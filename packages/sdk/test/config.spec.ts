import { describe, it, expect } from 'vitest';
import { parseScriptConfig, isAllowedApiHost, ConfigError } from '../src/config';

function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'src') s.src = v;
    else s.setAttribute(`data-${k}`, v);
  }
  return s;
}

describe('isAllowedApiHost', () => {
  it.each([
    ['api-prod.goldenhippo.io', true],
    ['api-uat.goldenhippo.io', true],
    ['localhost', true],
    ['127.0.0.1', true],
    ['app.local', true],
    ['evil.com', false],
    ['api-prod.goldenhippo.io.evil.com', false],
    ['', false],
  ])('host %s -> %s', (host, expected) => {
    expect(isAllowedApiHost(host)).toBe(expected);
  });
});

describe('parseScriptConfig', () => {
  const goodKey = 'gh_pk_netlify_gundry_a1b2c3';
  const goodSrc = 'https://api-prod.goldenhippo.io/sdk/v3/gh.js';

  it('parses a valid config', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    const c = parseScriptConfig(s);
    expect(c).toEqual({
      key: goodKey,
      brand: 'Gundry MD',
      debug: false,
      apiBaseUrl: 'https://api-prod.goldenhippo.io',
      checkoutBase: null,
      cookieDomain: null,
      brandToken: null,
      sessionEnabled: true,
      checkoutSessionId: true,
      eventsEnabled: true,
      sessionUrlFirst: false,
    });
  });

  describe('feature toggles', () => {
    const base = { key: goodKey, brand: 'Gundry MD', src: goodSrc };

    it.each([
      ['session', 'sessionEnabled'],
      ['checkout-sessionid', 'checkoutSessionId'],
      ['events', 'eventsEnabled'],
    ] as const)('data-%s defaults to on', (_attr, field) => {
      expect(parseScriptConfig(makeScript(base))[field]).toBe(true);
    });

    it.each([
      ['session', 'sessionEnabled'],
      ['checkout-sessionid', 'checkoutSessionId'],
      ['events', 'eventsEnabled'],
    ] as const)('data-%s="off" turns %s off', (attr, field) => {
      expect(parseScriptConfig(makeScript({ ...base, [attr]: 'off' }))[field]).toBe(false);
    });

    // "off" and "false" are both accepted so nobody loses an afternoon to a
    // reasonable guess. Anything else is on — a typo must not silently
    // disable session tracking for a whole brand.
    it.each([
      ['off', false],
      ['OFF', false],
      ['  off  ', false],
      ['false', false],
      ['FALSE', false],
      ['on', true],
      ['true', true],
      ['', true],
      ['0', true],
      ['no', true],
      ['nope', true],
    ])('data-session=%j -> sessionEnabled %s', (value, expected) => {
      expect(parseScriptConfig(makeScript({ ...base, session: value })).sessionEnabled).toBe(
        expected,
      );
    });

    it('toggles are independent of one another', () => {
      const c = parseScriptConfig(makeScript({ ...base, 'checkout-sessionid': 'off' }));
      expect(c.checkoutSessionId).toBe(false);
      expect(c.sessionEnabled).toBe(true);
      expect(c.eventsEnabled).toBe(true);
    });

    it('data-session-url-first defaults to false and opts in with "true"', () => {
      expect(parseScriptConfig(makeScript(base)).sessionUrlFirst).toBe(false);
      expect(
        parseScriptConfig(makeScript({ ...base, 'session-url-first': 'true' })).sessionUrlFirst,
      ).toBe(true);
      expect(
        parseScriptConfig(makeScript({ ...base, 'session-url-first': 'TRUE' })).sessionUrlFirst,
      ).toBe(true);
      expect(
        parseScriptConfig(makeScript({ ...base, 'session-url-first': 'yes' })).sessionUrlFirst,
      ).toBe(false);
    });
  });

  it('respects data-debug="true"', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', debug: 'true', src: goodSrc });
    expect(parseScriptConfig(s).debug).toBe(true);
  });

  it('accepts a hyphenated brand segment', () => {
    const s = makeScript({
      key: 'gh_pk_internal_beverly-hills-md_a1b2c3',
      brand: 'Beverly Hills MD',
      src: goodSrc,
    });
    expect(parseScriptConfig(s).key).toBe('gh_pk_internal_beverly-hills-md_a1b2c3');
  });

  it('rejects a malformed key', () => {
    const s = makeScript({ key: 'pk_test_123', brand: 'Gundry MD', src: goodSrc });
    expect(() => parseScriptConfig(s)).toThrow(ConfigError);
  });

  it('rejects an empty brand', () => {
    const s = makeScript({ key: goodKey, brand: '   ', src: goodSrc });
    expect(() => parseScriptConfig(s)).toThrow(/data-brand is required/);
  });

  it('rejects a script loaded from an unallowed host', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: 'https://evil.com/sdk/v3/gh.js' });
    expect(() => parseScriptConfig(s)).toThrow(/disallowed host/);
  });

  it('accepts the UAT host', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      src: 'https://api-uat.goldenhippo.io/sdk/v3/gh.js',
    });
    expect(parseScriptConfig(s).apiBaseUrl).toBe('https://api-uat.goldenhippo.io');
  });

  it('parses data-checkout-base when present', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: goodSrc,
    });
    expect(parseScriptConfig(s).checkoutBase).toBe('https://checkout.gundrymd.com');
  });

  it('returns null checkoutBase when data-checkout-base is absent', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    expect(parseScriptConfig(s).checkoutBase).toBeNull();
  });

  it('parses data-cookie-domain when present', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'cookie-domain': '.gundrymd.com',
      src: goodSrc,
    });
    expect(parseScriptConfig(s).cookieDomain).toBe('.gundrymd.com');
  });

  it('returns null cookieDomain when data-cookie-domain is absent', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    expect(parseScriptConfig(s).cookieDomain).toBeNull();
  });

  it('reads data-brand-token when present', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'brand-token': 'gundry',
      src: goodSrc,
    });
    expect(parseScriptConfig(s).brandToken).toBe('gundry');
  });

  it('is null when data-brand-token is absent — brand is NOT a fallback here', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    expect(parseScriptConfig(s).brandToken).toBeNull();
  });

  it('trims and treats whitespace-only as absent', () => {
    const trimmed = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'brand-token': '  gundry  ',
      src: goodSrc,
    });
    expect(parseScriptConfig(trimmed).brandToken).toBe('gundry');

    const blank = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      'brand-token': '   ',
      src: goodSrc,
    });
    expect(parseScriptConfig(blank).brandToken).toBeNull();
  });
});
