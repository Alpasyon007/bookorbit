# Personal fork patch plan

Baseline: upstream `v3.8.0` (`450c18e2`), published 11 November 2026. Working branch: `codex/custom-3.8`. Reviewed 12 November 2026.

The source upgrade preserves the previous fork documentation and image workflow. Product patches are proposed here, not implemented. The requested areas are sidebar UI, additional metadata/cover sources, and richer requests such as requesting a book series. Exact layouts and source providers remain choices for the first implementation task.

## Recommended order

| Stage | Deliverable                                                       | Likely core impact                             | Completion check                                                   |
| ----- | ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| 0     | Reliable fork checks and a tested custom image                    | Fork-only workflows                            | Checks gate publishing; image boots with a test database           |
| 1     | One specific sidebar improvement                                  | Small Vue component/composable patch           | Desktop, mobile, keyboard, permissions and saved settings work     |
| 2     | One additional metadata/cover source                              | Prefer an external HTTP service; no core patch | Search, lookup and cover candidates work through existing settings |
| 3     | Extra sources in the dedicated cover drawer, if needed            | Focused cover integration patch                | API, DTO, preferences and UI agree on available providers          |
| 4     | Preview a series and request selected missing books               | Requests UI and bounded server orchestration   | Real catalogue entries, dedupe, limits and partial retries work    |
| 5     | Persistent series tracking or future-volume monitoring, if wanted | Separate schema and worker patch               | Restart recovery, idempotency and scoped progress are verified     |

Keep one concern per commit and one feature per branch. Do not mix sidebar changes, provider integration and request orchestration in the same patch. Record each retained patch's purpose, tests and migration impact in the ledger below. Follow [FORK_WORKFLOW.md](FORK_WORKFLOW.md) for upgrades and image versions.

## 0. Build and verification foundation

The inherited Custom Image workflow publishes an amd64 app image on four-part tags such as `v3.8.0.1`. It now rejects malformed tags and labels images with the fork source and commit. No image has been published by this update.

Before the first product release:

1. Add fork-only checks for pushes to the maintained patch branch and PRs targeting it. Use a reusable workflow so the tag publishing job checks the exact tagged commit with the same commands.
2. Install using the repository's pinned pnpm version and `--frozen-lockfile`. Run `pnpm run verify`, client/server builds, and relevant E2E suites. Keep package publishing permissions out of the verification job.
3. Make the image build depend on successful checks. Keep publishing restricted to explicit four-part tags in this fork; keep upstream release and scheduled maintenance automation disabled.
4. Confirm host architecture before selecting amd64 or a native amd64/arm64 build matrix. Build the optional read-aloud worker separately only when changing it; otherwise pin its upstream release image.
5. Test startup, migration, login, library search and the changed features against disposable data. Test upgrading a restored copy of the previous database before deploying.

Current package pin is `pnpm@11.28.9`, minimum Node is 24, and upstream CI/Docker use Node 26. The repository instructions contain some older tooling descriptions; use the checked-in manifests for installation. E2E commands and supported suites live in `scripts/e2e/suite-registry.mjs`.

## 1. Sidebar UI

First try existing customization: hide/show entries and groups, reorder groups and rows within a group, collapse sections, and change list caps. Preferences already persist per user. Search/Dashboard and the primary group have deliberate restrictions; pending-work badges can reveal hidden Requests/Book Dock entries.

For a visual change, start with the smallest component in `client/src/components/sidebar/`, such as `SidebarNavItem.vue`, `SidebarEntitySection.vue`, `SidebarSectionHeader.vue` or `SidebarFooterBar.vue`. Keep `AppSidebar.vue` focused on orchestration.

For navigation changes, use `client/src/composables/useSidebarNav.ts`, `useSidebarLayout.ts` and `useSidebarPrefs.ts`. Preserve entry IDs, permission filtering and stale preference handling. Only expand `packages/types/src/sidebar.ts` if existing layout options cannot express the requirement, for example custom labels or user-created groups.

Existing persistence is `PATCH /api/v1/users/me/settings` with `{ settings: { sidebarConfig, sidebarLayout } }`, validated by `server/src/modules/user/dto/update-me-settings.dto.ts`. Extending the existing JSON settings should usually avoid a database migration; still validate every new field at the API boundary.

Acceptance: a saved layout survives reload and an upstream upgrade, another user retains their own layout, restricted routes stay hidden, and desktop rail/mobile sheet/keyboard navigation/reset all work. Target the existing sidebar composable and component tests. This is a good first product patch once the desired layout is specified.

## 2. Metadata and cover sources

Use the existing external HTTP provider support before adding source-specific code to BookOrbit. Providers can run as separately versioned services and register through Settings. This avoids replaying their implementation at every upstream upgrade.

The implemented contract is in `packages/types/src/metadata-http-provider.ts` and `server/src/modules/metadata-http-provider/`:

- `GET /provider/info` advertises a stable key, media types, fields, lookup support and rate limits.
- `GET /search?query=...&author=...&mediaType=...` returns `{ matches: [...] }`.
- Optional `GET /book/{id}` returns a full candidate.
- Candidates require a stable provider ID and title. Cover candidates can include image dimensions; a cover-focused service can advertise `supportedFields: ["cover"]`.

Register through `POST /api/v1/metadata-http-providers` with `{ baseUrl, authorization?, allowPrivateAddress?, timeoutMs? }`. The existing UI and `ManageMetadataConfig` permission cover registration, testing and updates. Local Compose services need the existing explicit private-address setting. Keep credentials in provider configuration rather than source control.

