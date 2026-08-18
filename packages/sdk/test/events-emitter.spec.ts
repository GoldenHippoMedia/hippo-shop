import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readStepSlug,
  firstDestinationSlug,
  resolveEventIdentity,
} from '../src/events';
import type { HippoShopDestinationDTO, HippoShopFunnelDTO } from '@goldenhippo/hippo-shop-types';

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
