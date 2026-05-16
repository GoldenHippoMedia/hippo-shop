# Declarative binding scope (`data-with`) and resource states (`data-when`)

**Status**: Draft
**Date**: 2026-05-16
**Target release**: `@goldenhippo/hippo-shop-sdk@2.2.0` (minor, additive)
**Affected packages**: `sdk` only — `types` unchanged

## Problem

Two ergonomic gaps surfaced while polishing the example demos pre-publish:

1. **Verbose path repetition.** Direct-lookup cards (e.g., "show the 6-pack price + savings + cadence") force partners to spell out `variants.subscription.standardByQuantity.6` on every nested `data-field` / `data-if`. Today the only way to introduce a new binding scope is `<template data-each>`, which iterates — wrong shape for single-item lookups.

2. **No declarative way to render loading or error UI.** A page that uses `data-gh-product="..."` either shows raw placeholder text until the SDK fetches and binds, or partners write boilerplate JS that listens for `gh:bindings-ready` to toggle a class. Failed fetches (404, network error) never trigger any UI change — placeholders persist forever.

Both miss the same point: a partner should be able to express "render this subtree under these conditions" purely in HTML.

## Goal

Add two new attributes that together complete the SDK's declarative miss-handling story:

- `data-with="path"` — narrows the binding scope for an element and its descendants. If the path doesn't resolve, the element hides.
- `data-when="loaded|loading|failed"` — shows the element only when the closest resource ancestor is in the named lifecycle state.

The two can stack. Neither requires partners to write JavaScript.

## Non-goals

- New resource kinds (no funnel/destination changes).
- A `data-each` shorthand that combines iteration with scope.
- Exposing the runtime's resource state object to JS consumers (it stays internal).
- A 4th `data-when` state like `'idle'` or `'stale'`. The three above are sufficient.
- Custom transition animations between states. Pure show/hide. Partners can style with CSS transitions if they want.

## Feature 1 — `data-with`

### Mechanic

A new attribute on any element. When `walk()` reaches the element:

1. Resolve `data-with` against the current binding scope via `getByPath`.
2. If the result is `null` or `undefined`, hide the element via `setHidden(el, true)` and skip the subtree.
3. Otherwise, replace `nextCtx.data` with the resolved value for this element AND descendants.

Evaluation order in `walk()` (updated):

1. Acquire resource context (existing — `data-gh-*` attributes).
2. **NEW**: Evaluate `data-with`. Hide and return on miss; narrow scope on hit.
3. Evaluate `data-if` / `data-if-not` (existing) — now against the narrowed scope.
4. Loop expansion via `<template data-each>` (existing — `data-each`'s path is also relative to the narrowed scope).
5. Field / attribute bindings (existing) — also relative to narrowed scope.
6. Recurse into children with the narrowed scope.

### Worked example

```html
<article class="tier featured" data-with="variants.subscription.standardByQuantity.6">
  <p class="qty"><span data-field="quantity"></span></p>
  <p class="price"><span data-field="price" data-format="currency:USD:en-US"></span></p>
  <p data-if="savings" class="savings">
    Save <span data-field="savings" data-format="currency:USD:en-US"></span>
  </p>
  <p data-if="defaultFrequency" class="cadence">
    Renews <span data-field="defaultFrequency.label"></span>
  </p>
</article>
```

If the catalog doesn't offer a 6-pack, the whole `<article>` hides — no further matching against `data-if`, no placeholder text leaking through.

### Edge cases

- **Nested `data-with`**: each level narrows further. The inner `data-with` path is relative to the outer narrowed scope.
- **`data-with` on `<template data-each>`**: the path narrows the iteration context's source. `<template data-each="standardList" data-with="variants.subscription">` is equivalent to `<template data-each="variants.subscription.standardList">`. Both forms supported; document the latter as the preferred when there's no second use of the narrowed scope.
- **Resolves to a primitive** (string, number, boolean): allowed — descendants can use property paths on the primitive (e.g., `data-with="name"` then `data-field="length"`). Not idiomatic, but consistent.
- **No resource context yet**: same as `data-if` today — leave the element alone (`if (!nextCtx) return;`).
- **`data-with` on the same element as a resource attribute** (`data-gh-product` + `data-with`): the resource attribute wins (acquires context first), then `data-with` narrows within. Sensible composition.

## Feature 2 — `data-when`

### Mechanic

A new attribute that takes one of three literal values: `loaded`, `loading`, `failed`. The element is visible only when the closest resource ancestor's lifecycle state matches the value.

### Runtime state tracking

The runtime gains a new internal map:

```ts
private readonly resourceStates = new Map<string, 'loading' | 'loaded' | 'failed'>();
```

Transitions:

- `loadOne` starts → `resourceStates.set(key, 'loading')` (if not already loaded).
- `loadOne` success → `resourceStates.set(key, 'loaded')`.
- `loadOne` failure → `resourceStates.set(key, 'failed')`.
- `refresh()` clears: `resourceStates.clear()` alongside the existing `resources.clear()`.

The map is passed into `applyBindings` as a new option:

```ts
interface ApplyBindingsOptions {
  formatters: FormatRegistry;
  resources: Map<string, unknown>;
  resourceStates: Map<string, 'loading' | 'loaded' | 'failed'>; // NEW
}
```

### Two-pass binding in `runtime.bind()`

Today, `bind()` awaits all fetches before calling `applyBindings` once. To support `data-when="loading"`, we add a pre-fetch pass:

```ts
async bind(root) {
  const refs = collectResources(root);
  if (refs.length > 0) {
    // Pre-fetch pass: mark all unloaded resources as 'loading'.
    for (const ref of refs) this.markLoading(ref);
    applyBindings(root, this.bindingOptions());
    // Fetch + state transitions as before.
    await Promise.all(refs.map(ref => this.loadOne(ref.kind, ref.slug)));
  }
  // Post-fetch pass.
  applyBindings(root, this.bindingOptions());
  // 'gh:bindings-ready' continues to fire after the post-fetch pass.
}
```

`markLoading(ref)` only sets `'loading'` when the resource isn't already loaded (so re-binds don't flicker through loading state).

