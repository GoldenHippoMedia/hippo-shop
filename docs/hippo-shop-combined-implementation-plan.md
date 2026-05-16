# Hippo Shop — Combined Implementation Plan

**Initiative:** Hippo Shop
**Owner:** Acquisition Dev / Platform
**Stakeholders:** Commerce API team, Platform, Partner Relations (downstream consumer of Kong Admin UI workflow)
**Scope:** Build the v1 public web surface end-to-end — DTO contract, types package, SDK package, commerce API routes, Kong gateway config, Cloudflare delivery.

> **What "Hippo Shop" is.** A typed, key-authenticated, brand-scoped public surface that lets external pages — Netlify landers, Lander Labs pages, GTM-injected widgets, partner sites — read Golden Hippo data (funnels, destinations, pricing) by adding two HTML lines. v1 is internal-only; the external partner story is gated behind operational sign-off, not technology.

---

## 1. The deliverable, in one paragraph

A new monorepo (`golden-hippo/hippo-shop`) houses two npm packages — `@goldenhippo/hippo-shop-types` (the contract) and `@goldenhippo/hippo-shop-sdk` (the runtime). The commerce API ships three new routes under `/public/v1/*` that emit responses conforming to the types package. Kong routes those URLs, enforces key auth, CORS, rate limits, and edge caching. The SDK is delivered from `api-prod.goldenhippo.io/sdk/v1/gh.js`, fronted by Kong, backed by Cloudflare. Partner pages load the SDK with `<script src="..." data-key="..." data-brand="...">` and call `window.gh.data.funnel(slug)`, `window.gh.data.destination(slug)`, or `window.gh.data.product(slug)` to receive typed, plain-JSON DTOs. **No new infrastructure, no new auth schemes, no new threat model.**

---

## 2. Architecture decisions

### 2.1 Monorepo, but only for the lockstep code

`hippo-shop` is a new **Nx + changesets** monorepo containing two packages. The commerce API stays in its own repo and consumes `@goldenhippo/hippo-shop-types` via a pinned semver range.

**Why monorepo for these two:**

The SDK imports the types; the types are versioned in tandem with the SDK; a change to one almost always touches the other; CI for one should fail if the other breaks. That's the lockstep case monorepos exist for. Separate repos would create an "update types, publish, bump SDK's dependency, hope CI catches the drift" loop that adds friction without adding safety.

**Why commerce API stays separate:**

The commerce API has its own lifecycle, its own deployment cadence, and many consumers other than Hippo Shop. The whole point of publishing a versioned types package is that the producer and consumer can move independently as long as they agree on the contract. Folding commerce into this monorepo would couple two release cycles that shouldn't be coupled.

**Why Nx (vs. plain pnpm workspaces):**

Mostly for consistency with the Builder plugins monorepo. Same tooling, same scripts, same CI patterns, same mental model. Marginal tooling overhead over plain workspaces, real onboarding benefit for engineers who've worked in the other repo.

**Why changesets (vs. Nx release):**

Existing convention in the org. Generates changelogs well, handles the two-package version graph cleanly, contributors pick it up in five minutes.

### 2.2 Repository layout

```
golden-hippo/hippo-shop/
├── apps/
│   ├── examples-static/             # hand-authored HTML pages exercising the SDK
│   │   └── product-pricing.html
│   └── integration-harness/         # vitest-driven E2E against UAT
│       ├── src/
│       └── package.json
├── packages/
│   ├── types/                       # @goldenhippo/hippo-shop-types
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── funnel.ts
│   │   │   ├── destination.ts
│   │   │   ├── product.ts
│   │   │   └── errors.ts
│   │   ├── test/
│   │   │   ├── fixtures/            # JSON fixtures, real production data, lightly redacted
│   │   │   └── types.test-d.ts      # tsd compile-time assertions
│   │   ├── tsup.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── sdk/                         # @goldenhippo/hippo-shop-sdk
│       ├── src/
│       │   ├── index.ts             # entry: bootstrap + window.gh.data attach
│       │   ├── client.ts            # GhDataClient — typed fetcher
│       │   ├── config.ts            # parseScriptConfig() + host validation
│       │   ├── errors.ts            # GhError class + code enum
│       │   ├── cache.ts             # in-memory request memoization
│       │   └── log.ts               # debug logger
│       ├── test/
│       │   ├── config.spec.ts
│       │   ├── client.spec.ts
│       │   ├── cache.spec.ts
│       │   └── index.spec.ts        # JSDOM auto-boot tests
│       ├── tsup.config.ts
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   ├── dto-contract-v1.md           # canonical contract (the law)
│   ├── onboarding-partners.md       # Kong Admin UI walkthrough (internal)
│   └── incident-response.md         # cache purge, key revocation, rollback runbook
├── .changeset/
├── .github/
│   └── workflows/
│       ├── ci.yml                   # lint, typecheck, test, build, size-guard
│       └── release.yml              # changesets publish + Cloudflare deploy
├── nx.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
└── README.md
```

