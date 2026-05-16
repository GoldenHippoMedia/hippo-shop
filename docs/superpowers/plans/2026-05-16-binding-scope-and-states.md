# Declarative Binding Scope + Resource States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new declarative HTML attributes to the SDK: `data-with="path"` (narrows binding scope; hides on miss) and `data-when="loaded|loading|failed"` (shows element based on closest resource's lifecycle). Together they complete the declarative miss-handling story before publish.

**Architecture:** `data-with` is a pure walker change in `packages/sdk/src/bindings.ts` — slot it into `walk()` after resource-context acquisition and before `data-if`. `data-when` requires (a) a new `ResourceState` type and optional `resourceStates` field on `ApplyBindingsOptions`, (b) per-element resource-key tracking inside `walk()`, (c) two-pass binding in `GhRuntime.bind()` so loading skeletons show before fetches settle, and (d) state transitions in `loadOne()` (loading → loaded / failed).

**Tech Stack:** TypeScript, pnpm + nx monorepo, vitest (jsdom) for SDK tests, changesets for releases.

**Spec:** `docs/superpowers/specs/2026-05-16-binding-scope-and-states-design.md`

---

## File Structure

**Created:**
- `.changeset/binding-scope-and-states.md` — release note (Task 12).

**Modified:**
- `packages/sdk/src/bindings.ts` — top-of-file attribute comment, `ApplyBindingsOptions` interface, `BindContext` interface, `walk()` body, new exported `ResourceState` type.
- `packages/sdk/src/index.ts` — re-export `ResourceState` from barrel.
- `packages/sdk/src/runtime.ts` — new `resourceStates` map, `markLoading()` helper, state writes in `loadOne()`, two-pass binding in `bind()`, expanded MutationObserver attribute filter, clear in `refresh()`.
- `packages/sdk/test/bindings.spec.ts` — new `applyBindings — data-with` describe block, new `applyBindings — data-when` describe block.
- `packages/sdk/test/runtime.spec.ts` — new tests for two-pass binding + state transitions.
- `apps/examples-static/variant-grid.html` — refactor "Featured packages" cards to use `data-with`.
- `apps/examples-static/product-pricing.html` — wrap card body with `data-when="loaded"` skeleton.
- `README.md` (root) — short note in the SDK section about the two new attributes.
- `packages/sdk/README.md` — paragraphs documenting `data-with` and `data-when` with code samples.

---

## Task 1: Write failing tests for `data-with`

**Files:**
- Modify: `packages/sdk/test/bindings.spec.ts`

- [ ] **Step 1: Append a new describe block to `bindings.spec.ts`**

Locate the closing `})` at the very end of the file (line ~380). Just BEFORE it, add the following describe block:

