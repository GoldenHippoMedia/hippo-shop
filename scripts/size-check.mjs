#!/usr/bin/env node
// SDK bundle size guard. Fails if the gzipped IIFE bundle exceeds the budget.
// Wired into the SDK package as `pnpm size`, and into CI on every PR.

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * 12 KB gzipped — the transfer size a browser actually pays for `gh.js`.
 *
 * Chosen against the 2026 third-party-script benchmark
 * (https://scripts.nuxt.com/learn/analytics-script-performance), which groups
 * real tags by measured transfer size:
 *
 *   Plausible 1.9 KB · Fathom 3.0 KB · Umami 3.2 KB      <- ping-only trackers
 *   Rybbit 9.3 KB · Cloudflare 10.7 KB · Databuddy 10.8 KB <- this tier
 *   Segment 30.3 KB · Matomo 61.5 KB · GA4 154.9 KB       <- full tag platforms
 *
 * `gh.js` is ~10.8 KB transfer / ~31 KB decoded, which puts it level with
 * Cloudflare Web Analytics (10.7 / 30.4) while doing strictly more: declarative
 * data binding, session identity, attribution parsing, checkout-URL composition
 * and funnel events. The nearest comparable in *capability* is Segment, and we
 * are under half its weight.
 *
 * So the budget encodes one commitment: **stay in the lightweight tier.** 12 KB
 * is that tier's ceiling plus ~11% working headroom. It is deliberately not
 * 16 KB or 20 KB — a budget the bundle cannot realistically reach constrains
 * nothing, and the drift it would permit runs toward Segment's tier, where the
 * cost stops being theoretical (GA4's 155 KB is ~100-150ms of main-thread work
 * on mid-range mobile).
 *
 * Decoded size, not transfer size, is what costs main-thread time — gzip does
 * not make a function cheaper to parse and run. Transfer is the proxy measured
 * here because it is stable and cheap to check; if the ratio to decoded size
 * ever moves sharply, re-check the real number rather than trusting this one.
 *
 * **When this is hit, the answer is trimming, not raising.** The budget was
 * 8 KB at the initial commit and moved to 11 KB in ddc2e52 when v4's session
 * and event work busted it — with no rationale recorded either time, which is
 * how it came to be re-litigated under deadline. Source has grown ~4.8x since
 * that first number while the ceiling moved 1.4x, so the squeeze is real; but
 * `events.ts` alone is ~43 KB of source, the largest module by a wide margin,
 * and has not been examined for savings. Raise this only with a measurement
 * showing the trimming was done and was not enough.
 */
const BUDGET_BYTES = 12 * 1024;
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
