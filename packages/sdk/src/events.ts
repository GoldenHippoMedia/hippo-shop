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

import type {
  HippoShopDestinationDTO,
  HippoShopFunnelDTO,
} from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from './config';
import type { SessionState } from './session';
import type { GhDataClient } from './client';
import type { Logger } from './log';
import { generateSessionId } from './session';

/**
 * Adding another is a typed change, not a string.
 *
 * `New Session` mirrors the reference's `FunnelEventTypes.newSession`
 * (`funnel-event-types.ts:8`) and carries the identical payload shape — only
 * `eventType` differs. On a cold load both fire: they are independent
 * emissions, not alternatives.
 */
export type FunnelEventType = 'Page View' | 'New Session';

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

// ---------------------------------------------------------------------------
// Page View payload builder (D5)
// ---------------------------------------------------------------------------

export interface PageViewContext {
  config: GhConfig;
  session: SessionState;
  /** Destination DTO funnelId, else data-gh-funnel-id, else ?origmainFunnelIdOrig=. Absent = do not emit. */
  funnelId: string | null;
  /** Destination DTO id, else ?origdsidOrig=, else ?dsid=. */
  destinationId: string | null;
  /** Funnel-step DTO id matched by data-gh-step, else the (stale, step-1) ?funnelSTPId=. */
  stepId: string | null;
  /** data-gh-step — a step SLUG. Lands in the `url` field. */
  stepSlug: string | null;
  /** ?origsplitTestingFunnelIdOrig=. */
  splitTestId: string | null;
  /** document.referrer, raw. Query-stripped here (opposite of the D3 rule). */
  referrer: string;
  /** location.search, for ?cid= and the /fst-minted funnel-identity URL-param fallbacks. */
  search: string;
}

/**
 * Build the 36-field `Page View` payload.
 *
 * Returns `null` when no `funnelId` resolved — the reference drops the event
 * on blank `funnelSTFId` (funnel-event.service.ts:82) and so do we. The caller
 * owns the debug-mode warn; the silent drop is the one reference behaviour
 * worth not copying.
 */
export function buildPageViewEvent(
  ctx: PageViewContext,
  eventType: FunnelEventType = 'Page View',
): FunnelEvent | null {
  const funnelId = ctx.funnelId;
  if (!funnelId) return null;

  const p = ctx.session.params;
  const ua = detectUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  return {
    // --- SFIDs ---
    funnelSTFId: funnelId,
    mainFunnelId: funnelId,
    destinationId: ctx.destinationId ?? null,
    // `??` not `||`: an empty step id is retained as '', matching
    // build-funnel-event.utility.ts:107 (`currentFunnelPageId ?? null`) where
    // the source defaults to ''.
    funnelSTPId: ctx.stepId ?? null,
    splitTestingFunnelId: ctx.splitTestId ?? null,
    splitTestingPageId: null,

    // --- Request-specific ---
    // `||` not `??`: '' collapses to null (utility.ts:112 `ctx.pageName || null`).
    url: ctx.stepSlug || null,
    // From the typed union only — never an arbitrary caller string. The
    // upstream matches this value exactly and drops what it does not know.
    eventType,
    sessionId: ctx.session.sessionId,
    orderId: null,

    // --- Custom payloads: `Page View` is the no-override branch ---
    customPayLoad1: null,
    customPayLoad2: null,

    // --- UTMs ---
    utmSource: p.utmSource ?? null,
    utmMedium: p.utmMedium ?? null,
    utmCampaign: p.utmCampaign ?? null,
    utmCampaignId: readCampaignId(ctx.search, p.utmCampaignId),
    utmContent: p.utmContent ?? null,
    utmTerm: p.utmTerm ?? null,

    // --- Attribution: the '' / null asymmetry is legacy wire shape ---
    affId: p.affId ?? '',
    offId: p.offId ?? '',
    subId1: p.subId1 ?? null,
    subId2: p.subId2 ?? null,
    subId3: p.subId3 ?? null,
    subId4: p.subId4 ?? null,
    subId5: p.subId5 ?? null,

    // --- Hardcoded: NOT ParsedParams.salesFunnel ---
    salesFunnel: 'Funnel',

    visitorId: null, // Altern-side visitor identity resolution is a non-goal
    visitDate: formatVisitDate(),
    videoPercentage: 0,
    leadId: null,
    accountId: null,
    // This payload's referralUrl IS document.referrer, query-stripped
    // (funnel-event.service.ts:176-180) — the opposite of the session POST.
    referralUrl: stripQuery(ctx.referrer),
    brand: ctx.config.brandToken ?? ctx.config.brand,
    browser: ua.browser,
    os: ua.os,
    device: ua.device,
  };
}

