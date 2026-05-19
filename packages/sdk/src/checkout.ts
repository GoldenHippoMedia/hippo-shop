/**
 * Cluster F: outbound checkout URL composition + (in Task 8)
 * `data-gh-checkout` attribute behavior and the `gh.checkoutUrl(slug)`
 * programmatic API.
 *
 * `composeCheckoutUrl` is a pure function: given a destination DTO, the
 * SDK config, and the current session state, it returns the outbound
 * URL. Falls back through brand-level `data-checkout-base` if the DTO
 * has no override; throws if neither is configured.
 */

import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from './config';
import type { SessionState } from './session';
import type { Logger } from './log';
import { GhError } from './errors';

/**
 * Keys in `ParsedParams` → query-param names on the outbound checkout URL.
 * Order matters for deterministic output (tests rely on this).
 */
const PARAM_KEY_MAP: Array<[keyof NonNullable<SessionState['params']>, string]> = [
  ['utmSource', 'utm_source'],
  ['utmMedium', 'utm_medium'],
  ['utmCampaign', 'utm_campaign'],
  ['utmCampaignId', 'utm_campaign_id'],
  ['utmContent', 'utm_content'],
  ['utmTerm', 'utm_term'],
  ['utmChat', 'utm_chat'],
  ['utmAction', 'utm_action'],
  ['offId', 'off_id'],
  ['affId', 'aff_id'],
  ['subId1', 'sub_id1'],
  ['subId2', 'sub_id2'],
  ['subId3', 'sub_id3'],
  ['subId4', 'sub_id4'],
  ['subId5', 'sub_id5'],
];

/**
 * Compose the outbound checkout URL for a destination.
 *
 * @throws GhError('config') if neither `destination.pricing.checkoutOverrideUrl`
 *  nor `config.checkoutBase` is set.
 */
export function composeCheckoutUrl(
  destination: HippoShopDestinationDTO,
  config: GhConfig,
  session: SessionState,
): string {
  const baseStr = destination.pricing.checkoutOverrideUrl ?? config.checkoutBase;
  if (!baseStr) {
    throw new GhError(
      'config',
      `No checkout base URL configured for destination "${destination.slug}". ` +
        `Set the script-tag data-checkout-base or destination.pricing.checkoutOverrideUrl.`,
    );
  }

  let url: URL;
  try {
    url = new URL(baseStr);
  } catch (err) {
    throw new GhError('config', `Invalid checkout base URL: ${baseStr}`, { cause: err });
  }

  setIfAbsent(url, 'order_form_id', destination.pricing.orderFormId);
  setIfAbsent(url, 'session_id', session.sessionId);

  if (session.params) {
    for (const [key, paramName] of PARAM_KEY_MAP) {
      const value = session.params[key];
      if (value) setIfAbsent(url, paramName, value);
    }
  }

  return url.toString();
}

/** Set `name=value` on the URL's search params only if not already set. Empty values are skipped. */
function setIfAbsent(url: URL, name: string, value: string | undefined | null): void {
  if (!value) return;
  if (url.searchParams.has(name)) return;
  url.searchParams.set(name, value);
}

// ---------------------------------------------------------------------------
// DOM binding surface (Task 8)
// ---------------------------------------------------------------------------

const CHECKOUT_ATTR = 'data-gh-checkout';
const BOUND_FLAG = 'ghCheckoutBound';

export interface CheckoutBindingsOptions {
  config: GhConfig;
  session: SessionState;
  /** Resolve a destination slug to its cached DTO, or null if not yet loaded. */
  getDestination: (slug: string) => HippoShopDestinationDTO | null;
  /** Trigger a fetch for a destination if not yet loaded. Returns when loaded. */
  ensureDestination: (slug: string) => Promise<void>;
  logger: Logger;
}

/**
 * Walk a root for `[data-gh-checkout]` elements and apply the appropriate
 * binding for each:
 *
 * - `<a>` → set `href` to the composed checkout URL (native browser navigation).
 * - non-`<a>` → attach a click handler that navigates the page on click.
 *
 * If the destination is not yet loaded, the href is set to `"#"` and
 * `ensureDestination` is invoked to load it. The caller is responsible
 * for re-running `applyCheckoutBindings` once the destination resolves
 * (typically via the existing MutationObserver re-bind in `runtime.ts`).
 *
 * Idempotent: re-running on the same DOM updates href values and is safe
 * for click handlers (the BOUND_FLAG dataset attribute prevents double-binding).
 */
export function applyCheckoutBindings(
  root: ParentNode,
  opts: CheckoutBindingsOptions,
): void {
  const elements = root.querySelectorAll<HTMLElement>(`[${CHECKOUT_ATTR}]`);
  for (const el of Array.from(elements)) {
    const slug = el.getAttribute(CHECKOUT_ATTR);
    if (!slug) continue;
    bindOne(el, slug, opts);
  }
}

function bindOne(el: HTMLElement, slug: string, opts: CheckoutBindingsOptions): void {
  const destination = opts.getDestination(slug);
  if (!destination) {
    // Stub href until destination loads; trigger the load.
    if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
    opts
      .ensureDestination(slug)
      .catch((err) =>
        opts.logger.warn(`checkout: failed to load destination "${slug}"`, err),
      );
    return;
  }

  let url: string;
  try {
    url = composeCheckoutUrl(destination, opts.config, opts.session);
  } catch (err) {
    opts.logger.warn(`checkout: cannot compose URL for "${slug}"`, err);
    if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
    return;
  }

  if (el instanceof HTMLAnchorElement) {
    el.setAttribute('href', url);
    return;
  }

  // Non-<a>: attach click handler once (idempotent via dataset flag).
  if (el.dataset[BOUND_FLAG] === '1') {
    // Already bound; update the stored URL for the handler to read.
    el.dataset['ghCheckoutUrl'] = url;
    return;
  }
  el.dataset[BOUND_FLAG] = '1';
  el.dataset['ghCheckoutUrl'] = url;
  el.addEventListener('click', (evt) => {
    evt.preventDefault();
    const target = el.dataset['ghCheckoutUrl'];
    if (target && typeof window !== 'undefined') {
      window.location.href = target;
    }
  });
}

/**
 * Programmatic equivalent of `<a data-gh-checkout="slug">`. Returns the
 * composed checkout URL for `slug` synchronously. Throws if the destination
 * is not yet cached or if no base URL is configured.
 *
 * Page authors who need to retrieve a checkout URL outside of the
 * declarative attribute (e.g., SPA route push, analytics-instrumented
 * click) call `gh.checkoutUrl(slug)`. The wire-up to `window.gh` happens
 * in `index.ts` (Task 9).
 */
export function makeCheckoutUrlFn(
  opts: Omit<CheckoutBindingsOptions, 'logger'>,
): (slug: string) => string {
  return function checkoutUrl(slug: string): string {
    const destination = opts.getDestination(slug);
    if (!destination) {
      // Trigger a load for the next call; throw to make the missing-cache
      // case visible to the caller.
      opts.ensureDestination(slug);
      throw new GhError(
        'not_found',
        `gh.checkoutUrl("${slug}"): destination not yet loaded — try again after gh:bindings-ready`,
      );
    }
    return composeCheckoutUrl(destination, opts.config, opts.session);
  };
}