### 2.3 Nx project boundaries

Enforce a hard rule: `packages/sdk` can depend on `packages/types`. **Nothing in `packages/types` may depend on anything in `packages/sdk`.** Enforced via Nx tags and `@nx/enforce-module-boundaries`. Catches the accidental "let me just import a helper" mistake that would break the types package's "zero runtime dependencies" promise.

```jsonc
// nx.json (excerpt)
{
  "targetDefaults": {
    "lint": { "options": { "lintFilePatterns": ["{projectRoot}/**/*.ts"] } }
  },
  "implicitDependencies": {},
  "namedInputs": { ... }
}
```

```jsonc
// packages/types/project.json
{ "tags": ["scope:contract", "type:lib"] }

// packages/sdk/project.json
{ "tags": ["scope:runtime", "type:lib"] }

// .eslintrc.cjs — boundary enforcement
{
  "@nx/enforce-module-boundaries": ["error", {
    "depConstraints": [
      { "sourceTag": "scope:contract", "onlyDependOnLibsWithTags": [] },
      { "sourceTag": "scope:runtime",  "onlyDependOnLibsWithTags": ["scope:contract"] }
    ]
  }]
}
```

### 2.4 Versioning across the system

| Surface | Versioning | Cadence |
|---|---|---|
| DTO contract document | Header version + dated entries | Updated in lockstep with types package major |
| `@goldenhippo/hippo-shop-types` | semver — **major = API major** | `1.x.x` → `/public/v1/*`. `2.x.x` would target `/public/v2/*`. |
| `@goldenhippo/hippo-shop-sdk` | semver — **major = bundle URL major** | `1.x.x` → served at `/sdk/v1/gh.js`. |
| Commerce API routes | Path-versioned — `/public/v1/*` | `v1` lives indefinitely; v2 is parallel. 12-month minimum deprecation window. |
| Kong routes | Mirror the commerce path versions | One-to-one mapping. |
| Cloudflare bundle | Hash-pinned + versioned channel | `/sdk/v1/gh.<hash>.js` for hash-pinning; `/sdk/v1/gh.js` for the moving v1 channel. |

**Coordination rule:** minor and patch changes to `@goldenhippo/hippo-shop-types` are additive only — the commerce API can pre-populate new fields, then the SDK can expose them in its next release without touching anyone else. Major changes (`v1 → v2`) trigger the full parallel-version dance: new types major, new commerce route prefix, new SDK bundle URL, 12-month v1 deprecation window.

### 2.5 The trust boundary

Kong at `api-prod.goldenhippo.io` is the only trust boundary. Everything past Kong (commerce API, internal services) treats the request as already-authenticated by the gateway. The SDK itself contains no auth logic — it forwards a publishable key and an `X-GH-Brand` header; Kong validates them.

**Six guardrails, none invented from scratch:**

1. **Publishable key auth** — Kong `key-auth`. Per-consumer `gh_pk_*` keys. Publishable, not secret; enforcement comes from origin allowlists and rate limits.
2. **Origin allowlist** — Kong `cors` plugin. For v1 the allowlist is a route-level superset of every onboarded partner's origins (per-consumer CORS plugin overrides don't apply in Kong OSS because browser preflights are anonymous). Per-consumer enforcement is deferred to a small pre-function plugin that compares the authenticated consumer's `origin:*` tags against the inbound `Origin`; see [`kong-public-routing.md`](./kong-public-routing.md). For v1, the superset enforced at the edge is the boundary.
3. **Per-key rate limiting** — Kong `rate-limiting`, tier-based per consumer. Revoke or downgrade a partner via Kong Admin UI in seconds.
4. **Brand-bound tenancy** — `data-brand="Gundry MD"` at init, validated server-side. Cross-brand requests return 404 (same as "doesn't exist") so partners can't enumerate resources they don't own.
5. **Public DTO segregation** — every handler under `/public/v1/` uses dedicated DTO types and mappers. An integration test verifies handlers return only the public type's keys.
6. **Defense-in-depth field strip** — Kong `response-transformer` strips a denylist of internal field names. If a mapper bug ever leaks an internal field, Kong catches it before the network. OSS limitation: top-level JSON keys only — nested-field enforcement is the commerce repo's integration tests (per §3.2 rule 4), which are the stronger guarantee anyway.

**No PII. No writes. No analytics ingestion. No identity. The SDK is dumb-pipe by design.** If a future scenario needs any of those, it gets its own purpose-built surface — not a flag here.

---

## 3. The DTO contract (the law)

Three DTOs. Read-only. Pre-Purchase only. Brand-bound at init.

