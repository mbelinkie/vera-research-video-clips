# PUNCH-004A — Canonical worklist flags and unified ingest

- Status: completed 2026-08-24
- Parent entry: `PUNCH-004`
- Priority: P1 high
- Dependencies: completed PUNCH-003A authority foundation, existing M7-04
  transcript supervision, and existing direct/bulk video ingest

## User-visible outcome

Every authorized project exposes one bounded canonical video worklist keyed by
project-video identity rather than transcription batch-item identity. Direct URL
ingest and bulk batch submission both activate one current-user flag on that
same row. Repeating an ingest restores/replays the flag without duplicating the
project video, while another researcher adds an independent flag. Rows show
bounded authorized flagger identity, exact current processing evidence, active
transcript availability, and clip count without replacing jobs, batches, or
immutable transcript authority.

## Smallest end-to-end proof

Two authorized researchers ingest the same YouTube source—one through the
direct resolve route and one through bulk batch creation—and receive one
project-video worklist row with two active flags. Exact replay creates no extra
row or flag. Removing and re-ingesting one user's own flag deactivates then
restores only that flag, leaves the shared project video/transcript/clips
untouched, and remains isolated from another project. The bounded API and
existing Workbench batch surface display the canonical row independently of any
single batch item.

## Affected authority boundaries and persisted records

- Shared contracts own worklist query/page/item, bounded flagger summary,
  processing evidence, and own-flag command/response shapes.
- Cloud migration 0028 adds durable project-video/user flag records and
  representative legacy backfill; `project_videos` remains the canonical row.
- The catalog atomically converges global video, project-video, and current-user
  flag upserts for both direct and batch ingest. It owns bounded authorized
  aggregate reads and own-flag deactivation/restoration.
- The cloud API validates the worklist and own-flag routes. Existing metadata,
  batch/job, language-decision, transcript, and worker adapters remain the
  processing authorities.
- `BatchWorkspace` consumes the new worklist read model but does not issue
  provider calls or infer processing state.

## Failure, restart, concurrency, authorization, and migration behavior

- The `(project_id, video_id)` key remains the one research identity; the flag
  key is `(project_id, video_id, user_id)`. Concurrent direct/bulk or two-user
  ingest converges under database constraints.
- Same-user replay is idempotent. Re-ingest restores an inactive flag and
  advances only durable flag/project-video activity versions; it never creates a
  second video, project video, transcript, or processing job.
- A user may deactivate only their own flag while they retain project write
  access. No ordinary flag command hard-deletes a project video, transcript,
  clip, artifact, batch, job, or another user's flag.
- Worklist reads require current membership and return only bounded member
  identity already authorized inside that project. Nonmembers and cross-project
  IDs fail closed.
- Processing evidence is derived from persisted batch/job state and reported as
  a separate axis. Missing attempts and active transcript reuse remain distinct.
- Populated migration backfills one active creator flag per historical project
  video without changing stable IDs or existing evidence. No local migration is
  required because the cloud catalog remains authoritative for shared flags.

## Explicit non-goals

- Soft claims, review cycles, Administrator-only completion policy, priority,
  triage/dismissal/restore, dependency-aware cancellation, activity receipts,
  notification inbox, keyword scans, or paid-provider budget policy.
- Replacing existing transcription batches/jobs or their pause/resume/retry and
  worker-lease behavior.
- Hard deletion, open-project discovery, invitations, membership changes,
  Project Settings, visible VERA redesign, or PUNCH-005 through PUNCH-010 work.
- Live providers/media, hosted spend, deployment, production data changes, or
  PUNCH-009 work.

## Acceptance criteria

1. Direct and bulk ingest of the same project/video create one project-video row
   and one active flag per ingesting member; another project remains isolated.
2. Same-user replay and concurrent ingest are idempotent; an inactive own flag
   is restored without duplicate jobs or evidence.
3. Own-flag deactivation preserves the project video, every other flag,
   transcripts, clips, jobs, and history; unauthorized/cross-project commands
   fail closed.
4. A cursor-bounded worklist returns stable project-video identity, video
   metadata, active transcript identity, bounded authorized flaggers/current
   user flag state, exact processing evidence, clip count, and durable versions.
5. Direct and batch routes use one catalog convergence helper while existing
   preflight, language gate, job idempotency, and worker authority remain green.
6. The current Workbench displays canonical worklist rows without deriving row
   identity from a selected batch or review-inbox item.
7. Clean/populated migration, contracts, catalog/API concurrency and
   authorization tests, browser coverage, typecheck, builds, scoped formatting,
   and aggregate affected tests pass without a local migration or external call.

