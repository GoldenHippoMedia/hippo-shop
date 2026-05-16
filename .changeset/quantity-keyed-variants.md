---
"@goldenhippo/hippo-shop-types": minor
"@goldenhippo/hippo-shop-sdk": minor
---

Add quantity-keyed variant access. Each `variants.<purchase>.<tier>` price level
now has two sibling fields: `<tier>List` (iteration) and `<tier>ByQuantity`
(record keyed by quantity).

HTML bindings can use the new paths directly:

    data-field="variants.subscription.standardByQuantity.3.price"
    <template data-each="variants.subscription.standardList">

JavaScript consumers can look up by quantity:

    product.variants.subscription.standardByQuantity['3']?.price

The existing arrays (`variants.<purchase>.<tier>`) are deprecated and will be
removed in v3.0.0. Missing quantities resolve to `undefined`; the existing
`data-field` and `data-if` semantics handle that without changes.

The new fields are derived client-side by the SDK from the existing array
shape; the wire format from `/public/v1/product/:slug` is unchanged.
