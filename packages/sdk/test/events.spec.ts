import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  formatVisitDate,
  detectUserAgent,
  buildPageViewEvent,
  emitPageView,
  FUNNEL_EVENT_RESOURCE,
  EVENT_ID_HEADER,
  pageViewDedupeKey,
  claimPageView,
  emitPageViewOnce,
  EVENT_GUARD_KEY,
  _resetEventsForTests,
  type PageViewContext,
} from '../src/events';
import type { GhConfig } from '../src/config';
import type { SessionState } from '../src/session';
import { GhDataClient } from '../src/client';
import { GhError } from '../src/errors';
import { createLogger } from '../src/log';

/**
 * A hand-built stand-in for Date. `formatVisitDate` only calls local getters,
 * so this makes the assertion byte-exact regardless of the machine timezone —
 * which a real `new Date()` cannot be.
 */
function fixedDate(offsetMinutesWestOfUtc: number): Date {
  return {
    getFullYear: () => 2026,
    getMonth: () => 7, // August — getMonth is 0-indexed
    getDate: () => 18,
    getHours: () => 11,
    getMinutes: () => 4,
    getSeconds: () => 22,
    getMilliseconds: () => 318,
    getTimezoneOffset: () => offsetMinutesWestOfUtc,
  } as unknown as Date;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatVisitDate', () => {
  it('formats a fixed date at UTC-7 as local wall clock plus numeric offset', () => {
    // getTimezoneOffset() returns minutes WEST of UTC, so 420 === UTC-07:00.
    expect(formatVisitDate(fixedDate(420))).toBe('2026-08-18T11:04:22.318-07:00');
  });

  it('emits a + sign and a non-zero minutes field east of UTC', () => {
    // -330 === UTC+05:30 (India) — exercises the sign flip and the mins pad.
    expect(formatVisitDate(fixedDate(-330))).toBe('2026-08-18T11:04:22.318+05:30');
  });

  it('emits +00:00 (never Z) at UTC', () => {
    const out = formatVisitDate(fixedDate(0));
    expect(out).toBe('2026-08-18T11:04:22.318+00:00');
    expect(out).not.toContain('Z');
  });

  it('is not toISOString: no Z, and shape is ISO8601 + offset + ms', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(420);
    const out = formatVisitDate(new Date());
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(out.endsWith('-07:00')).toBe(true);
    expect(out).not.toContain('Z');
  });

  it('zero-pads month, day, time components, and milliseconds to 3 digits', () => {
    const jan = {
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 3,
      getHours: () => 4,
      getMinutes: () => 5,
      getSeconds: () => 6,
      getMilliseconds: () => 7,
      getTimezoneOffset: () => 480,
    } as unknown as Date;
    expect(formatVisitDate(jan)).toBe('2026-01-03T04:05:06.007-08:00');
  });

  it('defaults to now when called with no argument', () => {
    expect(formatVisitDate()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
  });
});

const UA_CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51';
const UA_FIREFOX_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
const UA_CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const UA_OPERA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0';
const UA_IE11 =
  'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko';

