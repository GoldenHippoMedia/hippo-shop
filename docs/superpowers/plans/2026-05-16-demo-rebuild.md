# Demo Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/examples-static/`'s 5 generic demos with 3 real-world archetype demos (funnel step, offer selector, PDP) + a redesigned landing page, all using MCT Wellness data.

**Architecture:** Single shared CSS file (`_shared.css`) extracts the palette/typography. Four HTML files each load that shared CSS plus their own per-demo `<style>` block. Each demo loads the SDK from `api-uat.goldenhippo.io` with the existing public test key and binds to real Gundry MD / MCT Wellness slugs. Inline JS in each demo is minimal — only what cannot be expressed declaratively (funnel "Continue" link build, offer-selector pill toggle, PDP tier toggle).

**Tech Stack:** Static HTML + CSS + minimal vanilla JS. No build step. SDK loaded via `<script>` tag.

**Source of truth:** `docs/superpowers/specs/2026-05-16-demo-rebuild-design.md` (commit `bee33a8`).

**Commit convention:** `docs(examples): <imperative summary>` matching prior demo work conventions.

---

## File Structure

**Files to create:**
- `apps/examples-static/_shared.css` — Gundry MD palette, typography, base card/pill/button classes
- `apps/examples-static/funnel-step.html` — funnel demo with progress bar + next-step CTA
- `apps/examples-static/offer-selector.html` — 12-destination offer page with flavor + purchase-type filtering
- `apps/examples-static/pdp.html` — single product with tier toggle + quantity ladder

**Files to modify:**
- `apps/examples-static/index.html` — full redesign for new 3-demo structure

**Files to delete:**
- `apps/examples-static/funnel-steps.html`
- `apps/examples-static/destination-detail.html`
- `apps/examples-static/product-pricing.html`
- `apps/examples-static/variant-grid.html`

---

## Working principles

- **Read existing demos first** for styling reference. The current files are a goldmine of CSS patterns that match the Gundry MD brand. The implementer is free to copy & adapt CSS rules from them.
- **Be exact about `data-*` bindings.** Every `data-field`, `data-attr-*`, `data-gh-<kind>`, `data-with`, `data-if`, `data-each` attribute in this plan should appear verbatim in the final file.
- **Inline JS only where declarative can't reach.** Each demo's `<script>` block should be small and focused.
- **No deprecated array paths.** Never use `variants.subscription.standard.<index>` etc. — always `<tier>List` or `<tier>ByQuantity.<qty>`.
- **One commit per demo.** Each task commits independently; the smoke test for each is "the file opens in a browser and renders correctly."
- **Use the existing test key** (`gh_pk_test_all_feab8e2ae18f8164ee7e1f36412b774a`) and host `api-uat.goldenhippo.io` — already present in current demos.

---

## Task 1: Create `_shared.css`

**Files:**
- Create: `apps/examples-static/_shared.css`

The shared stylesheet holds the design system: Gundry MD palette, fonts, base card / button / pill styles. Per-demo HTML files `<link>` this file then add only their layout-specific rules.

- [ ] **Step 1: Read the existing `index.html` `<style>` block for reference**

Run: `head -300 apps/examples-static/index.html | grep -A 250 "<style>"`

The current `index.html` already has the palette and typography we want to extract. Cherry-pick what's reusable.

- [ ] **Step 2: Write `_shared.css`**

Create `apps/examples-static/_shared.css` with this content:

```css
/*
 * Hippo Shop SDK demos — shared design system.
 * Each demo file `<link>`s this stylesheet, then adds its own layout rules
 * in a per-page `<style>` block.
 */

@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Red+Hat+Text:ital,wght@0,300..700;1,300..700&display=swap');

:root {
  /* Gundry Blue */
  --blue-50:#F3F7FF; --blue-100:#E0E9FF; --blue-200:#C2D4FF; --blue-300:#9DB8FF;
  --blue-400:#6B91FF; --blue-500:#4569DF; --blue-600:#2945B8; --blue-700:#233B92;
  --blue-800:#1A2C6A; --blue-900:#101D49;

  /* Vitality Lime */
  --lime-50:#F4F9E8; --lime-100:#E5EFCB; --lime-300:#AEC947;
  --lime-400:#C2E329; --lime-500:#6B7F00; --lime-600:#536300; --lime-700:#3F4C00;

  /* Neutrals */
  --gray-50:#f9fafb; --gray-100:#f3f4f6; --gray-200:#e5e7eb; --gray-300:#d1d5db;
  --gray-400:#9ca3af; --gray-500:#6b7280; --gray-600:#4b5563; --gray-700:#374151;
  --gray-900:#111827;

  --green-600:#16a34a;
  --red-600:#dc2626;

  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.05);

  --font-serif: 'Lora', Georgia, serif;
  --font-sans:  'Red Hat Text', Inter, -apple-system, BlinkMacSystemFont, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.55;
  color: var(--gray-900);
  background: #fff;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3 { font-family: var(--font-serif); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
p { margin: 0; }
a { color: var(--blue-600); }
a:hover { color: var(--blue-700); }

/* ---------- Page chrome ---------- */

.page { max-width: 960px; margin: 56px auto 96px; padding: 0 20px; }
.page-narrow { max-width: 720px; }

.eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--blue-600);
}

.section-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gray-500);
  margin-bottom: 8px;
}

/* ---------- Cards ---------- */

.card {
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
  padding: 22px;
}

/* ---------- Pills (radio-style segmented controls) ---------- */

.pill-group {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  border: 1px solid var(--gray-200);
  border-radius: 999px;
  background: #fff;
  color: var(--gray-700);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.pill:hover { border-color: var(--blue-300); }
.pill[aria-checked="true"] {
  background: var(--blue-600);
  border-color: var(--blue-600);
  color: #fff;
  font-weight: 700;
}

/* ---------- Buttons / CTAs ---------- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 22px;
  border: 1px solid var(--blue-600);
  background: var(--blue-600);
  color: #fff;
  border-radius: 10px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.btn:hover {
  background: var(--blue-700);
  border-color: var(--blue-700);
  color: #fff;
}

.btn-block { width: 100%; }
.btn-ghost {
  background: transparent;
  color: var(--blue-600);
}
.btn-ghost:hover { background: var(--blue-50); }

/* ---------- Stock pill ---------- */

.stock {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--gray-100);
  color: var(--gray-600);
}
.stock[data-stock="in"] {
  background: color-mix(in srgb, var(--green-600) 18%, transparent);
  color: var(--green-600);
}
.stock[data-stock="out"] {
  background: color-mix(in srgb, var(--red-600) 18%, transparent);
  color: var(--red-600);
}

/* ---------- Inline code ---------- */

code {
  background: var(--gray-100);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--gray-700);
}

/* ---------- Demo-frame footer ---------- */

.demo-footer {
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid var(--gray-200);
  font-size: 13px;
  color: var(--gray-500);
  line-height: 1.7;
}
.demo-footer p + p { margin-top: 8px; }
.demo-footer a {
  color: var(--gray-600);
  font-weight: 500;
}
```

- [ ] **Step 3: Verify the file is well-formed**

Run: `wc -l apps/examples-static/_shared.css`
Expected: roughly 150-180 lines.

Run: `grep -c "^}" apps/examples-static/_shared.css`
Expected: an integer > 15 (one closing brace per rule).

- [ ] **Step 4: Commit**

