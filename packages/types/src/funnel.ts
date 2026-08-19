/**
 * A Golden Hippo funnel as exposed publicly.
 *
 * Pre-Purchase only. Post-Purchase funnels return 404 on the public API.
 * Inactive steps are filtered out server-side; split-test variants are
 * resolved to the destination's `defaultFunnel` before serialization.
 */
export interface HippoShopFunnelDTO {
  /**
   * Salesforce ID of the funnel. Needed as `funnelSTFId` / `mainFunnelId` on
   * funnel-event payloads, which the upstream drops when it is blank — so a
   * page that declares its funnel by `slug` alone could not emit an event
   * without it. Prefer `slug` for anything addressable.
   */
  id: string;
  /** Stable, human-readable identifier — preferred over `id` for external use. */
  slug: string;
  /** Display name. */
  name: string;
  /** Whether the funnel itself is active. Inactive funnels return 404. */
  active: boolean;
  /** Ordered list of steps. Inactive steps are pre-filtered. */
  steps: HippoShopFunnelStepDTO[];
}

export interface HippoShopFunnelStepDTO {
  /**
   * Salesforce ID of the step. Needed as `funnelSTPId` on funnel-event
   * payloads. Prefer `slug` for anything addressable.
   */
  id: string;
  /** 1-indexed position in the funnel. */
  stepNumber: number;
  /** Step slug, unique within the funnel. */
  slug: string;
  /** Display name. */
  name: string;
  /** Closed enum mapping from internal `pageType`. Unknown types are omitted server-side. */
  kind: HippoShopStepKind;
}

/**
 * Closed enum of step kinds. The internal `pageType` is mapped to this set
 * via a documented lookup; any unknown internal value causes the step to be
 * dropped (and a structured log line emitted) — host pages never see garbage.
 */
export type HippoShopStepKind =
  | 'landing'
  | 'content'
  | 'order-form'
  | 'bump'
  | 'upsell'
  | 'downsell'
  | 'thank-you';