```ts
describe('applyBindings — data-with', () => {
  const formatters = new FormatRegistry();

  function setup(html: string, data: unknown): void {
    document.body.innerHTML = html;
    applyBindings(document, {
      formatters,
      resources: new Map([['product:p1', data]]),
    });
  }

  it('narrows scope so descendants can use relative paths', () => {
    setup(
      `<article data-gh-product="p1">
         <div data-with="variants.subscription.standardByQuantity.6">
           <span id="q" data-field="quantity"></span>
           <span id="p" data-field="price"></span>
         </div>
       </article>`,
      {
        variants: {
          subscription: {
            standardByQuantity: {
              '6': { quantity: 6, price: 169.95 },
            },
          },
        },
      },
    );
    expect(document.getElementById('q')?.textContent).toBe('6');
    expect(document.getElementById('p')?.textContent).toBe('169.95');
  });

  it('hides the element and skips the subtree when the path is missing', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="card" data-with="variants.subscription.standardByQuantity.7">
           <span id="p" data-field="price">UNRENDERED</span>
         </div>
       </article>`,
      {
        variants: {
          subscription: {
            standardByQuantity: { '6': { quantity: 6, price: 169.95 } },
          },
        },
      },
    );
    expect((document.getElementById('card') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('p')?.textContent).toBe('UNRENDERED');
  });

  it('hides on null and on a falsy primitive that resolves to null', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="card" data-with="nullish">child</div>
       </article>`,
      { nullish: null },
    );
    expect((document.getElementById('card') as HTMLElement).style.display).toBe('none');
  });

  it('supports nested data-with — inner path is relative to outer narrowed scope', () => {
    setup(
      `<article data-gh-product="p1">
         <div data-with="variants.subscription">
           <div data-with="standardByQuantity.6">
             <span id="p" data-field="price"></span>
           </div>
         </div>
       </article>`,
      {
        variants: {
          subscription: {
            standardByQuantity: { '6': { price: 169.95 } },
          },
        },
      },
    );
    expect(document.getElementById('p')?.textContent).toBe('169.95');
  });

  it('evaluates data-with before data-if so data-if path is relative to narrowed scope', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="card" data-with="variants.subscription.standardByQuantity.6"
              data-if="savings">
           <span id="s" data-field="savings"></span>
         </div>
       </article>`,
      {
        variants: {
          subscription: {
            standardByQuantity: { '6': { savings: 25 } },
          },
        },
      },
    );
    expect((document.getElementById('card') as HTMLElement).style.display).not.toBe('none');
    expect(document.getElementById('s')?.textContent).toBe('25');
  });

  it('scopes loop body when data-with is on the <template data-each> element', () => {
    setup(
      `<article data-gh-product="p1">
         <ul>
           <template data-each="standardList" data-with="variants.subscription">
             <li class="row" data-field="sku"></li>
           </template>
         </ul>
       </article>`,
      {
        variants: {
          subscription: {
            standardList: [{ sku: 'A-3' }, { sku: 'A-6' }],
          },
        },
      },
    );
    const rows = Array.from(document.querySelectorAll('.row')).map((el) => el.textContent);
    expect(rows).toEqual(['A-3', 'A-6']);
  });

  it('does nothing when there is no resource context yet', () => {
    document.body.innerHTML = `<div id="card" data-with="anything">child</div>`;
    applyBindings(document, { formatters, resources: new Map() });
    expect((document.getElementById('card') as HTMLElement).style.display).not.toBe('none');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts -t "data-with"
```

Expected: 7 tests fail (most likely because `data-with` is unrecognized — the element renders without narrowing, so child bindings either resolve incorrectly or leave placeholders).

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/sdk/test/bindings.spec.ts
git commit -m "test(sdk): add failing tests for data-with"
```

---

## Task 2: Implement `data-with` in `walk()`

**Files:**
- Modify: `packages/sdk/src/bindings.ts`

- [ ] **Step 1: Update the top-of-file attribute comment**

In `packages/sdk/src/bindings.ts`, find the block listing supported attributes (lines 8-21). Add the `data-with` line right after `data-gh-funnel`:

```ts
 *   data-gh-product="slug"        Sets the product context for the element + descendants.
 *   data-gh-destination="slug"    Sets the destination context.
 *   data-gh-funnel="slug"         Sets the funnel context.
 *   data-with="path.to.object"    Narrows the binding scope for descendants; hides on miss.
 *   data-field="path.to.value"    Replaces textContent with the resolved value.
```

(Leave the rest of the comment block unchanged for now — `data-when` gets added in a later task.)

- [ ] **Step 2: Add the `data-with` evaluation block to `walk()`**

In the same file, find the `walk()` function (starts around line 104). Just AFTER the resource-acquisition for-loop and just BEFORE the `// Conditionals first` comment, insert:

```ts
  // data-with narrows scope before any other attribute on this element
  // evaluates. If the path resolves to null/undefined, hide the subtree —
  // partner-facing version of "if this lookup found nothing, don't render
  // dependent content". Evaluates after resource acquisition so the
  // narrowed scope can be relative to the resource's root.
  const withPath = el.getAttribute('data-with');
  if (withPath !== null) {
    if (!nextCtx) return; // No data → can't evaluate; leave alone (matches data-if).
    const scoped = getByPath(nextCtx.data, withPath);
    if (scoped == null) {
      setHidden(el, true);
      return;
    }
    setHidden(el, false);
    nextCtx = { data: scoped, formatters: nextCtx.formatters };
  }
```

Note: Task 4 will later expand `BindContext` to carry an optional `resourceKey`. The spread-with-replace approach above (`{ data: scoped, formatters: nextCtx.formatters }`) drops the resourceKey from the narrowed scope, which is intentional: `data-when` only meaningfully applies to the closest UNRESOLVED resource ancestor, not to a narrowed-via-data-with sub-object. Task 4 will revisit this with the full type in scope.

- [ ] **Step 3: Run the data-with tests to verify they pass**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts -t "data-with"
```

Expected: all 7 tests PASS.

- [ ] **Step 4: Run the full SDK test suite to confirm no regressions**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/bindings.ts
git commit -m "feat(sdk): add data-with for declarative binding scope

data-with=\"path\" narrows the binding scope for the element and its
descendants. If the path resolves to null/undefined the element hides
via setHidden and the subtree is skipped — partners get miss-handling
without writing JS. Evaluates before data-if/-not so conditionals can
use paths relative to the narrowed scope."
```

---

## Task 3: Refactor variant-grid demo "Featured packages" to use `data-with`

**Files:**
- Modify: `apps/examples-static/variant-grid.html`

- [ ] **Step 1: Locate the "Featured packages" section**

Open `apps/examples-static/variant-grid.html` and find the three cards in the "Featured packages" section. Each card currently repeats `variants.subscription.standardByQuantity.<qty>` on every `data-field` and `data-if`. Look for `class="tier featured"` to locate the cards.

- [ ] **Step 2: Wrap each featured card in `data-with` and switch descendant paths to be relative**

Each featured card currently has the pattern (paths abbreviated for clarity):

```html
<article class="tier featured"
         data-if="variants.subscription.standardByQuantity.6">
  <p class="qty"><span data-field="variants.subscription.standardByQuantity.6.quantity">—</span></p>
  <p class="price">
    <span data-field="variants.subscription.standardByQuantity.6.price"
          data-format="currency:USD:en-US">$0.00</span>
  </p>
  <p data-if="variants.subscription.standardByQuantity.6.savings" class="savings">
    Save <span data-field="variants.subscription.standardByQuantity.6.savings"
               data-format="currency:USD:en-US">$0</span>
  </p>
  <p data-if="variants.subscription.standardByQuantity.6.defaultFrequency" class="cadence">
    Renews <span data-field="variants.subscription.standardByQuantity.6.defaultFrequency.label">—</span>
  </p>
</article>
```

Rewrite each featured card to use `data-with`:

```html
<article class="tier featured" data-with="variants.subscription.standardByQuantity.6">
  <p class="qty"><span data-field="quantity">—</span></p>
  <p class="price">
    <span data-field="price" data-format="currency:USD:en-US">$0.00</span>
  </p>
  <p data-if="savings" class="savings">
    Save <span data-field="savings" data-format="currency:USD:en-US">$0</span>
  </p>
  <p data-if="defaultFrequency" class="cadence">
    Renews <span data-field="defaultFrequency.label">—</span>
  </p>
</article>
```

Repeat the same pattern for the other two featured cards (likely qty `1` and `3` — preserve the existing quantities). The `data-if` wrapper on the article is replaced by `data-with` (which hides the article when the quantity is absent — same end effect, less ceremony).

Do the same for the my-account-byQuantity card if it follows the same pattern (the demo has one earlier).

- [ ] **Step 3: Open the file in a browser as a sanity check**

Run:
```bash
pnpm --filter examples-static dev 2>/dev/null || python3 -m http.server --directory apps/examples-static 8765 >/dev/null 2>&1 &
```

(If neither works, open `apps/examples-static/variant-grid.html` directly with `open` — it doesn't need a server because the SDK is loaded from a CDN.)

Visually confirm:
- The three featured cards still render with prices.
- If a quantity doesn't exist on the demo product (e.g., if the catalog only offers 3 and 6), the missing card is hidden cleanly.
- No `[object Object]` text leaks through.

If you cannot run a browser, skip the visual check; the test suite covers the underlying mechanic.

Stop the server if you started one:
```bash
lsof -ti tcp:8765 | xargs kill 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add apps/examples-static/variant-grid.html
git commit -m "docs(examples): use data-with for featured variant cards

Each featured card now wraps in data-with=variants.subscription.
standardByQuantity.<qty>, so its descendants use relative paths
(quantity, price, savings, defaultFrequency.label). Drops ~30 lines
of duplicated path text and hides cleanly when a quantity is absent."
```

---

## Task 4: Add `ResourceState` type + optional `resourceStates` to `ApplyBindingsOptions`

**Files:**
- Modify: `packages/sdk/src/bindings.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Add the `ResourceState` type and extend `ApplyBindingsOptions`**

In `packages/sdk/src/bindings.ts`, find `ApplyBindingsOptions` (around line 80):

```ts
export interface ApplyBindingsOptions {
  formatters: FormatRegistry;
  resources: Map<string, unknown>;
}
```

Replace with:

```ts
export type ResourceState = 'loading' | 'loaded' | 'failed';

export interface ApplyBindingsOptions {
  formatters: FormatRegistry;
  resources: Map<string, unknown>;
  /**
   * Per-resource lifecycle state, keyed identically to `resources`
   * (e.g. `"product:bio-complete-3"`). Optional — when omitted, all
   * resources are treated as having no known state, which means
   * `data-when="loading"` shows by default for elements with a resource
   * ancestor.
   */
  resourceStates?: Map<string, ResourceState>;
}
```

- [ ] **Step 2: Also expand the `BindContext` interface to carry the resource key**

In the same file, find `BindContext` (around line 76):

```ts
interface BindContext {
  data: unknown;
  formatters: FormatRegistry;
}
```

Replace with:

```ts
interface BindContext {
  data: unknown;
  formatters: FormatRegistry;
  /**
   * Cache key (e.g. `"product:bio-complete-3"`) for the closest resource
   * ancestor. Carried so `data-when` can look up the resource's lifecycle
   * state without re-walking the DOM.
   */
  resourceKey?: string;
}
```

- [ ] **Step 3: Update the resource acquisition loop in `walk()` to record the key without early-returning**

In `walk()` (around lines 105-118), the existing loop is:

```ts
for (const kind of RESOURCE_KINDS) {
  const slug = el.getAttribute(RESOURCE_ATTR[kind]);
  if (!slug) continue;
  const data = opts.resources.get(`${kind}:${slug}`);
  if (data === undefined) {
    // Resource not loaded — defer the subtree until a later bind pass.
    return;
  }
  nextCtx = { data, formatters: opts.formatters };
  break;
}
```

This needs to (a) compute the key, (b) include it in `nextCtx`, and (c) allow loading state to proceed even when `data` is undefined (so `data-when="loading"` can fire). Replace with:

```ts
for (const kind of RESOURCE_KINDS) {
  const slug = el.getAttribute(RESOURCE_ATTR[kind]);
  if (!slug) continue;
  const key = `${kind}:${slug}`;
  const data = opts.resources.get(key);
  // Always record the key (so data-when can resolve state); data may be
  // undefined while the resource is still loading.
  nextCtx = { data, formatters: opts.formatters, resourceKey: key };
  break;
}
```

- [ ] **Step 4: Gate data-dependent operations on a `hasData` check**

Removing the early-return above means walk() now descends into subtrees with `data === undefined` (during the pre-fetch pass). For backward compatibility, the data-dependent operations (`data-with`, `data-if`, `data-if-not`, `<template data-each>`, field/attr bindings) must be gated so they only fire when data is actually present. Otherwise `data-if="outOfStock"` on a still-loading product would hide the element (because `getByPath(undefined, 'outOfStock')` returns undefined, falsy).

Restructure `walk()` after Task 2's `data-with` block and the existing conditional/loop/field/attr blocks so they're all inside a `hasData` gate. The structure of `walk()` after this task should match this exact shape:

```ts
function walk(el: Element, ctx: BindContext | null, opts: ApplyBindingsOptions): void {
  // Acquire context if this element specifies a resource.
  let nextCtx = ctx;
  for (const kind of RESOURCE_KINDS) {
    const slug = el.getAttribute(RESOURCE_ATTR[kind]);
    if (!slug) continue;
    const key = `${kind}:${slug}`;
    const data = opts.resources.get(key);
    nextCtx = { data, formatters: opts.formatters, resourceKey: key };
    break;
  }

  // data-when fires regardless of data presence — it only needs resourceKey
  // and the resourceStates map. (Implementation lands in Task 6.)

  // hasData gate — only the bindings that need data run when data is present.
  const hasData = nextCtx != null && nextCtx.data !== undefined;

  if (hasData) {
    // data-with narrows scope.
    const withPath = el.getAttribute('data-with');
    if (withPath !== null) {
      const scoped = getByPath(nextCtx!.data, withPath);
      if (scoped == null) {
        setHidden(el, true);
        return;
      }
      setHidden(el, false);
      nextCtx = { data: scoped, formatters: nextCtx!.formatters, resourceKey: nextCtx!.resourceKey };
    }

    // Conditionals.
    const ifPath = el.getAttribute('data-if');
    if (ifPath !== null) {
      const v = getByPath(nextCtx!.data, ifPath);
      setHidden(el, !v);
      if (!v) return;
    }
    const ifNotPath = el.getAttribute('data-if-not');
    if (ifNotPath !== null) {
      const v = getByPath(nextCtx!.data, ifNotPath);
      setHidden(el, Boolean(v));
      if (v) return;
    }

    // Loop expansion.
    if (el instanceof HTMLTemplateElement && el.hasAttribute('data-each')) {
      expandLoop(el, nextCtx!, opts);
      return;
    }

    // Field + attribute bindings.
    applyFieldBinding(el, nextCtx!);
    applyAttrBindings(el, nextCtx!);
  }

  // Recurse into children (skipped for <template>; loop body is processed inside expandLoop).
  if (!(el instanceof HTMLTemplateElement)) {
    for (const child of Array.from(el.children)) walk(child, nextCtx, opts);
  }
}
```

Key points about this restructure:
- The `data-with` block from Task 2 moves inside `hasData`. Its behavior is unchanged when data IS present.
- The existing `data-if` / `data-if-not` / `data-each` / field / attr blocks move inside `hasData`. When data is undefined, they're skipped — preserving the pre-2.2 behavior of "untouched subtree during loading."
- Recursion happens **outside** the `hasData` gate so that descendants with their own resource contexts (or `data-when` annotations) still get processed.
- Task 6 will insert the `data-when` block between the resource for-loop and the `hasData` check.

Note: this is a non-trivial restructure but it preserves all currently-tested behavior — the existing `applyBindings` test cases all operate on loaded resources, so the `hasData = true` branch runs and the behavior is identical.

- [ ] **Step 5: Re-export `ResourceState` from the SDK barrel**

In `packages/sdk/src/index.ts`, find the existing `bindings` export:

```ts
export { applyBindings, collectResources } from './bindings';
```

Replace with:

```ts
export { applyBindings, collectResources, type ResourceState } from './bindings';
```

- [ ] **Step 6: Run the full SDK suite**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk typecheck && pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all tests pass. The `hasData` gate preserves backward compatibility for every existing test (they all operate on loaded resources).

If a test fails, most likely cause: a test that exercised an unresolved-resource scenario expecting early-return behavior. The new behavior (descend but skip data-dependent ops) is semantically equivalent for any data-bound attribute. Investigate the failure before continuing.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/bindings.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): add ResourceState type and resourceKey to bind context

Prepares the binding walker for data-when by:
- Exporting ResourceState ('loading' | 'loaded' | 'failed') as a public type.
- Adding optional resourceStates field to ApplyBindingsOptions (callers
  who don't track state can omit it).
- Recording the closest resource ancestor's cache key on BindContext so
  per-element data-when lookups don't re-walk the DOM.
- No longer early-returning on unresolved resources — subtrees descend
  with data: undefined, which lets data-when='loading' fire while leaving
  field/attr bindings to leave placeholders in place as before."
```

---

## Task 5: Write failing tests for `data-when`

**Files:**
- Modify: `packages/sdk/test/bindings.spec.ts`

- [ ] **Step 1: Append a new describe block to the file**

Locate the closing `})` at the very end of `packages/sdk/test/bindings.spec.ts`. Just BEFORE it (and after the `data-with` block from Task 1), add:

```ts
describe('applyBindings — data-when', () => {
  const formatters = new FormatRegistry();

  function setup(
    html: string,
    states: Record<string, 'loading' | 'loaded' | 'failed'> = {},
    data?: unknown,
  ): void {
    document.body.innerHTML = html;
    const resources = new Map<string, unknown>();
    if (data !== undefined) resources.set('product:p1', data);
    applyBindings(document, {
      formatters,
      resources,
      resourceStates: new Map(Object.entries(states)),
    });
  }

  it('shows data-when="loaded" only when the resource is loaded', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="content" data-when="loaded"><span data-field="name"></span></div>
       </article>`,
      { 'product:p1': 'loaded' },
      { name: 'Bio Complete 3' },
    );
    expect((document.getElementById('content') as HTMLElement).style.display).not.toBe('none');
  });

  it('hides data-when="loaded" while loading', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="content" data-when="loaded">x</div>
       </article>`,
      { 'product:p1': 'loading' },
    );
    expect((document.getElementById('content') as HTMLElement).style.display).toBe('none');
  });

  it('shows data-when="loading" while loading and hides when loaded', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="skel" data-when="loading">Loading…</div>
       </article>`,
      { 'product:p1': 'loading' },
    );
    expect((document.getElementById('skel') as HTMLElement).style.display).not.toBe('none');

    // Now re-bind with state changed to loaded.
    document.body.innerHTML = `<article data-gh-product="p1">
      <div id="skel" data-when="loading">Loading…</div></article>`;
    applyBindings(document, {
      formatters,
      resources: new Map([['product:p1', { name: 'X' }]]),
      resourceStates: new Map([['product:p1', 'loaded']]),
    });
    expect((document.getElementById('skel') as HTMLElement).style.display).toBe('none');
  });

  it('shows data-when="failed" only after a failed fetch', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="err" data-when="failed">Couldn't load.</div>
       </article>`,
      { 'product:p1': 'failed' },
    );
    expect((document.getElementById('err') as HTMLElement).style.display).not.toBe('none');
  });

  it('defaults absent state to "loading" so skeletons show before any fetch attempt', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="skel" data-when="loading">Loading…</div>
         <div id="content" data-when="loaded">content</div>
       </article>`,
      {}, // no state set
    );
    expect((document.getElementById('skel') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('content') as HTMLElement).style.display).toBe('none');
  });

  it('stacks with data-with: scope only narrows when state matches', () => {
    setup(
      `<article data-gh-product="p1">
         <div id="card" data-when="loaded" data-with="variants.subscription.standardByQuantity.6">
           <span id="p" data-field="price">PLACEHOLDER</span>
         </div>
       </article>`,
      { 'product:p1': 'loading' },
    );
    // Loading state: data-when hides the element; data-with never runs.
    expect((document.getElementById('card') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('p')?.textContent).toBe('PLACEHOLDER');
  });

  it('leaves the element alone when there is no resource ancestor', () => {
    document.body.innerHTML = `<div id="orphan" data-when="loaded">x</div>`;
    applyBindings(document, {
      formatters,
      resources: new Map(),
      resourceStates: new Map(),
    });
    expect((document.getElementById('orphan') as HTMLElement).style.display).not.toBe('none');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts -t "data-when"
```

Expected: most of the 7 tests FAIL (the walker currently ignores `data-when`, so elements either always show or behave unpredictably). Pre-existing tests should still pass.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/sdk/test/bindings.spec.ts
git commit -m "test(sdk): add failing tests for data-when"
```

---

## Task 6: Implement `data-when` in `walk()`

**Files:**
- Modify: `packages/sdk/src/bindings.ts`

- [ ] **Step 1: Update the top-of-file attribute comment**

In `packages/sdk/src/bindings.ts`, update the supported-attributes block to include `data-when`:

```ts
 *   data-with="path.to.object"    Narrows the binding scope for descendants; hides on miss.
 *   data-when="loaded|loading|failed"  Shows only when the closest resource is in that state.
 *   data-field="path.to.value"    Replaces textContent with the resolved value.
```

- [ ] **Step 2: Add the `data-when` block to `walk()` between the resource for-loop and the `hasData` gate**

In `walk()`, the structure after Task 4 looks like:

```ts
// Resource acquisition for-loop.
for (const kind of RESOURCE_KINDS) { ... }

// (data-when goes here.)

const hasData = nextCtx != null && nextCtx.data !== undefined;
if (hasData) { /* data-with, data-if, data-each, field, attr */ }
```

Insert this immediately before the `hasData` gate:

```ts
  // data-when checks the closest resource ancestor's lifecycle state.
  // Cheap state check before any path resolution; fires whether or not
  // the resource has loaded yet so partners can show skeletons immediately.
  const whenState = el.getAttribute('data-when');
  if (whenState !== null) {
    if (!nextCtx?.resourceKey) return; // No resource ancestor → leave alone (consistent with data-if).
    const states = opts.resourceStates;
    const actual = states?.get(nextCtx.resourceKey) ?? 'loading';
    const shouldShow = actual === whenState;
    setHidden(el, !shouldShow);
    if (!shouldShow) return;
  }
```

The placement is critical: data-when MUST be outside the `hasData` gate (because it works during loading when `data` is undefined), and it must come AFTER the resource for-loop (it depends on `nextCtx.resourceKey`).

- [ ] **Step 3: Run the data-when tests to verify they pass**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/bindings.spec.ts -t "data-when"
```

Expected: all 7 tests PASS.

- [ ] **Step 4: Run the full SDK test suite to confirm no regressions**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/bindings.ts
git commit -m "feat(sdk): add data-when for declarative resource-state UI

data-when='loaded'|'loading'|'failed' shows the element only when the
closest resource ancestor is in the named lifecycle state. Evaluates
before data-with so the cheap state check short-circuits before path
resolution. Absent state defaults to 'loading' so partners' skeletons
show before any fetch begins."
```

---

## Task 7: Write failing tests for runtime two-pass binding

**Files:**
- Modify: `packages/sdk/test/runtime.spec.ts`

- [ ] **Step 1: Add tests for state tracking and two-pass binding**

Open `packages/sdk/test/runtime.spec.ts` and read the current structure. Then append the following describe block at the bottom of the file (before the file-level closing line):

```ts
describe('GhRuntime — resource state tracking', () => {
  it('marks resources as loading before the fetch resolves and applies bindings once at that point', async () => {
    const client = freshClient();
    // Resolve the product slowly so we can observe the loading state.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(
          () => resolve(new Response(JSON.stringify(PRODUCT), { status: 200 })),
          20,
        );
      }) as Promise<Response>,
    );

    document.body.innerHTML = `
      <article data-gh-product="bio-complete-3">
        <div id="skel" data-when="loading">loading...</div>
        <div id="content" data-when="loaded"><span data-field="name"></span></div>
      </article>
    `;
    const runtime = new GhRuntime({ logger: createLogger(false), client });
    const bindPromise = runtime.bind(document);

    // Synchronously after bind() starts: skeleton should be visible, content hidden.
    // The pre-fetch pass runs synchronously after the first await Promise.all if any
    // fetches are needed. With setTimeout(20), we can microtask-yield to observe.
    await Promise.resolve();
    await Promise.resolve();
    expect((document.getElementById('skel') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('content') as HTMLElement).style.display).toBe('none');

    // Wait for the fetch to settle.
    await bindPromise;
    expect((document.getElementById('skel') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('content') as HTMLElement).style.display).not.toBe('none');
    expect(document.querySelector('#content span')?.textContent).toBe(PRODUCT.name);

    fetchSpy.mockRestore();
  });

  it('marks the resource as failed when fetch rejects', async () => {
    const client = freshClient();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"code":"not_found","message":"x"}', { status: 404 }),
    );

    document.body.innerHTML = `
      <article data-gh-product="bio-complete-3">
        <div id="err" data-when="failed">Couldn't load.</div>
      </article>
    `;
    const runtime = new GhRuntime({ logger: createLogger(false), client });
    await runtime.bind(document);
    expect((document.getElementById('err') as HTMLElement).style.display).not.toBe('none');
  });

  it('refresh() clears resource state and re-runs the loading transition', async () => {
    const client = freshClient();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(PRODUCT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(PRODUCT), { status: 200 }));

    document.body.innerHTML = `
      <article data-gh-product="bio-complete-3">
        <div id="content" data-when="loaded"><span data-field="name"></span></div>
      </article>
    `;
    const runtime = new GhRuntime({ logger: createLogger(false), client });
    await runtime.bind(document);
    expect((document.getElementById('content') as HTMLElement).style.display).not.toBe('none');

    // Calling refresh() must clear resourceStates as well as resources.
    await runtime.refresh();
    expect((document.getElementById('content') as HTMLElement).style.display).not.toBe('none');
  });
});
```

Note: the existing test file already imports `vi`, `GhRuntime`, `freshClient`, `PRODUCT`, `createLogger`, and `describe/it/expect`. Verify these imports are present at the top of the file; if `freshClient` is missing from the imports, add it (it's exported / defined locally — read the top of `runtime.spec.ts` to confirm).

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts -t "resource state tracking"
```

Expected: all 3 tests FAIL. Most likely reasons:
- `runtime.bind()` doesn't expose a `resourceStates` map yet, so `data-when` evaluates against an empty/missing state map and the runtime doesn't perform a pre-fetch bind pass.
- The default "loading" state isn't set when fetches start, so the skeleton might still show after the fetch completes (or vice versa).

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/sdk/test/runtime.spec.ts
git commit -m "test(sdk): add failing tests for runtime resource state tracking"
```

---

## Task 8: Implement two-pass binding + state tracking in `GhRuntime`

**Files:**
- Modify: `packages/sdk/src/runtime.ts`

- [ ] **Step 1: Add the resource-state map and the `markLoading` helper**

Open `packages/sdk/src/runtime.ts`. Find the existing private field declarations on the class (lines ~27-34):

```ts
readonly formatters = new FormatRegistry();
private readonly resources = new Map<string, unknown>();
private readonly inFlight = new Map<string, Promise<void>>();
private observer: MutationObserver | null = null;
private rebindScheduled = false;
private bindingsReadyFired = false;
private readonly doc: Document;
private readonly win: Window;
```

Just after the `resources` and `inFlight` map declarations, add:

```ts
private readonly resourceStates = new Map<string, 'loading' | 'loaded' | 'failed'>();
```

Also add the import for `ResourceState` near the top (in the existing `bindings` import line):

```ts
import { applyBindings, collectResources, RESOURCE_ATTR, RESOURCE_KINDS, type ResourceState } from './bindings';
```

Use the imported type in the map declaration for sharper typing:

```ts
private readonly resourceStates = new Map<string, ResourceState>();
```

- [ ] **Step 2: Update `bind()` to do a pre-fetch pass when there are unloaded resources**

Find the existing `bind()` method (lines ~46-59):

```ts
async bind(root: ParentNode | Element = this.doc): Promise<void> {
  const refs = collectResources(root);
  if (refs.length > 0) {
    await Promise.all(refs.map(ref => this.loadOne(ref.kind, ref.slug)));
  }
  applyBindings(root instanceof Document ? root : (root as Element), {
    formatters: this.formatters,
    resources: this.resources,
  });
  if (!this.bindingsReadyFired) {
    this.bindingsReadyFired = true;
    this.win.dispatchEvent(new Event('gh:bindings-ready'));
  }
}
```

Replace with:

```ts
async bind(root: ParentNode | Element = this.doc): Promise<void> {
  const refs = collectResources(root);
  const target = root instanceof Document ? root : (root as Element);

  if (refs.length > 0) {
    // Pre-fetch pass: mark all unloaded resources as 'loading' and apply bindings
    // immediately so data-when="loading" elements can show their skeletons before
    // the fetch settles.
    let needsPrePass = false;
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.slug}`;
      if (!this.resources.has(key) && this.resourceStates.get(key) !== 'loading') {
        this.resourceStates.set(key, 'loading');
        needsPrePass = true;
      }
    }
    if (needsPrePass) {
      applyBindings(target, {
        formatters: this.formatters,
        resources: this.resources,
        resourceStates: this.resourceStates,
      });
    }
    await Promise.all(refs.map(ref => this.loadOne(ref.kind, ref.slug)));
  }

  applyBindings(target, {
    formatters: this.formatters,
    resources: this.resources,
    resourceStates: this.resourceStates,
  });
  if (!this.bindingsReadyFired) {
    this.bindingsReadyFired = true;
    this.win.dispatchEvent(new Event('gh:bindings-ready'));
  }
}
```

- [ ] **Step 3: Update `loadOne()` to write state transitions**

Find the existing `loadOne` (lines ~123-144):

```ts
private loadOne(kind: 'product' | 'destination' | 'funnel', slug: string): Promise<void> {
  const key = `${kind}:${slug}`;
  if (this.resources.has(key)) return Promise.resolve();
  const inflight = this.inFlight.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const data = await this.opts.client[kind](slug);
      this.resources.set(key, data);
    } catch (err) {
      if (err instanceof GhError) {
        this.opts.logger.warn(`failed to load ${kind} "${slug}" — ${err.code}: ${err.message}`);
      } else {
        this.opts.logger.warn(`failed to load ${kind} "${slug}"`, err);
      }
    } finally {
      this.inFlight.delete(key);
    }
  })();
  this.inFlight.set(key, promise);
  return promise;
}
```

Replace the inner try/catch to set state on transitions:

```ts
private loadOne(kind: 'product' | 'destination' | 'funnel', slug: string): Promise<void> {
  const key = `${kind}:${slug}`;
  if (this.resources.has(key)) return Promise.resolve();
  const inflight = this.inFlight.get(key);
  if (inflight) return inflight;
  this.resourceStates.set(key, 'loading');
  const promise = (async () => {
    try {
      const data = await this.opts.client[kind](slug);
      this.resources.set(key, data);
      this.resourceStates.set(key, 'loaded');
    } catch (err) {
      this.resourceStates.set(key, 'failed');
      if (err instanceof GhError) {
        this.opts.logger.warn(`failed to load ${kind} "${slug}" — ${err.code}: ${err.message}`);
      } else {
        this.opts.logger.warn(`failed to load ${kind} "${slug}"`, err);
      }
    } finally {
      this.inFlight.delete(key);
    }
  })();
  this.inFlight.set(key, promise);
  return promise;
}
```

- [ ] **Step 4: Update `refresh()` to clear `resourceStates`**

Find the existing `refresh()` (lines ~66-70):

```ts
async refresh(): Promise<void> {
  this.resources.clear();
  this.opts.client.clearCache();
  await this.bind(this.doc);
}
```

Replace with:

```ts
async refresh(): Promise<void> {
  this.resources.clear();
  this.resourceStates.clear();
  this.opts.client.clearCache();
  await this.bind(this.doc);
}
```

- [ ] **Step 5: Run runtime tests to verify they pass**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts
```

