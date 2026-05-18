# Cloudflare Pages deploy

How the SDK bundle gets to the public URL, what Kong should point at, and how to roll back.

## What it does

The release workflow uploads `packages/sdk/dist/` to a Cloudflare Pages project named **`gh-hippo-shop-sdk-v3`** (the active project for the current SDK major) after every successful npm publish. The contents:

| File | Purpose |
|------|---------|
| `gh.js` | IIFE bundle — what `<script>` tags load |
| `gh.mjs` / `gh.cjs` | ESM / CJS dual build for bundler users |
| `gh.d.ts` / `gh.d.cts` | TypeScript declarations |
| `index.html` | Generated landing page served at the project root |

The deploy step runs only when `changesets/action` reports it published — no publish, no deploy.

## URL model — three layers

Cloudflare Pages assigns every successful deployment three URL forms.

| Layer | Example | Lifetime | Use for |
|-------|---------|----------|---------|
| **Per-deploy hash** | `https://<hash>.gh-hippo-shop-sdk-v3.pages.dev` | Immutable, retained forever | Audit, rollback targets, pinned consumers |
| **Branch alias** | `https://<branch>.gh-hippo-shop-sdk-v3.pages.dev` | Latest deploy on a non-production branch | Staging / PR previews |
| **Production canonical** | `https://gh-hippo-shop-sdk-v3.pages.dev` | Auto-tracks latest `--branch=main` deploy | **Kong's stable upstream for `/sdk/v3/*`** |

There is no `main.<project>.pages.dev` alias — `--branch=main` is production, served at the bare canonical URL.

## Kong wiring (operational model)

Each npm major has its own Pages project and Kong route. The SDK URL path tracks the SDK's major version 1:1.

```
Public         Kong                                Cloudflare Pages
─────────────  ──────────────────────────────────  ─────────────────────────────────
api-prod.      ─►  forwards /sdk/v3/gh.js to       ─►  gh-hippo-shop-sdk-v3.pages.dev/gh.js
goldenhippo.io                                          (canonical — auto-tracks latest)

               ─►  forwards /sdk/v1/gh.js to       ─►  gh-hippo-shop-sdk.pages.dev/gh.js
                                                        (frozen at last v2.1.1 build)
```

Per release on the active major:

1. CI uploads new assets to the active Pages project → new immutable hash URL is created.
2. Cloudflare flips the canonical alias to the new hash (automatic, sub-second).
3. Kong's upstream URL is unchanged but now serves new bytes.
4. Older hash URLs remain live indefinitely as rollback targets.

Kong configuration changes are **not** required on a release cadence within a single major. They are required once per new major — to add a new `/sdk/vN/*` route.

### Frozen URL lines

When a major is cut, the prior major's Pages project stops receiving deploys. Its canonical URL freezes at the last build that landed there — Cloudflare keeps serving that hash forever via the project's canonical alias.

The frozen URL is **unsupported but functional**: anyone still pointing at it gets the old SDK code. Whether the page renders correctly depends on whether the backend still emits the wire shape that SDK version expected. After a backend wire-format change, frozen-URL pages may render gracefully-degraded content (e.g., empty product variants). The freeze is honest about the state: the URL works, the code is what it was, the data may or may not be.

To retire a frozen URL entirely, remove its Kong route (it'll then 404 from `api-prod`). The Pages project itself can be left alone — its `*.pages.dev` URLs keep working but won't be reachable through the public host.

### Per-major project-naming convention

The Pages project name encodes the SDK's major version: `gh-hippo-shop-sdk-vN`. The release workflow's `--project-name` argument is hardcoded to the currently-active project; bumping to a new major requires updating that argument in `.github/workflows/release.yml`. (We considered deriving the name from `package.json` at workflow time but kept it hardcoded for clarity — `grep --project-name release.yml` immediately tells you which major is live.)

## Rollback

Re-activating an earlier deploy is faster than republishing to npm — the asset already exists at its hash URL; you just repoint the canonical.

```bash
# List recent deploys (newest first) for the active major
npx wrangler@4 pages deployment list --project-name=gh-hippo-shop-sdk-v3

# Roll back via the Cloudflare dashboard:
#   Workers & Pages → gh-hippo-shop-sdk-v3 → Deployments
#   → ⋯ on the desired older deploy → "Rollback to this deployment"
```

Canonical repoints in seconds. Kong upstream doesn't change. npm package is unaffected — bad version stays on npm but consumers loading via `<script>` get the rolled-back bundle.

For the npm side, see "I shipped a bad version" in [`release-process.md`](./release-process.md).

## One-time setup

### Cloudflare side

1. **API token** — create at https://dash.cloudflare.com/profile/api-tokens → **Custom token**:
   - Permissions: **Account → Cloudflare Pages → Edit**
   - Account Resources: specific Cloudflare account (not "All accounts")
   - Save the token — it's shown once.

2. **Account ID** — visible in the right sidebar of any Cloudflare dashboard page.

3. **Pages project** — the release workflow runs `wrangler pages project create gh-hippo-shop-sdk-vN --production-branch=main || true` immediately before `wrangler pages deploy`, so the project is auto-created on the first major-bump deploy. The `|| true` makes the step idempotent (wrangler exits 1 if the project already exists, which is fine). By convention the project for SDK major version N is named `gh-hippo-shop-sdk-vN`. Bumping to a new major requires updating the project name in `.github/workflows/release.yml`; the first release-workflow run after that creates the new project.

   **Why we run create explicitly:** `wrangler@4 pages deploy` does NOT auto-create the project in non-interactive (CI) mode — it errors with `Project not found` (code 8000007). The first v3.0.0 release deploy hit exactly this; the workflow now creates first, deploys second.

### GitHub side

Add two repo secrets at `https://github.com/GoldenHippoMedia/hippo-shop/settings/secrets/actions`:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

That's it. The release workflow already references both.

## Local / emergency deploy

If CI is broken and a deploy must ship, or to validate Cloudflare credentials manually:

```bash
cd ~/Code/hippo-shop
pnpm install --frozen-lockfile
pnpm build  # builds types and sdk in dep order

read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=<account-id>

# Idempotent: succeeds on first run, exits 1 (swallowed) if project exists.
npx --yes wrangler@4 pages project create gh-hippo-shop-sdk-v3 \
  --production-branch=main || true

npx --yes wrangler@4 pages deploy packages/sdk/dist \
  --project-name=gh-hippo-shop-sdk-v3 \
  --branch=main

unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
```

Pass `--branch=main` to mark the deploy as production (so canonical updates). Drop the flag if you want a preview deploy that won't touch production canonical.

## Gotchas

### Don't use `cloudflare/wrangler-action@v3` in this monorepo

The action auto-detects pnpm from the lockfile and runs `pnpm add wrangler@...` to install the CLI, which fails with `ERR_PNPM_ADDING_TO_ROOT` because pnpm refuses workspace-root deps without `--workspace-root`. The workaround is `npx --yes wrangler@<major>` directly, which the release workflow already uses.

### `cloudflare/pages-action@v1` is deprecated

Anything still pointing at `pages-action@v1` should migrate. The replacement is `wrangler-action@v3` (which has the pnpm issue above) or `npx wrangler` directly.

### Per-deploy hash URLs never expire

This is a feature, not a leak. They make rollback trivial and let you audit "what exactly was at that hash on Tuesday." Don't try to clean them up.

### Pages project name is in the workflow

The workflow hardcodes `--project-name=gh-hippo-shop-sdk-v3` (matches the current SDK major). On a future major bump, update `.github/workflows/release.yml` to the new project name before merging the major-bump PR.
