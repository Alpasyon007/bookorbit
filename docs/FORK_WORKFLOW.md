# Fork Maintenance Workflow

This fork tracks upstream (`bookorbit/bookorbit`) stable releases and carries a small set of custom patches on top. Upstream cuts every release from `main` with semantic-release and has no maintenance branches, so the patch line is maintained here.

## Branch model

| Branch             | Purpose                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `main`             | Reserved for an upstream mirror. Fast-forward only; never add custom commits.                                                         |
| `codex/custom-3.8` | Current patch queue: `v3.8.0` plus fork maintenance changes.                                                                          |
| `custom/3.6`       | Previous patch queue, preserved for reference.                                                                                        |
| feature branch     | One patch, based on the current patch queue. Use `BO-<issue>-<description>` when linked to an issue, otherwise `codex/<description>`. |

The current stable base is `v3.8.0` (`450c18e2`), published on 11 November 2026. The previous fork changes were replayed with `cherry-pick -x`; upstream migration history still matches the tag. Runtime changes are limited to the custom-version compatibility patch described below. See [PATCH_PLAN.md](PATCH_PLAN.md) for the proposed sidebar, provider, and series-request work.

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

Custom releases use `v<upstream-version>-custom.<revision>`. The first release is `v3.8.0-custom.1`: upstream base `3.8.0`, custom revision `1`. The image tag omits the leading `v`: `ghcr.io/alpasyon007/bookorbit:3.8.0-custom.1`. The app and image version label retain the full Git tag.

Increment the custom revision for each changed build on the same base: `v3.8.0-custom.2`, then `v3.8.0-custom.3`. Reset it when rebasing, for example `v3.8.1-custom.1`. Revisions start at 1, without leading zeroes. Never move a published Git tag or overwrite an image with different contents; create a new custom revision. Branch pushes alone do not create releases. Numeric four-part tags such as `v3.8.0.1` are retired and cannot trigger the custom publisher.

