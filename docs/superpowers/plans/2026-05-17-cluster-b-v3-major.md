# Cluster B — v3.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut v3.0.0 of `@goldenhippo/hippo-shop-types` and `@goldenhippo/hippo-shop-sdk` by removing the deprecated variant arrays from the DTO contract and the `enrichProduct` client-side shim from the SDK. Configure the release workflow to deploy to a new Cloudflare Pages project (`gh-hippo-shop-sdk-v3`) so the v3 SDK lands at the new CDN URL line `/sdk/v3/gh.js` while the prior `/sdk/v1/` URL freezes at the last v2.1.1 build.

**Architecture:** Two small code deletions in the SDK and types packages, with cascade through README/SPEC docs and changesets. Plus a one-line workflow change that flips the Pages project name. No new code. No new tests — `enrichProduct` becomes a pass-through and its dedicated test file is removed. Backend and Kong changes happen outside this repo, before the v3 publish.

**Tech Stack:** TypeScript, pnpm + nx workspace, tsup builds, vitest, changesets, Cloudflare Pages.

**Reference spec:** [`docs/superpowers/specs/2026-05-17-cluster-b-v3-major-design.md`](../specs/2026-05-17-cluster-b-v3-major-design.md)

**Branch:** `feat/cluster-b-v3-major` (off `docs/cluster-a-restructure`; rebase on main once A merges)

---

## Pre-flight constraint: commit ordering

A few files reference each other (`enrich.ts` is exported by `index.ts` and imported by `client.ts`; tests import `enrich.ts`). To keep every commit a clean build, the SDK refactor lands as a single atomic commit (Task 1), and the types removal lands as another single commit (Task 2). The doc/SPEC/changeset commits follow.

Each task either always-builds at the head of the commit, or is doc-only. There are no intentionally-broken interim states.

## File structure

**Files modified:**
- `packages/types/src/product.ts` — Task 2
- `packages/sdk/src/client.ts` — Task 1
- `packages/sdk/src/index.ts` — Task 1
- `packages/types/SPEC.md` — Task 3
- `packages/sdk/SPEC.md` — Task 4
- `README.md` — Task 5
- `packages/types/README.md` — Task 6
- `packages/sdk/README.md` — Task 7
- `.github/workflows/release.yml` — Task 8
- `docs/architecture/cloudflare-deploy.md` — Task 9

**Files deleted:**
- `packages/sdk/src/enrich.ts` — Task 1
- `packages/sdk/test/enrich.spec.ts` — Task 1

**Files created:**
- `.changeset/<random-slug>-cluster-b-types.md` — Task 10
- `.changeset/<random-slug>-cluster-b-sdk.md` — Task 10

**Not touched by this plan (deploy-day work, post-merge):**
- `apps/examples-static/*.html` — updated to reference `/sdk/v3/gh.js` only after the v3 CDN URL is live.
- Backend commerce API — engineer-coordinated, separate repo.
- Kong route for `/sdk/v3/*` — engineer-handled prerequisite.
- `npm deprecate` v2.x — engineer-handled after v3 publishes.

---

## Task 1: Remove `enrichProduct` from the SDK

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`
- Delete: `packages/sdk/src/enrich.ts`
- Delete: `packages/sdk/test/enrich.spec.ts`

This is a single atomic commit because the four changes refer to each other. Removing one without the others breaks the build.

- [ ] **Step 1: Confirm starting state**

Run:
```bash
test -f packages/sdk/src/enrich.ts && echo "enrich.ts: exists"
test -f packages/sdk/test/enrich.spec.ts && echo "enrich.spec.ts: exists"
grep -n "enrichProduct\|enrich" packages/sdk/src/client.ts
grep -n "enrich" packages/sdk/src/index.ts
```

Expected:
```
enrich.ts: exists
enrich.spec.ts: exists
packages/sdk/src/client.ts:10:import { enrichProduct } from './enrich';
packages/sdk/src/client.ts:58:    const promise = this.fetchJson<T>(url).then((raw) =>
packages/sdk/src/client.ts:59:      resource === 'product'
packages/sdk/src/client.ts:60:        ? (enrichProduct(raw as unknown as HippoShopProductDTO) as unknown as T)
packages/sdk/src/client.ts:61:        : raw,
packages/sdk/src/client.ts:62:    );
packages/sdk/src/index.ts:14:export { enrichProduct } from './enrich';
```

- [ ] **Step 2: Edit `packages/sdk/src/client.ts` to remove the `enrichProduct` import**

Use Edit. Find:
```typescript
import { enrichProduct } from './enrich';
```

Replace with: (delete the line entirely; the surrounding imports stay)

Use this `old_string` to be unique:
```typescript
import { enrichProduct } from './enrich';
import type { Logger } from './log';
```

`new_string`:
```typescript
import type { Logger } from './log';
```

- [ ] **Step 3: Edit `packages/sdk/src/client.ts` to simplify the product post-processing**

Use Edit. The current block at lines 57–62 is:

```typescript
    const promise = this.fetchJson<T>(url).then((raw) =>
      resource === 'product'
        ? (enrichProduct(raw as unknown as HippoShopProductDTO) as unknown as T)
        : raw,
    );
    return this.cache.set(cacheKey, promise);
```

Replace with:

```typescript
    const promise = this.fetchJson<T>(url);
    return this.cache.set(cacheKey, promise);