Expected: all runtime tests pass, including the three new ones.

- [ ] **Step 6: Run the full SDK test suite**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/runtime.ts
git commit -m "feat(sdk): two-pass binding + per-resource lifecycle state

GhRuntime now tracks resourceStates ('loading' | 'loaded' | 'failed')
alongside the existing resources map. bind() does a pre-fetch pass
when any referenced resource is not yet loaded so data-when='loading'
elements can show their skeletons immediately. loadOne writes state
on entry, success, and failure; refresh() clears state too."
```

---

## Task 9: Update MutationObserver attribute filter

**Files:**
- Modify: `packages/sdk/src/runtime.ts`

- [ ] **Step 1: Add `data-with` and `data-when` to the observed attribute filter**

Find the `attachObserver()` method (lines ~77-105). The current attribute filter is:

```ts
const filter = [
  ...RESOURCE_KINDS.map(k => RESOURCE_ATTR[k]),
  'data-field',
  'data-format',
  'data-if',
  'data-if-not',
  'data-each',
];
```

Add the two new attributes:

```ts
const filter = [
  ...RESOURCE_KINDS.map(k => RESOURCE_ATTR[k]),
  'data-field',
  'data-format',
  'data-if',
  'data-if-not',
  'data-each',
  'data-with',
  'data-when',
];
```

- [ ] **Step 2: Run the runtime test suite**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-sdk exec vitest run test/runtime.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/runtime.ts
git commit -m "feat(sdk): observe data-with and data-when attribute mutations

Partners who toggle these attributes via JS (rare but supported) now
trigger a rebind through the existing MutationObserver."
```

