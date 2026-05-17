# Cluster B — v3.0.0: deprecation removal and major-version cut

**Status:** Design approved, awaiting implementation plan
**Date:** 2026-05-17
**Cluster:** B (of A–F; see [`/ROADMAP.md`](../../../ROADMAP.md))
**Branch:** `feat/cluster-b-v3-major` (off `docs/cluster-a-restructure`)
**Predecessor spec:** [`2026-05-17-cluster-a-docs-restructure-design.md`](./2026-05-17-cluster-a-docs-restructure-design.md)

## Background

Both shipped packages (`@goldenhippo/hippo-shop-types` and `@goldenhippo/hippo-shop-sdk`) carry deprecated array fields under `HippoShopProductVariantsDTO`. The README and SPEC files have promised removal at v3.0.0. Cluster B does that removal and ships v3 of both packages.

The packages have been published to npm (v1.x and v2.x), but there are no real external consumers — only this repo's sample pages, which we control. That fact shapes most of the decisions below, especially around CDN URL handling, deploy sequencing, and the lack of need for a backwards-compat shim.

This work is intentionally tight in scope. Anything that's not strictly the removal of the deprecated arrays is out of scope for B. Other cleanups, security findings, and architectural changes get their own clusters.

## Goals

1. Remove the deprecated `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields from the DTO contract.
2. Remove the corresponding client-side shim (`enrichProduct`) — the SDK becomes a thin pass-through for products.
3. Ship v3.0.0 of both packages to npm.
4. Ship the v3 SDK bundle to a new CDN URL line at `/sdk/v3/gh.js`, freezing the prior `/sdk/v1/` URL at the last v2.1.1 build.
5. Soft-deprecate v1.x and v2.x versions on npm so anyone installing them sees a nudge.

## Non-goals

- No additional deprecations or "while we're at it" cleanups. The four `@deprecated` arrays are the entire scope. Anything else gets its own cluster.
- No package renames or registry moves. Same names, same npm org.
- No CDN URL line at `/sdk/v2/gh.js`. v1 was the only line ever published; v3 gets its own line. Future majors continue the convention (`/sdk/v4/`, `/sdk/v5/`, …).
- No backwards-compat fallback in the SDK. The v3 SDK requires the new wire shape from the API; the API change is coordinated to ship first.
- No changes to funnel, destination, or error DTOs. Only `HippoShopProductVariantsDTO`.
- No changes to the SDK's declarative attributes, formatters, lifecycle events, or programmatic API. The SDK contract is otherwise unchanged.

## Decisions

### Scope: only the four `@deprecated` arrays

The only DTO fields being removed are:

- `HippoShopProductVariantsDTO.subscription.standard`
- `HippoShopProductVariantsDTO.subscription.myAccount`
- `HippoShopProductVariantsDTO.oneTime.standard`
- `HippoShopProductVariantsDTO.oneTime.myAccount`

Each is replaced (in the existing v2.x type) by its `<tier>List` (ordered iteration) and `<tier>ByQuantity` (direct lookup) siblings. Those siblings are unchanged in v3 — they're already the recommended path in v2.x.

The SDK's `enrichProduct()` function exists today to build `<tier>List` and `<tier>ByQuantity` from the deprecated arrays returned by the API. With the API emitting the new shape directly in v3, `enrichProduct()` becomes redundant and is removed.

### Version: v3.0.0 under existing names + context paragraph

Both packages bump to v3.0.0 under their current names. No rename, no registry move. The user-visible signal that "this is the first version we'd call production-ready" lives in a short "About this version" paragraph in the root `README.md`. The types and SDK READMEs each get a one-line pointer to that context rather than duplicating the paragraph.

The "v1.0.0 reset" idea was considered and discarded — npm only allows unpublishing within 72 hours of publish, and every existing v1.x / v2.x version is locked in. A reset would require a package rename, and the operational cost of that (consumer migrations, badge updates, npm Trusted Publishers reconfiguration, CI changes, CDN URL contract phrasing, sample page updates) is not justified by the aesthetic gain.

### Runtime: API emits new shape directly; SDK pass-through

Today the commerce API emits `variants.<purchase>.<tier>` as an array, and the SDK's `enrichProduct()` builds the `<tier>List` and `<tier>ByQuantity` siblings client-side. In v3, the API emits `<tier>List` and `<tier>ByQuantity` directly and drops the deprecated array.

The API change is coordinated by the same engineer (this is doable because the project isn't live yet). It ships first, ahead of the v3 SDK publish.

`enrichProduct()` is removed entirely from the SDK — no tolerant fallback. The trade-off accepted with this choice: a brief deploy-gap window where the v2.1.1 SDK (still on `/sdk/v1/gh.js`) sees the new wire shape and renders empty variants. This is acceptable because no consumer outside this repo's sample pages is on that URL. The window is closed by updating the sample pages to `/sdk/v3/gh.js` minutes after the v3 publish.

### CDN URL: `/sdk/v3/gh.js` on a new Cloudflare Pages project; freeze `/sdk/v1/`

A new Cloudflare Pages project `gh-hippo-shop-sdk-v3` will host the v3 build. Cloudflare auto-creates the project on the first `wrangler pages deploy` with that `--project-name`, so no manual Pages-project provisioning is required. The release workflow flips its `--project-name` argument to `gh-hippo-shop-sdk-v3`.

A new Kong route `/sdk/v3/*` → `gh-hippo-shop-sdk-v3.pages.dev` is added manually as a prerequisite (handled out-of-band by the engineer with Kong admin access).

The existing `/sdk/v1/*` Kong route stays unchanged. The existing `gh-hippo-shop-sdk` Pages project stops receiving deploys. It freezes at the last v2.1.1 build automatically — Cloudflare keeps the canonical alias pointing at that hash forever. Pre-v3 CDN URLs are declared **unsupported but functional** (frozen at v2.1.1 with the original wire shape, which the backend no longer emits, meaning these pages will render empty variants if anyone still hits them).

Convention established by this cluster: each npm major gets its own Pages project (`gh-hippo-shop-sdk-vN`) and its own Kong route (`/sdk/vN/*`). The previous major's URL freezes. Future majors continue the pattern.

### npm deprecation on v2.x

Once v3 ships and the production CDN deploy is verified, deprecate the v1.x and v2.x versions on npm so anyone installing them sees a `WARN` line nudging them to v3:

```
npm deprecate '@goldenhippo/hippo-shop-sdk@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
npm deprecate '@goldenhippo/hippo-shop-types@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
```

This is a one-time manual step run by the engineer after the release workflow publishes.

### Cluster D (security audit) runs separately, after B

The original Cluster B framing suggested running the security audit "with" the deprecation cleanup. With scope tightened to just the four arrays, the security audit's findings are unlikely to affect this specific release. If D's findings later require breaking changes, those ship as v4 — and "v4" is a believable story given v3 has a clear narrative behind it (the deprecated-array removal).

## What changes

### In this repo

**Code:**
- `packages/types/src/product.ts` — delete the four `@deprecated` array fields from `HippoShopProductVariantsDTO`. Adjust surrounding JSDoc to describe the cleaned shape (no longer mentions the deprecated arrays at all).
- `packages/sdk/src/enrich.ts` — delete the file.
- `packages/sdk/src/index.ts` — remove the `export { enrichProduct } from './enrich';` line.
- `packages/sdk/src/client.ts` — at the call site (currently line 59), remove the `enrichProduct(raw)` call and pass `raw` through directly.
- `packages/sdk/test/enrich.spec.ts` — delete the file. No replacement; the SDK is now a pass-through for products and there is nothing left to test in this module.

**Contract docs (from Cluster A):**
- `packages/types/SPEC.md` — update the "Deprecated surface" table. Replace with a one-sentence note: "No deprecated surface in v3. v1.x and v2.x carried legacy variant arrays under `variants.<purchase>.<tier>` (deprecated); these were removed in v3.0.0."
- `packages/sdk/SPEC.md` — same treatment on the deprecated table. Also update the "Stability" or "About this version" framing to note that v3 is the first major intended for use by other internal teams.

**Top-level docs:**
- `/README.md` — add a short "About this version" paragraph (under "Hippo Shop" or above "Quickstart") explaining that v1.x and v2.x were internal-only iterations and v3 is the first version intended for use by other internal teams. Remove the existing sentence at `README.md:51` that says `variants.<purchase>.<tier>` is "**deprecated** array shape, removed in v3.0.0" — the deprecation has actually happened and the field is gone.
- `packages/types/README.md` — remove the `/* deprecated mirror of standardList — removed in v3.0.0 */` comment from the example block at line 135 (and the surrounding deprecation reference). Add a one-line pointer to the root README's "About this version" paragraph.
- `packages/sdk/README.md` — remove the `> **Deprecation:** …` block at line 184. Add a one-line pointer to the root README's "About this version" paragraph.

**Release pipeline:**
- `.github/workflows/release.yml` — change `--project-name=gh-hippo-shop-sdk` to `--project-name=gh-hippo-shop-sdk-v3` in the "Deploy SDK to Cloudflare Pages" step.
- `docs/architecture/cloudflare-deploy.md` — add a section explaining the per-major Pages-project convention, document the freeze on `/sdk/v1/`, and note the project-name pattern (`gh-hippo-shop-sdk-vN`). Update the Kong wiring diagram to show both `/sdk/v1/` (frozen) and `/sdk/v3/` (active) routes.

**Changesets:**
- One major-bump changeset per package:
  - `@goldenhippo/hippo-shop-types`: "**Breaking:** Removed deprecated `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields from `HippoShopProductVariantsDTO`. Use `<tier>List` for iteration or `<tier>ByQuantity` for direct lookup."
  - `@goldenhippo/hippo-shop-sdk`: "**Breaking:** Removed `enrichProduct` export. The SDK now expects the API to emit `<tier>List` and `<tier>ByQuantity` directly. `data-field` paths through `variants.<purchase>.standard` and `.myAccount` are no longer supported."

