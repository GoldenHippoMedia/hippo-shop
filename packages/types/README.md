# @goldenhippo/hippo-shop-types

[![npm version](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)
[![types](https://img.shields.io/npm/types/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

TypeScript type definitions for the Hippo Shop public API. Zero runtime dependencies — install in your project for IntelliSense and compile-time safety against the live API contract.

> For context on v1.x/v2.x → v3 — see [About this version](../../README.md#about-this-version) in the root README.

> Runtime SDK: [`@goldenhippo/hippo-shop-sdk`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)

## Installation

```bash
npm install --save-dev @goldenhippo/hippo-shop-types
# or
pnpm add -D @goldenhippo/hippo-shop-types
```

## Usage

Import the DTOs you need:

```ts
import type {
  HippoShopFunnelDTO,
  HippoShopDestinationDTO,
  HippoShopProductDTO,
  HippoShopProductVariantDTO,
  HippoShopProductVariantsByQuantityDTO,
  HippoShopErrorDTO,
} from '@goldenhippo/hippo-shop-types';
```

Most pages use the SDK's auto-fetching declarative bindings — see [`@goldenhippo/hippo-shop-sdk`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk). For SSR, edge functions, or custom rendering, call the API directly with a typed fetch:

```ts
const res = await fetch(
  'https://api-prod.goldenhippo.io/public/v1/product/multi-vitamin',
  {
    headers: {
      'X-GH-Key': 'gh_pk_yourbrand_xxxxxx',
      'X-GH-Brand': 'Sample Co',
    },
  },
);
const product: HippoShopProductDTO = await res.json();
```

## Three DTOs

| DTO | Route | Scenario |
|-----|-------|----------|
| `HippoShopFunnelDTO` | `GET /public/v1/funnel/:slugOrId` | Render or link a Golden Hippo funnel. |
| `HippoShopDestinationDTO` | `GET /public/v1/destination/:slugOrId` | Resolve an offer to a funnel + price. |
| `HippoShopProductDTO` | `GET /public/v1/product/:slugOrId` | Display live pricing and availability. |

## Example responses

What the API actually returns. All examples use a fictional product (`multi-vitamin`) and brand (`Sample Co`) — substitute your own slugs.

### `HippoShopFunnelDTO`

```json
{
  "slug": "multi-vitamin-funnel",
  "name": "Daily Multi-Vitamin — Main",
  "active": true,
  "steps": [
    { "stepNumber": 1, "slug": "vsl", "name": "Video Sales Letter", "kind": "landing" },
    { "stepNumber": 2, "slug": "checkout", "name": "Order Form", "kind": "order-form" },
    { "stepNumber": 3, "slug": "discount-bump", "name": "10% Off Bump", "kind": "bump" },
    { "stepNumber": 4, "slug": "upsell-3mo", "name": "3-Month Upsell", "kind": "upsell" },
    { "stepNumber": 5, "slug": "thank-you", "name": "Thank You", "kind": "thank-you" }
  ]
}
```

### `HippoShopDestinationDTO`

```json
{
  "slug": "multi-vitamin-3pack-sub",
  "name": "3-Pack Subscription",
  "description": "3 bottles delivered every 90 days. Cancel anytime.",
  "funnelSlug": "multi-vitamin-funnel",
  "pricing": {
    "familyOrBundleId": "a8r000000000DEF",
    "orderFormId": "01t000000000ABC",
    "sku": "MV-SUB-3",
    "packageQuantity": 3,
    "purchaseType": "subscription",
    "frequency": {
      "interval": 3, "scale": "month",
      "publicInterval": 3, "publicScale": "month",
      "value": "90-day", "label": "Every 90 Days"
    },
    "price": { "amount": 89.95, "currency": "USD", "savings": 30 },
    "rebillPrice": { "amount": 89.95, "currency": "USD", "savings": null },
    "outOfStock": false,
    "restrictedCountryCodes": [],
    "shipping": { "domestic": 0, "international": 12.95, "freeShippingThreshold": null },
    "bumpOffers": [
      {
        "familyOrBundleId": "a8r000000000GHI",
        "orderFormId": "01t000000000JKL",
        "sku": "MV-BUMP-1",
        "productName": "Vitamin D Booster",
        "unitOfMeasure": "Bottle",
        "quantity": 1,
        "price": { "amount": 14.95, "currency": "USD", "savings": 5 },
        "outOfStock": false,
        "restrictedCountryCodes": []
      }
    ]
  }
}
```

### `HippoShopProductDTO`

The variant tree is the largest part of the product response. Each price-level branch (`subscription.standardList`, `subscription.myAccountList`, `oneTime.standardList`, `oneTime.myAccountList`) is paired with a `…ByQuantity` record keyed by stringified quantity for direct lookup.

```json
{
  "id": "p_01ABCDEFGHJK",
  "slug": "multi-vitamin",
  "name": "Daily Multi-Vitamin",
  "packaging": { "singular": "Bottle", "plural": "Bottles" },
  "image": "https://cdn.example.com/products/multi-vitamin.png",
  "reviews": { "count": 1842, "average": 4.6, "globalFiveStarReviews": 12450 },
  "outOfStock": false,
  "variants": {
    "subscription": {
      "standardList": [
        {
          "productId": "p_01ABCDEFGHJK",
          "variantId": "v_01ABCDE001",
          "sku": "MV-SUB-1",
          "price": 34.95,
          "rebillPrice": 34.95,
          "quantity": 1,
          "packageType": "bottle",
          "savings": null,
          "alternatePurchaseTypePrice": 39.95,
          "defaultFrequency": {
            "interval": 1, "scale": "month",
            "publicInterval": 1, "publicScale": "month",
            "value": "30-day", "label": "Every 30 Days"
          }
        },
        {
          "productId": "p_01ABCDEFGHJK",
          "variantId": "v_01ABCDE003",
          "sku": "MV-SUB-3",
          "price": 89.95,
          "rebillPrice": 89.95,
          "quantity": 3,
          "packageType": "bottle",
          "savings": 24.90,
          "alternatePurchaseTypePrice": 104.85,
          "defaultFrequency": {
            "interval": 3, "scale": "month",
            "publicInterval": 3, "publicScale": "month",
            "value": "90-day", "label": "Every 90 Days"
          }
        },
        {
          "productId": "p_01ABCDEFGHJK",
          "variantId": "v_01ABCDE006",
          "sku": "MV-SUB-6",
          "price": 169.95,
          "rebillPrice": 169.95,
          "quantity": 6,
          "packageType": "bottle",
          "savings": 79.75,
          "alternatePurchaseTypePrice": 199.70,
          "defaultFrequency": {
            "interval": 6, "scale": "month",
            "publicInterval": 6, "publicScale": "month",
            "value": "180-day", "label": "Every 180 Days"
          }
        }
      ],
      "standardByQuantity": {
        "1": { /* same shape as standardList[0] */ },
        "3": { /* same shape as standardList[1] */ },
        "6": { /* same shape as standardList[2] */ }
      },
      "myAccountList": [],
      "myAccountByQuantity": {}
    },
    "oneTime": {
      "standardList": [
        {
          "productId": "p_01ABCDEFGHJK",
          "variantId": "v_01ABCDE101",
          "sku": "MV-OT-1",
          "price": 39.95,
          "rebillPrice": null,
          "quantity": 1,
          "packageType": "bottle",
          "savings": null,
          "alternatePurchaseTypePrice": 34.95,
          "defaultFrequency": null
        },
        {
          "productId": "p_01ABCDEFGHJK",
          "variantId": "v_01ABCDE103",
          "sku": "MV-OT-3",
          "price": 104.85,
          "rebillPrice": null,
          "quantity": 3,
          "packageType": "bottle",
          "savings": null,
          "alternatePurchaseTypePrice": 89.95,
          "defaultFrequency": null
        }
      ],
      "standardByQuantity": {
        "1": { /* same shape as standardList[0] */ },
        "3": { /* same shape as standardList[1] */ }
      },
      "myAccountList": [],
      "myAccountByQuantity": {}
    }
  }
}
```

The `/* … */` comments inside the JSON above are illustrative — the real response includes the full object at each entry; they're elided here to keep the example readable. The `myAccount` tier is empty in this sample because the product isn't enrolled in the My Account tier program; most products show empty arrays and an empty record there.

## Versioning

Semver. Major versions track breaking changes to the public API contract. Minor and patch versions are additive only.

## No runtime validation

These are types only — no runtime validation. If you need to validate response bodies at the network boundary, use a runtime schema library like [Zod](https://zod.dev) or [io-ts](https://github.com/gcanti/io-ts).

## Provenance

Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) attestation via npm Trusted Publishers + GitHub Actions OIDC.

## License

MIT. See [LICENSE](./LICENSE).