## Narrow tests first

1. Contract tests for bounded worklist/query/flag/processing schemas.
2. Clean/populated migration tests for legacy flag backfill, uniqueness,
   deactivation preservation, and referential isolation.
3. Catalog tests for direct/batch convergence, two-user/concurrent replay,
   deactivate/restore, bounded aggregates, and authorization.
4. Cloud API route tests, then focused `BatchWorkspace` browser coverage.
5. Typecheck, cloud migration CLI, affected aggregate suites, full Playwright,
   builds, scoped Prettier, and `git diff --check` before closure.

## Completion record

### Decisions and delivered behavior

- Cloud migration `0028_project_video_flags.sql` adds one durable optimistic
  flag per project/video/user. Historical rows receive one active creator flag;
  removing membership does not cascade away flag evidence.
- Direct `addVideo` and batch creation share one actor-aware convergence helper.
  Its video upsert returns the constraint-winning global ID, so concurrent
  inserts cannot retain a losing UUID. Project-video and flag constraints make
  same-user and two-user ingest safe; inactive flags restore without creating a
  second job or row.
- The authorized cursor read orders by immutable project-video creation time
  plus video ID. It returns active transcript identity, at most 25 current-
  member flagger summaries, current-user optimistic flag state, the latest
  persisted batch-item processing evidence, clip count, and project/video
  versions. Removed-member identity is not disclosed in the bounded flagger
  summary even though its durable flag row is retained.
- Own-flag commands target only the authenticated member, support exact replay,
  reject stale versions, and never delete shared research evidence. Re-ingest
  restores a deactivated flag.
- `BatchWorkspace` loads and clears the canonical read model with the existing
  project/auth request-generation guards. It displays shared rows separately
  from batch details and supports Open video plus own-flag remove/restore.
- The PUNCH-003A dependency audit corrected transcription claiming so persisted
  Owner, Administrator, and Researcher roles can claim work; migrated Editor is
  no longer inferred as a stored authority role.

### Files changed for this slice

- `packages/contracts/src/index.ts` and `index.test.ts`
- `packages/db-cloud/migrations/0028_project_video_flags.sql`
- `packages/db-cloud/src/index.test.ts`
- `packages/catalog/src/index.ts` and `index.test.ts`
- `apps/cloud-api/src/app.ts` and `app.test.ts`
- `apps/web/src/batch-workspace.tsx` and `styles.css`
- `tests/e2e/workspace.spec.ts`
- `PROJECT_GUIDE.md`, `outline.md`, and
  `specs/future/PILOT-punch-list.md`

### Verification evidence

- Focused contracts worklist schemas: 1 passed.
- Focused Administrator transcription claim: 1 passed.
- Focused migration clean/populated worklist coverage: 2 passed.
- Focused catalog canonical worklist coverage: 2 passed; focused convergence
  replay rerun: 1 passed.
- Focused cloud API route coverage: 1 passed.
- Focused Chromium canonical-worklist interaction: 1 passed.
- Affected contracts/auth/cloud migration/catalog/cloud API/worker matrix:
  157 passed, 2 optional PostgreSQL tests skipped after one migration-count
  expectation was corrected and its focused rerun passed.
- Aggregate network-free Vitest: 53 files passed, 1 file skipped; 560 tests
  passed and 4 skipped.
- Full Playwright: 11 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run build:web`: passed (110 modules transformed).
- `npm run build:desktop`: passed, including web plus desktop main/preload,
  local-agent, and transcription-worker bundles.
- Cloud migration CLI: 28 migrations newly applied successfully.
- Local migration CLI: 30 migrations newly applied successfully; no local
  migration was added.
- Scoped Prettier and `git diff --check`: passed.

### Remaining risks and follow-ups

- `CLOUD_DATABASE_TEST_URL` was not configured, so the two optional real
  PostgreSQL migration tests remained skipped. PGlite clean/populated migration
  and concurrency behavior passed; no live database or production data was
  used.
- Terra/multi-agent tooling was unavailable in this task, so no independent
  review is claimed. Root review covered authorization, migration lifetime,
  idempotency/concurrency, cursor isolation, and UI project-state clearing.
- The Workbench intentionally shows only the first bounded 50 rows and reports
  when more exist. The API cursor is complete; richer shelf pagination belongs
  with the later visible PUNCH-006 redesign.
- Soft claims, review cycles/policy, priority, triage/dismissal, dependency-
  aware cancellation, activity receipts/notifications, automatic-processing
  policy, and keyword summaries remain explicit PUNCH-004 follow-up slices.
- No commit was created; this slice remains part of the preserved coherent dirty
  worktree.
