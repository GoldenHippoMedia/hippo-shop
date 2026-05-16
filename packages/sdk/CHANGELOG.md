# @goldenhippo/hippo-shop-sdk

## 1.1.0

### Minor Changes

- bf93fe3: Send the publishable key as the dedicated `X-GH-Key` request header instead
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

### Patch Changes

- bcf9144: Reject `javascript:`, `vbscript:`, and `data:` schemes on URL-bearing
  `data-attr-*` bindings (`href`, `src`, `action`, `formaction`, `xlink:href`,
  `data`, `ping`, `poster`, `background`, `cite`, `longdesc`, `usemap`,
  `manifest`) and refuse to bind `data-attr-srcdoc` entirely. The SDK
  previously only blocked `on*` attribute names. This is defense-in-depth: a
  script-bearing string surfacing in the public JSON feed would otherwise
  execute in the partner page's origin when the element is activated.
  Normalization mirrors browser URL-parser behavior (strips leading ASCII
  whitespace/control bytes and embedded tab/LF/CR in the scheme prefix), so
  common obfuscations like `java\tscript:` are still caught.

## 1.0.1

### Patch Changes

- fe00224: Refresh README for npm package pages: add install commands, license badge, repository cross-links, and SLSA provenance section. No code changes — package metadata now declares the source repository (`repository` field), which is required for provenance verification.
- Updated dependencies [fe00224]
  - @goldenhippo/hippo-shop-types@1.0.1
