import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GhRuntime } from '../src/runtime';
import { GhDataClient } from '../src/client';
import { createLogger } from '../src/log';
import type { GhConfig } from '../src/config';

const CONFIG: GhConfig = {
  key: 'gh_pk_test_consumer_abc123',
  brand: 'Gundry MD',
  debug: false,
  apiBaseUrl: 'https://api-prod.goldenhippo.io',
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
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient() });
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
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient() });
    await runtime.bind(document);
    expect(document.querySelector('h1')!.textContent).toBe('Bio Complete 3');
    expect(document.querySelector('h2')!.textContent).toBe('untouched');
  });

  it('fires gh:bindings-ready exactly once', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    document.body.innerHTML = `<div data-gh-product="bio-complete-3"><span data-field="name"></span></div>`;
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient() });
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
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient() });
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
    const runtime = new GhRuntime({ logger: createLogger(false), client: freshClient() });
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
