# M5-01 — Authorized source acquisition and scratch lifecycle

- Status: completed
- Task/thread: M5-01 only

## User-visible outcome

An authorized queued export can obtain its full source media only through an
explicitly configured provider, place it in a private job-scoped scratch
directory, and reliably remove the source when the acquisition path reaches a
terminal outcome. A source that cannot be acquired, is unauthorized, malformed,
or cannot be deleted leaves an actionable persisted job state; it never becomes
an invisible retained file or a successful export.

## Current behavior and evidence

- `packages/media` has an opt-in `yt-dlp` audio acquisition adapter for
  transcription. It produces FLAC, not a full export source.
- `apps/worker/src/pipeline.ts` creates and verifies cleanup of transcription
  scratch directories, but no export worker consumes queued export requests.
- Logged exports and projectless export-only requests already persist immutable
  video, selection, source-language, and preset snapshots. Their jobs remain
  queued; M5-01 must preserve this logged versus export-only separation.
- `PROJECT_GUIDE.md` requires job-scoped source scratch, authorization, terminal
  cleanup verification, and no success state while source media remains.

## In scope

1. Define a full-source acquisition contract behind `packages/media` that is
   distinct from the transcription-audio adapter and keeps provider/tool details
   out of routes and UI.
2. Add an explicit opt-in provider configuration and a deterministic fake for
   tests. The production adapter must use argument arrays, disable ambient
   provider configuration, validate inputs/paths, bound command output, support
   cancellation, and require the caller's authorization confirmation.
3. Create one private (`0700`) scratch directory per export-processing attempt
   beneath the configured data root. Validate that every acquired source is a
   regular, nonempty file inside that directory; capture only safe provenance
   needed by the job (provider, byte size, checksum, and source identity).
4. Implement the export-source lifecycle through its real job boundary so
   acquisition failure, cancellation, and successful handoff each execute
   cleanup. Verify that source media is absent before a terminal success state.
   A failed cleanup must be durable and actionable rather than silently marked
   complete.
5. Add narrow fixture/fake tests for authorization refusal, argument construction,
   invalid output, successful cleanup, acquisition failure cleanup, cancellation
   cleanup, and cleanup failure. Run relevant database/worker integration checks
   after the narrow suite.

## Explicit non-goals

- FFprobe inspection, bounds validation, FFmpeg rendering, subtitle generation,
  final artifact staging, thumbnails, manifests, presets, and export UI changes.
- Same-source multi-export grouping and the abandoned-scratch sweeper/lifecycle
  backstop; those follow after this single-attempt lifecycle is proven.
- Changing transcript acquisition, transcript publication, project authorization,
  logged-clip semantics, or the projectless behavior of `Export only`.
- Downloading media without explicit configured provider and caller-confirmed
  authorization, or storing media/credentials in source control.

## Required invariants and boundaries

- Preserve immutable export request snapshots and all existing public package/app
  boundaries unless a migration and contract change are justified in this spec.
- `Export + log` still creates the project clip before an export job; `Export
only` still creates no project clip, CSV row, or Sheets record.
- Keep full source media ephemeral: it may exist only in its job-scoped scratch
  directory, never in the repository, shared transcript object store, or final
  output location at this stage.
- Do not expose provider credentials, command details, private source URLs, or
  local paths in browser/API responses or logs.
- If durable state needs a new field or state, add the corresponding local/cloud
  migration and preserve idempotent retry semantics. Do not infer completion
  from a file's existence alone.

## Acceptance criteria

- An unconfigured provider or absent authorization confirmation does not start
  acquisition and produces an actionable, retry-safe job result.
- The configured provider receives only validated arguments with no shell and
  writes the source only below its private attempt directory.
- A valid acquired source is regular, nonempty, identified by checksum, and
  associated with its job attempt without leaking sensitive paths/URLs.
- Success, provider error, validation failure, and cancellation all attempt and
  verify deletion of the source and attempt directory.
- Cleanup failure is observable and blocks a terminal successful export state;
  retrying cleanup does not re-download or overwrite a verified source/output.
- Existing transcript-acquisition tests, export-only separation tests, and the
  relevant worker/database tests remain green.

## Focused context

Read this spec, `PROJECT_GUIDE.md` sections 3.5, 3.10, 7.5, 15, and 16, the
Milestone 5 portion of `outline.md`, and only the affected contracts, media,
local/cloud persistence, and worker files. Use the existing transcription
scratch lifecycle as evidence and reuse its safety properties without coupling
the two pipelines.

## Verification plan

1. Run the new focused media/export lifecycle tests first and keep their actual
   output in the completion record.
2. Run the affected package, worker, local database, and cloud database tests.
3. Run formatting and type checks, then the broader project checks appropriate
   to the final diff.
4. Review the complete diff for authorization bypasses, source-retention paths,
   log/credential leakage, lost job state, and violations of logged versus
   export-only separation.

## Completion record

- Decisions made: Added a separate `ExportSourceAcquisitionProvider` and
  `EXPORT_SOURCE_PROVIDER` opt-in configuration; acquisition requires explicit
  per-attempt authorization. Source lifecycle state is workstation-local in
  SQLite because the media never leaves the local job scratch directory; the
  cloud logged-export contract remains unchanged. Successful M5-01 handoff
  returns the immutable request to `queued` because rendering is deliberately
  deferred; `complete` is never set by acquisition.
- Files changed: `packages/media/src/index.ts` and tests; `packages/config`
  configuration and tests; local export lifecycle processor and tests;
  `packages/db-local/migrations/0005_export_source_scratch_lifecycle.sql` and
  queue persistence tests; `PROJECT_GUIDE.md` and `outline.md`.
- Checks run and actual results: focused `vitest` suite: 19 passed; affected
  migration and integration checks: local migrations 5 applied, cloud migrations
  7 applied, 25 tests passed; `npm run typecheck`: passed; `npm run
format:check`: passed; `npm test`: 108 passed, 1 skipped; `git diff --check`:
  passed.
- Manual verification: No live acquisition was run; it requires an explicitly
  configured provider and caller authorization. Deterministic fake-provider
  tests exercised each required lifecycle path without downloading media.
- Remaining risks/follow-ups: M5-02 must retain the verified source only through
  FFprobe/FFmpeg handoff, add output staging and finalization, and use the same
  cleanup gate. Same-source grouping, independent cleanup retry, and the
  abandoned-scratch sweeper remain explicitly deferred.
- Commit ID(s): Not committed in this task.
