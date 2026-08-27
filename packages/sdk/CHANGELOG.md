# @goldenhippo/hippo-shop-sdk

## 4.3.0

### Minor Changes

- 1f24394: Add `data-params` and `data-param-map` for hardcoding and remapping attribution params.

  `data-params="subid2=superfunnel&subid3=quiz-a"` hardcodes attribution values onto the page; `data-param-map="sessionId=subid2&ref=subid3"` files an inbound URL param the SDK has no rule for under one it does send, matching the inbound key case-insensitively. Both are parsed as query strings, name params in their outbound spelling (`subid2`, not `subId2`), and apply to both consumers — `affParameters` on `POST /public/v1/session` and every outbound checkout link.

  Both fill a slot only when it is still empty, so the precedence ladder is: an explicit URL param, then the click-id table, then `data-param-map`, then `data-params`. Anything derived from the URL beats anything the script tag says, which means neither attribute can erase attribution — but also that a target of `subid1`/`subid4`/`subid5` loses on exactly the paid traffic where it would have mattered. `subid2` and `subid3` are the only slots the SDK never derives into and are the ones to reach for.

  A target the SDK does not send is dropped with a console warning rather than invented as a new param; a malformed attribute yields no pairs rather than refusing to boot.

## 4.2.0

### Minor Changes

- 3f796f1: Read `?sessionId=` case-insensitively, and add three toggles for pages where another system owns session identity.

  **Fixed: the inbound handoff param is now matched case-insensitively.** Superfunnel navigates to the offer selector with `?sessionId=` (camelCase); the SDK matched the key exactly, so it never adopted that id and minted a UUID of its own instead. The two systems then disagreed about who the visitor was for the whole session. `?sessionId=`, `?sessionid=` and `?SESSIONID=` are now all adopted. Where a URL carries the param more than once — Superfunnel appends its own to every link on the page — the first occurrence wins, matching the funnel and every other reader. Outbound checkout links still _write_ lowercase `sessionid`: the SDK reads liberally and writes exactly.

  New script-tag attributes, all optional and all defaulting to today's behaviour:
  - `data-session="off"` — disable session identity entirely: no `POST /public/v1/session`, no `hippo_session_id` cookie, no `sessionid=` on outbound links. Landing attribution is still parsed, so UTM and click-id params keep riding checkout links. Implies `data-events="off"`, because an event with no session id is unattributable.
  - `data-checkout-sessionid="off"` — stop writing `sessionid=` onto outbound checkout URLs while leaving the session, the cookie and funnel events fully working. Knowingly gives up SDK ownership of that param, so a foreign `sessionid` baked into a Salesforce destination record now survives; the warning still fires, with a message saying so.
  - `data-events="off"` — the `Page View`/`New Session` emitter is not installed and `gh.track()` becomes a no-op. It stays callable so existing page code does not start throwing.
  - `data-session-url-first="true"` — make `?sessionid=` outrank the `hippo_session_id` cookie. Off by default, since cookie-first is what stops an inbound link re-keying a returning visitor on every visit; turn it on only where another system owns visitor identity, such as Superfunnel-hosted pages, where a 30-day-old cookie must not beat the id Superfunnel just put on the URL.

  `data-session`, `data-checkout-sessionid` and `data-events` accept `"off"` and `"false"` interchangeably. Anything unrecognized leaves the feature on — a typo that silently disabled session tracking for a brand would return `200`s and surface only in a missing-revenue report.

## 4.1.2

### Patch Changes

- 4d52b24: Fix the custom-formatter example, which taught a registration pattern that silently does nothing on most pages.

  The example registered the formatter inside a `gh:data-ready` listener. That event is dispatched **synchronously from inside `boot()`**, while the SDK's own `<script>` is still executing — so it has already fired before any inline script placed below the SDK tag runs, and a listener added from there never fires at all. The formatter is never registered, `data-format` finds no such formatter, and the element renders the **raw** bound value. For a number that reads as a plausible result rather than as a bug: a savings field renders `105` where the page meant `44%`, with nothing in the console.

  Since the SDK is normally loaded in the `<head>` and page authors write markup and scripts in the `<body>`, the documented pattern failed in the common case. The README already described this hazard correctly under _Defensive "already booted?" pattern_, and already noted under _Inline-script timing_ that `gh.refresh()` is unnecessary before the first bind pass — but the canonical example contradicted both.

  The example now registers directly from an inline script after the SDK tag, with no listener and no `gh.refresh()`, and carries a note explaining when each is actually needed. Verified in a browser against a live destination: direct registration renders `44%`; the previous listener form renders `105`.

  Documentation only — no runtime or type changes. This release exists so the corrected README reaches npmjs.com, which renders the README captured at publish time.

