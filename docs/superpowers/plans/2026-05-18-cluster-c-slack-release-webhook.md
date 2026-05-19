# Cluster C — Slack release webhook in CI: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single aggregated Slack notification step to `.github/workflows/release.yml` that fires after both npm publish and the Cloudflare Pages deploy succeed, posting a mrkdwn message with package names, versions, quoted CHANGELOG excerpts, and per-package GitHub Release links.

**Architecture:** A new ~80 LOC ESM Node script at `scripts/notify-slack-release.mjs` reads two env vars (`SLACK_WEBHOOK_URL`, `PUBLISHED_PACKAGES`) plus the default workflow env (`GITHUB_REPOSITORY`), walks the published packages, slices each one's `## <version>` section out of its `CHANGELOG.md`, builds a Slack mrkdwn payload, and POSTs. All failure modes are non-fatal (`exit 0`) so a Slack outage never paints a successful release red. The workflow gets one new `Notify Slack` step appended to the `release` job, gated on `steps.changesets.outputs.published == 'true'`.

**Tech Stack:** Node 24 built-ins only (no npm dependencies) — `node:fs`, `node:path`, global `fetch`. GitHub Actions workflow YAML. Slack incoming-webhook URL with mrkdwn payload.

**Spec:** [`docs/superpowers/specs/2026-05-18-cluster-c-slack-release-webhook-design.md`](../specs/2026-05-18-cluster-c-slack-release-webhook-design.md)

