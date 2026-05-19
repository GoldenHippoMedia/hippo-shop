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

/**
 * Slice the body of a `## <version>` section out of a CHANGELOG.md.
 * Stops at the next `## ` (H2) heading or end-of-file. `### ` (H3) headings
 * inside the section are preserved — only true H2 boundaries terminate.
 * Returns the trimmed body, or '' if the section is not found.
 */
export function extractChangelogSection(markdown, version) {
  if (typeof markdown !== 'string' || !version) return '';
  const lines = markdown.split('\n');
  const target = `## ${version}`;
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === target) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return '';
  const body = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Match H2 (## ) but NOT H3+ (### , #### , ...).
    if (line.startsWith('## ') && !line.startsWith('### ')) break;
    body.push(line);
  }
  return body.join('\n').trim();
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