```

`old_string` (must be exact, including indentation):
```typescript
    const promise = this.fetchJson<T>(url).then((raw) =>
      resource === 'product'
        ? (enrichProduct(raw as unknown as HippoShopProductDTO) as unknown as T)
        : raw,
    );
    return this.cache.set(cacheKey, promise);
```

`new_string`:
```typescript
    const promise = this.fetchJson<T>(url);
    return this.cache.set(cacheKey, promise);
```

This removes the conditional `.then` wrapper entirely. Products now pass through `fetchJson` directly — the API is expected to emit the new shape, so no client-side enrichment is needed.

- [ ] **Step 4: Check that `HippoShopProductDTO` is still imported elsewhere in `client.ts`**

Run: `grep -n "HippoShopProductDTO" packages/sdk/src/client.ts`

Expected output:
```
4:  HippoShopProductDTO,
31:  product(slugOrId: string): Promise<HippoShopProductDTO> {
32:    return this.request<HippoShopProductDTO>('product', slugOrId);
```

`HippoShopProductDTO` is still used by the `product()` method's return type. Leave the import as-is.

- [ ] **Step 5: Edit `packages/sdk/src/index.ts` to remove the `enrichProduct` export**

Use Edit. Find and delete the line:

`old_string` (include surrounding context for uniqueness):
```typescript
export { getByPath } from './path';
export { enrichProduct } from './enrich';
```

`new_string`:
```typescript
export { getByPath } from './path';
```

- [ ] **Step 6: Delete `packages/sdk/src/enrich.ts`**

Run: `git rm packages/sdk/src/enrich.ts`

- [ ] **Step 7: Delete `packages/sdk/test/enrich.spec.ts`**

Run: `git rm packages/sdk/test/enrich.spec.ts`

- [ ] **Step 8: Verify build is still clean**

Run: `pnpm typecheck`
Expected: PASS (2 projects). No type errors.

Run: `pnpm --filter @goldenhippo/hippo-shop-sdk test`
Expected: PASS. There will be one fewer test file in the SDK package now.

Run: `pnpm build`
Expected: PASS for all 3 projects (types, sdk, landing).

If any of these fail, STOP and report — likely indicates a missed reference to `enrichProduct` somewhere.

- [ ] **Step 9: Verify no stragglers reference `enrichProduct`**

Run: `grep -rn "enrichProduct\|from './enrich'" packages/sdk/`
Expected: zero output.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/src/enrich.ts packages/sdk/test/enrich.spec.ts
git commit -m "refactor(sdk): remove enrichProduct (v3 expects API to emit new shape directly)"
```

---

## Task 2: Remove the four `@deprecated` array fields from `HippoShopProductVariantsDTO`

**Files:**
- Modify: `packages/types/src/product.ts`

- [ ] **Step 1: Confirm starting state**

Run: `grep -n "@deprecated\|standard:\|myAccount:" packages/types/src/product.ts`

Expected (lines roughly 25-45 contain the four `@deprecated` blocks plus their `*List` siblings):
```
26:     * @deprecated Use `standardList` for iteration or `standardByQuantity` for direct lookup.
29:    standard: HippoShopProductVariantDTO[];
30:    /** Ordered list for iteration (same content as the deprecated `standard`). */
36:     * @deprecated Use `myAccountList` for iteration or `myAccountByQuantity` for direct lookup.
39:    myAccount: HippoShopProductVariantDTO[];
40:    /** Ordered list for iteration (same content as the deprecated `myAccount`). */
46:     * @deprecated Use `standardList` for iteration or `standardByQuantity` for direct lookup.
50:    standard: HippoShopProductVariantDTO[];
51:    /** Ordered list for iteration (same content as the deprecated `standard`). */
57:     * @deprecated Use `myAccountList` for iteration or `myAccountByQuantity` for direct lookup.
60:    myAccount: HippoShopProductVariantDTO[];
61:    /** Ordered list for iteration (same content as the deprecated `myAccount`). */
```

- [ ] **Step 2: Replace the `subscription` block**

Use Edit.

`old_string` (must match exactly — preserve indentation and the surrounding `subscription:` opening / `};` closing):
```typescript
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
```

`new_string`:
```typescript
  subscription: {
    /** Ordered list of subscription "standard" variants for iteration. */
    standardList: HippoShopProductVariantDTO[];
    /** Subscription "standard" variants keyed by `quantity` as a string. Missing quantities are absent (no `null` entries). */
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;
    /** Ordered list of subscription "my account" variants for iteration. */
    myAccountList: HippoShopProductVariantDTO[];
    /** Subscription "my account" variants keyed by `quantity` as a string. Missing quantities are absent. */
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
```

- [ ] **Step 3: Replace the `oneTime` block**

Use Edit.

`old_string`:
```typescript
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
```

`new_string`:
```typescript
  oneTime: {
    /** Ordered list of one-time "standard" variants for iteration. */
    standardList: HippoShopProductVariantDTO[];
    /** One-time "standard" variants keyed by `quantity` as a string. Missing quantities are absent. */
    standardByQuantity: HippoShopProductVariantsByQuantityDTO;
    /** Ordered list of one-time "my account" variants for iteration. */
    myAccountList: HippoShopProductVariantDTO[];
    /** One-time "my account" variants keyed by `quantity` as a string. Missing quantities are absent. */
    myAccountByQuantity: HippoShopProductVariantsByQuantityDTO;
  };
```

- [ ] **Step 4: Verify no `@deprecated` markers remain**

Run: `grep -c "@deprecated" packages/types/src/product.ts`
Expected: `0`

Run: `grep -n "standard\|myAccount" packages/types/src/product.ts`
Expected: only the four `*List` and four `*ByQuantity` lines, plus their JSDoc descriptions. No bare `standard:` or `myAccount:` field lines.

- [ ] **Step 5: Build and typecheck**

Run: `pnpm build`
Expected: PASS (3 projects). No build errors.

Run: `pnpm test`
Expected: PASS. SDK's 100+ remaining tests pass; types package's tsd type-tests pass.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Inspect the generated `.d.ts` to confirm the public type surface is cleaned**

Run: `grep -A 5 "subscription:" packages/types/dist/index.d.ts | head -20`

Expected output should show only `standardList`, `standardByQuantity`, `myAccountList`, `myAccountByQuantity` — no bare `standard` or `myAccount` fields:
```typescript
subscription: {
    /** Ordered list of subscription "standard" variants for iteration. */
    standardList: HippoShopProductVariantDTO[];
    ...
```

If you see `standard:` or `myAccount:` as bare field names in the output, the build didn't pick up the source change. Re-run `pnpm build`.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/product.ts
git commit -m "feat(types)!: remove deprecated variants.<purchase>.standard and .myAccount arrays

BREAKING CHANGE: HippoShopProductVariantsDTO no longer exposes the legacy
non-keyed arrays. Use <tier>List for iteration or <tier>ByQuantity for
direct lookup. The replacement fields have been available since v2.0.0."
```

---

## Task 3: Update `packages/types/SPEC.md` — clear the deprecated surface

**Files:**
- Modify: `packages/types/SPEC.md`

- [ ] **Step 1: Find the current deprecated-surface table**

Run: `grep -n "## Deprecated surface\|## Stability\|@deprecated\|HippoShopProductVariantsDTO" packages/types/SPEC.md`

Expected: a `## Deprecated surface` heading followed by a four-row table listing the removed fields. The next section is `## Stability`.

- [ ] **Step 2: Replace the deprecated-surface section**

Use Edit.

`old_string` (the entire `## Deprecated surface` section, exact match):
```markdown
## Deprecated surface

The following are still exported in v2.x but are scheduled for removal in v3.0.0 (covered by a separate work cluster). Prefer the indicated replacements.

| Deprecated | Replacement | Scheduled removal |
|---|---|---|
| `HippoShopProductVariantsDTO.subscription.standard` | Use `standardList` (iteration) or `standardByQuantity` (lookup) | v3.0.0 |
| `HippoShopProductVariantsDTO.subscription.myAccount` | Use `myAccountList` or `myAccountByQuantity` | v3.0.0 |
| `HippoShopProductVariantsDTO.oneTime.standard` | Use `standardList` or `standardByQuantity` | v3.0.0 |
| `HippoShopProductVariantsDTO.oneTime.myAccount` | Use `myAccountList` or `myAccountByQuantity` | v3.0.0 |

## Stability
```

`new_string`:
```markdown
## Deprecated surface

None in v3.0.0.

Historical note: v1.x and v2.x exposed legacy `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields on `HippoShopProductVariantsDTO`. Those were removed in v3.0.0. Use `<tier>List` for iteration or `<tier>ByQuantity` for direct lookup.

## Stability
```

- [ ] **Step 3: Verify**

Run: `grep -c "@deprecated\|standard.*Use\|myAccount.*Use" packages/types/SPEC.md`
Expected: `0` (no remaining "Use X instead of Y" deprecation prose in table form).

Run: `grep "## Deprecated surface" packages/types/SPEC.md`
Expected: exactly one match.

- [ ] **Step 4: Commit**

```bash
git add packages/types/SPEC.md
git commit -m "docs(types): clear v2-era deprecated-surface table from SPEC for v3"
```

---

## Task 4: Update `packages/sdk/SPEC.md` — clear deprecated surface, refresh stability framing

**Files:**
- Modify: `packages/sdk/SPEC.md`

- [ ] **Step 1: Find the current deprecated-surface section**

Run: `grep -n "## Deprecated surface\|## Stability\|variants.subscription.standard" packages/sdk/SPEC.md`

Expected: a `## Deprecated surface` heading with a row pointing to the deprecated `data-field` paths, followed by `## Stability`.

- [ ] **Step 2: Replace the deprecated-surface section**

Use Edit.

`old_string`:
```markdown
## Deprecated surface

Currently-shipping SDK behavior depends on deprecated DTO fields in `@goldenhippo/hippo-shop-types`. Specifically:

| Deprecated path | Replacement | Scheduled removal |
|---|---|---|
| `data-field="variants.subscription.standard"` (and the other three matching paths) | Use `*List` for iteration or `*ByQuantity` for direct lookup | v3.0.0 |

No SDK-internal API is currently marked `@deprecated`. When v3 removes the deprecated paths from the types package, the SDK's path lookup will simply stop seeing them.
```

`new_string`:
```markdown
## Deprecated surface

None in v3.0.0.

Historical note: pre-v3 SDK builds carried a client-side shim (`enrichProduct`) that built `*List` and `*ByQuantity` fields from legacy DTO arrays. v3 removed both the legacy DTO arrays and the shim — the SDK is now a thin pass-through for product responses.
```

- [ ] **Step 3: Verify**

Run: `grep -c "variants.subscription.standard\|enrichProduct" packages/sdk/SPEC.md`
Expected: `0` outside the historical note (the note says `enrichProduct` once, which is fine).

Specifically: `grep -n "enrichProduct" packages/sdk/SPEC.md` should show exactly one line, in the historical-note paragraph.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/SPEC.md
git commit -m "docs(sdk): clear v2-era deprecated-surface from SPEC; note removal of enrichProduct shim"
```

---

## Task 5: Root README — remove deprecation prose, add "About this version" section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the deprecation line**

Run: `grep -n "deprecated\|Working on Hippo Shop\|About this version\|## Contract and roadmap" README.md`

Expected to include a line at or near line 51 saying:
```
- `variants.<purchase>.<tier>` — **deprecated** array shape, removed in v3.0.0.
```

And a `## Contract and roadmap` section (added by Cluster A) before `## Quickstart`.

- [ ] **Step 2: Remove the deprecation bullet**

Use Edit. The bullet appears at the bottom of the "Accessing product variants by quantity" section.

`old_string` (must be unique — include surrounding bullets):
```markdown
- `variants.<purchase>.<tier>ByQuantity['3']` — variant for the 3-pack, or `undefined` if no 3-pack exists.
- `variants.<purchase>.<tier>List` — ordered array, suitable for `<template data-each>`.
- `variants.<purchase>.<tier>` — **deprecated** array shape, removed in v3.0.0.
```

`new_string`:
```markdown
- `variants.<purchase>.<tier>ByQuantity['3']` — variant for the 3-pack, or `undefined` if no 3-pack exists.
- `variants.<purchase>.<tier>List` — ordered array, suitable for `<template data-each>`.
```

- [ ] **Step 3: Add an "About this version" section**

Use Edit. The new section goes immediately after the existing `## Contract and roadmap` section (added in Cluster A) and before `## Quickstart`.

`old_string` (must be unique — include the last bullet of Contract and roadmap and the Quickstart heading):
```markdown
- [`ROADMAP.md`](./ROADMAP.md) — backlog of bugs, ideas, and planned work

## Quickstart
```

`new_string`:
```markdown
- [`ROADMAP.md`](./ROADMAP.md) — backlog of bugs, ideas, and planned work

## About this version

v3 is the first release of Hippo Shop intended for use by other internal Golden Hippo teams. v1.x and v2.x were internal iterations during development; they remain on npm but are no longer maintained.

If you're starting fresh, install the latest. If you've been on v1.x or v2.x, the only migration is replacing reads of `variants.<purchase>.standard` and `variants.<purchase>.myAccount` arrays with `<tier>List` (for iteration) or `<tier>ByQuantity` (for direct lookup).

## Quickstart
```

- [ ] **Step 4: Verify**

Run: `grep -n "deprecated\|removed in v3\|About this version" README.md`

Expected: exactly one line containing "About this version" (the new heading), no remaining "removed in v3" or `**deprecated**` prose.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: remove v3-deprecation prose from root README; add 'About this version' section"
```

---

## Task 6: `packages/types/README.md` — remove the deprecated-mirror code comment

**Files:**
- Modify: `packages/types/README.md`

- [ ] **Step 1: Find the deprecated reference**

Run: `grep -n "deprecated\|removed in v3" packages/types/README.md`

Expected to include line 135 (or nearby) with a comment like:
```
        /* deprecated mirror of standardList — removed in v3.0.0 */
```

Read the surrounding code-block context so you understand what to keep:

Run: `sed -n '125,150p' packages/types/README.md`

- [ ] **Step 2: Remove the deprecated mirror from the example**

Use Edit. The comment and its preceding `standard: ...` field both need to go from any example code block that shows them.

Locate the specific block. It's most likely showing a partial `HippoShopProductVariantsDTO` example. The block content depends on what's actually in the file — read the file before editing. Apply this rule:

- Any line within an example code block that has `/* deprecated mirror... */` should be removed.
- Any preceding line that declares the deprecated `standard:` or `myAccount:` array field within that same example should also be removed.
- Leave the `standardList`, `standardByQuantity`, `myAccountList`, `myAccountByQuantity` lines intact.

If the file contains multiple code blocks with deprecation comments, apply the same rule to each.

- [ ] **Step 3: Add a pointer to the root README**

Open the file and find the title section (the `# @goldenhippo/hippo-shop-types` heading and the first paragraph below it). Add a one-line callout immediately after that paragraph:

`old_string` (find the existing first-paragraph + blank line + next-heading pattern; tailor based on actual file content — read the file first):

Use Edit to add this block immediately after the package's intro paragraph and before the next section heading:

```markdown
> For context on v1.x/v2.x → v3 — see [About this version](../../README.md#about-this-version) in the root README.
```

Make sure there are blank lines above and below the block so it renders as a markdown blockquote.

- [ ] **Step 4: Verify**

Run: `grep -c "deprecated\|removed in v3" packages/types/README.md`
Expected: `0`.

Run: `grep "About this version" packages/types/README.md`
Expected: one match (the pointer line you added).

- [ ] **Step 5: Commit**

```bash
git add packages/types/README.md
git commit -m "docs(types): remove v3-deprecation mirror from README; link About this version"
```

---

## Task 7: `packages/sdk/README.md` — remove deprecation block, link About this version

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Find the deprecation block**

Run: `grep -n "Deprecation:\|deprecated\|enrichProduct\|removed in v3" packages/sdk/README.md`

Expected to include a line at or near line 184 starting with:
```
> **Deprecation:** the legacy array form `variants.<purchase>.<tier>` (without the `List` / `ByQuantity` suffix) is deprecated and will be removed in v3.0.0. Use `<tier>List` for iteration and `<tier>ByQuantity` for direct lookup by quantity.
```

There may also be references to `enrichProduct` in an "Advanced exports" section (e.g., "`enrichProduct` — quantity-keyed variant builder applied to product responses"). Those go too.

- [ ] **Step 2: Remove the `> **Deprecation:**` blockquote**

Use Edit.

`old_string` (the full blockquote — must match exactly):
```markdown
> **Deprecation:** the legacy array form `variants.<purchase>.<tier>` (without the `List` / `ByQuantity` suffix) is deprecated and will be removed in v3.0.0. Use `<tier>List` for iteration and `<tier>ByQuantity` for direct lookup by quantity.
```

`new_string`: (empty — replace with nothing; this removes the line entirely)

If `Edit` won't accept an empty `new_string`, fall back to running:
```bash
grep -v '^> \*\*Deprecation:\*\* the legacy array form' packages/sdk/README.md > /tmp/sdk_readme.md && mv /tmp/sdk_readme.md packages/sdk/README.md
```

- [ ] **Step 3: Remove `enrichProduct` references**

There are three sites in `packages/sdk/README.md` that mention `enrichProduct`. Run: `grep -n "enrichProduct\|client-side enriched" packages/sdk/README.md` to confirm — should be 4 lines (the three `enrichProduct` mentions plus one "(client-side enriched)" mention in a table row).

**Site 1: Endpoint table + prose paragraph (around lines 634–636).**

Use Edit.

`old_string`:
```markdown
| `GET` | `<base>/public/v1/product/<slugOrId>` | `HippoShopProductDTO` (client-side enriched) |

`<slugOrId>` is URL-encoded before insertion. The product endpoint is client-side enriched — the raw response is passed through `enrichProduct` to attach the `<tier>List` and `<tier>ByQuantity` sibling fields before it resolves.
```

`new_string`:
```markdown
| `GET` | `<base>/public/v1/product/<slugOrId>` | `HippoShopProductDTO` |

`<slugOrId>` is URL-encoded before insertion. Product responses arrive with `<tier>List` and `<tier>ByQuantity` fields already populated server-side.
```

**Site 2: Import example (around line 760).**

Use Edit.

`old_string`:
```typescript
  collectResources,
  enrichProduct,
  FormatRegistry,
```

`new_string`:
```typescript
  collectResources,
  FormatRegistry,
```

**Site 3: Barrel-exports table row (around line 779).**

Use Edit.

`old_string`:
```markdown
| `getByPath(obj, path)` | function | Resolve a dot-path against any object. Returns `undefined` on miss; never throws. Reusable outside the SDK. |
| `enrichProduct(raw)` | function | Mutate a raw product DTO in place, attaching `<tier>List` and `<tier>ByQuantity` sibling fields. Use after a manual `fetch()` to a product endpoint if you want the same shape `gh.data.product` returns. |
| `parseScriptConfig(scriptEl)` | function | Validate a `<script>` element's `data-*` config and produce a `GhConfig`. Throws on invalid input. |
```

`new_string`:
```markdown
| `getByPath(obj, path)` | function | Resolve a dot-path against any object. Returns `undefined` on miss; never throws. Reusable outside the SDK. |
| `parseScriptConfig(scriptEl)` | function | Validate a `<script>` element's `data-*` config and produce a `GhConfig`. Throws on invalid input. |
```

- [ ] **Step 4: Add the About-this-version pointer**

Add the same blockquote pointer as Task 6, immediately after the package's intro paragraph (after the badges and first paragraph, before the first `##` heading):

```markdown
> For context on v1.x/v2.x → v3 — see [About this version](../../README.md#about-this-version) in the root README.
```

Use Edit. Read the file first to find the exact intro-paragraph + blank-line + next-heading pattern, then place the blockquote there.

- [ ] **Step 5: Verify**

Run: `grep -c "deprecated\|removed in v3\|enrichProduct" packages/sdk/README.md`
Expected: `0`.

Run: `grep "About this version" packages/sdk/README.md`
Expected: one match.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/README.md
git commit -m "docs(sdk): remove v3-deprecation block and enrichProduct refs from README; link About this version"
```

---

## Task 8: Release workflow — flip the Cloudflare Pages project name

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Find the deploy step**

Run: `grep -n "gh-hippo-shop-sdk\|project-name" .github/workflows/release.yml`

Expected:
```
.github/workflows/release.yml:54:          run: npx --yes wrangler@4 pages deploy packages/sdk/dist --project-name=gh-hippo-shop-sdk --branch=main
```

(Line number may drift; trust the grep over this docstring.)

- [ ] **Step 2: Flip the project name**

Use Edit.

`old_string`:
```yaml
          run: npx --yes wrangler@4 pages deploy packages/sdk/dist --project-name=gh-hippo-shop-sdk --branch=main
```

`new_string`:
```yaml
          run: npx --yes wrangler@4 pages deploy packages/sdk/dist --project-name=gh-hippo-shop-sdk-v3 --branch=main
```

- [ ] **Step 3: Verify**

Run: `grep -n "project-name" .github/workflows/release.yml`
Expected: exactly one match, containing `--project-name=gh-hippo-shop-sdk-v3`. No remaining references to the v1 project name.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: deploy v3 SDK to new Cloudflare Pages project gh-hippo-shop-sdk-v3"
```

---

## Task 9: Update `docs/architecture/cloudflare-deploy.md` to document the new convention

**Files:**
- Modify: `docs/architecture/cloudflare-deploy.md`

- [ ] **Step 1: Read the current Kong wiring section**

Run: `sed -n '30,50p' docs/architecture/cloudflare-deploy.md`

Expected: an ASCII diagram showing `/sdk/v1/gh.js` → `gh-hippo-shop-sdk.pages.dev/gh.js`.

- [ ] **Step 2: Replace the Kong wiring section to show both routes**

Use Edit.

`old_string`:
```markdown
## Kong wiring (operational model)

Point Kong at the **canonical** URL once. It does not change between releases.

```
Public         Kong                                Cloudflare Pages
─────────────  ──────────────────────────────────  ─────────────────────────────────
api-prod.      ─►  forwards /sdk/v1/gh.js to       ─►  gh-hippo-shop-sdk.pages.dev/gh.js
goldenhippo.io                                          (canonical — auto-tracks latest)
```

Per release:

1. CI uploads new assets to Cloudflare → new immutable hash URL is created.
2. Cloudflare flips the canonical alias to the new hash (automatic, sub-second).
3. Kong's upstream URL is unchanged but now serves new bytes.
4. Older hash URLs remain live indefinitely as rollback targets.

Kong configuration changes are **not** required on a release cadence.
```

`new_string`:
```markdown
## Kong wiring (operational model)

Each npm major has its own Pages project and Kong route. The SDK URL path tracks the SDK's major version 1:1.

```
Public         Kong                                Cloudflare Pages
─────────────  ──────────────────────────────────  ─────────────────────────────────
api-prod.      ─►  forwards /sdk/v3/gh.js to       ─►  gh-hippo-shop-sdk-v3.pages.dev/gh.js
goldenhippo.io                                          (canonical — auto-tracks latest)

               ─►  forwards /sdk/v1/gh.js to       ─►  gh-hippo-shop-sdk.pages.dev/gh.js
                                                        (frozen at last v2.1.1 build)
```

Per release on the active major:

1. CI uploads new assets to the active Pages project → new immutable hash URL is created.
2. Cloudflare flips the canonical alias to the new hash (automatic, sub-second).
3. Kong's upstream URL is unchanged but now serves new bytes.
4. Older hash URLs remain live indefinitely as rollback targets.

Kong configuration changes are **not** required on a release cadence within a single major. They are required once per new major — to add a new `/sdk/vN/*` route.

### Frozen URL lines

When a major is cut, the prior major's Pages project stops receiving deploys. Its canonical URL freezes at the last build that landed there — Cloudflare keeps serving that hash forever via the project's canonical alias.

The frozen URL is **unsupported but functional**: anyone still pointing at it gets the old SDK code. Whether the page renders correctly depends on whether the backend still emits the wire shape that SDK version expected. After a backend wire-format change, frozen-URL pages may render gracefully-degraded content (e.g., empty product variants). The freeze is honest about the state: the URL works, the code is what it was, the data may or may not be.

To retire a frozen URL entirely, remove its Kong route (it'll then 404 from `api-prod`). The Pages project itself can be left alone — its `*.pages.dev` URLs keep working but won't be reachable through the public host.

### Per-major project-naming convention

The Pages project name encodes the SDK's major version: `gh-hippo-shop-sdk-vN`. The release workflow's `--project-name` argument is hardcoded to the currently-active project; bumping to a new major requires updating that argument in `.github/workflows/release.yml`. (We considered deriving the name from `package.json` at workflow time but kept it hardcoded for clarity — `grep --project-name release.yml` immediately tells you which major is live.)
```

- [ ] **Step 3: Update the "One-time setup → Cloudflare side → Pages project" paragraph**

Find the current "Pages project — does **not** need to be pre-created..." paragraph. It's accurate but should be augmented to mention the new convention.

Run: `grep -n "Pages project.*does.*not" docs/architecture/cloudflare-deploy.md`

Use Edit.

`old_string`:
```markdown
3. **Pages project** — does **not** need to be pre-created. The first `wrangler pages deploy` will create the project automatically if it doesn't exist, using the supplied `--project-name`.
```

`new_string`:
```markdown
3. **Pages project** — does **not** need to be pre-created. The first `wrangler pages deploy` will create the project automatically if it doesn't exist, using the supplied `--project-name`. By convention the project for SDK major version N is named `gh-hippo-shop-sdk-vN`. Bumping to a new major creates a new project on the first release-workflow run after the `--project-name` change in `.github/workflows/release.yml`.
```

- [ ] **Step 4: Update the "Pages project name is in the workflow" gotcha**

Run: `grep -n "Pages project name is in the workflow" docs/architecture/cloudflare-deploy.md`

Use Edit.

`old_string`:
```markdown
### Pages project name is in the workflow

The workflow hardcodes `--project-name=gh-hippo-shop-sdk`. If the project is renamed in Cloudflare, update `.github/workflows/release.yml` to match.
```

`new_string`:
```markdown
### Pages project name is in the workflow

The workflow hardcodes `--project-name=gh-hippo-shop-sdk-v3` (matches the current SDK major). On a future major bump, update `.github/workflows/release.yml` to the new project name before merging the major-bump PR.
```

- [ ] **Step 5: Verify**

Run: `grep -n "gh-hippo-shop-sdk\b" docs/architecture/cloudflare-deploy.md`
Expected: at least one line in the Kong wiring diagram referring to the old project (in the "frozen" branch); no other free-standing references that imply it's the active project.

Run: `grep -c "gh-hippo-shop-sdk-v3\|Per-major project-naming\|Frozen URL lines" docs/architecture/cloudflare-deploy.md`
Expected: ≥ 3 matches.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/cloudflare-deploy.md
git commit -m "docs(architecture): document per-major Pages-project convention and frozen URL lines"
```

---

## Task 10: Add changesets for both packages

**Files:**
- Create: `.changeset/cluster-b-types-major.md`
- Create: `.changeset/cluster-b-sdk-major.md`

The changesets convention uses random slugs but the actual filename doesn't matter for tooling — only the frontmatter `---` block does. Using descriptive slugs is fine.

- [ ] **Step 1: Confirm `.changeset/` directory is present**

Run: `ls .changeset`
Expected: at least `README.md` and `config.json`.

- [ ] **Step 2: Create the types-package changeset**

Write file `.changeset/cluster-b-types-major.md` with this exact content:

```markdown
---
"@goldenhippo/hippo-shop-types": major
---

**Breaking:** Removed deprecated `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields from `HippoShopProductVariantsDTO`. Use `<tier>List` for iteration or `<tier>ByQuantity` for direct lookup. The replacement fields have been available since v2.0.0.
```

- [ ] **Step 3: Create the sdk-package changeset**

Write file `.changeset/cluster-b-sdk-major.md` with this exact content:

```markdown
---
"@goldenhippo/hippo-shop-sdk": major
---

**Breaking:** Removed the `enrichProduct` export. The SDK now expects the API to emit `<tier>List` and `<tier>ByQuantity` directly — there is no longer a client-side fallback that builds those fields from the legacy `variants.<purchase>.standard` / `.myAccount` arrays. `data-field` paths through the legacy arrays are no longer supported.
```

- [ ] **Step 4: Verify**

Run: `ls .changeset/cluster-b-*.md`
Expected: two files listed.

Run: `head -3 .changeset/cluster-b-types-major.md .changeset/cluster-b-sdk-major.md`
Expected: each file's first three lines match the frontmatter shown above.

- [ ] **Step 5: Dry-run the version bump to confirm the changesets are valid**

Run: `pnpm changeset version --snapshot test`

This is a dry-ish run that won't commit anything but will show what the bump would look like. Expected: output mentions a major bump for both packages from current versions (`2.1.1`/`2.1.0`) to `3.0.0-test-<hash>`.

Discard the snapshot changes:
```bash
git checkout -- packages/types/package.json packages/sdk/package.json .changeset/
```

Wait — `git checkout .changeset/` would also revert the changeset files we just created. Use this instead:
```bash
git checkout -- packages/types/package.json packages/sdk/package.json packages/*/CHANGELOG.md
```

Then run `git status` to confirm the only new files are the two changesets we created.

- [ ] **Step 6: Commit**

```bash
git add .changeset/cluster-b-types-major.md .changeset/cluster-b-sdk-major.md
git commit -m "chore: add v3 major-bump changesets for hippo-shop-types and hippo-shop-sdk"
```

---

## Task 11: Final verification — typecheck, build, test, dist inspection

This task runs against the whole branch after all earlier commits are in. It produces no commit of its own.

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (2 projects: types, sdk). No errors.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: PASS (3 projects: types, sdk, landing).

- [ ] **Step 3: Test**

Run: `pnpm test`
Expected: PASS. SDK test count is one file lower than before (`enrich.spec.ts` removed); types tsd tests pass.

- [ ] **Step 4: Inspect SDK dist**

Run: `grep -c "enrichProduct" packages/sdk/dist/gh.d.ts packages/sdk/dist/gh.d.cts`
Expected: `0` and `0`.

Run: `grep -c "enrichProduct" packages/sdk/dist/gh.mjs packages/sdk/dist/gh.cjs`
Expected: `0` and `0`.

If any of these return non-zero, the build didn't pick up the change. Re-run `pnpm build`.

- [ ] **Step 5: Inspect types dist**

Run: `grep -E "(standard|myAccount):\s+HippoShopProductVariantDTO\[\]" packages/types/dist/index.d.ts`
Expected: zero output (no bare `standard:` or `myAccount:` array fields).

Run: `grep -E "(standardList|standardByQuantity|myAccountList|myAccountByQuantity):" packages/types/dist/index.d.ts | wc -l`
Expected: `8` (four field names × two purchase types).

- [ ] **Step 6: Size guard**

Run: `pnpm size`
Expected: PASS. The SDK bundle is slightly smaller now that `enrichProduct` is removed.

- [ ] **Step 7: Confirm `llms.txt` / `llms-full.txt` regenerated cleanly**

Run: `grep -c "enrichProduct\|deprecated.*variants" packages/sdk/dist/llms.txt packages/sdk/dist/llms-full.txt`
Expected: `0` and `0` (or only contextual mentions in a "removed in v3" historical note if the SDK README contains one — which it shouldn't after Task 7).

- [ ] **Step 8: Repo-level grep audit**

Run: `grep -ri "@deprecated\|enrichProduct" packages/ apps/ docs/ README.md 2>/dev/null | grep -v "docs/superpowers/" | grep -v "node_modules" | grep -v "/dist/" | grep -v "CHANGELOG.md"`

Expected: zero output, OR only references in the spec/plan docs under `docs/superpowers/specs/` and `docs/superpowers/plans/` (those are intentional historical references) which the `-v` filter already excludes.

If anything else is returned, decide per-line whether it's intentional (e.g., a `@deprecated` introduced by a different concern that was not in scope for Cluster B — unlikely but possible) and either keep it with explanation or remove it.

- [ ] **Step 9: Confirm commit log is clean**

Run: `git log --oneline main..HEAD`

Expected: 10 commits, each scoped to one task. Conventional-commits style (`refactor(sdk):`, `feat(types)!:`, `docs(types):`, `docs(sdk):`, `docs:`, `ci:`, `chore:`). The `feat(types)!:` commit should be the only one carrying a `!` breaking-change marker — the SDK refactor is technically not breaking on its own (it removes an internal shim), but the changeset marks the package as breaking because of the wire-shape expectation.

- [ ] **Step 10: Mental dress rehearsal of the release workflow**

This is a thinking step — no commands. Walk through what happens when this branch merges:

1. PR merges to `main`.
2. CI runs the release workflow.
3. Changesets PR is opened (or auto-merged) bumping both packages to `3.0.0`.
4. On merge of that PR, `pnpm release` runs: builds, then `changeset publish` pushes to npm with provenance.
5. The deploy step runs `wrangler@4 pages deploy ... --project-name=gh-hippo-shop-sdk-v3 --branch=main`. Cloudflare auto-creates the new project and uploads `packages/sdk/dist/`.
6. `/sdk/v3/gh.js` becomes reachable through the Kong route (which the engineer has already added per the K1 prerequisite).

If any step of this rehearsal makes you uncertain — for instance, if `npm publish` will fail because the v3.0.0 version already exists for some reason — flag it before merging. A useful sanity command: `npm view @goldenhippo/hippo-shop-sdk@3.0.0 2>&1 | head -3` (expected: "version not found").

---

## Out-of-band actions (engineer-handled, not part of this PR)

These run outside the implementation plan, before/during/after the PR merge. Listed here so they don't get lost:

### Before merge (prerequisites)

- **K1.** Add Kong route `/sdk/v3/*` → `gh-hippo-shop-sdk-v3.pages.dev` on UAT. Verify it responds (404 expected until first deploy).
- **K2 (optional).** Run a one-off `wrangler pages deploy` preview locally to confirm Cloudflare credentials work and the new Pages project gets created. (See `docs/architecture/cloudflare-deploy.md` "Local / emergency deploy" for command pattern.)

### Deploy day (tight-gap window — same working session)

- **D1.** Deploy backend wire-shape change (UAT first, then prod). Commerce API stops emitting `variants.<purchase>.<tier>` arrays and emits `<tier>List` / `<tier>ByQuantity` directly.
- **D2.** Brief window where `/sdk/v1/gh.js` (v2.1.1 SDK) renders empty variants. Acceptable per the spec.
- **D3.** Merge Cluster B PR. Release workflow publishes v3.0.0 and deploys to `/sdk/v3/gh.js`.
- **D4.** Add Kong route for `/sdk/v3/*` on prod (if not already done in K1). Update `apps/examples-static/*.html` to use `/sdk/v3/gh.js` — separate small PR or fold into D3's PR.
- **D5.** Run npm deprecate:
  ```bash
  npm deprecate '@goldenhippo/hippo-shop-sdk@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
  npm deprecate '@goldenhippo/hippo-shop-types@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
  ```

### Verification (post-deploy)

- `npm view @goldenhippo/hippo-shop-sdk version` returns `3.0.0`.
- `curl -I https://api-prod.goldenhippo.io/sdk/v3/gh.js` returns 200.
- `npm view @goldenhippo/hippo-shop-sdk@2.1.1` shows `(DEPRECATED)` in the metadata block.
- Each sample page in `apps/examples-static/` loads and renders populated product variants.

---

## Notes for the implementer

- **Branch off A's cluster-a-restructure branch.** When Cluster A's PR merges, rebase this branch on the final main commit.
- **No changesets for doc-only commits.** Tasks 3–9 don't bump package versions; only Task 10 introduces the changesets, and those describe the breaking changes from Tasks 1 and 2.
- **Don't run `pnpm version-packages` locally.** The release workflow handles that. Local-only operations are `pnpm typecheck && pnpm build && pnpm test` plus the `pnpm changeset version --snapshot test` dry-run inside Task 10 (which is reverted, not committed).
- **The `feat(types)!:` commit message** uses the `!` breaking-change convention. The `refactor(sdk):` commit is intentionally not marked breaking — the changeset is what tells the release pipeline to treat the SDK bump as major, not the commit message.
- **Estimated effort:** Half a day. Most of the time is in the README edits and verifying the verify-steps actually return what you expect.
- **What this plan does NOT cover:** Backend coordination, Kong routing, npm-deprecate execution, sample-page updates. Those are the engineer's manual deploy-day work.
