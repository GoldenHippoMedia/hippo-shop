# SDK README Full-Reference Expansion — Design

**Date:** 2026-05-16
**Scope:** `packages/sdk/README.md` only. No source changes, no demo changes, no other READMEs, no release.

---

## Goal

Expand `packages/sdk/README.md` from "quickstart + recipes + condensed reference" (currently 387 lines) into a **complete partner-facing reference** that documents every public feature of the SDK. After this pass, a partner reading only this file should be able to answer "does X exist?" for every public capability without having to read source.

## Why

An audit of the source against the current README found a substantial number of features that exist in code but are either undocumented, mentioned only in demos, or implied rather than spelled out. The current README is optimized for first-impression and recipe-style learning; partners building real integrations need a complete reference.

We're documenting now (before broad sharing) so the first impression partners get is a polished, complete document.

## Out of scope

- Source code changes — pure documentation
- Demo HTML changes — already approved in prior pass
- `packages/types/README.md` or root `README.md` — already partner-polished
- Changesets / version bump — docs-only change
- Wiki content — separate future effort
- New recipes — the four existing ones stay as-is

## Audience & voice

External partners (CRO, marketing, agency developers), not Golden Hippo engineers. Reference style:
- Tables and short descriptions over prose
- Every documented feature has at least one minimal HTML or JS example
- Generic sample data only: brand `Sample Co`, product slug `multi-vitamin`, funnel slug `multi-vitamin-funnel`, destination slug `multi-vitamin-3pack-sub`, publishable key `gh_pk_yourbrand_xxxxxx`
- No engineering plan, backend internals, or release-process references
- No new emoji

## What features to document

The pass adds or expands documentation for the following currently-under-documented capabilities. Each item below is a feature that exists in source but is either missing, mentioned in passing, or shown only in a demo.

### Declarative attributes
- **`data-attr-format-<NAME>`** — per-attribute formatter override. Empty value short-circuits an inherited `data-format`. Currently only appears in a demo.
- **`data-debug="true"`** on the script tag — key pattern `/^gh_pk_[a-z0-9_-]+_<hex>$/` belongs in the script-tag section.
- **Path resolver behavior** — dot syntax, numeric indices for arrays, empty path returns the bound object itself, missing segment returns `undefined`, never throws.

### Security surface
- **`srcdoc` refused** alongside `on*`.
- **URL-attribute allowlist** with scheme normalization: `href`, `xlink:href`, `src`, `action`, `formaction`, `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`, `manifest` — `javascript:` / `vbscript:` / `data:` schemes refused after whitespace and control-char normalization.

### HTTP layer
- **Endpoints**: `/public/v1/funnel/<slug>`, `/public/v1/destination/<slug>`, `/public/v1/product/<slug>`.
- **Headers sent**: `X-GH-Key`, `X-GH-Brand`, `Accept: application/json`.
- **Local-dev script src fallback** (`src$="/gh.js"`) for the boot detector.
- **Status → error-code mapping**:
  - 401/403 → `forbidden`
  - 404 → `not_found`
  - 429 → `rate_limited`
  - 4xx → `bad_request`
  - 5xx → `server`
- **`Retry-After` parsing** — seconds or HTTP-date.

### Runtime behavior
- **Two-pass binding** — pre-fetch pass with all resources marked `loading`, then post-fetch pass.
- **In-memory promise cache** — dedupes concurrent calls, evicts on rejection, no localStorage.
- **MutationObserver** — attribute filter list (all binding attrs), microtask debounce, loop-clones ignored.
- **Boot quirk** — `setTimeout(0)` between SDK setup and first bind lets inline scripts register formatters before the bind pass.
- **Refusal to re-attach** if `window.gh.data` already exists.

### Markup the SDK writes back (CSS hooks — exposed as **stable**)
- **`data-gh-hidden`** attribute on elements the SDK hid.
- **`data-gh-prior-display`** dataset key preserving a prior `style.display` value.
- **`data-gh-loop-clone`** attribute on elements expanded from a `<template data-each>`.