## 4.1.1

### Patch Changes

- c96f42e: Fetch the funnel by id as well as by slug, so a page arriving with only `?origmainFunnelIdOrig=` resolves its step.

  `GET /public/v1/funnel/{funnelSlugOrId}` resolves both forms — the slug `ultimateh2_cms_osstart_260520_p` and the id `a0qQL00000KlmGzYAJ` return the same funnel. The SDK only treated the slug-shaped sources (`data-gh-funnel`, `?origuidOrig=`, `?uid=`) as lookup keys, so a page that knew its funnel's id but not its slug had no key at all: the funnel was never fetched, and step resolution fell through to whatever `?funnelSTPId=` happened to carry.

  That is the common case, not an edge one — the `/fst` hop mints `origmainFunnelIdOrig` on every real inbound link. Landing on `/order-form` with `?origmainFunnelIdOrig=<id>` now fetches the funnel and matches the `order-form` step by path segment, where before it emitted a Page View with a null `funnelSTPId` and made no funnel request at all.

  `data-gh-funnel-id` and `?origmainFunnelIdOrig=` are now lookup keys too, ranked below the slug-shaped sources. Funnel-identity precedence is unchanged.

## 4.1.0

### Minor Changes

- 93a6ade: Gate funnel events on declared funnel identity, add `New Session`, and carry session data in the event body.

  **Action required — a page that only binds destinations no longer emits a funnel event.** Funnel identity previously came from a bound destination's `funnelId`, which meant a selector page with twelve offers emitted a Page View attributed to whichever offer happened to be first in the DOM — on any navigation, including a typed URL. Identity now comes only from what the page or the inbound link actually asserts about the funnel: `data-gh-funnel-id`, then the funnel named by `data-gh-funnel` / `?origuidOrig=` / `?uid=`, then `?origmainFunnelIdOrig=`. To keep emitting from such a page, declare the funnel on it.

  **Action required — `HippoShopFunnelDTO` gains a required `id`.** The funnel's Salesforce id, needed as `funnelSTFId` / `mainFunnelId`. Without it a page could name its funnel by slug but never emit an event for it, because the upstream drops events whose `funnelSTFId` is blank.

  **Action required — the session-id resolution order is reversed.** It is now the `hippo_session_id` cookie, then `?sessionid=`, then a minted UUIDv4. A returning visitor keeps the session they already have; the param is honoured only when there is no cookie, which is how a new visitor arriving from Superfunnel adopts the id it minted. The reference funnel app ranks the param first only because its own `/cid` router already reconciles against the cookie server-side — a hop that does not exist here.

  **The session POST response is now authoritative.** When it returns a `sessionId` differing from the locally resolved one, the SDK adopts it and rewrites the cookie before `gh:session-ready` fires, so `gh.session.id()`, outbound `sessionid=` params, funnel events and the dedupe key all agree on the id the server actually has in force.

  **New event type `New Session`.** Same 36-field payload as `Page View`, only `eventType` differs. It fires once per page load when the session was established on that load and a funnel id resolved. On a cold load both events fire, in that order.

  **Funnel events now carry `affParams`.** The body is `{ ...event, affParams: <the session POST's response> }`. This is how attribution reaches the upstream without needing `connect.sid` on a cross-site request — which no browser would send today anyway, since that cookie is issued without `SameSite=None; Secure`.

  **Step resolution gained two tiers.** `data-gh-step` matched against the funnel's steps, then the current URL's last path segment with any file extension stripped, then `?funnelSTPId=`, then — when the funnel has exactly one step — that step. The single-step fallback is the supported way to model a pre-purchase funnel built elsewhere as one Salesforce funnel.

### Patch Changes

- Updated dependencies [93a6ade]
  - @goldenhippo/hippo-shop-types@4.1.0

## 4.0.1

