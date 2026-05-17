# Partner-Facing README Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip engineering-internal content from the three published README files (root, types, sdk) and replace it with partner-facing usage docs, generic example data, and copy-paste recipes.

**Architecture:** Docs-only refactor. Five small commits, each touching one README file or doing a final consistency pass. No code or test changes. Engineering content (repo layout, dev setup, release process) is removed from READMEs and will live in a future GitHub wiki, linked from a one-line footer.

**Tech Stack:** Markdown only. No build steps required, but a final `pnpm build` pass confirms the published `packages/*/dist/` artifacts pick up the new README files.

**Spec:** `docs/superpowers/specs/2026-05-16-readme-polish-design.md`

---

## File Structure

**Modified:**
- `README.md` (root) — strip dev sections, swap real-data examples for generic ones, add wiki footer.
- `packages/types/README.md` — rewrite hero, drop internal references, add example response JSON for each DTO.
- `packages/sdk/README.md` — light wording edits to remove internal mechanics, swap real-data slugs for generic ones, add new "Recipes" section.

**Created:**
- None.

---

## Generic data conventions (used across all three READMEs)

Use these identifiers consistently in every example:

| Slot | Value |
|------|-------|
| Brand display name | `Sample Co` |
| Product slug | `multi-vitamin` |
| Product display name | `Daily Multi-Vitamin` |
| Funnel slug | `multi-vitamin-funnel` |
| Funnel display name | `Daily Multi-Vitamin — Main` |
| Destination slug | `multi-vitamin-3pack-sub` |
| Publishable key placeholder | `gh_pk_yourbrand_xxxxxx` |
| Salesforce-style ID examples | `01t000000000ABC`, `a8r000000000DEF`, etc. |

---

## Task 1: Polish root `README.md`

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Replace the entire file with the new content**

Open `/Users/stevenhall/Code/hippo-shop/README.md` and replace its entire contents with:

```markdown
# Hippo Shop

[![CI](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/ci.yml/badge.svg)](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/ci.yml)
[![Release](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/release.yml/badge.svg)](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/release.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Typed, key-authenticated, brand-scoped public surface for Golden Hippo data — funnels, destinations, products — readable from external pages with two lines of HTML.

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| [`@goldenhippo/hippo-shop-sdk`](./packages/sdk) | [![npm](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-sdk.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk) | Browser SDK. Auto-boots from a `<script>` tag, exposes declarative `data-gh-*` bindings and a programmatic `window.gh.data` API. |
| [`@goldenhippo/hippo-shop-types`](./packages/types) | [![npm](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types) | DTO contract. Zero runtime dependencies, pure TypeScript types. |

Both are published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) via npm Trusted Publishers.

## Quickstart

Drop one `<script>` tag and write your HTML — no install required:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_yourbrand_xxxxxx"
        data-brand="Sample Co"></script>

<article data-gh-product="multi-vitamin">
  <h2 data-field="name">Loading…</h2>
  <span data-field="variants.subscription.standardByQuantity.6.price"
        data-format="currency:USD"></span>
</article>
```

See [`packages/sdk/README.md`](./packages/sdk/README.md) for the full attribute and formatter reference, recipes, and lifecycle events.

### Accessing product variants by quantity

A product's variant tree supports direct lookup by `quantity` alongside iteration:

- `variants.<purchase>.<tier>ByQuantity['3']` — variant for the 3-pack, or `undefined` if no 3-pack exists.
- `variants.<purchase>.<tier>List` — ordered array, suitable for `<template data-each>`.
- `variants.<purchase>.<tier>` — **deprecated** array shape, removed in v3.0.0.

Where `<purchase>` is `subscription` or `oneTime` and `<tier>` is `standard` or `myAccount`.

In HTML bindings:

```html
<span data-field="variants.subscription.standardByQuantity.6.price"
      data-format="currency:USD:en-US">$0.00</span>
```

In JavaScript:

```js
const product = await window.gh.data.product('multi-vitamin');
const sixPack = product.variants.subscription.standardByQuantity['6'];
if (sixPack) renderPrice(sixPack.price);
```

Missing quantities resolve to `undefined`; `data-field` leaves the placeholder text in place and `data-if` hides the element.

### Declarative scope and loading states

Two attributes complete the binding miss-handling story:

- `data-with="path"` narrows the binding scope for the element and its descendants. If the path resolves to `null` / `undefined`, the element hides cleanly. Use it for direct-lookup cards (a 6-pack tier, an FAQ item) where you'd otherwise repeat the path on every nested field.

