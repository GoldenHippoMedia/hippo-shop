import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureSession, generateSessionId, getSessionState, _resetForTests } from '../src/session';
import { readCookie, writeCookie } from '../src/cookies';
import { GhDataClient } from '../src/client';
import type { GhConfig } from '../src/config';
import { createLogger } from '../src/log';

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Test',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: null,
    cookieDomain: null,
    ...overrides,
  };
}

function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, protocol: 'https:', href: `https://${hostname}/` },
    writable: true,
  });
}

beforeEach(() => {
  // Wipe cookies between tests.
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  setHostname('localhost');
  _resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateSessionId', () => {
  it('returns an RFC-4122 v4 UUID', () => {
    const id = generateSessionId();
    expect(id).toMatch(UUID_V4_RE);
    expect(id.length).toBe(36);
  });

  it('returns a different id on each call', () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });

  it('delegates to crypto.randomUUID when it exists', () => {
    const randomUUID = vi.fn().mockReturnValue('11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', {
      randomUUID,
      getRandomValues: () => {
        throw new Error('getRandomValues must not be called when randomUUID exists');
      },
    });
    expect(generateSessionId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('falls back to a getRandomValues v4 when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint8Array) => {
        buf.fill(0xff);
        return buf;
      },
    });
    // All-0xff bytes with the version/variant bits forced: byte 6 -> 0x4f, byte 8 -> 0xbf.
    expect(generateSessionId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(generateSessionId()).toMatch(UUID_V4_RE);
  });

  it('throws when neither randomUUID nor getRandomValues exists', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => generateSessionId()).toThrow(/no Web Crypto available/);
  });
});

describe('ensureSession', () => {
  let client: GhDataClient;
  let postSpy: ReturnType<typeof vi.fn>;

  // Manual cookie jar for jsdom, since jsdom's document.cookie doesn't persist.
  let cookieJar: Record<string, string> = {};

  beforeEach(() => {
    cookieJar = {};
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return Object.entries(cookieJar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      },
      set(cookieStr: string) {
        const parts = cookieStr.split(';');
        const [nameValue] = parts;
        const [name, value] = (nameValue ?? '').split('=');
        const trimmedName = (name ?? '').trim();

        const hasMaxAge0 = parts.some((p) => p.trim().startsWith('Max-Age=0'));
        if (hasMaxAge0) {
          delete cookieJar[trimmedName];
        } else {
          cookieJar[trimmedName] = value ?? '';
        }
      },
    });

    const logger = createLogger(false);
    client = new GhDataClient(makeConfig(), logger);
    postSpy = vi.fn().mockResolvedValue({});
    client.postJson = postSpy as never;
    setHostname('info.gundrymd.com'); // safe TLD, root .gundrymd.com
  });

  it('on first visit: parses URL params, generates sessionId, POSTs /session', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        href: 'https://info.gundrymd.com/funnel?utm_source=fb&fbclid=abc',
        hostname: 'info.gundrymd.com',
        protocol: 'https:',
      },
      writable: true,
    });
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params).toMatchObject({
      utmSource: 'fb',
      subId1: 'fb',
      subId5: 'abc',
    });
    expect(postSpy).toHaveBeenCalledWith('session', {
      affParameters: expect.objectContaining({
        utmSource: 'fb',
        subId1: 'fb',
        subId5: 'abc',
      }),
    });
    expect(state.hasConnectSid).toBe(true);
    // sessionId cookie was written
    expect(readCookie('sessionId')).toBe(state.sessionId);
  });

  it('skips POST when connect.sid cookie is already present', async () => {
    writeCookie('connect.sid', 's%3Afakevalue', { maxAgeSec: 3600, domain: null });
    const state = await ensureSession(makeConfig(), client);
    expect(postSpy).not.toHaveBeenCalled();
    expect(state.hasConnectSid).toBe(true);
    expect(state.params).toBeNull();
  });

  it('reuses an existing sessionId cookie', async () => {
    writeCookie('sessionId', '999999999999', { maxAgeSec: 3600, domain: null });
    writeCookie('connect.sid', 's%3Aexisting', { maxAgeSec: 3600, domain: null });
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('999999999999');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('on POST network failure: logs, still produces a SessionState with hasConnectSid=false', async () => {
    postSpy.mockRejectedValueOnce(new Error('network blew up'));
    const state = await ensureSession(makeConfig(), client);
    expect(state.hasConnectSid).toBe(false);
    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params).not.toBeNull(); // params still captured locally
  });

  it('fires gh:session-ready on window after resolving', async () => {
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);
    await ensureSession(makeConfig(), client);
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toMatchObject({
      sessionId: expect.stringMatching(UUID_V4_RE),
      hasConnectSid: true,
    });
  });
});

describe('getSessionState', () => {
  it('returns null before ensureSession resolves', () => {
    expect(getSessionState()).toBeNull();
  });

  it('returns the resolved state after ensureSession completes', async () => {
    // Manual cookie jar for this describe block too
    const jar: Record<string, string> = {};
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      },
      set(cookieStr: string) {
        const parts = cookieStr.split(';');
        const [nameValue] = parts;
        const [name, value] = (nameValue ?? '').split('=');
        const trimmedName = (name ?? '').trim();
        const hasMaxAge0 = parts.some((p) => p.trim().startsWith('Max-Age=0'));
        if (hasMaxAge0) {
          delete jar[trimmedName];
        } else {
          jar[trimmedName] = value ?? '';
        }
      },
    });

    const logger = createLogger(false);
    const client = new GhDataClient(makeConfig(), logger);
    client.postJson = vi.fn().mockResolvedValue({}) as never;
    await ensureSession(makeConfig(), client);
    expect(getSessionState()).not.toBeNull();
    expect(getSessionState()?.sessionId).toMatch(UUID_V4_RE);
  });
});