| DTO | Route | Primary scenario |
|-----|-------|------------------|
| `HippoShopFunnelDTO` | `GET /public/v1/funnel/:slugOrId` | External page renders or links a Golden Hippo funnel. |
| `HippoShopDestinationDTO` | `GET /public/v1/destination/:slugOrId` | External page resolves an offer/destination to a funnel + price to display. |
| `HippoShopProductDTO` | `GET /public/v1/product/:slugOrId` | External page displays live pricing/availability for a product. |

Full contract lives in `docs/dto-contract-v1.md` in the hippo-shop repo. The types in `packages/types/src/` are the **TypeScript materialization** of the contract — when the doc changes, the package changes, and every dependent breaks at compile time until updated. That's the feature.

### 3.1 The three DTOs (TypeScript form)

```ts
// packages/types/src/funnel.ts
export interface HippoShopFunnelDTO {
  slug: string;
  name: string;
  active: boolean;
  steps: HippoShopFunnelStepDTO[];
}
export interface HippoShopFunnelStepDTO {
  stepNumber: number;
  slug: string;
  name: string;
  kind: HippoShopStepKind;
}
export type HippoShopStepKind =
  | 'landing' | 'content' | 'order-form'
  | 'bump' | 'upsell' | 'downsell' | 'thank-you';

// packages/types/src/destination.ts
export interface HippoShopDestinationDTO {
  slug: string;
  name: string;
  description: string | null;
  funnelSlug: string;
  pricing: HippoShopPricingDTO;
}
export interface HippoShopPricingDTO {
  familyOrBundleId: string;            // navigation key into /public/v1/product/:id
  orderFormId: string;                 // cart-actionable identifier (Salesforce order-form ID)
  sku: string;                         // human-readable SKU code
  packageQuantity: number;
  purchaseType: 'subscription' | 'one-time';
  frequency: HippoShopFrequencyDTO | null;
  price: HippoShopPriceDTO;
  rebillPrice: HippoShopPriceDTO | null;
  outOfStock: boolean;
  restrictedCountryCodes: string[];
  shipping: HippoShopShippingDTO;
  bumpOffers: HippoShopBumpOfferDTO[];
}
export interface HippoShopPriceDTO {
  amount: number;
  currency: 'USD';
  savings: number | null;
}
export interface HippoShopShippingDTO {
  domestic: number;
  international: number;
  freeShippingThreshold: number | null;
}
export interface HippoShopBumpOfferDTO {
  familyOrBundleId: string;
  orderFormId: string;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  price: HippoShopPriceDTO;
  outOfStock: boolean;
  restrictedCountryCodes: string[];
}

// packages/types/src/product.ts
export interface HippoShopProductDTO {
  id: string;
  slug: string;
  name: string;
  packaging: { singular: string; plural: string };
  image: string;
  reviews: { count: number; average: number; globalFiveStarReviews: number };
  outOfStock: boolean;
  variants: HippoShopProductVariantsDTO;
}
export interface HippoShopProductVariantsDTO {
  subscription: { standard: HippoShopProductVariantDTO[]; myAccount: HippoShopProductVariantDTO[]; };
  oneTime:      { standard: HippoShopProductVariantDTO[]; myAccount: HippoShopProductVariantDTO[]; };
}
export interface HippoShopProductVariantDTO {
  productId: string;
  variantId: string;
  sku: string;
  price: number;
  rebillPrice: number | null;
  quantity: number;
  packageType: string;
  savings: number | null;
  alternatePurchaseTypePrice: number | null;
  defaultFrequency: HippoShopFrequencyDTO | null;
}
export interface HippoShopFrequencyDTO {
  interval: number;
  scale: 'day' | 'week' | 'month' | 'year';
  publicInterval: number;
  publicScale: 'day' | 'week' | 'month' | 'year';
  value: string;
  label: string;
}
```

### 3.2 Contract enforcement rules

These rules ride into the commerce API codebase and are non-negotiable:

1. All public routes live under `/public/v1/`. No public route exists outside this prefix; no internal route exists inside it.
2. Every handler under `/public/v1/` returns a `Public*DTO` type from `@goldenhippo/hippo-shop-types`, never an internal model.
3. Each handler has a dedicated `to*HippoShopDTO()` mapper. Mappers are the only place internal → public translation happens.
4. An integration test verifies every handler's response shape matches the published DTO type and **only** that type's keys (no excess properties).
5. Public routes opt out of any internal auth middleware applied service-wide. They're authenticated by Kong, not the service.
6. The commerce API never reads `Authorization` headers, cookies, or session tokens on `/public/v1/*` requests.

Rule 4 is the cheap, durable enforcement. Without it, rule 2 fails silently the first time someone uses `res.json({ ...internalModel, ... })` and ships.

### 3.3 Behavioral rules (handler-side)

