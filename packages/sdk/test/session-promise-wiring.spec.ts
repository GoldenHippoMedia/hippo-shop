import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boot } from '../src/index';
import { GhRuntime } from '../src/runtime';
import { GhDataClient } from '../src/client';
import { createLogger } from '../src/log';
import { applyCheckoutBindings, type CheckoutBindingsOptions } from '../src/checkout';
import { _resetForTests } from '../src/session';
import type { GhConfig } from '../src/config';

// Partial mock: the real implementation still runs on every call, but each
// call is recorded so the options object handed to it can be inspected.
vi.mock('../src/checkout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/checkout')>();
  return { ...actual, applyCheckoutBindings: vi.fn(actual.applyCheckoutBindings) };
});

const CONFIG: GhConfig = {
  key: 'gh_pk_internal_test_abc123',
  brand: 'Gundry MD',
  debug: false,
  apiBaseUrl: 'https://api-prod.goldenhippo.io',
  checkoutBase: 'https://checkout.gundrymd.com',
  cookieDomain: null,
  brandToken: null,
  sessionEnabled: true,
  checkoutSessionId: true,
  eventsEnabled: true,
  sessionUrlFirst: false,
};

const DESTINATION = {
  id: 'a0D0m000002Dst1EAC',
  slug: 'bio3-3p-sub',
  name: 'Bio Complete 3 — 3-pack subscription',
  description: null,
  funnelSlug: 'bio-complete-3-main',
  funnelId: 'a0F0m000002Fnl1EAC',
  url: null,
  pricing: {
    familyOrBundleId: 'fam1',
    orderFormId: 'OF_123',
    sku: 'BIO3-3P-SUB',
    packageQuantity: 3,
    purchaseType: 'subscription',
    frequency: null,
    price: { amount: 49.95, currency: 'USD', savings: null },
    rebillPrice: { amount: 49.95, currency: 'USD', savings: null },
    outOfStock: false,
    restrictedCountryCodes: [],
    shipping: { domestic: 0, international: 0, freeShippingThreshold: null },
    bumpOffers: [],
    checkoutOverrideUrl: null,
  },
};

function installScript(attrs: Record<string, string>): void {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'src') s.src = v;
    else s.setAttribute(`data-${k}`, v);
  }
  document.head.appendChild(s);
}

function lastBindingOptions(): CheckoutBindingsOptions {
  const calls = vi.mocked(applyCheckoutBindings).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)![1];
}

describe('GhRuntime.setSessionPromise', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(applyCheckoutBindings).mockClear();
  });

  it('binds with a settled promise until boot hands one over, then with the real one', async () => {
    const runtime = new GhRuntime({
      logger: createLogger(false),
      client: new GhDataClient(CONFIG, createLogger(false)),
      config: CONFIG,
    });

    // Direct-construction path (tests, embedders): nothing is pending, so an
    // already-settled promise is the honest default.
    await runtime.bind(document);
    const beforeHandover = lastBindingOptions().sessionPromise;
    expect(beforeHandover).toBeInstanceOf(Promise);
    await expect(beforeHandover).resolves.toBeUndefined();

    const sessionPromise = Promise.resolve('resolved-session');
    runtime.setSessionPromise(sessionPromise);
    await runtime.bind(document);

    expect(lastBindingOptions().sessionPromise).toBe(sessionPromise);
  });
});

describe('boot hands its session promise to the runtime', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as { gh?: unknown }).gh;
    vi.restoreAllMocks();
    vi.mocked(applyCheckoutBindings).mockClear();
    _resetForTests();

    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        href: 'https://info.gundrymd.com/lp?sessionid=abc123&utm_source=fb',
        search: '?sessionid=abc123&utm_source=fb',
        hostname: 'info.gundrymd.com',
        protocol: 'https:',
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/public/v1/destination/')) {
        return Promise.resolve(new Response(JSON.stringify(DESTINATION), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
  });

  it('binds checkout links with the very promise exposed as __sessionPromise', async () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
    });
    expect(boot()).toBe(true);

    // installAutoBind schedules the first bind pass with setTimeout(…, 0).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lastBindingOptions().sessionPromise).toBe(window.gh!.__sessionPromise);
  });

  it('a captured gh.checkoutUrl reference composes an attributed URL after the session resolves', async () => {
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
    });
    boot();

    // Captured in the pre-resolve window — exactly what a GTM variable or a
    // React prop does. Cluster F stranded this reference on a stub closure.
    const captured = window.gh!.checkoutUrl!;
    await window.gh!.__sessionPromise;

    const url = new URL(await captured('bio3-3p-sub'));
    expect(url.searchParams.get('sessionid')).toBe('abc123');
    expect(url.searchParams.get('utm_source')).toBe('fb');
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
    // One identity for the life of the page: boot must never reassign the slot.
    expect(window.gh!.checkoutUrl).toBe(captured);
  });
});
