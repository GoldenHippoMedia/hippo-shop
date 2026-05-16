---
'@goldenhippo/hippo-shop-sdk': patch
---

Reject `javascript:`, `vbscript:`, and `data:` schemes on URL-bearing
`data-attr-*` bindings (`href`, `src`, `action`, `formaction`, `xlink:href`,
`data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`,
`manifest`) and refuse to bind `data-attr-srcdoc` entirely. The SDK
previously only blocked `on*` attribute names. This is defense-in-depth: a
script-bearing string surfacing in the public JSON feed would otherwise
execute in the partner page's origin when the element is activated.
Normalization mirrors browser URL-parser behavior (strips leading ASCII
whitespace/control bytes and embedded tab/LF/CR in the scheme prefix), so
common obfuscations like `java\tscript:` are still caught.