- Post-Purchase funnels and destinations return 404. Post-Purchase is never exposed.
- Inactive funnel steps are filtered out of the response.
- Split tests are invisible externally. Destinations always resolve to their `defaultFunnel`.
- `pageType` maps to the closed `HippoShopStepKind` enum via a documented lookup. Unknown internal `pageType` values cause the step to be omitted *and* a structured log line emitted — partners never see garbage.
- Brand mismatch returns 404, not 403. No enumeration of out-of-tenant resources.

---

## 4. `@goldenhippo/hippo-shop-types`

### 4.1 Purpose

Pure TypeScript types. Zero runtime dependencies. Consumed by the SDK *and* by the commerce API's DTO mappers, so producer and consumer share the contract literally — not by convention. Breaking changes break both sides at compile time. That's the feature.

### 4.2 Build & distribution

`tsup`-built dual ESM/CJS with `.d.ts` outputs. Initially published to the **internal npm registry** (or path-linked in the monorepo). The package name is reserved on the public npm registry now to prevent squatting; public publishes happen only when external partners are onboarded.

```jsonc
// packages/types/package.json (essentials)
{
  "name": "@goldenhippo/hippo-shop-types",
  "version": "1.0.0",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "sideEffects": false,
  "peerDependencies": { "typescript": ">=5.0" }
}
```

### 4.3 Why no runtime validation in v1

Tempting to ship Zod schemas alongside the types. The case for *not* doing so:

1. **The SDK doesn't need to validate responses.** Kong + the commerce API are the trust boundary. The SDK trusts what comes back; shape mismatches are server bugs, not runtime checks the SDK should perform.
2. **The commerce API doesn't need this package's schemas.** It has its own internal Zod schemas. Public DTO mappers produce shapes that *conform to* this package's types; integration tests verify conformance.
3. **Adding Zod doubles the package surface and adds a runtime dependency.** Significant footprint inflation for a types-only package.

If runtime validation is ever needed, a companion package (`@goldenhippo/hippo-shop-types-zod`) slots in cleanly. Reserve the name; don't build it.

### 4.4 Test fixtures

`packages/types/test/fixtures/` ships hand-authored JSON files — one per DTO — built from real production data, lightly redacted, agreed with the commerce team. Two purposes:

1. The SDK's integration harness loads them as mocked responses while UAT routes are unavailable.
2. They double as example payloads in docs.

These are not exported from the package; they live in `test/` and are referenced by path.

### 4.5 Testing

`tsd` for compile-time assertions on the closed enums (`HippoShopStepKind`, `'USD'`, `'subscription' | 'one-time'`) and the null/non-null distinctions (`rebillPrice`, `savings`, `alternatePurchaseTypePrice`, `frequency`, `defaultFrequency`). Five minutes per DTO. Plus a `tsc --noEmit` + ESM/CJS smoke check on every build.

---

## 5. `@goldenhippo/hippo-shop-sdk`

### 5.1 Purpose

Browser JS bundle. Auto-boots from a `<script>` tag with `data-key` and `data-brand` attributes. Attaches `window.gh.data` with three async methods.

### 5.2 Public API

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_netlify_gundry_xyz"
        data-brand="Gundry MD"
        data-debug="false"></script>
```

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-key` | yes | — | Publishable key. Format: `gh_pk_<consumer-slug>_<random>`. |
| `data-brand` | yes | — | Brand display name. Required but not validated client-side — the API enforces validity on the first request. |
| `data-debug` | no | `false` | If `true`, logs requests/responses/cache/config to console. |

The API environment is derived from the script's own `src` host — `api-prod.goldenhippo.io` for prod, `api-uat.goldenhippo.io` for UAT, plus local-dev hosts (`localhost`, `127.0.0.1`, `[::1]`, `*.local`). No separate env attribute.

### 5.3 Methods

```ts
window.gh.data.funnel(slugOrId: string):      Promise<HippoShopFunnelDTO>;
window.gh.data.destination(slugOrId: string): Promise<HippoShopDestinationDTO>;
window.gh.data.product(slugOrId: string):     Promise<HippoShopProductDTO>;
```

Types come from `@goldenhippo/hippo-shop-types`. The SDK never redefines DTOs locally.

### 5.4 Error model

```ts
export class GhError extends Error {
  readonly code:
    | 'not_found' | 'rate_limited' | 'forbidden'
    | 'bad_request' | 'network' | 'bad_config' | 'server';
  readonly retryAfterMs: number | null;
  readonly cause: unknown;
}
```

`not_found` is deliberately ambiguous between "doesn't exist" and "you're not authorized" — partners can't enumerate resources they don't own.

### 5.5 Boot sequence

