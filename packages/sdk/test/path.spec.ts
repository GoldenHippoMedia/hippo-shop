import { describe, it, expect } from 'vitest';
import { getByPath } from '../src/path';

describe('getByPath', () => {
  it('returns the object when path is empty', () => {
    const o = { a: 1 };
    expect(getByPath(o, '')).toBe(o);
  });

  it('resolves shallow keys', () => {
    expect(getByPath({ a: 1 }, 'a')).toBe(1);
  });

  it('resolves nested keys with dots', () => {
    expect(getByPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('resolves numeric array indices', () => {
    expect(getByPath({ items: ['x', 'y', 'z'] }, 'items.1')).toBe('y');
  });

  it('resolves deeply mixed paths', () => {
    const o = {
      variants: { subscription: { standard: [{ price: 49.95 }, { price: 99.9 }] } },
    };
    expect(getByPath(o, 'variants.subscription.standard.0.price')).toBe(49.95);
    expect(getByPath(o, 'variants.subscription.standard.1.price')).toBe(99.9);
  });

  it('returns undefined when a segment is missing', () => {
    expect(getByPath({ a: 1 }, 'b')).toBeUndefined();
    expect(getByPath({ a: { b: 1 } }, 'a.c.d')).toBeUndefined();
  });

  it('returns undefined when descending into null/undefined', () => {
    expect(getByPath({ a: null }, 'a.b')).toBeUndefined();
    expect(getByPath({ a: undefined }, 'a.b')).toBeUndefined();
    expect(getByPath(null, 'anything')).toBeUndefined();
    expect(getByPath(undefined, 'anything')).toBeUndefined();
  });

  it('returns undefined for empty segments (double dots, trailing dot)', () => {
    expect(getByPath({ a: 1 }, 'a.')).toBeUndefined();
    expect(getByPath({ a: 1 }, 'a..b')).toBeUndefined();
    expect(getByPath({ a: 1 }, '.a')).toBeUndefined();
  });

  it('does not throw on prototype pollution attempts', () => {
    expect(getByPath({}, '__proto__.polluted')).toBeUndefined();
    // Setting via getByPath isn't supported; this is read-only by construction.
  });

  it('resolves arrays at the root', () => {
    expect(getByPath([10, 20, 30], '1')).toBe(20);
  });
});
