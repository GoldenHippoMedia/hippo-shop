# Cluster E v1 — Public lander at `hippo-shop.goldenhippo.io`

**Status:** Design approved, awaiting implementation plan
**Date:** 2026-05-18
**Cluster:** E (of A–F; see [`/ROADMAP.md`](../../../ROADMAP.md))
**Branch:** `feat/cluster-e-v1-lander` (off `main`)

## Background

`/ROADMAP.md` carries Cluster E as "Admin UI + marketing lander at `hippo-shop.goldenhippo.io` with Google login (@goldenhippo.com required) for managing access keys, authorized origins, and per-team relationships." The eventual app is two surfaces in one codebase: a public marketing lander and a gated admin UI.

This spec is for **v1 only — the public lander.** No authentication, no admin UI, no access-key management, no per-team relationships. v1 exists to:

1. Stand up the web app and its deploy plumbing so subsequent admin work is incremental.
2. Give internal teams a single URL to point at when explaining what Hippo Shop is and how to start using it.
3. Establish the framework and styling choices that will carry through to the admin UI work.

Admin functionality is deferred to a later cluster — call it E2 — and the lander explicitly signals "admin self-serve coming soon" rather than offering a request flow today.

## Goals

1. Ship a single-page lander served from `hippo-shop.goldenhippo.io` on Heroku.
2. Establish the web app's framework, repo location, styling, and deploy pipeline so the future admin UI builds on the same foundation without re-litigating those choices.
3. Apply the Golden Hippo parent brand (yellow `#edbf26`, ink scale, Poppins, JetBrains Mono for code, voice rules from the `golden-hippo-brand` skill).
4. Surface the existing SDK and Types READMEs from GitHub as the canonical "Read the docs" target rather than duplicating documentation in the lander.

## Non-goals

- **No authentication.** No Google OAuth, no `@goldenhippo.com` domain restriction, no session handling. Those land in a follow-on cluster.
- **No admin UI.** No CRUD on keys, origins, or relationships. v1 ships static content only.
- **No backend data layer.** No database, no Kong admin API integration, no key issuance flow. The lander has no dynamic data — every request returns the same HTML — but Astro is configured for `output: 'server'` (not `'static'`) so the admin work doesn't have to rewire the output mode later.
- **No CMS.** Content lives in `.astro` source files and ships through git.
- **No multi-page navigation.** v1 is one URL (`/`). A `/admin` route is not stubbed.
- **No analytics, telemetry, or A/B testing.** Defer.
- **No internationalization.** English only.
- **No SDK changes.** This cluster does not touch `packages/sdk` or `packages/types`.

## Decisions

### Stack: Astro 5 + Tailwind 4, Node adapter, deployed to Heroku

The framework choice was made against the eventual need (lander + admin UI in one app), not against v1's needs alone. The team is strong in Angular and not React, and the existing infra is Cloudflare for the SDK CDN with Heroku for backend services. Astro fits cleanly on Heroku via `@astrojs/node` in `standalone` mode and supports Angular islands for the eventual admin UI through `@analogjs/astro-angular`. v1 ships pure static-output Astro pages with no islands.

Specific versions and configuration:

- **Astro 5** with `@astrojs/node` adapter, `mode: 'standalone'`. Output `server`. The Heroku dyno runs `node ./dist/server/entry.mjs` via a `Procfile`.
- **Tailwind 4** integrated via `@tailwindcss/vite`. CSS-first config — the `--gh-*` brand tokens live in a `@theme` block, exposed as utility classes (`bg-gh-yellow-500`, `text-gh-ink-900`, `font-display`, etc.).
- **TypeScript** strict mode.
- **Node 20** to match the rest of the monorepo (`engines.node: '>=20'`).
- **pnpm** workspace package, integrated into the existing nx graph (`apps/web` becomes a project under `apps/`).

The Astro + Angular-islands path is documented as the chosen route for the admin UI work, but no Angular dependency is added in v1.