- `data-when="loaded | loading | failed"` shows the element only when the closest resource ancestor is in that lifecycle state. Use it for skeletons, error fallbacks, and "real" content blocks that should only render after data arrives.

```html
<article data-gh-product="multi-vitamin">
  <div data-when="loading" class="skeleton" aria-busy="true">…</div>
  <div data-when="failed" class="error">Couldn't load.</div>
  <div data-when="loaded">
    <h2 data-field="name"></h2>
    <div data-with="variants.subscription.standardByQuantity.6">
      <p class="price"><span data-field="price" data-format="currency:USD:en-US"></span></p>
    </div>
  </div>
</article>
```

Loading skeletons render immediately on page load; the SDK swaps in real values when data arrives.

---

*Working on Hippo Shop itself? See the [development wiki](https://github.com/GoldenHippoMedia/hippo-shop/wiki) for setup, repository layout, and release process.*

## License

MIT. See [LICENSE](./LICENSE).
```

- [ ] **Step 2: Verify the file rendered correctly**

Run:
```bash
wc -l README.md
grep -n "multi-vitamin\|Sample Co\|gh_pk_yourbrand" README.md
grep -n "Repository layout\|Boundaries\|## Development\|## Releasing\|combined-implementation-plan\|commerce API" README.md
```

Expected output:
- `wc -l` shows roughly 80-90 lines (down from 138).
- First grep shows multiple matches (the generic identifiers are present in code blocks).
- Second grep returns **zero matches** — all the dev-internal sections and references are gone.

If any of the second-grep terms still appear, find and remove them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): strip dev content; use generic sample data

Removes the Repository layout, Boundaries, Development, and Releasing
sections from the root README — engineering setup will live in the
GitHub wiki. Swaps the real-product 'bio-complete-3' slug for the
generic 'multi-vitamin' across examples, and uses 'Sample Co' as the
demo brand. Adds a one-line wiki footer for contributors."
```

---

## Task 2: Polish `packages/types/README.md` — structural rewrite

**Files:**
- Modify: `packages/types/README.md` (everything except the example response JSON blocks, which are added in Task 3)

- [ ] **Step 1: Replace the entire file**

Open `/Users/stevenhall/Code/hippo-shop/packages/types/README.md` and replace its entire contents with:

```markdown
# @goldenhippo/hippo-shop-types

[![npm version](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)
[![types](https://img.shields.io/npm/types/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

TypeScript type definitions for the Hippo Shop public API. Zero runtime dependencies — install in your project for IntelliSense and compile-time safety against the live API contract.

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

<!-- TASK 3 INSERT POINT: example response JSON blocks go here -->

## Versioning

Semver. Major versions track breaking changes to the public API contract. Minor and patch versions are additive only.

## No runtime validation

These are types only — no runtime validation. If you need to validate response bodies at the network boundary, use a runtime schema library like [Zod](https://zod.dev) or [io-ts](https://github.com/gcanti/io-ts).

## Provenance

Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) attestation via npm Trusted Publishers + GitHub Actions OIDC.

## License

MIT. See [LICENSE](./LICENSE).
```

Leave the `<!-- TASK 3 INSERT POINT: ... -->` comment in place. Task 3 will replace it with the actual JSON examples.

- [ ] **Step 2: Verify the structural rewrite**

Run:
```bash
grep -n "DTO mappers\|producer and consumer\|combined-implementation-plan\|hippo-shop-types-zod\|the gateway\|the commerce API" packages/types/README.md
```

Expected: zero matches. All the internal-architecture references are gone.

Run:
```bash
grep -c "TASK 3 INSERT POINT" packages/types/README.md
```

Expected: `1` — the placeholder is still present, awaiting Task 3.

- [ ] **Step 3: Commit**

```bash
git add packages/types/README.md
git commit -m "docs(types-readme): strip internal references; add typed-fetch example

Rewrites the hero to drop producer/consumer framing. Adds a typed-fetch
snippet using generic 'multi-vitamin' product data. Removes references
to the commerce API's DTO mappers, the gateway, the combined
implementation plan, and the speculative hippo-shop-types-zod companion
package. Replaces the No-runtime-validation justification with a
practical 'use Zod or io-ts if you need this' pointer. Leaves a
placeholder comment for the example-response JSON blocks landing in
the next commit."
```

---

## Task 3: Add example response JSON to `packages/types/README.md`

**Files:**
- Modify: `packages/types/README.md` (replace the `<!-- TASK 3 INSERT POINT -->` placeholder with three JSON blocks)

- [ ] **Step 1: Replace the placeholder with the example response blocks**

In `packages/types/README.md`, find the line:

```
<!-- TASK 3 INSERT POINT: example response JSON blocks go here -->
```

Replace that single line with:

````markdown
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

The variant tree is the largest part of the product response. Each price-level branch (`subscription.standard`, `subscription.myAccount`, `oneTime.standard`, `oneTime.myAccount`) contains three sibling fields: the deprecated array, an ordered `…List` for iteration, and a `…ByQuantity` record keyed by stringified quantity for direct lookup.

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
      "standard": [
        /* deprecated mirror of standardList — removed in v3.0.0 */
      ],
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
      "myAccount": [],
      "myAccountList": [],
      "myAccountByQuantity": {}
    },
    "oneTime": {
      "standard": [
        /* deprecated mirror of standardList */
      ],
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
      "myAccount": [],
      "myAccountList": [],
      "myAccountByQuantity": {}
    }
  }
}
```

The `/* … */` comments inside the JSON above are illustrative — the real response includes the full object at each entry; they're elided here to keep the example readable. The `myAccount` tier is empty in this sample because the product isn't enrolled in the My Account tier program; most products show empty arrays and an empty record there.
````

- [ ] **Step 2: Verify the JSON examples landed**

Run:
```bash
grep -c "HippoShopFunnelDTO\|HippoShopDestinationDTO\|HippoShopProductDTO" packages/types/README.md
grep -c "TASK 3 INSERT POINT" packages/types/README.md
grep -c '"standardByQuantity"' packages/types/README.md
```

Expected:
- First grep ≥ 6 (each DTO name appears at least twice: in the table + in the example heading).
- Second grep is `0` (placeholder removed).
- Third grep ≥ 2 (subscription and oneTime branches both show standardByQuantity).

- [ ] **Step 3: Verify the JSON is parseable** (sanity check — the comments and trailing-comma-free JSON make it parseable IF you ignore the `/* ... */` placeholders)

Run:
```bash
# Extract the funnel example and verify it parses
sed -n '/### `HippoShopFunnelDTO`/,/^### /p' packages/types/README.md | sed -n '/^```json$/,/^```$/p' | sed '1d;$d' | node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log("OK:", j.steps.length, "steps");'
```

Expected: `OK: 5 steps`. If it fails, the JSON has a syntax error — fix before committing.

The destination and product examples contain `/* ... */` placeholders that make them non-parseable as raw JSON; this is intentional (they're illustrative reference). Don't try to parse those.

- [ ] **Step 4: Commit**

```bash
git add packages/types/README.md
git commit -m "docs(types-readme): add example response JSON for each DTO

