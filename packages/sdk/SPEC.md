# `@goldenhippo/hippo-shop-sdk` — Contract

Browser SDK for reading Golden Hippo public data — funnels, destinations, products. Loads from a `<script>` tag and exposes two surfaces: declarative HTML bindings and a programmatic `window.gh` API.

What is documented here is what the SDK promises. Walkthroughs, recipes, and copy-paste examples live in [`README.md`](./README.md). Implementation details and internal modules are not part of the contract.

## Boot model

The SDK ships as an IIFE bundle (`gh.js`) intended to be loaded from a stable CDN URL:

```html
<script src="https://api-prod.goldenhippo.io/sdk/v4/gh.js"
        data-key="gh_pk_yourbrand_xxxxxx"
        data-brand="Your Brand"></script>
```

When the script evaluates, it locates its own `<script>` element (via `document.currentScript` or a fallback `[data-key][data-brand]` selector matching a `src` that ends in `/gh.js`), reads its `data-*` attributes, and attaches `window.gh`. Loading the SDK from any host outside the allowlist throws a config error and refuses to attach — the host is part of the contract.

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
- `data-gh-checkout="<destination-slug>"` — marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL. See [Checkout handoff](#checkout-handoff) for full details.
- `data-gh-step="<step-slug>"` — names the funnel step reported on the `Page View` funnel event. Accepted on any element **and** on the SDK `<script>` tag; a page element wins over the script tag. Read from the live DOM at emit time, never snapshotted at boot, so changing it is how a single-page app reports a new step. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
- `data-gh-funnel-id="<salesforce-id>"` — supplies the funnel's Salesforce ID directly, for pages that bind no destination. Ignored when a bound destination already yields one. Accepted on any element and on the SDK `<script>` tag. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).

Neither attribute participates in the [Evaluation order](#evaluation-order) list — they carry no binding scope and write nothing into the DOM.

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

## Session identity and inbound `?sessionid=`

### Resolution ladder

The SDK resolves exactly one session id per page load, in this order:

1. **`?sessionid=` on the current URL.** The key is matched **case-sensitively** — `?SessionId=` and `?SESSIONID=` are ignored. The value is trimmed and validated against `SESSION_ID_PATTERN`. On a pass it is adopted **even when the `hippo_session_id` cookie already holds a different value**, and written back to the cookie. On a fail the SDK logs a warning and falls through to step 2.
2. **The `hippo_session_id` cookie.** Used verbatim; not rewritten.
3. **A newly minted id** — `crypto.randomUUID()`, falling back to an RFC-4122 v4 assembled from `crypto.getRandomValues`. If neither is available the SDK throws rather than falling back to `Math.random()`.

```
SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
```

The charset is not incidental. An adopted value flows into a `document.cookie` write, into a query string on every outbound link, and into a server-side session key. `;`, `=`, `,`, and whitespace are excluded because consumers downstream write the value into `document.cookie` **unencoded**, where any of those characters would terminate the value and let the remainder be parsed as cookie attributes.

### Cookie contract

| Attribute | Value |
|---|---|
| Name | `hippo_session_id` |
| Value | The resolved session id |
| `Max-Age` | `2592000` (30 days) |
| `Path` | `/` |
| `Domain` | For a **minted** id: `data-cookie-domain` when set, else the auto-detected registrable root (`.brand.com`), else host-only. For an **adopted** id (from `?sessionid=`): always host-only — see below. |
| `SameSite` | `Lax` |
| `Secure` | Set when the page is `https:` |

The handoff between two hosts under one registrable domain (`sf.brand.com` → `www.brand.com`) works via the **URL** (`?sessionid=` on every outbound link), not the cookie — the resolution ladder puts the URL above the cookie for exactly this reason. Root-domain scoping on a *minted* id exists only for returning-visit continuity across subdomains within one brand.

That distinction is why an **adopted** id is persisted host-only: writing an adopted id root-domain-scoped would serve no purpose (the handoff doesn't need it) while pinning every subdomain of the brand to whichever session id one clicked link happened to carry, for the full 30-day `Max-Age`. A blocked or failed cookie write is non-fatal — the id still resolves for this page load and still travels on outbound links.

### The SDK trusts the inbound URL

**Adopting a session id supplied in a URL is session fixation, and it is intentional.** Anyone who can get a visitor to open a link of their choosing decides which session id that visitor's page load reports.

The blast radius is **analytics only**. The commerce session this id keys holds attribution — UTM values, click ids, affiliate and offer ids. It is not an authentication credential, it authorizes nothing, it carries no payment or cart state, and it is never accepted in place of a login. The realistic abuse is polluting attribution reporting, not taking over an account.

Three mitigations bound it, and all three are contract:

1. **`SESSION_ID_PATTERN`.** The value cannot carry cookie-attribute delimiters, control characters, or more than 128 characters, so it cannot break out of the cookie, the query string, or the session key it lands in.
2. **The adoption is logged in debug mode.** With `data-debug="true"` the SDK emits `[gh] session: adopting ?sessionid= handoff <id>` before the cookie write, and `[gh] session: ignoring malformed ?sessionid= handoff param` when validation rejects one. Either line names the mechanism in the console of the page that used it.
3. **This section.** The behaviour is published rather than implicit, so an integrator sees it before shipping.

The posture is scoped to the pilot. A durable rule — "a URL-supplied id wins at most once per id per browser" — needs persistent state the SDK has nowhere clean to keep, and is deferred rather than dismissed.

The resolved id is readable via `window.gh.session.id()` and is carried on `gh:session-ready` together with an `adopted` flag that is `true` exactly when step 1 supplied it — see [Lifecycle events](#lifecycle-events).

## Checkout handoff

### `data-gh-checkout="<destination-slug>"`

Marks the element as a checkout-handoff control. On `<a>` elements, the SDK populates `href` with the composed outbound checkout URL. On other elements (`<button>`, `<div>`, etc.), the SDK attaches a `click` handler that navigates the page to the composed URL.

**Base resolution — three sources, first one present wins:**

| Order | Source | When it applies |
|---|---|---|
| 1 | `destination.pricing.checkoutOverrideUrl` | Per-destination override on the DTO |
| 2 | `destination.url` | The destination's own absolute URL. The normal case |
| 3 | `data-checkout-base` on the script tag | Brand-level fallback for destinations Salesforce has no URL for |

**Appended parameters**, in this order, each omitted when its value is empty:

`order_form_id` (from `destination.pricing.orderFormId`), `sessionid` (the resolved session id — see [Session identity](#session-identity-and-inbound-sessionid)), `utm_source`, `utm_medium`, `utm_campaign`, `utm_campaign_id`, `utm_content`, `utm_term`, `utm_chat`, `utm_action`, `off_id`, `aff_id`, `subid1`, `subid2`, `subid3`, `subid4`, `subid5`, `landing_url`, `referral_url`, `sales_funnel`, the seven raw click-ids (`fbclid`, `gclid`, `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`), then `origmainFunnelIdOrig`, `origdsidOrig`, and `origsplitTestingFunnelIdOrig` forwarded verbatim from the current URL. `funnelSTPId` and `dsid` are deliberately never forwarded — the destination resolver re-mints `funnelSTPId` on every hop, so a forwarded value would be stale by the next page.

The key is `sessionid` — one word, lowercase, matching the inbound handoff key the SDK itself reads. Affiliate sub-ids are `subid1`–`subid5`, not `sub_id1`–`sub_id5`.

Pre-existing query keys on the base URL are preserved; SDK-added keys do not clobber author-supplied ones. Values are never truncated. If none of the three base sources yields a URL, the SDK sets `href="#"` on `[data-gh-checkout]` elements and logs a debug warning; `gh.checkoutUrl()` rejects with a `config` `GhError` instead (see [Error contract](#error-contract)).

### Script-tag attributes

- `data-checkout-base="https://checkout.brand.com"` — brand-level fallback base URL, source 3 of the ladder above. Required only if a page uses `[data-gh-checkout]` or `gh.checkoutUrl()` against destinations that carry neither a `checkoutOverrideUrl` nor a `url`. Optional otherwise.
- `data-cookie-domain=".brand.com"` — optional explicit `Domain` for the `hippo_session_id` cookie. When absent, the SDK auto-detects the registrable root via the safe-TLD allowlist: `com, net, org, io, app, dev, ai, co, us, store, shop`. Multi-part TLDs (`.co.uk`, `.com.au`, `.co.jp`) require this attribute; without it the cookie falls back to host-only and the cross-subdomain handoff stops working.
- `data-gh-step` / `data-gh-funnel-id` — also accepted on the script tag as page-wide defaults for funnel events. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).

### `window.gh.checkoutUrl(slug: string): Promise<string>`

Resolves with the composed checkout URL for the destination identified by `slug`, without navigating. It awaits session resolution and fetches the destination when it is not already cached, so it can never resolve with a URL whose `sessionid` or attribution is silently missing. Rejects with a `config` `GhError` when no base URL resolves, and with the usual data-layer `GhError` codes when the destination fetch fails.

**The function identity is stable.** Capturing the reference — `const buy = window.gh.checkoutUrl`, a GTM variable, a React prop — is supported. The function reads live session state through a thunk rather than closing over a snapshot, so a captured reference behaves identically to a fresh property read for the life of the page. This reverses the v3 rule and is one of the reasons v4 is a major.

**Awaiting inside a click handler breaks the user-gesture chain**, so `window.open(await window.gh.checkoutUrl(slug))` is popup-blocked in every major browser. Assign `window.location.href` instead, or resolve the URL before the click and keep the handler synchronous. The README carries the worked example.

### `window.gh.track(eventType: 'Page View'): Promise<void>`

Emits a funnel event programmatically, for single-page apps whose route change does not alter the DOM in a way the `MutationObserver` catches. `'Page View'` is the only accepted event type in v4; any other value rejects with `bad_request`.

It honours the same per-page-load dedupe guard as the automatic emit — keyed on the session id, the event type, and the step — so calling it without first changing `data-gh-step` is a deliberate no-op, not an error. Resolves (never rejects) when the event is dropped for a missing funnel ID. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).

### `window.gh.session.id(): string | undefined`

Returns the resolved session id — the value of the `hippo_session_id` cookie — or `undefined` before `gh:session-ready` fires.

### `window.gh.session.params(): ParsedParams | null`

Returns the attribution parsed from the landing URL for this visit. `null` only before session resolution settles; after `gh:session-ready` it is always an object, empty when the landing URL carried no attribution at all. It is **not** gated on the session POST succeeding — parsing is client-side.

### Event: `gh:session-ready`

Fires once on `window` after session resolution settles, on success **and** on swallowed failure. `event.detail` is `{ sessionId: string, adopted: boolean, params: ParsedParams }`:

| Field | Type | Meaning |
|---|---|---|
| `sessionId` | `string` | The resolved id. Always populated — the id resolves client-side, so a failed session POST does not blank it |
| `adopted` | `boolean` | `true` exactly when the id came from `?sessionid=` on this page load, i.e. step 1 of the [resolution ladder](#session-identity-and-inbound-sessionid) |
| `params` | `ParsedParams` | The attribution parsed from the landing URL. Never `null` on this event |

There is no `hasConnectSid` field. `connect.sid` is `httpOnly`, so the SDK could never observe it — see [Cookies managed by the SDK](#cookies-managed-by-the-sdk).

### Cookies managed by the SDK

The SDK writes exactly one cookie, `hippo_session_id`. Its full contract — name, attributes, scope, and the ladder that fills it — is in [Session identity and inbound `?sessionid=`](#session-identity-and-inbound-sessionid).

The SDK does **not** read, write, or reason about `connect.sid`. That cookie is `httpOnly` and belongs to the API, so `document.cookie` can never observe it; any logic conditioned on its presence is dead code by construction.

### Bookkeeping markers (stable CSS hooks)

The SDK writes a small set of attributes back into the DOM that authors can rely on as stable CSS hooks:

| Marker | Where | Meaning |
|---|---|---|
| `data-gh-hidden` | On any element the SDK has hidden via `data-if` / `data-if-not` / `data-when` / `data-with` | Lets CSS distinguish SDK-hidden elements from author-hidden ones. The element's `style.display` is also set to `none`. |
| `data-gh-prior-display` (dataset key `element.dataset.ghPriorDisplay`) | On the same hidden element | Preserves the pre-hide inline `display` value so unhide restores it. Only present when a non-`none` inline display was set before hiding. |
| `data-gh-loop-clone` | On every top-level element produced by `<template data-each>` | Lets CSS target loop items without changing markup. Also used internally to filter MutationObserver feedback loops. |

These markers are part of the contract — they will not change in a minor release.

## Write calls: session and funnel events

v4 makes two `POST`s. Both are fire-and-forget: a failure degrades attribution and never surfaces as a rejected promise to page code, and neither one blocks rendering or binding.

### `POST <base>/public/v1/session`

Registers this visit's attribution against the Commerce API's session. Sent once per page load, after the session id resolves.

| | |
|---|---|
| Body | `{ "affParameters": { …attribution, "sessionId": "<id>" } }` |
| Credentials | `credentials: 'include'` — the API maintains its own session cookie on this call |
| Empty values | **Omitted**, never sent as `""`. Every key present is treated as authoritative upstream, so a blank would erase stored attribution |
| Failure | Swallowed. `gh:session-ready` still fires with a resolved `sessionId` |

### `POST <base>/public/v1/funnel-event` — `Page View`

Exactly **one** `Page View` per page load, however many destinations the page binds. Six offers on a selector are six variants of one page view.

| | |
|---|---|
| Headers | `X-GH-Event-Id: <uuid>` correlation header, in addition to the standard `X-GH-Key` / `X-GH-Brand` |
| Transport | `keepalive: true`, so the event survives page unload |
| Retries | **None**, including on `429`. A rate-limited event is a lost event, not a delayed one |
| Credentials | Not sent. The body is self-sufficient for attribution |

**Identity is read from the live DOM at emit time**, not snapshotted at boot, with a URL-param fallback for pages that bind nothing. Precedence is **destination DTO → author attribute → URL param**:

| Source | Supplies |
|---|---|
| `data-gh-destination` / `data-gh-checkout` | The funnel and destination Salesforce IDs, out of the `HippoShopDestinationDTO` the page already fetched (`funnelId` and `id`). First match in document order wins, and `data-gh-destination` beats `data-gh-checkout` |
| `data-gh-step` | The funnel step slug. A page element wins over the SDK `<script>` tag |
| `data-gh-funnel-id` | The funnel Salesforce ID directly, for pages that bind no destination. Ignored when a bound destination already supplies one |
| `?origmainFunnelIdOrig=` | Fallback for `funnelSTFId` / `mainFunnelId` when neither a destination DTO nor `data-gh-funnel-id` supplies one. Minted by the `/fst` destination resolver and forwarded verbatim through later hops |
| `?origdsidOrig=`, else `?dsid=` | Fallback for `destinationId` when no destination DTO is cached |
| `?funnelSTPId=` | Fallback for `funnelSTPId` when no funnel-step DTO resolves. **Known-stale**: this URL param is minted once at the `/fst` hop as the funnel's step-1 id and never refreshed, so it never overrides a DTO-resolved step id — only fills the gap when there is no DTO at all |

All URL-param reads are **case-sensitive** (`URLSearchParams.get`, not the click-id table's case-insensitive lookup) — this matches both the funnel's own reader and the SDK's documented `?sessionid=` rule.

**No funnel ID, no event.** If neither a bound destination nor `data-gh-funnel-id` yields one, the event is dropped rather than sent with a blank ID — an event with a blank funnel ID is discarded upstream anyway. With `data-debug="true"` the drop is logged with its reason.

**Timing.** The event fires once session resolution and the first bind pass have both settled, plus a short quiet window so late-injected attributes land in the same event rather than producing a second one.

**Dedupe.** One guard per page load, keyed on session id + event type + step. It applies to the automatic emit and to [`gh.track`](#windowghtrackeventtype-page-view-promisevoid) alike, which is why changing `data-gh-step` is the precondition for a second event.

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
- `window.gh.checkoutUrl(slug: string): Promise<string>` — resolves with the composed checkout URL for the destination identified by `slug`, without navigating. Awaits session resolution and fetches the destination if needed. Rejects with a `config` `GhError` when no base URL resolves. The function identity is stable and safe to capture. See [Checkout handoff](#checkout-handoff).
- `window.gh.track(eventType: 'Page View'): Promise<void>` — emits a funnel event programmatically, subject to the per-page-load dedupe guard. See [Write calls: session and funnel events](#write-calls-session-and-funnel-events).
- `window.gh.session.id(): string | undefined` — returns the resolved session id (the `hippo_session_id` cookie value), or `undefined` before `gh:session-ready` fires.
- `window.gh.session.params(): ParsedParams | null` — returns the attribution parsed from the landing URL; `null` only before session resolution settles.
- `window.gh.debug` — `true` when the SDK booted with `data-debug="true"`. Absent otherwise.

Errors thrown by the data methods are `GhError` instances with a typed `.code` (see "Error contract" below).

## Lifecycle events

Dispatched on `window`:

- **`gh:data-ready`** — fired once after the SDK has attached `window.gh.data` and is ready to accept calls, before the first bind pass. Payload: `Event` (no `detail`).
- **`gh:bindings-ready`** — fired once per page lifetime, after the initial bind pass (including all initial fetches) completes. Payload: `Event` (no `detail`).
- **`gh:session-ready`** — fired once per page lifetime after session resolution settles (success or swallowed failure). Payload: `CustomEvent` with `detail: { sessionId: string, adopted: boolean, params: ParsedParams }`. `adopted` is `true` exactly when the id arrived via `?sessionid=`. This is the only point at which `window.gh.session.id()` is guaranteed to be populated, so it is the hook for page-owned analytics.

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
| `config` | Runtime configuration error — `gh.checkoutUrl()` or a `data-gh-checkout` binding cannot compose a URL because **none** of the three base sources resolved: the destination DTO has no `pricing.checkoutOverrideUrl`, no `url`, and the script tag has no `data-checkout-base`. `gh.checkoutUrl()` rejects with it; `[data-gh-checkout]` elements fall back to `href="#"` instead. |
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

None in v4.0.0. Two v3 surfaces were **removed** rather than deprecated, which is what makes v4 a major:

- `window.gh.checkoutUrl(slug): string` is now `Promise<string>`. A v3 caller that used the return value directly receives a `Promise` where it expected a string. The v3 closure-capture warning is also retired — the identity is stable now.
- The `sessionId` cookie is replaced by `hippo_session_id`. Nothing reads the old name, so a visitor carrying only the v3 cookie is treated as new on their first v4 page load.

Historical note: pre-v3 SDK builds carried a client-side shim (`enrichProduct`) that built `*List` and `*ByQuantity` fields from legacy DTO arrays. v3 removed both the legacy DTO arrays and the shim — the SDK is now a thin pass-through for product responses.

## Stability

- Adding new attributes, formatters, lifecycle events, programmatic methods, or bookkeeping markers is a minor.
- Removing or narrowing any documented attribute, formatter, event, method, marker, or accepted script host is a major.
- Changing default behavior of an existing attribute or method is a major.
