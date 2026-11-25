# M5-03 — FFmpeg adapter and verified single-range render

- Status: completed
- Task/thread: M5-03 only

## User-visible outcome

A queued logged export or projectless export-only request with an authorized,
validated source and M5-02 resolved bounds can render exactly one
editing-friendly H.264/AAC MP4 range into attempt-owned staging. The temporary
render is re-inspected and accepted only when its safe media properties match
the immutable request snapshot. Source and temporary scratch are deleted on all
terminal paths; a cleanup failure remains an actionable local job state.

## Focused context

Read `PROJECT_GUIDE.md` sections 3.5, 5.8, 7.1–7.5, 15, and 16;
`outline.md` Milestone 5; and completed M5-01/M5-02 specs. Inspect only the
affected export-request contracts, `packages/media`, local-agent source
lifecycle, local SQLite lifecycle, and worker tests.

## In scope

1. Add a provider-neutral FFmpeg render adapter in `packages/media`, with a
   deterministic fake. It uses validated paths, argument arrays, bounded
   sanitized output, cooperative cancellation, and no shell.
2. Consume the immutable export request snapshot and M5-02 resolved
   bounds/provenance without changing transcript selection or requested/export
   bounds.
3. Support only the existing editing-friendly H.264/AAC MP4 snapshot path;
   reject malformed/unsupported settings or incompatible inspected source
   conditions with actionable retry-safe state.
4. Render into a private attempt-owned temporary output below approved staging,
   require a regular nonempty output, re-inspect it with FFprobe, and validate
   duration tolerance, container, video codec, and audio codec. Persist only
   safe output provenance.
5. Delete source only after temporary render validation. On FFmpeg failure,
   output-validation failure, or cancellation, clean source and temporary
   scratch; preserve M5-01 cleanup-failure behavior.
6. Keep logged-export and export-only separation unchanged.

## Explicit non-goals

- Subtitles, thumbnails, manifests, final artifact promotion, preset/UI work,
  same-source grouping, render retries, or the scratch sweeper.
- Changes to transcript acquisition/publication, project authorization,
  logged-clip semantics, CSV/Sheets, or export-only projectlessness.
- Persisting or exposing local paths, URLs, commands, credentials, or raw tool
  output.

## Failure states

- Unsupported/malformed settings or incompatible source inspection fail before
  FFmpeg with specific retry-safe remediation, followed by verified scratch
  cleanup.
- FFmpeg failure, cancellation, missing/nonregular/empty output, malformed
  output inspection, or output property mismatch fails safely and cleans both
  source and temporary output.
- Source or output cleanup failure supersedes normal terminal reporting with
  M5-01's actionable `needs_user_action` state.

## Acceptance criteria

- FFmpeg is replaceable and normal tests use a deterministic fake that asserts
  only validated argument arrays.
- A valid H.264/AAC MP4 source and resolved range renders to private staging;
  its re-inspected duration/container/codecs satisfy the request snapshot and
  safe provenance is durable.
- Immutable selection/requested bounds remain separately readable and unchanged.
- Every failure/cancellation path deletes source and temporary render scratch;
  no source is deleted before validation succeeds.
- Logged and export-only requests retain their existing persistence and
  project-boundary behavior.

## Verification plan

1. Run focused fake/fixture tests first for FFmpeg arguments, successful render
   and FFprobe validation, settings/output mismatch, render failure/cancellation
   cleanup, output-validation cleanup, and cleanup-failure actionability.
2. Run relevant media, local-agent, local-database, and worker tests.
3. Run formatting, typecheck, broader project checks, and `git diff --check`.
4. Review the completed diff for snapshot mutation, tool/path leakage, missed
   cleanup, and logged/export-only boundary violations.

## Completion record

- Decisions made: Kept FFmpeg behind an injectable `packages/media` adapter
  and supported exactly the existing editing-friendly H.264/AAC MP4 snapshot:
  CRF, source frame rate, no scaling, no subtitle embedding, and no alternate
  codec/container options. Re-encode seeking is precise (`-ss` after input),
  and output must verify within 250 ms of the persisted M5-02 range. The
  temporary MP4 remains under the existing private attempt directory, so the
  M5-01 cleanup gate removes it and the source together only after validation.
  Safe output provenance is local SQLite state tied to the source attempt;
  this deliberately does not promote an artifact or complete the export.
- Files changed: `packages/media` FFmpeg/validation adapter and tests;
  `apps/local-agent` export source processor and fake lifecycle tests; shared
  export request schema; local SQLite render-provenance migration `0007` and
  queue test; `PROJECT_GUIDE.md`; and `outline.md`.
- Checks run and actual results: focused media/local-agent/local-DB suite: 20
  passed; affected media/local-agent/local-DB/worker suite: 37 passed;
  `npm run typecheck`: passed; `npm run format:check`: passed; `npm run check`:
  format and typecheck passed, 118 tests passed with 1 skipped, web production
  build passed, and local migrations validated with 7 newly applied; cloud
  migrations validated separately with 7 newly applied; `git diff --check`:
  passed.
- Remaining risks/follow-ups: No live authorized FFmpeg smoke test was run;
  production tools and source authorization are explicitly configured and the
  normal suite uses deterministic fakes. Subtitle artifacts, final artifact
  staging/promotion, manifests, render retries, same-source grouping, and the
  scratch sweeper remain intentionally deferred. A validated temporary output
  is cleaned rather than retained until final-promotion semantics are added.
- Commit ID(s): Not committed in this task.
