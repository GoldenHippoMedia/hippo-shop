import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GhRuntime } from '../src/runtime';
import { GhDataClient } from '../src/client';
import { createLogger } from '../src/log';
import { ensureSession, _resetForTests } from '../src/session';
import type { GhConfig } from '../src/config';

const CONFIG: GhConfig = {
  key: 'gh_pk_test_consumer_abc123',
  brand: 'Gundry MD',
  debug: false,
  apiBaseUrl: 'https://api-prod.goldenhippo.io',
  checkoutBase: null,
  cookieDomain: null,
  brandToken: null,
};

const PRODUCT = {
  slug: 'bio-complete-3',
  name: 'Bio Complete 3',
  variants: {
    subscription: { standard: [{ price: 49.95 }], myAccount: [] },
    oneTime: { standard: [], myAccount: [] },
  },
};

function freshClient(): GhDataClient {
  return new GhDataClient(CONFIG, createLogger(false));
}

describe('GhRuntime.bind', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    delete (window as { gh?: unknown }).gh;
  });

  it('fetches each unique resource exactly once and renders fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    document.body.innerHTML = `
      <div data-gh-product="bio-complete-3">
        <h1 data-field="name">x</h1>
        <p data-field="variants.subscription.standard.0.price" data-format="currency:USD:en-US"></p>
      </div>
      <div data-gh-product="bio-complete-3">
        <span data-field="name"></span>
      </div>
    `;
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
    await runtime.bind(document);
    expect(fetchSpy).toHaveBeenCalledOnce(); // deduped
    expect(document.querySelector('h1')!.textContent).toBe('Bio Complete 3');
    expect(document.querySelector('p')!.textContent).toBe('$49.95');
  });

  it('non-existent resources do not break other bindings', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/product/known')) {
        return Promise.resolve(new Response(JSON.stringify(PRODUCT), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ code: 'not_found', message: 'no' }), { status: 404 }));
    });
    document.body.innerHTML = `
      <div data-gh-product="known"><h1 data-field="name">x</h1></div>
      <div data-gh-product="unknown"><h2 data-field="name">untouched</h2></div>
    `;
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
    await runtime.bind(document);
    expect(document.querySelector('h1')!.textContent).toBe('Bio Complete 3');
    expect(document.querySelector('h2')!.textContent).toBe('untouched');
  });

  it('fires gh:bindings-ready exactly once', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    document.body.innerHTML = `<div data-gh-product="bio-complete-3"><span data-field="name"></span></div>`;
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
    const handler = vi.fn();
    window.addEventListener('gh:bindings-ready', handler);
    await runtime.bind(document);
    await runtime.bind(document);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('GhRuntime.refresh', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('clears cached data and refetches', async () => {
    const first = { ...PRODUCT, name: 'First' };
    const second = { ...PRODUCT, name: 'Second' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200 }));
    document.body.innerHTML = `<div data-gh-product="bio-complete-3"><h1 data-field="name"></h1></div>`;
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
    await runtime.bind(document);
    expect(document.querySelector('h1')!.textContent).toBe('First');

    await runtime.refresh();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(document.querySelector('h1')!.textContent).toBe('Second');
  });
});

describe('GhRuntime — observer (late-arriving DOM)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('re-binds when a new data-gh-* subtree is added', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
    await runtime.bind(document);
    runtime.attachObserver();

    const injected = document.createElement('div');
    injected.setAttribute('data-gh-product', 'bio-complete-3');
    injected.innerHTML = `<span id="late" data-field="name">placeholder</span>`;
    document.body.appendChild(injected);

    // Wait two microtasks: one for the observer to fire, one for the rebind to resolve.
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('late')!.textContent).toBe('Bio Complete 3');
    runtime.detachObserver();
  });
});

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
    const runtime = new GhRuntime({ logger: createLogger(false), client, config: CONFIG });
    const bindPromise = runtime.bind(document);

    // Synchronously after bind() starts: skeleton should be visible, content hidden.
    // The pre-fetch pass runs synchronously after marking loading state.
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
    const runtime = new GhRuntime({ logger: createLogger(false), client, config: CONFIG });
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
    const runtime = new GhRuntime({ logger: createLogger(false), client, config: CONFIG });
    await runtime.bind(document);
    expect((document.getElementById('content') as HTMLElement).style.display).not.toBe('none');

    // Calling refresh() must clear resourceStates as well as resources.
    await runtime.refresh();
    expect((document.getElementById('content') as HTMLElement).style.display).not.toBe('none');
  });

  it('getCachedFunnel returns null before load and the DTO after', async () => {
    const logger = createLogger(false);
    const client = {
      funnel: vi.fn().mockResolvedValue({
        slug: 'bio3-main',
        name: 'Bio Complete 3 main',
        active: true,
        steps: [{ id: 'a0Zstep1', slug: 'offer-selector', stepNumber: 1, name: 'Offer', kind: 'landing' }],
      }),
      destination: vi.fn(),
      product: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as GhDataClient;
    const runtime = new GhRuntime({ doc: document, win: window, logger, client, config: CONFIG });

    expect(runtime.getCachedFunnel('bio3-main')).toBeNull();
    document.body.innerHTML = '<div data-gh-funnel="bio3-main"></div>';
    await runtime.bind(document);
    expect(runtime.getCachedFunnel('bio3-main')?.steps[0]?.id).toBe('a0Zstep1');
  });
});

describe('GhRuntime — session-ready rebind (Cluster G Correction 3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('installSessionReadyRebind() rebinds synchronously when gh:session-ready fires', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    document.body.innerHTML =
      `<div data-gh-product="bio-complete-3"><span data-field="name"></span></div>`;
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });

    runtime.installSessionReadyRebind();
    window.dispatchEvent(new CustomEvent('gh:session-ready', { detail: {} }));

    // bind() reaches fetch() synchronously, so no awaits are needed.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('is idempotent — registering twice binds once per gh:session-ready', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient(), config: CONFIG });
    const bindSpy = vi.spyOn(runtime, 'bind');

    runtime.installSessionReadyRebind();
    runtime.installSessionReadyRebind();
    window.dispatchEvent(new CustomEvent('gh:session-ready', { detail: {} }));

    expect(bindSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GhRuntime — checkout link rebinding (Cluster G Correction 4)', () => {
  const CHECKOUT_CONFIG: GhConfig = { ...CONFIG, checkoutBase: 'https://checkout.gundrymd.com' };

  const DESTINATION = {
    id: 'a0D0m000002Dst1EAC',
    slug: 'bio3-3p-sub',
    name: 'Bio Complete 3 — 3-pack subscription',
    description: null,
    funnelSlug: 'bio-complete-3-main',
    funnelId: 'a0F0m000002Fnl1EAC',
    url: null,
    pricing: {
      familyOrBundleId: 'fam1',
      orderFormId: 'OF_123',
      sku: 'BIO3-3P-SUB',
      packageQuantity: 3,
      purchaseType: 'subscription',
      frequency: null,
      price: { amount: 49.95, currency: 'USD', savings: null },
      rebillPrice: { amount: 49.95, currency: 'USD', savings: null },
      outOfStock: false,
      restrictedCountryCodes: [],
      shipping: { domestic: 0, international: 0, freeShippingThreshold: null },
      bumpOffers: [],
      checkoutOverrideUrl: null,
    },
  };

  const OTHER_DESTINATION = {
    ...DESTINATION,
    id: 'a0D0m000002Dst2EAC',
    slug: 'bio3-6p-sub',
    pricing: { ...DESTINATION.pricing, orderFormId: 'OF_OTHER', sku: 'BIO3-6P-SUB' },
  };

  function mockDestinationFetch(): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const body = url.endsWith('/destination/bio3-6p-sub') ? OTHER_DESTINATION : DESTINATION;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
  }

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    _resetForTests();

    // Manual cookie jar: jsdom drops writes carrying a Domain attribute.
    const jar: Record<string, string> = {};
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      },
      set(cookieStr: string) {
        const parts = cookieStr.split(';');
        const [nameValue] = parts;
        const [name, value] = (nameValue ?? '').split('=');
        const trimmedName = (name ?? '').trim();
        if (parts.some((p) => p.trim().startsWith('Max-Age=0'))) delete jar[trimmedName];
        else jar[trimmedName] = value ?? '';
      },
    });

    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        href: 'https://info.gundrymd.com/lp?sessionid=sess-42',
        search: '?sessionid=sess-42',
        hostname: 'info.gundrymd.com',
        protocol: 'https:',
      },
      writable: true,
    });
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });

    // Resolve a real session: checkout bindings leave href="#" while the
    // session is unresolved, so these tests need one settled first.
    const sessionClient = freshClient();
    sessionClient.postJson = vi.fn().mockResolvedValue({}) as never;
    await ensureSession(CHECKOUT_CONFIG, sessionClient);
  });

  it('rebinds a checkout link when its destination loads out of band', async () => {
    mockDestinationFetch();
    document.body.innerHTML = `<a id="buy" data-gh-checkout="bio3-3p-sub" href="#">Buy</a>`;
    const runtime = new GhRuntime({
      logger: createLogger(false), client: freshClient(), config: CHECKOUT_CONFIG,
    });

    // The fire-and-forget path: gh.checkoutUrl(slug) and bindOne on a cold
    // page both warm a destination with no bind pass wrapped around them.
    await runtime.ensureDestination('bio3-3p-sub');
    await new Promise((r) => setTimeout(r, 20));

    const href = document.getElementById('buy')!.getAttribute('href')!;
    expect(href).not.toBe('#');
    expect(href).toContain('order_form_id=OF_123');
    expect(href).toContain('sessionid=sess-42');
  });

  it('rebinds when data-gh-checkout changes to a different slug', async () => {
    mockDestinationFetch();
    document.body.innerHTML = `<a id="buy" data-gh-checkout="bio3-3p-sub" href="#">Buy</a>`;
    const runtime = new GhRuntime({
      logger: createLogger(false), client: freshClient(), config: CHECKOUT_CONFIG,
    });
    await runtime.bind(document);
    expect(document.getElementById('buy')!.getAttribute('href')).toContain('order_form_id=OF_123');

    runtime.attachObserver();
    document.getElementById('buy')!.setAttribute('data-gh-checkout', 'bio3-6p-sub');
    await new Promise((r) => setTimeout(r, 20));

    expect(document.getElementById('buy')!.getAttribute('href')).toContain('order_form_id=OF_OTHER');
    runtime.detachObserver();
  });

  it('rebinds when data-gh-step changes', async () => {
    mockDestinationFetch();
    document.body.innerHTML = `<div id="step" data-gh-step="vsl"></div>`;
    const runtime = new GhRuntime({
      logger: createLogger(false), client: freshClient(), config: CHECKOUT_CONFIG,
    });
    await runtime.bind(document);
    runtime.attachObserver();
    const bindSpy = vi.spyOn(runtime, 'bind');

    document.getElementById('step')!.setAttribute('data-gh-step', 'order-form');
    await new Promise((r) => setTimeout(r, 20));

    expect(bindSpy).toHaveBeenCalled();
    runtime.detachObserver();
  });
});
