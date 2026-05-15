import { expectType, expectAssignable, expectNotAssignable, expectError } from 'tsd';
import type {
  HippoShopFunnelDTO,
  HippoShopStepKind,
  HippoShopDestinationDTO,
  HippoShopPriceDTO,
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
const dest: HippoShopDestinationDTO = {
  slug: 'd', name: 'd', description: null, funnelSlug: 'f',
  pricing: {
    productSlug: 'p', packageQuantity: 1, purchaseType: 'one-time',
    price: usdPrice, rebillPrice: null,
  },
};
expectType<HippoShopPriceDTO | null>(dest.pricing.rebillPrice);

// --- purchaseType is a closed enum ---
expectNotAssignable<HippoShopDestinationDTO['pricing']['purchaseType']>('lease');

// --- HippoShopProductVariantDTO.defaultFrequency is `HippoShopFrequencyDTO | null` ---
const variant: HippoShopProductVariantDTO = {
  productId: 'p', variantId: 'v', sku: 's',
  price: 0, rebillPrice: 0, quantity: 1, packageType: 'bottle',
  savings: 0, alternatePurchaseTypePrice: 0,
  defaultFrequency: null,
};
expectType<HippoShopFrequencyDTO | null>(variant.defaultFrequency);

// --- Funnel steps are `kind: HippoShopStepKind`, not arbitrary strings ---
const funnel: HippoShopFunnelDTO = {
  slug: 'f', name: 'F', active: true, entryUrl: 'https://example.com',
  steps: [
    { stepNumber: 1, slug: 's1', name: 'S1', kind: 'landing', url: 'https://example.com/1' },
  ],
};
expectType<HippoShopStepKind>(funnel.steps[0]!.kind);

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
