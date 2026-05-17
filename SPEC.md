# Hippo Shop — Contract

Hippo Shop is a typed, key-authenticated, brand-scoped public read surface for Golden Hippo's funnel, destination, and product data. It is consumed from the browser via a script-tag SDK with declarative HTML bindings and a small programmatic API.

This document is the contract. What is documented here is what Hippo Shop promises to do. Implementation details, how-it-works architecture, and operational runbooks live elsewhere (see "Where to read next" at the bottom).

## Audience

Golden Hippo's internal teams building landing pages, sales funnels, and supporting marketing surfaces. Hippo Shop is not a partner SDK and does not currently support external organizations.

## What it guarantees

- **Typed DTOs** that match what the public API returns, published as `@goldenhippo/hippo-shop-types` with zero runtime dependencies.
- **Auto-booting browser SDK** distributed as `@goldenhippo/hippo-shop-sdk` and served from a stable CDN URL. The host page drops in one `<script>` tag with `data-key` and `data-brand` attributes; the SDK attaches `window.gh`.
- **Declarative bindings** — `data-gh-*`, `data-field`, `data-format`, `data-with`, `data-when`, and related attributes — that read DTOs into HTML without JavaScript.
- **Programmatic API** at `window.gh.data` for `funnel`, `destination`, and `product` lookups when declarative bindings are not enough.
- **Brand-scoped isolation** — every request is scoped to one brand by the `data-brand` attribute and the access key. Cross-brand reads return 404.
- **Access-key gating** — only origins explicitly allow-listed for a key may use the API. 401 from Kong on unknown keys; 403 from CORS for unknown origins.
- **SLSA-provenanced npm releases** for both packages via npm Trusted Publishers.
- **URL stability** for the CDN-hosted SDK: `https://api-prod.goldenhippo.io/sdk/v1/gh.js` is the stable entry point; major-version upgrades will use a new URL path.

## What it does NOT do

- **No write operations.** Read-only by design. Cart, checkout, and order writes belong to other systems.
- **No PII.** Public read surface; nothing per-shopper.
- **No server-side rendering.** Browser-only. Node integrations consume the types package and the live API directly, not the SDK runtime.
- **No framework lock-in.** The SDK is framework-agnostic vanilla DOM; it can be used inside React, Vue, vanilla HTML, page builders, or anywhere a browser parses HTML.

## Surface map

| Surface | Lives in | Contract document |
|---|---|---|
| DTO shapes | `@goldenhippo/hippo-shop-types` | [`packages/types/SPEC.md`](./packages/types/SPEC.md) |
| Browser SDK | `@goldenhippo/hippo-shop-sdk` | [`packages/sdk/SPEC.md`](./packages/sdk/SPEC.md) |
| Public HTTP API | Kong route `/public/v1/*` on `api-{uat,prod}.goldenhippo.io` | [`docs/architecture/kong-public-routing.md`](./docs/architecture/kong-public-routing.md) |
| SDK delivery CDN | Cloudflare in front of an R2 origin | [`docs/architecture/cloudflare-deploy.md`](./docs/architecture/cloudflare-deploy.md) |

## Stability commitment

- Both npm packages follow semver. Breaking DTO or SDK changes ship in a major.
- Deprecated surfaces are documented in the package SPECs and stay alive for at least one minor release before removal.
- The CDN script URL `https://api-prod.goldenhippo.io/sdk/v1/gh.js` will not break for v1.x. v2 will publish to a separate URL path so embedded pages can upgrade on their own schedule.

## Roadmap and backlog

Open ideas, bugs, and enhancement requests live in [`/ROADMAP.md`](./ROADMAP.md). GitHub Issues is intentionally disabled — `/ROADMAP.md` is canonical. Items can be added or picked up by talking to Claude in this repository.

## Where to read next

- Using the SDK on a page → [`packages/sdk/README.md`](./packages/sdk/README.md)
- DTO field reference → [`packages/types/README.md`](./packages/types/README.md)
- How requests flow through Kong → [`docs/architecture/kong-public-routing.md`](./docs/architecture/kong-public-routing.md)
- How the SDK is delivered from the CDN → [`docs/architecture/cloudflare-deploy.md`](./docs/architecture/cloudflare-deploy.md)
- Releasing a new version → [`docs/ops/release-process.md`](./docs/ops/release-process.md)
- Responding to an incident → [`docs/ops/incident-response.md`](./docs/ops/incident-response.md)