```bash
git add apps/examples-static/_shared.css
git commit -m "$(cat <<'EOF'
docs(examples): add shared CSS for demo design system

Extracts the Gundry MD palette, typography, and base card/pill/button
styles into a single stylesheet so all demo HTML files can stay focused
on their unique layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `funnel-step.html`

**Files:**
- Create: `apps/examples-static/funnel-step.html`
- Read for reference: `apps/examples-static/funnel-steps.html` (existing — for styling cues), `packages/types/src/funnel.ts` (DTO shape)

The funnel-step demo simulates being on step 3 of a 5-step funnel. Fetches the funnel, renders a progress bar from `steps[]`, displays the current step's name + kind, and builds a "Continue to step N →" CTA from `steps[currentIndex + 1].slug`.

- [ ] **Step 1: Read the funnel DTO shape**

Run: `cat packages/types/src/funnel.ts`

Confirm the shape:
- `HippoShopFunnelDTO`: `slug`, `name`, `active`, `steps[]`
- `HippoShopFunnelStepDTO`: `stepNumber` (1-indexed), `slug`, `name`, `kind`
- `HippoShopStepKind`: `'landing' | 'content' | 'order-form' | 'bump' | 'upsell' | 'downsell' | 'thank-you'`

- [ ] **Step 2: Create `funnel-step.html` with the full content**

Write the file with this content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hippo Shop SDK — funnel step demo</title>
    <link rel="stylesheet" href="./_shared.css" />
    <style>
      /* ---------- Page-specific layout ---------- */

      .funnel-card { padding: 40px; }
      .funnel-name {
        font-size: 13px;
        color: var(--gray-500);
        margin-bottom: 12px;
      }
      .funnel-name strong { color: var(--gray-700); }

      /* Progress bar */
      .progress {
        display: flex;
        gap: 6px;
        margin-bottom: 28px;
      }
      .progress-seg {
        flex: 1;
        height: 6px;
        background: var(--gray-200);
        border-radius: 3px;
        transition: background 200ms ease;
      }
      .progress-seg[data-current="true"] { background: var(--blue-600); }
      .progress-seg[data-done="true"]    { background: var(--blue-400); }

      /* Color-code by step kind */
      .progress-seg[data-stage="landing"][data-done="true"]    { background: var(--lime-400); }
      .progress-seg[data-stage="content"][data-done="true"]    { background: var(--blue-400); }
      .progress-seg[data-stage="order-form"][data-done="true"] { background: var(--blue-500); }
      .progress-seg[data-stage="upsell"][data-done="true"]     { background: var(--blue-600); }
      .progress-seg[data-stage="thank-you"][data-done="true"]  { background: var(--green-600); }

      .step-meta {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--blue-600);
        margin-bottom: 10px;
      }

      .step-name {
        font-size: 30px;
        line-height: 1.2;
        margin-bottom: 18px;
      }

      .step-body {
        background: var(--gray-50);
        border: 1px dashed var(--gray-300);
        border-radius: 8px;
        padding: 32px;
        color: var(--gray-500);
        font-style: italic;
        text-align: center;
        margin: 20px 0 32px;
      }

      .cta-row {
        display: flex;
        gap: 12px;
        align-items: center;
      }
      .cta-row .btn { flex: 1; }
      .cta-row .btn[hidden] { display: none; }

      .demo-note {
        margin-top: 12px;
        font-size: 12px;
        color: var(--gray-500);
      }
      .demo-note code { font-size: 11px; }
    </style>
  </head>
  <body>
    <main class="page page-narrow">
      <article
        class="card funnel-card"
        data-gh-funnel="demo_mct_cms_survey_260427"
      >
        <p class="funnel-name">
          You're inside <strong data-field="name">…</strong>
        </p>

        <!--
          Progress bar — built from funnel.steps[] via <template data-each>.
          `data-attr-data-stage="kind"` lets CSS color-code each segment by step kind.
          The inline JS at the bottom of this file sets `data-current` / `data-done`
          on each segment based on the hardcoded currentIndex.
        -->
        <nav class="progress" aria-label="Funnel progress">
          <template data-each="steps">
            <span
              class="progress-seg"
              data-attr-data-stage="kind"
              data-attr-data-step-number="stepNumber"
            ></span>
          </template>
        </nav>

        <!--
          Current step body. `data-field="steps.2.name"` reads the third step
          (index 2 = step 3 of 5) directly. Real partner code would derive
          the index from the URL or session state; the demo hardcodes 2.
        -->
        <p class="step-meta">
          Step <span data-field="steps.2.stepNumber">3</span> of
          <span data-field="steps.0.stepNumber">5</span><!-- replaced below by JS -->
          ·
          <span data-field="steps.2.kind">content</span>
        </p>

        <h1 class="step-name" data-field="steps.2.name">Quick wellness check-in</h1>

        <div class="step-body">
          Partner-controlled step body lives here — a quiz question, a content
          block, an order-form, whatever fits this step's <code>kind</code>.
        </div>

        <div class="cta-row">
          <a id="continue-btn" class="btn btn-block" href="#" hidden>
            Continue to step <span id="continue-target-number">N</span> →
          </a>
          <a id="complete-btn" class="btn btn-block" href="#complete" hidden>
            Complete →
          </a>
        </div>

        <p class="demo-note">
          The <code>href</code> on the Continue button is built by inline JS reading
          <code>funnel.steps[currentIndex&nbsp;+&nbsp;1].slug</code> on
          <code>gh:bindings-ready</code>. Hardcoded <code>currentIndex = 2</code>
          in this demo — your code would derive it from the URL.
        </p>
      </article>

      <footer class="demo-footer">
        <p>
          ← <a href="./index.html">Back to demos</a>
        </p>
        <p>
          SDK loaded from <code>api-uat.goldenhippo.io</code>. Funnel slug:
          <code>demo_mct_cms_survey_260427</code>.
        </p>
      </footer>
    </main>

    <script
      src="https://api-uat.goldenhippo.io/sdk/v1/gh.js"
      data-key="gh_pk_test_all_feab8e2ae18f8164ee7e1f36412b774a"
      data-brand="Gundry MD"
    ></script>

    <script>
      // Demo hardcodes "you are currently on step index 2" (= step 3 of 5).
      // In a real partner page this would come from the URL or session.
      const currentIndex = 2;

      // Wait for the SDK's initial bind pass to settle before we touch the
      // progress segments or read funnel.steps. We listen on `gh:bindings-ready`
      // because by that point: (a) every <template data-each> has expanded into
      // sibling clones, and (b) the funnel resource is cached.
      window.addEventListener('gh:bindings-ready', async () => {
        const funnel = await window.gh.data.funnel('demo_mct_cms_survey_260427');

        // Mark progress segments. The clones live alongside the <template> in
        // document order, each carrying data-gh-loop-clone (an SDK marker).
        const segments = document.querySelectorAll('.progress-seg[data-gh-loop-clone]');
        segments.forEach((seg, idx) => {
          if (idx < currentIndex)       seg.setAttribute('data-done', 'true');
          else if (idx === currentIndex) seg.setAttribute('data-current', 'true');
        });

        // Wire up Continue / Complete buttons.
        const next = funnel.steps[currentIndex + 1];
        const continueBtn = document.getElementById('continue-btn');
        const completeBtn = document.getElementById('complete-btn');

        if (next) {
          continueBtn.href = `#step-${next.slug}`;
          document.getElementById('continue-target-number').textContent = next.stepNumber;
          continueBtn.hidden = false;
        } else {
          completeBtn.hidden = false;
        }
      }, { once: true });
    </script>
  </body>