1. Find the `<script>` tag via `document.currentScript` (fallback: scan for `script[data-key][data-brand]` matching `/sdk/v1/gh.js`).
2. Validate `data-key` against `/^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/`.
3. Validate `data-brand` is non-empty (API enforces actual validity).
4. Derive API base URL from the script's own `src.origin`. Validate against allowed-hosts list (prod, UAT, local-dev patterns).
5. Construct `GhDataClient` singleton.
6. Attach to `window.gh.data` non-destructively — preserve any pre-existing properties on `window.gh`. Refuse to overwrite an existing `window.gh.data`.
7. Dispatch one-time `gh:data-ready` event on `window`.

Bad config logs a clear console error and refuses to attach `window.gh.data`. No no-op stub — fail loudly.

### 5.6 Caching

Three layers:

1. **In-memory dedup (SDK).** Three calls to `gh.data.product('bio-complete-3')` make one request. Promise cache keyed by `${method}:${slugOrId}`. Cleared on unload.
2. **HTTP cache (browser).** Response headers set by Kong; browsers respect them. Free per-tab caching across calls.
3. **Edge cache (Kong proxy-cache).** Funnel 60s, destination 60s, product 120s.

No localStorage or cross-tab cache.

### 5.7 Distribution

Bundle delivered from `https://api-prod.goldenhippo.io/sdk/v1/gh.js`. Kong has a route proxying `/sdk/v1/*` to Cloudflare. Same Golden Hippo domain for SDK delivery and API; partner pastes one URL.

**Cloudflare Pages** for hosting (decided). GitHub Actions on tagged release pushes to Pages, generates SRI hash, updates `dist/manifest.json`.

**Hard bundle size budget:** 8 KB gzipped. CI-enforced.

### 5.8 Coexistence on `window.gh`

The SDK assigns only `.data` (and `.debug` when set) on `window.gh`. It never reassigns or deletes any other property. If `window.gh.data` already exists at boot, it logs a warning and does nothing. Future surfaces can claim other slots on `window.gh` safely.

---

## 6. Commerce API work

A new route family under `/public/v1/*`. Three handlers, three mappers, one set of integration tests.

### 6.1 New code

```
src/public/                          # dedicated module — keeps the boundary visible
├── dtos/                            # re-exports from @goldenhippo/hippo-shop-types
│   └── index.ts
├── mappers/
│   ├── funnel.mapper.ts             # toHippoShopFunnelDTO(internal): HippoShopFunnelDTO
│   ├── destination.mapper.ts
│   └── product.mapper.ts
├── handlers/
│   ├── funnel.handler.ts            # GET /public/v1/funnel/:slugOrId
│   ├── destination.handler.ts
│   └── product.handler.ts
└── public.module.ts                 # registers routes, no service-wide auth middleware
```

### 6.2 Dependency

```jsonc
// commerce-api/package.json (excerpt)
{
  "dependencies": {
    "@goldenhippo/hippo-shop-types": "^1.0.0"
  }
}
```

Pinned to caret on the minor. The commerce team can take new fields as they ship without coordinated releases.

### 6.3 The mappers (where the contract is enforced)

Each mapper is the *only* place internal → public translation happens. They look like:

```ts
import type { HippoShopProductDTO } from '@goldenhippo/hippo-shop-types';
import type { InternalProduct } from '../../commerce/types';

export function toHippoShopProductDTO(p: InternalProduct): HippoShopProductDTO {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    packaging: { singular: p.packaging.singular, plural: p.packaging.plural },
    image: p.image,
    reviews: {
      count: p.cms.reviews.count,
      average: p.cms.reviews.average,
      globalFiveStarReviews: p.cms.reviews.globalFiveStarReviews,
    },
    outOfStock: p.outOfStock,
    variants: {
      subscription: {
        standard:  p.products.subscription.standard.map(toHippoShopVariantDTO),
        myAccount: p.products.subscription.myAccount.map(toHippoShopVariantDTO),
      },
      oneTime: {
        standard:  p.products.oneTime.standard.map(toHippoShopVariantDTO),
        myAccount: p.products.oneTime.myAccount.map(toHippoShopVariantDTO),
      },
    },
  };
}
```

No spread of internal objects. Every field explicit. The TypeScript compiler enforces the shape; the integration test enforces it again at runtime.

### 6.4 Integration tests

Per the contract's rule 4: every handler is wrapped in a test that asserts the response shape matches the published DTO type and contains **only** those keys. Implementation can be as simple as a deep-keys comparison against the `tsd` fixture for that DTO. Lives in the commerce repo, not the hippo-shop monorepo — it's testing the producer side.

---

## 7. Kong gateway configuration

### 7.1 Service & routes

```
Service: hippo-shop-public-v1
  Upstream: commerce-api → /public/v1/*

Routes:
  GET /public/v1/funnel/:slugOrId
  GET /public/v1/destination/:slugOrId
  GET /public/v1/product/:slugOrId

Service: hippo-shop-sdk-delivery
  Upstream: cloudflare-pages (gh-sdk.pages.dev or hash-pinned)

Routes:
  GET /sdk/v1/gh.js
  GET /sdk/v1/gh.<hash>.js              # hash-pinned, max-age: immutable
```

