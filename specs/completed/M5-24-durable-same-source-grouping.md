# M5-24 — Durable same-source grouping

- Status: completed 2026-08-22
- Task/thread: M5-24 only
- Dependencies: completed M5-21 execution/cancellation, M5-22 progress, and
  M5-23 batch/sibling isolation

## User-visible outcome

Compatible active ranges from one authorized logged-export batch can acquire and
inspect the full source once on one local worker, then render independent clips.
Each request keeps its own immutable settings, execution lease, progress,
cancellation, staging, package, and terminal result. A member's failure or
cancellation releases only that member; the shared full source is deleted only
after every claimed member has released it and deletion is verified.

## Smallest end-to-end proof

Accept two same-project, same-batch requests for the same canonical YouTube
source on one worker epoch, then process them concurrently. The acquisition and
source inspection adapters run once while both renderers and package pipelines
run independently. Complete one range and fail or cancel the other. Neither
terminal result is reconciled until the group source is deleted exactly once,
the surviving sibling is not corrupted, and replay or local restart cannot
reacquire, double-release, double-delete, or reuse the source outside that
active group.

## Architectural decisions and invariants

1. A source group is private local-worker coordination, not a cloud queue,
   executor, result, cancellation scope, artifact, cache, or authorization
   boundary. Existing request processors remain the only executors.
2. Eligibility is restricted to cloud-accepted logged requests from one
   immutable M5-23 batch, project, canonical YouTube video ID, provider profile,
   worker ID, registration epoch, and active exact execution attempt. A group
   never crosses projects, batches, workers, epochs, providers, or export-only
   requests.
3. The accepted delivery carries only sanitized immutable batch/source-group
   eligibility needed by the assigned worker. Project-facing batch/request
   reads expose no local group ID, source path, checksum, authorization token,
   lease, or worker-private lifecycle.
4. Durable local group and membership rows make creation/join, one acquisition
   owner, ready/failure publication, exact member release, cleanup claim, and
   deletion evidence replay-safe. State and reference count are derived from
   exact immutable member attempts rather than trusted caller counters.
5. Only acquired full-source media and its verified inspection are group-owned.
   Every member uses a disjoint private staging directory and retains its own
   bounds, subtitles, media render, thumbnail, metadata, manifest, promotion,
   provenance, progress, cancellation, and result race lock.
6. Join closes before shared acquisition is handed off. Late or incompatible
   work uses a fresh request-owned acquisition rather than retaining or reviving
   completed source media. Acquired source identity is validated before reuse;
   divergence fails closed.
7. A member releases exactly once after its render path ends. Failure or
   cancellation releases only that member and cannot delete media while another
   member is active. Last release performs one bounded deletion; all affected
   requests receive exact deleted evidence only after verified deletion.
8. Cleanup failure remains durable and actionable. No member reconciles cloud
   success, failure, or cancellation while full media may remain. Restart and
   the existing sweeper recover only validated expired group roots and never
   infer or traverse untrusted paths.

## Affected boundaries

- Shared delivery contract and cloud mapping: sanitized immutable grouping
  eligibility for accepted M5-23 batch children only.
- Local migration/queue: source groups, exact members, leases/state constraints,
  release barrier, cleanup claims/evidence, replay, and recovery queries.
- Media/local runtime: explicit separation of shared source ownership from
  member staging and the existing request processing pipeline.
- Local app/main/sweeper: one shared coordinator instance per worker process and
  bounded restart cleanup using the durable local state.

## Explicit non-goals

- A group executor, cloud group lease, batch cancellation, scheduling, or new
  retry semantics.
- Cross-project, cross-batch, cross-worker, export-only, or completed-source
  reuse; opportunistic caching; provider changes; or Clip Library/M6 UI.
- Artifact locators, source paths/checksums, local group identifiers, or raw
  tool output in shared project reads, progress, events, or results.

## Acceptance criteria

1. Fresh and populated local migrations enforce valid group/member states and
   preserve all prior request-owned scratch rows.
2. Compatible concurrently accepted siblings acquire and inspect once, use
   separate member staging, preserve exact settings/transcript/provenance, and
   independently render/package each range.
3. Duplicate delivery/process/release, cloud response loss, restart while
   acquiring/ready/rendering/cleaning, and expired claims converge without
   duplicate package/result, false progress, source reuse, or leaked media.
4. One member failure, cancellation, or lost execution cannot cancel, corrupt,
   complete, or delete the source beneath another. Owner/acquisition failure
   leaves siblings safely retryable or failed under their own exact ownership.
5. Cross-project, different-video/profile/epoch/attempt, late join, divergent
   acquired identity, and export-only attempts fail closed and never share.
6. Source deletion happens once after the final release. Cleanup failure blocks
   every member's terminal reconciliation until bounded recovery verifies the
   exact group root absent and records deleted evidence for each member.

## Verification plan

Run focused contract/catalog delivery tests; fresh/populated local migration and
state-machine concurrency tests; deterministic two-member runtime tests for
success, mixed failure, cancellation, replay, restart, and cleanup failure; and
group-root sweeper safety tests. Then run formatting, typecheck, both migration
CLIs, `git diff --check`, the full `npm run check`, and Playwright regression.
Use deterministic fake acquisition for concurrency counts and a real
FFmpeg/FFprobe repository fixture for final shared-source lifecycle proof.

## Completion evidence

Implementation commit `9f66ff0` adds delivery-private immutable batch identity,
local migration `0024`, durable group/member/source evidence, one process-local
source coordinator around the existing request processor, independently safe
member staging, exact final-release cleanup, and bounded startup/manual group
recovery. Ordinary sweeping refuses a joined member with a live exact execution;
startup recovery explicitly treats prior-process members as orphaned. Durable
compatibility evidence makes later/retry work fall back to the request-owned
path rather than revive retained source media.

Follow-up test commit `b8a4c84` explicitly proves that one canceled member
releases only its own reference while successful and failed siblings retain
their independent outcomes through the common deletion barrier.

Focused tests prove strict delivery metadata, populated/fresh migration,
state-shape constraints, active-lease sweep exclusion, exact group-root recovery,
restart fallback, mixed member failure, cleanup-failure blocking/redaction, and
partial-artifact non-completion. A real FFmpeg/FFprobe test processes two active
same-video batch children with one repository-fixture acquisition, two isolated
packages, two deleted member rows, and an absent group scratch root. The final
aggregate gate passed 258 tests with one declared skip, the production web
build, 24 local and 19 cloud migrations, `git diff --check`, and four Playwright
flows. The 30-second foreign fixture and opt-in user-authorized live smoke remain
separate release-gate work.
