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

import type { HippoShopDestinationDTO, HippoShopFunnelDTO } from '@goldenhippo/hippo-shop-types';
import type { GhDataClient } from './client';
import { applyBindings, collectResources, RESOURCE_ATTR, RESOURCE_KINDS, type ResourceState } from './bindings';
import { FormatRegistry } from './format';
import { GhError } from './errors';
import type { Logger } from './log';
import type { GhConfig } from './config';
import { applyCheckoutBindings } from './checkout';
import { getSessionState } from './session';
import { notifyStepChanged, readStepSlug } from './events';

export interface RuntimeOptions {
  doc?: Document;
  win?: Window;
  logger: Logger;
  client: GhDataClient;
  config: GhConfig;
}

export class GhRuntime {
  readonly formatters = new FormatRegistry();
  private readonly resources = new Map<string, unknown>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly resourceStates = new Map<string, ResourceState>();
  private observer: MutationObserver | null = null;
  private rebindScheduled = false;
  private bindingsReadyFired = false;
  private sessionReadyInstalled = false;
  /** `undefined` = never observed; the first bind only records a baseline. */
  private lastStepSlug: string | null | undefined = undefined;
  private readonly doc: Document;
  private readonly win: Window;
  /**
   * The boot-time session promise, handed over by `boot()` right after
   * `ensureSession` is invoked. Until then it is an already-settled promise,
   * which is the honest value for the direct-construction path (tests,
   * embedders) where no session resolution is pending at all.
   */
  private sessionPromise: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: RuntimeOptions) {
    this.doc = opts.doc ?? document;
    this.win = opts.win ?? window;
  }

  /**
   * Hand the runtime the boot-time session promise, so every checkout bind
   * pass carries the real promise rather than a fabricated resolved one.
   * Called once, by `boot()`.
   */
  setSessionPromise(promise: Promise<unknown>): void {
    this.sessionPromise = promise;
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

    // Cluster G: also bind [data-gh-checkout] elements. `getSession` is a live
    // read — bindOne holds links at href="#" until the session resolves, and
    // the gh:session-ready rebind fills them in. `sessionPromise` is boot's
    // own promise, handed over by setSessionPromise — the synchronous DOM
    // pass does not await it, but anything reading it back off these options
    // must get the real one, not a fabricated resolved stand-in.
    applyCheckoutBindings(target, {
      config: this.opts.config,
      getSession: () => getSessionState(),
      sessionPromise: this.sessionPromise,
      getDestination: (slug) => this.getCachedDestination(slug),
      ensureDestination: (slug) => this.ensureDestination(slug),
      logger: this.opts.logger,
    });

    // Cluster G / D9: an SPA that swaps data-gh-step is declaring a new funnel
    // step. attachObserver watches that attribute (Task 32) and every such
    // mutation lands here — this is where the change becomes a signal the Page
    // View emitter can act on. Adding the attribute to the filter alone only
    // re-runs bind(); the emitter's `fired` latch would never clear.
    //
    // The first observation is a baseline, never a change: bind() runs before
    // any emission and must not re-arm an emitter that has not fired yet.
    const stepSlug = readStepSlug(this.doc);
    const stepChanged = this.lastStepSlug !== undefined && stepSlug !== this.lastStepSlug;
    this.lastStepSlug = stepSlug;
    if (stepChanged) {
      this.opts.logger.debug('data-gh-step changed —', stepSlug);
      notifyStepChanged(this.win);
    }

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
      'data-with',
      'data-when',
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

  /** Cluster F: synchronous lookup of a cached destination, or null. */
  getCachedDestination(slug: string): HippoShopDestinationDTO | null {
    return (this.resources.get(`destination:${slug}`) as HippoShopDestinationDTO | undefined) ?? null;
  }

  /**
   * Cluster G: synchronous lookup of a cached funnel, or null. Funnel-event
   * identity needs `steps[].id` to resolve `funnelSTPId` from `data-gh-step`.
   */
  getCachedFunnel(slug: string): HippoShopFunnelDTO | null {
    return (this.resources.get(`funnel:${slug}`) as HippoShopFunnelDTO | undefined) ?? null;
  }

  /** Cluster F: trigger a destination load (idempotent via in-flight dedup). */
  ensureDestination(slug: string): Promise<void> {
    return this.loadOne('destination', slug);
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

    // Safety net for callers that only call installAutoBind(). boot() calls
    // this earlier — before ensureSession — and the flag makes it a no-op.
    this.installSessionReadyRebind();
  }

  /**
   * Re-bind once the session resolves, so checkout hrefs pick up the real
   * `sessionid` instead of staying at "#".
   *
   * Must be registered *before* `ensureSession` is invoked: a session that
   * resolves without awaiting anything dispatches `gh:session-ready`
   * synchronously, inside the invoking call, and a listener registered
   * afterwards would never see it. Idempotent. Fire-and-forget; `bind()`
   * handles its own errors.
   */
  installSessionReadyRebind(): void {
    if (this.sessionReadyInstalled) return;
    this.sessionReadyInstalled = true;
    this.win.addEventListener(
      'gh:session-ready',
      () => {
        void this.bind(this.doc).catch((err) =>
          this.opts.logger.error('session-ready rebind failed', err),
        );
      },
      { once: true },
    );
  }
}
