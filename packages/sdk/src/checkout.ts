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
 * These carry the funnel's own funnel, destination, and split-test identity
 * across the hop; the SDK never synthesises them.
 *
 * Deliberately excludes `funnelSTPId` and `dsid`. The `/fst` destination
 * resolver re-mints `funnelSTPId` on every hop — it is always the current
 * page's step-1 sfid, never advancing — so forwarding a stale value here
 * would actively corrupt the next page's step id rather than merely leave it
 * unresolved. `dsid` is the internal-branch alias of `origdsidOrig`, already
 * covered by that param.
 */
const FORWARDED_PARAM_NAMES = [
  'origmainFunnelIdOrig',
  'origdsidOrig',
  'origsplitTestingFunnelIdOrig',
] as const;

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
 * `setIfAbsent` semantics apply to the attribution params: a param already
 * present on the base URL wins. That is the opposite of the `/cid` merge
 * rule, and deliberate — the base URL is page-authored, so the author's
 * override is the right behaviour there.
 *
 * `order_form_id` and `sessionid` are the exception (I2): all three of
 * `resolveDestinationBase`'s sources can come from Salesforce (only
 * `config.checkoutBase` is genuinely page-authored), and an ops user pasting
 * a live funnel URL into the destination record — one that already has a
 * `sessionid` baked in — would otherwise pin every visitor to that one
 * session. These two are SDK-owned: they are set unconditionally,
 * overwriting whatever the base URL carried, and a pre-existing value is
 * logged as a warning so the misconfiguration is visible.
 *
 * @throws GhError('config') if no base URL resolves, or if it will not parse.
 */