### Walker change

When `walk()` acquires resource context (lines 105-118 of `bindings.ts`), it now also records the resource key. The `data-when` check happens before `data-if`:

```ts
const whenState = el.getAttribute('data-when');
if (whenState !== null) {
  if (!currentResourceKey) return; // no resource ancestor → leave alone
  const actual = opts.resourceStates.get(currentResourceKey) ?? 'loading';
  const shouldShow = actual === whenState;
  setHidden(el, !shouldShow);
  if (!shouldShow) return;
}
```

Order of evaluation within a single element:

1. Acquire resource context.
2. **NEW**: `data-when`. Hide if mismatched; return.
3. `data-with`. Hide if path doesn't resolve; return.
4. `data-if` / `data-if-not`. Existing.
5. Loop / field / attr / recurse. Existing.

### Worked example

```html
<article data-gh-product="bio-complete-3">
  <div data-when="loading" class="skeleton" aria-busy="true">…</div>
  <div data-when="failed" class="error" role="alert">Couldn't load.</div>

  <div data-when="loaded">
    <h2 data-field="name"></h2>                     <!-- top-level product scope -->
    <div data-with="variants.subscription.standardByQuantity.6">
      <p class="price"><span data-field="price" data-format="currency:USD:en-US"></span></p>
      <p data-if="savings" class="savings">
        Save <span data-field="savings" data-format="currency:USD:en-US"></span>
      </p>
    </div>
  </div>
</article>
```

### Edge cases

- **`data-when` with no resource ancestor**: leave alone (consistent with `data-if`).
- **Resource has never been requested** (e.g., `data-gh-product="..."` added by JS after init, before the next bind tick): state is absent from the map. Treat as `'loading'` (default). Partners see the skeleton until the rebind tick lands.
- **Stacking `data-when` + `data-with`**: `data-when` first (cheap state check). `data-with` only evaluates when state matches. Partners typically pair `data-when="loaded"` with `data-with` for the success path.
- **Stacking `data-when` + `data-if`**: `data-when` first, `data-if` second. Both must be truthy for the element to show.
- **No upward path traversal**: `data-with` only narrows. There's no `../` syntax to escape back out. A partner who wants both the product's top-level `name` AND the 6-pack's `price` puts the wrapper above the `data-with`:

  ```html
  <article data-gh-product="bio-complete-3">
    <h2 data-field="name"></h2>                              <!-- top-level scope -->
    <div data-with="variants.subscription.standardByQuantity.6">
      <p class="price"><span data-field="price"></span></p>  <!-- narrowed scope -->
    </div>
  </article>
  ```

  This is documented as the canonical pattern.
- **`gh.refresh()`**: clears `resourceStates` along with `resources`. Next bind pass goes through `loading → loaded/failed` transitions normally.

### Mutation observer interaction

The MutationObserver's `attributeFilter` (`runtime.ts:79-86`) currently watches `data-gh-*`, `data-field`, `data-format`, `data-if`, `data-if-not`, `data-each`. We add `data-with` and `data-when` so partners who toggle these attributes via JS trigger a rebind. (Most partners won't — these are page-static — but the filter should be complete.)

## Updated `bindings.ts` documentation header

The top-of-file comment lists supported attributes. We extend it:

```ts
*   data-gh-product="slug"        Sets the product context for the element + descendants.
*   data-gh-destination="slug"    Sets the destination context.
*   data-gh-funnel="slug"         Sets the funnel context.
*   data-with="path.to.object"    Narrows the binding scope for descendants; hides on miss.
*   data-when="loaded|loading|failed"  Shows only when the closest resource is in that state.
*   data-field="path.to.value"    Replaces textContent with the resolved value.
*   data-format="name[:arg]"      Applies a formatter to the field/attr value.
*   data-attr-<NAME>="path"       Sets the <NAME> attribute (NOT for on* event attrs).
*   data-if="path"                Hides the element if the value is falsy.
*   data-if-not="path"            Hides the element if the value is truthy.
*   <template data-each="path">   Clones content per item in the array.
```

## Updated bindings public types (`packages/sdk/src/bindings.ts`)

`ApplyBindingsOptions` gains the `resourceStates` field. `applyBindings` callers (only `GhRuntime.bind` today) pass it through.

```ts
export type ResourceState = 'loading' | 'loaded' | 'failed';

export interface ApplyBindingsOptions {
  formatters: FormatRegistry;
  resources: Map<string, unknown>;
  resourceStates: Map<string, ResourceState>;
}
```

`ResourceState` is re-exported from the SDK barrel for partners who want to type their own runtime extensions.

## Demo update

The variant-grid demo's "Featured packages" section gets refactored to use `data-with` (drops ~30 lines of duplicated paths). The product-pricing demo gains a small `data-when` loading skeleton above the existing card. These are surface-level edits — not a rewrite.

## Tests

### `packages/sdk/test/bindings.spec.ts`

Add a new describe block `applyBindings — data-with` covering:
- Scope narrows: `<div data-with="X">` lets descendants use relative paths.
- Miss hides: `data-with="missing"` → element hidden, subtree not processed.
- Nested `data-with`: two levels of narrowing.
- `data-with` + `data-if`: scope narrows first, conditional in narrowed scope.
- `data-with` inside `<template data-each>` loop body: each clone scopes correctly.
- `data-with` on a `<template data-each>` element narrows the source of the loop.

Add a new describe block `applyBindings — data-when` covering:
- `data-when="loaded"` shows when `resourceStates.get(key) === 'loaded'`, hides otherwise.
- `data-when="loading"` shows when loading or unknown (state absent).
- `data-when="failed"` shows only when explicitly 'failed'.
- Stack with `data-with`: only the matching state evaluates the scope narrow.
- No resource ancestor → element left alone.

### `packages/sdk/test/runtime.spec.ts`

- Two-pass binding: during `bind()`, the pre-fetch pass marks loading and applies bindings before the fetch settles.
- State transitions: `loading → loaded`, `loading → failed`.
- `refresh()` clears `resourceStates` and re-runs the loading transition.

## Versioning + changeset

Single changeset, minor bump:

```markdown
---
"@goldenhippo/hippo-shop-sdk": minor
---

Add declarative miss-handling: data-with narrows the binding scope for a
subtree and hides on missing path; data-when="loaded|loading|failed" shows
elements based on the closest resource's lifecycle state. Together these
let partners express loading skeletons, error fallbacks, and tight
direct-lookup cards purely in HTML.

The runtime now binds twice per pass: once with all unloaded resources
marked 'loading' (so skeletons show immediately), then again after fetches
settle. gh:bindings-ready continues to fire once, after the post-fetch
pass.

Adds ApplyBindingsOptions.resourceStates and the ResourceState type to
the SDK exports.
```

## Risks and tradeoffs

- **Two-pass binding doubles the initial bind work.** The pre-fetch pass walks the DOM once before any fetches resolve. For pages with a few hundred bindings, this is negligible; for pages with thousands, it adds milliseconds. Acceptable — the value (avoiding a flash of unstyled placeholders) is worth more than the cost.
- **MutationObserver feedback risk.** The pre-fetch pass calls `setHidden` on `data-when="loaded"` elements, which sets `style.display`. The observer is configured with `attributeFilter` that doesn't include `style`, so this doesn't re-trigger. Verified.
- **`data-when` is element-scoped, not class-scoped.** Partners who want `body.gh-loading { … }` style CSS hooks still need to listen for `gh:bindings-ready` and toggle a class. We're not replacing that pattern, just adding a declarative alternative for element-level cases.
- **`data-with` precedence over `data-each` on the same element**: a `<template>` carrying both has `data-with` evaluated first (narrowing the iteration source). Documented explicitly to avoid confusion.
- **Resource state visibility.** The state map is internal to the runtime; we don't expose it via `window.gh`. If partners need programmatic access later, we can add it without breaking. YAGNI for now.

## Out of scope

- A `data-when="initial"` state for "no resource ancestor / hasn't been requested." The current `'loading'` default for absent state covers this case adequately.
- Upward scope traversal (`data-field="../name"` from inside a `data-with`). Forces partners to structure markup with the wrapper outside.
- A `data-each` + `data-with` shorthand like `data-each-with="path"`. Two attributes compose fine.
- Animated state transitions. Pure show/hide; partners style with CSS.
