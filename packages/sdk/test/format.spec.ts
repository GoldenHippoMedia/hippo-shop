import { describe, it, expect } from 'vitest';
import { FormatRegistry, builtinFormatters } from '../src/format';

describe('builtinFormatters', () => {
  it('currency formats USD with two decimals', () => {
    const out = builtinFormatters['currency']!(49.95, 'USD', 'en-US');
    expect(out).toBe('$49.95');
  });

  it('currency falls back to String for non-numeric input', () => {
    expect(builtinFormatters['currency']!('not a number')).toBe('not a number');
    expect(builtinFormatters['currency']!(null)).toBe('');
  });

  it('number applies fixed decimals when requested', () => {
    expect(builtinFormatters['number']!(1234.5, '2', 'en-US')).toBe('1,234.50');
    expect(builtinFormatters['number']!(1234.5, '0', 'en-US')).toBe('1,235');
  });

  it('percent treats the value as a fraction', () => {
    expect(builtinFormatters['percent']!(0.25, '0', 'en-US')).toBe('25%');
    expect(builtinFormatters['percent']!(0.1234, '1', 'en-US')).toBe('12.3%');
  });

  it('uppercase / lowercase handle non-strings', () => {
    expect(builtinFormatters['uppercase']!('hello')).toBe('HELLO');
    expect(builtinFormatters['lowercase']!('HELLO')).toBe('hello');
    expect(builtinFormatters['uppercase']!(null)).toBe('');
  });

  it('bool renders custom truthy/falsy strings', () => {
    expect(builtinFormatters['bool']!(true, 'Yes', 'No')).toBe('Yes');
    expect(builtinFormatters['bool']!(false, 'Yes', 'No')).toBe('No');
    expect(builtinFormatters['bool']!(0, 'In stock', 'Out')).toBe('Out');
  });

  it('join concatenates arrays with a separator', () => {
    expect(builtinFormatters['join']!([1, 2, 3])).toBe('1, 2, 3');
    expect(builtinFormatters['join']!(['a', 'b'], ' - ')).toBe('a - b');
    expect(builtinFormatters['join']!('not an array')).toBe('not an array');
  });
});

describe('FormatRegistry', () => {
  it('apply() with no spec returns String(value)', () => {
    const r = new FormatRegistry();
    expect(r.apply(123, null)).toBe('123');
    expect(r.apply(null, null)).toBe('');
  });

  it('apply() routes "currency:USD" to the currency formatter', () => {
    const r = new FormatRegistry();
    expect(r.apply(49.95, 'currency:USD:en-US')).toBe('$49.95');
  });

  it('apply() falls back to String when the formatter is unknown', () => {
    const r = new FormatRegistry();
    expect(r.apply(7, 'unknown-formatter')).toBe('7');
  });

  it('register() adds a custom formatter and apply() uses it', () => {
    const r = new FormatRegistry();
    r.register('exclaim', (v) => `${v}!`);
    expect(r.apply('hi', 'exclaim')).toBe('hi!');
  });

  it('register() can pass args through', () => {
    const r = new FormatRegistry();
    r.register('repeat', (v, n) => String(v).repeat(Number(n)));
    expect(r.apply('a', 'repeat:3')).toBe('aaa');
  });

  it('apply() never throws even if a formatter throws', () => {
    const r = new FormatRegistry();
    r.register('boom', () => {
      throw new Error('fail');
    });
    expect(r.apply('x', 'boom')).toBe('x');
  });

  it('typed shortcuts exist on the registry', () => {
    const r = new FormatRegistry();
    expect(r.currency(49.95, 'USD', 'en-US')).toBe('$49.95');
    expect(r.number(1.5, 0, 'en-US')).toBe('2');
    expect(r.percent(0.5, 0, 'en-US')).toBe('50%');
  });
});
