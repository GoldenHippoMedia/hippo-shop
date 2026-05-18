# Cluster A — Docs restructure and repo honesty pass

**Status:** Design approved, awaiting implementation plan
**Date:** 2026-05-17
**Cluster:** A (of A–F; see ROADMAP.md once seeded for the others)

## Background

This is the first of six planned clusters of work for the hippo-shop monorepo. The other clusters (B–F) cover deprecation removal and the next major release, a CI Slack release webhook, a security audit, an admin UI plus marketing lander with Google login, and SDK session/UTM/checkout handoff. Each cluster gets its own spec.

Cluster A exists because the current docs were written aspirationally — they describe a partner ecosystem that does not exist. The repo is honest engineering work, but the framing oversells it. Cluster A fixes that. It also establishes the doc structure that later clusters (B and E especially) rely on as a source of truth.

## Goals

1. Tell the truth about what hippo-shop is today: a typed, key-authenticated, brand-scoped public read surface for Golden Hippo's internal teams, used to build landing pages and sales funnels.
2. Replace the aspirational "partner"-framed planning docs with a small set of stable contract documents (`SPEC.md`) and a clean architecture/ops doc layout.
3. Stand up `ROADMAP.md` as the canonical backlog for bugs, enhancements, and ideas, with GitHub Issues disabled.
4. Make the repo skimmable: a reader landing on the repo should be able to know what it promises, where the contract lives, and what's planned without reading any code.

## Non-goals

- No code or public-API changes. JSDoc comment edits only.
- No deletion of deprecated APIs (that is Cluster B).
- No new architecture for the admin UI or session/UTM systems (Clusters E and F).
- No new content for an external marketing lander (Cluster E).

## Decisions

### Vocabulary

The word "partner" is removed from user-facing prose and JSDoc. The replacement is a mix:

- **User-facing prose** (READMEs, SPECs, docs that a person reads): "you" / "your team".
- **Third-person JSDoc** (where second-person voice reads awkwardly): "the host page" or "the embedding page".

Example: `"partners author HTML with data-attributes"` becomes `"the host page authors HTML with data-attributes"`. `"Partners cannot enumerate resources they..."` becomes `"You cannot enumerate resources you..."` (or similar; judgement applied per line).

The word "partner" can return later if and when external partners actually exist. This is not a permanent ban; it is honesty about the current state.

### SPEC.md files — contract only

Three new files, each contract-only. They describe what is promised, not how it is implemented:

- **`/SPEC.md`** — repo-level. Purpose, audience, guarantees, non-goals, public-surface map, stability commitment.
- **`/packages/types/SPEC.md`** — every exported DTO type, the fields it guarantees, and any invariants. Includes a "Deprecated surface" section listing types/fields scheduled for removal in a future major.
- **`/packages/sdk/SPEC.md`** — boot model, declarative attribute reference, programmatic API, lifecycle events, error contract, deprecated surface.

Implementation details, architecture, and how-it-works content live elsewhere (`docs/architecture/`, READMEs, source). The SPECs stay small and stable so they remain a believable source of truth.

`apps/integration-harness` and `apps/examples-static` do not get SPEC.md files. They are internal tooling and demos, not shipped artifacts, and their READMEs already describe them.

### ROADMAP.md — canonical backlog

A single file at repo root. GitHub Issues is disabled on the repo. The roadmap holds bugs, enhancements, ideas, spikes, and in-progress items. Each item is a short markdown block:

```
### <short title>
Status: idea | bug | enhancement | spike | in-progress | done
Added: YYYY-MM-DD

<body — repro steps if bug, reasoning if idea, acceptance criteria if enhancement>

Related: <links to specs, PRs, architecture docs if any>
```

Items can be added, updated, or removed collaboratively. When a dev picks something up, the status moves to `in-progress` and ideally a spec gets written. When work ships, the item flips to `done` and stays in the file as a record (we can prune `done` items periodically).

**Seed content:** the file ships with clusters B through F preloaded as `Status: idea` blocks so they do not get lost.

### Doc reorg

| Current file | Fate |
|---|---|
| `docs/dto-contract-v1.md` | **Delete.** Superseded by `packages/types/SPEC.md`. |
| `docs/public-dtos-v1-contract.md` | **Delete.** Same reason; also heavily "partner"-framed. |
| `docs/hippo-shop-combined-implementation-plan.md` | **Delete.** Historical planning, implementation has diverged. |
| `docs/onboarding-partners.md` | **Delete.** Currently aspirational. A real internal-onboarding doc can be written later if needed. |
| `docs/cloudflare-deploy.md` | **Move to `docs/architecture/`**, tone scrub. |
| `docs/kong-public-routing.md` | **Move to `docs/architecture/`**, tone scrub. |
| `docs/incident-response.md` | **Move to `docs/ops/`**, tone scrub. |
| `docs/release-process.md` | **Move to `docs/ops/`**, tone scrub. |
| `docs/superpowers/` | **Untouched.** Historical brainstorming specs and plans. |

