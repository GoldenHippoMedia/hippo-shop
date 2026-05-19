import { describe, it, expect } from 'vitest';
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
  overrides: Partial<HippoShopDestinationDTO['pricing']> = {},
): HippoShopDestinationDTO {
  return {
    slug: 'bio3-3p-sub',
    name: 'Bio Complete 3 — 3-pack subscription',
    description: null,
    funnelSlug: 'fnl',
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
      ...overrides,
    },
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: '174710238129',
    hasConnectSid: true,
    params: null,
    ...overrides,
  };
}

describe('composeCheckoutUrl', () => {
  it('uses the brand-level checkoutBase when no DTO override', () => {
    const url = composeCheckoutUrl(makeDestination(), makeConfig(), makeSession());
    expect(url).toMatch(/^https:\/\/checkout\.gundrymd\.com\//);
  });

  it('uses the DTO override when present, ignoring the brand default', () => {
    const dest = makeDestination({ checkoutOverrideUrl: 'https://special.example.com/buy' });
    const url = composeCheckoutUrl(dest, makeConfig(), makeSession());
    expect(url).toMatch(/^https:\/\/special\.example\.com\/buy/);
    expect(url).not.toContain('checkout.gundrymd.com');
  });

  it('throws GhError when no brand base AND no DTO override', () => {
    const config = makeConfig({ checkoutBase: null });
    const dest = makeDestination({ checkoutOverrideUrl: null });
    expect(() => composeCheckoutUrl(dest, config, makeSession())).toThrow(GhError);
  });

  it('always appends order_form_id and session_id', () => {
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), makeSession()));
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
    expect(url.searchParams.get('session_id')).toBe('174710238129');
  });

  it('appends UTM and sub_id params when present in session.params', () => {
    const session = makeSession({
      params: {
        landingUrl: 'https://info.gundrymd.com/x',
        utmSource: 'fb',
        utmCampaign: 'summer',
        subId1: 'fb',
        subId5: 'abc',
      },
    });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.get('utm_source')).toBe('fb');
    expect(url.searchParams.get('utm_campaign')).toBe('summer');
    expect(url.searchParams.get('sub_id1')).toBe('fb');
    expect(url.searchParams.get('sub_id5')).toBe('abc');
  });

  it('omits keys whose session.params values are empty/undefined', () => {
    const session = makeSession({ params: { utmSource: 'fb' } });
    const url = new URL(composeCheckoutUrl(makeDestination(), makeConfig(), session));
    expect(url.searchParams.has('utm_source')).toBe(true);
    expect(url.searchParams.has('utm_medium')).toBe(false);
    expect(url.searchParams.has('sub_id1')).toBe(false);
  });

  it('preserves pre-existing query string on the base URL', () => {
    const config = makeConfig({ checkoutBase: 'https://checkout.gundrymd.com/?fbp=existing' });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
    expect(url.searchParams.get('fbp')).toBe('existing');
    expect(url.searchParams.get('order_form_id')).toBe('OF_123');
  });

  it('author-supplied keys on the base win over SDK additions', () => {
    const config = makeConfig({
      checkoutBase: 'https://checkout.gundrymd.com/?session_id=author-wins',
    });
    const url = new URL(composeCheckoutUrl(makeDestination(), config, makeSession()));
    expect(url.searchParams.get('session_id')).toBe('author-wins');
  });

  it('emits empty string for session_id when sessionId is empty', () => {
    const url = new URL(
      composeCheckoutUrl(makeDestination(), makeConfig(), makeSession({ sessionId: '' })),
    );
    // empty sessionId is omitted — we don't pollute the URL with empty values
    expect(url.searchParams.has('session_id')).toBe(false);
  });
});
