# Cluster A — Docs Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace aspirational "partner"-framed planning docs with contract-only `SPEC.md` files (root + each shipped package), stand up `/ROADMAP.md` as the canonical backlog with GitHub Issues disabled, and reorganize `docs/` into `architecture/` and `ops/`. Light tone-scrub on surviving docs and JSDoc. No code or public-API changes.

**Architecture:** Pure docs + JSDoc work. Three new top-level docs (`/SPEC.md`, `/ROADMAP.md`, and per-package `SPEC.md`). Four existing docs move into `docs/architecture/` or `docs/ops/`. Four obsolete docs are deleted (git history preserves them). Light prose rewrites swap "partner" for "you / your team" in user-facing voice and "the host page" in third-person JSDoc. One out-of-band action: `gh repo edit` to disable GitHub Issues after merge.

**Tech Stack:** Markdown only. pnpm, nx, tsup, vitest already configured. `gh` CLI for the post-merge Issues setting.

**Reference spec:** `docs/superpowers/specs/2026-05-17-cluster-a-docs-restructure-design.md`

---

## File structure

**New files:**
- `/SPEC.md` — repo-level contract
- `/ROADMAP.md` — canonical backlog
- `/packages/sdk/SPEC.md` — SDK public contract
- `/packages/types/SPEC.md` — DTO contract
- `/docs/architecture/cloudflare-deploy.md` — moved from `/docs/`
- `/docs/architecture/kong-public-routing.md` — moved from `/docs/`
- `/docs/ops/release-process.md` — moved from `/docs/`
- `/docs/ops/incident-response.md` — moved from `/docs/`

**Deleted files:**
- `/docs/dto-contract-v1.md`
- `/docs/public-dtos-v1-contract.md`
- `/docs/hippo-shop-combined-implementation-plan.md`
- `/docs/onboarding-partners.md`

**Modified files (prose only — no code changes):**
- `/README.md` — add links to SPEC.md and ROADMAP.md; fix bottom-of-file wiki pointer
- `/packages/sdk/README.md` — 5 "partner" mentions get the mix-rule treatment
- `/packages/types/src/funnel.ts` — 1 JSDoc line (line 33)
- `/packages/types/src/destination.ts` — 1 JSDoc line (line 7)
- `/packages/types/src/errors.ts` — 1 JSDoc line (line 6)
- `/packages/sdk/src/bindings.ts` — 3 JSDoc lines (lines 4, 22, 139)
- `/packages/sdk/src/format.ts` — 1 JSDoc line (line 3)
- `/docs/architecture/kong-public-routing.md` — tone scrub (13 hits) and a delete-removed cross-link to onboarding-partners.md
- `/docs/ops/incident-response.md` — tone scrub (11 hits)
- `/docs/architecture/cloudflare-deploy.md` — verify-only; expected to be a no-op
- `/docs/ops/release-process.md` — verify-only; expected to be a no-op

**Vocabulary rule (apply consistently):**
- User-facing prose (READMEs, SPECs, docs a person reads): `partner(s)` → `you / your team / your funnel page`. Pick the natural fit per sentence.
- Third-person JSDoc (where second-person reads awkwardly): `partner(s)` → `the host page` / `host pages`.
- Kong-specific operational docs where the term **"consumer"** is Kong's API entity: prefer `consumer` over a generic substitute. `partner-<slug>` (a Kong consumer-naming convention) stays as a literal example since it's the current naming, but call out in prose that consumers represent internal Golden Hippo teams or brands, not external partners.
- References to a fictional "partner-relations" team — replace with the appropriate internal team or a generic phrase like "the team that owns the consumer." The implementer should apply judgement per occurrence; flag any cases of uncertainty in the PR description.

---

## Task 1: Add `/SPEC.md` (repo-level contract)

**Files:**
- Create: `/SPEC.md`

- [ ] **Step 1: Confirm starting state**

Run: `test ! -f SPEC.md && echo "absent" || echo "exists"`
Expected: `absent`

- [ ] **Step 2: Create `/SPEC.md` with the following exact content**

```markdown
# Hippo Shop — Contract

Hippo Shop is a typed, key-authenticated, brand-scoped public read surface for Golden Hippo's funnel, destination, and product data. It is consumed from the browser via a script-tag SDK with declarative HTML bindings and a small programmatic API.

This document is the contract. What is documented here is what Hippo Shop promises to do. Implementation details, how-it-works architecture, and operational runbooks live elsewhere (see "Where to read next" at the bottom).

## Audience

Golden Hippo's internal teams building landing pages, sales funnels, and supporting marketing surfaces. Hippo Shop is not a partner SDK and does not currently support external organizations.

## What it guarantees

- **Typed DTOs** that match what the public API returns, published as `@goldenhippo/hippo-shop-types` with zero runtime dependencies.
- **Auto-booting browser SDK** distributed as `@goldenhippo/hippo-shop-sdk` and served from a stable CDN URL. The host page drops in one `<script>` tag with `data-key` and `data-brand` attributes; the SDK attaches `window.gh`.
- **Declarative bindings** — `data-gh-*`, `data-field`, `data-format`, `data-with`, `data-when`, and related attributes — that read DTOs into HTML without JavaScript.
- **Programmatic API** at `window.gh.data` for `funnel`, `destination`, and `product` lookups when declarative bindings are not enough.
- **Brand-scoped isolation** — every request is scoped to one brand by the `data-brand` attribute and the access key. Cross-brand reads return 404.
- **Access-key gating** — only origins explicitly allow-listed for a key may use the API. 401 from Kong on unknown keys; 403 from CORS for unknown origins.
- **SLSA-provenanced npm releases** for both packages via npm Trusted Publishers.
- **URL stability** for the CDN-hosted SDK: `https://api-prod.goldenhippo.io/sdk/v1/gh.js` is the stable entry point; major-version upgrades will use a new URL path.

## What it does NOT do

- **No write operations.** Read-only by design. Cart, checkout, and order writes belong to other systems.
- **No PII.** Public read surface; nothing per-shopper.
- **No server-side rendering.** Browser-only. Node integrations consume the types package and the live API directly, not the SDK runtime.
- **No framework lock-in.** The SDK is framework-agnostic vanilla DOM; it can be used inside React, Vue, vanilla HTML, page builders, or anywhere a browser parses HTML.

