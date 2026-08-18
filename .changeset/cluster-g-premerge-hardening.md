---
'@goldenhippo/hippo-shop-sdk': patch
---

Pre-release hardening found while reviewing Cluster G:

- **Logging can no longer break the host page.** `createLogger` guarded against a stubbed, nulled, or removed `console`; `boot()`'s pre-logger failure reports guarded the same way. Previously a privacy tool that made `console.warn` throw could strand `ensureSession` (leaving every `data-gh-checkout` link at `href="#"`), leave an anchor on a stale offer URL, or surface an uncaught error from `boot()`.
- **Blank attribute values no longer defeat funnel-event identity.** `firstDestinationSlug` and `readAttrPreferringPage` now skip empty values instead of collapsing a whole precedence tier — on a six-offer selector page the links kept working while identity silently degraded.
- **The `hippo_session_id` cookie branch is validated** against the same charset pattern as the URL branch, and falls through to a fresh id when it fails.
- **A dropped attribution POST now warns** instead of failing silently.
- Bundle is ~276 B smaller gzip (dead IIFE exports epilogue and class-field lowering removed); the gzip budget is tightened to 11KB.