**Branch:** `feat/cluster-c-slack-release-webhook` (already created and checked out; spec already committed on it as `d2901b5`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/notify-slack-release.mjs` | Create | Main script. Exports `extractChangelogSection`, `buildPayload`. Has a `main()` that orchestrates env-read → loop → POST. Handles every failure non-fatally. |
| `.github/workflows/release.yml` | Modify | Append one `Notify Slack` step at the end of the `release` job. |
| `ROADMAP.md` | Modify | On ship, move the Cluster C entry from "Open items" to "Done". |

No new test files (spec explicitly opts out of automated tests for this script; verification happens via `--dry-run` against the real on-disk CHANGELOG.md).

---

## Tasks

### Task 1: Script skeleton + `--dry-run` flag + missing-secret short-circuit

**Files:**
- Create: `scripts/notify-slack-release.mjs`

- [ ] **Step 1: Create the script skeleton**

Create `scripts/notify-slack-release.mjs` with this exact content:

```js
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
```

Note: `readFileSync` and `resolve` are imported up-front because Tasks 2 and 4 use them. The eslint config does not flag unused imports as errors for `*.mjs` files outside the Nx graph (this script is in `scripts/`, which is not part of any project), so the brief unused state during this task is fine.

- [ ] **Step 2: Smoke-test the skeleton**

Run from repo root:

```bash
SLACK_WEBHOOK_URL='' PUBLISHED_PACKAGES='[]' node scripts/notify-slack-release.mjs --dry-run
```

Expected stderr output:
```
notify-slack-release: skeleton invoked
```

Exit code: 0. The `--dry-run` flag should bypass the secret check so the skeleton message prints.

Now verify the missing-secret path without `--dry-run`:

```bash
SLACK_WEBHOOK_URL='' node scripts/notify-slack-release.mjs
```

Expected stderr:
```
Slack webhook not configured; skipping
```

Exit code: 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/notify-slack-release.mjs
git commit -m "feat(ci): scaffold Slack release notification script

Skeleton for scripts/notify-slack-release.mjs: env reading, --dry-run
flag detection, missing-secret short-circuit, and a logSummary helper
that mirrors to stderr and \$GITHUB_STEP_SUMMARY. Every error path
exits 0 so a Slack outage never paints a successful release red.

Subsequent commits fill in the changelog parser, payload builder, and
HTTP POST.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `extractChangelogSection()` — slice `## <version>` body

**Files:**
- Modify: `scripts/notify-slack-release.mjs`

- [ ] **Step 1: Add the function near the top of the file**

Insert this function just above `async function main()`:

```js
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
```

- [ ] **Step 2: Verify against the real SDK CHANGELOG**

Run from repo root:

```bash
node --input-type=module -e "
import { extractChangelogSection } from './scripts/notify-slack-release.mjs';
import { readFileSync } from 'node:fs';
const md = readFileSync('packages/sdk/CHANGELOG.md', 'utf8');
const body = extractChangelogSection(md, '3.0.0');
console.log('--- 3.0.0 section ---');
console.log(body);
console.log('--- end ---');
console.log('length:', body.length);
"
```

Expected: the printed section contains the "Major Changes" subheading and the line starting with `- b4f8dbb: **Breaking:** Removed the \`enrichProduct\` export.`, AND the "Patch Changes" subheading with the dependencies-updated bullet. The next section's `## 2.1.1` header MUST NOT appear in the body. Length > 0.

Now check a non-existent version:

```bash
node --input-type=module -e "
import { extractChangelogSection } from './scripts/notify-slack-release.mjs';
const out = extractChangelogSection('# title\n\n## 1.0.0\n\nhello', '9.9.9');
console.log(JSON.stringify(out));
"
```

Expected stdout: `""`

- [ ] **Step 3: Commit**

```bash
git add scripts/notify-slack-release.mjs
git commit -m "feat(ci): add extractChangelogSection() helper

Pure function that slices a CHANGELOG.md's \`## <version>\` body up to
the next H2 heading (or EOF). Handles H3 subheadings ('### Patch
Changes' etc.) inside the section without terminating early. Returns
'' if the section is missing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `buildPayload()` — assemble the Slack mrkdwn message

**Files:**
- Modify: `scripts/notify-slack-release.mjs`

- [ ] **Step 1: Add the helper and the main builder**

Insert these two functions just below `extractChangelogSection`:

```js
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
  const text = [':package: *Hippo Shop released*', '', ...sections].join('\n\n');
  return { text, mrkdwn: true };
}
```

- [ ] **Step 2: Verify the builder against fixture inputs**

Run from repo root:

```bash
node --input-type=module -e "
import { buildPayload } from './scripts/notify-slack-release.mjs';
const fakeChangelog = (_name, _version) => ({ excerpt: 'Fix the script-tag fallback selector.', mapped: true });
const payload = buildPayload(
  [{ name: '@goldenhippo/hippo-shop-sdk', version: '3.0.1' }],
  fakeChangelog,
  'GoldenHippoMedia/hippo-shop'
);
console.log(JSON.stringify(payload, null, 2));
"
```

Expected stdout: a JSON object whose `text` field contains all of the following substrings:
- `:package: *Hippo Shop released*`
- `*<https://github.com/GoldenHippoMedia/hippo-shop/releases/tag/%40goldenhippo%2Fhippo-shop-sdk%403.0.1|@goldenhippo/hippo-shop-sdk@3.0.1>*`
- `> Fix the script-tag fallback selector.`

And `mrkdwn: true`.

Now check the empty-excerpt fallback:

```bash
node --input-type=module -e "
import { buildPayload } from './scripts/notify-slack-release.mjs';
const fakeChangelog = () => ({ excerpt: '', mapped: true });
const payload = buildPayload(
  [{ name: '@goldenhippo/hippo-shop-types', version: '3.0.1' }],
  fakeChangelog,
  'GoldenHippoMedia/hippo-shop'
);
console.log(payload.text);
"
```

Expected stdout includes the line: `> _(no notable changes)_`.

And the unmapped-package fallback:

```bash
node --input-type=module -e "
import { buildPayload } from './scripts/notify-slack-release.mjs';
const fakeChangelog = () => ({ excerpt: '', mapped: false });
const payload = buildPayload(
  [{ name: '@goldenhippo/unknown-future-package', version: '0.1.0' }],
  fakeChangelog,
  'GoldenHippoMedia/hippo-shop'
);
console.log(payload.text);
"
```

Expected stdout includes the line: `> _(see CHANGELOG)_`.

- [ ] **Step 3: Commit**

