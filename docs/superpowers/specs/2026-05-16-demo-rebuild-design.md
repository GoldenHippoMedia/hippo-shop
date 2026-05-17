# Demo Rebuild — Design

**Date:** 2026-05-16
**Scope:** `apps/examples-static/` — rebuild the static demo set to reflect real-world Golden Hippo / MCT Wellness use cases. No SDK source changes, no test changes, no release.

---

## Goal

Replace the current 5 generic demos with **3 real-world archetype demos + a landing page** that show partners how the SDK gets used in production funnel sales. Use real Gundry MD / MCT Wellness data (product, funnel, destinations) so the patterns match what partners will build.

## Why

The current demos technically exercise the SDK but don't reflect how partners will actually use it. Specifically:

- **Funnel demo** renders a step list (admin-ish) rather than acting like a real funnel step page that needs to build a "next" link.
- **Variant grid + product pricing** are two overlapping PDP-shaped demos. Real PDPs show **one** price tier (standard OR myAccount) — not both at once — and don't route to a destination.
- **Destination detail** shows 6 destinations but the realistic offer-selector pattern is more like 12 (6 SKUs × 2 flavors) with flavor/purchase-type filtering on top.
- Several demos still use the soon-to-be-deprecated `variants.<purchase>.<tier>` array path. The rebuild standardizes on `<tier>List` for iteration and `<tier>ByQuantity` for direct lookup.

## Audience

Partner developers integrating the SDK on Gundry MD / MCT Wellness funnel pages, PDPs, and offer selectors. Authentic data + realistic layouts let them paste-and-modify rather than re-think the patterns.

## Out of scope

- SDK source code changes
- Test changes
- Changeset / release
- Published READMEs (the partner-facing readme was already polished in a prior pass)
- New SDK features (every binding pattern needed is already supported)

---

## File layout

### Final file set

| File | Status | Replaces |
|------|--------|----------|
| `apps/examples-static/index.html` | redesigned | existing `index.html` |
| `apps/examples-static/funnel-step.html` | new (renamed) | `funnel-steps.html` |
| `apps/examples-static/offer-selector.html` | new (renamed) | `destination-detail.html` |
| `apps/examples-static/pdp.html` | new (renamed) | `product-pricing.html` + folds in `variant-grid.html` |
| `apps/examples-static/_shared.css` | new | extracted palette / typography / base card styles |

### Files to delete

- `apps/examples-static/funnel-steps.html` (renamed → `funnel-step.html`)
- `apps/examples-static/destination-detail.html` (renamed → `offer-selector.html`)
- `apps/examples-static/product-pricing.html` (renamed → `pdp.html`)
- `apps/examples-static/variant-grid.html` (merged into `pdp.html`)

### `_shared.css`

Holds the Gundry MD palette + typography variables + the base card / pill / button styles that recur across demos. Each demo file `<link>`s it. Keeps per-demo HTML focused on layout rather than restating the design system. Single static file, no build step.

The shared file contains:
- Color variables (Gundry blue 50–900, Vitality lime 50–700, neutrals, green-600 for success)
- Font imports (Lora + Red Hat Text) and `--font-serif` / `--font-sans` variables
- Shadow variables (`--shadow-xs`, `--shadow-sm`, `--shadow-md`)
- `body`, `h1`/`h2`/`h3` base styles
- `.page` container, `.eyebrow`, `.section-eyebrow` typography
- Base `.card` and `.mock-button` styles (since multiple demos render cards / CTAs)

Per-demo CSS lives in a `<style>` block inside each demo file for layout-specific rules.

---

## Shared data references

All demos use the same script tag config and the same brand/product line:

- **Brand:** Gundry MD (palette + voice)
- **Product line:** MCT Wellness
- **API host:** `api-uat.goldenhippo.io`
- **Publishable key:** the existing `gh_pk_test_all_…` UAT test key (reused verbatim from the current demos)

### Slugs

