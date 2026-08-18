# Kong configuration — Cluster G / Superfunnel.ai pilot

Everything that has to change at the gateway for SDK v4 and the Superfunnel pilot, in the order to apply it. Companion to [`kong-public-routing.md`](./kong-public-routing.md), which describes the existing read route, and [`cloudflare-deploy.md`](./cloudflare-deploy.md), which describes the SDK delivery path.

Trust boundary is unchanged: **Kong**. The Commerce API trusts the request as already-authenticated by the gateway. The SDK contains no auth logic — it forwards `X-GH-Key` and `X-GH-Brand`; Kong validates and translates. Sentinel runs Kong **OSS 3.9.1**, so Enterprise-only fields are out.

## What changes

| # | Item | Blocking? |
|---|---|---|
| 0 | Read the live `/public/v1` and `/sdk/v3` config out of the Admin API before editing anything | Yes — Step 7 explains why |
| 1 | `/sdk/v4/*` route + `gh-hippo-shop-sdk-v4` Cloudflare Pages project | **Blocks the v4 npm publish** |
| 2 | `POST /public/v1/session` → Commerce API | Blocks end-to-end testing |
| 3 | `POST /public/v1/funnel-event` → Altern | Blocks event attribution |
| 4 | CORS origins and `credentials` per route | Fails silently in the browser if wrong |
| 5 | Rate-limit tiers | **Most likely single cause of pilot failure** |
| 6 | Brand token | Nothing to do at Kong — read it anyway |
| 7 | The undocumented `/public/v1/*` → `/hippo-shop/v1/*` rewrite | Prerequisite for Steps 2 and 3 |
| 8 | Verification | After each step |

Steps 2 and 3 are the only genuinely parallel items. Step 1 is on the release critical path. Step 7 is a fact-finding prerequisite for Steps 2 and 3 even though it is written up last.

## Step 0 — before you touch anything

### The Sentinel plugin allowlist

The gateway image enforces an explicit plugin allowlist via the `CUSTOM_PLUGINS` env var; Kong's default `bundled` opt-in is not used. A plugin cannot be *selected* in the Admin UI until it is in the var.

**Cluster G introduces no new plugin names.** Everything below is one of the six already required by the read route:

```
cors,key-auth,rate-limiting,request-transformer,proxy-cache,response-transformer
```

Confirm rather than assume — the documented value is a stated *minimum*, and the live list also carries pre-existing entries:

```bash
heroku config:get CUSTOM_PLUGINS -a <uat-gateway-app>
heroku config:get CUSTOM_PLUGINS -a <uat-gui-app>
heroku config:get CUSTOM_PLUGINS -a <prod-gateway-app>
heroku config:get CUSTOM_PLUGINS -a <prod-gui-app>
```

All four must contain all six. If you have to set it, the dyno restarts, and the same value must go to *every* Sentinel app (gateway and gui) so the Admin UI picker matches what the gateway can actually execute.

### Read the live config

Do this before editing. The routing doc is known-stale on exactly the field the two new routes depend on (Step 7).

```bash
KONG_ADMIN=<uat admin api base>

curl -s "$KONG_ADMIN/routes/hippo-shop-public-v1"   | jq '{paths,methods,protocols,strip_path,preserve_host,path_handling,service}'
curl -s "$KONG_ADMIN/services/hippo-shop-public-v1" | jq '{protocol,host,port,path,connect_timeout,write_timeout,read_timeout,retries}'
curl -s "$KONG_ADMIN/routes/hippo-shop-public-v1/plugins" | jq '[.data[] | {name, enabled}]'

# The v3 SDK route — copy this shape for v4 rather than trusting the table in Step 1
curl -s "$KONG_ADMIN/routes"   | jq '[.data[] | select(.paths[]? | test("/sdk/"))]'
curl -s "$KONG_ADMIN/services" | jq '[.data[] | select(.name | test("sdk"))]'
```

Write down `strip_path`, `path_handling`, and the service `path`. Steps 2, 3 and 7 all key off those three values.

---

## Step 1 — the `/sdk/v4` CDN line

