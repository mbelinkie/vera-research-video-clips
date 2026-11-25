# M7-05 — Complete export workflow integration

- Status: complete
- Milestone: M7 local desktop completion and personal validation
- Dependencies: M5 durable export delivery/execution/result, progress,
  cancellation, retry, batching, same-source grouping, and cleanup are complete;
  M6 Clip Library/artifact/recovery/authoring boundaries and M7-02 through M7-04
  desktop setup, supervision, and transcript integration are complete. M7-01
  real AWS/Cognito acceptance remains externally blocked.

## User-visible outcome

From the terminal-free Intel macOS application, a signed-in researcher can
confirm rights for an exact source and have both logged and projectless export
requests execute automatically through the existing durable local processor.
Queue / log only still creates research work without rendering; Export + log
creates the project clip before automatic execution; Export only remains
projectless and creates no clip, CSV row, or shared research record. Clip
Library individual/batch export, progress, retry/cancel, immutable history,
verification, reveal/open/relink, re-export, and authoring handoff continue on
their established M5/M6 boundaries without manual worker or API commands.

## Smallest end-to-end proof

Using deterministic, repository-owned source media, select one exact passage
and exercise all three actions. Prove Queue / log only creates one clip and no
export; prove a rights-confirmed Export + log creates the clip, is automatically
registered/claimed/accepted/executed/reconciled by the existing local worker,
and yields one verified artifact version; prove a rights-confirmed Export only
creates and automatically completes one local request without project history.
Restart during queued/accepted work and prove the same durable request resumes
without a second render. Repeat with a multi-clip Clip Library batch and show
independent progress, cancellation/retry, same-source grouping, cleanup, and
artifact actions without `curl`, `export:run-once`, or a separate process.

## Affected authority boundaries

- Cloud project/catalog authority continues to own logged clips, export
  requests/jobs, delivery reservation/acceptance, execution lease/progress,
  cancellation, retry lineage, batches, immutable results, and artifact history.
- SQLite continues to own the local export queue, exact accepted delivery and
  execution evidence, projectless requests, source-rights evidence needed for
  local acquisition, source/group scratch, packages, and workstation locators.
- The local agent owns one bounded scheduling lane around the existing
  registration, heartbeat, claim/accept/process, and `runLocalExportOnce`
  boundaries. It does not become a second executor or cloud catalog.
- Electron owns signed-in lifecycle, protected cloud-token proxying, readiness,
  drain, and sign-out coordination. The renderer never receives credentials,
  delivery/execution tokens, paths, process controls, or arbitrary IPC.
- The renderer owns explicit source-specific rights confirmation and presents
  durable progress/actions. A global setup acknowledgement is disclosure only
  and cannot substitute for exact acquisition authorization.
- Full-source media remains private job/group scratch. Existing exact cleanup
  and terminal reconciliation gates remain authoritative.

## In-scope behavior

1. Add immutable, source-specific rights evidence at every request-creation
   path that may acquire media: selection Export + log, selection Export only,
   Clip Library individual/batch export, re-export, and authoring fallback.
   Queue / log only requires no acquisition authorization and starts no render.
2. Persist and propagate exact confirmation safely across local/cloud request,
   delivery, retry, batch, and restart boundaries. The automatic worker may
   never synthesize `authorizationConfirmed: true` for a request lacking that
   evidence.
3. Add one local-agent-owned, single-concurrency export supervisor that reuses
   the existing worker registration/heartbeat, pending-acceptance recovery,
   claim/import/accept, exact execution heartbeat/cancellation, processor, and
   result-reconciliation paths.
4. Automatically process eligible persisted export-only requests with the
   existing `LocalExportQueue` and `runLocalExportOnce`; never send projectless
   work to cloud delivery or artifact history.
5. Start or pause scheduling according to signed-in state, setup/readiness,
   worker enablement, drain, and exact rights. Sign-out stops fresh logged claims
   before protected credentials are cleared; active work drains safely.
6. Expose closed path-free worker health and operation-specific readiness. Use
   bounded idle/error backoff and no overlapping ticks, hot loop, unbounded
   claim, or automatic retry of `needs_user_action`/cleanup-required work.
7. Preserve M5/M6 individual/batch progress, retry/cancel, same-source grouping,
   storage preflight, cleanup recovery, immutable artifact history,
   verify/reveal/open/relink, re-export, and authoring descriptor behavior.

## Failure states

- Missing, stale, mismatched, or unconfirmed exact source rights leaves only the
  dependent export in `needs_action` and performs no acquisition/provider call.
- Sign-out, revoked membership, cloud-proxy failure, worker expiry/revocation,
  capability change, or network/cloud outage stops new logged claims and keeps
  durable accepted/local work recoverable without leaking credentials.
- Drain/restart stops scheduling new work, lets exact active execution and
  cleanup settle, and resumes pending acceptance/eligible queued work once.