/** `?cid=` wins over ParsedParams.utmCampaignId (funnel-event.service.ts:123-131). */
function readCampaignId(search: string, fromParams: string | undefined): string | null {
  let cid: string | null = null;
  try {
    cid = new URLSearchParams(search).get('cid');
  } catch {
    cid = null;
  }
  if (cid) return cid;
  return fromParams ?? null;
}

function stripQuery(value: string): string {
  return (value ?? '').split('?')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Transport (D10)
// ---------------------------------------------------------------------------

/** POST target: `/public/v1/funnel-event`, Kong-fronted, upstream Altern. */
export const FUNNEL_EVENT_RESOURCE = 'funnel-event';

/**
 * Correlation id header. It rides as a HEADER, not a body key: the 36-field
 * shape is matched byte-for-byte upstream and unrecognised keys are at best
 * ignored.
 */
export const EVENT_ID_HEADER = 'X-GH-Event-Id';

/**
 * Build and deliver one `Page View`. Fire-and-forget:
 *   - never retries — notably NOT on 429 (spec non-goals),
 *   - swallows every error, including synchronous throws,
 *   - warns (debug mode only) when the D5 funnel-id gate blocks the emit.
 *
 * Deliberately does NOT dedupe — `emitPageViewOnce` owns that, so this
 * function stays a straight-line builder + transport.
 */
export async function emitPageView(
  client: GhDataClient,
  ctx: PageViewContext,
  logger: Logger,
  eventType: FunnelEventType = 'Page View',
): Promise<void> {
  let event: FunnelEvent | null = null;
  try {
    event = buildPageViewEvent(ctx, eventType);
  } catch (err) {
    logger.debug(`funnel-event: could not build ${eventType} —`, err);
    return;
  }

  if (!event) {
    // The reference drops this silently; we log it, but only in debug mode so
    // a third-party-hosted page stays quiet in production.
    if (ctx.config.debug) {
      logger.warn(
        `funnel-event: no funnel id resolved (set data-gh-funnel-id or arrive with ?origmainFunnelIdOrig=) — ${eventType} not emitted`,
      );
    }
    return;
  }

  const headers: Record<string, string> = {};
  const eventId = newEventId();
  if (eventId) headers[EVENT_ID_HEADER] = eventId;

  // The session's own record, nested rather than merged. The upstream reads
  // attribution off `affParams`, so carrying it in the body is what lets a
  // funnel event be enriched without the server needing our express-session —
  // no `connect.sid` on this request, which means no credentialed CORS, no
  // `SameSite=None`, and no dependence on third-party cookies that Safari and
  // Firefox block outright.
  //
  // Forwarded verbatim from the session POST's response, not rebuilt from the
  // local params: the server prunes, normalises and reconciles what it stored,
  // so its echo is the accurate record. `{}` when the POST failed — the event
  // still carries full funnel identity and is worth sending.
  const body = { ...event, affParams: ctx.session.data ?? {} };

  try {
    await client.postEvent(FUNNEL_EVENT_RESOURCE, body, headers);
    logger.debug(`funnel-event: ${eventType} sent`, eventId);
  } catch (err) {
    // Non-fatal by design (Goal 8). No retry, no rethrow.
    logger.debug(`funnel-event: ${eventType} delivery failed —`, err);
  }
}

/**
 * UUID v4 for the correlation header, reusing the session generator (contract:
 * `generateSessionId(): string // UUID v4`). It throws when the platform has
 * neither `crypto.randomUUID` nor `getRandomValues`; a missing correlation id
 * must not cost us the event, so we degrade to no header.
 */
function newEventId(): string {
  try {
    return generateSessionId();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Dedupe (D9) — in-memory, per page load, on a WINDOW GLOBAL
// ---------------------------------------------------------------------------

/**
 * The guard lives on `window`, not in module scope: two SDK bundles can
 * coexist on one page (index.ts only refuses to overwrite `window.gh.data`),
 * and a module-scoped Set would let each bundle emit its own Page View.
 *
 * Deliberately NOT sessionStorage. The reference's Page View dedupe is an
 * instance field with no persistent marker (emission-driver.service.ts:61);
 * its conversion events DO use sessionStorage markers, so the omission is a
 * choice. A persistent marker here would make Superfunnel pages systematically
 * under-report against funnel pages for identical traffic.
 */
export const EVENT_GUARD_KEY = '__ghFunnelEventKeys';

interface EventGuardHost {
  [EVENT_GUARD_KEY]?: Set<string>;
}

function guardHost(): EventGuardHost | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as EventGuardHost;
}

/**
 * Dedupe key: `(sessionId, eventType, stepKey)`. `stepKey` is the step slug
 * when declared, else `location.pathname`.
 *
 * The fallback is page-level on purpose. Keying on the destination slug would
 * produce six distinct keys on the canonical offer-selector page and defeat
 * the one-Page-View-per-load rule.
 */
export function pageViewDedupeKey(
  sessionId: string,
  stepSlug: string | null,
  pathname: string,
  eventType: FunnelEventType = 'Page View',
): string {
  const stepKey = stepSlug && stepSlug.length > 0 ? stepSlug : pathname;
  return `${sessionId}|${eventType}|${stepKey}`;
}

/** Claim `key` for this page load. `true` means the caller owns the emit. */
export function claimPageView(key: string): boolean {
  const host = guardHost();
  if (!host) return true; // no window (SSR/test harness): nothing to dedupe against
  const store = (host[EVENT_GUARD_KEY] ??= new Set<string>());
  if (store.has(key)) return false;
  store.add(key);
  return true;
}

/**
 * Emit exactly one `Page View` per (session, step) per page load.
 *
 * Ordering is load-bearing twice over:
 *   1. the gate is checked FIRST, so a blocked emit does not burn the key and
 *      a later resolved-identity emit still lands;
 *   2. the key is claimed BEFORE the await, so re-entry inside one page load
 *      cannot double-fire (the reference's SECONDARY-defense ordering).
 */
export async function emitPageViewOnce(
  client: GhDataClient,
  ctx: PageViewContext,
  logger: Logger,
  pathname: string,
  eventType: FunnelEventType = 'Page View',
): Promise<void> {
  if (!ctx.funnelId) {
    if (ctx.config.debug) {
      logger.warn(
        `funnel-event: no funnel id resolved (set data-gh-funnel-id or arrive with ?origmainFunnelIdOrig=) — ${eventType} not emitted`,
      );
    }
    return;
  }

  const key = pageViewDedupeKey(ctx.session.sessionId, ctx.stepSlug, pathname, eventType);
  if (!claimPageView(key)) {
    logger.debug(`funnel-event: duplicate ${eventType} suppressed —`, key);
    return;
  }

  await emitPageView(client, ctx, logger, eventType);
}

/** Test-only: clears the window-global dedupe guard. Not exported via index.ts. */
export function _resetEventsForTests(): void {
  const host = guardHost();
  if (host) delete host[EVENT_GUARD_KEY];
  installGeneration++;
}

// ---------------------------------------------------------------------------
// Identity selection (D5) — read from the LIVE DOM at emit time
// ---------------------------------------------------------------------------

/** Step slug. Populates `url` and, via the funnel DTO, `funnelSTPId`. */
export const STEP_ATTR = 'data-gh-step';
/** Escape hatch for pages that bind no destination. */
export const FUNNEL_ID_ATTR = 'data-gh-funnel-id';
const DESTINATION_ATTR = 'data-gh-destination';
/** Repeated locally rather than imported: checkout.ts keeps its copy private. */
const CHECKOUT_ATTR = 'data-gh-checkout';
const FUNNEL_ATTR = 'data-gh-funnel';

// ---------------------------------------------------------------------------
// URL-param fallbacks (D5 fix) — minted once, at the /fst hop
// ---------------------------------------------------------------------------

/**
 * URL params the `/fst` destination→split-test→funnel resolver mints
 * (`server.js:1553-1639`) and `translateParams` forwards verbatim through
 * later hops. The `/cid/<campaign sfid>` lookup that precedes `/fst` sets
 * none of these itself.
 *
 * The param names are NOT the payload field names — only `funnelSTPId`
 * matches itself:
 *
 *   funnelSTFId / mainFunnelId  <- origmainFunnelIdOrig (same value; the aliasing is correct)
 *   destinationId               <- origdsidOrig, plus dsid on the internal branch
 *   funnelSTPId                 <- funnelSTPId
 *   splitTestingFunnelId        <- origsplitTestingFunnelIdOrig (read correctly already)
 *
 * Two traps, deliberately not read anywhere in this module:
 *   - `origspidOrig` is a DIFFERENT id (funnel-level, zero readers downstream).
 *   - `_did` / `_fid` / `_stid` do not exist anywhere in the real flow.
 */
const FUNNEL_ID_PARAM = 'origmainFunnelIdOrig';
const DESTINATION_ID_PARAM = 'origdsidOrig';
const DESTINATION_ID_PARAM_INTERNAL = 'dsid';
const STEP_ID_PARAM = 'funnelSTPId';
/**
 * The funnel SLUG, which is the only key `GET /public/v1/funnel/<slug>`
 * resolves by — verified against UAT: the slug `ultimateh2_cms_osstart_260520_p`
 * returns 200 with its step list, while the funnel *id* from
 * `origmainFunnelIdOrig` returns 404. The /fst hop mints both spellings; the
 * `orig…Orig` form is the one that survives later hops, so it is checked first.
 */
const FUNNEL_SLUG_PARAM = 'origuidOrig';
const FUNNEL_SLUG_PARAM_SHORT = 'uid';

/**
 * First non-blank trimmed value of `attr` among the elements `selector` matches.
 *
 * `querySelectorAll`, not `querySelector`: the latter returns the first element
 * that merely HAS the attribute, so one blank value defeats the whole tier —
 * while `collectResources` (bindings.ts:63-91) skips empty attribute values and
 * binds the rest, so the page looks perfect while identity silently degrades.
 *
 * Not an exact mirror of that guard: `collectResources` tests `if (!slug)`
 * (bindings.ts:75), which skips empty and absent values but still collects a
 * whitespace-only one. This helper trims first — the safer side of the
 * difference, and the reason it is spelled "non-blank" and not "non-empty".
 */
function firstNonBlankAttr(doc: Document, selector: string, attr: string): string | null {
  for (const el of Array.from(doc.querySelectorAll<Element>(selector))) {
    const value = el.getAttribute(attr)?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Read an attribute preferring a page element over the SDK script tag.
 *
 * `:not(script)` first, script second — not plain document order: the script
 * tag usually sits in <head> and would otherwise always win, inverting the
 * documented precedence ("read from the DOM ... falling back to the value on
 * the script tag").
 */
function readAttrPreferringPage(doc: Document, attr: string): string | null {
  return (
    firstNonBlankAttr(doc, `[${attr}]:not(script)`, attr) ??
    firstNonBlankAttr(doc, `script[${attr}]`, attr)
  );
}

/**
 * `data-gh-step` at emit time. Deliberately NOT a `parseScriptConfig` field:
 * `GhConfig` is an immutable boot-time snapshot, and an observer-driven
 * re-emit can only work against a live DOM read.
 */
export function readStepSlug(doc: Document): string | null {
  return readAttrPreferringPage(doc, STEP_ATTR);
}

/**
 * The destination slug that identity comes from: first non-blank
 * `[data-gh-destination]` in document order, else first non-blank
 * `[data-gh-checkout]`.
 *
 * The canonical offer-selector page binds six destinations. They are six
 * variants of ONE page view, not six page views.
 */
export function firstDestinationSlug(doc: Document): string | null {
  return (
    firstNonBlankAttr(doc, `[${DESTINATION_ATTR}]`, DESTINATION_ATTR) ??
    firstNonBlankAttr(doc, `[${CHECKOUT_ATTR}]`, CHECKOUT_ATTR)
  );
}

export interface EventIdentity {
  funnelId: string | null;
  destinationId: string | null;
  stepId: string | null;
  splitTestId: string | null;
}

export interface IdentityOptions {
  doc: Document;
  /** Synchronous cached-destination lookup (runtime.getCachedDestination). */
  getDestination: (slug: string) => HippoShopDestinationDTO | null;
  /** Synchronous cached-funnel lookup (runtime.getCachedFunnel). */
  getFunnel: (slug: string) => HippoShopFunnelDTO | null;
  stepSlug: string | null;
  /**
   * location.search — the /fst-minted funnel-identity fallbacks
   * (?origmainFunnelIdOrig=, ?origdsidOrig= / ?dsid=, ?funnelSTPId=,
   * ?origuidOrig= / ?uid=) plus the pre-existing
   * ?origsplitTestingFunnelIdOrig= handoff.
   */
  search: string;
  /**
   * location.pathname — the URL-based step-slug fallback. Optional: a caller
   * with no URL context simply loses that one tier, which is the same
   * degradation as a pathname that matches no step.
   */
  pathname?: string;
}

/**
 * The identifier to fetch this page's funnel by — a slug OR a Salesforce id.
 *
 * `GET /public/v1/funnel/{funnelSlugOrId}` resolves BOTH, verified against UAT:
 * the slug `ultimateh2_cms_osstart_260520_p` and the id `a0qQL00000KlmGzYAJ`
 * return the same funnel. So the funnel-id sources are lookup keys too, which
 * matters because the /fst hop mints `origmainFunnelIdOrig` on every real
 * inbound link — a page can easily arrive knowing its funnel's id and not its
 * slug. Without the id tiers below there is no lookup key at all on that path,
 * the funnel is never fetched, and step resolution silently degrades to
 * whatever `?funnelSTPId=` happens to carry.
 *
 * Slug-shaped sources rank first only because a page that names its funnel
 * explicitly is the more specific declaration; either kind resolves the same
 * record.
 *
 * Exported because the emitter needs it *before* identity resolution, to
 * trigger the funnel fetch that populates the cache `resolveEventIdentity`
 * then reads. Both callers must agree on the precedence, so there is one
 * implementation rather than two.
 *
 * A bound destination's `funnelSlug` is deliberately NOT a source: it names a
 * Post-Purchase funnel, which the route rejects by design
 * (`getFunnelByIdOrSlug` requires `funnelType === 'Pre-Purchase'`), and since
 * the resolved funnel's `id` feeds `funnelId`, admitting it would let an
 * arbitrary offer on a twelve-destination selector page re-establish the very
 * funnel-identity leak this gate exists to close.
 */
export function resolveFunnelLookupKey(doc: Document, params: URLSearchParams): string | null {
  return (
    readAttrPreferringPage(doc, FUNNEL_ATTR) ||
    params.get(FUNNEL_SLUG_PARAM) ||
    params.get(FUNNEL_SLUG_PARAM_SHORT) ||
    readAttrPreferringPage(doc, FUNNEL_ID_ATTR) ||
    params.get(FUNNEL_ID_PARAM) ||
    null
  );
}

/**
 * The current URL's last path segment, as a step-slug candidate: trailing
 * slashes dropped, then any file extension. `/fp/os260520a_sh_ap` ->
 * `os260520a_sh_ap`; `/offer-selector.html` -> `offer-selector`; `/` -> null.
 *
 * Only ever compared against slugs from a funnel DTO the brand owns, so a
 * non-matching segment costs one failed lookup and nothing else.
 */
function pathnameStepSlug(pathname: string): string | null {
  const last = pathname.replace(/\/+$/, '').split('/').pop()?.trim();
  if (!last) return null;
  return last.replace(/\.[^./]+$/, '') || null;
}

/**
 * Resolve the Salesforce ids a Page View needs from DOM + cached DTOs + the
 * /fst-minted URL params.
 *
 * Precedence is destination DTO -> author attribute -> URL param, for two
 * grounded reasons:
 *   1. The params are a one-time snapshot minted at the `/fst` hop and never
 *      refreshed on later hops. `funnelSTPId` in particular is always
 *      `defaultFunnels[0].variants[0].sfid` — hardcoded to step 1 — so an
 *      inbound `funnelSTPId` must never outrank a `data-gh-step` that
 *      resolved against a live funnel DTO (see the stepId fallback below).
 *   2. Author-attribute-over-URL-param mirrors the rule this repo already
 *      uses at `url-params.ts:179-180`.
 */
export function resolveEventIdentity(opts: IdentityOptions): EventIdentity {
  const slug = firstDestinationSlug(opts.doc);
  const destination = slug ? opts.getDestination(slug) : null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(opts.search);
  } catch {
    params = new URLSearchParams('');
  }

  // `URLSearchParams.get` is case-sensitive, DELIBERATELY: this matches both
  // the funnel's own reader and the SDK's documented ?sessionid= rule. There
  // is a `findCaseInsensitive` helper at url-params.ts:120-126 for the
  // ad-platform click-id casing games — these are funnel-minted params, not
  // that, so do not reach for it here.
  const destinationId =
    destination?.id ||
    params.get(DESTINATION_ID_PARAM) ||
    params.get(DESTINATION_ID_PARAM_INTERNAL) ||
    null;
  const splitTestId = params.get('origsplitTestingFunnelIdOrig') || null;

  // Resolved before `funnelId`, because the funnel DTO is one of its sources.
  const funnelKey = resolveFunnelLookupKey(opts.doc, params);
  const funnel = funnelKey ? opts.getFunnel(funnelKey) : null;

  // A bound destination's `funnelId` is deliberately NOT a source here. It
  // names the destination's own post-purchase funnel, not the funnel this page
  // view belongs to — and on a selector page binding twelve destinations, the
  // "first" one is arbitrary. Once #352 populated that field, every
  // destination-bound page started emitting a Page View on any navigation,
  // including a typed URL, attributed to whichever offer happened to be first
  // in the DOM. Funnel identity now comes only from what the page, the funnel
  // it names, or the /fst hop actually asserts about the funnel.
  //
  // Order follows the two precedence rules this file already applies:
  //   - an author attribute outranks a URL param (url-params.ts:179-180), and
  //   - a live DTO id outranks a /fst-minted snapshot (see the stepId note).
  // So the funnel DTO's own id sits between them: it is reached either from an
  // author attribute (`data-gh-funnel`) or from the same /fst mint that
  // produced the param, and in the latter case both name the same funnel.
  const funnelId =
    readAttrPreferringPage(opts.doc, FUNNEL_ID_ATTR) ||
    funnel?.id ||
    params.get(FUNNEL_ID_PARAM) ||
    null;

  let stepId: string | null = null;
  if (funnel) {
    // Author-declared `data-gh-step` first, then the current URL's last path
    // segment. The second is what makes a Superfunnel page resolvable without
    // an attribute: the CMS funnel's own step slugs already match it —
    // `/fp/os260520a_sh_ap` against step slug `os260520a_sh_ap`.
    for (const candidate of [opts.stepSlug, pathnameStepSlug(opts.pathname ?? '')]) {
      if (!candidate) continue;
      const lowered = candidate.toLowerCase();
      stepId = funnel.steps.find((s) => s.slug.toLowerCase() === lowered)?.id ?? null;
      if (stepId) break;
    }
  }
  // Fallback only: a resolved funnel-step DTO id is always live, while the
  // URL's funnelSTPId is a stale step-1 snapshot (see the function doc
  // comment) — it must never overwrite a DTO-resolved stepId.
  if (!stepId) stepId = params.get(STEP_ID_PARAM) || null;
  // Last resort, and only when the funnel genuinely has nowhere else to be.
  // This is what lets a single-step Salesforce funnel stand in for a whole
  // pre-purchase funnel built elsewhere (Superfunnel), which is the point of
  // modelling it that way.
  if (!stepId && funnel?.steps.length === 1) stepId = funnel.steps[0]?.id ?? null;

  return { funnelId, destinationId, stepId, splitTestId };
}

// ---------------------------------------------------------------------------
// Emitter timing (D9)
// ---------------------------------------------------------------------------

/** Quiet window so late-injected attributes land in the same event. */
export const PAGE_VIEW_QUIET_MS = 100;
/** Hard cap: emit with whatever resolved, or drop per the D5 gate. */
export const PAGE_VIEW_DEADLINE_MS = 2000;

const SESSION_READY_EVENT = 'gh:session-ready';
const BINDINGS_READY_EVENT = 'gh:bindings-ready';
/**
 * D9: an SPA swapped `data-gh-step`. Dispatched by `GhRuntime.bind()`, which is
 * where the MutationObserver's `data-gh-step` filter entry lands.
 */
export const STEP_CHANGED_EVENT = 'gh:step-changed';

/** Announce that the declared funnel step changed. Safe to call repeatedly. */
export function notifyStepChanged(win: Window): void {
  win.dispatchEvent(new Event(STEP_CHANGED_EVENT));
}

/**
 * Test-isolation guard, NOT a production concern: `installPageViewEmitter` is
 * called exactly once per real page load (from `boot()`), so there is only
 * ever one live closure on a given `window`. `_resetEventsForTests` bumps
 * this between specs; a superseded closure's still-armed `{ once: true }`
 * listener (e.g. one whose `sessionPromise` deliberately never settles) would
 * otherwise sit on the shared jsdom `window` for the rest of the test file
 * and can fire — and win the dedupe race — years after its own test ended.
 * Comparing the snapshot taken at install time against the live counter makes
 * that stale closure permanently inert without changing single-install
 * behaviour at all.
 */
let installGeneration = 0;

export interface PageViewEmitterOptions {
  doc: Document;
  win: Window;
  config: GhConfig;
  client: GhDataClient;
  logger: Logger;
  /** Session THUNK, not a snapshot: null until `ensureSession` resolves. */
  getSession: () => SessionState | null;
  sessionPromise: Promise<unknown>;
  getDestination: (slug: string) => HippoShopDestinationDTO | null;
  getFunnel: (slug: string) => HippoShopFunnelDTO | null;
  ensureDestination: (slug: string) => Promise<void>;
  ensureFunnel: (slug: string) => Promise<void>;
}

/**
 * Install the one-shot Page View emitter.
 *
 * MUST live outside `bind()` — `bind()` re-runs on every observer-triggered
 * mutation (runtime.ts:154-163) and again on `gh:session-ready`
 * (runtime.ts:219-227).
 *
 * A fixed setTimeout races: `ensureSession` can resolve synchronously (so
 * `gh:session-ready` may fire before DOMContentLoaded — and before this
 * listener exists), while a cold POST can take 800ms. So readiness joins the
 * EVENT and the PROMISE, and the whole thing is capped by a hard deadline.
 */
export function installPageViewEmitter(opts: PageViewEmitterOptions): void {
  const { win, logger } = opts;
  const myGeneration = ++installGeneration;
  /** Per-emission latch. Cleared by a step change so the SPA path can re-fire. */
  let fired = false;
  /** Sticky: the initial emission has happened at least once. */
  let firedOnce = false;
  let sessionReady = false;
  let bindingsReady = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  /** Step slug the last emission was built from. Null until the first fire. */
  let lastEmittedStep: string | null = null;

  const fire = (reason: string): void => {
    if (fired || myGeneration !== installGeneration) return;
    fired = true;
    firedOnce = true;
    lastEmittedStep = readStepSlug(opts.doc);
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }
    clearTimeout(deadlineTimer);
    logger.debug('funnel-event: Page View trigger —', reason);
    void runPageView(opts);
  };

  const deadlineTimer = setTimeout(() => fire('deadline'), PAGE_VIEW_DEADLINE_MS);

  /**
   * Readiness gates the FIRST emission only. Once that has happened the page is
   * live by definition — including on the deadline path, where `sessionReady`
   * may still be false and would otherwise strand every later step change.
   *
   * C1: `gh:session-ready` can be the accidental first caller of
   * `gh:bindings-ready` (runtime.ts's `installSessionReadyRebind` binds
   * against whatever's in the DOM the instant the session POST returns,
   * which is typically one round-trip before `DOMContentLoaded`). A bind
   * pass against a still-parsing document finds no offer markup, so
   * `firstDestinationSlug` comes back null and the D5 gate drops the event —
   * but the one-shot `fired` latch is already set and nothing re-arms it.
   * Refusing to consider the page ready while it is still parsing closes
   * that hole without touching who is allowed to dispatch
   * `gh:bindings-ready` (that event is public and documented elsewhere).
   */
  const ready = (): boolean =>
    firedOnce || (sessionReady && bindingsReady && opts.doc.readyState !== 'loading');

  const restartQuietWindow = (): void => {
    if (fired || myGeneration !== installGeneration || !ready()) return;
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => fire('quiet-window'), PAGE_VIEW_QUIET_MS);
  };

  const markSession = (): void => {
    sessionReady = true;
    restartQuietWindow();
  };

  win.addEventListener(SESSION_READY_EVENT, markSession, { once: true });
  win.addEventListener(
    BINDINGS_READY_EVENT,
    () => {
      bindingsReady = true;
      restartQuietWindow();
    },
    { once: true },
  );

  // C1: both readiness signals can already be true while the document is
  // still parsing (see `ready()` above) — nothing else re-checks readiness
  // once that stops being the case. `readystatechange` only ever fires when
  // `readyState` has just advanced past 'loading', so a single `once`
  // listener is enough to retry the join.
  if (opts.doc.readyState === 'loading') {
    opts.doc.addEventListener('readystatechange', () => restartQuietWindow(), { once: true });
  }

  /**
   * The SPA re-emission path D9 asks for. NOT `{ once: true }`: a funnel can
   * push many steps in one page load.
   *
   * The generation check is test-isolation-only (see `installGeneration`
   * above), but load-bearing here specifically: unlike the readiness
   * listeners, this one is never auto-removed, so a superseded closure that
   * already fired once in an earlier test would otherwise stay eligible to
   * re-arm itself forever on the shared `window`.
   *
   * The slug comparison is a cheap filter against timer churn, not the dedupe
   * rule — `emitPageViewOnce` keys on (sessionId, 'Page View', step) and is the
   * authority. So a step change signalled after `gh.track` already emitted that
   * slug re-opens the quiet window here and is then correctly suppressed there.
   */
  const onStepChanged = (): void => {
    if (myGeneration !== installGeneration) return;
    // Nothing to re-arm yet; the initial emission has its own readiness join.
    if (!firedOnce) return;
    const stepSlug = readStepSlug(opts.doc);
    if (stepSlug === lastEmittedStep) return;
    logger.debug('funnel-event: step changed, re-arming Page View —', stepSlug);
    fired = false;
    restartQuietWindow();
  };
  win.addEventListener(STEP_CHANGED_EVENT, onStepChanged);

  // Second path to session readiness: the event can dispatch before this
  // listener is registered on the synchronous resolution path. `gh:session-ready`
  // fires on swallowed failure too, and so does this — a rejected promise still
  // means "attribution is as good as it is going to get".
  void opts.sessionPromise.then(markSession, markSession);
}

/**
 * Programmatic escape hatch: `gh.track('Page View')`.
 *
 * Respects the dedupe guard — a caller doing an SPA route push must update
 * `data-gh-step` before calling, otherwise the call is a deliberate no-op.
 * Single-member union in v4: adding an event type is a typed change.
 */
export function makeTrackFn(
  opts: PageViewEmitterOptions,
): (eventType: FunnelEventType) => Promise<void> {
  return async function track(eventType: FunnelEventType): Promise<void> {
    if (eventType !== 'Page View' && eventType !== 'New Session') {
      opts.logger.warn(`gh.track: unsupported event type "${String(eventType)}"`);
      return;
    }
    await opts.sessionPromise.then(
      () => undefined,
      () => undefined,
    );
    await runPageView(opts);
  };
}

/** Resolve identity from the live DOM, then emit once. Never throws — see the guard note in the body. */
async function runPageView(opts: PageViewEmitterOptions): Promise<void> {
  // The WHOLE body is one try/catch, from `getSession()` down. This is the
  // single choke point both the timer-driven `fire()` path (called `void`, so
  // a rejection would otherwise surface as an unhandled promise rejection)
  // and the awaited `gh.track` escape hatch (where a rejection would
  // propagate into caller code) funnel through. `getSession`/`ensureDestination`
  // are internal SDK closures and safe by construction, but
  // `resolveEventIdentity` (Task 22-24 carry-forward) calls the caller-facing
  // `getDestination`/`getFunnel` unguarded — a third-party page's own bug in
  // one of those must degrade to "no Page View this load", never break the
  // page, so nothing in this function is allowed to sit outside the guard.
  try {
    const session = opts.getSession();
    if (!session) {
      if (opts.config.debug) {
        opts.logger.warn('funnel-event: session unresolved — Page View not emitted');
      }
      return;
    }

    // Identity comes from a destination binding; with the collectResources
    // fix the DTO is normally already cached by gh:bindings-ready. This
    // covers the deadline path and `gh.track` on a cold page.
    const slug = firstDestinationSlug(opts.doc);
    if (slug && !opts.getDestination(slug)) {
      try {
        await opts.ensureDestination(slug);
      } catch (err) {
        opts.logger.debug('funnel-event: destination load failed —', err);
      }
    }

    const search = opts.win.location.search;
    const stepSlug = readStepSlug(opts.doc);

    // Warm the funnel before identity resolution. `resolveEventIdentity` reads
    // the cache synchronously, and on a Superfunnel page nothing else ever
    // populates it — bind() only loads what it finds bound in the DOM. Without
    // this the step could only ever come from ?funnelSTPId=, and the
    // URL-slug and single-step paths would be dead code.
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(search);
    } catch {
      params = new URLSearchParams('');
    }
    const funnelKey = resolveFunnelLookupKey(opts.doc, params);
    if (funnelKey && !opts.getFunnel(funnelKey)) {
      try {
        await opts.ensureFunnel(funnelKey);
      } catch (err) {
        // A funnel that will not load costs the step id, not the event.
        opts.logger.debug('funnel-event: funnel load failed —', err);
      }
    }

    const identity = resolveEventIdentity({
      doc: opts.doc,
      getDestination: opts.getDestination,
      getFunnel: opts.getFunnel,
      stepSlug,
      search,
      pathname: opts.win.location.pathname,
    });

    const ctx: PageViewContext = {
      config: opts.config,
      session,
      funnelId: identity.funnelId,
      destinationId: identity.destinationId,
      stepId: identity.stepId,
      stepSlug,
      splitTestId: identity.splitTestId,
      referrer: opts.doc.referrer,
      search,
    };

    // A session established on this load gets a `New Session` before the
    // `Page View`, mirroring the reference's two independent effects
    // (`emission-driver.service.ts:107-147`) — on a cold load both fire.
    // Ordered, not raced: they share the funnel-id gate and the upstream reads
    // them in sequence. Its own dedupe key means the SPA re-arm on
    // `gh:step-changed` re-emits Page View without re-emitting this.
    if (ctx.session.isNew) {
      await emitPageViewOnce(
        opts.client,
        ctx,
        opts.logger,
        opts.win.location.pathname,
        'New Session',
      );
    }

    await emitPageViewOnce(opts.client, ctx, opts.logger, opts.win.location.pathname);
  } catch (err) {
    // Defensive guard for the unguarded-callback carry-forward: a throwing
    // getDestination/getFunnel (or any other synchronous failure in identity
    // resolution or the emit path) must not become an uncaught rejection out
    // of the emitter.
    opts.logger.debug('funnel-event: Page View emission failed —', err);
  }
}
