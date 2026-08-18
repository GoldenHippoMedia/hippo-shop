---
"@goldenhippo/hippo-shop-sdk": major
---

Cluster G (v4): Superfunnel.ai pilot — session handoff, funnel events, and
destination links. A clean cut rather than a compatibility-preserving
migration: there are no production consumers of the 3.x line, and several of
its attribution behaviours were wrong.

**Breaking**

- `window.gh.checkoutUrl(slug)` is async: it returns `Promise<string>`, awaits
  session resolution, and fetches the destination if needed, so it can no
  longer hand back an unattributed URL. `window.open(await gh.checkoutUrl(x))`
  inside a click handler breaks the user-gesture chain and will be
  popup-blocked — assign `window.location.href` instead.
- Outbound links emit `sessionid` (was `session_id`) and `subid1`…`subid5`
  (was `sub_id1`…`sub_id5`), plus `landing_url`, `referral_url`,
  `sales_funnel`, the seven raw click-ids, and `origdsidOrig` /
  `origsplitTestingFunnelIdOrig` forwarded from the current URL. A
  `?session_id=` handoff was silently ignored downstream, which showed up as
  duplicate sessions and orphaned attribution.
- The session cookie is `hippo_session_id` (was `sessionId`) and its value is
  a UUID v4 (was a 12-character numeric string).
- `?sessionid=` on the landing URL is validated and adopted over any existing
  cookie value.
- The session POST body carries `affParameters.sessionId`, so the SDK's
  identifier and the server's `hippoSessionId` are the same value.
- `connect.sid` is never read or reasoned about again — it is `httpOnly` and
  the gate that read it was dead code. `gh:session-ready` detail is
  `{ sessionId, adopted, params }`: `hasConnectSid` is gone and `params` is
  never `null`.
- Click-id mapping is the canonical seven-row table (`fbclid`, `gclid`,
  `ScCid`, `qclid`, `twclid`, `ndclid`, `wbraid`) with correct slot semantics.
  3.x wrote `subId1='fb'` and the click value into `subId5` — the two slots
  reversed, and a literal no platform ever emits. Values are no longer
  truncated at 255 characters.
- Requires `@goldenhippo/hippo-shop-types@4.x`.
- New major means a new CDN line: `/sdk/v4/gh.js`.

**New**

- `Page View` funnel events (the 36-field payload) posted to
  `/public/v1/funnel-event`, gated on a resolvable funnel id, deduped in
  memory per page load, sent with `keepalive: true`.
- `data-gh-step` and `data-gh-funnel-id` attributes;
  `window.gh.track('Page View')` as the programmatic escape hatch.
- `data-gh-checkout` resolves through `destination.url`, so binding an offer
  navigates the visitor to that destination with attribution attached.

**Fixed — latent defects in the unreleased 3.x line**

- `gh.checkoutUrl` is one stable function identity that reads the session
  through a thunk. It used to be installed as a stub with an empty session and
  then *reassigned*, so a captured reference (a GTM variable, a React prop,
  `const f = gh.checkoutUrl`) composed URLs with no `sessionid` and no UTMs
  for the life of the page — with no error anywhere.
- The `gh:session-ready` rebind listener is registered before `ensureSession`
  is invoked, so a synchronously-resolved session still triggers a rebind.
- `data-gh-checkout` slugs are collected as destination resources, both
  `data-gh-checkout` and `data-gh-step` are in the MutationObserver's
  `attributeFilter`, and a completed destination load schedules a rebind —
  checkout links no longer strand at `href="#"`.
- `SPEC.md` named `/session` where the client posts `/public/v1/session`.

See `docs/superpowers/specs/2026-08-18-cluster-g-superfunnel-pilot-design.md`
for the full design. Supersedes the unreleased Cluster F changeset for this
package.
