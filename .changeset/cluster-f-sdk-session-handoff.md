---
"@goldenhippo/hippo-shop-sdk": minor
---

Cluster F: SDK session, UTM, and checkout handoff.

The SDK now captures attribution on landing — parses UTM and click-id query
params (v1 ships fbclid → subId1='fb', subId5=<value>; the registry is
extensible), persists them via a POST to `/public/v1/session` (wrapped in
`affParameters`), and manages a 30-day `sessionId` cookie at the brand's
root domain. On checkout handoff, the SDK composes outbound URLs with
`order_form_id`, `session_id`, and the captured params.

New public surface:

- Script-tag attributes: `data-checkout-base`, `data-cookie-domain`.
- DOM attribute: `data-gh-checkout="<destination-slug>"` on `<a>` /
  `<button>` / arbitrary elements.
- `window.gh.checkoutUrl(slug)` — synchronous composed-URL getter.
- `window.gh.session.id()` / `window.gh.session.params()` — accessors.
- `gh:session-ready` event on `window` with `{ sessionId, hasConnectSid, params }`.

Every failure path is non-fatal: network errors, blocked cookies, missing
config — all log and degrade gracefully. Attribution may degrade for the
visit; the page never breaks.

Has hard API-side prerequisites (new `/public/v1/session` Kong route,
root-domain `Set-Cookie` for `connect.sid`, CORS-with-credentials) that
must land in parallel. The SDK ships safe even before the API side is in
place — the POST fails gracefully and the rest of the SDK continues to
work.

See `docs/superpowers/specs/2026-05-19-cluster-f-session-utm-checkout-handoff-design.md` for the full design.
