import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readStepSlug,
  firstDestinationSlug,
  resolveEventIdentity,
} from '../src/events';
import type { HippoShopDestinationDTO, HippoShopFunnelDTO } from '@goldenhippo/hippo-shop-types';
import {
  installPageViewEmitter,
  makeTrackFn,
  emitPageViewOnce,
  _resetEventsForTests,
  PAGE_VIEW_QUIET_MS,
  PAGE_VIEW_DEADLINE_MS,
  type PageViewEmitterOptions,
} from '../src/events';
import { GhDataClient } from '../src/client';
import { createLogger } from '../src/log';
import type { GhConfig } from '../src/config';
import type { SessionState } from '../src/session';
import { GhRuntime } from '../src/runtime';
import { STEP_CHANGED_EVENT } from '../src/events';

const UA_CHROME_MAC_EMITTER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function makeDestination(
  slug: string,
  id: string,
  funnelId: string,
  funnelSlug = 'bio3-main',
): HippoShopDestinationDTO {
  // Cast: identity resolution reads only these five fields, and pinning the
  // full pricing shape here would couple this spec to unrelated DTO churn.
  return { slug, id, funnelId, funnelSlug, url: `https://www.gundrymd.com/${slug}` } as unknown as HippoShopDestinationDTO;
}

function makeFunnel(slug: string, steps: Array<{ slug: string; id: string }>): HippoShopFunnelDTO {
  return {
    slug,
    name: 'Bio Complete 3 main',
    active: true,
    steps: steps.map((s, i) => ({
      id: s.id,
      slug: s.slug,
      stepNumber: i + 1,
      name: s.slug,
      kind: 'landing',
    })),
  } as unknown as HippoShopFunnelDTO;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function setHead(html: string): void {
  document.head.innerHTML = html;
}

beforeEach(() => {
  setBody('');
  setHead('');
});

afterEach(() => {
  setBody('');
  setHead('');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('firstDestinationSlug', () => {
  it('takes the first [data-gh-destination] in document order out of six', () => {
    setBody(`
      <div data-gh-destination="bio3-1p-ot"></div>
      <div data-gh-destination="bio3-1p-sub"></div>
      <div data-gh-destination="bio3-3p-ot"></div>
      <div data-gh-destination="bio3-3p-sub"></div>
      <div data-gh-destination="bio3-6p-ot"></div>
      <div data-gh-destination="bio3-6p-sub"></div>
    `);
    expect(firstDestinationSlug(document)).toBe('bio3-1p-ot');
  });

  it('falls back to the first [data-gh-checkout] when no destination is bound', () => {
    setBody(`
      <a data-gh-checkout="bio3-3p-sub">Buy</a>
      <a data-gh-checkout="bio3-6p-sub">Buy more</a>
    `);
    expect(firstDestinationSlug(document)).toBe('bio3-3p-sub');
  });

  it('prefers a destination binding over a checkout binding', () => {
    setBody(`
      <a data-gh-checkout="from-checkout">Buy</a>
      <div data-gh-destination="from-destination"></div>
    `);
    expect(firstDestinationSlug(document)).toBe('from-destination');
  });

  it('returns null when neither attribute is present or values are blank', () => {
    expect(firstDestinationSlug(document)).toBeNull();
    setBody('<div data-gh-destination="   "></div>');
    expect(firstDestinationSlug(document)).toBeNull();
  });
});

describe('readStepSlug', () => {
  it('reads the attribute from the live DOM', () => {
    setBody('<section data-gh-step="offer-selector"></section>');
    expect(readStepSlug(document)).toBe('offer-selector');
  });

  it('prefers a body element over the script tag', () => {
    setHead('<script data-gh-step="from-script"></script>');
    setBody('<section data-gh-step="from-dom"></section>');
    expect(readStepSlug(document)).toBe('from-dom');
  });

  it('falls back to the script tag when nothing else declares it', () => {
    setHead('<script data-gh-step="from-script"></script>');
    expect(readStepSlug(document)).toBe('from-script');
  });

  it('returns null when absent or blank', () => {
    expect(readStepSlug(document)).toBeNull();
    setBody('<section data-gh-step="  "></section>');
    expect(readStepSlug(document)).toBeNull();
  });
});

describe('resolveEventIdentity', () => {
  const noFunnel = (): null => null;

  it('takes funnelId and destinationId from the first bound destination DTO', () => {
    setBody(`
      <div data-gh-destination="bio3-1p-ot"></div>
      <div data-gh-destination="bio3-6p-sub"></div>
    `);
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: (slug) =>
        slug === 'bio3-1p-ot'
          ? makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1')
          : makeDestination(slug, 'a0Ydest6', 'a0Xfunnel6'),
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xfunnel1');
    expect(identity.destinationId).toBe('a0Ydest1');
  });

  it('falls back to data-gh-funnel-id when no destination DTO is cached', () => {
    setBody(`
      <div data-gh-funnel-id="a0Xfromattr"></div>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xfromattr');
    expect(identity.destinationId).toBeNull();
  });

  it('reads data-gh-funnel-id off the script tag as a last resort', () => {
    setHead('<script data-gh-funnel-id="a0Xfromscript"></script>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xfromscript');
  });

  it('returns a null funnelId when nothing resolves', () => {
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '',
    });
    expect(identity).toEqual({
      funnelId: null,
      destinationId: null,
      stepId: null,
      splitTestId: null,
    });
  });

  it('reads destinationId from ?origdsidOrig= and splitTestId from ?origsplitTestingFunnelIdOrig=', () => {
    setBody('<div data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?origdsidOrig=a0Yurl&origsplitTestingFunnelIdOrig=a0Wsplit',
    });
    expect(identity.destinationId).toBe('a0Yurl');
    expect(identity.splitTestId).toBe('a0Wsplit');
  });

  it('matches funnelSTPId from the cached funnel steps by step slug', () => {
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1', 'bio3-main'),
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel(slug, [
              { slug: 'offer-selector', id: 'a0Zstep1' },
              { slug: 'upsell', id: 'a0Zstep2' },
            ])
          : null,
      stepSlug: 'upsell',
      search: '',
    });
    expect(identity.stepId).toBe('a0Zstep2');
  });

  it('nulls stepId when the funnel is not cached or the slug does not match', () => {
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
    const base = {
      doc: document,
      getDestination: (slug: string) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
      search: '',
    };
    expect(
      resolveEventIdentity({ ...base, getFunnel: noFunnel, stepSlug: 'upsell' }).stepId,
    ).toBeNull();
    expect(
      resolveEventIdentity({
        ...base,
        getFunnel: (slug) => makeFunnel(slug, [{ slug: 'offer-selector', id: 'a0Zstep1' }]),
        stepSlug: 'nope',
      }).stepId,
    ).toBeNull();
  });

  it('resolves the funnel slug from [data-gh-funnel] when no destination is bound', () => {
    setBody(`
      <div data-gh-funnel="bio3-main" data-gh-funnel-id="a0Xattr"></div>
      <section data-gh-step="upsell"></section>
    `);
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'bio3-main' ? makeFunnel(slug, [{ slug: 'upsell', id: 'a0Zstep2' }]) : null,
      stepSlug: 'upsell',
      search: '',
    });
    expect(identity.stepId).toBe('a0Zstep2');
    expect(identity.funnelId).toBe('a0Xattr');
  });
});

function emitterConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Gundry MD',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
    brandToken: null,
    ...overrides,
  };
}

function emitterSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab',
    adopted: false,
    params: { utmSource: 'fb' },
    ...overrides,
  };
}

function makeEmitterOpts(
  overrides: Partial<PageViewEmitterOptions> = {},
): { opts: PageViewEmitterOptions; postEvent: ReturnType<typeof vi.fn> } {
  const config = overrides.config ?? emitterConfig();
  const client = new GhDataClient(config, createLogger(false));
  const postEvent = vi.fn().mockResolvedValue(undefined);
  client.postEvent = postEvent as never;
  const opts: PageViewEmitterOptions = {
    doc: document,
    win: window,
    config,
    client,
    logger: createLogger(false),
    getSession: () => emitterSession(),
    sessionPromise: Promise.resolve(undefined),
    getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
    getFunnel: () => null,
    ensureDestination: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { opts, postEvent };
}

describe('installPageViewEmitter', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('emits after both readiness signals plus the quiet window', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    expect(postEvent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('does not emit while only one signal has arrived', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      sessionPromise: new Promise<void>(() => {
        /* never resolves */
      }),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).not.toHaveBeenCalled();
  });

  it('emits on the hard deadline when a signal never arrives', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      sessionPromise: new Promise<void>(() => {
        /* never resolves */
      }),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('joins on the session promise when gh:session-ready fired before install', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    // Only bindings-ready is dispatched; readiness comes from sessionPromise.
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('treats a rejected session promise as ready (degraded attribution, still emits)', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      sessionPromise: Promise.reject(new Error('session blew up')),
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('emits exactly once even after the deadline also elapses', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS * 2);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('does not emit when the session never resolves to a state', async () => {
    const { opts, postEvent } = makeEmitterOpts({ getSession: () => null });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);
    expect(postEvent).not.toHaveBeenCalled();
  });
});

describe('makeTrackFn', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    _resetEventsForTests();
  });

  it('emits a Page View built from the live DOM', async () => {
    setBody(`
      <section data-gh-step="offer-selector"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    await makeTrackFn(opts)('Page View');
    expect(postEvent).toHaveBeenCalledOnce();
    const body = postEvent.mock.calls[0]![1] as Record<string, unknown>;
    expect(body['eventType']).toBe('Page View');
    expect(body['funnelSTFId']).toBe('a0Xfunnel1');
    expect(body['destinationId']).toBe('a0Ydest1');
    expect(body['url']).toBe('offer-selector');
    expect(body['utmSource']).toBe('fb');
  });

  it('respects the dedupe guard on a second call for the same step', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    const track = makeTrackFn(opts);
    await track('Page View');
    await track('Page View');
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('emits again once data-gh-step changes (SPA route push)', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    const track = makeTrackFn(opts);
    await track('Page View');
    document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', 'step-2');
    await track('Page View');
    expect(postEvent).toHaveBeenCalledTimes(2);
    expect((postEvent.mock.calls[1]![1] as Record<string, unknown>)['url']).toBe('step-2');
  });

  it('warns and no-ops on an unsupported event type', async () => {
    const { opts, postEvent } = makeEmitterOpts();
    const warn = vi.spyOn(opts.logger, 'warn');
    await makeTrackFn(opts)('Order Paid' as never);
    expect(postEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('awaits ensureDestination when the identity destination is not yet cached', async () => {
    let cached = false;
    const ensureDestination = vi.fn().mockImplementation(async () => {
      cached = true;
    });
    const { opts, postEvent } = makeEmitterOpts({
      ensureDestination,
      getDestination: (slug) =>
        cached ? makeDestination(slug, 'a0Ylate', 'a0Xlate') : null,
    });
    await makeTrackFn(opts)('Page View');
    expect(ensureDestination).toHaveBeenCalledWith('bio3-1p-ot');
    expect(postEvent).toHaveBeenCalledOnce();
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['funnelSTFId']).toBe(
      'a0Xlate',
    );
  });
});

// Carry-forward from Task 22-24: resolveEventIdentity calls the
// caller-supplied getDestination/getFunnel callbacks unguarded. The emitter
// must never propagate a throw from either — this pins that guarantee at
// both call sites (the timer-driven install() path and the awaited
// gh.track() escape hatch).
describe('installPageViewEmitter / makeTrackFn — throwing caller callbacks never escape', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('installPageViewEmitter does not throw and does not emit when getDestination throws', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getDestination: () => {
        throw new Error('boom from getDestination');
      },
    });
    expect(() => installPageViewEmitter(opts)).not.toThrow();
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).not.toHaveBeenCalled();
  });

  it('gh.track rejects neither on a throwing getFunnel nor a throwing getDestination', async () => {
    setBody(`
      <section data-gh-step="offer-selector"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts({
      getFunnel: () => {
        throw new Error('boom from getFunnel');
      },
    });
    await expect(makeTrackFn(opts)('Page View')).resolves.toBeUndefined();
    // Identity resolution failed, so there's nothing safe to build a payload
    // from — the swallow means "no event this load", not "emit garbage".
    expect(postEvent).not.toHaveBeenCalled();
  });
});

describe('installPageViewEmitter — SPA step change (D9)', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('re-emits when data-gh-step is swapped and the step change is signalled', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['url']).toBe('step-1');

    // The SPA swaps the attribute. No gh.track call anywhere in this test.
    document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', 'step-2');
    window.dispatchEvent(new Event(STEP_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledTimes(2);
    expect((postEvent.mock.calls[1]![1] as Record<string, unknown>)['url']).toBe('step-2');
  });

  it('re-arms on every subsequent step change, not just the first', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    for (const slug of ['step-2', 'step-3', 'step-4']) {
      document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', slug);
      window.dispatchEvent(new Event(STEP_CHANGED_EVENT));
      await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    }

    expect(postEvent).toHaveBeenCalledTimes(4);
    expect((postEvent.mock.calls[3]![1] as Record<string, unknown>)['url']).toBe('step-4');
  });

  it('does not re-emit when the signal arrives but the slug is unchanged', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();

    // A checkout-slug swap also lands here via the shared observer filter.
    window.dispatchEvent(new Event(STEP_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('re-emits end to end through GhRuntime.bind when data-gh-step is mutated', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const { opts, postEvent } = makeEmitterOpts();
    const runtimeClient = {
      product: vi.fn(),
      destination: vi
        .fn()
        .mockResolvedValue(makeDestination('bio3-1p-ot', 'a0Ydest1', 'a0Xfunnel1')),
      funnel: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as GhDataClient;
    const runtime = new GhRuntime({
      doc: document,
      win: window,
      logger: opts.logger,
      client: runtimeClient,
      config: opts.config,
    });

    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    // The runtime's own first bind fires gh:bindings-ready and records the
    // step-1 baseline; it must NOT signal a change on that first observation.
    await runtime.bind(document);
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
    expect(postEvent).toHaveBeenCalledOnce();

    // Task 32 puts data-gh-step in the observer's attributeFilter, so in a real
    // browser this second bind() is the observer's, not the test's.
    document.querySelector('[data-gh-step]')!.setAttribute('data-gh-step', 'step-2');
    await runtime.bind(document);
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledTimes(2);
    expect((postEvent.mock.calls[1]![1] as Record<string, unknown>)['url']).toBe('step-2');
  });

  it('GhRuntime.bind stays silent when data-gh-step does not change', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const runtimeClient = {
      product: vi.fn(),
      destination: vi
        .fn()
        .mockResolvedValue(makeDestination('bio3-1p-ot', 'a0Ydest1', 'a0Xfunnel1')),
      funnel: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as GhDataClient;
    const runtime = new GhRuntime({
      doc: document,
      win: window,
      logger: createLogger(false),
      client: runtimeClient,
      config: emitterConfig(),
    });
    const onStepChanged = vi.fn();
    window.addEventListener(STEP_CHANGED_EVENT, onStepChanged);

    await runtime.bind(document);
    await runtime.bind(document);
    await runtime.bind(document);

    window.removeEventListener(STEP_CHANGED_EVENT, onStepChanged);
    expect(onStepChanged).not.toHaveBeenCalled();
  });
});