| Resource | Slug | Used by |
|---|---|---|
| Product | `mct-wellness` | `pdp.html` |
| Funnel | `demo_mct_cms_survey_260427` | `funnel-step.html` |
| Destination 1 (sub, 1 unit, SL) | `d_mctwellness_1unitsub_mf_240210` | `offer-selector.html` |
| Destination 2 (sub, 3 unit, SL) | `d_mctwellness_3unitsub_mf_240210` | `offer-selector.html` |
| Destination 3 (sub, 6 unit, SL) | `d_mctwellness_6unitsub_mf_240210` | `offer-selector.html` |
| Destination 4 (OT, 1 unit, SL) | `d_mctwellness_1unit_mf_221006` | `offer-selector.html` |
| Destination 5 (OT, 3 unit, SL) | `d_mctwellness_3unit_mf_240210` | `offer-selector.html` |
| Destination 6 (OT, 6 unit, SL) | `d_mctwellness_6unit_mf_240210` | `offer-selector.html` |
| Destination 7 (OT, 1 unit, RM) | `d_mctwellnessraspberry_1unit_mf_11164` | `offer-selector.html` |
| Destination 8 (sub, 1 unit, RM) | `d_mctwellnessraspberry_1unitsub_mf_240210` | `offer-selector.html` |
| Destination 9 (sub, 3 unit, RM) | `d_mctwellnessraspberry_3unitsub_mf_240210` | `offer-selector.html` |
| Destination 10 (OT, 3 unit, RM) | `d_mctwellnessraspberry_3unit_mf_240210` | `offer-selector.html` |
| Destination 11 (OT, 6 unit, RM) | `d_mctwellnessraspberry_6unit_mf_240210` | `offer-selector.html` |
| Destination 12 (sub, 6 unit, RM) | `d_mctwellnessraspberry_6unitsub_mf_240210` | `offer-selector.html` |

SL = Strawberry Lemonade, RM = Raspberry Medley. (The `_mf_` infix is a Salesforce slug uniqueness artifact, not a flavor code.)

---

## Demo 1: `funnel-step.html`

**Real-world pattern:** A single page in a multi-step funnel — quiz, content, order-form, etc. The page acts as one step and uses the full funnel data to render a progress indicator and a "Continue to next step" CTA.

### Layout

```
┌─────────────────────────────────────────────┐
│  [progress bar — 5 segments]                │  ← built from funnel.steps[] via data-each
│  ▓▓▓▓ ▓▓▓▓ ▓▓▓▓ ▓▓▓▓ ░░░░ ░░░░             │
│                                              │
│  STEP 3 OF 5 · CONTENT                       │  ← step number + step kind eyebrow
│  "Quick wellness check-in"                   │  ← step name (from funnel.steps[2].name)
│                                              │
│  [partner-controlled step body — quiz/form] │  ← placeholder text, not bound
│                                              │
│  [   Continue to step 4 →   ]                │  ← href built from steps[currentIdx+1].slug
└─────────────────────────────────────────────┘
```

### Implementation notes

- Single resource fetch: `data-gh-funnel="demo_mct_cms_survey_260427"`.
- Progress bar is a `<template data-each="steps">` over `funnel.steps[]`. Each clone carries `data-attr-data-stage="kind"` (so CSS can color-code by step kind: `landing`, `content`, `order-form`, `bump`, `upsell`, `downsell`, `thank-you`) and `data-attr-data-step-number="stepNumber"`.
- A small inline `<script>` after the SDK tag tracks a hardcoded `currentIndex = 2` (= step 3) for the demo. On `gh:bindings-ready`:
  1. Read `funnel.steps[currentIndex + 1]` from the resolved resource (via `window.gh.data.funnel(slug)` — which returns the cached promise, so no extra fetch).
  2. If a next step exists: set the CTA's `href` to `#step-<slug>` and label "Continue to step N →".
  3. If `currentIndex` is the last step: change label to "Complete →" and href to `#complete`.
- The hardcoded `currentIndex` is documented in a comment so partners know to swap for their own routing.
- The current-step name + step-kind labels use `data-field="steps.2.name"` / `data-field="steps.2.kind"` with the `2` matching `currentIndex`. (A comment notes that real code would pass the index from the URL or session.)

### SDK features exercised

- `data-gh-funnel` (resource context)
- `data-field` (funnel name, current step name, current step kind)
- `<template data-each="steps">` (progress bar segments)
- `data-attr-data-stage` + per-attribute formatter (`data-attr-format-data-stage="lowercase"`) for CSS coloring
- `data-attr-data-step-number` on each segment
- `data-if` to hide a "Visit landing first" warning when current step ≠ landing
- `gh:bindings-ready` event listener to wire up the JS-built CTA href
- `gh.data.funnel(slug)` cached call from inline JS