### Repo location: `apps/web/`

The new app lives at `apps/web/` in this monorepo. The name is deliberately generic so the eventual admin UI doesn't force a rename — `apps/lander/` would.

Adds to `pnpm-workspace.yaml` automatically via the existing `apps/*` glob. Gets its own `package.json`, `project.json` (nx targets), `astro.config.mjs`, `tsconfig.json`, and `tailwind.config` equivalent (Tailwind 4 uses CSS-side `@theme`).

### Brand: Golden Hippo parent brand via `golden-hippo-brand` skill

The lander applies the parent-brand baseline:

- Top 6px yellow `#edbf26` band as the signature.
- Ink scale (`--gh-ink-900` for body text, never pure black).
- Poppins (700/600/400) with Inter and system fallback. JetBrains Mono for code.
- Yellow used as a signature, not a fill — top band, one primary CTA fill, one yellow callout per screen.
- Voice: confident, plain, modern. Numbers lead. No corporate filler. No emojis.

CSS tokens live at `:root` matching the `--gh-*` names from the brand skill. Tailwind reads them via `@theme` so utilities and raw CSS use the same source of truth. The brand skill's checklist becomes part of the implementation plan's acceptance criteria.

The brand skill normally asks "which product brand?" for landing pages; this lander is internal-facing (audience: Golden Hippo's own engineers and marketing teams) and the parent brand was explicitly named, so the parent-brand fallback applies.

### Content: single-page lander with five content sections

One URL (`/`). The page has a header and footer wrapping five body sections.

**Header** — GH wordmark left, "GitHub →" link right. 14px row, 1px ink-100 bottom border. No anchor nav.

**Body sections, top to bottom:**

1. **Hero (centered, code-as-hero)** — small uppercase label ("Hippo Shop SDK"), large display headline, supporting subhead, primary CTA "Read the docs" (yellow fill → GitHub README), secondary CTA "Admin — coming soon" (outline, non-link or anchored to the coming-soon callout). Below the buttons: the embed snippet in a JetBrains-Mono dark code block.
2. **How it works** — title + sub. Three numbered steps in a stacked list. Step 1: drop the script tag. Step 2: mark elements with `data-gh-*`. Step 3: or call `window.gh.data` directly. Each step is a one-line heading + one-sentence expansion.
3. **What you get** — title + sub. Four feature cards in a 2×2 grid (mobile collapses to 1×4): Typed DTOs · Declarative bindings · Programmatic API · Brand-scoped & key-gated. Each card is one short heading + 1–2 sentence body. Brand-skill card styling (12px radius, ink-300 border, white background, whisper shadow).
4. **See it in action** — title + sub. Code + rendered split. Left: a short HTML snippet showing two `<span data-gh-product="…" data-field="…">` elements bound to a SKU. Right: the rendered output (a price and a product name). Demonstrates the actual value proposition that the bare `<script>` tag in the hero doesn't.
5. **Admin coming-soon callout** — yellow callout (4px yellow-500 left border, yellow-50 background, 0/8/8/0 radius). One sentence: admin self-serve is launching in a future release; today the SDK is usable internally with a brand-scoped access key; read the docs on GitHub for the full reference. The callout contains the GitHub-docs link as an underlined inline link.

**Footer** — ink-500 small text. Left: "Golden Hippo · Hippo Shop". Right: three links — GitHub repo, npm package (`@goldenhippo/hippo-shop-sdk`), `/ROADMAP.md`. No yellow in the footer.

The full mockup of this composition lives at `.superpowers/brainstorm/<session>/content/page-composition.html`, captured from the brainstorming session that produced this spec.

### Headline and copy

Final headline copy is settled in the plan, not the spec. The mockup uses these placeholders to lock the *length and tone*:

- Headline: "Read Golden Hippo product data from any page in two lines of HTML"
- Subhead: "Typed DTOs. Brand-scoped access keys. Declarative HTML bindings — no JavaScript required."
- Hero CTAs: primary "Read the docs" → GitHub README; secondary "Admin — coming soon" (disabled state).
- Coming-soon callout: "Admin self-serve is launching in a future release. Today, the SDK and types are usable internally with a brand-scoped access key. Until the admin UI ships, read the docs on GitHub for the full attribute and API reference."

The implementation plan tightens these strings to final and gets approval inline.

### Code blocks: dark, JetBrains Mono, light syntax tint

Code blocks (hero and "See it in action") render on `--gh-ink-900` background with `--gh-ink-50` text. Identifier/attribute names tint to `--gh-yellow-400`; string literals to `--gh-yellow-100`; punctuation/tags to `--gh-ink-500`. Same palette as the rest of the page; no third-party syntax theme. Implemented as Astro components, not a syntax highlighter library — these are static snippets, not user-supplied code.

### Hosting: Heroku, Node 20, standalone Astro server

- **App provisioning.** The Heroku app is created out-of-band by an engineer with Heroku admin access. Likely name: `gh-hippo-shop-web` (final name confirmed in the plan). Region: `us` (matches the team's other Heroku apps). Stack: `heroku-24`. Single `web` dyno on the appropriate tier (Eco or Basic).
- **Buildpack.** `heroku/nodejs`. Heroku auto-detects the Node project; `engines.node: '>=20'` in `apps/web/package.json` keeps the runtime aligned. The build phase runs `pnpm install --frozen-lockfile` then `pnpm --filter @goldenhippo/hippo-shop-web build`. (Heroku's pnpm support is fine as of recent buildpack versions; if monorepo subdirectory builds become awkward, fall back to a custom `heroku-postbuild` script in `apps/web/package.json` — confirmed in the plan.)
- **Procfile.** `web: node apps/web/dist/server/entry.mjs` at the repo root. Astro's Node adapter binds to `process.env.PORT`.
- **Domain.** `hippo-shop.goldenhippo.io`. The CNAME and ACM cert are set up out-of-band by DNS-owning engineers; the implementation plan adds the domain to the Heroku app via `heroku domains:add`.
- **Deploy trigger.** Initial deploy from `main` via the Heroku Git remote — no GitHub Actions integration in v1. Adding a `.github/workflows/deploy-web.yml` is deferred to the plan as a stretch task; it's not required for v1 to ship.

### Assets

- **Logo.** Use the wordmark from `golden-hippo-brand/assets/logo-wordmark.webp`. Embedded inline (base64 data URL) in the header so the page is fully self-contained. The brand skill explicitly permits this for self-contained HTML output.
- **Favicon.** A small ink-on-yellow square based on the wordmark glyph, saved as `apps/web/public/favicon.svg`. Plan generates this; if too fiddly, falls back to the wordmark image scaled down.
- **OG image / SEO.** Page `<title>` is "Hippo Shop — SDK for Golden Hippo product data". Meta description is the subhead copy. OG image is deferred to E2 (or a follow-up enhancement); v1 ships without one.

### Testing approach

Light-touch for v1:

- **Type-check.** `astro check` runs in CI.
- **Build.** `pnpm --filter @goldenhippo/hippo-shop-web build` runs in CI.
- **No unit tests.** The lander is presentation-only with no interactive logic worth unit-testing in v1. When the admin UI lands, vitest + Playwright (or equivalent) get wired up.
- **Visual sanity check.** The implementation plan ends with a step that runs the dev server, navigates to `/`, and verifies the rendered page matches the mockup section-by-section.
- **Brand-skill self-check.** The plan's final task runs through the 11-item self-check from the brand skill (yellow band present, no pure black, no emojis, etc.) before declaring done.

## File structure

New files under `apps/web/`:

- `apps/web/package.json` — name `@goldenhippo/hippo-shop-web`, `private: true`, scripts for dev/build/preview/check.
- `apps/web/project.json` — nx targets matching the rest of the monorepo's conventions.
- `apps/web/astro.config.mjs` — output `server`, node adapter standalone, Tailwind 4 Vite plugin.
- `apps/web/tsconfig.json` — extends `tsconfig.base.json`.
- `apps/web/src/styles/tokens.css` — `:root` declarations for the `--gh-*` token set + the Tailwind 4 `@theme` block reading them.
- `apps/web/src/styles/global.css` — `@import 'tailwindcss';` plus base body/typography rules layered over the brand skill's choices.
- `apps/web/src/layouts/Base.astro` — `<html>` shell: head with Poppins + JetBrains Mono Google Fonts (`display=swap`), token stylesheet, top yellow band, header row, slotted main, footer.
- `apps/web/src/pages/index.astro` — composes the six sections.
- `apps/web/src/components/Hero.astro` — centered hero with label/headline/subhead/CTAs/code block.
- `apps/web/src/components/HowItWorks.astro` — title + sub + 3 numbered steps.
- `apps/web/src/components/Features.astro` — 2×2 feature card grid.
- `apps/web/src/components/InAction.astro` — code+rendered split.
- `apps/web/src/components/ComingSoon.astro` — yellow callout.
- `apps/web/src/components/Footer.astro` — footer row.
- `apps/web/src/components/CodeBlock.astro` — reusable dark code block with tokenized inline tinting (no JS).
- `apps/web/src/components/LogoWordmark.astro` — embedded base64 data URL of the wordmark.
- `apps/web/public/favicon.svg` — small ink-on-yellow favicon.
- `Procfile` (repo root) — `web: node apps/web/dist/server/entry.mjs`.

Modified files:

- `pnpm-lock.yaml` — regenerated on `pnpm install`.
- `/ROADMAP.md` — Cluster E entry split: v1 (this work) moves to Done on ship; admin scope retitled "Cluster E2 — Admin UI" and stays Open.

## Open questions for the implementation plan

The plan answers these inline; the spec leaves them open so the plan can confirm with the engineer doing the operational work:

- Final Heroku app name (`gh-hippo-shop-web` proposed).
- Final dyno tier (Eco vs Basic vs Standard-1X).
- Whether to wire a GitHub Actions deploy workflow now or defer.
- Final headline / subhead / callout copy.
- Final favicon treatment.

## Mockup references

- Hero composition decision: `.superpowers/brainstorm/62627-1779126633/content/hero-options.html` (Option A selected).
- Full page composition (locked): `.superpowers/brainstorm/85352-1779130606/content/page-composition.html`.

These files are gitignored (`.superpowers/` is excluded) so they live only in the session that produced them. The implementation plan embeds the section-by-section ASCII outline directly in its tasks so the engineer doesn't depend on the mockup files persisting.

## Future direction (admin UI signals)

This work makes the following downstream choices easier:

- Adding `/admin/*` routes is a matter of dropping new `.astro` pages and Angular islands into `apps/web/src/pages/admin/` — no second framework, no second deploy.
- Adding Google OAuth means installing Astro middleware + a Node-side session library (Lucia or `iron-session`) inside `apps/web/`. The Heroku Node runtime supports full Node APIs, so no edge-runtime workarounds are needed.
- The Tailwind 4 + brand-token foundation means admin UI styling inherits the same visual language without re-doing brand mapping.

None of this is built in v1. It's flagged here so the framework choice doesn't surprise anyone later.

## Acceptance criteria

The cluster ships when:

1. `apps/web/` builds locally (`pnpm --filter @goldenhippo/hippo-shop-web build`) and serves a single rendered `/` page that matches the locked composition.
2. The page passes the brand-skill 11-item self-check.
3. The repo's root CI build (`pnpm build`) includes `apps/web` and passes.
4. The Heroku app at `gh-hippo-shop-web` (final name TBD in plan) serves the deployed page at `hippo-shop.goldenhippo.io`.
5. `/ROADMAP.md` is updated: v1 lander moved to Done with the date and PR reference; "Cluster E2 — Admin UI" added as a new Open item.
