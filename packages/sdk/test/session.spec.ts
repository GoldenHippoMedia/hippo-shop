import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ensureSession,
  generateSessionId,
  getSessionState,
  SESSION_COOKIE_NAME,
  _resetForTests,
} from '../src/session';
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

import { installCookieJar, type CookieJar } from './helpers/cookie-jar';

function setLocation(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      href: url.href,
      hostname: url.hostname,
      protocol: url.protocol,
      pathname: url.pathname,
      search: url.search,
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  // Wipe cookies between tests.
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  setLocation('https://localhost/');
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
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    client = new GhDataClient(makeConfig(), createLogger(false));
    postSpy = vi.fn().mockResolvedValue({});
    client.postJson = postSpy as never;
    setLocation('https://info.gundrymd.com/funnel');
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  });

  afterEach(() => {
    jar.restore();
  });

  it('parses URL params, mints a session id and POSTs /session', async () => {
    setLocation('https://info.gundrymd.com/funnel?utm_source=fb');

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params).toMatchObject({ utmSource: 'fb' });
    expect(postSpy).toHaveBeenCalledWith('session', {
      affParameters: expect.objectContaining({ utmSource: 'fb' }),
    });
  });

  it('sends sessionId inside affParameters', async () => {
    setLocation('https://info.gundrymd.com/funnel?utm_source=fb');

    const state = await ensureSession(makeConfig(), client);

    expect(postSpy).toHaveBeenCalledWith('session', {
      affParameters: expect.objectContaining({ sessionId: state.sessionId, utmSource: 'fb' }),
    });
    const [, body] = postSpy.mock.calls[0] as [string, { affParameters: Record<string, string> }];
    expect('sessionId' in body).toBe(false);
  });

  it('POSTs even when a connect.sid cookie is present — the gate is gone', async () => {
    jar.seed('connect.sid', 's:fakevalue');
    const state = await ensureSession(makeConfig(), client);
    expect(postSpy).toHaveBeenCalledOnce();
    expect(state.params.landingUrl).toContain('gundrymd.com');
  });

  it('SessionState is exactly { sessionId, adopted, params }', async () => {
    const state = await ensureSession(makeConfig(), client);
    expect(Object.keys(state).sort()).toEqual(['adopted', 'params', 'sessionId']);
    expect('hasConnectSid' in state).toBe(false);
    expect(state.params).not.toBeNull();
  });

  it('reuses an existing session cookie instead of minting', async () => {
    jar.seed(SESSION_COOKIE_NAME, '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    expect(state.adopted).toBe(false);
  });

  it('on POST failure still resolves with an id and locally-parsed params', async () => {
    postSpy.mockRejectedValueOnce(new Error('network blew up'));
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params.landingUrl).toContain('gundrymd.com');
  });

  it('fires gh:session-ready on window after resolving', async () => {
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);
    await ensureSession(makeConfig(), client);
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toMatchObject({
      sessionId: expect.stringMatching(UUID_V4_RE),
      adopted: false,
    });
  });

  it('is idempotent — a second call returns the cached state without re-POSTing', async () => {
    const first = await ensureSession(makeConfig(), client);
    const second = await ensureSession(makeConfig(), client);
    expect(second).toBe(first);
    expect(postSpy).toHaveBeenCalledOnce();
  });
});

describe('getSessionState', () => {
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    setLocation('https://info.gundrymd.com/funnel');
  });

  afterEach(() => {
    jar.restore();
  });

  it('returns null before ensureSession resolves', () => {
    expect(getSessionState()).toBeNull();
  });

  it('returns the resolved state after ensureSession completes', async () => {
    const client = new GhDataClient(makeConfig(), createLogger(false));
    client.postJson = vi.fn().mockResolvedValue({}) as never;
    await ensureSession(makeConfig(), client);
    expect(getSessionState()).not.toBeNull();
    expect(getSessionState()?.sessionId).toMatch(UUID_V4_RE);
    expect(getSessionState()?.adopted).toBe(false);
  });
});

