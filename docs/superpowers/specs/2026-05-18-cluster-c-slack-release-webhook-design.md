# Cluster C — Slack release webhook in CI

**Status:** Design approved, awaiting implementation plan
**Date:** 2026-05-18
**Cluster:** C (of A–F; see [`/ROADMAP.md`](../../../ROADMAP.md))
**Branch:** `feat/cluster-c-slack-release-webhook` (off `main`)

## Background

`/ROADMAP.md` carries Cluster C as: "Have the release workflow post a webhook-based Slack message whenever a package version is published. Small, independent change to `.github/workflows/release.yml`."

Today, releases run end-to-end through `.github/workflows/release.yml`:

1. `changesets/action@v1` either opens a release PR or, if a release PR was already merged, publishes the queued versions to npm with provenance.
2. If anything was published, the workflow deploys the SDK `dist/` to Cloudflare Pages (`gh-hippo-shop-sdk-v3`).
3. The workflow ends. No notification anywhere.

Right now the only way to know a release shipped is to see the `chore: release` commit on `main` or notice the npm version bump. This cluster closes that gap with a single inline Slack message.

## Goals

1. Post one Slack message per release event, after both npm publish and Cloudflare Pages deploy succeed.
2. Make the message human-readable: package names, versions, a quoted excerpt of each package's changelog entry, and a link per package to the corresponding GitHub Release.
3. Keep the publish path unaffected — Slack failures must never paint a successful release red.
4. Make the secret optional so the notification can be disabled by removing `SLACK_WEBHOOK_URL` from repo secrets without touching workflow YAML.

## Non-goals

- **No multi-channel routing.** v1 fires one webhook URL into one Slack channel. If we later want a "release-failures" channel or per-package routing, add it then.
- **No Slack-app integration.** No OAuth, no `chat.postMessage`, no thread replies. Plain incoming webhook only.
- **No retries.** Single POST; if it fails, the workflow logs and moves on. Retries can be added if real-world signal shows they help.
- **No release-PR or pre-release notifications.** Only the publish event triggers a message. Opening or merging the changesets release PR is silent.
- **No CDN-deploy-only notification.** When `published == 'true'`, the deploy already runs as part of the same job; we don't need a separate "CDN is live" signal.
- **No bundle-size or perf annotations in the message.** Out of scope; the existing `scripts/size-check.mjs` step already fails the build if a budget is busted.
- **No automated tests on the script.** Following the existing `scripts/*.mjs` pattern (`size-check.mjs`, `make-key.mjs`), the script ships with a `--dry-run` flag and a manual smoke test on the first real release. Revisit if the script grows or a third package joins the publish set.

## Decisions

### Trigger: once per release, aggregated across packages

Most releases publish both `@goldenhippo/hippo-shop-sdk` and `@goldenhippo/hippo-shop-types` together. Emitting one message per package would double the Slack noise without adding meaningful information. One message per release event lists every published package + version inline.

The step is gated on `steps.changesets.outputs.published == 'true'` and runs after the Cloudflare Pages deploy. If `published` is false (the workflow only opened or updated a release PR, no publish happened), the step is skipped entirely.

### Message shape: list + changelog excerpt + per-package release link

Slack mrkdwn payload, single `text` field. Concrete shape:

```
:package: *Hippo Shop released*

*<https://github.com/GoldenHippoMedia/hippo-shop/releases/tag/%40goldenhippo%2Fhippo-shop-sdk%403.0.1|@goldenhippo/hippo-shop-sdk@3.0.1>*
> Fix the script-tag fallback selector so it works for every SDK major,
> not just v1. Previously the production-CDN selector hard-coded
> `[src*="/sdk/v1/gh"]`, which became stale after v3 moved to /sdk/v3/gh.js.
> ...

*<https://github.com/GoldenHippoMedia/hippo-shop/releases/tag/%40goldenhippo%2Fhippo-shop-types%403.0.1|@goldenhippo/hippo-shop-types@3.0.1>*
> _(no notable changes)_
```

- Header: `:package: *Hippo Shop released*`.
- One bullet per published package. The package name is the link to the corresponding GitHub Release.
- The bullet body is the package's changelog excerpt for that version, line-prefixed with `> ` to render as a Slack blockquote.
- Truncate any single excerpt to 500 characters with `…` appended. Readers click the release link for full notes.
- Empty or missing excerpt → `> _(no notable changes)_`.
- No footer link — each bullet already links to its own release, so a "release notes" footer would be redundant.

### Placement: final step in `release.yml`, gated on `published == 'true'`

New step added after `Deploy SDK to Cloudflare Pages`. The notification fires only when both publish and deploy have succeeded — making "Slack pinged" mean "npm + CDN are both live."

```yaml
- name: Notify Slack
  if: steps.changesets.outputs.published == 'true'
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    PUBLISHED_PACKAGES: ${{ steps.changesets.outputs.publishedPackages }}
  run: node scripts/notify-slack-release.mjs
```

The step has no `continue-on-error`. The script handles its own errors and exits 0 in all reachable failure modes (see Error handling).

### Secret: `SLACK_WEBHOOK_URL`, skip silently if unset

The webhook URL lives in a GitHub Actions repo secret named `SLACK_WEBHOOK_URL`. The Slack channel is configured on the Slack side when the incoming webhook is created — the workflow has no channel knowledge.

