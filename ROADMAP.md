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

### Cluster B — Remove deprecated APIs and ship next major
Status: idea
Added: 2026-05-17

Remove the deprecated non-`ByQuantity` variant arrays (`subscription.standard`, `subscription.myAccount`, `oneTime.standard`, `oneTime.myAccount`) from `HippoShopProductVariantsDTO` and any related SDK paths. Settle the version-number question — the current trajectory is v3.0.0, but since the packages have never been used in production a clean reset to v1.0.0 is on the table. Update the `Deprecated surface` sections of `packages/types/SPEC.md` and `packages/sdk/SPEC.md` as part of this work.

Related: `docs/superpowers/specs/2026-05-17-cluster-a-docs-restructure-design.md` (predecessor)

### Cluster C — Slack release webhook in CI
Status: idea
Added: 2026-05-17

Have the release workflow post a webhook-based Slack message whenever a package version is published. Small, independent change to `.github/workflows/release.yml`.

### Cluster D — Security audit
Status: idea
Added: 2026-05-17

General security review of the repo. Open questions to answer: is keeping the architecture plan in a public repo a problem? Are there issues the backend / API team should know about before this is used on a real funnel? May produce changes that need to land before Cluster B's release.

### Cluster E — Admin UI + marketing lander at `hippo-shop.goldenhippo.io`
Status: idea
Added: 2026-05-17

A web app that serves two purposes: (1) a marketing lander for internal teams that explains what Hippo Shop does and how it empowers them, and (2) an admin UI behind Google login (@goldenhippo.com required) for requesting and managing access keys, authorized origins, and (eventually) per-team relationships. Regular users can request a new key, see their request status, view their issued keys, and manage their domain allow-list. Admins can manage all relationships. Future: request-count visibility, possibly sourced from Kong logs via Logtail on Heroku.

Depends on Cluster A for the positioning that the lander cites.

### Cluster F — SDK session, UTM, and checkout handoff
Status: idea
Added: 2026-05-17

Have the SDK manage a session cookie when one is not present and parse UTM parameters, including the Golden Hippo-specific click-id mapping (e.g. `fbclid` → `sub_id1=fb` and `sub_id5=fbcli`). On a `checkoutUrl` handoff — possibly supplied by destination details — auto-apply the correct UTM parameters. This would unlock a single per-brand checkout app at `checkout.brand_domain.com` consuming pages from anywhere. Large architectural commitment; probably warrants a spike before a full spec.

---

## Done

(none yet)