### Accessibility

- Progress bar wrapped in `<nav aria-label="Funnel progress">`
- Active segment carries `aria-current="step"`
- Step name uses `<h1>`, step kind uses an uppercase eyebrow

---

## Demo 2: `offer-selector.html`

**Real-world pattern:** Post-funnel offer-selector page. The customer picks a flavor and purchase type, then the page shows 3 quantity options (1 / 3 / 6 unit). Each visible card maps to a unique destination slug that encodes the SKU's post-purchase upsell flow. Click → routes to the destination's funnel URL.

The full MCT Wellness OS has 24 destinations (2 flavors × 3 quantities × 2 purchase types × 2 free-bottle bump options). This demo shows the 12-destination subset (no free-bottle bump) to keep the demo focused on the routing pattern.

### Layout

```
┌───────────────────────────────────────────────────────┐
│  Pick your flavor                                       │
│  [Strawberry Lemonade ●] [Raspberry Medley ○]          │  ← flavor pills (1 of 2 active)
│                                                         │
│  Pick your plan                                         │
│  [Subscribe & save ●] [One-time ○]                      │  ← purchase-type pills
│                                                         │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │   1 UNIT    │ │   3 UNITS    │ │   6 UNITS    │    │
│  │   $XX.XX    │ │   $XX.XX     │ │ ★ BEST VALUE │    │  ← 3 destination cards
│  │             │ │  Save $XX    │ │   $XX.XX     │    │     of the 12 total
│  │ Continue →  │ │ Continue →   │ │  Save $XX    │    │
│  │             │ │              │ │ Continue →   │    │
│  └─────────────┘ └──────────────┘ └──────────────┘    │
└───────────────────────────────────────────────────────┘
```

### Implementation notes

- All 12 destination cards live in the DOM, marked with `data-flavor="strawberry-lemonade|raspberry-medley"` and `data-purchase="subscription|one-time"`. The SDK fetches all 12 resources (concurrent + deduped by the SDK cache).
- Inline `<script>` after the SDK tag listens for clicks on the flavor / purchase-type pills and toggles `hidden` on cards whose `data-flavor` / `data-purchase` doesn't match the active pair. No re-fetching needed.
- Each visible card uses **`data-gh-destination="<slug>"`** to set its resource context, then:
  - `data-field="pricing.price.amount"` with `data-format="currency:USD"` for the price
  - `data-field="pricing.price.savings"` with `currency:USD` formatter (when the savings field is non-null)
  - `data-field="pricing.sku"` for an analytics/identification label
  - `data-attr-href="funnelSlug"` on the CTA so click goes to the post-purchase funnel
  - `data-attr-aria-label="name"` for accessibility
  - Optional: `data-field="pricing.frequency.label"` for subscription cards' rebill cadence (`null` for one-time so renders blank)
- "BEST VALUE" ribbon shows declaratively via `data-if="pricing.price.savings"` on the 6-unit subscription cards.
- Default selected pills on page load: Strawberry Lemonade + Subscribe & save. The 6-unit card has an `is-featured` class baked in for the visually-highlighted treatment.

### SDK features exercised

- `data-gh-destination` × 12 (multi-resource batched fetch)
- `data-field` on every price / SKU / name binding
- `data-attr-href` (per-card CTA routing)
- `data-attr-aria-label`
- `data-if` on conditional ribbons (`pricing.savings`)
- `currency` formatter (built-in)
- Custom formatter — `savePercent` — registered via `window.gh.format.register` and used on the savings ribbon: `data-format="savePercent:<retailPrice>"`
- Demonstrates concurrent resource fetching dedupe (12 cards = 12 fetches, all rendered after one `gh:bindings-ready`)

### Accessibility

- Pill groups wrapped in `<fieldset>` + `<legend>` so screen-readers announce the choice context
- Each pill uses `role="radio"` + `aria-checked` so keyboard / a11y tooling treats them as a radio group
- The 6-unit "BEST VALUE" ribbon uses `aria-label` so it's announced once per card

---

## Demo 3: `pdp.html`

