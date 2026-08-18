import { GhDataClient } from './client';
import { parseScriptConfig, ConfigError } from './config';
import { createLogger } from './log';
import { GhRuntime } from './runtime';
import { FormatRegistry } from './format';
import { ensureSession, getSessionState } from './session';
import { makeCheckoutUrlFn } from './checkout';
import {
  installPageViewEmitter,
  makeTrackFn,
  type FunnelEventType,
  type PageViewEmitterOptions,
} from './events';

export { GhDataClient } from './client';
export { GhError, type GhErrorCode } from './errors';
export { parseScriptConfig, type GhConfig } from './config';
export { GhRuntime } from './runtime';
export { FormatRegistry, builtinFormatters } from './format';
export { applyBindings, collectResources, type ResourceState } from './bindings';
export { getByPath } from './path';

interface GhDataApi {
  funnel: GhDataClient['funnel'];
  destination: GhDataClient['destination'];
  product: GhDataClient['product'];
}

export interface GhWindow {
  data: GhDataApi;
  bind: GhRuntime['bind'];
  refresh: GhRuntime['refresh'];
  format: FormatRegistry;
  debug?: boolean;
  checkoutUrl?: (slug: string) => Promise<string>;
  /** Cluster G / D9: programmatic Page View. Respects the per-page-load dedupe guard. */
  track?: (eventType: FunnelEventType) => Promise<void>;
  session?: {
    id: () => string | undefined;
    params: () => unknown; // ParsedParams is internal; expose as unknown to keep types clean
  };
  __sessionPromise?: Promise<unknown>;
}

declare global {
  interface Window {
    gh?: Partial<GhWindow>;
  }
}

const DATA_READY_EVENT = 'gh:data-ready';

/**
 * Boot is exported for tests; in the browser it runs immediately when the
 * IIFE bundle is evaluated. Returns whether boot attached the API.
 */
export function boot(doc: Document = document, win: Window = window): boolean {
  const script = findScript(doc);
  if (!script) {
    console.error('[gh] could not locate the SDK <script> tag — refusing to attach');
    return false;
  }

  let config;
  try {
    config = parseScriptConfig(script);
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    console.error('[gh] bad config —', msg);
    return false;
  }

  const logger = createLogger(config.debug);
  const root = (win.gh ??= {});
  if (root.data) {
    logger.warn('window.gh.data already exists — refusing to overwrite');
    return false;
  }

  const client = new GhDataClient(config, logger);
  const runtime = new GhRuntime({ doc, win, logger, client, config });

  root.data = {
    funnel: client.funnel.bind(client),
    destination: client.destination.bind(client),
    product: client.product.bind(client),
  };
  root.bind = runtime.bind.bind(runtime);
  root.refresh = runtime.refresh.bind(runtime);
  root.format = runtime.formatters;
  if (config.debug) root.debug = true;

  root.session = {
    id: () => getSessionState()?.sessionId,
    params: () => getSessionState()?.params ?? null,
  };
  // One session promise, one stable checkoutUrl identity. Cluster F installed a
  // stub session here and reassigned root.checkoutUrl when the session
  // resolved, so any captured reference kept the un-attributed stub forever.
  // Registered before ensureSession is invoked: a session that resolves with
  // no awaits dispatches gh:session-ready synchronously, from inside the call
  // below, and a listener registered afterwards would never see it.
  runtime.installSessionReadyRebind();

  const sessionPromise = ensureSession(config, client).catch(() => undefined);
  root.__sessionPromise = sessionPromise;
  // The runtime's checkout bind pass gets this same promise — one session
  // promise for the whole page, never a second fabricated one.
  runtime.setSessionPromise(sessionPromise);

  root.checkoutUrl = makeCheckoutUrlFn({
    config,
    logger,
    getSession: () => getSessionState(),
    sessionPromise,
    getDestination: (slug) => runtime.getCachedDestination(slug),
    ensureDestination: (slug) => runtime.ensureDestination(slug),
  });

  // Cluster G / D9: funnel-event emitter. Deliberately outside bind() —
  // bind() re-runs on every observer mutation and again on gh:session-ready.
  // `getSession` is a THUNK (Correction 2): one stable identity always reads
  // live state, so a captured `gh.track` never goes stale.
  const emitterOptions: PageViewEmitterOptions = {
    doc,
    win,
    config,
    client,
    logger,
    getSession: () => getSessionState(),
    sessionPromise: root.__sessionPromise,
    getDestination: (slug) => runtime.getCachedDestination(slug),
    getFunnel: (slug) => runtime.getCachedFunnel(slug),
    ensureDestination: (slug) => runtime.ensureDestination(slug),
  };
  root.track = makeTrackFn(emitterOptions);
  installPageViewEmitter(emitterOptions);

  logger.debug('booted', { brand: config.brand, apiBaseUrl: config.apiBaseUrl });
  win.dispatchEvent(new Event(DATA_READY_EVENT));

  runtime.installAutoBind();
  return true;
}

function findScript(doc: Document): HTMLScriptElement | null {
  const cur = doc.currentScript as HTMLScriptElement | null;
  if (cur && cur.dataset['key'] && cur.dataset['brand']) return cur;
  return doc.querySelector<HTMLScriptElement>(
    'script[data-key][data-brand][src*="/sdk/"]',
  ) ?? doc.querySelector<HTMLScriptElement>(
    // Local-dev fallback so served pages don't need to live at a /sdk/ path.
    'script[data-key][data-brand][src$="/gh.js"]',
  );
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot();
}
