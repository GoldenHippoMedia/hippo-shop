import { describe, it, expect } from 'vitest';
import { enrichProduct } from '../src/enrich';
import type { HippoShopProductDTO, HippoShopProductVariantDTO } from '@goldenhippo/hippo-shop-types';

function variant(qty: number, sku: string, price: number): HippoShopProductVariantDTO {
  return {
    productId: `prod-${sku}`,
    variantId: `var-${sku}`,
    sku,
    price,
    rebillPrice: null,
    quantity: qty,
    packageType: 'bottle',
    savings: null,
    alternatePurchaseTypePrice: null,
    defaultFrequency: null,
  };
}

function emptyProduct(overrides?: Partial<HippoShopProductDTO['variants']>): HippoShopProductDTO {
  return {
    id: 'p1',
    slug: 'p1',
    name: 'Test',
    packaging: { singular: 'Bottle', plural: 'Bottles' },
    image: 'https://example.test/img.png',
    reviews: { count: 0, average: 0, globalFiveStarReviews: 0 },
    outOfStock: false,
    variants: {
      subscription: {
        standard: [],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
      oneTime: {
        standard: [],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
      ...overrides,
    } as HippoShopProductDTO['variants'],
  };
}

describe('enrichProduct', () => {
  it('produces a List that is reference-identical to the deprecated array', () => {
    const standardArr = [variant(3, 'A-3', 30), variant(6, 'A-6', 60)];
    const product = emptyProduct({
      subscription: {
        standard: standardArr,
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    expect(product.variants.subscription.standardList).toBe(standardArr);
  });

  it('keys ByQuantity by stringified quantity', () => {
    const product = emptyProduct({
      subscription: {
        standard: [variant(3, 'A-3', 30), variant(6, 'A-6', 60)],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    const byQty = product.variants.subscription.standardByQuantity;
    expect(Object.keys(byQty).sort()).toEqual(['3', '6']);
    expect(byQty['3']?.sku).toBe('A-3');
    expect(byQty['6']?.price).toBe(60);
    // Missing key resolves to undefined naturally.
    expect(byQty['9']).toBeUndefined();
  });

  it('produces empty list and empty record for an empty price level', () => {
    const product = emptyProduct();

    enrichProduct(product);

    expect(product.variants.oneTime.myAccountList).toEqual([]);
    expect(product.variants.oneTime.myAccountByQuantity).toEqual({});
  });

  it('collapses duplicate quantities to last-wins in the record but preserves all entries in the list', () => {
    const first = variant(3, 'A-3a', 30);
    const second = variant(3, 'A-3b', 28);
    const product = emptyProduct({
      subscription: {
        standard: [first, second],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    expect(product.variants.subscription.standardList).toEqual([first, second]);
    expect(product.variants.subscription.standardByQuantity['3']).toBe(second);
  });

  it('enriches all four price levels across both purchase types', () => {
    const product = emptyProduct({
      subscription: {
        standard: [variant(1, 'S-S-1', 10)],
        standardList: [],
        standardByQuantity: {},
        myAccount: [variant(2, 'S-M-2', 20)],
        myAccountList: [],
        myAccountByQuantity: {},
      },
      oneTime: {
        standard: [variant(3, 'O-S-3', 30)],
        standardList: [],
        standardByQuantity: {},
        myAccount: [variant(4, 'O-M-4', 40)],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    expect(product.variants.subscription.standardByQuantity['1']?.sku).toBe('S-S-1');
    expect(product.variants.subscription.myAccountByQuantity['2']?.sku).toBe('S-M-2');
    expect(product.variants.oneTime.standardByQuantity['3']?.sku).toBe('O-S-3');
    expect(product.variants.oneTime.myAccountByQuantity['4']?.sku).toBe('O-M-4');
  });

  it('returns the input unchanged when variants are missing or partial', () => {
    // Missing variants entirely.
    const noVariants = { id: 'x', slug: 'x', name: '', packaging: { singular: '', plural: '' },
      image: '', reviews: { count: 0, average: 0, globalFiveStarReviews: 0 }, outOfStock: false,
    } as unknown as HippoShopProductDTO;
    expect(() => enrichProduct(noVariants)).not.toThrow();
    expect((noVariants as unknown as { variants?: unknown }).variants).toBeUndefined();

    // Missing one purchase branch.
    const onlySubscription = {
      id: 'x', slug: 'x', name: '', packaging: { singular: '', plural: '' },
      image: '', reviews: { count: 0, average: 0, globalFiveStarReviews: 0 }, outOfStock: false,
      variants: {
        subscription: { standard: [], myAccount: [] },
        // oneTime is intentionally omitted
      },
    } as unknown as HippoShopProductDTO;
    expect(() => enrichProduct(onlySubscription)).not.toThrow();
    // Subscription branch was enriched; oneTime is untouched.
    expect(onlySubscription.variants.subscription.standardByQuantity).toEqual({});
    expect((onlySubscription.variants as unknown as Record<string, unknown>)['oneTime']).toBeUndefined();
  });
});
