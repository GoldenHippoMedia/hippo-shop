import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatVisitDate } from '../src/events';

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
