# PUNCH-004C — Dismissal, dependency-aware cancellation, and activity receipts

- Status: completed 2026-08-24
- Parent entry: `PUNCH-004`
- Priority: P1 high
- Dependencies: completed PUNCH-004A canonical worklist/flags and completed
  PUNCH-004B claims/review policy/priority

## User-visible outcome

An Owner or Administrator can dismiss or restore one or many canonical project
videos without deleting research evidence. Queue, Reviewed, and Dismissed reads
remain bounded and restart-safe. Dismissal cancels queued transcription work or
requests cooperative cancellation of active work only when no active canonical
project-video dependency still needs that job. Flaggers receive one durable
project-activity receipt when another member completes/reopens review or an
Administrator dismisses/restores their video, and can mark those receipts seen.

## Smallest end-to-end proof

Two Researchers flag one canonical video and an Administrator bulk-dismisses it
with a reason. It disappears from Queue/Reviewed, appears under Dismissed with
the actor/time/reason, retains flags/transcript/clips/review/claim/history, and
creates one unread receipt per other active flagger. A shared queued job is
canceled only after its last active project-video dependency is dismissed; an
active job receives a cooperative cancel request that a heartbeat observes.
Restore appends history, returns the row to its review-derived active view,
preserves compatible finalized evidence, and creates one deduplicated receipt.

## Affected authority boundaries and persisted records

- Shared contracts own triage state/history summaries, bounded worklist view,
  bulk optimistic dismiss/restore commands, cancellation outcomes, activity
  receipt pages/cursors, and mark-seen commands.
- Cloud migration 0030 adds current project-video triage state, append-only bulk
  command/triage evidence, transcription-job cancellation intents, safe
  project-video activity events, and per-user receipt state. No local migration
  is required.
- The catalog centralizes Owner/Administrator bulk authority, all-or-nothing
  optimistic replay, dependency checks, worker cancellation observation,
  recipient derivation, bounded reads, and current-membership privacy.
- Strict cloud API routes expose triage, activity receipt, and worker heartbeat
  behavior. Existing worker lease loss/abort and scratch-cleanup boundaries
  remain responsible for cooperative provider termination.
- `BatchWorkspace` provides bounded Queue/Reviewed/Dismissed views, bulk/row
  dismiss/restore controls, dismissal evidence, and a small activity inbox
  without inferring authorization or cancellation safety in React.

## Failure, restart, concurrency, authorization, and migration behavior

- Triage is soft state on the canonical project video. Every transition records
  stable actor/time/reason evidence; restore never erases prior dismissal.
- Exact bulk replay returns its stored response. Divergent idempotency payload,
  stale row version, duplicate video ID, mixed-project ID, concurrent triage,
  or a non-Administrator command fails atomically without a partial transition.
- Dismissal never deletes global video identity, project flags, claims, review
  cycles, transcript versions/pointers, clips, export artifacts, batches/jobs,
  or activity history.
- A queued transcription job is canceled only when every canonical dependency
  linked to that job is dismissed. Active work receives a durable cancellation
  request under the same condition; heartbeat rechecks dependencies before
  terminating the lease/job so a restored/new active dependency prevents stale
  cancellation.
- Receipts contain only safe event type, project/video identity, actor summary,
  and bounded reason metadata already authorized to current project members.
  Actor and recipients are deduplicated; removed members are not returned by
  inbox/worklist reads, while durable audit rows remain intact.
- Mark-seen is per recipient, optimistic/idempotent, survives restart, and
  cannot alter another user's receipt. Receipt creation never changes flags,
  review, processing, priority, transcript, clips, or artifacts.
- Populated migration defaults historical project videos to Active and creates
  no historical dismissal, cancellation, activity, or unread evidence.

## Explicit non-goals

- Hard deletion, automatic dismissal from zero keyword matches, keyword scans,
  invitations, comments/mentions, keyword-decision or general job-event notices,
  email/OS notifications, or a complete multi-user notification matrix.
- Automatic local-processing/resource policy, hosted-provider approval/budget,
  changing immutable batch priority/options, or retranscription orchestration on
  restore beyond preserving/reusing existing compatible evidence.
- Editing/deleting triage/activity history, exclusive claims, Project Settings,
  visible VERA redesign, live providers/media, deployment, production data, or
  PUNCH-009.

## Acceptance criteria

1. Owner/Administrator individual and bounded bulk dismissal/restore is atomic,
   optimistic, exactly replayable, cross-project safe, and denied to Researcher,
   Viewer, removed member, and nonmember.
2. Queue/Reviewed/Dismissed reads are cursor-bounded and derive only from
   independent triage plus review state; processing/priority/flags do not imply
   dismissal or restore.
3. Dismiss/restore preserves every flag, claim/review cycle, active transcript,
   transcript version, clip/artifact, batch/job, and append-only history row.
4. Queued and active transcription cancellation occurs only after the final
   active canonical dependency is dismissed; heartbeat rechecks and honors or
   safely ignores a stale request after restore.
5. Review-complete/reopen and dismiss/restore create one unread receipt for each
   eligible other active flagger/previous reviewer, with exact replay and actor/
   recipient deduplication.
