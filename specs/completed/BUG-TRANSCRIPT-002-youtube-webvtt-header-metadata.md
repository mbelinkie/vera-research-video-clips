# BUG-TRANSCRIPT-002 — YouTube WebVTT header metadata

## User-visible outcome

A downloadable YouTube caption whose WebVTT header contains metadata lines such
as `Kind: captions` and `Language: en-US` is normalized and reused instead of
silently falling back to Whisper.

## Affected boundaries

- WebVTT parsing and canonical transcript normalization in `packages/transcript`.
- Caption-first worker composition in `apps/worker`, verified without changing
  its existing provider or fallback contracts.

## Focused evidence

The authorized dogfood video `-78bl92WZHY` produced a valid downloaded VTT whose
header begins with `WEBVTT`, `Kind: captions`, and `Language: en-US`. The current
parser treated those header metadata lines as the first cue and threw
`WebVTT cue 1 has no timing line`; the worker then recorded
`caption-acquisition-failed` and launched Whisper.

## Non-goals

- Changing caption-source precedence or the speech-to-text fallback policy.
- Persisting provider error details or changing cloud/local schemas.
- Retrying, canceling, or mutating the already-running dogfood job.
- Adding live YouTube access to the deterministic test suite.

## Failure states

- Invalid WebVTT signatures, cue timings, empty cues, and empty documents remain
  rejected through the existing bounded non-retryable normalization error.
- Header metadata must not become transcript text or a synthetic cue.

## Acceptance criteria

- A synthetic YouTube-shaped VTT with header metadata normalizes to the expected
  cue-timed English track.
- Caption-first worker execution with that VTT does not acquire audio or invoke
  speech recognition.
- Existing WebVTT normalization, provider, and worker tests remain green.
- Type checking and formatting for the changed files pass.

## Narrow checks

1. `npm test -- packages/transcript/src/index.test.ts`
2. `npm test -- apps/worker/src/pipeline.test.ts`
3. `npm test -- packages/providers/src/index.test.ts`
4. `npm run typecheck`

## Verification record

- Implementation commit: `529ef92` (`Complete desktop dogfood and transcript workflows`).
- The exact downloaded caption for YouTube video `-78bl92WZHY` normalized to
  272 cue-timed segments and 4,278 tokens without media acquisition or Whisper.
- Focused transcript, worker, and provider tests passed; the aggregate verified
  worktree passed 691 unit/integration tests with four declared skips, 23/23
  Playwright tests, local and cloud migration suites, type checking, formatting,
  shell syntax checks, and the desktop production build.
- A fresh x64 desktop package was built and launched from the implementation
  commit. Its packaged local agent returned `status: ok`; the app bundle is at
  `out/Research Video Clips-darwin-x64/Research Video Clips.app` and the packaged
  `app.asar` SHA-256 is
  `cd3554c000e4fe1b704bbd964237a4c3df5d6146a3b80a6fcb8400d763076c6d`.
