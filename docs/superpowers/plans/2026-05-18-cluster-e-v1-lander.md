# Cluster E v1 — Public Lander Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a single-page public lander for Hippo Shop at `hippo-shop.goldenhippo.io` as a new Astro 5 app in `apps/web/`, deployed to Heroku.

**Architecture:** New pnpm workspace package `apps/web` running Astro 5 with the Node adapter in standalone mode. Tailwind 4 via the Vite plugin reads CSS-side `--gh-*` brand tokens declared at `:root`. Six presentational components compose one page (`/`). Heroku runs `node apps/web/dist/server/entry.mjs` from a repo-root `Procfile`. No backend, no auth, no admin UI in v1 — those land in a follow-on Cluster E2.

**Tech Stack:** Astro 5 · `@astrojs/node` · Tailwind 4 · `@tailwindcss/vite` · TypeScript strict · pnpm workspace · nx 20 · Node 20 · Heroku `heroku-24` · Golden Hippo parent-brand design tokens (`golden-hippo-brand` skill).

**Spec:** [`docs/superpowers/specs/2026-05-18-cluster-e-v1-lander-design.md`](../specs/2026-05-18-cluster-e-v1-lander-design.md)

---

## Pre-flight

These don't get committed individually — they're prerequisites the engineer confirms before Task 1.

- This work happens on a new branch `feat/cluster-e-v1-lander` off `main`. `git checkout -b feat/cluster-e-v1-lander` before Task 1.
- Operational items the spec defers and the engineer should resolve early so they don't block the final tasks: Heroku app provisioned (likely `gh-hippo-shop-web`, region `us`, stack `heroku-24`, Eco or Basic dyno) and `hippo-shop.goldenhippo.io` CNAME + ACM cert configured. These are out-of-band; the plan assumes they're done by Task 17.

---

## File Structure

New files under `apps/web/`:

```
apps/web/
├── package.json              # @goldenhippo/hippo-shop-web, private, astro scripts
├── project.json              # nx targets matching the rest of the monorepo
├── tsconfig.json             # extends tsconfig.base.json
├── astro.config.mjs          # Node adapter standalone + Tailwind Vite plugin
├── .gitignore                # dist, .astro
├── public/
│   ├── favicon.svg           # small ink-on-yellow square
│   └── logo-wordmark.webp    # copied from golden-hippo-brand skill assets
└── src/
    ├── styles/
    │   ├── tokens.css        # :root --gh-* design tokens
    │   └── global.css        # @import tailwindcss + @theme block
    ├── layouts/
    │   └── Base.astro        # HTML shell + head + top yellow band + header + slot + footer
    └── components/
        ├── LogoWordmark.astro
        ├── CodeBlock.astro
        ├── Hero.astro
        ├── HowItWorks.astro
        ├── Features.astro
        ├── InAction.astro
        ├── ComingSoon.astro
        └── Footer.astro
    └── pages/
        └── index.astro       # composes the five body sections
```

New files at repo root:

```
Procfile                       # web: node apps/web/dist/server/entry.mjs
```

Modified files:

```
pnpm-lock.yaml                 # regenerated on pnpm install (Task 2)
.github/workflows/ci.yml       # add apps/web to the build matrix (Task 18)
ROADMAP.md                     # split Cluster E into v1 (in-progress) and E2 (open) — Task 19
```

---

## Task 1: Scaffold `apps/web/` package skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/project.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/.gitignore`

- [ ] **Step 1: Create the package manifest**

Create `apps/web/package.json`:

```json
{
  "name": "@goldenhippo/hippo-shop-web",
  "version": "0.0.0",
  "private": true,
  "description": "Hippo Shop public lander — Astro app served at hippo-shop.goldenhippo.io.",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "start": "node ./dist/server/entry.mjs",
    "build": "astro check && astro build",
    "preview": "astro preview",
    "typecheck": "astro check",
    "astro": "astro"
  }
}
```

Note on scripts: `build` runs `astro check` first so TS errors fail CI without a separate step. `start` is what Heroku's buildpack invokes when there's no Procfile entry — we have a root Procfile too, but keeping `start` aligned means `pnpm --filter @goldenhippo/hippo-shop-web start` works locally.

- [ ] **Step 2: Create the nx project descriptor**

Create `apps/web/project.json`:

```json
{
  "name": "web",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/web/src",
  "tags": ["scope:app", "type:app"]
}
```

This matches the convention used by `apps/examples-static` and `apps/integration-harness`. No `targets` block is needed — nx infers `build`, `typecheck`, `dev` from the package.json scripts.