### Outside this repo (engineer-handled)

- **Backend:** commerce API stops emitting the deprecated `variants.<purchase>.<tier>` arrays and emits `<tier>List` / `<tier>ByQuantity` directly. Deploys to UAT first, then prod.
- **Kong:** new route `/sdk/v3/*` → `gh-hippo-shop-sdk-v3.pages.dev`. Configured on UAT first, then prod. (Mirror of the existing `/sdk/v1/*` route.)
- **npm deprecate:** the two `npm deprecate` commands above, run from a terminal after v3 publishes successfully.

### Not changed

- DTO types in `funnel.ts`, `destination.ts`, `errors.ts` — unchanged.
- SDK's declarative attributes, formatters, lifecycle events, programmatic API surface — unchanged.
- `packages/types/src/index.ts` barrel export — same exported names; only the internal shape of `HippoShopProductVariantsDTO` changes.
- CDN URL `/sdk/v1/gh.js` — stays alive forever, frozen at the last v2.1.1 build.

## Execution sequence

### Pre-merge work (in this repo)

10 logical commits on `feat/cluster-b-v3-major`:

1. Remove deprecated arrays from `packages/types/src/product.ts`.
2. Remove `enrichProduct` (delete `enrich.ts`, remove export and call site).
3. Delete `packages/sdk/test/enrich.spec.ts`.
4. Update `packages/types/SPEC.md`.
5. Update `packages/sdk/SPEC.md`.
6. Update root README (`About this version` paragraph + remove deprecation line) and the two package READMEs (remove deprecation references + one-line pointer to root).
7. Flip `--project-name` in `.github/workflows/release.yml`.
8. Update `docs/architecture/cloudflare-deploy.md` (new convention + freeze policy).
9. Add changesets for both packages (major bumps, migration notes).
10. Local verification — `pnpm typecheck && pnpm build && pnpm test` must pass. Inspect `packages/sdk/dist/gh.d.ts` to confirm `enrichProduct` is absent from the published surface. Inspect `packages/types/dist/index.d.ts` to confirm the deprecated array fields are absent.

