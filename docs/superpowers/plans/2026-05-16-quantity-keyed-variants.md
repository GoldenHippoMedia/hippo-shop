# Quantity-Keyed Variant Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add quantity-keyed access to product variants (`variants.subscription.standardByQuantity['3'].price`) and an explicit iteration array (`standardList`) without breaking the deprecated array shape, derived client-side by the SDK.

**Architecture:** Reshape `HippoShopProductVariantsDTO` to carry three sibling fields per `{purchase × tier}` branch (deprecated array + `…List` + `…ByQuantity`). The SDK derives `…List` and `…ByQuantity` client-side in a new `enrichProduct` helper, hooked into `GhDataClient.request()` when the resource is `product`. No wire-format change. Path resolver and binding behavior unchanged — `getByPath` already returns `undefined` for missing keys, which `data-field` and `data-if` already handle.

**Tech Stack:** TypeScript, pnpm + nx monorepo, vitest (jsdom) for SDK tests, changesets for releases.

**Spec:** `docs/superpowers/specs/2026-05-16-quantity-keyed-variants-design.md`

---

## File Structure

**Created:**
- `packages/sdk/src/enrich.ts` — pure enrichment function for product DTOs.
- `packages/sdk/test/enrich.spec.ts` — unit tests for `enrichProduct`.
- `.changeset/quantity-keyed-variants.md` — release note.

**Modified:**
- `packages/types/src/product.ts` — reshape `HippoShopProductVariantsDTO`, add `HippoShopProductVariantsByQuantityDTO`.
- `packages/types/src/index.ts` — re-export new type.
- `packages/sdk/src/client.ts:39-58` — wire enrichment into `request()`.
- `packages/sdk/test/client.spec.ts` — add tests for product enrichment + non-enrichment of funnel/destination + cache identity.
- `packages/sdk/test/bindings.spec.ts` — extend fixture and add new-path binding tests.
- `apps/examples-static/product-pricing.html:64-72` — bind against new paths.
- `README.md` — short note under SDK section.

---

## Task 1: Add `HippoShopProductVariantsByQuantityDTO` type and reshape `HippoShopProductVariantsDTO`

**Files:**
- Modify: `packages/types/src/product.ts`

- [ ] **Step 1: Replace `HippoShopProductVariantsDTO` and add the by-quantity record type**

In `packages/types/src/product.ts`, replace the current `HippoShopProductVariantsDTO` interface block with:

```ts
export interface HippoShopProductVariantsDTO {
  subscription: {
    /**
     * @deprecated Use `standardList` for iteration or `standardByQuantity` for direct lookup.
     * Will be removed in v3.0.0.
     */
    standard: HippoShopProductVariantDTO[];
    /** Ordered list for iteration (same content as the deprecated `standard`). */
    standardList: HippoShopProductVariantDTO[];
    /** Variants keyed by `quantity` as a string. Missing quantities are absent (no `null` entries). */
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;

    /**
     * @deprecated Use `myAccountList` for iteration or `myAccountByQuantity` for direct lookup.
     * Will be removed in v3.0.0.
     */
    myAccount: HippoShopProductVariantDTO[];
    /** Ordered list for iteration (same content as the deprecated `myAccount`). */
    myAccountList: HippoShopProductVariantDTO[];
    /** Variants keyed by `quantity` as a string. Missing quantities are absent. */
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
  oneTime: {
    /**
     * @deprecated Use `standardList` for iteration or `standardByQuantity` for direct lookup.
     * Will be removed in v3.0.0.
     */
    standard: HippoShopProductVariantDTO[];
    /** Ordered list for iteration (same content as the deprecated `standard`). */
    standardList: HippoShopProductVariantDTO[];
    /** Variants keyed by `quantity` as a string. Missing quantities are absent. */
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;

    /**
     * @deprecated Use `myAccountList` for iteration or `myAccountByQuantity` for direct lookup.
     * Will be removed in v3.0.0.
     */
    myAccount: HippoShopProductVariantDTO[];
    /** Ordered list for iteration (same content as the deprecated `myAccount`). */
    myAccountList: HippoShopProductVariantDTO[];
    /** Variants keyed by `quantity` as a string. Missing quantities are absent. */
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
}

/**
 * Variants indexed by their `quantity` value as a string key (e.g. `'3'`, `'6'`).
 * Only quantities that exist for the price level are present — missing keys
 * naturally resolve to `undefined` via path lookup or property access.
 */
export type HippoShopProductVariantsByQuantityDTO = Record<string, HippoShopProductVariantDTO>;
```