---

## Task 10: Update product-pricing demo with a `data-when` loading skeleton

**Files:**
- Modify: `apps/examples-static/product-pricing.html`

- [ ] **Step 1: Wrap the existing card body in `data-when="loaded"` and add a sibling skeleton + failure block**

Open `apps/examples-static/product-pricing.html`. Find the main `<article class="card" data-gh-product="bio-complete-3">` (around line 115).

Inside that `<article>`, today the card directly contains an `<img>` and a `<div>` with the product details. Wrap the existing inner content in a `<div data-when="loaded">` and add two siblings: a loading skeleton and a failure fallback.

Before:
```html
<article class="card" data-gh-product="bio-complete-3">
  <img ... />
  <div>
    <!-- existing content: h2, reviews, price, etc. -->
  </div>
</article>
```

After:
```html
<article class="card" data-gh-product="bio-complete-3">
  <div data-when="loading" class="card-skeleton" aria-busy="true">
    <div class="skel-img"></div>
    <div class="skel-text">
      <div class="skel-line"></div>
      <div class="skel-line short"></div>
      <div class="skel-line wide"></div>
    </div>
  </div>

  <div data-when="failed" class="card-failed" role="alert">
    <p>We couldn't load this product right now.</p>
  </div>

  <div data-when="loaded" class="card-loaded">
    <img ... />          <!-- existing img, unchanged -->
    <div>
      <!-- existing inner content, unchanged -->
    </div>
  </div>
</article>
```

