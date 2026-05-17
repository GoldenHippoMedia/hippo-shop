# SDK README Full-Reference Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `packages/sdk/README.md` from ~387 lines to a ~700-line complete partner-facing reference covering every public SDK feature.

**Architecture:** Single-file expansion. Each task adds or restructures one logical chunk of the README (top-to-bottom). No source / test / demo / changeset / release changes. Existing approved partner-facing sections (Hero, Installation, Quickstart, Recipes, Evaluation order, Size budget, Provenance, License) are preserved verbatim. The four existing recipes stay unchanged.

**Tech Stack:** Markdown (GitHub-flavored). No new dependencies. Plain HTML / JS / TypeScript code blocks (must parse).

**Source of truth:** `docs/superpowers/specs/2026-05-16-sdk-readme-full-reference-design.md` (commit `8caf836`).

**Generic sample data convention:** brand `Sample Co`, product slug `multi-vitamin`, funnel slug `multi-vitamin-funnel`, destination slug `multi-vitamin-3pack-sub`, publishable key `gh_pk_yourbrand_xxxxxx`. Never reference Gundry / Bio Complete 3 / any real brand.

**Commit convention:** `docs(sdk): <imperative summary>` matching recent commits.

---

## File Structure

**Modified files:**
- `packages/sdk/README.md` — the only file touched in this plan

**No new files.** **No source / test / demo changes.**

---

## Working principles

- **Read the file before each edit.** Line numbers shift as edits happen; locate insertion points by heading text (`grep -n "^## "`), not absolute line numbers.
- **One section per commit.** Easier to revert; the resulting git log doubles as a per-section changelog.
- **Don't touch what isn't in scope.** Preserve the Hero, Installation, Quickstart, Loops, data-with, data-when, Recipes, Evaluation order, Size budget, Provenance, and License sections **exactly as they are** unless this plan explicitly says otherwise.
- **All code blocks must parse.** No `…` placeholders inside fenced code; if you need to elide, use a comment like `<!-- snip -->` outside the fence.
- **No emojis. No new dependencies. No Mermaid. No images.**

---

## Task 1: Add table of contents and "How it works" section

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Read current README**

Run: `wc -l packages/sdk/README.md && grep -n "^## " packages/sdk/README.md`
Expected: 387 lines, 13 top-level headings starting at line 18.

- [ ] **Step 2: Insert the table of contents after the hero block**

Locate the line containing `---` immediately before `## Installation` (around line 16–17). Insert the following block BEFORE that `---`:

```markdown
## Contents

- [Installation](#installation)
- [Quickstart — declarative](#quickstart--declarative)
- [How it works](#how-it-works)
- [Script tag config](#script-tag-config)
- [Declarative attributes](#declarative-attributes)
- [Formatters](#formatters)
- [Loops](#loops)
- [Declarative scope (`data-with`)](#declarative-scope-data-with)
- [Resource lifecycle (`data-when`)](#resource-lifecycle-data-when)
- [Recipes](#recipes)
- [Evaluation order](#evaluation-order)
- [Programmatic API](#programmatic-api)
- [Lifecycle events](#lifecycle-events)
- [Resource caching](#resource-caching)
- [HTTP](#http)
- [Errors](#errors)
- [Safety](#safety)
- [Advanced — TypeScript / NPM consumers](#advanced--typescript--npm-consumers)
- [Size budget](#size-budget)
- [Provenance](#provenance)
- [License](#license)

---
```

> The TOC lists every level-2 heading the final README will contain. Some of these sections don't exist yet — Task 8 verifies all anchors resolve at the end.

- [ ] **Step 3: Insert the "How it works" section after Quickstart**

Locate the `---` separator that follows the `## Quickstart — declarative` section (immediately before `## Attribute reference`). Insert the following content BEFORE that `---`:

````markdown
## How it works

A quick mental model before the reference tables.

### Boot lifecycle

