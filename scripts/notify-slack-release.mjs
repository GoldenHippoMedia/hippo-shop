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
const ERROR_BODY_MAX_CHARS = 500; // defensive cap for log-line safety on non-2xx Slack responses

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

/** Quote every line of `body` with `> ` so Slack renders it as a blockquote. */
function quoteLines(body) {
  return body
    .split('\n')
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

/** Truncate the raw body to EXCERPT_MAX_CHARS, appending an ellipsis if cut. */
function truncate(body) {
  if (body.length <= EXCERPT_MAX_CHARS) return body;
  return body.slice(0, EXCERPT_MAX_CHARS - 1) + '…';
}

/**
 * Build the Slack mrkdwn payload for a release.
 *
 * @param {{name: string, version: string}[]} publishedPackages
 * @param {(name: string, version: string) => {excerpt: string, mapped: boolean}} getChangelog
 *        Returns the raw (pre-truncation, pre-quote) excerpt for a package@version,
 *        plus a `mapped` flag — false when the package is not in PACKAGE_DIRS.
 * @param {string} repoFullName e.g. "GoldenHippoMedia/hippo-shop"
 * @returns {{ text: string, mrkdwn: true }}
 */
export function buildPayload(publishedPackages, getChangelog, repoFullName) {
  const sections = publishedPackages.map(({ name, version }) => {
    const tag = `${name}@${version}`;
    const releaseUrl = `https://github.com/${repoFullName}/releases/tag/${encodeURIComponent(tag)}`;
    const headerLine = `*<${releaseUrl}|${tag}>*`;
    const { excerpt, mapped } = getChangelog(name, version);
    let body;
    if (!mapped) {
      body = '> _(see CHANGELOG)_';
    } else if (!excerpt) {
      body = '> _(no notable changes)_';
    } else {
      body = quoteLines(truncate(excerpt));
    }
    return `${headerLine}\n${body}`;
  });
  const text = [':package: *Hippo Shop released*', ...sections].join('\n\n');
  return { text, mrkdwn: true };
}

function readChangelogExcerpt(name, version) {
  const dir = PACKAGE_DIRS[name];
  if (!dir) {
    logSummary(`Package ${name} is not in PACKAGE_DIRS; rendering '(see CHANGELOG)' fallback`);
    return { excerpt: '', mapped: false };
  }
  const path = resolve(process.cwd(), dir, 'CHANGELOG.md');
  let md;
  try {
    md = readFileSync(path, 'utf8');
  } catch (err) {
    logSummary(`Could not read ${path}: ${err?.message ?? err}; rendering '(see CHANGELOG)' fallback`);
    return { excerpt: '', mapped: false };
  }
  return { excerpt: extractChangelogSection(md, version), mapped: true };
}

async function main() {
  const webhookUrl = process.env['SLACK_WEBHOOK_URL'] ?? '';
  if (!webhookUrl && !DRY_RUN) {
    logSummary('Slack webhook not configured; skipping');
    process.exit(0);
  }

  const repoFullName = process.env['GITHUB_REPOSITORY'] ?? 'GoldenHippoMedia/hippo-shop';

  let publishedPackages;
  try {
    publishedPackages = JSON.parse(process.env['PUBLISHED_PACKAGES'] ?? '[]');
  } catch (err) {
    logSummary(`PUBLISHED_PACKAGES is not valid JSON: ${err?.message ?? err}; skipping`);
    process.exit(0);
  }
  if (!Array.isArray(publishedPackages) || publishedPackages.length === 0) {
    logSummary('PUBLISHED_PACKAGES is empty or not an array; skipping');
    process.exit(0);
  }

  const payload = buildPayload(publishedPackages, readChangelogExcerpt, repoFullName);

  if (DRY_RUN) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
  }

  let res;
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logSummary(`Slack POST threw: ${err?.message ?? err}`);
    process.exit(0);
  }

  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, ERROR_BODY_MAX_CHARS);
    } catch (_err) {
      // res.text() can throw on truncated or malformed HTTP responses;
      // the empty body is fine — the status code was already logged above.
    }
    logSummary(`Slack POST returned ${res.status}: ${body}`);
    process.exit(0);
  }

  logSummary(`Slack notification sent for ${publishedPackages.length} package(s)`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logSummary(`notify-slack-release: unexpected error: ${err?.message ?? err}`);
    process.exit(0);
  });
}
