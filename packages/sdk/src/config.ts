/**
 * Parses `<script data-key="..." data-brand="...">` attributes and derives
 * the API base URL from the script's own `src`. Refuses to attach if the
 * script was loaded from an unrecognized host — the host is the contract.
 */

export interface GhConfig {
  key: string;
  brand: string;
  debug: boolean;
  apiBaseUrl: string;
  /** Brand-level default for the checkout handoff base URL. `null` if not supplied. */
  checkoutBase: string | null;
  /** Explicit cookie domain (e.g., `.gundrymd.com`). `null` triggers auto-detect at cookie-write time. */
  cookieDomain: string | null;
}

const KEY_PATTERN = /^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/;

const PROD_HOST = 'api-prod.goldenhippo.io';
const UAT_HOST = 'api-uat.goldenhippo.io';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseScriptConfig(script: HTMLScriptElement): GhConfig {
  const key = script.dataset['key'] ?? '';
  const brand = script.dataset['brand'] ?? '';
  const debug = script.dataset['debug'] === 'true';

  if (!KEY_PATTERN.test(key)) {
    throw new ConfigError(
      `data-key must match /^gh_pk_[a-z0-9_-]+_<hex>$/ — got: ${truncate(key)}`,
    );
  }
  if (!brand.trim()) {
    throw new ConfigError('data-brand is required and must be non-empty');
  }

  const src = script.src;
  if (!src) {
    throw new ConfigError('script src is empty — cannot derive API base URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch (err) {
    throw new ConfigError(`could not parse script src as URL: ${src}`, { cause: err });
  }

  if (!isAllowedApiHost(parsed.hostname)) {
    throw new ConfigError(`script loaded from disallowed host: ${parsed.hostname}`);
  }

  const checkoutBase = (script.dataset['checkoutBase'] ?? '').trim() || null;
  const cookieDomain = (script.dataset['cookieDomain'] ?? '').trim() || null;

  return {
    key,
    brand: brand.trim(),
    debug,
    apiBaseUrl: parsed.origin,
    checkoutBase,
    cookieDomain,
  };
}

export function isAllowedApiHost(hostname: string): boolean {
  if (hostname === PROD_HOST) return true;
  if (hostname === UAT_HOST) return true;
  if (LOCAL_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  return false;
}

export class ConfigError extends Error {
  override readonly cause: unknown;
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.cause = opts.cause;
  }
}

function truncate(s: string, n = 48): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
