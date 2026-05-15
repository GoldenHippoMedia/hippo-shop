import { describe, it, expect, beforeEach } from 'vitest';
import { applyBindings, collectResources, resourceKey } from '../src/bindings';
import { FormatRegistry } from '../src/format';

const PRODUCT = {
  id: 'p1',
  slug: 'bio-complete-3',
  name: 'Bio Complete 3',
  category: 'Digestive Health',
  packaging: { singular: 'Bottle', plural: 'Bottles' },
  image: 'https://cdn.example.com/bc3.png',
  reviews: { count: 18432, average: 4.7, globalFiveStarReviews: 14210 },
  outOfStock: false,
  variants: {
    subscription: {
      standard: [
        { sku: 'BC3-SUB-1', price: 49.95, quantity: 1, packageType: 'bottle', savings: 30 },
        { sku: 'BC3-SUB-6', price: 199.74, quantity: 6, packageType: 'bottle', savings: 359.76 },
      ],
      myAccount: [],
    },
    oneTime: { standard: [], myAccount: [] },
  },
};

const FUNNEL = {
  slug: 'bio-complete-3-main',
  name: 'Bio Complete 3 — Main',
  active: true,
  entryUrl: 'https://example.com/bc3',
  steps: [
    { stepNumber: 1, slug: 'vsl', name: 'VSL', kind: 'landing', url: '/vsl' },
    { stepNumber: 2, slug: 'order', name: 'Order Form', kind: 'order-form', url: '/order' },
  ],
};

function setHtml(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('collectResources', () => {
  it('finds product/destination/funnel references uniquely', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3"></div>
      <div data-gh-product="bio-complete-3"></div>
      <div data-gh-funnel="f1"></div>
      <span data-gh-destination="d1"></span>
    `);
    const refs = collectResources(document);
    const keys = refs.map(resourceKey).sort();
    expect(keys).toEqual(
      ['destination:d1', 'funnel:f1', 'product:bio-complete-3'].sort(),
    );
  });

  it('ignores content inside <template> tags', () => {
    setHtml(`
      <template><div data-gh-product="inside-template"></div></template>
      <div data-gh-product="outside-template"></div>
    `);
    const refs = collectResources(document);
    expect(refs).toEqual([{ kind: 'product', slug: 'outside-template' }]);
  });
});

describe('applyBindings — field + format', () => {
  const formatters = new FormatRegistry();
  const resources = new Map<string, unknown>([
    ['product:bio-complete-3', PRODUCT],
    ['funnel:bio-complete-3-main', FUNNEL],
  ]);

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('substitutes textContent for a single field', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <h1 data-field="name">placeholder</h1>
        <p data-field="category">placeholder</p>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect(document.querySelector('h1')!.textContent).toBe('Bio Complete 3');
    expect(document.querySelector('p')!.textContent).toBe('Digestive Health');
  });

  it('applies a format spec', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <span id="price" data-field="variants.subscription.standard.0.price" data-format="currency:USD:en-US"></span>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect(document.getElementById('price')!.textContent).toBe('$49.95');
  });

  it('leaves the original textContent when the path is unresolved', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <span id="x" data-field="nonexistent.path">keep me</span>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect(document.getElementById('x')!.textContent).toBe('keep me');
  });

  it('does not process elements without context (no enclosing data-gh-*)', () => {
    setHtml(`<span id="x" data-field="name">untouched</span>`);
    applyBindings(document, { formatters, resources });
    expect(document.getElementById('x')!.textContent).toBe('untouched');
  });

  it('skips the subtree when the resource is not yet loaded', () => {
    setHtml(`<div data-gh-product="missing"><span data-field="name">placeholder</span></div>`);
    applyBindings(document, { formatters, resources: new Map() });
    expect(document.querySelector('span')!.textContent).toBe('placeholder');
  });
});

describe('applyBindings — attribute bindings', () => {
  const formatters = new FormatRegistry();
  const resources = new Map<string, unknown>([['product:bio-complete-3', PRODUCT]]);

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sets attributes via data-attr-*', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <img id="img" data-attr-src="image" data-attr-alt="name" />
      </div>
    `);
    applyBindings(document, { formatters, resources });
    const img = document.getElementById('img')!;
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/bc3.png');
    expect(img.getAttribute('alt')).toBe('Bio Complete 3');
  });

  it('refuses to bind on* event attributes', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <button id="b" data-attr-onclick="name">click</button>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect(document.getElementById('b')!.getAttribute('onclick')).toBeNull();
  });
});