Three fenced JSON blocks (funnel, destination, product) showing the
full response shape using the fictional 'multi-vitamin' product on
the 'Sample Co' brand. The product example demonstrates the variant
tree including standardList + standardByQuantity siblings; uses
/* ... */ placeholders inside the byQuantity record to keep the
example compact without duplicating each variant three times."
```

---

## Task 4: Polish `packages/sdk/README.md` — light edits + Recipes section

**Files:**
- Modify: `packages/sdk/README.md` (in three discrete edits, plus one new section)

- [ ] **Step 1: Apply the four light wording / data-fix edits**

Open `packages/sdk/README.md`.

**Edit A** — Line 12 (the hero paragraph):

Find: `Both share the same auth, caching, and brand-tenancy guardrails enforced at the API gateway.`

Replace with: `Both share the same auth, caching, and brand-scoped access rules enforced by the API.`

**Edit B** — In the Quickstart section's code block, find the `<script>` line:

```
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_netlify_gundry_xyz"
        data-brand="Gundry MD"></script>
```

Replace with:

```
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_yourbrand_xxxxxx"
        data-brand="Sample Co"></script>
```

Also in the Quickstart code block, replace every occurrence of `data-gh-product="bio-complete-3"` with `data-gh-product="multi-vitamin"`.

**Edit C** — In the Loops section, find the example code block (around lines 116-124). It contains `data-gh-product="bio-complete-3"`. Change to `data-gh-product="multi-vitamin"`.

**Edit D** — In the `Resource lifecycle (data-when)` section, find the example block (around lines 155-163) that contains `data-gh-product="bio-complete-3"`. Change to `data-gh-product="multi-vitamin"`.

**Edit E** — Find the paragraph that explains the two-pass binding mechanic (around line 166):

```
The runtime now binds twice per pass: once with unloaded resources marked `'loading'` (skeletons appear before the network round-trip), then again after fetches settle. `gh:bindings-ready` continues to fire once, after the post-fetch pass.
```

Replace with:

```
Loading skeletons render immediately on page load; the SDK swaps in real values when data arrives. The `gh:bindings-ready` event fires once, after the initial data fetch settles.
```

- [ ] **Step 2: Insert the new Recipes section between "Resource lifecycle" and "Evaluation order"**

Find the line `## Evaluation order` in the file. Just BEFORE that heading (and after the closing of the `Resource lifecycle (data-when)` section), insert the following block. Leave the existing `## Evaluation order` and everything that follows it untouched.