## Surface map

| Surface | Lives in | Contract document |
|---|---|---|
| DTO shapes | `@goldenhippo/hippo-shop-types` | [`packages/types/SPEC.md`](./packages/types/SPEC.md) |
| Browser SDK | `@goldenhippo/hippo-shop-sdk` | [`packages/sdk/SPEC.md`](./packages/sdk/SPEC.md) |
| Public HTTP API | Kong route `/public/v1/*` on `api-{uat,prod}.goldenhippo.io` | [`docs/architecture/kong-public-routing.md`](./docs/architecture/kong-public-routing.md) |
| SDK delivery CDN | Cloudflare in front of an R2 origin | [`docs/architecture/cloudflare-deploy.md`](./docs/architecture/cloudflare-deploy.md) |

## Stability commitment

- Both npm packages follow semver. Breaking DTO or SDK changes ship in a major.
- Deprecated surfaces are documented in the package SPECs and stay alive for at least one minor release before removal.
- The CDN script URL `https://api-prod.goldenhippo.io/sdk/v1/gh.js` will not break for v1.x. v2 will publish to a separate URL path so embedded pages can upgrade on their own schedule.

## Roadmap and backlog

Open ideas, bugs, and enhancement requests live in [`/ROADMAP.md`](./ROADMAP.md). GitHub Issues is intentionally disabled — `/ROADMAP.md` is canonical. Items can be added or picked up by talking to Claude in this repository.

## Where to read next

- Using the SDK on a page → [`packages/sdk/README.md`](./packages/sdk/README.md)
- DTO field reference → [`packages/types/README.md`](./packages/types/README.md)
- How requests flow through Kong → [`docs/architecture/kong-public-routing.md`](./docs/architecture/kong-public-routing.md)
- How the SDK is delivered from the CDN → [`docs/architecture/cloudflare-deploy.md`](./docs/architecture/cloudflare-deploy.md)
- Releasing a new version → [`docs/ops/release-process.md`](./docs/ops/release-process.md)
- Responding to an incident → [`docs/ops/incident-response.md`](./docs/ops/incident-response.md)
```

- [ ] **Step 3: Verify file exists with correct content**

Run: `head -1 SPEC.md`
Expected: `# Hippo Shop — Contract`

- [ ] **Step 4: Commit**

```bash
git add SPEC.md
git commit -m "docs: add repo-level SPEC.md (contract)"
```

---

## Task 2: Add `/packages/types/SPEC.md`

**Files:**
- Create: `/packages/types/SPEC.md`

- [ ] **Step 1: Confirm starting state**

Run: `test ! -f packages/types/SPEC.md && echo "absent" || echo "exists"`
Expected: `absent`

- [ ] **Step 2: Create `/packages/types/SPEC.md` with the following exact content**

```markdown
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

The following are still exported in v2.x but are scheduled for removal in v3.0.0 (covered by a separate work cluster). Prefer the indicated replacements.

| Deprecated | Replacement | Scheduled removal |
|---|---|---|
| `HippoShopProductVariantsDTO.subscription.standard` | Use `standardList` (iteration) or `standardByQuantity` (lookup) | v3.0.0 |
| `HippoShopProductVariantsDTO.subscription.myAccount` | Use `myAccountList` or `myAccountByQuantity` | v3.0.0 |
| `HippoShopProductVariantsDTO.oneTime.standard` | Use `standardList` or `standardByQuantity` | v3.0.0 |
| `HippoShopProductVariantsDTO.oneTime.myAccount` | Use `myAccountList` or `myAccountByQuantity` | v3.0.0 |

## Stability

- Adding optional fields to existing types is a minor.
- Adding new exported types is a minor.
- Removing or narrowing any documented field is a major.
- Promoting a field from optional to required is a major.
```

- [ ] **Step 3: Verify content matches the actual exports**

Run: `node -e "const fs=require('fs'); const idx=fs.readFileSync('packages/types/src/index.ts','utf8'); const exports=[...idx.matchAll(/HippoShop\w+/g)].map(m=>m[0]); const spec=fs.readFileSync('packages/types/SPEC.md','utf8'); for(const e of exports){ if(!spec.includes(e)) console.log('MISSING:',e); } console.log('done');"`
Expected: `done` with no `MISSING:` lines.

- [ ] **Step 4: Commit**

```bash
git add packages/types/SPEC.md
git commit -m "docs(types): add SPEC.md (DTO contract)"
```

---

## Task 3: Add `/packages/sdk/SPEC.md`

**Files:**
- Create: `/packages/sdk/SPEC.md`

- [ ] **Step 1: Confirm starting state**

Run: `test ! -f packages/sdk/SPEC.md && echo "absent" || echo "exists"`
Expected: `absent`

- [ ] **Step 2: Read the SDK source surface so the content matches reality**

Read the following files end-to-end. The SPEC content must match what these files actually export and document:
- `packages/sdk/src/index.ts` — module exports, `boot()` semantics, `gh:data-ready` event name, `findScript()` lookup rules
- `packages/sdk/src/bindings.ts` — declarative attribute behavior (`data-gh-*`, `data-field`, `data-format`, `data-with`, `data-when`, `data-if`, loops)
- `packages/sdk/src/config.ts` — what `parseScriptConfig` reads from the script tag (`data-key`, `data-brand`, optional `data-debug`)
- `packages/sdk/src/format.ts` — built-in formatters and their syntax
- `packages/sdk/src/errors.ts` — `GhError` and `GhErrorCode` values
- `packages/sdk/README.md` — sections "Declarative attributes", "Formatters", "Programmatic API", "Lifecycle events", "Errors"

These are the source of truth. The SPEC is a stable summary of what they expose, not a duplicate.

- [ ] **Step 3: Create `/packages/sdk/SPEC.md` with the following content, filling in the bracketed enumerations from the source files in Step 2**

