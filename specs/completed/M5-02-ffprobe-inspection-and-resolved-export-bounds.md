# M5-02 — FFprobe inspection and resolved export-bound validation

- Status: completed
- Task/thread: M5-02 only

## User-visible outcome

Before a queued logged export or projectless export-only request can reach the
future render handoff, its authorized full source is inspected through a
provider-neutral FFprobe boundary. The worker records safe media provenance and
persists the actual, clamped export range separately from the immutable
selection and requested export bounds. An invalid source, malformed inspection,
empty resolved range, inspection failure, or cancellation leaves an actionable,
retry-safe job state and removes source scratch just as M5-01 requires.

## Current behavior and evidence

- M5-01 provides opt-in authorized full-source acquisition, a private
  job-attempt scratch directory, source-file validation, durable local lifecycle
  state, deterministic fakes, and verified cleanup.
- Existing export requests already preserve immutable transcript-selection and
  requested export-bound snapshots, with logged exports separate from local
  projectless export-only requests.
- No FFprobe adapter, safe media provenance, or actual-duration bound resolution
  exists yet; M5-01 intentionally returned the source handoff to `queued` and
  immediately cleaned its scratch source.

## In scope

1. Add an injectable FFprobe adapter under `packages/media`, with deterministic
   fake coverage. It must use validated paths, argument arrays, bounded
   sanitized output, cooperative cancellation, strict parsing, and no shell.
2. Require a regular nonempty source inside the current private attempt scratch
   directory before probing. Capture only duration, container/format,
   video/audio codec details needed by later capability checks, and FFprobe
   version when available; do not persist or expose source paths, URLs,
   commands, credentials, or raw probe output.
3. During the M5-01 source handoff, persist safe probe provenance and resolved
   export bounds independently from immutable transcript-selection and
   requested export bounds. Clamp padded bounds to `[0, duration]`; reject
   non-finite, inverted, or empty resolved ranges with actionable retry-safe
   state.
4. Extend the local SQLite lifecycle only where durable source-probe provenance
   and resolved bounds require it, including migrations and read models.
5. Ensure inspection failure, invalid bound validation, and cancellation run
   the existing verified source cleanup. Preserve M5-01 cleanup-failure state as
   actionable and do not introduce a source-retention success path.

## Explicit non-goals

- FFmpeg rendering, subtitle generation or validation, presets/UI changes,
  output staging/finalization, thumbnails/manifests, same-source grouping, the
  abandoned-scratch sweeper, or independent cleanup retries.
- Changing transcript acquisition/publication, project authorization, logged
  clip semantics, CSV/Sheets synchronization, or the projectless behavior of
  `Export only`.
- Persisting source paths, provider commands, raw probe payloads, source URLs,
  or credentials; live FFprobe/provider smoke tests are optional and excluded
  from normal tests.

## Failure states

- Missing, nonregular, empty, or out-of-scratch source fails safely before
  FFprobe execution and triggers cleanup.
- Malformed/nonfinite/no-duration probe output, FFprobe process failure, and
  cancellation remain bounded and sanitized, transition the request to an
  actionable retry-safe failure state, and trigger cleanup.
- A padded range clamped to media duration that is empty or invalid fails with
  a specific bounds-validation reason; the original request snapshot remains
  unchanged.
- Cleanup failure continues to win over normal failure/completion reporting and
  remains visible as `needs_user_action`, as established by M5-01.

## Acceptance criteria

- FFprobe is replaceable, receives validated argument arrays only, and its
  normal fake tests cover argument construction and strict output parsing.
- Durable state records only safe source/probe provenance and resolved bounds;
  requested bounds and transcript-selection bounds remain immutable and
  separately readable.
- A valid source produces a duration-clamped resolved range for both logged and
  export-only request paths, without creating project research data for the
  latter.
- Bounds clamp cleanly at zero and media duration; invalid or empty results are
  rejected rather than silently repaired into a different request.
- Inspection errors, malformed output, validation errors, and cancellation all
  delete and verify source scratch; M5-01 cleanup failure remains actionable.

## Focused context

Read this spec, `PROJECT_GUIDE.md` sections 3.5, 7.4–7.6, 10, 12, 13, 15, and
16; the Milestone 5 portion of `outline.md`; the completed M5-01 spec; and only
the affected `packages/media`, `apps/local-agent`, `packages/db-local`, and
export request contracts/tests. Retain the M5-01 separation between logged
exports and export-only jobs.

## Verification plan

1. Run the focused FFprobe adapter and export-source lifecycle fixture/fake
   tests first, covering arguments/parsing, persisted resolution, clamping,
   invalid range, malformed output, cancellation/failure cleanup, and existing
   cleanup-failure behavior.
2. Run relevant media, local-agent, local database, and worker tests.
3. Run formatting, typecheck, appropriate broader project checks, and
   `git diff --check`.
4. Review the complete diff for source-path/URL/command leakage, request
   snapshot mutation, missed cleanup paths, missing migration coverage, and any
   logged/export-only boundary violation.

## Completion record

- Decisions made: Added `FfprobeMediaInspector` and `ExportSourceInspector` in
  `packages/media`; both real and fake inspections pass through regular-file and
  private-attempt-directory validation before probing. The adapter uses
  argument-array invocation, strict bounded JSON parsing, generic sanitized
  failures, and a best-effort bounded version query. Safe probe provenance lives
  on the local source-attempt record; resolved bounds live separately on the
  local export request, leaving the immutable selection/requested bounds JSON
  untouched. No cloud migration was justified because full source media and its
  lifecycle remain workstation-local, and this slice adds no logged-project
  write path or sync behavior.
- Files changed: `packages/media` adapter/tests; shared export request read
  schema; `apps/local-agent` source handoff/tests; local export lifecycle
  migration `0006_export_probe_resolution` and tests; `PROJECT_GUIDE.md`; and
  `outline.md`.
- Checks run and actual results: focused media/local-agent/local-DB suite: 15
  passed; affected media/local-agent/local-DB/worker suite: 32 passed;
  `npm run typecheck`: passed; `npm run check`: format check passed, typecheck
  passed, 113 tests passed with 1 skipped, web production build passed, local
  migrations validated with 6 newly applied, cloud migrations validated with 7
  newly applied; `git diff --check`: passed.
- Manual verification: No live FFprobe or source acquisition ran; both require
  locally configured authorized media tools. Deterministic fakes cover FFprobe
  arguments/parsing, malformed output, duration clamping, empty ranges,
  cancellation, inspection failure cleanup, and the established cleanup-failure
  path.
- Remaining risks/follow-ups: FFmpeg rendering, actual capability validation,
  subtitles, artifacts/finalization, same-source grouping, independent cleanup
  retry, and the abandoned-scratch sweeper remain intentionally deferred.
- Commit ID(s): Not committed in this task.
