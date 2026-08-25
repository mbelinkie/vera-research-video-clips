# BUG-DOGFOOD-003 — Batch removal and caption retry

## User-visible outcome

Researchers can cancel obsolete transcription batches and remove their terminal
history from the normal batch list. From an empty transcript view, `Retry
transcript` retries the selected video's failed retryable job instead of merely
reloading the same missing transcript response. A retried YouTube job reuses a
downloadable caption before Whisper. The Logged destination contains only
logged-clip work, while the Review transcript/player split has a directly
draggable, keyboard-accessible divider.

## Affected boundaries

- Shared batch contracts, catalog persistence, cloud API routes, and migration.
- Batch list/detail controls and the selected-video transcript retry action.
- Destination isolation and the persisted Review transcript-panel width.
- Caption-first worker regression coverage and the packaged desktop runtime.

## Focused evidence

- Project `Bhutan 26` has four visible manual batches with no queued or active
  items; failed, blocked, and action-needed items remain visible after the user
  tries to clean up old work.
- The Lobsang Phuntsok batch item for YouTube video `-78bl92WZHY` is retryable
  failed with `whisper.cpp returned an invalid transcription segment at index
222.`
- That job ran before the YouTube WebVTT header parser fix. Its valid caption was
  rejected, so the old worker fell back to Whisper.
- The current `Retry transcript` button only increments a local reload counter;
  it never invokes batch retry.

## Non-goals

- Physically deleting batch/job audit records or completed transcript versions.
- Canceling active shared work without the existing safe worker checkpoint.
- Changing source precedence, translation policy, or language-confirmation
  authority.
- Automatically retrying failed work without an explicit researcher action.

## Failure states

- A batch with queued, active, canceling, or non-canceled items cannot be removed
  from the normal list; the UI must direct the researcher to cancel it first.
- Removing a batch is an idempotent soft archive and preserves all durable audit
  rows and direct-ID access.
- Transcript retry reports when no retryable failed item exists for the selected
  video and never retries a different video.
- A retry conflict refreshes current state rather than creating duplicate work.

## Acceptance criteria

- Canceling a terminal or unstarted batch leaves no live item and exposes
  `Remove from list`.
- Removing a terminal batch persists in the shared catalog and excludes it from
  ordinary batch listing without deleting its detail/audit record.
- `Retry transcript` locates the selected video's exact retryable failed batch,
  sends `retry_failed` with the current version, and shows queued progress.
- The exact `-78bl92WZHY` retry selects and normalizes the downloadable YouTube
  caption and publishes an active English transcript without invoking Whisper.
- Focused catalog/API/UI/worker tests, migrations, type checking, formatting,
  desktop build, and a packaged-app smoke test pass.
- Logged never renders transcription batch creation, history, or controls.
- The Review transcript panel can be widened from the divider or Layout slider;
  its width persists, and the divider supports arrow/Home/End keys.

## Narrow checks

1. `npm test -- packages/catalog/src/index.test.ts`
2. `npm test -- apps/cloud-api/src/app.test.ts`
3. `npm test -- apps/web/src/transcription-action-batch.test.ts`
4. `npm test -- apps/worker/src/pipeline.test.ts packages/transcript/src/index.test.ts`
5. `npm run typecheck`
