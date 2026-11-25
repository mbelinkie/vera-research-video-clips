# M5-19 — Cleanup recovery and abandoned source-scratch sweeper

- Status: completed 2026-08-20
- Task/thread: M5-19 only
- Dependency: completed M5-01 through M5-18 export lifecycle

## User-visible outcome

A local operator can run one explicit, bounded maintenance action that safely
recovers source-scratch cleanup. It retries a durable `cleanup_failed` record
or removes an expired abandoned attempt-private scratch directory, records
verified deletion, and makes the associated local job actionable without
reacquiring or rerendering media. It never deletes an output package, an
unknown path, or an active/nonexpired attempt.

## Smallest end-to-end proof

Create local source-scratch lifecycle rows under a temporary configured data
root. A one-shot maintenance boundary claims a bounded number of eligible rows
and derives each directory only as
`${dataRoot}/jobs/export-source-scratch/<job UUID>/<positive attempt>`. It
deletes only that exact validated child directory. Missing children become
durably `deleted`; successful deletion makes an abandoned processing job
`needs_user_action` with a stable sanitized abandonment code; cleanup errors
remain `cleanup_failed` with sanitized evidence. Replays and concurrent
sweepers are harmless, and an M5-18 failure projection is eligible only after
the cleanup record is durably `deleted`.

## Affected boundaries

- Local SQLite `source_scratch_assets` repository transitions and bounded
  claim/recovery state.
- A narrow local maintenance service, with one explicit loopback or CLI entry
  point selected after inspecting existing local runtime conventions.
- Existing M5-18 local failure-projection eligibility; no cloud mutation.
- Local DB, maintenance boundary, processor, and migration tests using temporary
  filesystem roots.

## Decisions and invariants to preserve

1. The durable source-scratch record remains the authority for lifecycle;
   filesystem names are derived from validated `job_id` and positive `attempt`,
   never from a stored path, source URL, provider output, glob, or caller value.
2. The only deletion target is the exact expected `<job UUID>/<positive
attempt>` child beneath the configured `jobs/export-source-scratch` root,
   after containment validation. The data root itself, the scratch root,
   sibling attempts/jobs, final export packages, and unknown paths are never
   deletion candidates.
3. A missing expected exact directory is already-absent cleanup success. A
   regular file, symlink, malformed ID/attempt, malformed root, or target that
   escapes the expected root fails closed and is not recursively removed.
4. Sweep eligibility is bounded per invocation. It includes all
   `cleanup_failed` rows and only expired `acquiring`, `ready`, or `deleting`
   rows that are not part of a currently valid active local attempt; current
   expiry/lifecycle behavior must be inspected before finalizing the precise
   SQL predicate.
5. SQLite claims and lifecycle updates prevent two maintenance invocations from
   deleting/reclassifying the same row concurrently. Crash/restart windows must
   converge safely; no continuous polling or scheduler is added.
6. After verified deletion, an abandoned nonterminal processing job without a
   valid complete package moves only to `needs_user_action` with a stable,
   sanitized abandonment code. The sweeper never marks a job failed or sends a
   cloud result; its sole completion transition is the narrowly verified,
   same-attempt package-recovery case below. A successfully promoted package
   and its immutable provenance are preserved.
7. Failed deletion stores only a stable error code and bounded sanitized message
   (no local paths, URLs, credentials, raw errors, or provider data) and leaves
   the row locally actionable as `cleanup_failed`.
8. Migration `0021` distinguishes new deterministic scratch-layout rows from
   all pre-M5-19 rows. Earlier attempts used an unpersisted `mkdtemp` suffix, so
   a recovery action cannot infer their real directory safely. Legacy nondeleted
   rows become/remain actionable `cleanup_failed` with a stable unsupported
   layout code and are never claimed as an absent deterministic directory or
   marked `deleted` automatically.
9. If deletion recovers a cleanup failure for the exact attempt and existing
   complete final-artifact provenance for that same attempt is already present,
   restore only the established local `complete` state and preserve every
   artifact/provenance row. A later M5-17 reconciliation can then report that
   package without rerendering. Without a complete package, cleanup recovery
   leaves/moves the job to `needs_user_action` with stable sanitized recovery or
   abandonment evidence so M5-18 may project a failure.

## Explicit non-goals

- Continuous polling/scheduling; user-facing retry, progress, cancellation, or
  control UI; execution retry/rerender; acquisition; source reuse/grouping;
  batch handling; 30-second fixture/live-source gates.
- Any cloud API/catalog mutation, export-only synchronization, artifact
  locators, M6 Clip Library/authoring handoff, or M7 work.