```markdown
# `@goldenhippo/hippo-shop-sdk` — Contract

Browser SDK for reading Golden Hippo public data — funnels, destinations, products. Loads from a `<script>` tag and exposes two surfaces: declarative HTML bindings and a programmatic `window.gh` API.

What is documented here is what the SDK promises. Walkthroughs, recipes, and copy-paste examples live in [`README.md`](./README.md). Implementation details and internal modules are not part of the contract.

## Boot model

The SDK ships as an IIFE bundle (`gh.js`) intended to be loaded from a stable CDN URL:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_yourbrand_xxxxxx"
        data-brand="Your Brand"></script>
```

When the script evaluates, it locates its own `<script>` element (via `document.currentScript` or a fallback selector on `[data-key][data-brand][src*="/sdk/v1/gh"]`), reads its `data-*` attributes, and attaches `window.gh`. Loading the SDK from any unrecognized host throws a config error and refuses to attach — the host is part of the contract.

Attributes read from the script tag:
- `data-key` (required) — public access key issued by Golden Hippo.
- `data-brand` (required) — the brand this page reads data for.
- `data-debug` (optional) — when present and truthy, enables structured `[gh]` console logging.

After successful boot:
- `window.gh.data` is set with `funnel`, `destination`, and `product` methods.
- `window.gh.bind`, `window.gh.refresh`, and `window.gh.format` are exposed.
- A `gh:data-ready` event is dispatched on `window`.
- Auto-binding runs against the current DOM.

If the script cannot find its own tag, cannot parse its config, or finds `window.gh.data` already set, it refuses to attach and logs a clear error to the console.

## Declarative attributes

The full attribute set is below. Cross-check against `packages/sdk/src/bindings.ts` and the "Declarative attributes" section of `README.md` when filling this in — if you find an attribute supported in source that isn't in this list, add it.

- `data-gh-funnel` / `data-gh-destination` / `data-gh-product` — resource-binding root. Value is the resource slug.
- `data-field="<path>"` — write the resolved value into the element's `textContent` (never `innerHTML`). Dot-paths are supported; missing paths leave the placeholder.
- `data-format="<formatter>[:<args>]"` — apply a built-in or registered formatter (see below). Composes with `data-field`.
- `data-with="<path>"` — narrow the binding scope for an element and its descendants. If the path resolves to `null` or `undefined`, the element hides cleanly.
- `data-when="loaded | loading | failed"` — show the element only when the closest resource ancestor is in that lifecycle state.
- `data-if="<path>"` — show the element only when the path resolves to a truthy value.
- `data-each="<path>"` and `<template data-each>` for loops — iterate over arrays; the SDK clones the template per item with a scoped binding root.
- `data-attr-<name>="<path>"` — write the resolved value into an attribute. Values pass through `textContent` semantics — markup cannot inject scripts or styles.

All field values render through `textContent`, never `innerHTML`. Data can never inject markup, scripts, or styles. This is the single most important guarantee.

`on*` attribute bindings (`data-attr-onclick` and friends) are silently ignored. This is by design and is not a bug.

## Formatters

Built-in formatters, applied via `data-format="<name>[:<arg1>[:<arg2>…]]"`. All formatters are non-throwing — malformed specs or unconvertible values fall back to `String(value)` so a single bad binding never breaks the rest of the page.

| Name | Signature | Notes |
|---|---|---|
| `currency` | `currency:<ISO-code>:<locale>` | Uses `Intl.NumberFormat` with `style: 'currency'`. Both args optional; default currency is USD. |
| `number` | `number:<decimals>:<locale>` | Locale-aware number formatting. Decimals fixes both min and max fraction digits. |
| `percent` | `percent:<decimals>:<locale>` | Value is interpreted as a fraction (`0.25` → `"25%"`). |
| `uppercase` | `uppercase` | `String(value).toUpperCase()`. |
| `lowercase` | `lowercase` | `String(value).toLowerCase()`. |
| `bool` | `bool:<truthy>:<falsy>` | Render one of two strings based on truthiness. Defaults are `'true'` and `'false'`. |
| `join` | `join:<separator>` | Joins arrays. Default separator is `", "`. |

Custom formatters can be registered via `window.gh.format.register(name, fn)`.

`FormatRegistry` also exposes typed convenience accessors for `currency`, `number`, and `percent` on the registry instance — see "Programmatic API."

## Programmatic API

Surface on `window.gh`:

- `window.gh.data.funnel(slug: string): Promise<HippoShopFunnelDTO>`
- `window.gh.data.destination(slug: string): Promise<HippoShopDestinationDTO>`
- `window.gh.data.product(slug: string): Promise<HippoShopProductDTO>`
- `window.gh.bind(root?: Element | Document): Promise<void>` — manually trigger a binding pass against a subtree.
- `window.gh.refresh(): Promise<void>` — clear the resource cache and rebind.
- `window.gh.format` — the `FormatRegistry` for registering custom formatters.

Errors thrown by the data methods are `GhError` instances with a typed `.code` (see "Error contract" below).

## Lifecycle events

Dispatched on `window`:

- **`gh:data-ready`** — fired once after the SDK has attached `window.gh.data` and is ready to accept calls. Payload: `Event` (no `detail`).
- **`gh:bindings-ready`** — fired after each binding pass completes (initial pass on boot, plus any subsequent `bind()` or `refresh()` calls). Payload: `Event` (no `detail`).

## Error contract

`GhError` is a public class extending `Error` with the following surface:

- `code: GhErrorCode` — typed discriminator (closed enum below).
- `retryAfterMs: number | null` — populated for `rate_limited`; otherwise `null`.
- `cause: unknown` — optional underlying error (e.g. a fetch-level failure).
- `name === 'GhError'`.

`GhErrorCode` values:

| Code | When it fires |
|---|---|
| `not_found` | 404 from the API. Slug doesn't exist for your brand, or the brand isn't authorized to see it. The two cases are deliberately indistinguishable — you cannot enumerate resources you don't own. |
| `rate_limited` | 429 from Kong. `retryAfterMs` is parsed from `Retry-After` (or a comparable header) and exposed on the error. |
| `forbidden` | 403 from Kong. CORS or key denied; usually a misconfigured origin allow-list. |
| `bad_request` | 400 from the API. Malformed request shape — rare for SDK callers and typically indicates an SDK-level bug. |
| `network` | Client-side network failure before the request completed (DNS, offline, CORS preflight rejection that surfaces as a fetch error, etc.). |
| `bad_config` | Refusal at boot or at request time because the SDK config is invalid (missing `data-key`/`data-brand`, unrecognized API host, etc.). |
| `server` | 5xx upstream. |

## Advanced exports (stable but not recommended)

The package also exports these for advanced consumers building a custom auto-boot, instantiating the runtime inside a framework, or reusing utilities:

- `boot(doc?, win?): boolean` — entry point that returns whether it attached.
- `GhDataClient` — typed HTTP client class.
- `GhRuntime` — DOM-binding runtime class.
- `parseScriptConfig(script): GhConfig` — extracts config from a script element. Throws `ConfigError` on invalid input.
- `GhConfig` (type) — the parsed script-tag config shape.
- `GhWindow` (interface) — the shape of `window.gh` after boot (`data`, `bind`, `refresh`, `format`, optional `debug`).
- `FormatRegistry`, `builtinFormatters` — formatter registry class plus the built-in set.
- `applyBindings`, `collectResources`, `ResourceState` — low-level binding primitives.
- `getByPath` — dot-path lookup utility.
- `enrichProduct` — quantity-keyed variant builder applied to product responses.

These are versioned with the rest of the package but are not the recommended path. The `default` export is reserved.

## Deprecated surface

Currently-shipping SDK behavior depends on deprecated DTO fields in `@goldenhippo/hippo-shop-types`. Specifically:

| Deprecated path | Replacement | Scheduled removal |
|---|---|---|
| `data-field="variants.subscription.standard"` (and the other three matching paths) | Use `*List` for iteration or `*ByQuantity` for direct lookup | v3.0.0 |

No SDK-internal API is currently marked `@deprecated`. When v3 removes the deprecated paths from the types package, the SDK's path lookup will simply stop seeing them.

## Stability

- Adding new attributes, formatters, lifecycle events, or programmatic methods is a minor.
- Removing or narrowing any documented attribute, formatter, event, or method is a major.
- Changing default behavior of an existing attribute or method is a major.
```

- [ ] **Step 4: Verify the SPEC matches the actual SDK surface**

Run:
```bash
node -e "const fs=require('fs'); const idx=fs.readFileSync('packages/sdk/src/index.ts','utf8'); const exports=[...idx.matchAll(/^export.*?\\b(\\w+)\\b/gm)].map(m=>m[1]).filter(x=>!['type','interface','function','const','class','default'].includes(x)); const spec=fs.readFileSync('packages/sdk/SPEC.md','utf8'); for(const e of exports){ if(!spec.includes(e)) console.log('MISSING:',e); } console.log('done');"
```
Expected: `done` with no `MISSING:` lines. (Some grep hits may be intentionally absent — e.g. internal helpers — but every top-level public symbol from `index.ts` should appear in the SPEC.)

Also confirm error codes match:
```bash
diff <(grep -oE "'(not_found|rate_limited|forbidden|bad_request|network|bad_config|server)'" packages/sdk/src/errors.ts | sort -u) <(grep -oE "(not_found|rate_limited|forbidden|bad_request|network|bad_config|server)" packages/sdk/SPEC.md | sort -u | sed "s/^/'/;s/$/'/")
```
Expected: no diff output.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/SPEC.md
git commit -m "docs(sdk): add SPEC.md (SDK contract)"
```

---

## Task 4: Add `/ROADMAP.md` (canonical backlog, seeded with clusters B–F)

**Files:**
- Create: `/ROADMAP.md`

- [ ] **Step 1: Confirm starting state**

Run: `test ! -f ROADMAP.md && echo "absent" || echo "exists"`
Expected: `absent`

- [ ] **Step 2: Create `/ROADMAP.md` with the following exact content**

```markdown
# Hippo Shop Roadmap

This file is the canonical backlog for Hippo Shop. Bugs, enhancements, ideas, and in-progress work all live here. GitHub Issues is intentionally disabled on this repository — this document is the single source of truth for "what's next."

Items can be added, updated, or removed collaboratively by working with Claude in this repo. When you pick something up, flip the status to `in-progress` and write a design spec in `docs/superpowers/specs/`. When it ships, set status to `done`. Done items are pruned periodically.

## Item template

```text
### <short title>
Status: idea | bug | enhancement | spike | in-progress | done
Added: YYYY-MM-DD

<body — repro steps if bug, reasoning if idea, acceptance criteria if enhancement>

Related: <links to specs, PRs, architecture docs if any>
```

---

## Open items

### Cluster B — Remove deprecated APIs and ship next major
Status: idea
Added: 2026-05-17

Remove the deprecated non-`ByQuantity` variant arrays (`subscription.standard`, `subscription.myAccount`, `oneTime.standard`, `oneTime.myAccount`) from `HippoShopProductVariantsDTO` and any related SDK paths. Settle the version-number question — the current trajectory is v3.0.0, but since the packages have never been used in production a clean reset to v1.0.0 is on the table. Update the `Deprecated surface` sections of `packages/types/SPEC.md` and `packages/sdk/SPEC.md` as part of this work.

Related: `docs/superpowers/specs/2026-05-17-cluster-a-docs-restructure-design.md` (predecessor)

### Cluster C — Slack release webhook in CI
Status: idea
Added: 2026-05-17

Have the release workflow post a webhook-based Slack message whenever a package version is published. Small, independent change to `.github/workflows/release.yml`.

### Cluster D — Security audit
Status: idea
Added: 2026-05-17

General security review of the repo. Open questions to answer: is keeping the architecture plan in a public repo a problem? Are there issues the backend / API team should know about before this is used on a real funnel? May produce changes that need to land before Cluster B's release.

### Cluster E — Admin UI + marketing lander at `hippo-shop.goldenhippo.io`
Status: idea
Added: 2026-05-17

A web app that serves two purposes: (1) a marketing lander for internal teams that explains what Hippo Shop does and how it empowers them, and (2) an admin UI behind Google login (@goldenhippo.com required) for requesting and managing access keys, authorized origins, and (eventually) per-team relationships. Regular users can request a new key, see their request status, view their issued keys, and manage their domain allow-list. Admins can manage all relationships. Future: request-count visibility, possibly sourced from Kong logs via Logtail on Heroku.

Depends on Cluster A for the positioning that the lander cites.

### Cluster F — SDK session, UTM, and checkout handoff
Status: idea
Added: 2026-05-17

Have the SDK manage a session cookie when one is not present and parse UTM parameters, including the Golden Hippo-specific click-id mapping (e.g. `fbclid` → `sub_id1=fb` and `sub_id5=fbcli`). On a `checkoutUrl` handoff — possibly supplied by destination details — auto-apply the correct UTM parameters. This would unlock a single per-brand checkout app at `checkout.brand_domain.com` consuming pages from anywhere. Large architectural commitment; probably warrants a spike before a full spec.

---

## Done

(none yet)
```

