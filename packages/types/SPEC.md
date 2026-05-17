# `@goldenhippo/hippo-shop-types` — Contract

The DTO contract shared by the Golden Hippo public commerce API and the browser SDK. Zero runtime dependencies; pure TypeScript types.

What is documented here is what the package promises to export. Internal helpers, build scripts, and how the contract is generated are not part of this document.

## Module surface

The package has one barrel export at `@goldenhippo/hippo-shop-types`. Every type listed below is exported by name and is part of the public contract. Names are intentionally prefixed with `HippoShop` so they remain unambiguous when imported into a multi-namespace consumer.

### Funnel types

| Type | What it represents |
|---|---|
| `HippoShopFunnelDTO` | A pre-purchase funnel as exposed publicly — `slug`, `name`, `active`, ordered `steps[]`. Inactive funnels return 404 server-side; inactive steps are pre-filtered out of `steps`. Post-purchase funnels are not exposed publicly. |
| `HippoShopFunnelStepDTO` | One step within a funnel — `stepNumber` (1-indexed), `slug`, `name`, `kind` (a closed enum). |
| `HippoShopStepKind` | Closed enum: `'landing' \| 'content' \| 'order-form' \| 'bump' \| 'upsell' \| 'downsell' \| 'thank-you'`. The internal `pageType` is mapped to this set server-side; unknown internal values are dropped (and logged) so the host page never sees garbage. |

### Destination types

| Type | What it represents |
|---|---|
| `HippoShopDestinationDTO` | An offer resolution — `slug`, `name`, optional `description`, `funnelSlug` (the funnel to enter), and a `pricing` block. Split tests are resolved server-side; the host page always sees the destination's `defaultFunnel`. Cross-brand requests return 404. |
| `HippoShopPricingDTO` | The pricing block on a destination — Salesforce IDs (`familyOrBundleId`, `orderFormId`), human SKU, package quantity, `purchaseType` (`'subscription' \| 'one-time'`), optional rebill `frequency`, `price`, optional `rebillPrice`, `outOfStock`, `restrictedCountryCodes`, `shipping`, and any `bumpOffers`. |
| `HippoShopPriceDTO` | A money amount — `amount` in decimal dollars, `currency` literal `'USD'` (reserved for forward compatibility), optional `savings` versus a documented baseline (`null` when not applicable). |
| `HippoShopShippingDTO` | Shipping policy — `domestic` and `international` amounts in USD (0 means always free), optional `freeShippingThreshold` for domestic. |
| `HippoShopBumpOfferDTO` | A checkout bump offer — Salesforce IDs, SKU, product name, unit-of-measure label, quantity, price, stock state, restricted country codes. |

### Product types

| Type | What it represents |
|---|---|
| `HippoShopProductDTO` | A product as exposed publicly — `id`, `slug`, `name`, `packaging` (singular/plural), `image`, `reviews` (count/average/global-five-star), `outOfStock`, and the full `variants` matrix. |
| `HippoShopProductVariantsDTO` | The full variant matrix split by purchase type (`subscription`, `oneTime`) and price tier (`standard`, `myAccount`). For each tier you get `<tier>List` (ordered for iteration) and `<tier>ByQuantity` (keyed by stringified quantity for direct lookup). Missing quantities are absent — there are no `null` entries; lookup naturally yields `undefined`. |
| `HippoShopProductVariantsByQuantityDTO` | `Record<string, HippoShopProductVariantDTO>` keyed by `quantity` as a string (e.g. `'3'`, `'6'`). |
| `HippoShopProductVariantDTO` | A single variant row — `productId`, `variantId`, `sku`, `price`, optional `rebillPrice`, `quantity`, `packageType`, optional `savings`, optional `alternatePurchaseTypePrice`, optional `defaultFrequency`. |
| `HippoShopFrequencyDTO` | A subscription rebill cadence — `interval`/`scale` (internal), `publicInterval`/`publicScale` (display-facing — may differ), `value` machine code (e.g. `"30-day"`), `label` human string (e.g. `"Every 30 Days"`). |

### Error types

| Type | What it represents |
|---|---|
| `HippoShopErrorDTO` | The wire shape returned by `/public/v1/*` errors — `code`, `message`, optional `retryAfterMs` for rate-limited responses. Both Kong and the commerce API emit this shape. |
| `HippoShopErrorCode` | Closed enum: `'not_found' \| 'rate_limited' \| 'forbidden' \| 'bad_request' \| 'server'`. `not_found` is deliberately ambiguous between "doesn't exist" and "not authorized" — you cannot enumerate resources you don't own. |

## Invariants

- **Brand isolation.** Every DTO comes from a brand-scoped request. Cross-brand reads return `HippoShopErrorCode = 'not_found'` rather than `'forbidden'`.
- **Variants are absent, not null.** Both `*List` arrays and `*ByQuantity` records omit missing quantities. There are no `null` placeholders; lookup naturally yields `undefined`.
- **Currency.** v1 is USD-only; `HippoShopPriceDTO.currency` is the literal `'USD'`. Reserved for forward compatibility — do not switch on it today.
- **Date and time.** No DTO contains a date or time field in v1. If one appears in a future major, this section will say so.

## Deprecated surface

None in v3.0.0.

Historical note: v1.x and v2.x exposed legacy `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields on `HippoShopProductVariantsDTO`. Those were removed in v3.0.0. Use `<tier>List` for iteration or `<tier>ByQuantity` for direct lookup.

## Stability

- Adding optional fields to existing types is a minor.
- Adding new exported types is a minor.
- Removing or narrowing any documented field is a major.
- Promoting a field from optional to required is a major.
