---
"@goldenhippo/hippo-shop-types": major
---

Cluster G (v4): destination identity and absolute URL.

**Breaking.** Three required fields on `HippoShopDestinationDTO`, one on
`HippoShopFunnelStepDTO`:

- `HippoShopDestinationDTO.id: string` — Salesforce ID of the destination.
- `HippoShopDestinationDTO.funnelId: string` — Salesforce ID of the funnel it
  resolves to (the resolved `defaultFunnel`).
- `HippoShopDestinationDTO.url: string | null` — absolute landing URL for the
  destination. `null` when Salesforce has none, in which case callers fall
  back to their own configured checkout base.
- `HippoShopFunnelStepDTO.id: string` — Salesforce ID of the step.

Producers must supply all four. Consumers gain the identity a funnel-event
payload requires (`funnelSTFId`, `mainFunnelId`, `destinationId`,
`funnelSTPId`) from a destination fetch they were already making — the
upstream Salesforce record carried every one of these and the serializer
discarded them.

Also corrects the `HippoShopDestinationDTO` docblock, which claimed
"Pre-Purchase only". The public API serves **Post-Purchase** destinations and
Pre-Purchase funnels; the docblock had been pasted from `funnel.ts`.

Supersedes the unreleased Cluster F changeset for this package.