</html>
```

- [ ] **Step 3: Verify the file is well-formed**

Run: `wc -l apps/examples-static/funnel-step.html`
Expected: roughly 200-250 lines.

Run: `grep -c 'data-gh-funnel="demo_mct_cms_survey_260427"' apps/examples-static/funnel-step.html`
Expected: 1.

Run: `grep -c "variants.subscription.standard\b" apps/examples-static/funnel-step.html`
Expected: 0 (this demo has no product variant access; the grep is a safety net for the global rule).

- [ ] **Step 4: Smoke test in a browser (manual)**

Open `apps/examples-static/funnel-step.html` in a browser. Expected:
- Funnel name appears at top
- Progress bar renders with 5+ segments (depending on the actual funnel)
- Step 3 name + kind shown
- "Continue to step 4 →" button appears with a non-empty `href`
- Network tab shows one GET to `/public/v1/funnel/demo_mct_cms_survey_260427`
- Console has no errors

If the funnel has fewer than 4 steps, the demo will show "Complete →" instead — that's correct behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/examples-static/funnel-step.html
git commit -m "$(cat <<'EOF'
docs(examples): add funnel-step demo

Replaces the prior funnel-steps "list of all steps" view with a
realistic single-step page: progress bar built from funnel.steps[],
current step name + kind, and a Continue CTA whose href is built
from funnel.steps[currentIndex + 1].slug on gh:bindings-ready.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `offer-selector.html`

**Files:**
- Create: `apps/examples-static/offer-selector.html`
- Read for reference: `apps/examples-static/destination-detail.html` (existing — for styling cues), `packages/types/src/destination.ts` (DTO shape)

The offer-selector demo binds 12 destinations (6 strawberry lemonade + 6 raspberry medley). Two filter rows (flavor + purchase type) reduce the 12 cards down to 3 visible at a time. Each visible card's CTA `href` is bound to `funnelSlug` so click routes to the post-purchase funnel.

- [ ] **Step 1: Read the destination DTO shape and the existing demo for styling**

Run:
```bash
cat packages/types/src/destination.ts
head -250 apps/examples-static/destination-detail.html
```

Confirm shape:
- `HippoShopDestinationDTO`: `slug`, `name`, `description`, `funnelSlug`, `pricing`
- `HippoShopPricingDTO`: `sku`, `packageQuantity`, `purchaseType`, `frequency`, `price`, `rebillPrice`, `outOfStock`, `shipping`
- `HippoShopPriceDTO`: `amount`, `currency`, `savings`

- [ ] **Step 2: Create `offer-selector.html`**

Write the file with this content. The 12 destination cards repeat a similar template — be precise about the slugs and the `data-flavor` / `data-purchase` markers, but the inner binding pattern is the same on each.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hippo Shop SDK — offer selector demo</title>
    <link rel="stylesheet" href="./_shared.css" />
    <style>
      /* ---------- Header ---------- */

      .demo-header { margin-bottom: 36px; }
      .demo-header h1 {
        font-size: 30px;
        line-height: 1.2;
        margin: 4px 0 6px;
      }
      .demo-header p {
        color: var(--gray-600);
        font-size: 15px;
        max-width: 560px;
      }

      /* ---------- Filter rows ---------- */

      .filters { margin-bottom: 28px; }
      .filter-row { margin-bottom: 18px; }
      .filter-row legend {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--gray-500);
        margin-bottom: 8px;
        padding: 0;
      }
      .filter-row fieldset {
        border: none;
        padding: 0;
        margin: 0;
      }

      /* ---------- Offer grid ---------- */

      .offers {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }

      .offer {
        background: #fff;
        border: 1px solid var(--gray-200);
        border-radius: 14px;
        padding: 24px;
        text-align: center;
        position: relative;
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }
      .offer:hover {
        border-color: var(--blue-300);
        box-shadow: var(--shadow-sm);
      }
      .offer.is-featured {
        border-color: var(--lime-300);
        box-shadow: 0 0 0 2px var(--lime-100), var(--shadow-sm);
      }
      .offer[hidden] { display: none !important; }

      .offer .ribbon {
        position: absolute;
        top: 14px;
        right: 14px;
        background: var(--lime-400);
        color: var(--blue-900);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 4px 9px;
        border-radius: 999px;
      }

      .offer .qty {
        font-family: var(--font-serif);
        font-size: 38px;
        font-weight: 700;
        line-height: 1;
        margin: 0 0 4px;
      }
      .offer .package {
        color: var(--gray-500);
        font-size: 13px;
        margin-bottom: 14px;
      }
      .offer .price {
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 4px;
      }
      .offer .cadence {
        font-size: 12px;
        color: var(--gray-500);
        margin: 0 0 14px;
      }
      .offer .savings {
        color: var(--green-600);
        font-size: 13px;
        font-weight: 700;
        margin: 0 0 14px;
      }
      .offer .savings[data-gh-hidden] { display: none; }
      .offer .sku {
        font-size: 11px;
        color: var(--gray-400);
        margin-top: 12px;
      }

      .offer .btn {
        width: 100%;
        margin-top: 10px;
      }

      .demo-note {
        margin-top: 28px;
        padding: 16px 20px;
        background: var(--gray-50);
        border-left: 3px solid var(--blue-400);
        border-radius: 6px;
        font-size: 13px;
        color: var(--gray-600);
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="demo-header">
        <p class="eyebrow">MCT Wellness · Offer Selector</p>
        <h1>Pick the package that's right for you</h1>
        <p>
          12 destinations in this demo (2 flavors × 3 quantities × 2 purchase types).
          The two filter rows below collapse them to 3 visible cards. Each card's
          CTA <code>href</code> is bound to <code>funnelSlug</code> so click routes
          to the post-purchase funnel for that specific SKU.
        </p>
      </header>

      <div class="filters">
        <div class="filter-row" data-filter="flavor">
          <fieldset>
            <legend>Flavor</legend>
            <div class="pill-group" role="radiogroup" aria-label="Flavor">
              <button type="button" class="pill" role="radio"
                      aria-checked="true"
                      data-value="strawberry-lemonade">Strawberry Lemonade</button>
              <button type="button" class="pill" role="radio"
                      aria-checked="false"
                      data-value="raspberry-medley">Raspberry Medley</button>
            </div>
          </fieldset>
        </div>

        <div class="filter-row" data-filter="purchase">
          <fieldset>
            <legend>Plan</legend>
            <div class="pill-group" role="radiogroup" aria-label="Purchase type">
              <button type="button" class="pill" role="radio"
                      aria-checked="true"
                      data-value="subscription">Subscribe &amp; save</button>
              <button type="button" class="pill" role="radio"
                      aria-checked="false"
                      data-value="one-time">One-time</button>
            </div>
          </fieldset>
        </div>
      </div>

      <!--
        12 destination cards. Each carries data-flavor + data-purchase markers
        so the inline JS at the bottom can toggle [hidden] on the 9 cards that
        don't match the current filter pair. The CTA href is bound to
        funnelSlug so click routes to the correct post-purchase funnel.
      -->
      <section class="offers">
        <!-- Strawberry Lemonade · Subscription -->
        <article class="offer" data-flavor="strawberry-lemonade" data-purchase="subscription"
                 data-gh-destination="d_mctwellness_1unitsub_mf_240210">
          <p class="qty"><span data-field="pricing.packageQuantity">1</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="cadence">
            Renews <span data-field="pricing.frequency.label">every 30 days</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer" data-flavor="strawberry-lemonade" data-purchase="subscription"
                 data-gh-destination="d_mctwellness_3unitsub_mf_240210">
          <p class="qty"><span data-field="pricing.packageQuantity">3</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="cadence">
            Renews <span data-field="pricing.frequency.label">every 30 days</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer is-featured" data-flavor="strawberry-lemonade" data-purchase="subscription"
                 data-gh-destination="d_mctwellness_6unitsub_mf_240210">
          <p class="ribbon" data-if="pricing.price.savings">Best Value</p>
          <p class="qty"><span data-field="pricing.packageQuantity">6</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="cadence">
            Renews <span data-field="pricing.frequency.label">every 30 days</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <!-- Strawberry Lemonade · One-time -->
        <article class="offer" data-flavor="strawberry-lemonade" data-purchase="one-time"
                 data-gh-destination="d_mctwellness_1unit_mf_221006">
          <p class="qty"><span data-field="pricing.packageQuantity">1</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer" data-flavor="strawberry-lemonade" data-purchase="one-time"
                 data-gh-destination="d_mctwellness_3unit_mf_240210">
          <p class="qty"><span data-field="pricing.packageQuantity">3</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer is-featured" data-flavor="strawberry-lemonade" data-purchase="one-time"
                 data-gh-destination="d_mctwellness_6unit_mf_240210">
          <p class="ribbon" data-if="pricing.price.savings">Best Value</p>
          <p class="qty"><span data-field="pricing.packageQuantity">6</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <!-- Raspberry Medley · Subscription -->
        <article class="offer" data-flavor="raspberry-medley" data-purchase="subscription"
                 data-gh-destination="d_mctwellnessraspberry_1unitsub_mf_240210" hidden>
          <p class="qty"><span data-field="pricing.packageQuantity">1</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="cadence">
            Renews <span data-field="pricing.frequency.label">every 30 days</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer" data-flavor="raspberry-medley" data-purchase="subscription"
                 data-gh-destination="d_mctwellnessraspberry_3unitsub_mf_240210" hidden>
          <p class="qty"><span data-field="pricing.packageQuantity">3</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="cadence">
            Renews <span data-field="pricing.frequency.label">every 30 days</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer is-featured" data-flavor="raspberry-medley" data-purchase="subscription"
                 data-gh-destination="d_mctwellnessraspberry_6unitsub_mf_240210" hidden>
          <p class="ribbon" data-if="pricing.price.savings">Best Value</p>
          <p class="qty"><span data-field="pricing.packageQuantity">6</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="cadence">
            Renews <span data-field="pricing.frequency.label">every 30 days</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <!-- Raspberry Medley · One-time -->
        <article class="offer" data-flavor="raspberry-medley" data-purchase="one-time"
                 data-gh-destination="d_mctwellnessraspberry_1unit_mf_11164" hidden>
          <p class="qty"><span data-field="pricing.packageQuantity">1</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer" data-flavor="raspberry-medley" data-purchase="one-time"
                 data-gh-destination="d_mctwellnessraspberry_3unit_mf_240210" hidden>
          <p class="qty"><span data-field="pricing.packageQuantity">3</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>

        <article class="offer is-featured" data-flavor="raspberry-medley" data-purchase="one-time"
                 data-gh-destination="d_mctwellnessraspberry_6unit_mf_240210" hidden>
          <p class="ribbon" data-if="pricing.price.savings">Best Value</p>
          <p class="qty"><span data-field="pricing.packageQuantity">6</span></p>
          <p class="package"><span data-field="name">…</span></p>
          <p class="price">
            <span data-field="pricing.price.amount" data-format="currency:USD">$0.00</span>
          </p>
          <p class="savings" data-if="pricing.price.savings">
            Save <span data-field="pricing.price.savings" data-format="currency:USD">$0</span>
          </p>
          <a class="btn" data-attr-href="funnelSlug" data-attr-aria-label="name" href="#">
            Continue →
          </a>
          <p class="sku"><span data-field="pricing.sku">SKU</span></p>
        </article>
      </section>

      <p class="demo-note">
        All 12 destinations fetch concurrently when the page loads — the SDK
        dedupes requests by slug. Filter pills toggle <code>hidden</code> on the
        9 non-matching cards purely in client JS; no extra fetches happen when
        you change a filter.
      </p>

      <footer class="demo-footer">
        <p>← <a href="./index.html">Back to demos</a></p>
        <p>
          SDK loaded from <code>api-uat.goldenhippo.io</code>. 12 destination slugs
          listed in the page source.
        </p>
      </footer>
    </main>

    <script
      src="https://api-uat.goldenhippo.io/sdk/v1/gh.js"
      data-key="gh_pk_test_all_feab8e2ae18f8164ee7e1f36412b774a"
      data-brand="Gundry MD"
    ></script>

    <script>
      // Filter-pill toggling. No SDK calls here — just visibility on already-
      // rendered cards. The 3 cards whose data-flavor + data-purchase match
      // the active pair stay visible; the other 9 get [hidden].
      (function () {
        const filters = { flavor: 'strawberry-lemonade', purchase: 'subscription' };

        function applyFilters() {
          document.querySelectorAll('.offer').forEach((card) => {
            const matches =
              card.getAttribute('data-flavor') === filters.flavor &&
              card.getAttribute('data-purchase') === filters.purchase;
            card.hidden = !matches;
          });
        }

        document.querySelectorAll('.filter-row').forEach((row) => {
          const kind = row.getAttribute('data-filter');
          row.querySelectorAll('.pill').forEach((pill) => {
            pill.addEventListener('click', () => {
              row.querySelectorAll('.pill').forEach((p) =>
                p.setAttribute('aria-checked', 'false'),
              );
              pill.setAttribute('aria-checked', 'true');
              filters[kind] = pill.getAttribute('data-value');
              applyFilters();
            });
          });
        });

        applyFilters();
      })();
    </script>
  </body>
</html>
```