### Patch Changes

- 2caf98e: Documentation corrections for v4. No runtime or type changes — this release exists so the corrected READMEs reach npmjs.com, which renders the README captured at publish time.

  **The version section is correct again.** The "About this version" section both package pages link to described v3 as the current release and showed a `/sdk/v3/gh.js` script tag. It now describes v4 and flags the two things that fail quietly for a new integrator: omitting `data-brand-token` mis-attributes every funnel event with a `200` and no log line, and `gh.checkoutUrl()` returns a promise, so `window.open(await …)` is popup-blocked.

  **SDK README**
  - Documented how an inbound click-id lands in the `subid` slots. `fbclid`, `gclid`, `ScCid`, `qclid`, `twclid` and `ndclid` write the click value to `subid1`; `wbraid` writes `subid4`; `ScCid`, `qclid`, `twclid` and `ndclid` additionally mark `subid5` with a platform name.
  - Corrected the outbound parameter precedence. Attribution parameters do not overwrite a value already on the destination's base URL, but `order_form_id` and `sessionid` are SDK-owned and always overwrite — which is what stops a pasted live funnel link from pinning every visitor to one session.
  - Added the `'config'` error code to the `GhErrorCode` union and the error reference. `gh.checkoutUrl()` rejects with it when a destination resolves no `checkoutOverrideUrl`, no `url`, and the script tag has no `data-checkout-base`.
  - Added `boot()` and the `GhWindow` interface to the barrel-export reference; both were already exported.
  - Fixed two table-of-contents links that did not resolve.

  **Types README**
  - Documented `HippoShopPricingDTO.checkoutOverrideUrl`. It is required as of 4.0.0 and was missing from both the `HippoShopDestinationDTO` example and the required-field table, so the example did not satisfy the type it illustrates. v4 adds five required keys across the DTOs, not four.

- Updated dependencies [2caf98e]
  - @goldenhippo/hippo-shop-types@4.0.1

## 4.0.0

### Major Changes

- ddc2e52: Cluster G (v4): Superfunnel.ai pilot — session handoff, funnel events, and
  destination links. A clean cut rather than a compatibility-preserving
  migration: there are no production consumers of the 3.x line, and several of
  its attribution behaviours were wrong.

  **Breaking**
  - `window.gh.checkoutUrl(slug)` is async: it returns `Promise<string>`, awaits
    session resolution, and fetches the destination if needed, so it can no
    longer hand back an unattributed URL. `window.open(await gh.checkoutUrl(x))`
    inside a click handler breaks the user-gesture chain and will be
    popup-blocked — assign `window.location.href` instead.
  - Outbound links emit `sessionid` (was `session_id`) and `subid1`…`subid5`
    (was `sub_id1`…`sub_id5`), plus `landing_url`, `referral_url`,
    `sales_funnel`, the seven raw click-ids, and `origdsidOrig` /
    `origsplitTestingFunnelIdOrig` forwarded from the current URL. A
    `?session_id=` handoff was silently ignored downstream, which showed up as
    duplicate sessions and orphaned attribution.
  - The session cookie is `hippo_session_id` (was `sessionId`) and its value is
    a UUID v4 (was a 12-character numeric string).
  - `?sessionid=` on the landing URL is validated and adopted over any existing
    cookie value.
  - The session POST body carries `affParameters.sessionId`, so the SDK's
    identifier and the server's `hippoSessionId` are the same value.
  - `connect.sid` is never read or reasoned about again — it is `httpOnly` and
    the gate that read it was dead code. `gh:session-ready` detail is
    `{ sessionId, adopted, params }`: `hasConnectSid` is gone and `params` is
    never `null`.
  - Click-id mapping is the canonical seven-row table (`fbclid`, `gclid`,
    `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`) with correct slot semantics.
    3.x wrote `subId1='fb'` and the click value into `subId5` — the two slots
    reversed, and a literal no platform ever emits. Values are no longer
    truncated at 255 characters.
  - Requires `@goldenhippo/hippo-shop-types@4.x`.
  - New major means a new CDN line: `/sdk/v4/gh.js`.

  **New**
  - `Page View` funnel events (the 36-field payload) posted to
    `/public/v1/funnel-event`, gated on a resolvable funnel id, deduped in
    memory per page load, sent with `keepalive: true`.
  - `data-gh-step` and `data-gh-funnel-id` attributes;
    `window.gh.track('Page View')` as the programmatic escape hatch.
  - `data-gh-checkout` resolves through `destination.url`, so binding an offer
    navigates the visitor to that destination with attribution attached.

  **Fixed — latent defects in the unreleased 3.x line**
  - `gh.checkoutUrl` is one stable function identity that reads the session
    through a thunk. It used to be installed as a stub with an empty session and
    then _reassigned_, so a captured reference (a GTM variable, a React prop,
    `const f = gh.checkoutUrl`) composed URLs with no `sessionid` and no UTMs
    for the life of the page — with no error anywhere.
  - The `gh:session-ready` rebind listener is registered before `ensureSession`
    is invoked, so a synchronously-resolved session still triggers a rebind.
  - `data-gh-checkout` slugs are collected as destination resources, both
    `data-gh-checkout` and `data-gh-step` are in the MutationObserver's
    `attributeFilter`, and a completed destination load schedules a rebind —
    checkout links no longer strand at `href="#"`.
  - `SPEC.md` named `/session` where the client posts `/public/v1/session`.

  See `docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`
  for the full design. Supersedes the unreleased Cluster F changeset for this
  package.