### Formatters
- **Failure modes** — never throw; unknown name or unconvertible value falls back to `String(value)` (or `''` for null/undefined).
- **`percent` semantics** — input is a fraction (0.25 → "25%").
- **`FormatRegistry` API** — `register(name, fn)`, `has(name)`, `apply(value, spec)`, typed methods `currency()`, `number()`, `percent()`.

### Programmatic
- **`window.gh.debug`** boolean (set when `data-debug="true"`).
- **Advanced barrel exports** — `applyBindings`, `collectResources`, `ResourceState`, `getByPath`, `GhRuntime`, `GhDataClient`, `parseScriptConfig`, `builtinFormatters`, `FormatRegistry`, `GhConfig`. Documented as supported but **advanced** — partners should use the declarative + `window.gh` surfaces unless they have a specific need.

### Product enrichment
- **`enrichProduct(raw)`** — public client-side function that attaches `<tier>List` / `<tier>ByQuantity` siblings.
- **Duplicate-quantity rule** — record is last-wins, list keeps original order.
- **Tolerance** — missing variants/branches pass through unchanged.

---

## Final structure (Table of Contents)

```
1.  Hero + badges + cross-links
2.  Table of contents (anchored)
3.  Installation
4.  Quickstart — declarative
5.  How it works
    5.1  Boot lifecycle
    5.2  Two-pass binding
    5.3  Re-binding (MutationObserver)
6.  Script tag config
    6.1  Required & optional attributes
    6.2  Host allowlist
7.  Declarative attributes
    7.1  Attribute reference table
    7.2  Paths
    7.3  data-attr-<NAME> details
    7.4  data-attr-format-<NAME> per-attribute formatter
    7.5  Markup the SDK writes back
8.  Formatters
    8.1  Built-in reference table
    8.2  percent semantics
    8.3  Failure modes
    8.4  Registering custom formatters
    8.5  FormatRegistry typed methods
9.  Loops
10. Declarative scope (data-with)
11. Resource lifecycle (data-when)
12. Recipes (unchanged: Quantity ladder, Tier picker, Loading skeleton, Custom formatter)
13. Evaluation order
14. Programmatic API
    14.1 window.gh surface
    14.2 Manually binding subtrees
    14.3 Refreshing cached data
15. Lifecycle events
    15.1 gh:data-ready / gh:bindings-ready
    15.2 Defensive "already booted?" pattern
    15.3 Inline-script timing note
16. Resource caching
17. HTTP
    17.1 Endpoints
    17.2 Headers sent
    17.3 Base URL derivation
    17.4 Status → error code mapping
    17.5 Retry-After parsing
18. Errors
    18.1 GhError shape
    18.2 Error code reference
    18.3 Declarative degradation
19. Safety
    19.1 textContent only
    19.2 Refused attributes (on*, srcdoc)
    19.3 URL attribute allowlist & scheme normalization
    19.4 Cross-brand 404
20. Advanced — TypeScript / NPM consumers
    20.1 When to reach for these
    20.2 Barrel exports table
    20.3 Pointer to @goldenhippo/hippo-shop-types
21. Size budget
22. Provenance
23. License
```

## Section-by-section notes

### Section 2 — Table of contents
Anchored markdown links, flat list of section 3+ headings (level-2 only; level-3 not included). GitHub renders these as clickable anchors.

### Section 4 — Quickstart
Stays as a single example with the existing `multi-vitamin` markup. **No expansion** — first impression matters; complete reference begins at §5.

### Section 5 — How it works
New section. Sets the mental model before partners hit the reference tables. Three subsections:

