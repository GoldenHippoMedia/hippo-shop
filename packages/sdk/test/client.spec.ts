import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GhDataClient } from '../src/client';
import { GhError } from '../src/errors';
import { createLogger } from '../src/log';
import type { GhConfig } from '../src/config';

const CONFIG: GhConfig = {
  key: 'gh_pk_test_consumer_abc123',
  brand: 'Gundry MD',
  debug: false,
  apiBaseUrl: 'https://api-prod.goldenhippo.io',
  checkoutBase: null,
  cookieDomain: null,
};

function mockFetchOnce(body: unknown, init: ResponseInit = {}): void {
  const res = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(res);
}

describe('GhDataClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs the funnel route with key + brand headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"slug":"x"}', { status: 200 }),
    );
    const client = new GhDataClient(CONFIG, createLogger(false));
    await client.funnel('bio-complete-3-main');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      'https://api-prod.goldenhippo.io/public/v1/funnel/bio-complete-3-main',
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-GH-Key']).toBe('gh_pk_test_consumer_abc123');
    expect(headers['X-GH-Brand']).toBe('Gundry MD');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('URL-encodes the slug', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          variants: {
            subscription: { standard: [], myAccount: [] },
            oneTime: { standard: [], myAccount: [] },
          },
        }),
        { status: 200 },
      ),
    );
    const client = new GhDataClient(CONFIG, createLogger(false));
    await client.product('weird/slug with spaces');
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://api-prod.goldenhippo.io/public/v1/product/weird%2Fslug%20with%20spaces',
    );
  });

  it('dedupes concurrent calls to the same resource', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          slug: 'x',
          variants: {
            subscription: { standard: [], myAccount: [] },
            oneTime: { standard: [], myAccount: [] },
          },
        }),
        { status: 200 },
      ),
    );
    const client = new GhDataClient(CONFIG, createLogger(false));
    const [a, b, c] = await Promise.all([
      client.product('x'),
      client.product('x'),
      client.product('x'),
    ]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('maps 404 to a GhError with code=not_found', async () => {
    mockFetchOnce({ code: 'not_found', message: 'nope' }, { status: 404 });
    const client = new GhDataClient(CONFIG, createLogger(false));
    await expect(client.funnel('missing')).rejects.toMatchObject({
      name: 'GhError',
      code: 'not_found',
    });
  });

  it('maps 429 to rate_limited and parses Retry-After', async () => {
    const res = new Response('{}', {
      status: 429,
      headers: { 'Retry-After': '30' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(res);
    const client = new GhDataClient(CONFIG, createLogger(false));
    try {
      await client.product('x');
      throw new Error('expected rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(GhError);
      expect((e as GhError).code).toBe('rate_limited');
      expect((e as GhError).retryAfterMs).toBe(30_000);
    }
  });

  it('maps a network failure to code=network', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fail'));
    const client = new GhDataClient(CONFIG, createLogger(false));
    await expect(client.destination('x')).rejects.toMatchObject({
      name: 'GhError',
      code: 'network',
    });
  });

  // M1: an ok response whose body read itself rejects (e.g. an aborted
  // stream) must still surface as a GhError, not a raw TypeError.
  it('M1: maps a failed response-body read to a GhError, not a raw error', async () => {
    const abortedResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.reject(new TypeError('body stream aborted')),
    } as unknown as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(abortedResponse);
    const client = new GhDataClient(CONFIG, createLogger(false));
    const promise = client.destination('x');
    await expect(promise).rejects.toBeInstanceOf(GhError);
    await expect(promise).rejects.toMatchObject({ code: 'server' });
  });

  it('rejects empty slug with bad_request without making a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new GhDataClient(CONFIG, createLogger(false));
    await expect(client.funnel('')).rejects.toMatchObject({ code: 'bad_request' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not enrich funnel or destination responses', async () => {
    mockFetchOnce({ slug: 'f1', name: 'F', active: true, steps: [] });
    const client = new GhDataClient(CONFIG, createLogger(false));
    const funnel = await client.funnel('f1');
    expect((funnel as unknown as Record<string, unknown>)['variants']).toBeUndefined();
    expect(Object.keys(funnel)).not.toContain('standardList');
  });

  it('returns the same object on cache hit', async () => {
    mockFetchOnce({
      id: 'p1', slug: 's', name: 'n',
      packaging: { singular: 'B', plural: 'Bs' },
      image: '', reviews: { count: 0, average: 0, globalFiveStarReviews: 0 },
      outOfStock: false,
      variants: {
        subscription: {
          standardList: [],
          standardByQuantity: {},
          myAccountList: [],
          myAccountByQuantity: {},
        },
        oneTime: {
          standardList: [],
          standardByQuantity: {},
          myAccountList: [],
          myAccountByQuantity: {},
        },
      },
    });
    const client = new GhDataClient(CONFIG, createLogger(false));
    const first = await client.product('s');
    const second = await client.product('s');
    expect(second).toBe(first); // promise cache returns identical reference
    expect(first.variants.subscription.standardByQuantity).toEqual({});
  });

  it('postEvent POSTs with keepalive, extra headers, and no credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new GhDataClient(CONFIG, createLogger(false));

    await client.postEvent('funnel-event', { eventType: 'Page View' }, {
      'X-GH-Event-Id': 'b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api-prod.goldenhippo.io/public/v1/funnel-event');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(req.keepalive).toBe(true);
    expect(req.credentials).toBeUndefined();
    const headers = req.headers as Record<string, string>;
    expect(headers['X-GH-Event-Id']).toBe('b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-GH-Key']).toBe('gh_pk_test_consumer_abc123');
    expect(headers['X-GH-Brand']).toBe('Gundry MD');
    expect(req.body).toBe(JSON.stringify({ eventType: 'Page View' }));
  });

  it('postEvent issues exactly one request on 429 (no retry)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }),
    );
    const client = new GhDataClient(CONFIG, createLogger(false));
    await expect(client.postEvent('funnel-event', { a: 1 })).rejects.toMatchObject({
      name: 'GhError',
      code: 'rate_limited',
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe('GhDataClient.postJson', () => {
  let client: GhDataClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new GhDataClient(
      {
        key: 'gh_pk_test_abc123',
        brand: 'Test',
        debug: false,
        apiBaseUrl: 'https://api-prod.goldenhippo.io',
        checkoutBase: null,
        cookieDomain: null,
      },
      { debug: () => {}, warn: () => {}, error: () => {} },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs JSON body with X-GH-Key and X-GH-Brand headers and credentials: include', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await client.postJson('session', { affParameters: { utmSource: 'fb' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-prod.goldenhippo.io/public/v1/session');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-GH-Key']).toBe('gh_pk_test_abc123');
    expect(init.headers['X-GH-Brand']).toBe('Test');
    expect(JSON.parse(init.body)).toEqual({ affParameters: { utmSource: 'fb' } });
  });

  it('returns parsed JSON response on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"sessionId":"abc"}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const result = await client.postJson<{ sessionId: string }>('session', {});
    expect(result).toEqual({ sessionId: 'abc' });
  });

  it('returns null on 2xx with empty body', async () => {
    const res = new Response(null, { status: 204 });
    fetchMock.mockResolvedValueOnce(res);
    const result = await client.postJson('session', {});
    expect(result).toBeNull();
  });

  it('throws GhError on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"code":"forbidden","message":"nope"}', { status: 403 }),
    );
    await expect(client.postJson('session', {})).rejects.toMatchObject({
      code: 'forbidden',
      message: 'nope',
    });
  });

  it('throws GhError on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.postJson('session', {})).rejects.toMatchObject({
      code: 'network',
    });
  });
});