For each desired source: check the built-in providers and directory, choose the supported API, implement bounded queries with caching/timeouts/rate limits, test representative mapping fixtures, register it, then verify interactive metadata and cover candidates. Enable automatic field rules deliberately after previewing results. Source selection is still open; no new provider account or service has been configured.

Relevant wiring: `server/src/modules/metadata-fetch/providers/http/http-metadata-provider.ts`, `provider-registry.ts`, and `client/src/features/settings/metadata-preferences/`. Validate with provider unit tests and the `metadata-http-providers` E2E suite; add `metadata-cache` or `metadata-lock` checks if those behaviours change.

### Dedicated cover search needs separate integration

`CoverSearchDrawer.vue` uses `GET /api/v1/books/cover/search` and a separate provider registry. An external metadata provider does not automatically become a source in that drawer.

If that is the desired experience, make a small additional patch in `server/src/modules/cover/`, its `providers/cover-provider.ts`, registry/module, `dto/search-covers-query.dto.ts`, and the drawer at `client/src/features/book/components/detail/tabs/CoverSearchDrawer.vue`. Include `packages/types/src/cover-search-preferences.ts` and server preference validation if persisting a new default.

Prefer an adapter using exported metadata services so source clients are not duplicated. Preserve the shared response contract, proxy/download protections, metadata-edit permission, source deduplication and ebook/audiobook filtering. Test the cover controller/service/DTO and drawer together.

`packages/plugin-api/` is a different extension point: disk-loaded acquisition indexers for finding downloadable releases. It is not the metadata/cover provider API.

## 3. Requesting a series

Reuse the existing per-book request lifecycle. It already handles duplicates, subscriptions, approval, destinations, ebook/audiobook pairs, retries and progress. Build series selection/orchestration around it rather than creating a second download pipeline.

### A. Discover and preview the catalogue

The current Series API lists accessible library books and inferred gap positions. It does not supply the titles of missing external books. Its list summaries are deliberately capped. The metadata provider interface currently searches/looks up individual books rather than enumerating a whole series.

Add a paginated series search/member capability for one chosen source first. Return stable source series/work IDs, title/author, the original series position, release status and pagination/completeness information. Do not turn gap numbers into invented book requests. A partial catalogue must be labelled as partial.

Implement behind the owning metadata feature's exported service/interface, then expose a validated, permission-checked preview route and shared response types. Cache responses and bound provider concurrency. Novel/novella ordering needs care: existing request `seriesIndex` is integer-only and submission currently truncates fractional positions. Preserve `1.5` in catalogue display/identity; initially omit the legacy numeric field for noninteger values, or make a separate tested schema change.

### B. Select and submit an initial batch

Add a picker in `client/src/features/book-requests/` and optionally a Requests action on a series page. Show owned books, existing requests, main volumes and optional novellas. Let the user choose media, language, destination and the exact books to request.

Reuse existing availability checks, capped at 50 items per call. Default to missing books and keep large lists paginated or virtualized. Respect the current limit of 10 live self-serve requests and report capacity before submission; server enforcement remains authoritative.

Add bounded orchestration around `server/src/modules/book-request/book-request.service.ts`, with validated DTOs and shared types in `packages/types/`. Call the existing creation/dedupe services for each selected work. Return per-item `created`, `joined`, `skipped` or `failed` outcomes, with useful reasons. Retry failed items only. Preserve the existing cross-user active-request deduplication/subscription model while checking each caller's permissions and visibility.

An initial capped selection can avoid schema changes: submitted books appear as ordinary requests and existing automation handles fulfillment. This version does not promise durable series-level grouping or automatic future-volume tracking. Do not start an unbounded indexer search for every catalogue entry.

### C. Add persistent tracking only when needed

For restartable large submissions, an aggregate series progress page or future releases, introduce user-owned series-request/job and item records in a separate patch. Generate migrations with Drizzle. Use a caller-scoped idempotency key, stable work/media identity, indexed pending-state queries and bounded workers. Resume unfinished items and route progress only to the owner or authorized managers. Reuse existing per-book request IDs and retry/backoff machinery.

Acceptance tests must cover duplicate clicks/concurrent submissions, two users requesting the same book, already-owned media, existing subscriptions, missing/fractional volumes, incomplete catalogues, permissions, request limits, partial failures and retries. Use existing request service/dedupe/gateway tests, frontend submission tests, and `book-requests` plus `authorization-matrix` E2E suites. If a durable worker is added, include restart recovery and a large synthetic catalogue.

## Patch ledger

| Patch                                | Status                                                      | Migration           | Verification                                                                 |
| ------------------------------------ | ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Fork workflow documentation          | Carried from `c837937b`; updated for v3.8.0                 | None                | Documentation and Git ancestry                                               |
| Custom Image workflow                | Carried from `ca689ba6`; numeric tags and fork labels added | None                | Formatting, workflow parsing and tag-validation checks; hosted build pending |
| Fork checks and publish gate         | Planned, before first product release                       | None                | Successful checks on the exact tagged commit                                 |
| Sidebar improvement                  | Planned; exact UI change to choose                          | Probably none       | Sidebar component/composable tests and responsive review                     |
| Additional metadata provider         | Planned; source to choose                                   | None in BookOrbit   | Provider contract fixtures and integration tests                             |
| Cover drawer provider integration    | Optional follow-up                                          | Probably none       | Cover API/DTO/preferences/UI tests                                           |
| Series preview and selected requests | Planned; catalogue source to choose                         | None for capped MVP | Request and authorization tests                                              |
| Durable series tracking              | Optional later feature                                      | Yes                 | Migration/restore/restart tests                                              |

For each implemented product patch, record its commit, acceptance example, exact test command and upstream status. At every release upgrade, keep, replace or retire each patch explicitly. Never regenerate a custom migration that has already run against a real database.
