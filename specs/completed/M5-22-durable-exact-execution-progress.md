# M5-22 — Durable monotonic progress for one exact execution

- Status: completed 2026-08-22
- Task/thread: M5-22 only
- Dependency: completed M5-21 exact execution ownership and safe cancellation

## User-visible outcome

An authorized project member can read bounded durable progress for one logged
export through the existing cloud request boundary. The owning local worker
persists progress against the exact M5-21 execution attempt before reporting it;
heartbeat delivery makes duplicate updates idempotent, rejects older evidence,
and rejects changed execution/delivery/worker credentials. Restart returns the
latest accepted stage without rerendering or inventing completion.

## Smallest end-to-end proof

Start one accepted logged export, persist exact local execution ownership, and
advance the existing processor through a fixed ordered stage vocabulary. Each
local update increments one sequence and never decreases stage rank or bounded
progress. The execution heartbeat sends the latest snapshot to cloud, where one
transaction validates exact lease ownership and advances only newer monotonic
evidence. An authorized project read returns that sanitized snapshot. Exact
replay and stale updates create no extra event or mutation; cancellation and all
three terminal result paths remain authoritative and independent.

## Architectural decisions and invariants

1. M5-21 remains the only execution path. Progress is metadata on its exact
   execution, never another worker, queue, lease, or terminal state.
2. Progress uses one fixed ordered stage enum, a positive local sequence, and
   integer basis points from 0 through 10,000. Sequence, stage rank, and basis
   points move only forward. Duplicate exact snapshots are no-ops; divergent
   reuse of a sequence conflicts.
3. SQLite persists the latest exact snapshot before it can leave the process.
   Heartbeats carry at most that sanitized snapshot and cloud binds it to exact
   execution ID/attempt/lease plus accepted delivery generation/worker epoch.
4. Restart loads the local and cloud latest snapshots. Neither side infers a
   later stage from job state or terminal evidence. Stale delivery, lease,
   generation, token, epoch, or membership cannot read or mutate progress.
5. Progress contains no path, source identity, artifact locator, command output,
   credential, owner identity, URL, transcript text, or failure detail.
6. Progress is not terminal evidence. It cannot mark success, failure, or
   cancellation, cannot block cancellation, and cannot weaken M5-21 cleanup or
   three-way result exclusion.

## Affected boundaries

- Shared contracts: fixed progress stage/snapshot and heartbeat/read response.
- Cloud migration/catalog/API: exact latest-progress persistence, monotonic
  constraints, heartbeat update, and project-authorized request read.
- Local migration/repository/runtime: exact latest snapshot, processor stage
  recording, heartbeat publication, and restart replay.

## Explicit non-goals

- Browser progress UI, ETA, throughput, logs, free-form messages, or per-file
  progress.
- Batch aggregation/sibling isolation, same-source grouping, fixture/live gates,
  M6, or M7.

## Acceptance criteria

1. Fresh and populated cloud/local migrations add strict monotonic state without
   rewriting existing execution or request evidence.
2. Only the exact live execution heartbeat can publish progress; replay is
   idempotent and stale/divergent sequence, stage, basis points, or ownership
   conflicts without mutation.
3. The existing processor records representative acquisition, inspection,
   render, subtitle/thumbnail, packaging, cleanup, and locally complete stages.
4. Restart returns the latest durable snapshot without rerendering, and the next
   valid update continues from it.
5. Current project members can read sanitized progress; nonmembers and former
   members are denied.
6. Cancellation and success/failure/canceled reconciliation remain compatible.

## Verification plan

Run focused contracts, populated/fresh migrations, catalog/API authorization and
monotonicity, local repository restart, processor, heartbeat, and terminal
compatibility tests. Then run formatting, typecheck, both migration CLIs,
`git diff --check`, full `npm run check`, and the security/compatibility audit.
No Playwright run is required because this slice adds no browser surface.
