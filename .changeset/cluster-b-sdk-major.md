---
"@goldenhippo/hippo-shop-sdk": major
---

**Breaking:** Removed the `enrichProduct` export. The SDK now expects the API to emit `<tier>List` and `<tier>ByQuantity` directly — there is no longer a client-side fallback that builds those fields from the legacy `variants.<purchase>.standard` / `.myAccount` arrays. `data-field` paths through the legacy arrays are no longer supported.
