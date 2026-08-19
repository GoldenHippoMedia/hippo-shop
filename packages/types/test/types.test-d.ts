import { expectType, expectAssignable, expectNotAssignable, expectError } from 'tsd';
import type {
  HippoShopFunnelDTO,
  HippoShopStepKind,
  HippoShopDestinationDTO,
  HippoShopPriceDTO,
  HippoShopShippingDTO,
  HippoShopBumpOfferDTO,
  HippoShopProductVariantDTO,
  HippoShopFrequencyDTO,
  HippoShopErrorDTO,
  HippoShopErrorCode,
} from '../dist';

// --- HippoShopStepKind is a closed enum ---
expectAssignable<HippoShopStepKind>('landing');
expectAssignable<HippoShopStepKind>('order-form');
expectAssignable<HippoShopStepKind>('thank-you');
expectNotAssignable<HippoShopStepKind>('checkout');
expectNotAssignable<HippoShopStepKind>('');

// --- HippoShopPriceDTO.currency is USD only in v1 ---
const usdPrice: HippoShopPriceDTO = { amount: 49.95, currency: 'USD', savings: null };
expectType<'USD'>(usdPrice.currency);
expectError<HippoShopPriceDTO>({ amount: 1, currency: 'EUR', savings: null });

// --- HippoShopPriceDTO.savings is `number | null` (not optional) ---
expectError<HippoShopPriceDTO>({ amount: 1, currency: 'USD' });

// --- pricing.rebillPrice is `HippoShopPriceDTO | null`, not optional ---
const shipping: HippoShopShippingDTO = {
  domestic: 4.95, international: 9.95, freeShippingThreshold: 50,
};
const dest: HippoShopDestinationDTO = {
  id: 'a0D0m000002Dst1EAC',
  slug: 'd', name: 'd', description: null,
  funnelSlug: 'f', funnelId: 'a0F0m000002Fnl1EAC',
  url: null,
  pricing: {
    familyOrBundleId: 'fam-sf-id', orderFormId: 'of-sf-id', sku: 'SKU-1',
    packageQuantity: 1, purchaseType: 'one-time',
    frequency: null,
    price: usdPrice, rebillPrice: null,
    outOfStock: false, restrictedCountryCodes: [],
    shipping, bumpOffers: [],
    checkoutOverrideUrl: null,
  },
};
expectType<HippoShopPriceDTO | null>(dest.pricing.rebillPrice);
expectType<HippoShopFrequencyDTO | null>(dest.pricing.frequency);
expectType<number | null>(dest.pricing.shipping.freeShippingThreshold);
expectType<HippoShopBumpOfferDTO[]>(dest.pricing.bumpOffers);
expectType<string | null>(dest.pricing.checkoutOverrideUrl);
// --- Cluster G: destination identity + absolute URL are required, not optional ---
expectType<string>(dest.id);
expectType<string>(dest.funnelId);
expectType<string | null>(dest.url);
// Omitting any of the three is an error, not a silently-undefined read.
expectError<HippoShopDestinationDTO>({
  slug: 'd', name: 'd', description: null, funnelSlug: 'f',
  pricing: dest.pricing,
});

// --- bumpOffers entries have a full price shape, not just an amount ---
const bump: HippoShopBumpOfferDTO = {
  familyOrBundleId: 'fam-sf-bump', orderFormId: 'of-sf-bump',
  sku: 'BUMP-1', productName: 'Bump',
  unitOfMeasure: 'Bag', quantity: 1,
  price: { amount: 14.99, currency: 'USD', savings: 10 },
  outOfStock: false, restrictedCountryCodes: [],
};
expectType<HippoShopPriceDTO>(bump.price);

// --- purchaseType is a closed enum ---
expectNotAssignable<HippoShopDestinationDTO['pricing']['purchaseType']>('lease');

// --- HippoShopProductVariantDTO.defaultFrequency is `HippoShopFrequencyDTO | null` ---
const variant: HippoShopProductVariantDTO = {
  productId: 'p', variantId: 'v', sku: 's',
  price: 0, rebillPrice: null, quantity: 1, packageType: 'bottle',
  savings: null, alternatePurchaseTypePrice: null,
  defaultFrequency: null,
};
expectType<HippoShopFrequencyDTO | null>(variant.defaultFrequency);
expectType<number | null>(variant.rebillPrice);
expectType<number | null>(variant.savings);
expectType<number | null>(variant.alternatePurchaseTypePrice);

// --- Funnel steps are `kind: HippoShopStepKind`, not arbitrary strings ---
const funnel: HippoShopFunnelDTO = {
  id: 'a0F0m000002Fnl1EAC',
  slug: 'f', name: 'F', active: true,
  steps: [
    { id: 'a0P0m000002Stp1EAC', stepNumber: 1, slug: 's1', name: 'S1', kind: 'landing' },
  ],
};
expectType<HippoShopStepKind>(funnel.steps[0]!.kind);
expectType<string>(funnel.steps[0]!.id);
// The funnel carries its own Salesforce id, distinct from any step's: it is
// what a funnel event sends as `funnelSTFId` / `mainFunnelId`.
expectType<string>(funnel.id);

// --- HippoShopFrequencyDTO has both internal and public interval/scale ---
const freq: HippoShopFrequencyDTO = {
  interval: 1, scale: 'month',
  publicInterval: 30, publicScale: 'day',
  value: '30-day', label: 'Every 30 Days',
};
expectType<'day' | 'week' | 'month' | 'year'>(freq.publicScale);

// --- HippoShopErrorCode is a closed enum, retryAfterMs is optional ---
const err: HippoShopErrorDTO = { code: 'rate_limited', message: 'slow down' };
expectAssignable<HippoShopErrorCode>('not_found');
expectNotAssignable<HippoShopErrorCode>('teapot');
expectType<number | undefined>(err.retryAfterMs);