1. The browser loads the SDK `<script>`. The IIFE executes immediately.
2. The SDK parses its `data-key` / `data-brand` config from the script tag and derives the API base URL from the script's own host.
3. `window.gh.data`, `gh.bind`, `gh.refresh`, and `gh.format` are attached synchronously.
4. The SDK dispatches `gh:data-ready` on `window`.
5. The first bind pass is scheduled — on `DOMContentLoaded` if the document is still loading, or via `setTimeout(0)` if `DOMContentLoaded` has already fired. The deliberate `setTimeout(0)` (rather than a microtask) gives inline scripts placed after the SDK tag a chance to run first — so a script that registers a custom formatter is picked up by the first bind pass.
6. The bind pass scans the document, fetches every referenced resource, renders the bindings, and dispatches `gh:bindings-ready` (once, after the post-fetch pass).
7. A `MutationObserver` attaches and re-binds on relevant DOM changes (see [Re-binding](#re-binding-mutationobserver)).

### Two-pass binding

When a page references resources that aren't yet cached, the SDK actually runs the bind walker **twice**:

- **Pre-fetch pass.** Every unloaded resource is marked `loading` in an internal lifecycle map. Elements with `data-when="loading"` show their skeletons immediately; elements that depend on actual data are left untouched.
- **Post-fetch pass.** Once all fetches settle (success or failure), the walker runs again with the final data and lifecycle states. `data-when="loaded"` blocks render real values; `data-when="failed"` blocks show error fallbacks.

`gh:bindings-ready` fires once, after the post-fetch pass.

### Re-binding (MutationObserver)

The runtime installs a `MutationObserver` after the initial bind so late-arriving content gets bound automatically. It watches for:

- Additions of any element subtree (e.g. a modal opened by your own JS, a GTM injection, a SPA route change).
- Attribute changes on any of: `data-gh-product`, `data-gh-destination`, `data-gh-funnel`, `data-field`, `data-format`, `data-if`, `data-if-not`, `data-each`, `data-with`, `data-when`.

Mutations caused by the SDK's own loop expansion are ignored (they carry a `data-gh-loop-clone` marker) to prevent feedback loops. Re-binds are coalesced via a single microtask, so a burst of DOM changes triggers only one extra bind pass.

If you mutate the DOM in a way the observer doesn't catch (e.g. you swap an element's `data-gh-product` to a slug that's already cached and immediately need it bound), call `window.gh.bind(element)` to force a scan.
````

- [ ] **Step 4: Verify**

Run: `grep -n "^## " packages/sdk/README.md`
Expected: a new heading `## Contents` near the top and `## How it works` between `## Quickstart — declarative` and `## Attribute reference`. Total top-level headings increased from 13 to 15.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): add table of contents and "How it works" section

Anchored TOC at the top of the SDK README plus a new "How it works"
section that establishes the mental model (boot lifecycle, two-pass
binding, MutationObserver re-binding) before partners hit the
reference tables.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Restructure Attribute reference; expand Script tag config and Declarative attributes

**Files:**
- Modify: `packages/sdk/README.md`

This task collapses the current `## Attribute reference` umbrella into separate top-level sections and substantially expands the script-tag + declarative-attribute documentation.

- [ ] **Step 1: Re-read current README**

Run: `grep -n "^## \|^### " packages/sdk/README.md`
Expected: the umbrella `## Attribute reference` with `### Script tag`, `### Declarative attributes`, `### Formatters`, `### Loops` as its subsections.

- [ ] **Step 2: Remove the umbrella `## Attribute reference` heading**

Delete the single line `## Attribute reference` (and the blank line that follows, if there is one). The content immediately under it becomes the start of the new `## Script tag config` section. Do NOT change any of the prose under it yet.

- [ ] **Step 3: Replace the `### Script tag` block with the expanded `## Script tag config` section**

Locate the block that currently starts with `### Script tag` (and ends just before `### Declarative attributes`). Replace it entirely with:

````markdown
## Script tag config

The SDK boots from a single `<script>` tag. All configuration lives on that tag's `data-*` attributes; nothing else is required.

### Attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-key` | yes | — | Publishable key. Must match `/^gh_pk_[a-z0-9_-]+_<hex>$/` (e.g. `gh_pk_yourbrand_a1b2c3d4e5f6`). |
| `data-brand` | yes | — | Brand display name. Must be non-empty after trimming. Validated server-side. |
| `data-debug` | no | `"false"` | If set to the string `"true"`, the SDK logs requests, cache hits, and bind passes to the browser console with a `[gh]` prefix. Also sets `window.gh.debug = true`. |

The script tag itself is auto-located via `document.currentScript`; if that's unavailable, the SDK falls back to `script[data-key][data-brand][src*="/sdk/v1/gh"]`, then to `script[data-key][data-brand][src$="/gh.js"]` (the latter is a local-dev convenience so a page served from a non-`/sdk/v1/` path still boots).

If `window.gh.data` is already attached when the SDK boots — for example, because the tag is included twice — the SDK refuses to overwrite the existing surface and logs a warning. This is harmless but worth knowing if you see "window.gh.data already exists" in the console.

### Host allowlist

The API base URL is derived from the script tag's `src` host. Only the following hosts are accepted:

| Host | Use |
|------|-----|
| `api-prod.goldenhippo.io` | Production |
| `api-uat.goldenhippo.io` | UAT / staging |
| `localhost`, `127.0.0.1`, `[::1]` | Local development |
| `*.local` | Local development on `.local` hostnames |

Loading the SDK from any other host throws a config error and refuses to attach. The host is part of the contract — partners cannot point the SDK at an unrecognized API server.
````

- [ ] **Step 4: Replace the `### Declarative attributes` block with the expanded `## Declarative attributes` section**

Locate the block that currently starts with `### Declarative attributes` (and ends just before `### Formatters`). Replace it entirely with:

````markdown
## Declarative attributes

Write HTML; the SDK reads the `data-*` attributes below, fetches the right resources, and renders values.

### Reference

| Attribute | Where | What it does |
|-----------|-------|--------------|
| `data-gh-product="slug"` | Any element | Sets the **product** context for the element + descendants. |
| `data-gh-destination="slug"` | Any element | Sets the **destination** context. |
| `data-gh-funnel="slug"` | Any element | Sets the **funnel** context. |
| `data-with="path"` | Any element | Narrows the binding scope to the resolved value; hides on null/undefined. See [Declarative scope](#declarative-scope-data-with). |
| `data-when="loaded\|loading\|failed"` | Any element | Shows the element only when the closest resource is in that lifecycle state. See [Resource lifecycle](#resource-lifecycle-data-when). |
| `data-field="path"` | Any element | Replaces `textContent` with the resolved value. Undefined leaves the placeholder. |
| `data-format="name[:arg1[:arg2…]]"` | With `data-field` or `data-attr-*` | Formats the bound value. See [Formatters](#formatters). |
| `data-attr-<NAME>="path"` | Any element | Sets the `<NAME>` attribute to the resolved value. `data-attr-on*` and `data-attr-srcdoc` are refused. |
| `data-attr-format-<NAME>="..."` | With `data-attr-<NAME>` | Per-attribute formatter override. An empty value (`data-attr-format-foo=""`) short-circuits an inherited `data-format`. |
| `data-if="path"` | Any element | Hides the element (and skips the subtree) if the path resolves to a falsy value. |
| `data-if-not="path"` | Any element | Hides the element (and skips the subtree) if the path resolves to a truthy value. |
| `data-each="path"` | `<template>` only | Clones the template's content once per item in the array at `path`. |

### Paths

`data-field`, `data-with`, `data-if`, `data-if-not`, `data-each`, `data-attr-<NAME>`, and `data-attr-format-<NAME>` all accept a **dot-path** that resolves against the closest enclosing data context.

- Dot-separated segments only. `a.b.c` reads `obj.a.b.c`.
- Numeric segments traverse arrays. `items.0.name` reads `obj.items[0].name`.
- An empty path resolves to the bound object itself (useful with `data-with` and `data-each` when the value already lives at the current scope).
- A missing or non-traversable segment resolves to `undefined`. The resolver never throws.

For product variants, prefer the keyed lookup `variants.subscription.standardByQuantity.<qty>.price` over the array form `variants.subscription.standardList.<index>.price`. The former is stable across catalog reorderings; the latter is only useful inside `<template data-each>` loops.

> **Deprecation:** the legacy array form `variants.<purchase>.<tier>` (without the `List` / `ByQuantity` suffix) is deprecated and will be removed in v3.0.0. Use `<tier>List` for iteration and `<tier>ByQuantity` for direct lookup by quantity.

### `data-attr-<NAME>` details

The `<NAME>` portion is the literal HTML attribute name (lowercased on read by the browser). Hyphens are preserved:

```html
<button
  data-field="ctaLabel"
  data-attr-aria-label="ctaAccessibleLabel"
></button>
```

Refused targets:

- `data-attr-on*` — event handlers are never bound from data, period.
- `data-attr-srcdoc` — `<iframe srcdoc>` is a raw HTML island; binding it would defeat the textContent-only safety rule.

URL-bearing attributes (`href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`, `manifest`) pass through a scheme check that refuses `javascript:`, `vbscript:`, and `data:` URLs. See [Safety](#safety) for the full rule.

### `data-attr-format-<NAME>` — per-attribute formatter override

When an element carries both `data-field` and `data-attr-*` bindings, `data-format` applies to both by default. To format an attribute differently, use `data-attr-format-<NAME>`:

```html
<span
  class="stock-pill"
  data-field="outOfStock"
  data-format="bool:Out of stock:In stock"
  data-attr-data-stock="outOfStock"
  data-attr-format-data-stock="bool:out:in"
>…</span>
```

Here the visible label renders via the human-readable `bool:Out of stock:In stock` formatter, while the `data-stock` attribute mirrors the same field through `bool:out:in` so CSS can target `[data-stock="in"]` and `[data-stock="out"]`.

An empty value short-circuits any inherited `data-format`:

```html
<a data-field="title" data-format="uppercase"
   data-attr-href="url" data-attr-format-href="">
```

The element's text is uppercased; the `href` attribute is set to the raw `url` value, ignoring the `uppercase` formatter that would otherwise inherit.

### Markup the SDK writes back

The SDK writes a handful of bookkeeping attributes that you can rely on as **stable CSS hooks**. Target them in your stylesheet to add transitions, debug overlays, or layout rules.

| Marker | Where | Meaning |
|--------|-------|---------|
| `data-gh-hidden` | On any element the SDK has hidden via `data-if` / `data-if-not` / `data-when` / `data-with` miss | Lets CSS distinguish SDK-hidden elements from author-hidden ones. The element's `style.display` is also set to `none`. |
| `data-gh-prior-display` | Dataset key (`element.dataset.ghPriorDisplay`) on the same hidden element | Preserves the pre-hide `style.display` so unhide restores it. Only present when a non-`none` inline display was set before hiding. |
| `data-gh-loop-clone` | On every top-level element produced by `<template data-each>` | Lets CSS target loop items without changing markup (e.g. `[data-gh-loop-clone] { animation: fade-in 0.2s; }`). Also used internally to filter MutationObserver feedback loops. |

These are part of the contract — they will not change in a minor release.
````

- [ ] **Step 5: Promote `### Loops` to `## Loops`**

Locate the line `### Loops` (currently a subsection of the now-removed `## Attribute reference`). Replace it with `## Loops`. Leave the body unchanged.

- [ ] **Step 6: Promote `### Formatters` to `## Formatters`**

Locate the line `### Formatters` (currently a subsection of the now-removed `## Attribute reference`). Replace it with `## Formatters`. Leave the body unchanged — Task 3 expands this section.

- [ ] **Step 7: Verify**

Run: `grep -n "^## " packages/sdk/README.md`
Expected: `## Contents`, `## Installation`, `## Quickstart — declarative`, `## How it works`, `## Script tag config`, `## Declarative attributes`, `## Formatters`, `## Loops`, `## Declarative scope...`, `## Resource lifecycle...`, `## Recipes`, `## Evaluation order`, `## Programmatic API`, `## Errors`, `## Safety`, `## Size budget`, `## Provenance`, `## License`. The old `## Attribute reference` should no longer appear.

Also run: `grep -c "^### " packages/sdk/README.md`
Expected: 4 recipe headings + 1 Lifecycle events + the new `### Attributes`, `### Host allowlist`, `### Reference`, `### Paths`, `### \`data-attr-<NAME>\` details`, `### \`data-attr-format-<NAME>\` — per-attribute formatter override`, `### Markup the SDK writes back`, `### Boot lifecycle`, `### Two-pass binding`, `### Re-binding (MutationObserver)`. (Approximately 14–15 `### ` headings total.)

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): split Attribute reference and expand declarative reference

Removes the umbrella "Attribute reference" heading and promotes its
former subsections (Script tag, Declarative attributes, Formatters,
Loops) to top-level sections. Expands Script tag config with the full
key pattern, host allowlist, and local-dev fallback. Expands the
declarative-attribute reference with path semantics, per-attribute
formatter overrides, and a "Markup the SDK writes back" subsection
documenting the stable CSS hooks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Expand Formatters section

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Re-read the current Formatters section**

Run: `grep -n "^## Formatters" packages/sdk/README.md`
Confirm there's exactly one `## Formatters` heading (created in Task 2 step 6).

- [ ] **Step 2: Replace the `## Formatters` block entirely**

Locate the block that starts with `## Formatters` and ends immediately before `## Loops`. Replace it with:

````markdown
## Formatters

`data-format="name[:arg1[:arg2…]]"` applies a formatter to a bound value before it lands in the DOM. The same registry powers `data-attr-format-<NAME>` overrides.

### Built-in formatters

| Name | Example | Output |
|------|---------|--------|
| `currency` | `currency` / `currency:USD` / `currency:EUR:en-GB` | `$49.95` (default USD, locale default) |
| `number` | `number` / `number:0` / `number:2:en-US` | `1,234` / `1,234.50` |
| `percent` | `percent` / `percent:1` | `25%` / `12.3%` (input is a fraction — see below) |
| `uppercase` | `uppercase` | `MULTI VITAMIN` |
| `lowercase` | `lowercase` | `multi vitamin` |
| `bool` | `bool:In stock:Sold out` | First arg if truthy; second if falsy |
| `join` | `join` / `join: - ` | Joins arrays with the separator (default `, `) |

### `percent` semantics

The `percent` formatter expects its input to be a **fraction** between 0 and 1, not a 0–100 number. `0.25` renders as `"25%"`, not `"0.25%"`. If your data already arrives as 0–100 (e.g. a survey score), divide by 100 before binding — or wrap it in a custom formatter (see below).

### Failure modes

Formatters are intentionally non-throwing. A single misformatted value never breaks the rest of the page.

- **Unknown name** (`data-format="nonexistent"`) → the raw value is rendered via `String(value)`.
- **Unconvertible value** (e.g. `currency` applied to `"foo"`) → falls back to `String(value)`.
- **Null or undefined value** → renders as the empty string `""`.

### Registering custom formatters

Use the registry on `window.gh.format`:

```js
window.gh.format.register('shouty', (value) => String(value).toUpperCase() + '!');
```

Then in HTML:

```html
<span data-field="name" data-format="shouty"></span>
```

If you register a custom formatter from an inline `<script>` placed **after** the SDK script tag, you do not need to call `gh.refresh()` — the SDK schedules its first bind pass via `setTimeout(0)` so your registration runs first. See [Lifecycle events](#lifecycle-events).

Custom formatters receive the bound value as their first argument; additional `:`-separated values from the `data-format` spec arrive as **string** arguments. Convert types yourself:

```js
window.gh.format.register('savePercent', (savings, fullPriceStr) => {
  const full = Number(fullPriceStr);
  if (!savings || !Number.isFinite(full) || full === 0) return '';
  return 'Save ' + Math.round((savings / (full + savings)) * 100) + '%';
});
```

### FormatRegistry — typed methods

The `window.gh.format` object also exposes the three numeric built-ins as typed methods, plus introspection helpers. Reach for these when you want to format a value in your own JavaScript (e.g. inside a custom formatter or after a manual `gh.data.product(slug)` call) without re-implementing the locale logic:

```js
window.gh.format.currency(49.95);                 // "$49.95"
window.gh.format.currency(49.95, 'EUR', 'en-GB'); // "€49.95"
window.gh.format.number(1234.5);                  // "1,234.5"
window.gh.format.number(1234.5, 2, 'en-US');      // "1,234.50"
window.gh.format.percent(0.123);                  // "12%"
window.gh.format.percent(0.123, 1);               // "12.3%"
window.gh.format.has('shouty');                   // false (unless registered)
window.gh.format.apply('hello', 'uppercase');     // "HELLO"
```

`apply(value, spec)` is the same entry point the declarative bindings use; it accepts the full `"name[:arg1[:arg2…]]"` syntax and inherits all failure-mode behavior described above.
````

- [ ] **Step 3: Verify**

Run: `grep -n "^### " packages/sdk/README.md | grep -E "Built-in formatters|percent semantics|Failure modes|Registering custom formatters|FormatRegistry"`
Expected: 5 matching `### ` subsections under Formatters.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): expand Formatters section with semantics and typed methods

Documents the percent-is-a-fraction semantic, the three soft-fail
modes (unknown name, unconvertible value, null/undefined), and the
FormatRegistry typed methods (currency/number/percent/has/apply).
Adds a note on the setTimeout(0) boot quirk that lets inline custom
formatter registrations land before the first bind pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Expand Programmatic API; promote and expand Lifecycle events

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Re-read current Programmatic API section**

Run: `grep -n "^## Programmatic API\|^### Lifecycle events" packages/sdk/README.md`
Confirm both exist. Lifecycle events is currently a `###` subsection.

- [ ] **Step 2: Replace the `## Programmatic API` block (up to but not including `## Errors`)**

Locate `## Programmatic API` and everything down to (but not including) `## Errors`. Replace with:

````markdown
## Programmatic API

Everything the declarative layer does is also exposed on `window.gh`. Useful when you want to fetch data without binding (e.g. server-side rendering preview), open a modal whose markup needs binding, or invalidate the cache after a known data change.

### `window.gh` surface

```ts
window.gh.data.funnel(slugOrId):      Promise<HippoShopFunnelDTO>;
window.gh.data.destination(slugOrId): Promise<HippoShopDestinationDTO>;
window.gh.data.product(slugOrId):     Promise<HippoShopProductDTO>;

window.gh.bind(rootElement):    Promise<void>;
window.gh.refresh():            Promise<void>;

window.gh.format: FormatRegistry; // see the Formatters section
window.gh.debug?: true;           // present only when data-debug="true" on the script tag
```

The promises returned by `gh.data.*` resolve with **enriched** payloads. Products in particular gain the `<tier>List` and `<tier>ByQuantity` sibling fields described under [Loops](#loops) and [Declarative scope](#declarative-scope-data-with) — the same shape your declarative bindings see.

Types live in `@goldenhippo/hippo-shop-types`. Install it for IntelliSense in TypeScript projects:

```bash
pnpm add @goldenhippo/hippo-shop-types
```

### Manually binding a subtree

`gh.bind(element)` scans the given subtree for `data-gh-*` references, fetches anything not yet cached, and renders the bindings. Use it when you've inserted markup the `MutationObserver` won't catch in time — typically a modal you've just attached and want bound before it's visible.

```js
const modal = document.getElementById('cart-modal');
modal.innerHTML = `
  <article data-gh-product="multi-vitamin">
    <h2 data-field="name"></h2>
    <p data-field="variants.subscription.standardByQuantity.3.price"
       data-format="currency:USD"></p>
  </article>
`;
await window.gh.bind(modal);
modal.classList.add('open');
```

`gh.bind` is safe to call on the same subtree repeatedly — bindings are idempotent and prior loop clones are removed before re-expansion.

### Refreshing cached data

`gh.refresh()` drops every cached resource, clears the lifecycle-state map, and re-binds the document. Use it when you know the underlying data has changed (e.g. you just informed the API of a price update) and you want the page to reflect it without a full reload.

```js
await window.gh.refresh();
```

`refresh()` returns the same promise as `bind(document)` and resolves after the post-fetch pass completes.

## Lifecycle events

Two events fire on `window` during boot:

| Event | When |
|-------|------|
| `gh:data-ready` | The synchronous setup is done — `window.gh.data`, `bind`, `refresh`, and `format` are attached. Fires before the first bind pass. |
| `gh:bindings-ready` | The initial bind pass has completed, including all initial fetches. Fires **once** per page lifetime. |

### Defensive "already booted?" pattern

The SDK boots synchronously when its `<script>` tag finishes loading. Inline scripts placed **below** that tag may miss `gh:data-ready` because it fires before they run. To handle both orderings, check for the surface first:

```js
function whenReady() {
  // window.gh.data is now attached
  window.gh.format.register('savePercent', (savings, fullPriceStr) => {
    const full = Number(fullPriceStr);
    if (!savings || !Number.isFinite(full) || full === 0) return '';
    return 'Save ' + Math.round((savings / (full + savings)) * 100) + '%';
  });
}

if (window.gh && window.gh.data) whenReady();
else window.addEventListener('gh:data-ready', whenReady, { once: true });
```

### Inline-script timing

If your custom formatter registration sits in an inline `<script>` placed **after** the SDK tag but **before** `DOMContentLoaded`, the SDK's `setTimeout(0)` scheduling guarantees your inline script runs before the first bind pass — so `gh.refresh()` is unnecessary.

If you register a formatter **after** `gh:bindings-ready` has fired (e.g. from an async chunk that loads lazily), call `gh.refresh()` so existing elements pick up the new formatter.

```js
window.addEventListener('gh:bindings-ready', async () => {
  // first bind is done; we can safely add late formatters and re-render
  window.gh.format.register('shouty', (v) => String(v).toUpperCase() + '!');
  await window.gh.refresh();
}, { once: true });
```
````

- [ ] **Step 3: Verify**

Run: `grep -n "^## Programmatic API\|^## Lifecycle events" packages/sdk/README.md`
Expected: both heads exist as `##` (Lifecycle events is now top-level).

Run: `grep -c "^### " packages/sdk/README.md`
Expected: increased by 5 (three under Programmatic API: `\`window.gh\` surface`, `Manually binding a subtree`, `Refreshing cached data`; two under Lifecycle events: `Defensive "already booted?" pattern`, `Inline-script timing`).

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): expand Programmatic API and promote Lifecycle events

Promotes Lifecycle events from a Programmatic API subsection to its
own top-level section. Documents the enriched-product return shape of
gh.data.product, the gh.bind / gh.refresh use cases, window.gh.debug,
and the inline-script timing guarantee for custom formatters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Resource caching and HTTP sections

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Re-read current README**

Run: `grep -n "^## " packages/sdk/README.md`
Expected: `## Lifecycle events` (added in Task 4) is followed directly by `## Errors`.

- [ ] **Step 2: Insert Resource caching + HTTP sections between Lifecycle events and Errors**

Locate the first line of `## Errors`. Insert the following block immediately BEFORE it (separated by a blank line):

````markdown
## Resource caching

The SDK keeps an in-memory cache of resource fetches keyed by `<kind>:<slug>` (e.g. `product:multi-vitamin`). The cache stores **promises**, not resolved values, which means:

- **Concurrent calls dedupe.** Two `gh.data.product('multi-vitamin')` calls fired at the same time share a single HTTP request.
- **Resolved values stay cached** for the lifetime of the page. Successive calls return immediately.
- **Rejected promises are evicted.** A failed fetch (network error, 5xx, etc.) is removed from the cache as soon as it settles, so the next call retries instead of returning the stuck failure.

There is no `localStorage` and no cross-tab persistence — every page load starts with an empty cache.

To invalidate the cache explicitly, call `gh.refresh()` (see [Programmatic API](#programmatic-api)). This clears the resource cache, clears the lifecycle-state map, and re-runs the bind pass.

---

## HTTP

What the SDK sends and how it talks to the API.

### Endpoints

All three resource types use the same shape:

| Method | URL | Returns |
|--------|-----|---------|
| `GET` | `<base>/public/v1/funnel/<slugOrId>` | `HippoShopFunnelDTO` |
| `GET` | `<base>/public/v1/destination/<slugOrId>` | `HippoShopDestinationDTO` |
| `GET` | `<base>/public/v1/product/<slugOrId>` | `HippoShopProductDTO` (client-side enriched) |

`<slugOrId>` is URL-encoded before insertion. The product endpoint is client-side enriched — the raw response is passed through `enrichProduct` to attach the `<tier>List` and `<tier>ByQuantity` sibling fields before it resolves.

### Headers sent

| Header | Value |
|--------|-------|
| `X-GH-Key` | Your publishable key (from `data-key`) |
| `X-GH-Brand` | Your brand display name (from `data-brand`) |
| `Accept` | `application/json` |

The SDK does not send credentials (cookies are not included), does not set a `User-Agent` beyond the browser default, and does not send any analytics or PII.

### Base URL derivation

The API base URL is the script tag's `src` origin. Loading the SDK from `https://api-prod.goldenhippo.io/sdk/v1/gh.js` produces a base URL of `https://api-prod.goldenhippo.io`; loading it from `https://api-uat.goldenhippo.io/sdk/v1/gh.js` produces `https://api-uat.goldenhippo.io`. See [Script tag config — Host allowlist](#host-allowlist) for the full list of accepted hosts.

### Status → error code mapping

When a fetch returns a non-2xx status, the SDK constructs a `GhError` with a code derived from the response. The server's response body may supply an explicit `code`; otherwise the SDK infers from the status:

| HTTP status | `GhError.code` |
|-------------|----------------|
| 401, 403 | `forbidden` |
| 404 | `not_found` |
| 429 | `rate_limited` |
| Other 4xx | `bad_request` |
| 5xx | `server` |

Network errors (the fetch itself rejects) surface as `network`. Bad client-side config (bad key pattern, missing brand, disallowed host) surfaces as `bad_config` and is thrown during boot.

### `Retry-After` parsing

Rate-limited responses (status `429`) carry a `Retry-After` header. The SDK parses both forms allowed by the spec:

- Seconds — `Retry-After: 30` → `retryAfterMs: 30000`
- HTTP-date — `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` → `retryAfterMs: <ms-from-now>`

If the error response body includes an explicit `retryAfterMs`, that value takes precedence over the header.

---
````

> The trailing `---` separates HTTP from `## Errors` below.

- [ ] **Step 3: Verify**

Run: `grep -n "^## " packages/sdk/README.md`
Expected: `## Resource caching` and `## HTTP` appear between `## Lifecycle events` and `## Errors`.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): document resource caching and HTTP layer

Two new sections: Resource caching (promise-cache semantics, dedupe,
eviction on rejection, refresh) and HTTP (endpoints, headers, base
URL derivation, status → error code mapping, Retry-After parsing).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Expand Errors and Safety sections

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Replace the `## Errors` block**

Locate `## Errors` and everything down to (but not including) `## Safety`. Replace with:

````markdown
## Errors

The programmatic API (`gh.data.funnel`, `gh.data.destination`, `gh.data.product`) rejects with a `GhError`:

```ts
class GhError extends Error {
  readonly code: GhErrorCode;
  readonly retryAfterMs: number | null;
  readonly cause: unknown;
}

type GhErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'bad_request'
  | 'network'
  | 'bad_config'
  | 'server';
```

### Error code reference

| Code | Meaning | Common cause |
|------|---------|--------------|
| `not_found` | 404 from the API | Slug doesn't exist for your brand, or you're not authorized to see it. The two are deliberately indistinguishable — partners cannot enumerate resources they don't own. |
| `rate_limited` | 429 from the API | Too many requests. Honour `retryAfterMs` before retrying. |
| `forbidden` | 401 or 403 from the API | Missing / invalid `data-key`, or the key/brand combination doesn't authorize this resource. |
| `bad_request` | Other 4xx from the API | Malformed slug, unknown resource type, or a programmatic call with an empty argument. |
| `network` | Fetch rejected before getting a response | DNS, CORS, offline. Check the `cause` for the underlying `TypeError`. |
| `bad_config` | Thrown during boot | Bad `data-key` format, missing `data-brand`, script loaded from a disallowed host. Surfaces in the console, not as a rejected promise. |
| `server` | 5xx from the API, or a response that wasn't valid JSON | Retry with backoff. |

`retryAfterMs` is populated for `rate_limited` errors and any other response that carried a `Retry-After` header — see [HTTP](#http).

### Declarative degradation

Declarative bindings degrade gracefully — a failed fetch logs a warning to the console and leaves placeholder text in place. The page does not break because one slug is wrong. To show an explicit error message, use `data-when="failed"` (see [Resource lifecycle](#resource-lifecycle-data-when)).

---

````

> The trailing `---` separates Errors from `## Safety` below.

- [ ] **Step 2: Replace the `## Safety` block**

Locate `## Safety` and everything down to (but not including) `## Size budget`. Replace with:

````markdown
## Safety

The SDK is read-only by design. It sends no analytics, no PII, and never executes data as code.

### textContent only

All field values are rendered via `textContent`, never `innerHTML`. Partner data can never inject markup, scripts, or styles. This is the single most important guarantee in the SDK.

### Refused attributes

The following `data-attr-<NAME>` targets are silently refused:

- `data-attr-on*` — every event-handler attribute (`onclick`, `onerror`, `onmouseover`, etc.). Event handlers are never wired from data.
- `data-attr-srcdoc` — `<iframe srcdoc>` is a raw HTML island; binding it would defeat the textContent-only rule.

### URL attribute allowlist and scheme normalization

A defined set of attributes are recognized as URL-bearing. Before the SDK writes one, the resolved value is checked for unsafe schemes:

`href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`, `manifest`

Values whose scheme prefix is `javascript:`, `vbscript:`, or `data:` are silently refused — the attribute is left unset. The scheme check normalizes the value first by stripping leading whitespace and ASCII control characters, then removing any tab / linefeed / carriage return characters before checking the prefix. This mirrors how browsers themselves resolve URLs, so `java\tscript:foo` (which a browser would treat as `javascript:`) cannot sneak past.

### Cross-brand 404

A request for a resource that belongs to a different brand returns 404 from the API, indistinguishable from a non-existent resource. There is no enumeration vector.

---

````

> The trailing `---` separates Safety from `## Size budget` below.

- [ ] **Step 3: Verify**

Run: `grep -c "^### " packages/sdk/README.md`
Expected: increased by 3 — `### Error code reference`, `### Declarative degradation` under Errors; and `### textContent only`, `### Refused attributes`, `### URL attribute allowlist and scheme normalization`, `### Cross-brand 404` under Safety. (Net: +6 new subsections.)

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): expand Errors and Safety sections

Adds an error-code reference table that maps each code to its HTTP
cause and a Declarative degradation subsection. Safety now lists every
refused attribute (on*, srcdoc), the full URL-attribute allowlist,
and the whitespace/control-char scheme normalization rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add "Advanced — TypeScript / NPM consumers" section

**Files:**
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Re-read current README**

Run: `grep -n "^## " packages/sdk/README.md`
Confirm `## Safety` is followed directly by `## Size budget`.

- [ ] **Step 2: Insert the Advanced section between Safety and Size budget**

Locate the first line of `## Size budget`. Insert the following block immediately BEFORE it:

````markdown
## Advanced — TypeScript / NPM consumers

Most partners need only the declarative attributes ([§ Declarative attributes](#declarative-attributes)) and the `window.gh` surface ([§ Programmatic API](#programmatic-api)). The exports listed below are the package's full public API for advanced consumers — building a custom auto-boot, bypassing the script-tag detection, instantiating the runtime in a framework, or reusing utilities like `getByPath` in isolation. They're **stable but not the recommended path**.

If you're not sure whether you need these, you don't.

Import from the package root:

```ts
import {
  applyBindings,
  builtinFormatters,
  collectResources,
  enrichProduct,
  FormatRegistry,
  GhDataClient,
  GhError,
  GhRuntime,
  getByPath,
  parseScriptConfig,
} from '@goldenhippo/hippo-shop-sdk';

import type { GhConfig, GhErrorCode, ResourceState } from '@goldenhippo/hippo-shop-sdk';
```

### Barrel exports

| Export | Kind | Purpose |
|--------|------|---------|
| `applyBindings(root, opts)` | function | Apply bindings to a subtree against an explicit `{ formatters, resources, resourceStates? }` bag. The low-level core that `gh.bind` wraps. |
| `collectResources(root)` | function | Return every `(kind, slug)` referenced under a node. Useful for prefetching server-side or warming a cache. |
| `getByPath(obj, path)` | function | Resolve a dot-path against any object. Returns `undefined` on miss; never throws. Reusable outside the SDK. |
| `enrichProduct(raw)` | function | Mutate a raw product DTO in place, attaching `<tier>List` and `<tier>ByQuantity` sibling fields. Use after a manual `fetch()` to a product endpoint if you want the same shape `gh.data.product` returns. |
| `parseScriptConfig(scriptEl)` | function | Validate a `<script>` element's `data-*` config and produce a `GhConfig`. Throws on invalid input. |
| `builtinFormatters` | `Record<string, Formatter>` | The raw built-in formatter map. Useful for constructing a custom `FormatRegistry`. |
| `FormatRegistry` | class | The class behind `window.gh.format`. Instantiate one if you need an isolated registry that doesn't share state with the global. |
| `GhDataClient` | class | The HTTP client (`funnel` / `destination` / `product` methods). Construct with a `GhConfig` + `Logger` to talk to the API without the binding layer. |
| `GhRuntime` | class | The high-level orchestrator: ties a `GhDataClient` to the binding pass and manages the resource + lifecycle caches. |
| `GhError` | class | The error class thrown by all data methods. |
| `GhConfig` | type | The parsed config produced by `parseScriptConfig`. |
| `GhErrorCode` | type | Union of `'not_found' \| 'rate_limited' \| 'forbidden' \| 'bad_request' \| 'network' \| 'bad_config' \| 'server'`. |
| `ResourceState` | type | Union of `'loading' \| 'loaded' \| 'failed'` — the values passed in `ApplyBindingsOptions.resourceStates`. |

### DTO types

The data types these methods accept and return (`HippoShopFunnelDTO`, `HippoShopDestinationDTO`, `HippoShopProductDTO`, `HippoShopErrorDTO`) live in a separate package, [`@goldenhippo/hippo-shop-types`](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types). Install it alongside the SDK for type-only imports:

```bash
pnpm add -D @goldenhippo/hippo-shop-types
```

---

````

> The trailing `---` separates Advanced from `## Size budget` below.

- [ ] **Step 3: Verify**

Run: `grep -n "^## Advanced" packages/sdk/README.md`
Expected: one match, between `## Safety` and `## Size budget`.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): add Advanced — TypeScript / NPM consumers section

Documents the full set of barrel exports (applyBindings, getByPath,
GhRuntime, GhDataClient, enrichProduct, etc.) for advanced consumers
who want to bypass the auto-boot. Frames these as supported but not
the recommended path — declarative + window.gh remains the primary
surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification

**Files:**
- (potentially) Modify: `packages/sdk/README.md` — only if verification turns up issues

- [ ] **Step 1: Verify all top-level headings exist in the expected order**

Run: `grep -n "^## " packages/sdk/README.md`

Expected output (in this exact order):

```
## Contents
## Installation
## Quickstart — declarative
## How it works
## Script tag config
## Declarative attributes
## Formatters
## Loops
## Declarative scope (`data-with`)
## Resource lifecycle (`data-when`)
## Recipes
## Evaluation order
## Programmatic API
## Lifecycle events
## Resource caching
## HTTP
## Errors
## Safety
## Advanced — TypeScript / NPM consumers
## Size budget
## Provenance
## License
```

If any are missing or out of order, return to the relevant task and fix before continuing.

- [ ] **Step 2: Verify the TOC anchors all resolve**

Run:

```bash
python3 - <<'PY'
import re, pathlib, sys
text = pathlib.Path('packages/sdk/README.md').read_text()
# Pull TOC link targets
toc_block = re.search(r'## Contents\n(.+?)\n---', text, re.DOTALL)
if not toc_block:
    print('FAIL: could not locate Contents block'); sys.exit(1)
toc_anchors = re.findall(r'\]\(#([^)]+)\)', toc_block.group(1))
# Pull every ## heading and derive its GitHub anchor
heads = re.findall(r'^## (.+)$', text, re.MULTILINE)
def slug(h):
    s = h.lower()
    s = re.sub(r'[`\\.]', '', s)
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'\s+', '-', s.strip())
    return s
have = {slug(h) for h in heads}
missing = [a for a in toc_anchors if a not in have]
if missing:
    print('FAIL: anchors with no matching heading:', missing); sys.exit(1)
print('OK:', len(toc_anchors), 'TOC anchors all resolve.')
PY
```

Expected: `OK: N TOC anchors all resolve.` where N is 20 (every section after Contents).

If any anchors are missing or misspelled, fix the TOC OR fix the offending heading. Re-run the check.

- [ ] **Step 3: Sample-data scrub — no real-brand references**

Run:

```bash
grep -nEi "gundry|bio.complete|brand-?x|acme|example\.com" packages/sdk/README.md
```

Expected: **no output** (zero matches).

If any matches, replace with the generic equivalents (`multi-vitamin`, `Sample Co`, etc.) and commit the fix.

- [ ] **Step 4: Placeholder scrub — no leftover authoring tokens**

Run:

```bash
grep -nE "TBD|TODO|XXX|FIXME|placeholder|fill in|coming soon" packages/sdk/README.md
```

Expected: **no output**.

If any matches, address them. (Note: the word "placeholder" appearing in technical descriptions like "leaves the placeholder in place" is fine — grep will surface it but it's not a real authoring placeholder. Read the context before fixing.)

- [ ] **Step 5: Code-block sanity check**

Run:

```bash
grep -c "^\`\`\`" packages/sdk/README.md
```

Expected: an **even** number (every code block has an opening and closing fence). If odd, locate the unclosed fence and fix it.

- [ ] **Step 6: Line count check**

Run: `wc -l packages/sdk/README.md`

Expected: approximately **700** lines. Anything in the range **620–780** is acceptable. If far outside that range, investigate (something was cut or duplicated).

- [ ] **Step 7: Verify required features per spec**

Spot-check the following 14 items are present in the README. If any is missing, locate which task should have introduced it and fix.

- [ ] TOC with anchored links to every level-2 section
- [ ] How it works section explaining boot, two-pass binding, MutationObserver
- [ ] `data-debug="true"` documented with key pattern
- [ ] Host allowlist including `*.local` and local-dev `src$="/gh.js"` fallback
- [ ] `data-attr-format-<NAME>` documented (including empty-value short-circuit)
- [ ] `data-gh-hidden`, `data-gh-prior-display`, `data-gh-loop-clone` documented as stable CSS hooks
- [ ] `percent` semantic ("input is a fraction") explicitly called out
- [ ] Formatter failure modes documented (unknown name, unconvertible, null/undefined)
- [ ] `FormatRegistry` typed methods (`currency`, `number`, `percent`, `has`, `apply`) documented
- [ ] Resource caching section with eviction-on-rejection
- [ ] HTTP section with endpoints, headers, base URL, status mapping, Retry-After parsing
- [ ] URL-attribute allowlist with full attribute list and scheme-check rule
- [ ] `srcdoc` refusal explicitly documented alongside `on*`
- [ ] Advanced — TypeScript / NPM consumers section with barrel-export table

- [ ] **Step 8: Final commit (only if fixes were needed)**

If steps 2–7 surfaced issues and you made fixes:

```bash
git add packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(sdk): final-pass cleanup on the expanded README

Touchups from the verification pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no fixes were needed, skip this step.

---

## Spec coverage cross-reference

| Spec requirement | Task |
|------------------|------|
| TOC anchored, no level-3 entries | 1 (added), 8 (verified) |
| How it works — boot lifecycle, two-pass binding, MutationObserver | 1 |
| Script tag config — key pattern, full host allowlist, local-dev fallback, refusal to re-attach | 2 |
| Declarative reference — `data-attr-format-<NAME>`, paths, undefined-on-miss, never-throws | 2 |
| Markup the SDK writes back (CSS hooks) | 2 |
| Formatters — `percent` semantics, failure modes, typed methods | 3 |
| Programmatic API — `window.gh.debug`, refresh semantics, enriched product | 4 |
| Lifecycle events — defensive pattern, inline-script timing | 4 |
| Resource caching — promise cache, dedupe, eviction, refresh | 5 |
| HTTP — endpoints, headers, base URL derivation, status mapping, Retry-After | 5 |
| Errors — code reference, declarative degradation | 6 |
| Safety — `srcdoc` refusal, URL allowlist, scheme normalization, cross-brand 404 | 6 |
| Advanced — TypeScript / NPM consumers | 7 |
| Generic sample data throughout | 8 (grep) |
| No engineering / release references | 8 (grep + spot-check) |
| ~700 line target | 8 |

All 15 spec requirements are covered by one of the eight tasks.
