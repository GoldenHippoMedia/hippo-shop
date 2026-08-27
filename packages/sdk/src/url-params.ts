/**
 * Landing-URL parser: captures UTM, sub-id, and click-id query parameters and
 * produces a `ParsedParams` shape directly compatible with the
 * POST /public/v1/session `affParameters` request body.
 *
 * Explicit query parameters (e.g. a literal `?subid1=manual`) are parsed
 * first and win over click-id-derived values: URL author intent beats
 * inference.
 *
 * Canonical sources, ported for parity:
 * - click-id table: `hippo-builder-funnel/src/server/cid/click-id-normalizer.ts:35-43`
 * - landing/referral rules: `.../core/services/hippo-api/session.service.ts:133,138,143,145`
 *
 * See the Cluster G design spec, decision D3.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g; // ASCII control chars
/** Stripped from click-id-derived sub-id values only (click-id-normalizer.ts:45-50). */
const CLICK_ID_UNSAFE_RE = /[<>'"`&]/g;

export interface ParsedParams {
  landingUrl?: string;
  referralUrl?: string;
  salesFunnel?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmCampaignId?: string;
  utmContent?: string;
  utmTerm?: string;
  utmChat?: string;
  utmAction?: string;
  offId?: string;
  affId?: string;
  subId1?: string;
  subId2?: string;
  subId3?: string;
  subId4?: string;
  subId5?: string;
  /**
   * Raw click-id values, forwarded verbatim (session.model.ts:22-30). Note the
   * mixed-case `scCid`.
   *
   * These have two consumers and a different fate on each, so do not conclude
   * from either half alone that they are dead weight:
   *  - Session POST: sent, but *not* persisted. The commerce session stores only
   *    its own 18 attribution keys, so on that path it is the derived
   *    `subId1`/`subId4`/`subId5` values that land, not these.
   *  - Outbound checkout links: these DO land — `checkout.ts` forwards all seven
   *    as query params, which is how the funnel receives the original click id.
   */
  fbclid?: string;
  gclid?: string;
  scCid?: string;
  qclid?: string;
  twclid?: string;
  ndclid?: string;
  wbraid?: string;
}

export interface ClickIdMapping {
  /** Inbound param name in the ad platform's casing; matched case-insensitively. */
  incoming: string;
  /** `ParsedParams` field that receives the raw value. */
  rawKey: 'fbclid' | 'gclid' | 'scCid' | 'qclid' | 'twclid' | 'ndclid' | 'wbraid';
  /** Sub-id slot that receives the derived value. */
  target: 'subId1' | 'subId4';
  /** Marker written to `subId5` when that slot is unset; `null` writes no marker. */
  platform: 'snap' | 'quora' | 'twitter' | 'nextdoor' | null;
}

/**
 * The canonical click-id table, ported from
 * `hippo-builder-funnel/src/server/cid/click-id-normalizer.ts:35-43`.
 *
 * Table order is precedence for the `subId1`/`subId4` slot: the first row with
 * a non-empty value claims the slot, and an already-present value is never
 * overwritten. Each row's slot write and its `subId5` marker are evaluated
 * independently — a row that loses the slot still applies its marker when
 * `subId5` is unset.
 */
export const CLICK_ID_MAP: readonly ClickIdMapping[] = [
  { incoming: 'fbclid', rawKey: 'fbclid', target: 'subId1', platform: null },
  { incoming: 'gclid', rawKey: 'gclid', target: 'subId1', platform: null },
  { incoming: 'ScCid', rawKey: 'scCid', target: 'subId1', platform: 'snap' },
  { incoming: 'qclid', rawKey: 'qclid', target: 'subId1', platform: 'quora' },
  { incoming: 'twclid', rawKey: 'twclid', target: 'subId1', platform: 'twitter' },
  { incoming: 'ndclid', rawKey: 'ndclid', target: 'subId1', platform: 'nextdoor' },
  { incoming: 'wbraid', rawKey: 'wbraid', target: 'subId4', platform: null },
] as const;

const UTM_KEY_MAP: Record<string, keyof ParsedParams> = {
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_campaign_id: 'utmCampaignId',
  utm_content: 'utmContent',
  utm_term: 'utmTerm',
  utm_chat: 'utmChat',
  utm_action: 'utmAction',
};

/** Canonical inbound spelling. Wins over the legacy `sub_idN` spelling. */
const SUB_ID_KEY_MAP: Record<string, keyof ParsedParams> = {
  subid1: 'subId1',
  subid2: 'subId2',
  subid3: 'subId3',
  subid4: 'subId4',
  subid5: 'subId5',
};

/** Legacy inbound spelling, accepted but never overwriting a canonical value. */
const LEGACY_SUB_ID_KEY_MAP: Record<string, keyof ParsedParams> = {
  sub_id1: 'subId1',
  sub_id2: 'subId2',
  sub_id3: 'subId3',
  sub_id4: 'subId4',
  sub_id5: 'subId5',
};

const OTHER_KEY_MAP: Record<string, keyof ParsedParams> = {
  off_id: 'offId',
  aff_id: 'affId',
  sales_funnel: 'salesFunnel',
  landing_url: 'landingUrl',
  referral_url: 'referralUrl',
};

/** First case-insensitive match for `key`, or null when absent. */
function findCaseInsensitive(params: URLSearchParams, key: string): string | null {
  const keyLower = key.toLowerCase();
  for (const [k, v] of params) {
    if (k.toLowerCase() === keyLower) return v;
  }
  return null;
}

/**
 * Strips ASCII control characters. Deliberately does NOT cap length: real
 * `fbclid` and `landing_url` values exceed 255 chars, and a truncated value
 * will not match what the funnel stored for the same click (D3).
 */
function clean(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '');
}