### Pre-merge prerequisites (manual, engineer)

- **K1.** Add Kong route for `/sdk/v3/*` → `gh-hippo-shop-sdk-v3.pages.dev` on UAT. The route should respond (404 expected until first deploy).
- **K2.** (Optional) Run a one-off `wrangler pages deploy` preview locally to verify Cloudflare credentials work and the new Pages project gets auto-created:
  ```bash
  cd ~/Code/hippo-shop
  pnpm --filter @goldenhippo/hippo-shop-sdk build
  read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
  export CLOUDFLARE_ACCOUNT_ID=<account-id>
  npx --yes wrangler@4 pages deploy packages/sdk/dist \
    --project-name=gh-hippo-shop-sdk-v3
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  ```
  This creates a preview deploy (no `--branch=main`) and confirms the project provisions correctly.

### Deploy day (tight-gap window — same working session)

Run these in sequence, ideally within 2–3 hours of attention:

- **D1.** Backend deploys v3 wire shape. UAT first, verify products fetch and render correctly via `/sdk/v3/gh.js` preview (if K2 was done). Then prod.
- **D2.** Brief window: `/sdk/v1/gh.js` (still serving v2.1.1) hits the new backend, falls through the `Array.isArray(arr) ? arr : []` branch in `enrichProduct`, and renders empty variants. Acceptable per the tight-gap choice. No external consumers affected.
- **D3.** Merge Cluster B PR to main. The Changesets workflow runs:
  1. Opens (or auto-merges) the "Release PR".
  2. On merge, publishes `@goldenhippo/hippo-shop-types@3.0.0` and `@goldenhippo/hippo-shop-sdk@3.0.0` to npm with provenance.
  3. Deploys `packages/sdk/dist/` to `gh-hippo-shop-sdk-v3` Pages project (auto-created on first deploy). `/sdk/v3/gh.js` is now live via the Kong route added in K1.
