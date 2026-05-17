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

When the script evaluates, it locates its own `<script>` element (via `document.currentScript` or a fallback selector on `[data-key][data-brand][src*="/sdk/v1/gh"]`, with a final local-dev fallback on `[data-key][data-brand][src$="/gh.js"]`), reads its `data-*` attributes, and attaches `window.gh`. Loading the SDK from any host outside the allowlist throws a config error and refuses to attach — the host is part of the contract.

Attributes read from the script tag:
- `data-key` (required) — public access key issued by Golden Hippo. Must match `/^gh_pk_[a-z0-9_-]+_<hex>$/`.
- `data-brand` (required) — the brand this page reads data for. Must be non-empty after trimming.
- `data-debug` (optional) — when set to the literal string `"true"`, enables structured `[gh]` console logging and sets `window.gh.debug = true`.

Accepted script-host allowlist (the API base URL is the script's `src` origin):
- `api-prod.goldenhippo.io` (production)
- `api-uat.goldenhippo.io` (UAT / staging)
- `localhost`, `127.0.0.1`, `[::1]` (local development)
- Any `*.local` hostname (local development on `.local` hostnames)

After successful boot:
- `window.gh.data` is set with `funnel`, `destination`, and `product` methods.
- `window.gh.bind`, `window.gh.refresh`, and `window.gh.format` are exposed.
- `window.gh.debug` is set to `true` when `data-debug="true"`.
- A `gh:data-ready` event is dispatched on `window`.
- Auto-binding runs against the current DOM (deferred to `DOMContentLoaded`, or to a `setTimeout(0)` task if the DOM is already ready, so inline scripts placed after the SDK tag get a chance to register custom formatters before the first bind pass).

If the script cannot find its own tag, cannot parse its config, or finds `window.gh.data` already set, it refuses to attach and logs a clear error to the console.

## Declarative attributes

The full attribute set:

- `data-gh-funnel` / `data-gh-destination` / `data-gh-product` — resource-binding root. Value is the resource slug.
- `data-field="<path>"` — write the resolved value into the element's `textContent` (never `innerHTML`). Dot-paths are supported; missing paths leave the placeholder.
- `data-format="<formatter>[:<args>]"` — apply a built-in or registered formatter (see below). Composes with `data-field` and inherits to `data-attr-*` bindings on the same element.
- `data-attr-<name>="<path>"` — write the resolved value into an attribute. Refused for `on*` (event handlers) and `srcdoc`. URL-bearing attributes pass through a `javascript:` / `vbscript:` / `data:` scheme block before the write.
- `data-attr-format-<name>="<formatter>[:<args>]"` — per-attribute formatter override. An empty value (`data-attr-format-foo=""`) short-circuits an inherited `data-format` on that one attribute.
- `data-with="<path>"` — narrow the binding scope for an element and its descendants. If the path resolves to `null` or `undefined`, the element hides cleanly.
- `data-when="loaded | loading | failed"` — show the element only when the closest resource ancestor is in that lifecycle state.
- `data-if="<path>"` — show the element only when the path resolves to a truthy value.
- `data-if-not="<path>"` — hide the element (and skip its subtree) when the path resolves to a truthy value. Inverse of `data-if`.
- `data-each="<path>"` on a `<template>` element — iterate over arrays; the SDK clones the template content per item with a scoped binding root.

All field values render through `textContent`, never `innerHTML`. Data can never inject markup, scripts, or styles. This is the single most important guarantee.

`on*` attribute bindings (`data-attr-onclick` and friends) and `data-attr-srcdoc` are silently ignored. URL-bearing attributes (`href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`, `manifest`) refuse `javascript:`, `vbscript:`, and `data:` schemes after browser-style whitespace/control-character normalization. These are all by design and are not bugs.

### Evaluation order

When multiple binding attributes appear on the same element, they evaluate in this fixed order:

1. Resource context attributes (`data-gh-product`, `data-gh-destination`, `data-gh-funnel`) — first to set; one wins per element.
2. `data-when` — cheap state check; if mismatched, the element hides and the subtree is skipped.
3. `data-with` — narrows scope; if the path doesn't resolve, the element hides.
4. `data-if` / `data-if-not` — evaluated against the narrowed scope.
5. `<template data-each>` — iterates; clones use the iteration item as their data context.
6. `data-field`, `data-attr-<name>` — field/attribute writes against the narrowed scope.
7. Recurse into children.

### Bookkeeping markers (stable CSS hooks)

The SDK writes a small set of attributes back into the DOM that authors can rely on as stable CSS hooks:

| Marker | Where | Meaning |
|---|---|---|
| `data-gh-hidden` | On any element the SDK has hidden via `data-if` / `data-if-not` / `data-when` / `data-with` | Lets CSS distinguish SDK-hidden elements from author-hidden ones. The element's `style.display` is also set to `none`. |
| `data-gh-prior-display` (dataset key `element.dataset.ghPriorDisplay`) | On the same hidden element | Preserves the pre-hide inline `display` value so unhide restores it. Only present when a non-`none` inline display was set before hiding. |
| `data-gh-loop-clone` | On every top-level element produced by `<template data-each>` | Lets CSS target loop items without changing markup. Also used internally to filter MutationObserver feedback loops. |

These markers are part of the contract — they will not change in a minor release.

## Formatters

Built-in formatters, applied via `data-format="<name>[:<arg1>[:<arg2>…]]"`. All formatters are non-throwing — malformed specs, unknown names, or unconvertible values fall back to `String(value)` (or `""` for `null`/`undefined`) so a single bad binding never breaks the rest of the page.

| Name | Signature | Notes |
|---|---|---|
| `currency` | `currency:<ISO-code>:<locale>` | Uses `Intl.NumberFormat` with `style: 'currency'`. Both args optional; default currency is USD. |
| `number` | `number:<decimals>:<locale>` | Locale-aware number formatting. Decimals fixes both min and max fraction digits. |
| `percent` | `percent:<decimals>:<locale>` | Value is interpreted as a fraction (`0.25` → `"25%"`). |
| `uppercase` | `uppercase` | `String(value).toUpperCase()`. |
| `lowercase` | `lowercase` | `String(value).toLowerCase()`. |
| `bool` | `bool:<truthy>:<falsy>` | Render one of two strings based on truthiness. Defaults are `'true'` and `'false'`. |
| `join` | `join:<separator>` | Joins arrays. Default separator is `", "`. |

Custom formatters can be registered via `window.gh.format.register(name, fn)`. Extra `:`-separated arguments arrive as **string** arguments — convert types inside the formatter.

`FormatRegistry` also exposes a typed surface used by both the declarative layer and direct callers:

- `register(name, fn)` — install a custom formatter.
- `has(name)` — introspection helper; returns `true` when a name is registered (built-in or custom).
- `apply(value, spec)` — entry point used by the declarative bindings. Accepts the full `"name[:arg1[:arg2…]]"` syntax and inherits all failure-mode behavior above.
- `currency(value, currency?, locale?)`, `number(value, decimals?, locale?)`, `percent(value, decimals?, locale?)` — typed convenience accessors for the three numeric built-ins.

## Programmatic API

Surface on `window.gh`:

- `window.gh.data.funnel(slug: string): Promise<HippoShopFunnelDTO>`
- `window.gh.data.destination(slug: string): Promise<HippoShopDestinationDTO>`
- `window.gh.data.product(slug: string): Promise<HippoShopProductDTO>` — resolves with the client-side-enriched product (`<tier>List` / `<tier>ByQuantity` sibling fields attached).
- `window.gh.bind(root?: Element | Document): Promise<void>` — manually trigger a binding pass against a subtree. Resolves after the post-fetch pass.
- `window.gh.refresh(): Promise<void>` — clear the resource cache and the lifecycle-state map, then rebind the document. Equivalent to `bind(document)` after a cache wipe.
- `window.gh.format` — the `FormatRegistry` for registering custom formatters and applying them programmatically.
- `window.gh.debug` — `true` when the SDK booted with `data-debug="true"`. Absent otherwise.

Errors thrown by the data methods are `GhError` instances with a typed `.code` (see "Error contract" below).

## Lifecycle events

Dispatched on `window`:

- **`gh:data-ready`** — fired once after the SDK has attached `window.gh.data` and is ready to accept calls, before the first bind pass. Payload: `Event` (no `detail`).
- **`gh:bindings-ready`** — fired once per page lifetime, after the initial bind pass (including all initial fetches) completes. Payload: `Event` (no `detail`).

The runtime additionally installs a `MutationObserver` after the initial bind so late-arriving content gets bound automatically. Mutation-driven rebinds are coalesced via a single microtask and do not re-fire `gh:bindings-ready`.

## Error contract

`GhError` is a public class extending `Error` with the following surface:

- `code: GhErrorCode` — typed discriminator (closed enum below).
- `retryAfterMs: number | null` — populated when the server response carried a parseable `Retry-After` header or an explicit `retryAfterMs` in the body. Most commonly set for `rate_limited`; may also be set on `server` (e.g. 503 with `Retry-After`). `null` otherwise.
- `cause: unknown` — optional underlying error (e.g. a fetch-level failure or a JSON-parse failure).
- `name === 'GhError'`.

`GhErrorCode` values:

| Code | When it fires |
|---|---|
| `not_found` | 404 from the API. Slug doesn't exist for your brand, or the brand isn't authorized to see it. The two cases are deliberately indistinguishable — you cannot enumerate resources you don't own. |
| `rate_limited` | 429 from the API. `retryAfterMs` is parsed from `Retry-After` (or an explicit body field) and exposed on the error. |
| `forbidden` | 401 or 403 from the API. Missing / invalid `data-key`, key/brand mismatch, or CORS / origin allow-list rejection. |
| `bad_request` | Other 4xx from the API. Malformed slug, unknown resource type, or a programmatic call with an empty argument. Rare for normal SDK callers and typically indicates an SDK-level bug. |
| `network` | Client-side fetch rejection before getting a response (DNS, offline, CORS preflight rejection that surfaces as a fetch error, etc.). |
| `bad_config` | Refusal at boot because the SDK config is invalid (missing / malformed `data-key`, missing `data-brand`, unrecognized API host, unparseable script `src`). Surfaces in the console, not as a rejected promise. |
| `server` | 5xx from the API, or a response whose body was not valid JSON. |

The server may supply an explicit `code` in the error response body; when present, it overrides the status-based mapping above.

## Advanced exports (stable but not recommended)

The package also exports these for advanced consumers building a custom auto-boot, instantiating the runtime inside a framework, or reusing utilities:

- `boot(doc?, win?): boolean` — entry point that returns whether it attached.
- `GhDataClient` — typed HTTP client class.
- `GhRuntime` — DOM-binding runtime class.
- `parseScriptConfig(script): GhConfig` — extracts config from a script element. Throws `ConfigError` on invalid input.
- `GhConfig` (type) — the parsed script-tag config shape (`key`, `brand`, `debug`, `apiBaseUrl`).
- `GhWindow` (interface) — the shape of `window.gh` after boot (`data`, `bind`, `refresh`, `format`, optional `debug`).
- `FormatRegistry`, `builtinFormatters` — formatter registry class plus the built-in set.
- `applyBindings`, `collectResources`, `ResourceState` — low-level binding primitives.
- `getByPath` — dot-path lookup utility.

These are versioned with the rest of the package but are not the recommended path. The `default` export is reserved.

## Deprecated surface

None in v3.0.0.

Historical note: pre-v3 SDK builds carried a client-side shim (`enrichProduct`) that built `*List` and `*ByQuantity` fields from legacy DTO arrays. v3 removed both the legacy DTO arrays and the shim — the SDK is now a thin pass-through for product responses.

## Stability

- Adding new attributes, formatters, lifecycle events, programmatic methods, or bookkeeping markers is a minor.
- Removing or narrowing any documented attribute, formatter, event, method, marker, or accepted script host is a major.
- Changing default behavior of an existing attribute or method is a major.