/**
 * Parse a landing URL into a ParsedParams shape ready for
 * POST /public/v1/session under `affParameters`. Empty/undefined fields are
 * omitted from the output (never sent as `""`) — a blank and an absent key are
 * equivalent upstream, so omitting is simply the smaller, unambiguous form.
 *
 * @param href The full landing URL, typically `window.location.href`.
 * @param referrer `document.referrer`. Accepted for signature stability and
 *  deliberately unused: on this path `referralUrl` comes from
 *  `?referral_url=` alone (D3). Upstream storage is per-key
 *  first-write-wins, so the hazard runs the other way: a `document.referrer`
 *  fallback on a *first* page view would durably claim `referralUrl` with
 *  whatever page linked in, and no later POST could correct it. The
 *  funnel-event payload derives its own `referralUrl` from
 *  `document.referrer` — a different call, different shape.
 * @param isReturningVisit I3: true when this page load reused an existing
 *  session (the `hippo_session_id` cookie was read rather than minted or
 *  adopted from `?sessionid=`). The session POST fires unconditionally on
 *  every page load and upstream storage is per-key first-write-wins. A
 *  returning visitor can still meet a *fresh* commerce session — its cookie
 *  expired or was blocked while `hippo_session_id` survived — and there the
 *  current href would become the permanent `landingUrl` for that session,
 *  uncorrectable by any later POST. On a returning visit the default is
 *  skipped entirely — an explicit `?landing_url=` below still wins
 *  regardless, exactly like a first touch.
 */
