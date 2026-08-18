import { describe, it, expect, beforeEach, vi } from 'vitest';
import { composeCheckoutUrl } from '../src/checkout';
import { GhError } from '../src/errors';
import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from '../src/config';
import type { SessionState } from '../src/session';

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Test',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
    ...overrides,
  };
}

function makeDestination(
  pricing: Partial<HippoShopDestinationDTO['pricing']> = {},
  root: Partial<HippoShopDestinationDTO> = {},
): HippoShopDestinationDTO {
  return {
    id: 'a0X0000000001AAA',
    slug: 'bio3-3p-sub',
    name: 'Bio Complete 3 — 3-pack subscription',
    description: null,
    funnelSlug: 'fnl',
    funnelId: 'a0Y0000000002BBB',
    url: null,
    pricing: {
      familyOrBundleId: 'fam1',
      orderFormId: 'OF_123',
      sku: 'BIO3-3P-SUB',
      packageQuantity: 3,
      purchaseType: 'subscription',
      frequency: { months: 1, label: 'Monthly' } as never,
      price: { amount: 49.95, currency: 'USD', savings: null },
      rebillPrice: { amount: 49.95, currency: 'USD', savings: null },
      outOfStock: false,
      restrictedCountryCodes: [],
      shipping: { domestic: 0, international: 0, freeShippingThreshold: null },
      bumpOffers: [],
      checkoutOverrideUrl: null,
      ...pricing,
    },
    ...root,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: '174710238129',
    adopted: false,
    params: {},
    ...overrides,
  };
}

import { resolveDestinationBase } from '../src/checkout';

describe('resolveDestinationBase', () => {
  it('prefers pricing.checkoutOverrideUrl over destination.url and config.checkoutBase', () => {
    const dest = makeDestination(
      { checkoutOverrideUrl: 'https://override.example.com/buy' },
      { url: 'https://dest.gundrymd.com/offer' },
    );
    expect(resolveDestinationBase(dest, makeConfig())).toBe('https://override.example.com/buy');
  });

  it('falls back to destination.url when there is no pricing override', () => {
    const dest = makeDestination({ checkoutOverrideUrl: null }, { url: 'https://dest.gundrymd.com/offer' });
    expect(resolveDestinationBase(dest, makeConfig())).toBe('https://dest.gundrymd.com/offer');
  });

  it('falls back to config.checkoutBase when the destination has no url', () => {
    const dest = makeDestination({ checkoutOverrideUrl: null }, { url: null });
    expect(resolveDestinationBase(dest, makeConfig())).toBe('https://checkout.gundrymd.com');
  });

  it('throws GhError("config") only when all three sources are absent', () => {
    const dest = makeDestination({ checkoutOverrideUrl: null }, { url: null });
    const config = makeConfig({ checkoutBase: null });
    expect(() => resolveDestinationBase(dest, config)).toThrow(GhError);
    try {
      resolveDestinationBase(dest, config);
    } catch (err) {
      expect((err as GhError).code).toBe('config');
    }
  });
});

describe('composeCheckoutUrl — destination url', () => {
  it('composes against destination.url when there is no pricing override', () => {
    const dest = makeDestination({ checkoutOverrideUrl: null }, { url: 'https://dest.gundrymd.com/offer' });
    const url = new URL(composeCheckoutUrl(dest, makeConfig(), makeSession()));
    expect(url.origin + url.pathname).toBe('https://dest.gundrymd.com/offer');
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
  });
});

function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      hostname: 'sf.gundrymd.com',
      protocol: 'https:',
      search,
      href: `https://sf.gundrymd.com/offer${search}`,
    },
    writable: true,
  });
}

const FULL_PARAMS = {
  landingUrl: 'https://sf.gundrymd.com/offer',
  referralUrl: 'https://www.facebook.com/',
  salesFunnel: 'Funnel',
  utmSource: 'fb',
  utmMedium: 'cpc',
  utmCampaign: 'summer',
  utmCampaignId: '12345',
  utmContent: 'ad1',
  utmTerm: 'kw',
  utmChat: 'chat1',
  utmAction: 'act1',
  offId: 'OFF1',
  affId: 'AFF1',
  subId1: 's1',
  subId2: 's2',
  subId3: 's3',
  subId4: 's4',
  subId5: 's5',
  fbclid: 'F',
  gclid: 'G',
  scCid: 'S',
  qclid: 'Q',
  twclid: 'T',
  ndclid: 'N',
  wbraid: 'W',
};

