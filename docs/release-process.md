# Release process

How releases work in this monorepo, how to ship one, and what to do if something goes wrong.

## TL;DR

```bash
pnpm changeset                # describe what changed
git add .changeset && git commit && git push
# review and merge the "chore: release" PR that GitHub Actions opens
# packages publish automatically with provenance
```

No npm tokens are involved. Publishing uses **npm Trusted Publishers** over GitHub Actions OIDC; trust is granted per-package on npmjs.com.

---

## How it works

```
┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
│ 1. you commit a         │    │ 2. CI opens a           │    │ 3. CI publishes to npm  │
│    changeset describing │───▶│    "chore: release" PR  │───▶│    via OIDC trusted     │
│    the user-visible     │    │    bumping versions     │    │    publisher; provenance│
│    change               │    │    and CHANGELOGs       │    │    attestation attached │
└─────────────────────────┘    └─────────────────────────┘    └─────────────────────────┘
        you                       you review, merge              automatic on merge
```

The mechanics:

- **[changesets](https://github.com/changesets/changesets)** owns versioning and changelogs. Each user-visible change is described in a small markdown file in `.changeset/` and gets consumed at release time.
- **[`changesets/action`](https://github.com/changesets/action)** runs on every push to `main`. It either:
  - **Opens/updates a "chore: release" PR** if there are pending changesets, or
  - **Publishes** any packages whose `package.json` versions aren't yet on npm.
- **GitHub Actions OIDC** authenticates to npm. The release workflow has `id-token: write` permission, npm validates the resulting OIDC token against each package's Trusted Publisher config, and accepts the publish.
- **Provenance** is attached via Sigstore. Public packages built from public GitHub repos with a declared `repository` field get a "Built and signed on GitHub Actions" badge on npmjs.com.

## Shipping a release

### 1. Add a changeset

```bash
pnpm changeset
```

Pick the affected packages, the bump type, and write a short summary. The summary lands in the CHANGELOG — write it for a future reader trying to understand "what changed in this release?"

Example, for a bugfix in the SDK:

```
---
'@goldenhippo/hippo-shop-sdk': patch
---

Fix `data-each` template expansion crashing when the bound path resolves
to `null` instead of an empty array.
```

Bump type:
- `patch` — bug fixes, internal changes, anything users can safely consume without reading the changelog.
- `minor` — new features, additive contract changes.
- `major` — breaking changes. Coordinate carefully.

Commit the generated file:

```bash
git add .changeset/
git commit -m "feat(sdk): add data-each null tolerance"
git push
```

### 2. Review and merge the release PR

Within a minute of your push to `main`, GitHub Actions will open (or update) a PR titled **"chore: release"**. It contains:

- `package.json` version bumps for affected packages
- Generated `CHANGELOG.md` entries
- The consumed changeset files removed

**Review the bumps and changelog text before merging.** Especially for a major bump — confirm the changelog clearly describes the breaking change.

### 3. Merge → publish

On merge, the release workflow runs once more and publishes any version that isn't on npm. Watch the run; it takes ~1 minute.

Verify:

```bash
npm view @goldenhippo/hippo-shop-sdk versions dist-tags
```

Then check the package page on npmjs.com — provenance badge should be visible.

---

## One-time setup for a new package

Adding a new package under `@goldenhippo/*` to this monorepo? Trusted Publishers are configured **per package on npmjs.com**, so the first publish needs a bootstrap step.

1. **Create the package** in `packages/<name>/` with a proper `package.json`:
   ```json
   {
     "name": "@goldenhippo/<name>",
     "version": "0.0.0",
     "license": "MIT",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/GoldenHippoMedia/hippo-shop.git",
       "directory": "packages/<name>"
     },
     "publishConfig": {
       "access": "public"
     }
   }
   ```
   The `repository.url` field is required for provenance to validate.

2. **Bootstrap publish a stub** to claim the package name on npm — Trusted Publishers can only be configured on packages that already exist. Generate a 1-day granular npm token scoped to `@goldenhippo`, then locally:
   ```bash
   ( cd packages/<name> && \
     pnpm build && \
     NODE_AUTH_TOKEN=<token> \
     NPM_CONFIG_USERCONFIG=<(printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n') \
     npm publish --access public --tag bootstrap )
   ```
   `--tag bootstrap` keeps the stub off `latest` until the real release.

3. **Configure the Trusted Publisher** on the new package's npmjs.com settings page (Settings tab → Trusted Publisher → Add):
   - Publisher: GitHub Actions
   - Organization: `GoldenHippoMedia`
   - Repository: `hippo-shop`
   - Workflow filename: `release.yml`
   - Environment: *(leave blank)*

4. **Revoke the bootstrap token.**

5. **Bump the version to `1.0.0`** (or wherever you want the first real release), push, and let CI publish. The bootstrap stub stays on npm tagged `bootstrap` (harmless) or can be unpublished within 72 hours.

---

## Gotchas

These all bit us during initial setup. Don't lose them.

### Provenance requires a public GitHub repo

npm publish will fail with `422 Unprocessable Entity — Unsupported GitHub Actions source repository visibility: "private"` if the repo is private and `NPM_CONFIG_PROVENANCE=true` is set. Either make the repo public or strip provenance from the workflow.

### Provenance requires `repository.url` in package.json

If `package.json` is missing a `repository.url` matching the GitHub repo URL, npm rejects the publish with `422 — "repository.url" is "", expected to match …`. Always include the `repository` field on publishable packages (see template above).

### Trusted Publishers are per-package, not per-org

There is no org-wide Trusted Publisher config on npm (unlike PyPI). Each new package needs its own config on its own settings page after first publish.

### Trusted Publishers cannot be configured before the package exists

Hence the bootstrap dance. There's no "claim a name" flow on npm.

### Trusted publishing needs npm ≥ 11.5.1

Which means Node ≥ 24 in CI. Don't try `npm install -g npm@latest` mid-workflow — it self-corrupts with a `MODULE_NOT_FOUND` error. Just use Node 24.

### Do not set `publishConfig.provenance: true` in package.json

It will break local `npm publish` invocations (no OIDC provider available locally → `Automatic provenance generation not supported for provider: null`). Provenance is enabled in CI via the `NPM_CONFIG_PROVENANCE: true` env var on the changesets step in `.github/workflows/release.yml`. That's the only place it's needed.

### Don't set `registry-url:` in `actions/setup-node` for OIDC

It writes an `.npmrc` with a hardcoded `${NODE_AUTH_TOKEN}` placeholder and sets `NODE_AUTH_TOKEN` to a dummy value, which makes npm try token auth instead of falling through to OIDC. With trusted publishing, omit `registry-url:` entirely.

### First-publish `dist-tags` quirk

When you publish the bootstrap stub, npm always also tags it as `latest` because there's no other version. This auto-resolves the moment the real `1.0.0` publishes (npm moves `latest` to `1.0.0`). The window is minutes — nobody's installing a brand-new package during that gap in practice.

---

## File reference

| File | Purpose |
|------|---------|
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Release pipeline |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PR / push checks (no publishing) |
| [`.changeset/config.json`](../.changeset/config.json) | changesets configuration |
| [`packages/*/package.json`](../packages) | Per-package publish config |

## Manual rescue scenarios

### "I need to publish from my machine, just this once"

You shouldn't, but if Trusted Publisher is broken and a release must ship:

1. Generate a granular npm token (1-hour expiry, write scope to `@goldenhippo`).
2. `cd` to the package, `pnpm build`, `npm publish --access public` with `NODE_AUTH_TOKEN` set.
3. Revoke the token immediately.

The published version won't have provenance, but it'll be installable. Open an issue describing why CI couldn't do it.

### "I shipped a bad version and want to take it back"

Within 72 hours: `npm unpublish @goldenhippo/<name>@<version>`.

After 72 hours: `npm deprecate @goldenhippo/<name>@<version> "Reason"`. You can't un-publish, but installs will warn and consumers can pin away.

For a critical security issue past the unpublish window, contact npm support.