Move the existing `<img>` and `<div>` (the right-column container) inside the new `data-when="loaded"` div. Do not change the descendants.

- [ ] **Step 2: Add skeleton + failed styles to the existing `<style>` block**

Find the `<style>` block at the top of the file. Add the following rules (place them near the existing `.card` declaration for cohesion):

```css
.card-skeleton { display: grid; grid-template-columns: 160px 1fr; gap: 1.25rem; padding: 1.25rem; }
.card-skeleton .skel-img {
  width: 100%; aspect-ratio: 1; border-radius: 8px;
  background: color-mix(in srgb, CanvasText 12%, transparent);
  animation: pulse 1.4s ease-in-out infinite;
}
.card-skeleton .skel-text { display: flex; flex-direction: column; gap: 0.6rem; padding-top: 0.5rem; }
.card-skeleton .skel-line {
  height: 0.9rem; border-radius: 4px;
  background: color-mix(in srgb, CanvasText 12%, transparent);
  animation: pulse 1.4s ease-in-out infinite;
}
.card-skeleton .skel-line.short { width: 40%; }
.card-skeleton .skel-line.wide  { width: 80%; }
@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}

.card-failed {
  padding: 1.25rem;
  color: #991b1b;
  background: #fee2e2;
  border-radius: 12px;
}

.card-loaded {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 1.25rem;
  align-items: start;
}
```

