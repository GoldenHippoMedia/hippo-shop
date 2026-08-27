# @goldenhippo/hippo-shop-sdk

[![npm version](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-sdk.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)
[![bundle size](https://img.shields.io/badge/gzipped-%E2%89%A48%20KB-blue)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Browser SDK for reading Golden Hippo public data — funnels, destinations, products. Loads from a `<script>` tag and exposes two complementary surfaces:

1. **Declarative** — write HTML with `data-gh-*` attributes; the SDK scans the page, fetches the right resources, and renders the values. No JS required.
2. **Programmatic** — call `window.gh.data.product(slug)` and friends for full control.

Both share the same auth, caching, and brand-scoped access rules enforced by the API.

> Source: [GoldenHippoMedia/hippo-shop](https://github.com/GoldenHippoMedia/hippo-shop) · DTO contract: [`@goldenhippo/hippo-shop-types`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)

> New to Hippo Shop? See [About this version](../../README.md#about-this-version) in the root README for what v4 does and the three things worth knowing before you integrate.

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
- [Superfunnel-hosted pages](#superfunnel-hosted-pages)
- [Session, attribution, and events](#session-attribution-and-events)
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
<script src="https://api-prod.goldenhippo.io/sdk/v4/gh.js"
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
- Attribute changes on any of: `data-gh-product`, `data-gh-destination`, `data-gh-funnel`, `data-gh-checkout`, `data-gh-step`, `data-field`, `data-format`, `data-if`, `data-if-not`, `data-each`, `data-with`, `data-when`.

`data-gh-checkout` and `data-gh-step` are watched for a specific reason: swapping a checkout slug re-composes that link's `href` against the new destination, and swapping a step slug is how an SPA route change produces a fresh `Page View` without any JavaScript of yours. See [Session, attribution, and events](#session-attribution-and-events).

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
| `data-brand-token` | conditional | falls back to `data-brand` | The brand's `BRAND_NAME` token — the vocabulary Altern attributes on (`gundry`), not the public display name (`Gundry MD`). It fills the payload `brand` field on every funnel event, as `data-brand-token ?? data-brand`. **Omit it and every funnel event on the page is attributed to the wrong brand**, with a `200` from the API and nothing in any log. Required on every brand whose token differs from its display name — see [Funnel events](#funnel-events). |
| `data-debug` | no | `"false"` | If set to the string `"true"`, the SDK logs requests, cache hits, and bind passes to the browser console with a `[gh]` prefix. Also sets `window.gh.debug = true`. |
| `data-checkout-base` | conditional | — | Brand-level fallback base URL for outbound offer links (e.g. `https://checkout.gundrymd.com`). Used only when the destination carries neither a per-destination override nor its own `url`. Required if any page on this brand uses `data-gh-checkout` or `gh.checkoutUrl()` against destinations Salesforce has no URL for; optional otherwise. |
| `data-cookie-domain` | conditional | auto-detect | Explicit `Domain` for the `hippo_session_id` cookie (e.g. `.gundrymd.com`). When absent the SDK derives the registrable root from `location.hostname` using a single-segment TLD allowlist — `com, net, org, io, app, dev, ai, co, us, store, shop`. **Multi-part TLDs (`.co.uk`, `.com.au`, `.co.jp`) require this attribute**; auto-detect refuses to guess them and falls back to a host-only cookie, which breaks the cross-subdomain handoff. |

| `data-session` | no | on | Set to `"off"` (or `"false"`) to disable session identity entirely: no `POST /public/v1/session`, no `hippo_session_id` cookie, and no `sessionid=` on outbound links. Landing attribution is still parsed, so UTM and click-id params keep riding checkout links. **Implies `data-events="off"`** — an event with no session id is unattributable. |
| `data-checkout-sessionid` | no | on | Set to `"off"` to stop writing `sessionid=` onto outbound checkout URLs while leaving the session, the cookie, and funnel events fully working. For pages where another system owns that param. |
| `data-events` | no | on | Set to `"off"` to disable funnel events: the `Page View`/`New Session` emitter is not installed and `gh.track()` becomes a no-op (still callable, so existing page code doesn't throw). |
| `data-session-url-first` | no | `"false"` | Set to `"true"` to make `?sessionid=` outrank the `hippo_session_id` cookie in the resolution ladder. Off by default so an inbound link cannot re-key a returning visitor's session on every visit — turn it on only where another system owns visitor identity. See [Superfunnel-hosted pages](#superfunnel-hosted-pages). |

`data-session`, `data-checkout-sessionid` and `data-events` accept `"off"` and `"false"` interchangeably. Anything else — including a typo — leaves the feature **on**, deliberately: silently disabling session tracking for a whole brand returns `200`s and surfaces only in a missing-revenue report weeks later.

Set `data-checkout-base` and `data-cookie-domain` together on brands running a Superfunnel-hosted subdomain — see [Session, attribution, and events](#session-attribution-and-events).

### Superfunnel-hosted pages

Superfunnel owns visitor identity on the pages it serves, and it interacts with the SDK in two ways worth knowing about.

**It puts its session id on the URL as `?sessionId=` — camelCase.** The SDK matches that key case-insensitively, so `?sessionId=`, `?sessionid=` and `?SESSIONID=` are all adopted. (Through v4.1.2 the match was exact, so a camelCase param fell through to a freshly minted UUID and the two systems disagreed about the visitor for the whole session.) Outbound checkout links still *write* lowercase `sessionid`, which is what the funnel reads — the SDK reads liberally and writes exactly.

**It appends its own `sessionid` to every link on the page, including the ones the SDK builds.** That produces two `sessionid` params on one URL. Every reader — the funnel included — takes the first occurrence, and the SDK's is written first, so the SDK's value wins. Once the SDK is adopting Superfunnel's id (above), both values are the same and this resolves itself. Where it doesn't, `data-checkout-sessionid="off"` drops the SDK's copy and leaves Superfunnel's alone.

A returning visitor carrying a `hippo_session_id` cookie from an earlier visit still resolves to the cookie, not to Superfunnel's `?sessionId=` — that ordering is what stops any inbound link re-keying a session on every visit. On Superfunnel-hosted pages, where Superfunnel is the identity authority and a 30-day-old cookie of ours must not outrank it, set `data-session-url-first="true"`.

The script tag itself is auto-located via `document.currentScript`; if that's unavailable, the SDK falls back to a `[data-key][data-brand]` `<script>` whose `src` ends in `/gh.js`. That covers the active CDN URL (`/sdk/v4/gh.js`), the frozen `/sdk/v3/gh.js` and `/sdk/v1/gh.js` URLs, and local-dev paths.

If `window.gh.data` is already attached when the SDK boots — for example, because the tag is included twice — the SDK refuses to overwrite the existing surface and logs a warning. This is harmless but worth knowing if you see "window.gh.data already exists" in the console.

### Host allowlist

The API base URL is derived from the script tag's `src` host. Only the following hosts are accepted:

| Host | Use |
|------|-----|
| `api-prod.goldenhippo.io` | Production |
| `api-uat.goldenhippo.io` | UAT / staging |
| `localhost`, `127.0.0.1`, `[::1]` | Local development |
| `*.local` | Local development on `.local` hostnames |

Loading the SDK from any other host throws a config error and refuses to attach. The host is part of the contract — the SDK cannot be pointed at an unrecognized API server.

## Declarative attributes

Write HTML; the SDK reads the `data-*` attributes below, fetches the right resources, and renders values.

### Reference

| Attribute | Where | What it does |
|-----------|-------|--------------|
| `data-gh-product="slug"` | Any element | Sets the **product** context for the element + descendants. |
| `data-gh-destination="slug"` | Any element | Sets the **destination** context. |
| `data-gh-funnel="slug"` | Any element | Sets the **funnel** context. Also names the funnel whose DTO supplies funnel-event identity — see [Funnel events](#funnel-events). |
| `data-gh-checkout="destination-slug"` | Any element | Marks the element as the control that sends the visitor to buy that offer. Fills `href` on `<a>`; attaches a navigating `click` handler on anything else. See [Session, attribution, and events](#session-attribution-and-events). |
| `data-gh-step="step-slug"` | Any element, or the SDK `<script>` tag | Names the funnel step for funnel events, matched against the funnel's own step slugs. Read from the **live DOM at emit time**, so an SPA can change it; a page element wins over the script tag. |
| `data-gh-funnel-id="salesforce-id"` | Any element, or the SDK `<script>` tag | Supplies the funnel's Salesforce ID directly. The **first** source of funnel identity for funnel events, ahead of the resolved funnel DTO and `?origmainFunnelIdOrig=`. A bound destination never supplies one. |
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

## Session, attribution, and events

The SDK participates in Golden Hippo's session and attribution model rather than inventing its own. It resolves one session id per visitor, persists it at the brand's root domain, posts it to the API along with the landing URL's attribution, stamps it onto every outbound offer link, and emits its funnel events — one `Page View` per page load, plus a `New Session` on the load that establishes the session.

All of it degrades quietly. A blocked cookie, a failed POST, an unresolvable funnel id — attribution gets worse; the page never breaks.

### The session id

One id per visitor, resolved once per page load, in this order:

1. **The `hippo_session_id` cookie** — validated against `/^[A-Za-z0-9._-]{1,128}$/`; a value that fails is ignored and the SDK falls through. A returning visitor keeps the session they already have, and the cookie is not re-written, so the 30-day window does not roll.
2. **`?sessionid=` on the current URL.** The key is matched **case-insensitively** — `?sessionId=`, `?SESSIONID=` and `?sessionid=` are all accepted, which is what lets Superfunnel's camelCase handoff through. Where the same URL carries the param more than once (Superfunnel appends its own to every link), the **first** occurrence wins, matching every other reader including the funnel. Validated against that same pattern, and read **only when no usable cookie exists** — that is, for a genuinely new visitor — unless `data-session-url-first="true"` swaps rungs 1 and 2. On a pass the value is adopted and written to the cookie, host-only. On a fail the SDK warns and falls through.
3. **A freshly minted UUID v4** — `crypto.randomUUID()`, with an RFC-4122 `getRandomValues` fallback. In a runtime that offers neither, minting throws; the SDK catches that, logs an error, and degrades to a last-resort `fallback-<base36>-<base36>` id — neither a UUID nor cryptographically random. Resolution has to finish either way: if it didn't, `gh:session-ready` would never fire and every checkout link would stay at `href="#"`.

| Cookie | Max-Age | Path | Domain | SameSite | Secure |
|--------|---------|------|--------|----------|--------|
| `hippo_session_id` | 30 days (`2592000`), **absolute — not rolling**: written on mint, on `?sessionid=` adoption, and when the session POST returns a different id, never re-written on a plain cookie hit | `/` | For a **minted** id: `data-cookie-domain`, else the auto-detected registrable root (`.gundrymd.com`), else host-only. For an id **adopted** from `?sessionid=`: always host-only. A server-returned replacement reuses whichever scoping the id it replaced would have had | `Lax` | on `https:` |

Root-domain scoping on a **minted** id is what makes a returning visitor one visitor across subdomains: `sf.gundrymd.com` and `www.gundrymd.com` read the same cookie. The handoff *within* a visit rides the URL rather than the cookie, which is why an **adopted** id needs no root scoping — and deliberately doesn't get it. See [SPEC — Cookie contract](./SPEC.md#cookie-contract).

**Why the cookie outranks the param.** A returning visitor keeps their session; the param is for new visitors, and that is how Superfunnel's own minted UUID gets adopted here. Ranking the param first would let any inbound link re-key a returning visitor's session on every visit. The reference funnel app ranks it first only because its own `/cid` router already reconciles server-side — it mints the param there, reusing the visitor's existing cookie when one is present, so by the time the param reaches that app's browser both orderings agree. Nothing performs that hop for a Superfunnel page, so the reconciliation happens here instead.

Read it with `window.gh.session.id()` — `undefined` until `gh:session-ready` fires. The attribution parsed from the landing URL is on `window.gh.session.params()`.

### The session POST response is authoritative

`POST /public/v1/session` answers with the record the API stored for this visit, including the session id actually in force after it reconciled the id we sent against its own server-side session. If that id differs from the one resolved above, **the SDK adopts it and rewrites the cookie** — before `gh:session-ready` fires, so `gh.session.id()`, every outbound `sessionid=`, the funnel events and their dedupe keys all see one value rather than two. A returned id that fails the same `/^[A-Za-z0-9._-]{1,128}$/` check is ignored with a warning, and a failed POST simply leaves the locally resolved id in place.

The response body is kept as well: it is forwarded verbatim as the funnel event's `affParams` — see [Funnel events](#funnel-events).

### Inbound handoff — `?sessionid=`

Land a **new** visitor with `?sessionid=<id>` and the SDK adopts that id as its own:

```
https://sf.gundrymd.com/offer?sessionid=3f6b2c11-1c2a-4b1d-9f0a-77c1d2e3f455&utm_source=fb&fbclid=IwAR…
```

That is how one page hands a visitor to another without minting a second identifier for a single visit, and it is how a session minted elsewhere — Superfunnel's own UUID, for instance — becomes the session id on this side. A visitor who already carries a valid `hippo_session_id` cookie keeps it: by default the param is read only when the cookie is absent or malformed, so an inbound link cannot re-key a returning visitor. Set `data-session-url-first="true"` to invert that on pages where another system owns visitor identity — see [Superfunnel-hosted pages](#superfunnel-hosted-pages). The SDK trusts the URL here **by design** — see [SPEC — Session identity and inbound `?sessionid=`](./SPEC.md#session-identity-and-inbound-sessionid) for the threat note and why the blast radius is analytics only. With `data-debug="true"` the adoption is logged as `[gh] session: adopting ?sessionid= handoff <id>`.

### Outbound handoff — `data-gh-checkout`

`data-gh-checkout="<destination-slug>"` marks the control that sends a visitor to buy that offer. On `<a>` the SDK fills in `href`; on anything else it attaches a `click` handler that navigates the page.

```html
<section data-gh-destination="bio3-3p-sub">
  <h3 data-field="name"></h3>
  <a data-gh-checkout="bio3-3p-sub">Select this offer</a>
</section>
```

The base URL resolves in this order, and the first one present wins:

1. `destination.pricing.checkoutOverrideUrl` — per-destination override.
2. `destination.url` — the destination's own absolute URL. The normal case.
3. `data-checkout-base` on the script tag — brand-level fallback.

Onto that base the SDK appends, in this order and skipping anything empty: `order_form_id`, `sessionid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_campaign_id`, `utm_content`, `utm_term`, `utm_chat`, `utm_action`, `off_id`, `aff_id`, `subid1`…`subid5`, `landing_url`, `referral_url`, `sales_funnel`, the seven raw click-ids (`fbclid`, `gclid`, `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`), then `origmainFunnelIdOrig`, `origdsidOrig`, and `origsplitTestingFunnelIdOrig` forwarded verbatim from the current URL. `funnelSTPId` and `dsid` are never forwarded — the destination resolver re-mints `funnelSTPId` on every hop, so forwarding it would hand the next page a stale step id.

```
https://www.gundrymd.com/bio3-3pk-sub?order_form_id=OF_123&sessionid=3f6b2c11-…&utm_source=fb&subid1=IwAR…&fbclid=IwAR…
```

Attribution parameters use `setIfAbsent` semantics — a parameter already present on the base URL wins, and the SDK only fills what is absent. `order_form_id` and `sessionid` are the deliberate exception: they are SDK-owned and written unconditionally, overwriting whatever the base URL carried. (`data-checkout-sessionid="off"` gives up SDK ownership of `sessionid` — the base URL's value then survives, and the warning below changes to say so.) Overwriting a pre-existing, different value logs a warning — it almost always means a live funnel link with a session already baked into it was pasted into the destination record in Salesforce. Values are never truncated.

### Inbound click-ids → `subid` slots

The SDK derives the `subid` parameters from the click-id on the landing URL, matching the funnel's own normalizer. The raw click-id also rides along outbound under its own name.

| Inbound param | Writes | Also sets `subid5` |
|---|---|---|
| `fbclid` | `subid1` | — |
| `gclid` | `subid1` | — |
| `ScCid` | `subid1` | `snap` |
| `qclid` | `subid1` | `quora` |
| `twclid` | `subid1` | `twitter` |
| `ndclid` | `subid1` | `nextdoor` |
| `wbraid` | `subid4`, prefixed `wbraid:` | — |

The slot value is the click-id with the characters `<`, `>`, `'`, `"`, `` ` ``, and `&` stripped. The click-id emitted under its own name is unmodified.

Table order is precedence: the first matching row claims `subid1`, and an already-populated `subid1` / `subid4` is never overwritten. The `subid5` marker is applied independently of the slot write, so `?fbclid=F&ScCid=S` yields `subid1=F` **and** `subid5=snap`. Inbound keys are matched case-insensitively, and both `subidN` (canonical) and `sub_idN` (legacy) are accepted inbound, with the canonical spelling winning; only `subidN` is ever emitted outbound.

### `await gh.checkoutUrl(slug)`

The programmatic twin of `data-gh-checkout`. It returns a `Promise<string>`: it awaits session resolution and fetches the destination if it isn't cached yet, so it can never hand back a URL with the session id and UTMs silently missing.

```js
document.getElementById('buy').addEventListener('click', async (event) => {
  event.preventDefault();
  window.location.href = await window.gh.checkoutUrl('bio3-3p-sub');
});
```

> **`window.open()` will be popup-blocked.** Awaiting inside a click handler breaks the user-gesture chain, so `window.open(await window.gh.checkoutUrl(slug))` is blocked in every major browser. Assign `window.location.href` instead — a same-tab navigation is unaffected by the `await`, and it is the checkout pattern Golden Hippo actually uses.
>
> If you genuinely need a new tab, resolve the URL **before** the click and stash it, so the handler itself stays synchronous:
>
> ```js
> let checkoutUrl = '#';
> window.addEventListener('gh:bindings-ready', async () => {
>   checkoutUrl = await window.gh.checkoutUrl('bio3-3p-sub');
> }, { once: true });
>
> document.getElementById('buy').addEventListener('click', () => {
>   window.open(checkoutUrl, '_blank'); // no await in the handler — gesture intact
> });
> ```

### Funnel events

The SDK emits exactly **one `Page View` funnel event per page load**, however many offers the page binds. Six bound destinations on an offer selector are six variants of one page view, not six page views.

On the load that *establishes* the session it emits a **`New Session`** first. The two are independent emissions, not alternatives — on a cold load both fire — and they share the identical 36-field payload; only `eventType` differs. `New Session` goes out when the session was newly established on this load (minted, adopted from `?sessionid=`, or replaced by the [session POST](#the-session-post-response-is-authoritative)) **and** a funnel id resolved. A returning visitor's page load sends `Page View` alone. It carries its own dedupe key, so an SPA step change re-emits `Page View` without re-emitting `New Session`.

#### Funnel identity

Read from the DOM and the URL at emit time. First one present wins:

| Source | What it supplies |
|--------|------------------|
| `data-gh-funnel-id` | The funnel's Salesforce ID directly. A page element wins over the script tag. |
| the resolved funnel's `id` | The funnel named by `data-gh-funnel`, `?origuidOrig=`, or `?uid=` — fetched by slug, then read for `HippoShopFunnelDTO.id`. |
| `?origmainFunnelIdOrig=` | The funnel ID the `/fst` hop minted onto the URL. |

**A bound destination no longer supplies funnel identity.** `HippoShopDestinationDTO.funnelId` names the funnel a destination sends the visitor *into*, not the funnel the current page view belongs to — and on a selector binding twelve offers, "the first one in the DOM" is an arbitrary answer. So **a page that only binds destinations emits no funnel event at all**, by design: an offer selector with six `data-gh-destination` sections and nothing else is deliberately absent from funnel reporting. Give the page a funnel of its own — `data-gh-funnel-id`, or `data-gh-funnel` with the funnel's slug — if you want page views from it. (When nothing else names a funnel the SDK does try the bound destination's `funnelSlug`, but that names a post-purchase funnel, which `GET /public/v1/funnel/<slugOrId>` rejects with a 404 by design; in debug mode you will see that load fail.)

**No funnel ID, no event.** If nothing above yields one, the event is dropped — an event with a blank funnel ID is discarded silently further upstream, so sending it would be strictly worse than not sending it. With `data-debug="true"` the drop is logged with the reason.

```html
<body data-gh-step="offer-selector" data-gh-funnel-id="a0F0m000002Fnl1EAC">
  <section data-gh-destination="bio3-1p-ot">…</section>
  <section data-gh-destination="bio3-3p-sub">…</section>
  <!-- four more offers -->
</body>
```

#### Step identity

The step resolves in this order. Tiers 1, 2, and 4 match against the steps of the funnel the page named, so they need that funnel to have loaded; tier 3 does not.

1. **`data-gh-step`**, matched against the funnel's own step slugs. A page element wins over the script tag.
2. **The current URL's last path segment** — trailing slashes dropped, then any file extension, and matched case-insensitively. `/fp/os260520a_sh_ap` matches the step slug `os260520a_sh_ap`; `/offer-selector.html` matches `offer-selector`. This is what makes an externally-built page resolvable without an attribute at all.
3. **`?funnelSTPId=`** — the step id the `/fst` hop minted onto the URL. A fallback only: it is a step-1 snapshot, so it never overwrites a step resolved from the funnel itself.
4. **The funnel's only step**, when the funnel has exactly one. This is the supported way to model a pre-purchase funnel built outside Salesforce — a Superfunnel flow, say — as a single Salesforce funnel: one step stands in for the whole flow, and every page of it resolves there.
5. Otherwise `null`. The event still goes out; only the step id is missing.

`data-gh-step` also lands in the payload's `url` field as the step *slug*, whether or not it matched a step of the funnel.

#### URL params the SDK reads

Alongside `?sessionid=` and the click-ids, these `/fst`-minted params feed funnel-event identity. These `/fst` params are read **case-sensitively** (`?sessionid=` is the exception — see [The session id](#the-session-id)).

| Param | What it supplies |
|-------|------------------|
| `origuidOrig`, `uid` | The funnel **slug** — the key `GET /public/v1/funnel/<slugOrId>` actually resolves by. `origuidOrig` is checked first: it is the spelling that survives later hops. The funnel id in `origmainFunnelIdOrig` does **not** resolve at that route, which is why these two exist. |
| `origmainFunnelIdOrig` | The funnel's Salesforce ID, used directly as funnel identity when neither the attribute nor a resolved funnel supplied one. |
| `origdsidOrig`, `dsid` | The destination's Salesforce ID. |
| `funnelSTPId` | A step id — stale by design, so it is a fallback only. |
| `origsplitTestingFunnelIdOrig` | The split-test funnel ID, sent as `splitTestingFunnelId`. |

#### What is sent

**The event's `brand` is `data-brand-token`, not `data-brand`.** Altern attributes the event off the payload's `brand` field — not the `X-GH-Brand` header — and it expects the `BRAND_NAME` token vocabulary (`gundry`), not the public display name (`Gundry MD`). The SDK sends `data-brand-token ?? data-brand`, so a script tag that omits `data-brand-token` falls back to the display name for every event it emits. Both values land in the same Salesforce column, so the wrong one is silent mis-attribution rather than an error: the POST returns `200` and nothing appears in any log. If a brand reports missing funnel events while the API looks healthy, check the embed's script tag before anything else.

**The body nests the session's own record as `affParams`.** The event is posted as `{ …event, affParams: { …the session POST's response body } }` — the server's echo of what it stored for this session, forwarded verbatim, or `{}` when that POST failed. That is how session and attribution data reaches the upstream on a request that deliberately carries **no `connect.sid`**: the funnel-event POST is uncredentialed, so it needs neither credentialed CORS nor the `SameSite=None` third-party cookie that Safari and Firefox block outright.

The events fire once session resolution and the first bind pass have both settled, plus a short quiet window so late-injected attributes land in the same event instead of a second one. They are sent with `keepalive: true` so they survive page unload, and they are **never retried** — not even on `429`.

#### `gh.track()`

The programmatic escape hatch, for SPA route changes:

```js
await window.gh.track('Page View');
```

`'Page View'` and `'New Session'` are the accepted event types; any other value logs a warning and does nothing. It respects the same per-page-load dedupe guard as the automatic emit, keyed on the session id, the event type, and the step — so the two types never suppress each other. **Update `data-gh-step` before calling it** — otherwise the key is unchanged and the call is a deliberate no-op. Often you don't need it at all: `data-gh-step` is in the `MutationObserver`'s filter, so an SPA that swaps the attribute gets a new `Page View` through the existing machinery.

## Recipes

Copy-paste patterns for the most common integrations. All use the example product slug `multi-vitamin`; swap in your own slug and brand.

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

Register your own formatter once, then bind any field through it. This is the right way to express derived values (percentages, computed labels, currency-in-words) without adding per-page JS to every binding.

Register from an inline `<script>` placed **after** the SDK tag. `window.gh` already exists by then, and the SDK defers its first bind pass to `DOMContentLoaded`, so the formatter is in place before anything renders — no listener and no `gh.refresh()` needed:

```html
<script>
  window.gh.format.register('savePercent', (savings, fullPriceStr) => {
    const full = Number(fullPriceStr);
    if (!savings || !Number.isFinite(full) || full === 0) return '';
    return 'Save ' + Math.round((savings / (full + savings)) * 100) + '%';
  });
</script>

<article data-gh-product="multi-vitamin" data-with="variants.subscription.standardByQuantity.6">
  <p class="badge" data-if="savings">
    <span data-field="savings" data-format="savePercent:169.95"></span>
  </p>
  <p class="price"><span data-field="price" data-format="currency:USD"></span></p>
</article>
```

Formatters receive the bound value as their first argument; additional `:`-separated values from `data-format` are passed as string arguments (so the `:169.95` above arrives as a string and `Number()`'s back to a float).

> **Do not wrap registration in a `gh:data-ready` listener placed below the SDK tag.** That event is dispatched synchronously from inside `boot()`, while the SDK's own `<script>` is still executing — so it has already fired before any later inline script runs, and a listener added from there never fires. The formatter is silently never registered and the element renders the raw bound value, which for a number reads as a plausible result rather than as a bug. If you cannot control script order, use the [defensive pattern](#defensive-already-booted-pattern).
>
> `gh.refresh()` is only needed when you register **after** the first bind pass — from a `load` handler, an async callback, or a framework effect. See [Inline-script timing](#inline-script-timing).

### Checkout handoff

Capture attribution on landing and carry it onto outbound offer links:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v4/gh.js"
        data-key="gh_pk_internal_gundry_abc123"
        data-brand="Gundry MD"
        data-brand-token="gundry"
        data-checkout-base="https://checkout.gundrymd.com"
        data-cookie-domain=".gundrymd.com"></script>

<a data-gh-checkout="bio3-3p-sub">Buy now</a>
```

On click the link navigates to the destination's own URL with `?order_form_id=…&sessionid=…&utm_source=…&subid1=…` appended, carrying the attribution captured from the landing URL. `data-checkout-base` is the brand-level fallback for destinations Salesforce has no URL for.

The programmatic twin is **async**:

```js
const url = await window.gh.checkoutUrl('bio3-3p-sub');
window.location.href = url;
```

`window.open(await …)` inside a click handler is popup-blocked; see [Session, attribution, and events](#session-attribution-and-events) for the resolution order, the full outbound parameter set, and the new-tab workaround — and the [SDK SPEC](./SPEC.md#checkout-handoff) for the contract.

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

window.gh.checkoutUrl(slug):    Promise<string>;   // composed outbound URL for a destination
window.gh.track(eventType):     Promise<void>;     // 'Page View' | 'New Session' (dedupe-guarded)
window.gh.session.id():         string | undefined; // current hippo_session_id cookie value
window.gh.session.params():     ParsedParams | null; // attribution parsed from the landing URL

window.gh.format: FormatRegistry; // see the Formatters section
window.gh.debug?: boolean;        // set to true when data-debug="true" on the script tag
```

`checkoutUrl` and `track` are **stable function identities** — capturing one (`const buy = window.gh.checkoutUrl`, a GTM variable, a React prop) is safe. They read live session state through a thunk rather than closing over a snapshot, so a captured reference behaves identically to a fresh property read for the life of the page. `session.id()` and `session.params()` return `undefined` / `null` until `gh:session-ready` fires.

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

Three events fire on `window` during boot:

| Event | When |
|-------|------|
| `gh:data-ready` | The synchronous setup is done — `window.gh.data`, `bind`, `refresh`, and `format` are attached. Fires before the first bind pass. |
| `gh:bindings-ready` | The initial bind pass has completed, including all initial fetches. Fires **once** per page lifetime. |
| `gh:session-ready` | Session resolution has settled — on success **and** on swallowed failure, so it always fires. `event.detail` is `{ sessionId: string, adopted: boolean, params: ParsedParams }`, where `adopted` is `true` when the id came from `?sessionid=` on this page load. Fires **once** per page lifetime. |

`gh:session-ready` is the hook to use when your own analytics need the session id — it is the only point at which `window.gh.session.id()` is guaranteed to be populated:

```js
window.addEventListener('gh:session-ready', (event) => {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'gh_session', sessionId: event.detail.sessionId });
}, { once: true });
```

A successful session POST is **not** a precondition: the event fires with a resolved `sessionId` even when the network call failed, because the id itself is resolved client-side.

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

The three resource reads share one shape; v4 adds two write endpoints:

| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `<base>/public/v1/funnel/<slugOrId>` | Returns `HippoShopFunnelDTO` |
| `GET` | `<base>/public/v1/destination/<slugOrId>` | Returns `HippoShopDestinationDTO` |
| `GET` | `<base>/public/v1/product/<slugOrId>` | Returns `HippoShopProductDTO` |
| `POST` | `<base>/public/v1/session` | Registers this visit's attribution. Body is `{ "affParameters": { …attribution, "sessionId": "<id>" } }`. Fires once per page load. Empty values are **omitted**, never sent as `""` — a blank and an absent key are indistinguishable upstream, so omitting is simply smaller and unambiguous. Storage is per-key **first-write-wins**: a POST fills keys the session does not yet hold and cannot change one it already holds. Values are truncated server-side at 255 characters (18 for `offId`/`affId`). The **response body is authoritative** — its `sessionId` replaces the locally resolved one, and the body itself rides on funnel events as `affParams`. |
| `POST` | `<base>/public/v1/funnel-event` | A funnel event — `Page View`, plus a `New Session` on the load that establishes the session. Body is `{ …event, "affParams": { …the session POST's response } }`. Sent with `keepalive: true` and an `X-GH-Event-Id: <uuid>` correlation header. Never retried. |

`<slugOrId>` is URL-encoded before insertion. Product responses arrive with `<tier>List` and `<tier>ByQuantity` fields already populated server-side.

### Headers sent

| Header | Value |
|--------|-------|
| `X-GH-Key` | Your publishable key (from `data-key`) |
| `X-GH-Brand` | Your brand display name (from `data-brand`) |
| `Accept` | `application/json` |

The three `GET` reads send no credentials. The session `POST` sends `credentials: 'include'` so the API can maintain its own session cookie; the funnel-event `POST` does not, and adds `X-GH-Event-Id` — it needs no `connect.sid`, because the session record it would otherwise have to be looked up for travels in the body as `affParams`. No request carries PII — the payloads are URL attribution parameters, a session id, and a browser / OS / device string derived from the user agent. The SDK sets no `User-Agent` beyond the browser default.

### Base URL derivation

The API base URL is the script tag's `src` origin. Loading the SDK from `https://api-prod.goldenhippo.io/sdk/v4/gh.js` produces a base URL of `https://api-prod.goldenhippo.io`; loading it from `https://api-uat.goldenhippo.io/sdk/v4/gh.js` produces `https://api-uat.goldenhippo.io`. See [Script tag config — Host allowlist](#host-allowlist) for the full list of accepted hosts.

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
  | 'config'
  | 'server';
```

### Error code reference

| Code | Meaning | Common cause |
|------|---------|--------------|
| `not_found` | 404 from the API | Slug doesn't exist for your brand, or you're not authorized to see it. The two are deliberately indistinguishable — you cannot enumerate resources you don't own. |
| `rate_limited` | 429 from the API | Too many requests. Honor `retryAfterMs` before retrying. |
| `forbidden` | 401 or 403 from the API | Missing / invalid `data-key`, or the key/brand combination doesn't authorize this resource. |
| `bad_request` | Other 4xx from the API | Malformed slug, unknown resource type, or a programmatic call with an empty argument. |
| `network` | Fetch rejected before getting a response | DNS, CORS, offline. Check the `cause` for the underlying `TypeError`. |
| `bad_config` | Thrown during boot | Bad `data-key` format, missing `data-brand`, script loaded from a disallowed host. Surfaces in the console, not as a rejected promise. |
| `config` | Runtime configuration error | `gh.checkoutUrl()` or a `data-gh-checkout` binding cannot compose a URL because **none** of the three base sources resolved: the destination has no `pricing.checkoutOverrideUrl`, no `url`, and the script tag has no `data-checkout-base`. `gh.checkoutUrl()` rejects with it; `[data-gh-checkout]` elements fall back to `href="#"` instead. |
| `server` | 5xx from the API, or a response that wasn't valid JSON | Retry with backoff. |

`retryAfterMs` is populated for `rate_limited` errors and any other response that carried a `Retry-After` header — see [HTTP](#http).

### Declarative degradation

Declarative bindings degrade gracefully — a failed fetch logs a warning to the console and leaves placeholder text in place. The page does not break because one slug is wrong. To show an explicit error message, use `data-when="failed"` (see [Resource lifecycle](#resource-lifecycle-data-when)).

---

## Safety

The SDK never executes data as code and never sends PII. It is **not** read-only as of v4: it posts this visit's attribution to `/public/v1/session` and one or two funnel events to `/public/v1/funnel-event` — a `Page View`, plus a `New Session` on the load that establishes the session. [HTTP](#http) lists exactly what leaves the page; [Session, attribution, and events](#session-attribution-and-events) explains why. Everything below still holds — the rendering path is unchanged.

### textContent only

All field values are rendered via `textContent`, never `innerHTML`. Data can never inject markup, scripts, or styles. This is the single most important guarantee in the SDK.

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

## Advanced — TypeScript / NPM consumers

Most pages need only the declarative attributes ([§ Declarative attributes](#declarative-attributes)) and the `window.gh` surface ([§ Programmatic API](#programmatic-api)). The exports listed below are the package's full public API for advanced consumers — building a custom auto-boot, bypassing the script-tag detection, instantiating the runtime in a framework, or reusing utilities like `getByPath` in isolation. They're **stable but not the recommended path**.

If you're not sure whether you need these, you don't.

Import from the package root:

```ts
import {
  applyBindings,
  boot,
  builtinFormatters,
  collectResources,
  FormatRegistry,
  GhDataClient,
  GhError,
  GhRuntime,
  getByPath,
  parseScriptConfig,
} from '@goldenhippo/hippo-shop-sdk';

import type { GhConfig, GhErrorCode, GhWindow, ResourceState } from '@goldenhippo/hippo-shop-sdk';
```

### Barrel exports

| Export | Kind | Purpose |
|--------|------|---------|
| `applyBindings(root, opts)` | function | Apply bindings to a subtree against an explicit `{ formatters, resources, resourceStates? }` bag. The low-level core that `gh.bind` wraps. |
| `boot(doc?, win?)` | function | The auto-boot entry point: locates the SDK `<script>` tag, parses its config, attaches `window.gh`, and starts the session and event work. Returns `true` when it attached and `false` when it declined (no script tag found, invalid config, or `window.gh.data` already exists). Call it yourself when you are constructing the script element rather than letting the tag boot itself. |
| `collectResources(root)` | function | Return every `(kind, slug)` referenced under a node. Useful for prefetching server-side or warming a cache. |
| `getByPath(obj, path)` | function | Resolve a dot-path against any object. Returns `undefined` on miss; never throws. Reusable outside the SDK. |
| `parseScriptConfig(scriptEl)` | function | Validate a `<script>` element's `data-*` config and produce a `GhConfig`. Throws on invalid input. |
| `builtinFormatters` | `Record<string, Formatter>` | The raw built-in formatter map. Useful for constructing a custom `FormatRegistry`. |
| `FormatRegistry` | class | The class behind `window.gh.format`. Instantiate one if you need an isolated registry that doesn't share state with the global. |
| `GhDataClient` | class | The HTTP client (`funnel` / `destination` / `product` methods). Construct with a `GhConfig` to talk to the API without the binding layer. (Constructor also accepts an optional logger object with `debug` / `warn` / `error` methods.) |
| `GhRuntime` | class | The high-level orchestrator: ties a `GhDataClient` to the binding pass and manages the resource + lifecycle caches. |
| `GhError` | class | The error class thrown by all data methods. |
| `GhConfig` | type | The parsed config produced by `parseScriptConfig`. |
| `GhErrorCode` | type | Union of `'not_found' \| 'rate_limited' \| 'forbidden' \| 'bad_request' \| 'network' \| 'bad_config' \| 'config' \| 'server'`. |
| `GhWindow` | type | The shape of `window.gh` after boot — `data`, `bind`, `refresh`, `format`, and the optional `debug`, `checkoutUrl`, `track`, and `session` members. Useful for typing `window` in a TypeScript project. Note the SDK declares `window.gh` as `Partial<GhWindow>`, since the object exists only once boot has attached to it. |
| `ResourceState` | type | Union of `'loading' \| 'loaded' \| 'failed'` — the values passed in `ApplyBindingsOptions.resourceStates`. |

### DTO types

The data types these methods accept and return (`HippoShopFunnelDTO`, `HippoShopDestinationDTO`, `HippoShopProductDTO`, `HippoShopErrorDTO`) live in a separate package, [`@goldenhippo/hippo-shop-types`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types). Install it alongside the SDK for type-only imports:

```bash
pnpm add -D @goldenhippo/hippo-shop-types
```

---

## Size budget

Hard-budgeted at **12 KB gzipped**, CI-enforced on every PR and again at release (`scripts/size-check.mjs`).

That number is not arbitrary. Measured against the [2026 third-party-script benchmark](https://scripts.nuxt.com/learn/analytics-script-performance), `gh.js` ships ~10.8 KB transfer / ~31 KB decoded — level with Cloudflare Web Analytics (10.7 / 30.4 KB) and under half the weight of Segment (30.3 KB), which is the nearest comparable in what it actually does. The budget encodes one commitment: **stay in the lightweight tier.** It is deliberately not set somewhere the bundle cannot reach, because a budget that constrains nothing isn't one.

When the budget is hit, the intended answer is trimming, not raising it.

## Provenance

Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) attestation via npm Trusted Publishers + GitHub Actions OIDC. Look for the "Built and signed on GitHub Actions" badge on the [package page](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk) — it links back to the exact workflow run that built the artifact.

## License

MIT. See [LICENSE](./LICENSE).