describe('session cookie contract (D2)', () => {
  let client: GhDataClient;
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    client = new GhDataClient(makeConfig(), createLogger(false));
    client.postJson = vi.fn().mockResolvedValue({}) as never;
  });

  afterEach(() => {
    jar.restore();
  });

  it('uses the funnel-canonical cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('hippo_session_id');
  });

  it('writes the cookie at the registrable root domain from a subdomain host', async () => {
    setLocation('https://sf.example.com/offer');
    const state = await ensureSession(makeConfig(), client);
    const rec = jar.get('hippo_session_id');
    expect(rec).toBeDefined();
    expect(rec!.value).toBe(state.sessionId);
    expect(rec!.domain).toBe('.example.com');
    expect(rec!.maxAge).toBe(2_592_000); // 30 days
    expect(rec!.path).toBe('/');
    expect(rec!.sameSite).toBe('Lax');
    expect(rec!.secure).toBe(true);
  });

  it('honours an explicit data-cookie-domain override for multi-part TLDs', async () => {
    setLocation('https://sf.brand.co.uk/offer');
    await ensureSession(makeConfig({ cookieDomain: '.brand.co.uk' }), client);
    expect(jar.get('hippo_session_id')!.domain).toBe('.brand.co.uk');
  });

  it('never writes the Cluster F sessionId cookie name', async () => {
    setLocation('https://sf.example.com/offer');
    await ensureSession(makeConfig(), client);
    expect(jar.names()).toContain('hippo_session_id');
    expect(jar.names()).not.toContain('sessionId');
  });
});

describe('ensureSession — D1 resolution ladder', () => {
  let client: GhDataClient;
  let postSpy: ReturnType<typeof vi.fn>;
  let jar: CookieJar;

  beforeEach(() => {
    jar = installCookieJar();
    client = new GhDataClient(makeConfig(), createLogger(false));
    postSpy = vi.fn().mockResolvedValue({});
    client.postJson = postSpy as never;
    setLocation('https://sf.example.com/offer');
  });

  afterEach(() => {
    jar.restore();
  });

  it('adopts ?sessionid= over a different cookie value', async () => {
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('url-value-222');
    expect(state.adopted).toBe(true);
  });

  it('persists the adopted id to the cookie at the root domain', async () => {
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    await ensureSession(makeConfig(), client);
    const rec = jar.get('hippo_session_id');
    expect(rec!.value).toBe('url-value-222');
    expect(rec!.domain).toBe('.example.com');
    expect(rec!.maxAge).toBe(2_592_000);
    expect(rec!.sameSite).toBe('Lax');
  });

  it('falls through to the cookie when ?sessionid= is malformed, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=bad%20value%3B%20Max-Age%3D0');

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toBe('cookie-value-111');
    expect(state.adopted).toBe(false);
    expect(warn).toHaveBeenCalledWith('[gh]', expect.stringContaining('malformed ?sessionid='));
    expect(jar.get('hippo_session_id')!.value).toBe('cookie-value-111');
  });

  it('mints a v4 UUID when there is no URL param and no cookie', async () => {
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.adopted).toBe(false);
    expect(jar.get('hippo_session_id')!.value).toBe(state.sessionId);
  });

  it('adopts ?sessionid= when no cookie exists at all', async () => {
    setLocation('https://sf.example.com/offer?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
    expect(state.adopted).toBe(true);
    expect(jar.get('hippo_session_id')!.value).toBe('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
  });

  it('ignores ?SessionId= — the key is read case-sensitively', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?SessionId=url-value-222');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('cookie-value-111');
    expect(state.adopted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs the adoption in debug mode', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    await ensureSession(makeConfig({ debug: true }), client);
    expect(debug).toHaveBeenCalledWith(
      '[gh]',
      expect.stringContaining('adopting ?sessionid='),
      'url-value-222',
    );
  });

  it('still resolves the adopted id when the cookie write is blocked', async () => {
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    const setter = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('cookie write blocked');
    });
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('url-value-222');
    expect(state.adopted).toBe(true);
    setter.mockRestore();
  });
});
