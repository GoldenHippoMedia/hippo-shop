# @goldenhippo/hippo-shop-sdk

[![npm version](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-sdk.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)
[![bundle size](https://img.shields.io/badge/gzipped-%E2%89%A48%20KB-blue)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Browser SDK for reading Golden Hippo public data — funnels, destinations, products. Loads from a `<script>` tag and exposes two complementary surfaces:

1. **Declarative** — write HTML with `data-gh-*` attributes; the SDK scans the page, fetches the right resources, and renders the values. No JS required.
2. **Programmatic** — call `window.gh.data.product(slug)` and friends for full control.

Both share the same auth, caching, and brand-scoped access rules enforced by the API.

> Source: [GoldenHippoMedia/hippo-shop](https://github.com/GoldenHippoMedia/hippo-shop) · DTO contract: [`@goldenhippo/hippo-shop-types`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)

## Contents

- [Installation](#installation)
- [Quickstart — declarative](#quickstart--declarative)
- [How it works](#how-it-works)
- [Script tag config](#script-tag-config)
- [Declarative attributes](#declarative-attributes)
- [Formatters](#formatters)
- [Loops](#loops)
- [Declarative scope (`data-with`)](#declarative-scope-data-with)
- [Resource lifecycle (`data-when`)](#resource-lifecycle-data-when)
- [Recipes](#recipes)
- [Evaluation order](#evaluation-order)
- [Programmatic API](#programmatic-api)
- [Lifecycle events](#lifecycle-events)
- [Resource caching](#resource-caching)
- [HTTP](#http)
- [Errors](#errors)
- [Safety](#safety)
- [Advanced — TypeScript / NPM consumers](#advanced--typescript--npm-consumers)
- [Size budget](#size-budget)
- [Provenance](#provenance)
- [License](#license)

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
        data-key="gh_pk_yourbrand_a1b2c3d4e5f6"
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

## How it works

A quick mental model before the reference tables.

### Boot lifecycle

1. The browser loads the SDK `<script>`. The IIFE executes immediately.
2. The SDK parses its `data-key` / `data-brand` config from the script tag and derives the API base URL from the script's own host.
3. `window.gh.data`, `gh.bind`, `gh.refresh`, and `gh.format` are attached synchronously.
4. The SDK dispatches `gh:data-ready` on `window`.
5. The first bind pass is scheduled — on `DOMContentLoaded` if the document is still loading, or via `setTimeout(0)` if `DOMContentLoaded` has already fired. The deliberate `setTimeout(0)` (rather than a microtask) gives inline scripts placed after the SDK tag a chance to run first — so a script that registers a custom formatter is picked up by the first bind pass.
6. The bind pass scans the document, fetches every referenced resource, renders the bindings, and dispatches `gh:bindings-ready` (once, after the post-fetch pass).
7. A `MutationObserver` attaches and re-binds on relevant DOM changes (see [Re-binding](#re-binding-mutationobserver)).

### Two-pass binding

When a page references resources that aren't yet cached, the SDK actually runs the bind walker **twice**:

- **Pre-fetch pass.** Every unloaded resource is marked `loading` in an internal lifecycle map. Elements with `data-when="loading"` show their skeletons immediately; elements that depend on actual data are left untouched.
- **Post-fetch pass.** Once all fetches settle (success or failure), the walker runs again with the final data and lifecycle states. `data-when="loaded"` blocks render real values; `data-when="failed"` blocks show error fallbacks.

`gh:bindings-ready` fires once, after the post-fetch pass.

### Re-binding (MutationObserver)

The runtime installs a `MutationObserver` after the initial bind so late-arriving content gets bound automatically. It watches for:

- Additions of any element subtree (e.g. a modal opened by your own JS, a GTM injection, a SPA route change).
- Attribute changes on any of: `data-gh-product`, `data-gh-destination`, `data-gh-funnel`, `data-field`, `data-format`, `data-if`, `data-if-not`, `data-each`, `data-with`, `data-when`.

Mutations caused by the SDK's own loop expansion are ignored automatically to prevent feedback loops. Re-binds are coalesced via a single microtask, so a burst of DOM changes triggers only one extra bind pass.

If you mutate the DOM in a way the observer doesn't catch (e.g. you swap an element's `data-gh-product` to a slug that's already cached and immediately need it bound), call `window.gh.bind(element)` to force a scan.

---

## Script tag config

The SDK boots from a single `<script>` tag. All configuration lives on that tag's `data-*` attributes; nothing else is required.

### Attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-key` | yes | — | Publishable key. Must match `/^gh_pk_[a-z0-9_-]+_<hex>$/` (e.g. `gh_pk_yourbrand_a1b2c3d4e5f6`). |
| `data-brand` | yes | — | Brand display name. Must be non-empty after trimming. Validated server-side. |
| `data-debug` | no | `"false"` | If set to the string `"true"`, the SDK logs requests, cache hits, and bind passes to the browser console with a `[gh]` prefix. Also sets `window.gh.debug = true`. |

The script tag itself is auto-located via `document.currentScript`; if that's unavailable, the SDK falls back to `script[data-key][data-brand][src*="/sdk/v1/gh"]`, then to `script[data-key][data-brand][src$="/gh.js"]` (the latter is a local-dev convenience so a page served from a non-`/sdk/v1/` path still boots).

If `window.gh.data` is already attached when the SDK boots — for example, because the tag is included twice — the SDK refuses to overwrite the existing surface and logs a warning. This is harmless but worth knowing if you see "window.gh.data already exists" in the console.

### Host allowlist

The API base URL is derived from the script tag's `src` host. Only the following hosts are accepted:

| Host | Use |
|------|-----|
| `api-prod.goldenhippo.io` | Production |
| `api-uat.goldenhippo.io` | UAT / staging |
| `localhost`, `127.0.0.1`, `[::1]` | Local development |
| `*.local` | Local development on `.local` hostnames |

Loading the SDK from any other host throws a config error and refuses to attach. The host is part of the contract — partners cannot point the SDK at an unrecognized API server.

## Declarative attributes

Write HTML; the SDK reads the `data-*` attributes below, fetches the right resources, and renders values.

### Reference

| Attribute | Where | What it does |
|-----------|-------|--------------|
| `data-gh-product="slug"` | Any element | Sets the **product** context for the element + descendants. |
| `data-gh-destination="slug"` | Any element | Sets the **destination** context. |
| `data-gh-funnel="slug"` | Any element | Sets the **funnel** context. |
| `data-with="path"` | Any element | Narrows the binding scope to the resolved value; hides on null/undefined. See [Declarative scope](#declarative-scope-data-with). |
| `data-when="loaded\|loading\|failed"` | Any element | Shows the element only when the closest resource is in that lifecycle state. See [Resource lifecycle](#resource-lifecycle-data-when). |
| `data-field="path"` | Any element | Replaces `textContent` with the resolved value. Undefined leaves the placeholder. |
| `data-format="name[:arg1[:arg2…]]"` | With `data-field` or `data-attr-*` | Formats the bound value. See [Formatters](#formatters). |
| `data-attr-<NAME>="path"` | Any element | Sets the `<NAME>` attribute to the resolved value. `data-attr-on*` and `data-attr-srcdoc` are refused. |
| `data-attr-format-<NAME>="..."` | With `data-attr-<NAME>` | Per-attribute formatter override. An empty value (`data-attr-format-foo=""`) short-circuits an inherited `data-format`. |
| `data-if="path"` | Any element | Hides the element (and skips the subtree) if the path resolves to a falsy value. |
| `data-if-not="path"` | Any element | Hides the element (and skips the subtree) if the path resolves to a truthy value. |
| `data-each="path"` | `<template>` only | Clones the template's content once per item in the array at `path`. |

### Paths

`data-field`, `data-with`, `data-if`, `data-if-not`, `data-each`, and `data-attr-<NAME>` all accept a **dot-path** that resolves against the closest enclosing data context.

- Dot-separated segments only. `a.b.c` reads `obj.a.b.c`.
- Numeric segments traverse arrays. `items.0.name` reads `obj.items[0].name`.
- An empty path resolves to the bound object itself (useful with `data-with` and `data-each` when the value already lives at the current scope).
- A missing or non-traversable segment resolves to `undefined`. The resolver never throws.

For product variants, prefer the keyed lookup `variants.subscription.standardByQuantity.<qty>.price` over the array form `variants.subscription.standardList.<index>.price`. The former is stable across catalog reorderings; the latter is only useful inside `<template data-each>` loops.

> **Deprecation:** the legacy array form `variants.<purchase>.<tier>` (without the `List` / `ByQuantity` suffix) is deprecated and will be removed in v3.0.0. Use `<tier>List` for iteration and `<tier>ByQuantity` for direct lookup by quantity.

### `data-attr-<NAME>` details

The `<NAME>` portion is the literal HTML attribute name (lowercased on read by the browser). Hyphens are preserved:

```html
<button
  data-field="ctaLabel"
  data-attr-aria-label="ctaAccessibleLabel"
></button>
```

Refused targets:

- `data-attr-on*` — event handlers are never bound from data, period.
- `data-attr-srcdoc` — `<iframe srcdoc>` is a raw HTML island; binding it would defeat the textContent-only safety rule.

URL-bearing attributes (`href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`, `manifest`) pass through a scheme check that refuses `javascript:`, `vbscript:`, and `data:` URLs. See [Safety](#safety) for the full rule.

### `data-attr-format-<NAME>` — per-attribute formatter override

When an element carries both `data-field` and `data-attr-*` bindings, `data-format` applies to both by default. To format an attribute differently, use `data-attr-format-<NAME>`:

```html
<span
  class="stock-pill"
  data-field="outOfStock"
  data-format="bool:Out of stock:In stock"
  data-attr-data-stock="outOfStock"
  data-attr-format-data-stock="bool:out:in"
>…</span>
```

Here the visible label renders via the human-readable `bool:Out of stock:In stock` formatter, while the `data-stock` attribute mirrors the same field through `bool:out:in` so CSS can target `[data-stock="in"]` and `[data-stock="out"]`.

An empty value short-circuits any inherited `data-format`:

```html
<a data-field="title" data-format="uppercase"
   data-attr-href="url" data-attr-format-href=""></a>
```

The element's text is uppercased; the `href` attribute is set to the raw `url` value, ignoring the `uppercase` formatter that would otherwise inherit.

### Markup the SDK writes back

The SDK writes a handful of bookkeeping attributes that you can rely on as **stable CSS hooks**. Target them in your stylesheet to add transitions, debug overlays, or layout rules.

| Marker | Where | Meaning |
|--------|-------|---------|
| `data-gh-hidden` | On any element the SDK has hidden via `data-if` / `data-if-not` / `data-when` / `data-with` miss | Lets CSS distinguish SDK-hidden elements from author-hidden ones. The element's `style.display` is also set to `none`. |
| `data-gh-prior-display` | Dataset key (`element.dataset.ghPriorDisplay`) on the same hidden element | Preserves the pre-hide `style.display` so unhide restores it. Only present when a non-`none` inline display was set before hiding. |
| `data-gh-loop-clone` | On every top-level element produced by `<template data-each>` | Lets CSS target loop items without changing markup (e.g. `[data-gh-loop-clone] { animation: fade-in 0.2s; }`). Also used internally to filter MutationObserver feedback loops. |

These are part of the contract — they will not change in a minor release.

## Formatters

`data-format="name[:arg1[:arg2…]]"` applies a formatter to a bound value before it lands in the DOM. The same registry powers `data-attr-format-<NAME>` overrides.

### Built-in formatters

| Name | Example | Output |
|------|---------|--------|
| `currency` | `currency` / `currency:USD` / `currency:EUR:en-GB` | `$49.95` (default USD, locale default) |
| `number` | `number` / `number:0` / `number:2:en-US` | `1,234` / `1,234.50` |
| `percent` | `percent` / `percent:1` | `25%` / `12.3%` (input is a fraction — see below) |
| `uppercase` | `uppercase` | `MULTI VITAMIN` |
| `lowercase` | `lowercase` | `multi vitamin` |
| `bool` | `bool:In stock:Sold out` | First arg if truthy; second if falsy |
| `join` | `join` / `join: - ` | Joins arrays with the separator (default `, `) |

### `percent` semantics

The `percent` formatter expects its input to be a **fraction** between 0 and 1, not a 0–100 number. `0.25` renders as `"25%"`, not `"0.25%"`. If your data already arrives as 0–100 (e.g. a survey score), divide by 100 before binding — or wrap it in a custom formatter (see below).

### Failure modes

Formatters are intentionally non-throwing. A single misformatted value never breaks the rest of the page.

- **Unknown name** (`data-format="nonexistent"`) → the raw value is rendered via `String(value)`.
- **Unconvertible value** (e.g. `currency` applied to `"foo"`) → falls back to `String(value)`.
- **Null or undefined value** → renders as the empty string `""`.

### Registering custom formatters

Use the registry on `window.gh.format`:

```js
window.gh.format.register('shouty', (value) => String(value).toUpperCase() + '!');
```

Then in HTML:

```html
<span data-field="name" data-format="shouty"></span>
```

If you register a custom formatter from an inline `<script>` placed **after** the SDK script tag, you do not need to call `gh.refresh()` — the SDK defers its first bind pass to after the surrounding inline scripts run. See [Lifecycle events](#lifecycle-events).

Custom formatters receive the bound value as their first argument; additional `:`-separated values from the `data-format` spec arrive as **string** arguments. Convert types yourself:

```js
window.gh.format.register('savePercent', (savings, fullPriceStr) => {
  const full = Number(fullPriceStr);
  if (!savings || !Number.isFinite(full) || full === 0) return '';
  return 'Save ' + Math.round((savings / (full + savings)) * 100) + '%';
});
```

### FormatRegistry — typed methods

The `window.gh.format` object also exposes the three numeric built-ins as typed methods, plus introspection helpers. Reach for these when you want to format a value in your own JavaScript (e.g. inside a custom formatter or after a manual `gh.data.product(slug)` call) without re-implementing the locale logic:

```js
window.gh.format.currency(49.95);                 // "$49.95"
window.gh.format.currency(49.95, 'EUR', 'en-GB'); // "€49.95"
window.gh.format.number(1234.5);                  // "1,234.5"
window.gh.format.number(1234.5, 2, 'en-US');      // "1,234.50"
window.gh.format.percent(0.123);                  // "12%"
window.gh.format.percent(0.123, 1);               // "12.3%"
window.gh.format.has('shouty');                   // false (unless registered)
window.gh.format.apply('hello', 'uppercase');     // "HELLO"
```

`apply(value, spec)` is the same entry point the declarative bindings use; it accepts the full `"name[:arg1[:arg2…]]"` syntax and inherits all failure-mode behavior described above.

## Loops

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

Everything the declarative layer does is also exposed on `window.gh`. Useful when you want to fetch data without binding (e.g. server-side rendering preview), open a modal whose markup needs binding, or invalidate the cache after a known data change.

### `window.gh` surface

```ts
window.gh.data.funnel(slugOrId):      Promise<HippoShopFunnelDTO>;
window.gh.data.destination(slugOrId): Promise<HippoShopDestinationDTO>;
window.gh.data.product(slugOrId):     Promise<HippoShopProductDTO>;

window.gh.bind(rootElement):    Promise<void>;
window.gh.refresh():            Promise<void>;

window.gh.format: FormatRegistry; // see the Formatters section
window.gh.debug?: boolean;        // set to true when data-debug="true" on the script tag
```

The promises returned by `gh.data.*` resolve with **enriched** payloads. Products in particular gain the `<tier>List` and `<tier>ByQuantity` sibling fields described under [Loops](#loops) and [Declarative scope](#declarative-scope-data-with) — the same shape your declarative bindings see.

Types live in `@goldenhippo/hippo-shop-types`. Install it for IntelliSense in TypeScript projects:

```bash
pnpm add @goldenhippo/hippo-shop-types
```

### Manually binding a subtree

`gh.bind(element)` scans the given subtree for `data-gh-*` references, fetches anything not yet cached, and renders the bindings. Use it when you need a subtree bound synchronously — for instance, a modal you've just attached and want to render with data before making it visible. The `MutationObserver` will eventually catch the insertion and rebind, but its pass is scheduled asynchronously; `gh.bind` lets you await the bind right when you need it.

```js
const modal = document.getElementById('cart-modal');
modal.innerHTML = `
  <article data-gh-product="multi-vitamin">
    <h2 data-field="name"></h2>
    <p data-field="variants.subscription.standardByQuantity.3.price"
       data-format="currency:USD"></p>
  </article>
`;
await window.gh.bind(modal);
modal.classList.add('open');
```

`gh.bind` is safe to call on the same subtree repeatedly — bindings are idempotent and prior loop clones are removed before re-expansion.

### Refreshing cached data

`gh.refresh()` drops every cached resource, clears the lifecycle-state map, and re-binds the document. Use it when you know the underlying data has changed (e.g. you just informed the API of a price update) and you want the page to reflect it without a full reload.

```js
await window.gh.refresh();
```

`refresh()` returns the same promise as `bind(document)` and resolves after the post-fetch pass completes.

## Lifecycle events

Two events fire on `window` during boot:

| Event | When |
|-------|------|
| `gh:data-ready` | The synchronous setup is done — `window.gh.data`, `bind`, `refresh`, and `format` are attached. Fires before the first bind pass. |
| `gh:bindings-ready` | The initial bind pass has completed, including all initial fetches. Fires **once** per page lifetime. |

### Defensive "already booted?" pattern

The SDK boots synchronously when its `<script>` tag finishes loading. Inline scripts placed **below** that tag may miss `gh:data-ready` because it fires before they run. To handle both orderings, check for the surface first:

```js
function whenReady() {
  // window.gh.data is now attached
  window.gh.format.register('savePercent', (savings, fullPriceStr) => {
    const full = Number(fullPriceStr);
    if (!savings || !Number.isFinite(full) || full === 0) return '';
    return 'Save ' + Math.round((savings / (full + savings)) * 100) + '%';
  });
}

if (window.gh && window.gh.data) whenReady();
else window.addEventListener('gh:data-ready', whenReady, { once: true });
```

### Inline-script timing

If your custom formatter registration sits in an inline `<script>` placed **after** the SDK tag but **before** `DOMContentLoaded`, your inline script is guaranteed to run before the first bind pass — the SDK defers binding to `DOMContentLoaded` (or to a `setTimeout(0)` task if the DOM is already ready), and inline scripts run synchronously in source order. `gh.refresh()` is unnecessary.

If you register a formatter **after** `gh:bindings-ready` has fired (e.g. from an async chunk that loads lazily), call `gh.refresh()` so existing elements pick up the new formatter.

```js
window.addEventListener('gh:bindings-ready', async () => {
  // first bind is done; we can safely add late formatters and re-render
  window.gh.format.register('shouty', (v) => String(v).toUpperCase() + '!');
  await window.gh.refresh();
}, { once: true });
```

---

## Resource caching

The SDK keeps an in-memory cache of resource fetches keyed by `<kind>:<slug>` (e.g. `product:multi-vitamin`). The cache stores **promises**, not resolved values, which means:

- **Concurrent calls dedupe.** Two `gh.data.product('multi-vitamin')` calls fired at the same time share a single HTTP request.
- **Resolved values stay cached** for the lifetime of the page. Successive calls return immediately.
- **Rejected promises are evicted.** A failed fetch (network error, 5xx, etc.) is removed from the cache as soon as it settles, so the next call retries instead of returning the stuck failure.

There is no `localStorage` and no cross-tab persistence — every page load starts with an empty cache.

To invalidate the cache explicitly, call `gh.refresh()` (see [Programmatic API](#programmatic-api)). This clears the resource cache, clears the lifecycle-state map, and re-runs the bind pass.

---

## HTTP

What the SDK sends and how it talks to the API.

### Endpoints

All three resource types use the same shape:

| Method | URL | Returns |
|--------|-----|---------|
| `GET` | `<base>/public/v1/funnel/<slugOrId>` | `HippoShopFunnelDTO` |
| `GET` | `<base>/public/v1/destination/<slugOrId>` | `HippoShopDestinationDTO` |
| `GET` | `<base>/public/v1/product/<slugOrId>` | `HippoShopProductDTO` (client-side enriched) |

`<slugOrId>` is URL-encoded before insertion. The product endpoint is client-side enriched — the raw response is passed through `enrichProduct` to attach the `<tier>List` and `<tier>ByQuantity` sibling fields before it resolves.

### Headers sent

| Header | Value |
|--------|-------|
| `X-GH-Key` | Your publishable key (from `data-key`) |
| `X-GH-Brand` | Your brand display name (from `data-brand`) |
| `Accept` | `application/json` |

The SDK does not send credentials (cookies are not included), does not set a `User-Agent` beyond the browser default, and does not send any analytics or PII.

### Base URL derivation

The API base URL is the script tag's `src` origin. Loading the SDK from `https://api-prod.goldenhippo.io/sdk/v1/gh.js` produces a base URL of `https://api-prod.goldenhippo.io`; loading it from `https://api-uat.goldenhippo.io/sdk/v1/gh.js` produces `https://api-uat.goldenhippo.io`. See [Script tag config — Host allowlist](#host-allowlist) for the full list of accepted hosts.

### Status → error code mapping

When a fetch returns a non-2xx status, the SDK constructs a `GhError` with a code derived from the response. The server's response body may supply an explicit `code`; otherwise the SDK infers from the status:

| HTTP status | `GhError.code` |
|-------------|----------------|
| 401, 403 | `forbidden` |
| 404 | `not_found` |
| 429 | `rate_limited` |
| Other 4xx | `bad_request` |
| 5xx | `server` |

Network errors (the fetch itself rejects) surface as `network`. Bad client-side config (bad key pattern, missing brand, disallowed host) surfaces as `bad_config` and is thrown during boot.

### `Retry-After` parsing

The `Retry-After` header is parsed on **any** non-2xx response (most commonly status `429`, but also 503 if the server provides it). The SDK accepts both forms allowed by the spec:

- Seconds — `Retry-After: 30` → `retryAfterMs: 30000`
- HTTP-date — `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` → `retryAfterMs: <ms-from-now>`

If the error response body includes an explicit `retryAfterMs`, that value takes precedence over the header.

---

## Errors

The programmatic API (`gh.data.funnel`, `gh.data.destination`, `gh.data.product`) rejects with a `GhError`:

```ts
class GhError extends Error {
  readonly code: GhErrorCode;
  readonly retryAfterMs: number | null;
  readonly cause: unknown;
}

type GhErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'bad_request'
  | 'network'
  | 'bad_config'
  | 'server';
```

### Error code reference

| Code | Meaning | Common cause |
|------|---------|--------------|
| `not_found` | 404 from the API | Slug doesn't exist for your brand, or you're not authorized to see it. The two are deliberately indistinguishable — partners cannot enumerate resources they don't own. |
| `rate_limited` | 429 from the API | Too many requests. Honor `retryAfterMs` before retrying. |
| `forbidden` | 401 or 403 from the API | Missing / invalid `data-key`, or the key/brand combination doesn't authorize this resource. |
| `bad_request` | Other 4xx from the API | Malformed slug, unknown resource type, or a programmatic call with an empty argument. |
| `network` | Fetch rejected before getting a response | DNS, CORS, offline. Check the `cause` for the underlying `TypeError`. |
| `bad_config` | Thrown during boot | Bad `data-key` format, missing `data-brand`, script loaded from a disallowed host. Surfaces in the console, not as a rejected promise. |
| `server` | 5xx from the API, or a response that wasn't valid JSON | Retry with backoff. |

`retryAfterMs` is populated for `rate_limited` errors and any other response that carried a `Retry-After` header — see [HTTP](#http).

### Declarative degradation

Declarative bindings degrade gracefully — a failed fetch logs a warning to the console and leaves placeholder text in place. The page does not break because one slug is wrong. To show an explicit error message, use `data-when="failed"` (see [Resource lifecycle](#resource-lifecycle-data-when)).

---

## Safety

The SDK is read-only by design. It sends no analytics, no PII, and never executes data as code.

### textContent only

All field values are rendered via `textContent`, never `innerHTML`. Partner data can never inject markup, scripts, or styles. This is the single most important guarantee in the SDK.

### Refused attributes

The following `data-attr-<NAME>` targets are silently refused:

- `data-attr-on*` — every event-handler attribute (`onclick`, `onerror`, `onmouseover`, etc.). Event handlers are never wired from data.
- `data-attr-srcdoc` — `<iframe srcdoc>` is a raw HTML island; binding it would defeat the textContent-only rule.

### URL attribute allowlist and scheme normalization

A defined set of attributes are recognized as URL-bearing. Before the SDK writes one, the resolved value is checked for unsafe schemes:

`href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`, `manifest`

Values whose scheme prefix is `javascript:`, `vbscript:`, or `data:` are silently refused — the attribute is left unset. The scheme check normalizes the value first by stripping leading whitespace and ASCII control characters, then removing any tab / linefeed / carriage return characters before checking the prefix. This mirrors how browsers themselves resolve URLs, so `java\tscript:foo` (which a browser would treat as `javascript:`) cannot sneak past.

### Cross-brand 404

A request for a resource that belongs to a different brand returns 404 from the API, indistinguishable from a non-existent resource. There is no enumeration vector.

---

## Size budget

Hard-budgeted at **8 KB gzipped**, CI-enforced.

## Provenance

Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) attestation via npm Trusted Publishers + GitHub Actions OIDC. Look for the "Built and signed on GitHub Actions" badge on the [package page](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk) — it links back to the exact workflow run that built the artifact.

## License

MIT. See [LICENSE](./LICENSE).