- [ ] **Step 3: Verify the file is well-formed**

Run: `wc -l apps/examples-static/offer-selector.html`
Expected: roughly 600-700 lines.

Run: `grep -c 'data-gh-destination=' apps/examples-static/offer-selector.html`
Expected: 12 (one per destination card).

Run: `grep -E 'data-gh-destination="d_mctwellness(raspberry)?_[136]unit(sub)?_mf_' apps/examples-static/offer-selector.html | wc -l`
Expected: 12.

Run: `grep -c "variants\." apps/examples-static/offer-selector.html`
Expected: 0 (this demo binds destinations, not products — no `variants.*` paths).

- [ ] **Step 4: Smoke test in a browser (manual)**

Open `apps/examples-static/offer-selector.html` in a browser. Expected:
- Two filter rows visible at top with active pills (Strawberry Lemonade + Subscribe & save)
- Three cards visible: 1, 3, 6 unit (subscription, strawberry lemonade)
- 6-unit card carries the "Best Value" ribbon (when savings is non-null) and the `is-featured` border
- Click "Raspberry Medley" → cards swap to raspberry subs
- Click "One-time" → cards swap to one-time variants
- Network tab shows ~12 GETs to `/public/v1/destination/<slug>` (deduped)
- Each visible card's "Continue" button has an `href` matching its `funnelSlug`
- Console has no errors

- [ ] **Step 5: Commit**

