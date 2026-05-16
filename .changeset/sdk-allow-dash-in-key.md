---
'@goldenhippo/hippo-shop-sdk': patch
---

Widen `KEY_PATTERN` to allow `-` in the consumer/brand portion of `data-key`
(`/^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/`). This lets multi-word brand slugs stay
scannable (e.g. `gh_pk_internal_beverly-hills-md_<hex>`) and keeps the
structural `_` separator unambiguous between consumer and brand fields.

Backwards-compatible: every key that matched the previous pattern still
matches. The error message was updated to reflect the new shape.