- **D4.** Add Kong route for `/sdk/v3/*` on prod (if not already done). Update `apps/examples-static/*.html` to reference `/sdk/v3/gh.js`. Verify pages render correctly. Commit on a follow-up PR or fold into D3's PR (preferred — same atomic ship).
- **D5.** Deprecate v1.x and v2.x on npm:
  ```bash
  npm deprecate '@goldenhippo/hippo-shop-sdk@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
  npm deprecate '@goldenhippo/hippo-shop-types@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
  ```

### Verification

- After D3: `npm view @goldenhippo/hippo-shop-sdk version` returns `3.0.0`. `curl -I https://api-prod.goldenhippo.io/sdk/v3/gh.js` returns 200 and a Cloudflare `cf-ray` header.
- After D4: load each sample page in `apps/examples-static/`, confirm products render with populated variant cards (price, quantity, tier).
- After D5: `npm view @goldenhippo/hippo-shop-sdk@2.1.1` shows `(DEPRECATED)` in the metadata block. Likewise for `@2.1.0`, `@2.0.0`, `@1.x.x`, etc.

### Rollback

- **v3 ships and immediately fails:** Cloudflare dashboard → `gh-hippo-shop-sdk-v3` → Deployments → roll back to a previous v3 deploy (if any). npm v3.0.0 stays published — npm allows unpublish only within 72 hours, and the cluster's policy is to forward-fix with a patch (v3.0.1) rather than unpublish. Pages serves the prior hash via the canonical alias.
- **Catastrophic v3 failure with no quick fix:** revert sample pages to `/sdk/v1/gh.js`. They render empty variants (the backend already shipped the new shape), but the site stays up. Real recovery requires rolling back the backend's wire-shape change too.

## Dependencies and ordering

- **Depends on Cluster A.** A creates the SPEC.md files this cluster modifies (the "Deprecated surface" tables). B branches off A and rebases on the final main commit after A merges.
- **Blocks Cluster D execution if D requires architectural changes** that would break the v3 contract. Pragmatically: D runs after B, and any D findings that need breaking changes ship as v4. The "/sdk/vN/" CDN convention established by B makes this clean.
- **Independent of C, E, F.** Cluster C (Slack release webhook) can run before, after, or interleaved with B — they touch different parts of CI. Cluster E (admin UI) depends on B only insofar as it would prefer to be on top of v3 contracts. Cluster F (SDK session/UTM) is far enough downstream to be independent.

## Effort

- In-repo changes: ~1 day of focused work. Most of it is the SPEC and README edits + careful changeset wording; the actual code change is small.
- Manual ops (Kong routes, npm deprecate): 1–2 hours of focused work.
- Deploy day session: 2–3 hours including coordination, verification, and the sample-page update.

## Open questions

None. All decisions resolved during brainstorming.
