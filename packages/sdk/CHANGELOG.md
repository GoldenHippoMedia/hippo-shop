# @goldenhippo/hippo-shop-sdk

## 2.1.0

### Minor Changes

- 79674ab: Add declarative miss-handling: `data-with` narrows the binding scope for a subtree
  and hides on missing path; `data-when="loaded|loading|failed"` shows elements based
  on the closest resource's lifecycle state. Together these let partners express
  loading skeletons, error fallbacks, and tight direct-lookup cards purely in HTML.

  The runtime now binds twice per pass: once with all unloaded resources marked
  `loading` (so skeletons show immediately), then again after fetches settle.
  `gh:bindings-ready` continues to fire once, after the post-fetch pass.

  Adds `ApplyBindingsOptions.resourceStates` and the `ResourceState` type to the SDK
  exports.

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

### Patch Changes

- Updated dependencies [8411639]
  - @goldenhippo/hippo-shop-types@2.1.0

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

### Patch Changes

- Updated dependencies [82411f5]
  - @goldenhippo/hippo-shop-types@2.0.0

## 1.1.1

### Patch Changes

- ab4a3e0: Widen `KEY_PATTERN` to allow `-` in the consumer/brand portion of `data-key`
  (`/^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/`). This lets multi-word brand slugs stay
  scannable (e.g. `gh_pk_internal_beverly-hills-md_<hex>`) and keeps the
  structural `_` separator unambiguous between consumer and brand fields.

  Backwards-compatible: every key that matched the previous pattern still
  matches. The error message was updated to reflect the new shape.

## 1.1.0

### Minor Changes

- bf93fe3: Send the publishable key as the dedicated `X-GH-Key` request header instead
  of `Authorization: Bearer <key>`. The previous Bearer shape did not fit
  Kong's `key-auth` plugin natively (which does an exact-value match against
  the configured header), so the gateway either had to store keys with a
  `Bearer ` prefix baked in or run a custom Lua plugin to strip the scheme.
  Moving to a dedicated header lets Kong validate keys with default
  configuration and keeps the `Authorization` header free for other purposes.

  The wire contract is partner-facing only via `data-key` on the `<script>`
  tag — no partner has to change anything. Internal callers using `curl` or
  custom integrations must swap `-H "Authorization: Bearer gh_pk_…"` for
  `-H "X-GH-Key: gh_pk_…"`.

### Patch Changes

- bcf9144: Reject `javascript:`, `vbscript:`, and `data:` schemes on URL-bearing
  `data-attr-*` bindings (`href`, `src`, `action`, `formaction`, `xlink:href`,
  `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`,
  `manifest`) and refuse to bind `data-attr-srcdoc` entirely. The SDK
  previously only blocked `on*` attribute names. This is defense-in-depth: a
  script-bearing string surfacing in the public JSON feed would otherwise
  execute in the partner page's origin when the element is activated.
  Normalization mirrors browser URL-parser behavior (strips leading ASCII
  whitespace/control bytes and embedded tab/LF/CR in the scheme prefix), so
  common obfuscations like `java\tscript:` are still caught.

## 1.0.1

### Patch Changes

- fe00224: Refresh README for npm package pages: add install commands, license badge, repository cross-links, and SLSA provenance section. No code changes — package metadata now declares the source repository (`repository` field), which is required for provenance verification.
- Updated dependencies [fe00224]
  - @goldenhippo/hippo-shop-types@1.0.1