The other interfaces (`HippoShopProductDTO`, `HippoShopProductVariantDTO`, `HippoShopFrequencyDTO`) are unchanged.

- [ ] **Step 2: Run typecheck to verify the types package compiles**

```bash
pnpm --filter @goldenhippo/hippo-shop-types typecheck
```

Expected: exits 0. If errors, fix typos in field names — every branch has six fields with the same naming pattern.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/product.ts
git commit -m "feat(types): add by-quantity and list sibling fields to variant tree

Deprecates the array shape (variants.<purchase>.<tier>) and adds
<tier>List and <tier>ByQuantity siblings. Wire format unchanged; SDK
will derive the new fields client-side in a follow-up commit."
```

---

## Task 2: Re-export the new type from the barrel

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the new type to the product re-export block**

Find the existing block:

```ts
export type {
  HippoShopProductDTO,
  HippoShopProductVariantsDTO,
  HippoShopProductVariantDTO,
  HippoShopFrequencyDTO,
} from './product';
```

Replace with:

```ts
export type {
  HippoShopProductDTO,
  HippoShopProductVariantsDTO,
  HippoShopProductVariantsByQuantityDTO,
  HippoShopProductVariantDTO,
  HippoShopFrequencyDTO,
} from './product';
```

- [ ] **Step 2: Typecheck the workspace**

```bash
pnpm --filter @goldenhippo/hippo-shop-types typecheck && pnpm --filter @goldenhippo/hippo-shop-sdk typecheck
```

Expected: both exit 0. The pre-existing `PRODUCT` fixture in `bindings.spec.ts` is a plain object literal (untyped against `HippoShopProductDTO`), so adding required fields to the type doesn't break it.

If you see any failure, stop and inspect — there should be none at this stage.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): export HippoShopProductVariantsByQuantityDTO from barrel"
```

---

## Task 3: Write failing tests for `enrichProduct`

**Files:**
- Create: `packages/sdk/test/enrich.spec.ts`

- [ ] **Step 1: Create the test file with five failing cases**

