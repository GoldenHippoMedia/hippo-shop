import { describe, it, expect } from 'vitest';
import { RequestCache } from '../src/cache';

describe('RequestCache', () => {
  it('returns the same promise for repeated keys', () => {
    const cache = new RequestCache();
    const p = Promise.resolve(1);
    cache.set('a', p);
    expect(cache.get<number>('a')).toBe(p);
  });

  it('evicts on rejection so the next call retries', async () => {
    const cache = new RequestCache();
    const failing = Promise.reject(new Error('boom'));
    cache.set('a', failing);
    await expect(failing).rejects.toThrow('boom');
    // Microtask to let the .catch handler run.
    await Promise.resolve();
    expect(cache.get('a')).toBeUndefined();
  });

  it('does not evict on success', async () => {
    const cache = new RequestCache();
    const ok = Promise.resolve('ok');
    cache.set('a', ok);
    await ok;
    expect(cache.get<string>('a')).toBe(ok);
  });

  it('clear() empties the cache', () => {
    const cache = new RequestCache();
    cache.set('a', Promise.resolve(1));
    cache.set('b', Promise.resolve(2));
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
