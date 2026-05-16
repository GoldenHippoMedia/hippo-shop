/**
 * Declarative DOM bindings.
 *
 * Partners author HTML with data-attributes; the SDK scans the page, fetches
 * the resources they reference, and renders values into the DOM.
 *
 * Supported attributes (all data-*):
 *
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
 *   <template data-each="path">   Clones content per item in the array (path resolves to an array).
 *
 * Lookups are read-only. textContent (not innerHTML) is used everywhere, so
 * partner data can never inject markup. on* attribute bindings are silently
 * dropped — we never wire event handlers from data.
 */

import { getByPath } from './path';
import { FormatRegistry } from './format';

export type ResourceKind = 'product' | 'destination' | 'funnel';

export const RESOURCE_KINDS = ['product', 'destination', 'funnel'] as const;

export const RESOURCE_ATTR: Record<ResourceKind, string> = {
  product: 'data-gh-product',
  destination: 'data-gh-destination',
  funnel: 'data-gh-funnel',
};

const LOOP_CLONE_ATTR = 'data-gh-loop-clone';
const HIDDEN_BY_GH_ATTR = 'data-gh-hidden';

export interface ResourceRef {
  kind: ResourceKind;
  slug: string;
}

export function resourceKey(ref: ResourceRef): string {
  return `${ref.kind}:${ref.slug}`;
}

/**
 * Walk a subtree and collect every unique (kind, slug) referenced by a
 * `data-gh-*` attribute. Inert and previously-cloned subtrees are skipped.
 */
