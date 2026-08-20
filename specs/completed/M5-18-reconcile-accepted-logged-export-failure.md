# M5-18 — Reconcile one accepted logged-export failure

- Status: completed 2026-08-20
- Task/thread: M5-18 only
- Dependency: completed M5-16 delivery and M5-17 success reconciliation

## User-visible outcome

One logged export already accepted by a local worker that durably reaches local
`needs_user_action` without a valid complete package can record one sanitized,
immutable failure in the shared catalog. The exact cloud job and clip become
`failed` atomically, and retrying reconciliation after a cloud outage or lost
response returns the same failure without a second row, clip version, or event.

An attempted export is terminally fail-able only after its source scratch is
verified deleted. A `cleanup_failed` attempt remains explicitly actionable in
SQLite and does not tell the shared catalog that source deletion succeeded or
that the ordinary processing failure is terminal.

## Smallest end-to-end proof

Create, claim, import, and accept one logged request through the M5-16 boundary.
Run it through the existing one-shot processor into either a not-started failure
or an attempted failure whose scratch cleanup is durably `deleted`. Project one
strict failure result from SQLite, then reconcile it through the authenticated
cloud boundary. Prove one transaction creates one immutable failure record,
changes only the exact queued job and clip to `failed`, increments the clip once,
and emits one versioned event. Exact replay after both local-failure/cloud-call
loss and cloud-commit/response loss is a no-op; divergent replay conflicts.

## Architectural decisions and invariants

1. Execution continues to use `runLocalExportOnce` and the existing
   `LocalExportSourceProcessor`; this slice adds no executor or queue runner.
2. The local failure projection is built only from persisted SQLite state. It
   requires an accepted logged delivery, job state `needs_user_action`, no
   verified complete package, one bounded sanitized `lastError`, and the durable
   job attempt number.
3. Failure cleanup provenance has exactly two terminal shapes:
   `not_started` for attempt zero with no source-scratch rows, or `deleted` for a
   positive attempt whose exact scratch record is `deleted` with a durable
   deletion timestamp. Provider/source identity, byte/hash, paths, raw process
   output, acquisition URLs, tokens, and scratch IDs are not projected.
4. `cleanup_failed` is deliberately deferred, not reconciled as a cloud terminal
   failure. SQLite remains `needs_user_action` with its cleanup error and the
   cloud request remains queued. Cleanup-only retry/sweeping and any later
   nonterminal cloud needs-action surface are separate slices. This avoids a
   false claim that retained scratch bytes were deleted.
5. The failure command carries the exact request/job/project/clip, stable
   delivery ID, accepted generation, worker ID/epoch, and reservation token for
   authorization. The immutable stored failure and returned/event projection
   omit the reservation token and worker owner identity.
6. An accepted delivery is pinned authorization, not a live scheduling claim.
   Reconciliation therefore requires the authenticated original worker owner,
   current project membership, the existing worker identity, the exact accepted
   delivery worker ID/epoch/generation/token, and immutable request identity.
   It may close after registration expiry, revocation, or a later registered
   epoch; it does not mutate or reassign delivery provenance. Another actor,
   worker, epoch in the command, token/generation, or a former project member is
   rejected. Requiring both account authentication and the opaque accepted
   credential preserves revocation as a scheduling stop while permitting safe
   terminal recovery by the original owner.
7. One cloud failure row is unique per request and accepted delivery. A canonical
   SHA-256 fingerprint makes exact replay idempotent and divergent replay a
   conflict. Failure and success rows are mutually exclusive under both catalog
   transaction locks and database triggers.
8. First failure reconciliation accepts only the exact authoritative queued job
   and queued clip. It inserts the failure, changes job to `failed`, changes clip
   export status to `failed`, increments the clip once, and emits one sanitized
   `clip_candidate.export_failed` event in one transaction.
9. A process command that returns local failure immediately builds and sends the
   persisted projection. Rerunning after local failure skips media because the
   persisted `needs_user_action` failure is reconciled before any processor call.
   A lost cloud response replays the exact immutable failure.

## Affected boundaries

- Shared contracts: strict sanitized failure result, reconciliation command and
  response, plus process response discriminating success from failure.
- Local persistence/repository: durable failure projection and exact cleanup
  proof from existing job/source rows; migration only if an additional durable
  field is proven necessary.
- Cloud persistence/catalog/API: one failure-result migration, mutual-exclusion
  constraints/triggers, pinned-delivery authorization, atomic failure transition,
  idempotency, and one authenticated route.
- Local loopback/cloud adapter: recover a persisted failure before execution,
  reconcile a newly persisted processor failure, and preserve failure evidence
  across restart/cloud loss.
- Focused contract, migration, repository, catalog/API, and loopback tests.

## Failure states

- Missing/invalid accepted local provenance, non-`needs_user_action` state, a
  complete package, missing/partial error evidence, or inconsistent attempts
  fail before a cloud call.
- Any positive attempt without exactly one matching `deleted` scratch lifecycle
  cannot project an ordinary terminal failure.
- `cleanup_failed`, `acquiring`, `ready`, or `deleting` remains local actionable
  work and leaves cloud job/clip unchanged.
- Wrong actor, worker, command epoch, delivery generation/token, request/job/
  project/clip identity, or lost project membership is rejected.
- Expired/revoked registration or a newer registered epoch does not by itself
  block the original owner from closing the exactly pinned accepted delivery.
- A prior immutable success blocks failure; a prior immutable failure blocks
  success. Exact failure replay returns the canonical row; divergent failure
  bytes or provenance conflict without another version/event.
- Cloud transport failure preserves local evidence for restart-safe retry.

## Explicit non-goals

