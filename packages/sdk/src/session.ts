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
import { parseLandingParams, readSessionIdFromUrl, type ParsedParams } from './url-params';
import { createLogger, type Logger } from './log';

/**
 * D2. Same name as the funnel app (`hippo-builder-funnel` session.service.ts:11)
 * so a visitor arriving from a funnel page keeps one identity — but written
 * root-domain scoped rather than host-only, which is what makes the
 * `sf.brand.com` -> `www.brand.com` handoff work without the URL. The resulting
 * two-scope collision is benign only because the funnel's own ladder puts
 * `?sessionid=` above the cookie, which is why every outbound link must carry it.
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
 * Mint a session id as an RFC-4122 v4 UUID, matching the funnel app's
 * `generateUniqueSessionId` (`hippo-builder-funnel` session.service.ts:164-184).
 *
 * `crypto.randomUUID()` when available; otherwise an explicit v4 built from
 * `crypto.getRandomValues` (insecure-context browsers expose the latter but not
 * the former). There is no `Math.random()` path: if neither exists we throw
 * rather than mint a guessable id.
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
  const domain = getCookieDomain(config);
  const search = typeof window !== 'undefined' ? window.location.search : '';

  const resolved = resolveSessionId(search, logger);
  if (resolved.persist) {
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
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const params = parseLandingParams(href, referrer);

  try {
    // D4: POST once per page load, unconditionally. The attribution task group
    // extends this body with `sessionId` and empty-value pruning.
    await client.postJson('session', { affParameters: params });
  } catch {
    // Network or non-2xx: attribution degrades, the page never breaks.
  }

  const state: SessionState = {
    sessionId: resolved.sessionId,
    adopted: resolved.adopted,
    params,
  };
  cachedState = state;
  fireReady(state);
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
 *  2. the `hippo_session_id` cookie.
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

  const fromCookie = readCookie(SESSION_COOKIE_NAME);
  if (fromCookie) return { sessionId: fromCookie, adopted: false, persist: false };

  return { sessionId: generateSessionId(), adopted: false, persist: true };
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
