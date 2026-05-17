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
