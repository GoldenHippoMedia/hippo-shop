---
'@goldenhippo/hippo-shop-sdk': minor
---

Read `?sessionId=` case-insensitively, and add three toggles for pages where another system owns session identity.

**Fixed: the inbound handoff param is now matched case-insensitively.** Superfunnel navigates to the offer selector with `?sessionId=` (camelCase); the SDK matched the key exactly, so it never adopted that id and minted a UUID of its own instead. The two systems then disagreed about who the visitor was for the whole session. `?sessionId=`, `?sessionid=` and `?SESSIONID=` are now all adopted. Where a URL carries the param more than once — Superfunnel appends its own to every link on the page — the first occurrence wins, matching the funnel and every other reader. Outbound checkout links still *write* lowercase `sessionid`: the SDK reads liberally and writes exactly.

New script-tag attributes, all optional and all defaulting to today's behaviour:

- `data-session="off"` — disable session identity entirely: no `POST /public/v1/session`, no `hippo_session_id` cookie, no `sessionid=` on outbound links. Landing attribution is still parsed, so UTM and click-id params keep riding checkout links. Implies `data-events="off"`, because an event with no session id is unattributable.
- `data-checkout-sessionid="off"` — stop writing `sessionid=` onto outbound checkout URLs while leaving the session, the cookie and funnel events fully working. Knowingly gives up SDK ownership of that param, so a foreign `sessionid` baked into a Salesforce destination record now survives; the warning still fires, with a message saying so.
- `data-events="off"` — the `Page View`/`New Session` emitter is not installed and `gh.track()` becomes a no-op. It stays callable so existing page code does not start throwing.
- `data-session-url-first="true"` — make `?sessionid=` outrank the `hippo_session_id` cookie. Off by default, since cookie-first is what stops an inbound link re-keying a returning visitor on every visit; turn it on only where another system owns visitor identity, such as Superfunnel-hosted pages, where a 30-day-old cookie must not beat the id Superfunnel just put on the URL.

`data-session`, `data-checkout-sessionid` and `data-events` accept `"off"` and `"false"` interchangeably. Anything unrecognized leaves the feature on — a typo that silently disabled session tracking for a brand would return `200`s and surface only in a missing-revenue report.
