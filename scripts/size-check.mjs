#!/usr/bin/env node
// SDK bundle size guard. Fails if the gzipped IIFE bundle exceeds the budget.
// Wired into the SDK package as `pnpm size`, and into CI on every PR.

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUDGET_BYTES = 8 * 1024;
const BUNDLE = resolve(__dirname, '..', 'packages', 'sdk', 'dist', 'gh.js');

if (!existsSync(BUNDLE)) {
  console.error(`[size-check] bundle not found at ${BUNDLE} — run \`pnpm --filter @goldenhippo/hippo-shop-sdk build\` first.`);
  process.exit(2);
}

const raw = readFileSync(BUNDLE);
const gzipped = gzipSync(raw, { level: 9 });

const fmt = (n) => `${(n / 1024).toFixed(2)} KB (${n} B)`;
const pct = ((gzipped.length / BUDGET_BYTES) * 100).toFixed(1);

console.log(`[size-check] raw:     ${fmt(raw.length)}`);
console.log(`[size-check] gzip:    ${fmt(gzipped.length)}`);
console.log(`[size-check] budget:  ${fmt(BUDGET_BYTES)} (${pct}% used)`);

if (gzipped.length > BUDGET_BYTES) {
  console.error(`[size-check] ❌ over budget by ${fmt(gzipped.length - BUDGET_BYTES)}`);
  process.exit(1);
}
console.log('[size-check] ✅ under budget');