export function collectResources(root: ParentNode | Element): ResourceRef[] {
  const seen = new Set<string>();
  const out: ResourceRef[] = [];
  const consider = (el: Element): void => {
    for (const kind of RESOURCE_KINDS) {
      const slug = el.getAttribute(RESOURCE_ATTR[kind]);
      if (!slug) continue;
      const key = `${kind}:${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, slug });
    }
  };
  if (root instanceof Element) consider(root);
  const selector = RESOURCE_KINDS.map(k => `[${RESOURCE_ATTR[k]}]`).join(',');
  // Note: querySelectorAll skips <template> content — good, those are loop bodies.
  for (const el of Array.from(root.querySelectorAll<Element>(selector))) {
    consider(el);
  }
  return out;
}

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

/**
 * Apply bindings under `root`. Idempotent: safe to call repeatedly.
 *
 * - Elements with `data-gh-<kind>` set the iteration context for themselves
 *   and their descendants.
 * - `<template data-each="...">` is expanded into siblings (previously expanded
 *   clones are removed first, so re-renders don't accumulate).
 * - `data-field`, `data-attr-*`, `data-if`, `data-if-not` are processed against
 *   the closest enclosing context.
 *
 * Elements outside any context are left untouched (they can be set up later by
 * a parent acquiring context — common with MutationObserver-driven binding).
 */
export function applyBindings(root: Element | Document, opts: ApplyBindingsOptions): void {
  const start = root instanceof Document ? root.documentElement : root;
  if (!start) return;
  walk(start, null, opts);
}

function walk(el: Element, ctx: BindContext | null, opts: ApplyBindingsOptions): void {
  // Acquire context if this element specifies a resource. We resolve in a fixed
  // order so an element using two attrs (rare) picks a deterministic winner.
  // Always record the key so data-when can resolve state, even when data is
  // still undefined (resource not yet loaded).
  let nextCtx = ctx;
  for (const kind of RESOURCE_KINDS) {
    const slug = el.getAttribute(RESOURCE_ATTR[kind]);
    if (!slug) continue;
    const key = `${kind}:${slug}`;
    const data = opts.resources.get(key);
    nextCtx = { data, formatters: opts.formatters, resourceKey: key };
    break;
  }

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

  // hasData gate — bindings that operate on the bound data only run when
  // data is actually present. During loading (data === undefined), we still
  // recurse into children so descendants with their own resource contexts
  // get processed, but data-with / data-if / data-each / data-field / data-attr-*
  // are skipped to preserve the pre-2.2 "untouched during loading" behavior.
  const hasData = nextCtx != null && nextCtx.data !== undefined;

  if (hasData) {
    // data-with narrows scope before any other attribute on this element
    // evaluates. If the path resolves to null/undefined, hide the subtree.
    const withPath = el.getAttribute('data-with');
    if (withPath !== null) {
      const scoped = getByPath(nextCtx!.data, withPath);
      if (scoped == null) {
        setHidden(el, true);
        return;
      }
      setHidden(el, false);
      nextCtx = nextCtx!.resourceKey !== undefined
        ? { data: scoped, formatters: nextCtx!.formatters, resourceKey: nextCtx!.resourceKey }
        : { data: scoped, formatters: nextCtx!.formatters };
    }

    // Conditionals first so we can skip the subtree if hidden.
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

    // Loop expansion. <template data-each="path"> clones its content per item.
    if (el instanceof HTMLTemplateElement && el.hasAttribute('data-each')) {
      expandLoop(el, nextCtx!, opts);
      return;
    }

    // Field and attribute bindings on this element.
    applyFieldBinding(el, nextCtx!);
    applyAttrBindings(el, nextCtx!);
  }

  // Recurse into children. Templates are not entered (their content is in
  // template.content, processed only when expanded via the hasData branch above).
  if (!(el instanceof HTMLTemplateElement)) {
    for (const child of Array.from(el.children)) walk(child, nextCtx, opts);
  }
}

function applyFieldBinding(el: Element, ctx: BindContext): void {
  const fieldPath = el.getAttribute('data-field');
  if (!fieldPath) return;
  const value = getByPath(ctx.data, fieldPath);
  if (value === undefined) return; // Leave placeholder in place.
  const fmt = el.getAttribute('data-format');
  el.textContent = ctx.formatters.apply(value, fmt);
}

// Attributes whose value the browser resolves as a URL. If the value starts
// with a script-bearing scheme (javascript:, vbscript:, data:) it executes in
// the host page's origin, so we scheme-check before binding.
const URL_ATTRS = new Set([
  'href',
  'xlink:href',
  'src',
  'action',
  'formaction',
  'data',
  'ping',
  'poster',
  'background',
  'cite',
  'longdesc',
  'usemap',
  'manifest',
]);

function isSafeUrl(value: string): boolean {
  // Browsers strip ASCII whitespace/control chars at the start of a URL and
  // tab/LF/CR anywhere in the scheme prefix when resolving — `java\tscript:…`
  // is treated as `javascript:`. Mirror that normalization before checking.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/^[\s\x00-\x1f]+/, '').replace(/[\t\n\r]/g, '');
  return !/^(javascript|vbscript|data):/i.test(cleaned);
}

function applyAttrBindings(el: Element, ctx: BindContext): void {
  const attrs = el.attributes;
  // Iterate in reverse since we may not be modifying, but stable in either direction.
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!attr) continue;
    if (!attr.name.startsWith('data-attr-')) continue;
    const target = attr.name.slice('data-attr-'.length);
    if (!target) continue;
    const lcTarget = target.toLowerCase();
    if (lcTarget.startsWith('on')) continue; // Never bind event handlers.
    if (lcTarget === 'srcdoc') continue; // <iframe srcdoc> is a raw HTML island.
    const value = getByPath(ctx.data, attr.value);
    if (value === undefined || value === null) continue;
    const fmtSpec = el.getAttribute(`data-attr-format-${target}`) ?? el.getAttribute('data-format');
    const formatted = ctx.formatters.apply(value, fmtSpec);
    if (URL_ATTRS.has(lcTarget) && !isSafeUrl(formatted)) continue;
    el.setAttribute(target, formatted);
  }
}

function expandLoop(template: HTMLTemplateElement, ctx: BindContext, opts: ApplyBindingsOptions): void {
  const path = template.getAttribute('data-each')!;
  const items = getByPath(ctx.data, path);
  const parent = template.parentNode;
  if (!parent) return;

  // Remove previously-expanded clones so re-renders don't accumulate.
  let cursor = template.nextSibling;
  while (cursor && cursor instanceof Element && cursor.hasAttribute(LOOP_CLONE_ATTR)) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }

  if (!Array.isArray(items)) return;

  const insertBefore = template.nextSibling;
  for (const item of items) {
    const clone = template.content.cloneNode(true) as DocumentFragment;
    // For each top-level Element in the clone, mark it as a loop clone and process it
    // with the iteration context.
    const topLevelEls: Element[] = [];
    for (const node of Array.from(clone.childNodes)) {
      if (node instanceof Element) {
        node.setAttribute(LOOP_CLONE_ATTR, '');
        topLevelEls.push(node);
      }
    }
    const itemCtx: BindContext = { data: item, formatters: ctx.formatters };
    for (const el of topLevelEls) walk(el, itemCtx, opts);
    parent.insertBefore(clone, insertBefore);
  }
}

function setHidden(el: Element, hidden: boolean): void {
  const html = el as HTMLElement;
  if (hidden) {
    el.setAttribute(HIDDEN_BY_GH_ATTR, '');
    if (html.style) {
      // Preserve any prior display value so we can restore it on un-hide.
      const prior = html.style.display;
      if (prior && prior !== 'none') html.dataset['ghPriorDisplay'] = prior;
      html.style.display = 'none';
    } else {
      el.setAttribute('hidden', '');
    }
  } else {
    if (el.hasAttribute(HIDDEN_BY_GH_ATTR)) {
      el.removeAttribute(HIDDEN_BY_GH_ATTR);
      el.removeAttribute('hidden');
      if (html.style) {
        const prior = html.dataset?.['ghPriorDisplay'];
        html.style.display = prior ?? '';
        if (prior) delete html.dataset['ghPriorDisplay'];
      }
    }
  }
}
