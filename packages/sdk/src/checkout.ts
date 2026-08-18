/**
 * Cluster G: outbound destination-link composition, the `data-gh-checkout`
 * attribute behavior, and the `await gh.checkoutUrl(slug)` programmatic twin.
 *
 * The canonical page shape is an offer selector: several destinations bound
 * to the available choices, where selecting one navigates the current page to
 * that destination's URL. The destination URL therefore *is* the checkout
 * navigation target — one composer, one attribute (spec D7).
 */

import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from './config';
import type { SessionState } from './session';
import type { ParsedParams } from './url-params';
import type { Logger } from './log';
import { GhError } from './errors';

/**
 * `ParsedParams` key → outbound query-param name, in the canonical funnel
 * order (spec D6). Order is part of the contract; tests assert it.
 *
 * `subidN` — not `sub_idN` — and `sessionid` (set separately, ahead of this
 * list) are the spellings the funnel reads. `session_id` and `sub_idN` are
 * silently ignored by it, which shows up downstream as duplicate sessions
 * and orphaned attribution.
 */
const PARAM_KEY_MAP: Array<[keyof ParsedParams, string]> = [
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
  ['subId1', 'subid1'],
  ['subId2', 'subid2'],
  ['subId3', 'subid3'],
  ['subId4', 'subid4'],
  ['subId5', 'subid5'],
  ['landingUrl', 'landing_url'],
  ['referralUrl', 'referral_url'],
  ['salesFunnel', 'sales_funnel'],
  ['fbclid', 'fbclid'],
  ['gclid', 'gclid'],
  ['scCid', 'ScCid'],
  ['qclid', 'qclid'],
  ['twclid', 'twclid'],
  ['ndclid', 'ndclid'],
  ['wbraid', 'wbraid'],
];

/**
 * Forwarded verbatim from the current page URL when present, appended last.
 * These carry the funnel's own destination and split-test identity across the
 * hop; the SDK never synthesises them.
 */
const FORWARDED_PARAM_NAMES = ['origdsidOrig', 'origsplitTestingFunnelIdOrig'] as const;

/**
 * Resolve the base URL a destination's link points at:
 *
 *   destination.pricing.checkoutOverrideUrl   // per-destination override
 *     ?? destination.url                      // the normal case
 *     ?? config.checkoutBase                  // brand-level data-checkout-base
 *
 * @throws GhError('config') when all three are absent.
 */
export function resolveDestinationBase(
  destination: HippoShopDestinationDTO,
  config: GhConfig,
): string {
  const base =
    destination.pricing.checkoutOverrideUrl ?? destination.url ?? config.checkoutBase;
  if (!base) {
    throw new GhError(
      'config',
      `No URL resolved for destination "${destination.slug}". Salesforce supplied no ` +
        `destination url, pricing.checkoutOverrideUrl is unset, and the script tag has ` +
        `no data-checkout-base.`,
    );
  }
  return base;
}

/**
 * Compose the outbound URL for a destination: the resolved base plus
 * `order_form_id`, `sessionid`, the attribution params in canonical order,
 * and the forwarded `orig*` params from the current page.
 *
 * `setIfAbsent` semantics: a param already present on the base URL wins.
 * That is the opposite of the `/cid` merge rule, and deliberate — the base
 * URL is page-authored, so the author's override is the right behaviour.
 *
 * @throws GhError('config') if no base URL resolves, or if it will not parse.
 */
export function composeCheckoutUrl(
  destination: HippoShopDestinationDTO,
  config: GhConfig,
  session: SessionState,
): string {
  const baseStr = resolveDestinationBase(destination, config);

  let url: URL;
  try {
    url = new URL(baseStr);
  } catch (err) {
    throw new GhError('config', `Invalid destination URL: ${baseStr}`, { cause: err });
  }

  setIfAbsent(url, 'order_form_id', destination.pricing.orderFormId);
  setIfAbsent(url, 'sessionid', session.sessionId);

  for (const [key, paramName] of PARAM_KEY_MAP) {
    setIfAbsent(url, paramName, session.params[key]);
  }

  const current = currentSearchParams();
  for (const name of FORWARDED_PARAM_NAMES) {
    setIfAbsent(url, name, current.get(name));
  }

  return url.toString();
}

/** The current page's query string, or an empty set outside a browser. */
function currentSearchParams(): URLSearchParams {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  try {
    return new URLSearchParams(search);
  } catch {
    return new URLSearchParams();
  }
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
