import { describe, it, expect } from 'vitest';
import type {
  HippoShopFunnelDTO,
  HippoShopDestinationDTO,
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

describeIf('public/v1 — UAT E2E', () => {
  it('GET /public/v1/funnel/:slug returns a HippoShopFunnelDTO', async () => {
    const funnel = await get<HippoShopFunnelDTO>(`/public/v1/funnel/${FUNNEL_SLUG}`);
    expect(funnel.slug).toBeTypeOf('string');
    expect(funnel.active).toBeTypeOf('boolean');
    expect(Array.isArray(funnel.steps)).toBe(true);
    expect(funnel.steps.length).toBeGreaterThan(0);
  });

  it('GET /public/v1/destination/:slug returns a HippoShopDestinationDTO', async () => {
    const dest = await get<HippoShopDestinationDTO>(`/public/v1/destination/${DESTINATION_SLUG}`);
    expect(dest.funnelSlug).toBeTypeOf('string');
    expect(dest.pricing.price.currency).toBe('USD');
    expect(['subscription', 'one-time']).toContain(dest.pricing.purchaseType);
  });

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
