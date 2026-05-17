#!/usr/bin/env node
// Generates dist/llms.txt (curated index per llmstxt.org) and dist/llms-full.txt
// (one-fetch concatenation of the SDK + Types READMEs) at SDK build time.
//
// Runs as part of `pnpm --filter @goldenhippo/hippo-shop-sdk build`. The
// existing Cloudflare Pages deploy in .github/workflows/release.yml publishes
// everything in dist/, so the resulting files land at
// https://api-prod.goldenhippo.io/sdk/v1/{llms.txt,llms-full.txt} after the
// next release.
//
// Source: docs/superpowers/specs/2026-05-16-llms-txt-design.md

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SCRIPT_DIR   = new URL('.', import.meta.url);
const SDK_README   = new URL('../README.md', SCRIPT_DIR);
const TYPES_README = new URL('../../types/README.md', SCRIPT_DIR);
const DIST_DIR     = new URL('../dist/', SCRIPT_DIR);
const LLMS_TXT     = new URL('llms.txt', DIST_DIR);
const LLMS_FULL    = new URL('llms-full.txt', DIST_DIR);

// Static curated index. To add a new doc source, edit this string.
const LLMS_TXT_BODY = `# Hippo Shop SDK

> Browser SDK for reading Golden Hippo public data — funnels, destinations, products — from external pages with two lines of HTML.

The SDK ships two complementary surfaces: declarative \`data-gh-*\` attribute bindings (no JavaScript required) and a programmatic \`window.gh.data\` API. Both share the same auth, caching, and brand-scoped access rules enforced by the API.

## Documentation

- [SDK README](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/packages/sdk/README.md): Full attribute reference, built-in and custom formatters, lifecycle events, programmatic API, error codes, safety guarantees, and the advanced TypeScript / NPM surface
- [Types README](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/packages/types/README.md): DTO shapes for funnel, destination, and product resources, with field definitions and example JSON responses
- [Full content (one-fetch)](https://api-prod.goldenhippo.io/sdk/v1/llms-full.txt): Both READMEs concatenated for LLMs that want a single download

## Packages

- [@goldenhippo/hippo-shop-sdk](https://www.npmjs.com/package/@goldenhippo/hippo-shop-sdk): Browser SDK on npm
- [@goldenhippo/hippo-shop-types](https://www.npmjs.com/package/@goldenhippo/hippo-shop-types): DTO contract on npm (type-only, zero runtime deps)

## Examples

- [Live demo set](https://github.com/GoldenHippoMedia/hippo-shop/tree/main/apps/examples-static): Funnel step, offer selector, and PDP archetype pages — open any HTML file directly in a browser

## Source

- [GitHub repository](https://github.com/GoldenHippoMedia/hippo-shop): Monorepo with the SDK source, type definitions, and demos
`;

const SEPARATOR = '='.repeat(80);

function fullHeader(timestamp) {
  return `# Hippo Shop SDK — full documentation (single fetch)
# Sources: packages/sdk/README.md, packages/types/README.md
# Canonical: https://github.com/GoldenHippoMedia/hippo-shop
# Generated: ${timestamp}

`;
}

async function readOrFail(url, label) {
  try {
    return await readFile(url, 'utf8');
  } catch (err) {
    console.error(`[build-llms] FAIL: cannot read ${label} (${url.pathname}): ${err.message}`);
    process.exit(1);
  }
}

const [sdkReadme, typesReadme] = await Promise.all([
  readOrFail(SDK_README, 'SDK README'),
  readOrFail(TYPES_README, 'Types README'),
]);

// ISO 8601 truncated to second precision — keeps the timestamp compact and
// avoids second-fractional churn between rapid rebuilds.
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const llmsFull =
  fullHeader(now) +
  SEPARATOR + '\n' +
  '# SDK README\n' +
  SEPARATOR + '\n\n' +
  sdkReadme.trimEnd() + '\n\n' +
  SEPARATOR + '\n' +
  '# Types README\n' +
  SEPARATOR + '\n\n' +
  typesReadme.trimEnd() + '\n';

await mkdir(DIST_DIR, { recursive: true });
await writeFile(LLMS_TXT, LLMS_TXT_BODY, 'utf8');
await writeFile(LLMS_FULL, llmsFull, 'utf8');

console.log(`[build-llms] wrote ${LLMS_TXT.pathname} (${LLMS_TXT_BODY.length} bytes)`);
console.log(`[build-llms] wrote ${LLMS_FULL.pathname} (${llmsFull.length} bytes)`);
