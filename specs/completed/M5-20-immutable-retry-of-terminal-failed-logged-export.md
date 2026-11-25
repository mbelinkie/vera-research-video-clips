# M5-20 — Immutable retry of one terminal failed logged export

- Status: completed 2026-08-21
- Task/thread: M5-20 only
- Dependency: completed M5-16 through M5-19 logged-export delivery, result,
  and cleanup recovery

## User-visible outcome

An authorized current project collaborator can retry one logged export whose
exact cloud request is durably and immutably failed. Retry creates a new queued
request and job with the original request's exact immutable media, selection,
language, subtitle, preset, and resolved-settings evidence. The failed request,
accepted delivery, immutable failure, and historical event remain unchanged.

Repeating the same retry command after a timeout or lost response returns the
same child request. Concurrent duplicates create only one child. That child
uses the existing M5-16 claim/import/accept path and the existing M5-17/M5-18
success/failure reconciliation paths without another executor.

## Smallest end-to-end proof

Create and immutably reconcile one failed accepted logged export. As a current
write-capable project member, issue one retry command with a bounded idempotency
key. In one cloud transaction, lock the parent request, job, clip, immutable
failure, and accepted delivery; prove the exact terminal failed state; allocate
one monotonically increasing retry ordinal; create new request/job IDs with
byte-equivalent immutable snapshots and explicit parent provenance; move only
the clip from `failed` to `queued`; increment it once; and emit one retry event.

Replay and race the same command and prove one child, version, and event. Claim
the child through M5-16 and prove its delivery envelope carries the unchanged
snapshot and no parent failure/delivery credentials. Prove later result paths
accept the child under their ordinary rules.

## Architectural decisions and invariants

1. Retry is a new immutable export request and new job. It never resets,
   deletes, or mutates the parent request/job, accepted delivery, success or
   failure result, fingerprint, or historical sync event.
2. The catalog stores `retry_of_request_id` and a positive `retry_ordinal` on
   the child. The root/original request has no parent and ordinal zero. A unique
   parent/ordinal constraint and a unique project retry-command identity make
   exact replay and concurrent delivery idempotent.
3. This bounded slice permits at most one direct child per failed parent.
   Retrying the same parent with a different command identity is a branching
   conflict. A later retry must target the newest terminal failed child, which
   produces the next monotonically increasing lineage ordinal. This creates a
   linear chain and avoids ambiguous parallel attempts.
4. The retry command is authorized by current project write permission. It
   does not require or preserve ownership by the worker that produced the
   failure. Subsequent processing ownership is assigned only through the
   ordinary M5-16 worker claim/accept boundary.
5. Eligibility requires the exact parent job and clip to be `failed`, one
   immutable failure row bound to an accepted delivery, no immutable success,
   and internally consistent request/job/project/clip identity. Nonterminal,
   complete/successful, canceled, missing-result, or inconsistent parents fail
   closed.
6. The child's video, selection, source-language classification, subtitle-track
   snapshot, compatibility preset snapshot, authoritative resolved-settings
   snapshot, capability profile, and resolution fingerprint are copied from
   persisted parent columns without accepting caller replacements. Existing
   snapshot schemas revalidate the returned child and M5-16 delivery.
7. The child job payload is rebuilt only from those persisted snapshots plus
   the new request identity and retry provenance. It contains no parent
   reservation token, worker identity/epoch, delivery ID, failure message,
   source path, artifact locator, acquisition URL, or local evidence.
8. The first accepted retry creates the child, changes the clip only from
   `failed` to `queued`, increments the clip version once, and emits one
   sanitized `clip_candidate.export_retried` event containing stable request/
   job lineage IDs and ordinal. Exact replay creates no further mutation.
9. Existing M5-16 claim selection sees the new queued job as ordinary work.
   M5-17/M5-18 reconciliation remains request-scoped, so a child result cannot
   coexist with another result for that child and cannot alter the parent.

## Affected boundaries

- Shared contracts: strict retry command/response and retry provenance on the
  logged `ExportRequest` projection.
- Cloud migration: immutable retry lineage/idempotency columns and constraints
  on logged requests, with populated-schema compatibility.
- Shared catalog/cloud API: project-authorized retry transaction, exact replay,
  branching/concurrency rejection, and one route.
- Existing delivery/reconciliation tests: one child remains consumable without
  local queue, processor, media, or result-rule changes.

## Failure states

- A viewer, nonmember, unregistered actor, or actor lacking current write
  permission cannot retry.
- A queued, processing, needs-action, complete/successful, canceled, or
  failure-result-missing parent is rejected without a child or clip mutation.
- Parent request/job/clip/delivery/failure identity or snapshot inconsistency
  conflicts and preserves all evidence.
- A different retry idempotency key for a parent that already has a child is a
  branching conflict. Exact replay returns the existing byte-equivalent child.
- Concurrent identical commands serialize to one child; concurrent divergent
  commands cannot create siblings.
- A retry child never carries the parent's worker/delivery token, result, local
  path, artifact provenance, or failure text.

## Explicit non-goals

- Safe cancellation. Accepted/executing cancellation requires a separate
  execution-start/heartbeat lease, durable cancel intent, local AbortController
  coordination, verified scratch cleanup, and a third immutable canceled-result
  reconciliation so cancellation cannot race with success/failure.
