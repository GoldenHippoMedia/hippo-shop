/**
 * A product as exposed publicly — packaging, reviews, availability, and
 * the full variant matrix used for pricing.
 */
export interface HippoShopProductDTO {
  id: string;
  slug: string;
  name: string;
  category: string;
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
    standard: HippoShopProductVariantDTO[];
    myAccount: HippoShopProductVariantDTO[];
  };
  oneTime: {
    standard: HippoShopProductVariantDTO[];
    myAccount: HippoShopProductVariantDTO[];
  };
}

export interface HippoShopProductVariantDTO {
  productId: string;
  variantId: string;
  sku: string;
  price: number;
  rebillPrice: number;
  quantity: number;
  packageType: string;
  savings: number;
  /** Price for the same package under the *other* purchase type (subscription↔one-time). */
  alternatePurchaseTypePrice: number;
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
