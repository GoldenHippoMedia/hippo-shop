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

function makeFunnel(
  slug: string,
  steps: Array<{ slug: string; id: string }>,
  id = `a0Xfunnel-${slug}`,
): HippoShopFunnelDTO {
  return {
    id,
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

/** Mirrors checkout.spec.ts's helper: override window.location.search for one test. */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      search,
      href: `https://sf.gundrymd.com/offer${search}`,
    },
    writable: true,
  });
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

  // A blank value must not defeat the tier: bindings.ts collectResources skips
  // blanks and binds the other five offers, so the page looks perfect while
  // funnel-event identity silently gives up.
  it('skips a blank data-gh-destination and keeps searching the tier', () => {
    setBody(`
      <div data-gh-destination="   "></div>
      <div data-gh-destination="bio3-1p-ot"></div>
      <div data-gh-destination="bio3-3p-sub"></div>
    `);
    expect(firstDestinationSlug(document)).toBe('bio3-1p-ot');
  });

  it('skips a blank data-gh-checkout and keeps searching the fallback tier', () => {
    setBody(`
      <a data-gh-checkout=""></a>
      <a data-gh-checkout="bio3-3p-sub">Buy</a>
    `);
    expect(firstDestinationSlug(document)).toBe('bio3-3p-sub');
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

  // Same blank-value trap as firstDestinationSlug, on the page tier of
  // readAttrPreferringPage: a blank first element must not hand the answer
  // to the script tag.
  it('skips a blank page element instead of falling through to the script tag', () => {
    setHead('<script data-gh-step="from-script"></script>');
    setBody(`
      <section data-gh-step=" "></section>
      <section data-gh-step="offer-selector"></section>
    `);
    expect(readStepSlug(document)).toBe('offer-selector');
  });
});

