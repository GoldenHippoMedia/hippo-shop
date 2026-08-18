import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boot } from '../src/index';
import { _resetForTests } from '../src/session';

function installScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'src') s.src = v;
    else s.setAttribute(`data-${k}`, v);
  }
  document.head.appendChild(s);
  return s;
}

describe('boot()', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete (window as { gh?: unknown }).gh;
    vi.restoreAllMocks();
    _resetForTests();
  });

  it('attaches window.gh.data + bind + refresh + format when given valid config', () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    const attached = boot();
    expect(attached).toBe(true);
    expect(window.gh).toBeDefined();
    expect(typeof window.gh!.data!.funnel).toBe('function');
    expect(typeof window.gh!.data!.destination).toBe('function');
    expect(typeof window.gh!.data!.product).toBe('function');
    expect(typeof window.gh!.bind).toBe('function');
    expect(typeof window.gh!.refresh).toBe('function');
    expect(typeof window.gh!.format!.apply).toBe('function');
  });

  it('dispatches gh:data-ready on success', () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    const handler = vi.fn();
    window.addEventListener('gh:data-ready', handler);
    boot();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('refuses to attach with a bad key', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    installScript({
      key: 'not-a-key',
      brand: 'Gundry MD',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    const attached = boot();
    expect(attached).toBe(false);
    expect(window.gh?.data).toBeUndefined();
    expect(err).toHaveBeenCalled();
  });

  // `boot()` runs before `createLogger` exists, so its two failure reports cannot
  // use the guard in log.ts. It is also invoked unwrapped at IIFE top level, so an
  // escaping throw here surfaces as an uncaught error on a third-party page —
  // exactly what Goal 8 forbids. Both paths go through `bootError`.
  it('returns false rather than throwing when console.error throws (no script tag)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('privacy tool');
    });
    let attached: boolean | undefined;
    expect(() => {
      attached = boot();
    }).not.toThrow();
    expect(attached).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('returns false rather than throwing when console.error throws (bad config)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('privacy tool');
    });
    installScript({
      key: 'not-a-key',
      brand: 'Gundry MD',
      src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
    });
    let attached: boolean | undefined;
    expect(() => {
      attached = boot();
    }).not.toThrow();
    expect(attached).toBe(false);
    expect(window.gh?.data).toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('returns false rather than throwing when console is removed entirely', () => {
    const real = globalThis.console;
    // Deleted, not stubbed to undefined: only deletion exercises the
    // ReferenceError path a bare `console` identifier would take.
    // @ts-expect-error — deliberately removing a global to model a hostile host page
    delete globalThis.console;
    let attached: boolean | undefined;
    try {
      expect(() => {
        attached = boot();
      }).not.toThrow();
    } finally {
      globalThis.console = real;
    }
    expect(attached).toBe(false);
  });

  it('does not overwrite an existing window.gh.data', () => {
    const existing = { funnel: vi.fn(), destination: vi.fn(), product: vi.fn() };
    window.gh = { data: existing };
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const attached = boot();
    expect(attached).toBe(false);
    expect(window.gh!.data).toBe(existing);
    expect(warn).toHaveBeenCalled();
  });

  it('preserves other slots on window.gh', () => {
    (window as { gh?: { somethingElse?: string } }).gh = { somethingElse: 'kept' };
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    boot();
    expect((window.gh as { somethingElse?: string }).somethingElse).toBe('kept');
    expect(typeof window.gh!.data!.product).toBe('function');
  });
});

describe('cluster F wiring on boot', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete (window as { gh?: unknown }).gh;
    vi.restoreAllMocks();
    _resetForTests();
  });

  it('attaches window.gh.session and window.gh.checkoutUrl when booted', () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    boot();
    expect(typeof window.gh!.session!.id).toBe('function');
    expect(typeof window.gh!.session!.params).toBe('function');
    expect(typeof window.gh!.checkoutUrl).toBe('function');
  });

  it('gh.session.id() returns undefined before ensureSession resolves', () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v3/gh.js',
    });
    boot();
    // Synchronous immediately after boot — session resolution is async.
    expect(window.gh!.session!.id()).toBeUndefined();
  });

  it('installs gh.track as a stable async function', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const script = document.createElement('script');
    script.dataset['key'] = 'gh_pk_test_abc123';
    script.dataset['brand'] = 'Gundry MD';
    script.src = 'https://api-prod.goldenhippo.io/sdk/v4/gh.js';
    document.head.appendChild(script);
    delete (window as { gh?: unknown }).gh;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    expect(boot(document, window)).toBe(true);
    expect(typeof window.gh?.track).toBe('function');
    const captured = window.gh!.track!;
    await expect(captured('Page View')).resolves.toBeUndefined();
    // Stable identity: a captured reference is still the live function.
    expect(window.gh!.track).toBe(captured);
  });
});