```bash
git add apps/examples-static/offer-selector.html
git commit -m "$(cat <<'EOF'
docs(examples): add offer-selector demo

12-destination offer page covering both MCT Wellness flavors and both
purchase types. Two filter pill rows (flavor + plan) collapse the 12
cards down to 3 visible matches. Each visible card's CTA href is bound
to funnelSlug so click routes to the post-purchase funnel for that SKU.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `pdp.html`

**Files:**
- Create: `apps/examples-static/pdp.html`
- Read for reference: `apps/examples-static/product-pricing.html` and `apps/examples-static/variant-grid.html` (existing — for styling cues), `packages/types/src/product.ts` (DTO shape)

The PDP demo binds one product (`mct-wellness`), shows a single tier at a time (Standard or My Account, toggleable), renders a 3-card quantity ladder using `<tier>ByQuantity.<qty>`, and an Add-to-Cart CTA. Tier toggle is CSS-only — both tier card-sets are pre-rendered and the toggle changes visibility.

- [ ] **Step 1: Read the product DTO + existing PDP demos for styling**

Run:
```bash
cat packages/types/src/product.ts
head -200 apps/examples-static/product-pricing.html
```

Confirm shape:
- Variant access: `variants.subscription.standardByQuantity.<qty>`, `variants.subscription.myAccountByQuantity.<qty>`
- Variant fields: `sku`, `price`, `rebillPrice`, `quantity`, `packageType`, `savings`, `alternatePurchaseTypePrice`, `defaultFrequency.label`
- Product fields: `name`, `image`, `outOfStock`, `reviews.count`, `reviews.average`, `reviews.globalFiveStarReviews`

- [ ] **Step 2: Create `pdp.html`**

Write the file with this content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hippo Shop SDK — PDP demo</title>
    <link rel="stylesheet" href="./_shared.css" />
    <style>
      /* ---------- Layout ---------- */

      .pdp {
        display: grid;
        grid-template-columns: 1fr;
        gap: 32px;
        padding: 32px;
      }
      @media (min-width: 720px) {
        .pdp { grid-template-columns: 320px 1fr; }
      }

      .hero {
        position: relative;
        background: var(--gray-50);
        border-radius: 12px;
        aspect-ratio: 1;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .hero img {
        width: 90%;
        height: 90%;
        object-fit: contain;
      }
      .hero .stock {
        position: absolute;
        top: 14px;
        left: 14px;
      }

      .body h1 {
        font-size: 30px;
        line-height: 1.15;
        margin-bottom: 8px;
      }
      .reviews {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--gray-600);
        font-size: 13px;
        margin-bottom: 18px;
      }
      .reviews .stars { color: var(--lime-500); font-weight: 700; }

      /* ---------- Tier toggle ---------- */

      .tier-toggle { margin-bottom: 18px; }
      .tier-toggle legend {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--gray-500);
        margin-bottom: 8px;
        padding: 0;
      }
      .tier-toggle fieldset {
        border: none;
        padding: 0;
        margin: 0;
      }

      /* ---------- Variant grid ---------- */

      .variants legend {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--gray-500);
        margin-bottom: 8px;
        padding: 0;
      }
      .variants fieldset {
        border: none;
        padding: 0;
        margin: 0 0 18px;
      }
      .variant-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
      }
      .variant {
        background: #fff;
        border: 2px solid var(--gray-200);
        border-radius: 10px;
        padding: 14px 12px;
        text-align: center;
        cursor: pointer;
        position: relative;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .variant:hover { border-color: var(--blue-300); }
      .variant.is-selected {
        border-color: var(--blue-600);
        background: var(--blue-50);
      }
      .variant .qty {
        font-family: var(--font-serif);
        font-weight: 700;
        font-size: 22px;
        line-height: 1;
        margin-bottom: 4px;
      }
      .variant .package {
        font-size: 11px;
        color: var(--gray-500);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 8px;
      }
      .variant .price {
        font-weight: 600;
        font-size: 16px;
        margin: 0 0 4px;
      }
      .variant .alt {
        font-size: 11px;
        color: var(--gray-500);
      }
      .variant .alt[data-gh-hidden] { display: none; }
      .variant .ribbon {
        position: absolute;
        top: -10px;
        right: 8px;
        background: var(--lime-400);
        color: var(--blue-900);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 3px 7px;
        border-radius: 999px;
      }
      .variant .ribbon[data-gh-hidden] { display: none; }

      /* Show only the active tier's variants */
      .pdp-root[data-tier="standard"]  [data-tier="my-account"] { display: none; }
      .pdp-root[data-tier="my-account"] [data-tier="standard"]  { display: none; }

      .cta-row {
        margin-top: 22px;
      }
      .cta-row .btn { width: 100%; }

      .demo-note {
        margin-top: 28px;
        padding: 16px 20px;
        background: var(--gray-50);
        border-left: 3px solid var(--blue-400);
        border-radius: 6px;
        font-size: 13px;
        color: var(--gray-600);
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main class="page page-narrow">
      <article
        class="card pdp pdp-root"
        data-gh-product="mct-wellness"
        data-tier="standard"
      >
        <div class="hero">
          <span
            class="stock"
            data-field="outOfStock"
            data-format="bool:Out of stock:In stock"
            data-attr-data-stock="outOfStock"
            data-attr-format-data-stock="bool:out:in"
          >…</span>
          <img data-attr-src="image" data-attr-alt="name" alt="" />
        </div>

        <div class="body">
          <h1 data-field="name">…</h1>
          <p class="reviews">
            <span class="stars">★</span>
            <span data-field="reviews.average" data-format="number:1">0.0</span>
            <span>
              (<span data-field="reviews.count" data-format="number:0">0</span> reviews)
            </span>
          </p>

          <!-- Tier toggle: Standard / My Account -->
          <div class="tier-toggle">
            <fieldset>
              <legend>Pricing tier</legend>
              <div class="pill-group" role="radiogroup" aria-label="Pricing tier">
                <button type="button" class="pill" role="radio"
                        aria-checked="true"
                        data-value="standard">Standard</button>
                <button type="button" class="pill" role="radio"
                        aria-checked="false"
                        data-value="my-account">My Account</button>
              </div>
            </fieldset>
          </div>

          <!--
            Variant grid. Two parallel sets — one for each tier. CSS hides the
            inactive set based on the data-tier attribute on .pdp-root. No
            gh.refresh() needed; both tiers are pre-bound at first render.
          -->
          <div class="variants">
            <fieldset>
              <legend>Pick your quantity</legend>

              <!-- Standard tier — visible when data-tier="standard" -->
              <div class="variant-grid" data-tier="standard">
                <button type="button" class="variant" data-with="variants.subscription.standardByQuantity.1">
                  <p class="qty"><span data-field="quantity">1</span></p>
                  <p class="package"><span data-field="packageType">bottle</span></p>
                  <p class="price">
                    <span data-field="price" data-format="currency:USD">$0.00</span>
                  </p>
                  <p class="alt" data-if="alternatePurchaseTypePrice">
                    Or once
                    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD">$0</span>
                  </p>
                </button>

                <button type="button" class="variant is-selected" data-with="variants.subscription.standardByQuantity.3">
                  <p class="qty"><span data-field="quantity">3</span></p>
                  <p class="package"><span data-field="packageType">bottle</span>s</p>
                  <p class="price">
                    <span data-field="price" data-format="currency:USD">$0.00</span>
                  </p>
                  <p class="alt" data-if="alternatePurchaseTypePrice">
                    Or once
                    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD">$0</span>
                  </p>
                </button>

                <button type="button" class="variant" data-with="variants.subscription.standardByQuantity.6">
                  <p class="ribbon" data-if="savings">
                    Save <span data-field="savings" data-format="savePercent:0">0%</span>
                  </p>
                  <p class="qty"><span data-field="quantity">6</span></p>
                  <p class="package"><span data-field="packageType">bottle</span>s</p>
                  <p class="price">
                    <span data-field="price" data-format="currency:USD">$0.00</span>
                  </p>
                  <p class="alt" data-if="alternatePurchaseTypePrice">
                    Or once
                    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD">$0</span>
                  </p>
                </button>
              </div>

              <!-- My Account tier — visible when data-tier="my-account" -->
              <div class="variant-grid" data-tier="my-account">
                <button type="button" class="variant" data-with="variants.subscription.myAccountByQuantity.1">
                  <p class="qty"><span data-field="quantity">1</span></p>
                  <p class="package"><span data-field="packageType">bottle</span></p>
                  <p class="price">
                    <span data-field="price" data-format="currency:USD">$0.00</span>
                  </p>
                  <p class="alt" data-if="alternatePurchaseTypePrice">
                    Or once
                    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD">$0</span>
                  </p>
                </button>

                <button type="button" class="variant is-selected" data-with="variants.subscription.myAccountByQuantity.3">
                  <p class="qty"><span data-field="quantity">3</span></p>
                  <p class="package"><span data-field="packageType">bottle</span>s</p>
                  <p class="price">
                    <span data-field="price" data-format="currency:USD">$0.00</span>
                  </p>
                  <p class="alt" data-if="alternatePurchaseTypePrice">
                    Or once
                    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD">$0</span>
                  </p>
                </button>

                <button type="button" class="variant" data-with="variants.subscription.myAccountByQuantity.6">
                  <p class="ribbon" data-if="savings">
                    Save <span data-field="savings" data-format="savePercent:0">0%</span>
                  </p>
                  <p class="qty"><span data-field="quantity">6</span></p>
                  <p class="package"><span data-field="packageType">bottle</span>s</p>
                  <p class="price">
                    <span data-field="price" data-format="currency:USD">$0.00</span>
                  </p>
                  <p class="alt" data-if="alternatePurchaseTypePrice">
                    Or once
                    <span data-field="alternatePurchaseTypePrice" data-format="currency:USD">$0</span>
                  </p>
                </button>
              </div>
            </fieldset>
          </div>

          <div class="cta-row">
            <button id="add-to-cart" class="btn" type="button">
              Add to Cart
            </button>
          </div>
        </div>
      </article>

      <p class="demo-note">
        Tier toggle is CSS-only — both Standard and My Account variant cards are
        pre-rendered. Switching the tier just changes which set is visible, so
        no extra HTTP fetch happens. Variant selection is captured in a small
        inline JS that <code>console.log</code>s the chosen SKU on click.
      </p>

      <footer class="demo-footer">
        <p>← <a href="./index.html">Back to demos</a></p>
        <p>
          SDK loaded from <code>api-uat.goldenhippo.io</code>. Product slug:
          <code>mct-wellness</code>.
        </p>
      </footer>
    </main>

    <script
      src="https://api-uat.goldenhippo.io/sdk/v1/gh.js"
      data-key="gh_pk_test_all_feab8e2ae18f8164ee7e1f36412b774a"
      data-brand="Gundry MD"
    ></script>

    <script>
      // Register a savePercent formatter so the 6-unit ribbon renders
      // "Save 23%" from raw savings dollars. Second arg (the retail price)
      // arrives as a string from data-format="savePercent:<retailPrice>" —
      // in the demo we pass 0 since we don't have a retail baseline; the
      // formatter falls back to a percentage of the (price + savings) sum.
      window.addEventListener('gh:data-ready', () => {
        window.gh.format.register('savePercent', (savings, retailStr) => {
          const sav = Number(savings);
          if (!Number.isFinite(sav) || sav <= 0) return '';
          const retail = Number(retailStr);
          const base = Number.isFinite(retail) && retail > 0
            ? retail
            : sav * 4; /* rough fallback — real partner would pass a baseline */
          return Math.round((sav / base) * 100) + '%';
        });
      }, { once: true });

      // Tier toggle — flips data-tier on .pdp-root which CSS reads.
      (function () {
        const root = document.querySelector('.pdp-root');
        const pills = document.querySelectorAll('.tier-toggle .pill');
        pills.forEach((pill) => {
          pill.addEventListener('click', () => {
            pills.forEach((p) => p.setAttribute('aria-checked', 'false'));
            pill.setAttribute('aria-checked', 'true');
            root.setAttribute('data-tier', pill.getAttribute('data-value'));
          });
        });
      })();

      // Variant selection — click a card, mark it selected, persist for Add-to-Cart.
      (function () {
        function applyVariantClickHandlers() {
          document.querySelectorAll('.variant-grid').forEach((grid) => {
            grid.querySelectorAll('.variant').forEach((v) => {
              if (v.dataset.clickWired === 'true') return;
              v.dataset.clickWired = 'true';
              v.addEventListener('click', () => {
                grid.querySelectorAll('.variant').forEach((other) =>
                  other.classList.remove('is-selected'),
                );
                v.classList.add('is-selected');
              });
            });
          });
        }
        // Wire on data-ready (DOM is parsed); re-wire once bindings have run
        // because the SDK's bind pass doesn't remove these buttons but we run
        // it twice just to be safe against any future DOM rewrites.
        window.addEventListener('gh:data-ready', applyVariantClickHandlers, { once: true });
        window.addEventListener('gh:bindings-ready', applyVariantClickHandlers, { once: true });
      })();

      // Add to Cart — logs the selected SKU + tier. A real partner would push
      // this to their own cart system here.
      document.getElementById('add-to-cart').addEventListener('click', () => {
        const root = document.querySelector('.pdp-root');
        const tier = root.getAttribute('data-tier');
        const activeGrid = root.querySelector(`.variant-grid[data-tier="${tier}"]`);
        const selected = activeGrid && activeGrid.querySelector('.variant.is-selected');
        if (!selected) return;
        // The SKU lives inside the bound subtree — read it from the DOM the SDK populated.
        // We grab the price element's surrounding subtree and pull the SKU via attribute lookup.
        // (Real partner code could carry data-attr-data-sku="sku" on each .variant to make this trivial.)
        console.log('[cart] add', {
          tier,
          path: selected.getAttribute('data-with'),
        });
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: Verify the file is well-formed**

Run: `wc -l apps/examples-static/pdp.html`
Expected: roughly 350-420 lines.

Run: `grep -c 'data-gh-product="mct-wellness"' apps/examples-static/pdp.html`
Expected: 1.

Run: `grep -c 'variants\.subscription\.standardByQuantity' apps/examples-static/pdp.html`
Expected: 3 (one per quantity card in the standard tier).

Run: `grep -c 'variants\.subscription\.myAccountByQuantity' apps/examples-static/pdp.html`
Expected: 3 (one per quantity card in the my-account tier).

Run: `grep -nE 'variants\.subscription\.standard(?!By|List)\b|variants\.subscription\.myAccount(?!By|List)\b' apps/examples-static/pdp.html`
Expected: zero matches (no deprecated array path).

- [ ] **Step 4: Smoke test in a browser (manual)**

Open `apps/examples-static/pdp.html` in a browser. Expected:
- Product name, image, review count + average all render
- Stock pill shows "In stock" (or "Out of stock") with appropriate color
- Standard tier is active by default; 3 cards visible (1, 3, 6 unit)
- Click "My Account" pill → grid swaps to my-account variants, no new HTTP request fires
- Click any variant card → it gets `is-selected` highlight
- Click "Add to Cart" → console logs `{tier, path}` of the selected card
- Network tab shows exactly ONE GET to `/public/v1/product/mct-wellness`
- Console has no errors

- [ ] **Step 5: Commit**

```bash
git add apps/examples-static/pdp.html
git commit -m "$(cat <<'EOF'
docs(examples): add PDP demo with tier toggle