If the existing `.card` rule already sets `display: grid` etc., that's fine — the new `.card-loaded` rule replaces it for the loaded sub-region. You can either:
(a) Remove the grid styles from `.card` and let `.card-loaded` carry them, or
(b) Keep both — the inner `.card-loaded` redundantly sets grid; it's a no-op when `.card` already does so.

Option (a) is cleaner; do it if you're comfortable. If unsure, leave `.card` as-is — both rules are harmless.

- [ ] **Step 3: Verify in a browser if possible**

Open `apps/examples-static/product-pricing.html` in a browser. You should see the skeleton briefly before the SDK fetches and the loaded content appears. (Throttle network in devtools to slow-3G to see the skeleton longer.)

- [ ] **Step 4: Commit**

```bash
git add apps/examples-static/product-pricing.html
git commit -m "docs(examples): add loading skeleton and failure state via data-when

product-pricing.html now shows a pulse-animated skeleton during fetch,
the existing card on success, and an error message on failure — all
purely declarative via data-when='loaded' | 'loading' | 'failed'."
```

---

## Task 11: Update bindings.ts top comment, root README, and SDK README

**Files:**
- Modify: `README.md` (root)
- Modify: `packages/sdk/README.md`

(The `bindings.ts` top comment was already updated in Tasks 2 and 6.)