**Real-world pattern:** Product Detail Page. Shows ONE product, ONE price tier (either standard OR myAccount based on auth state), a quantity ladder, and an Add-to-Cart CTA. **No destination routing** — partner manages cart state in their own JS.

### Layout

```
┌──────────────────────────────────────────────────┐
│ ┌──────────────┐                                  │
│ │   product    │  MCT Wellness                     │
│ │   image      │  Boost ketosis, mental clarity… │
│ │              │  ★ 4.7 (1,234 reviews)            │
│ │              │                                   │
│ │              │  ─────────────────────────────   │
│ │              │  [Standard ●] [My Account ○]    │ ← tier toggle
│ └──────────────┘  ─────────────────────────────   │
│                                                    │
│  Pick your quantity:                               │
│  [ 1 UNIT   ] [ 3 UNITS  ] [ 6 UNITS ★ BEST ]    │ ← quantity ladder
│  [ $XX.XX   ] [ $XX.XX   ] [ $XX.XX           ]   │
│  [ Or pay   ] [ Or pay   ] [ Or pay once $XX  ]   │ ← alternatePurchaseTypePrice
│  [ once $XX ] [ once $XX ] [                  ]   │
│                                                    │
│            [   Add to Cart   ]                     │
└──────────────────────────────────────────────────┘
```

### Implementation notes

- Single resource fetch: `data-gh-product="mct-wellness"`.
- Tier toggle is a segmented control (`Standard | My Account`). Implementation:
  - Wrapper element carries `data-tier="standard"` initially.
  - The three quantity cards each carry **conditional** `data-with` paths driven by the tier. Approach: CSS toggles which of two parallel card sets is visible based on `[data-tier="standard"]` vs `[data-tier="my-account"]` on the wrapper. Each tier has its own three `data-with` cards bound to `variants.subscription.standardByQuantity.<qty>` or `variants.subscription.myAccountByQuantity.<qty>`.
  - This avoids needing `gh.refresh()` and keeps the swap purely CSS-driven. All variants are pre-bound; the toggle just changes visibility.
