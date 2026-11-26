# M5-21 — Safe cancellation and exact execution ownership

- Status: completed 2026-08-21
- Task/thread: M5-21 only
- Dependency: completed M5-16 through M5-20 logged-export delivery, result,
  cleanup recovery, and immutable retry

## User-visible outcome

A current write-capable project member can cancel one queued, accepted, or
actively executing logged export without corrupting another request or leaving
full-source scratch behind. Accepted work starts only under one durable exact
execution lease owned by its accepted worker/delivery generation/epoch. An
executing worker observes durable cancel intent, cooperatively aborts acquisition,
FFprobe, FFmpeg, subtitle, thumbnail, staging, and promotion work, terminates
active child processes through the existing `AbortSignal` boundary, verifies
source scratch deletion, and reconciles one immutable sanitized canceled result.

Success, failure, and canceled evidence are mutually exclusive. Exact replay
after local/cloud loss is idempotent; divergent replay, stale ownership, changed
worker epoch, and a newer delivery generation conflict without executing or
mutating terminal evidence.

## Smallest end-to-end proof

Create and accept one logged export. Start one cloud-owned execution lease and
persist its exact ID/token/attempt locally before provider work. Run the existing
`LocalExportSourceProcessor` with a cooperative abort controller and bounded
lease heartbeats. Record a project-authorized cancel intent while FFmpeg or an
injected provider is active, observe it through the heartbeat response, abort
the existing processor, verify the exact attempt scratch is deleted, and
reconcile one canceled result that atomically changes only the exact cloud job
and clip to `canceled`.

Also prove cancellation before local execution produces an attempt-zero
`not_started` canceled result, cancellation of never-accepted queued work is an
atomic cloud-only not-started terminal result, and success/cancel races serialize
under the same delivery/request lock so exactly one terminal outcome wins.

## Architectural decisions and invariants

1. There remains one executor: `runLocalExportOnce` and
   `LocalExportSourceProcessor`. Cancellation adds ownership/control around it;
   it does not create a cancellation executor, alternate renderer, or queue.
2. Cloud execution state is distinct from delivery acceptance. One immutable
   execution identity is bound to the accepted delivery ID, generation, worker
   ID, and worker epoch, with one positive attempt, opaque lease token,
   heartbeat, and bounded expiry. An accepted delivery may start at most one
   execution; an expired lease may be resumed only by the same exact pinned
   delivery/worker/epoch in this slice, never by a higher registered epoch.
3. The local queue persists the exact cloud execution identity/token/attempt
   before `beginSourceAcquisition`. Replay must match byte-for-byte. Local source
   attempt equals the cloud execution attempt; a changed token, generation,
   worker, epoch, or attempt cannot enter the processor.
4. Project-authorized cancel intent is immutable in identity and first-writer
   timestamp. Exact replay is a no-op. It is checked during claim, execution
   start, every heartbeat, and every terminal reconciliation.
5. Never-accepted queued work can be canceled atomically without worker or
   scratch evidence. Accepted-but-not-started work records intent and is closed
   by its pinned worker with `attempt = 0` and `sourceCleanup = not_started`.
   Executing work requires the exact durable execution and one matching local
   attempt whose scratch is verified `deleted`.
6. The process boundary runs a bounded heartbeat loop. A cancel response,
   ownership loss, lease expiry, changed delivery/worker epoch, or restart
   mismatch aborts the same controller passed into capability discovery,
   acquisition, FFprobe, FFmpeg, subtitle staging, thumbnail work, and package
   promotion. Existing command runners receive that signal and must terminate
   their child process; real child-process tests prove this boundary.
7. Cancellation is not an ordinary failure. Local canceled evidence has one
   stable sanitized reason and exact attempt/cleanup/execution provenance. It
   never enters M5-18 failure reconciliation and never masquerades as success.
8. Success, failure, and canceled reconciliation acquire the same accepted
   delivery/request lock and check all three immutable result tables before the
   first terminal transition. Database triggers enforce exclusion in every
   insertion direction. Exact replay is idempotent; divergent replay conflicts.
9. If cancellation wins after a package was locally promoted but before cloud
   success commits, the local boundary removes only the deterministic exact
   package owned by that request, clears its local package provenance, verifies
   absence, and then projects cancellation. If success commits first, the later
   cancel command returns the already-terminal outcome and cannot erase it.
10. No shared contract, response, event, stored result, or log exposes lease or
    reservation tokens, worker-owner identity, local paths, source/acquisition
    identity, private URLs, raw command output, secrets, or artifact locators.

## Affected boundaries

- Shared contracts: cancel command/result, execution start/heartbeat, process
  canceled response, and sanitized immutable canceled projection.
- Cloud migration/catalog/API: execution lease, cancel intent, canceled result,
  claim exclusion, exact ownership, authorization, replay, and three-way
  terminal exclusion.
- Local migration/repository: exact execution provenance, cancellation state,
  attempt ownership, canceled-result projection, and safe package discard after
  a lost terminal race.
- Local runtime/API: execution start, bounded heartbeat/abort coordination,
  processor signal propagation, restart recovery, and canceled reconciliation.
- Media boundary: child-process abort behavior and deterministic real process
  termination tests without changing renderer/provider semantics.

## Failure states

- Viewer/nonmember/former member cancel requests are denied. A current writer
  cannot cancel a request from another project.
- Wrong/stale delivery generation, reservation token, execution ID/token,
  worker ID/epoch, or higher current epoch cannot start, heartbeat, execute, or
  reconcile old accepted work.
- Lease expiry or cloud heartbeat loss aborts local work and retains actionable
  evidence; it cannot silently continue FFmpeg or promote a package.