### Patch Changes

- ddc2e52: Fix: funnel-event identity (`resolveEventIdentity`) now falls back to the
  `/fst`-minted URL params Golden Hippo's ad-tracking flow actually carries,
  when neither a destination DTO nor an author `data-gh-*` attribute supplies
  a value.
  - `funnelId` (`funnelSTFId`/`mainFunnelId`) additionally falls back to
    `?origmainFunnelIdOrig=`.
  - `destinationId` additionally falls back to `?origdsidOrig=`, then `?dsid=`.
  - `funnelSTPId` additionally falls back to `?funnelSTPId=`, but **only** when
    no funnel-step DTO resolves one — that URL param is a one-time snapshot
    minted at the `/fst` hop as the funnel's step-1 id and never refreshed on
    later hops, so it must never outrank a live DTO lookup.
  - Precedence throughout is destination DTO → author attribute → URL param.
  - `origmainFunnelIdOrig` is now forwarded on outbound `data-gh-checkout` /
    `gh.checkoutUrl()` links, alongside the existing `origdsidOrig` /
    `origsplitTestingFunnelIdOrig` forwarding. `funnelSTPId` and `dsid` are
    deliberately never forwarded, since the destination resolver re-mints
    `funnelSTPId` per hop and a forwarded value would be stale on arrival.

  **Behavioural consequence — this is the point of the fix, not a side
  effect:** a page that binds no `data-gh-destination`/`data-gh-checkout` and
  sets no `data-gh-funnel-id`, but arrives from the real ad-tracking flow
  (`/cid` → `/fst`), previously dropped its `Page View` silently at the
  funnel-id gate. It now emits. Expect per-page and per-funnel emit counts to
  move upward as a result, particularly on pages like
  `drmarty-postpurchase`/`roundhouse-postpurchase` that carry the identity
  params but bind nothing.

- ddc2e52: Pre-release hardening found while reviewing Cluster G:
  - **Logging can no longer break the host page.** `createLogger` guarded against a stubbed, nulled, or removed `console`; `boot()`'s pre-logger failure reports guarded the same way. Previously a privacy tool that made `console.warn` throw could strand `ensureSession` (leaving every `data-gh-checkout` link at `href="#"`), leave an anchor on a stale offer URL, or surface an uncaught error from `boot()`.
  - **Blank attribute values no longer defeat funnel-event identity.** `firstDestinationSlug` and `readAttrPreferringPage` now skip empty values instead of collapsing a whole precedence tier — on a six-offer selector page the links kept working while identity silently degraded.
  - **The `hippo_session_id` cookie branch is validated** against the same charset pattern as the URL branch, and falls through to a fresh id when it fails.
  - **A dropped attribution POST now warns** instead of failing silently.
  - Bundle is ~276 B smaller gzip (dead IIFE exports epilogue and class-field lowering removed); the gzip budget is tightened to 11KB.

- Updated dependencies [ddc2e52]
  - @goldenhippo/hippo-shop-types@4.0.0