describe('detectUserAgent', () => {
  it('Chrome on macOS desktop', () => {
    expect(detectUserAgent(UA_CHROME_MAC)).toEqual({
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
    });
  });

  it('Safari on iPhone reports iOS and Mobile, not Mac OS', () => {
    expect(detectUserAgent(UA_SAFARI_IPHONE)).toEqual({
      browser: 'Safari',
      os: 'iOS',
      device: 'Mobile',
    });
  });

  it('Edge on Windows wins over the Chrome token', () => {
    expect(detectUserAgent(UA_EDGE_WINDOWS)).toEqual({
      browser: 'Microsoft Edge',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('Firefox on Linux', () => {
    expect(detectUserAgent(UA_FIREFOX_LINUX)).toEqual({
      browser: 'Firefox',
      os: 'Linux',
      device: 'Desktop',
    });
  });

  it('Chrome on Android reports Android, not Linux, and Mobile', () => {
    expect(detectUserAgent(UA_CHROME_ANDROID)).toEqual({
      browser: 'Chrome',
      os: 'Android',
      device: 'Mobile',
    });
  });

  it('Opera wins over the Chrome token', () => {
    expect(detectUserAgent(UA_OPERA_WINDOWS)).toEqual({
      browser: 'Opera',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('Internet Explorer via Trident', () => {
    expect(detectUserAgent(UA_IE11)).toEqual({
      browser: 'Internet Explorer',
      os: 'Windows',
      device: 'Desktop',
    });
  });

  it('empty UA returns the reference SSR default', () => {
    expect(detectUserAgent('')).toEqual({
      browser: 'Unknown',
      os: null,
      device: 'Desktop',
    });
  });
});

function makeConfig(overrides: Partial<GhConfig> = {}): GhConfig {
  return {
    key: 'gh_pk_test_abc123',
    brand: 'Gundry MD',
    debug: false,
    apiBaseUrl: 'https://api-prod.goldenhippo.io',
    checkoutBase: 'https://checkout.gundrymd.com',
    cookieDomain: null,
    brandToken: null,
    sessionEnabled: true,
    checkoutSessionId: true,
    eventsEnabled: true,
    sessionUrlFirst: false,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab',
    adopted: false,
    params: {},
    isNew: false,
    data: null,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PageViewContext> = {}): PageViewContext {
  return {
    config: makeConfig(),
    session: makeSession(),
    funnelId: 'a0X000000000001AAA',
    destinationId: 'a0Y000000000002AAA',
    stepId: 'a0Z000000000003AAA',
    stepSlug: 'offer-selector',
    splitTestId: null,
    referrer: '',
    search: '',
    ...overrides,
  };
}

const ISO_OFFSET_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

describe('buildPageViewEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when funnelId is absent — the D5 gate', () => {
    expect(buildPageViewEvent(makeCtx({ funnelId: null }))).toBeNull();
    expect(buildPageViewEvent(makeCtx({ funnelId: '' }))).toBeNull();
  });

  it('emits every constant field exactly', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(event.eventType).toBe('Page View');
    expect(event.salesFunnel).toBe('Funnel');
    expect(event.splitTestingPageId).toBeNull();
    expect(event.orderId).toBeNull();
    expect(event.customPayLoad1).toBeNull();
    expect(event.customPayLoad2).toBeNull();
    expect(event.visitorId).toBeNull();
    expect(event.videoPercentage).toBe(0);
    expect(event.leadId).toBeNull();
    expect(event.accountId).toBeNull();
    expect(event.brand).toBe('Gundry MD');
    expect(event.visitDate).toMatch(ISO_OFFSET_MS);
  });

  it('salesFunnel stays the literal Funnel even when params.salesFunnel is set', () => {
    const ctx = makeCtx({ session: makeSession({ params: { salesFunnel: 'Store' } }) });
    expect(buildPageViewEvent(ctx)!.salesFunnel).toBe('Funnel');
  });

  it('mirrors funnelId into funnelSTFId and mainFunnelId', () => {
    const event = buildPageViewEvent(makeCtx({ funnelId: 'a0Xfff' }))!;
    expect(event.funnelSTFId).toBe('a0Xfff');
    expect(event.mainFunnelId).toBe('a0Xfff');
  });

  it('url collapses empty string to null while funnelSTPId retains empty string', () => {
    const event = buildPageViewEvent(makeCtx({ stepSlug: '', stepId: '' }))!;
    expect(event.url).toBeNull();
    expect(event.funnelSTPId).toBe('');
  });

  it('url carries the step SLUG, not a URL', () => {
    expect(buildPageViewEvent(makeCtx({ stepSlug: 'step-2-upsell' }))!.url).toBe(
      'step-2-upsell',
    );
  });

  it('nulls destinationId, funnelSTPId and splitTestingFunnelId when absent', () => {
    const event = buildPageViewEvent(
      makeCtx({ destinationId: null, stepId: null, splitTestId: null }),
    )!;
    expect(event.destinationId).toBeNull();
    expect(event.funnelSTPId).toBeNull();
    expect(event.splitTestingFunnelId).toBeNull();
  });

  it('defaults affId/offId to empty string but every subId to null', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(event.affId).toBe('');
    expect(event.offId).toBe('');
    expect(event.subId1).toBeNull();
    expect(event.subId2).toBeNull();
    expect(event.subId3).toBeNull();
    expect(event.subId4).toBeNull();
    expect(event.subId5).toBeNull();
  });

  it('maps UTMs, affId/offId and subIds from ParsedParams when present', () => {
    const ctx = makeCtx({
      session: makeSession({
        params: {
          utmSource: 'fb',
          utmMedium: 'cpc',
          utmCampaign: 'summer',
          utmContent: 'creative-7',
          utmTerm: 'gut health',
          affId: 'AFF9',
          offId: 'OFF3',
          subId1: 'FBCLICKID',
          subId5: 'snap',
        },
      }),
    });
    const event = buildPageViewEvent(ctx)!;
    expect(event.utmSource).toBe('fb');
    expect(event.utmMedium).toBe('cpc');
    expect(event.utmCampaign).toBe('summer');
    expect(event.utmContent).toBe('creative-7');
    expect(event.utmTerm).toBe('gut health');
    expect(event.affId).toBe('AFF9');
    expect(event.offId).toBe('OFF3');
    expect(event.subId1).toBe('FBCLICKID');
    expect(event.subId5).toBe('snap');
  });

  it('prefers ?cid= over ParsedParams.utmCampaignId', () => {
    const ctx = makeCtx({
      search: '?cid=CID_FROM_URL',
      session: makeSession({ params: { utmCampaignId: 'FROM_UTM' } }),
    });
    expect(buildPageViewEvent(ctx)!.utmCampaignId).toBe('CID_FROM_URL');
  });

  it('falls back to ParsedParams.utmCampaignId when ?cid= is absent or empty', () => {
    const withoutCid = makeCtx({
      search: '?utm_campaign_id=FROM_UTM',
      session: makeSession({ params: { utmCampaignId: 'FROM_UTM' } }),
    });
    expect(buildPageViewEvent(withoutCid)!.utmCampaignId).toBe('FROM_UTM');
    const emptyCid = makeCtx({
      search: '?cid=',
      session: makeSession({ params: { utmCampaignId: 'FROM_UTM' } }),
    });
    expect(buildPageViewEvent(emptyCid)!.utmCampaignId).toBe('FROM_UTM');
    expect(buildPageViewEvent(makeCtx())!.utmCampaignId).toBeNull();
  });

  it('derives referralUrl from the referrer with the query stripped', () => {
    const event = buildPageViewEvent(
      makeCtx({ referrer: 'https://www.facebook.com/ads?utm_source=fb&x=1' }),
    )!;
    expect(event.referralUrl).toBe('https://www.facebook.com/ads');
  });

  it('referralUrl is empty string, never null, when there is no referrer', () => {
    expect(buildPageViewEvent(makeCtx({ referrer: '' }))!.referralUrl).toBe('');
  });

  it('carries the session id and the detected UA triple', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(event.sessionId).toBe('b2e4f0a1-7c3d-4a5b-9e8f-0123456789ab');
    expect(event.browser).toBe('Chrome');
    expect(event.os).toBe('Mac OS');
    expect(event.device).toBe('Desktop');
  });

  it('brand prefers config.brandToken over config.brand when set', () => {
    const ctx = makeCtx({ config: makeConfig({ brandToken: 'gundry' }) });
    expect(buildPageViewEvent(ctx)!.brand).toBe('gundry');
  });

  it('brand falls back to config.brand when brandToken is null', () => {
    const ctx = makeCtx({ config: makeConfig({ brandToken: null, brand: 'Gundry MD' }) });
    expect(buildPageViewEvent(ctx)!.brand).toBe('Gundry MD');
  });

  it('emits exactly the 36 documented keys', () => {
    const event = buildPageViewEvent(makeCtx())!;
    expect(Object.keys(event).sort()).toEqual(
      [
        'accountId',
        'affId',
        'brand',
        'browser',
        'customPayLoad1',
        'customPayLoad2',
        'destinationId',
        'device',
        'eventType',
        'funnelSTFId',
        'funnelSTPId',
        'leadId',
        'mainFunnelId',
        'offId',
        'orderId',
        'os',
        'referralUrl',
        'salesFunnel',
        'sessionId',
        'splitTestingFunnelId',
        'splitTestingPageId',
        'subId1',
        'subId2',
        'subId3',
        'subId4',
        'subId5',
        'url',
        'utmCampaign',
        'utmCampaignId',
        'utmContent',
        'utmMedium',
        'utmSource',
        'utmTerm',
        'visitDate',
        'videoPercentage',
        'visitorId',
      ].sort(),
    );
    expect(Object.keys(event)).toHaveLength(36);
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeClientWithSpy(): {
  client: GhDataClient;
  postEvent: ReturnType<typeof vi.fn>;
} {
  const client = new GhDataClient(makeConfig(), createLogger(false));
  const postEvent = vi.fn().mockResolvedValue(undefined);
  client.postEvent = postEvent as never;
  return { client, postEvent };
}

describe('emitPageView', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the built event to the funnel-event resource with a uuid event-id header', async () => {
    const { client, postEvent } = makeClientWithSpy();
    await emitPageView(client, makeCtx(), createLogger(false));
    expect(postEvent).toHaveBeenCalledOnce();
    const [resource, body, headers] = postEvent.mock.calls[0]!;
    expect(resource).toBe('funnel-event');
    expect(FUNNEL_EVENT_RESOURCE).toBe('funnel-event');
    expect((body as { eventType: string }).eventType).toBe('Page View');
    expect((body as { funnelSTFId: string }).funnelSTFId).toBe('a0X000000000001AAA');
    expect((headers as Record<string, string>)[EVENT_ID_HEADER]).toMatch(UUID_RE);
    expect(EVENT_ID_HEADER).toBe('X-GH-Event-Id');
  });

  it('does not POST and warns in debug mode when the funnel id gate blocks', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    const warn = vi.spyOn(logger, 'warn');
    await emitPageView(
      client,
      makeCtx({ funnelId: null, config: makeConfig({ debug: true }) }),
      logger,
    );
    expect(postEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('stays silent when the gate blocks and debug is off', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    const warn = vi.spyOn(logger, 'warn');
    await emitPageView(client, makeCtx({ funnelId: null }), logger);
    expect(postEvent).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('swallows a network rejection', async () => {
    const { client, postEvent } = makeClientWithSpy();
    postEvent.mockRejectedValueOnce(new GhError('network', 'offline'));
    await expect(
      emitPageView(client, makeCtx(), createLogger(false)),
    ).resolves.toBeUndefined();
  });

  it('never retries on 429', async () => {
    const { client, postEvent } = makeClientWithSpy();
    postEvent.mockRejectedValueOnce(new GhError('rate_limited', 'slow down'));
    await emitPageView(client, makeCtx(), createLogger(false));
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('swallows a thrown non-Error and still resolves', async () => {
    const { client, postEvent } = makeClientWithSpy();
    postEvent.mockImplementationOnce(() => {
      throw 'boom';
    });
    await expect(
      emitPageView(client, makeCtx(), createLogger(false)),
    ).resolves.toBeUndefined();
  });
});

describe('page view dedupe', () => {
  beforeEach(() => {
    _resetEventsForTests();
    vi.stubGlobal('navigator', { userAgent: UA_CHROME_MAC });
  });
  afterEach(() => {
    _resetEventsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keys on sessionId, the literal event type, and the step slug', () => {
    expect(pageViewDedupeKey('sess-1', 'offer-selector', '/lp/gut-health')).toBe(
      'sess-1|Page View|offer-selector',
    );
  });

  it('falls back to location.pathname when no step slug is declared', () => {
    expect(pageViewDedupeKey('sess-1', null, '/lp/gut-health')).toBe(
      'sess-1|Page View|/lp/gut-health',
    );
    expect(pageViewDedupeKey('sess-1', '', '/lp/gut-health')).toBe(
      'sess-1|Page View|/lp/gut-health',
    );
  });

  it('claimPageView returns true once then false for the same key', () => {
    expect(claimPageView('k1')).toBe(true);
    expect(claimPageView('k1')).toBe(false);
    expect(claimPageView('k2')).toBe(true);
  });

  it('stores the guard on a window global, not module scope', () => {
    claimPageView('k1');
    const store = (window as unknown as Record<string, Set<string>>)[EVENT_GUARD_KEY];
    expect(store).toBeInstanceOf(Set);
    expect(store?.has('k1')).toBe(true);
  });

  it('emits once and suppresses the second emit for the same step', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx(), logger, '/lp/gut-health');
    await emitPageViewOnce(client, makeCtx(), logger, '/lp/gut-health');
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('emits again for a different step slug (SPA route change)', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx({ stepSlug: 'step-1' }), logger, '/p');
    await emitPageViewOnce(client, makeCtx({ stepSlug: 'step-2' }), logger, '/p');
    expect(postEvent).toHaveBeenCalledTimes(2);
  });

  it('does not burn the key when the funnel id gate blocks the emit', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx({ funnelId: null }), logger, '/p');
    expect(postEvent).not.toHaveBeenCalled();
    await emitPageViewOnce(client, makeCtx(), logger, '/p');
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('claims the key before awaiting, so concurrent calls cannot double-fire', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await Promise.all([
      emitPageViewOnce(client, makeCtx(), logger, '/p'),
      emitPageViewOnce(client, makeCtx(), logger, '/p'),
    ]);
    expect(postEvent).toHaveBeenCalledOnce();
  });

  it('_resetEventsForTests clears the guard', async () => {
    const { client, postEvent } = makeClientWithSpy();
    const logger = createLogger(false);
    await emitPageViewOnce(client, makeCtx(), logger, '/p');
    _resetEventsForTests();
    await emitPageViewOnce(client, makeCtx(), logger, '/p');
    expect(postEvent).toHaveBeenCalledTimes(2);
  });
});