Single product (mct-wellness) demo showcasing the "one tier at a time"
pattern partners actually deploy. CSS-only tier toggle between Standard
and My Account — both card sets are pre-bound; the toggle flips a
data-tier attribute on the root, no gh.refresh() needed. Add-to-Cart
button logs the selected SKU + tier.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Redesign `index.html`

**Files:**
- Modify: `apps/examples-static/index.html`
- Read for reference: existing `apps/examples-static/index.html` for the matrix pattern

The landing page now points at the three new demos. Update the hero copy, swap the demo cards (4 → 3), and refresh the capability matrix to match what each new demo actually exercises.

- [ ] **Step 1: Read the current `index.html`**

Run: `cat apps/examples-static/index.html | head -550`

The structural skeleton (hero, demo-grid, matrix-wrap, footer) is sound. The body content (card titles, summaries, matrix rows/columns) needs to change.

- [ ] **Step 2: Replace `apps/examples-static/index.html`**

Replace the file entirely. The full content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hippo Shop SDK — live demos</title>
    <link rel="stylesheet" href="./_shared.css" />
    <style>
      /* ---------- Hero ---------- */

      header.hero { margin-bottom: 48px; }
      h1 { font-size: 38px; line-height: 1.15; }
      .lede {
        font-size: 16px;
        color: var(--gray-600);
        margin-top: 16px;
        max-width: 640px;
      }

      /* ---------- Section headings ---------- */

      .section { margin-top: 56px; }
      h2 {
        font-size: 24px;
        line-height: 1.2;
        margin-bottom: 8px;
      }
      .section-lede {
        font-size: 14px;
        color: var(--gray-600);
        margin-bottom: 24px;
        max-width: 600px;
      }

      /* ---------- Demo cards ---------- */

      .demo-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
      }
      @media (min-width: 720px) {
        .demo-grid { grid-template-columns: 1fr 1fr 1fr; }
      }

      .demo-card {
        background: #fff;
        border: 1px solid var(--gray-200);
        border-radius: 14px;
        padding: 22px 22px 20px;
        box-shadow: var(--shadow-xs);
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }
      .demo-card:hover {
        border-color: var(--blue-200);
        box-shadow: var(--shadow-sm);
      }
      .demo-card .card-eyebrow {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--blue-600);
      }
      .demo-card h3 {
        font-size: 22px;
        line-height: 1.2;
      }
      .demo-card .summary {
        font-size: 14px;
        color: var(--gray-700);
        line-height: 1.55;
      }
      .demo-card ul {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--gray-700);
      }
      .demo-card ul li {
        position: relative;
        padding-left: 18px;
        line-height: 1.5;
      }
      .demo-card ul li::before {
        content: '›';
        position: absolute;
        left: 4px;
        top: -1px;
        color: var(--lime-500);
        font-weight: 700;
        font-size: 14px;
      }
      .demo-card .view {
        margin-top: auto;
        padding-top: 14px;
      }
      .demo-card .view a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--blue-600);
        text-decoration: none;
      }
      .demo-card .view a:hover { color: var(--blue-700); }
      .demo-card .view a::after {
        content: '→';
        font-size: 14px;
        transition: transform 160ms ease;
      }
      .demo-card .view a:hover::after { transform: translateX(2px); }

      /* ---------- Feature matrix ---------- */

      .matrix-wrap {
        border: 1px solid var(--gray-200);
        border-radius: 14px;
        overflow: hidden;
        box-shadow: var(--shadow-xs);
      }
      .matrix {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .matrix thead th {
        background: var(--blue-50);
        font-family: var(--font-sans);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--blue-700);
        padding: 12px 10px;
        text-align: center;
        border-bottom: 1px solid var(--blue-100);
        vertical-align: middle;
      }
      .matrix thead th:first-child {
        text-align: left;
        padding-left: 18px;
        color: var(--gray-700);
        background: var(--gray-50);
        border-bottom: 1px solid var(--gray-200);
        min-width: 240px;
      }
      .matrix tbody td {
        padding: 10px 10px;
        border-bottom: 1px solid var(--gray-100);
        text-align: center;
        vertical-align: middle;
        color: var(--gray-700);
      }
      .matrix tbody td:first-child {
        text-align: left;
        padding-left: 18px;
        color: var(--gray-900);
        font-weight: 500;
        background: var(--gray-50);
        border-right: 1px solid var(--gray-200);
      }
      .matrix tbody tr:last-child td { border-bottom: none; }
      .matrix tbody tr:hover td { background: var(--blue-50); }
      .matrix tbody tr:hover td:first-child { background: var(--blue-100); }
      .check { color: var(--blue-600); font-weight: 700; font-size: 15px; line-height: 1; }
      .dash  { color: var(--gray-300); font-weight: 400; }

      @media (max-width: 640px) {
        .matrix { font-size: 12px; }
        .matrix thead th:first-child { min-width: 140px; }
        .matrix tbody td, .matrix thead th { padding: 8px 6px; }
        .matrix tbody td:first-child { padding-left: 12px; }
        .matrix thead th:first-child { padding-left: 12px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="hero">
        <p class="eyebrow">Hippo Shop SDK</p>
        <h1>Live demos of declarative product binding</h1>
        <p class="lede">
          Three real-world archetype pages — funnel step, offer selector, PDP —
          rendered from real Gundry MD / MCT Wellness data using only HTML
          <code>data-*</code> attributes. Each one mirrors how partners actually
          build on the SDK.
        </p>
      </header>

      <section class="section">
        <p class="section-eyebrow">The demos</p>
        <h2>Three archetypes, all using MCT Wellness data</h2>
        <p class="section-lede">
          Open any file directly in a browser — no build step, no bundler. Each
          demo loads the SDK from <code>api-uat.goldenhippo.io</code> with a
          public test key.
        </p>

        <div class="demo-grid">
          <article class="demo-card">
            <p class="card-eyebrow">Demo 01 · funnel resource</p>
            <h3>Funnel step</h3>
            <p class="summary">
              Single step of a multi-step funnel, with a progress bar built from
              <code>funnel.steps[]</code> and a "Continue to step N" CTA whose
              <code>href</code> is built from the next step's slug.
            </p>
            <ul>
              <li><code>&lt;template data-each="steps"&gt;</code> for the progress bar segments</li>
              <li><code>data-attr-data-stage="kind"</code> for per-step-kind CSS coloring</li>
              <li><code>gh:bindings-ready</code> listener that reads <code>funnel.steps[currentIndex + 1]</code></li>
              <li>Cached <code>window.gh.data.funnel(slug)</code> call from inline JS</li>
            </ul>
            <p class="view"><a href="funnel-step.html">View demo</a></p>
          </article>

          <article class="demo-card">
            <p class="card-eyebrow">Demo 02 · destination resource × 12</p>
            <h3>Offer selector</h3>
            <p class="summary">
              12 destinations on one page (2 flavors × 3 quantities × 2 purchase
              types). Filter pills collapse the 12 down to 3 visible cards.
              Each card's CTA routes to its post-purchase funnel.
            </p>
            <ul>
              <li>12 <code>data-gh-destination</code> resources fetched concurrently (deduped by the SDK)</li>
              <li><code>data-attr-href="funnelSlug"</code> on each card's CTA — no JS for routing</li>
              <li><code>data-if="pricing.price.savings"</code> ribbons on the value-tier cards</li>
              <li>Pill-driven <code>[hidden]</code> toggling — no extra fetches when filters change</li>
            </ul>
            <p class="view"><a href="offer-selector.html">View demo</a></p>
          </article>

          <article class="demo-card">
            <p class="card-eyebrow">Demo 03 · product resource</p>
            <h3>PDP (Product Detail)</h3>
            <p class="summary">
              Single product with a tier toggle (Standard / My Account) and a
              quantity ladder. Tier swap is CSS-only — both tier card sets are
              pre-bound; no <code>gh.refresh()</code> required.
            </p>
            <ul>
              <li><code>data-with="variants.subscription.standardByQuantity.&lt;qty&gt;"</code> for scope narrowing per card</li>
              <li>Per-attribute formatter override (<code>data-attr-format-data-stock</code>)</li>
              <li>Custom <code>savePercent</code> formatter registered via <code>gh.format.register</code></li>
              <li>One product fetch covers six pre-bound variant cards</li>
            </ul>
            <p class="view"><a href="pdp.html">View demo</a></p>
          </article>
        </div>
      </section>

      <section class="section">
        <p class="section-eyebrow">Capability map</p>
        <h2>Feature matrix</h2>
        <p class="section-lede">
          Quick index — find a capability, then jump to whichever demo exercises
          it.
        </p>

        <div class="matrix-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th scope="col">SDK capability</th>
                <th scope="col">Funnel<br />step</th>
                <th scope="col">Offer<br />selector</th>
                <th scope="col">PDP</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Resource binding (<code>data-gh-product / -funnel / -destination</code>)</td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>data-field</code> (text replacement)</td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>data-with</code> (scope narrowing)</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>data-if</code> (conditional render)</td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>&lt;template data-each&gt;</code> (iteration)</td>
                <td><span class="check">✓</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
              </tr>
              <tr>
                <td><code>data-attr-&lt;NAME&gt;</code> (attribute binding)</td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>data-attr-format-&lt;NAME&gt;</code> (per-attribute formatter)</td>
                <td><span class="check">✓</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>currency</code> formatter</td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>number</code> formatter</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>bool</code> formatter</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td>Custom formatter via <code>gh.format.register</code></td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>gh:data-ready</code> event</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>gh:bindings-ready</code> event</td>
                <td><span class="check">✓</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td><code>window.gh.data.&lt;resource&gt;()</code> programmatic call</td>
                <td><span class="check">✓</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
              </tr>
              <tr>
                <td>Quantity-keyed variant lookup (<code>standardByQuantity</code>)</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td>Multi-resource batched fetch</td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
                <td><span class="dash">—</span></td>
              </tr>
              <tr>
                <td>Tier-switching pattern (Standard ↔ My Account)</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
              <tr>
                <td>Alternate-purchase-type comparison (<code>alternatePurchaseTypePrice</code>)</td>
                <td><span class="dash">—</span></td>
                <td><span class="dash">—</span></td>
                <td><span class="check">✓</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer class="demo-footer">
        <p>
          The SDK ships as <code>@goldenhippo/hippo-shop-sdk</code> — see the
          <a href="../../packages/sdk/README.md">SDK README</a> for installation,
          the data model, and the full attribute reference.
        </p>
        <p>
          The publishable key embedded in each demo's <code>&lt;script&gt;</code>
          tag (<code>gh_pk_test_all_…</code>) is a public, scoped test/UAT key —
          it's intentionally checked in and safe to ship in client HTML.
        </p>
        <p>
          Every demo is a single self-contained HTML file: open it directly in
          a browser, no build step required.
        </p>
      </footer>
    </main>
  </body>
</html>
```

- [ ] **Step 3: Verify**

Run: `grep -c "demo-card" apps/examples-static/index.html`
Expected: ≥ 6 (3 cards × 2 references each — `<article class="demo-card">` and one in CSS).

Run: `grep -c '<th scope="col">' apps/examples-static/index.html`
Expected: 4 (one capability column + 3 demo columns).

Run: `grep -n "funnel-steps.html\|destination-detail.html\|product-pricing.html\|variant-grid.html" apps/examples-static/index.html`
Expected: zero matches (no references to deleted files).

- [ ] **Step 4: Smoke test in a browser (manual)**

Open `apps/examples-static/index.html` in a browser. Expected:
- Hero, three demo cards, capability matrix all render correctly
- Click each demo card link → navigates to the new HTML file (which loads without error)
- Matrix has 3 demo columns + 1 capability column, ~18 rows
- No broken links to deleted demos

- [ ] **Step 5: Commit**

```bash
git add apps/examples-static/index.html
git commit -m "$(cat <<'EOF'
docs(examples): redesign landing page for new 3-demo structure

Hero copy + demo grid + feature matrix all updated to point at the
three new archetype demos (funnel-step, offer-selector, pdp). Drops
references to the now-removed variant-grid demo and consolidates
the matrix to 3 columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Delete legacy demo files

**Files:**
- Delete: `apps/examples-static/funnel-steps.html`
- Delete: `apps/examples-static/destination-detail.html`
- Delete: `apps/examples-static/product-pricing.html`
- Delete: `apps/examples-static/variant-grid.html`

These have all been replaced by the new archetype demos. Index no longer references them, so deletion is safe.

- [ ] **Step 1: Confirm no references remain**

Run:
```bash
grep -rn "funnel-steps.html\|destination-detail.html\|product-pricing.html\|variant-grid.html" apps/ docs/ packages/ 2>/dev/null | grep -v "\.planning\|node_modules\|dist\|.git/"
```

Expected: only references inside `docs/superpowers/` (in the spec and this plan, which is acceptable since they're historical documentation).

If any external/non-planning code still references these files, **STOP** and report. The deletion may break a link.

- [ ] **Step 2: Delete the four files**

```bash
rm apps/examples-static/funnel-steps.html
rm apps/examples-static/destination-detail.html
rm apps/examples-static/product-pricing.html
rm apps/examples-static/variant-grid.html
```

- [ ] **Step 3: Verify**

Run: `ls apps/examples-static/`
Expected output (one per line):
```
_shared.css
funnel-step.html
index.html
offer-selector.html
package.json
pdp.html
project.json
```

(`package.json` and `project.json` are Nx config — leave them alone.)

- [ ] **Step 4: Commit**

```bash
git add -A apps/examples-static/
git commit -m "$(cat <<'EOF'
docs(examples): remove legacy demos replaced by archetype set

Removes funnel-steps.html, destination-detail.html, product-pricing.html,
and variant-grid.html. All four are superseded by the three new
archetype demos plus the redesigned landing page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification

**Files:**
- Possibly modify: any of the four demos, if verification surfaces issues

- [ ] **Step 1: File set sanity**

Run: `ls apps/examples-static/*.html apps/examples-static/_shared.css 2>/dev/null`
Expected:
```
apps/examples-static/_shared.css
apps/examples-static/funnel-step.html
apps/examples-static/index.html
apps/examples-static/offer-selector.html
apps/examples-static/pdp.html
```

- [ ] **Step 2: No deprecated array paths anywhere**

Run:
```bash
grep -rnE 'variants\.(subscription|oneTime)\.(standard|myAccount)\b(?![-A-Za-z])' apps/examples-static/ | grep -v "\.css:"
```

Expected: zero matches in HTML files. The deprecated `variants.<purchase>.<tier>` array path must not appear. (Hits in `_shared.css` are impossible; the grep is defensive.)

If any matches surface, locate the offending file and replace with `<tier>List` or `<tier>ByQuantity`. Re-run the grep until clean.

- [ ] **Step 3: All four HTML files load `_shared.css`**

Run: `grep -l '_shared\.css' apps/examples-static/*.html`
Expected: all four files (index.html, funnel-step.html, offer-selector.html, pdp.html).

- [ ] **Step 4: All four HTML files load the SDK from `api-uat.goldenhippo.io`**

Run: `grep -c 'src="https://api-uat\.goldenhippo\.io/sdk/v1/gh\.js"' apps/examples-static/*.html`
Expected: each demo HTML except `index.html` has exactly 1 match. (`index.html` is pure documentation, no SDK script.)

- [ ] **Step 5: No real-brand sample data outside Gundry MD / MCT Wellness**

Run: `grep -nEi "bio.complete|olive.oil" apps/examples-static/*.html`
Expected: zero matches (the spec authorized Gundry MD + MCT Wellness only; Bio Complete 3 and Olive Oil were used in the prior demos but are not in the new set).

- [ ] **Step 6: Browser smoke test all four pages**

Manual step. Open each file in a browser:

1. `apps/examples-static/index.html` → renders hero + 3 cards + matrix. All card links land on valid pages.
2. `apps/examples-static/funnel-step.html` → progress bar + step content + Continue button render with bound data. Continue href ≠ "#".
3. `apps/examples-static/offer-selector.html` → 3 cards visible at default filters. Toggling pills changes which 3 are visible. Each visible CTA `href` is set.
4. `apps/examples-static/pdp.html` → product image + name + reviews + 3 variant cards render. Tier toggle swaps variant grid without new HTTP requests. Add-to-cart logs to console.

Open DevTools Console on each → **no red errors**.

- [ ] **Step 7: Feature-coverage check**

Spot-check the SDK feature coverage from the spec's acceptance criteria. For each row of the index.html capability matrix, confirm the ✓-marked demo actually exercises that feature (open the file and grep for the pattern).

If any item is missing, identify which demo should have it, add it, and re-run smoke tests.

- [ ] **Step 8: Final commit (only if Step 2/3/7 surfaced fixes)**

If any of the earlier steps surfaced fixes that weren't already committed by their respective tasks:

```bash
git add -A apps/examples-static/
git commit -m "$(cat <<'EOF'
docs(examples): final-pass cleanup on demo set

Touchups from the verification pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Otherwise skip this step.

---

## Spec coverage cross-reference

| Spec requirement | Task(s) |
|---|---|
| `_shared.css` extracted palette + typography + base classes | 1 |
| `funnel-step.html` with progress bar + Continue CTA | 2 |
| Hardcoded `currentIndex = 2` with comment | 2 |
| Funnel-step uses `<template data-each="steps">` | 2 |
| `data-attr-data-stage="kind"` per progress segment | 2 |
| `offer-selector.html` with 12 destinations | 3 |
| Flavor + purchase-type filter rows | 3 |
| Each card CTA bound via `data-attr-href="funnelSlug"` | 3 |
| "Best Value" ribbon via `data-if="pricing.price.savings"` | 3 |
| `pdp.html` with tier toggle (CSS-only) | 4 |
| Quantity ladder via `<tier>ByQuantity.<qty>` | 4 |
| Stock pill with per-attribute formatter override | 4 |
| Custom `savePercent` formatter registered | 4 |
| `index.html` updated to 3-demo structure | 5 |
| Capability matrix refreshed to 3 columns | 5 |
| Legacy files deleted | 6 |
| All demos use `_shared.css` | 1, 7 |
| No deprecated `variants.<purchase>.<tier>` paths | 4, 7 |
| Browser smoke-tested without console errors | 7 |
| Generic sample data — Gundry MD / MCT Wellness only | 7 |

All 19 spec requirements are covered by one of the seven tasks.