- **5.1 Boot lifecycle** — script tag → parse config → attach `window.gh` → dispatch `gh:data-ready` → on DOMContentLoaded (or `setTimeout 0` if already past it) → scan → fetch → render → dispatch `gh:bindings-ready` → install MutationObserver.
- **5.2 Two-pass binding** — explains why a skeleton (`data-when="loading"`) appears immediately even though data hasn't arrived yet.
- **5.3 Re-binding** — what the MutationObserver watches for, why loop clones don't trigger feedback loops, when partners should call `gh.bind(el)` themselves (modals / SPA route changes).

### Section 6 — Script tag config
Tables only. Required (`data-key`, `data-brand`), optional (`data-debug`), key pattern, host allowlist including the `*.local` and `localhost`/`127.0.0.1`/`[::1]` entries and the local-dev `src$="/gh.js"` fallback.

### Section 7 — Declarative attributes
Existing attribute reference table, expanded to include `data-attr-format-<NAME>`. New subsections:

- **7.3 data-attr-<NAME> details** — names with hyphens (e.g. `data-attr-aria-label`), URL attributes are scheme-checked (forward-reference to §19.3 for the list), `data-attr-on*` and `data-attr-srcdoc` refused.
- **7.4 data-attr-format-<NAME>** — example of overriding inherited `data-format`, empty-value short-circuit.
- **7.5 Markup the SDK writes back** — declared as stable CSS hooks. Table:
  - `data-gh-hidden` — present on any element the SDK has hidden; target with `[data-gh-hidden]` in CSS to add transitions, etc.
  - `data-gh-prior-display` — dataset key (`element.dataset.ghPriorDisplay`) holding the pre-hide `style.display` so unhide restores it.
  - `data-gh-loop-clone` — present on every top-level element produced by `<template data-each>`. Lets CSS target loop items without changing markup.

### Section 8 — Formatters
Existing built-in table stays. Add:

- **8.2 percent semantics** — single paragraph + example clarifying input is a fraction. Includes a "common mistake" callout for partners coming from frameworks where percent formatters expect 0–100.
- **8.3 Failure modes** — paragraph stating formatters never throw; lists the three fall-back rules (unknown name → `String(value)`, unconvertible value → `String(value)`, null/undefined → `''`).
- **8.5 FormatRegistry typed methods** — minimal JS example:
  ```js
  window.gh.format.currency(49.95);            // "$49.95"
  window.gh.format.number(1234.5, 2, 'en-US'); // "1,234.50"
  window.gh.format.percent(0.123, 1);          // "12.3%"
  window.gh.format.has('shouty');              // false
  ```

### Section 14 — Programmatic API
Existing content expanded. Specifically calls out:
- `window.gh.data.product(slug)` returns the **enriched** product (with `<tier>List` / `<tier>ByQuantity`).
- `window.gh.refresh()` clears both the resource cache and the lifecycle-state map.
- `window.gh.bind(el)` is the right hook for "I just opened a modal".
- `window.gh.debug` is present (and truthy) when `data-debug="true"`.

### Section 15 — Lifecycle events
Existing content + new subsection 15.3:

> The SDK schedules its first bind via `setTimeout(0)` (not `queueMicrotask`) so inline `<script>` tags placed after the SDK script — for example, a script that registers a custom formatter — finish executing before the first bind pass. If you register formatters inline after the SDK script, you don't need to call `gh.refresh()`.

### Section 16 — Resource caching
New section. Covers:
- In-memory `Map<string, Promise<unknown>>` — keyed `kind:slug`, page lifetime only, no localStorage / cross-tab.
- Successful fetches stay cached until `gh.refresh()`.
- **Rejected** promises are evicted automatically so the next call re-fetches rather than returning a stale failure.
- Concurrent calls to the same `kind:slug` are deduped — only one network request.

