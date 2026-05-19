#!/usr/bin/env node
// notify-slack-release.mjs — posts one Slack message after a release publishes.
// Reads: SLACK_WEBHOOK_URL, PUBLISHED_PACKAGES (JSON), GITHUB_REPOSITORY.
// Flags: --dry-run prints the payload to stdout instead of POSTing.
// Every failure path is non-fatal (exit 0): the publish already succeeded.

import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');

const PACKAGE_DIRS = {
  '@goldenhippo/hippo-shop-sdk': 'packages/sdk',
  '@goldenhippo/hippo-shop-types': 'packages/types',
};

const EXCERPT_MAX_CHARS = 500;

/** Mirror a line to stderr and (best-effort) to $GITHUB_STEP_SUMMARY. */
function logSummary(line) {
  process.stderr.write(`${line}\n`);
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `- ${line}\n`);
  } catch {
    // GITHUB_STEP_SUMMARY is best-effort; never fail the step over a log line.
  }
}

async function main() {
  const webhookUrl = process.env['SLACK_WEBHOOK_URL'] ?? '';
  if (!webhookUrl && !DRY_RUN) {
    logSummary('Slack webhook not configured; skipping');
    process.exit(0);
  }
  // (Remainder filled in by later tasks.)
  logSummary('notify-slack-release: skeleton invoked');
  process.exit(0);
}

main().catch((err) => {
  logSummary(`notify-slack-release: unexpected error: ${err?.message ?? err}`);
  process.exit(0);
});
