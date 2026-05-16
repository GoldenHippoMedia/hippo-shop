# Quantity-keyed variant access

**Status**: Draft  
**Date**: 2026-05-16  
**Target release**: `@goldenhippo/hippo-shop-types@2.1.0`, `@goldenhippo/hippo-shop-sdk@2.1.0` (minor, non-breaking)  
**Removes**: deprecated array shape — planned for `v3.0.0`

## Problem

Today, a partner who wants to bind a product price to the page must index into the variant array by position:

```html
<span data-field="variants.subscription.standard.0.price">$0.00</span>
```

The `0` is the first item in `HippoShopProductDTO.variants.subscription.standard[]`. Position is unstable — it depends on how the catalog happens to order packages — and meaningless to the author. What partners actually want to say is "the price for the **3-pack** subscription," not "the price for the first item in whatever order the API returned."

The current arrays remain the right shape for *iteration* (`<template data-each=…>` over all packages), but they're the wrong shape for *direct lookup*.

## Goal

Allow partners to access a variant by its `quantity` value in both surfaces:

- **HTML binding** — `data-field="variants.subscription.standardByQuantity.3.price"`
- **JS API** — `product.variants.subscription.standardByQuantity['3'].price`

The contract is the path chain: `variants → purchase type → price level → quantity → variant fields`. Missing quantities resolve to `undefined` (no throw, no error), which the existing `getByPath` resolver, `data-field`, and `data-if` already handle correctly.

Iteration (looping over all package options) must continue to work.

## Non-goals

- Server-side wire format changes (the SDK derives the new fields).
- A separate `getVariant(...)` helper method on the SDK class — optional chaining is sufficient.
- Explicit `null` entries for "known-absent" quantities.
- Distinguishing "this quantity isn't offered" from "we don't track this quantity."

## Design

### Type changes — `packages/types/src/product.ts`

`HippoShopProductVariantsDTO` is reshaped so each `{subscription, oneTime} × {standard, myAccount}` branch carries three sibling fields:

1. The existing array, marked `@deprecated` and removed in v3.
2. A `…List` array (iteration; same content as the deprecated array).
3. A `…ByQuantity` record (direct lookup by `quantity`).

```ts
export type HippoShopProductVariantsByQuantityDTO = Record<string, HippoShopProductVariantDTO>;

export interface HippoShopProductVariantsDTO {
  subscription: {
    /** @deprecated Use `standardList` for iteration or `standardByQuantity` for direct lookup. Removed in v3.0.0. */
    standard: HippoShopProductVariantDTO[];
    standardList: HippoShopProductVariantDTO[];
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;

    /** @deprecated Use `myAccountList` / `myAccountByQuantity`. Removed in v3.0.0. */
    myAccount: HippoShopProductVariantDTO[];
    myAccountList: HippoShopProductVariantDTO[];
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
  oneTime: {
    /** @deprecated Use `standardList` / `standardByQuantity`. Removed in v3.0.0. */
    standard: HippoShopProductVariantDTO[];
    standardList: HippoShopProductVariantDTO[];
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;

    /** @deprecated Use `myAccountList` / `myAccountByQuantity`. Removed in v3.0.0. */
    myAccount: HippoShopProductVariantDTO[];
    myAccountList: HippoShopProductVariantDTO[];
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
}
```

### SDK enrichment — `packages/sdk/src/enrich.ts` (new file)

A pure function `enrichProduct(raw)` walks the four price-level arrays and adds the two sibling fields to each. The deprecated arrays are passed through untouched.

```ts
import type { HippoShopProductDTO } from '@goldenhippo/hippo-shop-types';

const PURCHASE_TYPES = ['subscription', 'oneTime'] as const;
const TIERS = ['standard', 'myAccount'] as const;

export function enrichProduct(raw: HippoShopProductDTO): HippoShopProductDTO {
  for (const purchase of PURCHASE_TYPES) {
    for (const tier of TIERS) {
      const arr = raw.variants[purchase][tier];
      // Defensive: tolerate a malformed server response without throwing.
      const list = Array.isArray(arr) ? arr : [];
      (raw.variants[purchase] as Record<string, unknown>)[`${tier}List`] = list;
      (raw.variants[purchase] as Record<string, unknown>)[`${tier}ByQuantity`] =
        Object.fromEntries(list.map(v => [String(v.quantity), v]));
    }
  }
  return raw;
}
```

Behavior notes documented inline:
- **Empty array** → `…List: []`, `…ByQuantity: {}`.
- **Duplicate `quantity` values** → `Object.fromEntries` keeps the last occurrence. The `…List` preserves all entries in source order.
- **Identity** — `…List` is the same reference as the deprecated array; we don't clone.

### Hooking enrichment into `request()` — `packages/sdk/src/client.ts`

`fetchJson` is generic across all three resources. We add a resource-aware step in `request()` so the enrichment runs after parsing and before the result is cached:

```ts
private request<T>(resource: Resource, slugOrId: string): Promise<T> {
  // ... existing arg validation and cache lookup ...

  const url = `${this.config.apiBaseUrl}/public/v1/${resource}/${encodeURIComponent(slugOrId)}`;
  this.logger.debug('GET', url);

  const promise = this.fetchJson<T>(url).then(raw =>
    resource === 'product' ? (enrichProduct(raw as HippoShopProductDTO) as unknown as T) : raw,
  );
  return this.cache.set(cacheKey, promise);
}
```

