---
'@goldenhippo/hippo-shop-sdk': minor
---

Add `data-params` and `data-param-map` for hardcoding and remapping attribution params.

`data-params="subid2=superfunnel&subid3=quiz-a"` hardcodes attribution values onto the page; `data-param-map="sessionId=subid2&ref=subid3"` files an inbound URL param the SDK has no rule for under one it does send, matching the inbound key case-insensitively. Both are parsed as query strings, name params in their outbound spelling (`subid2`, not `subId2`), and apply to both consumers — `affParameters` on `POST /public/v1/session` and every outbound checkout link.

Both fill a slot only when it is still empty, so the precedence ladder is: an explicit URL param, then the click-id table, then `data-param-map`, then `data-params`. Anything derived from the URL beats anything the script tag says, which means neither attribute can erase attribution — but also that a target of `subid1`/`subid4`/`subid5` loses on exactly the paid traffic where it would have mattered. `subid2` and `subid3` are the only slots the SDK never derives into and are the ones to reach for.

A target the SDK does not send is dropped with a console warning rather than invented as a new param; a malformed attribute yields no pairs rather than refusing to boot.
