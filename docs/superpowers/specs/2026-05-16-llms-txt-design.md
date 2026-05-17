# llms.txt for Hippo Shop SDK — Design

**Date:** 2026-05-16
**Scope:** Generate `llms.txt` + `llms-full.txt` from the existing READMEs and ship them via the SDK's Cloudflare Pages deploy so they're served alongside `gh.js`.

---

## Goal

Make the Hippo Shop SDK's documentation discoverable and consumable by LLMs and AI agents via the [llmstxt.org](https://llmstxt.org) convention. Specifically: publish a curated index (`llms.txt`) and a single-fetch full-content bundle (`llms-full.txt`) to the same CDN that serves the SDK script.

## Why

LLM agents writing code that integrates with the SDK benefit from a single, authoritative endpoint that:

1. Lists every canonical documentation source (`llms.txt`)
2. Provides all of that documentation in one fetch (`llms-full.txt`)

This avoids the agent having to crawl GitHub, npm, and the API host separately, and ensures it grounds against the latest source-of-truth content rather than an outdated training snapshot.

## Out of scope

- Domain-root `/llms.txt` placement (would require a Kong gateway rule — separate infra ask, can land later without changing the files this spec produces)
- Wiki content inclusion (wiki doesn't exist yet; design accommodates adding it later)
- LLM-specific prose rewrites of the READMEs — the existing partner-facing READMEs already serve LLMs well
- A changeset / SDK version bump (this is build tooling + static output, no SDK behavior change)
- Tests for the build script — the script is small, idempotent, and output is human-inspectable

## Audience

- LLM agents (Claude, GPT, etc.) being asked to write code that uses `@goldenhippo/hippo-shop-sdk`
- AI-augmented IDEs that fetch documentation context per-project
- Partner developers using LLM-based coding tools who want their agents grounded on the current SDK

---

## Architecture

### Files

| File | Status | Purpose |
|------|--------|---------|
| `packages/sdk/scripts/build-llms.mjs` | new (committed) | Pure-Node generator script; reads the two READMEs and writes the two outputs |
| `packages/sdk/dist/llms.txt` | generated (gitignored, like the rest of `dist/`) | Curated index per llmstxt.org format |
| `packages/sdk/dist/llms-full.txt` | generated (gitignored) | Concatenated SDK + Types READMEs with a short provenance header |

### Build wiring

The SDK package's existing `build` script chains `tsup` with one helper script:

```jsonc
"build": "tsup && node scripts/generate-landing.mjs"
```

This spec extends the chain to also run the new generator:

```jsonc
"build": "tsup && node scripts/generate-landing.mjs && node scripts/build-llms.mjs"
```

The new script reads:

- `packages/sdk/README.md` (canonical SDK docs)
- `packages/types/README.md` (canonical DTO docs)

…and writes to `packages/sdk/dist/`.

Reads are absolute paths relative to the script's location (`new URL('../README.md', import.meta.url)`, etc.), so the script behaves predictably regardless of `cwd`.

### Deployment

The existing release workflow already deploys `packages/sdk/dist` to Cloudflare Pages via:

```yaml
- name: Deploy SDK to Cloudflare Pages
  if: steps.changesets.outputs.published == 'true'
  ...
  run: npx --yes wrangler@4 pages deploy packages/sdk/dist --project-name=gh-hippo-shop-sdk --branch=main
```

No workflow changes needed — the two new files in `dist/` ride along on the next release. Kong already routes `api-prod.goldenhippo.io/sdk/v1/*` to the CF Pages site (per the comment in `tsup.config.ts`), so the resulting URLs are:

- `https://api-prod.goldenhippo.io/sdk/v1/llms.txt`
- `https://api-prod.goldenhippo.io/sdk/v1/llms-full.txt`

---

## File contents

### `llms.txt` (curated index)

Follows the llmstxt.org format: single `#` title, blockquote tagline, optional paragraph, then `##` sections listing links with descriptions.

```markdown
# Hippo Shop SDK

> Browser SDK for reading Golden Hippo public data — funnels, destinations, products — from external pages with two lines of HTML.

The SDK ships two complementary surfaces: declarative `data-gh-*` attribute bindings (no JavaScript required) and a programmatic `window.gh.data` API. Both share the same auth, caching, and brand-scoped access rules enforced by the API.

## Documentation

- [SDK README](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/packages/sdk/README.md): Full attribute reference, built-in and custom formatters, lifecycle events, programmatic API, error codes, safety guarantees, and the advanced TypeScript / NPM surface
- [Types README](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/packages/types/README.md): DTO shapes for funnel, destination, and product resources, with field definitions and example JSON responses
- [Full content (one-fetch)](https://api-prod.goldenhippo.io/sdk/v1/llms-full.txt): Both READMEs concatenated for LLMs that want a single download

## Packages

- [@goldenhippo/hippo-shop-sdk](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk): Browser SDK on npm
- [@goldenhippo/hippo-shop-types](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types): DTO contract on npm (type-only, zero runtime deps)

## Examples

- [Live demo set](https://github.com/GoldenHippoMedia/hippo-shop/tree/main/apps/examples-static): Funnel step, offer selector, and PDP archetype pages — open any HTML file directly in a browser

## Source

- [GitHub repository](https://github.com/GoldenHippoMedia/hippo-shop): Monorepo with the SDK source, type definitions, and demos
```

### `llms-full.txt` (one-fetch full content)

Concise provenance header, then the two READMEs separated by a horizontal rule. The header gives the LLM enough context to know what it's reading and where to find the canonical version.

```
# Hippo Shop SDK — full documentation (single fetch)
# Sources: packages/sdk/README.md, packages/types/README.md
# Canonical: https://github.com/GoldenHippoMedia/hippo-shop
# Generated: <ISO 8601 timestamp at build time>

================================================================================
# SDK README
================================================================================

[verbatim content of packages/sdk/README.md]

================================================================================
# Types README
================================================================================

[verbatim content of packages/types/README.md]
```

The `=` rule separator is used (rather than `---`) so an LLM scanning the file can quickly find section boundaries — `---` would clash with markdown horizontal rules inside the READMEs.

Header timestamp is the **build invocation time** (ISO 8601, e.g. `2026-05-16T19:42:13Z`). Since `dist/` is gitignored, no churn from timestamps appears in `git diff`. The user has confirmed the timestamp is helpful but not critical — if it becomes a hassle, dropping the `Generated:` line is acceptable.

---

## `build-llms.mjs` behavior

### High-level

```js
// packages/sdk/scripts/build-llms.mjs
// Generates dist/llms.txt and dist/llms-full.txt from the two canonical READMEs.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 1. Resolve paths relative to this script's own location.
// 2. Read both README files (fail fast if either is missing).
// 3. Build llms.txt from a static template (no input-driven branching).
// 4. Build llms-full.txt by concatenating the READMEs with the header + section separators.
// 5. Ensure dist/ exists, write both files, log a one-line summary to stdout.
```

### Behavioral guarantees

- **Idempotent** — running it twice produces the same files (modulo the timestamp).
- **Fails loudly** — if either source README is missing, exits with code 1 and a clear error.
- **No dependencies** — uses Node's built-in `fs/promises` and `url` modules. No additions to `package.json` dependencies or to the lockfile.
- **No transformations** — README content is included verbatim. The script does NOT rewrite anchor links, prepend headers, or strip frontmatter. (The READMEs don't have frontmatter; they're already partner-facing prose.)
- **Static `llms.txt` body** — the curated index is a string constant in the script. Adding/removing links requires editing the script, which is the intended maintenance pattern.

### Edge cases

- If `dist/` doesn't exist (e.g., running the script standalone before `tsup`): `mkdir({ recursive: true })` creates it. The script can run before, during, or after `tsup`.
- If a README has trailing newlines: preserved verbatim (no normalization).
- If a README has Windows line endings: preserved verbatim. (None of the current files do; not worth coding around.)

---

## Maintenance model

When the SDK or Types README changes:
- `llms-full.txt` automatically reflects the new content on the next `pnpm build`
- `llms.txt` reflects whatever's hard-coded in the script

When a new canonical doc source is added (e.g., a wiki page goes live):
- Edit `build-llms.mjs` to add a new bullet under the appropriate `##` section
- Optionally add the new source to the concatenation in `llms-full.txt`
- Commit the script change; next release ships the updated output

When the file format itself needs to change (e.g., llmstxt.org v2):
- Update the template strings in the script
- Bump the SDK package patch version (since it's a publish-only artifact, not a code change)

---

## Acceptance criteria

1. `pnpm --filter @goldenhippo/hippo-shop-sdk build` produces both `packages/sdk/dist/llms.txt` and `packages/sdk/dist/llms-full.txt` without errors.
2. `dist/llms.txt` matches the llmstxt.org structure: starts with `# `, has a `> ` tagline, has at least one `## Section` with bullet-point links of the form `- [Title](URL): description`.
3. `dist/llms-full.txt` contains:
   - A 4-line `#` provenance header (title, sources, canonical, generated timestamp)
   - The full content of `packages/sdk/README.md`
   - A `===` separator
   - The full content of `packages/types/README.md`
4. The generated `llms-full.txt` line count is approximately `sdk-README-lines + types-README-lines + 10` (header + separators).
5. `node packages/sdk/scripts/build-llms.mjs` (run standalone) produces identical output to running it as part of `pnpm build`.
6. The release workflow's existing CF Pages deploy step picks up both new files automatically (no workflow changes needed).
7. Acceptance is **manual after the next release**: `curl https://api-prod.goldenhippo.io/sdk/v1/llms.txt` returns 200 with the generated content.

## Non-goals

- Domain-root `/llms.txt` (Kong rule — out of repo)
- A `dist/llms.txt.html` rendered version
- robots.txt or sitemap.xml work
- Versioning the llms files independently of the SDK package
- Detecting README drift via CI (the build script's auto-regen IS the detection — if the published llms-full.txt is stale, the SDK hadn't been republished, which is the right signal)