describe('resolveEventIdentity', () => {
  const noFunnel = (): null => null;

  // The destination DTO is still the primary source of `destinationId` — and
  // is no longer a source of `funnelId` at all. A page binding offers says
  // which offers it sells, not which funnel it is a step of.
  it('takes destinationId from the first bound destination DTO, but never funnelId', () => {
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
    expect(identity.destinationId).toBe('a0Ydest1');
    // Nothing on this page declares a funnel, so there is no funnel identity —
    // and a null funnelId suppresses the event downstream, which is the point.
    expect(identity.funnelId).toBeNull();
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

  // The page must DECLARE the funnel: a bound destination's funnelSlug is no
  // longer a source, because the resolved funnel's id now feeds funnelId and
  // an arbitrary offer must not be able to establish funnel identity.
  it('matches funnelSTPId from the cached funnel steps by step slug', () => {
    setBody('<div data-gh-funnel="bio3-main" data-gh-destination="bio3-1p-ot"></div>');
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
    // Two steps, deliberately: a ONE-step funnel has its own last-resort
    // fallback to that step, so a single-step fixture here would prove nothing
    // about slug matching.
    expect(
      resolveEventIdentity({
        ...base,
        getFunnel: (slug) =>
          makeFunnel(slug, [
            { slug: 'offer-selector', id: 'a0Zstep1' },
            { slug: 'upsell', id: 'a0Zstep2' },
          ]),
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
      // Two steps so the match is provably by slug, not the single-step fallback.
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
    expect(identity.funnelId).toBe('a0Xattr');
  });

  it('funnelId falls back to ?origmainFunnelIdOrig= with no DTO and no attribute', () => {
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?origmainFunnelIdOrig=a0Xurl',
    });
    expect(identity.funnelId).toBe('a0Xurl');
  });

  // A page that names its funnel by SLUG is asserting membership just as much
  // as one that hardcodes the Salesforce id — but the id is what the upstream
  // requires, and it drops events whose funnelSTFId is blank. `funnel.id`
  // closes that gap so `data-gh-funnel` alone is a usable declaration.
  it('resolves funnelId from the funnel DTO when the page declares only data-gh-funnel', () => {
    setBody('<div data-gh-funnel="bio3-main"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel('bio3-main', [{ slug: 'lp', id: 'a0Zlp' }], 'a0XfromDto')
          : null,
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0XfromDto');
  });

  it('data-gh-funnel-id outranks the funnel DTO id', () => {
    setBody('<div data-gh-funnel-id="a0Xattr" data-gh-funnel="bio3-main"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: () => makeFunnel('bio3-main', [{ slug: 'lp', id: 'a0Zlp' }], 'a0XfromDto'),
      stepSlug: null,
      search: '',
    });
    expect(identity.funnelId).toBe('a0Xattr');
  });

  // The DTO is live; ?origmainFunnelIdOrig= is a snapshot minted at /fst and
  // carried through later hops — same rule the stepId fallback follows.
  it('the funnel DTO id outranks ?origmainFunnelIdOrig=', () => {
    setBody('<div data-gh-funnel="bio3-main"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: () => makeFunnel('bio3-main', [{ slug: 'lp', id: 'a0Zlp' }], 'a0XfromDto'),
      stepSlug: null,
      search: '?origmainFunnelIdOrig=a0Xurl',
    });
    expect(identity.funnelId).toBe('a0XfromDto');
  });

  // The /fst funnel-slug params are what make the CMS path resolvable without
  // any author attribute at all.
  it('resolves the funnel from ?origuidOrig= and takes its id', () => {
    setBody('<div></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'ultimateh2_cms_osstart_260520_p'
          ? makeFunnel(
              'ultimateh2_cms_osstart_260520_p',
              [{ slug: 'os260520a_sh_ap', id: 'a0Zstep' }],
              'a0XfromUid',
            )
          : null,
      stepSlug: null,
      search: '?origuidOrig=ultimateh2_cms_osstart_260520_p',
      pathname: '/fp/os260520a_sh_ap',
    });
    expect(identity.funnelId).toBe('a0XfromUid');
    expect(identity.stepId).toBe('a0Zstep');
  });

  it('data-gh-funnel-id wins over ?origmainFunnelIdOrig=', () => {
    setBody('<div data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?origmainFunnelIdOrig=a0Xurl',
    });
    expect(identity.funnelId).toBe('a0Xattr');
  });

  // Reversed precedence, deliberately: a bound destination's `funnelId` names
  // that destination's OWN funnel, not the funnel this page view belongs to.
  // On a selector page binding twelve offers the "first" one is arbitrary, so
  // the DTO is not consulted for funnel identity at all — only what the page
  // (data-gh-funnel-id) or the /fst hop (?origmainFunnelIdOrig=) asserts.
  it('data-gh-funnel-id wins over ?origmainFunnelIdOrig=, and a destination DTO funnelId is ignored entirely', () => {
    setBody(`
      <div data-gh-funnel-id="a0Xattr"></div>
      <div data-gh-destination="bio3-1p-ot"></div>
    `);
    const withAttr = resolveEventIdentity({
      doc: document,
      getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?origmainFunnelIdOrig=a0Xurl',
    });
    expect(withAttr.funnelId).toBe('a0Xattr');
    // The DTO is still the destinationId source — only funnel identity moved.
    expect(withAttr.destinationId).toBe('a0Ydest1');

    // Drop the attribute and the URL param takes over — the DTO's funnelId
    // never enters the ranking, so it cannot win by default either.
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
    const withoutAttr = resolveEventIdentity({
      doc: document,
      getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?origmainFunnelIdOrig=a0Xurl',
    });
    expect(withoutAttr.funnelId).toBe('a0Xurl');
  });

  it('destinationId falls back to ?dsid=; origdsidOrig wins when both are present', () => {
    expect(
      resolveEventIdentity({
        doc: document,
        getDestination: () => null,
        getFunnel: noFunnel,
        stepSlug: null,
        search: '?dsid=a0Yinternal',
      }).destinationId,
    ).toBe('a0Yinternal');
    expect(
      resolveEventIdentity({
        doc: document,
        getDestination: () => null,
        getFunnel: noFunnel,
        stepSlug: null,
        search: '?origdsidOrig=a0Yorig&dsid=a0Yinternal',
      }).destinationId,
    ).toBe('a0Yorig');
  });

  // The regression test this fix exists for: a destination-bound page with no
  // cached funnel DTO must still resolve funnelSTPId from the /fst-minted URL
  // param rather than drop it to null.
  it('stepId falls back to ?funnelSTPId= when the funnel DTO is not cached', () => {
    setBody('<div data-gh-destination="bio3-1p-ot"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1'),
      getFunnel: noFunnel,
      stepSlug: 'offer-selector',
      search: '?funnelSTPId=a0Zstep1',
    });
    expect(identity.stepId).toBe('a0Zstep1');
  });

  it('a resolved funnel-step DTO id wins over a conflicting ?funnelSTPId= (locks the staleness precedence)', () => {
    setBody('<div data-gh-funnel="bio3-main" data-gh-destination="bio3-1p-ot"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: (slug) => makeDestination(slug, 'a0Ydest1', 'a0Xfunnel1', 'bio3-main'),
      // Two steps so the win is provably the slug match, not the single-step
      // fallback (which ranks BELOW ?funnelSTPId= and would invert the proof).
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel(slug, [
              { slug: 'offer-selector', id: 'a0Zstep1' },
              { slug: 'upsell', id: 'a0Zstep2' },
            ])
          : null,
      stepSlug: 'upsell',
      search: '?funnelSTPId=a0Zstep1',
    });
    expect(identity.stepId).toBe('a0Zstep2');
  });

  it('?ORIGDSIDORIG=X does NOT resolve — case-sensitivity is deliberate', () => {
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: noFunnel,
      stepSlug: null,
      search: '?ORIGDSIDORIG=X',
    });
    expect(identity.destinationId).toBeNull();
  });

  // --- URL-path step matching -------------------------------------------
  // What makes a Superfunnel page resolvable with no data-gh-step at all: the
  // CMS funnel's own step slugs already match the URL's last path segment.

  it('matches a step by the last URL path segment when no data-gh-step is declared', () => {
    setBody('<div data-gh-funnel="ultimateh2_cms" data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'ultimateh2_cms'
          ? makeFunnel(slug, [
              { slug: 'os260520a_sh_ap', id: 'a0Zstep7' },
              { slug: 'checkout', id: 'a0Zstep8' },
            ])
          : null,
      stepSlug: null,
      search: '',
      pathname: '/fp/os260520a_sh_ap',
    });
    expect(identity.stepId).toBe('a0Zstep7');
  });

  it('strips a file extension off the path segment before matching (/offer-selector.html)', () => {
    setBody('<div data-gh-funnel="bio3-main" data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel(slug, [
              { slug: 'offer-selector', id: 'a0Zstep1' },
              { slug: 'upsell', id: 'a0Zstep2' },
            ])
          : null,
      stepSlug: null,
      search: '',
      pathname: '/offer-selector.html',
    });
    expect(identity.stepId).toBe('a0Zstep1');
  });

  it('prefers a declared data-gh-step over the URL path segment', () => {
    setBody('<div data-gh-funnel="bio3-main" data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'bio3-main'
          ? makeFunnel(slug, [
              { slug: 'offer-selector', id: 'a0Zstep1' },
              { slug: 'upsell', id: 'a0Zstep2' },
            ])
          : null,
      stepSlug: 'upsell',
      search: '',
      pathname: '/offer-selector',
    });
    expect(identity.stepId).toBe('a0Zstep2');
  });

  // --- Single-step fallback ---------------------------------------------
  // A one-step Salesforce funnel is how a whole pre-purchase funnel built
  // elsewhere (Superfunnel) gets modelled, so "the only step" is the right
  // answer when nothing else matched — but only as the LAST resort, below the
  // /fst-minted ?funnelSTPId=.

  it('falls back to the funnel’s only step when neither the step slug nor the path matched', () => {
    setBody('<div data-gh-funnel="superfunnel-1" data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'superfunnel-1' ? makeFunnel(slug, [{ slug: 'the-only-step', id: 'a0Zonly' }]) : null,
      stepSlug: 'nothing-like-it',
      search: '',
      pathname: '/nor/this',
    });
    expect(identity.stepId).toBe('a0Zonly');
  });

  it('?funnelSTPId= outranks the single-step fallback', () => {
    setBody('<div data-gh-funnel="superfunnel-1" data-gh-funnel-id="a0Xattr"></div>');
    const identity = resolveEventIdentity({
      doc: document,
      getDestination: () => null,
      getFunnel: (slug) =>
        slug === 'superfunnel-1' ? makeFunnel(slug, [{ slug: 'the-only-step', id: 'a0Zonly' }]) : null,
      stepSlug: null,
      search: '?funnelSTPId=a0Zfromurl',
      pathname: '/nor/this',
    });
    expect(identity.stepId).toBe('a0Zfromurl');
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
    // Default to a RESUMED session with no server echo: `isNew: true` would
    // add a `New Session` emission to every test below, and `data` non-null
    // would change the posted body's `affParams`. Both are opted into
    // explicitly by the tests that are about them.
    isNew: false,
    data: null,
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
    ensureFunnel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { opts, postEvent };
}

/**
 * The funnel identity every emitter fixture below declares on the page.
 *
 * A destination DTO's `funnelId` is no longer a source of funnel identity, so
 * a page that binds only `data-gh-destination` emits nothing at all. These
 * specs are about emitter TIMING, so each fixture page states its funnel the
 * way a real funnel step does — with the attribute.
 */
const EMITTER_FUNNEL_ATTR = 'data-gh-funnel-id="a0Xfunnel1"';

describe('installPageViewEmitter', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody(`<div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>`);
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
    setSearch('');
  });

  it('emits one Page View with all five SFIDs from URL params alone when the page binds nothing', async () => {
    setBody(''); // zero bindings: no destination, no checkout, no funnel-id attr, no step
    setSearch(
      '?origmainFunnelIdOrig=a0Xfunnel1&origdsidOrig=a0Ydest1&funnelSTPId=a0Zstep1&origsplitTestingFunnelIdOrig=a0Wsplit1',
    );
    const { opts, postEvent } = makeEmitterOpts({ getDestination: () => null });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
    const [, event] = postEvent.mock.calls[0]!;
    expect(event.funnelSTFId).toBe('a0Xfunnel1');
    expect(event.mainFunnelId).toBe('a0Xfunnel1');
    expect(event.mainFunnelId).toBe(event.funnelSTFId);
    expect(event.destinationId).toBe('a0Ydest1');
    expect(event.funnelSTPId).toBe('a0Zstep1');
    expect(event.splitTestingFunnelId).toBe('a0Wsplit1');
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

  it('C1: does not fire against a still-parsing document, then fires once the join is retried', async () => {
    const readyStateSpy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    try {
      const { opts, postEvent } = makeEmitterOpts();
      installPageViewEmitter(opts);

      // Both readiness signals arrive while the document is still parsing —
      // the documented head-script install, session POST resolving before
      // DOMContentLoaded.
      window.dispatchEvent(new Event('gh:session-ready'));
      window.dispatchEvent(new Event('gh:bindings-ready'));
      await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
      expect(postEvent).not.toHaveBeenCalled();

      // The document finishes parsing; the browser fires `readystatechange`.
      readyStateSpy.mockReturnValue('complete');
      document.dispatchEvent(new Event('readystatechange'));
      await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

      expect(postEvent).toHaveBeenCalledOnce();
      const [, event] = postEvent.mock.calls[0]!;
      expect(event.destinationId).toBe('a0Ydest1');
      expect(event.mainFunnelId).toBe('a0Xfunnel1');
    } finally {
      readyStateSpy.mockRestore();
    }
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
    setBody(`<div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>`);
  });
  afterEach(() => {
    _resetEventsForTests();
  });

  it('emits a Page View built from the live DOM', async () => {
    setBody(`
      <section data-gh-step="offer-selector"></section>
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
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
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
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
    // The proof that the await happened is the LATE-cached DTO's id landing in
    // the payload. It is read off `destinationId`, not `funnelSTFId`: funnel
    // identity no longer comes from the destination DTO, so that field now
    // reports the page's own data-gh-funnel-id no matter when the DTO arrived.
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['destinationId']).toBe(
      'a0Ylate',
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
    setBody(`<div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>`);
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
      <section data-gh-step="offer-selector" data-gh-funnel="bio3-main"></section>
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
    `);
    const { opts, postEvent } = makeEmitterOpts({
      // data-gh-funnel is what makes getFunnel reachable at all: without a
      // declared funnel slug the emitter never consults it, and this test
      // would pass for the wrong reason.
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
    setBody(`<div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>`);
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  it('re-emits when data-gh-step is swapped and the step change is signalled', async () => {
    setBody(`
      <section data-gh-step="step-1"></section>
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
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
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
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
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
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
      <div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>
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

describe('offer-selector page: six destinations', () => {
  const SIX = [
    'bio3-1p-ot',
    'bio3-1p-sub',
    'bio3-3p-ot',
    'bio3-3p-sub',
    'bio3-6p-ot',
    'bio3-6p-sub',
  ];

  /** The canonical page: one step, six bound offers, funnel optionally declared. */
  function setOfferSelectorBody(funnelAttr = '', funnelSlugAttr = ''): void {
    setBody(
      `<section data-gh-step="offer-selector" ${funnelAttr} ${funnelSlugAttr}>` +
        SIX.map((slug) => `<a data-gh-checkout="${slug}" data-gh-destination="${slug}"></a>`).join('') +
        `</section>`,
    );
  }

  /** Each of the six carries its OWN funnelId — six different ones. */
  const sixDestinations = (slug: string): HippoShopDestinationDTO =>
    makeDestination(slug, `id-${slug}`, `funnel-${slug}`, 'bio3-main');

  const bio3Funnel = (slug: string): HippoShopFunnelDTO | null =>
    slug === 'bio3-main'
      ? makeFunnel(slug, [
          { slug: 'offer-selector', id: 'a0Zstep1' },
          { slug: 'upsell', id: 'a0Zstep2' },
        ])
      : null;

  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setOfferSelectorBody(EMITTER_FUNNEL_ATTR, 'data-gh-funnel="bio3-main"');
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  // The headline fix. Binding offers is not a claim to be inside a funnel:
  // which of the six is "first" is arbitrary DOM order, so taking funnel
  // identity from that DTO invented funnel membership for every page that
  // merely sells something — including one reached by a typed URL.
  it('emits NOTHING when the page itself declares no funnel', async () => {
    setOfferSelectorBody(); // no data-gh-funnel-id, and no ?origmainFunnelIdOrig=
    const { opts, postEvent } = makeEmitterOpts({
      getDestination: sixDestinations,
      getFunnel: bio3Funnel,
    });

    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    // Past the hard deadline as well: the gate is a drop, not a delay.
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);

    expect(postEvent).not.toHaveBeenCalled();
  });

  // Sibling of the above, and the reason the gate is safe: the identical page
  // WITH funnel identity still emits one Page View for all six offers, so the
  // dedupe-by-page rule is unchanged.
  it('emits exactly one event when the page declares data-gh-funnel-id, identified by the first destination in document order', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getDestination: sixDestinations,
      getFunnel: bio3Funnel,
    });

    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
    const body = postEvent.mock.calls[0]![1] as Record<string, unknown>;
    // Funnel identity is the page's declaration — NOT `funnel-bio3-1p-ot`,
    // which is the first destination's own funnel and no longer consulted.
    expect(body['funnelSTFId']).toBe('a0Xfunnel1');
    expect(body['mainFunnelId']).toBe('a0Xfunnel1');
    expect(body['destinationId']).toBe('id-bio3-1p-ot');
    expect(body['funnelSTPId']).toBe('a0Zstep1');
    expect(body['url']).toBe('offer-selector');
    expect(body['eventType']).toBe('Page View');
    expect(body['salesFunnel']).toBe('Funnel');
  });

  it('a late-arriving seventh offer does not produce a second event', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getDestination: sixDestinations,
      getFunnel: bio3Funnel,
    });
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);

    const extra = document.createElement('a');
    extra.setAttribute('data-gh-destination', 'bio3-12p-sub');
    document.querySelector('[data-gh-step]')!.appendChild(extra);
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEADLINE_MS + 1);

    expect(postEvent).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// New Session (D-new) and the affParams envelope
// ---------------------------------------------------------------------------

describe('installPageViewEmitter — New Session and affParams', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC_EMITTER });
    setBody(`<div data-gh-destination="bio3-1p-ot" ${EMITTER_FUNNEL_ATTR}></div>`);
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEventsForTests();
  });

  /** Install, raise both readiness signals, let the quiet window elapse. */
  async function coldLoad(opts: PageViewEmitterOptions): Promise<void> {
    installPageViewEmitter(opts);
    window.dispatchEvent(new Event('gh:session-ready'));
    window.dispatchEvent(new Event('gh:bindings-ready'));
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_QUIET_MS + 1);
  }

  it('sends New Session BEFORE the Page View when the session was established on this load', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getSession: () => emitterSession({ isNew: true }),
    });
    await coldLoad(opts);

    // Two independent emissions, not alternatives — and two separate POSTs.
    // They survive each other's dedupe only because the key carries the event
    // type; both are keyed on the same (session, step).
    expect(postEvent).toHaveBeenCalledTimes(2);
    const first = postEvent.mock.calls[0]![1] as Record<string, unknown>;
    const second = postEvent.mock.calls[1]![1] as Record<string, unknown>;
    expect(first['eventType']).toBe('New Session');
    expect(second['eventType']).toBe('Page View');
    // Identical payloads apart from eventType: same funnel, same session.
    expect(first['mainFunnelId']).toBe('a0Xfunnel1');
    expect(second['mainFunnelId']).toBe('a0Xfunnel1');
    expect(first['sessionId']).toBe(second['sessionId']);
  });

  it('sends only the Page View when the session was resumed rather than established', async () => {
    const { opts, postEvent } = makeEmitterOpts(); // emitterSession defaults isNew: false
    await coldLoad(opts);
    expect(postEvent).toHaveBeenCalledOnce();
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['eventType']).toBe('Page View');
  });

  it('carries the session POST response verbatim as affParams', async () => {
    const data = { sessionId: 'srv-1', visitorId: 'vis-9', affId: 'AFF42', serverAdded: true };
    const { opts, postEvent } = makeEmitterOpts({ getSession: () => emitterSession({ data }) });
    await coldLoad(opts);

    expect(postEvent).toHaveBeenCalledOnce();
    const body = postEvent.mock.calls[0]![1] as Record<string, unknown>;
    // Nested, not merged: the 36-field shape is matched byte-for-byte upstream,
    // so the server's echo rides in its own key rather than flattened into it.
    expect(body['affParams']).toEqual(data);
    expect(body['eventType']).toBe('Page View');
    expect(body['mainFunnelId']).toBe('a0Xfunnel1');
  });

  it('sends affParams as {} when the session POST failed', async () => {
    const { opts, postEvent } = makeEmitterOpts({
      getSession: () => emitterSession({ data: null }),
    });
    await coldLoad(opts);

    expect(postEvent).toHaveBeenCalledOnce();
    // A failed session POST costs attribution, not the event: full funnel
    // identity is still on the wire.
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['affParams']).toEqual({});
    expect((postEvent.mock.calls[0]![1] as Record<string, unknown>)['mainFunnelId']).toBe(
      'a0Xfunnel1',
    );
  });
});
