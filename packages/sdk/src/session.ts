/**
 * Cluster G session lifecycle (spec D1/D2/D4).
 *
 * Resolves the visitor's session id, persists it to the root-domain
 * `hippo_session_id` cookie, parses landing attribution, and POSTs it once per
 * page load to /public/v1/session. Fires `gh:session-ready` on `window` when it
 * resolves — on success and on swallowed failure alike.
 *
 * `connect.sid` is deliberately absent: it is httpOnly and belongs to the API,
 * so `document.cookie` can never observe it. Cluster F's gate on that cookie was
 * dead code and is deleted.
 *
 * Every reachable failure path is non-fatal: a blocked cookie write or a failed
 * POST degrades attribution; the page never breaks.
 */

import type { GhConfig } from './config';
import type { GhDataClient } from './client';
import { getCookieDomain, readCookie, writeCookie } from './cookies';
import {
  parseLandingParams,
  readSessionIdFromUrl,
  SESSION_ID_PATTERN,
  type ParsedParams,
} from './url-params';
import { createLogger, type Logger } from './log';

/**
 * D2. Same name as the funnel app (`hippo-builder-funnel` session.service.ts:11)
 * so a visitor arriving from a funnel page keeps one identity.
 *
 * The `sf.brand.com` -> `www.brand.com` handoff works via the **URL**
 * (`?sessionid=`), not the cookie — which is why every outbound link must
 * carry it. That means root-domain, 30-day persistence of an *adopted* id
 * serves no purpose: it only pins whatever `?sessionid=` one clicked link
 * carried to the whole brand for a month (I4). So a minted id is written
 * root-domain scoped, for returning-visit continuity across subdomains, but
 * an adopted id is written host-only — see the `domain` computation in
 * `ensureSession`.
 */
export const SESSION_COOKIE_NAME = 'hippo_session_id';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const SESSION_READY_EVENT = 'gh:session-ready';

export interface SessionState {
  /** Resolved session id: adopted from `?sessionid=`, restored from the cookie, or minted. */
  sessionId: string;
  /** True when the id came from `?sessionid=` on this page load (spec D1 handoff). */
  adopted: boolean;
  /** Landing-URL attribution. Always parsed — never null (spec D4). */
  params: ParsedParams;
}

let cachedState: SessionState | null = null;

/** Returns the resolved session state, or null if `ensureSession` hasn't resolved yet. */
export function getSessionState(): SessionState | null {
  return cachedState;
}

/**
 * Drops keys whose value is null, undefined, or whitespace-only.
 *
 * This is a payload nicety, not a safety guard. The backend cannot tell a
 * blank from an absent key: `''`, `'   '` and a missing key all collapse to
 * `undefined` server-side and are filtered out before storage, so posting
 * `utmSource: ''` can neither set nor clear a stored value. Omitting is kept
 * because it is smaller on the wire and gives exactly one wire form for "no
 * value" (spec D3, whose destructive-on-write premise was wrong; storage is
 * per-key first-write-wins).
 */
export function pruneEmpty(
  input: Record<string, string | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Builds the POST /public/v1/session request body.
 *
 * `sessionId` is nested *inside* `affParameters` because the API lifts
 * `req.body.affParameters.sessionId` into the server-side session — a
 * top-level key is ignored (spec D4). An absent id is omitted entirely.
 */
export function buildSessionPostBody(
  params: ParsedParams,
  sessionId: string,
): { affParameters: Record<string, string> } {
  return { affParameters: pruneEmpty({ ...params, sessionId }) };
}

/**
 * Mint a session id as an RFC-4122 v4 UUID, matching the funnel app's
 * `generateUniqueSessionId` (`hippo-builder-funnel` session.service.ts:164-184).
 *
 * `crypto.randomUUID()` when available; otherwise an explicit v4 built from
 * `crypto.getRandomValues` (insecure-context browsers expose the latter but not
 * the former). There is no `Math.random()` path *in this function*: if neither
 * exists we throw rather than mint a guessable id.
 *
 * That is a property of this function alone, not of the SDK. `mintSessionId`
 * below is the only caller on the resolution ladder, and it catches this throw
 * and degrades to `fallback-<base36>-<base36>` — built with `Math.random()`,
 * because an uncaught throw here would strand `ensureSession` and leave every
 * checkout link on the page inert (see the M4 note there). So the SDK *does*
 * mint guessable ids in a runtime without Web Crypto; it just never returns one
 * from here.
 *
 * This replaces Cluster F's 12-character numeric generator. Nothing parses that
 * format — the funnel app already emits UUIDv4 into the same pipeline.
 */
export function generateSessionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'session.generateSessionId: no Web Crypto available (globalThis.crypto missing) — ' +
        'cannot mint a session id in this runtime',
    );
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Top-level orchestrator. Runs once per visit. Idempotent on re-call.
 * Fires `gh:session-ready` on the window when it resolves (success or
 * graceful failure).
 */