### 7.2 Plugins on `hippo-shop-public-v1`

```
- cors                      # route-level origin superset; preflight + browser headers
- key-auth                  # X-GH-Key: gh_pk_...
- rate-limiting             # per-consumer, tier-based (60/min standard, 300/min elevated)
- request-transformer       # rename X-GH-Brand → X-Brand for upstream
- proxy-cache               # TTL: 60s default; honors upstream Cache-Control
- response-transformer      # defense-in-depth header + top-level JSON denylist
```

Operational details — Sentinel `CUSTOM_PLUGINS` allowlist, plugin priorities, full configuration values, smoke tests, known limitations — live in [`kong-public-routing.md`](./kong-public-routing.md). The original plan referenced `request-validator` for per-consumer origin enforcement; that plugin is Enterprise-only and is replaced for v1 by route-level cors enforcement plus a deferred pre-function (see the new doc).

### 7.3 Plugins on `hippo-shop-sdk-delivery`

```
- cors                      # permissive — bundle is loadable from anywhere
                            #   (the API auth is at the other route)
- proxy-cache               # Cache-Control: public, max-age=300, swr=86400
                            #   on the moving v1 channel; immutable on hash-pinned URLs
```

No `key-auth` on the SDK route — anyone can fetch the bundle. Auth is enforced when the bundle calls the API.

### 7.4 Consumer model

Each partner property = one Kong consumer. Consumer carries:
- One `key-auth` credential (the `gh_pk_*`).
- An allowed-origins list (CORS).
- A rate-limit tier.
- A brand assignment (used by the commerce API for tenancy enforcement, not by Kong itself).

Managed via Kong Admin UI for v1. Future scaling path: a small admin app for partner-relations.

### 7.5 Cache invalidation

TTL-based. If a price change needs immediate propagation, the commerce API calls Kong's admin API to purge `proxy-cache` keys for affected routes. Documented in `docs/incident-response.md`, not automated for v1.

---

## 8. Cloudflare delivery

### 8.1 Setup

- Cloudflare Pages project: `gh-hippo-shop-sdk`.
- Deploy source: GitHub Actions on tagged commits in the hippo-shop repo.
- Build artifact: `packages/sdk/dist/gh.js`.
- Stable URL: `gh-hippo-shop-sdk.pages.dev/v1/gh.js` (Kong fronts this).

### 8.2 SRI

Every release generates an SRI hash, published in `dist/manifest.json`:

```json
{
  "version": "1.0.0",
  "sri": "sha384-...",
  "deployedAt": "2026-05-20T12:00:00Z"
}
```

Optional for partners but recommended; required eventually.

### 8.3 Cache headers

```
Cache-Control: public, max-age=300, stale-while-revalidate=86400
```

Five-minute fresh window, 24-hour stale-OK. Tight enough to push fixes within a workday; loose enough to serve most traffic from cache.

Hash-pinned URLs (`/sdk/v1/gh.<hash>.js`) get `max-age=31536000, immutable`.

---

## 9. Implementation phases

### Phase 1 — Foundation (week 1)

**Goal:** monorepo exists, types package is publishable, contract is signed off.

| Owner | Work | Effort |
|---|---|---|
| Hippo Shop dev | Create `hippo-shop` monorepo (Nx + changesets + pnpm workspaces + Nx tags + ESLint boundary rule + tsconfig.base + CI scaffold) | 1.0 day |
| Hippo Shop dev | `packages/types`: author types from DTO contract, JSDoc, `tsd` tests | 1.0 day |
| Hippo Shop dev | Fixture JSON files from real production data | 0.5 day |
| Hippo Shop dev + Commerce | Walk through DTO contract end-to-end, get explicit sign-off | 0.5 day |
| Hippo Shop dev | Reserve `@goldenhippo` scope on public npm (placeholder publish or organization claim) | 0.25 day |
| Hippo Shop dev | Publish `@goldenhippo/hippo-shop-types@1.0.0` to internal registry | 0.25 day |

**Exit criteria:** `pnpm install` brings in the types package in a downstream project. `pnpm nx test types` passes. The DTO contract document is merged and considered locked.

### Phase 2 — SDK + Commerce in parallel (week 2)

**Goal:** SDK builds and runs against mocked responses. Commerce ships `/public/v1/*` on UAT.

#### Hippo Shop track

| Work | Effort |
|---|---|
| `packages/sdk`: scaffold, tsup dual build, size guard in CI | 0.5 day |
| `config.ts` + `errors.ts` + `cache.ts` + unit tests | 0.5 day |
| `client.ts` + unit tests | 0.5 day |
| `index.ts` auto-boot + JSDOM tests | 0.5 day |
| Cloudflare Pages setup + GitHub Actions deploy + manifest/SRI generation | 1.0 day |
| `apps/examples-static`: a few hand-authored HTML pages exercising each method | 0.5 day |

