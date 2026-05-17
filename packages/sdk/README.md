# @goldenhippo/hippo-shop-sdk

[![npm version](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-sdk.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)
[![bundle size](https://img.shields.io/badge/gzipped-%E2%89%A48%20KB-blue)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Browser SDK for reading Golden Hippo public data — funnels, destinations, products. Loads from a `<script>` tag and exposes two complementary surfaces:

1. **Declarative** — write HTML with `data-gh-*` attributes; the SDK scans the page, fetches the right resources, and renders the values. No JS required.
2. **Programmatic** — call `window.gh.data.product(slug)` and friends for full control.

Both share the same auth, caching, and brand-scoped access rules enforced by the API.

> Source: [GoldenHippoMedia/hippo-shop](https://github.com/GoldenHippoMedia/hippo-shop) · DTO contract: [`@goldenhippo/hippo-shop-types`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)

---

## Installation

For most pages, no install — drop the `<script>` tag (see Quickstart below). For TypeScript projects or build-tool integrations:

```bash
npm install @goldenhippo/hippo-shop-sdk
# or
pnpm add @goldenhippo/hippo-shop-sdk
```

The published bundle is `dist/gh.js` (IIFE, browser-loadable directly from a CDN-like URL) and ESM/CJS entries for tooling.

---

## Quickstart — declarative

Drop one `<script>` and write your HTML:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v1/gh.js"
        data-key="gh_pk_yourbrand_xxxxxx"
        data-brand="Sample Co"></script>

<article data-gh-product="multi-vitamin">
  <img data-attr-src="image" data-attr-alt="name" />
  <h2 data-field="name">Loading…</h2>

  <p class="reviews">
    <span data-field="reviews.average" data-format="number:1"></span>★
    (<span data-field="reviews.count" data-format="number:0"></span> reviews)
  </p>

  <p class="price">
    <span data-field="variants.subscription.standardByQuantity.6.price"
          data-format="currency:USD"></span>
  </p>

  <p data-if="outOfStock" class="badge-oos">Out of stock</p>
</article>
```

That's it. The SDK auto-boots, scans for `data-gh-*` attributes, fetches `/public/v1/product/multi-vitamin` once, and renders. Any placeholder text inside the elements stays visible until the data arrives (good for SEO and graceful loading).

---

## Attribute reference

### Script tag

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-key` | yes | — | Publishable key. Format: `gh_pk_<consumer>_<random>`. |
| `data-brand` | yes | — | Brand display name. Validated server-side. |
| `data-debug` | no | `false` | If `true`, logs requests/responses/cache to the console. |

The API base URL is derived from the script's `src` host. Allowed hosts: `api-prod.goldenhippo.io`, `api-uat.goldenhippo.io`, `localhost`, `127.0.0.1`, `*.local`.

### Declarative attributes

| Attribute | Where | What it does |
|-----------|-------|--------------|
| `data-gh-product="slug"` | Any element | Sets the **product** context for the element + descendants. |
| `data-gh-destination="slug"` | Any element | Sets the **destination** context. |
| `data-gh-funnel="slug"` | Any element | Sets the **funnel** context. |
| `data-field="path.to.value"` | Any element | Replaces `textContent` with the value at that path. |
| `data-format="name[:arg]"` | With `data-field` or `data-attr-*` | Applies a formatter. See below. |
| `data-attr-<NAME>="path"` | Any element | Sets the `<NAME>` attribute (e.g. `data-attr-src`, `data-attr-href`). `on*` attributes are silently refused. |
| `data-if="path"` | Any element | Hides the element if the path resolves to a falsy value. |
| `data-if-not="path"` | Any element | Hides the element if the path resolves to a truthy value. |
| `data-each="path"` | `<template>` only | Clones the template's content once per item in the array. |

Paths are dot-separated. Variant lookups use the quantity as the key (e.g. `variants.subscription.standardByQuantity.6.price`); for iteration use `<template data-each="variants.subscription.standardList">`. Numeric path segments still work as array indices for any other array field.

> **Deprecation:** the array form `variants.<purchase>.<tier>` (e.g. `variants.subscription.standard.0.price`) is deprecated and will be removed in v3.0.0. Use `<tier>List` for iteration and `<tier>ByQuantity` for direct lookup by quantity instead.

### Formatters

| Name | Example | Output |
|------|---------|--------|
| `currency` | `currency:USD:en-US` (currency code + locale, both optional) | `$49.95` |
| `number` | `number:0` (decimals), `number:2:en-US` | `1,235` / `1,234.50` |
| `percent` | `percent`, `percent:1` | `25%` / `12.3%` |
| `uppercase` / `lowercase` | `uppercase` | `MULTI VITAMIN` |
| `bool` | `bool:In stock:Sold out` | renders the second arg if falsy |
| `join` | `join: - ` | joins arrays |

Register custom formatters at runtime:

```js
window.gh.format.register('shouty', (v) => String(v).toUpperCase() + '!');
// then in HTML: <span data-field="name" data-format="shouty"></span>
```

### Loops

`<template>` is the standard HTML element for non-rendered templates. The SDK expands it once per array item, with each clone seeing the iterated item as its data context.

```html
<ul data-gh-product="multi-vitamin">
  <template data-each="variants.subscription.standardList">
    <li>
      <strong data-field="quantity"></strong>
      × <span data-field="packageType"></span>:
      <span data-field="price" data-format="currency:USD"></span>
    </li>
  </template>
</ul>
```

Loops can be nested inside loops — bind paths resolve against the nearest enclosing iteration item.

---

## Declarative scope (`data-with`)

Wrap any element in `data-with="path.to.object"` to narrow the binding scope for it and its descendants. If the path doesn't resolve, the element hides via `style.display = 'none'` and the subtree is skipped — no JS, no placeholder leak.

Use it whenever you'd otherwise repeat a long path on every nested binding:

```html
<article data-with="variants.subscription.standardByQuantity.6">
  <p class="qty"><span data-field="quantity"></span></p>
  <p class="price"><span data-field="price" data-format="currency:USD:en-US"></span></p>
  <p data-if="savings">Save <span data-field="savings" data-format="currency:USD:en-US"></span></p>
</article>
```

If the catalog doesn't carry a 6-pack, the entire `<article>` hides.

## Resource lifecycle (`data-when`)

`data-when` shows an element only when its closest resource ancestor is in the named lifecycle state:

- `loaded` — the resource fetch succeeded.
- `loading` — the fetch is in flight, or the page just mounted and a fetch is queued.
- `failed` — the fetch settled without populating the resource (404, network error, brand mismatch).

```html
<article data-gh-product="multi-vitamin">
  <div data-when="loading" class="skeleton" aria-busy="true">…</div>
  <div data-when="failed" class="error" role="alert">Couldn't load this product.</div>
  <div data-when="loaded">
    <h2 data-field="name"></h2>
    <img data-attr-src="image" data-attr-alt="name" />
  </div>
</article>
```

Loading skeletons render immediately on page load; the SDK swaps in real values when data arrives. The `gh:bindings-ready` event fires once, after the initial data fetch settles.

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

## Evaluation order

When multiple binding attributes appear on the same element, they evaluate in this order:

1. Resource context attributes (`data-gh-product`, `data-gh-destination`, `data-gh-funnel`).
2. `data-when` — cheap state check; if mismatched, the element hides and the subtree is skipped.
3. `data-with` — narrows scope; if the path doesn't resolve, the element hides.
4. `data-if` / `data-if-not` — evaluated against the narrowed scope.
5. `<template data-each>` — iterates; clones use the narrowed scope as their parent context.
6. `data-field`, `data-attr-<NAME>` — field/attribute writes, against the narrowed scope.
7. Recurse into children.

---

## Programmatic API

Everything the declarative layer does is also available on `window.gh`:

```ts
window.gh.data.funnel(slugOrId):      Promise<HippoShopFunnelDTO>;
window.gh.data.destination(slugOrId): Promise<HippoShopDestinationDTO>;
window.gh.data.product(slugOrId):     Promise<HippoShopProductDTO>;

// Manually scan a subtree (e.g., a modal opened via JS):
window.gh.bind(myElement);

// Drop cached data and refetch + re-render everything:
window.gh.refresh();

// Formatter registry:
window.gh.format.currency(49.95);                     // "$49.95"
window.gh.format.register('shouty', v => v + '!');
```

Types come from `@goldenhippo/hippo-shop-types` — install it for IntelliSense in TypeScript projects.

### Lifecycle events

| Event | When |
|-------|------|
| `gh:data-ready` | The synchronous setup is done — `window.gh.data`, `bind`, `refresh`, `format` are attached. |
| `gh:bindings-ready` | The initial declarative bind pass has completed (DOMContentLoaded + first fetch). |

Both are dispatched on `window`.

Since the SDK boots synchronously when its `<script>` tag finishes loading, inline scripts placed below it may miss `gh:data-ready`. Use the defensive pattern:

```js
function whenReady() { /* … */ }
if (window.gh && window.gh.data) whenReady();
else window.addEventListener('gh:data-ready', whenReady, { once: true });
```

---

## Errors

The programmatic API rejects with `GhError`:

```ts
class GhError extends Error {
  readonly code:
    | 'not_found' | 'rate_limited' | 'forbidden'
    | 'bad_request' | 'network' | 'bad_config' | 'server';
  readonly retryAfterMs: number | null;
  readonly cause: unknown;
}
```

`not_found` is deliberately ambiguous between "doesn't exist" and "you're not authorized" — partners cannot enumerate resources they don't own.

Declarative bindings degrade gracefully: a failed fetch logs a warning and leaves placeholder text in place. Pages don't break because one slug is wrong.

---

## Safety

- All field values are rendered with `textContent`, never `innerHTML` — partner data cannot inject markup.
- `data-attr-on*` is silently refused — event handlers can never be wired from data.
- The SDK is read-only by design. No writes, no analytics ingestion, no PII.
- Cross-brand requests return 404 from the API.

## Size budget

Hard-budgeted at **8 KB gzipped**, CI-enforced.

## Provenance

Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) attestation via npm Trusted Publishers + GitHub Actions OIDC. Look for the "Built and signed on GitHub Actions" badge on the [package page](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk) — it links back to the exact workflow run that built the artifact.

## License

MIT. See [LICENSE](./LICENSE).
