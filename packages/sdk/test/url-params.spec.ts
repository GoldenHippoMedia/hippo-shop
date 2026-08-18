import { describe, it, expect } from 'vitest';
import { parseLandingParams, CLICK_ID_MAP } from '../src/url-params';

const BASE = 'https://info.gundrymd.com/some-funnel';

describe('parseLandingParams', () => {
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

});

describe('parseLandingParams — inbound sub-id spelling', () => {
  it('captures the canonical subid1–5 spelling', () => {
    const out = parseLandingParams(
      `${BASE}?subid1=a&subid2=b&subid3=c&subid4=d&subid5=e`,
      '',
    );
    expect(out.subId1).toBe('a');
    expect(out.subId2).toBe('b');
    expect(out.subId3).toBe('c');
    expect(out.subId4).toBe('d');
    expect(out.subId5).toBe('e');
  });

  it('still captures the legacy sub_id1–5 spelling', () => {
    const out = parseLandingParams(`${BASE}?sub_id1=a&sub_id2=b&sub_id3=c&sub_id4=d&sub_id5=e`, '');
    expect(out.subId1).toBe('a');
    expect(out.subId5).toBe('e');
  });

  it('canonical subid1 wins when it appears after legacy sub_id1', () => {
    const out = parseLandingParams(`${BASE}?sub_id1=legacy&subid1=canonical`, '');
    expect(out.subId1).toBe('canonical');
  });

  it('canonical subid1 wins when it appears before legacy sub_id1', () => {
    const out = parseLandingParams(`${BASE}?subid1=canonical&sub_id1=legacy`, '');
    expect(out.subId1).toBe('canonical');
  });

  it('matches inbound sub-id keys case-insensitively', () => {
    const out = parseLandingParams(`${BASE}?SubID1=x&SUB_ID2=y`, '');
    expect(out.subId1).toBe('x');
    expect(out.subId2).toBe('y');
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

describe('parseLandingParams — canonical click-id table', () => {
  it('CLICK_ID_MAP is the canonical seven-row table, in precedence order', () => {
    expect(CLICK_ID_MAP.map((row) => row.incoming)).toEqual([
      'fbclid',
      'gclid',
      'ScCid',
      'qclid',
      'twclid',
      'ndclid',
      'wbraid',
    ]);
    expect(CLICK_ID_MAP.map((row) => row.target)).toEqual([
      'subId1',
      'subId1',
      'subId1',
      'subId1',
      'subId1',
      'subId1',
      'subId4',
    ]);
    expect(CLICK_ID_MAP.map((row) => row.platform)).toEqual([
      null,
      null,
      'snap',
      'quora',
      'twitter',
      'nextdoor',
      null,
    ]);
  });

  it('fbclid → raw fbclid + subId1, no subId5 marker', () => {
    const out = parseLandingParams(`${BASE}?fbclid=IwAR1abc`, '');
    expect(out.fbclid).toBe('IwAR1abc');
    expect(out.subId1).toBe('IwAR1abc');
    expect(out.subId5).toBeUndefined();
  });

  it('gclid → raw gclid + subId1, no subId5 marker', () => {
    const out = parseLandingParams(`${BASE}?gclid=Cj0KCQjw`, '');
    expect(out.gclid).toBe('Cj0KCQjw');
    expect(out.subId1).toBe('Cj0KCQjw');
    expect(out.subId5).toBeUndefined();
  });

  it("ScCid → raw scCid + subId1 + subId5='snap'", () => {
    const out = parseLandingParams(`${BASE}?ScCid=sc-123`, '');
    expect(out.scCid).toBe('sc-123');
    expect(out.subId1).toBe('sc-123');
    expect(out.subId5).toBe('snap');
  });

  it('matches click-id keys case-insensitively (sccid)', () => {
    const out = parseLandingParams(`${BASE}?sccid=sc-123`, '');
    expect(out.scCid).toBe('sc-123');
    expect(out.subId1).toBe('sc-123');
    expect(out.subId5).toBe('snap');
  });

  it("qclid → raw qclid + subId1 + subId5='quora'", () => {
    const out = parseLandingParams(`${BASE}?qclid=q-123`, '');
    expect(out.qclid).toBe('q-123');
    expect(out.subId1).toBe('q-123');
    expect(out.subId5).toBe('quora');
  });

  it("twclid → raw twclid + subId1 + subId5='twitter'", () => {
    const out = parseLandingParams(`${BASE}?twclid=tw-123`, '');
    expect(out.twclid).toBe('tw-123');
    expect(out.subId1).toBe('tw-123');
    expect(out.subId5).toBe('twitter');
  });

  it("ndclid → raw ndclid + subId1 + subId5='nextdoor'", () => {
    const out = parseLandingParams(`${BASE}?ndclid=nd-123`, '');
    expect(out.ndclid).toBe('nd-123');
    expect(out.subId1).toBe('nd-123');
    expect(out.subId5).toBe('nextdoor');
  });

  it('wbraid → raw wbraid + prefixed subId4, never subId1 or subId5', () => {
    const out = parseLandingParams(`${BASE}?wbraid=wb-123`, '');
    expect(out.wbraid).toBe('wb-123');
    expect(out.subId4).toBe('wbraid:wb-123');
    expect(out.subId1).toBeUndefined();
    expect(out.subId5).toBeUndefined();
  });

  it("fbclid + ScCid: fbclid wins subId1, ScCid still marks subId5='snap'", () => {
    const out = parseLandingParams(`${BASE}?fbclid=F&ScCid=S`, '');
    expect(out.subId1).toBe('F');
    expect(out.subId5).toBe('snap');
    expect(out.fbclid).toBe('F');
    expect(out.scCid).toBe('S');
  });

  it("ScCid + qclid: ScCid wins subId1 by table order, and its 'snap' marker wins — qclid's 'quora' must not overwrite it", () => {
    const out = parseLandingParams(`${BASE}?ScCid=S&qclid=Q`, '');
    expect(out.subId1).toBe('S');
    expect(out.subId5).toBe('snap');
    expect(out.scCid).toBe('S');
    expect(out.qclid).toBe('Q');
  });

  it('gclid + wbraid: distinct slots, no marker from either row', () => {
    const out = parseLandingParams(`${BASE}?gclid=G&wbraid=W`, '');
    expect(out.subId1).toBe('G');
    expect(out.subId4).toBe('wbraid:W');
    expect(out.subId5).toBeUndefined();
    expect(out.gclid).toBe('G');
    expect(out.wbraid).toBe('W');
  });

  it('an explicit subid1 beats a click-id for the slot but keeps the raw field', () => {
    const out = parseLandingParams(`${BASE}?fbclid=F&subid1=manual`, '');
    expect(out.subId1).toBe('manual');
    expect(out.fbclid).toBe('F');
  });

  it('an explicit subid4 beats wbraid, and an explicit subid5 beats a marker', () => {
    const out = parseLandingParams(`${BASE}?wbraid=W&subid4=manual&ScCid=S&subid5=mine`, '');
    expect(out.subId4).toBe('manual');
    expect(out.subId5).toBe('mine');
    expect(out.wbraid).toBe('W');
    expect(out.scCid).toBe('S');
  });

  it("strips [<>'\"`&] from the derived sub-id but not from the raw click-id field", () => {
    const out = parseLandingParams(`${BASE}?fbclid=a%3Cb%3E%27c%22d%60e%26f`, '');
    expect(out.fbclid).toBe('a<b>\'c"d`e&f');
    expect(out.subId1).toBe('abcdef');
  });

  it('skips an empty click-id entirely — no raw field, no slot, no marker', () => {
    const out = parseLandingParams(`${BASE}?fbclid=&ScCid=S`, '');
    expect('fbclid' in out).toBe(false);
    expect(out.subId1).toBe('S');
    expect(out.subId5).toBe('snap');
  });
});

describe('parseLandingParams — value hygiene', () => {
  it('does not truncate a long fbclid: raw field and subId1 survive intact', () => {
    const longValue = 'a'.repeat(300);
    const out = parseLandingParams(`${BASE}?fbclid=${longValue}`, '');
    expect(out.fbclid).toBe(longValue);
    expect(out.fbclid!.length).toBe(300);
    expect(out.subId1).toBe(longValue);
    expect(out.subId1!.length).toBe(300);
  });

  it('does not truncate long utm or explicit sub-id values', () => {
    const longCampaign = 'b'.repeat(400);
    const longSubId = 'c'.repeat(400);
    const out = parseLandingParams(
      `${BASE}?utm_campaign=${longCampaign}&subid2=${longSubId}`,
      '',
    );
    expect(out.utmCampaign!.length).toBe(400);
    expect(out.utmCampaign).toBe(longCampaign);
    expect(out.subId2!.length).toBe(400);
    expect(out.subId2).toBe(longSubId);
  });

  it('still strips ASCII control characters from raw click-ids and derived sub-ids', () => {
    const out = parseLandingParams(`${BASE}?utm_source=a%00b%0Ac%07d&fbclid=x%01y`, '');
    expect(out.utmSource).toBe('abcd');
    expect(out.fbclid).toBe('xy');
    expect(out.subId1).toBe('xy');
  });
});

describe('parseLandingParams — landing and referral URLs', () => {
  it('landingUrl is the href truncated at the first "?"', () => {
    const out = parseLandingParams(`${BASE}?utm_source=fb&fbclid=x`, '');
    expect(out.landingUrl).toBe(BASE);
  });

  it('an explicit ?landing_url= wins over the truncated href', () => {
    const explicit = 'https://ads.example.com/lp?q=1';
    const out = parseLandingParams(
      `${BASE}?landing_url=${encodeURIComponent(explicit)}`,
      '',
    );
    expect(out.landingUrl).toBe(explicit);
  });

  it('referralUrl comes from ?referral_url= only', () => {
    const out = parseLandingParams(
      `${BASE}?referral_url=${encodeURIComponent('https://www.facebook.com/')}`,
      'https://internal.example.com/previous-page',
    );
    expect(out.referralUrl).toBe('https://www.facebook.com/');
  });

  it('omits referralUrl when ?referral_url= is absent even though document.referrer is set', () => {
    const out = parseLandingParams(BASE, 'https://www.facebook.com/');
    expect('referralUrl' in out).toBe(false);
    expect(out.referralUrl).toBeUndefined();
  });

  it('omits referralUrl when ?referral_url= is present but empty', () => {
    const out = parseLandingParams(`${BASE}?referral_url=`, 'https://www.facebook.com/');
    expect('referralUrl' in out).toBe(false);
  });

  it('still yields a landingUrl for a malformed href', () => {
    const out = parseLandingParams('not-a-url?utm_source=fb', '');
    expect(out.landingUrl).toBe('not-a-url');
    expect(out.utmSource).toBeUndefined();
  });

  it('omits landingUrl entirely for an empty href', () => {
    const out = parseLandingParams('', '');
    expect('landingUrl' in out).toBe(false);
  });
});
