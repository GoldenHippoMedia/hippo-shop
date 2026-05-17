# Partner-facing README polish

**Status**: Draft
**Date**: 2026-05-16
**Target release**: docs-only; will ship in the next release PR alongside the staged feature changesets (`data-with`/`data-when` + quantity-keyed variants). No version bump from this work alone — npm consumes whatever README is in the published packages.

## Problem

The three READMEs (`README.md`, `packages/types/README.md`, `packages/sdk/README.md`) are published to GitHub and npm. They currently mix partner-facing usage docs with internal engineering content — references to "the commerce API mappers", "the API gateway", "the combined implementation plan", repository layout, Nx module boundaries, contributor setup, and the changesets release flow. A partner integrating the SDK or types into their own page doesn't need any of that, and seeing it suggests an early-stage internal project rather than a published library.

We're publishing the v2.x release imminently. This is the last chance to polish the docs before sharing the project broadly.

## Goal

Treat each README as the npm package's landing page. Strip everything an external partner doesn't need to know, add the examples they DO need, and use generic sample data so no real brand or product is featured in the docs.

Engineering-internal content (repo layout, dev setup, release process, architecture deep-dive) will live in the GitHub wiki, populated separately. README footers will link there.

## Non-goals

- Creating or populating the GitHub wiki content. That's a follow-up.
- Rewriting any prose that's already partner-appropriate.
- Adding marketing-style content (hero images, animated previews, badges beyond what's there).
- Changing package functionality. This is docs-only.
- Migrating the existing real-data demo HTML files in `apps/examples-static/` — those stay using `bio-complete-3` since they hit live UAT data and need real slugs to render.

## Generic data conventions

All examples in the published READMEs use these fictional, clearly non-real identifiers:

| Slot | Value |
|------|-------|
| Brand | `Sample Co` |
| Product slug | `multi-vitamin` |
| Product name | `Daily Multi-Vitamin` |
| Funnel slug | `multi-vitamin-funnel` |
| Funnel name | `Daily Multi-Vitamin — Main` |
| Destination slug | `multi-vitamin-3pack-sub` |
| Publishable key | `gh_pk_yourbrand_xxxxxx` (existing placeholder; keep) |
| Salesforce-style IDs (where they appear in DTO examples) | `01t000000000ABC`, `a8r000000000DEF` |

Pick consistent values across all three READMEs so a partner reading them in sequence sees a coherent story.

## Root `README.md` — new structure

Target line count: ~70 lines (down from 138).

### Sections to keep (with minor edits)

1. **Title + badges** — unchanged.
2. **Hero blurb** (line 7) — update for clarity. Suggested replacement:
   > *Typed, key-authenticated, brand-scoped public surface for Golden Hippo data — funnels, destinations, products — readable from external pages with two lines of HTML.*
   (Roughly unchanged; trim "pricing —" since "products" covers it.)
3. **Packages table** — keep, drop the trailing sentence about commerce API + gateway config. Replace with one short line: *"Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) via npm Trusted Publishers."*
4. **Using the SDK quickstart** — keep, update slug to `multi-vitamin` and brand to `Sample Co`.
5. **Accessing product variants by quantity** subsection — keep as-is. Already partner-facing.
6. **Declarative scope and loading states** subsection — keep as-is.
7. **License** — unchanged.

### Sections to remove

- Line 18 sentence about "commerce API (separate repo) and gateway config (platform)" + link to `docs/hippo-shop-combined-implementation-plan.md`.
- **Repository layout** section (lines 88-106).
- **Boundaries** section (lines 108-110).
- **Development** section (lines 112-122).
- **Releasing** section (lines 124-134).

### Sections to add

- **Contributors footer** — single line at the bottom of the file, just above the License section:
  > *Working on Hippo Shop itself? See the [development wiki](https://github.com/GoldenHippoMedia/hippo-shop/wiki) for setup, repository layout, and release process.*

## `packages/types/README.md` — restructured

Target line count: ~120 lines (up from 54; the addition is example responses).

### Final structure

1. **Title + badges** — unchanged.
2. **Hero blurb** — rewrite to remove producer/consumer framing:
   > *TypeScript type definitions for the Hippo Shop public API. Zero runtime dependencies — install in your project for IntelliSense and compile-time safety against the live API contract.*
   (Drops "consumed by both the commerce API's DTO mappers and the SDK's typed client so that producer and consumer share the contract literally, not by convention.")
3. **Cross-link line** — unchanged: *"Runtime SDK: [`@goldenhippo/hippo-shop-sdk`](...)"*. Drop the "Source:" link to the repo (badges already provide that).
4. **Installation** — unchanged.
5. **Usage** — keep the import snippet. Add a 4-line example of a typed fetch:
   ```ts
   const res = await fetch('https://api-prod.goldenhippo.io/public/v1/product/multi-vitamin', {
     headers: { 'X-GH-Key': 'gh_pk_yourbrand_xxxxxx', 'X-GH-Brand': 'Sample Co' },
   });
   const product: HippoShopProductDTO = await res.json();
   ```
   Briefly: *"In production, most pages use the SDK's auto-fetching declarative bindings — see `@goldenhippo/hippo-shop-sdk` — but for SSR, edge functions, or custom rendering you can call the API directly."*
6. **Three DTOs** table — keep.
7. **NEW: Example responses** — one JSON block per DTO (funnel, destination, product) using the generic data conventions. Compact, real-shape JSON. The product example shows the full variants tree including `standardList`, `standardByQuantity`, `myAccountList`/`myAccountByQuantity` (empty arrays/objects are fine for tier dimensions a generic product wouldn't have).
8. **Versioning** section — keep, slight rewording to drop "API major" framing: *"Semver. Major versions track breaking changes to the public API contract. Minor and patch versions are additive only."*
9. **No runtime validation** — rewrite to drop internal architecture references:
   > *These are types only — no runtime validation. If you need to validate response bodies at the network boundary, use a runtime schema library like [Zod](https://zod.dev) or [io-ts](https://github.com/gcanti/io-ts).*
   (Drop "The SDK trusts what comes back from the gateway; the commerce API has its own internal validation" and the speculative `@goldenhippo/hippo-shop-types-zod` companion.)
10. **Provenance** — unchanged.
11. **License** — unchanged.

### Example response objects

Embed each as a fenced JSON code block. The product example needs full variants tree; funnel and destination are smaller.

**HippoShopFunnelDTO sample** — show ~5 steps mixing several `kind` values:

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

**HippoShopDestinationDTO sample** — show subscription with frequency, one bump offer, generic Salesforce IDs:

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

**HippoShopProductDTO sample** — show full variants tree with subscription and one-time tiers, including 1/3/6 quantities, and an empty `myAccount` tier so partners see the shape:

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
      "standard": [ /* deprecated mirror — same content as standardList */ ],
      "standardList": [
        { "productId": "p_01...", "variantId": "v_01...A1", "sku": "MV-SUB-1", "price": 34.95, "rebillPrice": 34.95, "quantity": 1, "packageType": "bottle", "savings": null, "alternatePurchaseTypePrice": 39.95, "defaultFrequency": { "interval": 1, "scale": "month", "publicInterval": 1, "publicScale": "month", "value": "30-day", "label": "Every 30 Days" } },
        { "productId": "p_01...", "variantId": "v_01...A3", "sku": "MV-SUB-3", "price": 89.95, "rebillPrice": 89.95, "quantity": 3, "packageType": "bottle", "savings": 24.90, "alternatePurchaseTypePrice": 104.85, "defaultFrequency": { "interval": 3, "scale": "month", "publicInterval": 3, "publicScale": "month", "value": "90-day", "label": "Every 90 Days" } },
        { "productId": "p_01...", "variantId": "v_01...A6", "sku": "MV-SUB-6", "price": 169.95, "rebillPrice": 169.95, "quantity": 6, "packageType": "bottle", "savings": 79.75, "alternatePurchaseTypePrice": 199.70, "defaultFrequency": { "interval": 6, "scale": "month", "publicInterval": 6, "publicScale": "month", "value": "180-day", "label": "Every 180 Days" } }
      ],
      "standardByQuantity": {
        "1": { /* same shape as standardList[0] */ },
        "3": { /* same shape as standardList[1] */ },
        "6": { /* same shape as standardList[2] */ }
      },
      "myAccount": [],
      "myAccountList": [],
      "myAccountByQuantity": {}
    },
    "oneTime": {
      "standard": [ /* deprecated mirror */ ],
      "standardList": [
        { "productId": "p_01...", "variantId": "v_01...B1", "sku": "MV-OT-1", "price": 39.95, "rebillPrice": null, "quantity": 1, "packageType": "bottle", "savings": null, "alternatePurchaseTypePrice": 34.95, "defaultFrequency": null },
        { "productId": "p_01...", "variantId": "v_01...B3", "sku": "MV-OT-3", "price": 104.85, "rebillPrice": null, "quantity": 3, "packageType": "bottle", "savings": null, "alternatePurchaseTypePrice": 89.95, "defaultFrequency": null }
      ],
      "standardByQuantity": {
        "1": { /* … */ },
        "3": { /* … */ }
      },
      "myAccount": [],
      "myAccountList": [],
      "myAccountByQuantity": {}
    }
  }
}
```

Use `/* … */` placeholders for repeat content rather than full duplication to keep the README readable; the table-of-contents pattern partners need to see is clear from the first occurrence.

## `packages/sdk/README.md` — light edits + Recipes section

Target line count: ~330 lines (up from 260; addition is the Recipes section).

### Edits

1. Line 12: *"Both share the same auth, caching, and brand-tenancy guardrails enforced at the API gateway."* → *"Both share the same auth, caching, and brand-scoped access rules enforced by the API."*
2. Line 166: *"The runtime now binds twice per pass: once with unloaded resources marked 'loading' (skeletons appear before the network round-trip), then again after fetches settle. `gh:bindings-ready` continues to fire once, after the post-fetch pass."*
   →
   *"Loading skeletons render immediately on page load; the SDK swaps in real values when data arrives. The `gh:bindings-ready` event fires once, after the initial data fetch settles."*
3. Replace `bio-complete-3` with `multi-vitamin` in the Quickstart code block (lines 47-65). Also in the inline `data-key="gh_pk_netlify_gundry_xyz"` value — change to the generic `gh_pk_yourbrand_xxxxxx` already used elsewhere on the page.
4. In the **Loops** section example (lines 116-124), the `data-gh-product="bio-complete-3"` → `data-gh-product="multi-vitamin"`.
5. In the **Resource lifecycle (`data-when`)** section example (lines 155-163), same replacement.

### New section — Recipes (insert after "Resource lifecycle" + before "Evaluation order")

```markdown
## Recipes

Copy-paste patterns for the most common partner integrations. All use the example product slug `multi-vitamin`; swap in your own slug and brand.

### Quantity ladder (side-by-side pricing cards)

Three cards bound to the 1-pack, 3-pack, and 6-pack subscription tiers. Each card uses `data-with` so its descendants address relative fields. Any quantity the catalog doesn't carry stays hidden automatically.

\`\`\`html
<section data-gh-product="multi-vitamin" class="tier-grid">
  <article class="tier" data-with="variants.subscription.standardByQuantity.1">
    <h3>1-Month Supply</h3>
    <p class="price"><span data-field="price" data-format="currency:USD"></span> /mo</p>
    <p class="cadence" data-if="defaultFrequency">
      Renews <span data-field="defaultFrequency.label"></span>
    </p>
  </article>

  <article class="tier" data-with="variants.subscription.standardByQuantity.3">
    <span class="ribbon" data-if="savings">Save <span data-field="savings" data-format="currency:USD"></span></span>
    <h3>3-Month Supply</h3>
    <p class="price"><span data-field="price" data-format="currency:USD"></span></p>
    <p class="cadence" data-if="defaultFrequency">
      Renews <span data-field="defaultFrequency.label"></span>
    </p>
  </article>

  <article class="tier featured" data-with="variants.subscription.standardByQuantity.6">
    <span class="ribbon">Best Value</span>
    <h3>6-Month Supply</h3>
    <p class="price"><span data-field="price" data-format="currency:USD"></span></p>
    <p class="savings" data-if="savings">
      Save <span data-field="savings" data-format="currency:USD"></span>
    </p>
  </article>
</section>
\`\`\`

### Subscription vs one-time tier picker

Show the same package's price under both purchase types, with a small comparison line. No JS — `alternatePurchaseTypePrice` on each variant carries the price for the opposite purchase type, so a single bind gets both.

\`\`\`html
<article data-gh-product="multi-vitamin" data-with="variants.subscription.standardByQuantity.3">
  <h2>3-Month Supply</h2>

  <p class="price-sub">
    Subscribe and save:
    <strong data-field="price" data-format="currency:USD"></strong>
  </p>

  <p class="price-onetime" data-if="alternatePurchaseTypePrice">
    Or pay once:
    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD"></span>
  </p>
</article>
\`\`\`

### Loading skeleton + error fallback

Show a pulsing skeleton while the product loads, an error message if the fetch fails, and the real content on success. All three states are sibling `data-when` blocks; the SDK picks the right one each render pass.

\`\`\`html
<article data-gh-product="multi-vitamin" class="card">
  <div data-when="loading" class="card-skeleton" aria-busy="true">
    <div class="skel-image"></div>
    <div class="skel-lines">
      <div class="skel-line"></div>
      <div class="skel-line short"></div>
    </div>
  </div>

  <div data-when="failed" class="card-error" role="alert">
    <p>This product is temporarily unavailable. <a href="/products">See other products →</a></p>
  </div>

  <div data-when="loaded" class="card-content">
    <img data-attr-src="image" data-attr-alt="name" />
    <h2 data-field="name"></h2>
    <p class="price">
      <span data-field="variants.subscription.standardByQuantity.3.price"
            data-format="currency:USD"></span>
    </p>
  </div>
</article>

<style>
  .skel-image, .skel-line {
    background: #e5e7eb;
    border-radius: 4px;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50%      { opacity: 1; }
  }
</style>
\`\`\`

### Custom formatter — "Save 23% off"

Register your own formatter once on `gh:data-ready`, then bind any field through it. This pattern is the right way to express derived values (percentages, computed labels, currency-in-words) without adding per-page JS to every binding.

\`\`\`html
<script>
  window.addEventListener('gh:data-ready', () => {
    window.gh.format.register('savePercent', (savings, fullPriceStr) => {
      const full = Number(fullPriceStr);
      if (!savings || !Number.isFinite(full) || full === 0) return '';
      return 'Save ' + Math.round((savings / (full + savings)) * 100) + '%';
    });
    window.gh.refresh(); // re-bind so existing pages pick up the new formatter
  }, { once: true });
</script>

<article data-gh-product="multi-vitamin" data-with="variants.subscription.standardByQuantity.6">
  <p class="badge" data-if="savings">
    <span data-field="savings" data-format="savePercent:169.95"></span>
  </p>
  <p class="price"><span data-field="price" data-format="currency:USD"></span></p>
</article>
\`\`\`

Formatters receive the bound value as their first argument; additional `:`-separated values from `data-format` are passed as string arguments (so the `:169.95` above arrives as a string and `Number()`'s back to a float).
```

### Section to leave alone

Everything from "Lifecycle events" through "License" stays as-is. Cross-references, the bundle-size note, and the provenance line are all partner-facing already.

## Risks and tradeoffs

- **Wiki link is a forward reference.** The README footer links to `https://github.com/GoldenHippoMedia/hippo-shop/wiki` before the wiki has any content. That's acceptable for v2.x — GitHub renders a "Create the first page" affordance on an empty wiki, which is fine for the first wave of contributors but unwelcoming to drive-by visitors. Mitigate by creating at least one wiki page ("Development setup") at the same time as the README polish ships, or accept the empty-wiki experience and remediate immediately after.
- **Removing dev sections loses local discoverability.** Today, a contributor cloning the repo can read the root README and learn how to build/test/release. After this change they need to find the wiki. Acceptable since the wiki link is right there and contributor onboarding is a separate concern.
- **JSON examples drift from reality.** The types README's JSON samples are hand-authored and could drift from the actual DTO shape if types change without README updates. Mitigation: keep the samples deliberately compact (one variant per dimension, `/* … */` placeholders); add a `CHANGELOG`-style note to the README if a DTO shape changes meaningfully.
- **`bio-complete-3` still appears in the static demo files.** That's intentional and out of scope here. The demo files run against live UAT data; they need real slugs.

## Out of scope

- Populating the GitHub wiki. The footer link will work eventually; content lives elsewhere.
- Migrating the static demo files away from `bio-complete-3`. They consume live UAT data and need real slugs.
- Updating the existing `docs/` markdown files (release-process, kong-public-routing, etc.). Those continue to live in-repo as engineering reference; only the root README's *links* to them are being removed.
- Adding a `CHANGELOG.md` or `CONTRIBUTING.md` at the root. The wiki will house the equivalent content.
- Localized README versions or screenshots/animated GIFs.
