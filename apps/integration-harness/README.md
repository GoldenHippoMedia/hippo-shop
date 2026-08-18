# Integration harness

Vitest E2E suite that exercises `/public/v1/*` against a real environment (UAT by default).

## Running

The network tests are **skipped** unless `HIPPO_SHOP_KEY` is set, so it's safe to leave in CI without secrets. The key-set helper's own self-test always runs, and `pnpm --filter @hippo-shop/integration-harness typecheck` checks the DTO key lists against `@goldenhippo/hippo-shop-types` with no key and no network at all.

```bash
export HIPPO_SHOP_KEY=gh_pk_internal_test_xxxxxx
export HIPPO_SHOP_BRAND="Gundry MD"
# Optional overrides
export HIPPO_SHOP_BASE_URL=https://api-uat.goldenhippo.io
export HIPPO_SHOP_FUNNEL_SLUG=bio-complete-3-main
export HIPPO_SHOP_DESTINATION_SLUG=bio-complete-3-6btl-sub
export HIPPO_SHOP_PRODUCT_SLUG=bio-complete-3

pnpm --filter @hippo-shop/integration-harness test
```

## What it verifies

- Funnel and destination responses carry **exactly** the DTO key set — no missing field, no extra field, at every level (`destination`, `pricing`, `price`, `shipping`, `bumpOffers[]`, `frequency`, `funnel`, `funnel.steps[]`). A field the API quietly stops sending and a field it quietly starts sending both fail here.
- The Cluster G additions specifically: `destination.id`, `destination.funnelId` (non-blank — a blank id makes a funnel event undeliverable upstream) and `destination.url` (absolute, or `null`, which is the documented degradation), plus `funnel.steps[].id`.
- The product route still uses sampled assertions — its variant matrix is keyed by quantity, so an exact key set would assert the catalogue rather than the contract.
- Unknown slugs return 404 (the brand-mismatch and not-found case shares this code by design).

The key lists are built with a `keysOf<T>()` helper whose argument fails to compile unless it names every key of `T`. So a DTO field added in `packages/types` without a matching line here is caught by `pnpm typecheck` in CI, long before anyone runs this against UAT.

This is *not* a unit-test substitute — it's a smoke check that the producer (commerce API) and the contract (`@goldenhippo/hippo-shop-types`) are still in sync.

**Ordering:** the exact-key assertions describe the **v4** contract. They fail against any environment still serving v3 — that is intended. UAT must have the commerce identity pass-through and destination-URL lookup deployed before this suite can pass with a key set.
