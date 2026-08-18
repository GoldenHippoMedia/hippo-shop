import { describe, it, expect } from 'vitest';
import {
  parseLandingParams,
  CLICK_ID_REGISTRY,
  type ParsedParams,
} from '../src/url-params';

const BASE = 'https://info.gundrymd.com/some-funnel';

describe('parseLandingParams', () => {
  it('captures landingUrl as the full href', () => {
    const out = parseLandingParams(`${BASE}?a=1`, '');
    expect(out.landingUrl).toBe(`${BASE}?a=1`);
  });

  it('captures referralUrl when referrer is non-empty', () => {
    const out = parseLandingParams(BASE, 'https://www.facebook.com/');
    expect(out.referralUrl).toBe('https://www.facebook.com/');
  });

  it('omits referralUrl when referrer is empty', () => {
    const out = parseLandingParams(BASE, '');
    expect(out.referralUrl).toBeUndefined();
  });

  it('captures utm_* params as camelCased keys', () => {
    const out = parseLandingParams(
      `${BASE}?utm_source=fb&utm_medium=cpc&utm_campaign=summer`,
      '',
    );
    expect(out.utmSource).toBe('fb');
    expect(out.utmMedium).toBe('cpc');
    expect(out.utmCampaign).toBe('summer');
  });

  it('captures sub_id1–5 params', () => {
    const out = parseLandingParams(
      `${BASE}?sub_id1=a&sub_id2=b&sub_id3=c&sub_id4=d&sub_id5=e`,
      '',
    );
    expect(out.subId1).toBe('a');
    expect(out.subId2).toBe('b');
    expect(out.subId3).toBe('c');
    expect(out.subId4).toBe('d');
    expect(out.subId5).toBe('e');
  });

  it('applies the fbclid mapping when fbclid is present', () => {
    const out = parseLandingParams(`${BASE}?fbclid=IwAR1abc`, '');
    expect(out.subId1).toBe('fb');
    expect(out.subId5).toBe('IwAR1abc');
  });

  it('direct sub_id values take precedence over click-id-derived values', () => {
    const out = parseLandingParams(`${BASE}?fbclid=xyz&sub_id1=manual`, '');
    expect(out.subId1).toBe('manual'); // direct wins over click-id-derived
    expect(out.subId5).toBe('xyz');     // no direct sub_id5; click-id fills it
  });

  it('truncates values longer than 255 chars', () => {
    const longValue = 'a'.repeat(300);
    const out = parseLandingParams(`${BASE}?utm_source=${longValue}`, '');
    expect(out.utmSource!.length).toBe(255);
    expect(out.utmSource).toBe('a'.repeat(255));
  });

  it('strips ASCII control characters from values', () => {
    const out = parseLandingParams(`${BASE}?utm_source=a%00b%0Ac%07d`, '');
    expect(out.utmSource).toBe('abcd');
  });

  it('decodes URL-encoded values', () => {
    const out = parseLandingParams(`${BASE}?utm_campaign=summer%20sale`, '');
    expect(out.utmCampaign).toBe('summer sale');
  });

  it('returns empty params for a URL with no query string', () => {
    const out = parseLandingParams(BASE, '');
    expect(out.utmSource).toBeUndefined();
    expect(out.subId1).toBeUndefined();
    expect(out.landingUrl).toBe(BASE);
  });

  it('ignores unknown query parameters', () => {
    const out = parseLandingParams(`${BASE}?utm_source=fb&unrelated=foo`, '');
    expect(out.utmSource).toBe('fb');
    expect(Object.keys(out)).not.toContain('unrelated');
  });

  it('CLICK_ID_REGISTRY has the fbclid entry', () => {
    expect(typeof CLICK_ID_REGISTRY.fbclid).toBe('function');
    const params: ParsedParams = {};
    CLICK_ID_REGISTRY.fbclid('test-value', params);
    expect(params.subId1).toBe('fb');
    expect(params.subId5).toBe('test-value');
  });

  it('truncates click-id values too', () => {
    const longValue = 'b'.repeat(300);
    const out = parseLandingParams(`${BASE}?fbclid=${longValue}`, '');
    expect(out.subId5!.length).toBe(255);
  });
});

import { readSessionIdFromUrl, SESSION_ID_PATTERN } from '../src/url-params';

describe('readSessionIdFromUrl', () => {
  it('returns the value of ?sessionid= when it passes the pattern', () => {
    expect(readSessionIdFromUrl('?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455')).toBe(
      '3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455',
    );
  });

  it('accepts a search string with no leading question mark', () => {
    expect(readSessionIdFromUrl('sessionid=abc.DEF-123_456')).toBe('abc.DEF-123_456');
  });

  it('accepts the legacy 26-digit numeric shape', () => {
    expect(readSessionIdFromUrl('?sessionid=12345678901234567890123456')).toBe(
      '12345678901234567890123456',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(readSessionIdFromUrl('?sessionid=%20abc123%20')).toBe('abc123');
  });

  it('returns null when the param is absent', () => {
    expect(readSessionIdFromUrl('?utm_source=fb')).toBeNull();
    expect(readSessionIdFromUrl('')).toBeNull();
  });

  it('returns null for a blank value', () => {
    expect(readSessionIdFromUrl('?sessionid=')).toBeNull();
    expect(readSessionIdFromUrl('?sessionid=%20%20')).toBeNull();
  });

  it('is case-sensitive on the key — ?SessionId= is ignored', () => {
    expect(readSessionIdFromUrl('?SessionId=abc123')).toBeNull();
    expect(readSessionIdFromUrl('?SESSIONID=abc123')).toBeNull();
  });

  it('rejects the near-miss camelCase key ?sessionId=', () => {
    expect(readSessionIdFromUrl('?sessionId=abc123')).toBeNull();
  });

  it('rejects the near-miss snake_case key ?session_id=', () => {
    expect(readSessionIdFromUrl('?session_id=abc123')).toBeNull();
  });

  it('rejects values carrying cookie-attribute delimiters', () => {
    expect(readSessionIdFromUrl('?sessionid=abc%3B%20Max-Age%3D0')).toBeNull();
    expect(readSessionIdFromUrl('?sessionid=a%2Cb')).toBeNull();
    expect(readSessionIdFromUrl('?sessionid=a%3Db')).toBeNull();
  });

  it('caps the value at 128 characters', () => {
    expect(readSessionIdFromUrl(`?sessionid=${'a'.repeat(128)}`)).toBe('a'.repeat(128));
    expect(readSessionIdFromUrl(`?sessionid=${'a'.repeat(129)}`)).toBeNull();
  });

  it('SESSION_ID_PATTERN rejects whitespace, CR/LF and the empty string', () => {
    expect(SESSION_ID_PATTERN.test('a b')).toBe(false);
    expect(SESSION_ID_PATTERN.test('a\nb')).toBe(false);
    expect(SESSION_ID_PATTERN.test('')).toBe(false);
    expect(SESSION_ID_PATTERN.test('3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455')).toBe(true);
  });
});
