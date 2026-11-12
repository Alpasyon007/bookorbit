# Fork Maintenance Workflow

This fork tracks upstream (`bookorbit/bookorbit`) stable releases and carries a small set of custom patches on top. Upstream cuts every release from `main` with semantic-release and has no maintenance branches, so the patch line is maintained here.

## Branch model

| Branch             | Purpose                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `main`             | Reserved for an upstream mirror. Fast-forward only; never add custom commits.                                                         |
| `codex/custom-3.8` | Current patch queue: `v3.8.0` plus fork maintenance changes.                                                                          |
| `custom/3.6`       | Previous patch queue, preserved for reference.                                                                                        |
| feature branch     | One patch, based on the current patch queue. Use `BO-<issue>-<description>` when linked to an issue, otherwise `codex/<description>`. |

The current stable base is `v3.8.0` (`450c18e2`), published on 11 November 2026. The previous fork changes were replayed with `cherry-pick -x`; application code and upstream migration history match the tag. See [PATCH_PLAN.md](PATCH_PLAN.md) for the proposed sidebar, provider, and series-request work.

`upstream/main` can contain unreleased changes. Updating its mirror must not change the base of the patch queue. This checkout's `main` and `origin/main` still point at the previous `99aa7dce` snapshot; advancing them is separate from updating the stable patch branch.

One-time setup:

```bash
git remote add upstream https://github.com/bookorbit/bookorbit.git
git config rerere.enabled true
```

## Patch rules

- Prefer new files over edits to upstream files. Keep edits to upstream files minimal.
- Do not reformat, rename or move upstream code.
- Add translation strings to `client/src/locales/en.json` only. Crowdin owns the other locales.
- Prefer existing settings and supported provider APIs before changing core code.
- Avoid schema changes where practical. Generate required changes with `pnpm --dir server db:generate <name>`. Never hand-write migration SQL or rewrite an already-applied migration.
- One concern per commit, so a patch can be dropped or redone on its own.
- If `pnpm-lock.yaml` conflicts, start from the upstream lockfile, reapply intentional dependency changes, regenerate with the pinned pnpm version, and review the result. Do not discard patch dependencies silently.

## Versioning

Custom builds use a four-part version: `v3.8.0.N`, where `N` counts builds of our patch set on that exact upstream base. Never move a published tag. No custom release tag is created just by updating the source branch.

Do not use suffixes such as `v3.8.0-custom.1` with the current parsers. The update check and the What's New filter require numeric parts; a suffix causes comparisons to fail. With `v3.8.0.N`, only the first three parts are compared, so the update check still reports a newer upstream stable release. This four-part scheme is for fork image tags, not npm package versions.

## Building an image

Pushing a tag matching `v*.*.*.*` runs `.github/workflows/custom-image.yml`. It validates four numeric components, builds the `Dockerfile` with `APP_VERSION` set to the tag, and publishes `ghcr.io/alpasyon007/bookorbit:<version>` with fork source and commit labels. Branch pushes do not publish an image.

The inherited workflow builds the app for **linux/amd64 only**. It does not yet run lint, type checks, or tests. Complete the validation below before tagging; the first planned infrastructure patch adds an automated gate. Add arm64 only if the deployment host needs it. The read-aloud worker is a separate image: while unmodified, pin `READ_ALOUD_WORKER_IMAGE=ghcr.io/bookorbit/bookorbit-read-aloud-worker:3.8.0` when using that optional service.

Use Node >=24 and the pinned `pnpm@11.28.9`; upstream CI and Docker use Node 26. Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run build:client
pnpm run build:server
```

Also run the E2E suites relevant to the patch, selected from `scripts/e2e/suite-registry.mjs`. Use a dedicated test database, never the real library database. Some suites reset their database. Preview and smoke-test the built image before using it with real data.

After verification, an example first release is:

```bash
git switch codex/custom-3.8
git tag -a v3.8.0.1 -m "custom build 3.8.0.1"
git push origin codex/custom-3.8 v3.8.0.1
```

Deploy with `APP_IMAGE=ghcr.io/alpasyon007/bookorbit:3.8.0.1` in the deployment environment, or pin the tested image digest. Do not use upstream image names for fork builds.

Production Compose uses PostgreSQL 18 with pgvector. The app entrypoint applies database migrations before startup; there is no separate migration job. Before upgrading a running instance, back up the database and app data and test the upgrade on a restored copy. The v3.6.0 to v3.8.0 upgrade includes migrations 0132 through 0142; **0132 removes podcast tables and data**. Record the previous image digest and database backup together, because image rollback alone does not reverse migrations. Updating this repository does not deploy it or migrate an existing database.

## Syncing with upstream

```bash
git fetch upstream --tags
git switch main
git merge --ff-only upstream/main
git push origin main
```

Only push the mirror after checking the fork's workflow state below. Do not deploy `main`.

### Picking up a fix before the next stable release

```bash
git switch codex/custom-3.8
git cherry-pick -x <sha-from-upstream-main>
```

`-x` records the upstream commit in the message. If the fix needs a migration that is not in the base, do not cherry-pick it. Wait for the next stable release.

### Moving to a new stable release

```bash
git fetch upstream --tags
git switch -c codex/custom-3.9 v3.9.0
git cherry-pick -x <retained-patch-commit-1> <retained-patch-commit-2>
pnpm install --frozen-lockfile
pnpm verify
```

The commands illustrate a future v3.9.0 upgrade, not a release already available. First fetch and verify the latest published stable release. Review the patch ledger, drop changes already upstream, and replay the remaining commits in order. Use a new branch so the old release stays reproducible. A newer patch release such as v3.8.1 also needs an explicit new base and corresponding image version.

Only unpublished, unapplied custom migrations may be regenerated. For a migration already deployed, retain its history, reconcile upstream schema/journal conflicts, and design a forward upgrade path. Test both a clean database and a restored database containing the previous custom release before deployment.

## Upstream workflows

The upstream workflows are left untouched to reduce upgrade conflicts. On 12 November 2026, the fork's Actions API reported Actions enabled but **zero registered workflows**. That does not prove individual upstream workflows are disabled, and hosted custom builds have not been exercised.

Before enabling hosted builds or pushing the `main` mirror, inspect `gh workflow list --all --repo Alpasyon007/bookorbit`. Keep upstream publishing, release, translation, chart, and issue-maintenance workflows disabled on the fork. Enable `Custom Image` and the planned fork checks explicitly. Keep quality checks available; do not disable all CI without a replacement. Upstream `CI` targets `main`, so it currently provides no automatic checks for the custom branch. Do not push all upstream tags just to publish a patch release.

## Licence obligations

The AGPL additional terms in `ADDITIONAL_TERMS.md` apply to this fork:

- Keep the "Powered by BookOrbit" notice in the About / Legal Notices screen.
- A modified version must state that it is a modified version and not an official release, with a modification date.
- Do not use the BookOrbit name or logo as primary branding.
- Offer users the Corresponding Source of the exact version being served.

## Update checks and release notes

The in-app update check and release notes read from `bookorbit/bookorbit` on GitHub (`server/src/modules/app-info/app-info.constants.ts` and `GITHUB_RELEASES_REPO`). That is intentional here: the instance reports when a new upstream stable release exists, and What's New shows upstream release notes up to the running base version.