```bash
git add scripts/notify-slack-release.mjs
git commit -m "feat(ci): add buildPayload() Slack mrkdwn assembler

Pure function that assembles the Slack mrkdwn payload from a list of
{name, version} packages plus an injectable getChangelog callback.
Constructs per-package GitHub Release links via encodeURIComponent on
the tag, quotes each excerpt as a Slack blockquote, truncates >500
char bodies with an ellipsis, and falls back to '(no notable changes)'
or '(see CHANGELOG)' as appropriate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire up `main()` — read env, read files, POST

**Files:**
- Modify: `scripts/notify-slack-release.mjs`

- [ ] **Step 1: Replace the `main()` body with the real orchestrator**

Replace the entire existing `async function main() { ... }` with this:

```js
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
      body = (await res.text()).slice(0, 500);
    } catch {}
    logSummary(`Slack POST returned ${res.status}: ${body}`);
    process.exit(0);
  }

  logSummary(`Slack notification sent for ${publishedPackages.length} package(s)`);
  process.exit(0);
}
```

- [ ] **Step 2: Dry-run against the live SDK CHANGELOG**

Run from repo root with a synthetic `PUBLISHED_PACKAGES` that references the real CHANGELOG entry on disk:

```bash
PUBLISHED_PACKAGES='[{"name":"@goldenhippo/hippo-shop-sdk","version":"3.0.0"},{"name":"@goldenhippo/hippo-shop-types","version":"3.0.0"}]' \
GITHUB_REPOSITORY='GoldenHippoMedia/hippo-shop' \
node scripts/notify-slack-release.mjs --dry-run
```

Expected: a single JSON payload printed to stdout. Sanity-check by eye:

- `text` starts with `:package: *Hippo Shop released*\n\n`
- Two `*<https://github.com/GoldenHippoMedia/hippo-shop/releases/tag/...|@goldenhippo/...>*` headers, one per package, with `%40` and `%2F` encoded.
- The SDK section's blockquoted body mentions `enrichProduct` and `Patch Changes`.
- The types section either shows its real 3.0.0 excerpt or the `_(no notable changes)_` fallback — both are valid; eyeball the file at `packages/types/CHANGELOG.md` to decide which is expected.
- `mrkdwn` is `true`.

Now test the unmapped-package path:

```bash
PUBLISHED_PACKAGES='[{"name":"@goldenhippo/not-a-real-package","version":"1.0.0"}]' \
GITHUB_REPOSITORY='GoldenHippoMedia/hippo-shop' \
node scripts/notify-slack-release.mjs --dry-run 2>&1
```

Expected stderr includes `Package @goldenhippo/not-a-real-package is not in PACKAGE_DIRS; rendering '(see CHANGELOG)' fallback`, stdout payload contains `> _(see CHANGELOG)_`.

And the invalid-JSON path:

```bash
SLACK_WEBHOOK_URL='https://example.invalid' \
PUBLISHED_PACKAGES='not json' \
node scripts/notify-slack-release.mjs
```

Expected stderr: `PUBLISHED_PACKAGES is not valid JSON: ... ; skipping`. Exit code 0.

And the empty-array path:

```bash
SLACK_WEBHOOK_URL='https://example.invalid' \
PUBLISHED_PACKAGES='[]' \
node scripts/notify-slack-release.mjs
```

Expected stderr: `PUBLISHED_PACKAGES is empty or not an array; skipping`. Exit code 0.

- [ ] **Step 3: Test the fetch-throws path**

Force a DNS failure to exercise the `fetch()` try/catch:

```bash
SLACK_WEBHOOK_URL='https://does-not-resolve.invalid/' \
PUBLISHED_PACKAGES='[{"name":"@goldenhippo/hippo-shop-sdk","version":"3.0.0"}]' \
GITHUB_REPOSITORY='GoldenHippoMedia/hippo-shop' \
node scripts/notify-slack-release.mjs
```

Expected stderr starts with `Slack POST threw:` followed by a Node DNS-error message. Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/notify-slack-release.mjs
git commit -m "feat(ci): wire up main orchestrator and HTTP POST

