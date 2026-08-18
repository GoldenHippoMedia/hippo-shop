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

// ---------------------------------------------------------------------------
// Page View payload builder (D5)
// ---------------------------------------------------------------------------

export interface PageViewContext {
  config: GhConfig;
  session: SessionState;
  /** Destination DTO funnelId, else data-gh-funnel-id. Absent = do not emit. */
  funnelId: string | null;
  /** Destination DTO id, else ?origdsidOrig=. */
  destinationId: string | null;
  /** Funnel-step DTO id matched by data-gh-step. */
  stepId: string | null;
  /** data-gh-step — a step SLUG. Lands in the `url` field. */
  stepSlug: string | null;
  /** ?origsplitTestingFunnelIdOrig=. */
  splitTestId: string | null;
  /** document.referrer, raw. Query-stripped here (opposite of the D3 rule). */
  referrer: string;
  /** location.search, for ?cid=. */
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
export function buildPageViewEvent(ctx: PageViewContext): FunnelEvent | null {
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
    // Hardcoded literal. Never build this from a variable.
    eventType: 'Page View',
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
): Promise<void> {
  let event: FunnelEvent | null = null;
  try {
    event = buildPageViewEvent(ctx);
  } catch (err) {
    logger.debug('funnel-event: could not build Page View —', err);
    return;
  }

  if (!event) {
    // The reference drops this silently; we log it, but only in debug mode so
    // a third-party-hosted page stays quiet in production.
    if (ctx.config.debug) {
      logger.warn(
        'funnel-event: no funnel id resolved (bind a data-gh-destination or set data-gh-funnel-id) — Page View not emitted',
      );
    }
    return;
  }

  const headers: Record<string, string> = {};
  const eventId = newEventId();
  if (eventId) headers[EVENT_ID_HEADER] = eventId;

  try {
    await client.postEvent(FUNNEL_EVENT_RESOURCE, event, headers);
    logger.debug('funnel-event: Page View sent', eventId);
  } catch (err) {
    // Non-fatal by design (Goal 8). No retry, no rethrow.
    logger.debug('funnel-event: Page View delivery failed —', err);
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
): string {
  const stepKey = stepSlug && stepSlug.length > 0 ? stepSlug : pathname;
  return `${sessionId}|Page View|${stepKey}`;
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
): Promise<void> {
  if (!ctx.funnelId) {
    if (ctx.config.debug) {
      logger.warn(
        'funnel-event: no funnel id resolved (bind a data-gh-destination or set data-gh-funnel-id) — Page View not emitted',
      );
    }
    return;
  }

  const key = pageViewDedupeKey(ctx.session.sessionId, ctx.stepSlug, pathname);
  if (!claimPageView(key)) {
    logger.debug('funnel-event: duplicate Page View suppressed —', key);
    return;
  }

  await emitPageView(client, ctx, logger);
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

/**
 * Read an attribute preferring a page element over the SDK script tag.
 *
 * `:not(script)` first, script second — not plain document order: the script
 * tag usually sits in <head> and would otherwise always win, inverting the
 * documented precedence ("read from the DOM ... falling back to the value on
 * the script tag").
 */
function readAttrPreferringPage(doc: Document, attr: string): string | null {
  const fromPage = doc.querySelector(`[${attr}]:not(script)`)?.getAttribute(attr)?.trim();
  if (fromPage) return fromPage;
  const fromScript = doc.querySelector(`script[${attr}]`)?.getAttribute(attr)?.trim();
  return fromScript ? fromScript : null;
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
 * The destination slug that identity comes from: first `[data-gh-destination]`
 * in document order, else first `[data-gh-checkout]`.
 *
 * The canonical offer-selector page binds six destinations. They are six
 * variants of ONE page view, not six page views.
 */
export function firstDestinationSlug(doc: Document): string | null {
  const direct = doc
    .querySelector(`[${DESTINATION_ATTR}]`)
    ?.getAttribute(DESTINATION_ATTR)
    ?.trim();
  if (direct) return direct;
  const checkout = doc
    .querySelector(`[${CHECKOUT_ATTR}]`)
    ?.getAttribute(CHECKOUT_ATTR)
    ?.trim();
  return checkout ? checkout : null;
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
  /** location.search, for the ?origdsidOrig= / ?origsplitTestingFunnelIdOrig= handoff. */
  search: string;
}

/** Resolve the Salesforce ids a Page View needs from DOM + cached DTOs. */
export function resolveEventIdentity(opts: IdentityOptions): EventIdentity {
  const slug = firstDestinationSlug(opts.doc);
  const destination = slug ? opts.getDestination(slug) : null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(opts.search);
  } catch {
    params = new URLSearchParams('');
  }

  const funnelId =
    destination?.funnelId || readAttrPreferringPage(opts.doc, FUNNEL_ID_ATTR) || null;
  const destinationId = destination?.id || params.get('origdsidOrig') || null;
  const splitTestId = params.get('origsplitTestingFunnelIdOrig') || null;

  const funnelSlug =
    destination?.funnelSlug || readAttrPreferringPage(opts.doc, FUNNEL_ATTR) || null;
  let stepId: string | null = null;
  if (funnelSlug && opts.stepSlug) {
    const funnel = opts.getFunnel(funnelSlug);
    stepId = funnel?.steps.find((s) => s.slug === opts.stepSlug)?.id ?? null;
  }

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
   */
  const ready = (): boolean => firedOnce || (sessionReady && bindingsReady);

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
    if (eventType !== 'Page View') {
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
    const identity = resolveEventIdentity({
      doc: opts.doc,
      getDestination: opts.getDestination,
      getFunnel: opts.getFunnel,
      stepSlug,
      search,
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

    await emitPageViewOnce(opts.client, ctx, opts.logger, opts.win.location.pathname);
  } catch (err) {
    // Defensive guard for the unguarded-callback carry-forward: a throwing
    // getDestination/getFunnel (or any other synchronous failure in identity
    // resolution or the emit path) must not become an uncaught rejection out
    // of the emitter.
    opts.logger.debug('funnel-event: Page View emission failed —', err);
  }
}
