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

### Cluster D — Security audit
Status: idea
Added: 2026-05-17

General security review of the repo. Open questions to answer: is keeping the architecture plan in a public repo a problem? Are there issues the backend / API team should know about before this is used on a real funnel? Findings that need breaking changes ship as v4 (the `/sdk/vN/` URL-line convention established by Cluster B makes that clean).

### Cluster E v2 — Admin UI behind Google login
Status: idea
Added: 2026-05-18

Now that Cluster E v1 has landed the public lander, layer an admin UI onto the same `apps/web` Astro app behind Google login (@goldenhippo.com required) for requesting and managing access keys, authorized origins, and (eventually) per-team relationships. Regular users can request a new key, see their request status, view their issued keys, and manage their domain allow-list. Admins can manage all relationships. Future: request-count visibility, possibly sourced from Kong logs via Logtail on Heroku. Coming-soon callout on the lander already points at this.

### Cluster G — Superfunnel.ai pilot: session handoff, funnel events, destination links
Status: in-progress
Added: 2026-08-18

Golden Hippo is piloting [Superfunnel.ai](https://superfunnel.ai), which hosts funnel pages on a subdomain of the brand's root domain (e.g. `sf.gundrymd.com`) and embeds the Hippo Shop SDK. Cluster G realigns the SDK's session and attribution layer with `hippo-builder-funnel`, the canonical implementation: `hippo_session_id` cookie at the registrable root domain, UUID v4 ids, a three-step resolution ladder (inbound `?sessionid=` → cookie → mint), and an unconditional session POST carrying `affParameters.sessionId`. Adds `Page View` funnel events — the 36-field payload, `keepalive` POST to `/public/v1/funnel-event`, deduped per page load, gated on a resolvable funnel id — plus `data-gh-step`, `data-gh-funnel-id`, and `gh.track('Page View')`. `data-gh-checkout` now resolves through the destination's absolute `url`, so binding an offer navigates the visitor to that destination with attribution attached, and `gh.checkoutUrl(slug)` becomes async. Both packages cut as v4: a clean break with no compatibility shims, since the 3.x line has no production consumers.

Subsumes Cluster F (SDK session, UTM, and checkout handoff), which this file recorded as `done` on 2026-05-19. It was not done: PR #17 never merged, `main` has never carried `cookies.ts`, `url-params.ts`, `session.ts` or `checkout.ts`, and no npm version ever shipped them. F is folded into this entry rather than moved back to Open because nothing separable is left to pick up — `feat/cluster-g-superfunnel-pilot` is branched off F, F's commits reach `main` inside the single Cluster G PR, and every behaviour an F backlog item would have described is replaced here: the click-id mapping (`subId1='fb'` with the value in `subId5` — the slots reversed, and a literal no platform emits), the `session_id` / `sub_idN` outbound spelling, the `sessionId` cookie name and its 12-digit id, and the `connect.sid` gate that read an `httpOnly` cookie JS cannot see. PR #17 closes as superseded and F's two changesets are deleted.

The `GH-Commerce-Service` half ships as its own PR from `feat/cluster-g-hippo-shop-session-destination-url` (off `prerelease`): a public `POST /hippo-shop/v1/session` route on the already-unauthenticated `HippoShopController`, destination identity pass-through (`id`, `funnelId`, step `id`) from a payload the serializer already fetched and discarded, and the destination's absolute URL via a brand-scoped SOQL query that degrades to `url: null` rather than failing the response.

Release ordering is load-bearing. The `gh-hippo-shop-sdk-v4` Cloudflare Pages project and the Kong `/sdk/v4/*` route must exist *before* the SDK publish — the v3 cut failed on exactly this. `@goldenhippo/hippo-shop-types@4.0.0` must publish *before* the commerce pin bump, and in the commerce repo the pin bump (`^3.0.0` → `^4.0.0`) and the Zod schema change must be one commit or `tsc` fails. 3.x is npm-deprecated afterwards, following the 1.x/2.x precedent.

Kong work is parallel and owned outside these repos: the `/public/v1/session` and `/public/v1/funnel-event` routes, and a rate-limit tier sized for the offer selector's ~8 requests per page load (six destination `GET`s, one session `POST`, one event `POST`) against a documented 60/min per-consumer default.

Related: `docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`, `docs/superpowers/plans/2026-08-18-cluster-g-superfunnel-pilot.md`, PR #17 (superseded), PR #18

---

## Done

### SDK v3.0.1 — version-agnostic script-tag fallback selector
Status: done
Added: 2026-05-18
Shipped: 2026-05-19 (PR #13)

Replaced the v1-substring selector in `packages/sdk/src/index.ts` `findScript()` with a version-agnostic `[src*="/sdk/"]` form so the production-CDN fallback works for every SDK major, not just v1. Refreshed the test fixtures in `packages/sdk/test/{index,config}.spec.ts` from `/sdk/v1/gh.js` to `/sdk/v3/gh.js` to match the current shipping URL. Patch released as `@goldenhippo/hippo-shop-sdk@3.0.1` via the changesets release PR #14.

Related: PR #13

### Cluster C — Slack release webhook in CI
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PR #15)

Adds a `Notify Slack` step at the end of `.github/workflows/release.yml`, gated on `steps.changesets.outputs.published == 'true'`, that runs `scripts/notify-slack-release.mjs`. The script reads the published-packages JSON, slices each package's `## <version>` block out of its `CHANGELOG.md`, builds a Slack mrkdwn payload with per-package GitHub Release links, and POSTs to the `SLACK_WEBHOOK_URL` repo secret. Every failure path exits 0 so a Slack outage cannot paint a successful release red; if the secret is unset, the script logs and skips.

Related: `docs/superpowers/specs/2026-05-18-cluster-c-slack-release-webhook-design.md`, `docs/superpowers/plans/2026-05-18-cluster-c-slack-release-webhook.md`, PR #15

### npm deprecate v1.x and v2.x packages
Status: done
Added: 2026-05-18
Shipped: 2026-05-18

Cluster B post-publish housekeeping that didn't run with the original release. Both `@goldenhippo/hippo-shop-sdk` and `@goldenhippo/hippo-shop-types` now have every `<3.0.0` version flagged with the deprecation message "use v3.0.0 or later — v1.x/v2.x were internal-only iterations and are no longer maintained". Verified via `npm view <pkg>@<v> deprecated` on every published 1.x/2.x.

### Cluster A — Repo honesty & docs restructure
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PR #7)

Replaced aspirational "partner"-framed planning docs with contract-only `SPEC.md` files (root + per package), stood up `ROADMAP.md` as the canonical backlog with GitHub Issues disabled, reorganized `docs/` into `architecture/` and `ops/`, light tone scrub on the SDK README and JSDoc. CI workflow gained a build-before-typecheck fix as part of the same PR after the original ordering surfaced a workspace-dependency resolution failure.

Related: `docs/superpowers/specs/2026-05-17-cluster-a-docs-restructure-design.md`, `docs/superpowers/plans/2026-05-17-cluster-a-docs-restructure.md`, PR #7

### Cluster E v1 — Public lander at `hippo-shop.goldenhippo.io`
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PRs #11, #12)

Stood up `apps/web/` as a new Astro 6 + Tailwind 4 app deployed to Heroku — a single public lander pitched at Golden Hippo funnel writers. v1 is presentation-only; the framework choice is sized for the admin UI (Cluster E v2) that will layer on top. PR #11 shipped the initial page (Hero / How it works / What you get / In action / Coming-soon callout) with the Golden Hippo parent brand applied via the brand skill. PR #12 rewrote the copy to lead with the destination-binding story (build the funnel page once, marketing edits prices and offers without a deploy) after the first pass over-rotated on typed DTOs vs. the actual internal audience.

Related: `docs/superpowers/specs/2026-05-18-cluster-e-v1-lander-design.md`, PRs #11, #12

### Cluster B — v3.0.0 (deprecation removal + major-version cut)
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PRs #8, #9, #10)

Removed the four deprecated variant array fields from `HippoShopProductVariantsDTO`, removed the `enrichProduct` SDK shim, published v3.0.0 of both packages to npm with provenance. Established the per-major CDN URL convention (`/sdk/vN/gh.js`) — v3 live at `https://api-{uat,prod}.goldenhippo.io/sdk/v3/gh.js` via the new `gh-hippo-shop-sdk-v3` Cloudflare Pages project and new Kong routes. The frozen `/sdk/v1/gh.js` URL keeps serving the last v2.1.1 build.

The original release deploy step failed with "Project not found" because `wrangler@4 pages deploy` does not auto-create the project in non-interactive CI (the architecture doc had claimed otherwise). Fixed forward in PR #10: workflow now runs `wrangler pages project create … || true` before deploy, architecture doc corrected, and the v3 SDK was manually deployed from a local checkout to recover the Pages project.

Related: `docs/superpowers/specs/2026-05-17-cluster-b-v3-major-design.md`, `docs/superpowers/plans/2026-05-17-cluster-b-v3-major.md`, PRs #8, #9, #10