- An abort with incomplete/failed scratch deletion remains local
  `cleanup_failed`/`needs_user_action` and cannot reconcile canceled.
- Existing success/failure/canceled evidence blocks every other outcome. A
  terminal request cannot be canceled again except as exact terminal replay.
- Local/cloud call loss and cloud commit/response loss preserve exact evidence
  for replay without rerendering or another event/version increment.

## Explicit non-goals

- Durable user-facing progress percentages/stages beyond the execution
  heartbeat/control fields needed for cancellation; that is M5-22.
- Batch export, sibling isolation, same-source grouping/reuse, 30-second foreign
  fixture, authorized live YouTube smoke, final M5 release matrix, M6, or M7.
- Worker reassignment of an accepted delivery, automatic execution retry, or
  changing immutable request/settings/preset/subtitle snapshots.
- A polished browser cancellation UI. The authorized API and existing local
  process boundary are the end-to-end gate for this slice.

## Acceptance criteria

1. Cloud and local migrations preserve populated databases and add strict exact
   execution/cancel/result constraints.
2. Only the accepted exact worker/delivery generation/epoch can start one
   execution; restart/exact replay recovers it and stale or higher-epoch work
   cannot execute.
3. Project-authorized cancel works for queued-unaccepted, accepted-not-started,
   and executing requests; already-terminal states are immutable.
4. Cancel/ownership loss aborts every processor boundary through one signal and
   active real child processes terminate.
5. Cancellation reconciles only after attempt-zero no-start proof or exact
   positive-attempt scratch deletion. Cleanup failure remains actionable.
6. Success, failure, and canceled results are mutually exclusive under
   concurrent races and database triggers; exact replay is idempotent and
   divergent replay conflicts.
7. Restart, cloud-call loss, cloud-commit/response loss, lease expiry, lost
   membership, and changed token/generation/epoch tests converge without
   rerender, duplicate terminal records, duplicate events, or leaked secrets.
8. Existing export-only processing, M5-16 delivery, M5-17 success, M5-18
   failure, M5-19 cleanup recovery, and M5-20 retry stay compatible.

## Verification plan

Run focused contracts, fresh/populated cloud/local migration, catalog/API,
local repository/runtime, processor, and media child-process tests first. Cover
pending/accepted/executing/already-terminal cancellation, start/heartbeat replay,
restart, stale lease, changed epoch/token/generation, lost membership, abort
during acquisition/FFprobe/FFmpeg/subtitle/thumbnail/promotion, cleanup failure,
success/failure/cancel races, and local/cloud loss windows. Use a real bounded
child process for termination evidence and repository-owned media fixtures where
FFmpeg behavior matters.

Then run formatting, typecheck, both migration suites, `git diff --check`, the
full `npm run check`, and the security/compatibility/destructive-action audit.
No Playwright run is required unless a browser surface changes. Stop at a
verified no-stage/no-commit checkpoint before completion documentation.

## Completion record

- Completed 2026-08-21. Cloud migration
  `0017_logged_export_safe_cancellation.sql` adds immutable cancel intent, one
  exact execution per accepted delivery/request, bounded lease heartbeat, and
  one canceled-result table. The existing success/failure triggers now include
  canceled evidence in both directions, and all three catalog reconciliations
  lock the same request/delivery state before a first terminal transition.
  Queued cancellation also invalidates any unaccepted reservation.
- Local migration `0022_logged_export_execution_cancellation.sql` persists the
  exact cloud execution ID/token/attempt and monotonic heartbeat before logged
  source acquisition. The existing queue is still the only executor. It records
  canceled evidence only for attempt-zero no-start state or an exact positive
  attempt whose deterministic scratch is verified deleted. Cleanup failure
  remains `needs_user_action` and cannot reach cloud cancellation.
- The local process boundary starts/replays execution, runs a bounded heartbeat
  loop, and passes one controller through capability discovery, acquisition,
  FFprobe, FFmpeg, subtitles, thumbnail work, package staging, and promotion.
  The media runner waits for real child close after abort and escalates an
  ignored `SIGTERM` to `SIGKILL`. A real child-process test and repository-owned
  FFmpeg package test verify termination, scratch deletion, and exact package
  removal when cancellation wins after local promotion.
- Queued-unaccepted, accepted-not-started, executing, expired-lease, stale
  token/epoch, viewer/nonmember, replay/divergence, restart, cloud-call loss,
  cloud commit/response loss, cleanup-failure, and success/failure/cancel race
  paths fail closed or converge without another attempt, duplicate terminal
  row/event, or retained full-source scratch. Persisted lease-loss cancellation
  replays directly without renewing the lost lease.
- Verification: focused contracts, populated/fresh cloud/local migration,
  catalog/API, local repository/runtime, processor, package cleanup, and real
  child-process tests passed 9 files and 143 tests. Final `npm run check` passed
  formatting, typecheck, 25 test files plus one declared skip, 246 tests plus one
  declared skip, the production web build, and fresh migration checks (22 local
  and 17 cloud). `git diff --check` plus the authorization, terminal-race,
  token/path leakage, compatibility, and exact destructive-path audit passed.
  Playwright was not run because no browser surface changed.
- Remaining work: M5-21 intentionally adds only execution ownership and safe
  cancellation. Durable progress, batch/sibling isolation, same-source grouping,
  the 30-second foreign fixture, explicit user-authorized live YouTube smoke,
  and the final Milestone 5 release matrix remain open. M5-18 still rejects
  ambiguous multi-attempt failure projection, and pre-M5-19 random-layout
  scratch remains manual recovery.
- Implementation commit: `4deecdf2bbeccbb033d1db346f5abe22d71e4c16`
  (`feat: add safe logged export cancellation`).