export function parseLandingParams(
  href: string,
  _referrer: string,
  isReturningVisit = false,
): ParsedParams {
  const out: ParsedParams = {};
  if (!isReturningVisit) {
    const landingDefault = clean(href.split('?')[0] ?? href);
    if (landingDefault) out.landingUrl = landingDefault;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return out; // malformed href — still return what we have
  }

  // Pass 1: explicit param keys. Written first so the click-id table below
  // never overwrites an author-supplied subid1/subid4/subid5.
  for (const [key, value] of url.searchParams.entries()) {
    const lower = key.toLowerCase();
    const cleanValue = clean(value);
    if (!cleanValue) continue;

    const utmKey = UTM_KEY_MAP[lower];
    if (utmKey) {
      out[utmKey] = cleanValue;
      continue;
    }

    const subIdKey = SUB_ID_KEY_MAP[lower];
    if (subIdKey) {
      out[subIdKey] = cleanValue;
      continue;
    }

    const legacySubIdKey = LEGACY_SUB_ID_KEY_MAP[lower];
    if (legacySubIdKey) {
      // Canonical `subidN` wins regardless of query-string order.
      if (out[legacySubIdKey] === undefined) out[legacySubIdKey] = cleanValue;
      continue;
    }

    const otherKey = OTHER_KEY_MAP[lower];
    if (otherKey) {
      out[otherKey] = cleanValue;
    }
  }

  // Pass 2: the canonical click-id table (D3).
  for (const row of CLICK_ID_MAP) {
    const found = findCaseInsensitive(url.searchParams, row.incoming);
    if (found === null) continue;
    const raw = clean(found);
    if (!raw) continue;

    out[row.rawKey] = raw;

    const derived = raw.replace(CLICK_ID_UNSAFE_RE, '');
    if (derived && out[row.target] === undefined) {
      out[row.target] = row.incoming === 'wbraid' ? `wbraid:${derived}` : derived;
    }

    // Independent of the slot write: a row that lost the slot still marks subId5.
    if (row.platform !== null && out.subId5 === undefined) {
      out.subId5 = row.platform;
    }
  }

  return out;
}

/**
 * Allowlist for URL-sourced session ids, matching the funnel app's
 * `SESSION_ID_PATTERN` (`hippo-builder-funnel` session.service.ts:23).
 * Permissive enough for every legitimate handoff shape (UUIDv4, legacy
 * 26-digit numeric, hyphenated alphanumeric) but excludes cookie-attribute
 * delimiters (`;`, `=`, `,`, whitespace, CR/LF): the funnel writes this value
 * into `document.cookie` unencoded, so a crafted `?sessionid=` could otherwise
 * inject attributes such as `Max-Age=0`. The 128-char cap bounds header size.
 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Read the session-id handoff param from a query string. Returns the trimmed
 * value when it passes SESSION_ID_PATTERN, else null — absent, blank and
 * malformed are the same answer to the caller, which falls through to the
 * cookie.
 *
 * The key is matched **case-insensitively**. This used to be an exact match,
 * justified by "the funnel reads `sessionid` case-sensitively
 * (session.service.ts:85)" — but that is a fact about what we must *write*, and
 * outbound checkout links still emit lowercase `sessionid` unchanged. It never
 * justified being strict about what we *read*. Superfunnel's landing pages
 * navigate to the offer selector with `?sessionId=` (camelCase), so the exact
 * match meant we never adopted their id and minted our own instead, leaving the
 * two systems disagreeing about the visitor for the whole session. Read
 * liberally, write exactly.
 *
 * Note this widens what the SDK accepts from the URL, and accepting a
 * URL-supplied id is session fixation by design (see the D1 note on
 * `resolveSessionId`). SESSION_ID_PATTERN, not the key's casing, is the
 * mitigation — a `?SeSsIoNiD=` attacker could always have written `?sessionid=`.
 *
 * Deliberately NOT a `ParsedParams` field: the resolved id is posted in its own
 * `affParameters.sessionId` slot, so parsing it here as well would double-send it.
 *
 * @param search A query string, with or without the leading `?`.
 */
export function readSessionIdFromUrl(search: string): string | null {
  const trimmed = firstSessionIdParam(search)?.trim();
  if (!trimmed) return null;
  if (!SESSION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * The first `sessionid`-keyed value in query-string order, whatever its casing
 * and whatever its value. Null when the key is absent or the string will not
 * parse.
 *
 * "First" is load-bearing, and this deliberately does NOT scan past a malformed
 * match for a valid later one. Duplicate `sessionid` params are the normal case
 * on a Superfunnel page — it appends its own to every link — and every
 * downstream reader, the funnel included, takes the first occurrence without
 * validating it. Recovering here would make the SDK the only party using the
 * second value. Agreeing on a bad id beats disagreeing about a good one.
 */
export function firstSessionIdParam(search: string): string | null {
  try {
    return findCaseInsensitive(new URLSearchParams(search), 'sessionid');
  } catch {
    return null;
  }
}
