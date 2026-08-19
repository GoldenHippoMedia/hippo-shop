---
'@goldenhippo/hippo-shop-sdk': patch
'@goldenhippo/hippo-shop-types': patch
---

Documentation corrections for v4. No runtime or type changes — this release exists so the corrected READMEs reach npmjs.com, which renders the README captured at publish time.

**The version section is correct again.** The "About this version" section both package pages link to described v3 as the current release and showed a `/sdk/v3/gh.js` script tag. It now describes v4 and flags the two things that fail quietly for a new integrator: omitting `data-brand-token` mis-attributes every funnel event with a `200` and no log line, and `gh.checkoutUrl()` returns a promise, so `window.open(await …)` is popup-blocked.

**SDK README**

- Documented how an inbound click-id lands in the `subid` slots. `fbclid`, `gclid`, `ScCid`, `qclid`, `twclid` and `ndclid` write the click value to `subid1`; `wbraid` writes `subid4`; `ScCid`, `qclid`, `twclid` and `ndclid` additionally mark `subid5` with a platform name.
- Corrected the outbound parameter precedence. Attribution parameters do not overwrite a value already on the destination's base URL, but `order_form_id` and `sessionid` are SDK-owned and always overwrite — which is what stops a pasted live funnel link from pinning every visitor to one session.
- Added the `'config'` error code to the `GhErrorCode` union and the error reference. `gh.checkoutUrl()` rejects with it when a destination resolves no `checkoutOverrideUrl`, no `url`, and the script tag has no `data-checkout-base`.
- Added `boot()` and the `GhWindow` interface to the barrel-export reference; both were already exported.
- Fixed two table-of-contents links that did not resolve.

**Types README**

- Documented `HippoShopPricingDTO.checkoutOverrideUrl`. It is required as of 4.0.0 and was missing from both the `HippoShopDestinationDTO` example and the required-field table, so the example did not satisfy the type it illustrates. v4 adds five required keys across the DTOs, not four.