#### Commerce track (separate repo)

| Work | Effort |
|---|---|
| Add `@goldenhippo/hippo-shop-types@^1.0.0` dependency | trivial |
| `src/public/` module scaffold: routes, DTOs index, no service-wide auth | 0.5 day |
| Three mappers (funnel, destination, product) | 1.0 day |
| Three handlers (slug-or-ID lookup, brand-bound, error mapping) | 0.5 day |
| Integration tests per the contract's rule 4 | 0.5 day |

#### Platform track

| Work | Effort |
|---|---|
| Kong routes + plugin stack (UAT first, then prod) | 0.5 day |
| Kong consumer + credentials for one internal-test partner | 0.25 day |

**Exit criteria:** SDK loaded from a UAT-equivalent local dev page successfully reads a product, funnel, and destination from UAT commerce. Unit tests green. Bundle size under 8 KB gzipped.

### Phase 3 — Integration & polish (week 3)

**Goal:** End-to-end working against UAT. First internal consumer migrated.

| Work | Effort |
|---|---|
| `apps/integration-harness`: vitest tests against UAT routes (gated behind env var) | 0.5 day |
| Migrate one internal Netlify property to use the SDK | 0.5 day |
| Manual smoke pass against prod (after promote) | 0.25 day |
| `docs/onboarding-partners.md`: Kong Admin UI walkthrough, internal-only | 0.5 day |
| `docs/incident-response.md`: cache purge, key revocation, rollback runbook | 0.5 day |
| `packages/sdk/README.md` partner-facing quickstart | 0.25 day |

**Exit criteria:** An internal property is using the SDK in production. The two internal docs exist. Manual smoke + integration suite both pass against prod.

### Phase 4 — Hardening (week 4, partial)

**Goal:** Second internal consumer; production runbooks validated by use.

| Work | Effort |
|---|---|
| Onboard a second internal consumer (different shape of use case) | 0.5 day |
| Validate the partner-onboarding doc against actual onboarding | 0.25 day |
| Validate the incident-response doc with a deliberate cache-purge drill | 0.25 day |
| Address any feedback from the two internal consumers | 1.0 day buffer |

**Exit criteria:** v1 declared ready for internal use. External partner story is documented but no external keys issued yet — that's a separate gating decision by partner-relations.

### Total effort

| Track | Effort |
|---|---|
| Hippo Shop monorepo (types + SDK + apps + docs) | ~8 days |
| Commerce API (`/public/v1/*` routes) | ~2.5 days |
| Platform (Kong routes + plugin config) | ~0.75 day |
| **Total focused engineering** | **~11.25 days** |

Plus dependencies on commerce sign-off and Cloudflare/Kong access — typically waiting time, not engineering time.

---

## 10. Operational concerns

### 10.1 CI/CD

**Hippo Shop monorepo CI (`.github/workflows/ci.yml`):**
- `pnpm nx affected:lint`
- `pnpm nx affected:test`
- `pnpm nx affected:build`
- Bundle size check on the SDK (`gzip -9 dist/gh.js | wc -c` ≤ 8192).
- `tsd` against `packages/types`.
- ESM + CJS smoke checks on `packages/types`.

**Hippo Shop monorepo release (`.github/workflows/release.yml`):**
- Triggered by changesets PR merge.
- Runs `pnpm changeset publish` to push new types/SDK versions to the internal registry.
- On SDK release: builds bundle, deploys to Cloudflare Pages, updates manifest with SRI hash, optionally hash-pins via path.
- Posts a release summary to a designated Slack channel.

**Commerce API CI** runs as it does today, plus the new integration tests for `/public/v1/*`.

### 10.2 Monitoring

- Kong already emits per-route metrics. Add dashboards for `/public/v1/*` request rate, error rate by code, p99 latency, cache hit ratio.
- Commerce API logs each `/public/v1/*` request with consumer ID (from the `Kong-Consumer` header) for traceability without storing PII.
- Cloudflare Pages analytics for bundle delivery (request count, geo distribution, 4xx/5xx rates).

### 10.3 Deprecation & versioning operations

The 12-month minimum deprecation window for any v1 → v2 migration applies to:
- The DTO contract document.
- `@goldenhippo/hippo-shop-types` major versions.
- `@goldenhippo/hippo-shop-sdk` major versions.
- Commerce API route prefixes.
- Kong route paths.

Once a `<script src=".../sdk/v1/gh.js">` is in a partner's HTML, we do not control update timing. Plan for v1 to live for years.

### 10.4 Incident response