main() reads env (SLACK_WEBHOOK_URL, PUBLISHED_PACKAGES, GITHUB_REPOSITORY),
short-circuits on missing secret / invalid JSON / empty array, calls
buildPayload with a readChangelogExcerpt closure over the filesystem,
and POSTs to Slack. --dry-run prints the JSON payload instead. fetch()
errors and non-2xx responses are logged to \$GITHUB_STEP_SUMMARY and
exit 0.

Verified locally via --dry-run against packages/sdk/CHANGELOG.md and
against invalid-JSON / unmapped-package / fetch-throws fixtures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add the `Notify Slack` step to `release.yml`

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Append the new step**

The current last step of the `release` job is `Deploy SDK to Cloudflare Pages` (lines 53–64). Append this immediately after it, with one blank line above for readability. After the change, the bottom of the file should look like:

```yaml
      - name: Deploy SDK to Cloudflare Pages
        if: steps.changesets.outputs.published == 'true'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        # `pages deploy` in non-interactive mode (CI) does NOT auto-create
        # the project if it doesn't exist — it errors with "Project not
        # found" instead. We always run `project create` first; it errors
        # with exit 1 if the project exists, which we swallow with `|| true`.
        run: |
          npx --yes wrangler@4 pages project create gh-hippo-shop-sdk-v3 --production-branch=main || true
          npx --yes wrangler@4 pages deploy packages/sdk/dist --project-name=gh-hippo-shop-sdk-v3 --branch=main

      - name: Notify Slack
        if: steps.changesets.outputs.published == 'true'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          PUBLISHED_PACKAGES: ${{ steps.changesets.outputs.publishedPackages }}
        run: node scripts/notify-slack-release.mjs
```

Verify there is exactly one trailing newline at end-of-file.

- [ ] **Step 2: Validate the YAML parses**

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { parse } from 'node:path';
// Cheap structural sanity check — no yaml lib in repo, so just confirm the
// new step strings appear and the file ends cleanly.
const txt = readFileSync('.github/workflows/release.yml', 'utf8');
const checks = [
  /- name: Notify Slack/,
  /SLACK_WEBHOOK_URL: \\\${{ secrets\\.SLACK_WEBHOOK_URL }}/,
  /PUBLISHED_PACKAGES: \\\${{ steps\\.changesets\\.outputs\\.publishedPackages }}/,
  /run: node scripts\\/notify-slack-release\\.mjs/,
];
for (const re of checks) {
  if (!re.test(txt)) { console.error('MISSING:', re); process.exit(1); }
}
if (!txt.endsWith('\n')) { console.error('Missing trailing newline'); process.exit(1); }
console.log('release.yml structural checks passed');
"
```

Expected stdout: `release.yml structural checks passed`. Exit code 0.

If you have `yamllint` or another YAML linter installed locally, also run it:

```bash
command -v yamllint >/dev/null 2>&1 && yamllint .github/workflows/release.yml || echo 'yamllint not installed; skipping'
```

(Optional. The structural check above is sufficient.)

- [ ] **Step 3: Confirm the script is reachable from the workflow's `cwd`**

GitHub Actions runs `run:` steps with the repo root as `cwd`. Verify by running the same command the workflow will run, in the same env shape:

```bash
PUBLISHED_PACKAGES='[]' SLACK_WEBHOOK_URL='' node scripts/notify-slack-release.mjs
```

Expected stderr: `Slack webhook not configured; skipping`. Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): notify Slack after publish + Pages deploy

Adds a final 'Notify Slack' step gated on
steps.changesets.outputs.published == 'true'. Runs
scripts/notify-slack-release.mjs, passing the webhook URL and the
JSON list of published packages via env. The script handles all
failure modes non-fatally so a Slack outage cannot fail a successful
release.

Requires the SLACK_WEBHOOK_URL repo secret to be set; if unset, the
step runs but the script logs 'webhook not configured; skipping' and
exits 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ROADMAP — move Cluster C to Done

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Move the entry**

In `ROADMAP.md`, find this entry under "Open items":

```markdown
### Cluster C — Slack release webhook in CI
Status: idea
Added: 2026-05-17

