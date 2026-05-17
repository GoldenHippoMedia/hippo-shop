# Kong public-v1 routing

How the public `/public/v1/*` route is wired in Kong — the service, the route, the six plugins, and the order they run in. Companion to [`cloudflare-deploy.md`](./cloudflare-deploy.md), which covers the `/sdk/v1/gh.js` delivery path.

## At a glance

```
Embedding page                Kong (api-{uat,prod}.goldenhippo.io)         Commerce API (private)
────────────────────────  ─────────────────────────────────────────────  ────────────────────────
GET /public/v1/product/x  ─►  Route /public/v1 matches                  ─►  GET /public/v1/product/x
X-GH-Key: gh_pk_…             1.  cors           preflight + headers        X-Brand: Gundry MD
X-GH-Brand: Gundry MD         2.  key-auth       gh_pk_* → consumer         (consumer headers from
Origin: https://…             3.  rate-limiting  per-consumer 60/min         Kong: X-Consumer-Id,
                              4.  request-trans. rename X-GH-Brand→X-Brand   X-Consumer-Username)
                              5.  proxy-cache    serve hit / store miss
                              6.  response-trans. strip leak-prone headers
                              (response phase: cors adds Access-Control-*)
```

Trust boundary: Kong. The Commerce API trusts the request as already-authenticated by the gateway. The SDK contains no auth logic — it forwards `X-GH-Key` and `X-GH-Brand`; Kong validates and translates.

## Prerequisites — the Sentinel allowlist

