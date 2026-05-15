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

  it('GETs the funnel route with brand + bearer headers', async () => {
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
    expect(headers['Authorization']).toBe('Bearer gh_pk_test_consumer_abc123');
    expect(headers['X-GH-Brand']).toBe('Gundry MD');
  });

  it('URL-encodes the slug', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const client = new GhDataClient(CONFIG, createLogger(false));
    await client.product('weird/slug with spaces');
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      'https://api-prod.goldenhippo.io/public/v1/product/weird%2Fslug%20with%20spaces',
    );
  });

  it('dedupes concurrent calls to the same resource', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"slug":"x"}', { status: 200 }),
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

  it('rejects empty slug with bad_request without making a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new GhDataClient(CONFIG, createLogger(false));
    await expect(client.funnel('')).rejects.toMatchObject({ code: 'bad_request' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
