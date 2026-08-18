import { describe, it, expect } from 'vitest';
import { pruneEmpty, buildSessionPostBody } from '../src/session';
import type { ParsedParams } from '../src/url-params';

describe('pruneEmpty', () => {
  it('keeps non-empty string values verbatim', () => {
    expect(pruneEmpty({ a: 'x', b: 'y z' })).toEqual({ a: 'x', b: 'y z' });
  });

  it('drops undefined values', () => {
    expect(pruneEmpty({ a: 'x', b: undefined })).toEqual({ a: 'x' });
  });

  it('drops null values', () => {
    expect(pruneEmpty({ a: 'x', b: null })).toEqual({ a: 'x' });
  });

  it('drops empty-string values', () => {
    expect(pruneEmpty({ a: 'x', b: '' })).toEqual({ a: 'x' });
  });

  it('drops whitespace-only values', () => {
    expect(pruneEmpty({ a: 'x', b: '   ', c: '\t\n' })).toEqual({ a: 'x' });
  });

  it('never returns a key whose value is an empty string', () => {
    const out = pruneEmpty({ utmSource: '', utmMedium: 'cpc' });
    expect(Object.values(out)).not.toContain('');
    expect('utmSource' in out).toBe(false);
  });
});

describe('buildSessionPostBody', () => {
  const params: ParsedParams = {
    landingUrl: 'https://sf.gundrymd.com/offer',
    utmSource: 'fb',
    utmMedium: 'cpc',
  };

  it('nests sessionId inside affParameters', () => {
    const body = buildSessionPostBody(params, 'e2b9f0c4-1111-4222-8333-444455556666');
    expect(body.affParameters.sessionId).toBe('e2b9f0c4-1111-4222-8333-444455556666');
  });

  it('does not put sessionId at the top level of the body', () => {
    const body = buildSessionPostBody(params, 'e2b9f0c4-1111-4222-8333-444455556666');
    expect('sessionId' in body).toBe(false);
    expect(Object.keys(body)).toEqual(['affParameters']);
  });

  it('carries the attribution params alongside the session id', () => {
    const body = buildSessionPostBody(params, 'abc');
    expect(body.affParameters).toEqual({
      landingUrl: 'https://sf.gundrymd.com/offer',
      utmSource: 'fb',
      utmMedium: 'cpc',
      sessionId: 'abc',
    });
  });

  it('omits sessionId entirely when it is absent — never sends an empty string', () => {
    const body = buildSessionPostBody(params, '');
    expect('sessionId' in body.affParameters).toBe(false);
    expect(body.affParameters).toEqual({
      landingUrl: 'https://sf.gundrymd.com/offer',
      utmSource: 'fb',
      utmMedium: 'cpc',
    });
  });

  it('omits sessionId when it is whitespace only', () => {
    const body = buildSessionPostBody(params, '  ');
    expect('sessionId' in body.affParameters).toBe(false);
  });

  it('prunes empty-string attribution params so a stored value is never blanked', () => {
    const body = buildSessionPostBody({ utmSource: '', utmCampaign: 'summer' }, 'abc');
    expect('utmSource' in body.affParameters).toBe(false);
    expect(body.affParameters).toEqual({ utmCampaign: 'summer', sessionId: 'abc' });
  });
});