- Lease loss or cancellation aborts the same processor signal, terminates child
  commands, removes only exact owned scratch/package state, and reconciles only
  after verified cleanup.
- Low/changed disk space blocks the affected heavy operation before render and
  preserves browsing, transcript review, logging, history, and actionable state.
- `cleanup_failed`, invalid tool/provider/model, corrupt package, stale settings,
  or artifact mismatch remains explicit and is never blindly retried or marked
  complete.
- A duplicate tick, lost HTTP response, app crash, or cloud commit/response loss
  converges through existing idempotency and exact ownership without another
  request, render, result, artifact version, or clip event.

## Explicit non-goals

- A separate Electron export-worker process, new executor/queue/state machine,
  in-memory orchestration, hosted renderer, cloud clip-byte store, or changes to
  M5/M6 immutable package and artifact identity.
- Automatic retry of terminal failures or cleanup-required work, hidden rights
  assumptions, whole-batch cancellation, or cross-project/source reuse.
- M7-06 live-source/real-cloud dogfood or final milestone decision.
- M8 signing/notarization, Universal/Windows builds, updates, releases, remote
  testers, support/reporting, or independent cross-platform QA.
- Any live-source acquisition without a new exact source-specific user
  authorization for this slice's eventual dogfood invocation.

## Acceptance criteria

1. Exact per-request source-rights evidence is explicit in the UI, durable,
   immutable with request material, preserved through delivery/retry/batch, and
   required immediately before every automatic source acquisition.
2. One bounded local-agent supervisor registers/heartbeats, recovers pending or
   accepted work, claims/processes logged work, and processes local export-only
   work using only the established durable processor/result boundaries.
3. Queue / log only, Export + log, and Export only retain their exact distinct
   clip/export/shared-record effects; no ordinary path needs manual register,
   heartbeat, claim/process, `curl`, or `export:run-once`.
4. Clip Library individual/batch export, progress, retry/cancel, grouping,
   cleanup, artifact verify/reveal/open/relink, immutable re-export, restart
   persistence, and authoring handoff remain compatible and actionable.
5. Sign-out, drain, crash/restart, cloud/network loss, low space, lease loss,
   cancellation, worker failure, and cleanup-required tests preserve durable
   work and leave no full source media after terminal cleanup.
6. Renderer/IPC/API/status/error boundaries expose no OAuth, delivery/execution
   token, source media, path, filename, command, raw output, or credential.
7. Focused tests, formatting, typecheck, clean/populated migrations, affected
   unit/integration suites, web/desktop builds, packaged deterministic UI proof,
   aggregate checks, `git diff --check`, and independent Terra review find no
   unresolved P0/P1.

## Narrow tests first

- Rights contracts and clean/populated migrations: exact source binding,
  strictness, immutable replay/retry/batch propagation, and unconfirmed no-call.
- Supervisor unit tests with fake time/dependencies: register/heartbeat, idle
  backoff, one lane, pending/accepted restart recovery, logged versus
  export-only routing, drain/stop, auth/capability failures, and safe status.
- Existing local-agent claim/process/execution/cancel/result, one-shot processor,
  storage guard, source/group cleanup, and runtime quiescence matrices.
- Web/Playwright: default-unchecked exact rights; all three selection effects;
  automatic individual/batch completion; progress/retry/cancel; artifact
  actions; restart; and no acquisition when confirmation is absent.

## External closure boundary

All normal tests and automated execution proofs remain network-free and use
repository-owned deterministic media. Real Cognito/RDS/S3/SQS acceptance still
requires the M7-01 deployment inputs and authority. Real source processing
requires a separately supplied exact rights-cleared source authorization and
the approved tool/model configuration; it is M7-06 evidence, not permission
granted by this spec.

## Completion record

Completed on 2026-08-23 at the deterministic local/fixture boundary. M7-06 was
not activated, no live source was acquired, and this completion does not mark
M7 itself complete.

### Design decisions and delivered behavior

- Added strict `ExportSourceRightsSnapshot` evidence for the exact YouTube
  video. Every new Export + log, Export only, Clip Library individual/batch,
  and immutable re-export command requires it. Queue / log only remains a
  research action and needs no acquisition confirmation or render.
- Persisted the confirmation with immutable request/job material in cloud and
  local stores. Retry, batch, delivery, and artifact-history projections retain
  it. Pre-M7-05 rows remain readable but cannot authorize new acquisition;
  already accepted legacy work is failed and reconciled without calling a
  source provider, while unaccepted legacy cloud work is not claimed.
- Added one bounded `LocalExportSupervisor` inside the existing local agent. It
  reuses the established register, heartbeat, claim/accept, execution,
  cancellation, processor, result, and cleanup routes. It recovers accepted
  work first, then claims one logged request and processes one eligible
  projectless request. It never creates a second executor or Electron service.
