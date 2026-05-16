/**
 * Runtime ties the data client and the declarative bindings together.
 *
 * Lifecycle:
 *   1. Boot attaches `window.gh.data` + `bind`/`refresh`/`format` synchronously.
 *   2. On DOMContentLoaded, the runtime scans the page, fetches all referenced
 *      resources in parallel, and renders the initial bindings.
 *   3. A MutationObserver watches for late-arriving `data-gh-*` elements
 *      (GTM/SPA injections) and re-runs the bind pass.
 *   4. `gh:bindings-ready` fires once after the initial bind completes.
 */

import type { GhDataClient } from './client';
import { applyBindings, collectResources, RESOURCE_ATTR, RESOURCE_KINDS, type ResourceState } from './bindings';
import { FormatRegistry } from './format';
import { GhError } from './errors';
import type { Logger } from './log';

export interface RuntimeOptions {
  doc?: Document;
  win?: Window;
  logger: Logger;
  client: GhDataClient;
}

export class GhRuntime {
  readonly formatters = new FormatRegistry();
  private readonly resources = new Map<string, unknown>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly resourceStates = new Map<string, ResourceState>();
  private observer: MutationObserver | null = null;
  private rebindScheduled = false;
  private bindingsReadyFired = false;
  private readonly doc: Document;
  private readonly win: Window;

  constructor(private readonly opts: RuntimeOptions) {
    this.doc = opts.doc ?? document;
    this.win = opts.win ?? window;
  }

  /**
   * Scan `root` (default: the whole document) for `data-gh-*` references,
   * fetch any not-yet-cached resources, and apply bindings.
   * Safe to call repeatedly; in-flight fetches are deduped.
   */
  async bind(root: ParentNode | Element = this.doc): Promise<void> {
    const refs = collectResources(root);
    const target = root instanceof Document ? root : (root as Element);

    if (refs.length > 0) {
      // Pre-fetch pass: mark all unloaded resources as 'loading' and apply bindings
      // immediately so data-when="loading" elements can show their skeletons before
      // the fetch settles.
      let needsPrePass = false;
      for (const ref of refs) {
        const key = `${ref.kind}:${ref.slug}`;
        if (!this.resources.has(key) && this.resourceStates.get(key) !== 'loading') {
          this.resourceStates.set(key, 'loading');
          needsPrePass = true;
        }
      }
      if (needsPrePass) {
        applyBindings(target, {
          formatters: this.formatters,
          resources: this.resources,
          resourceStates: this.resourceStates,
        });
      }
      await Promise.all(refs.map(ref => this.loadOne(ref.kind, ref.slug)));
    }

    applyBindings(target, {
      formatters: this.formatters,
      resources: this.resources,
      resourceStates: this.resourceStates,
    });
    if (!this.bindingsReadyFired) {
      this.bindingsReadyFired = true;
      this.win.dispatchEvent(new Event('gh:bindings-ready'));
    }
  }

  /**
   * Drop all cached resource data + the client's in-flight cache, then
   * re-bind the whole document. Use after a known data change (e.g. you've
   * informed the API of a price update and want the page to reflect it).
   */
  async refresh(): Promise<void> {
    this.resources.clear();
    this.resourceStates.clear();
    this.opts.client.clearCache();
    await this.bind(this.doc);
  }

  /**
   * Attach a MutationObserver that re-binds whenever a relevant attribute
   * changes or a subtree with bindings is added. Debounced to one microtask
   * so a burst of DOM changes triggers only one re-bind.
   */
  attachObserver(): void {
    if (this.observer) return;
    const filter = [
      ...RESOURCE_KINDS.map(k => RESOURCE_ATTR[k]),
      'data-field',
      'data-format',
      'data-if',
      'data-if-not',
      'data-each',
    ];
    this.observer = new MutationObserver(mutations => {
      // Heuristic: ignore mutations caused by our own loop expansion to avoid
      // a feedback loop. Loop clones carry `data-gh-loop-clone`.
      const meaningful = mutations.some(m => {
        if (m.type === 'attributes') return true;
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof Element && !node.hasAttribute('data-gh-loop-clone')) return true;
        }
        return false;
      });
      if (meaningful) this.scheduleRebind();
    });
    this.observer.observe(this.doc.documentElement ?? this.doc.body ?? this.doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: filter,
    });
  }

  detachObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private scheduleRebind(): void {
    if (this.rebindScheduled) return;
    this.rebindScheduled = true;
    queueMicrotask(() => {
      this.rebindScheduled = false;
      void this.bind(this.doc).catch(err => {
        this.opts.logger.error('bind failed', err);
      });
    });
  }

  private loadOne(kind: 'product' | 'destination' | 'funnel', slug: string): Promise<void> {
    const key = `${kind}:${slug}`;
    if (this.resources.has(key)) return Promise.resolve();
    const inflight = this.inFlight.get(key);
    if (inflight) return inflight;
    this.resourceStates.set(key, 'loading');
    const promise = (async () => {
      try {
        const data = await this.opts.client[kind](slug);
        this.resources.set(key, data);
        this.resourceStates.set(key, 'loaded');
      } catch (err) {
        this.resourceStates.set(key, 'failed');
        if (err instanceof GhError) {
          this.opts.logger.warn(`failed to load ${kind} "${slug}" — ${err.code}: ${err.message}`);
        } else {
          this.opts.logger.warn(`failed to load ${kind} "${slug}"`, err);
        }
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Wire DOMContentLoaded → initial bind. Idempotent. */
  installAutoBind(): void {
    const run = (): void => {
      void this.bind(this.doc)
        .catch(err => this.opts.logger.error('initial bind failed', err))
        .finally(() => this.attachObserver());
    };
    if (this.doc.readyState === 'loading') {
      this.doc.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      // setTimeout(0) yields a full task so subsequent inline scripts (e.g.
      // registering a custom formatter) finish before the first bind pass.
      // queueMicrotask runs *between* script tags and would miss them.
      setTimeout(run, 0);
    }
  }
}