Create `packages/sdk/test/enrich.spec.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { enrichProduct } from '../src/enrich';
import type { HippoShopProductDTO, HippoShopProductVariantDTO } from '@goldenhippo/hippo-shop-types';

function variant(qty: number, sku: string, price: number): HippoShopProductVariantDTO {
  return {
    productId: `prod-${sku}`,
    variantId: `var-${sku}`,
    sku,
    price,
    rebillPrice: null,
    quantity: qty,
    packageType: 'bottle',
    savings: null,
    alternatePurchaseTypePrice: null,
    defaultFrequency: null,
  };
}

function emptyProduct(overrides?: Partial<HippoShopProductDTO['variants']>): HippoShopProductDTO {
  return {
    id: 'p1',
    slug: 'p1',
    name: 'Test',
    packaging: { singular: 'Bottle', plural: 'Bottles' },
    image: 'https://example.test/img.png',
    reviews: { count: 0, average: 0, globalFiveStarReviews: 0 },
    outOfStock: false,
    variants: {
      subscription: {
        standard: [],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
      oneTime: {
        standard: [],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
      ...overrides,
    } as HippoShopProductDTO['variants'],
  };
}

describe('enrichProduct', () => {
  it('produces a List that is reference-identical to the deprecated array', () => {
    const standardArr = [variant(3, 'A-3', 30), variant(6, 'A-6', 60)];
    const product = emptyProduct({
      subscription: {
        standard: standardArr,
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    expect(product.variants.subscription.standardList).toBe(standardArr);
  });

  it('keys ByQuantity by stringified quantity', () => {
    const product = emptyProduct({
      subscription: {
        standard: [variant(3, 'A-3', 30), variant(6, 'A-6', 60)],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    const byQty = product.variants.subscription.standardByQuantity;
    expect(Object.keys(byQty).sort()).toEqual(['3', '6']);
    expect(byQty['3']?.sku).toBe('A-3');
    expect(byQty['6']?.price).toBe(60);
    // Missing key resolves to undefined naturally.
    expect(byQty['9']).toBeUndefined();
  });

  it('produces empty list and empty record for an empty price level', () => {
    const product = emptyProduct();

    enrichProduct(product);

    expect(product.variants.oneTime.myAccountList).toEqual([]);
    expect(product.variants.oneTime.myAccountByQuantity).toEqual({});
  });

  it('collapses duplicate quantities to last-wins in the record but preserves all entries in the list', () => {
    const first = variant(3, 'A-3a', 30);
    const second = variant(3, 'A-3b', 28);
    const product = emptyProduct({
      subscription: {
        standard: [first, second],
        standardList: [],
        standardByQuantity: {},
        myAccount: [],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    expect(product.variants.subscription.standardList).toEqual([first, second]);
    expect(product.variants.subscription.standardByQuantity['3']).toBe(second);
  });

  it('enriches all four price levels across both purchase types', () => {
    const product = emptyProduct({
      subscription: {
        standard: [variant(1, 'S-S-1', 10)],
        standardList: [],
        standardByQuantity: {},
        myAccount: [variant(2, 'S-M-2', 20)],
        myAccountList: [],
        myAccountByQuantity: {},
      },
      oneTime: {
        standard: [variant(3, 'O-S-3', 30)],
        standardList: [],
        standardByQuantity: {},
        myAccount: [variant(4, 'O-M-4', 40)],
        myAccountList: [],
        myAccountByQuantity: {},
      },
    });

    enrichProduct(product);

    expect(product.variants.subscription.standardByQuantity['1']?.sku).toBe('S-S-1');
    expect(product.variants.subscription.myAccountByQuantity['2']?.sku).toBe('S-M-2');
    expect(product.variants.oneTime.standardByQuantity['3']?.sku).toBe('O-S-3');
    expect(product.variants.oneTime.myAccountByQuantity['4']?.sku).toBe('O-M-4');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/enrich.spec.ts
```

Expected: FAIL with "Cannot find module '../src/enrich'" (or equivalent module-resolution error).

If the error is anything else (typecheck, syntax), stop and fix the test file before proceeding.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/sdk/test/enrich.spec.ts
git commit -m "test(sdk): add failing tests for enrichProduct"
```

---

## Task 4: Implement `enrichProduct` to make tests pass

**Files:**
- Create: `packages/sdk/src/enrich.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/sdk/src/enrich.ts` with this exact content:

```ts
import type { HippoShopProductDTO } from '@goldenhippo/hippo-shop-types';

const PURCHASE_TYPES = ['subscription', 'oneTime'] as const;
const TIERS = ['standard', 'myAccount'] as const;

/**
 * Attach the `<tier>List` and `<tier>ByQuantity` sibling fields to every
 * price level on a product. Pure mutation — the input object is the same
 * reference returned. The deprecated `<tier>` arrays are passed through
 * by reference (no clone) and become the value of `<tier>List`.
 *
 * Duplicate `quantity` values in an input array collapse to last-wins in
 * the record; the list preserves the original order including duplicates.
 */
export function enrichProduct(raw: HippoShopProductDTO): HippoShopProductDTO {
  for (const purchase of PURCHASE_TYPES) {
    for (const tier of TIERS) {
      const branch = raw.variants[purchase] as Record<string, unknown>;
      const arr = branch[tier];
      // Defensive: tolerate a missing/malformed branch without throwing — the
      // SDK is a thin pass-through and we'd rather degrade than blow up.
      const list = Array.isArray(arr) ? arr : [];
      branch[`${tier}List`] = list;
      branch[`${tier}ByQuantity`] = Object.fromEntries(
        list.map((v) => [String((v as { quantity: number }).quantity), v]),
      );
    }
  }
  return raw;
}
```

- [ ] **Step 2: Run the enrich tests to verify they pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/enrich.spec.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Run the full SDK test suite to confirm no regressions**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: pre-existing tests still pass. The `bindings.spec.ts` PRODUCT fixture will still typecheck because the test file declares `PRODUCT` as a plain object (not typed against `HippoShopProductDTO`). If you see a type error there, do NOT change the fixture in this task — note it and continue to Task 5 which will extend it correctly.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/enrich.ts
git commit -m "feat(sdk): add enrichProduct to derive list and byQuantity siblings"
```

