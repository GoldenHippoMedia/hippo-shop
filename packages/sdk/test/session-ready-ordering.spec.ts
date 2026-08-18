import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cluster G Correction 3: `gh:session-ready` can be dispatched *synchronously*,
 * inside the very call that invokes `ensureSession` — an async function with no
 * awaits on its resolution path runs to completion before returning its
 * promise. This spec fakes exactly that session, so a listener registered
 * after the invoke never sees the event.
 */
const SYNC_STATE = { sessionId: 'sync-session', adopted: false, params: {} };

vi.mock('../src/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/session')>();
  return {
    ...actual,
    ensureSession: vi.fn(async () => {
      window.dispatchEvent(new CustomEvent('gh:session-ready', { detail: SYNC_STATE }));
      return SYNC_STATE;
    }),
  };
});

import { boot } from '../src/index';

const PRODUCT = {
  slug: 'p1',
  name: 'Sync Product',
  variants: {
    subscription: { standard: [{ price: 49.95 }], myAccount: [] },
    oneTime: { standard: [], myAccount: [] },
  },
};

function installScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'src') s.src = v;
    else s.setAttribute(`data-${k}`, v);
  }
  document.head.appendChild(s);
  return s;
}

describe('boot() — gh:session-ready registration order (Correction 3)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as { gh?: unknown }).gh;
    // Fake timers keep installAutoBind's setTimeout(0) initial bind pending,
    // so any bind observed below can only be the session-ready rebind.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rebinds on a gh:session-ready dispatched synchronously during boot', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(PRODUCT), { status: 200 }),
    );
    document.body.innerHTML =
      `<div data-gh-product="p1"><span data-field="name">placeholder</span></div>`;
    installScript({
      key: 'gh_pk_internal_test_abc123',
      brand: 'Gundry MD',
      'checkout-base': 'https://checkout.gundrymd.com',
      src: 'https://api-prod.goldenhippo.io/sdk/v4/gh.js',
    });

    expect(boot()).toBe(true);

    // No awaits: bind() reaches fetch() synchronously, and awaiting here would
    // let the deferred initial bind run and mask the defect.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      'https://api-prod.goldenhippo.io/public/v1/product/p1',
    );
    fetchSpy.mockRestore();
  });
});
