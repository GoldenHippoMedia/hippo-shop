export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const PREFIX = '[gh]';

type Method = 'debug' | 'warn' | 'error';
type ConsoleLike = Partial<Record<Method, (...args: unknown[]) => void>>;

/**
 * Emits one prefixed line, and cannot throw.
 *
 * Design Goal 8 of this cluster — "every failure mode stays non-fatal;
 * attribution may degrade, the page never breaks" — applies to the logger
 * itself. This SDK runs on third-party brand pages where `console` is not
 * ours: privacy tools, consent managers and tag managers routinely stub, null
 * out or wrap `console.warn`/`console.error`, and a wrapper that throws turns
 * a diagnostic into a page-breaking exception at whatever call site happened
 * to log. Guarding here rather than at each call site makes non-fatality a
 * property of the logger, instead of an ordering rule ("write the
 * safety-critical effect *before* you warn") that every present and future
 * caller has to remember. Callers may log wherever reads best.
 *
 * Three hazards, all real on a page we do not control:
 *
 *  - `console` missing from `globalThis` — read off `globalThis` rather than as
 *    a bare identifier, because a bare `console` is a ReferenceError, not
 *    `undefined`, when the global is genuinely absent.
 *  - the method absent or not callable (`console.warn = null`, or `console`
 *    replaced by an object lacking it) — the `typeof` gate.
 *  - the method present but throwing when called — the `try`.
 *
 * Resolution stays per-call, as before: a consent tool that swaps
 * `console.warn` after boot must still receive our lines.
 */
function emit(method: Method, args: unknown[]): void {
  try {
    const c = (globalThis as { console?: ConsoleLike }).console;
    const fn = c?.[method];
    // `.call(c, …)` because a console method detached from its object throws in
    // some implementations — which the `try` would swallow, silently dropping
    // every line on that page.
    if (typeof fn === 'function') fn.call(c, PREFIX, ...args);
  } catch {
    // The host page broke its own console; there is nowhere left to report
    // that. Dropping the diagnostic is the entire point — a diagnostic is
    // never worth an exception on someone else's page.
  }
}

export function createLogger(enabled: boolean): Logger {
  return {
    // Debug stays gated exactly as before: when disabled it is a bare no-op
    // that never touches `console` and never builds an argument list.
    debug: enabled ? (...args) => emit('debug', args) : () => {},
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  };
}