---

## Task 5: Hook `enrichProduct` into `GhDataClient.request()`

**Files:**
- Modify: `packages/sdk/src/client.ts:39-58`
- Modify: `packages/sdk/test/client.spec.ts`

- [ ] **Step 1: Add a failing test for product enrichment via the client**

In `packages/sdk/test/client.spec.ts`, find the existing `describe('GhDataClient', () => { ... })` block. Inside it (anywhere works; put it near the end before the closing `})`), add this test:

```ts
it('enriches product responses with List and ByQuantity siblings', async () => {
  mockFetchOnce({
    id: 'p1',
    slug: 'bio-complete-3',
    name: 'Bio Complete 3',
    packaging: { singular: 'Bottle', plural: 'Bottles' },
    image: 'https://cdn.example.com/bc3.png',
    reviews: { count: 1, average: 5, globalFiveStarReviews: 1 },
    outOfStock: false,
    variants: {
      subscription: {
        standard: [
          { productId: 'p', variantId: 'v1', sku: 'BC3-SUB-3', price: 90,
            rebillPrice: 90, quantity: 3, packageType: 'bottle',
            savings: null, alternatePurchaseTypePrice: null, defaultFrequency: null },
          { productId: 'p', variantId: 'v2', sku: 'BC3-SUB-6', price: 170,
            rebillPrice: 170, quantity: 6, packageType: 'bottle',
            savings: 10, alternatePurchaseTypePrice: null, defaultFrequency: null },
        ],
        myAccount: [],
      },
      oneTime: {
        standard: [],
        myAccount: [],
      },
    },
  });

  const client = new GhDataClient(CONFIG, createLogger(false));
  const product = await client.product('bio-complete-3');

  expect(product.variants.subscription.standardList).toHaveLength(2);
  expect(product.variants.subscription.standardByQuantity['3']?.sku).toBe('BC3-SUB-3');
  expect(product.variants.subscription.standardByQuantity['6']?.price).toBe(170);
  expect(product.variants.subscription.standardByQuantity['9']).toBeUndefined();
  // Empty branches still get the sibling fields.
  expect(product.variants.oneTime.standardList).toEqual([]);
  expect(product.variants.oneTime.standardByQuantity).toEqual({});
});

it('does not enrich funnel or destination responses', async () => {
  mockFetchOnce({ slug: 'f1', name: 'F', active: true, steps: [] });
  const client = new GhDataClient(CONFIG, createLogger(false));
  const funnel = await client.funnel('f1');
  expect((funnel as Record<string, unknown>)['variants']).toBeUndefined();
  expect(Object.keys(funnel)).not.toContain('standardList');
});

it('returns the same enriched object on cache hit', async () => {
  mockFetchOnce({
    id: 'p1', slug: 's', name: 'n',
    packaging: { singular: 'B', plural: 'Bs' },
    image: '', reviews: { count: 0, average: 0, globalFiveStarReviews: 0 },
    outOfStock: false,
    variants: {
      subscription: { standard: [], myAccount: [] },
      oneTime: { standard: [], myAccount: [] },
    },
  });
  const client = new GhDataClient(CONFIG, createLogger(false));
  const first = await client.product('s');
  const second = await client.product('s');
  expect(second).toBe(first); // promise cache returns identical reference
  expect(first.variants.subscription.standardByQuantity).toEqual({});
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/client.spec.ts
```

