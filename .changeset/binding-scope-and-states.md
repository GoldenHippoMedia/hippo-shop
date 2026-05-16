---
"@goldenhippo/hippo-shop-sdk": minor
---

Add declarative miss-handling: `data-with` narrows the binding scope for a subtree
and hides on missing path; `data-when="loaded|loading|failed"` shows elements based
on the closest resource's lifecycle state. Together these let partners express
loading skeletons, error fallbacks, and tight direct-lookup cards purely in HTML.

The runtime now binds twice per pass: once with all unloaded resources marked
`loading` (so skeletons show immediately), then again after fetches settle.
`gh:bindings-ready` continues to fire once, after the post-fetch pass.

Adds `ApplyBindingsOptions.resourceStates` and the `ResourceState` type to the SDK
exports.
