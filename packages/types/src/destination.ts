import type { HippoShopFrequencyDTO } from './product';

/**
 * A destination resolves an offer to a funnel and a displayable price.
 *
 * Pre-Purchase only. Cross-brand requests return 404 (no enumeration).
 * Split tests are resolved server-side — host pages always see the
 * destination's `defaultFunnel`.
 */
export interface HippoShopDestinationDTO {
  slug: string;
  name: string;
  description: string | null;
  /** Slug of the funnel this destination resolves to. */
  funnelSlug: string;
  pricing: HippoShopPricingDTO;
}

export interface HippoShopPricingDTO {
  /**
   * Salesforce ID of the product family this offer belongs to —
   * use this to look the product up via the products API.
   */
  familyOrBundleId: string;
  /** Salesforce ID of the order form that sells this offer — pass to checkout. */
  orderFormId: string;
  /** Human-readable SKU code for the main offer (used for analytics and identification). */
  sku: string;
  packageQuantity: number;
  purchaseType: 'subscription' | 'one-time';
  /** Subscription rebill cadence. Null for one-time purchases. */
  frequency: HippoShopFrequencyDTO | null;
  price: HippoShopPriceDTO;
  /** Subscription rebill price. Null for one-time purchases. */
  rebillPrice: HippoShopPriceDTO | null;
  outOfStock: boolean;
  /** ISO-3166-1 alpha-2 country codes blocked from purchase. Empty when unrestricted. */
  restrictedCountryCodes: string[];
  shipping: HippoShopShippingDTO;
  /** Bump offers presented at checkout. Empty array when none are configured. */
  bumpOffers: HippoShopBumpOfferDTO[];
  /**
   * Optional override for the checkout base URL on handoff. When set,
   * overrides the brand-level `data-checkout-base`. `null` means use
   * the brand default. Added in Cluster F.
   */
  checkoutOverrideUrl: string | null;
}

export interface HippoShopPriceDTO {
  /** Decimal dollars, e.g. 49.95. */
  amount: number;
  /** v1 is USD-only. Reserved as a literal for forward compatibility. */
  currency: 'USD';
  /** Savings vs. a documented baseline, or null if not applicable. */
  savings: number | null;
}

export interface HippoShopShippingDTO {
  /** Domestic shipping amount in USD. 0 indicates always free. */
  domestic: number;
  /** International shipping amount in USD. 0 indicates always free. */
  international: number;
  /** Order subtotal at or above which domestic shipping is free. Null if no threshold promotion. */
  freeShippingThreshold: number | null;
}

export interface HippoShopBumpOfferDTO {
  /** Salesforce ID of the product family the bump belongs to. */
  familyOrBundleId: string;
  /** Salesforce ID of the order form that sells this bump — pass to checkout. */
  orderFormId: string;
  /** Human-readable SKU code for the bump. */
  sku: string;
  productName: string;
  /** Package unit label, e.g., "Bag" or "Bottle". */
  unitOfMeasure: string;
  quantity: number;
  price: HippoShopPriceDTO;
  outOfStock: boolean;
  /** ISO-3166-1 alpha-2 country codes blocked from purchase. Empty when unrestricted. */
  restrictedCountryCodes: string[];
}
