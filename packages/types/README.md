# @goldenhippo/hippo-shop-types

[![npm version](https://img.shields.io/npm/v/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)
[![types](https://img.shields.io/npm/types/@goldenhippo/hippo-shop-types.svg)](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

TypeScript type definitions for the Hippo Shop public API. Zero runtime dependencies — install in your project for IntelliSense and compile-time safety against the live API contract.

> Runtime SDK: [`@goldenhippo/hippo-shop-sdk`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk)

## Installation

```bash
npm install --save-dev @goldenhippo/hippo-shop-types
# or
pnpm add -D @goldenhippo/hippo-shop-types
```

## Usage

Import the DTOs you need:

```ts
import type {
  HippoShopFunnelDTO,
  HippoShopDestinationDTO,
  HippoShopProductDTO,
  HippoShopProductVariantDTO,
  HippoShopProductVariantsByQuantityDTO,
  HippoShopErrorDTO,
} from '@goldenhippo/hippo-shop-types';
```

Most pages use the SDK's auto-fetching declarative bindings — see [`@goldenhippo/hippo-shop-sdk`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk). For SSR, edge functions, or custom rendering, call the API directly with a typed fetch:

```ts
const res = await fetch(
  'https://api-prod.goldenhippo.io/public/v1/product/multi-vitamin',
  {
    headers: {
      'X-GH-Key': 'gh_pk_yourbrand_xxxxxx',
      'X-GH-Brand': 'Sample Co',
    },
  },
);
const product: HippoShopProductDTO = await res.json();
```

## Three DTOs

| DTO | Route | Scenario |
|-----|-------|----------|
| `HippoShopFunnelDTO` | `GET /public/v1/funnel/:slugOrId` | Render or link a Golden Hippo funnel. |
| `HippoShopDestinationDTO` | `GET /public/v1/destination/:slugOrId` | Resolve an offer to a funnel + price. |
| `HippoShopProductDTO` | `GET /public/v1/product/:slugOrId` | Display live pricing and availability. |

## Example responses

<!-- TASK 3 INSERT POINT: example response JSON blocks go here -->

## Versioning

Semver. Major versions track breaking changes to the public API contract. Minor and patch versions are additive only.

## No runtime validation

These are types only — no runtime validation. If you need to validate response bodies at the network boundary, use a runtime schema library like [Zod](https://zod.dev) or [io-ts](https://github.com/gcanti/io-ts).

## Provenance

Published with [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) attestation via npm Trusted Publishers + GitHub Actions OIDC.

## License

MIT. See [LICENSE](./LICENSE).