````markdown
## Recipes

Copy-paste patterns for the most common partner integrations. All use the example product slug `multi-vitamin`; swap in your own slug and brand.

### Quantity ladder (side-by-side pricing cards)

Three cards bound to the 1-pack, 3-pack, and 6-pack subscription tiers. Each card uses `data-with` so its descendants address relative fields. Any quantity the catalog doesn't carry stays hidden automatically.

```html
<section data-gh-product="multi-vitamin" class="tier-grid">
  <article class="tier" data-with="variants.subscription.standardByQuantity.1">
    <h3>1-Month Supply</h3>
    <p class="price"><span data-field="price" data-format="currency:USD"></span> /mo</p>
    <p class="cadence" data-if="defaultFrequency">
      Renews <span data-field="defaultFrequency.label"></span>
    </p>
  </article>

  <article class="tier" data-with="variants.subscription.standardByQuantity.3">
    <span class="ribbon" data-if="savings">
      Save <span data-field="savings" data-format="currency:USD"></span>
    </span>
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
```

### Subscription vs one-time tier picker

Show the same package's price under both purchase types, with a small comparison line. No JS — `alternatePurchaseTypePrice` on each variant carries the price for the opposite purchase type, so a single bind gets both.

```html
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
```

### Loading skeleton + error fallback

Show a pulsing skeleton while the product loads, an error message if the fetch fails, and the real content on success. All three states are sibling `data-when` blocks; the SDK picks the right one each render pass.

```html
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
```

### Custom formatter — "Save 23% off"

Register your own formatter once on `gh:data-ready`, then bind any field through it. This pattern is the right way to express derived values (percentages, computed labels, currency-in-words) without adding per-page JS to every binding.

```html
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
```