describe('composeCheckoutUrl', () => {
  beforeEach(() => {
    setSearch('');
  });

  it('uses the brand-level checkoutBase when no DTO override and no destination url', () => {
    const url = composeCheckoutUrl(makeDestination(), makeConfig(), makeSession());
    expect(url).toMatch(/^https:\/\/checkout\.gundrymd\.com\//);
  });

  it('uses the pricing override when present, ignoring the brand default', () => {
    const dest = makeDestination({ checkoutOverrideUrl: 'https://special.example.com/buy' });
    const url = composeCheckoutUrl(dest, makeConfig(), makeSession());
    expect(url).toMatch(/^https:\/\/special\.example\.com\/buy/);
    expect(url).not.toContain('checkout.gundrymd.com');
  });

  it('emits sessionid, not session_id', () => {
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
    expect(url.searchParams.get('sessionid')).toBe('174710238129');
    expect(url.searchParams.has('session_id')).toBe(false);
  });

  it('emits subidN, not sub_idN', () => {
    const session = makeSession({ params: { subId1: 'a', subId4: 'wbraid:W', subId5: 'snap' } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.get('subid1')).toBe('a');
    expect(url.searchParams.get('subid4')).toBe('wbraid:W');
    expect(url.searchParams.get('subid5')).toBe('snap');
    expect(url.searchParams.has('sub_id1')).toBe(false);
    expect(url.searchParams.has('sub_id4')).toBe(false);
    expect(url.searchParams.has('sub_id5')).toBe(false);
  });

  it('always appends order_form_id', () => {
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
  });

  it('emits the full param set in the canonical D6 order', () => {
    const session = makeSession({ params: { ...FULL_PARAMS } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(Array.from(url.searchParams.keys())).toEqual([
      'order_form_id',
      'sessionid',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_campaign_id',
      'utm_content',
      'utm_term',
      'utm_chat',
      'utm_action',
      'off_id',
      'aff_id',
      'subid1',
      'subid2',
      'subid3',
      'subid4',
      'subid5',
      'landing_url',
      'referral_url',
      'sales_funnel',
      'fbclid',
      'gclid',
      'ScCid',
      'qclid',
      'twclid',
      'ndclid',
      'wbraid',
    ]);
  });

  it('emits the seven raw click-ids with their canonical spellings', () => {
    const session = makeSession({ params: { ...FULL_PARAMS } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.get('fbclid')).toBe('F');
    expect(url.searchParams.get('gclid')).toBe('G');
    expect(url.searchParams.get('ScCid')).toBe('S');
    expect(url.searchParams.get('qclid')).toBe('Q');
    expect(url.searchParams.get('twclid')).toBe('T');
    expect(url.searchParams.get('ndclid')).toBe('N');
    expect(url.searchParams.get('wbraid')).toBe('W');
  });

  it('emits landing_url, referral_url and sales_funnel from params', () => {
    const session = makeSession({
      params: {
        landingUrl: 'https://sf.gundrymd.com/offer',
        referralUrl: 'https://www.facebook.com/',
        salesFunnel: 'Funnel',
      },
    });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.get('landing_url')).toBe('https://sf.gundrymd.com/offer');
    expect(url.searchParams.get('referral_url')).toBe('https://www.facebook.com/');
    expect(url.searchParams.get('sales_funnel')).toBe('Funnel');
  });

  it('does not truncate long values', () => {
    const long = 'x'.repeat(400);
    const session = makeSession({ params: { fbclid: long } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.get('fbclid')).toBe(long);
  });

  it('omits keys whose params values are empty/undefined', () => {
    const session = makeSession({ params: { utmSource: 'fb' } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.has('utm_source')).toBe(true);
    expect(url.searchParams.has('utm_medium')).toBe(false);
    expect(url.searchParams.has('subid1')).toBe(false);
  });

  it('omits sessionid when the session id is empty', () => {
    const url = new URL(
      composeCheckoutUrl(makeDestination(), makeConfig(), makeSession({ sessionId: '' })),
    );
    expect(url.searchParams.has('sessionid')).toBe(false);
  });

  it('preserves a pre-existing query string on the base URL', () => {
    const config = makeConfig({ checkoutBase: 'https://checkout.gundrymd.com/?fbp=existing' });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
    expect(url.searchParams.get('fbp')).toBe('existing');
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
  });

  it('author-supplied params on the base URL win over SDK additions', () => {
    const config = makeConfig({
      checkoutBase:
        'https://checkout.gundrymd.com/?sessionid=author-wins&subid1=author-sub&utm_source=author-src',
    });
    const session = makeSession({ params: { subId1: 'sdk-sub', utmSource: 'sdk-src' } });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, session));
    expect(url.searchParams.get('sessionid')).toBe('author-wins');
    expect(url.searchParams.get('subid1')).toBe('author-sub');
    expect(url.searchParams.get('utm_source')).toBe('author-src');
    expect(url.searchParams.getAll('sessionid')).toHaveLength(1);
  });

  it('forwards origdsidOrig and origsplitTestingFunnelIdOrig from the current page URL, last', () => {
    setSearch('?origdsidOrig=DS1&origsplitTestingFunnelIdOrig=ST1');
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
    expect(url.searchParams.get('origdsidOrig')).toBe('DS1');
    expect(url.searchParams.get('origsplitTestingFunnelIdOrig')).toBe('ST1');
    const keys = Array.from(url.searchParams.keys());
    expect(keys.slice(-2)).toEqual(['origdsidOrig', 'origsplitTestingFunnelIdOrig']);
  });

  it('omits the orig params when the current page URL has none', () => {
    setSearch('?utm_source=fb');
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
    expect(url.searchParams.has('origdsidOrig')).toBe(false);
    expect(url.searchParams.has('origsplitTestingFunnelIdOrig')).toBe(false);
  });

  it('does not overwrite an author-supplied origdsidOrig on the base URL', () => {
    setSearch('?origdsidOrig=from-page');
    const config = makeConfig({ checkoutBase: 'https://checkout.gundrymd.com/?origdsidOrig=on-base' });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
    expect(url.searchParams.get('origdsidOrig')).toBe('on-base');
  });
});

import { applyCheckoutBindings, type CheckoutBindingsOptions } from '../src/checkout';

describe('applyCheckoutBindings', () => {
  function setupDom(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body;
  }

  function makeOptions(overrides: Partial<CheckoutBindingsOptions> = {}): CheckoutBindingsOptions {
    return {
      config: makeConfig(),
      getSession: () => makeSession(),
      sessionPromise: Promise.resolve(),
      getDestination: () => makeDestination(),
      ensureDestination: () => Promise.resolve(),
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
      ...overrides,
    };
  }

  beforeEach(() => {
    setSearch('');
  });

  it('writes href on <a data-gh-checkout> when destination and session are available', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="#">Buy</a>');
    applyCheckoutBindings(document, makeOptions());
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toMatch(/^https:\/\/checkout\.gundrymd\.com\/\?/);
    expect(a.getAttribute('href')).toContain('order_form_id=OF_123');
    expect(a.getAttribute('href')).toContain('sessionid=174710238129');
  });

  it('leaves href="#" while the session is unresolved — never a params-less URL', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
    applyCheckoutBindings(document, makeOptions({ getSession: () => null }));
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toBe('#');
    expect(a.getAttribute('href')).not.toContain('order_form_id');
  });

  it('does not bind a click handler on non-<a> elements while the session is unresolved', () => {
    setupDom('<button data-gh-checkout="bio3-3p-sub">Buy</button>');
    applyCheckoutBindings(document, makeOptions({ getSession: () => null }));
    const button = document.querySelector<HTMLButtonElement>('button[data-gh-checkout]')!;
    expect(button.dataset['ghCheckoutBound']).toBeUndefined();
    expect(button.dataset['ghCheckoutUrl']).toBeUndefined();
  });

  it('fills the href in on a later pass once the session has resolved', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
    let session: ReturnType<typeof makeSession> | null = null;
    const opts = makeOptions({ getSession: () => session });

    applyCheckoutBindings(document, opts);
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toBe('#');

    session = makeSession({ sessionId: '999999999999' });
    applyCheckoutBindings(document, opts);
    expect(a.getAttribute('href')).toContain('sessionid=999999999999');
  });

  it('reads the session live on every pass rather than closing over a snapshot', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="#">Buy</a>');
    let sessionId = '111111111111';
    const opts = makeOptions({ getSession: () => makeSession({ sessionId }) });

    applyCheckoutBindings(document, opts);
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toContain('sessionid=111111111111');

    sessionId = '222222222222';
    applyCheckoutBindings(document, opts);
    expect(a.getAttribute('href')).toContain('sessionid=222222222222');
  });

  it('sets href to "#" and triggers ensureDestination when the destination is not yet loaded', () => {
    setupDom('<a data-gh-checkout="not-yet-loaded" href="">Buy</a>');
    const ensure = vi.fn().mockResolvedValue(undefined);
    applyCheckoutBindings(
      document,
      makeOptions({ getDestination: () => null, ensureDestination: ensure }),
    );
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toBe('#');
    expect(ensure).toHaveBeenCalledWith('not-yet-loaded');
  });

  it('attaches a click handler on non-<a> elements once the session is resolved', () => {
    setupDom('<button data-gh-checkout="bio3-3p-sub">Buy</button>');
    applyCheckoutBindings(document, makeOptions());
    const button = document.querySelector<HTMLButtonElement>('button[data-gh-checkout]')!;
    expect(button.dataset['ghCheckoutBound']).toBe('1');
    expect(button.dataset['ghCheckoutUrl']).toContain('sessionid=174710238129');
  });

  it('logs a warning and sets href="#" when no URL resolves for the destination', () => {
    setupDom('<a data-gh-checkout="bio3-3p-sub" href="">Buy</a>');
    const warn = vi.fn();
    applyCheckoutBindings(
      document,
      makeOptions({
        config: makeConfig({ checkoutBase: null }),
        getDestination: () => makeDestination({ checkoutOverrideUrl: null }, { url: null }),
        logger: { debug: () => {}, warn, error: () => {} },
      }),
    );
    const a = document.querySelector<HTMLAnchorElement>('a[data-gh-checkout]')!;
    expect(a.getAttribute('href')).toBe('#');
    expect(warn).toHaveBeenCalled();
  });
});