- [ ] **Step 3: Verify the file exists and lists all five clusters**

Run: `grep -c "^### Cluster" ROADMAP.md`
Expected: `5`

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: add ROADMAP.md seeded with clusters B–F"
```

---

## Task 5: Reorganize `docs/` (create new dirs, move surviving docs, delete obsolete ones)

**Files:**
- Create: `docs/architecture/`, `docs/ops/` (directories)
- Move: `docs/cloudflare-deploy.md` → `docs/architecture/cloudflare-deploy.md`
- Move: `docs/kong-public-routing.md` → `docs/architecture/kong-public-routing.md`
- Move: `docs/release-process.md` → `docs/ops/release-process.md`
- Move: `docs/incident-response.md` → `docs/ops/incident-response.md`
- Delete: `docs/dto-contract-v1.md`
- Delete: `docs/public-dtos-v1-contract.md`
- Delete: `docs/hippo-shop-combined-implementation-plan.md`
- Delete: `docs/onboarding-partners.md`

- [ ] **Step 1: Confirm starting state**

Run: `ls docs/`
Expected: includes all 8 of the files listed above plus the `superpowers/` directory.

- [ ] **Step 2: Create the two new directories**

Run:
```bash
mkdir -p docs/architecture docs/ops
```

- [ ] **Step 3: Move the four surviving docs using `git mv` so history is preserved**

Run:
```bash
git mv docs/cloudflare-deploy.md docs/architecture/cloudflare-deploy.md
git mv docs/kong-public-routing.md docs/architecture/kong-public-routing.md
git mv docs/release-process.md docs/ops/release-process.md
git mv docs/incident-response.md docs/ops/incident-response.md
```

- [ ] **Step 4: Delete the four obsolete docs**

Run:
```bash
git rm docs/dto-contract-v1.md
git rm docs/public-dtos-v1-contract.md
git rm docs/hippo-shop-combined-implementation-plan.md
git rm docs/onboarding-partners.md
```

- [ ] **Step 5: Verify final structure**

Run: `find docs -maxdepth 2 -type f -name '*.md' | sort`
Expected:
```
docs/architecture/cloudflare-deploy.md
docs/architecture/kong-public-routing.md
docs/ops/incident-response.md
docs/ops/release-process.md
```
Plus whatever lives in `docs/superpowers/` (untouched).

- [ ] **Step 6: Verify the memory note about release-process.md still points somewhere valid**

The user's auto-memory references `docs/release-process.md` as the source of truth for releases. After this commit it lives at `docs/ops/release-process.md`. Update no files here — the memory will be reconciled in conversation later. Note this in the PR description.

- [ ] **Step 7: Commit**

```bash
git commit -m "docs: reorganize docs/ into architecture/ and ops/, drop obsolete planning docs

- Move cloudflare-deploy.md and kong-public-routing.md into docs/architecture/
- Move incident-response.md and release-process.md into docs/ops/
- Delete dto-contract-v1.md and public-dtos-v1-contract.md (superseded by per-package SPEC.md)
- Delete hippo-shop-combined-implementation-plan.md (historical planning, stale)
- Delete onboarding-partners.md (aspirational; partner ecosystem does not exist)"
```

---

## Task 6: Tone scrub `docs/architecture/kong-public-routing.md`

**Files:**
- Modify: `docs/architecture/kong-public-routing.md`

- [ ] **Step 1: List every "partner" hit with line numbers and surrounding context**

Run: `grep -n -B1 -A1 -i "partner" docs/architecture/kong-public-routing.md`

There are 13 hits. The high-judgement substitutions are:

| Line context | Substitute |
|---|---|
| "Partner page" (ASCII diagram caption) | "Embedding page" |
| "a partner repeatedly hitting…" / "partner refresh" / "partners can self-throttle" | "a consumer repeatedly hitting…" / "consumer refresh" / "consumers can self-throttle" |
| References to `onboarding-partners.md` (this file is being deleted) | Inline a one-paragraph "Per-consumer setup" section listing the four steps (create consumer, attach key-auth credential, add origins to route-level cors, optionally create an elevated-tier rate-limiting override). Use the existing repeated descriptions of those four steps already in `kong-public-routing.md` as source material. See the explicit replacement text in Step 2 below. |
| "the SDK sends the partner-facing name" | "the SDK sends the public name" |
| "Document this in partner-relations comms" | "Document this when communicating the change to teams using the route" |
| "the Commerce API has no business seeing partner keys" | "the Commerce API has no business seeing consumer keys" |
| "Per-partner-property buckets" | "Per-consumer buckets" |

- [ ] **Step 2: Apply all 13 substitutions and inline the onboarding section**

Use `Edit` or `Read`+`Edit` to apply each substitution. The substitutions must be context-faithful — adjust grammar (singular/plural, possessives) so the surrounding sentence still reads correctly. For the `onboarding-partners.md` references (three of them — at the top under "Companion to", in the body at "See onboarding-partners.md", and in the "Related reading" or similar footer):

- Top "Companion to" reference: drop the `onboarding-partners.md` link; keep the `cloudflare-deploy.md` link and adjust prose.
- Body "See onboarding-partners.md for the per-consumer workflow" reference: replace with an inline section like:

```markdown
### Per-consumer setup