- Electron enables or pauses that supervisor from signed-in setup/readiness and
  stops fresh claims before sign-out. The supervisor rechecks readiness, drain,
  and pause state around asynchronous registration, heartbeat, claim, and
  process boundaries; sign-out cannot begin source acquisition after a pause.
- Closed path-free supervisor issues now feed operation-specific readiness for
  authentication, cloud, configuration, and worker failures. Credentials,
  local paths, commands, raw output, delivery tokens, and execution tokens do
  not enter the renderer response.
- The selection and Clip Library UIs show the exact YouTube ID and use separate,
  default-off source confirmation. Confirmation resets on project, video,
  selection, preflight, and successful submission changes. Clip Library batch
  submission binds one confirmation to every selected clip.

### Changed boundaries

- `packages/contracts`, `packages/catalog`, and `packages/db-cloud`: strict
  command evidence, exact clip/video binding, retry/batch/delivery propagation,
  legacy claim filtering, and cloud migration
  `0023_export_source_rights_snapshots`.
- `packages/db-local` and the existing local export processor: durable evidence,
  restart selectors, immutable terminal reconciliation, pre-acquisition
  enforcement, and local migration
  `0030_export_source_rights_and_terminal_reconciliation`.
- `apps/local-agent`: the single-concurrency scheduler, native-only lifecycle
  route, readiness projection, automatic composition through existing routes,
  and exact Clip Library rights mapping.
- `apps/desktop`: signed-in/setup/readiness reconciliation and sign-out pause;
  the launcher still does not create a separate export-worker process.
- `apps/web`: exact-source confirmation for selection and Clip Library export
  commands while preserving the distinct Queue / log only behavior.

### Verification evidence

- Final aggregate Vitest run: 52 files passed and 1 opt-in file skipped; 506
  tests passed and 4 skipped. The final focused supervisor run passed 11/11,
  including automatic scheduling, single-lane ordering, accepted-work restart
  recovery, heartbeat, drain, pause during readiness/register/claim, safe issue
  classification, and stop/wait behavior.
- The full PGlite catalog suite passed 32/32 after source-rights claim and retry
  coverage was added. Deterministic local FFmpeg/FFprobe processing retained its
  real fixture proof, and a focused regression proved missing durable rights
  calls no acquisition provider.
- `npx playwright test tests/e2e/workspace.spec.ts`: 6 passed. The existing
  transcript/workspace flows remained intact, while the changed workflow proved
  default-off exact-source confirmation, no request before confirmation,
  distinct logged/projectless request bodies, per-clip batch evidence, and
  re-export reset behavior.
- `npm run typecheck`, `npm run build:web`, and `npm run build:desktop` passed.
  Local migration validation applied 30 migrations; cloud validation applied 23. All staged TypeScript/TSX files passed scoped Prettier and
  `git diff --check` passed.
- `npm run check` stopped only at global `format:check` because the pre-existing
  user-owned `docs/Script-to-Resolve Product Spec.md` is not formatted. That
  file was preserved untouched by this slice; the later typecheck, aggregate
  tests, builds, migrations, scoped formatting, and diff checks were run
  separately and passed.
- `npm run desktop:package:x64` passed. Bundle ID is
  `com.researchvideoclips.desktop`, version `0.1.0`; the executable is Mach-O
  x86_64. Final `app.asar` SHA-256 is
  `b6e60908fdccac4ea8b6024a11e631e38b719f5e918724e1ec12683c98fbb8f0`
  (5,384,957 bytes).
- The packaged app launched and quit with disposable profile
  `/tmp/research-video-clips-m705-smoke.GokvK7`. Stderr was empty, no process
  using that profile remained, and the exact profile was moved to Trash. No
  user app data, database, model, credential, export, or source media was used.

### Independent review and remaining prerequisites

Fresh Terra review found and drove closure of pause/sign-out races, actionable
supervisor readiness, cloud filtering for legacy unconfirmed work, and local
reconciliation for already accepted legacy work. Final re-review found no
remaining M7-05 P0/P1. As lower-priority defense in depth, the cloud database
constraint binds the required discriminator and exact video but leaves the
full nested disclosure-version strictness to the shared contract and catalog
ingress validation.

M7-05 is complete at the network-free deterministic boundary. Real Cognito,
RDS, S3, and production worker acceptance remains blocked on M7-01 deployment
inputs and authority. Real source processing still requires a newly supplied,
rights-cleared source and approved local tools/model. Per user direction, those
M7-06 dogfood gates are intentionally paused while additional features are
added; M7-06 remains unstarted and M7 is not complete.

### Commits

- Implementation, tests, and migrations: `85f62fe`
- Completion documentation: recorded by the documentation commit that moves
  this spec to `specs/completed/`.
