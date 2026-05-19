/**
 * Cluster F: outbound checkout URL composition + (in Task 8)
 * `data-gh-checkout` attribute behavior and the `gh.checkoutUrl(slug)`
 * programmatic API.
 *
 * `composeCheckoutUrl` is a pure function: given a destination DTO, the
 * SDK config, and the current session state, it returns the outbound
 * URL. Falls back through brand-level `data-checkout-base` if the DTO
 * has no override; throws if neither is configured.
 */

import type { HippoShopDestinationDTO } from '@goldenhippo/hippo-shop-types';
import type { GhConfig } from './config';
import type { SessionState } from './session';
import { GhError } from './errors';

/**
 * Keys in `ParsedParams` → query-param names on the outbound checkout URL.
 * Order matters for deterministic output (tests rely on this).
 */
const PARAM_KEY_MAP: Array<[keyof NonNullable<SessionState['params']>, string]> = [
  ['utmSource', 'utm_source'],
  ['utmMedium', 'utm_medium'],
  ['utmCampaign', 'utm_campaign'],
  ['utmCampaignId', 'utm_campaign_id'],
  ['utmContent', 'utm_content'],
  ['utmTerm', 'utm_term'],
  ['utmChat', 'utm_chat'],
  ['utmAction', 'utm_action'],
  ['offId', 'off_id'],
  ['affId', 'aff_id'],
  ['subId1', 'sub_id1'],
  ['subId2', 'sub_id2'],
  ['subId3', 'sub_id3'],
  ['subId4', 'sub_id4'],
  ['subId5', 'sub_id5'],
];

/**
 * Compose the outbound checkout URL for a destination.
 *
 * @throws GhError('config') if neither `destination.pricing.checkoutOverrideUrl`
 *  nor `config.checkoutBase` is set.
 */
export function composeCheckoutUrl(
  destination: HippoShopDestinationDTO,
  config: GhConfig,
  session: SessionState,
): string {
  const baseStr = destination.pricing.checkoutOverrideUrl ?? config.checkoutBase;
  if (!baseStr) {
    throw new GhError(
      'config',
      `No checkout base URL configured for destination "${destination.slug}". ` +
        `Set the script-tag data-checkout-base or destination.pricing.checkoutOverrideUrl.`,
    );
  }

  let url: URL;
  try {
    url = new URL(baseStr);
  } catch (err) {
    throw new GhError('config', `Invalid checkout base URL: ${baseStr}`, { cause: err });
  }

  setIfAbsent(url, 'order_form_id', destination.pricing.orderFormId);
  setIfAbsent(url, 'session_id', session.sessionId);

  if (session.params) {
    for (const [key, paramName] of PARAM_KEY_MAP) {
      const value = session.params[key];
      if (value) setIfAbsent(url, paramName, value);
    }
  }

  return url.toString();
}

/** Set `name=value` on the URL's search params only if not already set. Empty values are skipped. */
function setIfAbsent(url: URL, name: string, value: string | undefined | null): void {
  if (!value) return;
  if (url.searchParams.has(name)) return;
  url.searchParams.set(name, value);
}