export async function ensureSession(
  config: GhConfig,
  client: GhDataClient,
): Promise<SessionState> {
  if (cachedState) return cachedState;

  const logger = createLogger(config.debug);
  const search = typeof window !== 'undefined' ? window.location.search : '';

  const resolved = resolveSessionId(search, logger);
  if (resolved.persist) {
    // I4: an adopted id (from `?sessionid=`) is written host-only — the
    // sf -> www handoff already works via the URL (see the
    // SESSION_COOKIE_NAME comment above), so root-domain persistence of an
    // adopted id has no purpose and would otherwise pin every subdomain to
    // one visitor's chosen session for the full 30-day TTL. Minted ids keep
    // root-domain scoping, which is what makes returning-visit continuity
    // work across subdomains.
    const domain = resolved.adopted ? null : getCookieDomain(config);
    try {
      writeCookie(SESSION_COOKIE_NAME, resolved.sessionId, {
        maxAgeSec: SESSION_TTL_SEC,
        domain,
      });
    } catch {
      // Cookie write blocked (third-party context, quota). The id still lives
      // in memory for this page load and still rides outbound links.
    }
  }

  const href = typeof window !== 'undefined' ? window.location.href : '';
  // Read here but deliberately discarded by parseLandingParams: on this path
  // referralUrl comes from ?referral_url= alone, not document.referrer — see
  // the @param referrer note on parseLandingParams (url-params.ts) before
  // wiring this value up to referralUrl.
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  // I3: `persist: false` is exactly the "read the existing cookie, mint/adopt
  // nothing new" branch of resolveSessionId — the one case that is a
  // returning visit reusing a prior session, not a fresh landing.
  const isReturningVisit = !resolved.persist;
  const params = parseLandingParams(href, referrer, isReturningVisit);

  // Boxed rather than warned in place: the warn is deliberately deferred past
  // the state transition below (see the note on it), and boxing keeps a thrown
  // `undefined` distinguishable from "no failure".
  let postFailure: { err: unknown } | null = null;
  try {
    // D4: POST once per page load, unconditionally. `sessionId` is nested
    // inside `affParameters` and empty values are pruned before send.
    await client.postJson('session', buildSessionPostBody(params, resolved.sessionId));
  } catch (err) {
    // Network or non-2xx: attribution degrades, the page never breaks. Still
    // swallowed — D4 is fire-and-forget with no retry, not even on 429.
    postFailure = { err };
  }

  const state: SessionState = {
    sessionId: resolved.sessionId,
    adopted: resolved.adopted,
    params,
  };
  cachedState = state;
  fireReady(state);

  if (postFailure) {
    // Logged *after* cachedState/fireReady rather than from inside the catch,
    // so the state transition every checkout link on the page waits on is
    // already done before any diagnostic runs. That ordering is no longer
    // load-bearing: `logger.warn` cannot throw, whatever the host page has
    // done to `console` (see `emit` in log.ts, which guards a missing
    // `console`, a non-callable method and a throwing one). It used to be —
    // a stubbed `console.warn` that threw from inside the catch skipped the
    // transition, `gh:session-ready` never fired, and every
    // `data-gh-checkout` link sat at href="#" for the life of the page.
    //
    // Unconditional, unlike the debug-gated warn in `emitPageView`
    // (events.ts:321-327): a systematically dead attribution path should be
    // loud. But one line, carrying the error's *message* and not the Error —
    // this SDK runs on third-party brand pages and a dropped POST is a common
    // event, so a stack dump per page load is noise on someone else's site.
    const reason =
      postFailure.err instanceof Error ? postFailure.err.message : String(postFailure.err);
    logger.warn(
      `session: attribution POST failed — attribution degraded for this load (${reason})`,
    );
  }

  return state;
}