### Section 17 — HTTP
New section. Five subsections:
- **17.1 Endpoints** — three rows: funnel, destination, product, with method (`GET`) and URL pattern.
- **17.2 Headers sent** — three rows: `X-GH-Key`, `X-GH-Brand`, `Accept: application/json`. Note that no cookies are sent (no `credentials` option).
- **17.3 Base URL derivation** — derived from the script tag's `src` host; lists prod / UAT / local hosts.
- **17.4 Status → error code mapping** — table.
- **17.5 Retry-After parsing** — accepts seconds (e.g. `Retry-After: 30`) or HTTP-date, converted to `retryAfterMs`. Body-level `retryAfterMs` from the error DTO takes precedence over the header.

### Section 19 — Safety
Expands current Safety section with:
- **19.2** — list both refused targets: `on*` (event handlers) and `srcdoc` (raw HTML island).
- **19.3** — full URL-attribute list. Brief note on the normalization: leading whitespace and control characters are stripped before the `javascript:` / `vbscript:` / `data:` scheme check, matching browser URL resolution.

### Section 20 — Advanced — TypeScript / NPM consumers
**Brief subsection** (per design decision). Three paragraphs:

- Most partners need only the declarative attributes (§7) and the `window.gh` surface (§14). The barrel exports below are public so advanced consumers can bypass the auto-boot, instantiate the runtime in their own framework, or use a single utility like `getByPath` in isolation. They're **stable but not the recommended path**.
- One table listing all barrel exports with a one-line purpose for each:
  - `applyBindings` — apply bindings to a subtree against an explicit data map
  - `collectResources` — collect every `data-gh-*` reference under a node
  - `ResourceState` — type alias `'loading' | 'loaded' | 'failed'`
  - `getByPath` — resolve a dot-path against any object (never throws)
  - `GhRuntime` — class wiring the data client to the binding pass
  - `GhDataClient` — class wrapping the HTTP layer; can be used standalone
  - `parseScriptConfig` — script-tag → `GhConfig` parser
  - `builtinFormatters` — raw `Record<string, Formatter>` (no class wrapper)
  - `FormatRegistry` — class behind `window.gh.format`
  - `enrichProduct` — attaches `<tier>List` / `<tier>ByQuantity` to a raw product DTO
  - `GhConfig`, `GhError`, `GhErrorCode` — exported types
- Pointer to `@goldenhippo/hippo-shop-types` for the DTOs that flow through every method.

---

## Conventions

- **Generic sample data**: always `multi-vitamin`, `Sample Co`, `gh_pk_yourbrand_xxxxxx`.
- **All HTML / JS examples must be syntactically valid** — no `…` placeholders inside code blocks.
- **No internal links beyond GitHub anchors**.
- **No new dependencies** — plain markdown, no Mermaid, no images.
- **Heading levels**: `#` for the package name, `##` for top-level sections, `###` for subsections. No deeper than `####`.
- **Tables**: standard GitHub-flavored markdown, no HTML.

## Acceptance criteria

The expanded README is acceptable when:

1. Every feature listed in the "What features to document" section above is present in the README with at least one usage example or table entry.
2. No engineering-plan, backend-internals, or release-process references appear.
3. Sample data is generic throughout — no `Bio Complete 3` / Gundry MD / real-brand references.
4. The TOC at the top of the document anchors correctly to every level-2 section.
5. All code blocks parse as their declared language (HTML / JS / TypeScript) — no syntax errors.
6. Final length is approximately 700 lines (current 387 + roughly 360 of new reference material).

## Estimated final length

~700 lines. Existing content (hero, install, quickstart, recipes, evaluation order, lifecycle events block, errors block, safety block, size budget, provenance, license) is ~340 lines and stays largely untouched. New sections (§5, §6 expansion, §7.3–7.5, §8.2–8.3, §8.5, §14 expansion, §15.3, §16, §17, §19.2–19.3, §20) add ~360 lines of new reference material.

## Non-goals

- **No restructuring of the existing Recipes section** — already approved partner-facing content.
- **No edits to source code, tests, demos, or changesets.**
- **No new release** — this is a pure docs change. The next published version will pick it up automatically.
- **No companion files** — single README, no `REFERENCE.md` split.
