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
- Authenticated transcript-artifact upload bridging for the development-only
  memory object store used by external desktop workers.

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
- A remote worker never attempts to fetch a `memory-upload://` URL directly;
  it sends the exact claimed upload target through the authenticated API, which
  verifies the lease, target, checksum, and bounded bytes before publication.
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

## Completion record — 2026-08-25

### Decisions

- The default acquisition hierarchy remains verified shared transcript,
  downloadable YouTube manual caption, downloadable YouTube automatic caption,
  and only then configured local speech recognition. Whisper is the recovery
  path for captionless or unusable-caption sources, not the ordinary path.
- Batch removal is a soft archive. Audit records and direct-ID reads remain
  intact, while archived batches disappear from the ordinary list.
- A verified-artifact preflight result is authoritative through insertion so a
  stale database pointer cannot silently turn queued recovery back into
  `existing-transcript`.
- Empty, timed YouTube WebVTT transition cues are ignored when the document has
  readable cues; an entirely empty caption remains invalid.
- Republished caption transcripts allocate the next lineage version instead of
  colliding with an earlier Whisper transcript at version 1.

### Implementation

- Added versioned cancel-all/archive controls, exact-video transcript retry,
  Logged-destination isolation, and a persisted accessible transcript divider
  across the shared contracts/catalog/API and web workspace.
- Added authenticated development upload/download proxying for transcript
  artifacts and stale-pointer recovery for the memory-backed development
  object store.
- Hardened WebVTT normalization and transcript revision allocation, with
  focused regressions in the cloud API, catalog, worker, sync, transcript, and
  web suites.
- Primary implementation files include `apps/cloud-api/src/app.ts`,
  `apps/web/src/batch-workspace.tsx`, `apps/web/src/workspace-shell.tsx`,
  `apps/worker/src/pipeline.ts`, `packages/catalog/src/index.ts`,
  `packages/contracts/src/index.ts`, `packages/sync/src/index.ts`, and
  `packages/transcript/src/index.ts`.

### Verification

- `npm run typecheck` passed.
- The focused stale-pointer cloud API regression passed.
- The focused catalog claimed-finalization/revision regression passed.
- Worker and transcript suites passed: 49 tests.
- Formatting and `git diff --check` passed.
- The packaged macOS app loaded YouTube video `-78bl92WZHY` from the manual
  `en-US` track (`manual-target-language`) and published transcript version
  `f8e9c5c6-acc5-8998-aee7-65e0b24b4fef` without Whisper.
- The packaged app also loaded `sJfHiHXGNE8` from the automatic `en-orig` track
  (`automatic-target-language`) and published a review-ready transcript without
  Whisper.
- On the Lobsang transcript, exact-text search for `love` advanced to `2 of 13`;
  clicking the visible `2:08` cue moved playback to `2:08` and reported
  `Cue requested 2:08.`
- The transcript panel was widened to 60% through the persisted resize control.
- A disposable live batch was canceled with `cancel_all`, archived, and then
  confirmed absent from the ordinary batch list.
- The app was left open on the working Lobsang transcript after verification.

### Remaining risk

- The low-cost development backend uses an in-memory object store. Restarting
  that backend discards artifact bytes while durable metadata remains; the new
  recovery path requeues the transcript, but production should use the planned
  durable S3 object store.

### Commits

- `29c55b5` — Fix transcript retry and batch workspace cleanup
- `6ffb623` — Proxy development transcript artifact uploads
- `ca74e6d` — Proxy development transcript artifact downloads
- `93aae3a` — Reprocess unavailable active transcripts
- `5b70ca7` — Route transcript downloads through desktop proxy
- `efa93e2` — Queue recovery for stale transcript pointers
- `10a0976` — Accept empty YouTube caption transition cues
- `44ed5a9` — Version revised caption transcripts correctly
