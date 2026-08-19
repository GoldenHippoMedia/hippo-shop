---
'@goldenhippo/hippo-shop-sdk': patch
---

Fetch the funnel by id as well as by slug, so a page arriving with only `?origmainFunnelIdOrig=` resolves its step.

`GET /public/v1/funnel/{funnelSlugOrId}` resolves both forms — the slug `ultimateh2_cms_osstart_260520_p` and the id `a0qQL00000KlmGzYAJ` return the same funnel. The SDK only treated the slug-shaped sources (`data-gh-funnel`, `?origuidOrig=`, `?uid=`) as lookup keys, so a page that knew its funnel's id but not its slug had no key at all: the funnel was never fetched, and step resolution fell through to whatever `?funnelSTPId=` happened to carry.

That is the common case, not an edge one — the `/fst` hop mints `origmainFunnelIdOrig` on every real inbound link. Landing on `/order-form` with `?origmainFunnelIdOrig=<id>` now fetches the funnel and matches the `order-form` step by path segment, where before it emitted a Page View with a null `funnelSTPId` and made no funnel request at all.

`data-gh-funnel-id` and `?origmainFunnelIdOrig=` are now lookup keys too, ranked below the slug-shaped sources. Funnel-identity precedence is unchanged.
