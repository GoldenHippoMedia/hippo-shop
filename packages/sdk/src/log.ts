export interface Logger {
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const PREFIX = '[gh]';

export function createLogger(enabled: boolean): Logger {
  const debug = enabled
    ? (...args: unknown[]) => console.debug(PREFIX, ...args)
    : (..._args: unknown[]) => {};
  return {
    debug,
    warn: (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args),
  };
}
