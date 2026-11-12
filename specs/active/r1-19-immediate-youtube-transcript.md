# R1 #19 — Immediate real YouTube transcript

## User-visible outcome

From the existing Research browser workspace, Matthew can run one documented local
command, paste an authorized YouTube URL into the existing input, see a real
caption-derived or locally recognized English transcript, and click it to seek.
When the video is unavailable or recognition is not configured, show one short,
safe, actionable sentence instead of demo text or an indefinite spinner.

## Boundaries and implementation slices

- Phase 1: Pure single-video adapter for the existing batch request, item-stage
  reporting, and immutable verified transcript response; deterministic tests.
- Phase 2: One-command private loopback runtime, project bootstrap, worker
  supervision, and safe signed-object storage across processes. Keep credentials
  out of browser JavaScript and require origin/CSRF protection.
- Phase 3: Existing workspace input submits and polls the exact one-item batch,
  resolves the authenticated project transcript, and cancels stale async UI
  updates on video/project changes. Preserve selection, search, and queue UX.
- Phase 4: Local provider fallback and worker lifecycle; real caption/ASR/error
  pipeline fakes, signed HTTP publication, safe runtime documentation and a
  separately authorized local Mac smoke test.
- Phase 5: Full gate, critical security/integrity guard mutation checks,
  real-source acceptance evidence, self-review, and PR handoff.

Use the existing `CreateTranscriptionBatchRequestSchema`,
`TranscriptionBatchItemSchema`, and `NormalizedTranscriptSchema`. Batch creation
may immediately reuse an active transcript or enter a queued worker path. A
catalog video UUID is never interchangeable with a YouTube video ID; the
published version must match the exact active version and English track.

## Failure and recovery states

- Unsupported URL or unavailable metadata: safe terminal sentence.
- Captionless video: use opted-in local ASR; otherwise report missing recognizer.
- Worker missing/failing, blocked or canceled item: visible terminal/actionable
  status and retry where supported; never show raw worker stderr or filesystem paths.
- Missing active version or mismatched video/version: reject verified response;
  do not show a successful or fixture transcript.
- Source/project switched during polling: discard stale results, preserve
  project authorization and never attach content to the wrong video.

## Non-goals

No redesign, desktop shell, colleague sign-in, new recognizer provider, hosted
transcription/translation billing, or new word-exact alignment (#47). Preserve
the source-reported auto-caption starts/derived ends from #46 and cue timing
when that is all the source has. No unrelated changes to exports or database.

## Acceptance checks

Phase 1: `npx vitest run --maxWorkers=1 apps/web/src/immediate-transcript.test.ts`
and `npm run typecheck`, including canonical URL, all stage/error states,
missing IDs, mismatched version/video/track and fake successful verified
response. Later phases: focused worker/API/browser/security suites, Playwright
workspace checks, `npm run check`, and on-Mac authorized captioned, captionless,
unavailable-source and restart smoke checks. Do not treat fixture tests as real
YouTube/recognition evidence or mark this spec complete until all required
integration evidence exists.
