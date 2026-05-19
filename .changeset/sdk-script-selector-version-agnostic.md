---
"@goldenhippo/hippo-shop-sdk": patch
---

Fix the script-tag fallback selector in `findScript()` so it works for every
SDK major, not just v1. Previously the production-CDN selector hard-coded
`[src*="/sdk/v1/gh"]`, which became stale after v3 moved to `/sdk/v3/gh.js`.

In practice the bug was dormant because `document.currentScript` covers the
hot path and the local-dev `[src$="/gh.js"]` fallback covers most server-side
cases. It would only fire on a page where `document.currentScript` is null
*and* the SDK is served from a path the `/gh.js` suffix doesn't match.

The selector now uses `[src*="/sdk/"]`, which matches any `/sdk/vN/`
deployment. Test fixtures in `packages/sdk/test/{index,config}.spec.ts` are
updated from `/sdk/v1/gh.js` to `/sdk/v3/gh.js` to match the current major.

No runtime behavior change for existing callers.
