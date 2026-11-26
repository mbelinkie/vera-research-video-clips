# LANGUAGE-PROVIDER-002 — Amazon Transcribe provider adapter

- Status: completed
- Date authorized: 2026-08-26

## User-visible outcome

The backend can run one authorized job-scoped audio input through Amazon
Transcribe behind the shared provider registry and return a canonical
word-timed transcript. Replayed delivery recovers the same provider operation
without starting a second paid cloud job, and terminal operation artifacts are
removed before a result or failure is surfaced.

## Affected boundaries

- `packages/providers`: Amazon Transcribe adapter, private S3-operation
  abstraction, durable PostgreSQL store, registry factory, and deterministic
  tests.
- `apps/worker`: opaque provider resolution, authorized local-media staging,
  and whole-source Whisper fallback.
- `packages/db-cloud`: provider-private recovery state whose SDK identities do
  not enter generic jobs or API descriptors.

## Explicit non-goals

- Amazon Transcribe live calls, direct source URLs/YouTube access, public object
  access, or automatic transfer to another cloud provider.

## Failure states

- Unsupported input path/format or a source URL fails before any S3 or
  Transcribe request.
- Provider failure, malformed output, or cleanup failure discards partial
  output, attempts all terminal cleanup operations, and emits only a sanitized
  generic execution error suitable for a higher layer to rerun the whole source
  through Whisper.
- Existing operation identity recovers/polls rather than submitting another
  provider job; job names remain deterministic and opaque.

## Acceptance criteria

1. The shared registry can enumerate an `amazon-transcribe` transcription
   factory whose safe descriptor permits only `object_uri` and `direct_upload`.
2. Injected S3 and Transcribe seams stage private job-scoped input/output,
   submit/poll/recover one idempotent job, and never pass SDK output through the
   generic provider interface.
3. Completed JSON becomes a canonical word-timed `SpeechToTextProvider`
   transcript with provider/model provenance.
4. Success, provider failure, malformed output, and cleanup failure all make
   best-effort terminal deletion of input, output, and provider job; partial
   output is never returned.
5. Deterministic fixtures cover duplicate delivery/recovery, word timing,
   source-URL rejection, all terminal cleanup paths, and sanitized failures.

## Narrow verification first

- `npm exec vitest run packages/providers/src/speech-aws-transcribe.test.ts packages/providers/src/language-service-registry.test.ts`
- `npm run typecheck`
