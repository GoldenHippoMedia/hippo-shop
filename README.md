# Hippo Shop

[![CI](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/ci.yml/badge.svg)](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/ci.yml)
[![Release](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/release.yml/badge.svg)](https://github.com/GoldenHippoMedia/hippo-shop/actions/workflows/release.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Typed, key-authenticated, brand-scoped public surface for Golden Hippo data — funnels, destinations, products — readable from external pages with two lines of HTML. As of v4 the SDK also carries Golden Hippo's session and attribution model: it writes a first-party session cookie and posts attribution and funnel events (`Page View`, plus a `New Session` on the load that establishes the session).

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| [`@goldenhippo/hippo-shop-sdk`](./packages/sdk) | [![npm](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-sdk.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk) | Browser SDK. Auto-boots from a `<script>` tag, exposes declarative `data-gh-*` bindings and a programmatic `window.gh.data` API. |
| [`@goldenhippo/hippo-shop-types`](./packages/types) | [![npm](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types) | DTO contract. Zero runtime dependencies, pure TypeScript types. |

Both are published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) via npm Trusted Publishers.


## Contract and roadmap

- [`SPEC.md`](./SPEC.md) — what Hippo Shop promises (repo-level contract)
- [`packages/sdk/SPEC.md`](./packages/sdk/SPEC.md) — SDK public contract
- [`packages/types/SPEC.md`](./packages/types/SPEC.md) — DTO contract
- [`ROADMAP.md`](./ROADMAP.md) — backlog of bugs, ideas, and planned work

## About this version

**v4 is the current release.** It is the first version of Hippo Shop that participates in Golden Hippo's session and attribution model. A v4 page reads funnels, destinations, and products exactly as v3 did, and additionally resolves a session id, writes a first-party `hippo_session_id` cookie, POSTs this visit's attribution to `/public/v1/session`, stamps the session onto outbound offer links, and emits its funnel events — a `Page View` per page load, plus a `New Session` on the load that establishes the session.

v1.x, v2.x, and v3.x remain on npm but are no longer maintained. There are no production consumers of those lines, so v4 is a clean cut rather than a migration — start on v4.

Three things to know before you integrate, because none of them fails loudly:

- **Set `data-brand-token` on any page that binds a destination or checkout link.** It fills the `brand` field on funnel events, as `data-brand-token ?? data-brand`. Omit it and every event on the page is attributed to the display name instead of the brand token — with a `200` from the API and nothing in any log to tell you.

- **A page that only binds destinations emits no funnel event.** Funnel identity comes from `data-gh-funnel-id`, from the funnel named by `data-gh-funnel` / `?origuidOrig=`, or from `?origmainFunnelIdOrig=` — never from a bound destination. An offer selector that binds six offers and declares no funnel of its own is silently absent from funnel reporting, by design; give the page a funnel of its own if you want page views from it.

- **`gh.checkoutUrl()` returns a `Promise<string>`**, because it awaits session resolution before composing the URL. Assign the result to `window.location.href`; `window.open(await gh.checkoutUrl(slug))` is popup-blocked in every major browser, because the `await` breaks the user-gesture chain. See [Session, attribution, and events](./packages/sdk/README.md#session-attribution-and-events) for the full surface, including how to open a new tab safely.

## Quickstart

Drop one `<script>` tag and write your HTML — no install required:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v4/gh.js"
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

*Working on Hippo Shop itself? See the [release process](./docs/ops/release-process.md), [incident response runbook](./docs/ops/incident-response.md), and [architecture docs](./docs/architecture/) for setup, repository layout, and operational guidance.*

## License

MIT. See [LICENSE](./LICENSE).