- Deleting final packages, artifact roots, output directories, data roots, or
  any stored/caller-provided filesystem path.

## Failure states

- Invalid configured root, malformed job/attempt, symlink/non-directory target,
  containment failure, and deletion error leave bytes untouched and persist a
  sanitized `cleanup_failed` record when a claimed row exists.
- Active/nonexpired attempts and complete-package jobs are excluded from
  abandonment recovery.
- A crash after a row claim but before filesystem removal remains retriable after
  the bounded claim expires/recovery state is released; a crash after removal
  converges to durable `deleted` on replay because an absent target is success.
- A cleanup failure must not satisfy M5-18's terminal failure projection.
- A pre-0021 legacy scratch row is never inferred to be absent from the new
  deterministic layout and remains manual/actionable rather than falsely
  deleted.

## Acceptance criteria

1. Temporary-directory tests prove exact-child deletion and that unrelated
   siblings, export packages, and roots survive.
2. Missing exact child is durable deletion success; malformed/escaping/symlink
   targets are rejected without recursive removal.
3. Cleanup failures are sanitized, durable, independently retryable, and do not
   rerender or reacquire media.
4. Expired abandoned lifecycle recovery moves eligible nonterminal local work to
   `needs_user_action`; active/nonexpired work and preserved packages are not
   altered.
5. Concurrent/repeated invocations and restart windows are idempotent.
6. M5-18 local failure projection rejects pre-cleanup state and accepts only
   after verified deletion, without cloud mutation from this slice.
7. Cleanup recovery restores an already complete verified package for the same
   attempt without media execution; legacy random-layout rows are reported as
   unsupported/actionable and never auto-deleted.

## Verification plan

Run focused local DB and maintenance/processor tests first, including
containment, missing directory, real exact deletion, sibling/package
preservation, sanitized failure, stale lifecycle, active exclusion,
concurrency/idempotence, restart, and M5-18 eligibility. Then run local-agent,
contracts, migration checks, typecheck, full `npm run check`, and
`git diff --check`. No browser test is required unless a browser surface is
introduced. Perform a destructive-action/security/compatibility diff audit
before requesting orchestration review.

## Completion record

- Completed 2026-08-20. The one-shot
  `npm run export:recover-source-scratch -- [--limit <1-25>]` boundary claims a
  bounded deterministic-layout row with a durable SQLite token/lease, derives
  only `${dataRoot}/jobs/export-source-scratch/<job UUID>/<positive attempt>`,
  and deletes only that validated exact child. Missing children settle as
  deleted; roots, parents, symlinks, regular files, malformed values, and
  containment failures fail closed. No path, source identity, URL, secret, or
  claim identifier is emitted by the maintenance result.
- Migration `0021_source_scratch_recovery_claims.sql` establishes deterministic
  layout version 2 for new attempts and durable claim metadata. It deliberately
  leaves pre-0021 random-`mkdtemp` layouts unrecoverable by automation: every
  nondeleted legacy row remains `cleanup_failed` with
  `source_scratch_legacy_layout_unrecoverable`, and a corresponding processing
  job becomes `needs_user_action`. Legacy bytes are not touched or falsely
  marked deleted.
- Verified deletion settles abandoned no-package work to sanitized
  `needs_user_action` evidence so M5-18 failure projection becomes eligible
  only then. A cleanup-failed or post-promotion crash restores `complete` only
  when the exact request owns a complete, same-attempt package with one allowed
  video, required metadata/thumbnail/manifest, permitted sidecars, the exact
  `clip-<requestId>` identity, safe sizes and digests, and valid provenance
  timestamps. It preserves all package/provenance records and does not rerender
  media.
- Verification: focused media/local DB/local-agent tests passed 5 files and 72
  tests. Final `npm run check` passed formatting, typecheck, 25 test files plus
  one declared skip, 229 tests plus one declared skip, the production web
  build, and fresh migration checks (21 local and 15 cloud). `git diff --check`
  and destructive-action/security/compatibility review passed. Playwright was
  not run because no browser/UI surface changed.
- Remaining risk/follow-up: legacy random-layout scratch is manual-only; source
  expiry is the abandonment boundary, so a legitimately long-running attempt
  needs future execution heartbeat/control work; M5-18 still rejects
  multi-attempt failure projection rather than guessing ownership; no scheduler
  was introduced. M5-20 is the bounded durable logged-export operational-control
  slice for safe cancellation and retry ownership/state transition.
- Implementation commit: `9fe69a2d312d2291015cd32f91ccfb8a4e546a35`
  (`feat(export): recover abandoned source scratch safely`).