export function composeCheckoutUrl(
  destination: HippoShopDestinationDTO,
  config: GhConfig,
  session: SessionState,
  logger?: Logger,
): string {
  const baseStr = resolveDestinationBase(destination, config);

  let url: URL;
  try {
    url = new URL(baseStr);
  } catch (err) {
    throw new GhError('config', `Invalid destination URL: ${baseStr}`, { cause: err });
  }

  setSdkOwned(url, 'order_form_id', destination.pricing.orderFormId, logger);
  if (config.checkoutSessionId) {
    setSdkOwned(url, 'sessionid', session.sessionId, logger);
  } else {
    // `data-checkout-sessionid="off"`: another system owns this param on these
    // pages, so we leave the URL's own value alone. The I2 check still runs —
    // a foreign `sessionid` baked into a Salesforce destination record is
    // still a misconfiguration, and it is now load-bearing rather than
    // harmlessly overwritten, so it must not go quiet just because we stopped
    // writing the param.
    warnForeignSessionId(url, logger);
  }

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

/**
 * Set `name=value` unconditionally, overwriting whatever the base URL
 * carried. Empty values are skipped — never clobber a real base-URL value
 * with nothing. Warns when a pre-existing, different value is overwritten,
 * since that is always a misconfiguration for the two SDK-owned identifiers
 * this is used for (I2).
 */
function setSdkOwned(url: URL, name: string, value: string | undefined | null, logger?: Logger): void {
  if (!value) return;
  const existing = url.searchParams.get(name);
  // Overwrite first, warn second, matching the `bindOne` catch above. The
  // ordering is no longer load-bearing — `createLogger`'s `emit` cannot throw
  // whatever the host page has done to `console` — but it is the right shape:
  // the write this function exists to perform should not depend on a
  // diagnostic. Historically a throwing `console.warn` could escape here and
  // leave the foreign `sessionid`/`order_form_id` sitting on the URL.
  url.searchParams.set(name, value);
  if (existing !== null && existing !== value) {
    logger?.warn(
      `checkout: destination base URL already had "${name}=${existing}" — overwriting with the ` +
        `session's own value. This base URL likely has a foreign ${name} baked in (e.g. a pasted ` +
        `live funnel link); fix the destination URL/checkoutOverrideUrl in Salesforce.`,
    );
  }
}

/**
 * Warn about a pre-existing `sessionid` on the base URL when the SDK is not
 * writing its own. Same misconfiguration `setSdkOwned` warns about (I2), with
 * a different remedy line: nothing overwrote it, so it is what the visitor
 * will actually be sent with.
 */
function warnForeignSessionId(url: URL, logger?: Logger): void {
  const existing = url.searchParams.get('sessionid');
  if (existing === null) return;
  logger?.warn(
    `checkout: destination base URL carries "sessionid=${existing}" and ` +
      `data-checkout-sessionid="off" leaves it in place — every visitor through this link ` +
      `gets that one session id. Fix the destination URL/checkoutOverrideUrl in Salesforce.`,
  );
}

// ---------------------------------------------------------------------------
// DOM binding surface (Task 8)
// ---------------------------------------------------------------------------

const CHECKOUT_ATTR = 'data-gh-checkout';
const BOUND_FLAG = 'ghCheckoutBound';

export interface CheckoutBindingsOptions {
  config: GhConfig;
  /**
   * Live read of session state — `null` until `ensureSession` resolves.
   * A thunk rather than a snapshot: one stable identity always reads current
   * state, so nothing can hold a pre-resolve, un-attributed session.
   */
  getSession: () => SessionState | null;
  /**
   * Resolves when `ensureSession` has settled. `makeCheckoutUrlFn` awaits it;
   * the synchronous DOM pass does not — `bindOne` holds links at `href="#"`
   * and the `gh:session-ready` rebind fills them in.
   */
  sessionPromise: Promise<unknown>;
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
    // Stub href until the destination loads; trigger the load.
    if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
    opts
      .ensureDestination(slug)
      .catch((err) =>
        opts.logger.warn(`checkout: failed to load destination "${slug}"`, err),
      );
    return;
  }

  // Session unresolved: hold the link inert rather than emitting a
  // syntactically valid URL with `sessionid` and every UTM silently missing.
  // The `gh:session-ready` rebind fills it in.
  const session = opts.getSession();
  if (!session) {
    if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
    opts.logger.debug(`checkout: session unresolved — holding "${slug}" at href="#"`);
    return;
  }

  let url: string;
  try {
    url = composeCheckoutUrl(destination, opts.config, session, opts.logger);
  } catch (err) {
    // Inert first, warn second — never the reverse. `createLogger`'s `emit`
    // now makes a throwing or absent `console` harmless, so this ordering is
    // defence in depth rather than the only thing holding the guarantee up.
    // Keep it: stopping a click from navigating to a stale offer is the entire
    // point of this fallback, and it should not sit downstream of a log line.
    // Same shape as the post-failure warn in `ensureSession` (session.ts).
    if (el instanceof HTMLAnchorElement) el.setAttribute('href', '#');
    opts.logger.warn(`checkout: cannot compose URL for "${slug}"`, err);
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
 * Programmatic equivalent of `<a data-gh-checkout="slug">`. Async by design
 * (spec D8): it awaits the session before composing, so it never returns the
 * params-less URL that a pre-resolve snapshot used to produce, and it warms a
 * cold destination cache instead of making the caller catch, subscribe to
 * `gh:bindings-ready`, and retry.
 *
 * The returned function keeps one stable identity for the life of the page —
 * it must never be reassigned, or anything holding a reference (a GTM
 * variable, a React prop, `const f = gh.checkoutUrl`) keeps a stale closure.
 *
 * Known cost: `window.open(await gh.checkoutUrl(x))` inside a click handler
 * breaks the user-gesture chain and will be popup-blocked. Assigning
 * `window.location.href` is unaffected.
 *
 * `logger` is optional (unlike the DOM-binding path) so existing callers that
 * never had one to hand keep working; when supplied, it surfaces the I2
 * sessionid/order_form_id-overwrite warning the same as the DOM binding path.
 */
export function makeCheckoutUrlFn(
  opts: Omit<CheckoutBindingsOptions, 'logger'> & { logger?: Logger },
): (slug: string) => Promise<string> {
  return async function checkoutUrl(slug: string): Promise<string> {
    // Session first. A rejection here is not fatal — ensureSession swallows
    // its own failures and still resolves a state.
    await Promise.resolve(opts.sessionPromise).catch(() => undefined);

    let destination = opts.getDestination(slug);
    if (!destination) {
      await opts.ensureDestination(slug);
      destination = opts.getDestination(slug);
    }
    if (!destination) {
      throw new GhError(
        'not_found',
        `gh.checkoutUrl("${slug}"): destination could not be loaded`,
      );
    }

    const session = opts.getSession() ?? {
      sessionId: '',
      adopted: false,
      params: {},
      isNew: false,
      data: null,
    };
    return composeCheckoutUrl(destination, opts.config, session, opts.logger);
  };
}
