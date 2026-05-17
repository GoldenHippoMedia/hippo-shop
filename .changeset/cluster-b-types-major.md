---
"@goldenhippo/hippo-shop-types": major
---

**Breaking:** Removed deprecated `variants.<purchase>.standard` and `variants.<purchase>.myAccount` array fields from `HippoShopProductVariantsDTO`. Use `<tier>List` for iteration or `<tier>ByQuantity` for direct lookup. The replacement fields have been available since v2.0.0.
