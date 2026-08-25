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
