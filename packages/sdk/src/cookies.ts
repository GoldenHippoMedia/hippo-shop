/**
 * Cookie read/write/delete helpers + brand root-domain auto-detection.
 * The SDK uses this for the 30-day `sessionId` cookie and for inspecting
 * the API-set `connect.sid`. See Cluster F design spec for the cookie
 * model.
 */

import type { GhConfig } from './config';

/**
 * Single-segment TLDs the SDK auto-detects safely. Multi-part TLDs
 * (`.co.uk`, `.com.au`, `.co.jp`, etc.) require `data-cookie-domain`
 * to be set explicitly — auto-detect refuses to guess them and falls
 * back to host-only cookies.
 */
export const SAFE_TLDS = [
  'com',
  'net',
  'org',
  'io',
  'app',
  'dev',
  'ai',
  'co',
  'us',
  'store',
  'shop',
] as const;

const ILLEGAL_NAME_CHARS = /[=,;\s]/;

/**
 * Returns the `Domain` attribute to use when writing the SDK's cookies,
 * or `null` for host-only cookies.
 *
 * Resolution order:
 *  1. Explicit `data-cookie-domain` from config wins, verbatim.
 *  2. Else: if `window.location.hostname` ends in a SAFE_TLDS entry,
 *     return `.<registrable-domain>`.
 *  3. Else: return `null` (host-only).
 */
export function getCookieDomain(config: GhConfig): string | null {
  if (config.cookieDomain) return config.cookieDomain;

  const host = (typeof window !== 'undefined' ? window.location.hostname : '') || '';
  if (!host || !host.includes('.')) return null; // localhost, single-label
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null; // IPv4
  if (host.startsWith('[') && host.endsWith(']')) return null; // IPv6 brackets

  const labels = host.split('.');
  const tld = labels.at(-1)?.toLowerCase();
  if (!tld || !SAFE_TLDS.includes(tld as typeof SAFE_TLDS[number])) return null;

  // Apex (e.g., `gundrymd.com`): 2 labels — return `.gundrymd.com`.
  // Subdomain (e.g., `info.gundrymd.com`): 3+ labels — strip one to
  // give `.gundrymd.com`.
  if (labels.length === 2) return `.${host}`;
  return '.' + labels.slice(1).join('.');
}

/** Read a single cookie by name. Returns the decoded value, or undefined. */
export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const target = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split(';');
  for (const c of cookies) {
    const trimmed = c.trim();
    if (trimmed.startsWith(target)) {
      try {
        return decodeURIComponent(trimmed.slice(target.length));
      } catch {
        return trimmed.slice(target.length);
      }
    }
  }
  return undefined;
}

export interface WriteCookieOptions {
  /** Max-Age in seconds. Required so the caller has to think about expiry. */
  maxAgeSec: number;
  /** `Domain=` attribute value. `null` => host-only. */
  domain: string | null;
  /** Default `'/'`. */
  path?: string;
  /** Default `'Lax'`. */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Default true on `https:`, false otherwise. */
  secure?: boolean;
}

export function writeCookie(name: string, value: string, opts: WriteCookieOptions): void {
  if (typeof document === 'undefined') return;
  if (!name || ILLEGAL_NAME_CHARS.test(name)) {
    throw new Error(`cookies.writeCookie: illegal cookie name: ${JSON.stringify(name)}`);
  }
  const secure =
    opts.secure ?? (typeof window !== 'undefined' && window.location.protocol === 'https:');
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`,
    `Path=${opts.path ?? '/'}`,
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

export function deleteCookie(name: string, domain: string | null): void {
  writeCookie(name, '', { maxAgeSec: 0, domain });
}
