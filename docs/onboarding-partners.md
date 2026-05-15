# Onboarding a partner — Kong Admin UI walkthrough

> **Internal-only.** v1 of Hippo Shop is gated behind operational sign-off.
> No external partner keys should be issued until partner-relations has
> approved the partner.

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

3. **Configure CORS.**
   - Kong Admin UI → Services → `hippo-shop-public-v1` → Routes → Plugins → CORS.
   - Per-consumer override → add the partner's exact origins:
     - `https://www.example.com`
     - `https://staging.example.com`
   - Wildcards are not permitted. Add each subdomain explicitly.

4. **Set the rate-limit tier.**
   - Plugins → Rate Limiting → per-consumer override.
   - Standard tier: 60 req/min per consumer.
   - Elevated tier: 300 req/min — requires partner-relations sign-off.

5. **Assign the brand binding.**
   - The brand is enforced server-side by the commerce API on every `/public/v1/*` request via the `X-GH-Brand` header.
   - Add `brand:<brand-slug>` to the consumer's tags so it shows up in dashboards.

6. **Verify.**
   - From an allowed origin, run:
     ```bash
     curl -i \
       -H "Authorization: Bearer gh_pk_..." \
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