The hyphenated label is accepted by Docker tags and uses SemVer's suffix syntax. Generic SemVer tools sort such a suffix below the corresponding plain release, so this fork deliberately compares the upstream base for update notifications and What's New. `v3.8.0-custom.1` therefore reports no upstream update for `v3.8.0`, but does report `v3.8.1` or `v3.9.0`. The UI shows the complete custom version. These checks concern upstream releases, not newer custom revisions. See the [SemVer precedence rules](https://semver.org/#spec-item-11).

## Building an image

Pushing a tag matching `v*.*.*-custom.*` runs `.github/workflows/custom-image.yml`. The shared validator in `scripts/fork/release-version.mjs` requires the exact custom format before checks and again before publication. The Dockerfile receives the full tag as `APP_VERSION`; images carry fork source, commit and version labels. Branch pushes do not publish an image.

The workflow builds the app for **linux/amd64 only**. Publishing depends on the reusable fork checks passing for the exact tagged commit. Add arm64 only if the deployment host needs it. The read-aloud worker is a separate image: while unmodified, pin `READ_ALOUD_WORKER_IMAGE=ghcr.io/bookorbit/bookorbit-read-aloud-worker:3.8.0` when using that optional service.

### Automated publishing gate

`.github/workflows/fork-checks.yml` runs for `codex/**`, `custom/**` and `BO-*-*` branch pushes, PRs targeting a patch branch, and manual runs. `custom-image.yml` calls that same workflow when a custom release tag is pushed. A [local reusable workflow reference](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#calling-a-reusable-workflow) uses the caller's commit; every checkout explicitly uses `github.sha`.

The required checks are:

1. Frozen dependency installation using the Node version from `Dockerfile` and pnpm pin from `package.json`.
2. Fork formatting, workflow validation and failure-path tests; application lint, type checks, unit tests, and client/server production builds.
3. `book-api-contract` and `authorization-matrix` E2E suites, each using its own disposable PostgreSQL 18/pgvector service. Empty test selections fail.
4. Build the production image without publishing, then run its real entrypoint against a fresh disposable database. Verify migration/startup, initial setup, login/session, empty library browsing/search, app version, and built client assets.
5. A final gate requires every job to report `success`. Failed, cancelled, skipped or missing checks block publication.

On a release tag, the smoke-tested image is saved as a one-day artifact. Only after the gate passes can the separate publishing job download that run's archive, verify the loaded Docker image ID and revision/version labels, log in to GHCR and push it. It then pulls the published image, verifies the same image ID and records its immutable repository digest in the job summary. There is no second build. Verification jobs have only `contents: read`; only publishing receives `packages: write`. Branch and PR runs cannot publish. No manual publish bypass is provided.

The gate verifies a clean database install, not every previous custom database upgrade. Continue testing restored production backups before deploying schema changes. Add feature-specific E2E suites to the fork matrix when a patch needs them; the baseline matrix does not replace Kobo, metadata or request-specific coverage.

### Portable patch boundaries

| Fork-owned boundary                           | Purpose                                            | Upstream dependency to check on upgrade                   |
| --------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `.github/workflows/fork-checks.yml`           | Check orchestration and image verification         | Package scripts, E2E suite IDs and Dockerfile             |
| `.github/workflows/custom-image.yml`          | Tag-only publication of the tested artifact        | Reusable workflow outputs and Docker image labels         |
| `.github/actions/fork-setup/action.yml`       | Thin toolchain adapter                             | Manifest pin and Docker base declaration                  |
| `scripts/fork/`                               | Gate logic and disposable-container smoke contract | Public authentication, library and app-info API contracts |
| `docs/FORK_WORKFLOW.md`, `docs/PATCH_PLAN.md` | Porting procedure and patch inventory              | Current stable base and retained patch decisions          |

No upstream workflow, package script, Dockerfile or application source file is changed by this foundation. Reapply the fork-owned files together, then run the checks on the new base. A changed toolchain declaration or API contract should fail visibly so the small adapter or smoke contract can be reviewed.

Custom-version compatibility is a separate runtime patch: `server/src/common/utils/upstream-version.utils.ts` owns upstream-base parsing, with narrow hooks in `app-info.service.ts` and `release-notes.service.ts`. The sidebar's `client/src/components/sidebar/versionUi.ts` accepts custom labels for update indicators without linking them to nonexistent upstream releases. The patch preserves the displayed label, supports reading legacy numeric versions, and rejects malformed custom versions. Port these adapters and their regression tests together; revisit the three hooks if upstream changes its update/release-note handling. The general KOReader version parser is unaffected.

The v3.8.0 authorization test inventory omits `POST /admin/download-clients/validate`. A separate compatibility patch adds `server/test/e2e/authorization-matrix/route-inventory/routes-fork.json` and registers it through the inventory manifest. It preserves the existing parity assertion and adds the route to the permission/API-key probes. On each upstream upgrade, check whether upstream now inventories the route; if so, drop the fork chunk and its manifest registration. Do not add it to the uncovered-route baseline or skip the failing test.

For future product patches, keep implementation in a named feature/service/composable and use the owning module's exported interface. Prefer existing HTTP metadata providers or indexer plugins for source integrations. Keep upstream wiring changes small and identifiable; avoid copying whole upstream components or querying another module's database internals. Preserve shared types, ownership/permission checks and stable persisted IDs. Each patch needs its own acceptance tests and a ledger entry describing its injection points. Do not introduce a general plugin framework until an actual feature requires it.

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
git tag -a v3.8.0-custom.1 -m "custom build 3.8.0-custom.1"
git push origin codex/custom-3.8 v3.8.0-custom.1
```

Deploy with `APP_IMAGE=ghcr.io/alpasyon007/bookorbit:3.8.0-custom.1` in the deployment environment, or pin the tested image digest. Do not use upstream image names for fork builds.

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

The upstream workflows are left untouched to reduce upgrade conflicts. Before the foundation rollout on 12 November 2026, the fork's Actions API reported Actions enabled but **zero registered workflows**. That did not prove individual upstream workflows were disabled.

Before enabling hosted builds or pushing the `main` mirror, inspect `gh workflow list --all --repo Alpasyon007/bookorbit`. Keep upstream publishing, release, translation, chart, and issue-maintenance workflows disabled on the fork. Enable `Custom Image` and `Fork Checks` explicitly. Keep quality checks available; do not disable all CI without a replacement. Upstream `CI` targets `main`; `Fork Checks` provides checks for the patch branches. Do not push all upstream tags just to publish a patch release.

## Licence obligations

The AGPL additional terms in `ADDITIONAL_TERMS.md` apply to this fork:

- Keep the "Powered by BookOrbit" notice in the About / Legal Notices screen.
- A modified version must state that it is a modified version and not an official release, with a modification date.
- Do not use the BookOrbit name or logo as primary branding.
- Offer users the Corresponding Source of the exact version being served.

## Update checks and release notes

The in-app update check and release notes read from `bookorbit/bookorbit` on GitHub (`server/src/modules/app-info/app-info.constants.ts` and `GITHUB_RELEASES_REPO`). That is intentional here: the instance reports when a new upstream stable release exists, and What's New shows upstream release notes up to the running base version.
