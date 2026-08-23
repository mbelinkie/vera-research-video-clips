# M6-07 — Operational handoff and exit gate

- Status: complete
- Task/thread: M6-07 only
- Dependencies: M6-01 through M6-06 are complete

## User-visible outcome

The local agent can enter a bounded drain mode before a desktop supervisor or
updater stops it. Drain blocks new logged-export claims, lets already accepted
or executing work finish safely, and reports `safeToStop` only when no local
operation, media child command, or durable source-scratch lifecycle remains
active. It also returns closed, path-free operation diagnostics suitable for an
M7 supervisor without exposing research content or machine details.

## Smallest end-to-end proof

Start a deferred logged export, begin drain while one media command is active,
and prove a new claim is rejected before any cloud request. Quiescence remains
unsafe through the running operation and source cleanup, then becomes safe when
the operation, child command, and durable scratch/group lifecycle all settle.
Reconstruct queued, accepted, executing, completed, failed, and canceled local
states after restart from the existing durable catalog and prove the same
fail-closed decision.

## In-scope behavior

1. Add strict shared `LocalRuntimeQuiescence`, operation-correlation, and
   sanitized operation-failure schemas. Diagnostics contain only closed
   operation/failure classes, retryability, and an opaque UUID.
2. Add an in-process runtime coordinator. `POST /api/runtime/drain` is
   idempotent for that process; `GET /api/runtime/quiescence` returns a derived
   snapshot. Both require local authorization.
3. Reject new logged-export claims before contacting cloud after drain begins.
   A claim already in flight may finish its durable import/accept handoff.
4. Let accepted/executing work, heartbeat, terminal reconciliation, and cleanup
   finish. Drain never aborts a media process, cancels a job, deletes evidence,
   or starts a new scheduler.
5. Track all injected FFmpeg, FFprobe, and yt-dlp commands through one wrapper;
   increment before invocation and decrement only after the runner settles.
6. Derive durable counts from the existing local queue, execution, scratch, and
   shared-source tables. Queued and accepted work is restartable and reported
   but does not alone block stopping; active processing, in-process operations,
   child commands, or any nondeleted scratch/group lifecycle does.
7. Keep drain process-local. After a crash there are no surviving child
   processes, while durable execution/scratch evidence remains fail-closed and
   startup recovery runs before the listener opens. A new process therefore
   starts accepting only after recovery rather than inheriting a stale drain
   switch.

## Explicit non-goals

- Updater/checkpoint implementation, Electron supervision, cloud-global drain,
  forced termination or cancellation, a polling scheduler, support bundles,
  telemetry, OS-process attestation, or changes to M5 export semantics.
- Controlling the separate transcription worker process; an M7 supervisor must
  coordinate that process independently.
- Claiming real Windows junction/reparse containment evidence from macOS or
  running a new real-source smoke without explicit authorization.

## Safety and recovery invariants

- `safeToStop` is derived and true only when drain is active and all three are
  zero: active local operations, active media commands, and active durable
  source lifecycles.
- `cleanup_failed` and other nondeleted scratch/group states remain unsafe and
  recovery-required. No status-only shortcut may hide source bytes.
- A drain/claim race has one event-loop ordering: the claim registers before
  its first await or is rejected; drain observes all registered operations.
- Responses never include request/job/clip/project IDs, transcript/subtitle
  text, notes/tags, source URLs, local paths, filenames, credentials, headers,
  tokens, object keys, commands, arguments, or command output.
- Correlation IDs are random local-operation identifiers, never derived from
  durable or sensitive identities.

## Acceptance criteria

1. Drain is authenticated, idempotent, blocks new claims before cloud, and
   remains queryable without affecting unrelated reads or local artifact work.
2. Child-command and operation races keep `safeToStop = false` until their
   promises settle; no drain path aborts or double-starts work.
3. Existing durable state reconstructs queued, accepted, executing, complete,
   failed, canceled, individual-scratch, and shared-group truth after restart.
4. Closed diagnostic schemas and adversarial tests prevent sensitive strings
   from reaching local responses or quiescence snapshots.
5. Focused tests, the full network-free check, web build, migration validators,
   formatting, and `git diff --check` pass before independent Sol review.

## Exit gates retained outside implementation

Milestone 6 cannot be declared fully closed until the already-declared real
Windows junction/reparse physical-containment proof is obtained and one new
explicitly authorized real-source M6 smoke passes. M6-07 must report those gates
honestly and must not initiate live access without user authorization.

## Completion evidence

- Added strict quiescence, durable-work, operation-correlation, and closed
  operation-failure contracts. Local responses use opaque UUID correlations;
  arbitrary provider messages, codes, issues, paths, credentials, and research
  content cannot enter the diagnostic boundary.
- Added a process-local runtime coordinator with event-loop-ordered operation
  tickets and idempotent drain. Fresh cloud session authorization protects drain
  and quiescence reads. New claims, processors, and media-capable mutations are
  rejected after drain; only a pre-existing pending acceptance handoff may
  finish its exact cloud transition.
- Injected one tracking runner through yt-dlp, FFmpeg capability discovery,
  FFprobe source/thumbnail inspection, FFmpeg rendering, and thumbnail creation.
  A child remains counted until its exact runner promise settles.
- Derived restart truth from the existing logged delivery/execution, job,
  scratch, and shared-source rows. Queued/accepted/checkpointed work remains
  restartable and visible; every nondeleted scratch/group lifecycle, including
  cleanup failure, remains fail-closed and unsafe.
- Runtime tickets settle only after Fastify handler success/failure, not client
  socket close. This prevents a disconnected request from starting later media
  work after a supervisor observed a safe snapshot.
- Focused contract/cloud/local DB/local-agent review evidence passed with 103
  tests. The full network-free suite passed with 323 tests and two skips;
  typecheck, web production build, all 27 local and 20 cloud migrations, scoped
  formatting, and `git diff --check` passed.
- Independent Sol review returned PASS with no remaining P0/P1 findings. The
  previously declared real-Windows physical-containment proof and a newly
  authorized real-source M6 smoke remain external milestone exit gates and were
  not claimed or run.
