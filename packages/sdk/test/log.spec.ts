import { describe, it, expect, afterEach, vi } from 'vitest';
import { createLogger } from '../src/log';

/**
 * The logger's contract is that no method it hands out can throw, whatever the
 * host page has done to `console`. This SDK runs on third-party brand pages
 * where privacy tools, consent managers and tag managers routinely stub, null
 * out or wrap the console methods — and Design Goal 8 ("attribution may
 * degrade; the page never breaks") has no exemption for the diagnostic itself.
 *
 * Two sites in this cluster were previously patched one at a time for this same
 * hazard, each by ordering its safety-critical write before its warn. These
 * tests pin the guarantee at the root instead, so that ordering rule is no
 * longer something every future call site has to know.
 */
describe('createLogger', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes and forwards to the matching console method', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger(false);
    logger.warn('careful', 1);
    logger.error('broken', { a: 1 });

    expect(warn).toHaveBeenCalledWith('[gh]', 'careful', 1);
    expect(error).toHaveBeenCalledWith('[gh]', 'broken', { a: 1 });
  });

  // The defect this suite exists for: `console.warn` present but throwing.
  it('warn returns normally when console.warn throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console.warn stubbed by a privacy tool');
    });
    const logger = createLogger(false);

    expect(() => logger.warn('degraded')).not.toThrow();
    expect(logger.warn('degraded')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('error returns normally when console.error throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console.error wrapped by a tag manager');
    });
    expect(() => createLogger(false).error('boom')).not.toThrow();
  });

  it('debug returns normally when console.debug throws', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {
      throw new Error('console.debug wrapped by a tag manager');
    });
    expect(() => createLogger(true).debug('tracing')).not.toThrow();
  });

  // `console.warn = undefined` is what several script blockers actually do —
  // the property survives, the function does not.
  it('is a no-op when the console method is not callable', () => {
    vi.stubGlobal('console', { ...console, warn: undefined, error: null });
    const logger = createLogger(false);

    expect(() => logger.warn('degraded')).not.toThrow();
    expect(() => logger.error('degraded')).not.toThrow();
  });

  it('is a no-op when console is replaced by an object lacking the method', () => {
    vi.stubGlobal('console', { log: () => {} });
    const logger = createLogger(false);

    expect(() => logger.warn('degraded')).not.toThrow();
    expect(() => logger.error('degraded')).not.toThrow();
    expect(() => createLogger(true).debug('degraded')).not.toThrow();
  });

  // `console` gone from `globalThis` entirely. Deleted rather than stubbed to
  // `undefined`, because the two differ for a bare `console` reference: an
  // absent global is a ReferenceError, not `undefined`, which is why `emit`
  // reads the property off `globalThis`.
  it('is a no-op when console is absent from globalThis', () => {
    const real = globalThis.console;
    let threw: unknown = null;
    try {
      delete (globalThis as { console?: Console }).console;
      const logger = createLogger(false);
      logger.warn('degraded');
      logger.error('degraded');
      createLogger(true).debug('degraded');
    } catch (err) {
      threw = err;
    } finally {
      // Restored before asserting: vitest needs a console to report with.
      globalThis.console = real;
    }
    expect(threw).toBeNull();
  });

  // The guard must not have quietly turned the disabled debug into work: it
  // stays a no-op that never reaches `console` at all.
  it('does not touch console.debug when debug is disabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    createLogger(false).debug('should not appear');
    expect(debug).not.toHaveBeenCalled();

    createLogger(true).debug('should appear');
    expect(debug).toHaveBeenCalledWith('[gh]', 'should appear');
  });
});