The gateway image at [`GoldenHippoMedia/Sentinel-API-Gateway`](https://github.com/GoldenHippoMedia/Sentinel-API-Gateway) enforces an explicit plugin allowlist via the `CUSTOM_PLUGINS` env var; Kong's default `bundled` opt-in is not used. Before any of the plugins below can be selected in the Admin UI, the env var must include them.

Minimum value for the hippo-shop route stack:

```
cors,key-auth,rate-limiting,request-transformer,proxy-cache,response-transformer
```

Plus whatever the existing list already contains (e.g., `ip-restriction,correlation-id,detailed-logger`). To extend:

```bash
heroku config:get CUSTOM_PLUGINS -a <uat-gateway-app>
# append the missing entries, then:
heroku config:set CUSTOM_PLUGINS="…existing…,rate-limiting,request-transformer,proxy-cache,response-transformer" -a <uat-gateway-app>
# repeat for the gui dyno and prod
```

Dyno restarts on set. The same `CUSTOM_PLUGINS` value should be applied to *every* Sentinel app (gateway and gui) so the Admin UI shows the same plugin picker the gateway can actually execute.

## Kong version

Sentinel runs Kong **OSS 3.9.1**. This matters because two pieces of the original plan referenced features that are Enterprise-only:

| Plan reference | OSS reality |
|---|---|
| `request-validator` plugin (per-consumer origin enforcement) | Not in OSS. Origin enforcement is route-level cors superset for v1; per-consumer enforcement is a small pre-function plugin (see "Known limitations" below) |
| `response-transformer` with nested JSON paths and conditional transforms | OSS plugin operates on top-level JSON only. Nested-field enforcement is the integration-test layer in the commerce repo (DTO key allowlist) |

## Service

Single service backs the route.

| Field | Value |
|---|---|
| Name | `hippo-shop-public-v1` |
| Protocol | `https` (or `http` for in-mesh) |
| Host | The internal Commerce API hostname (private DNS / mesh address) |
| Port | Whatever the upstream listens on |
| Path | *empty* — paths flow through unchanged |
| Tags | `hippo-shop`, `public-v1` |

## Route

Single route attached to the service.

| Field | Value | Notes |
|---|---|---|
| Name | `hippo-shop-public-v1` | |
| Paths | `/public/v1` | Plain (non-`~`) path = prefix match. Matches `/public/v1/funnel/x`, `/public/v1/destination/x`, `/public/v1/product/x` |
| Methods | `GET` | Public surface is read-only; locking to `GET` lets Kong reject accidental POSTs with `405` before reaching upstream |
| Protocols | `HTTP, HTTPS` (UAT) / `HTTPS` only (prod) | |
| Strip Path | **off** | Upstream needs the full `/public/v1/…` path — that's where its handlers are mounted |
| Preserve Host | **off** | Upstream sees the internal hostname; it doesn't need to know the public name |
| Path Handling | `v0` (default) | Service has no path; v0/v1 behave identically here |

## Plugin priorities (the order things run in)

Kong runs plugins in **descending priority** during the access phase and in ascending priority during the response phase. Knowing the order saves debugging time.

```
ACCESS phase  (higher priority first):

  cors                 (2000)   responds to OPTIONS preflight; otherwise no-op
  key-auth             (1003)   validates X-GH-Key, identifies consumer
  rate-limiting        ( 910)   counts requests per consumer
  request-transformer  ( 801)   renames X-GH-Brand → X-Brand (consumer already known)
  proxy-cache          ( 100)   cache hit → terminate + serve / miss → continue
                                  ⬇ upstream Commerce API
RESPONSE phase  (lower priority first):

  proxy-cache          ( 100)   stores the raw upstream body
  response-transformer ( 800)   strips internal headers + top-level JSON keys
  cors                 (2000)   adds Access-Control-* using the current request's Origin
```

Two consequences worth internalizing:

1. **cors decorates cached responses correctly.** The cache stores a CORS-agnostic body; cors response-phase appends the right `Access-Control-Allow-Origin` per request. You do not need to vary the cache key by `Origin`.
2. **Cache hits still count toward rate limits.** rate-limiting (access phase) runs before proxy-cache, so a consumer repeatedly hitting a hot cached URL spends quota. That's intentional — protects upstream from runaway clients.

## 1. cors

| Field | Value | Why |
|---|---|---|
| `origins` | Explicit list — every origin any consumer uses (no wildcards) | Required for browser preflight to succeed |
| `methods` | `GET, OPTIONS` | OPTIONS is mandatory; `GET` is the only verb we serve |
| `headers` | `X-GH-Key, X-GH-Brand, Accept, Content-Type` | **Must include `X-GH-Key`** — preflight checks it against the allowlist |
| `exposed_headers` | `Retry-After` | The SDK reads this on 429s. Without exposing it, `res.headers.get('Retry-After')` returns `null` in browser JS |
| `credentials` | `false` | We don't use cookies; auth is in a custom header |
| `max_age` | `600` | 10-minute preflight cache. Long enough to amortize preflight cost; short enough that origin-list changes propagate within a workday |
| `preflight_continue` | `false` | Kong must answer preflights itself; the Commerce API doesn't handle them |
| `private_network` | `false` | Chrome PNA spec; not relevant |

**Per-consumer CORS is deferred.** Browser preflights are anonymous (no `X-GH-Key`), so Kong can't apply consumer-scoped cors plugins on preflight. The route-level superset of origins is the v1 enforcement boundary; per-consumer origin pinning lives in a future pre-function plugin (see "Known limitations").

## 2. key-auth

| Field | Value | Why |
|---|---|---|
| `key_names` | `X-GH-Key` | Matches the SDK's request header |
| `key_in_header` | `true` | |
| `key_in_query` | `false` | Keep keys out of access logs and Referer leaks |
| `key_in_body` | `false` | GET-only |
| `hide_credentials` | `true` | Strip `X-GH-Key` before forwarding upstream — the Commerce API has no business seeing consumer keys |
| `anonymous` | *empty* | Missing/invalid key → `401`, no fall-through |
| `run_on_preflight` | **`false`** | **Critical.** Browser preflights carry no auth header; if `true`, every preflight 401s and CORS never runs |
| `realm` | *(default)* | OSS doesn't expose this — Enterprise-only field |

Credentials hang off Consumers. See "Per-consumer setup" below for the workflow (consumer + key-auth credential + origin tags + rate tier).

## 3. rate-limiting

| Field | Value | Why |
|---|---|---|
| `minute` | `60` (standard tier) | Standard tier for the route; elevated tier (300/min) is a per-consumer override plugin instance |
| `limit_by` | `consumer` | Per-consumer buckets; falls back to `ip` automatically for un-authenticated requests (preflights) |
| `policy` | `local` | Per-dyno counters. Phase 2/3 traffic doesn't justify the Redis add-on. Switch to `redis` if/when strict cross-dyno limits matter |
| `fault_tolerant` | `true` | If the rate-limiting backend errors, allow rather than 500. Right default for a public SDK |
| `hide_client_headers` | `false` | Send `X-RateLimit-*` and standardized `RateLimit-*` headers so consumers can self-throttle |

**Tier overrides:** per-consumer rate-limiting plugin instances shadow the route-level instance for that consumer. The elevated tier is a separate plugin attached to the specific consumer with `minute: 300`; everyone else continues to be governed by the route-level 60.

**Multi-dyno math:** with `local` policy, the effective limit is `dynos × configured`. A 2-dyno gateway running "60/min standard" tolerates up to 120/min in worst-case dyno distribution. Document this when communicating the change to teams using the route.

## 4. request-transformer

| Field | Value | Why |
|---|---|---|
| `rename.headers` | `X-GH-Brand:X-Brand` | The SDK sends the public name; the existing Commerce API expects `X-Brand`. Kong bridges so neither side has to change |

The Commerce API trusts Kong's own request directly — no separately-injected credential header. Consumer identity is forwarded by `key-auth` via the standard `X-Consumer-Id` / `X-Consumer-Username` headers if the Commerce API ever needs to attribute requests.

## 5. proxy-cache

| Field | Value | Why |
|---|---|---|
| `strategy` | `memory` | Per-dyno cache. Phase 2/3 traffic doesn't justify Redis |
| `memory.dictionary_name` | `kong_db_cache` (default) | Don't change unless an explicit nginx shared_dict is configured |
| `cache_ttl` | `60` | Fallback TTL when upstream doesn't set Cache-Control |
| `cache_control` | `true` | Honor upstream `Cache-Control` so the Commerce API can drive per-resource TTLs (60s funnel/destination, 120s product) without route splitting |
| `response_code` | `[200]` | Don't cache 404 — brand-mismatch 404s would poison the cache against real resources |
| `request_method` | `[GET]` | |
| `content_type` | `["application/json", "application/json; charset=utf-8"]` | **Both forms** — Kong does exact match on Content-Type. If the Commerce API emits a charset, the bare form misses everything |
| `vary_headers` | `["X-Brand"]` | Brand affects body content. **Do not add `Origin`** — cors decorates cache hits per-request; Origin in the cache key just wastes memory |
| `vary_query_params` | *empty* | No query params today |
| `bypass_on_err` | `false` | Fail loudly on cache backend errors rather than silently bypass |

**Memory strategy + multi-dyno caveat:** each dyno has its own cache. Cache invalidation via Admin API hits whichever dyno is currently serving the call; full-fleet purge requires fan-out or a dyno restart. At 60s TTL this is rarely a problem; flag it as the line where Redis becomes worth its cost.

**Observability headers Kong adds:**

| Header | Meaning |
|---|---|
| `X-Cache-Status: Hit\|Miss\|Refresh\|Bypass` | Cache outcome for this request |
| `X-Cache-Key: <sha1>` | Composed cache key — useful when two requests should share an entry but don't |
| `Age: <seconds>` | Age of the served entry; confirms TTL |

## 6. response-transformer

| Field | Value | Why |
|---|---|---|
| `remove.headers` | `Server, X-Powered-By` (extend with any internal debug headers) | Strip backend stack-fingerprint headers |
| `remove.json` | Top-level denylist agreed with Commerce team, e.g. `_id, __v, internalNotes, cost, costBasis, salesforceId, createdBy, updatedBy, testMode, draftMode` | Defense-in-depth. **Top-level only** in OSS — nested-field enforcement lives in the commerce repo's integration tests |
| `add.headers` | *(optional)* `Cache-Control:public, max-age=60` | Only set this if the Commerce API isn't yet emitting Cache-Control. Remove once the API takes over |
| Everything else | empty | |

**The real defense is upstream.** The commerce-side integration tests (plan §3.2 rule 4) assert each handler's response matches the published DTO and contains *only* the DTO's keys. That test catches nested leaks; this plugin is the belt to those suspenders. Don't list nested paths here and assume they're stripped.

## Verification — the consolidated smoke test

After every config change, run these in order. Each one isolates a single failure mode.

```bash
BASE=https://api-uat.goldenhippo.io
KEY=gh_pk_...                       # a valid consumer key
BRAND="Gundry MD"
ORIGIN=https://www.gundrymd.com     # an allowed origin
SLUG=bio-complete-3                 # a known product slug

H_CORS=(-H "Origin: $ORIGIN")
H_AUTH=(-H "X-GH-Key: $KEY" -H "X-GH-Brand: $BRAND")

# 1) Preflight from an allowed origin → 204 + CORS headers
curl -i -X OPTIONS "${H_CORS[@]}" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-gh-key, x-gh-brand" \
  "$BASE/public/v1/product/$SLUG" | grep -i 'HTTP\|access-control'

# 2) Preflight from a disallowed origin → no Access-Control-Allow-Origin
curl -i -X OPTIONS -H "Origin: https://attacker.example" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-gh-key" \
  "$BASE/public/v1/product/$SLUG" | grep -i 'access-control-allow-origin'

# 3) No key → 401
curl -i "${H_CORS[@]}" "$BASE/public/v1/product/$SLUG" | head -1

# 4) Real call → 200 + DTO, plus observability headers
curl -i "${H_CORS[@]}" "${H_AUTH[@]}" "$BASE/public/v1/product/$SLUG" \
  | grep -iE 'HTTP|x-cache-status|x-ratelimit|access-control|^server|^x-powered'

# 5) Same call again within 60s → X-Cache-Status: Hit
curl -i "${H_CORS[@]}" "${H_AUTH[@]}" "$BASE/public/v1/product/$SLUG" \
  | grep -i 'x-cache-status'

# 6) Cross-brand → X-Cache-Status: Miss (cache key includes X-Brand)
curl -i "${H_CORS[@]}" \
  -H "X-GH-Key: $KEY" -H "X-GH-Brand: Beverly Hills MD" \
  "$BASE/public/v1/product/$SLUG" | grep -i 'x-cache-status'

# 7) Rate-limit burst (expect ~10 of these to come back 429)
for i in $(seq 1 70); do
  curl -s -o /dev/null -w "%{http_code}\n" "${H_CORS[@]}" "${H_AUTH[@]}" \
    "$BASE/public/v1/product/$SLUG"
done | sort | uniq -c
```

Expected outcomes:

| Step | Pass criterion |
|---|---|
| 1 | `204`, `Access-Control-Allow-Origin: https://www.gundrymd.com`, `Access-Control-Allow-Headers` includes `X-GH-Key, X-GH-Brand` |
| 2 | `204` with **no** `Access-Control-Allow-Origin` header |
| 3 | `401` |
| 4 | `200`, JSON body, headers include `X-Cache-Status: Miss`, `X-RateLimit-Limit-Minute: 60`, `Access-Control-Allow-Origin: …`; **no** `Server` or `X-Powered-By` |
| 5 | `X-Cache-Status: Hit` |
| 6 | `X-Cache-Status: Miss` (different brand → different cache key) |
| 7 | ~60 × `200`, ~10 × `429` |

Common failure modes and which plugin to look at first:

| Symptom | Likely cause |
|---|---|
| `CORS preflight did not succeed` in browser | `run_on_preflight: true` on key-auth, OR Origin not in cors `origins` list |
| `Request header field X-GH-Key is not allowed` | cors `headers` config doesn't include `X-GH-Key` |
| `Retry-After is null` in SDK on 429 | cors `exposed_headers` doesn't include `Retry-After` |
| Every request shows `X-Cache-Status: Bypass` | proxy-cache `content_type` doesn't include the variant the upstream actually sends |
| Cross-brand requests see each other's data | proxy-cache `vary_headers` missing `X-Brand` |
| Real 401 on a valid call | key-auth attached but `key_names` doesn't match SDK's `X-GH-Key`, OR `hide_credentials: true` on a stale plugin instance with old `key_names` |
| Upstream sees `X-GH-Brand` instead of `X-Brand` | request-transformer not attached, or `rename.headers` entry malformed (must be `Source:Destination`, no spaces) |

## Per-consumer setup

The route + plugin stack above is **one-time platform plumbing**. Each Golden Hippo team using this route gets a Kong consumer plus credentials:

1. Create a Kong consumer with a stable slug (currently named `partner-<slug>` for legacy reasons — the slug names an internal team or brand, not an external partner).
2. Attach a `key-auth` credential. The plaintext key is shown once at creation; store it in 1Password.
3. Add the team's origins to the route-level `cors` plugin `origins` list. No wildcards.
4. (Optional) Create a consumer-scoped rate-limiting override if the team needs the elevated tier.

## Known limitations / future work

1. **Per-consumer origin enforcement.** Today the route-level cors `origins` list is the union of all allowed origins. Any consumer with a valid key can call from any allowed origin. For tighter enforcement when consumer count grows past a handful, add a small pre-function plugin (priority just below `request-transformer`) that compares the authenticated consumer's tags (`origin:<url>`) against the inbound `Origin` header and `kong.response.exit(403)` on mismatch.

2. **Memory-strategy cache purge.** Single Admin API DELETE only purges the dyno serving the request. Documented in [`incident-response.md`](./incident-response.md). Switching to `redis` strategy resolves this.

3. **Sentinel `CUSTOM_PLUGINS` is Heroku-only.** The plugin allowlist lives in Heroku config, not in `kong.conf`. A local run of the Sentinel image without `CUSTOM_PLUGINS` set will exit hard (intentional safety net). Optional follow-up: bake a default in `kong.conf` and let the env var override.

## Cross-references

- [`cloudflare-deploy.md`](./cloudflare-deploy.md) — SDK bundle delivery (separate route, no auth)
- [`incident-response.md`](./incident-response.md) — cache purge, key revocation, rollback runbooks
- [`hippo-shop-combined-implementation-plan.md`](./hippo-shop-combined-implementation-plan.md) — original architecture and rationale