- [ ] **Step 3: Create the TypeScript config**

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "types": ["astro/client"]
  },
  "include": ["src/**/*", "astro.config.mjs"]
}
```

`tsconfig.base.json` already sets strict, ESNext module, `moduleResolution: Bundler`, and `lib: ES2022, DOM`. Astro needs `types: ["astro/client"]` for `import.meta.env` typings and the `astro:assets` namespace.

- [ ] **Step 4: Create the package-level gitignore**

Create `apps/web/.gitignore`:

```
dist/
.astro/
```

`node_modules/` and `.env*` are already ignored at the repo root; the package only needs to add Astro-specific build outputs.

- [ ] **Step 5: Verify the workspace picks up the new package**

Run:

```bash
pnpm install
```

Expected: no errors. The `apps/*` glob in `pnpm-workspace.yaml` picks up `apps/web` automatically. `pnpm-lock.yaml` regenerates.

Run:

```bash
pnpm nx show projects
```

Expected: output includes `web` alongside the existing `sdk`, `types`, `examples-static`, `integration-harness` projects.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/project.json apps/web/tsconfig.json apps/web/.gitignore pnpm-lock.yaml
git commit -m "feat(web): scaffold apps/web package skeleton"
```

---

## Task 2: Install Astro, Node adapter, Tailwind 4, and Vite plugin

**Files:**
- Modify: `apps/web/package.json` (deps added by pnpm)
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install Astro and the Node adapter**

Run from the repo root:

```bash
pnpm --filter @goldenhippo/hippo-shop-web add astro @astrojs/node @astrojs/check typescript
```

Expected versions (latest as of 2026-05-18): astro `^5.x`, `@astrojs/node` `^9.x`, `@astrojs/check` `^0.9.x`. If pnpm warns about peer deps, install the requested ones.

- [ ] **Step 2: Install Tailwind 4 and its Vite plugin**

```bash
pnpm --filter @goldenhippo/hippo-shop-web add tailwindcss @tailwindcss/vite
```

Expected versions: both `^4.x`.

- [ ] **Step 3: Verify the resulting package.json**

The dependencies section of `apps/web/package.json` should now have astro + node adapter as regular deps and `@astrojs/check`, `typescript`, `tailwindcss`, `@tailwindcss/vite` as devDependencies. If pnpm placed any of those wrong, manually move them. Astro and the Node adapter need to be runtime deps because the Heroku slug runs `astro build` and then `node entry.mjs`.

- [ ] **Step 4: Verify install works clean from scratch**

```bash
rm -rf apps/web/node_modules
pnpm install --frozen-lockfile
```

Expected: install completes; no error. The frozen-lockfile flag confirms the lockfile is internally consistent.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): install Astro 5 + Node adapter + Tailwind 4"
```

---

## Task 3: Configure Astro with the Node adapter and Tailwind Vite plugin

**Files:**
- Create: `apps/web/astro.config.mjs`

- [ ] **Step 1: Write the Astro config**

Create `apps/web/astro.config.mjs`:

```javascript
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Output 'server' (not 'static') so the future admin UI can add dynamic routes
// without rewiring the output mode. v1 has no dynamic data, but every request
// returns the same HTML from a Node process running on Heroku.
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  server: {
    host: true,
    port: Number(process.env.PORT) || 4321,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
```

Notes:

- `mode: 'standalone'` produces `dist/server/entry.mjs`, which auto-starts a Node HTTP server on the configured host/port. That's what the Procfile invokes (Task 17).
- `server.host: true` binds to all interfaces (required on Heroku's dyno).
- `server.port` reads from `PORT` so Heroku's dyno-assigned port is honored; 4321 is the local dev fallback.
- The Tailwind Vite plugin handles class detection, JIT compilation, and CSS bundling. No `tailwind.config.js` is needed in v4 — config is CSS-side via `@theme` in `global.css` (Task 5).

- [ ] **Step 2: Verify the config parses**

```bash
pnpm --filter @goldenhippo/hippo-shop-web exec astro info
```

Expected: prints Astro version, adapter (`@astrojs/node`), and integrations without error.

- [ ] **Step 3: Commit**

```bash
git add apps/web/astro.config.mjs
git commit -m "feat(web): configure Astro for Node standalone + Tailwind 4"
```

---

## Task 4: Create a placeholder index page and smoke-test the dev server

**Files:**
- Create: `apps/web/src/pages/index.astro`

- [ ] **Step 1: Write a minimal placeholder page**

Create `apps/web/src/pages/index.astro`:

```astro
---
// Placeholder page so the dev server has something to render before the
// layout and components exist. Replaced by the real composition in Task 15.
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hippo Shop</title>
  </head>
  <body>
    <h1>Hippo Shop — placeholder</h1>
    <p>If you see this, the Astro dev server is working.</p>
  </body>
</html>
```

- [ ] **Step 2: Start the dev server**

```bash
pnpm --filter @goldenhippo/hippo-shop-web dev
```

Expected output includes a line like `Local: http://localhost:4321/`. The server starts in under 2 seconds.

- [ ] **Step 3: Confirm the page renders**

In another terminal:

```bash
curl -s http://localhost:4321/ | grep -c 'placeholder'
```

Expected: `1` (the word "placeholder" appears once in the rendered body).

Stop the dev server (Ctrl-C in the terminal where it's running).

- [ ] **Step 4: Verify a production build**

```bash
pnpm --filter @goldenhippo/hippo-shop-web build
```

Expected output ends with `[build] Server built in <N>s` (or similar) and produces:

- `apps/web/dist/server/entry.mjs` — the standalone server entry
- `apps/web/dist/client/` — static assets (currently empty or near-empty)

```bash
ls apps/web/dist/server/entry.mjs
```

Expected: the file exists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/index.astro
git commit -m "feat(web): add placeholder index page + verify dev/build"
```

---

## Task 5: Add design tokens and global stylesheet

**Files:**
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`

- [ ] **Step 1: Create the design tokens**

Create `apps/web/src/styles/tokens.css`:

```css
/*
 * Golden Hippo parent-brand design tokens.
 * Source: golden-hippo-brand skill (SKILL.md, "Color tokens" section).
 *
 * These are the canonical values. The @theme block in global.css reads them
 * to expose Tailwind utilities like bg-gh-yellow-500 and text-gh-ink-900.
 */