interface ResolvedSessionId {
  sessionId: string;
  /** True when the id came from `?sessionid=`. */
  adopted: boolean;
  /** True when the id must be written to the cookie. */
  persist: boolean;
}

/**
 * D1 resolution ladder, mirroring `hippo-builder-funnel`
 * session.service.ts:54-93:
 *
 *  1. `?sessionid=` — validated by SESSION_ID_PATTERN, adopted even when a
 *     *different* cookie value already exists, and re-persisted every time so
 *     the 30-day window refreshes. Malformed values warn and fall through.
 *  2. the `hippo_session_id` cookie — validated by the same pattern. The cookie
 *     is scoped to the registrable root, so any sibling subdomain can write it;
 *     an unvalidated value would flow straight into a cookie write, a query
 *     string and a server-side session key. Malformed values warn and fall
 *     through, exactly as in tier 1.
 *  3. a freshly minted UUIDv4.
 *
 * Accepting a URL-supplied id is session fixation by design; for this pilot the
 * blast radius is analytics, not authentication or payment. The regex and the
 * debug log line are the mitigations.
 */
function resolveSessionId(search: string, logger: Logger): ResolvedSessionId {
  const fromUrl = readSessionIdFromUrl(search);
  if (fromUrl) {
    logger.debug('session: adopting ?sessionid= handoff', fromUrl);
    return { sessionId: fromUrl, adopted: true, persist: true };
  }

  if (hasSessionIdParam(search)) {
    logger.warn('session: ignoring malformed ?sessionid= handoff param');
  }

  const fromCookie = readCookie(SESSION_COOKIE_NAME)?.trim();
  if (fromCookie) {
    if (SESSION_ID_PATTERN.test(fromCookie)) {
      return { sessionId: fromCookie, adopted: false, persist: false };
    }
    logger.warn('session: ignoring malformed hippo_session_id cookie value');
  }

  return { sessionId: mintSessionId(logger), adopted: false, persist: true };
}

/**
 * M4: `generateSessionId` is the one call in the resolution ladder that can
 * throw (no Web Crypto in this runtime). Every other failure path here is
 * non-fatal by design (module header) — an uncaught throw here is not: it
 * rejects `ensureSession` before `cachedState` is ever set, so
 * `gh:session-ready` never fires and every checkout link on the page stays
 * at `href="#"` forever. Falls back to a non-cryptographic id so session
 * resolution always completes; session fixation already means this id is
 * not a security boundary (D1), so a guessable fallback loses nothing that
 * matters here.
 */
function mintSessionId(logger: Logger): string {
  try {
    return generateSessionId();
  } catch (err) {
    logger.error('session: generateSessionId failed — falling back to a last-resort id', err);
    return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** True when a non-blank `sessionid` key is present, whatever its value. */
function hasSessionIdParam(search: string): boolean {
  try {
    return !!new URLSearchParams(search).get('sessionid')?.trim();
  } catch {
    return false;
  }
}

function fireReady(state: SessionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_READY_EVENT, { detail: { ...state } }));
  } catch {
    // CustomEvent unsupported in some test envs; ignore.
  }
}

/** Test-only: clears the module-level cache between specs. Not exported via index.ts. */
export function _resetForTests(): void {
  cachedState = null;
}
