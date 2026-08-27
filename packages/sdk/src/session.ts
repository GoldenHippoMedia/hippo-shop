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
  firstSessionIdParam,
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

/**
 * The session POST's response body. The server echoes the attribution it stored
 * plus the identity it resolved, so this — not the local guess — is the record
 * of what the session actually is. Every key is optional: the route prunes
 * empty values, so a sparse landing produces a sparse object.
 *
 * Carried on `SessionState.data` and forwarded verbatim as the funnel event's
 * `affParams`. That forwarding is why this is deliberately not narrowed to a
 * hand-written field list: the server owns the shape, and a stale local copy of
 * it would silently drop whatever the server adds next.
 */
export type SessionResponse = Record<string, unknown> & {
  sessionId?: string;
  visitorId?: string;
};

export interface SessionState {
  /** Resolved session id: restored from the cookie, adopted from `?sessionid=`, minted, or replaced by the server. */
  sessionId: string;
  /** True when the id came from `?sessionid=` on this page load (spec D1 handoff). */
  adopted: boolean;
  /** Landing-URL attribution. Always parsed — never null (spec D4). */
  params: ParsedParams;
  /**
   * True when this page load established a session rather than resuming one —
   * a mint, a `?sessionid=` adoption, or a server-side replacement. Gates the
   * one-shot `New Session` funnel event, mirroring the reference's
   * `wasNewlyGenerated` (`emission-driver.service.ts:107-117`).
   */
  isNew: boolean;
  /** The session POST's response body, or null if the POST failed. Becomes `affParams` on funnel events. */
  data: SessionResponse | null;
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

  if (!config.sessionEnabled) return resolveDisabled(config, logger);