Formatters receive the bound value as their first argument; additional `:`-separated values from `data-format` are passed as string arguments (so the `:169.95` above arrives as a string and `Number()`'s back to a float).

````

- [ ] **Step 3: Verify the edits and the new section**

Run:
```bash
grep -c "bio-complete-3" packages/sdk/README.md
grep -c "gundry\|Gundry MD" packages/sdk/README.md
grep -c "API gateway" packages/sdk/README.md
grep -c "binds twice per pass\|round-trip" packages/sdk/README.md
grep -c "## Recipes" packages/sdk/README.md
grep -c "Quantity ladder\|tier picker\|Loading skeleton\|Custom formatter" packages/sdk/README.md
```

Expected:
- First three greps: `0` (real brand/product references gone, internal "API gateway" wording gone).
- Fourth grep: `0` (the internal "binds twice per pass" prose is replaced).
- Fifth grep: `1` (the new Recipes heading exists).
- Sixth grep: `4` (all four recipe subsections present).

If any of the first four return non-zero, find and fix before committing.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "docs(sdk-readme): polish wording and add Recipes section

Three rewrites:
- Hero drops the 'API gateway' wording in favor of 'enforced by the API'.
- The two-pass-binding paragraph is replaced with a partner-observable
  description: skeletons render immediately, real values swap in on data.
- Every 'bio-complete-3' / 'Gundry MD' / netlify-keyed example is swapped
  for the generic 'multi-vitamin' / 'Sample Co' / 'gh_pk_yourbrand_xxxxxx'.

New 'Recipes' section adds four copy-paste patterns: quantity ladder
(data-with per card), subscription-vs-one-time tier picker (uses
alternatePurchaseTypePrice), loading skeleton + failed fallback
(data-when), and a custom-formatter showcase computing 'Save 23% off'."
```

---

## Task 5: Final consistency sweep + build verification

**Files:**
- None modified (verification only)

- [ ] **Step 1: Run consistency greps across all three README files**

Run:
```bash
echo "=== Generic identifiers ==="
grep -c "multi-vitamin\|Sample Co\|gh_pk_yourbrand" README.md packages/types/README.md packages/sdk/README.md

echo "=== Real-data references (should all be 0) ==="
grep -c "bio-complete-3\|Gundry MD\|gh_pk_netlify_gundry\|gh_pk_test_all_feab8e2" README.md packages/types/README.md packages/sdk/README.md

echo "=== Internal-architecture references (should all be 0) ==="
grep -c "DTO mappers\|producer and consumer\|API gateway\|combined-implementation-plan\|hippo-shop-types-zod\|the commerce API" README.md packages/types/README.md packages/sdk/README.md

echo "=== Dev/contributor sections in root (should be 0) ==="
grep -c "^## Repository layout\|^## Boundaries\|^## Development\|^## Releasing" README.md

echo "=== Wiki footer link ==="
grep -c "github.com/GoldenHippoMedia/hippo-shop/wiki" README.md
```

Expected outputs:
- Generic identifiers: ≥ 1 in each file (multiple references in each).
- Real-data references: `0` for every file.
- Internal-architecture references: `0` for every file.
- Dev/contributor sections in root: `0`.
- Wiki footer link: `1` (the new footer).

If any expected-zero count is nonzero, identify the surviving reference and fix it before committing.

- [ ] **Step 2: Run a full build to confirm READMEs are picked up by the package dist**

Run:
```bash
pnpm build 2>&1 | tail -5
```

Expected: `NX   Successfully ran target build for 3 projects` (or similar). The build doesn't compile READMEs, but it confirms nothing was broken by the doc edits.

Also verify the `files` field in each `package.json` includes `README.md` (it should already — this is just confirmation):

```bash
grep -A 6 '"files":' packages/types/package.json packages/sdk/package.json
```

Expected: each `files` array includes `"README.md"` (or `"dist"` plus the README is at the package root, which `pnpm publish` picks up by default).

- [ ] **Step 3: Verify the typecheck + tests still pass (sanity, since this is docs-only)**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-types typecheck \
  && pnpm --filter @goldenhippo/hippo-shop-sdk typecheck \
  && pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all exit 0. No tests should be affected by README changes.

- [ ] **Step 4: Eyeball the rendered output**

Run:
```bash
wc -l README.md packages/types/README.md packages/sdk/README.md
```

Expected approximate sizes:
- `README.md`: 75-95 lines (down from 138).
- `packages/types/README.md`: 200-260 lines (up from 54 due to JSON examples).
- `packages/sdk/README.md`: 380-440 lines (up from 260 due to the Recipes section).

If sizes are wildly off, eyeball the actual files (`head -30` and `tail -30` on each) to confirm the structure looks right.

- [ ] **Step 5: No commit needed for this task**

This task is verification-only. If everything passes, no commit; if anything failed and required a fix in one of the earlier tasks, that fix should be a small follow-up commit with a `docs(readme): ...` message describing what was corrected.

---

## Out of scope

- Populating the GitHub wiki at `https://github.com/GoldenHippoMedia/hippo-shop/wiki`. The README footer links there as a forward reference; wiki content lives elsewhere and is created separately.
- Migrating `apps/examples-static/*.html` away from `bio-complete-3` and Gundry MD. Those files hit live UAT data and need real slugs to render.
- Modifying `docs/*.md` (release-process, kong-public-routing, etc.). They continue to live in-repo as engineering reference; only the root README's *links* to them are being removed.
- Adding a `CHANGELOG.md` or `CONTRIBUTING.md` at the root. The wiki will house equivalent content.
- Adding screenshots, animated previews, or marketing copy beyond the existing one-line hero.

## Risks

- **Empty-wiki footer link.** The README footer points to `https://github.com/GoldenHippoMedia/hippo-shop/wiki` before any wiki page exists. GitHub will render a "Create the first page" affordance for repo maintainers and a generic "wiki is empty" view for everyone else. Acceptable for the npm publish window; should be remediated by creating at least one wiki page ("Development setup") shortly after this lands.
- **JSON examples drift.** The types README's JSON samples are hand-authored and could drift from the actual DTO shape if `packages/types/src/*.ts` changes meaningfully without a paired README update. Mitigation: keep the JSON deliberately compact (one variant per dimension, `/* ... */` placeholders) and add a note to the changeset whenever a DTO shape changes.
- **Two README files now reference each other for cross-discovery.** The root README sends partners to `packages/sdk/README.md` and `packages/types/README.md`; the types README sends partners to the SDK README. If a package is renamed or moved, all three READMEs need updating. Mitigation: the cross-links use the canonical npm package names, which are far less likely to change than file paths.
