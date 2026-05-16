---
'@goldenhippo/hippo-shop-sdk': minor
---

Send the publishable key as the dedicated `X-GH-Key` request header instead
of `Authorization: Bearer <key>`. The previous Bearer shape did not fit
Kong's `key-auth` plugin natively (which does an exact-value match against
the configured header), so the gateway either had to store keys with a
`Bearer ` prefix baked in or run a custom Lua plugin to strip the scheme.
Moving to a dedicated header lets Kong validate keys with default
configuration and keeps the `Authorization` header free for other purposes.

The wire contract is partner-facing only via `data-key` on the `<script>`
tag — no partner has to change anything. Internal callers using `curl` or
custom integrations must swap `-H "Authorization: Bearer gh_pk_…"` for
`-H "X-GH-Key: gh_pk_…"`.
