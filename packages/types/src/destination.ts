/**
 * A destination resolves an offer to a funnel and a displayable price.
 *
 * Pre-Purchase only. Cross-brand requests return 404 (no enumeration).
 * Split tests are resolved server-side — partners always see the
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
  productSlug: string;
  packageQuantity: number;
  purchaseType: 'subscription' | 'one-time';
  price: HippoShopPriceDTO;
  /** Subscription rebill price. Null for one-time purchases. */
  rebillPrice: HippoShopPriceDTO | null;
}

export interface HippoShopPriceDTO {
  /** Decimal dollars, e.g. 49.95. */
  amount: number;
  /** v1 is USD-only. Reserved as a literal for forward compatibility. */
  currency: 'USD';
  /** Savings vs. a documented baseline, or null if not applicable. */
  savings: number | null;
}
