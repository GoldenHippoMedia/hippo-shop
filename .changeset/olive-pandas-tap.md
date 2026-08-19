---
'@goldenhippo/hippo-shop-sdk': minor
'@goldenhippo/hippo-shop-types': minor
---

Gate funnel events on declared funnel identity, add `New Session`, and carry session data in the event body.

**Action required — a page that only binds destinations no longer emits a funnel event.** Funnel identity previously came from a bound destination's `funnelId`, which meant a selector page with twelve offers emitted a Page View attributed to whichever offer happened to be first in the DOM — on any navigation, including a typed URL. Identity now comes only from what the page or the inbound link actually asserts about the funnel: `data-gh-funnel-id`, then the funnel named by `data-gh-funnel` / `?origuidOrig=` / `?uid=`, then `?origmainFunnelIdOrig=`. To keep emitting from such a page, declare the funnel on it.

**Action required — `HippoShopFunnelDTO` gains a required `id`.** The funnel's Salesforce id, needed as `funnelSTFId` / `mainFunnelId`. Without it a page could name its funnel by slug but never emit an event for it, because the upstream drops events whose `funnelSTFId` is blank.

**Action required — the session-id resolution order is reversed.** It is now the `hippo_session_id` cookie, then `?sessionid=`, then a minted UUIDv4. A returning visitor keeps the session they already have; the param is honoured only when there is no cookie, which is how a new visitor arriving from Superfunnel adopts the id it minted. The reference funnel app ranks the param first only because its own `/cid` router already reconciles against the cookie server-side — a hop that does not exist here.

**The session POST response is now authoritative.** When it returns a `sessionId` differing from the locally resolved one, the SDK adopts it and rewrites the cookie before `gh:session-ready` fires, so `gh.session.id()`, outbound `sessionid=` params, funnel events and the dedupe key all agree on the id the server actually has in force.

**New event type `New Session`.** Same 36-field payload as `Page View`, only `eventType` differs. It fires once per page load when the session was established on that load and a funnel id resolved. On a cold load both events fire, in that order.

**Funnel events now carry `affParams`.** The body is `{ ...event, affParams: <the session POST's response> }`. This is how attribution reaches the upstream without needing `connect.sid` on a cross-site request — which no browser would send today anyway, since that cookie is issued without `SameSite=None; Secure`.

**Step resolution gained two tiers.** `data-gh-step` matched against the funnel's steps, then the current URL's last path segment with any file extension stripped, then `?funnelSTPId=`, then — when the funnel has exactly one step — that step. The single-step fallback is the supported way to model a pre-purchase funnel built elsewhere as one Salesforce funnel.
