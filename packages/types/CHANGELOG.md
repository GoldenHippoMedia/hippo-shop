# @goldenhippo/hippo-shop-types

## 2.1.0

### Minor Changes

- 8411639: Add quantity-keyed variant access. Each `variants.<purchase>.<tier>` price level
  now has two sibling fields: `<tier>List` (iteration) and `<tier>ByQuantity`
  (record keyed by quantity).

  HTML bindings can use the new paths directly:

      data-field="variants.subscription.standardByQuantity.3.price"
      <template data-each="variants.subscription.standardList">

  JavaScript consumers can look up by quantity:

      product.variants.subscription.standardByQuantity['3']?.price

  The existing arrays (`variants.<purchase>.<tier>`) are deprecated and will be
  removed in v3.0.0. Missing quantities resolve to `undefined`; the existing
  `data-field` and `data-if` semantics handle that without changes.

  The new fields are derived client-side by the SDK from the existing array
  shape; the wire format from `/public/v1/product/:slug` is unchanged.

## 2.0.0

### Major Changes

- 82411f5: Reshape the public DTOs to match real funnel/destination data.

  **Funnel**

  - Drop `entryUrl` from `HippoShopFunnelDTO`.
  - Drop `url` from `HippoShopFunnelStepDTO`.

  Funnels are identified by slug; the SDK is embedded on the partner page (which
  is the entry point), so canonical entry/step URLs have no consumer use.

  **Product**

  - Drop `category` from `HippoShopProductDTO`. Not every product has one — a
    required string was frequently a meaningless placeholder.
  - `HippoShopProductVariantDTO.rebillPrice`, `savings`, and
    `alternatePurchaseTypePrice` are now `number | null` instead of `number`.
    `null` carries the "doesn't apply here" signal (e.g. no rebill on a one-time
    variant, no savings to display) so consumers can branch cleanly rather than
    guarding against `0`.

  **Destination / pricing** — expanded to be landing-page-complete so a partner
  can render an offer card without a second call:

  - Drop `productSlug` from `HippoShopPricingDTO`. The source data has no public
    product slug — partners look the product family up via the new
    `familyOrBundleId`.
  - Replace `productId` with `orderFormId`. Checkout takes a list of order forms,
    so the cart-actionable identifier is the order-form Salesforce ID, not the
    SKU's SF ID.
  - Add `sku` (human-readable SKU code, used for analytics and identification).
  - Add `frequency: HippoShopFrequencyDTO | null` (subscription cadence; null for
    one-time).
  - Add `outOfStock: boolean`.
  - Add `restrictedCountryCodes: string[]` (ISO-3166-1 alpha-2 codes blocked from
    purchase).
  - Add `shipping: HippoShopShippingDTO` — `{ domestic, international,
freeShippingThreshold }`.
  - Add `bumpOffers: HippoShopBumpOfferDTO[]` — empty array when none configured.
    Each bump carries `familyOrBundleId`, `orderFormId`, `sku`, `productName`,
    `unitOfMeasure`, `quantity`, `price`, `outOfStock`, and
    `restrictedCountryCodes`.

  **New exported types:** `HippoShopShippingDTO`, `HippoShopBumpOfferDTO`.

## 1.0.1

### Patch Changes

- fe00224: Refresh README for npm package pages: add install commands, license badge, repository cross-links, and SLSA provenance section. No code changes — package metadata now declares the source repository (`repository` field), which is required for provenance verification.