Each Golden Hippo team using this route gets a Kong consumer plus credentials:

1. Create a Kong consumer with a stable slug (currently named `partner-<slug>` for legacy reasons — the slug names an internal team or brand, not an external partner).
2. Attach a `key-auth` credential. The plaintext key is shown once at creation; store it in 1Password.
3. Add the team's origins to the route-level `cors` plugin `origins` list. No wildcards.
4. (Optional) Create a consumer-scoped rate-limiting override if the team needs the elevated tier.
```

- Footer link reference (if any): remove the bullet pointing at `onboarding-partners.md`.

- [ ] **Step 3: Verify no "partner" hits remain in the file**

Run: `grep -c -i "partner" docs/architecture/kong-public-routing.md`
Expected: `0`

If the count is greater than 0, run `grep -n -i "partner" docs/architecture/kong-public-routing.md` and resolve each — every remaining hit is intentional only if it is the literal Kong consumer slug `partner-<slug>` quoted as a current naming artifact. If you keep that one literal, the grep must still show only that exact context.

Also confirm no broken link to the deleted onboarding doc:

Run: `grep -n "onboarding-partners" docs/architecture/kong-public-routing.md`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/kong-public-routing.md
git commit -m "docs(architecture): scrub partner language and inline per-consumer setup"
```

---

## Task 7: Tone scrub `docs/ops/incident-response.md`

**Files:**
- Modify: `docs/ops/incident-response.md`

- [ ] **Step 1: List every "partner" hit with line numbers**

Run: `grep -n -B1 -A1 -i "partner" docs/ops/incident-response.md`

There are 11 hits. The substitutions:

