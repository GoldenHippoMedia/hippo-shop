---
'@goldenhippo/hippo-shop-sdk': patch
---

Fix the custom-formatter example, which taught a registration pattern that silently does nothing on most pages.

The example registered the formatter inside a `gh:data-ready` listener. That event is dispatched **synchronously from inside `boot()`**, while the SDK's own `<script>` is still executing — so it has already fired before any inline script placed below the SDK tag runs, and a listener added from there never fires at all. The formatter is never registered, `data-format` finds no such formatter, and the element renders the **raw** bound value. For a number that reads as a plausible result rather than as a bug: a savings field renders `105` where the page meant `44%`, with nothing in the console.

Since the SDK is normally loaded in the `<head>` and page authors write markup and scripts in the `<body>`, the documented pattern failed in the common case. The README already described this hazard correctly under *Defensive "already booted?" pattern*, and already noted under *Inline-script timing* that `gh.refresh()` is unnecessary before the first bind pass — but the canonical example contradicted both.

The example now registers directly from an inline script after the SDK tag, with no listener and no `gh.refresh()`, and carries a note explaining when each is actually needed. Verified in a browser against a live destination: direct registration renders `44%`; the previous listener form renders `105`.

Documentation only — no runtime or type changes. This release exists so the corrected README reaches npmjs.com, which renders the README captured at publish time.
