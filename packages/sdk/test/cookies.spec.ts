import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCookieDomain,
  readCookie,
  writeCookie,
  deleteCookie,
  SAFE_TLDS,
} from '../src/cookies';
import type { GhConfig } from '../src/config';

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
  // jsdom's location is read-only by default; override via the prototype
  // descriptor so individual tests can stub a hostname.
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, protocol: 'https:' },
    writable: true,
  });
}

describe('getCookieDomain', () => {
  it('returns explicit override verbatim when config.cookieDomain is set', () => {
    setHostname('info.example.com');
    expect(getCookieDomain(makeConfig({ cookieDomain: '.brand-override.com' }))).toBe('.brand-override.com');
  });

  it('auto-detects for .com hosts by stripping the leading subdomain', () => {
    setHostname('info.gundrymd.com');
    expect(getCookieDomain(makeConfig())).toBe('.gundrymd.com');
  });

  it.each(SAFE_TLDS.map((t) => [t] as const))('auto-detects for .%s hosts', (tld) => {
    setHostname(`info.example.${tld}`);
    expect(getCookieDomain(makeConfig())).toBe(`.example.${tld}`);
  });

  it('returns null for multi-part TLDs like .co.uk', () => {
    setHostname('info.brand.co.uk');
    expect(getCookieDomain(makeConfig())).toBeNull();
  });

  it('returns null for single-label hosts like localhost', () => {
    setHostname('localhost');
    expect(getCookieDomain(makeConfig())).toBeNull();
  });

  it('returns null for IP addresses', () => {
    setHostname('192.168.1.1');
    expect(getCookieDomain(makeConfig())).toBeNull();
  });

  it('handles bare apex domain (e.g., gundrymd.com — no leading subdomain)', () => {
    setHostname('gundrymd.com');
    expect(getCookieDomain(makeConfig())).toBe('.gundrymd.com');
  });
});

describe('cookie read/write/delete', () => {
  // Manual cookie jar for jsdom, since jsdom's document.cookie doesn't persist.
  let cookieJar: Record<string, string> = {};

  beforeEach(() => {
    cookieJar = {};
    setHostname('localhost');
    // Mock document.cookie getter/setter to use our manual jar.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return Object.entries(cookieJar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      },
      set(cookieStr: string) {
        // Parse the Set-Cookie string.
        const parts = cookieStr.split(';');
        const [nameValue] = parts;
        const [name, value] = nameValue.split('=');
        const trimmedName = name.trim();

        // Check for Max-Age=0 to delete.
        const hasMaxAge0 = parts.some((p) => p.trim().startsWith('Max-Age=0'));
        if (hasMaxAge0) {
          delete cookieJar[trimmedName];
        } else {
          // Store the value.
          cookieJar[trimmedName] = value || '';
        }
      },
    });
  });

  it('round-trips a value via writeCookie + readCookie', () => {
    writeCookie('test_cookie', 'hello-world', { maxAgeSec: 60, domain: null });
    expect(readCookie('test_cookie')).toBe('hello-world');
  });

  it('returns undefined for a missing cookie', () => {
    expect(readCookie('nonexistent_cookie')).toBeUndefined();
  });

  it('URL-encodes values with special characters', () => {
    writeCookie('encoded', 'a=b; c', { maxAgeSec: 60, domain: null });
    expect(readCookie('encoded')).toBe('a=b; c');
  });

  it('deleteCookie removes a previously-written cookie', () => {
    writeCookie('to_delete', 'present', { maxAgeSec: 60, domain: null });
    expect(readCookie('to_delete')).toBe('present');
    deleteCookie('to_delete', null);
    expect(readCookie('to_delete')).toBeUndefined();
  });

  it('writeCookie refuses names with illegal characters', () => {
    expect(() => writeCookie('bad name', 'x', { maxAgeSec: 60, domain: null })).toThrow(/illegal/i);
    expect(() => writeCookie('bad=name', 'x', { maxAgeSec: 60, domain: null })).toThrow(/illegal/i);
    expect(() => writeCookie('bad;name', 'x', { maxAgeSec: 60, domain: null })).toThrow(/illegal/i);
  });
});
