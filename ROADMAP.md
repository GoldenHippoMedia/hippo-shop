# Hippo Shop Roadmap

This file is the canonical backlog for Hippo Shop. Bugs, enhancements, ideas, and in-progress work all live here. GitHub Issues is intentionally disabled on this repository — this document is the single source of truth for "what's next."

Items can be added, updated, or removed collaboratively by working with Claude in this repo. When you pick something up, flip the status to `in-progress` and write a design spec in `docs/superpowers/specs/`. When it ships, set status to `done`. Done items are pruned periodically.

## Item template

```text
### <short title>
Status: idea | bug | enhancement | spike | in-progress | done
Added: YYYY-MM-DD

<body — repro steps if bug, reasoning if idea, acceptance criteria if enhancement>

Related: <links to specs, PRs, architecture docs if any>
```

---

## Open items

### Cluster C — Slack release webhook in CI
Status: idea
Added: 2026-05-17

Have the release workflow post a webhook-based Slack message whenever a package version is published. Small, independent change to `.github/workflows/release.yml`.

### Cluster D — Security audit
Status: idea
Added: 2026-05-17

General security review of the repo. Open questions to answer: is keeping the architecture plan in a public repo a problem? Are there issues the backend / API team should know about before this is used on a real funnel? Findings that need breaking changes ship as v4 (the `/sdk/vN/` URL-line convention established by Cluster B makes that clean).

### Cluster E v1 — Public lander at `hippo-shop.goldenhippo.io`
Status: in-progress
Added: 2026-05-17

A single-page Astro lander that explains Hippo Shop and points at the SDK docs on GitHub. Stack chosen for the eventual admin UI: Astro 5 + Tailwind 4 + Node adapter on Heroku, `apps/web/` in the monorepo. No auth, no admin operations in v1 — the page signals "admin self-serve coming soon" and links to GitHub for the docs.

Related: `docs/superpowers/specs/2026-05-18-cluster-e-v1-lander-design.md`, `docs/superpowers/plans/2026-05-18-cluster-e-v1-lander.md`

### Cluster E2 — Admin UI (Google login, key & origin management)
Status: idea
Added: 2026-05-17

Adds the gated half of the web app: Google OAuth restricted to `@goldenhippo.com`, requests/issuance of brand-scoped access keys, per-key authorized-origin allowlists, and eventually per-team relationships. Regular users see their own requests and keys; admins see and manage all relationships. Future: request-count visibility, possibly sourced from Kong logs via Logtail on Heroku. Builds on top of `apps/web/` from Cluster E v1.

### Cluster F — SDK session, UTM, and checkout handoff
Status: idea
Added: 2026-05-17

Have the SDK manage a session cookie when one is not present and parse UTM parameters, including the Golden Hippo-specific click-id mapping (e.g. `fbclid` → `sub_id1=fb` and `sub_id5=fbcli`). On a `checkoutUrl` handoff — possibly supplied by destination details — auto-apply the correct UTM parameters. This would unlock a single per-brand checkout app at `checkout.brand_domain.com` consuming pages from anywhere. Large architectural commitment; probably warrants a spike before a full spec.

### SDK script-tag fallback selector still matches `/sdk/v1/gh`
Status: enhancement
Added: 2026-05-18

`packages/sdk/src/index.ts` lines 88–90 hard-code the v1 substring in the script-tag fallback selector. With v3 SDK loaded from `/sdk/v3/gh.js`, the primary `document.currentScript` path works fine, and the generic `[src$="/gh.js"]` second fallback catches v3 URLs — so the bug only fires in the narrow edge case where `document.currentScript` is null AND the page injects the SDK in a way the generic fallback doesn't reach. Make the v1-specific selector version-agnostic (or match any `/sdk/v\d+/gh`). Update `packages/sdk/test/{index,config}.spec.ts` fixtures to match.

Pick up alongside any other small SDK change that warrants a v3.0.1 patch.

Related: PR #10 (deferred this cleanup)

### npm deprecate v1.x and v2.x packages
Status: bug
Added: 2026-05-18

The Cluster B plan called for `npm deprecate` on v1.x and v2.x of both packages after v3 publish; it wasn't run. Anyone installing v2.1.1 or earlier sees no warning. Two one-off commands:

```
npm deprecate '@goldenhippo/hippo-shop-sdk@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
npm deprecate '@goldenhippo/hippo-shop-types@<3.0.0' 'use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained'
```

Needs `npm login` with publish-level npm access.

---

## Done

### Cluster A — Repo honesty & docs restructure
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PR #7)

Replaced aspirational "partner"-framed planning docs with contract-only `SPEC.md` files (root + per package), stood up `ROADMAP.md` as the canonical backlog with GitHub Issues disabled, reorganized `docs/` into `architecture/` and `ops/`, light tone scrub on the SDK README and JSDoc. CI workflow gained a build-before-typecheck fix as part of the same PR after the original ordering surfaced a workspace-dependency resolution failure.

Related: `docs/superpowers/specs/2026-05-17-cluster-a-docs-restructure-design.md`, `docs/superpowers/plans/2026-05-17-cluster-a-docs-restructure.md`, PR #7

### Cluster B — v3.0.0 (deprecation removal + major-version cut)
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PRs #8, #9, #10)

Removed the four deprecated variant array fields from `HippoShopProductVariantsDTO`, removed the `enrichProduct` SDK shim, published v3.0.0 of both packages to npm with provenance. Established the per-major CDN URL convention (`/sdk/vN/gh.js`) — v3 live at `https://api-{uat,prod}.goldenhippo.io/sdk/v3/gh.js` via the new `gh-hippo-shop-sdk-v3` Cloudflare Pages project and new Kong routes. The frozen `/sdk/v1/gh.js` URL keeps serving the last v2.1.1 build.

The original release deploy step failed with "Project not found" because `wrangler@4 pages deploy` does not auto-create the project in non-interactive CI (the architecture doc had claimed otherwise). Fixed forward in PR #10: workflow now runs `wrangler pages project create … || true` before deploy, architecture doc corrected, and the v3 SDK was manually deployed from a local checkout to recover the Pages project.

Related: `docs/superpowers/specs/2026-05-17-cluster-b-v3-major-design.md`, `docs/superpowers/plans/2026-05-17-cluster-b-v3-major.md`, PRs #8, #9, #10