Expected: the three new tests FAIL because `standardList` / `standardByQuantity` are missing on the parsed response (enrichment isn't wired yet). The pre-existing tests pass.

- [ ] **Step 3: Wire `enrichProduct` into `request()`**

In `packages/sdk/src/client.ts`, add this import near the top alongside the other imports:

```ts
import { enrichProduct } from './enrich';
```

Then find the `request()` method (lines ~39-58). The current body ends like:

```ts
    const promise = this.fetchJson<T>(url);
    return this.cache.set(cacheKey, promise);
```

Replace those two lines with:

```ts
    const promise = this.fetchJson<T>(url).then((raw) =>
      resource === 'product'
        ? (enrichProduct(raw as unknown as HippoShopProductDTO) as unknown as T)
        : raw,
    );
    return this.cache.set(cacheKey, promise);
```

The `HippoShopProductDTO` import already exists in `client.ts` (line 4) — no new type import needed.

- [ ] **Step 4: Run the client tests to verify they pass**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/client.spec.ts
```

Expected: all tests PASS, including the three new ones.

- [ ] **Step 5: Run the full SDK suite**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/test/client.spec.ts
git commit -m "feat(sdk): enrich product responses in the request pipeline

Wires enrichProduct into GhDataClient.request() so any product fetched
via .product(slug) gets the new List and ByQuantity siblings before
hitting the cache or being returned to callers."
```

---

## Task 6: Extend binding tests for the new paths

**Files:**
- Modify: `packages/sdk/test/bindings.spec.ts`

The existing `PRODUCT` fixture in this file uses the old array shape and is loosely typed. We'll add a pre-enriched fixture and three new binding test cases. We will NOT modify the existing fixture or its tests.

- [ ] **Step 1: Add a typed, pre-enriched fixture at the top of the file**

Open `packages/sdk/test/bindings.spec.ts`. Just after the existing `PRODUCT` constant, add:

```ts
const ENRICHED_PRODUCT = {
  id: 'p2',
  slug: 'enriched-product',
  name: 'Enriched Product',
  packaging: { singular: 'Bottle', plural: 'Bottles' },
  image: 'https://cdn.example.com/ep.png',
  reviews: { count: 10, average: 4.8, globalFiveStarReviews: 8 },
  outOfStock: false,
  variants: {
    subscription: {
      standard: [],
      standardList: [
        { sku: 'EP-SUB-3', price: 89.95, quantity: 3, packageType: 'bottle', savings: 15 },
        { sku: 'EP-SUB-6', price: 169.95, quantity: 6, packageType: 'bottle', savings: 50 },
      ],
      standardByQuantity: {
        '3': { sku: 'EP-SUB-3', price: 89.95, quantity: 3, packageType: 'bottle', savings: 15 },
        '6': { sku: 'EP-SUB-6', price: 169.95, quantity: 6, packageType: 'bottle', savings: 50 },
      },
      myAccount: [],
      myAccountList: [],
      myAccountByQuantity: {},
    },
    oneTime: {
      standard: [],
      standardList: [],
      standardByQuantity: {},
      myAccount: [],
      myAccountList: [],
      myAccountByQuantity: {},
    },
  },
};
```

Note: the fixture mirrors the shape `enrichProduct` would produce; the same variant object can appear in both `standardList[i]` and `standardByQuantity[String(quantity)]`, but for test clarity we duplicate the literals rather than alias them. The binding tests below only read fields — they never compare references — so the duplication is harmless.

- [ ] **Step 2: Add three binding test cases at the bottom of the existing `describe('applyBindings', …)` block**

Locate the closing `})` of the `applyBindings` describe block (it's the largest describe in the file). Immediately before that closing `})`, add:

```ts
it('resolves data-field via standardByQuantity by quantity key', () => {
  setHtml(`
    <article data-gh-product="enriched-product">
      <span id="price" data-field="variants.subscription.standardByQuantity.3.price">$0.00</span>
    </article>
  `);
  const resources = new Map<string, unknown>([['product:enriched-product', ENRICHED_PRODUCT]]);
  applyBindings(document, { formatters: new FormatRegistry(), resources });
  expect(document.getElementById('price')?.textContent).toBe('89.95');
});

it('iterates standardList via <template data-each>', () => {
  setHtml(`
    <section data-gh-product="enriched-product">
      <template data-each="variants.subscription.standardList">
        <li class="row" data-field="sku"></li>
      </template>
    </section>
  `);
  const resources = new Map<string, unknown>([['product:enriched-product', ENRICHED_PRODUCT]]);
  applyBindings(document, { formatters: new FormatRegistry(), resources });
  const rows = Array.from(document.querySelectorAll('.row')).map((el) => el.textContent);
  expect(rows).toEqual(['EP-SUB-3', 'EP-SUB-6']);
});

it('hides element when quantity is missing via data-if', () => {
  setHtml(`
    <article data-gh-product="enriched-product">
      <p id="nine" data-if="variants.subscription.standardByQuantity.9">9-pack available</p>
      <p id="six" data-if="variants.subscription.standardByQuantity.6">6-pack available</p>
    </article>
  `);
  const resources = new Map<string, unknown>([['product:enriched-product', ENRICHED_PRODUCT]]);
  applyBindings(document, { formatters: new FormatRegistry(), resources });
  expect((document.getElementById('nine') as HTMLElement).style.display).toBe('none');
  expect((document.getElementById('six') as HTMLElement).style.display).not.toBe('none');
});
```

- [ ] **Step 3: Run binding tests**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts
```

Expected: all tests PASS, including the three new ones.

- [ ] **Step 4: Run the full SDK test suite**

```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/test/bindings.spec.ts
git commit -m "test(sdk): cover new variant paths in bindings

Adds an enriched fixture and three binding cases:
- data-field via standardByQuantity by qty key
- <template data-each=\"standardList\"> iteration
- data-if hiding for missing quantity"
```

---

## Task 7: Update the example HTML

**Files:**
- Modify: `apps/examples-static/product-pricing.html:64-72`

- [ ] **Step 1: Update the price binding to use the by-quantity path and add a comment showing both forms**

In `apps/examples-static/product-pricing.html`, replace lines 63-72 (the `<p class="price">…</p>` and `<p class="savings">…</p>` blocks) with:

```html
        <!--
          Variant paths:
            variants.subscription.standardByQuantity.<qty>   — direct lookup by quantity
            variants.subscription.standardList               — array for <template data-each>
            variants.subscription.standard                   — deprecated, removed in v3.0.0
        -->
        <p class="price">
          <span data-field="variants.subscription.standardByQuantity.6.price" data-format="currency:USD:en-US">
            $0.00
          </span>
        </p>

        <p class="savings" data-if="variants.subscription.standardByQuantity.6.savings">
          Save <span data-field="variants.subscription.standardByQuantity.6.savings" data-format="currency:USD:en-US">$0.00</span>
          vs. one-time
        </p>
```

The example assumes a 6-pack exists for the demo product `bio-complete-3`. If a different quantity is more representative, swap `6` for that. Don't add UI to choose quantities — this example is about declarative binding, not interactivity.

- [ ] **Step 2: Verify nothing else in the repo references the old path inside the static example**

```bash
grep -rn "variants.subscription.standard.0" apps/examples-static/ packages/ docs/
```

Expected output: zero matches (or only inside the design spec / plan files, which is fine — they document the old path for context).

- [ ] **Step 3: Commit**

```bash
git add apps/examples-static/product-pricing.html
git commit -m "docs(examples): use standardByQuantity in product-pricing.html

Migrates the demo from positional index (standard.0.price) to the new
quantity-keyed path. Keeps an HTML comment showing the deprecated form
during the v2.x window."
```

---

## Task 8: Add README note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the SDK section**

Open `README.md` and find the section that documents the SDK / declarative bindings. Look for headings like "SDK", "Bindings", or "Browser SDK". If multiple sections exist, pick the one a partner would consult to learn how to bind product data.

If no such section exists, place the new note under whichever section is most about consumer-facing data access (likely near the bottom of the existing SDK / packages overview). Skim, don't read end-to-end.

- [ ] **Step 2: Add a short subsection**

Insert this markdown block at the appropriate spot:

```markdown
### Accessing product variants by quantity

A product's variant tree now supports direct lookup by `quantity` alongside iteration:

- `variants.<purchase>.<tier>ByQuantity['3']` — variant for the 3-pack, or `undefined` if no 3-pack exists.
- `variants.<purchase>.<tier>List` — ordered array, suitable for `<template data-each>`.
- `variants.<purchase>.<tier>` — **deprecated** array shape, removed in v3.0.0.

Where `<purchase>` is `subscription` or `oneTime` and `<tier>` is `standard` or `myAccount`.

In HTML bindings:

\`\`\`html
<span data-field="variants.subscription.standardByQuantity.6.price"
      data-format="currency:USD:en-US">$0.00</span>
\`\`\`

In JavaScript:

\`\`\`js
const product = await window.gh.data.product('bio-complete-3');
const sixPack = product.variants.subscription.standardByQuantity['6'];
if (sixPack) renderPrice(sixPack.price);
\`\`\`

Missing quantities resolve to `undefined`; `data-field` leaves the placeholder text in place and `data-if` hides the element.
```

The triple-backtick fences above use escaped backticks inside the markdown block; remove the leading `\` when you paste so the fences render normally.

- [ ] **Step 3: Verify the README renders without obvious issues**

```bash
grep -n "standardByQuantity" README.md
```

Expected: at least 2 matches (the prose lines and the code blocks).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document quantity-keyed variant access"
```

---

## Task 9: Add the changeset

**Files:**
- Create: `.changeset/quantity-keyed-variants.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/quantity-keyed-variants.md` with this exact content:

```markdown
---
"@goldenhippo/hippo-shop-types": minor
"@goldenhippo/hippo-shop-sdk": minor
---

Add quantity-keyed variant access. Each `variants.<purchase>.<tier>` price level
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
```

- [ ] **Step 2: Confirm changesets recognizes the file**

```bash
pnpm changeset status
```

Expected: lists both `@goldenhippo/hippo-shop-types` and `@goldenhippo/hippo-shop-sdk` as scheduled for a minor bump.

If `pnpm changeset status` is interactive in your environment and prompts for input, just skim its output and ensure the new packages and bumps are listed.

- [ ] **Step 3: Run the full workspace verification**

```bash
pnpm --filter @goldenhippo/hippo-shop-types typecheck \
  && pnpm --filter @goldenhippo/hippo-shop-sdk typecheck \
  && pnpm --filter @goldenhippo/hippo-shop-sdk test \
  && pnpm --filter @goldenhippo/hippo-shop-sdk lint
```

Expected: all four steps exit 0.

- [ ] **Step 4: Commit**

```bash
git add .changeset/quantity-keyed-variants.md
git commit -m "chore: add changeset for quantity-keyed variant access"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the workspace-wide build**

```bash
pnpm build
```

Expected: all packages build successfully. If a downstream consumer in `apps/` fails to typecheck due to the new variant fields, that's likely an `examples-static` template — examples consume types loosely (no compile step against the DTO). If you see a true type error, stop and investigate.

- [ ] **Step 2: Run the workspace-wide test command**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Review the diff history**

```bash
git log --oneline -10
```

Expected: a clean series of commits from Task 1 through Task 9 (≈9 commits). Each commit is independently revertable.

- [ ] **Step 4: Push the branch (do NOT push to main; create a feature branch first if needed)**

Confirm with the user whether to push and what branch / PR strategy they prefer before pushing anything. This plan has been executing on `main` per the existing repo workflow; if a feature branch is preferred, create one and move the commits there with `git switch -c feat/quantity-keyed-variants && git push -u origin feat/quantity-keyed-variants`.

---

## Out of scope

- Changing the wire format from `/public/v1/product/:slug` — server keeps emitting today's array shape.
- Adding a `getVariant({ purchase, tier, quantity })` helper method on `GhDataClient`.
- Updating `apps/integration-harness/src/public-v1.test.ts` — that file asserts the wire format from UAT, which hasn't changed. The SDK enrichment is covered by `client.spec.ts`.
- Removing the deprecated arrays — that's v3.0.0.
- Modifying the existing `PRODUCT` fixture in `bindings.spec.ts` — would balloon this change and isn't required.
