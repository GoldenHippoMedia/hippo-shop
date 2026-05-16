# Hippo Shop

[![CI](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/ci.yml/badge.svg)](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/ci.yml)
[![Release](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/release.yml/badge.svg)](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/release.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Typed, key-authenticated, brand-scoped public surface for Golden Hippo data — funnels, destinations, pricing — readable from external pages with two lines of HTML.

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| [`@goldenhippo/hippo-shop-sdk`](./packages/sdk) | [![npm](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-sdk.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk) | Browser SDK. Auto-boots from a `<script>` tag, exposes declarative `data-gh-*` bindings and a programmatic `window.gh.data` API. |
| [`@goldenhippo/hippo-shop-types`](./packages/types) | [![npm](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types) | DTO contract. Zero runtime dependencies, pure TypeScript types. |

Both are published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) via npm Trusted Publishers + GitHub Actions OIDC.

The commerce API (separate repo) and gateway config (platform) consume the types and complete the system. See [`docs/hippo-shop-combined-implementation-plan.md`](./docs/hippo-shop-combined-implementation-plan.md) for the full architecture and rollout plan.

## Using the SDK

The fast path — no install, just HTML:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_yourbrand_xxxxxx"
        data-brand="Your Brand"></script>

<article data-gh-product="some-product-slug">
  <h2 data-field="name">Loading…</h2>
  <span data-field="variants.subscription.standardByQuantity.6.price"
        data-format="currency:USD"></span>
</article>
```

See [`packages/sdk/README.md`](./packages/sdk/README.md) for the full attribute and formatter reference.

### Accessing product variants by quantity

A product's variant tree now supports direct lookup by `quantity` alongside iteration:

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
const product = await window.gh.data.product('bio-complete-3');
const sixPack = product.variants.subscription.standardByQuantity['6'];
if (sixPack) renderPrice(sixPack.price);
```

Missing quantities resolve to `undefined`; `data-field` leaves the placeholder text in place and `data-if` hides the element.

## Repository layout

```
apps/
  examples-static/          hand-authored HTML pages exercising the SDK
  integration-harness/      vitest-driven E2E suite against UAT
packages/
  sdk/                      @goldenhippo/hippo-shop-sdk
  types/                    @goldenhippo/hippo-shop-types
docs/
  hippo-shop-combined-implementation-plan.md
  public-dtos-v1-contract.md
  dto-contract-v1.md
  onboarding-partners.md
  incident-response.md
  release-process.md
  cloudflare-deploy.md
  kong-public-routing.md
```

## Boundaries

`packages/sdk` may depend on `packages/types`. Nothing may depend on `packages/sdk`, and nothing in `packages/types` may import from `packages/sdk`. Enforced by Nx tags and `@nx/enforce-module-boundaries`.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Requires Node ≥ 20 and pnpm ≥ 10 (managed via `corepack`). The lockfile is canonical — regenerate it with `pnpm install` after changing dependencies.

## Releasing

Versioning and publishing are driven by [changesets](https://github.com/changesets/changesets). The short version:

```bash
pnpm changeset                # describe the change
git commit && git push        # CI opens a release PR
# review and merge the release PR — packages publish automatically
```

For the full process, including how to add new packages, see [`docs/release-process.md`](./docs/release-process.md).

## License

MIT. See [LICENSE](./LICENSE).
