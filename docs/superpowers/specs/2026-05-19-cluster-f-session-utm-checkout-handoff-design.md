# Cluster F — SDK session, UTM, and checkout handoff

**Status:** Design approved, awaiting implementation plan
**Date:** 2026-05-19
**Cluster:** F (of A–F; see [`/ROADMAP.md`](../../../ROADMAP.md))
**Branch:** `feat/cluster-f-session-utm-checkout-handoff` (off `main`)

## Background

`/ROADMAP.md` carries Cluster F as: "Have the SDK manage a session cookie when one is not present and parse UTM parameters, including the Golden Hippo-specific click-id mapping (e.g. `fbclid` → `sub_id1=fb` and `sub_id5=fbcli`). On a `checkoutUrl` handoff — possibly supplied by destination details — auto-apply the correct UTM parameters. This would unlock a single per-brand checkout app at `checkout.brand_domain.com` consuming pages from anywhere. Large architectural commitment; probably warrants a spike before a full spec."

Today the SDK is a read-only DOM-binding library: it fetches funnel/destination/product DTOs from `/public/v1/*` and writes their fields into the page via `data-gh-*` attributes. It has zero side-effects beyond DOM updates — no cookies, no URL parsing, no outbound POSTs, no navigation behavior.

The current Golden Hippo pre-purchase funnels run on a separate Angular app (`gh-utils` / brand-specific funnel apps). That app already manages:
- A POST to `/commerce/session` with parsed UTM/click-id params, which makes the API set a `connect.sid` cookie at the brand's root domain.
- A separate `sessionId` cookie (30-day, root-domain) generated client-side, used as an identifier in funnel events emitted to a different API.
- Handoff from `info.brand.com` (pre-purchase) to `checkout.brand.com` (post-purchase) carrying both cookies (cookies survive because they're root-domain scoped) plus a set of URL params.

Cluster F gives the SDK the same responsibilities for static-HTML funnel pages, so partner teams who build their funnel page once in HTML (per the Cluster E v1 lander's pitch) can have correct attribution and a robust checkout handoff without standing up their own Angular runtime. The eventual goal — flagged in the ROADMAP as "future hope, not in scope here" — is that any HTML funnel page anywhere can hand off cleanly to a single per-brand checkout app at `checkout.brand.com`. Cluster F builds the plumbing for that without committing to that destination architecture.

The ROADMAP flagged this as "spike-worthy," but most of the unknowns are now resolved: the commerce API contract is documented, the gh-utils `sessionId` algorithm exists, the click-id mapping pattern is clear, and the SDK's existing modular shape gives a clean place to add these pieces. A spike is no longer warranted.

## Goals

1. The SDK parses `window.location.href` on boot, extracts UTM and known click-id params, and POSTs them to `/commerce/session` (wrapped in `affParameters`) once per visit. The API persists them server-side ("first-touch wins" — the API spec explicitly says "session parameters persist once set") and sets `connect.sid` at the brand's root domain.
2. The SDK manages a separate `sessionId` cookie (30-day, root-domain) for funnel-event continuity, reusing any existing value or generating a new one via the gh-utils algorithm ported verbatim.
3. The SDK exposes a clean handoff API — a declarative `data-gh-checkout` attribute and a programmatic `gh.checkoutUrl(slug)` method — that composes outbound checkout URLs with `order_form_id`, `session_id`, and the captured UTM/sub_id set as query params.
4. Every failure mode degrades gracefully. Network errors, blocked cookies, missing config, malformed inputs — none of them prevent the page from rendering, and none of them throw uncaught errors. Attribution may degrade for the visit; the user experience does not.

## Non-goals

- **No funnel events.** Cluster F does not fire page-view, click, or checkout-intent events to the funnel-events API. That's a separate cluster on its own timeline.
- **No checkout app.** Cluster F builds the handoff URL; it does not host or implement the checkout destination. The destination is supplied by `data-checkout-base` or `checkoutOverrideUrl`.
- **No consent gating.** v1 ships without GDPR/CCPA consent gating because the existing Angular flow doesn't gate either. A future cluster can add `data-consent-required` + `gh.consent.grant()` as a pause point; this design does not anticipate it.
- **No `sessionId` algorithm modernization.** The ported gh-utils algorithm uses `Math.ceil(Date.now() * Math.random()).toString().slice(0, 12)`, which has weak entropy by modern standards. We port it verbatim for backward compatibility with funnel events that may parse the format. A "v2 sessionId migration" is a future ROADMAP item.
- **No additional click-id mappings beyond `fbclid`.** v1 ships with just the `fbclid → subId1='fb', subId5=<value>` mapping. The mapping registry is structured so adding more (gclid, ttclid, msclkid, etc.) is a one-entry edit once the canonical table is provided.
- **No retry/backoff on POST `/session` failure.** Single attempt; failure is logged and the visit proceeds with degraded attribution. Retry can land later if real-world signal warrants it.
- **No bundle-size optimization heroics.** Estimated +6–8KB minified. SDK is currently ~22KB; this remains well within practical bounds. Tree-shaking the cookie/URL helpers per-module is not pursued.

## Decisions

### Scope: session API + checkout handoff + click-id mapping inside the SDK

The SDK owns all three layers: cookie management, POST `/session` orchestration, and handoff URL composition. The click-id mapping table lives in code (`packages/sdk/src/url-params.ts`) rather than as runtime config, so adding a new click-id ships as part of an SDK release rather than being a per-page override.

### Click-id mapping v1: `fbclid` only, generalizable pattern

The v1 registry has one entry:

```ts
const CLICK_ID_REGISTRY: Record<string, ClickIdMutator> = {
  fbclid: (value, into) => {
    into.subId1 = 'fb';
    into.subId5 = value;
  },
};
```

Each mutator takes the raw click-id value (e.g., the `fbclid` query value) plus a mutable `ParsedParams` object and writes channel-marker + payload into specific `subId` slots. The pattern generalizes: `subId1` is the channel marker (a fixed short string), `subId5` is the click-id payload. When the canonical mapping table for other click-ids (`gclid`, `ttclid`, `msclkid`, etc.) is provided, each becomes a one-line registry entry.

Direct query params on the landing URL take precedence over click-id-derived values. If the URL has both `?fbclid=abc&sub_id1=manual`, the URL author's `sub_id1=manual` wins; `subId5` still gets the fbclid value because no direct `sub_id5` was supplied.

### Checkout URL source: brand-level default with per-destination override

The script tag carries a brand-level default:

```html
<script src="…/sdk/v3/gh.js"
        data-key="…"
        data-brand="Gundry MD"
        data-checkout-base="https://checkout.gundrymd.com">
</script>
```

Per-destination override lives on the DTO:

```ts
// packages/types/src/destination.ts
export interface HippoShopPricingDTO {
  // …existing fields…
  /**
   * Optional override for the checkout base URL on handoff. When set,
   * overrides the brand-level `data-checkout-base`. Null means use the
   * brand default.
   */
  checkoutOverrideUrl: string | null;
}
```

Override wins when both are present. If neither is present AND a page tries to compose a checkout URL, `composeCheckoutUrl` throws an SDK error; `[data-gh-checkout]` elements get `href = "#"` plus a debug log; programmatic `gh.checkoutUrl(slug)` throws.

### Handoff API: declarative attribute + programmatic method

Two surfaces, both supported:

1. **Declarative.** `<a data-gh-checkout="<destination-slug>">Buy</a>`. The SDK populates `href` with the composed URL during the bind pass. Re-runs on the existing MutationObserver hook when destination data changes or the element is added/removed. Native browser navigation works (middle-click, hover preview, right-click context menu — all behave as expected because the link is a real URL by the time the user interacts with it). Works on `<button>` and arbitrary elements too — for non-`<a>` it attaches a click handler that navigates.

2. **Programmatic.** `window.gh.checkoutUrl(slug: string): string` — returns the composed URL without navigating. For page authors building custom UI (SPA route push, JS-driven flow, analytics-instrumented click). Throws if no `checkoutBase` is configured AND the destination has no `checkoutOverrideUrl`.

### Cookie domain: auto-detect with conservative TLD allowlist + explicit override

`getCookieDomain(config)` algorithm:

1. If `data-cookie-domain` is set on the script tag, return it verbatim.
2. Else parse `window.location.hostname`. Split on `.`.
3. If the last segment is in the safe-TLD allowlist — `['com', 'net', 'org', 'io', 'app', 'dev', 'ai', 'co', 'us', 'store', 'shop']` — strip the leading subdomain and return `.<registrable-domain>` (with the leading dot).
4. Else (unknown TLD, multi-part TLD like `.co.uk`, single-label host like `localhost`) → return `null`. Caller uses host-only cookies. If we hit this path in a non-dev hostname, log a debug warning telling the site owner to set `data-cookie-domain` explicitly.

Multi-part TLDs (`.co.uk`, `.com.au`, `.co.jp`, etc.) are intentionally NOT supported by auto-detect. They require explicit override. This is documented; the warning makes the failure mode visible.

### Session cookie: `sessionId`, gh-utils algorithm, 30-day root-domain

Cookie name is exactly `sessionId` (camelCase, no namespace prefix) for backward compatibility with the existing Angular flow and any downstream consumer (notably the funnel-events API).

ID generation is ported verbatim from [`gh-utils/src/utils/session/session.ts`](https://github.com/GoldenHippoMedia/gh-utils/blob/master/src/utils/session/session.ts):

```ts
function generateSessionId(): string {
  let id = Math.ceil(Date.now() * Math.random()).toString();
  if (id.length < 12) {
    const now = new Date();
    const year = now.getFullYear();
    const month = new Intl.DateTimeFormat(undefined, { month: '2-digit' }).format(now);
    const day = new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(now);
    id += `${year}${month}${day}`;
  }
  return id.slice(0, 12);
}
```

Cookie attributes: `Max-Age=2592000` (30 days), `Domain=<auto-detected-or-override>`, `Path=/`, `SameSite=Lax`, `Secure` when on https.

Existing `sessionId` cookie (set by any prior Angular flow or earlier SDK boot) is reused; only generated fresh when absent.

### POST `/session` timing: once per visit, only if no `connect.sid` present

The SDK checks for `connect.sid` cookie on boot. If present, it skips the POST entirely — the API's "session parameters persist once set" semantics mean re-POSTing accomplishes nothing useful, and the cookie's presence is sufficient evidence that a session already exists.

If absent: parse URL params, POST `/session` with `affParameters` wrapping the params (see body shape below), `credentials: 'include'`. The API sets `connect.sid` via `Set-Cookie` on the response. The SDK does not need to manipulate `connect.sid` client-side — it just needs to ensure `credentials: 'include'` so the browser stores and forwards the cookie correctly on subsequent calls.

The cookie's natural expiration (controlled by the API) is the visit boundary. When the cookie expires, the next page load gets a fresh POST.

### Code structure: 4 focused modules

Following the existing SDK pattern (small files, one responsibility):

```
packages/sdk/src/
├── cookies.ts        (new, ~80 LOC)
├── url-params.ts     (new, ~70 LOC)
├── session.ts        (new, ~120 LOC)
├── checkout.ts       (new, ~90 LOC)
├── index.ts          (modified — boots session pipeline)
├── runtime.ts        (modified — bind pass walks data-gh-checkout)
├── config.ts         (modified — parses new script-tag attrs)
└── …
```

### Auth scheme: expose `/session` via the public-route gateway

The SDK currently uses `X-GH-Key` + `X-GH-Brand` headers against `/public/v1/*` endpoints. The commerce API at `/commerce/*` uses BasicAuth + `X-Brand` and is meant for authenticated/internal clients. Cluster F requires `/session` to be reachable from the SDK using the same auth scheme it already uses.

The chosen path: expose `POST /session` (and any future session-related endpoints) behind the same Kong public-route gateway that fronts `/public/v1/*`. The gateway translates `X-GH-Key` + `X-GH-Brand` into whatever the commerce service expects internally (BasicAuth + `X-Brand`). The SDK does NOT learn about a second header set, a second credential type, or a different base URL.

From the SDK's perspective: the call becomes `POST <apiBaseUrl>/public/v1/session` with the same headers it already uses (`X-GH-Key`, `X-GH-Brand`, `Accept: application/json`, `Content-Type: application/json`) plus `credentials: 'include'`.

This is an API-side counterpart to Cluster F and is a hard prerequisite for shipping the SDK side. The implementation plan flags it.

### POST `/session` request body shape: `{ "affParameters": { … } }`

**The OpenAPI spec at `api-prod.goldenhippo.io/commerce/docs` shows the request body as a flat object. The actual API expects the params wrapped in `affParameters`:**

```json
{
  "affParameters": {
    "landingUrl": "https://info.gundrymd.com/some-funnel?fbclid=AbC123",
    "referralUrl": "https://www.facebook.com/",
    "utmSource": "fb",
    "utmCampaign": "summer",
    "subId1": "fb",
    "subId5": "AbC123"
  }
}
```

Empty/undefined values are omitted from the wrapped object rather than sent as `""`. The OpenAPI spec is stale; the spec doc is the source of truth for this shape until the OpenAPI is corrected.

## Architecture & Components

Four new modules + minor wiring touches to three existing files. One DTO field added to `packages/types`. No new npm dependencies.

### `cookies.ts`

Responsibility: cookie read/write/delete plus domain auto-detection.

```ts
export function getCookieDomain(config: SdkConfig): string | null;
export function readCookie(name: string): string | undefined;
export function writeCookie(name: string, value: string, opts: {
  maxAgeSec: number;
  domain: string | null;   // null = host-only
  secure?: boolean;        // defaults to location.protocol === 'https:'
  sameSite?: 'Lax' | 'Strict' | 'None';  // defaults to 'Lax'
  path?: string;           // defaults to '/'
}): void;
export function deleteCookie(name: string, domain: string | null): void;
```

Pure DOM API (`document.cookie`); no external deps. Encodes values with `encodeURIComponent`. Refuses to write cookies with names matching `/[=,;\s]/` (defensive guard).

### `url-params.ts`

Responsibility: parse the landing URL into a shape compatible with the POST `/session` body.

```ts
export interface ParsedParams {
  landingUrl?: string;
  referralUrl?: string;
  salesFunnel?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmCampaignId?: string;
  utmContent?: string;
  utmTerm?: string;
  utmChat?: string;
  utmAction?: string;
  offId?: string;
  affId?: string;
  subId1?: string;
  subId2?: string;
  subId3?: string;
  subId4?: string;
  subId5?: string;
}

export type ClickIdMutator = (value: string, into: ParsedParams) => void;

export const CLICK_ID_REGISTRY: Record<string, ClickIdMutator>;

export function parseLandingParams(
  href: string,
  referrer: string,
): ParsedParams;
```

`parseLandingParams` walks the URL's query string. For each known `utm_*` and `sub_id*` key, writes to the corresponding `ParsedParams` field. Then walks the registry; for each click-id present in the URL, calls the mutator. Direct query-param values take precedence over click-id-derived values (the mutator writes first; direct keys overwrite afterward). `landingUrl` is the full `href`, `referralUrl` is `referrer` (empty string omitted from output).

Values longer than 255 chars are truncated (matches API `maxLength`). Control characters are stripped.

### `session.ts`

Responsibility: cookie lifecycle, ID generation, POST orchestration.

```ts
export interface SessionState {
  sessionId: string;
  hasConnectSid: boolean;
  params: ParsedParams | null;  // null if POST didn't run or failed
}

export async function ensureSession(
  config: SdkConfig,
  client: ApiClient,
): Promise<SessionState>;

export function generateSessionId(): string;
export function getSessionState(): SessionState | null;  // null before ensureSession resolves
```

`ensureSession` flow:

1. Read `connect.sid` cookie via `readCookie('connect.sid')`.
2. Read or generate `sessionId` cookie. If existing → reuse; else `generateSessionId()` and write with 30-day expiry at the resolved cookie domain.
3. If `connect.sid` present → set internal state with `hasConnectSid: true, params: null`, fire `gh:session-ready`, return.
4. Else: `parseLandingParams(location.href, document.referrer)` → `params`.
5. POST `<apiBaseUrl>/public/v1/session` with body `{ affParameters: params }`, `credentials: 'include'`, the existing SDK headers.
6. On 2xx → set state with `hasConnectSid: true` (assumes the API set the cookie correctly; we can't verify the Set-Cookie header from JS), `params`.
7. On error → log + set state with `hasConnectSid: false, params` (params are still captured for handoff URL composition).
8. Fire `gh:session-ready` with the state.

`generateSessionId` ports the gh-utils algorithm verbatim (see Decisions § Session cookie).

### `checkout.ts`

Responsibility: URL composition + `data-gh-checkout` attribute behavior + `gh.checkoutUrl` programmatic API.

```ts
export function composeCheckoutUrl(
  destination: HippoShopDestinationDTO,
  config: SdkConfig,
  session: SessionState,
): string;

export function installCheckoutBindings(
  runtime: Runtime,
  config: SdkConfig,
): void;

export function checkoutUrl(slug: string): string;  // exposed as gh.checkoutUrl
```

`composeCheckoutUrl` algorithm:

1. Determine base URL: `destination.pricing.checkoutOverrideUrl ?? config.checkoutBase`. If both null/undefined, throw `GhError('config', 'No checkout base URL configured', …)`.
2. Parse base as `new URL(base)`. Preserve any existing query string.
3. For each non-empty value in the union of `{ order_form_id: destination.pricing.orderFormId, session_id: session.sessionId }` and the session params (mapped from `subId1` → `sub_id1`, `utmSource` → `utm_source`, etc.), set the corresponding `searchParams` key only if not already set by the base URL (author-supplied keys win).
4. Return `url.toString()`.

`installCheckoutBindings` is called by `runtime.installAutoBind` after the existing data bindings. It walks `[data-gh-checkout]` elements. For each, resolves the destination DTO via the existing cache, calls `composeCheckoutUrl`, and either writes `href` (on `<a>`) or attaches a click handler (on other elements).

Re-bind triggers:
- The same MutationObserver hook that powers existing `data-gh-*` bindings — picks up nodes added/removed after initial bind, and destination-data changes propagated via the existing cache invalidation.
- A `window.addEventListener('gh:session-ready', …)` listener — re-runs the walk once `ensureSession` resolves, so any href that was bound with a stub `session_id` (because the page hit `installAutoBind` before session resolution) gets updated with the real value.

`checkoutUrl(slug)` looks up the destination DTO synchronously (or returns a stub URL with an empty `session_id` if not yet loaded), composes, returns. Does not navigate. Throws on missing config (per `composeCheckoutUrl`).

## Data flow

End-to-end journey for a first-visit user landing on `https://info.gundrymd.com/some-funnel?fbclid=AbC123&utm_source=fb&utm_campaign=summer`:

1. SDK script loads. `boot()` runs the existing path: parse script-tag config (now including `data-checkout-base` and optional `data-cookie-domain`), validate, attach `window.gh.{data, bind, refresh, format}`, fire `gh:data-ready`.
2. `boot()` calls `session.ensureSession(config, client)` — fire-and-forget; promise stored on `window.gh.__sessionPromise` for debug introspection.
3. `runtime.installAutoBind()` runs. The bind pass walks the existing `data-gh-*` attributes AND the new `data-gh-checkout` attribute. For `data-gh-checkout` elements, `installCheckoutBindings` runs.
4. First bind pass — `[data-gh-checkout]` `href` may be a stub (`session_id` empty) if `ensureSession` is still in flight. The stub gets replaced via the `gh:session-ready` event listener in step 11.
5. `gh:bindings-ready` fires.
6. `ensureSession` resolves: parses `window.location.href`, click-id registry sees `fbclid=AbC123` and writes `subId1='fb'`, `subId5='AbC123'`. Also captures `utmSource='fb'`, `utmCampaign='summer'`, `landingUrl=…`, `referralUrl=document.referrer`.
7. `connect.sid` is absent. Generate `sessionId` cookie at root domain (e.g., `sessionId=174710238129; Domain=.gundrymd.com; Max-Age=2592000; …`).
8. POST `<apiBaseUrl>/public/v1/session` with body `{ affParameters: { utmSource: 'fb', utmCampaign: 'summer', subId1: 'fb', subId5: 'AbC123', landingUrl: '…', referralUrl: '…' } }`, `credentials: 'include'`, headers including `X-GH-Key` + `X-GH-Brand`. Kong gateway translates to BasicAuth + `X-Brand` for the commerce service.
9. API persists params server-side and responds `Set-Cookie: connect.sid=…; Domain=.gundrymd.com; HttpOnly; Secure; SameSite=Lax; …` plus a JSON body echoing the persisted params.
10. `ensureSession` fires `gh:session-ready` on `window` with `detail: { sessionId, hasConnectSid: true, params }`.
11. The `gh:session-ready` listener installed by `installCheckoutBindings` fires and re-runs the bind walk. Every `[data-gh-checkout]` element on the page now has its `href` set to e.g. `https://checkout.gundrymd.com/?order_form_id=…&session_id=174710238129&utm_source=fb&utm_campaign=summer&sub_id1=fb&sub_id5=AbC123`.
12. User clicks a checkout link. Native browser navigation runs; the URL above is the destination. Middle-click opens in a new tab correctly.
13. Checkout page at `https://checkout.gundrymd.com/…` loads. `connect.sid` is still set (root-domain scoped, survived the subdomain change). Checkout app reads URL params directly and/or calls `GET /session` to retrieve the full persisted state.

**Second-visit flow** (same browser, cookies intact):
- Step 2 still runs.
- In step 7 (`ensureSession` internal), `connect.sid` IS present → skip POST entirely, set state with `hasConnectSid: true, params: null`.
- `sessionId` cookie reused.
- `gh:session-ready` fires with `params: null`.
- Re-bind picks up the same `sessionId`. Handoff URL includes `session_id` and `order_form_id` but no UTM/sub_id params (those live server-side, retrievable via `GET /session`).
- First-touch attribution preserved on the server.

## Public surface changes

| Surface | Change | Compat |
|---|---|---|
| Script-tag attr | NEW: `data-checkout-base="https://checkout.brand.com"` | Optional; required only if any page uses `[data-gh-checkout]` or `gh.checkoutUrl()` without a DTO override |
| Script-tag attr | NEW: `data-cookie-domain=".brand.com"` | Optional; overrides auto-detect |
| DOM attr | NEW: `data-gh-checkout="<destination-slug>"` on `<a>` / `<button>` / arbitrary elements | Net-new |
| `window.gh` | NEW: `gh.checkoutUrl(slug: string): string` | Net-new |
| `window.gh` | NEW: `gh.session.id(): string \| undefined` | Net-new |
| `window.gh` | NEW: `gh.session.params(): ParsedParams \| null` | Net-new |
| Event | NEW: `gh:session-ready` on `window` with `detail: { sessionId, hasConnectSid, params }` | Net-new |
| DTO | NEW: `HippoShopDestinationDTO.pricing.checkoutOverrideUrl: string \| null` | Minor-version bump on `@goldenhippo/hippo-shop-types` |
| API auth | EXISTING: `X-GH-Key` + `X-GH-Brand` headers, `credentials: 'include'` | No new credentials |
| API route | NEW (on the API side): `POST /public/v1/session` proxying to commerce `/session` | API/Kong work, parallel to SDK |

**Checkout URL query-param set** (what `composeCheckoutUrl` appends): `order_form_id` (required), `session_id` (always present once `sessionId` cookie exists), and any non-empty subset of `utm_source`, `utm_medium`, `utm_campaign`, `utm_campaign_id`, `utm_content`, `utm_term`, `utm_chat`, `utm_action`, `sub_id1`, `sub_id2`, `sub_id3`, `sub_id4`, `sub_id5`. Empty/unset values are omitted. Author-supplied query params on the base URL are preserved and take precedence over SDK-added keys with the same name.

## Error handling

Every reachable failure path is non-fatal. The SDK never throws an uncaught exception during normal operation; it logs to the debug logger and degrades gracefully.

| Condition | Behavior |
|---|---|
| `data-checkout-base` missing AND DTO `checkoutOverrideUrl` null | `composeCheckoutUrl` throws `GhError('config', …)`. `[data-gh-checkout]` `href` set to `"#"` with debug log. Programmatic `gh.checkoutUrl()` throws |
| `data-cookie-domain` missing AND auto-detect fails (multi-part TLD, single-label host other than `localhost`) | Cookies fall back to host-only. Debug log warns the author to set `data-cookie-domain` |
| POST `/session` network error or non-2xx | Log + swallow. `connect.sid` not set; `sessionId` cookie still generated locally; `gh:session-ready` fires with `hasConnectSid: false`. Handoff URL still includes `session_id` plus URL-derived params. Marketing attribution degrades to client-side-only for this visit |
| POST `/session` 2xx but no `Set-Cookie` (CORS misconfig) | Undetectable from JS (Set-Cookie is opaque). SDK reports success. Surfaces downstream as missing attribution. Documented API-side requirement |
| `document.cookie` write blocked (sandboxed iframe, 3rd-party blocking) | Log + degrade. `sessionId` not persisted; handoff works for this page load only; attribution doesn't survive refresh |
| Malformed click-id value (empty, non-string) | Registry mutators defensive: skip the entry |
| Click-id or UTM value > 255 chars | Truncate to 255 (matches API `maxLength`). Strip control characters |
| Multiple `[data-gh-checkout]` elements with the same slug | All bound together on every bind pass |
| `data-gh-checkout` slug doesn't match any cached destination | `href = "#"`, debug log. Once destination loads (via the existing fetch path), re-bind fixes the href |
| `[data-gh-checkout]` element added/removed via JS post-bind | MutationObserver picks it up (existing mechanism, no new code) |
| User refreshes mid-POST | Browser cancels in-flight fetch. Next page load tries again (cookie still absent). Idempotent |
| Both `data-checkout-base` AND `checkoutOverrideUrl` present | Override wins (per-destination beats global default) |
| `connect.sid` cookie present at boot | Skip POST entirely. `sessionId` reused. `gh:session-ready` fires with `params: null` |

## Testing

Vitest + jsdom, following the existing `packages/sdk/test/*.spec.ts` pattern. Four new spec files mirror the four new src modules; existing spec files get small additions for the wire-up touches.

| Spec file | Coverage |
|---|---|
| `test/cookies.spec.ts` | Auto-detect over every TLD-allowlist entry (`.com`, `.net`, …); multi-part-TLD fallback; explicit override wins; `localhost` dev path; read/write/delete round-trips; leading-dot domain handling; encoding of values with special chars |
| `test/url-params.spec.ts` | UTM-only URL; fbclid-only; both; direct sub_id overriding click-id-derived; encoded values (`%20`, `+`); URL with hash fragment; URL with no query string; >255-char truncation; control-char stripping; `landingUrl` and `referralUrl` capture |
| `test/session.spec.ts` | First-visit POST flow (mocked fetch); skip POST when `connect.sid` present; `sessionId` byte-for-byte match against gh-utils algorithm for fixed `Date.now()` + `Math.random()`; reuse existing `sessionId`; network-error graceful path; `gh:session-ready` event emission |
| `test/checkout.spec.ts` | URL composition with all empty params; with full param set; DTO override beats brand base; pre-existing query on base preserved; SDK keys don't clobber author keys; `<a>` href rewrite; non-`<a>` click handler; `gh.checkoutUrl(slug)` programmatic; throws when no base AND no override |

Existing spec updates:
- `test/index.spec.ts` — `boot()` now calls `ensureSession`; promise stored on `window.gh.__sessionPromise`.
- `test/runtime.spec.ts` — bind pass walks `[data-gh-checkout]`.
- `test/config.spec.ts` — parses `data-checkout-base` and `data-cookie-domain`.

New tests: ~50. Bundle-size impact: estimated +6–8KB minified pre-gzip. SDK is currently ~22KB; this remains comfortably within the existing `scripts/size-check.mjs` budget (current budget is documented at the release-workflow level; verify during implementation).

## File plan

**New:**

- `packages/sdk/src/cookies.ts`
- `packages/sdk/src/url-params.ts`
- `packages/sdk/src/session.ts`
- `packages/sdk/src/checkout.ts`
- `packages/sdk/test/cookies.spec.ts`
- `packages/sdk/test/url-params.spec.ts`
- `packages/sdk/test/session.spec.ts`
- `packages/sdk/test/checkout.spec.ts`

**Modified:**

- `packages/sdk/src/index.ts` — boot pipeline calls `ensureSession`; exposes `gh.checkoutUrl`, `gh.session.id`, `gh.session.params`.
- `packages/sdk/src/runtime.ts` — bind pass walks `[data-gh-checkout]` via `installCheckoutBindings`.
- `packages/sdk/src/config.ts` — parses `data-checkout-base` and `data-cookie-domain`; both optional.
- `packages/sdk/src/client.ts` — minor: a `postJson` helper alongside the existing GET path (or generalize `fetchJson` to accept method + body).
- `packages/types/src/destination.ts` — add `checkoutOverrideUrl: string | null` to `HippoShopPricingDTO`.
- `packages/sdk/test/index.spec.ts`, `runtime.spec.ts`, `config.spec.ts` — small additions.
- `packages/sdk/SPEC.md` + root `SPEC.md` — document the new attributes, events, and `window.gh` surface.
- `packages/types/SPEC.md` — document the new DTO field.
- `packages/sdk/README.md` — usage example for `data-gh-checkout` and the script-tag attrs.

**Changesets:** one entry per package — `@goldenhippo/hippo-shop-sdk: minor` (new public surface) and `@goldenhippo/hippo-shop-types: minor` (new optional DTO field). No breaking changes.

## API-side requirements (out-of-band)

This cluster has hard dependencies on API/Kong work that ship in parallel:

1. **Expose `POST /public/v1/session`** as a Kong route that proxies to the commerce service's `POST /session`, translating `X-GH-Key` + `X-GH-Brand` (the public auth scheme) to BasicAuth + `X-Brand` (the commerce auth scheme).
2. **Set `Domain=.brand.com` on the `connect.sid` `Set-Cookie` response.** The API must know each brand's root domain (likely already wired since the Angular flow depends on this). Without this, the cookie won't survive the `info.brand.com` → `checkout.brand.com` handoff and the SDK side of Cluster F is effectively broken.
3. **CORS configuration** to allow `credentials: true` from each brand's pre-purchase subdomain. `Access-Control-Allow-Origin` must echo the request `Origin` (not wildcard) and `Access-Control-Allow-Credentials: true` must be present.
4. **Accept the `affParameters` wrapper** as the canonical request body shape, and update the OpenAPI spec at `api-prod.goldenhippo.io/commerce/docs` to match (currently shows a flat object — stale).

These are surfaced as operational follow-ups; the implementation plan will note them but the SDK PR ships independent of them. Until the API side is in place, the SDK's POST will fail gracefully (Cluster F's error-handling matrix covers this case — attribution degrades, page still works).

## Operational follow-ups (post-merge)

- Coordinate the API-side requirements above with the API owners.
- Once both sides are deployed, smoke-test with a real branded landing URL carrying `?fbclid=test123` and verify:
  - `sessionId` cookie set at `.brand.com`.
  - `connect.sid` cookie set at `.brand.com`.
  - `gh:session-ready` event fires.
  - A `[data-gh-checkout]` link's `href` contains `session_id=…&sub_id1=fb&sub_id5=test123`.
  - Navigating to checkout preserves both cookies; `GET /session` on the checkout origin returns the persisted params.
- Update the `examples-static` demo set with a "session + handoff" demo showing the new attribute (likely a v3.1.0 or v3.2.0 follow-up; not gating cluster ship).

## Out of scope (deferred, not rejected)

- Additional click-id mappings beyond `fbclid` — ship as one-line registry edits once the canonical table is provided.
- Funnel-events API integration — separate cluster, separate timeline.
- Consent/privacy gating — new attribute + `gh.consent.grant()` API in a follow-on.
- `sessionId` algorithm modernization (UUIDv4 or similar) — coupled with downstream-API tolerance work.
- Retry/backoff on POST `/session` failures — add when real-world signal warrants.
- Single per-brand checkout app (the ROADMAP's eventual goal) — Cluster F builds the plumbing; the destination app is its own cluster.

## ROADMAP entry mutation

On ship, `/ROADMAP.md`'s "Cluster F — SDK session, UTM, and checkout handoff" entry moves from "Open items" to the top of "Done" with the ship date and PR number, following the pattern set by every previous cluster.