:root {
  /* Brand */
  --gh-yellow-500: #edbf26;   /* primary brand */
  --gh-yellow-400: #f3cf57;   /* hover / lighter accent */
  --gh-yellow-600: #c99e0f;   /* pressed / darker accent */
  --gh-yellow-100: #fdf4d4;   /* soft callout background */
  --gh-yellow-50:  #fefaeb;   /* tinted surface */

  /* Ink (replaces gray — never pure black) */
  --gh-ink-900:    #0f1115;   /* default body text */
  --gh-ink-700:    #2a2f3a;   /* secondary text */
  --gh-ink-500:    #5b6373;   /* muted text, captions */
  --gh-ink-300:    #c5cad3;   /* borders, dividers */
  --gh-ink-100:    #eef0f4;   /* subtle surfaces */
  --gh-ink-50:     #f7f8fa;   /* page backgrounds */
  --gh-white:      #ffffff;

  /* Fonts */
  --gh-font-display: 'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --gh-font-body:    'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --gh-font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

- [ ] **Step 2: Create the global stylesheet**

Create `apps/web/src/styles/global.css`:

```css
@import 'tailwindcss';
@import './tokens.css';

/*
 * Wire the --gh-* tokens into Tailwind 4's theme so utilities like
 * bg-gh-yellow-500, text-gh-ink-900, font-display, font-mono exist.
 */
@theme {
  --color-gh-yellow-50:  var(--gh-yellow-50);
  --color-gh-yellow-100: var(--gh-yellow-100);
  --color-gh-yellow-400: var(--gh-yellow-400);
  --color-gh-yellow-500: var(--gh-yellow-500);
  --color-gh-yellow-600: var(--gh-yellow-600);

  --color-gh-ink-50:  var(--gh-ink-50);
  --color-gh-ink-100: var(--gh-ink-100);
  --color-gh-ink-300: var(--gh-ink-300);
  --color-gh-ink-500: var(--gh-ink-500);
  --color-gh-ink-700: var(--gh-ink-700);
  --color-gh-ink-900: var(--gh-ink-900);

  --font-display: var(--gh-font-display);
  --font-sans:    var(--gh-font-body);
  --font-mono:    var(--gh-font-mono);
}

/* Base typography. The brand skill calls for body text in --gh-ink-900,
   never #000, with Poppins as the default. */
body {
  font-family: var(--gh-font-body);
  color: var(--gh-ink-900);
  background: var(--gh-white);
  line-height: 1.6;
  margin: 0;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Headlines use the display font with tightened tracking per the brand ramp. */
h1, h2, h3, h4 {
  font-family: var(--gh-font-display);
  color: var(--gh-ink-900);
  margin: 0;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/styles/global.css
git commit -m "feat(web): add Golden Hippo design tokens and Tailwind @theme"
```

---

## Task 6: Create the `Base.astro` layout

**Files:**
- Create: `apps/web/src/layouts/Base.astro`

- [ ] **Step 1: Write the layout**

Create `apps/web/src/layouts/Base.astro`:

```astro
---
import '../styles/global.css';

interface Props {
  title?: string;
  description?: string;
}

const {
  title = 'Hippo Shop — SDK for Golden Hippo product data',
  description = 'Typed DTOs. Brand-scoped access keys. Declarative HTML bindings — no JavaScript required.',
} = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>{title}</title>
    <meta name="description" content={description} />

    <!-- Open Sans isn't used; we want Poppins (display/body) + JetBrains Mono (code). -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
    />
  </head>
  <body>
    <!-- Signature yellow band: 6px, full bleed across the top. -->
    <div class="h-1.5 bg-gh-yellow-500"></div>

    <slot />
  </body>
</html>
```

Notes:

- `h-1.5` in Tailwind 4 is `0.375rem` = 6px — matches the brand skill's "4–6px solid yellow band" rule.
- Fonts load from Google Fonts via `display=swap` so the page never blocks on font loading. Brand skill explicitly permits this; standalone HTML artifacts use `@import` instead.
- The header and footer aren't in `Base.astro` — they're separate components composed in `index.astro` (Task 15). This keeps the layout reusable when the admin UI lands and needs different header/footer treatments per route group.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/layouts/Base.astro
git commit -m "feat(web): add Base layout with brand head + yellow band"
```

---

## Task 7: Create the `CodeBlock.astro` component

**Files:**
- Create: `apps/web/src/components/CodeBlock.astro`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/CodeBlock.astro`:

```astro
---
/**
 * Static code block with token-tinted inline styling. No syntax highlighter
 * dependency — these are hand-authored snippets, not user input.
 *
 * Pass children as raw HTML using <Fragment set:html={...} /> so individual
 * tokens can be wrapped in <span> with brand-aligned color tints.
 */

interface Props {
  /** Optional max width in pixels (default: full width of parent). */
  maxWidth?: string;
  /** Show a copy button (deferred — v1 has no copy interaction). */
  showCopy?: false;
}

const { maxWidth } = Astro.props;
---
<pre
  class="bg-gh-ink-900 text-gh-ink-50 font-mono text-[13px] leading-relaxed rounded-lg p-4 overflow-x-auto"
  style={maxWidth ? `max-width: ${maxWidth}; margin-left: auto; margin-right: auto;` : ''}
><code><slot /></code></pre>
```

The component is intentionally thin — it provides the dark background, monospace face, padding, and overflow handling. Token tinting (yellow for attribute names, lighter yellow for strings, ink-500 for punctuation/tags) happens inline in the call site via `<span style="color: ...">` so the actual snippet code stays readable in the source.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/CodeBlock.astro
git commit -m "feat(web): add CodeBlock component"
```

---

## Task 8: Add the logo asset and create `LogoWordmark.astro`

**Files:**
- Create: `apps/web/public/logo-wordmark.webp` (copied from the brand skill)
- Create: `apps/web/src/components/LogoWordmark.astro`

- [ ] **Step 1: Copy the wordmark from the brand skill's assets**

Run:

```bash
LOGO_SRC=$(find ~/.claude/plugins/cache/golden-hippo-skills -name 'logo-wordmark.webp' -path '*golden-hippo-brand*' | head -1)
echo "Source: $LOGO_SRC"
mkdir -p apps/web/public
cp "$LOGO_SRC" apps/web/public/logo-wordmark.webp
ls -la apps/web/public/logo-wordmark.webp
```

Expected: the find command resolves to one path under `~/.claude/plugins/cache/golden-hippo-skills/...`, and the `ls` shows the file copied at ~9KB.

If the find returns nothing (engineer doesn't have the plugin installed locally), download from the public CDN:

```bash
curl -fsSL -o apps/web/public/logo-wordmark.webp \
  'https://images.squarespace-cdn.com/content/v1/61896c752920de7588599ee8/12a5a634-7306-4fb1-bcf2-a57c3c33e16a/goldenhippo-wordmark+%282%29+%281%29.png?format=1500w'
```

Either source produces the same wordmark; the brand skill ships the WebP version for self-contained artifacts but the CDN PNG is fine for a deployed Astro app.

**Note on the deviation from the spec:** The spec called for base64-inline embedding "so the page is fully self-contained." That guidance came from the brand skill's HTML-report context. For a deployed Astro app with a `public/` asset pipeline, the canonical pattern is `public/logo-wordmark.webp` referenced by URL — it ships with the deploy, gets HTTP-cached, and keeps the HTML small. The "self-contained" property is preserved (the asset is in the repo and in the deploy slug). Calling this out so it doesn't surprise a reviewer.

- [ ] **Step 2: Write the component**

Create `apps/web/src/components/LogoWordmark.astro`:

```astro
---
interface Props {
  /** Pixel height — the brand skill recommends 40–48px in headers. */
  height?: number;
}

const { height = 32 } = Astro.props;
---
<img
  src="/logo-wordmark.webp"
  alt="Golden Hippo"
  height={height}
  style={`height: ${height}px; width: auto; display: block;`}
/>
```

The fixed `height` (with `width: auto`) preserves the wordmark's aspect ratio. The brand skill's "Never modify the file" rule is honored — we scale only via CSS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/logo-wordmark.webp apps/web/src/components/LogoWordmark.astro
git commit -m "feat(web): add Golden Hippo wordmark asset and component"
```

---

## Task 9: Create `Hero.astro`

**Files:**
- Create: `apps/web/src/components/Hero.astro`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/Hero.astro`:

```astro
---
import CodeBlock from './CodeBlock.astro';
---
<section class="bg-gh-ink-50 px-8 py-16 text-center">
  <span class="text-[11px] uppercase tracking-[1.2px] text-gh-ink-500 font-semibold">
    Hippo Shop SDK
  </span>

  <h1 class="font-display font-bold text-4xl md:text-5xl leading-tight mt-3 mb-4 max-w-[800px] mx-auto">
    Read Golden Hippo product data from any page in two lines of HTML
  </h1>

  <p class="text-base text-gh-ink-700 max-w-[560px] mx-auto mb-8">
    Typed DTOs. Brand-scoped access keys. Declarative HTML bindings — no JavaScript required.
  </p>

  <div class="flex flex-wrap gap-2 justify-center mb-8">
    <a
      href="https://github.com/GoldenHippoMedia/hippo-shop/blob/main/packages/sdk/README.md"
      class="bg-gh-yellow-500 hover:bg-gh-yellow-400 text-gh-ink-900 font-semibold text-sm px-5 py-2 rounded-lg transition-colors"
    >
      Read the docs
    </a>
    <a
      href="#coming-soon"
      class="bg-white border border-gh-ink-300 text-gh-ink-900 font-semibold text-sm px-5 py-2 rounded-lg"
      aria-disabled="true"
    >
      Admin — coming soon
    </a>
  </div>

  <CodeBlock maxWidth="540px">
    <Fragment set:html={`<span style="color: var(--gh-ink-500)">&lt;script</span> <span style="color: var(--gh-yellow-400)">src</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"https://api-prod.goldenhippo.io/sdk/v3/gh.js"</span>
        <span style="color: var(--gh-yellow-400)">data-key</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"…"</span> <span style="color: var(--gh-yellow-400)">data-brand</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"…"</span><span style="color: var(--gh-ink-500)">&gt;&lt;/script&gt;</span>`} />
  </CodeBlock>
</section>
```

Notes:

- The "Admin — coming soon" button anchors to `#coming-soon` (the callout section), not a real disabled state. This gives keyboard users somewhere to land. `aria-disabled="true"` signals semantics without making the link non-focusable.
- The code block's inline `<span style="color: ...">` styling uses CSS variable references so token changes propagate without editing the snippet.
- The `Fragment set:html={...}` pattern is required because the snippet contains literal `<`, `>`, and `&` characters that Astro would otherwise escape.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/Hero.astro
git commit -m "feat(web): add Hero component"
```

---

## Task 10: Create `HowItWorks.astro`

**Files:**
- Create: `apps/web/src/components/HowItWorks.astro`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/HowItWorks.astro`:

```astro
---
const steps = [
  {
    title: 'Drop the SDK script tag on your page',
    body: 'Add the script with your access key and brand. The SDK loads from the CDN and attaches <code class="font-mono text-[13px]">window.gh</code>.',
  },
  {
    title: 'Mark elements with <code class="font-mono text-[13px]">data-gh-*</code> attributes',
    body: 'Point any HTML element at a product, destination, or funnel — the SDK reads the DTO and writes the value.',
  },
  {
    title: 'Or call <code class="font-mono text-[13px]">window.gh.data</code> directly',
    body: 'For dynamic flows, the typed programmatic API is one promise away. Same auth, same DTOs, same brand scope.',
  },
];
---
<section class="bg-white px-8 py-16">
  <h2 class="font-display font-bold text-3xl text-center mb-2">How it works</h2>
  <p class="text-sm text-gh-ink-500 text-center mb-10 max-w-[540px] mx-auto">
    Three steps, no build tooling required.
  </p>

  <div class="max-w-[640px] mx-auto">
    {steps.map((step, i) => (
      <div class={`flex gap-4 py-4 items-start ${i === 0 ? '' : 'border-t border-gh-ink-100'}`}>
        <div class="bg-gh-yellow-500 text-gh-ink-900 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
          {i + 1}
        </div>
        <div>
          <h3 class="font-display font-semibold text-base mb-1">
            <Fragment set:html={step.title} />
          </h3>
          <p class="text-sm text-gh-ink-700">
            <Fragment set:html={step.body} />
          </p>
        </div>
      </div>
    ))}
  </div>
</section>
```

The titles and bodies use `<Fragment set:html>` because they contain inline `<code>` elements that need to render rather than escape.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/HowItWorks.astro
git commit -m "feat(web): add HowItWorks component"
```

---

## Task 11: Create `Features.astro`

**Files:**
- Create: `apps/web/src/components/Features.astro`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/Features.astro`:

```astro
---
const features = [
  {
    title: 'Typed DTOs',
    body: 'Published as <code class="font-mono text-[12px]">@goldenhippo/hippo-shop-types</code> on npm. Zero runtime deps; safe to import server-side too.',
  },
  {
    title: 'Declarative bindings',
    body: '<code class="font-mono text-[12px]">data-gh-product</code>, <code class="font-mono text-[12px]">data-field</code>, <code class="font-mono text-[12px]">data-format</code>, <code class="font-mono text-[12px]">data-when</code> — read DTOs into HTML with no JavaScript.',
  },
  {
    title: 'Programmatic API',
    body: '<code class="font-mono text-[12px]">window.gh.data.funnel(...)</code>, <code class="font-mono text-[12px]">.destination(...)</code>, <code class="font-mono text-[12px]">.product(...)</code> — typed promises for dynamic flows.',
  },
  {
    title: 'Brand-scoped &amp; key-gated',
    body: 'Every request is brand-scoped at Kong. Cross-brand reads return 404. CORS origins are allow-listed at the route.',
  },
];
---
<section class="bg-gh-ink-50 px-8 py-16">
  <h2 class="font-display font-bold text-3xl text-center mb-2">What you get</h2>
  <p class="text-sm text-gh-ink-500 text-center mb-10 max-w-[540px] mx-auto">
    Built for Golden Hippo's funnels, PDPs, and offer pages.
  </p>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-[760px] mx-auto">
    {features.map((feature) => (
      <div class="bg-white border border-gh-ink-300 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,17,21,0.04)]">
        <h3 class="font-display font-semibold text-sm mb-2">
          <Fragment set:html={feature.title} />
        </h3>
        <p class="text-sm text-gh-ink-500 leading-relaxed">
          <Fragment set:html={feature.body} />
        </p>
      </div>
    ))}
  </div>
</section>
```

The shadow value matches the brand skill's "whisper, not lift" specification (`box-shadow: 0 1px 2px rgba(15, 17, 21, 0.04)`).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/Features.astro
git commit -m "feat(web): add Features (2x2 cards) component"
```

---

## Task 12: Create `InAction.astro`

**Files:**
- Create: `apps/web/src/components/InAction.astro`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/InAction.astro`:

```astro
---
import CodeBlock from './CodeBlock.astro';
---
<section class="bg-white px-8 py-16">
  <h2 class="font-display font-bold text-3xl text-center mb-2">See it in action</h2>
  <p class="text-sm text-gh-ink-500 text-center mb-10 max-w-[540px] mx-auto">
    A snippet of HTML and what the SDK renders into it.
  </p>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[760px] mx-auto">
    <CodeBlock>
      <Fragment set:html={`<span style="color: var(--gh-ink-500)">&lt;span</span> <span style="color: var(--gh-yellow-400)">data-gh-product</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"sku-123"</span>
      <span style="color: var(--gh-yellow-400)">data-field</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"price"</span>
      <span style="color: var(--gh-yellow-400)">data-format</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"currency"</span><span style="color: var(--gh-ink-500)">&gt;&lt;/span&gt;</span>

<span style="color: var(--gh-ink-500)">&lt;span</span> <span style="color: var(--gh-yellow-400)">data-gh-product</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"sku-123"</span>
      <span style="color: var(--gh-yellow-400)">data-field</span><span style="color: var(--gh-ink-500)">=</span><span style="color: var(--gh-yellow-100)">"name"</span><span style="color: var(--gh-ink-500)">&gt;&lt;/span&gt;</span>`} />
    </CodeBlock>

    <div class="bg-white border border-gh-ink-300 rounded-lg p-5">
      <div class="text-[11px] uppercase tracking-[1.2px] text-gh-ink-500 font-semibold mb-3">
        Rendered
      </div>
      <div class="font-bold text-xl text-gh-ink-900">$59.99</div>
      <div class="text-sm text-gh-ink-700">Ultra Krill Oil — 60 softgels</div>
    </div>
  </div>
</section>
```

The rendered values (`$59.99`, `Ultra Krill Oil — 60 softgels`) are illustrative; they're not actually rendered by the SDK on the lander itself — the right pane is a static mockup of what the SDK would produce.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/InAction.astro
git commit -m "feat(web): add InAction (code + rendered) component"
```

---

## Task 13: Create `ComingSoon.astro`

**Files:**
- Create: `apps/web/src/components/ComingSoon.astro`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/ComingSoon.astro`:

```astro
---
// Yellow callout treatment per the brand skill (border-left 4px yellow-500,
// yellow-50 background, 0/8/8/0 radius).
---
<section id="coming-soon" class="bg-gh-ink-50 px-8 py-16">
  <div class="max-w-[640px] mx-auto bg-gh-yellow-50 border-l-4 border-gh-yellow-500 rounded-r-lg px-5 py-4">
    <p class="text-base text-gh-ink-900 leading-relaxed m-0">
      <strong>Admin self-serve is launching in a future release.</strong>
      Today, the SDK and types are usable internally with a brand-scoped access key.
      Until the admin UI ships,
      <a
        href="https://github.com/GoldenHippoMedia/hippo-shop/blob/main/packages/sdk/README.md"
        class="text-gh-ink-900 underline decoration-gh-yellow-500 decoration-2 underline-offset-[3px] hover:decoration-[3px]"
      >read the docs on GitHub</a>
      for the full attribute and API reference.
    </p>
  </div>
</section>
```

The link styling matches the brand skill's inline-link rule: ink-900 text with a 2px yellow underline at 3px offset, thickening on hover. The brand skill explicitly says "Don't recolor the text."

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ComingSoon.astro
git commit -m "feat(web): add ComingSoon callout component"
```

---

## Task 14: Create `Footer.astro` and update `Base.astro` to slot it

**Files:**
- Create: `apps/web/src/components/Footer.astro`
- Modify: `apps/web/src/layouts/Base.astro`

- [ ] **Step 1: Write the Footer component**

Create `apps/web/src/components/Footer.astro`:

```astro
---
const year = new Date().getFullYear();
---
<footer class="border-t border-gh-ink-100 px-8 py-6 text-xs text-gh-ink-500 flex flex-wrap justify-between gap-2">
  <span>Golden Hippo · Hippo Shop · {year}</span>
  <span class="flex flex-wrap gap-3">
    <a href="https://github.com/GoldenHippoMedia/hippo-shop" class="text-gh-ink-500 hover:text-gh-ink-700">
      GitHub
    </a>
    <span>·</span>
    <a href="https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk" class="text-gh-ink-500 hover:text-gh-ink-700">
      npm: @goldenhippo/hippo-shop-sdk
    </a>
    <span>·</span>
    <a href="https://github.com/GoldenHippoMedia/hippo-shop/blob/main/ROADMAP.md" class="text-gh-ink-500 hover:text-gh-ink-700">
      ROADMAP
    </a>
  </span>
</footer>
```

The brand skill's footer rule: "single row, `--gh-ink-500`, small text — date, version, owner. No yellow in the footer."

- [ ] **Step 2: Update the Base layout to include the Footer**

Modify `apps/web/src/layouts/Base.astro`. Find the `<body>` block and replace its inner content:

Old:
```astro
  <body>
    <!-- Signature yellow band: 6px, full bleed across the top. -->
    <div class="h-1.5 bg-gh-yellow-500"></div>

    <slot />
  </body>
```

New:
```astro
  <body>
    <!-- Signature yellow band: 6px, full bleed across the top. -->
    <div class="h-1.5 bg-gh-yellow-500"></div>

    <slot />

    <Footer />
  </body>
```

And add the import at the top of the frontmatter (just below the `import '../styles/global.css';` line):

```astro
import Footer from '../components/Footer.astro';
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Footer.astro apps/web/src/layouts/Base.astro
git commit -m "feat(web): add Footer and wire it into Base layout"
```

---

## Task 15: Compose the page

**Files:**
- Modify: `apps/web/src/pages/index.astro`

- [ ] **Step 1: Replace the placeholder index with the real composition**

Overwrite `apps/web/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import LogoWordmark from '../components/LogoWordmark.astro';
import Hero from '../components/Hero.astro';
import HowItWorks from '../components/HowItWorks.astro';
import Features from '../components/Features.astro';
import InAction from '../components/InAction.astro';
import ComingSoon from '../components/ComingSoon.astro';
---
<Base>
  <header class="flex items-center justify-between px-7 py-3 border-b border-gh-ink-100 text-sm">
    <LogoWordmark height={28} />
    <a
      href="https://github.com/GoldenHippoMedia/hippo-shop"
      class="text-gh-ink-500 hover:text-gh-ink-700 font-semibold"
    >
      GitHub →
    </a>
  </header>

  <main>
    <Hero />
    <HowItWorks />
    <Features />
    <InAction />
    <ComingSoon />
  </main>
</Base>
```

- [ ] **Step 2: Start the dev server and visually verify**

```bash
pnpm --filter @goldenhippo/hippo-shop-web dev
```

Open `http://localhost:4321/` in a browser. Verify the six visible elements stack in order: yellow band, header with wordmark + GitHub link, hero (label / headline / subhead / two buttons / code block), how it works (3 numbered steps), what you get (2×2 cards), see it in action (code + rendered split), coming-soon yellow callout, footer.

The composition should visually match the locked mockup. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/index.astro
git commit -m "feat(web): compose index page with all sections"
```

---

## Task 16: Add the favicon

**Files:**
- Create: `apps/web/public/favicon.svg`

- [ ] **Step 1: Create the favicon**

Create `apps/web/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#edbf26"/>
  <text x="16" y="22" text-anchor="middle" font-family="Poppins, Inter, system-ui, sans-serif" font-weight="700" font-size="18" fill="#0f1115">gh</text>
</svg>
```

A 32×32 yellow-filled rounded square with "gh" in ink-900 Poppins. Reads at favicon size; reads as a Golden Hippo glyph; honors the brand palette without modifying the wordmark file.

- [ ] **Step 2: Verify the favicon loads**

```bash
pnpm --filter @goldenhippo/hippo-shop-web dev
```

Open `http://localhost:4321/favicon.svg` directly — the yellow square with "gh" should render. The browser tab on `http://localhost:4321/` should show it too. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/favicon.svg
git commit -m "feat(web): add favicon"
```

---

## Task 17: Add the Heroku `Procfile`

**Files:**
- Create: `Procfile` (repo root)

- [ ] **Step 1: Create the Procfile**

Create `Procfile` at the repo root (not inside `apps/web/`):

```
web: node apps/web/dist/server/entry.mjs
```

That's the only line. Heroku reads it once per deploy and starts the dyno with that command. Astro's standalone Node adapter binds to `process.env.PORT` automatically, so no env wiring is needed here.

- [ ] **Step 2: Add a Heroku build hint at the repo root package.json**

Modify `package.json` (repo root). The existing `scripts` block is:

```json
"scripts": {
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    ...
}
```

Add a `heroku-postbuild` script that scopes the build to just the web app (Heroku doesn't need to build SDK + types every deploy — but it doesn't hurt either, and keeping it simple is the right v1 call). Modify the scripts block to add this line at the end (after `release`):

```json
"heroku-postbuild": "pnpm --filter @goldenhippo/hippo-shop-web build"
```

The Heroku Node buildpack runs `heroku-postbuild` after `npm install` (and via the pnpm support, after `pnpm install`). This is what produces `apps/web/dist/server/entry.mjs` that the Procfile invokes.

- [ ] **Step 3: Verify a clean build mimics what Heroku will do**

```bash
rm -rf apps/web/dist
pnpm install --frozen-lockfile
pnpm heroku-postbuild
ls apps/web/dist/server/entry.mjs
```

Expected: install completes, `heroku-postbuild` runs without error, and `entry.mjs` exists.

Confirm the standalone server boots locally with the Procfile command:

```bash
PORT=4500 node apps/web/dist/server/entry.mjs &
sleep 2
curl -s http://localhost:4500/ | grep -c 'Hippo Shop'
kill %1
```

Expected: `curl` finds the page (count > 0). The server starts, serves the page, then we kill it.

- [ ] **Step 4: Commit**

```bash
git add Procfile package.json
git commit -m "feat(web): add Procfile and heroku-postbuild for Heroku deploy"
```

---

## Task 18: Wire `apps/web` into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Inspect the current CI workflow**

Open `.github/workflows/ci.yml`. The existing build step is:

```yaml
      - name: Build
        run: pnpm nx run-many -t build
```

This already builds all projects with a `build` target. `apps/web` has a `build` script in its `package.json`, so nx picks it up automatically — **no edit needed if the build step is already `run-many`**.

The typecheck step is:

```yaml
      - name: Typecheck
        run: pnpm nx affected -t typecheck --base=origin/main
```

`apps/web` has a `typecheck` script (`astro check`). Affected-typecheck will run it whenever apps/web files change.

- [ ] **Step 2: Verify CI runs cleanly locally**

```bash
pnpm install --frozen-lockfile
pnpm nx run-many -t build
pnpm nx run-many -t typecheck
```

Expected: both targets pass. `web:build` produces `apps/web/dist/`. `web:typecheck` runs `astro check` and reports zero errors.

If `web:typecheck` reports errors (most likely "Cannot find name 'Astro'" or similar), confirm `tsconfig.json` has `"types": ["astro/client"]`. If errors are about missing module declarations for `.astro` files, that's the same fix.

- [ ] **Step 3: No commit needed if no file changed**

If Step 1 confirmed the workflow already does the right thing, there's nothing to commit at this task. If you had to add anything to `ci.yml` (e.g., a separate `web` step), commit it now:

```bash
git add .github/workflows/ci.yml
git commit -m "ci(web): wire apps/web into CI build and typecheck"
```

---

## Task 19: Full local verification + brand self-check

**Files:**
- None (verification only)

This task ends in zero commits unless verification surfaces issues. It exists to catch them before the PR.

- [ ] **Step 1: Clean rebuild from scratch**

```bash
rm -rf apps/web/dist apps/web/node_modules .nx/cache
pnpm install --frozen-lockfile
pnpm nx run-many -t build
```

Expected: clean install + clean build with no warnings about missing peer deps, no Tailwind class warnings, no Astro errors.

- [ ] **Step 2: Boot the production build locally**

```bash
PORT=4500 node apps/web/dist/server/entry.mjs &
sleep 2
```

Open `http://localhost:4500/` in a browser. Walk through each visible element top-to-bottom:

1. **Yellow band** at the very top. 6px solid `#edbf26`. Full bleed.
2. **Header** below the band: wordmark on the left (Golden Hippo, all yellow), "GitHub →" link on the right in ink-500.
3. **Hero section** (light ink-50 background): "Hippo Shop SDK" eyebrow label, large display headline, subhead, "Read the docs" yellow button + "Admin — coming soon" outline button, a dark code block showing the `<script>` snippet.
4. **How it works** (white background): "How it works" heading, three numbered steps with yellow numerals.
5. **What you get** (ink-50 background): "What you get" heading, four feature cards in 2×2 grid.
6. **See it in action** (white): "See it in action" heading, code + rendered split.
7. **Coming-soon callout** (ink-50): yellow left-border callout with one paragraph and the GitHub-docs link.
8. **Footer**: "Golden Hippo · Hippo Shop · <year>" on the left; three links on the right.

Then kill the server:

```bash
kill %1
```

- [ ] **Step 3: Brand-skill self-check (11 items)**

Confirm each from the `golden-hippo-brand` skill's "Self-check" section against the rendered page:

- [ ] Yellow band at the top of HTML output (6px)
- [ ] No more than one solid-yellow CTA per viewport (only "Read the docs" is yellow-filled in the hero)
- [ ] No more than one yellow callout per screen-worth of content (one callout — the ComingSoon section)
- [ ] Body text uses `--gh-ink-900`, never `#000`
- [ ] Poppins loaded (browser DevTools → Network → fonts.googleapis.com response 200)
- [ ] No charts in this artifact (skipped)
- [ ] No emojis anywhere on the page
- [ ] No corporate filler ("synergize," "leverage," "best-in-class") in any copy
- [ ] Generous whitespace — section padding 64px (py-16) on desktop
- [ ] Logo present and unmodified (correct yellow `#edbf26`, original aspect ratio)

If any check fails, fix the relevant component file and re-verify. Commit the fix with a focused message (`fix(web): correct …`).

- [ ] **Step 4: Mobile sanity check**

Open DevTools, switch to a mobile viewport (375×667). Confirm:

- [ ] Header stays a single row (wordmark + GitHub link)
- [ ] Hero buttons stack or wrap, code block scrolls horizontally not breaking the layout
- [ ] How it works steps remain readable (no horizontal scroll)
- [ ] Features grid collapses to a single column
- [ ] In-action split collapses to a single column (code above, rendered below)
- [ ] Callout text wraps gracefully
- [ ] Footer wraps to two rows if needed without overflow

No commit if everything looks clean. If you tweaked spacing/grid, commit `style(web): mobile breakpoint fixes`.

---

## Task 20: Update `/ROADMAP.md`

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Split the Cluster E entry**

Open `ROADMAP.md`. Find the existing entry:

```markdown
### Cluster E — Admin UI + marketing lander at `hippo-shop.goldenhippo.io`
Status: idea
Added: 2026-05-17

A web app that serves two purposes: (1) a marketing lander for internal teams that explains what Hippo Shop does and how it empowers them, and (2) an admin UI behind Google login (@goldenhippo.com required) for requesting and managing access keys, authorized origins, and (eventually) per-team relationships. Regular users can request a new key, see their request status, view their issued keys, and manage their domain allow-list. Admins can manage all relationships. Future: request-count visibility, possibly sourced from Kong logs via Logtail on Heroku.
```

Replace it with two entries:

```markdown
### Cluster E v1 — Public lander at `hippo-shop.goldenhippo.io`
Status: in-progress
Added: 2026-05-17

A single-page Astro lander that explains Hippo Shop and points at the SDK docs on GitHub. Stack chosen for the eventual admin UI: Astro 5 + Tailwind 4 + Node adapter on Heroku, `apps/web/` in the monorepo. No auth, no admin operations in v1 — the page signals "admin self-serve coming soon" and links to GitHub for the docs.

Related: `docs/superpowers/specs/2026-05-18-cluster-e-v1-lander-design.md`, `docs/superpowers/plans/2026-05-18-cluster-e-v1-lander.md`

### Cluster E2 — Admin UI (Google login, key & origin management)
Status: idea
Added: 2026-05-17

Adds the gated half of the web app: Google OAuth restricted to `@goldenhippo.com`, requests/issuance of brand-scoped access keys, per-key authorized-origin allowlists, and eventually per-team relationships. Regular users see their own requests and keys; admins see and manage all relationships. Future: request-count visibility, possibly sourced from Kong logs via Logtail on Heroku. Builds on top of `apps/web/` from Cluster E v1.
```

This keeps the original 2026-05-17 add-date (when the cluster was first conceived) and splits the work across two ROADMAP items.

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): split Cluster E into v1 (lander) and E2 (admin)"
```

---

## Post-implementation

After all tasks ship and the PR merges:

1. **Heroku deploy** — Push `main` to the Heroku Git remote: `git push heroku main`. The buildpack runs `pnpm install` + `heroku-postbuild`, the slug starts via the Procfile.
2. **Domain wiring** — `heroku domains:add hippo-shop.goldenhippo.io --app <heroku-app-name>`. The DNS CNAME and ACM cert are presumed already in place (pre-flight).
3. **Smoke-test prod** — `curl -I https://hippo-shop.goldenhippo.io/` returns 200, `text/html` content-type.
4. **Flip ROADMAP** — Move Cluster E v1 from "in-progress" to "done" with the ship date and PR reference. The PR description is the easiest place to capture the operational details (Heroku app name, dyno tier, etc.) for future audit.