If the secret is not configured (empty env var), the script writes one line to `$GITHUB_STEP_SUMMARY` (`Slack webhook not configured; skipping`) and exits 0. This lets the channel be disabled by deleting the secret, without a workflow-YAML change.

### Implementation surface: small Node script under `scripts/`

A new file at `scripts/notify-slack-release.mjs`, ESM, ~80 LOC. Pure Node 24 built-ins (`node:fs`, `node:path`, global `fetch`). No npm dependencies beyond what `node` ships with.

The script exposes two pure functions for ad-hoc verification (no test runner, but exported for `node -e` use during development):

- `extractChangelogSection(markdown, version)` — slices the `## <version>` heading and content up to the next `## ` heading. Returns the trimmed body string or empty string if not found.
- `buildPayload(publishedPackages, getChangelog, repoFullName)` — pure builder that returns the Slack JSON payload. `getChangelog` is `(packageName, version) => string` so the function is trivially substitutable in dry-run tests.

The main entry point reads env, walks `publishedPackages`, reads each `CHANGELOG.md`, builds the payload, and POSTs.

### Package → directory lookup: hard-coded map in the script

npm package names don't match their directory names in this repo:

- `@goldenhippo/hippo-shop-sdk` lives at `packages/sdk/`
- `@goldenhippo/hippo-shop-types` lives at `packages/types/`

The script carries a literal object:

```js
const PACKAGE_DIRS = {
  '@goldenhippo/hippo-shop-sdk': 'packages/sdk',
  '@goldenhippo/hippo-shop-types': 'packages/types',
};
```

When `publishedPackages` contains a name not in the map, the script renders that package's bullet with `> _(see CHANGELOG)_` and writes a warning to `$GITHUB_STEP_SUMMARY` so the omission is visible. The message still ships. Adding a third published package is a one-line edit to this map.

### GitHub Release URL construction

Changesets-action creates one GitHub Release per published package@version by default, with the tag name `<packageName>@<version>` (literal `@`, slash from the scope). The script builds the URL as:

```js
`https://github.com/${repoFullName}/releases/tag/${encodeURIComponent(`${name}@${version}`)}`
```

`encodeURIComponent` correctly escapes both the leading `@` (`%40`) and the scope slash (`%2F`). GitHub's release-tag URL handler accepts both encoded and raw forms.

### `--dry-run` flag for local development

Invoking the script with `--dry-run` (or `node scripts/notify-slack-release.mjs --dry-run`) prints the constructed JSON payload to stdout and skips the POST. Used by the implementer to validate output shape against a synthetic `PUBLISHED_PACKAGES` value before pushing.

## Error handling

Every condition below ends with `exit 0`. The publish has already succeeded; the workflow stays green.

| Condition | Behavior |
|---|---|
| `published != 'true'` | Step skipped via workflow `if:`; script never runs |
| `SLACK_WEBHOOK_URL` empty | Log `Slack webhook not configured; skipping` to `$GITHUB_STEP_SUMMARY`, exit 0 |
| `PUBLISHED_PACKAGES` empty/invalid JSON | Log warning to step summary, exit 0 |
| Package not in `PACKAGE_DIRS` map | Render bullet as `> _(see CHANGELOG)_`, log warning, continue |
| `CHANGELOG.md` file missing | Same fallback as above, continue |
| `## <version>` section missing in file | Render `> _(no notable changes)_`, continue |
| `fetch()` throws (network error) | Log error message to step summary, exit 0 |
| Slack returns non-2xx | Log status + response body (first 500 chars) to step summary, exit 0 |

All `$GITHUB_STEP_SUMMARY` writes use the markdown block format Actions renders on the run summary page, so warnings are visible without expanding the step log.

## File plan

New:

- `scripts/notify-slack-release.mjs` — the script described above.

Modified:

- `.github/workflows/release.yml` — append the `Notify Slack` step at the end of the `release` job.

No changes to `packages/`, `apps/`, or other workflows. No new npm dependencies.

## Operational follow-ups (not part of this cluster)

These happen outside the PR and don't block merging:

- Create a Slack incoming webhook in the target workspace; pick the channel; copy the URL.
- Set the `SLACK_WEBHOOK_URL` secret in the `GoldenHippoMedia/hippo-shop` repo settings under "Settings → Secrets and variables → Actions."
- After the first real release post-merge, eyeball the message in Slack and confirm the per-package release links resolve.

The script ships with `SLACK_WEBHOOK_URL` un-set initially, so merging this PR is safe even if the secret hasn't been added yet — the step skips silently.

## Out of scope (deferred, not rejected)

- **Retry with backoff** if real-world signal shows the single POST is too brittle.
- **Channel routing per package** if SDK and types ever need different audiences.
- **Failure notifications** (red message when CI fails) — a separate webhook step in the CI workflow, not in `release.yml`.
- **Automated unit tests** for the script's helpers. Add when the script grows past ~100 LOC or a regression actually bites.

## ROADMAP entry mutation

On ship, `/ROADMAP.md`'s "Cluster C — Slack release webhook in CI" entry moves from "Open items" to "Done" with the ship date and PR number, following the pattern set by Cluster A, B, and E v1.
