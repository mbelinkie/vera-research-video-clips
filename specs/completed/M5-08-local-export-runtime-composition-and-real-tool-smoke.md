# M5-08 — Local export runtime composition and real-tool smoke

- Status: completed
- Task/thread: M5-08 only

## User-visible outcome

A developer can explicitly process one persisted local `export_only` request
with a one-shot command. Each run requires the request ID and a fresh
authorization confirmation, composes the verified M5-01–M5-07 boundaries, and
reports a concise sanitized outcome only after package verification and source
scratch cleanup.

## In scope

1. Add `export:run-once`, a loopback-independent local CLI that accepts exactly
   one request ID and an explicit authorization-confirmation flag.
2. Compose `LocalExportSourceProcessor` with `LocalExportQueue`, the configured
   full-source provider, real FFprobe/FFmpeg adapters, and the configured data
   root. Do not duplicate its lifecycle.
3. Return only request state, safe error code/message, package identity, and
   artifact roles/byte sizes/hashes. Never print source URLs, paths, command
   arguments, credentials, presigned data, or subtitle text.
4. Add a deterministic real-tool integration test using the repository-owned
   `synthetic-4s.mp4` fixture and a narrowly scoped provider that copies it
   into the private attempt directory. Verify installed FFmpeg and FFprobe
   before exercising them.

## Explicit non-goals

- Logged/cloud export delivery, HTTP/background processing, polling,
  concurrency, grouping, retry UI, cleanup sweeping, presets, metadata,
  thumbnails, embedded subtitles, or any project/CSV/Sheets integration.
- Any live YouTube or yt-dlp smoke test without separately supplied explicit
  source authorization.

## Failure states and acceptance

- Missing CLI confirmation exits nonzero before opening media tools; a runtime
  invocation with confirmation false persists actionable state and invokes no
  acquisition/inspection/render tool.
- A completed request is reported as already complete and is never rendered or
  overwritten again.
- Runtime failure is nonzero, sanitized, persisted, and leaves no partial final
  package. Cleanup failure remains the reported actionable outcome.
- The real fixture proves a playable H.264/AAC MP4, resolved-duration tolerance,
  required bilingual SRTs, clip-relative ordered cue timing, persisted hashes
  and byte sizes, atomic final package visibility, and absent source/render
  scratch.

## Completion record

- Decisions made: Kept all media lifecycle behavior in
  `LocalExportSourceProcessor`; the runtime only opens/migrates the configured
  local database, composes its existing queue/provider/FFprobe/FFmpeg
  dependencies, and invokes one named request. Completed requests short-circuit
  before any provider/tool construction or invocation. The CLI requires both
  `--request-id` and `--authorization-confirmed`, emits JSON without source or
  filesystem details, and returns nonzero for invalid input or runtime failure.
- Files changed: `apps/local-agent/src/export-run-once.ts` and its real-tool
  integration test; root `package.json`; `.env.example`; `PROJECT_GUIDE.md`;
  and `outline.md`.
- Checks run and actual results: `npx vitest run
apps/local-agent/src/export-run-once.test.ts`: 1 passed; focused local-agent,
  media, transcript, contracts, and local-DB suite: 58 passed; `npm run check`:
  130 passed, 1 skipped, web build passed, local/cloud migrations validated
  with 11/8 newly applied; `npm run test:e2e`: 4 passed; `git diff --check`:
  passed.
- Real-tool smoke: verified `/usr/local/bin/ffmpeg` and
  `/usr/local/bin/ffprobe`, both version 8.1.2, then used them against the
  authorized repository-owned `tests/fixtures/media/synthetic-4s.mp4` through
  a fixture-only source provider. It produced a three-second H.264/AAC MP4
  plus exact original-language and English SRTs, checked clip-relative timing,
  persisted byte/hash provenance, package visibility, replay behavior, and
  source/render scratch cleanup. No live YouTube or yt-dlp test ran.
- Remaining risks/follow-ups: This is local `export_only` processing only.
  Logged export jobs still lack local/cloud delivery, and live provider
  acquisition remains opt-in and must be explicitly authorized. Manifests,
  thumbnails, presets, retries, grouping, sweeping, and the full Milestone 5
  release acceptance path remain unimplemented.
- Commit ID(s): reported in the task handoff after the required M5-08 commit.
