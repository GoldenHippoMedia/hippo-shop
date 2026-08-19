# @goldenhippo/hippo-shop-types

## 4.0.1

### Patch Changes

- 2caf98e: Documentation corrections for v4. No runtime or type changes — this release exists so the corrected READMEs reach npmjs.com, which renders the README captured at publish time.

  **The version section is correct again.** The "About this version" section both package pages link to described v3 as the current release and showed a `/sdk/v3/gh.js` script tag. It now describes v4 and flags the two things that fail quietly for a new integrator: omitting `data-brand-token` mis-attributes every funnel event with a `200` and no log line, and `gh.checkoutUrl()` returns a promise, so `window.open(await …)` is popup-blocked.

  **SDK README**
  - Documented how an inbound click-id lands in the `subid` slots. `fbclid`, `gclid`, `ScCid`, `qclid`, `twclid` and `ndclid` write the click value to `subid1`; `wbraid` writes `subid4`; `ScCid`, `qclid`, `twclid` and `ndclid` additionally mark `subid5` with a platform name.
  - Corrected the outbound parameter precedence. Attribution parameters do not overwrite a value already on the destination's base URL, but `order_form_id` and `sessionid` are SDK-owned and always overwrite — which is what stops a pasted live funnel link from pinning every visitor to one session.
  - Added the `'config'` error code to the `GhErrorCode` union and the error reference. `gh.checkoutUrl()` rejects with it when a destination resolves no `checkoutOverrideUrl`, no `url`, and the script tag has no `data-checkout-base`.
  - Added `boot()` and the `GhWindow` interface to the barrel-export reference; both were already exported.
  - Fixed two table-of-contents links that did not resolve.

  **Types README**
  - Documented `HippoShopPricingDTO.checkoutOverrideUrl`. It is required as of 4.0.0 and was missing from both the `HippoShopDestinationDTO` example and the required-field table, so the example did not satisfy the type it illustrates. v4 adds five required keys across the DTOs, not four.

## 4.0.0

### Major Changes

- ddc2e52: Cluster G (v4): destination identity and absolute URL.

  **Breaking.** Three required fields on `HippoShopDestinationDTO`, one on
  `HippoShopFunnelStepDTO`:
  - `HippoShopDestinationDTO.id: string` — Salesforce ID of the destination.
  - `HippoShopDestinationDTO.funnelId: string` — Salesforce ID of the funnel it
    resolves to (the resolved `defaultFunnel`).
  - `HippoShopDestinationDTO.url: string | null` — absolute landing URL for the
    destination. `null` when Salesforce has none, in which case callers fall
    back to their own configured checkout base.
  - `HippoShopFunnelStepDTO.id: string` — Salesforce ID of the step.

  Producers must supply all four. Consumers gain the identity a funnel-event
  payload requires (`funnelSTFId`, `mainFunnelId`, `destinationId`,
  `funnelSTPId`) from a destination fetch they were already making — the
  upstream Salesforce record carried every one of these and the serializer
  discarded them.

  Also corrects the `HippoShopDestinationDTO` docblock, which claimed
  "Pre-Purchase only". The public API serves **Post-Purchase** destinations and
  Pre-Purchase funnels; the docblock had been pasted from `funnel.ts`.

  Supersedes the unreleased Cluster F changeset for this package.

## 3.0.0

### Major Changes

- b4f8dbb: **Breaking:** Removed deprecated `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields from `HippoShopProductVariantsDTO`. Use `<tier>List` for iteration or `<tier>ByQuantity` for direct lookup. The replacement fields have been available since v2.0.0.

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
