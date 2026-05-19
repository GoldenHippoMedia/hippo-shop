---
"@goldenhippo/hippo-shop-types": minor
---

Add required `checkoutOverrideUrl: string | null` field to `HippoShopPricingDTO`.

When non-null, the SDK uses this URL as the base for the checkout handoff on
this destination, overriding the brand-level `data-checkout-base` script-tag
attribute. When `null`, the brand-level default is used. No producer impact —
APIs that don't supply the field can return `null`.

Part of Cluster F (SDK session, UTM, and checkout handoff).
