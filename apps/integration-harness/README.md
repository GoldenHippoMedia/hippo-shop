# Integration harness

Vitest E2E suite that exercises `/public/v1/*` against a real environment (UAT by default).

## Running

The suite is **skipped** unless `HIPPO_SHOP_KEY` is set, so it's safe to leave in CI without secrets.

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

- Funnel / destination / product routes return the published DTO shape.
- Unknown slugs return 404 (the brand-mismatch and not-found case shares this code by design).

This is *not* a unit-test substitute — it's a smoke check that the producer (commerce API) and the contract (`@goldenhippo/hippo-shop-types`) are still in sync.
