---
"@goldenhippo/hippo-shop-sdk": patch
---

Fix: funnel-event identity (`resolveEventIdentity`) now falls back to the
`/fst`-minted URL params Golden Hippo's ad-tracking flow actually carries,
when neither a destination DTO nor an author `data-gh-*` attribute supplies
a value.

- `funnelId` (`funnelSTFId`/`mainFunnelId`) additionally falls back to
  `?origmainFunnelIdOrig=`.
- `destinationId` additionally falls back to `?origdsidOrig=`, then `?dsid=`.
- `funnelSTPId` additionally falls back to `?funnelSTPId=`, but **only** when
  no funnel-step DTO resolves one — that URL param is a one-time snapshot
  minted at the `/fst` hop as the funnel's step-1 id and never refreshed on
  later hops, so it must never outrank a live DTO lookup.
- Precedence throughout is destination DTO → author attribute → URL param.
- `origmainFunnelIdOrig` is now forwarded on outbound `data-gh-checkout` /
  `gh.checkoutUrl()` links, alongside the existing `origdsidOrig` /
  `origsplitTestingFunnelIdOrig` forwarding. `funnelSTPId` and `dsid` are
  deliberately never forwarded, since the destination resolver re-mints
  `funnelSTPId` per hop and a forwarded value would be stale on arrival.

**Behavioural consequence — this is the point of the fix, not a side
effect:** a page that binds no `data-gh-destination`/`data-gh-checkout` and
sets no `data-gh-funnel-id`, but arrives from the real ad-tracking flow
(`/cid` → `/fst`), previously dropped its `Page View` silently at the
funnel-id gate. It now emits. Expect per-page and per-funnel emit counts to
move upward as a result, particularly on pages like
`drmarty-postpurchase`/`roundhouse-postpurchase` that carry the identity
params but bind nothing.