- The "Or pay once $XX" line under each card uses `data-field="alternatePurchaseTypePrice"` with `data-if="alternatePurchaseTypePrice"` (so it hides when the alternate isn't available, e.g. some quantities don't have a one-time price).
- "★ BEST" ribbon on 6-unit uses `data-if="savings"`.
- Add to Cart CTA carries `data-attr-data-sku="sku"` (currently visible variant's SKU) and `data-attr-aria-label` so the partner's own JS can read the selected SKU. **Bonus**: a small inline `<script>` listens for the Add-to-Cart click and `console.log`s the chosen SKU + price (real partner would push to their cart system).
- Stock pill at top-right of the image: `data-field="outOfStock"` with `data-format="bool:Out of stock:In stock"` plus paired `data-attr-data-stock` with `data-attr-format-data-stock="bool:out:in"` so CSS can color it.

### SDK features exercised

- `data-gh-product` (resource context)
- `data-with` for variant scope narrowing (key for "the most-recommended SDK pattern" demonstration)
- `data-field` on every name / price / review binding
- `data-attr-src`, `data-attr-alt`, `data-attr-aria-label`, `data-attr-data-sku`
- `currency` formatter
- `number` formatter for review counts (`reviews.count`, `reviews.average`)
- `bool` formatter for stock pill, plus per-attribute formatter override (`data-attr-format-data-stock`)
- `data-if` on conditional sections (alternate purchase type, savings ribbon)
- Custom `savePercent` formatter — registered inline before the first bind, used on the 6-unit savings ribbon

### Accessibility

- Tier toggle uses `role="radiogroup"` with `<button role="radio" aria-checked>` items
- Stock pill uses `aria-live="polite"` so it announces if it changes during the page lifetime
- Quantity cards use `<fieldset>` + `<legend>` similarly to the offer selector pills
- Hero image uses `alt` bound via `data-attr-alt="name"`

---

## Demo 4: `index.html` (landing)

### Layout

Same overall shape as the current landing page, but:

- **Hero copy** updated for "Three real-world archetype demos": funnel step, offer selector, PDP.
- **Three demo cards** (not 4) — funnel-step, offer-selector, pdp.
- **Capability matrix** refreshed:
  - 3 columns instead of 4
  - Remove rows for patterns no longer demonstrated (e.g. `gh.refresh()` if no demo exercises it directly — actually the funnel-step demo could include one, see below)
  - Add row for `data-with` (key pattern in pdp.html)
  - Add row for tier-switching pattern (pdp.html)
  - Add row for multi-destination batching (offer-selector.html)
- **Footer** unchanged in spirit (still describes the test key + no-build-step setup).

### SDK features exercised

The landing page itself doesn't bind any data — it's pure documentation. It just `<link>`s `_shared.css` for the design system.

---

## CSS architecture

### `_shared.css` contents

Lifted verbatim from the existing `index.html`'s `<style>` block:

- `@import` of Google Fonts (Lora + Red Hat Text)
- `:root` variables: Gundry blue 50–900, Vitality lime 50–700, neutrals, green-600, shadow variables, font variables
- Reset (`*, *::before, *::after { box-sizing: border-box; }`)
- `body` base typography
- `h1, h2, h3, p, a` baseline styles
- `.page` 820px max-width container
- `.eyebrow`, `.section-eyebrow` typography
- Generic `.card` skeleton (border, radius, shadow, padding)
- Generic pill / button utility classes used by tier and flavor toggles

Per-demo `<style>` blocks hold layout-specific rules — grid templates, demo-specific component variants, etc.

### Why a shared CSS file instead of duplicating

Three demos currently duplicate ~250 lines of palette+typography. After the rebuild, four files would do the same. A single shared file ensures:
- Visual consistency without manual sync
- Easy palette tweak in one place
- Each demo HTML stays focused on its unique layout

The CSS file is loaded as a `<link rel="stylesheet" href="./_shared.css">` from each demo. No build step (the demos are served as static files directly).

---

## Conventions

- **No `gh.refresh()` unless needed.** The pdp.html tier toggle is CSS-only (both tiers' bindings are pre-rendered, toggle just changes visibility). `gh.refresh()` is for cache invalidation, not view-state toggling.
- **No deprecated array paths.** All variant access goes through `<tier>List` (for iteration) or `<tier>ByQuantity.<qty>` (for direct lookup). No `variants.subscription.standard.0.price` patterns anywhere.
- **Inline JS is minimal.** Each demo's inline `<script>` does only what's not expressible declaratively: the funnel "Continue" link href build, the offer-selector pill toggling, the PDP tier toggle's CSS state, the PDP Add-to-Cart `console.log`. All other binding is declarative.
- **Slugs are hardcoded** in the HTML. (Real partner pages would inject from server-side templates; the demos are static.)
- **Test key embedded** in the script tag (`gh_pk_test_all_…` — the existing UAT key, intentionally checked in).
- **Generic placeholder text** for partner-controlled content (e.g. "quiz body here" inside the funnel-step's step body).
- **No emoji** in demo HTML.

---

## Acceptance criteria

1. Four demo HTML files exist: `index.html`, `funnel-step.html`, `offer-selector.html`, `pdp.html`.
2. `variant-grid.html`, `funnel-steps.html`, `destination-detail.html`, `product-pricing.html` are removed (the renamed/folded ones).
3. `_shared.css` exists and is `<link>`ed from all four demos.
4. All demos use only `<tier>List` or `<tier>ByQuantity.<qty>` for variant access — no `variants.<purchase>.<tier>` (deprecated array path).
5. Each demo, when opened in a browser, fetches the documented slug(s) and renders without console errors.
6. `funnel-step.html`'s "Continue" button has a non-empty `href` after `gh:bindings-ready` fires.
7. `offer-selector.html`'s flavor + purchase-type pills toggle which 3 of 12 cards are visible. Each visible card's CTA `href` matches its `funnelSlug` field.
8. `pdp.html`'s tier toggle swaps which of two variant card-sets is visible without firing a new HTTP request (verifiable in the Network tab).
9. `index.html`'s feature matrix accurately reflects the patterns in the three new demos.
10. No demo references real-brand sample data outside Gundry MD / MCT Wellness (those are the authorized real brands for these demos).
11. All HTML is self-contained: opens in a browser with no build step.

---

## Non-goals

- New SDK features
- Build system changes
- Test additions (the demos are not test fixtures)
- Changeset / release work
- Backward-compatible aliases for the deleted file paths (no `funnel-steps.html` redirect; assumed unused since not pushed to a public URL outside the index)
