---
"@goldenhippo/hippo-shop-sdk": patch
---

Ship `llms.txt` and `llms-full.txt` alongside the SDK script. A build-time generator
(`packages/sdk/scripts/build-llms.mjs`) reads `packages/sdk/README.md` and
`packages/types/README.md` and writes two files into `dist/`:

- `llms.txt` — curated index per [llmstxt.org](https://llmstxt.org), listing the canonical docs, npm packages, and source repo.
- `llms-full.txt` — one-fetch concatenation of both READMEs with a provenance header, for LLMs that want a single download.

After this release, both files are served at:

- `https://api-prod.goldenhippo.io/sdk/v1/llms.txt`
- `https://api-prod.goldenhippo.io/sdk/v1/llms-full.txt`

No SDK runtime behavior changes.
