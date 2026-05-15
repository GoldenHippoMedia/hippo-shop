/**
 * A Golden Hippo funnel as exposed publicly.
 *
 * Pre-Purchase only. Post-Purchase funnels return 404 on the public API.
 * Inactive steps are filtered out server-side; split-test variants are
 * resolved to the destination's `defaultFunnel` before serialization.
 */
export interface HippoShopFunnelDTO {
  /** Stable, human-readable identifier — preferred over `id` for external use. */
  slug: string;
  /** Display name. */
  name: string;
  /** Whether the funnel itself is active. Inactive funnels return 404. */
  active: boolean;
  /** Canonical entry URL for the funnel's first step. */
  entryUrl: string;
  /** Ordered list of steps. Inactive steps are pre-filtered. */
  steps: HippoShopFunnelStepDTO[];
}

export interface HippoShopFunnelStepDTO {
  /** 1-indexed position in the funnel. */
  stepNumber: number;
  /** Step slug, unique within the funnel. */
  slug: string;
  /** Display name. */
  name: string;
  /** Closed enum mapping from internal `pageType`. Unknown types are omitted server-side. */
  kind: HippoShopStepKind;
  /** Canonical URL for this step. */
  url: string;
}

/**
 * Closed enum of step kinds. The internal `pageType` is mapped to this set
 * via a documented lookup; any unknown internal value causes the step to be
 * dropped (and a structured log line emitted) — partners never see garbage.
 */
export type HippoShopStepKind =
  | 'landing'
  | 'content'
  | 'order-form'
  | 'bump'
  | 'upsell'
  | 'downsell'
  | 'thank-you';
