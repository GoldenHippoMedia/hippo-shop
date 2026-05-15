# DTO Contract — v1

> **Status:** placeholder. The canonical contract lives in
> [`public-dtos-v1-contract.md`](./public-dtos-v1-contract.md) and is materialized in
> [`@goldenhippo/hippo-shop-types`](../packages/types/src/index.ts).
>
> This file exists so future contract revisions have a stable path
> (`docs/dto-contract-v1.md`) referenced by the implementation plan. The
> first formal version will be cut here from the current `public-dtos-v1-contract.md`
> as part of Phase 1 sign-off.

## Where the contract lives

| Form | Path | Authority |
|------|------|-----------|
| Prose contract | [`docs/public-dtos-v1-contract.md`](./public-dtos-v1-contract.md) | The narrative law. |
| TypeScript types | [`packages/types/src/`](../packages/types/src/) | Compile-time enforcement for both producer and consumer. |
| Fixtures | [`packages/types/test/fixtures/`](../packages/types/test/fixtures/) | Real, lightly-redacted production payloads. |
| `tsd` assertions | [`packages/types/test/types.test-d.ts`](../packages/types/test/types.test-d.ts) | Compile-time tests for closed enums and null distinctions. |

## Versioning

- `1.x.x` → `/public/v1/*` and `/sdk/v1/gh.js`.
- Minor/patch versions are **additive only**.
- Major versions trigger the full parallel-version dance with a 12-month minimum deprecation window.
