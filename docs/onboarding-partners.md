# Onboarding a partner — Kong Admin UI walkthrough

> **Internal-only.** v1 of Hippo Shop is gated behind operational sign-off.
> No external partner keys should be issued until partner-relations has
> approved the partner.

This doc covers the **per-partner** workflow. The **one-time** route + plugin setup (the cors, key-auth, rate-limiting, request-transformer, proxy-cache, response-transformer stack) lives in [`kong-public-routing.md`](./kong-public-routing.md).

## Prerequisites

- Access to the Kong Admin UI (ask platform).
- The partner's brand assignment confirmed (e.g. `Gundry MD`).
- The partner's exact set of `Origin` headers (the URLs their pages will be served from).
- A rate-limit tier decision (default: standard).

## Steps

1. **Create the consumer.**
   - Kong Admin UI → Consumers → New consumer.
   - Username: `partner-<slug>` (e.g. `partner-netlify-gundry`).
   - Custom ID: leave blank.
   - Tags: `brand:<brand-slug>`, `partner`.

2. **Create the publishable key.**
   - Open the consumer → Credentials → Key Auth → Add credential.
   - Key format: `gh_pk_<consumer-slug>_<random-hex>` (e.g. `gh_pk_netlify_gundry_a1b2c3d4`).
   - The key is **publishable** — it will live in plain text on partner pages. Treat it like a Stripe `pk_*`, not a secret.
   - Record the key in the partner-relations vault.

3. **Add the partner's origins to the route-level CORS allowlist.**
   - Kong Admin UI → Routes → `hippo-shop-public-v1` → Plugins → CORS.
   - Append the partner's exact origins to `config.origins`:
     - `https://www.example.com`
     - `https://staging.example.com`
   - Wildcards are not permitted. Add each subdomain explicitly.
   - Also tag the **consumer** (not the plugin) with one tag per origin: `origin:https://www.example.com`, `origin:https://staging.example.com`. The tags don't enforce anything today, but they're the input shape the future per-consumer origin pre-function will key off (see [`kong-public-routing.md`](./kong-public-routing.md) → "Known limitations").
   - **Per-consumer CORS plugin overrides don't work in OSS Kong** — browser preflights are anonymous, so Kong can't identify the consumer on `OPTIONS`. Today the route-level superset is the enforcement boundary.

4. **Set the rate-limit tier.**
   - Standard tier (default): nothing to do — the route-level `rate-limiting` plugin already applies 60 req/min per consumer.
   - Elevated tier (requires partner-relations sign-off): attach a **consumer-scoped** `rate-limiting` plugin to this consumer with `minute: 300`, `limit_by: consumer`, `policy: local`. This shadows the route-level instance for this consumer only.

5. **Assign the brand binding.**
   - The SDK sends `X-GH-Brand`; Kong's `request-transformer` plugin renames it to `X-Brand` before the request reaches the Commerce API, which enforces brand tenancy on `X-Brand`. Neither side reads `X-GH-Brand` directly; the rename happens at the gateway.
   - Add `brand:<brand-slug>` to the consumer's tags so it shows up in dashboards.

6. **Verify.**
   - From an allowed origin, run:
     ```bash
     curl -i \
       -H "X-GH-Key: gh_pk_..." \
       -H "X-GH-Brand: Gundry MD" \
       -H "Origin: https://www.example.com" \
       "https://api-prod.goldenhippo.io/public/v1/product/<known-slug>"
     ```
   - Expect: 200 + JSON.
   - From a *disallowed* origin: expect CORS preflight failure.
   - With a forged key: expect 401.

## Handoff to the partner

Provide the partner with:
- The publishable key.
- The brand display name to set as `data-brand`.
- The exact `<script>` snippet — copy from [`packages/sdk/README.md`](../packages/sdk/README.md).
- A pointer to the manifest at `https://api-prod.goldenhippo.io/sdk/v1/manifest.json` for the current SRI hash (optional in v1, recommended).

## Revocation

See [`incident-response.md`](./incident-response.md).