The enriched promise is what lands in the in-memory cache, so enrichment runs once per `(resource, slug)` regardless of how many bindings reference it.

### Path resolver — no changes

`getByPath` in `packages/sdk/src/path.ts` already does the right thing:

| Path                                                         | Result                              |
|--------------------------------------------------------------|-------------------------------------|
| `variants.subscription.standardByQuantity.3.price`           | `49.99` (number)                    |
| `variants.subscription.standardByQuantity.7.price`           | `undefined` (key `'7'` not present) |
| `variants.subscription.standardList.0.price`                 | first variant's price (iteration)   |
| `variants.subscription.standard.0.price` (deprecated array)  | still works during deprecation     |

### Binding behavior — no changes

- `data-field` with `undefined` already leaves the placeholder text in place (`bindings.ts:159`).
- `data-if` already hides on falsy values, which covers `undefined` (`bindings.ts:123-127`).
- `<template data-each="variants.subscription.standardList">` works because `…List` is a real array.

The example at `apps/examples-static/product-pricing.html:64` will be updated to use the new path (the current `…standard.0.price` continues to work until v3).

### Tests

**New unit tests — `packages/sdk/test/enrich.test.ts`:**

- Enrichment of a typical product (3 packages per branch) — `…List` matches input, `…ByQuantity` keyed correctly by string quantity.
- Empty-array branch — `…List` is `[]`, `…ByQuantity` is `{}`.
- Duplicate quantity — last wins in record; list preserves all entries.
- Deprecated arrays are unchanged (reference identity check against the input).
- Both purchase types and both tiers all four price levels are processed.

**Extended tests — `packages/sdk/test/client.test.ts`:**

- `product(slug)` returns enriched DTO with the new fields populated.
- `funnel(slug)` and `destination(slug)` return raw fetched body — no enrichment hook fires.
- Cache hit returns the same enriched promise (enrichment doesn't re-run).

**Integration harness — `apps/integration-harness/`:**

- Add a binding fixture: `data-field="variants.subscription.standardByQuantity.3.price"` resolves on a stubbed product.
- Add a loop fixture: `<template data-each="variants.subscription.standardList">` clones one node per variant.
- Add a miss fixture: `data-if="variants.subscription.standardByQuantity.99"` correctly hides the element.

### Example updates

- `apps/examples-static/product-pricing.html:64` — switch the bound path to `variants.subscription.standardByQuantity.3.price` (or whichever quantity the demo product has). Keep a comment showing both forms during the deprecation window.
- Add one more example (or a section in the existing page) demonstrating `<template data-each="variants.subscription.standardList">` for partners who want to render all packages.

### Documentation

- `README.md` (root) — add a short subsection under the SDK section noting the new path shapes and that the array form is deprecated for v3.
- No new top-level doc file. The release-process and onboarding docs don't need touch-up.

### Changeset

Single changeset, minor bumps for both packages:

```markdown
---
"@goldenhippo/hippo-shop-types": minor
"@goldenhippo/hippo-shop-sdk": minor
---

Add quantity-keyed variant access. Each variants.<purchase>.<tier> price level now has
two sibling fields: <tier>List (iteration) and <tier>ByQuantity (record keyed by quantity).
HTML bindings can do data-field="variants.subscription.standardByQuantity.3.price"; JS
consumers can do product.variants.subscription.standardByQuantity['3']. The existing
arrays (variants.<purchase>.<tier>) are deprecated and will be removed in v3.0.0.

The new fields are derived client-side by the SDK from the existing array shape; the
server wire format is unchanged.
```

## Implementation order

1. Add `HippoShopProductVariantsByQuantityDTO` and reshape `HippoShopProductVariantsDTO` in `packages/types/src/product.ts`. Update barrel exports in `packages/types/src/index.ts`.
2. Create `packages/sdk/src/enrich.ts` with `enrichProduct` and unit tests.
3. Wire `enrichProduct` into `packages/sdk/src/client.ts`'s `request()`.
4. Extend `packages/sdk/test/client.test.ts` for the new code path and add cache-hit coverage.
5. Add integration-harness fixtures.
6. Update `apps/examples-static/product-pricing.html`.
7. Update root `README.md` SDK section.
8. Add changeset.

## Risks and tradeoffs

- **Two ways to access the same data during deprecation.** During the v2.1 → v3 window, partners will see three sibling fields per price level. This is the cost of a non-breaking deprecation; mitigated by clear JSDoc `@deprecated` markers and a one-line README note. v3 collapses back to two.
- **In-place mutation in `enrichProduct`.** The function attaches new properties to the parsed JSON object rather than returning a new object. This is safe because the SDK never exposes the raw response — every caller receives the enriched object. It avoids a deep clone on a hot code path.
- **String vs number keys.** Record keys are strings (`'3'`, not `3`). JS callers using bracket notation get implicit number→string coercion (`record[3]` works). The TS type is `Record<string, …>` to match the wire convention.
- **Duplicate quantities.** Unlikely in production data but theoretically possible if the catalog has multiple packages at the same quantity (e.g., promotional variants). Documented "last wins" behavior is consistent with `Object.fromEntries` and avoids surprising partners with an array-of-arrays shape under a single key.