`docs/incident-response.md` covers:
- Cache purge runbook (Kong admin API call, single-route or full-service).
- Key revocation (Kong Admin UI — delete the consumer's `key-auth` credential; takes effect within seconds globally).
- Bundle rollback (re-deploy a previous Cloudflare Pages release, update Kong upstream to the prior URL if needed).
- "A partner is being abusive" (revoke key, document, communicate via partner-relations).
- "Bundle 404s for some region" (Cloudflare status page first; fallback path is hash-pinned URL on the manifest).

---

## 11. Out of scope for v1

- External partner enrollment. The whole stack is internal-only initially. Partner-relations decides when to open the gate; engineering provides the runway.
- Writes of any kind (lead capture, analytics ingestion, cart, subscriptions).
- Authenticated/personalized reads. Publishable-key-only.
- Variant assignment for split tests. Corrupts test data — partners always see the resolved default.
- An SSR-friendly server-side SDK. The bundle assumes a browser.
- Helper utilities (`renderProduct(el, slug)`, `bindPrice(el, slug)`). Belong in a future companion package if a pattern emerges.
- Cross-tab/localStorage caching.
- Multi-brand pages (one page loading the SDK twice with different brand bindings). Possible by accident but explicitly unsupported.
- A `@goldenhippo/hippo-shop-types-zod` runtime-validation package. Reserve the name; don't build it.

---

## 12. Open dependencies before kickoff

These need answers before Phase 1 starts. None are blockers on the architecture — they're inputs that affect specific implementation details.

1. **Destination → pricing derivation.** Where in the internal destination/order-form structure do `familyOrBundleId`, `orderFormId`, `sku`, `packageQuantity`, `purchaseType`, `frequency`, `price`, `rebillPrice`, `shipping`, and `bumpOffers` come from? Commerce team needs to confirm this is implementable from existing data without significant new integration work.
2. **Brand display-name → Salesforce ID mapping.** The commerce API needs a lookup from `"Gundry MD"` → internal brand ID for tenancy enforcement. Confirm this is accessible or trivial to populate.
3. **Test funnel/destination/product on UAT.** Integration tests need stable seeded data on UAT. Commerce team identifies the test resources and their slugs.
4. **Internal npm registry credentials.** Hippo Shop dev needs publish access to wherever `@goldenhippo/*` packages live today.
5. **Cloudflare Pages access.** Whoever owns the Cloudflare account creates the project and grants deploy access to the GitHub repo via API token in CI secrets.
6. **Kong Admin UI access.** For the dev doing the gateway config. Partner-relations also gets access for ongoing consumer management.

---

## 13. Acceptance criteria for v1 done

- [ ] `hippo-shop` monorepo exists with Nx + changesets + pnpm workspaces, project boundaries enforced.
- [ ] `@goldenhippo/hippo-shop-types@1.0.0` published to the internal registry, conforms to the DTO contract, ships fixtures, passes `tsd`.
- [ ] `@goldenhippo/hippo-shop-sdk@1.0.0` published, bundle ≤ 8 KB gzipped, deployed to Cloudflare Pages, served via Kong at `api-prod.goldenhippo.io/sdk/v1/gh.js`.
- [ ] Commerce API ships `/public/v1/funnel/:slugOrId`, `/public/v1/destination/:slugOrId`, `/public/v1/product/:slugOrId` on prod, conforming to the published types, with integration tests verifying shape.
- [ ] Kong service `hippo-shop-public-v1` configured with cors, key-auth, rate-limiting, request-transformer, proxy-cache, and response-transformer on both UAT and prod, per [`kong-public-routing.md`](./kong-public-routing.md).
- [ ] At least one internal Golden Hippo property using the SDK in production.
- [ ] `docs/dto-contract-v1.md`, `docs/kong-public-routing.md`, `docs/onboarding-partners.md`, `docs/incident-response.md` all merged in the monorepo.
- [ ] CI green on monorepo and commerce repo. Bundle size guard active.
- [ ] At least one cache-purge drill executed and documented.

---

## 14. Follow-ups (separate tickets, not blockers)

- **SKILL.md generation from `@goldenhippo/hippo-shop-types` `.d.ts`** so AI-authored partner pages use the canonical SDK vocabulary.
- **Migrate one internal use case off the legacy `/commerce/product/feed`** to validate the new public route's parity, then put the legacy feed behind auth for internal-only use.
- **Partner self-service portal** (key generation, origin management) when the manual Kong Admin UI workflow gets expensive. Likely after 5–10 partners.
- **Helper utilities package** (`@goldenhippo/hippo-shop-sdk-helpers`?) once a clear consumer pattern emerges. Separate package keeps the core SDK small.
- **Runtime validation companion package** (`@goldenhippo/hippo-shop-types-zod`) if a consumer scenario demands it.
- **Evaluate cross-pollination with internal apps.** Internal Angular apps currently hit the internal commerce API directly; revisit whether any of them should consume the public types for shared contract enforcement.
