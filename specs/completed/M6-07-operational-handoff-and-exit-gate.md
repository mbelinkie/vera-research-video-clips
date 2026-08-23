# M6-07 — Operational handoff and exit gate

- Status: complete; Milestone 6 closed 2026-08-23
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

## Exit gates completed after implementation

The implementation completed with two deliberately open external gates: a real
Windows junction/reparse physical-containment proof and one new explicitly
authorized real-source M6 smoke. Both were subsequently completed on 2026-08-23
without starting Milestone 7.

### Real-Windows physical containment

- The user explicitly authorized a temporary `windows-latest` GitHub Actions
  workflow. Addition commit `70fd49b` checked out exact revision
  `70fd49b65741d9d13d3ec2976e184ec9abfb7ca1` and ran the committed physical
  package-junction test rather than accepting a platform skip.
- GitHub Actions run
  [32648253167](https://github.com/mbelinkie/youtube-clip-converter/actions/runs/32648253167)
  passed on Windows Server 2025 Datacenter, Windows version 2009/build 26100,
  Node `v22.23.2`, and npm `10.9.8`.
- Exact command:
  `npm exec vitest -- run apps/local-agent/src/artifact-locators.test.ts --testNamePattern "rejects a physical Windows package junction" --reporter=verbose --no-color`.
  The named test ran and passed in 744 ms; the file reported one passed test and
  twelve unrelated skips. This proves a real Windows junction fails closed as
  untrusted and persists no locator.
- Cleanup commit `789fe9e` removed the temporary workflow and was pushed. No
  workflow, deployment, main-branch mutation, or M7 implementation remains from
  the gate.

### Newly authorized real-source smoke

- The user supplied a source-specific rights-cleared authorization and exact
  17-second range. Caption discovery exposed a coherent Spanish-original
  automatic track. YouTube rate-limited its generated-English alias, so the
  external descriptor used eight exact source-video Spanish cue ranges plus an
  eight-cue English derivative linked to the exact original track.
- The strict external descriptor passed schema validation with matching eight-
  segment original/English tracks and was stored outside the repository with
  private permissions. The guarded command ran once with both authorization
  flags and `EXPORT_SOURCE_PROVIDER=yt-dlp`.
- Result: `passed`. FFprobe verified exactly 17,000 ms of H.264/AAC MP4 at
  1920x1080. Original and English SRTs each contained eight clip-relative cues
  bounded from 0 through 17,000 ms. `sourceScratchAbsent` and
  `temporaryWorkspaceRemoved` were both true.
- Six verified artifacts were produced before cleanup:
  - `video_mp4`: 7,564,675 bytes,
    SHA-256 `2b3099e7c9fedc764c29422e4efe0f3f58c272089f1a8837803d046827ad09e4`
  - `original_srt`: 625 bytes,
    SHA-256 `e36cae69b49d84e339c04b6afffa1ae739113211f90e813c220f0b0c2cb70190`
  - `english_srt`: 706 bytes,
    SHA-256 `cae8930140995fd94246451ae614071e411e83ee64ae57426fb26cdf71fa3a89`
  - `thumbnail_jpg`: 97,021 bytes,
    SHA-256 `406e013eb5db010f6f785e1f2076942a4320e821bbc4842e9130118181129ec3`
  - `clip_metadata_json`: 2,647 bytes,
    SHA-256 `0cfcb3b7b06a82180e35853bd2573d1a5285da0b2d38bd6c1e7054b68e6bd85a`
  - `manifest_json`: 5,196 bytes,
    SHA-256 `28dcb3954bc67fa884be55f1fbb1026d42a62b919fcf6061f8d9d8702d8d2036`
- The external descriptor, acquired caption, generator, downloaded source,
  rendered package, and private temporary workspaces were deleted and verified
  absent. Only this sanitized evidence remains.
- An earlier authorized candidate was deliberately interrupted after human
  review exposed conflicting provider and creator language evidence. Its
  workspace cleanup succeeded, no result was claimed, its temporary evidence
  was deleted, and the production enhancement was scoped as `PUNCH-001` in the
  future pilot punch list.

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
- Independent Sol review returned PASS with no remaining P0/P1 findings.
- The two retained external exit gates were completed with the evidence above.
  Milestone 6 is closed; Milestone 7 has not started.
