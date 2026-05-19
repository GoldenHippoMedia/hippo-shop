/**
 * Cluster F: session lifecycle. Reads existing `connect.sid` and `sessionId`
 * cookies, generates the `sessionId` when missing using the gh-utils
 * algorithm (ported verbatim for backward compatibility with funnel
 * events). POSTs once per visit to /public/v1/session when no `connect.sid`
 * is present. Fires `gh:session-ready` on `window` after resolving.
 *
 * Every reachable failure path is non-fatal: a network error or blocked
 * cookie surfaces as a SessionState with `hasConnectSid: false` or local-
 * only attribution; the page never breaks.
 *
 * See the Cluster F design spec for the data model.
 */

import type { GhConfig } from './config';
import type { GhDataClient } from './client';
import { getCookieDomain, readCookie, writeCookie } from './cookies';
import { parseLandingParams, type ParsedParams } from './url-params';

export const SESSION_COOKIE_NAME = 'sessionId';
export const CONNECT_SID_COOKIE_NAME = 'connect.sid';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const SESSION_ID_LENGTH = 12;
const SESSION_READY_EVENT = 'gh:session-ready';

export interface SessionState {
  sessionId: string;
  hasConnectSid: boolean;
  params: ParsedParams | null;
}

let cachedState: SessionState | null = null;

/** Returns the resolved session state, or null if `ensureSession` hasn't resolved yet. */
export function getSessionState(): SessionState | null {
  return cachedState;
}

/**
 * Port of `generateSessionId` from
 * https://github.com/GoldenHippoMedia/gh-utils/blob/master/src/utils/session/session.ts
 *
 * Produces a 12-character numeric string. NOT cryptographically random —
 * preserved for backward compatibility with funnel-events parsers that may
 * depend on the format.
 */
export function generateSessionId(): string {
  let id = Math.ceil(Date.now() * Math.random()).toString();
  if (id.length < SESSION_ID_LENGTH) {
    const now = new Date();
    const year = now.getFullYear();
    const month = new Intl.DateTimeFormat('en-US', { month: '2-digit' }).format(now);
    const day = new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(now);
    id += `${year}${month}${day}`;
    // Pad with zeros if still short (edge case: very small random product).
    while (id.length < SESSION_ID_LENGTH) {
      id += '0';
    }
  }
  return id.slice(0, SESSION_ID_LENGTH);
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

  const domain = getCookieDomain(config);
  const existingConnectSid = readCookie(CONNECT_SID_COOKIE_NAME);
  const hasConnectSid = !!existingConnectSid;

  // Ensure sessionId cookie exists at the resolved domain.
  let sessionId = readCookie(SESSION_COOKIE_NAME);
  if (!sessionId) {
    sessionId = generateSessionId();
    try {
      writeCookie(SESSION_COOKIE_NAME, sessionId, { maxAgeSec: SESSION_TTL_SEC, domain });
    } catch {
      // Cookie write blocked; sessionId still kept in memory for this visit.
    }
  }

  // If connect.sid already present, skip the POST entirely.
  if (hasConnectSid) {
    const state: SessionState = { sessionId, hasConnectSid: true, params: null };
    cachedState = state;
    fireReady(state);
    return state;
  }

  // First-visit path: parse landing URL, POST /session.
  const href = typeof window !== 'undefined' ? window.location.href : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const params = parseLandingParams(href, referrer);

  let postOk = false;
  try {
    await client.postJson('session', { affParameters: params });
    postOk = true;
  } catch {
    // Network or non-2xx; degrade gracefully. We can't inspect Set-Cookie
    // from JS, so postOk is our only signal that the API was reached.
  }

  const state: SessionState = { sessionId, hasConnectSid: postOk, params };
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