Have the release workflow post a webhook-based Slack message whenever a package version is published. Small, independent change to `.github/workflows/release.yml`.
```

Remove it from "Open items", and add a new entry at the **top** of the "Done" section (so newest-done sits highest, matching the order Cluster E v1 → Cluster B → Cluster A established):

```markdown
### Cluster C — Slack release webhook in CI
Status: done
Added: 2026-05-17
Shipped: 2026-05-18 (PR #__)

Adds a `Notify Slack` step at the end of `.github/workflows/release.yml`, gated on `steps.changesets.outputs.published == 'true'`, that runs `scripts/notify-slack-release.mjs`. The script reads the published-packages JSON, slices each package's `## <version>` block out of its `CHANGELOG.md`, builds a Slack mrkdwn payload with per-package GitHub Release links, and POSTs to the `SLACK_WEBHOOK_URL` repo secret. Every failure path exits 0 so a Slack outage cannot paint a successful release red; if the secret is unset, the script logs and skips.

Related: `docs/superpowers/specs/2026-05-18-cluster-c-slack-release-webhook-design.md`, `docs/superpowers/plans/2026-05-18-cluster-c-slack-release-webhook.md`, PR #__
```

Leave `PR #__` as a literal placeholder for now — the actual PR number gets filled in just before opening the PR (or in a follow-up commit if PR creation reveals the number after the commit lands).

- [ ] **Step 2: Spot-check the file**

```bash
grep -n "Cluster C" ROADMAP.md
```

Expected: exactly two matches — one under "## Done" with `Status: done`, none under "## Open items". (The `## Done` heading itself does not match `Cluster C`.)

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "chore: ROADMAP — Cluster C done

Move the Slack release webhook entry from 'Open items' to 'Done',
referencing the spec, plan, and (to-be-filled) PR number.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Run the full repo verification suite

**Files:** None (verification only).

- [ ] **Step 1: Run lint + typecheck + test + build across all Nx projects**

This mirrors what CI runs on PR and ensures the new script doesn't break anything (it shouldn't — it's outside the Nx graph — but the verification is cheap and catches accidental dependency drift).

```bash
pnpm nx run-many -t lint typecheck test build
```

Expected: all targets green. Last line of output should be `NX   Successfully ran targets lint, typecheck, test, build for 5 projects` (or similar — count may vary if projects change).

- [ ] **Step 2: Final dry-run smoke**

```bash
PUBLISHED_PACKAGES='[{"name":"@goldenhippo/hippo-shop-sdk","version":"3.0.0"}]' \
GITHUB_REPOSITORY='GoldenHippoMedia/hippo-shop' \
node scripts/notify-slack-release.mjs --dry-run
```

Expected: JSON payload prints to stdout, no warnings on stderr. Eyeball the `text` field once more.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/cluster-c-slack-release-webhook
```

Then open the PR. Use this body template (fill in the actual PR number into the ROADMAP commit afterwards by amending `chore: ROADMAP — Cluster C done` with `git commit --amend --no-edit` after the URL is known, OR open the PR first then push an updated ROADMAP commit — pick whichever the implementer prefers; both are fine and the spec doesn't mandate one):

```
gh pr create --title "feat(ci): Cluster C — Slack release webhook" --body "$(cat <<'EOF'
## Summary

Adds a final \`Notify Slack\` step to \`.github/workflows/release.yml\` that posts one aggregated Slack message after \`changesets/action\` publishes and the Cloudflare Pages deploy succeeds. The message lists every published package with its version, a quoted excerpt of its \`CHANGELOG.md\` entry, and a direct link to the per-package GitHub Release.

### What changes

- **\`scripts/notify-slack-release.mjs\`** (new) — ~120 LOC ESM, zero deps. Two pure helpers (\`extractChangelogSection\`, \`buildPayload\`) and a \`main()\` that reads env, walks \`PUBLISHED_PACKAGES\`, slices each \`CHANGELOG.md\`, and POSTs. Every failure path exits 0. \`--dry-run\` prints the JSON payload instead.
- **\`.github/workflows/release.yml\`** — one new step at the end of the \`release\` job, gated on \`steps.changesets.outputs.published == 'true'\`.
- **\`ROADMAP.md\`** — Cluster C moves to Done.

### Operational follow-ups

- Create a Slack incoming webhook, pick the channel, copy the URL.
- Add \`SLACK_WEBHOOK_URL\` to repo secrets (Settings → Secrets and variables → Actions).
- After the first real release post-merge, eyeball the Slack message and confirm each per-package release link resolves.

Until the secret is configured, the new step runs and skips silently (\`webhook not configured; skipping\`) — merging is safe regardless.

### Out of scope (deferred, not rejected)

Retry with backoff, per-package channel routing, failure (red CI) notifications, and automated unit tests for the script — all documented as deferrals in the spec.

### Spec and plan

- Spec: [\`docs/superpowers/specs/2026-05-18-cluster-c-slack-release-webhook-design.md\`](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/docs/superpowers/specs/2026-05-18-cluster-c-slack-release-webhook-design.md)
- Plan: [\`docs/superpowers/plans/2026-05-18-cluster-c-slack-release-webhook.md\`](https://github.com/GoldenHippoMedia/hippo-shop/blob/main/docs/superpowers/plans/2026-05-18-cluster-c-slack-release-webhook.md)

## Test Plan

- [x] \`pnpm nx run-many -t lint typecheck test build\` — all targets green
- [x] \`node scripts/notify-slack-release.mjs --dry-run\` with synthetic PUBLISHED_PACKAGES — JSON payload prints, links and \`%40\`/\`%2F\` encodings are correct
- [x] Missing-secret path: script logs \`webhook not configured; skipping\` and exits 0
- [x] Invalid-JSON path: script logs and exits 0
- [x] Unmapped-package path: bullet renders as \`> _(see CHANGELOG)_\`
- [x] \`fetch()\` failure path: script logs and exits 0
- [ ] **Post-merge:** add \`SLACK_WEBHOOK_URL\` to repo secrets; cut the next release (e.g. v3.0.1 from PR #13); confirm the Slack message renders correctly and every release link resolves

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (already performed)

**Spec coverage:**

- ✅ "Once per release, aggregated" — Task 5 step gated on `published == 'true'`; Task 4 loops once over `publishedPackages`.
- ✅ Message shape (list + changelog excerpt + per-package release link) — Task 3.
- ✅ `--dry-run` flag — Task 1.
- ✅ `SLACK_WEBHOOK_URL`, skip if unset — Task 1 (short-circuit) and Task 4 (verification under both paths).
- ✅ Node script under `scripts/`, no deps — Task 1 creates the file with only `node:fs`/`node:path` imports.
- ✅ Per-package GitHub Release URL via `encodeURIComponent(tag)` — Task 3.
- ✅ Hard-coded `PACKAGE_DIRS` map; unmapped package logs warning + `(see CHANGELOG)` fallback — Task 4 `readChangelogExcerpt` + Task 3 `buildPayload` fallback path.
- ✅ Error handling matrix (all eight rows) — Tasks 1, 4 cover them; each is explicitly smoke-tested in Task 4 step 2/3.
- ✅ Workflow step gated on `published == 'true'`, placed last, no `continue-on-error` — Task 5.
- ✅ ROADMAP entry moves to Done — Task 6.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task body. The only `__` is in the ROADMAP entry's `PR #__`, which is explicitly called out as a manual fill-in.

**Type consistency:** `extractChangelogSection(markdown, version)`, `buildPayload(publishedPackages, getChangelog, repoFullName)`, `readChangelogExcerpt(name, version)` — names match across Tasks 2, 3, 4. The `getChangelog` callback shape `{excerpt, mapped}` is consistent between its definition (Task 3) and its caller (Task 4).
