# Cloudflare Pages deploy

How the SDK bundle gets to the public URL, what Kong should point at, and how to roll back.

## What it does

The release workflow uploads `packages/sdk/dist/` to a Cloudflare Pages project named **`gh-hippo-shop-sdk`** after every successful npm publish. The contents:

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
| **Per-deploy hash** | `https://<hash>.gh-hippo-shop-sdk.pages.dev` | Immutable, retained forever | Audit, rollback targets, pinned consumers |
| **Branch alias** | `https://<branch>.gh-hippo-shop-sdk.pages.dev` | Latest deploy on a non-production branch | Staging / PR previews |
| **Production canonical** | `https://gh-hippo-shop-sdk.pages.dev` | Auto-tracks latest `--branch=main` deploy | **Kong's stable upstream** |

There is no `main.<project>.pages.dev` alias — `--branch=main` is production, served at the bare canonical URL.

## Kong wiring (operational model)

Point Kong at the **canonical** URL once. It does not change between releases.

```
Public         Kong                                Cloudflare Pages
─────────────  ──────────────────────────────────  ─────────────────────────────────
api-prod.      ─►  forwards /sdk/v1/gh.js to       ─►  gh-hippo-shop-sdk.pages.dev/gh.js
goldenhippo.io                                          (canonical — auto-tracks latest)
```

Per release:

1. CI uploads new assets to Cloudflare → new immutable hash URL is created.
2. Cloudflare flips the canonical alias to the new hash (automatic, sub-second).
3. Kong's upstream URL is unchanged but now serves new bytes.
4. Older hash URLs remain live indefinitely as rollback targets.

Kong configuration changes are **not** required on a release cadence.

## Rollback

Re-activating an earlier deploy is faster than republishing to npm — the asset already exists at its hash URL; you just repoint the canonical.

```bash
# List recent deploys (newest first)
npx wrangler@4 pages deployment list --project-name=gh-hippo-shop-sdk

# Roll back via the Cloudflare dashboard:
#   Workers & Pages → gh-hippo-shop-sdk → Deployments
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

3. **Pages project** — does **not** need to be pre-created. The first `wrangler pages deploy` will create the project automatically if it doesn't exist, using the supplied `--project-name`.

### GitHub side

Add two repo secrets at `https://github.com/GoldenHippoMedia/hippo-shop/settings/secrets/actions`:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

That's it. The release workflow already references both.

## Local / emergency deploy

If CI is broken and a deploy must ship, or to validate Cloudflare credentials manually:

```bash
cd ~/Code/hippo-shop
pnpm --filter @goldenhippo/hippo-shop-sdk build

read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=<account-id>

npx --yes wrangler@4 pages deploy packages/sdk/dist \
  --project-name=gh-hippo-shop-sdk \
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

The workflow hardcodes `--project-name=gh-hippo-shop-sdk`. If the project is renamed in Cloudflare, update `.github/workflows/release.yml` to match.