"Delete" means `git rm` — git preserves history. We do not move them to a `docs/archive/` folder; lingering archive folders confuse readers.

"Tone scrub" means a read-through to remove "partner" framing and aspirational language. Technical content is preserved. These are edits, not rewrites.

### Final repo doc structure

```
/SPEC.md
/ROADMAP.md
/README.md  (small polish: link to SPEC.md and ROADMAP.md; fix "wiki" pointer)
/packages/sdk/SPEC.md
/packages/sdk/README.md  (tone scrub; ~5 "partner" hits)
/packages/types/SPEC.md
/packages/types/README.md  (unchanged)
/docs/architecture/cloudflare-deploy.md
/docs/architecture/kong-public-routing.md
/docs/ops/release-process.md
/docs/ops/incident-response.md
/docs/superpowers/   (untouched)
```

### README and JSDoc edits

- **`packages/sdk/README.md`** — 5 "partner" mentions get the mix-rule treatment.
- **JSDoc** — 7 mentions across `packages/types/src/funnel.ts`, `errors.ts`, `destination.ts`, and `packages/sdk/src/bindings.ts`, `format.ts`. Mechanical replacements.
- **Root `README.md`** — currently fine on tone (zero "partner" hits). Add explicit links to `/SPEC.md` and `/ROADMAP.md`. The bottom-of-README pointer to a "development wiki" should be verified — if no wiki exists, point at `docs/ops/` instead.

## Execution plan

The work breaks into six logical commits. They can land as one PR or several; my recommendation is one PR with these as separate commits for reviewability.

1. **Add SPEC.md scaffolding.** Three new files: `/SPEC.md`, `/packages/types/SPEC.md`, `/packages/sdk/SPEC.md`. Full contract content. No other changes.
2. **Add ROADMAP.md.** New file, seeded with clusters B–F as `Status: idea` blocks plus the template and intro.
3. **Reorg `docs/`.** Create `docs/architecture/` and `docs/ops/`. `git mv` the four surviving docs to their new homes. `git rm` the four obsolete docs. No content edits in this commit; pure file moves.
4. **Tone scrub on surviving docs.** Edit `cloudflare-deploy.md`, `kong-public-routing.md`, `incident-response.md`, `release-process.md`. Read-through edits, not rewrites.
5. **Tone scrub on SDK README + JSDoc.** 5 SDK README hits, 7 JSDoc hits across types and sdk source.
6. **Root README polish.** Add SPEC.md and ROADMAP.md links; verify and fix the wiki pointer at the bottom.

## Verification

Run after the relevant commits:

- `pnpm typecheck` — should pass (JSDoc changes do not move types but it's free insurance).
- `pnpm build` — confirms tsup regenerates `dist` cleanly with updated JSDoc flowing into `.d.ts`.
- `pnpm test` — should be unaffected since we are not touching runtime code.

Final-pass audit, after all six commits:

- `grep -ri "partner" packages/ apps/ docs/ README.md SPEC.md ROADMAP.md` — should return zero hits, with the only acceptable matches being inside `docs/superpowers/` (historical brainstorming material we agreed to leave alone).
- Read `packages/types/src/index.ts` and confirm every type listed in `packages/types/SPEC.md` exists and is described accurately.
- Read the SDK's public surface (`packages/sdk/src/index.ts` and bindings) and confirm every API and attribute documented in `packages/sdk/SPEC.md` is real, with no inventions or omissions.
- `tree -L 3 docs/ packages/*/SPEC.md SPEC.md ROADMAP.md` — should match the final structure above.

## Out-of-band actions

Not a code change, but part of completing Cluster A:

- Disable GitHub Issues on the repo: `gh repo edit GoldenHippoMedia/hippo-shop --enable-issues=false`. Run this after the PR merges so the ROADMAP.md guidance ("GitHub Issues is intentionally disabled") becomes immediately true.

## Release / changeset

No changeset is required. JSDoc edits flow into published `.d.ts` files but are purely cosmetic with no semver impact. A `chore:` or `docs:` commit prefix is appropriate. If we later decide we want the cleanup recorded in the package changelogs, a patch-level changeset on both `@goldenhippo/hippo-shop-sdk` and `@goldenhippo/hippo-shop-types` is the right call, but the default position is no changeset.

## Effort

Roughly half a day of focused work. The SPEC.md content is the bulk of it; everything else is mechanical.

## Dependencies and ordering

- **Blocks Cluster B** (deprecation removal + next major). Cluster B updates the `Deprecated surface` sections of the SPEC files when it removes the deprecated APIs, so the SPECs need to exist first.
- **Blocks Cluster E** (admin UI + lander). The marketing lander cites repo-level positioning; that positioning becomes canonical in `/SPEC.md` here.
- **Independent of Clusters C, D, F.** Those can run in parallel.
