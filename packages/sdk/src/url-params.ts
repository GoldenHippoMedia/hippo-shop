/**
 * Landing-URL parser: captures UTM and sub_id query parameters, runs the
 * click-id mapping registry, and produces a `ParsedParams` shape that's
 * directly compatible with the POST /session `affParameters` request body.
 *
 * Direct query parameters (e.g., literal `?sub_id1=manual`) take precedence
 * over click-id-derived values. URL author intent wins over inference.
 *
 * See the Cluster F design spec for the click-id mapping pattern.
 */

const MAX_VALUE_CHARS = 255;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g; // ASCII control chars

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
}

export type ClickIdMutator = (value: string, into: ParsedParams) => void;

/**
 * Maps a click-id query-param name to a function that writes channel-marker
 * and payload into ParsedParams. Each entry should: skip empty/non-string
 * values, and use `into` mutation rather than returning a new object.
 *
 * v1 ships with fbclid only. Adding a new mapping is a one-line entry.
 */
export const CLICK_ID_REGISTRY: Record<string, ClickIdMutator> = {
  fbclid: (value, into) => {
    if (!value) return;
    into.subId1 = 'fb';
    into.subId5 = value;
  },
};

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
};

function clean(value: string): string {
  const stripped = value.replace(CONTROL_CHARS_RE, '');
  if (stripped.length <= MAX_VALUE_CHARS) return stripped;
  return stripped.slice(0, MAX_VALUE_CHARS);
}

/**
 * Parse a landing URL + document.referrer into a ParsedParams shape ready
 * for POST /session under `affParameters`. Empty/undefined fields are
 * omitted from the output (not set to empty strings).
 *
 * @param href The full landing URL, typically `window.location.href`.
 * @param referrer `document.referrer`. Empty string omits referralUrl.
 */
export function parseLandingParams(href: string, referrer: string): ParsedParams {
  const out: ParsedParams = { landingUrl: href };
  if (referrer) out.referralUrl = referrer;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return out; // malformed href — still return what we have
  }

  // Pass 1: click-id mutators (so direct params can overwrite them in pass 2).
  for (const [paramName, mutator] of Object.entries(CLICK_ID_REGISTRY)) {
    const raw = url.searchParams.get(paramName);
    if (raw !== null) {
      mutator(clean(raw), out);
    }
  }

  // Pass 2: direct param keys. These win over click-id-derived values.
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
 * Read `?sessionid=` from a query string. Returns the trimmed value when it
 * passes SESSION_ID_PATTERN, else null — absent, blank and malformed are the
 * same answer to the caller, which falls through to the cookie.
 *
 * The key is matched **case-sensitively** (`URLSearchParams.get` is exact)
 * because the funnel reads `sessionid` case-sensitively (session.service.ts:85).
 *
 * Deliberately NOT a `ParsedParams` field: the resolved id is posted in its own
 * `affParameters.sessionId` slot, so parsing it here as well would double-send it.
 *
 * @param search A query string, with or without the leading `?`.
 */
export function readSessionIdFromUrl(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('sessionid');
  } catch {
    return null;
  }
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (!SESSION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}