| Line context | Substitute |
|---|---|
| "partners hitting a different dyno" | "consumers hitting a different dyno" |
| Section heading "## 2. Revoke a partner key" | "## 2. Revoke a consumer key" |
| "The partner's pages will start returning 401" | "Pages using that key will start returning 401" |
| "Consumers → `partner-<slug>` → Credentials" | Keep the literal `partner-<slug>` (it's a current Kong slug naming convention), but the surrounding prose should say something like: "Consumers → the affected consumer (currently named `partner-<slug>` for legacy reasons) → Credentials → Key Auth." |
| "Notify partner-relations to communicate with the partner" | "Notify the internal team that owns the consumer." |
| "Worst-case partner refresh is ~5 minutes" | "Worst-case refresh on a consumer's page is ~5 minutes" |
| "until partner pages stop referencing the prior hash" | "until pages embedding the SDK stop referencing the prior hash" |
| Section heading "## 4. \"A partner is being abusive\"" | "## 4. \"A consumer is being abusive\"" |
| "Read recent traffic from the Kong dashboard for the partner's consumer" | "Read recent traffic from the Kong dashboard for that consumer" |
| "email partner-relations with the consumer ID" | "email the team that owns the consumer with the consumer ID" |
| "Document the incident — partner ID, what happened, what we did, who decided what" | "Document the incident — consumer ID, what happened, what we did, who decided what" |
| "Fallback path for partners" | "Fallback path for pages using the SDK" |

- [ ] **Step 2: Apply all substitutions**

Use `Edit` for each. Adjust grammar so each sentence still reads correctly.

- [ ] **Step 3: Verify**

Run: `grep -c -i "partner" docs/ops/incident-response.md`
Expected: `0` — except if you kept the literal `partner-<slug>` example as a Kong-slug artifact. In that case, confirm that's the only context:

Run: `grep -n -i "partner" docs/ops/incident-response.md`
Expected: only matches showing the literal `partner-<slug>` Kong slug.

- [ ] **Step 4: Commit**

```bash
git add docs/ops/incident-response.md
git commit -m "docs(ops): scrub partner language in incident-response runbook"
```

---

## Task 8: Verify `docs/architecture/cloudflare-deploy.md` and `docs/ops/release-process.md` need no scrub

**Files:**
- Read: `docs/architecture/cloudflare-deploy.md`
- Read: `docs/ops/release-process.md`

These two files had zero "partner" hits in the original audit. Confirm and verify they have no other aspirational language to scrub.

- [ ] **Step 1: Confirm zero "partner" hits**

Run:
```bash
grep -c -i "partner" docs/architecture/cloudflare-deploy.md docs/ops/release-process.md
```
Expected: both `0`.

- [ ] **Step 2: Read both files end-to-end looking for aspirational tone**

Skim for phrases like "partner ecosystem", "when partners onboard", "for our partners", "external partners", etc. There should be none.

- [ ] **Step 3: If nothing to change, skip commit**

If no edits needed, this task is a no-op and no commit is made. If something is found, apply the same vocabulary rule and commit:

```bash
git add docs/architecture/cloudflare-deploy.md docs/ops/release-process.md
git commit -m "docs: scrub residual aspirational language from architecture/ops docs"
```

---

## Task 9: Tone scrub `packages/sdk/README.md` (5 hits)

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: List the exact 5 hits**

Run: `grep -n -i "partner" packages/sdk/README.md`

Expected hits with their replacements:

| Line | Current text | Replacement |
|---|---|---|
| 150 | "The host is part of the contract — partners cannot point the SDK at an unrecognized API server." | "The host is part of the contract — the SDK cannot be pointed at an unrecognized API server." |
| 371 | "Copy-paste patterns for the most common partner integrations." | "Copy-paste patterns for the most common integrations." |
| 702 | (in error-code table) "Slug doesn't exist for your brand, or you're not authorized to see it. The two are deliberately indistinguishable — partners cannot enumerate resources they don't own." | "Slug doesn't exist for your brand, or you're not authorized to see it. The two are deliberately indistinguishable — you cannot enumerate resources you don't own." |
| 724 | "All field values are rendered via `textContent`, never `innerHTML`. Partner data can never inject markup, scripts, or styles. This is the single most important guarantee in the SDK." | "All field values are rendered via `textContent`, never `innerHTML`. Data can never inject markup, scripts, or styles. This is the single most important guarantee in the SDK." |
| 749 | "Most partners need only the declarative attributes ([§ Declarative attributes](#declarative-attributes)) and the `window.gh` surface ([§ Programmatic API](#programmatic-api))." | "Most pages need only the declarative attributes ([§ Declarative attributes](#declarative-attributes)) and the `window.gh` surface ([§ Programmatic API](#programmatic-api))." |

Confirm the `(line_number, old_string)` pairs match the current file before editing — line numbers can drift if the file has been edited since this plan was written.

- [ ] **Step 2: Apply the five `Edit` operations**

Use one `Edit` tool call per hit, with `old_string` containing enough surrounding context to be unique in the file.

- [ ] **Step 3: Verify**

Run: `grep -c -i "partner" packages/sdk/README.md`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "docs(sdk): scrub partner language from README"
```

---

## Task 10: Tone scrub JSDoc (7 hits across 5 source files)

**Files:**
- Modify: `packages/types/src/funnel.ts`
- Modify: `packages/types/src/destination.ts`
- Modify: `packages/types/src/errors.ts`
- Modify: `packages/sdk/src/bindings.ts`
- Modify: `packages/sdk/src/format.ts`

- [ ] **Step 1: List the exact 7 hits**

Run: `grep -n -i "partner" packages/types/src/funnel.ts packages/types/src/destination.ts packages/types/src/errors.ts packages/sdk/src/bindings.ts packages/sdk/src/format.ts`

Expected hits with their replacements (use "host page" voice — these are third-person JSDoc):

| File:line | Current line content (in JSDoc) | Replacement |
|---|---|---|
| `packages/types/src/funnel.ts:33` | ` * dropped (and a structured log line emitted) — partners never see garbage.` | ` * dropped (and a structured log line emitted) — host pages never see garbage.` |
| `packages/types/src/destination.ts:7` | ` * Split tests are resolved server-side — partners always see the` | ` * Split tests are resolved server-side — host pages always see the` |
| `packages/types/src/errors.ts:6` | ` * authorized to see this" — partners cannot enumerate resources they` | ` * authorized to see this" — host pages cannot enumerate resources they` |
| `packages/sdk/src/format.ts:3` | ` * elements. The built-in set covers the vast majority of partner needs;` | ` * elements. The built-in set covers the vast majority of host-page needs;` |
| `packages/sdk/src/bindings.ts:4` | ` * Partners author HTML with data-attributes; the SDK scans the page, fetches` | ` * The host page authors HTML with data-attributes; the SDK scans the page, fetches` |
| `packages/sdk/src/bindings.ts:22` | ` * partner data can never inject markup. on* attribute bindings are silently` | ` * data can never inject markup. on* attribute bindings are silently` |
| `packages/sdk/src/bindings.ts:139` | `  // the resource has loaded yet so partners can show skeletons immediately.` | `  // the resource has loaded yet so host pages can show skeletons immediately.` |

- [ ] **Step 2: Apply the seven `Edit` operations**

One `Edit` per hit, each with enough surrounding context to be unique.

- [ ] **Step 3: Verify no remaining JSDoc hits**

Run:
```bash
grep -c -i "partner" packages/types/src/funnel.ts packages/types/src/destination.ts packages/types/src/errors.ts packages/sdk/src/bindings.ts packages/sdk/src/format.ts
```
Expected: all `0`.

- [ ] **Step 4: Run typecheck — confirms JSDoc edits didn't accidentally break anything**

Run: `pnpm typecheck`
Expected: PASS with no errors.

- [ ] **Step 5: Run build — confirms tsup regenerates `dist` with updated comments flowing into `.d.ts`**

Run: `pnpm build`
Expected: PASS. The build also regenerates `llms.txt` / `llms-full.txt` in the SDK; those should now contain the updated JSDoc text.

- [ ] **Step 6: Run tests — sanity check**

Run: `pnpm test`
Expected: all tests PASS. No tests assert against the changed comment text; this is a safety net only.

- [ ] **Step 7: Commit (include `dist/` regeneration if files changed)**

Run `git status` to see what changed. If only `src/` files changed, commit just those. If `dist/` files in `packages/sdk` or `packages/types` regenerated, include them too:

```bash
git add packages/types/src packages/sdk/src
# If dist regenerated:
git add packages/sdk/dist packages/types/dist
git commit -m "chore: scrub partner language from JSDoc, prefer host page voice"
```

---

## Task 11: Root README polish (link SPEC.md and ROADMAP.md, fix wiki pointer)

**Files:**
- Modify: `/README.md`

- [ ] **Step 1: Verify the wiki actually exists or doesn't**

Run: `gh api repos/GoldenHippoMedia/hippo-shop --jq '.has_wiki'`
Expected: `true` or `false`.

If `false`, the bottom-of-README line that says `See the [development wiki](https://github.com/GoldenHippoMedia/hippo-shop/wiki) for setup, repository layout, and release process.` points at a 404 and must be replaced.

If `true`, run `gh api repos/GoldenHippoMedia/hippo-shop/pages` or check `https://github.com/GoldenHippoMedia/hippo-shop/wiki` to confirm there's actually content there. An empty wiki is functionally equivalent to no wiki for a reader.

- [ ] **Step 2: Apply two edits to README.md**

Edit 1 — add a "Contract and roadmap" section. Find the line:

```
Both are published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) via npm Trusted Publishers.
```

Add the following section immediately after it (two blank lines, then this block):

```markdown
## Contract and roadmap

- [`SPEC.md`](./SPEC.md) — what Hippo Shop promises (repo-level contract)
- [`packages/sdk/SPEC.md`](./packages/sdk/SPEC.md) — SDK public contract
- [`packages/types/SPEC.md`](./packages/types/SPEC.md) — DTO contract
- [`ROADMAP.md`](./ROADMAP.md) — backlog of bugs, ideas, and planned work

```

Edit 2 — fix the wiki pointer at the bottom. Find the line:

```markdown
*Working on Hippo Shop itself? See the [development wiki](https://github.com/GoldenHippoMedia/hippo-shop/wiki) for setup, repository layout, and release process.*
```

Replace with one of:

- **If the wiki exists and has real content:** leave the line alone.
- **If the wiki does not exist or is empty (most likely):** replace with:

```markdown
*Working on Hippo Shop itself? See the [release process](./docs/ops/release-process.md), [incident response runbook](./docs/ops/incident-response.md), and [architecture docs](./docs/architecture/) for setup, repository layout, and operational guidance.*
```

- [ ] **Step 3: Verify the rendered links are not 404s**

Run:
```bash
for f in SPEC.md packages/sdk/SPEC.md packages/types/SPEC.md ROADMAP.md docs/ops/release-process.md docs/ops/incident-response.md docs/architecture; do
  test -e "$f" && echo "OK: $f" || echo "MISSING: $f"
done
```
Expected: all `OK:` lines.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: link SPEC.md and ROADMAP.md from root README; fix wiki pointer"
```

---

## Task 12: Final verification pass

This task runs against the whole repo after all earlier commits are in. It produces no commit of its own.

- [ ] **Step 1: Global "partner" audit**

Run:
```bash
grep -ri "partner" packages/ apps/ docs/ README.md SPEC.md ROADMAP.md 2>/dev/null | grep -v "docs/superpowers/"
```
Expected: zero output, OR only output you can explain (e.g. the literal `partner-<slug>` Kong slug example we agreed to keep in `kong-public-routing.md` and `incident-response.md`).

If anything else is returned, decide per-line: keep it (and explain in PR description) or scrub it (in a follow-up commit).

- [ ] **Step 2: SPEC accuracy spot-check — types**

Cross-check `packages/types/SPEC.md` against the actual barrel export:

```bash
diff <(grep -oE "HippoShop\w+" packages/types/src/index.ts | sort -u) <(grep -oE "HippoShop\w+" packages/types/SPEC.md | sort -u | grep -v "ByQuantityDTO\|VariantDTO\|FrequencyDTO" )
```

Every name exported from `index.ts` must appear in the SPEC. (Note: `ByQuantityDTO`/`VariantDTO`/`FrequencyDTO` may legitimately appear in the SPEC more than in the simple export grep because they're listed in tables; the diff is a quick sanity check, not a strict equality.)

Better check: open `packages/types/SPEC.md` and confirm every type from `packages/types/src/index.ts:1-27` is mentioned in a table row.

- [ ] **Step 3: SPEC accuracy spot-check — sdk**

Open `packages/sdk/SPEC.md` and `packages/sdk/src/index.ts` side by side. Confirm:
- Every `export` from `index.ts` is mentioned in the SPEC.
- Every public method on `window.gh` listed in the SPEC actually exists.
- The lifecycle event name `gh:data-ready` matches `DATA_READY_EVENT` in `src/index.ts:36`.
- Every `GhErrorCode` value listed in the SPEC actually exists in `src/errors.ts`.
- Every formatter listed in the SPEC actually exists in `src/format.ts`.

- [ ] **Step 4: Doc tree shape**

Run:
```bash
find docs SPEC.md ROADMAP.md packages/*/SPEC.md -maxdepth 4 -type f -name '*.md' 2>/dev/null | sort
```

Expected output (modulo files under `docs/superpowers/`):
```
ROADMAP.md
SPEC.md
docs/architecture/cloudflare-deploy.md
docs/architecture/kong-public-routing.md
docs/ops/incident-response.md
docs/ops/release-process.md
docs/superpowers/...
packages/sdk/SPEC.md
packages/types/SPEC.md
```

- [ ] **Step 5: Final build, test, typecheck — confirm nothing is broken**

Run:
```bash
pnpm typecheck && pnpm build && pnpm test
```
Expected: all PASS.

- [ ] **Step 6: Note the out-of-band action in the PR description**

In the eventual PR description, include this checkbox item:

```markdown
**Post-merge:** Disable GitHub Issues on the repo so the ROADMAP.md guidance becomes immediately true:

  gh repo edit GoldenHippoMedia/hippo-shop --enable-issues=false

Anyone with admin rights on the repo can run this.
```

This is not a code change and does not require a commit. It is a one-line settings change run from a terminal with appropriate `gh` auth.

---

## Task 13: Out-of-band action — disable GitHub Issues (post-merge)

Run only after the PR has been merged.

- [ ] **Step 1: Confirm you have admin rights**

Run: `gh api repos/GoldenHippoMedia/hippo-shop --jq '.permissions.admin'`
Expected: `true`. If `false`, ask a repo admin to run Step 2 for you.

- [ ] **Step 2: Disable Issues**

Run: `gh repo edit GoldenHippoMedia/hippo-shop --enable-issues=false`
Expected: command exits with status 0 and no error output.

- [ ] **Step 3: Confirm**

Run: `gh api repos/GoldenHippoMedia/hippo-shop --jq '.has_issues'`
Expected: `false`.

No commit; this is a repo-settings change.

---

## Notes for the implementer

- **Changesets:** No changeset is required. JSDoc edits technically flow into published `.d.ts` files but are purely cosmetic — they should not produce a release. Use `chore:` or `docs:` commit prefixes; the changeset workflow will skip these.
- **One PR or several:** Recommendation is one PR titled `docs: Cluster A — contract docs, ROADMAP, and tone scrub`. The 11 logical commits above keep review tractable. If a reviewer wants smaller surface area, split into two PRs: docs-only (Tasks 1–4, 5) and tone-scrub (Tasks 6–11). The verification task (12) runs against the merged state.
- **Estimated effort:** ~half a day of focused work. The largest item is `packages/sdk/SPEC.md` content; everything else is mechanical.
- **If a JSDoc edit fails verification because of subsequent file edits:** the line numbers in Task 10 are accurate as of 2026-05-17. If they have drifted, re-run the grep at the top of the task to locate them; the substitutions themselves don't change.
- **What this plan does NOT cover:** Removing deprecated APIs (Cluster B). Slack release webhook (Cluster C). Security audit (Cluster D). Admin UI (Cluster E). SDK session/UTM (Cluster F). Those are tracked as their own roadmap items and will get their own specs and plans.
