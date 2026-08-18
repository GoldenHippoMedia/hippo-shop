import { describe, it, expect } from 'vitest';
import type {
  HippoShopFunnelDTO,
  HippoShopFunnelStepDTO,
  HippoShopDestinationDTO,
  HippoShopPricingDTO,
  HippoShopPriceDTO,
  HippoShopShippingDTO,
  HippoShopBumpOfferDTO,
  HippoShopFrequencyDTO,
  HippoShopProductDTO,
} from '@goldenhippo/hippo-shop-types';

const BASE = process.env['HIPPO_SHOP_BASE_URL'] ?? 'https://api-uat.goldenhippo.io';
const KEY = process.env['HIPPO_SHOP_KEY'];
const BRAND = process.env['HIPPO_SHOP_BRAND'] ?? 'Gundry MD';
const FUNNEL_SLUG = process.env['HIPPO_SHOP_FUNNEL_SLUG'] ?? 'bio-complete-3-main';
const DESTINATION_SLUG = process.env['HIPPO_SHOP_DESTINATION_SLUG'] ?? 'bio-complete-3-6btl-sub';
const PRODUCT_SLUG = process.env['HIPPO_SHOP_PRODUCT_SLUG'] ?? 'bio-complete-3';

const describeIf = KEY ? describe : describe.skip;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'X-GH-Key': KEY as string,
      'X-GH-Brand': BRAND,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * Compile-time exhaustive key list for `T`.
 *
 * The argument is rejected by tsc unless it lists every string key of `T`:
 * an unknown key fails the `K extends readonly Extract<keyof T, string>[]`
 * constraint, and a *missing* key collapses the conditional to a tuple the
 * array cannot satisfy, so the error names what was left out. That is the
 * half of this contract CI can enforce without a UAT key — add a field to a
 * DTO and forget this file, and `pnpm typecheck` fails.
 */
function keysOf<T>() {
  return <K extends readonly Extract<keyof T, string>[]>(
    keys: K &
      ([Extract<keyof T, string>] extends [K[number]]
        ? unknown
        : ['MISSING KEY(S)', Exclude<Extract<keyof T, string>, K[number]>]),
  ): readonly string[] => [...keys] as readonly string[];
}

/**
 * The runtime half: the server's key set must equal the contract's key set.
 * Not `toMatchObject`, not a handful of sampled paths — a field the API stops
 * sending and a field it starts sending are both failures, because the SDK
 * ships a `.d.ts` that promises exactly this shape.
 */
function expectExactKeys(actual: unknown, expected: readonly string[], label: string): void {
  expect(actual, `${label} is not a JSON object`).toBeTypeOf('object');
  expect(actual, `${label} is null`).not.toBeNull();
  expect(
    Object.keys(actual as object).sort(),
    `${label} key set drifted from @goldenhippo/hippo-shop-types`,
  ).toEqual([...expected].sort());
}

const FUNNEL_KEYS = keysOf<HippoShopFunnelDTO>()(['slug', 'name', 'active', 'steps']);
const FUNNEL_STEP_KEYS = keysOf<HippoShopFunnelStepDTO>()([
  'id', 'stepNumber', 'slug', 'name', 'kind',
]);
const DESTINATION_KEYS = keysOf<HippoShopDestinationDTO>()([
  'id', 'slug', 'name', 'description', 'funnelSlug', 'funnelId', 'url', 'pricing',
]);
const PRICING_KEYS = keysOf<HippoShopPricingDTO>()([
  'familyOrBundleId', 'orderFormId', 'sku', 'packageQuantity', 'purchaseType', 'frequency',
  'price', 'rebillPrice', 'outOfStock', 'restrictedCountryCodes', 'shipping', 'bumpOffers',
  'checkoutOverrideUrl',
]);
const PRICE_KEYS = keysOf<HippoShopPriceDTO>()(['amount', 'currency', 'savings']);
const SHIPPING_KEYS = keysOf<HippoShopShippingDTO>()([
  'domestic', 'international', 'freeShippingThreshold',
]);
const BUMP_OFFER_KEYS = keysOf<HippoShopBumpOfferDTO>()([
  'familyOrBundleId', 'orderFormId', 'sku', 'productName', 'unitOfMeasure', 'quantity', 'price',
  'outOfStock', 'restrictedCountryCodes',
]);
const FREQUENCY_KEYS = keysOf<HippoShopFrequencyDTO>()([
  'interval', 'scale', 'publicInterval', 'publicScale', 'value', 'label',
]);
const STEP_KINDS = ['landing', 'content', 'order-form', 'bump', 'upsell', 'downsell', 'thank-you'];

// Runs with or without a key — the only test in this file that does. It proves the
// comparator itself fails on both directions of drift, so a green CI run without a
// UAT key still means something.
describe('key-set helper', () => {
  it('passes on an exact match and fails on drift', () => {
    expectExactKeys({ amount: 1, currency: 'USD', savings: null }, PRICE_KEYS, 'price');
    expect(() => expectExactKeys({ amount: 1, currency: 'USD' }, PRICE_KEYS, 'price')).toThrow(
      /price key set drifted/,
    );
    expect(() =>
      expectExactKeys({ amount: 1, currency: 'USD', savings: null, extra: 1 }, PRICE_KEYS, 'price'),
    ).toThrow(/price key set drifted/);
  });
});

