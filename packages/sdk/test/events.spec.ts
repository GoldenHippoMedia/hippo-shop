import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatVisitDate, detectUserAgent } from '../src/events';

/**
 * A hand-built stand-in for Date. `formatVisitDate` only calls local getters,
 * so this makes the assertion byte-exact regardless of the machine timezone —
 * which a real `new Date()` cannot be.
 */
function fixedDate(offsetMinutesWestOfUtc: number): Date {
  return {
    getFullYear: () => 2026,
    getMonth: () => 7, // August — getMonth is 0-indexed
    getDate: () => 18,
    getHours: () => 11,
    getMinutes: () => 4,
    getSeconds: () => 22,
    getMilliseconds: () => 318,
    getTimezoneOffset: () => offsetMinutesWestOfUtc,
  } as unknown as Date;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatVisitDate', () => {
  it('formats a fixed date at UTC-7 as local wall clock plus numeric offset', () => {
    // getTimezoneOffset() returns minutes WEST of UTC, so 420 === UTC-07:00.
    expect(formatVisitDate(fixedDate(420))).toBe('2026-08-18T11:04:22.318-07:00');
  });

  it('emits a + sign and a non-zero minutes field east of UTC', () => {
    // -330 === UTC+05:30 (India) — exercises the sign flip and the mins pad.
    expect(formatVisitDate(fixedDate(-330))).toBe('2026-08-18T11:04:22.318+05:30');
  });

  it('emits +00:00 (never Z) at UTC', () => {
    const out = formatVisitDate(fixedDate(0));
    expect(out).toBe('2026-08-18T11:04:22.318+00:00');
    expect(out).not.toContain('Z');
  });

  it('is not toISOString: no Z, and shape is ISO8601 + offset + ms', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(420);
    const out = formatVisitDate(new Date());
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(out.endsWith('-07:00')).toBe(true);
    expect(out).not.toContain('Z');
  });

  it('zero-pads month, day, time components, and milliseconds to 3 digits', () => {
    const jan = {
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 3,
      getHours: () => 4,
      getMinutes: () => 5,
      getSeconds: () => 6,
      getMilliseconds: () => 7,
      getTimezoneOffset: () => 480,
    } as unknown as Date;
    expect(formatVisitDate(jan)).toBe('2026-01-03T04:05:06.007-08:00');
  });

  it('defaults to now when called with no argument', () => {
    expect(formatVisitDate()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
  });
});

const UA_CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51';
const UA_FIREFOX_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
const UA_CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const UA_OPERA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0';
const UA_IE11 =
  'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko';

describe('detectUserAgent', () => {
  it('Chrome on macOS desktop', () => {
    expect(detectUserAgent(UA_CHROME_MAC)).toEqual({
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
    });
  });

  it('Safari on iPhone reports iOS and Mobile, not Mac OS', () => {
    expect(detectUserAgent(UA_SAFARI_IPHONE)).toEqual({
      browser: 'Safari',
      os: 'iOS',
      device: 'Mobile',
    });
  });

  it('Edge on Windows wins over the Chrome token', () => {
    expect(detectUserAgent(UA_EDGE_WINDOWS)).toEqual({
      browser: 'Microsoft Edge',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('Firefox on Linux', () => {
    expect(detectUserAgent(UA_FIREFOX_LINUX)).toEqual({
      browser: 'Firefox',
      os: 'Linux',
      device: 'Desktop',
    });
  });

  it('Chrome on Android reports Android, not Linux, and Mobile', () => {
    expect(detectUserAgent(UA_CHROME_ANDROID)).toEqual({
      browser: 'Chrome',
      os: 'Android',
      device: 'Mobile',
    });
  });

  it('Opera wins over the Chrome token', () => {
    expect(detectUserAgent(UA_OPERA_WINDOWS)).toEqual({
      browser: 'Opera',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('Internet Explorer via Trident', () => {
    expect(detectUserAgent(UA_IE11)).toEqual({
      browser: 'Internet Explorer',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('empty UA returns the reference SSR default', () => {
    expect(detectUserAgent('')).toEqual({
      browser: 'Unknown',
      os: null,
      device: 'Desktop',
    });
  });
});
