/**
 * Parses `<script data-key="..." data-brand="...">` attributes and derives
 * the API base URL from the script's own `src`. Refuses to attach if the
 * script was loaded from an unrecognized host — the host is the contract.
 */

export interface GhConfig {
  key: string;
  brand: string;
  debug: boolean;
  apiBaseUrl: string;
  /** Brand-level default for the checkout handoff base URL. `null` if not supplied. */
  checkoutBase: string | null;
  /** Explicit cookie domain (e.g., `.gundrymd.com`). `null` triggers auto-detect at cookie-write time. */
  cookieDomain: string | null;
  /**
   * Brand token for the funnel-event payload's `brand` field, e.g. `gundry`.
   * Deliberately separate from `brand` (`Gundry MD`): Altern reads the payload
   * field, and it expects the BRAND_NAME token vocabulary, not the display name.
   * `null` when `data-brand-token` is absent — the emitter then falls back to
   * `brand` and the value may not match what Altern expects.
   */
  brandToken: string | null;
  /**
   * `data-session`. When false the SDK resolves no identity of its own: no
   * `POST /public/v1/session`, no `hippo_session_id` cookie read or write, and
   * `SessionState.sessionId` is `''`.
   *
   * Landing attribution is still parsed, so UTM and click-id params keep riding
   * outbound checkout links. Two knock-ons are intended: `sessionid=` drops off
   * those links for free (composeCheckoutUrl skips empty values), and funnel
   * events are suppressed regardless of `eventsEnabled`, because an event
   * carrying no session id is unattributable.
   */
  sessionEnabled: boolean;
  /**
   * `data-checkout-sessionid`. When false, `sessionid=` is not written onto
   * outbound checkout URLs. Everything else about the session — the POST, the
   * cookie, funnel events — is untouched.
   *
   * For pages where another system owns the param. Superfunnel appends its own
   * `sessionid` to every link on the page; ours was written first and every
   * reader takes the first occurrence, so ours silently won. This leaves theirs
   * alone. Knowingly re-opens I2 (see `setSdkOwned` in checkout.ts).
   */
  checkoutSessionId: boolean;
  /** `data-events`. When false the Page View emitter is not installed and `gh.track` is a no-op. */
  eventsEnabled: boolean;
  /**
   * `data-session-url-first`. Opt-in inversion of the top two rungs of the D1
   * resolution ladder: `?sessionid=` outranks the `hippo_session_id` cookie.
   *
   * Off by default, because D1's cookie-first ruling is what stops an inbound
   * link re-keying a returning visitor's session on every visit. On for pages
   * hosted by a system that owns visitor identity — Superfunnel puts its id on
   * the URL, and a 30-day-old cookie of ours must not outrank it there.
   */
  sessionUrlFirst: boolean;
}

const KEY_PATTERN = /^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/;

const PROD_HOST = 'api-prod.goldenhippo.io';
const UAT_HOST = 'api-uat.goldenhippo.io';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseScriptConfig(script: HTMLScriptElement): GhConfig {
  const key = script.dataset['key'] ?? '';
  const brand = script.dataset['brand'] ?? '';
  const debug = script.dataset['debug'] === 'true';

  if (!KEY_PATTERN.test(key)) {
    throw new ConfigError(
      `data-key must match /^gh_pk_[a-z0-9_-]+_<hex>$/ — got: ${truncate(key)}`,
    );
  }
  if (!brand.trim()) {
    throw new ConfigError('data-brand is required and must be non-empty');
  }

  const src = script.src;
  if (!src) {
    throw new ConfigError('script src is empty — cannot derive API base URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch (err) {
    throw new ConfigError(`could not parse script src as URL: ${src}`, { cause: err });
  }

  if (!isAllowedApiHost(parsed.hostname)) {
    throw new ConfigError(`script loaded from disallowed host: ${parsed.hostname}`);
  }

  const checkoutBase = (script.dataset['checkoutBase'] ?? '').trim() || null;
  const cookieDomain = (script.dataset['cookieDomain'] ?? '').trim() || null;
  const brandToken = (script.dataset['brandToken'] ?? '').trim() || null;

  return {
    key,
    brand: brand.trim(),
    debug,
    apiBaseUrl: parsed.origin,
    checkoutBase,
    cookieDomain,
    brandToken,
    sessionEnabled: isEnabled(script.dataset['session']),
    checkoutSessionId: isEnabled(script.dataset['checkoutSessionid']),
    eventsEnabled: isEnabled(script.dataset['events']),
    sessionUrlFirst: isOptedIn(script.dataset['sessionUrlFirst']),
  };
}

/**
 * Opt-OUT parse for the feature toggles: absent means on, and only an explicit
 * `"off"` or `"false"` turns the feature off.
 *
 * Both spellings are accepted because either is a reasonable guess and the cost
 * of guessing wrong is silent. The failure is asymmetric in the other
 * direction too, which is why anything unrecognized stays ON: a typo that
 * disabled session tracking for a whole brand would return `200`s and show up
 * in nothing but a missing-revenue report weeks later.
 */
function isEnabled(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v !== 'off' && v !== 'false';
}

/** Opt-IN parse: absent means off, and only an explicit `"true"` turns it on. */
function isOptedIn(raw: string | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

export function isAllowedApiHost(hostname: string): boolean {
  if (hostname === PROD_HOST) return true;
  if (hostname === UAT_HOST) return true;
  if (LOCAL_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  return false;
}

export class ConfigError extends Error {
  override readonly cause: unknown;
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.cause = opts.cause;
  }
}

function truncate(s: string, n = 48): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