## 3.0.1

### Patch Changes

- de8be0f: Fix the script-tag fallback selector in `findScript()` so it works for every
  SDK major, not just v1. Previously the production-CDN selector hard-coded
  `[src*="/sdk/v1/gh"]`, which became stale after v3 moved to `/sdk/v3/gh.js`.

  In practice the bug was dormant because `document.currentScript` covers the
  hot path and the local-dev `[src$="/gh.js"]` fallback covers most server-side
  cases. It would only fire on a page where `document.currentScript` is null
  _and_ the SDK is served from a path the `/gh.js` suffix doesn't match.

  The selector now uses `[src*="/sdk/"]`, which matches any `/sdk/vN/`
  deployment. Test fixtures in `packages/sdk/test/{index,config}.spec.ts` are
  updated from `/sdk/v1/gh.js` to `/sdk/v3/gh.js` to match the current major.

  No runtime behavior change for existing callers.

## 3.0.0

### Major Changes

- b4f8dbb: **Breaking:** Removed the `enrichProduct` export. The SDK now expects the API to emit `<tier>List` and `<tier>ByQuantity` directly — there is no longer a client-side fallback that builds those fields from the legacy `variants.<purchase>.standard` / `.myAccount` arrays. `data-field` paths through the legacy arrays are no longer supported.

### Patch Changes

- Updated dependencies [b4f8dbb]
  - @goldenhippo/hippo-shop-types@3.0.0

## 2.1.1

### Patch Changes

