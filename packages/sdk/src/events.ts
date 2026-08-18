/**
 * Cluster G / D5, D9, D10: funnel-event emission.
 *
 * The wire shape is the 36-field Salesforce funnel-event payload, ported from
 * hippo-builder-funnel `build-funnel-event.utility.ts:14-63` (interface) and
 * `:102-150` (base construction). `Page View` takes the reference's
 * no-override branch (`:166-171`), so every value here is the base default —
 * there is no event-specific branch logic to port.
 *
 * Three field names collide with `ParsedParams` and mean different things:
 *   - `salesFunnel` is the hardcoded literal 'Funnel', NOT ParsedParams.salesFunnel.
 *   - `url` is a step SLUG, not a URL.
 *   - `referralUrl` IS derived from document.referrer here — the opposite of
 *     the session-POST rule (D3). Different payloads; do not share a mapper.
 *
 * Nothing on this path validates: the proxy forwards verbatim and Salesforce
 * Postgres triggers drop unrecognised input silently. A 200 is not evidence a
 * row landed — hence the byte-level fidelity of every default below.
 */

/** v4 ships one event type. Adding another is a typed change, not a string. */
export type FunnelEventType = 'Page View';

export interface FunnelEvent {
  // --- SFIDs ---
  funnelSTFId: string | null;
  mainFunnelId: string | null;
  destinationId: string | null;
  funnelSTPId: string | null;
  splitTestingFunnelId: string | null;
  splitTestingPageId: string | null;

  // --- Request-specific ---
  /** Step SLUG, despite the name. */
  url: string | null;
  eventType: FunnelEventType;
  sessionId: string;
  orderId: string | null;

  // --- Custom payloads (caps-L) ---
  customPayLoad1: string | null;
  customPayLoad2: string | null;

  // --- UTMs ---
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmCampaignId: string | null;
  utmContent: string | null;
  utmTerm: string | null;

  // --- Attribution. The null-vs-'' asymmetry is deliberate legacy wire
  // shape: affId/offId default to '', subIds default to null. Do not normalize.
  affId: string;
  offId: string;
  subId1: string | null;
  subId2: string | null;
  subId3: string | null;
  subId4: string | null;
  subId5: string | null;

  // --- Hardcoded ---
  salesFunnel: 'Funnel';

  visitorId: string | null;
  visitDate: string;
  videoPercentage: number;
  leadId: string | null;
  accountId: string | null;
  referralUrl: string;
  brand: string;
  browser: string;
  os: string | null;
  device: 'Mobile' | 'Desktop';
}

/**
 * Format a Date as ISO8601 with LOCAL timezone offset and ms precision:
 * '2026-08-18T11:04:22.318-07:00'.
 *
 * `Date.prototype.toISOString()` is WRONG for this field — it emits UTC with a
 * 'Z' suffix, which is not the format the Salesforce stream carries. Ported
 * verbatim from build-funnel-event.utility.ts:71-84.
 */
export function formatVisitDate(now: Date = new Date()): string {
  const pad = (n: number, digits = 2): string => String(n).padStart(digits, '0');
  const offset = -now.getTimezoneOffset(); // positive = east of UTC
  const sign = offset >= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hrs = pad(Math.floor(absOffset / 60));
  const mins = pad(absOffset % 60);

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.` +
    `${pad(now.getMilliseconds(), 3)}${sign}${hrs}:${mins}`
  );
}

// ---------------------------------------------------------------------------
// UA detection (D5) — ported for VOCABULARY PARITY with the reference
// (hippo-builder-funnel detect-user-agent.utility.ts). The reference reads
// navigator.userAgentData / navigator.platform; the SDK takes the UA string,
// so OS comes from UA tokens while producing the identical output words.
// Any drift in these strings splits Salesforce dashboard groupings.
// ---------------------------------------------------------------------------

export interface UaDetection {
  browser: string;
  os: string | null;
  device: 'Mobile' | 'Desktop';
}

/** Order is precedence. Edge/Opera must precede Chrome; Safari precedes IE. */
const BROWSER_RULES: Array<[RegExp, string]> = [
  [/Firefox\//, 'Firefox'],
  [/ OPR\//, 'Opera'],
  [/Edg\//, 'Microsoft Edge'],
  [/Chrome\//, 'Chrome'],
  [/^((?!chrome|android).)*safari/i, 'Safari'],
  [/Trident\//, 'Internet Explorer'],
];

/**
 * Order is precedence, and two orderings are load-bearing:
 *   iOS before Mac OS  — the iPhone UA contains 'like Mac OS X'.
 *   Android before Linux — the Android UA contains 'Linux'.
 */
const OS_RULES: Array<[RegExp, string]> = [
  [/(iPhone|iPad|iPod)/, 'iOS'],
  [/(Macintosh|Mac OS X)/, 'Mac OS'],
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];

/**
 * Detect browser / os / device from a raw user-agent string.
 * An empty string yields the reference SSR default
 * `{ browser: 'Unknown', os: null, device: 'Desktop' }`.
 */
export function detectUserAgent(ua: string): UaDetection {
  const s = ua ?? '';
  let browser = 'Unknown';
  for (const [re, name] of BROWSER_RULES) {
    if (re.test(s)) {
      browser = name;
      break;
    }
  }
  let os: string | null = null;
  for (const [re, name] of OS_RULES) {
    if (re.test(s)) {
      os = name;
      break;
    }
  }
  return { browser, os, device: /Mobi/.test(s) ? 'Mobile' : 'Desktop' };
}
