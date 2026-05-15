# @goldenhippo/hippo-shop-types

The DTO contract for Hippo Shop. Zero runtime dependencies, pure TypeScript types — consumed by both the commerce API's DTO mappers and the SDK's typed client so that producer and consumer share the contract literally, not by convention.

```ts
import type {
  HippoShopFunnelDTO,
  HippoShopDestinationDTO,
  HippoShopProductDTO,
  HippoShopErrorDTO,
} from '@goldenhippo/hippo-shop-types';
```

## Three DTOs

| DTO | Route | Scenario |
|-----|-------|----------|
| `HippoShopFunnelDTO` | `GET /public/v1/funnel/:slugOrId` | Render or link a Golden Hippo funnel. |
| `HippoShopDestinationDTO` | `GET /public/v1/destination/:slugOrId` | Resolve an offer to a funnel + price. |
| `HippoShopProductDTO` | `GET /public/v1/product/:slugOrId` | Display live pricing/availability. |

See [`docs/hippo-shop-combined-implementation-plan.md`](../../docs/hippo-shop-combined-implementation-plan.md) for the full architecture and the canonical contract document.

## Versioning

Semver — **major = API major**. `1.x.x` targets `/public/v1/*`. Minor and patch versions are additive only.

## No runtime validation

There are no Zod schemas in this package by design. The SDK trusts what comes back from Kong; the commerce API has its own internal validation; shape conformance is enforced by integration tests on the producer side. If runtime validation is ever needed, a companion package (`@goldenhippo/hippo-shop-types-zod`) will provide it.
