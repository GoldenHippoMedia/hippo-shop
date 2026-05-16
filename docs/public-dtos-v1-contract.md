# Golden Hippo Public DTOs — v1 Contract

**Owner:** Acquisition Dev / Platform (consumer) + Commerce API team (producer)
**Status:** Draft for review
**Purpose:** Define the v1 public DTO contract that backs the external JS SDK (`window.gh.data.*`). This is the binding contract between the commerce API team (implementing the routes) and the SDK package (consuming them). Lock this before any handlers, Kong routes, or SDK methods are written.

> **Why this document exists.** The SDK's value is "external pages can read Golden Hippo data without owning Angular." Its risk is "external pages get more Golden Hippo data than we meant to expose." This contract is the boundary that keeps the former true and the latter contained.

---

## 1. Scope of v1

Three DTOs. Read-only. No PII. No writes. No analytics ingestion. No auth-bearing data. Pre-Purchase only (Post-Purchase is internal flow control and never exposed).

| DTO | Route | Primary scenario |
|-----|-------|------------------|
| `HippoShopFunnelDTO` | `GET /public/v1/funnel/:slugOrId` | External lander or widget needs to render or link a Golden Hippo funnel. |
| `HippoShopDestinationDTO` | `GET /public/v1/destination/:slugOrId` | External page resolves an offer/destination slug to a funnel reference and CTA URL, with the purchase price to display. |
| `HippoShopProductDTO` | `GET /public/v1/product/:slugOrId` | External page displays live pricing/availability for a product, optionally including MyAccount-tier pricing for guest-checkout flows. |

**Anything not listed is out of scope for v1.** Cart, checkout, lead capture, analytics ingestion, user accounts, subscriptions, order lookup, transactional email, A/B variant assignment — all explicitly out. Each is a different security model and a different DTO and gets its own purpose-built surface, most of which probably shouldn't live in this SDK at all.

**Lookup-by-slug-or-ID:** every route accepts either a stable public slug *or* a Salesforce ID. Slug is preferred — it works identically across UAT and prod, which is the whole reason for the convention. ID is the fallback for cases where slug isn't known. The handler tries slug first; on miss, tries ID; on miss again, returns 404.

---

## 2. Tenancy: brand-bound at init

The SDK is initialized with a brand:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_netlify_gundry_xyz"
        data-brand="Gundry MD"></script>
