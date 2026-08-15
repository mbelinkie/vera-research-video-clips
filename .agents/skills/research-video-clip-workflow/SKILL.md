---
name: research-video-clip-workflow
description: Plan, implement, review, and test the shared-project Research Video Transcript & Clip Extraction Tool in this repository. Use when working on YouTube video loading, online transcript storage/sync, AWS/S3 project artifacts, bulk transcription batches and workers, transcript acquisition or translation, transcript-synchronized navigation, text-range selection, project-based clip logging, export-only workflows, FFmpeg/subtitle export, queues, caching, SQLite/PostgreSQL persistence, Google Sheets synchronization, or related project architecture and documentation.
---

# Research Video Clip Workflow

## Establish context

Read `PROJECT_GUIDE.md` completely before changing architecture, behavior, schemas, or milestone scope. Read `outline.md` for the current build order and checklist. Treat the guide as authoritative; update it and the outline when a deliberate decision changes.

Inspect the repository and current changes before editing. Preserve unrelated user work. Identify the active milestone and state the smallest end-to-end behavior the task must prove.

## Protect the core workflow

Preserve these product invariants:

- Open a shared project, resolve its active English transcript from verified local cache or private online storage before generating one, navigate by transcript, and act on a highlighted range.
- Publish newly completed transcript bundles as immutable, checksummed project versions so another authorized workstation can reuse them.
- Let users submit deduplicated multi-video transcription batches to a project and move successful items into `Ready for review` without one failure blocking siblings.
- Keep original-language and English tracks separate and time-linked.
- Record transcript source, version, and timing precision.
- Seek by word timing when exact; otherwise use honest cue/estimated timing.
- Never regenerate completed media or transcript work silently.
- Keep long work persisted, observable, retryable, leased/heartbeat-aware, and safe under at-least-once delivery.

Implement the three selection actions as distinct commands:

- `Queue / log only`: require a visible project, create a logged clip, and start no render.
- `Export + log`: require a visible project, create the logged clip first, then request its render.
- `Export only`: require no project, create a persisted technical export job/request snapshot, and create no project clip, CSV row, or Sheets row.

Never log to a hidden default project. Permit a preselected project only when its name is visible and changeable at the action point.
For either logging action, accept optional multiline usage notes and zero or more reusable project-scoped free-form tags in the same action panel. Persist them atomically with the clip, preserve them through offline sync, and include them in clip search/filter and CSV/Sheets projections. Do not silently attach project tags or notes to `Export only` jobs.

## Work in vertical slices

For implementation tasks:

1. Define the user-visible outcome and failure states.
2. Trace the affected contract, authorization, local/cloud database, object storage, sync, worker, and UI boundaries.
3. Add or update shared schemas before duplicating shapes.
4. Add a migration for every local or cloud persistent schema change.
5. Implement the smallest complete slice through the real boundary.
6. Add fixture-based tests and keep live-provider tests optional.
7. Run the narrow tests, then the relevant broader checks.
8. Manually verify the critical interaction when a UI or media path changes.
9. Update `outline.md` only for work actually completed.

Avoid building isolated UI that cannot reach a real contract, or provider code embedded directly in routes/components.

## Maintain boundaries

- Keep playback behind a YouTube player wrapper.
- Keep caption discovery, media acquisition, speech-to-text, translation, alignment, object storage, job dispatch, and shared catalog access behind provider interfaces.
- Normalize provider output into versioned tracks, segments, and tokens using integer source-video milliseconds.
- Keep the shared catalog authoritative for memberships, project-video links, published manifests/active versions, batches, and synchronized records. Keep object storage authoritative for bundle bytes. Use SQLite as verified cache, offline outbox, FTS store, and local process history.
- Publish through job-scoped staging uploads plus a transactional catalog finalize; never expose partial bundles as ready.
- Require project authorization before reading manifests or issuing short-lived object URLs. Never place AWS credentials or presigned URLs in source control/logs.
- Use stable idempotency keys, expiring worker leases, immutable object keys/checksums, and a duplicate/supersede policy.
- Require a project for every transcription batch. Deduplicate by project, video, transcription profile, source fingerprint, provider/model, and schema version.
- Require `project_id` on logged clip records. Permit an export job without a clip/project only when its explicit mode is `export_only`.
- Link translated/original content by time, not matching array indexes.
- Store export bounds separately from transcript selection bounds.
- Shift exported subtitle timestamps to clip-relative zero without mutating source transcript timing.
- Invoke external tools with argument arrays and validate every path/filename.
- Bind local services to loopback and keep credentials out of source control/logs.

## Validate by task type

For transcript work, test shared-first resolution, source precedence, cache/manifest identity, checksum/schema verification, transactional finalization, second-workstation reuse, timing precision, bilingual preservation, authorization, and failure recovery.

For batch work, test preflight deduplication, existing transcript reuse, sibling failure isolation, concurrency limits, state/review transitions, duplicate delivery, expired lease recovery, pause/resume, cancellation boundaries, and retry.

For selection work, test DOM/token mapping, cue-only behavior, export padding, project enforcement, atomic note/tag persistence for both logging actions, and all three action effects.

For export work, use a small authorized local fixture. Verify media duration/codecs, subtitle trimming and zero-basing, artifact names/hashes, idempotent retry, and atomic completion.

For integrations, test stable-ID reconciliation, optimistic versions, outbox replay, field ownership, duplicate requests, conflicts, and offline recovery. Ensure export-only jobs never sync unless explicitly added to a project.

For reviews, report violations of the guide's invariants, data-loss/idempotency risks, timing inaccuracies, security issues around local processes/credentials, missing migrations, and untested failure states before style concerns.

## Handle platform uncertainty

Check current primary documentation before relying on unstable YouTube, AWS/S3/SQS/Batch, identity, Google, browser, FFmpeg, transcription-provider, or library behavior. Record the source and keep the uncertainty isolated behind an adapter. Do not claim arbitrary caption/media access; preserve useful shared transcripts and queue/log behavior when acquisition or export is unavailable.

## Finish work

Finish only after the relevant checks pass or clearly report what could not be run. Summarize the user-visible result, tests, migrations/data compatibility, and remaining risk. Do not mark milestone items complete for scaffolding alone.
