/**
 * A product as exposed publicly — packaging, reviews, availability, and
 * the full variant matrix used for pricing.
 */
export interface HippoShopProductDTO {
  id: string;
  slug: string;
  name: string;
  packaging: {
    singular: string;
    plural: string;
  };
  image: string;
  reviews: {
    count: number;
    average: number;
    globalFiveStarReviews: number;
  };
  outOfStock: boolean;
  variants: HippoShopProductVariantsDTO;
}

export interface HippoShopProductVariantsDTO {
  subscription: {
    /** Ordered list of subscription "standard" variants for iteration. */
    standardList: HippoShopProductVariantDTO[];
    /** Subscription "standard" variants keyed by `quantity` as a string. Missing quantities are absent (no `null` entries). */
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;
    /** Ordered list of subscription "my account" variants for iteration. */
    myAccountList: HippoShopProductVariantDTO[];
    /** Subscription "my account" variants keyed by `quantity` as a string. Missing quantities are absent. */
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
  oneTime: {
    /** Ordered list of one-time "standard" variants for iteration. */
    standardList: HippoShopProductVariantDTO[];
    /** One-time "standard" variants keyed by `quantity` as a string. Missing quantities are absent. */
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;
    /** Ordered list of one-time "my account" variants for iteration. */
    myAccountList: HippoShopProductVariantDTO[];
    /** One-time "my account" variants keyed by `quantity` as a string. Missing quantities are absent. */
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
}

/**
 * Variants indexed by their `quantity` value as a string key (e.g. `'3'`, `'6'`).
 * Only quantities that exist for the price level are present — missing keys
 * naturally resolve to `undefined` via path lookup or property access.
 */
export type HippoShopProductVariantsByQuantityDTO = Record<string, HippoShopProductVariantDTO>;

export interface HippoShopProductVariantDTO {
  productId: string;
  variantId: string;
  sku: string;
  price: number;
  /** Subscription rebill price. Null for one-time variants. */
  rebillPrice: number | null;
  quantity: number;
  packageType: string;
  /** Savings vs. a documented baseline, or null when no savings apply (avoids rendering "Save $0.00"). */
  savings: number | null;
  /**
   * Price for the same package under the *other* purchase type (subscription↔one-time).
   * Null when the alternate purchase type is not offered for this package.
   */
  alternatePurchaseTypePrice: number | null;
  /** Subscription frequency. Null for one-time variants. */
  defaultFrequency: HippoShopFrequencyDTO | null;
}

export interface HippoShopFrequencyDTO {
  /** Internal billing interval (e.g. every 1 unit). */
  interval: number;
  scale: 'day' | 'week' | 'month' | 'year';
  /** Display-facing interval — may differ from internal for presentation. */
  publicInterval: number;
  publicScale: 'day' | 'week' | 'month' | 'year';
  /** Machine value such as "30-day". */
  value: string;
  /** Human label such as "Every 30 Days". */
  label: string;
}