- [ ] **Step 1: Add a `data-with` / `data-when` subsection to the root README**

Open `README.md` and find the existing "Accessing product variants by quantity" subsection (around lines 38-63). Just AFTER that subsection (before "## Repository layout"), add a new subsection:

```markdown
### Declarative scope and loading states

Two attributes complete the binding miss-handling story:

- `data-with="path"` narrows the binding scope for the element and its descendants. If the path resolves to `null` / `undefined`, the element hides cleanly. Use it for direct-lookup cards (a 6-pack tier, an FAQ item) where you'd otherwise repeat the path on every nested field.

- `data-when="loaded | loading | failed"` shows the element only when the closest resource ancestor is in that lifecycle state. Use it for skeletons, error fallbacks, and "real" content blocks that should only render after data arrives.

```html
<article data-gh-product="bio-complete-3">
  <div data-when="loading" class="skeleton" aria-busy="true">…</div>
  <div data-when="failed" class="error">Couldn't load.</div>
  <div data-when="loaded">
    <h2 data-field="name"></h2>
    <div data-with="variants.subscription.standardByQuantity.6">
      <p class="price"><span data-field="price" data-format="currency:USD:en-US"></span></p>
    </div>
  </div>
</article>
```

The runtime fires a pre-fetch bind pass with all unloaded resources marked `'loading'`, so skeletons show immediately without waiting for the network.
```

(Replace `\`\`\`` markers above with literal triple backticks when pasting.)

- [ ] **Step 2: Add the same pattern (in expanded form) to `packages/sdk/README.md`**

Open `packages/sdk/README.md` and find the existing variant-access section (the one added when we documented `standardByQuantity`). Insert a new section either right before or right after it:

```markdown
## Declarative scope (`data-with`)

Wrap any element in `data-with="path.to.object"` to narrow the binding scope for it and its descendants. If the path doesn't resolve, the element hides via `style.display = 'none'` and the subtree is skipped — no JS, no placeholder leak.

Use it whenever you'd otherwise repeat a long path on every nested binding:

\`\`\`html
<article data-with="variants.subscription.standardByQuantity.6">
  <p class="qty"><span data-field="quantity"></span></p>
  <p class="price"><span data-field="price" data-format="currency:USD:en-US"></span></p>
  <p data-if="savings">Save <span data-field="savings" data-format="currency:USD:en-US"></span></p>
</article>
\`\`\`

If the catalog doesn't carry a 6-pack, the entire `<article>` hides.

## Resource lifecycle (`data-when`)

`data-when` shows an element only when its closest resource ancestor is in the named lifecycle state:

- `loaded` — the resource fetch succeeded.
- `loading` — the fetch is in flight, or the page just mounted and a fetch is queued.
- `failed` — the fetch settled without populating the resource (404, network error, brand mismatch).

\`\`\`html
<article data-gh-product="bio-complete-3">
  <div data-when="loading" class="skeleton" aria-busy="true">…</div>
  <div data-when="failed" class="error" role="alert">Couldn't load this product.</div>
  <div data-when="loaded">
    <h2 data-field="name"></h2>
    <img data-attr-src="image" data-attr-alt="name" />
  </div>
</article>
\`\`\`

The runtime now binds twice per pass: once with unloaded resources marked `'loading'` (skeletons appear before the network round-trip), then again after fetches settle. `gh:bindings-ready` continues to fire once, after the post-fetch pass.

## Evaluation order

When multiple binding attributes appear on the same element, they evaluate in this order:

1. Resource context attributes (`data-gh-product`, `data-gh-destination`, `data-gh-funnel`).
2. `data-when` — cheap state check; if mismatched, the element hides and the subtree is skipped.
3. `data-with` — narrows scope; if the path doesn't resolve, the element hides.
4. `data-if` / `data-if-not` — evaluated against the narrowed scope.
5. `<template data-each>` — iterates; clones use the narrowed scope as their parent context.
6. `data-field`, `data-attr-<NAME>` — field/attribute writes, against the narrowed scope.
7. Recurse into children.
```

(Replace `\`\`\`` markers with literal triple backticks when pasting.)

- [ ] **Step 3: Verify both README files render**

Run:
```bash
grep -n "data-with\|data-when" README.md packages/sdk/README.md | head -20
```

Expected: multiple matches in each file.

- [ ] **Step 4: Commit**

```bash
git add README.md packages/sdk/README.md
git commit -m "docs(readme): document data-with and data-when

Root README gets a short subsection with one combined example. The SDK
package README gets a deeper treatment with separate sections per
attribute plus a definitive evaluation-order table for partners reading
top-to-bottom."
```

---

## Task 12: Add changeset + final workspace verification

**Files:**
- Create: `.changeset/binding-scope-and-states.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/binding-scope-and-states.md` with this EXACT content:

```markdown
---
"@goldenhippo/hippo-shop-sdk": minor
---

Add declarative miss-handling: `data-with` narrows the binding scope for a subtree
and hides on missing path; `data-when="loaded|loading|failed"` shows elements based
on the closest resource's lifecycle state. Together these let partners express
loading skeletons, error fallbacks, and tight direct-lookup cards purely in HTML.

The runtime now binds twice per pass: once with all unloaded resources marked
`loading` (so skeletons show immediately), then again after fetches settle.
`gh:bindings-ready` continues to fire once, after the post-fetch pass.

Adds `ApplyBindingsOptions.resourceStates` and the `ResourceState` type to the SDK
exports.
```

- [ ] **Step 2: Confirm changesets recognizes the file**

Run:
```bash
pnpm changeset status
```

Expected: lists `@goldenhippo/hippo-shop-sdk` scheduled for a minor bump.

- [ ] **Step 3: Run the full workspace verification**

Run:
```bash
pnpm --filter @goldenhippo/hippo-shop-types typecheck \
  && pnpm --filter @goldenhippo/hippo-shop-sdk typecheck \
  && pnpm --filter @goldenhippo/hippo-shop-sdk test \
  && pnpm --filter @goldenhippo/hippo-shop-sdk lint \
  && pnpm build
```

Expected: all six steps exit 0.

- [ ] **Step 4: Commit**

```bash
git add .changeset/binding-scope-and-states.md
git commit -m "chore: add changeset for data-with and data-when"
```

- [ ] **Step 5: Review the commit history**

Run:
```bash
git log --oneline -15
```

Expected: ~12 commits since the spec, in a clean linear sequence (test red → impl green → test red → impl green → docs → changeset).

---

## Out of scope

- Updating `docs/public-dtos-v1-contract.md` — that doc is about the API contract / wire format, which doesn't change. The new attributes are SDK-only.
- Adding similar attributes for finer-grained state (e.g., a "stale" state when `gh.refresh()` is mid-flight). YAGNI; partners can compose `data-when="loading"` to cover refresh transitions.
- A `data-each-with` shorthand. Two attributes compose fine; the spec covers `data-with` on a `<template data-each>` element.
- Programmatic access to `resourceStates` via `window.gh`. Internal-only for now; can be exposed later without breaking.
- Animated transitions between states. Pure show/hide; partners style with CSS as desired.

## Risks

- **Pre-fetch pass adds a DOM walk.** Pages with thousands of bindings will see a small extra cost; negligible in practice (the walk is fast and only runs when there are unloaded resources).
- **Existing behavior change**: unresolved resource subtrees used to `return` early. Now they descend with `data: undefined`. Field bindings short-circuit on undefined values (existing `applyFieldBinding` guard at `bindings.ts:159`), so the visible effect is identical for any page not using `data-when`. Worth calling out in PR review.
- **`data-when` requires a resource ancestor.** Stray `data-when="loaded"` elements with no `data-gh-*` ancestor are silently left alone (intentional — matches `data-if`). Partners who put `data-when` on the wrong element will see no behavior; no error to debug. Acceptable tradeoff (otherwise we'd throw or log, which is noisy).
