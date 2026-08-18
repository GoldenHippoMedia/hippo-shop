import type {
  HippoShopFunnelDTO,
  HippoShopDestinationDTO,
  HippoShopProductDTO,
  HippoShopErrorDTO,
} from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from './config';
import { GhError, type GhErrorCode } from './errors';
import { RequestCache } from './cache';
import type { Logger } from './log';

type Resource = 'funnel' | 'destination' | 'product';

export class GhDataClient {
  private readonly cache = new RequestCache();

  constructor(
    private readonly config: GhConfig,
    private readonly logger: Logger,
  ) {}

  funnel(slugOrId: string): Promise<HippoShopFunnelDTO> {
    return this.request<HippoShopFunnelDTO>('funnel', slugOrId);
  }

  destination(slugOrId: string): Promise<HippoShopDestinationDTO> {
    return this.request<HippoShopDestinationDTO>('destination', slugOrId);
  }

  product(slugOrId: string): Promise<HippoShopProductDTO> {
    return this.request<HippoShopProductDTO>('product', slugOrId);
  }

  /** Clears the in-memory promise cache. Used by `gh.refresh()`. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * POST a JSON body to a `/public/v1/<resource>` route. Used by Cluster F's
   * session endpoint. Includes credentials so the API's `Set-Cookie` for
   * `connect.sid` is stored and forwarded on subsequent calls.
   */
  postJson<T = unknown>(resource: string, body: unknown): Promise<T | null> {
    const url = `${this.config.apiBaseUrl}/public/v1/${resource}`;
    this.logger.debug('POST', url);
    return this.fetchJson<T | null>(url, {
      method: 'POST',
      body,
      credentials: 'include',
    });
  }

  /**
   * Cluster G / D10: fire-and-forget event POST to `/public/v1/<resource>`.
   *
   * Differs from `postJson` in three load-bearing ways:
   *   - `keepalive: true` so the request survives page unload (sendBeacon is
   *     unusable: it cannot set headers, and Kong's key-auth needs `X-GH-Key`).
   *   - caller-supplied headers, for the `X-GH-Event-Id` correlation id — it
   *     rides as a header because the 36-field body is matched byte-for-byte
   *     upstream and unrecognised keys are dropped.
   *   - no `credentials`, because the funnel-event Kong route is
   *     `cors.credentials: false` and the body is self-sufficient.
   *
   * Never retries — not even on 429 (spec non-goals). Rejects on failure; the
   * caller is responsible for swallowing.
   */
  async postEvent(
    resource: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<void> {
    const url = `${this.config.apiBaseUrl}/public/v1/${resource}`;
    this.logger.debug('POST keepalive', url);
    await this.fetchJson<unknown>(url, {
      method: 'POST',
      body,
      keepalive: true,
      headers,
    });
  }

  private request<T>(resource: Resource, slugOrId: string): Promise<T> {
    if (!slugOrId) {
      return Promise.reject(
        new GhError('bad_request', `${resource} slug or id is required`),
      );
    }

    const cacheKey = `${resource}:${slugOrId}`;
    const cached = this.cache.get<T>(cacheKey);
    if (cached) {
      this.logger.debug('cache hit', cacheKey);
      return cached;
    }

    const url = `${this.config.apiBaseUrl}/public/v1/${resource}/${encodeURIComponent(slugOrId)}`;
    this.logger.debug('GET', url);

    const promise = this.fetchJson<T>(url);
    return this.cache.set(cacheKey, promise);
  }

  private async fetchJson<T>(
    url: string,
    opts: {
      method?: string;
      body?: unknown;
      credentials?: RequestCredentials;
      keepalive?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET';
    const init: RequestInit = {
      method,
      headers: {
        'X-GH-Key': this.config.key,
        'X-GH-Brand': this.config.brand,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.credentials) init.credentials = opts.credentials;
    if (opts.keepalive) init.keepalive = true;

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new GhError('network', errorMessage(err), { cause: err });
    }

    if (!res.ok) {
      const body = await safeJson<HippoShopErrorDTO>(res);
      const code: GhErrorCode = body?.code ?? mapStatus(res.status);
      const retryAfterMs =
        body?.retryAfterMs ?? parseRetryAfter(res.headers.get('Retry-After'));
      throw new GhError(code, body?.message ?? (res.statusText || 'request failed'), {
        retryAfterMs,
      });
    }

    // 204 / empty body short-circuit
    if (res.status === 204 || res.headers.get('Content-Length') === '0') {
      return null as T;
    }

    // M1: reading the body can itself reject (e.g. an aborted response
    // stream) — that used to fall outside every try/catch here and surface
    // as a raw TypeError, breaking the "every rejection is a GhError"
    // contract. Both the read and the parse are covered now.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw new GhError('server', 'failed to read response body', { cause: err });
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new GhError('server', 'response was not valid JSON', { cause: err });
    }
  }
}

function mapStatus(status: number): GhErrorCode {
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'server';
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const epoch = Date.parse(header);
  if (Number.isFinite(epoch)) return Math.max(0, epoch - Date.now());
  return null;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
