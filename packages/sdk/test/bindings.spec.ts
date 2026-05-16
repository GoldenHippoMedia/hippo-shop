import { describe, it, expect, beforeEach } from 'vitest';
import { applyBindings, collectResources, resourceKey } from '../src/bindings';
import { FormatRegistry } from '../src/format';

const PRODUCT = {
  id: 'p1',
  slug: 'bio-complete-3',
  name: 'Bio Complete 3',
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

const ENRICHED_PRODUCT = {
  id: 'p2',
  slug: 'enriched-product',
  name: 'Enriched Product',
  packaging: { singular: 'Bottle', plural: 'Bottles' },
  image: 'https://cdn.example.com/ep.png',
  reviews: { count: 10, average: 4.8, globalFiveStarReviews: 8 },
  outOfStock: false,
  variants: {
    subscription: {
      standard: [],
      standardList: [
        { sku: 'EP-SUB-3', price: 89.95, quantity: 3, packageType: 'bottle', savings: 15 },
        { sku: 'EP-SUB-6', price: 169.95, quantity: 6, packageType: 'bottle', savings: 50 },
      ],
      standardByQuantity: {
        '3': { sku: 'EP-SUB-3', price: 89.95, quantity: 3, packageType: 'bottle', savings: 15 },
        '6': { sku: 'EP-SUB-6', price: 169.95, quantity: 6, packageType: 'bottle', savings: 50 },
      },
      myAccount: [],
      myAccountList: [],
      myAccountByQuantity: {},
    },
    oneTime: {
      standard: [],
      standardList: [],
      standardByQuantity: {},
      myAccount: [],
      myAccountList: [],
      myAccountByQuantity: {},
    },
  },
};

const FUNNEL = {
  slug: 'bio-complete-3-main',
  name: 'Bio Complete 3 — Main',
  active: true,
  steps: [
    { stepNumber: 1, slug: 'vsl', name: 'VSL', kind: 'landing' },
    { stepNumber: 2, slug: 'order', name: 'Order Form', kind: 'order-form' },
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
        <p data-field="packaging.singular">placeholder</p>
      </div>
    `);
    applyBindings(document, { formatters, resources });
    expect(document.querySelector('h1')!.textContent).toBe('Bio Complete 3');
    expect(document.querySelector('p')!.textContent).toBe('Bottle');
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

  it('drops javascript:/vbscript:/data: URLs on url-bearing attributes', () => {
    const hostile = {
      slug: 'evil',
      js: 'javascript:alert(1)',
      // Browsers strip tab/LF/CR while parsing the scheme; we must catch that too.
      jsObfuscated: 'java\tscript:alert(1)',
      jsLeading: '  \t javascript:alert(1)',
      vb: 'VbScript:msgbox(1)',
      dataHtml: 'data:text/html,<script>alert(1)</script>',
      safeRel: '/order-form',
      safeHttps: 'https://example.com/x',
    };
    const res = new Map<string, unknown>([['product:evil', hostile]]);
    setHtml(`
      <div data-gh-product="evil">
        <a id="a1" data-attr-href="js">x</a>
        <a id="a2" data-attr-href="jsObfuscated">x</a>
        <a id="a3" data-attr-href="jsLeading">x</a>
        <a id="a4" data-attr-href="vb">x</a>
        <iframe id="f1" data-attr-src="dataHtml"></iframe>
        <a id="ok1" data-attr-href="safeRel">x</a>
        <a id="ok2" data-attr-href="safeHttps">x</a>
      </div>
    `);
    applyBindings(document, { formatters, resources: res });
    expect(document.getElementById('a1')!.getAttribute('href')).toBeNull();
    expect(document.getElementById('a2')!.getAttribute('href')).toBeNull();
    expect(document.getElementById('a3')!.getAttribute('href')).toBeNull();
    expect(document.getElementById('a4')!.getAttribute('href')).toBeNull();
    expect(document.getElementById('f1')!.getAttribute('src')).toBeNull();
    expect(document.getElementById('ok1')!.getAttribute('href')).toBe('/order-form');
    expect(document.getElementById('ok2')!.getAttribute('href')).toBe('https://example.com/x');
  });

  it('refuses to bind iframe srcdoc (raw HTML island)', () => {
    const res = new Map<string, unknown>([
      ['product:evil', { slug: 'evil', html: '<img src=x onerror=alert(1)>' }],
    ]);
    setHtml(`
      <div data-gh-product="evil">
        <iframe id="f" data-attr-srcdoc="html"></iframe>
      </div>
    `);
    applyBindings(document, { formatters, resources: res });
    expect(document.getElementById('f')!.getAttribute('srcdoc')).toBeNull();
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
            <a data-attr-data-slug="slug"><span data-field="name"></span></a>
          </li>
        </template>
      </ol>
    `);
    applyBindings(document, { formatters, resources });
    const links = document.querySelectorAll('#steps li a');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('data-slug')).toBe('vsl');
    expect(links[0]!.querySelector('span')!.textContent).toBe('VSL');
    expect(links[1]!.getAttribute('data-slug')).toBe('order');
    expect(links[1]!.querySelector('span')!.textContent).toBe('Order Form');
  });

  it('resolves data-field via standardByQuantity by quantity key', () => {
    setHtml(`
      <article data-gh-product="enriched-product">
        <span id="price" data-field="variants.subscription.standardByQuantity.3.price">$0.00</span>
      </article>
    `);
    const resources = new Map<string, unknown>([['product:enriched-product', ENRICHED_PRODUCT]]);
    applyBindings(document, { formatters: new FormatRegistry(), resources });
    expect(document.getElementById('price')?.textContent).toBe('89.95');
  });

  it('iterates standardList via <template data-each>', () => {
    setHtml(`
      <section data-gh-product="enriched-product">
        <template data-each="variants.subscription.standardList">
          <li class="row" data-field="sku"></li>
        </template>
      </section>
    `);
    const resources = new Map<string, unknown>([['product:enriched-product', ENRICHED_PRODUCT]]);
    applyBindings(document, { formatters: new FormatRegistry(), resources });
    const rows = Array.from(document.querySelectorAll('.row')).map((el) => el.textContent);
    expect(rows).toEqual(['EP-SUB-3', 'EP-SUB-6']);
  });

  it('hides element when quantity is missing via data-if', () => {
    setHtml(`
      <article data-gh-product="enriched-product">
        <p id="nine" data-if="variants.subscription.standardByQuantity.9">9-pack available</p>
        <p id="six" data-if="variants.subscription.standardByQuantity.6">6-pack available</p>
      </article>
    `);
    const resources = new Map<string, unknown>([['product:enriched-product', ENRICHED_PRODUCT]]);
    applyBindings(document, { formatters: new FormatRegistry(), resources });
    expect((document.getElementById('nine') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('six') as HTMLElement).style.display).not.toBe('none');
  });
});

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