A new npm major is not just a publish. Each major has its own Cloudflare Pages project and its own Kong route, and the SDK URL path tracks the major 1:1. **The v3 cut failed on exactly this**: `wrangler@4 pages deploy` does not auto-create the project in non-interactive CI — it errors with "Project not found" — and the release had to be recovered by manually deploying from a local checkout (`ROADMAP.md:98`, PR #10).

The workflow now runs `wrangler pages project create … || true` before deploy, so CI would self-heal the *project*. It does not create the *Kong route*, and it does not help you smoke-test an upstream that has never received a deploy. Do it by hand, ahead of time.

### Order relative to the release

| When | What | Where |
|---|---|---|
| **T-2** | `npx --yes wrangler@4 pages project create gh-hippo-shop-sdk-v4 --production-branch=main` | Cloudflare |
| **T-2** | Seed one deploy from a local checkout so the canonical alias resolves: `npx --yes wrangler@4 pages deploy packages/sdk/dist --project-name=gh-hippo-shop-sdk-v4 --branch=main` | Cloudflare |
| **T-1** | Create the Kong service + route below in **UAT and prod** | Kong |
| **T-1** | Smoke-test `GET /sdk/v4/gh.js` in both (Step 8.1) — against the seeded bundle | — |
| **T-1** | In the release PR, change both `gh-hippo-shop-sdk-v3` occurrences in `.github/workflows/release.yml` (lines 63 and 64) to `-v4` | hippo-shop |
| **T-0** | Merge → `@goldenhippo/hippo-shop-types@4.0.0` + `@goldenhippo/hippo-shop-sdk@4.0.0` publish → CI deploys to the v4 project → canonical alias flips to the real build | — |
| **T+1** | Re-run Step 8.1; confirm the served bytes are the published build | — |

Leave the `/sdk/v3` route in place. Its Pages project stops receiving deploys and freezes at the last v3 build — unsupported but functional, same as `/sdk/v1`.

### Service

| Field | Value |
|---|---|
| Name | `hippo-shop-sdk-v4` |
| Protocol | `https` |
| Host | `gh-hippo-shop-sdk-v4.pages.dev` |
| Port | `443` |
| Path | *empty* — the route strips the public prefix and Pages serves from its root |
| Tags | `hippo-shop`, `sdk-v4` |

### Route

| Field | Value | Notes |
|---|---|---|
| Name | `hippo-shop-sdk-v4` | |
| Paths | `/sdk/v4` | Prefix match — covers `gh.js`, `gh.mjs`, `gh.d.ts`, `llms-full.txt`, `index.html` |
| Methods | `GET, HEAD` | A `<script src>` load is a GET and triggers no preflight, so `OPTIONS` is not needed here |
| Protocols | `HTTP, HTTPS` (UAT) / `HTTPS` only (prod) | |
| Strip Path | **on** | Pages serves `gh.js` at the project root, not at `/sdk/v4/gh.js`. With Strip Path off you get a Cloudflare 404 for every asset |
| Preserve Host | **off** | **Counter-intuitive and it fails hard.** Cloudflare Pages routes on the `Host` header. Forward `api-prod.goldenhippo.io` and you get a Cloudflare error page, not the bundle |
| Path Handling | `v0` (default) | Service has no path; v0/v1 behave identically here |

**Plugins: none.** The bundle is a public static asset — no `key-auth` (the SDK has to be loadable before it has a key to send), no `rate-limiting`, no `proxy-cache` (Cloudflare already caches, and Pages sets its own `Cache-Control`).

Compare the result against the live `/sdk/v3` route from Step 0 and reconcile any difference in *its* favour — that route is known to work.

---

## Step 2 — `POST /public/v1/session`

### The upstream path is not `/session`

`/session` at the Commerce API root is `SessionController`, which does **not** set `disableAuth`, so it inherits `disableAuth = false` and gets `requireUserOrApiAuth` prepended. An anonymous browser request to it gets a `401` (`MissingUserOrApiAuth`). Pointing this route at `/session` would 404 through the rewrite, and if it ever resolved it would expose an auth-protected controller.

The public handler lives on `HippoShopController` — `basePath = 'hippo-shop'`, `disableAuth = true`, brand-scoped — so the endpoint is:

```
POST /hippo-shop/v1/session
```

Its effective middleware chain is `referralBasedAuth → mockUserAuth → requireBrandName → handler`. The first two can never reject; `requireBrandName` is the only thing that can 4xx before the handler, and it needs `X-Brand` populated. That is why the `request-transformer` rename below is not optional.

### Path arithmetic — read this before you set Strip Path

You cannot hang this route off the existing `hippo-shop-public-v1` service. With that service's path (`/hippo-shop/v1`) and a route path of `/public/v1/session`, Strip Path **on** strips the *entire matched route path*, leaving `/`, and Kong joins `/hippo-shop/v1` + `/` = `/hippo-shop/v1/`. That is not the session endpoint, and it will not error at config time — it 404s at runtime, or worse resolves to a different handler.

Give it its own service whose path *is* the full upstream path:

### Service

| Field | Value |
|---|---|
| Name | `hippo-shop-public-session` |
| Protocol | Same as `hippo-shop-public-v1` (`https`, or `http` for in-mesh) |
| Host | Same internal Commerce API hostname as `hippo-shop-public-v1` |
| Port | Same as `hippo-shop-public-v1` |
| Path | `/hippo-shop/v1/session` |
| Tags | `hippo-shop`, `public-v1`, `session` |

### Route

| Field | Value | Notes |
|---|---|---|
| Name | `hippo-shop-public-session` | |
| Paths | `/public/v1/session` | Longer prefix than `/public/v1`, so it wins the match against the read route. Do **not** widen the read route's `methods` to include `POST` instead — these two need different `cors`, different rate limits, and no `proxy-cache` |
| Methods | `POST, OPTIONS` | `OPTIONS` is mandatory or the preflight 404s before `cors` ever runs |
| Protocols | `HTTP, HTTPS` (UAT) / `HTTPS` only (prod) | |
| Strip Path | **on** | Strips all of `/public/v1/session`; the service path supplies the whole upstream path |
| Preserve Host | **off** | |
| Path Handling | `v0` (default) | Confirm against the value Step 0 recorded on the read route and match it |

### Plugins

Five attached, using the vocabulary of the read route. **`5. proxy-cache` is deliberately not attached** — this is a write, and caching it would serve one visitor's session response to another.

#### 1. cors

| Field | Value | Why |
|---|---|---|
| `origins` | Explicit list — the Superfunnel subdomain (e.g. `https://sf.gundrymd.com`) plus every brand origin that boots the SDK. **No wildcards** | See Step 4. With `credentials: true` a wildcard is not merely discouraged, it is illegal |
| `methods` | `POST, OPTIONS` | **Do not copy the read route's `GET, OPTIONS`.** If you clone that plugin you get a preflight that rejects `POST` with a browser message that names no cause |
| `headers` | `X-GH-Key, X-GH-Brand, Accept, Content-Type` | The SDK's session POST sends all four. `Content-Type` matters here in a way it does not on GETs — the body makes it a non-simple request |
| `exposed_headers` | `Retry-After` | SDK reads `body.retryAfterMs` first and falls back to this header, so it is the fallback path rather than the primary — still expose it |
| `credentials` | **`true`** | The SDK posts with `credentials: 'include'`. Without this the browser discards the response's `Set-Cookie` **and reports nothing to JS** |
| `max_age` | `600` | Same as the read route |
| `preflight_continue` | `false` | Kong answers preflights; the Commerce API does not handle them |
| `private_network` | `false` | Not relevant |

#### 2. key-auth

Identical to the read route's `2. key-auth`, field for field:

| Field | Value | Why |
|---|---|---|
| `key_names` | `X-GH-Key` | Matches the SDK's request header |
| `key_in_header` | `true` | |
| `key_in_query` | `false` | Keep keys out of access logs and Referer leaks |
| `key_in_body` | `false` | The body is the session payload; a key must never be read from it |
| `hide_credentials` | `true` | Strip `X-GH-Key` before forwarding upstream |
| `anonymous` | *empty* | Missing/invalid key → `401`, no fall-through |
| `run_on_preflight` | **`false`** | **Critical.** Browser preflights carry no auth header; if `true`, every preflight 401s and CORS never runs |
| `realm` | *(default)* | OSS doesn't expose this |

#### 3. rate-limiting

See Step 5 for the arithmetic. Values: `minute` `120`, `limit_by` **`ip`**, `policy` `local`, `fault_tolerant` `true`, `hide_client_headers` `false`.

#### 4. request-transformer

| Field | Value | Why |
|---|---|---|
| `rename.headers` | `X-GH-Brand:X-Brand` | Must be `Source:Destination`, no spaces. Without it `requireBrandName` 400s every request |
| `remove.headers` | `X-Domain` | **`gh-service-utils` sets the session cookie's domain from this header with no allowlist.** On an authenticated internal route that is merely sloppy; on a public POST it is cookie-scope injection. The SDK never sends it, so removing it costs nothing |

#### 6. response-transformer

| Field | Value | Why |
|---|---|---|
| `remove.headers` | `Server, X-Powered-By` | Same stack-fingerprint strip as the read route |
| `remove.json` | *empty* | **Do not copy the read route's denylist.** The session response body is the payload the SDK consumes; a stray `_id`-style rule here silently removes a field the SDK needs |
| `add.headers` | `Cache-Control:private, no-store` | A session response must never be held by an intermediary. Kong is not caching it (no `proxy-cache`), but a CDN or corporate proxy in front might |

---

## Step 3 — `POST /public/v1/funnel-event`

This route does not touch the Commerce API. It replaces the Express hop in `hippo-builder-funnel` (`src/server/funnel-events/router.ts`), which builds its upstream request header set **from scratch** — only four headers ever reach Altern. Kong must reproduce a strictly smaller version of that set.

### Service

| Field | Value |
|---|---|
| Name | `hippo-shop-funnel-event` |
| Protocol | `https` |
| Host | Altern — UAT `uat-api-altmar.herokuapp.com`. **Prod host unconfirmed** (see "Confirm before applying") |
| Port | `443` |
| Path | `/api/v1/funnel/stats/save/` — **leading and trailing slash, both load-bearing** |
| Connect timeout | `5000` |
| Write timeout | `5000` |
| Read timeout | `5000` |
| Retries | `0` (recommended, see below) |
| Tags | `hippo-shop`, `funnel-event` |

`/api/v1` comes from the configured `ALTERN_API_URL`; `/funnel/stats/save/` is hardcoded in the proxy. The two concatenate — do not drop either half.

**Timeouts are `5000` ms on all three**, matching the Express proxy's `UPSTREAM_TIMEOUT_MS = 5_000`. Kong's default is 60000, which would leave a `keepalive` fetch hanging for a minute after page unload. The Express proxy returns `502 upstream_unreachable` on abort; Kong will return `504`. Either way the SDK does not retry.

**`retries: 0` is a recommendation, not a copied value.** Kong defaults to 5. A funnel event is a write with no idempotency key, so a Kong-level retry after a 5s write timeout can double-count a `Page View` in Salesforce. The Express proxy has no retry. Set it to 0 unless you have a reason not to.

### Route

| Field | Value | Notes |
|---|---|---|
| Name | `hippo-shop-funnel-event` | |
| Paths | `/public/v1/funnel-event` | More specific than `/public/v1`, so it wins the match |
| Methods | `POST, OPTIONS` | |
| Protocols | `HTTP, HTTPS` (UAT) / `HTTPS` only (prod) | |
| Strip Path | **on** | The public path contributes nothing upstream; the service path is the whole upstream path |
| Preserve Host | **off** | Altern would not recognise `api-prod.goldenhippo.io` |
| Path Handling | `v0` (default) | |

**Verify the trailing slash survives.** Strip Path leaves an empty remainder, and Kong joins that to the service path. Under `v0` the result should be `/api/v1/funnel/stats/save/`, but slash normalisation is exactly the sort of thing worth observing rather than reasoning about — Step 8.8 is the check. If the trailing slash is lost, the unambiguous fix is `request-transformer` `replace.uri` = `/api/v1/funnel/stats/save/`.

### The exact header set Kong must produce

| Header | Value | How | Why |
|---|---|---|---|
| `X-Brand` | Whatever `X-GH-Brand` carried | `request-transformer` `rename.headers` | The Express proxy sent its `BRAND_NAME` token (`gundry`) here; Kong will send the display name (`Gundry MD`) because a rename changes the key, not the value. Altern attributes off the **payload** `brand` field, not this header — see Step 6 |
| `Content-Type` | `application/json;charset=UTF-8` | `request-transformer` `replace.headers` **and** `add.headers` | **No space before `charset`, uppercase `UTF-8`.** This exact string is pinned by an upstream spec assertion |
| `Cookie` | *absent* | `request-transformer` `remove.headers` | The Express proxy relayed the inbound `Cookie` — a cross-origin cookie relay a browser would never perform on its own. Kong must not. `cors.credentials: false` already means the browser sends none; the removal covers non-browser callers |
| `User-Agent` | Pass through | *(default)* | The Express proxy forwarded it deliberately, to stop Node's fetch stamping its own runtime UA. Kong forwards it by default — just don't remove it |
| `Authorization` | *absent* | `request-transformer` `remove.headers` | There is no API key on the Altern call. Never introduce one here |
| `X-GH-Key` | *absent* | `key-auth` `hide_credentials: true` | A Golden Hippo consumer key must not reach a third-party upstream |
| `X-Domain` | *absent* | `request-transformer` `remove.headers` | Same cookie-scope reasoning as Step 2 |

**Do not copy the response `Content-Type`.** The Express proxy sets `application/json; charset=utf-8` — *with* a space, lowercase — on the reply to the browser, and `application/json;charset=UTF-8` — no space, uppercase — on the request to Altern. The two strings are not interchangeable. The one Kong sends upstream is the second.

### Plugins

#### 1. cors

| Field | Value | Why |
|---|---|---|
| `origins` | Explicit list — the same Superfunnel and brand origins as Step 2 | |
| `methods` | `POST, OPTIONS` | |
| `headers` | `X-GH-Key, X-GH-Brand, X-GH-Event-Id, Accept, Content-Type` | `X-GH-Event-Id` is the D9 correlation header. **The shipped SDK does not send it yet** — it exists only in a docblock — but allowlisting an unsent header costs nothing, and omitting it the day the emitter lands fails every preflight |
| `exposed_headers` | `Retry-After` | Informational only here: the SDK never retries this call, **including on `429`**. A rate-limited event is a lost event, not a delayed one |
| `credentials` | **`false`** | See Step 4 |
| `max_age` | `600` | |
| `preflight_continue` | `false` | |
| `private_network` | `false` | |

#### 2. key-auth

Identical to Step 2's table, all eight fields. `hide_credentials: true` is what keeps `X-GH-Key` off the Altern call.

#### 3. rate-limiting

`minute` `120`, `limit_by` **`ip`**, `policy` `local`, `fault_tolerant` `true`, `hide_client_headers` `false`. See Step 5.

#### 4. request-transformer

| Field | Value | Why |
|---|---|---|
| `rename.headers` | `X-GH-Brand:X-Brand` | |
| `replace.headers` | `Content-Type:application/json;charset=UTF-8` | Fires when the client sent a `Content-Type` (the SDK always does) |
| `add.headers` | `Content-Type:application/json;charset=UTF-8` | Fires when it did not. Kong's `add` is a no-op when the header is present, so both entries together are safe and cover either case |
| `remove.headers` | `Cookie, Authorization, X-Domain` | |

#### 6. response-transformer

| Field | Value | Why |
|---|---|---|
| `remove.headers` | `Server, X-Powered-By` | Don't leak a third party's stack fingerprint through our host either |
| `remove.json` | *empty* | Altern's response body passes through untouched; upstream status is passed through as-is |

**Not attached: `5. proxy-cache`.** Obviously — but state it in the config review, because the read route's plugin set is what people clone from.

**One deliberate loss of protection.** The Express route is mounted under `/api`, so it sits behind that app's CSRF validate middleware. A Kong route does not. Whether an unauthenticated public event endpoint needs a compensating control beyond `key-auth` + `limit_by: ip` is an open decision, not something this configuration settles.

---

## Step 4 — CORS

Three routes, three different answers, and every failure mode here is invisible from JavaScript.

| Route | `credentials` | Why |
|---|---|---|
| `GET /public/v1/*` (existing) | `false` | The SDK's GETs never set `credentials`, so no cookies are sent cross-origin. Unchanged |
| `POST /public/v1/session` | **`true`** | The SDK posts with `credentials: 'include'` so the Commerce API's `Set-Cookie` is stored and forwarded on later calls. Without `Access-Control-Allow-Credentials: true` **and** an explicit `Access-Control-Allow-Origin`, the browser drops the cookie and tells JS nothing — the fetch resolves `200` and the session silently never sticks |
| `POST /public/v1/funnel-event` | `false` | The SDK deliberately omits `credentials` on this call (its test asserts `req.credentials` is `undefined`). A `Cookie` could not survive a cross-site request to a different registrable domain anyway — which is precisely why the event body has to be self-sufficient for attribution |

### Wildcards are illegal with credentials

Not "discouraged" — a browser rejects `Access-Control-Allow-Origin: *` on a credentialed request outright. The two ways to get this wrong both fail quietly:

- **Wildcard + `credentials: true`** → every credentialed request fails CORS. The console message names the wildcard, but only if someone is looking.
- **Kong echoing the request's `Origin` back** → the preflight passes for *any* origin, and you have shipped an open credentialed endpoint. Nothing anywhere reports this as a problem.

So: `origins` is an explicit list on all three routes. It must include the Superfunnel subdomain and every brand origin that boots the SDK. The concrete strings are not recorded anywhere in the repos — see "Confirm before applying".

### Per-consumer CORS is still deferred

Unchanged from the read route's reasoning: browser preflights are anonymous (no `X-GH-Key`), so Kong cannot apply consumer-scoped `cors` plugins on a preflight. The route-level superset of origins remains the v1 enforcement boundary. Adding two more routes widens that superset — it does not change the model.

### The two mistakes that will actually happen

1. **Cloning the read route's `cors` plugin.** You inherit `methods: GET, OPTIONS`, and every POST preflight fails. The browser message does not mention `methods`.
2. **`run_on_preflight: true` on `key-auth`.** Preflights carry no `X-GH-Key`, so they 401 and `cors` never runs. Symptom is identical to a missing origin.

---

## Step 5 — rate limiting

This is the item most likely to break the pilot.

### The arithmetic

Verified against `packages/sdk/src`, not against docs. One offer-selector page load with six bound destinations:

| Requests | Route | Source |
|---|---|---|
| 6 × `GET /public/v1/destination/<slug>` | read route | Six *distinct* slugs, so the SDK's request cache cannot dedupe them. Three independent dedup layers guarantee six is the exact count, not an upper bound |
| 1 × `POST /public/v1/session` | session route | Once per page load, guarded by a module-level cache |
| 1 × `POST /public/v1/funnel-event` | funnel-event route | **Zero today** — `postEvent` has no call site in `packages/sdk/src`; the D9 emitter is in flight. Size for 1 |
| **7 today / 8 once the emitter lands** | | |

One publishable key is shared by every page of a brand, and the documented default is `minute: 60`, `limit_by: consumer`. That is **one bucket for the brand's entire traffic**:

```
60 requests/min ÷ 8 requests/page load  =  7.5 page loads per minute, brand-wide
60 requests/min ÷ 7 requests/page load  =  8.6 page loads per minute, brand-wide   (today, pre-emitter)
```

Single-digit page loads per minute for a whole brand. The documented "elevated tier" of `minute: 300` gives 37 page loads/min — still not a pilot number.

### `proxy-cache` does not relieve any of this

`rate-limiting` (priority 910) runs in the **access phase**; `proxy-cache` (priority 100) runs after it. A cache *hit* has already spent quota by the time the cache is consulted. The existing doc states this at `kong-public-routing.md:102` and calls it intentional — it protects the upstream from runaway clients. Correct behaviour, but it means the cache hit ratio is irrelevant to the tier you need. Size against raw request count.

Nor do the two new routes help: they carry no `proxy-cache` at all.

### The multi-dyno multiplier cuts the wrong way

With `policy: local`, counters are per dyno, so the effective ceiling is `dynos × configured` — a 2-dyno gateway at `minute: 60` tolerates up to 120/min in worst-case distribution.

That is the *ceiling*, not the floor. A single client's requests can all land on one dyno, so the number you must plan against is the configured one. Use the multiplier when you explain to a brand team why they sometimes get more headroom than the documented number; never use it to justify configuring less.

### Recommended tiers

| Route | `limit_by` | `minute` | Scope | Reasoning |
|---|---|---|---|---|
| `GET /public/v1/*` | `consumer` | `3000` | **Consumer-scoped override on the Superfunnel consumer** — leave the route-level `60` alone | 3000 ÷ 6 GETs = 500 page loads/min for the brand. Attaching it to the consumer rather than raising the route default means existing teams keep the standard tier |
| `POST /public/v1/session` | **`ip`** | `120` | Route-level | One session POST per page load. 120/min per IP is far above any real visitor and stops one client exhausting a brand-wide bucket |
| `POST /public/v1/funnel-event` | **`ip`** | `120` | Route-level | One event per page load, deduped in memory per load. Same reasoning |

Common fields on all three: `policy` `local`, `fault_tolerant` `true` (allow rather than 500 if the counter backend errors — right default for a public SDK), `hide_client_headers` `false` (so consumers see `X-RateLimit-*` and `RateLimit-*` and can self-throttle).

Three things to know about these numbers:

- **`limit_by: ip` and per-consumer overrides are mutually exclusive on a route.** A consumer-scoped `rate-limiting` instance *shadows* the route-level instance for that consumer — it does not stack. So the write routes get IP limiting *or* consumer limiting, not both. IP is the right choice: the threat is one visitor, not one brand.
- **`limit_by: ip` has a CGNAT tail.** Mobile carriers and corporate proxies put many real visitors behind one address. `120` is chosen with that headroom in mind; watch the UAT 429 rate before prod rather than trusting the number.
- **A Kong `429` is not a `HippoShopErrorDTO`.** The rate-limiting plugin terminates in the access phase, so the request never reaches the Commerce API's error handler. The body has no `code` field and the SDK falls back to deriving the code from the status. Expected, not a bug — but it means a 429 storm looks different in SDK telemetry than an upstream error.

### Not pilot scope, but size against it

Six sequential destination `GET`s per page is an N+1 shape. A batch destination endpoint would cut a page load from eight requests to three, and the tier by the same factor. Flagged only because the numbers above are sized against the unbatched count.

---

## Step 6 — the brand token: nothing to do at Kong

Read this so you can decline the request when it comes.

Altern reads the **payload** `brand` field, not the `X-Brand` header, and it expects the `BRAND_NAME` token vocabulary — `gundry` — not the public display name — `Gundry MD`. Both land in the same Salesforce column, so a wrong value is silent mis-attribution, not an error.

Kong cannot fix it:

- **`rename.headers` changes a header key, not a value**, and not a JSON body value at all. `X-GH-Brand:X-Brand` moves `Gundry MD` from one header name to another; it never becomes `gundry`.
- **`replace.body` would mean per-consumer body rewriting on a route that every brand shares.** One route, one plugin instance, N brands — the mapping would have to be a per-consumer plugin instance carrying a hardcoded brand token, which is configuration that drifts the moment a brand is added.

So the SDK carries it: `config.ts` now parses a `data-brand-token` script-tag attribute into `GhConfig.brandToken`, and the event builder reads `brandToken ?? brand`.

**The consequence that lands on you anyway:** a page whose script tag omits `data-brand-token` falls back to the display name and mis-attributes every event, with a `200` from Altern and nothing in any log. When a brand reports missing funnel events and the gateway looks healthy, check the embed's script tag before you check Kong.

The `X-Brand` header Kong injects on the funnel-event route will carry the display name for the same reason. That is believed to be harmless because Altern attributes off the payload — listed under "Confirm before applying".

---

## Step 7 — the undocumented rewrite

`docs/architecture/kong-public-routing.md` says the `/public/v1` route has **Strip Path off** because "Upstream needs the full `/public/v1/…` path — that's where its handlers are mounted", and that the service Path is empty because "paths flow through unchanged".

**That is false, and it has been false since the first `/public/v1` route was published.** The Commerce API has no `/public` handler at all: `HippoShopController.basePath = 'hippo-shop'` and its routes are declared as `/v1/product/:productSlugOrId`, `/v1/funnel/:funnelSlugOrId`, `/v1/destination/:destinationSlugOrId`. The SDK calls `/public/v1/*` and works in UAT and prod, so a rewrite exists at the edge that the doc does not describe. No `/public/v1` request has ever reached the upstream unchanged.

| Hop | Path |
|---|---|
| Browser → Kong | `/public/v1/product/bio-complete-3` |
| Kong → Commerce API | `/hippo-shop/v1/product/bio-complete-3` |

The most likely mechanism — and the one Steps 2 and 3 are written against — is route `strip_path: on` with a service `path` of `/hippo-shop/v1`. **Confirm it from the Admin API (Step 0) before propagating it.** Alternatives that would produce the same observable behaviour and would need Steps 2 and 3 configured differently:

- a `pre-function` plugin calling `kong.service.request.set_path`
- a different `path_handling` value doing the join
- service path `/hippo-shop` paired with route path `/public`

Whatever is live, **use the same mechanism on the two new routes**. Mixing a `strip_path` rewrite on one route with a `pre-function` rewrite on another is how a gateway becomes unmaintainable.

### `PUBLIC_SDK_PATH_PREFIX` is coupled to the rewrite target

The Commerce API chooses which error shape to emit by prefix-matching the **upstream** path:

```ts
// src/middleware/errorHandler.middleware.ts:15
const PUBLIC_SDK_PATH_PREFIX = '/hippo-shop/'
```

A request whose path starts with that prefix gets the public wire shape, `HippoShopErrorDTO` — `{ code, message, retryAfterMs? }`. Everything else gets the internal `IError` shape — `{ status, name, message, fields }`.

| Side | Value | Where |
|---|---|---|
| Kong rewrite target | `/hippo-shop/v1/…` | Service `path` + route `strip_path` |
| Commerce prefix test | `/hippo-shop/` | `errorHandler.middleware.ts:15` |

**If those drift apart, nothing fails loudly.** Success responses are untouched, so a happy-path smoke test stays green. Only error responses change, and they change silently: they regress to the internal `IError`, which carries no `code`, so the SDK's `body.code` lookup finds nothing and every error falls back to a status-derived code. A brand-authorization `403` stops being distinguishable from any other `403`, the deliberately-ambiguous "Resource not found" message is replaced by the raw internal one, and a body-supplied `retryAfterMs` is lost on `429`s. The SDK does not break — it just stops being able to tell errors apart.

Step 8.9 is the check that catches drift. Run it after any path change on any of the three routes.

The routing doc still carries the false rows; correcting it is queued work in the Cluster G plan (Steps 25–30) and is not done.

---

## Step 8 — verification

Run in order after each step. Each isolates a single failure mode.

```bash
BASE=https://api-uat.goldenhippo.io
KEY=gh_pk_...                        # a valid consumer key
BRAND="Gundry MD"                    # the display name — what the SDK sends
BRAND_TOKEN=gundry                   # the Altern payload token — NOT sent as a header
ORIGIN=https://sf.gundrymd.com       # the Superfunnel origin
SLUG=bio-complete-3

H_CORS=(-H "Origin: $ORIGIN")
H_AUTH=(-H "X-GH-Key: $KEY" -H "X-GH-Brand: $BRAND")

# 1) SDK bundle is served on the new CDN line
curl -sI "$BASE/sdk/v4/gh.js" | grep -iE 'HTTP|content-type|content-length|cache-control'

# 2) Preflight on the session route → 204 + credentialed CORS headers
curl -i -X OPTIONS "${H_CORS[@]}" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: x-gh-key, x-gh-brand, content-type" \
  "$BASE/public/v1/session" | grep -iE 'HTTP|access-control'

# 3) Real session POST → 200, cookie set, no stack fingerprint
curl -i -X POST "${H_CORS[@]}" "${H_AUTH[@]}" \
  -H "Content-Type: application/json" \
  --data '{"sessionId":"11111111-2222-4333-8444-555555555555","affParameters":{}}' \
  "$BASE/public/v1/session" \
  | grep -iE 'HTTP|set-cookie|access-control|x-ratelimit|^server|^x-powered'

# 4) Session POST with no key → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST "${H_CORS[@]}" \
  -H "Content-Type: application/json" --data '{}' "$BASE/public/v1/session"

# 5) X-Domain injection is stripped — the cookie Domain must NOT be attacker.example
curl -i -X POST "${H_CORS[@]}" "${H_AUTH[@]}" \
  -H "Content-Type: application/json" -H "X-Domain: attacker.example" \
  --data '{"sessionId":"11111111-2222-4333-8444-555555555555"}' \
  "$BASE/public/v1/session" | grep -i 'set-cookie'

# 6) Preflight on the funnel-event route → 204, NO credentials header
curl -i -X OPTIONS "${H_CORS[@]}" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: x-gh-key, x-gh-brand, x-gh-event-id, content-type" \
  "$BASE/public/v1/funnel-event" | grep -iE 'HTTP|access-control'

# 7) Real funnel-event POST → upstream status passes through
curl -i -X POST "${H_CORS[@]}" "${H_AUTH[@]}" \
  -H "Content-Type: application/json" \
  -H "X-GH-Event-Id: 99999999-8888-4777-8666-555555555555" \
  --data "{\"brand\":\"$BRAND_TOKEN\",\"eventType\":\"Page View\",\"funnelSTFId\":\"<known-id>\"}" \
  "$BASE/public/v1/funnel-event" | grep -iE 'HTTP|content-type|x-ratelimit'

# 8) Establish what the trailing slash is worth, BEFORE blaming Kong.
#    Hit Altern directly both ways; the pair of status codes tells you which one Kong must send.
for P in /api/v1/funnel/stats/save/ /api/v1/funnel/stats/save; do
  printf '%s -> ' "$P"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    -H 'Content-Type: application/json;charset=UTF-8' -H "X-Brand: $BRAND_TOKEN" \
    --data '{}' "https://uat-api-altmar.herokuapp.com$P"
done

# 9) Error-shape drift check — public shape has `code`, internal shape has `status`/`name`/`fields`
curl -s "${H_CORS[@]}" "${H_AUTH[@]}" "$BASE/public/v1/product/no-such-slug-xyz"

# 10) Confirm the elevated read tier without firing 3000 requests
curl -sI "${H_CORS[@]}" "${H_AUTH[@]}" "$BASE/public/v1/product/$SLUG" | grep -i 'ratelimit'

# 11) 429 burst on a write route (tier is 120/min, limit_by ip) — expect ~30 rejections
for i in $(seq 1 150); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "${H_CORS[@]}" "${H_AUTH[@]}" \
    -H "Content-Type: application/json" --data '{}' "$BASE/public/v1/funnel-event"
done | sort | uniq -c
```

Expected outcomes:

| Step | Pass criterion |
|---|---|
| 1 | `200`, `content-type: application/javascript`, non-trivial `content-length`. A Cloudflare error page here means Preserve Host is on |
| 2 | `204`; `Access-Control-Allow-Origin: https://sf.gundrymd.com` (the exact origin, never `*`); `Access-Control-Allow-Credentials: true`; `Access-Control-Allow-Methods` includes `POST`; `Access-Control-Allow-Headers` includes `x-gh-key` and `content-type` |
| 3 | `200`, JSON body, `Set-Cookie` present, `Access-Control-Allow-Origin` echoing the exact origin, `X-RateLimit-Limit-Minute: 120`; **no** `Server` or `X-Powered-By`. A `400` "Brand name is required" means the `request-transformer` rename is missing or malformed |
| 4 | `401` |
| 5 | `Set-Cookie` `Domain` is the brand domain, **not** `attacker.example`. If it is, `remove.headers: X-Domain` is not applied |
| 6 | `204`; exact-origin `Access-Control-Allow-Origin`; **no** `Access-Control-Allow-Credentials`; `Access-Control-Allow-Headers` includes `x-gh-event-id` |
| 7 | Whatever Altern returns for a valid event, passed through unchanged. A `404` here almost always means the trailing slash was lost — go to step 8 |
| 8 | Two different status codes. The one that is *not* `404` is the path Kong must produce |
| 9 | Body has `code` and `message`. If it has `status`, `name`, `fields`, the rewrite target no longer starts with `/hippo-shop/` — Step 7 |
| 10 | `X-RateLimit-Limit-Minute: 3000` for the Superfunnel consumer, `60` for any other consumer's key |
| 11 | ~120 × `200`/`2xx`, ~30 × `429`. All from one IP, so this exercises `limit_by: ip` |

Common failure modes and which plugin to look at first:

| Symptom | Likely cause |
|---|---|
| POST preflight fails, GET preflight is fine | `cors` `methods` on the new route is still `GET, OPTIONS` — cloned from the read route |
| `CORS preflight did not succeed` on any new route | `run_on_preflight: true` on `key-auth`, OR the origin is not in that route's `origins` list |
| Session POST returns `200` but the cookie never appears | `cors.credentials` is `false` on the session route, or the upstream cookie lacks `SameSite=None; Secure` |
| `Access-Control-Allow-Origin: *` on a credentialed route | Wildcard `origins` with `credentials: true` — illegal, and the browser will reject every credentialed call |
| Session POST → `400` "Brand name is required" | `request-transformer` not attached, or `rename.headers` malformed (must be `Source:Destination`, no spaces) |
| Session POST → `401` with a valid key | Route pointed at `/session` instead of `/hippo-shop/v1/session` — you hit the auth-protected `SessionController` |
| Session POST → `404` | Service `path` is `/hippo-shop/v1` with `strip_path: on`, producing `/hippo-shop/v1/`. It must be `/hippo-shop/v1/session` |
| funnel-event → `404` from Altern | Trailing slash lost — service `path` or `path_handling` |
| funnel-event → `504` at exactly 60s | Timeouts left at Kong's default instead of `5000` |
| funnel-event `2xx` but rows never appear in Salesforce | Payload `brand` is the display name — the embed is missing `data-brand-token` (Step 6), or `funnelSTFId` is blank and the upstream dropped it silently |
| `429` at ~60/min despite the elevated tier | The consumer-scoped override is attached to the wrong consumer, or to the service rather than the route |
| Errors carry `status`/`name`/`fields` instead of `code` | Rewrite target and `PUBLIC_SDK_PATH_PREFIX` have drifted — Step 7 |
| `Retry-After` is `null` in the SDK | `cors` `exposed_headers` on that route doesn't include it |

---

## Confirm before applying

Every item below is something this guide could not verify from source. Do not guess at any of them.

1. **The live `/public/v1` route and service config.** The rewrite mechanism (`strip_path` + service `path` vs a `pre-function` plugin vs `path_handling`) was never read from the Admin API. Steps 2 and 3 assume `strip_path: on` + service path — confirm before propagating it. This is the single highest-value check in the document.
2. **The live `/sdk/v3` route and service config.** Step 1's tables are derived, not copied. Copy the working v3 route's shape and reconcile any difference in its favour.
3. **The live `CUSTOM_PLUGINS` value** on all four Sentinel apps (gateway + gui, UAT + prod). The documented six-plugin CSV is a stated *minimum*, and the extra entries named in the doc are explicitly examples.
4. **The concrete `cors` `origins` strings.** Nowhere in any repo — the routing doc describes the list only as prose. The Superfunnel subdomain used above (`https://sf.gundrymd.com`) is illustrative.
5. **The Commerce API internal `Host` and `Port`** for `hippo-shop-public-v1`. Both are prose placeholders in the routing doc; Step 2's service must reuse the real values.
6. **Altern's production host.** Only the UAT value (`uat-api-altmar.herokuapp.com/api/v1`) is active in the funnel repo's `.env`; the prod line (`prod-ps-api-altmar.herokuapp.com/api/v1`) is commented out and the real Heroku config var was not read.
7. **Whether `POST /hippo-shop/v1/session` exists yet.** The SDK ships the caller; the handler is Workstream 2 work on `GH-Commerce-Service@prerelease`. `HippoShopService` has no session method today. Configure the route only after the endpoint answers.
8. **Whether Altern reads the `X-Brand` header at all.** Kong will send the display name there. This is believed harmless because attribution comes from the payload `brand` field, but it is an inference from plan documents, not from Altern's code.
9. **Whether Altern validates the relayed `Cookie`.** The Express proxy forwards it; Kong will not. If Altern does anything with cookie state beyond attribution capture, behaviour will differ.
10. **Trailing-slash behaviour under `path_handling: v0`.** Step 8.8 settles it empirically. The `replace.uri` fallback is there if the slash is lost.
11. **`retries: 0` on the funnel-event service** is a recommendation, not an observed value. Kong's default is 5, and a retry after a write timeout can double-count an event.
12. **The rate-limit numbers are sized, not measured.** `3000`/`120`/`120` are derived from the verified 7–8 requests per page load against an assumed pilot ceiling. Watch the UAT `429` rate — particularly on the `limit_by: ip` write routes, where CGNAT can put many real visitors behind one address — before promoting them to prod.
13. **The session cookie's `SameSite=None; Secure` attributes** are the Commerce API's responsibility, not Kong's. `cors.credentials: true` is necessary but not sufficient; without those attributes the browser drops the cookie and reports nothing.
14. **Whether the funnel-event route needs a compensating control for the CSRF protection it bypasses.** The Express route sits behind `/api`'s CSRF validate middleware by mount position; a Kong route does not.
15. **The plugin priorities `800` (response-transformer) and `801` (request-transformer)** are repeated from the existing routing doc and were not checked against Kong 3.9.1's actual schema. Same for the claim that `key-auth`'s `realm` is Enterprise-only. Neither affects any value above.
16. **`X-GH-Event-Id` is not sent by the shipped SDK** — it exists only in a docblock, and no code mints an event id. Allowlisting it in `cors.headers` is deliberate pre-provisioning, not a description of current traffic.