- Automatic execution retry, retrying local `cleanup_failed`, modifying the
  existing local queue, source acquisition/rendering, progress, polling,
  supervision, or user-interface controls.
- Batch export, sibling isolation, same-source grouping/reuse, 30-second fixture
  or authorized-live gates, artifact upload/locators, M6, or M7.
- Retrying a successful request, replacing an immutable package, or weakening
  M5-17/M5-18 authorization, cleanup, result, or mutual-exclusion rules.

## Acceptance criteria

1. A current write-capable project member can retry exactly one terminal failed
   request; viewers, former members, and invalid parent states fail closed.
2. One transaction locks and verifies the parent request/job/clip/failure and
   accepted delivery before creating a new request/job with a monotonic ordinal.
3. Every immutable export snapshot, including resolved capability and
   fingerprint evidence, is byte-equivalent to the parent and caller input
   cannot replace it.
4. Parent request/job/delivery/failure/event evidence is unchanged. Only the
   exact clip moves `failed` to `queued`, with one version and retry event.
5. Exact replay and concurrent identical delivery return one child. Divergent
   parent branching conflicts; sequential retry targets the newest failed child.
6. The child can be claimed by M5-16 and reconciled by M5-17 or M5-18 without a
   new executor or relaxed rule.
7. Contracts, rows, response, event, and delivery leak no reservation token,
   worker owner/epoch, failure text, local path, source/acquisition identity,
   private URL, raw output, or artifact locator from the parent.

## Verification plan

Run focused contracts, fresh/populated cloud migration, catalog transaction,
cloud API, and existing delivery/result compatibility tests. Cover exact replay,
concurrent replay, divergent branching, sequential ordinal, wrong role/lost
membership, every ineligible parent state, missing/inconsistent immutable
failure/delivery, exact snapshot equality, parent immutability, one clip
version/event, and claim/result compatibility. Then run typecheck, full
`npm run check`, migration checks, and `git diff --check`. No Playwright is
required because this slice adds no browser surface.

Review the complete diff for authorization, retry branching, transaction races,
mutable snapshot reuse, token/failure leakage, parent mutation, duplicate
executors, and compatibility. Do not update `PROJECT_GUIDE.md` or `outline.md`,
move this spec, stage, or commit until orchestration review authorizes completion.

## Completion record

- Completed 2026-08-21. The strict cloud API retry command accepts only a
  bounded idempotency key from a current write-capable project member. One
  catalog transaction locks the project membership and exact parent request,
  job, clip, immutable failure, and accepted delivery; reauthorizes and
  validates persisted evidence; and creates one new queued request/job with new
  IDs, `retry_of_request_id`, and the next positive ordinal. The child snapshots
  are copied in PostgreSQL from the parent rather than reconstructed from caller
  input.
- Cloud migration `0016_logged_export_retry_lineage.sql` adds the retry
  provenance, one-direct-child and project-command uniqueness, a restrictive
  parent foreign key, exact snapshot validation on insertion, and immutable
  request identity/snapshot triggers. The established single PGlite connection
  now serializes catalog transaction boundaries so concurrent commands cannot
  interleave `BEGIN`/`ROLLBACK`; request-insertion conflict rolls back its new
  job instead of returning with an orphan.
- Exact replay is checked before first-time failed/clip eligibility, so replay
  after cloud commit and clip requeue returns the persisted child. Concurrent
  exact commands return one child. Concurrent or later divergent commands
  cannot branch and leave zero orphan jobs. A failed retry child can itself be
  retried to ordinal 2 without changing the established logged-job payload
  shape.
- The child contains the exact immutable video, selection, source-language,
  subtitle, preset, and resolved-settings/capability/fingerprint snapshots. Its
  job payload, delivery, event, and response contain no parent reservation
  token, worker identity/epoch, failure text, source path/identity, raw output,
  private URL, or artifact locator. The parent request/job/delivery/failure and
  historical events remain unchanged. Existing M5-16 claim/accept and M5-18
  failure reconciliation consume the child without a new executor or weakened
  result rules.
- Verification: focused contracts, populated/fresh cloud migration, catalog,
  concurrency, authorization, and cloud API tests passed 4 files and 53 tests.
  Final `npm run check` passed formatting, typecheck, 25 test files plus one
  declared skip, 233 tests plus one declared skip, the production web build,
  and fresh migration checks (21 local and 16 cloud). `git diff --check` and the
  authorization, concurrency, leakage, parent-immutability, migration,
  compatibility, and orphan-job audit passed. Playwright was not run because no
  browser/UI surface changed.
- Remaining risk/follow-up: this slice intentionally adds retry only. Safe
  cancellation still needs durable execution start/lease/heartbeat and cancel
  intent, cooperative `AbortSignal` propagation and child-process termination,
  verified scratch cleanup, and immutable canceled reconciliation mutually
  exclusive with success/failure. Durable progress, batch/sibling isolation,
  same-source grouping, the 30-second foreign fixture, authorized live smoke,
  and final Milestone 5 gate remain open. M5-18 still rejects multi-attempt
  failure projection, and pre-M5-19 random-layout scratch remains manual-only;
  resolve either limitation only if the final gate requires it.
- Implementation commit: `7b38deb0904e7c23bfd681ae4ec17391cd442e18`
  (`feat: retry terminal failed logged exports`).