describeIf('public/v1 — UAT E2E', () => {
  it('GET /public/v1/funnel/:slug returns exactly the HippoShopFunnelDTO shape', async () => {
    const funnel = await get<HippoShopFunnelDTO>(`/public/v1/funnel/${FUNNEL_SLUG}`);

    expectExactKeys(funnel, FUNNEL_KEYS, 'funnel');
    expect(funnel.slug).toBeTypeOf('string');
    expect(funnel.name).toBeTypeOf('string');
    expect(funnel.active).toBeTypeOf('boolean');
    expect(Array.isArray(funnel.steps)).toBe(true);
    expect(funnel.steps.length).toBeGreaterThan(0);

    funnel.steps.forEach((step, i) => {
      expectExactKeys(step, FUNNEL_STEP_KEYS, `funnel.steps[${i}]`);
      // Cluster G: the Salesforce step id rides as `funnelSTPId` on every funnel event.
      // A blank value is silently dropped upstream, so blank is a failure, not a null case.
      expect(step.id, `funnel.steps[${i}].id`).toBeTypeOf('string');
      expect(step.id.length, `funnel.steps[${i}].id is blank`).toBeGreaterThan(0);
      expect(step.stepNumber).toBeTypeOf('number');
      expect(step.slug).toBeTypeOf('string');
      expect(step.name).toBeTypeOf('string');
      expect(STEP_KINDS).toContain(step.kind);
    });
  });

  it('GET /public/v1/destination/:slug returns exactly the HippoShopDestinationDTO shape', async () => {
    const dest = await get<HippoShopDestinationDTO>(`/public/v1/destination/${DESTINATION_SLUG}`);

    expectExactKeys(dest, DESTINATION_KEYS, 'destination');

    // Cluster G identity: `destinationId` and `mainFunnelId` on the funnel-event payload.
    expect(dest.id, 'destination.id').toBeTypeOf('string');
    expect(dest.id.length, 'destination.id is blank').toBeGreaterThan(0);
    expect(dest.funnelId, 'destination.funnelId').toBeTypeOf('string');
    expect(dest.funnelId.length, 'destination.funnelId is blank').toBeGreaterThan(0);

    // Cluster G navigation target. `null` is a valid, expected value: Task 40 degrades to
    // null when Salesforce has no URL, when the SOQL lookup fails, and while the sObject
    // name is unconfigured. What is *not* acceptable is a non-absolute string.
    const url = dest.url;
    expect(url === null || typeof url === 'string', 'destination.url').toBe(true);
    if (url !== null) {
      expect(() => new URL(url), `destination.url is not absolute: ${url}`).not.toThrow();
    }

    expect(dest.slug).toBeTypeOf('string');
    expect(dest.name).toBeTypeOf('string');
    expect(dest.description === null || typeof dest.description === 'string').toBe(true);
    expect(dest.funnelSlug).toBeTypeOf('string');

    expectExactKeys(dest.pricing, PRICING_KEYS, 'destination.pricing');
    expectExactKeys(dest.pricing.price, PRICE_KEYS, 'destination.pricing.price');
    expect(dest.pricing.price.currency).toBe('USD');
    expect(['subscription', 'one-time']).toContain(dest.pricing.purchaseType);
    expectExactKeys(dest.pricing.shipping, SHIPPING_KEYS, 'destination.pricing.shipping');

    // Both are null on a one-time destination; the default DESTINATION_SLUG is a
    // subscription, so with default env these two branches do run.
    if (dest.pricing.rebillPrice !== null) {
      expectExactKeys(dest.pricing.rebillPrice, PRICE_KEYS, 'destination.pricing.rebillPrice');
    }
    if (dest.pricing.frequency !== null) {
      expectExactKeys(dest.pricing.frequency, FREQUENCY_KEYS, 'destination.pricing.frequency');
    }

    expect(Array.isArray(dest.pricing.bumpOffers)).toBe(true);
    dest.pricing.bumpOffers.forEach((bump, i) => {
      expectExactKeys(bump, BUMP_OFFER_KEYS, `destination.pricing.bumpOffers[${i}]`);
      expectExactKeys(bump.price, PRICE_KEYS, `destination.pricing.bumpOffers[${i}].price`);
    });
  });

  // Left as sampled paths on purpose: Cluster G does not touch HippoShopProductDTO, and
  // its variant matrix is a Record keyed by quantity, so an exact key set would assert the
  // catalogue rather than the contract. Locking it down is a follow-up, not this task.
  it('GET /public/v1/product/:slug returns a HippoShopProductDTO', async () => {
    const product = await get<HippoShopProductDTO>(`/public/v1/product/${PRODUCT_SLUG}`);
    expect(product.id).toBeTypeOf('string');
    expect(product.reviews.count).toBeGreaterThanOrEqual(0);
    expect(product.variants.subscription).toBeDefined();
    expect(product.variants.oneTime).toBeDefined();
  });

  it('unknown slug returns 404', async () => {
    await expect(get(`/public/v1/funnel/__definitely_not_a_real_funnel__`)).rejects.toThrow(/404/);
  });
});
