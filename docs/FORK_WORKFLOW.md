# Fork Maintenance Workflow

This fork tracks upstream (`bookorbit/bookorbit`) stable releases and carries a small set of custom patches on top. Upstream cuts every release from `main` with semantic-release and has no maintenance branches, so the patch line is maintained here.

## Branch model

| Branch         | Purpose                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `main`         | Mirror of `upstream/main`. Fast-forward only. Never commit here.              |
| `custom/X.Y`   | An upstream stable tag `vX.Y.0` plus our patches. This is what gets deployed. |
| feature branch | Branched from the current `custom/X.Y`, merged back into it.                  |

One-time setup:

```bash
git remote add upstream https://github.com/bookorbit/bookorbit.git
git config rerere.enabled true
```

## Patch rules

- Prefer new files over edits to upstream files. Keep edits to upstream files minimal.
- Do not reformat, rename or move upstream code.
- Add translation strings to `client/src/locales/en.json` only. Crowdin owns the other locales.
- Avoid schema changes. If one is unavoidable, generate it with `pnpm db:generate` and expect to regenerate it on the next base.
- One concern per commit, so a patch can be dropped or redone on its own.
- If `pnpm-lock.yaml` conflicts, take the upstream version and run `pnpm install`.

## Versioning

Custom builds use a four-part version: `v3.6.0.N`, where `N` counts builds of our patch set on that base.

Do not use semver suffixes such as `v3.6.0-custom.1`. The update check and the What's New filter split the version on `.` and require numeric parts, so a suffix silently disables both. With `v3.6.0.N` only the first three parts are compared, so the in-app update check still reports when upstream publishes a newer stable release.

## Building an image

Pushing a tag matching `v*.*.*.*` runs `.github/workflows/custom-image.yml`, which builds the `Dockerfile` with `APP_VERSION` set to the tag and pushes `ghcr.io/<owner>/<repo>:<version>` (lowercased).

```bash
git checkout custom/3.6
git tag v3.6.0.1
git push origin custom/3.6 v3.6.0.1
```

Deploy by setting `APP_IMAGE` in `.env` to that image. Do not push to upstream's image names.

## Syncing with upstream

```bash
git fetch upstream --tags
git checkout main && git merge --ff-only upstream/main && git push origin main
```

### Picking up a fix before the next stable release

```bash
git checkout custom/3.6
git cherry-pick -x <sha-from-upstream-main>
```

`-x` records the upstream commit in the message. If the fix needs a migration that is not in the base, do not cherry-pick it. Wait for the next stable release.

### Moving to a new stable release

```bash
git fetch upstream --tags
git checkout -b custom/3.7 custom/3.6
git rebase --onto v3.7.0 v3.6.0 custom/3.7
pnpm install
pnpm verify
```

If a patch added a migration, regenerate it on top of the new base before applying it to any database you care about, and back up first.

## Upstream workflows

The upstream workflows in `.github/workflows/` are left untouched so they do not conflict on rebase. They are written for the upstream repository and should be disabled on the fork under Settings > Actions, or with `gh workflow disable <name>`: `CI`, `Container Image`, `Release`, `E2E`, `E2E Runner`, `Crowdin *`, `Repo Charts`, `Stale*`, `Labeler`. Keep `Custom Image` enabled.

## Licence obligations

The AGPL additional terms in `ADDITIONAL_TERMS.md` apply to this fork:

- Keep the "Powered by BookOrbit" notice in the About / Legal Notices screen.
- A modified version must state that it is a modified version and not an official release, with a modification date.
- Do not use the BookOrbit name or logo as primary branding.
- Offer users the Corresponding Source of the exact version being served.

## Update checks and release notes

The in-app update check and release notes read from `bookorbit/bookorbit` on GitHub (`server/src/modules/app-info/app-info.constants.ts` and `GITHUB_RELEASES_REPO`). That is intentional here: the instance reports when a new upstream stable release exists, and What's New shows upstream release notes up to the running base version.