describe('applyBindings — conditionals', () => {
  const formatters = new FormatRegistry();
  const resources = new Map<string, unknown>([['product:bio-complete-3', PRODUCT]]);

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('data-if hides when value is falsy', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <p id="show" data-if="reviews.count">visible</p>
        <p id="hide" data-if="outOfStock">should be hidden</p>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect((document.getElementById('show')! as HTMLElement).style.display).toBe('');
    expect((document.getElementById('hide')! as HTMLElement).style.display).toBe('none');
  });

  it('data-if-not hides when value is truthy', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <p id="instock" data-if-not="outOfStock">in stock</p>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect((document.getElementById('instock')! as HTMLElement).style.display).toBe('');
  });

  it('re-applying with changed data un-hides previously hidden elements', () => {
    setHtml(`
      <div data-gh-product="bio-complete-3">
        <p id="oos" data-if="outOfStock">Out of stock!</p>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect((document.getElementById('oos')! as HTMLElement).style.display).toBe('none');

    const updated = new Map<string, unknown>([
      ['product:bio-complete-3', { ...PRODUCT, outOfStock: true }],
    ]);
    applyBindings(document, { formatters, resources: updated });
    expect((document.getElementById('oos')! as HTMLElement).style.display).toBe('');
  });
});

describe('applyBindings — loops (data-each on <template>)', () => {
  const formatters = new FormatRegistry();
  const resources = new Map<string, unknown>([
    ['product:bio-complete-3', PRODUCT],
    ['funnel:bio-complete-3-main', FUNNEL],
  ]);

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('expands a template per array item using the item context', () => {
    setHtml(`
      <ul id="list" data-gh-product="bio-complete-3">
        <template data-each="variants.subscription.standard">
          <li>
            <span class="qty" data-field="quantity"></span> ×
            <span class="price" data-field="price" data-format="currency:USD:en-US"></span>
          </li>
        </template>
      </ul>
    `);
    applyBindings(document, { formatters, resources });
    const list = document.getElementById('list')!;
    const lis = list.querySelectorAll('li');
    expect(lis).toHaveLength(2);
    expect(lis[0]!.querySelector('.qty')!.textContent).toBe('1');
    expect(lis[0]!.querySelector('.price')!.textContent).toBe('$49.95');
    expect(lis[1]!.querySelector('.qty')!.textContent).toBe('6');
    expect(lis[1]!.querySelector('.price')!.textContent).toBe('$199.74');
  });

  it('clears previously-expanded clones on re-render', () => {
    setHtml(`
      <ul id="list" data-gh-product="bio-complete-3">
        <template data-each="variants.subscription.standard"><li data-field="sku"></li></template>
      </ul>
    `);
    applyBindings(document, { formatters, resources });
    expect(document.querySelectorAll('#list li')).toHaveLength(2);
    applyBindings(document, { formatters, resources });
    expect(document.querySelectorAll('#list li')).toHaveLength(2); // not 4
  });

  it('expands funnel steps with attribute bindings', () => {
    setHtml(`
      <ol id="steps" data-gh-funnel="bio-complete-3-main">
        <template data-each="steps">
          <li>
            <a data-attr-href="url"><span data-field="name"></span></a>
          </li>
        </template>
      </ol>
    `);
    applyBindings(document, { formatters, resources });
    const links = document.querySelectorAll('#steps li a');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('href')).toBe('/vsl');
    expect(links[0]!.querySelector('span')!.textContent).toBe('VSL');
    expect(links[1]!.getAttribute('href')).toBe('/order');
    expect(links[1]!.querySelector('span')!.textContent).toBe('Order Form');
  });
});