import { makeCheckoutUrlFn } from '../src/checkout';

describe('makeCheckoutUrlFn', () => {
  beforeEach(() => {
    setSearch('');
  });

  it('returns a promise, not a string', () => {
    const fn = makeCheckoutUrlFn({
      config: makeConfig(),
      getSession: () => makeSession(),
      sessionPromise: Promise.resolve(),
      getDestination: () => makeDestination(),
      ensureDestination: () => Promise.resolve(),
    });
    const result = fn('bio3-3p-sub');
    expect(result).toBeInstanceOf(Promise);
    return expect(result).resolves.toContain('sessionid=174710238129');
  });

  it('resolves after an initially-cold cache instead of throwing', async () => {
    let cached: ReturnType<typeof makeDestination> | null = null;
    const ensure = vi.fn().mockImplementation(async () => {
      cached = makeDestination();
    });
    const fn = makeCheckoutUrlFn({
      config: makeConfig(),
      getSession: () => makeSession(),
      sessionPromise: Promise.resolve(),
      getDestination: () => cached,
      ensureDestination: ensure,
    });

    const url = await fn('bio3-3p-sub');

    expect(ensure).toHaveBeenCalledWith('bio3-3p-sub');
    expect(url).toContain('order_form_id=OF_123');
    expect(url).toContain('sessionid=174710238129');
  });

  it('awaits sessionPromise before composing, so the URL is never params-less', async () => {
    let session: ReturnType<typeof makeSession> | null = null;
    const sessionPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        session = makeSession({ sessionId: 'late-resolved-id', params: { utmSource: 'fb' } });
        resolve();
      }, 5);
    });
    const fn = makeCheckoutUrlFn({
      config: makeConfig(),
      getSession: () => session,
      sessionPromise,
      getDestination: () => makeDestination(),
      ensureDestination: () => Promise.resolve(),
    });

    const url = await fn('bio3-3p-sub');

    expect(url).toContain('sessionid=late-resolved-id');
    expect(url).toContain('utm_source=fb');
  });

  it('still resolves when sessionPromise rejects', async () => {
    const fn = makeCheckoutUrlFn({
      config: makeConfig(),
      getSession: () => makeSession(),
      sessionPromise: Promise.reject(new Error('session blew up')),
      getDestination: () => makeDestination(),
      ensureDestination: () => Promise.resolve(),
    });
    await expect(fn('bio3-3p-sub')).resolves.toContain('order_form_id=OF_123');
  });

  it('rejects with GhError("not_found") when the destination cannot be loaded at all', async () => {
    const fn = makeCheckoutUrlFn({
      config: makeConfig(),
      getSession: () => makeSession(),
      sessionPromise: Promise.resolve(),
      getDestination: () => null,
      ensureDestination: () => Promise.resolve(),
    });
    await expect(fn('nope')).rejects.toThrow(GhError);
    await expect(fn('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});
