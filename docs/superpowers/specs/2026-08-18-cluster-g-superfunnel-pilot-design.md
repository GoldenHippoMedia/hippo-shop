# Cluster G — Superfunnel.ai pilot: session handoff, funnel events, destination links

**Status:** Design approved, awaiting implementation plan
**Date:** 2026-08-18
**Cluster:** G (see [`/ROADMAP.md`](../../../ROADMAP.md))
**Branches:**
- `hippo-shop`: `feat/cluster-g-superfunnel-pilot` (off `main`)
- `GH-Commerce-Service`: `feat/cluster-g-hippo-shop-session-destination-url` (off `prerelease`)
- Kong: owned by Steven, specified here as parallel work

## Background

Golden Hippo is piloting [Superfunnel.ai](https://superfunnel.ai) as a funnel-building tool. Superfunnel hosts pages on a **subdomain of the brand's root domain** (e.g. `sf.gundrymd.com`) and embeds the Hippo Shop SDK. For the pilot to work, the SDK must participate in Golden Hippo's existing session and attribution model rather than inventing its own.

Cluster F (shipped 2026-05-19, PR #17) built a first cut of this: a `sessionId` cookie, UTM parsing, a POST to `/public/v1/session`, and `data-gh-checkout` handoff. It was written without access to the canonical implementation. Cluster F's own spec says of the click-id table: "The mapping registry is structured so adding more ships as a one-entry edit **once the canonical table is provided**."

The canonical table has now been read directly from `hippo-builder-funnel` (the Angular CMS funnel app at `~/Code/hippo-frontend/hippo-builder-funnel`), along with the rest of the session, attribution, and event contracts. **Cluster F guessed several of them wrong.** Cluster G corrects those, aligns the SDK with the reference implementation, and adds what the pilot needs on top.

The pilot's canonical page is an **offer selector**: six destinations bound to the available choices (quantity 1/3/6 × one-time/subscription), where selecting one navigates the current page to that destination's URL. That shape drives several decisions below — the single link composer (D7), the async accessor (D8), and the per-page-load request fan-out that Kong has to absorb (W3).

The SDK has **no production consumers yet**. Breaking changes are therefore free, and Cluster G ships as **v4** — a clean cut rather than a compatibility-preserving migration.

### What recon established

Three codebases were surveyed: `hippo-shop`, `hippo-builder-funnel`, and `GH-Commerce-Service` (branch `prerelease`).

**The API already accepts a client-supplied session id.** `GH-Commerce-Service/src/App.ts:202-211` is a global middleware that lifts `req.body.affParameters.sessionId` into `res.locals.sessionId`; `Session.service.ts:35-60` writes it to `req.session[brand].hippoSessionId`. The field is nested inside `affParameters` — not top-level, not a header. There is **no format validation anywhere** in the service or in `gh-service-utils`, so a UUID is accepted as readily as the legacy formats.

**The SDK never sends it.** `session.ts:100` posts `{ affParameters: params }`, and `ParsedParams` (`url-params.ts:16-35`) has no `sessionId` field. So the SDK mints a cookie id, the server independently mints `hippoSessionId`, and `checkout.ts:68` stamps the SDK's id onto outbound URLs. Two identifiers for one visitor, joined by nothing. This is a live attribution defect in shipped code, independent of the pilot.

**The `connect.sid` gate is dead code.** `gh-service-utils@1.11.2` constructs express-session with `cookie: { maxAge, path }` only, so express-session's default `httpOnly: true` applies. `document.cookie` can never see `connect.sid`, so `session.ts:71` always reads `undefined`, `hasConnectSid` is always `false`, and the POST already fires on every page load. The "returning visitor skips the POST and loses all attribution" branch at `session.ts:86-91` never executes.

**`api-prod.goldenhippo.io` can never set a cookie at `.brandsite.com`.** Browsers reject `Set-Cookie` whose `Domain` does not domain-match the responding host. Cross-subdomain session continuity is therefore satisfiable only by the SDK's own first-party cookie plus the URL parameter — never by `connect.sid`.

**The public route is not where the docs say.** `HippoShopController.basePath = 'hippo-shop'`, serving `/hippo-shop/v1/*`, while the SDK calls `/public/v1/*` and works in UAT. A URI rewrite exists at the edge that `docs/architecture/kong-public-routing.md` does not describe. That doc needs reconciling; the rewrite mechanism being already in production lowers the cost of adding new routes.

**`feat/public-sdk` is stale.** It was squash-merged to `prerelease` as `afbd897`, and still pins `@goldenhippo/hippo-shop-types@^2.1.0`. `prerelease` is authoritative; ignore that branch.

**All the Salesforce IDs a funnel event needs are already in hand.** `ZDestination` (`hippo-salesforce-service/dist/index.d.ts:8403-8425`) carries `id`, `defaultFunnel.id`, and `defaultFunnel.steps[].id`. `formatDestinationToDTO` fetches all of it and drops it.

## Goals

1. **Adopt an inbound session id.** Read `?sessionid=` from the landing URL, validate it, adopt it over any existing cookie, and persist it at the brand root domain.
2. **Align session identity with the reference implementation** — `hippo_session_id` cookie, `crypto.randomUUID()` generation.
3. **Send the session id to the API** inside `affParameters`, so the SDK's identifier and the server's `hippoSessionId` are the same value.
4. **Correct the attribution model** to match `hippo-builder-funnel` exactly: the full seven-entry click-id table with correct slot semantics, the seven raw click-id fields, canonical `subidN` param spelling, and no value truncation.
5. **Emit `Page View` funnel events** to Altern through a Kong-fronted route, using the 36-field payload shape.
6. **Expose a destination's absolute URL** — new DTO field, produced by the commerce service, resolved by the single link composer so that binding an offer to `data-gh-checkout` navigates to that destination with the correct parameters attached.
7. **Correct outbound link composition** to funnel-canonical parameter names so the handoff actually stitches.
8. **Every failure mode stays non-fatal.** Attribution may degrade; the page never breaks.

## Non-goals

- **No Alternai / visitor identity.** `visitorId` is sent as `null` in funnel events and is not exposed on the SDK surface. Alternai is not meaningfully in use.
- **No first-touch / last-touch persistence.** The funnel app maintains `hippo_ft` (localStorage) and `hippo_lt` (cookie). The SDK does not. A second page view with no query params carries no attribution. Deferred; noted as a divergence.
- **No Salesforce managed-package change.** The destination URL is retrieved by the commerce service via a direct SOQL query as an interim measure. The durable fix — a field on the Destination sObject surfaced through SF Base → `hippo-salesforce-service` → `hippo-shop-types` → commerce — is a later cluster.
- **No SPA history patching by default.** The SDK will not monkey-patch `history.pushState` on a third-party-hosted page. Route-change re-emission is available via an attribute-driven path and a programmatic escape hatch.
- **No retry on funnel-event or session POST failure.** Fire-and-forget, matching the reference implementation. Notably, the SDK must **not** retry on 429.
- **No consent gating.** Unchanged from Cluster F's reasoning.

## Decisions

### D1 — Session resolution ladder

Mirrors `hippo-builder-funnel/src/app/core/services/hippo-api/session.service.ts:54-93`:

1. **`?sessionid=`** — exact lowercase key, read **case-sensitively** to match the reference (`session.service.ts:85`). Validate against `/^[A-Za-z0-9._-]{1,128}$/` (`session.service.ts:23`). On pass, adopt it and write it to the cookie **even when a different cookie value already exists**. On fail, `logger.warn` and fall through.
2. **`hippo_session_id` cookie.**
3. **Mint** via `crypto.randomUUID()`, with the RFC-4122 v4 `getRandomValues` fallback, and throw if neither is available — no `Math.random()` path (`session.service.ts:164-184`).

The validation regex is not optional. The adopted value flows into a cookie write, a query string, and a server-side session key; its charset deliberately excludes `;`, `=`, `,`, and whitespace because the funnel writes it into `document.cookie` unencoded.

**Accepting a URL-supplied session id is session fixation by design.** For this pilot the blast radius is analytics, not authentication or payment — the commerce session holds attribution only. The mitigations are the regex, a debug-mode log line on adoption, and an explicit note in `packages/sdk/SPEC.md` that the SDK trusts the inbound URL.

### D2 — Cookie: `hippo_session_id`, root-domain scoped

Name `hippo_session_id`, `Max-Age` 30 days, `Path=/`, `SameSite=Lax`, `Secure` on https, and `Domain` resolved to the registrable root (`.gundrymd.com`) by the existing `getCookieDomain` (`cookies.ts:42-59`), with `data-cookie-domain` as the explicit override for multi-part TLDs.

**This deliberately diverges from the reference implementation, which writes the cookie host-only** (`cookie.service.ts:77-94`; the funnel's own server comments note "NO Domain"). Root scoping is what makes the `sf.brand.com` → `www.brand.com` handoff work without relying on the URL.

The divergence creates a real hazard: same cookie name, two scopes, two cookies, and `document.cookie` ordering is unspecified, so the funnel's `startsWith` parse could latch onto either. **It is benign only because the funnel's own ladder puts the URL parameter above the cookie.** As long as every outbound link carries `sessionid`, the funnel adopts our value regardless of cookie confusion. This makes "always emit `sessionid` on outbound links" load-bearing rather than a nicety, and it is why D6 is not optional.

### D3 — Attribution model corrections

The click-id registry is replaced wholesale with the canonical table from `hippo-builder-funnel/src/server/cid/click-id-normalizer.ts:35-43`:

| Inbound param | Writes | Also sets `subId5` |
|---|---|---|
| `fbclid` | `subId1` = raw value | — |
| `gclid` | `subId1` = raw value | — |
| `ScCid` | `subId1` = raw value | `snap` |
| `qclid` | `subId1` = raw value | `quora` |
| `twclid` | `subId1` = raw value | `twitter` |
| `ndclid` | `subId1` = raw value | `nextdoor` |
| `wbraid` | `subId4` = `wbraid:<value>` | — |

Rules: table order is precedence (the first matching row claims `subId1`); an already-present `subId1`/`subId4` is never overwritten; `subId5` is set only when unset; empty values are skipped.

**Each row's slot write and its `subId5` marker are evaluated independently.** A row whose `subId1`/`subId4` slot is already taken still applies its `subId5` marker if `subId5` is unset. Given `?fbclid=F&ScCid=S`, the result is `subId1='F'` (fbclid wins the slot by table order) **and** `subId5='snap'` (the ScCid row's marker still lands). Cross-tagged links carrying multiple click-ids are routine, so this is a common path, and getting it backwards produces a plausible-looking wrong marker. Required test cases: `fbclid`+`ScCid` and `gclid`+`wbraid`.

**Cluster F had this inverted.** It shipped `fbclid → subId1='fb', subId5=<value>` — the value and marker slots reversed, writing a literal `'fb'` that the platform never emits. This is silent data corruption, not a visible failure.

Further corrections:

- **Add the seven raw click-id fields** (`fbclid`, `gclid`, `scCid`, `qclid`, `twclid`, `ndclid`, `wbraid`) alongside the derived sub-ids, per `session.model.ts:22-30`. Note the mixed-case `scCid`.
- **Drop the 255-character truncation** (`url-params.ts:12`, `:79-83`). Real `fbclid` and `landing_url` values exceed it, and a truncated value will not match what the funnel stored for the same click. The reference implementation caps nothing.
- **Keep control-character stripping** — defensible hardening the funnel lacks, and it matters more here because the funnel writes cookie values unencoded.
- **Add the `[<>'"`&]` strip** on click-id-derived sub-id values, matching `click-id-normalizer.ts:45-50`.
- **Inbound sub-id spelling:** accept both `subidN` (canonical) and `sub_idN` (legacy), canonical winning. Liberal inbound is free and protects against media-buyer variance. Outbound emits canonical only.
- **Keep case-insensitive inbound key matching.** It is a safe superset of the funnel's client parser and matches the funnel's server normalizer.
- **`landingUrl`** = `?landing_url=` when present, else `location.href` truncated at the first `?` (`session.service.ts:133`, `:145`).
- **`referralUrl`** = `?referral_url=` when present, **and omitted entirely otherwise** (`session.service.ts:138`, `:143` — a spread guard, so the key is absent rather than empty). Cluster F's `document.referrer` fallback (`url-params.ts:95`) is **removed from the session POST body**. The reference never derives this field from `document.referrer` on this path; its only referrer-derived `referralUrl` is in the funnel-event payload (`funnel-event.service.ts:176-180`), a different call with a different shape.

  Keeping the fallback would be actively harmful, not merely divergent. `affParameters` is destructive-on-write and D4 posts on every page load, so on the second page view `document.referrer` is the *previous internal page* — and the POST would overwrite the true ad referrer that the reference captured server-side (`cid/router.ts:186-189` sets `referral_url` from the raw `Referer` header). That is precisely the class of silent attribution corruption Cluster G exists to fix.
- **Empty values are omitted, never sent as `""`.** The `affParameters` contract is destructive-on-write: the backend treats every key present as authoritative, so `utmSource: ''` blanks a real stored value (`analytics-and-attribution.md:147-149`).

### D4 — Always POST, and carry the session id

Delete the `connect.sid` gate (`session.ts:86-91`) entirely. Never read, write, or reason about that cookie again — it is `httpOnly` and belongs to the API.

POST once per page load, idempotent via the existing module-level cache. Body:

```json
{ "affParameters": { "...attribution": "...", "sessionId": "<resolved id>" } }
```

`sessionId` nested inside `affParameters`, omitted entirely when absent — never `""`.

Do **not** adopt a server-returned session id; the reference implementation does not (`HippoSession` declares no `sessionId` field). Do not read `visitorId` — see non-goals.

This is not a behavioural change in practice: the gate is already dead code and the POST already fires per page load. Cluster G makes the code honest about what it does.

### D5 — Funnel event identity via the destination DTO

A `Page View` event is a 36-field payload (`build-funnel-event.utility.ts:14-63`). The SDK cannot supply `funnelSTFId`/`mainFunnelId`, `funnelSTPId`, or `destinationId` — our DTOs are deliberately slug-keyed. And this is not a soft failure: **the reference implementation silently drops the event when `funnelSTFId` is blank** (`funnel-event.service.ts:82`), with no log at all.

Because `ZDestination` already carries every one of those IDs and the serializer discards them, the fix is a pass-through:

```ts
HippoShopDestinationDTO:   id: string;  funnelId: string;
HippoShopFunnelStepDTO:    id: string;
```

Any page that binds `data-gh-destination` — which it already does for checkout — yields full identity from a fetch it was already making.

**Exactly one `Page View` is emitted per page load, regardless of how many destinations the page binds.** The canonical offer selector binds six, so this must be stated rather than inferred: identity is taken from the **first `[data-gh-destination]` in document order**, falling back to the first `[data-gh-checkout]`, then to an explicit `data-gh-funnel-id`. Six bound offers are six variants of one page view, not six page views.

Step identity comes from `data-gh-step="<step-slug>"`, which populates `url` (that field is a **step slug**, not a URL — `funnel-event.service.ts:172-174`) and, once step ids resolve, `funnelSTPId`. It is read **from the DOM at emit time** — `document.querySelector('[data-gh-step]')`, first in document order — falling back to the value on the script tag. It is deliberately *not* a `parseScriptConfig` field: `GhConfig` is an immutable boot-time snapshot, so an observer-driven re-emit (D9) can only work against a live DOM read. An explicit `data-gh-funnel-id` remains available for pages that bind no destination.

**Emission is gated the same way the reference gates it — no `funnelSTFId`, no event — but with a `logger.warn` in debug mode.** The silent drop is the one behaviour from the reference worth not copying.

#### The 36 fields

Verbatim from `build-funnel-event.utility.ts:14-63` (interface) and `:102-150` (base construction). "Source" is the SDK expression; "absent" is the value when the source yields nothing. `Page View` takes the no-override branch (`:166-171`), so every value below is the base default — there is no event-specific branch logic to port.

| Field | Source | Absent |
|---|---|---|
| `funnelSTFId` | destination DTO `funnelId`, else `data-gh-funnel-id` | **gate — do not emit** |
| `mainFunnelId` | same value as `funnelSTFId` | same |
| `destinationId` | destination DTO `id`, else `?origdsidOrig=` | `null` |
| `funnelSTPId` | funnel-step DTO `id` matched by `data-gh-step` | `null` |
| `splitTestingFunnelId` | `?origsplitTestingFunnelIdOrig=` | `null` |
| `splitTestingPageId` | — | `null` (constant) |
| `url` | `data-gh-step` (a **step slug**, not a URL) | `null` — note `\|\|` collapses `''` to `null` |
| `eventType` | literal `'Page View'` | n/a — hardcode, never build from a variable |
| `sessionId` | resolved session id (D1) | n/a — gated on session resolution |
| `orderId` | — | `null` (constant) |
| `customPayLoad1` | — | `null` (constant) |
| `customPayLoad2` | — | `null` (constant) |
| `utmSource` | `ParsedParams.utmSource` | `null` |
| `utmMedium` | `ParsedParams.utmMedium` | `null` |
| `utmCampaign` | `ParsedParams.utmCampaign` | `null` |
| `utmCampaignId` | `?cid=` if present, else `ParsedParams.utmCampaignId` | `null` |
| `utmContent` | `ParsedParams.utmContent` | `null` |
| `utmTerm` | `ParsedParams.utmTerm` | `null` |
| `affId` | `ParsedParams.affId` | **`''`** |
| `offId` | `ParsedParams.offId` | **`''`** |
| `subId1`…`subId5` | `ParsedParams.subId1..5` | `null` |
| `salesFunnel` | literal `'Funnel'` | n/a — constant, **not** `ParsedParams.salesFunnel` |
| `visitorId` | — | `null` (constant; Alternai is a non-goal) |
| `visitDate` | `formatVisitDate()` | n/a |
| `videoPercentage` | — | `0` (constant) |
| `leadId` | — | `null` (constant) |
| `accountId` | — | `null` (constant) |
| `referralUrl` | `document.referrer` query-stripped (`funnel-event.service.ts:176-180`) | `''` |
| `brand` | see the brand-token note below | n/a |
| `browser` | ported UA detection | n/a |
| `os` | ported UA detection | `null` |
| `device` | ported UA detection | `'Mobile' \| 'Desktop'` — never null |

Three name collisions with `ParsedParams` are traps: `salesFunnel` here is the hardcoded literal `'Funnel'`, **not** the parsed `sales_funnel` value; `url` is a step slug, not a URL; and `referralUrl` here **is** derived from `document.referrer` — the opposite of the session POST rule in D3, because these are different payloads. Do not share a single mapper between them.

Three details that are silent-corruption risks if approximated:

**No validation exists anywhere on this path.** The funnel's Express proxy forwards the body verbatim; rejection happens in Salesforce Postgres triggers that drop unrecognised input silently. A 200 through the whole chain is not evidence the row landed. Reconciling emit counts against actual Salesforce rows in UAT is the only test that proves the contract, and it is a required acceptance step.

### D6 — Outbound link composition

Parameter order, replacing `checkout.ts:22-38`:

`order_form_id`, `sessionid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_campaign_id`, `utm_content`, `utm_term`, `utm_chat`, `utm_action`, `off_id`, `aff_id`, `subid1`…`subid5`, `landing_url`, `referral_url`, `sales_funnel`, the seven raw click-ids, then `origdsidOrig` and `origsplitTestingFunnelIdOrig` forwarded verbatim when present in the current URL.

**`session_id` becomes `sessionid` and `sub_idN` becomes `subidN`.** The reference reads `sessionid` case-sensitively (`session.service.ts:85`); `session_id` appears nowhere in that repository, so a `?session_id=` handoff is silently ignored and the funnel mints a fresh session — visible downstream as duplicate sessions and orphaned attribution.

`setIfAbsent` semantics are retained: parameters already present on the base URL win. This is the opposite of `/cid`'s merge rule, where the incoming request wins (`translate-params.ts:56-58`), but these are different hops and the author-supplied override is the right behaviour for a page-authored base URL.

### D7 — Destination URL on the DTO root, and one link composer

```ts
export interface HippoShopDestinationDTO {
  /** Absolute landing URL for this destination. Null when Salesforce has none. */
  url: string | null;
}
```

On the root, not on `pricing` — it is a property of the destination, not of its pricing.

**The canonical page shape is an offer selector**: six destinations bound to the available choices (quantity 1/3/6 × one-time/subscription), and selecting one navigates to that destination's URL. So the destination URL *is* the checkout navigation target, not a separate concept from it. Cluster F's `checkoutOverrideUrl ?? checkoutBase` was a guess at this target made before the field existed.

Therefore there is **one composer and one attribute**, not two. Resolution order:

```
destination.pricing.checkoutOverrideUrl   // per-destination override, if ever set
  ?? destination.url                      // the normal case
  ?? config.checkoutBase                  // brand-level fallback from data-checkout-base
```

`data-gh-checkout="<slug>"` keeps its name — it is the semantically accurate one for "this element sends the visitor to buy this offer" — and `await gh.checkoutUrl(slug)` remains its programmatic twin. No `data-gh-destination-link` attribute and no separate `gh.destinationUrl()` accessor are introduced; two names for one act is the kind of thing that reads fine in a pilot and becomes unfixable at ten brands.

### D8 — `gh.checkoutUrl` becomes async

Today it is synchronous and throws `GhError('not_found')` when the destination is not already cached (`checkout.ts:190-197`), since `getCachedDestination` is a plain Map lookup (`runtime.ts:192-194`). On a cold page that throw is the common case, and a third-party integrator must catch, subscribe to `gh:bindings-ready`, and retry.

Both accessors become async. Combined with the `collectResources` pre-warm fix (see "Corrections"), any destination declared in markup is fetched during the first bind pass, so the cold path largely disappears.

**Known cost:** `window.open(await gh.checkoutUrl(x))` inside a click handler breaks the user-gesture chain and will be popup-blocked. `window.location.href = url` is unaffected.

This cost is accepted rather than mitigated: checkout in a new tab is explicitly not a pattern Golden Hippo uses. The offer-selector flow navigates the current page on selection, which works correctly after an `await`. The constraint is documented in the SDK README so the one team that ever wants a new tab knows to resolve and stash the URL ahead of the click.

### D9 — Funnel-event timing and dedupe

A fixed `setTimeout` races: `ensureSession` can resolve synchronously (so `gh:session-ready` may fire before `DOMContentLoaded`), while a cold POST can take 800ms. Instead, join on:

- `gh:session-ready` (fires on success **and** on swallowed failure, `session.ts:99-110` — the structural analogue of the funnel's `sessionApiReady()`),
- `gh:bindings-ready` (`runtime.ts:94-97`),
- destination resolution when identity comes from a destination binding,

then wait a ~100ms quiet window so late-injected attributes land in the same event rather than a second one, capped by a hard ~2s deadline. On deadline, emit with whatever resolved — or drop per the D5 gate.

**The emitter must live outside `bind()`.** `bind()` re-runs on every observer-triggered mutation (`runtime.ts:154-163`) and again on `gh:session-ready` (`runtime.ts:219-227`).

**Dedupe is in-memory, per page load**, keyed on `(sessionId, eventType, stepKey)` where `stepKey` is the step slug when declared and **`location.pathname`** otherwise. The fallback is deliberately page-level, not the destination slug — keying on the destination would produce six distinct keys on an offer-selector page and defeat the one-event-per-load rule above. Deliberately **not** sessionStorage: the reference's Page View dedupe is an instance field with no persistent marker (`emission-driver.service.ts:61`, `:131-132`), while its conversion events *do* use sessionStorage markers — so the omission is a choice, not an oversight. A persistent marker here would make Superfunnel pages systematically under-report against funnel pages for identical traffic. The guard lives on a window global, not module scope, since two SDK bundles can coexist (`index.ts:67-70` only refuses to overwrite `window.gh.data`).

A correlation id rides as an `X-GH-Event-Id: <uuid>` header, not in the body — the 36-field shape is matched byte-for-byte upstream and unrecognised keys are at best ignored.

SPA route changes: `data-gh-step` is added to the MutationObserver `attributeFilter`, so an SPA that swaps the attribute gets a new Page View through existing machinery. `gh.track(eventType: 'Page View'): Promise<void>` is the programmatic escape hatch, mirroring how `gh.checkoutUrl` sits alongside `data-gh-checkout`. It **respects the dedupe guard**: a caller doing an SPA route push must update `data-gh-step` before calling, otherwise the call is a deliberate no-op. The parameter is a single-member union in v4 rather than an open string, so adding event types is a typed change; there is no payload-override parameter.

### D10 — Transport

`keepalive: true` on the funnel-event fetch, not `navigator.sendBeacon`. sendBeacon cannot set request headers, and Kong's `key-auth` requires `X-GH-Key` in a header (`key_in_query: false`). `keepalive` survives page unload and its 64KB body cap is irrelevant at ~1KB.

## Corrections to shipped Cluster F

Cluster G is already touching this code, so the following latent defects are fixed in the same pass:

1. **Pre-resolve stub session** (`index.ts:89-94`). `gh.checkoutUrl` is installed with `{ sessionId: '', hasConnectSid: false, params: null }` before `ensureSession` is invoked at `:96`. Because `setIfAbsent` skips falsy values, this produces a *syntactically valid* checkout URL with `sessionid` and every UTM omitted — a click in that window navigates un-attributed with no error anywhere.
2. **Captured-reference attribution loss** (`index.ts:99-104`). `root.checkoutUrl` is *reassigned* when the session resolves, so any integration holding the function (`const f = gh.checkoutUrl`, a GTM variable, a React prop) keeps the stub closure forever. A third-party tool is exactly the consumer likely to do this.

   Both are fixed the same way: pass a **session thunk** (`getSession: () => SessionState | null`) rather than a snapshot, and delete the reassignment. One stable identity always reads live state.

   The thunk is nullable because `getSessionState()` returns `null` until `ensureSession` resolves (`session.ts:32-37`) — which is exactly the window Correction 1 describes, so the null case must be specified rather than typed away. Behaviour differs by path: `gh.checkoutUrl` (async per D8) **awaits `__sessionPromise` before composing**, so it never returns a params-less URL; `bindOne` leaves `href="#"` while the session is unresolved — never a syntactically valid URL with the session and UTMs silently missing — and relies on the `gh:session-ready` rebind (Correction 3) to fill it in.
3. **`gh:session-ready` listener registered too late** (`runtime.ts:217-227` runs at `index.ts:111`, after `ensureSession` at `:96`). On the synchronous path the event dispatches before the listener exists. Register it before `ensureSession` is invoked, or defer `fireReady` by a microtask.
4. **Checkout links stranded at `href="#"`.** `data-gh-checkout` slugs are absent from `collectResources` (`runtime.ts:52-76`), so `bind()` never awaits their destination fetch; `bindOne` sets `href="#"` and fires `ensureDestination` fire-and-forget; `gh:bindings-ready` then fires with the link still `#`; and nothing re-binds because neither `href` nor `data-gh-checkout` is in the observer's `attributeFilter` (`runtime.ts:119-128`). Fix: add checkout slugs to `collectResources`, add the attribute to `attributeFilter`, and call `scheduleRebind()` on successful `loadOne`.
5. **`destination.ts:6` docblock says "Pre-Purchase only"** — the opposite of the truth. The server enforces Post-Purchase for destinations and Pre-Purchase for funnels (`HippoShop.service.ts:25-26`, `:96`, `:104-105`). `funnel.ts:4` is correct; the destination docblock was pasted from it.
6. **`packages/sdk/SPEC.md:103`** says params are posted to `/session` while the code posts to `/public/v1/session`.

## Workstream 1 — `hippo-shop` (v4)

| File | Change |
|---|---|
| `packages/sdk/src/session.ts` | D1 ladder, D2 cookie, D4 always-POST with `sessionId` in body, delete `connect.sid` handling, UUIDv4 generation |
| `packages/sdk/src/url-params.ts` | D3 in full: seven-row click-id table, seven raw fields, drop truncation, `subidN` inbound, landing/referral rules, session-id reader + regex (kept **out** of `ParsedParams` so it is not double-sent) |
| `packages/sdk/src/checkout.ts` | D6 param set and ordering, D8 async, session thunk |
| `packages/sdk/src/events.ts` *(new)* | D5 payload builder, `formatVisitDate`, UA detection ported for vocabulary parity, D9 gating and dedupe, D10 transport |
| `packages/sdk/src/runtime.ts` | Corrections 3 and 4; `data-gh-step` and `data-gh-checkout` in `attributeFilter` |
| `packages/sdk/src/index.ts` | Corrections 1 and 2; `gh.track`; drop `visitorId` |
| `packages/sdk/src/config.ts` | `data-gh-step`, `data-gh-funnel-id` |
| `packages/types/src/destination.ts` | `url`, `id`, `funnelId`; fix the Pre/Post-Purchase docblock |
| `packages/types/src/funnel.ts` | `id` on `HippoShopFunnelStepDTO` |
| Tests | Session ladder and precedence, POST body shape, all seven click-id rows, truncation removal, outbound param names, event payload field-by-field, gating and dedupe. Plus a shared cookie-jar helper that records `Domain`/`Max-Age`/`SameSite` — three copies exist today (`test/cookies.spec.ts:70-101`, `test/session.spec.ts:73-98`, `:183-203`) and none can assert attributes, so the root-domain contract is currently untestable |
| `apps/integration-harness/src/public-v1.test.ts` | Assert the new destination fields; assert the full key set rather than the three sampled paths at `:41-46` |
| Docs | `packages/sdk/SPEC.md`, `packages/sdk/README.md`, `packages/types/README.md`, `docs/architecture/kong-public-routing.md`, changesets |

## Workstream 2 — `GH-Commerce-Service` (off `prerelease`)

1. **Public session route.** Add `{ path: '/v1/session', method: 'post', handler: [requireBrandName, this.publicSession] }` to `HippoShopController`, which is already `disableAuth = true` and brand-scoped. Delegate to the existing `SessionService.getSession`. **Do not** flip `SessionController.disableAuth` — that would expose the authenticated internal route.
2. **Session id validation.** None exists today. Add an explicit guard in the handler; bounds must accommodate UUIDs and legacy ids.
3. **Destination URL.** Retrieve via a direct SOQL query (a second trip to Salesforce for the same record) and emit as `url`. Interim by explicit decision; the managed-package field is a later cluster.

   **The lookup must never fail the destination response.** A SOQL error or timeout logs and yields `url: null` — indistinguishable to the client from "Salesforce has none", which is the correct degradation given D7's fallback chain and Goal 8. Making a supplementary field a hard dependency would turn one flaky Salesforce call into six failed requests per offer-selector page load. Issue it **in parallel** with the primary destination fetch, not sequentially, for the same reason. The implementation must name the sObject field it queries; it is not yet identified in either repo (see open question 5).
4. **Destination identity pass-through.** Emit `id` from `destination.id` and `funnelId` from `defaultFunnel.id`; emit step `id` from `defaultFunnel.steps[].id`. All are already present in the fetched payload.
5. **Types pin bump.** `^3.0.0` → `^4.0.0` **in the same commit** as the Zod schema changes. `HippoShop.spec.ts:503-519` asserts bidirectional type equality (`Equals<z.infer<typeof ZHippoShopDestinationDTO>, HippoShopDestinationDTO>`), so either change alone fails `tsc`.
6. **Fix `Session.service.ts:68`** — the fallback path returns key `session` where the happy paths and the OpenAPI use `sessionId`. Check `hippo-builder-funnel` consumption before changing.
7. **Cache the negative visitor lookup.** `Session.service.ts:38` early-returns only when the provided id matches **and** `visitorIdFromSession` is truthy, so when AlternActivate returns nothing every POST re-fires the `getVisitorId` JSONP fetch (`:73-86`) — one outbound call per page view for a value nobody consumes. Pre-existing, but Cluster G formalises always-POST, so it should be fixed here.
8. **Remove `console.log` of client-supplied ids and full attribution** in `Session.controller.ts` and `Session.service.ts:37` before this surface goes public.

## Workstream 3 — Kong (owned by Steven)

**Session route:** `POST /public/v1/session` → commerce `POST /hippo-shop/v1/session`. Note the upstream path: W2.1 registers the route on `HippoShopController`, whose `basePath` is `hippo-shop`, so the endpoint is `/hippo-shop/v1/session` and **never** the authenticated `/session` at the app root. This must use the same `/public/v1/*` → `/hippo-shop/v1/*` rewrite the read routes already rely on (see the reconciliation note below); configuring it against `/session` would both 404 and, if it resolved, hit the auth-protected controller. Methods `POST, OPTIONS`. `cors.credentials: true` with `origins` listing the Superfunnel subdomain explicitly — wildcards are illegal with credentials. `key-auth` with `key_names: X-GH-Key`, `hide_credentials: true`, `run_on_preflight: false`. `request-transformer` renaming `X-GH-Brand` → `X-Brand`. No `proxy-cache`.

**Funnel-event route:** `POST /public/v1/funnel-event` → Altern, service path `/funnel/stats/save/` (both slashes), `strip_path: on`. Methods `POST, OPTIONS`. Timeouts 5000ms, matching the funnel proxy's `UPSTREAM_TIMEOUT_MS`. Injected headers are a **strictly smaller** set than the sibling proxy: `X-Brand` and `Content-Type: application/json;charset=UTF-8` (no space before `charset` — the exact string is pinned by a spec assertion). **No Authorization, no API key, no `X-Domain`.** `cors.credentials: false` — the `Cookie` header cannot survive a cross-site request to a different registrable domain anyway, which is precisely why the event body must be self-sufficient for attribution.

**Rate limiting — this is the item most likely to break the pilot.** The documented route default is 60/min `limit_by: consumer` (`kong-public-routing.md:134-146`), and one publishable key is shared by every page of a brand, so that is a single bucket for all traffic.

An offer-selector page load costs roughly **eight requests**: six destination `GET`s (one per bound offer — `RequestCache` dedupes identical slugs, but these are six distinct slugs), one session `POST`, and one funnel-event `POST`. Against a 60/min bucket that is **about seven page loads per minute for the entire brand.**

`proxy-cache` does not relieve this. Rate limiting runs in the access phase, before proxy-cache, so cache hits still spend quota — stated explicitly at `kong-public-routing.md:102` and described there as intentional.

Required: an elevated per-consumer tier well above the documented `minute: 300` example, and `limit_by: ip` on the write routes so one visitor cannot exhaust a brand-wide bucket. Remember the local-policy multi-dyno math — effective limit is `dynos × configured` (`:146`).

Worth noting as a follow-up rather than pilot scope: six sequential destination `GET`s per page is an N+1 shape. A batch destination endpoint (or a destination-group resource) would cut a page load from eight requests to three. Out of scope here; flagged because the rate-limit tier is being sized around the unbatched number.

**Brand token mapping.** See D5 — `rename.headers` changes the key, not the value, and `"Gundry MD"` ≠ `"gundry"`.

**New SDK major = new CDN line.** Cutting v4 is not just an npm publish. `docs/architecture/cloudflare-deploy.md:32` states that each npm major has its own Pages project and Kong route, and `:51` that Kong changes are required once per new major to add a `/sdk/vN/*` route; `ROADMAP.md:98` records that the v3 cut needed exactly this and that the release initially failed because the Pages project did not exist. So W3 also owns: create the `gh-hippo-shop-sdk-v4` Cloudflare Pages project, add the Kong `/sdk/v4/*` route pointing at it, and update the CI deploy target. **This must exist before the SDK publish in step 1**, not after.

**Reconcile the routing doc** with the `/public/v1/*` → `/hippo-shop/v1/*` rewrite that already exists in production but is undocumented. Whichever way path resolution is settled, `PUBLIC_SDK_PATH_PREFIX` (`errorHandler.middleware.ts:15`) must match, or public error responses silently regress to the internal shape and the SDK's `body.code` parsing breaks.

## Release ordering

1. `hippo-shop` PR merges; `@goldenhippo/hippo-shop-types@4.0.0` and `@goldenhippo/hippo-shop-sdk@4.0.0` publish. SDK deploys to `/sdk/v4/gh.js`.
2. `GH-Commerce-Service` PR bumps the pin and lands the Zod plus serializer changes together.
3. npm-deprecate 3.x, as with the 1.x/2.x precedent.

Ordering constraints, precisely:

- The `gh-hippo-shop-sdk-v4` Cloudflare Pages project and the Kong `/sdk/v4/*` route **must exist before** step 1's deploy. The v3 cut failed on exactly this (`ROADMAP.md:98`).
- The types release **gates** the commerce work, and within step 2 the pin bump and the Zod change must be the *same commit*.
- The session and funnel-event Kong routes are the only genuinely parallel items — they can land any time before end-to-end testing.

## Testing

Unit coverage per W1's table. Beyond that, two acceptance steps that cannot be replaced by unit tests:

- **UAT reconciliation.** Emit a known number of `Page View` events for a fixed session id and count the rows that actually land in Salesforce. Nothing in any repository can prove this contract statically, and a 200 response is not evidence.
- **End-to-end handoff.** Land on a `sf.brand.com` page with `?sessionid=<known>` plus UTM parameters, confirm the cookie is written at `.brand.com`, confirm the POST body carries the id inside `affParameters`, click through to a destination, and confirm the same id arrives as `?sessionid=` and is adopted rather than re-minted.

## Risks

- **Session fixation via the URL** (D1). Accepted for the pilot with regex, logging, and documentation. Revisit before general availability; a "URL wins once per id per browser" rule is the right long-term answer but needs state we have nowhere clean to keep.
- **Silent CORS failure is undetectable from JS.** `hasConnectSid` was being set from HTTP success rather than actual cookie presence, which JS cannot observe. D4 removes that inference entirely, but a credentials misconfiguration at Kong will still fail invisibly.
- **`X-Domain` has no allowlist.** `gh-service-utils` sets the session cookie domain from an arbitrary request header. Confirm Kong strips it on the public route before opening a POST path.
- **Cookie-name collision with the funnel app** (D2). Mitigated by always emitting `sessionid`; worth a coordinated release with the funnel team to align on root scoping.
- **Silent event rejection** (D5). No validation anywhere on the path; the only detection is UAT reconciliation.

## Open questions

1. **Does the SDK's `data-brand` value match what Altern expects for the `brand` column, and does Altern read the `X-Brand` header or the payload's `brand` field?** The answer decides whether this is fixable at Kong (`replace.headers`), needs `replace.body`, or needs the SDK to emit the token form. Blocks correct event attribution if wrong; must be settled before D5 is implemented.
2. **Is anything parsing the legacy 12-character numeric session-id format?** Cluster F asserted a funnel-events dependency (`session.ts:43-45`) but named no consumer, and the funnel app already emits UUIDv4 into the same pipeline. Cluster G proceeds on the evidence that nothing does.
3. **Who mints the legacy ~26-digit numeric ids** the funnel accepts inbound? Not this SDK, not the funnel. If that producer is live, it is a third format in circulation.
4. **Should the funnel team adopt root-domain cookie scoping** so D2's divergence closes?
5. **Which Salesforce sObject field holds the destination URL?** W2.3 depends on it. `Campaign.TouchCRBase__URL_V2__c` is the only destination-shaped URL found anywhere in the codebase (`Campaign.service.ts:52`), but it is campaign-scoped, and destinations are fetched through an Apex REST route rather than SOQL — so the field is not visible from either repo. Must be identified before W2.3 can be written.