- 6870806: Ship `llms.txt` and `llms-full.txt` alongside the SDK script. A build-time generator
  (`packages/sdk/scripts/build-llms.mjs`) reads `packages/sdk/README.md` and
  `packages/types/README.md` and writes two files into `dist/`:
  - `llms.txt` — curated index per [llmstxt.org](https://llmstxt.org), listing the canonical docs, npm packages, and source repo.
  - `llms-full.txt` — one-fetch concatenation of both READMEs with a provenance header, for LLMs that want a single download.

  After this release, both files are served at:
  - `https://api-prod.goldenhippo.io/sdk/v1/llms.txt`
  - `https://api-prod.goldenhippo.io/sdk/v1/llms-full.txt`

  No SDK runtime behavior changes.

## 2.1.0

### Minor Changes

- 79674ab: Add declarative miss-handling: `data-with` narrows the binding scope for a subtree
  and hides on missing path; `data-when="loaded|loading|failed"` shows elements based
  on the closest resource's lifecycle state. Together these let partners express
  loading skeletons, error fallbacks, and tight direct-lookup cards purely in HTML.

  The runtime now binds twice per pass: once with all unloaded resources marked
  `loading` (so skeletons show immediately), then again after fetches settle.
  `gh:bindings-ready` continues to fire once, after the post-fetch pass.

  Adds `ApplyBindingsOptions.resourceStates` and the `ResourceState` type to the SDK
  exports.

- 8411639: Add quantity-keyed variant access. Each `variants.<purchase>.<tier>` price level
  now has two sibling fields: `<tier>List` (iteration) and `<tier>ByQuantity`
  (record keyed by quantity).

  HTML bindings can use the new paths directly:

      data-field="variants.subscription.standardByQuantity.3.price"
      <template data-each="variants.subscription.standardList">

  JavaScript consumers can look up by quantity:

      product.variants.subscription.standardByQuantity['3']?.price

  The existing arrays (`variants.<purchase>.<tier>`) are deprecated and will be
  removed in v3.0.0. Missing quantities resolve to `undefined`; the existing
  `data-field` and `data-if` semantics handle that without changes.

  The new fields are derived client-side by the SDK from the existing array
  shape; the wire format from `/public/v1/product/:slug` is unchanged.

### Patch Changes

- Updated dependencies [8411639]
  - @goldenhippo/hippo-shop-types@2.1.0

## 2.0.0

### Major Changes

- 82411f5: Reshape the public DTOs to match real funnel/destination data.

  **Funnel**
  - Drop `entryUrl` from `HippoShopFunnelDTO`.
  - Drop `url` from `HippoShopFunnelStepDTO`.

  Funnels are identified by slug; the SDK is embedded on the partner page (which
  is the entry point), so canonical entry/step URLs have no consumer use.

  **Product**
  - Drop `category` from `HippoShopProductDTO`. Not every product has one — a
    required string was frequently a meaningless placeholder.
  - `HippoShopProductVariantDTO.rebillPrice`, `savings`, and
    `alternatePurchaseTypePrice` are now `number | null` instead of `number`.
    `null` carries the "doesn't apply here" signal (e.g. no rebill on a one-time
    variant, no savings to display) so consumers can branch cleanly rather than
    guarding against `0`.

  **Destination / pricing** — expanded to be landing-page-complete so a partner
  can render an offer card without a second call:
  - Drop `productSlug` from `HippoShopPricingDTO`. The source data has no public
    product slug — partners look the product family up via the new
    `familyOrBundleId`.
  - Replace `productId` with `orderFormId`. Checkout takes a list of order forms,
    so the cart-actionable identifier is the order-form Salesforce ID, not the
    SKU's SF ID.
  - Add `sku` (human-readable SKU code, used for analytics and identification).
  - Add `frequency: HippoShopFrequencyDTO | null` (subscription cadence; null for
    one-time).
  - Add `outOfStock: boolean`.
  - Add `restrictedCountryCodes: string[]` (ISO-3166-1 alpha-2 codes blocked from
    purchase).
  - Add `shipping: HippoShopShippingDTO` — `{ domestic, international,
freeShippingThreshold }`.
  - Add `bumpOffers: HippoShopBumpOfferDTO[]` — empty array when none configured.
    Each bump carries `familyOrBundleId`, `orderFormId`, `sku`, `productName`,
    `unitOfMeasure`, `quantity`, `price`, `outOfStock`, and
    `restrictedCountryCodes`.

  **New exported types:** `HippoShopShippingDTO`, `HippoShopBumpOfferDTO`.

### Patch Changes

- Updated dependencies [82411f5]
  - @goldenhippo/hippo-shop-types@2.0.0

## 1.1.1

### Patch Changes

- ab4a3e0: Widen `KEY_PATTERN` to allow `-` in the consumer/brand portion of `data-key`
  (`/^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/`). This lets multi-word brand slugs stay
  scannable (e.g. `gh_pk_internal_beverly-hills-md_<hex>`) and keeps the
  structural `_` separator unambiguous between consumer and brand fields.

  Backwards-compatible: every key that matched the previous pattern still
  matches. The error message was updated to reflect the new shape.

## 1.1.0

### Minor Changes

- bf93fe3: Send the publishable key as the dedicated `X-GH-Key` request header instead
  of `Authorization: Bearer <key>`. The previous Bearer shape did not fit
  Kong's `key-auth` plugin natively (which does an exact-value match against
  the configured header), so the gateway either had to store keys with a
  `Bearer ` prefix baked in or run a custom Lua plugin to strip the scheme.
  Moving to a dedicated header lets Kong validate keys with default
  configuration and keeps the `Authorization` header free for other purposes.

  The wire contract is partner-facing only via `data-key` on the `<script>`
  tag — no partner has to change anything. Internal callers using `curl` or
  custom integrations must swap `-H "Authorization: Bearer gh_pk_…"` for
  `-H "X-GH-Key: gh_pk_…"`.

### Patch Changes

- bcf9144: Reject `javascript:`, `vbscript:`, and `data:` schemes on URL-bearing
  `data-attr-*` bindings (`href`, `src`, `action`, `formaction`, `xlink:href`,
  `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`,
  `manifest`) and refuse to bind `data-attr-srcdoc` entirely. The SDK
  previously only blocked `on*` attribute names. This is defense-in-depth: a
  script-bearing string surfacing in the public JSON feed would otherwise
  execute in the partner page's origin when the element is activated.
  Normalization mirrors browser URL-parser behavior (strips leading ASCII
  whitespace/control bytes and embedded tab/LF/CR in the scheme prefix), so
  common obfuscations like `java\tscript:` are still caught.

## 1.0.1

### Patch Changes

- fe00224: Refresh README for npm package pages: add install commands, license badge, repository cross-links, and SLSA provenance section. No code changes — package metadata now declares the source repository (`repository` field), which is required for provenance verification.
- Updated dependencies [fe00224]
  - @goldenhippo/hippo-shop-types@1.0.1
