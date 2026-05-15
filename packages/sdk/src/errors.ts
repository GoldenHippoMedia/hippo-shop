export type GhErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'bad_request'
  | 'network'
  | 'bad_config'
  | 'server';

export interface GhErrorOptions {
  retryAfterMs?: number | null;
  cause?: unknown;
}

export class GhError extends Error {
  readonly code: GhErrorCode;
  readonly retryAfterMs: number | null;
  override readonly cause: unknown;

  constructor(code: GhErrorCode, message: string, opts: GhErrorOptions = {}) {
    super(message);
    this.name = 'GhError';
    this.code = code;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.cause = opts.cause;
  }
}