```

The brand binding has several consequences worth pinning down up front:

1. **The brand becomes the consumer's tenancy boundary.** A Gundry MD key initialized with `data-brand="Gundry MD"` can only resolve Gundry MD funnels, destinations, and products. Cross-brand requests return 404 even if the resource exists. Kong enforces this by binding the key→brand mapping at the consumer level; the commerce API double-enforces in the handler. Belt and suspenders.

2. **Routes do not carry a `brand` parameter.** Brand is implied by the authenticated key on the request. Smaller URL surface, harder to forge, partners physically can't typo their way into another brand's data.

3. **`brand` is omitted from DTO response bodies.** Every response is already scoped to the caller's brand; returning brand in the body would be noise.

4. **The brand value is the display name, not a code.** `data-brand="Gundry MD"` is what humans copy-paste from the partner-onboarding email. The internal mapping `"Gundry MD" → Salesforce brand ID` lives in the commerce API. The public surface never deals in brand codes — that simplification is welcome and removes the risk of a `BrandCode` enum drifting from reality.

5. **Boot-time validation.** The SDK validates `data-brand` against a known list at load and refuses to initialize on mismatch, with a clear console error. Otherwise a typo (`"Gundry"` vs `"Gundry MD"`) gives a cryptic 401 on first call.

6. **Brand mismatch returns 404, not 403.** Same response as "doesn't exist" — partners can't enumerate resources they don't own by probing.

---

## 3. Route segregation rules

These are hard rules, not conventions. They protect the boundary even after the codebase grows and original authors are gone.

1. **All SDK-bound routes live under `/public/v1/` in the commerce API.** No public-facing route exists outside this prefix. No internal route exists inside it.
2. **Every route under `/public/v1/` returns a `Public*DTO` type, never an internal model.** Types defined in `src/public/dtos/*.ts`. Not "the internal type minus a few fields" — distinct types that must be explicitly mapped from internal models.
3. **Each handler under `/public/v1/` has a corresponding `to*HippoShopDTO()` mapper.** Mappers live alongside the DTO types. They are the only place internal → public translation happens.
4. **An integration test verifies every `/public/v1/*` handler returns a value satisfying its DTO type and *only* that type's keys** — no excess properties from spread operators or accidental inclusion of internal fields.
5. **Public routes opt out of any internal auth middleware applied service-wide.** They are authenticated by Kong via `key-auth`, not by the service.
6. **The commerce API never reads `Authorization` headers, cookies, or session tokens on `/public/v1/*` requests.** If a future endpoint needs per-user data, it doesn't go under `/public/v1/`.

The integration test in rule 4 is the cheap, durable enforcement mechanism. Without it, rule 2 fails silently the first time someone uses `res.json({ ...internalModel, ... })` and ships.

---

## 4. The DTOs

### 4.1 `HippoShopFunnelDTO`

The minimum information an external page needs to render a Golden Hippo funnel's marketing structure or link into it. Funnel *configuration*, not funnel *state*.

```ts
export interface HippoShopFunnelDTO {
  slug: string;                       // 'skin-quiz' — primary lookup key
  name: string;                       // public-facing name
  active: boolean;                    // mirrors internal `active`
  entryUrl: string;                   // absolute https URL to the first step
  steps: HippoShopFunnelStepDTO[];       // ordered; inactive steps filtered out
}

export interface HippoShopFunnelStepDTO {
  stepNumber: number;                 // 1-based, as in source
  slug: string;                       // step slug, stable for analytics
  name: string;                       // public-facing step name
  kind: HippoShopStepKind;               // closed enum, mapped from internal pageType
  url: string;                        // absolute https URL
}

export type HippoShopStepKind =
  | 'landing'
  | 'content'
  | 'order-form'
  | 'bump'
  | 'upsell'
  | 'downsell'
  | 'thank-you';
```

**Field rationale:**

| Field | Why public | Notes |
|-------|------------|-------|
| `slug` | The lookup key. Already public via URLs. | — |
| `name` | Display label. | Not internal-name; not Salesforce-side editorial name. |
| `active` | Mirrors source. Lets consumers gracefully degrade if a funnel is off. | Honest to source; no fake state machine. |
| `entryUrl` | The minimum a partner needs to send traffic. | — |
| `steps` | Lets partners render a table of contents or progress indicator. | Excludes Salesforce IDs, A/B test variants, internal routing tokens. |
| `step.stepNumber` | 1-based to match source. | Documented as 1-based; the SDK does not renumber. |
| `step.kind` | Closed public enum, mapped from internal `pageType`. | See mapping below. |

**`pageType` → `kind` mapping:**

| Internal `pageType` | Public `kind` |
|---------------------|---------------|
| `Landing Page` | `landing` |
| `Content Page` | `content` |
| `Order Form` | `order-form` |
| `Bump Offer` | `bump` |
| `Upsell` | `upsell` |
| `DownSell` | `downsell` |
| `Thankyou Page` | `thank-you` |

Mapping is maintained in the commerce API. If an internal `pageType` is added that has no public mapping, the step is omitted from the response *and* a structured log line is emitted so the mapping can be updated. Partners never see a "garbage in, garbage out" response. (Post-Purchase-only kinds — bump, upsell, downsell — are reserved in the type so partners' handlers don't break if Post-Purchase exposure is added in v2.)

**Explicitly excluded** — name them so they don't drift in by accident:

- `id` (Salesforce funnel record ID).
- `brandId` (resolved via tenancy, not returned).
- `funnelType` — v1 only returns Pre-Purchase; the field would always be the same value. Reintroduced as a discriminator if Post-Purchase is ever exposed.
- `gep` (Generic End Point — internal page-routing slug, WIP, not partner-meaningful).
- `step.id` (Salesforce step record ID).
- `step.orderForm` (only populated on Post-Purchase, which is excluded).
- `prePurchaseOptions` — the offer-selector array on Pre-Purchase funnels. Partners that need offer details fetch a destination directly via `gh.data.destination()`.
- Any A/B test, variant, or experiment metadata.

**Behavioral rules:**

- **Post-Purchase funnels return 404** from `/public/v1/funnel/:slugOrId`. Not a 200 with empty fields. Same response as "doesn't exist."
- **Steps with `active === false` are filtered out** of the response. Consumers receive only the live, public step sequence.
- **Brand mismatch returns 404**, not 403.

### 4.2 `HippoShopDestinationDTO`

A destination is the routing primitive in our funnel system. It points at a default funnel and may have a split test attached internally. Externally, the split test is invisible — partners always see the resolved default. The DTO carries the purchase price to display alongside the destination.

```ts
export interface HippoShopDestinationDTO {
  slug: string;
  name: string;
  description: string | null;
  funnelSlug: string;                 // resolved default funnel
  pricing: HippoShopPricingDTO;          // the price we display at this destination
}

export interface HippoShopPricingDTO {
  productSlug: string;                // the primary product the price is for
  packageQuantity: number;            // e.g. 1, 3, 6
  purchaseType: 'subscription' | 'one-time';
  price: HippoShopPriceDTO;
  rebillPrice: HippoShopPriceDTO | null; // only present for subscription
}

export interface HippoShopPriceDTO {
  amount: number;                     // 44.95
  currency: 'USD';
  savings: number | null;             // strikethrough delta vs retail
}
```

**Field rationale:**

| Field | Why public | Notes |
|-------|------------|-------|
| `slug` | The lookup key. Stable across environments. | — |
| `name`, `description` | Partner-facing context (description optional, often unused). | Not the internal Salesforce notes. |
| `funnelSlug` | Reference, not embedded data. | Partners call `gh.data.funnel(slug)` if they need full funnel info. Cache decoupled. |
| `pricing` | The price the destination presents at its order form. | This is what marketing displays on landers — the "price at this funnel," not the catalog retail. |
| `pricing.productSlug` | The primary product associated with the offer at this destination. | If partners need full product detail, they call `gh.data.product(slug)`. |
| `pricing.price.savings` | Delta from retail, in dollars. Already shown on every brand site. | — |

**Explicitly excluded:**

- `id` (Salesforce destination record ID).
- `type` (`Pre-Purchase | Post-Purchase`) — Post-Purchase returns 404, so type is implicitly Pre-Purchase and the field is omitted.
- `defaultFunnel` (full embedded funnel) — replaced by `funnelSlug` reference.
- `splitTest` (entire object) — A/B testing infrastructure is not exposed externally. Reveals variant counts, traffic allocations (50/50 vs 90/10 tells you a lot about test maturity), `isControl` flags. Partners always see the default funnel.

**Behavioral rules:**

- **Post-Purchase destinations return 404** from `/public/v1/destination/:slugOrId`.
- **The destination is always resolved to its `defaultFunnel`**, regardless of split-test configuration. v1 does not perform variant assignment from external pages — that would corrupt test data, since external pages aren't in measured sessions. If variant-aware destination resolution is needed later, it's a separate, opt-in API method.
- **`pricing` is derived from the destination's order form configuration.** The mapping logic is implemented in the commerce API and documented alongside the mapper.

### 4.3 `HippoShopProductDTO`

Product data drawn from the existing commerce product feed, projected to a public-safe shape. Most of the underlying feed is already what powers the public brand websites — the DTO is generous about exposing it but removes operational fields.

```ts
export interface HippoShopProductDTO {
  id: string;                         // Salesforce family ID (a1H...) — already in client-side cart calls; safe to expose
  slug: string;
  name: string;                       // plain-text product name (e.g. "Bio Complete 3")
  category: string;                   // e.g. 'Supplements'
  packaging: {
    singular: string;                 // 'Bottle'
    plural: string;                   // 'Bottles'
  };
  image: string;                      // primary product image, https
  reviews: {
    count: number;
    average: number;
    globalFiveStarReviews: number;    // sometimes advertised; included intentionally
  };
  outOfStock: boolean;                // top-level OOS, the value funnels use
  variants: HippoShopProductVariantsDTO;
}

export interface HippoShopProductVariantsDTO {
  subscription: {
    standard: HippoShopProductVariantDTO[];
    myAccount: HippoShopProductVariantDTO[];  // public for guest-checkout MyAccount-price flows
  };
  oneTime: {
    standard: HippoShopProductVariantDTO[];
    myAccount: HippoShopProductVariantDTO[];  // public for guest-checkout MyAccount-price flows
  };
}

export interface HippoShopProductVariantDTO {
  productId: string;                  // Salesforce Product ID (01t...) — already in cart payloads
  variantId: string;                  // Salesforce variant ID (a0N...) — already in cart payloads
  sku: string;
  price: number;
  rebillPrice: number;                // for subscriptions, the per-shipment charge
  quantity: number;                   // pack count, e.g. 1, 3, 6
  packageType: string;                // 'Bottle', 'Jar', etc.
  savings: number;                    // dollars; 0 means no savings
  alternatePurchaseTypePrice: number; // counterpart price (sub vs one-time) for marketing comparison
  defaultFrequency: HippoShopFrequencyDTO | null;  // null on one-time variants
}

export interface HippoShopFrequencyDTO {
  // Canonical (used in legal/disclaimer text)
  interval: number;
  scale: 'day' | 'week' | 'month' | 'year';
  // Public-display (used in CTAs and marketing copy)
  publicInterval: number;
  publicScale: 'day' | 'week' | 'month' | 'year';
  value: string;                      // 'Monthly' | 'Quarterly' | ...
  label: string;                      // 'Every Month', 'Every 3 Months', ...
}
```

**Field rationale & decisions:**

| Field | Why public | Notes |
|-------|------------|-------|
| `id`, `productId`, `variantId` | Already exposed in every public website's cart calls. Partners may need them to deep-link into checkout. | Documented as Salesforce-derived; partners should treat them as opaque strings. |
| `slug` | Lookup key, already public. | Preferred over `id` for lookups (works across UAT/prod). |
| `name` | Plain-text product name from the top-level feed field. | Marketing-rich names with `<sup>` / `<em>` etc. live in `cms.displayName` and are deliberately not exposed in v1. Partners that need rich names can request later; we'll revisit the HTML-passthrough question then. |
| `category` | Public, on every PLP. | Top-level `category` string only; `cms.categories[]` (with internal IDs) is excluded. |
| `packaging` | Used in price displays ("3 Bottles for $X"). | — |
| `image` | Primary product photo, served from the brand's CDN. Already public. | `cms.featuredImage` / `secondaryImage` deliberately excluded in v1 — those are marketing-CMS assets that may have stricter usage rights. Revisit if a partner scenario needs them. |
| `reviews.count`, `.average`, `.globalFiveStarReviews` | All three exposed per explicit decision — `globalFiveStarReviews` is sometimes advertised on lower-rated products. | — |
| `outOfStock` | Source: top-level `outOfStock` from the product feed. This is what funnels use today, so the public DTO matches. | `cms.cartOutOfStock` is not surfaced — funnel-relevant semantics take precedence. |
| `variants` (all 4 quadrants: subscription/oneTime × standard/myAccount) | **MyAccount tier is exposed** to support funnel flows that grant MyAccount pricing to guest checkouts via session/param. | The SDK doesn't enforce when MyAccount pricing is "allowed" — that's a funnel-side concern. |
| `variant.savings` | Already on the site. | Dollar amount, not percentage. |
| `variant.alternatePurchaseTypePrice` | Used for "Subscribe and save $X" comparison copy. | Marketing-public concept. |
| `variant.defaultFrequency` (with both canonical and public fields) | **Both sets exposed**. Public for CTA copy ("1 bottle monthly!"), canonical for disclaimer/legal text ("charged $X every {interval} {scale}"). | Required by marketing pattern. |

**Explicitly excluded:**

- **All CMS-sourced display fields:** `cms.displayName`, `cms.description`, `cms.quote`, `cms.subHeading`, `cms.featuredImage`, `cms.secondaryImage`, `cms.gridDescription`, `cms.gridTagline`. These contain HTML markup (`<sup>`, `<em>`, etc.) and are excluded in v1 to keep the DTO pure plain-text. Revisit if a concrete partner scenario justifies an HTML-passthrough story (and clear consumer-side render/sanitize guidance).
- Top-level `description` — internal-feeling string (e.g. `"Gundry MD - Bio Complete 3"`), not useful for partner display. Plain-text marketing names are surfaced via top-level `name`.
- `localeRetailPrice`, `localePrice`, `localeSavings`, `localeRebillPrice` — locale variants. v1 is US-only; revisit if international support is added.
- `taxCode` — operational, not customer-facing.
- `tax` (object) — internal accounting concern.
- `countryCode`, `currencyCode` — implied US/USD for v1. Re-add when international support exists.
- `restrictedCountries`, `isRestricted` — checkout-time enforcement, not catalog-level.
- `countrySpecificPrices` (array on variants) — locale concerns, see above.
- `installments` — internal payment-plan field.
- `trialFamilyId`, `isTrial` — trials are not exposed in v1.
- `upc` — operational SKU metadata.
- `outOfStockEmailList`, `restockEta` — operational, partner UX should just see OOS or in-stock.
- `priceLevel`, `purchaseType` (on variant) — implied by the position in the variants tree (`.subscription.standard[]` etc.); redundant in the response.
- `alternatePriceLevelPrice`, `alternatePriceLevelLocalePrice` — Standard-vs-MyAccount comparison. Partners that need both tiers have both arrays.
- `cms.hidden`, `cms.cartOutOfStock` — `outOfStock` semantics use the top-level field per the funnel convention.
- `cms.group`, `cms.type` — internal CMS structure.
- `cms.categories`, `cms.useCases`, `cms.tags`, `cms.ingredients` — excluded for v1. Revisit if a concrete partner scenario asks for them.
- `reviewId` — duplicate of top-level `id` in practice.
- `rank`, `bundleRank` — internal sort order, not partner-meaningful.
- `group` (top-level) — internal product family pointer.
- `concerns`, `ingredients` (top-level, frequently empty) — see CMS notes.

**Behavioral rules:**

- Slug-or-ID lookup. Slug tried first.
- Brand-bound. Cross-brand request → 404.
- All string fields are plain text in v1. No HTML escaping or sanitization is required on the consumer side because no fields carry markup.

### 4.4 Shared types

```ts
export interface HippoShopError {
  code: 'not_found' | 'paused' | 'forbidden' | 'rate_limited' | 'bad_request';
  message: string;
}
```

No `BrandCode` enum — brand is bound at SDK init via display name and never appears in DTO bodies.

---

## 5. Consumer scenarios — what each DTO is *for*

These three scenarios drive the field decisions above. If a scenario needs something not in the DTOs, that's a contract gap. If a DTO field doesn't serve any scenario, it's bloat.

### Scenario A — Netlify-hosted lander with live pricing

A static lander wants to display the current Bio Complete 3 price without hardcoding.

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_netlify_gundry_xyz"
        data-brand="Gundry MD"></script>

<div class="price-block">
  <span data-gh-product="bio-complete-3" data-field="variants.subscription.standard.0.price">…</span>
  <span class="strike" data-gh-product="bio-complete-3" data-field="variants.oneTime.standard.0.price">…</span>
</div>
```

Uses `HippoShopProductDTO` directly. The SDK reads `data-gh-product` attributes on `DOMContentLoaded`, fetches `gh.data.product('bio-complete-3')`, and writes resolved values into the spans.

### Scenario B — Lander Labs partner page that presents a destination's offer

A partner page wants to render a "claim this offer" card and link to the destination's funnel.

```ts
const dest = await window.gh.data.destination('d_oo_aff_os_qqq');
// dest.pricing.price.amount     → "$44.95"
// dest.pricing.rebillPrice      → "$44.95/month" (if subscription)
// dest.funnelSlug                → 'skin-quiz'
const funnel = await window.gh.data.funnel(dest.funnelSlug);
// CTA href = funnel.entryUrl
```

Uses `HippoShopDestinationDTO` + `HippoShopFunnelDTO`. Destination carries the displayed price; funnel reference is followed only if the partner wants step structure.

### Scenario C — GTM-injected widget on a partner site

A widget loaded via GTM on an affiliate's site wants to show a small "see the full skin quiz" deep-link.

```ts
const funnel = await window.gh.data.funnel('skin-quiz');
if (funnel.active) {
  renderPrompt({ name: funnel.name, href: funnel.entryUrl });
}
```

Uses `HippoShopFunnelDTO`. The `active` field lets the widget self-suppress on paused funnels — without it, the widget renders a dead link.

### Scenarios explicitly *not* supported in v1

- "Record this user as a lead." (No PII writes.)
- "Add this product to a cart that follows the user into the funnel." (Cross-origin cart state is a separate, harder problem.)
- "Track a conversion from my partner page." (Use existing pixel infrastructure.)
- "Pull A/B test variant for a specific user." (Variants are decided server-side at funnel entry. Exposing them externally corrupts the test data.)
- "Get a price personalized to this user." (No identity, no segmentation. MyAccount tier is exposed for guest-checkout funnel flows, not for personalized pricing.)

If a partner asks for any of the above, the answer is "v1 doesn't support that, here's the right channel today" — not "let's add a field." Saying no is the contract's job.

---

## 6. Versioning policy

- **Path versioning.** `/public/v1/*`. v2 is a parallel path; v1 never breaks. Consumers pin via the SDK they load (`gh.js@v1` vs `gh.js@v2`).
- **Additive within a major version is free.** New optional fields can be added without a major bump. Consumers that don't read them are unaffected.
- **Removing or changing a field is a major version bump.** Including renaming, narrowing a type, or changing nullable to non-nullable.
- **Behavior changes are major version bumps** even if shapes don't change. Example: redefining what `active: false` means functionally.
- **`@goldenhippo/sdk-types` major version matches the route prefix.**
- **Deprecation window: 12 months minimum** for any v1 → v2 migration once v2 exists. Partners need time; once a `<script>` tag is in a partner's HTML, you do not control when it gets updated. v1 endpoints will live for years — plan for it.

---

## 7. Kong + plugin stack (v1)

Single Kong service backing all three routes. Single consumer model. Same plugin stack applied at the service level.

```
Service: sdk-public-v1
  Upstream:  commerce-api → /public/v1/*
  Plugins:
    - key-auth          (key as X-GH-Key: gh_pk_...)
    - cors              (origins per consumer, exact-match enforcement)
    - rate-limiting     (per consumer, tier-based)
    - proxy-cache       (TTL: funnel 60s, destination 60s, product 120s)
    - response-transformer  (defense-in-depth field denylist)
    - request-validator (origin must match consumer's allowlist)

Consumer model:
  Each partner-property = one Kong consumer.
  Consumer carries: brand binding, origin allowlist, rate tier.

Routes:
  GET /public/v1/funnel/:slugOrId
  GET /public/v1/destination/:slugOrId
  GET /public/v1/product/:slugOrId

SDK script delivery:
  GET /sdk/v1/gh.js
  (Served from CDN, not commerce API. Decision pending: Cloudflare Pages or S3+CloudFront.)
```

**Per-environment:** `api-prod.goldenhippo.io` and `api-uat.goldenhippo.io` host parallel route trees. Partners receive separate keys per environment. The SDK accepts an `environment` config; defaults to `prod`.

**Cache invalidation:** TTL-based for v1. If a price change needs immediate propagation, the commerce API can call Kong's admin API to purge `proxy-cache` keys. Documented as a runbook, not automated.

**Defense in depth:** `response-transformer` strips a denylist of internal field-name patterns (e.g. `taxCode`, `*Id` keys not on the allow-set, `outOfStockEmailList`, `restockEta`) so that if a mapper bug ever leaks an internal field, Kong catches it before it reaches the network.

---

## 8. Resolved decisions

These questions were raised during contract design and have been answered. Recording them here so the rationale isn't lost and so future "should we add X?" requests have a precedent to point at.

1. **Destination → pricing shape.** Always a single `HippoShopPricingDTO` per destination — one product, one package quantity, one purchase type. If a destination needs to present a user-facing choice between variants, that's a funnel-level concern, not a destination concern. **Decision:** `pricing: HippoShopPricingDTO` (singular, required).

2. **`outOfStock` semantics.** Use the **top-level** `outOfStock` from the product feed, not `cms.cartOutOfStock`. This matches what funnels use today, so partners see the same OOS state the funnel app would. **Decision:** top-level only.

3. **HTML in product display fields.** v1 ships **no HTML-bearing fields**. All CMS-sourced display strings (`displayName`, `description`, `quote`, `subHeading`, `featuredImage`) are excluded. The DTO carries only top-level plain-text `name`, `category`, `image`, and `packaging`. Revisit if a partner scenario justifies the HTML-passthrough story; that's a v1.x additive change, not a v2 break.

4. **Old `/commerce/product/feed` migration.** Tracked as a separate ticket. The new `/public/v1/product/:slugOrId` will eventually replace external use of the legacy feed, and the legacy feed will be put behind auth for internal-only use. Not a blocker for SDK v1.

5. **Partner-onboarding mechanics.** **Kong Admin UI** for v1. Internal partner-relations team issues keys, configures origin allowlists, and assigns rate tiers directly. If/when this scales (more partners, more frequent onboarding), a small admin app gets built. **Initial use is internal-only**, so the manual Kong workflow is sufficient.

6. **CDN for SDK delivery.** **Cloudflare** (Pages or Workers, decided at SDK implementation time). Consumer-facing URL stays `https://api-prod.goldenhippo.io/sdk/v1/gh.js` regardless — Cloudflare is the underlying provider, not the public surface.

---

## 9. Implementation prerequisites

Before commerce API work starts, the team should:

- [ ] Confirm the destination → pricing derivation logic — specifically which fields on the internal destination/order-form structure feed the `productSlug`, `packageQuantity`, `purchaseType`, `price`, and `rebillPrice` outputs. This is the only piece of the contract whose internal source isn't fully documented above, and it will drive a few mapper-test cases.
- [ ] Verify the brand display-name → Salesforce brand-ID mapping is accessible from the commerce API (or trivial to populate). This is the tenancy enforcement boundary.
- [ ] Decide whether the integration tests for §3 rule 4 (response shape verification) live alongside route handlers or in a separate contract-test suite. Either works; pick the one that fits the existing test conventions.

---

## 10. Out of scope for this document

- The SDK package itself (`@goldenhippo/web-sdk`). Separate plan.
- CDN provisioning details (Cloudflare specifics).
- Kong declarative-config syntax.
- Partner-onboarding tooling (Kong Admin UI is the v1 mechanism).
- The `@goldenhippo/sdk-types` package mechanics — but its *contents* are §4 of this document.

---

## 11. Acceptance for "v1 DTO contract is ready to build against"

- [ ] §9 implementation prerequisites resolved.
- [ ] Commerce API team agrees the three routes are implementable against existing upstream services without significant new integration work.
- [ ] Each DTO field reviewed by someone who can speak to "does this leak something we don't intend to expose."
- [ ] `@goldenhippo/sdk-types` package scaffolded with the interfaces in §4, even if unpublished.
- [ ] One example response per route, hand-authored against real production data, agreed by both teams.

Once those check, the commerce API team can build handlers and the SDK package work can start in parallel against the example responses (mocking) until UAT routes are live.