  const resolved = resolveSessionId(search, logger, config.sessionUrlFirst);
  // Hoisted out of the write below because the server-replacement path further
  // down needs the same scoping decision, and the two must not drift.
  const cookieDomain = resolved.adopted ? null : getCookieDomain(config);
  if (resolved.persist) {
    // I4: an adopted id (from `?sessionid=`) is written host-only — the
    // sf -> www handoff already works via the URL (see the
    // SESSION_COOKIE_NAME comment above), so root-domain persistence of an
    // adopted id has no purpose and would otherwise pin every subdomain to
    // one visitor's chosen session for the full 30-day TTL. Minted ids keep
    // root-domain scoping, which is what makes returning-visit continuity
    // work across subdomains.
    try {
      writeCookie(SESSION_COOKIE_NAME, resolved.sessionId, {
        maxAgeSec: SESSION_TTL_SEC,
        domain: cookieDomain,
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
  const params = parseLandingParams(href, referrer, isReturningVisit, {
    paramMap: config.paramMap,
    hardcodedParams: config.hardcodedParams,
    logger,
  });

  // Boxed rather than warned in place: the warn is deliberately deferred past
  // the state transition below (see the note on it), and boxing keeps a thrown
  // `undefined` distinguishable from "no failure".
  let postFailure: { err: unknown } | null = null;
  let data: SessionResponse | null = null;
  try {
    // D4: POST once per page load, unconditionally. `sessionId` is nested
    // inside `affParameters` and empty values are pruned before send.
    data = await client.postJson<SessionResponse>(
      'session',
      buildSessionPostBody(params, resolved.sessionId),
    );
  } catch (err) {
    // Network or non-2xx: attribution degrades, the page never breaks. Still
    // swallowed — D4 is fire-and-forget with no retry, not even on 429.
    postFailure = { err };
  }

  // The server reconciles the id we sent against its own express-session (keyed
  // by `connect.sid`) and returns the id actually in force. That one is
  // authoritative: it is what the funnel-event pipeline and Salesforce will
  // see. Adopting it here — before `cachedState` is set, so before
  // `gh:session-ready` fires — keeps `gh.session.id()`, every outbound
  // `sessionid=`, the funnel event and the Page View dedupe key on one value.
  //
  // Validated with the same pattern as every other tier: this value reaches a
  // cookie write and a query string, and "the server sent it" is not on its own
  // a reason to skip the check the ladder applies to all three other sources.
  //
  // A deliberate divergence from the reference, which discards the response —
  // its `HippoSession` model declares no `sessionId` field at all. It can
  // afford to because its `/cid` router already reconciled server-side.
  const returnedId = typeof data?.sessionId === 'string' ? data.sessionId.trim() : '';
  const replaced =
    returnedId !== '' && SESSION_ID_PATTERN.test(returnedId) && returnedId !== resolved.sessionId;
  if (returnedId !== '' && !SESSION_ID_PATTERN.test(returnedId)) {
    logger.warn('session: ignoring malformed sessionId in the session response');
  }
  const sessionId = replaced ? returnedId : resolved.sessionId;

  if (replaced) {
    logger.debug('session: server replaced the resolved id', resolved.sessionId, '->', sessionId);
    try {
      writeCookie(SESSION_COOKIE_NAME, sessionId, {
        maxAgeSec: SESSION_TTL_SEC,
        domain: cookieDomain,
      });
    } catch {
      // Same non-fatal contract as the first write: the id still lives in
      // memory for this page load and still rides outbound links.
    }
  }

  const state: SessionState = {
    sessionId,
    adopted: resolved.adopted,
    params,
    // A mint or an adoption established a session; so did a server replacement,
    // which means the id we were carrying was not the one in force.
    isNew: resolved.persist || replaced,
    data,
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
 * D1 resolution ladder. **Cookie outranks `?sessionid=`** — the reverse of
 * `hippo-builder-funnel` session.service.ts:54-93, and deliberately so.
 *
 *  1. the `hippo_session_id` cookie — validated by SESSION_ID_PATTERN. A
 *     returning visitor keeps the session they already have. `persist: false`:
 *     re-writing the same value only rolls the TTL, and the ledger's I3 ruling
 *     keeps that off.
 *  2. `?sessionid=` — validated by the same pattern, taken only when no usable
 *     cookie exists, i.e. for a genuinely new visitor. Superfunnel mints its own
 *     UUID into this param; honouring it for new visitors is what stitches their
 *     session to ours. Malformed values warn and fall through.
 *  3. a freshly minted UUIDv4.
 *
 * Why this differs from the reference: the funnel app can safely rank the param
 * first because its own `/cid` router mints that param **server-side and reuses
 * the visitor's existing cookie when one is present** (`src/server/cid/
 * router.ts:167-174`, which also drops any caller-supplied `sessionid` first).
 * By the time the param reaches that app's browser it already encodes the
 * cookie, so param-first and cookie-first agree. Superfunnel has no equivalent
 * server hop, so the same reconciliation has to happen here. Ranking the param
 * first without it would let any inbound link re-key a returning visitor's
 * session on every visit.
 *
 * Accepting a URL-supplied id is still session fixation by design; for this
 * pilot the blast radius is analytics, not authentication or payment. The
 * regex, the cookie precedence and the debug log line are the mitigations.
 */
function resolveSessionId(search: string, logger: Logger, urlFirst: boolean): ResolvedSessionId {
  const fromUrl = (): ResolvedSessionId | null => {
    const id = readSessionIdFromUrl(search);
    if (id) {
      logger.debug('session: adopting ?sessionid= handoff', id);
      return { sessionId: id, adopted: true, persist: true };
    }
    if (hasSessionIdParam(search)) {
      logger.warn('session: ignoring malformed ?sessionid= handoff param');
    }
    return null;
  };

  const fromCookie = (): ResolvedSessionId | null => {
    const id = readCookie(SESSION_COOKIE_NAME)?.trim();
    if (!id) return null;
    if (SESSION_ID_PATTERN.test(id)) {
      return { sessionId: id, adopted: false, persist: false };
    }
    logger.warn('session: ignoring malformed hippo_session_id cookie value');
    return null;
  };

  // `sessionUrlFirst` swaps only these two rungs; the mint stays the floor.
  // A malformed value on the winning rung falls through to the loser rather
  // than short-circuiting to a mint — both readers already warn on their own
  // malformed input, and dropping a usable id because the other source was
  // garbage would be strictly worse.
  const ladder = urlFirst ? [fromUrl, fromCookie] : [fromCookie, fromUrl];
  for (const rung of ladder) {
    const resolved = rung();
    if (resolved) return resolved;
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

/**
 * True when a non-blank `sessionid` key is present, whatever its value and
 * whatever its casing. Matched case-insensitively for the same reason
 * `readSessionIdFromUrl` is: otherwise a malformed `?sessionId=` would fall
 * through to a silent mint with no warning at all.
 */
function hasSessionIdParam(search: string): boolean {
  return !!firstSessionIdParam(search)?.trim();
}

/**
 * `data-session="off"`: resolve a session state that carries no identity.
 *
 * No POST, no cookie read, no cookie write, no mint — `sessionId` is `''`.
 * Landing attribution is still parsed, because it is independent of identity
 * and still has somewhere to go: `composeCheckoutUrl` writes the UTM and
 * click-id params onto every outbound link regardless.
 *
 * Two things this deliberately still does. It caches and fires
 * `gh:session-ready` exactly like the normal path — every `data-gh-checkout`
 * link on the page waits on that event, and skipping it would leave them all
 * at `href="#"` for the life of the page, which is a broken page rather than a
 * disabled feature. And it returns a real `SessionState` rather than null, so
 * `getSessionState()` has one shape for every caller.
 *
 * The empty `sessionId` is what suppresses the downstream effects: `setSdkOwned`
 * skips empty values so `sessionid=` never reaches a checkout URL, and the
 * funnel-event emitter gates on it so no Page View or New Session is emitted —
 * an event carrying no session id is unattributable, so this dominates
 * `eventsEnabled`.
 *
 * `isNew` is false: nothing was established, so the one-shot `New Session`
 * must not arm even if something later re-enables emission.
 */
function resolveDisabled(config: GhConfig, logger: Logger): SessionState {
  const href = typeof window !== 'undefined' ? window.location.href : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  // `isReturningVisit: false` — with no session of our own there is no prior
  // session to protect from an I3 landingUrl overwrite, and the params are
  // never POSTed from here anyway. Parsing the full set keeps outbound links
  // carrying everything they would otherwise carry.
  const state: SessionState = {
    sessionId: '',
    adopted: false,
    // `data-params`/`data-param-map` still apply: they are attribution the
    // page author asked for on outbound links, and this branch is precisely
    // the one that keeps those links carrying everything they otherwise would.
    params: parseLandingParams(href, referrer, false, {
      paramMap: config.paramMap,
      hardcodedParams: config.hardcodedParams,
      logger,
    }),
    isNew: false,
    data: null,
  };
  logger.debug('session: disabled by data-session="off" — no POST, no cookie, no session id');
  cachedState = state;
  fireReady(state);
  return state;
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
