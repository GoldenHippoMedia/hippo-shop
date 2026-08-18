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
    brandToken: null,
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
    const name = c.split('=')[0]!.trim();
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

  // I3: a first-touch POST stores the real landing page; a same-session
  // follow-on click must not blow it away with the current, internal page.
  it('I3: a first load stores landingUrl', async () => {
    setLocation('https://info.gundrymd.com/lp/vsl?utm_source=facebook');
    await ensureSession(makeConfig(), client);
    const [, body] = postSpy.mock.calls[0] as [string, { affParameters: Record<string, string> }];
    expect(body.affParameters.landingUrl).toBe('https://info.gundrymd.com/lp/vsl');
  });

  it('I3: a returning visit (cookie reused) omits landingUrl from the POST', async () => {
    jar.seed(SESSION_COOKIE_NAME, '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    setLocation('https://info.gundrymd.com/lp/offers');
    await ensureSession(makeConfig(), client);
    const [, body] = postSpy.mock.calls[0] as [string, { affParameters: Record<string, string> }];
    expect('landingUrl' in body.affParameters).toBe(false);
  });

  it('I3: an explicit ?landing_url= is sent even on a returning visit', async () => {
    jar.seed(SESSION_COOKIE_NAME, '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    setLocation('https://info.gundrymd.com/lp/offers?landing_url=https%3A%2F%2Fads.example.com%2Flp');
    await ensureSession(makeConfig(), client);
    const [, body] = postSpy.mock.calls[0] as [string, { affParameters: Record<string, string> }];
    expect(body.affParameters.landingUrl).toBe('https://ads.example.com/lp');
  });

  it('I3: adopting ?sessionid= counts as a first touch, not a returning visit', async () => {
    jar.seed(SESSION_COOKIE_NAME, 'stale-cookie-session-id');
    setLocation('https://info.gundrymd.com/lp/vsl?sessionid=adopted-session-id');
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toBe('adopted-session-id');
    expect(state.adopted).toBe(true);
    const [, body] = postSpy.mock.calls[0] as [string, { affParameters: Record<string, string> }];
    expect(body.affParameters.landingUrl).toBe('https://info.gundrymd.com/lp/vsl');
  });

  it('on POST failure still resolves with an id and locally-parsed params', async () => {
    // Stubbed so the expected degradation warn does not print to stderr and
    // make a green run look like a failing one.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    postSpy.mockRejectedValueOnce(new Error('network blew up'));
    const state = await ensureSession(makeConfig(), client);
    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.params.landingUrl).toContain('gundrymd.com');
  });

  // D4 keeps the POST fire-and-forget (no retry, not even on 429), but a
  // dropped session POST is invisible from outside: the page renders, checkout
  // links bind and the id still rides the URL, while the attribution row never
  // lands. The warn is the only signal.
  it('warns when the attribution POST fails, and still does not rethrow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    postSpy.mockRejectedValueOnce(new Error('network blew up'));

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(UUID_V4_RE);
    // Exactly two args: the prefix and one line carrying the error's *message*.
    // Passing the Error itself would dump a stack per page load on a
    // third-party brand page, and a failed POST is a common event.
    expect(warn).toHaveBeenCalledWith(
      '[gh]',
      'session: attribution POST failed — attribution degraded for this load (network blew up)',
    );
  });

  // Privacy tools and some tag managers stub or null `console.warn`, and a stub
  // that throws used to escape `ensureSession` — this test asserted exactly
  // that escape, which encoded the defect rather than the contract. The guard
  // now lives in the logger (`emit` in log.ts), so a throwing `console.warn` is
  // invisible from out here: `ensureSession` resolves normally, the state is
  // cached and `gh:session-ready` fires, no differently than on a clean page.
  // Deliberately exercises the real `createLogger` path through `ensureSession`
  // rather than an injected `vi.fn()` — the hazard is how the logger reaches
  // `console.warn`.
  it('resolves normally, caches state and fires gh:session-ready when console.warn throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console.warn stubbed by a privacy tool');
    });
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);
    postSpy.mockRejectedValueOnce(new Error('network blew up'));

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(getSessionState()).toBe(state);
    expect(handler).toHaveBeenCalledOnce();
    // The line was still attempted: the guard swallows the host page's failure,
    // it does not stop the SDK from trying to report the degradation.
    expect(warn).toHaveBeenCalled();
  });

  // M4: generateSessionId is the one unguarded throw in ensureSession. If it
  // throws, cachedState must not stay null forever — every checkout link on
  // the page would sit at href="#" for the life of the page.
  it('M4: falls back to a last-resort id and still resolves when generateSessionId throws', async () => {
    vi.stubGlobal('crypto', undefined);
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toBeTruthy();
    expect(state.adopted).toBe(false);
    expect(getSessionState()).toBe(state);
    expect(handler).toHaveBeenCalledOnce();
    expect(postSpy).toHaveBeenCalledWith('session', {
      affParameters: expect.objectContaining({ sessionId: state.sessionId }),
    });
  });

  it('fires gh:session-ready on window after resolving', async () => {
    const handler = vi.fn();
    window.addEventListener('gh:session-ready', handler);
    await ensureSession(makeConfig(), client);
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as CustomEvent;
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

  // I4: the sf -> www handoff works via the URL, not the cookie, so a
  // root-domain, 30-day cookie for an *adopted* id serves no purpose and
  // only pins the whole brand to one clicked link's session for a month.
  it('I4: writes an adopted (?sessionid=) id host-only, with no Domain attribute', async () => {
    setLocation('https://sf.example.com/offer?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
    const state = await ensureSession(makeConfig(), client);
    expect(state.adopted).toBe(true);
    const rec = jar.get('hippo_session_id');
    expect(rec).toBeDefined();
    expect(rec!.value).toBe('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455');
    expect(rec!.domain).toBeNull();
    expect(rec!.maxAge).toBe(2_592_000); // TTL unchanged — only the scope narrows
  });

  it('I4: writes a minted id root-domain scoped, unlike an adopted id', async () => {
    setLocation('https://sf.example.com/offer');
    const state = await ensureSession(makeConfig(), client);
    expect(state.adopted).toBe(false);
    expect(jar.get('hippo_session_id')!.domain).toBe('.example.com');
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

  // I4: root-domain persistence of an adopted id served no purpose (the
  // sf -> www handoff works via the URL, not the cookie) and pinned every
  // subdomain of the brand to whichever session id one clicked link
  // happened to carry, for the full 30-day TTL. Adopted ids are host-only.
  it('persists the adopted id to the cookie host-only, not at the root domain', async () => {
    jar.seed('hippo_session_id', 'cookie-value-111');
    setLocation('https://sf.example.com/offer?sessionid=url-value-222');
    await ensureSession(makeConfig(), client);
    const rec = jar.get('hippo_session_id');
    expect(rec!.value).toBe('url-value-222');
    expect(rec!.domain).toBeNull();
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

  // Task 5 widened the cookie to the registrable root, so any sibling
  // subdomain can write hippo_session_id. An unvalidated value flowed into a
  // cookie write, a query string and a server-side session key.
  it('rejects a malformed cookie value, warns, and mints a fresh id instead', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    jar.seed('hippo_session_id', 'bad value; Max-Age=0');

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toMatch(UUID_V4_RE);
    expect(state.adopted).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[gh]',
      expect.stringContaining('malformed hippo_session_id cookie'),
    );
    // The fresh id replaces the rejected value rather than riding alongside it.
    expect(jar.get('hippo_session_id')!.value).toBe(state.sessionId);
  });

  it('adopts a cookie value that passes SESSION_ID_PATTERN unchanged, without re-persisting', async () => {
    jar.seed('hippo_session_id', '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');

    const state = await ensureSession(makeConfig(), client);

    expect(state.sessionId).toBe('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    expect(state.adopted).toBe(false);
    expect(jar.writes.filter((w) => w.startsWith(`${SESSION_COOKIE_NAME}=`))).toEqual([]);
  });
});
