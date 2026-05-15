# Hippo Shop

Typed, key-authenticated, brand-scoped public surface for Golden Hippo data — funnels, destinations, pricing — readable from external pages with two lines of HTML.

This monorepo houses two npm packages:

- **`@goldenhippo/hippo-shop-types`** — the DTO contract. Zero runtime dependencies, pure TypeScript.
- **`@goldenhippo/hippo-shop-sdk`** — the browser bundle. Auto-boots from `<script>` tag, attaches `window.gh.data`.

The commerce API (separate repo) and Kong gateway config (platform) consume the types and complete the system. See [`docs/hippo-shop-combined-implementation-plan.md`](./docs/hippo-shop-combined-implementation-plan.md) for the full architecture and rollout plan.

## Layout

```
apps/
  examples-static/          # hand-authored HTML pages exercising the SDK
  integration-harness/      # vitest-driven E2E against UAT
packages/
  types/                    # @goldenhippo/hippo-shop-types
  sdk/                      # @goldenhippo/hippo-shop-sdk
docs/                       # contract, onboarding, incident response
```

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

## Boundaries

`packages/sdk` may depend on `packages/types`. Nothing may depend on `packages/sdk`, and nothing in `packages/types` may import from `packages/sdk`. Enforced by Nx tags + `@nx/enforce-module-boundaries`.

## Versioning

Managed by [changesets](https://github.com/changesets/changesets). Add an entry with `pnpm changeset`; CI publishes on merge.