- Cleanup retry, cleanup sweeper/lifecycle backstop, or claiming that
  `cleanup_failed` is terminal.
- Rerendering, automatic retry execution, progress, cancellation, leases,
  continuous polling/supervision, or worker reassignment.
- Batches, sibling isolation, same-source grouping/reuse, the 30-second fixture
  gate, live YouTube smoke, artifact upload/locators, Clip Library, authoring
  handoff, M6/M7, or export-only cloud synchronization.
- Weakening M5-17 success verification, package identity, subtitle, cleanup, or
  authorization rules.

## Acceptance criteria

1. Not-started and attempted-plus-deleted failures project only stable IDs,
   bounded sanitized error code/message, attempt, and safe cleanup lifecycle.
2. `cleanup_failed` and every nondeleted attempt are rejected/deferred without a
   terminal cloud mutation or false scratch-deletion claim.
3. First failure reconciliation atomically creates one immutable record and
   changes only the exact queued job and clip to `failed`, one version/event.
4. Exact replay across local/cloud loss windows is idempotent; divergent replay
   conflicts. Success and failure cannot coexist.
5. Authorization binds the current authenticated original owner and project
   membership to the exact accepted delivery credential. Expiry, revocation,
   and a later registration epoch still permit pinned terminal recovery; wrong
   actor/worker/command epoch/token/generation and membership loss fail closed.
6. No contract, row, response, event, or logged error leaks paths, source IDs,
   acquisition/private URLs, credentials, reservation token, owner identity,
   raw process arguments/output, or artifact locators.
7. Existing M5-16 acceptance, M5-17 success, and local export-only behavior stay
   unchanged.

## Verification plan

Run focused contracts, local DB, cloud migration/catalog, cloud API, local-agent
route, and processor/one-shot tests first. Cover not-started, cleaned attempted,
cleanup-failed deferral, restart persistence, local failure/cloud loss, cloud
commit/response loss, divergent replay, success/failure exclusion, wrong actor/
worker/epoch/token/membership, and expired/revoked/newer-epoch recovery. Then run
typecheck, fresh and populated migration checks, full `npm run check`, and
`git diff --check`. No Playwright run is required unless a browser surface
changes. Review the full diff for authorization, idempotency races, secret/path
leakage, premature cloud terminal state, cleanup-rule weakening, compatibility,
and duplicate executors. Do not update durable guide/outline status, move this
spec, stage, or commit until orchestration review authorizes completion.

## Completion record

- Completed 2026-08-20. The local queue now builds a failure result only from an
  accepted logged request durably in `needs_user_action`, with no final package,
  one bounded persisted error, and the exact job attempt. Attempt zero requires
  zero scratch rows; a positive attempt requires exactly one matching scratch
  row in `deleted` with a durable deletion time. Real one-shot processor tests
  prove both not-started and attempted-plus-deleted projections. A
  `cleanup_failed`, live/incomplete scratch lifecycle, or inconsistent attempt
  remains actionable locally and cannot be reconciled as terminal.
- The local process route first checks for persisted terminal-safe failure, so a
  local-failure/cloud-call or cloud-commit/response-loss retry never reruns the
  processor. A later local identity epoch may report evidence pinned to the
  original worker ID/epoch, but it cannot execute old accepted work. A newly
  returned processor error is never trusted directly; reconciliation rebuilds
  the result from SQLite after the processor returns.
- Cloud migration `0015_logged_export_failure_results.sql` adds one immutable
  failure row unique by request and delivery. Success/failure checks run under
  the same accepted-delivery lock, and database triggers reject insertion in
  either direction. First failure changes only the exact queued job and clip to
  `failed`, increments the clip once, and emits one event; exact replay is a
  no-op and divergent identity/error/cleanup provenance conflicts.
- Failure authorization requires the current authenticated original worker
  owner, current project membership, and exact accepted delivery ID,
  generation, opaque token, worker ID, and pinned epoch. Registration expiry,
  intentional revocation, or a later registered epoch does not strand existing
  terminal evidence; another actor, worker, command epoch, generation/token, or
  former project member is rejected. Delivery provenance is never reassigned.
- Failure error code/message is sanitized idempotently at the shared contract
  and local repository boundaries. Regressions cover HTTP(S), `file://`, Unix,
  Windows drive, and UNC paths; UUIDs/digests; key-value secrets; and bearer
  tokens. Stored rows, sync events, and responses omit the reservation token,
  worker owner, source/acquisition identity, paths/locators, private URLs,
  credentials, and raw tool arguments/output.
- Verification: orchestration-focused contract/database/catalog/API/local
  runtime tests passed 7 files and 81 tests. Final `npm run check` passed
  formatting, typecheck, 217 tests with one declared skip, the production web
  build, and fresh migration checks (20 local and 15 cloud). `git diff --check`
  and the complete security/compatibility audit passed. Playwright was not run
  because this slice changes no browser/UI surface.
- Compatibility: no local migration was required because the existing durable
  job attempt/error and source-scratch lifecycle rows already carry the needed
  restart-safe evidence. The new cloud migration preserves populated delivery,
  worker, and success-result rows.
- Remaining risk/follow-up: `cleanup_failed` is intentionally nonterminal and
  still needs an independent cleanup retry plus abandoned-scratch sweeper. The
  current terminal projection rejects multiple source-attempt rows rather than
  guessing which attempt a future retry owns; the cleanup-recovery slice must
  define that attempt selection explicitly. User-facing retry/progress/cancel,
  batching/grouping, the 30-second foreign fixture gate, the authorized live
  smoke, M6, and M7 remain outside this slice.
- Implementation commit: `c67477c` (`Implement logged export failure reconciliation`).
