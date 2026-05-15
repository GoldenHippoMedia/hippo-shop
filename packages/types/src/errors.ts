/**
 * Wire shape of an error response from `/public/v1/*`.
 *
 * Kong and the commerce API both emit this shape. `not_found` is
 * deliberately ambiguous between "doesn't exist" and "you're not
 * authorized to see this" — partners cannot enumerate resources they
 * don't own.
 */
export interface HippoShopErrorDTO {
  code: HippoShopErrorCode;
  message: string;
  /** Hint for rate-limited responses, in milliseconds. */
  retryAfterMs?: number;
}

export type HippoShopErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'bad_request'
  | 'server';
