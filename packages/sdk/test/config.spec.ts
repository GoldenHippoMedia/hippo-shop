import { describe, it, expect } from 'vitest';
import { parseScriptConfig, isAllowedApiHost, ConfigError } from '../src/config';

function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'src') s.src = v;
    else s.dataset[k] = v;
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
  const goodSrc = 'https://api-prod.goldenhippo.io/sdk/v1/gh.js';

  it('parses a valid config', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: goodSrc });
    const c = parseScriptConfig(s);
    expect(c).toEqual({
      key: goodKey,
      brand: 'Gundry MD',
      debug: false,
      apiBaseUrl: 'https://api-prod.goldenhippo.io',
    });
  });

  it('respects data-debug="true"', () => {
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', debug: 'true', src: goodSrc });
    expect(parseScriptConfig(s).debug).toBe(true);
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
    const s = makeScript({ key: goodKey, brand: 'Gundry MD', src: 'https://evil.com/sdk/v1/gh.js' });
    expect(() => parseScriptConfig(s)).toThrow(/disallowed host/);
  });

  it('accepts the UAT host', () => {
    const s = makeScript({
      key: goodKey,
      brand: 'Gundry MD',
      src: 'https://api-uat.goldenhippo.io/sdk/v1/gh.js',
    });
    expect(parseScriptConfig(s).apiBaseUrl).toBe('https://api-uat.goldenhippo.io');
  });
});
