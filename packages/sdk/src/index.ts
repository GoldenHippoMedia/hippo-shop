import { GhDataClient } from './client';
import { parseScriptConfig, ConfigError } from './config';
import { createLogger } from './log';
import { GhRuntime } from './runtime';
import { FormatRegistry } from './format';

export { GhDataClient } from './client';
export { GhError, type GhErrorCode } from './errors';
export { parseScriptConfig, type GhConfig } from './config';
export { GhRuntime } from './runtime';
export { FormatRegistry, builtinFormatters } from './format';
export { applyBindings, collectResources } from './bindings';
export { getByPath } from './path';
export { enrichProduct } from './enrich';

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
  const runtime = new GhRuntime({ doc, win, logger, client });

  root.data = {
    funnel: client.funnel.bind(client),
    destination: client.destination.bind(client),
    product: client.product.bind(client),
  };
  root.bind = runtime.bind.bind(runtime);
  root.refresh = runtime.refresh.bind(runtime);
  root.format = runtime.formatters;
  if (config.debug) root.debug = true;

  logger.debug('booted', { brand: config.brand, apiBaseUrl: config.apiBaseUrl });
  win.dispatchEvent(new Event(DATA_READY_EVENT));

  runtime.installAutoBind();
  return true;
}

function findScript(doc: Document): HTMLScriptElement | null {
  const cur = doc.currentScript as HTMLScriptElement | null;
  if (cur && cur.dataset['key'] && cur.dataset['brand']) return cur;
  return doc.querySelector<HTMLScriptElement>(
    'script[data-key][data-brand][src*="/sdk/v1/gh"]',
  ) ?? doc.querySelector<HTMLScriptElement>(
    // Local-dev fallback so served pages don't need to live at a /sdk/v1/ path.
    'script[data-key][data-brand][src$="/gh.js"]',
  );
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot();
}