6. Authorized bounded receipt reads and own mark-seen survive reload, expose no
   private content or removed-member current identity, and drive a Workbench
   `New for you`/activity surface.
7. Clean/populated migration, catalog/API replay/concurrency/authorization/
   dependency tests, worker cancellation, focused Chromium, typecheck, builds,
   scoped formatting, and aggregate affected gates pass.

## Narrow tests first

1. Contracts for strict triage/view/activity/cancellation shapes and bounds.
2. Clean/populated migration tests for Active defaults, append-only constraints,
   receipt uniqueness, cancellation intent lifetime, and no fabricated events.
3. Catalog tests for role matrix, atomic bulk replay/conflict, preservation,
   dependency-aware queued/active cancellation, restore race, recipient
   deduplication, bounded inbox, mark-seen, and project isolation.
4. Strict cloud API and worker-heartbeat tests, then focused Workbench Chromium
   coverage for Queue/Reviewed/Dismissed plus activity seen state.
5. Typecheck, cloud migration CLI, affected/aggregate tests, Playwright, builds,
   scoped Prettier, and `git diff --check` before closure.

## Completion record

Completed 2026-08-24.

### Decisions and delivered behavior

- Cloud migration `0030_project_video_triage_activity.sql` adds independent
  current triage state/version/evidence, exact-replay bulk command records,
  append-only triage/activity evidence, durable active-job cancellation
  requests, and per-user unread/seen receipts. Historical rows backfill Active
  with no fabricated events or receipts; no local migration was needed.
- Owner/Administrator dismissal and restore lock all requested rows in sorted
  order, enforce all-or-nothing optimistic versions and current membership,
  return exact stored replay, and preserve flags, claims, review cycles,
  transcripts, clips, artifacts, jobs, and history. Researcher commands are
  denied.
- Queued jobs are canceled only after the final active canonical dependency is
  dismissed. Active jobs receive a durable request; heartbeat rechecks current
  dependencies, either revokes a stale request or durably cancels the job/items
  and releases the lease before the HTTP worker aborts provider work.
- Review complete/reopen and video dismiss/restore create deduplicated safe
  activity events for eligible other active flaggers and the prior reviewer.
  Activity cursors bind project and state filter, mark-seen is own-receipt
  optimistic/idempotent state, and removed recipients or actors disappear from
  current reads while durable audit rows remain. Historical worklist actor
  summaries use a former-member tombstone rather than exposing a removed
  member's current profile.
- The Workbench uses the strict API contracts for Queue, Reviewed, Dismissed,
  and All views; row and selected-row dismissal/restore; dismissal evidence;
  `New for you` counts; a bounded activity inbox; and individual/all-shown
  mark-seen. Payload-derived SHA-256 idempotency keys remain stable and bounded.

### Primary files

- `packages/db-cloud/migrations/0030_project_video_triage_activity.sql`
- `packages/contracts/src/index.ts`
- `packages/catalog/src/index.ts`
- `apps/cloud-api/src/app.ts`
- `apps/worker/src/worker.ts`
- `apps/web/src/batch-workspace.tsx`
- Corresponding contract, migration, catalog, API, worker, and Chromium tests.

### Verification evidence

- `npm run typecheck` — passed.
- Affected Vitest matrix (contracts, cloud migrations, catalog, cloud API,
  worker) — 5 files passed; 143 tests passed; 2 optional PostgreSQL tests
  skipped.
- Focused Chromium Workbench triage/activity flow — 1 passed.
- Aggregate `npm test` — 53 files passed, 1 skipped; 572 tests passed, 4
  skipped.
- Full Playwright gate — 11 passed.
- `npm run build:web` and `npm run build:desktop` — passed. Vite retained its
  existing advisory for a roughly 501 kB minified web chunk.
- Cloud and local disposable migration CLIs — 30 migrations applied and
  validated in each store.
- Scoped Prettier check on supported changed TypeScript/TSX/Markdown files —
  passed. Migration SQL was reviewed manually because Prettier has no SQL
  parser. The known unrelated full-repository Prettier failure in
  `docs/Script-to-Resolve Product Spec.md` was not attributed to this slice.
- `git diff --check` — passed.
- Root review covered current-role authorization, exact/divergent replay,
  all-or-nothing row locks, cancellation/restore races, clean and populated
  migration behavior, receipt deduplication, cursor filter identity, and
  removed-member privacy. No unresolved P0/P1 finding remained. Terra tooling
  was unavailable, so no independent-agent review is claimed.

### Remaining bounded risks and follow-ups

- Restore deliberately does not create a new transcription job after queued
  work was already canceled; compatible finalized evidence is reused and any
  deliberate retranscription remains later orchestration work.
- This slice intentionally covers only review and triage activity. Invitations,
  keyword decisions, comments/mentions, actionable job events, email/OS
  notifications, automatic local resource policy, and paid hosted budget
  policy remain later slices.
- No live provider/media, production data, deployment, commit, push, or external
  service action was used. Commit ID: none (not requested).
