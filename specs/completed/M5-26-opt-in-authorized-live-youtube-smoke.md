# M5-26 — Opt-in authorized live YouTube smoke

- Status: completed 2026-08-22
- Task/thread: M5-26 only
- Dependencies: completed M5-08 one-shot runtime, M5-21 cancellation/cleanup,
  and M5-25 deterministic foreign fixture gate

## User-visible outcome

An explicitly authorized user can run one representative, rights-cleared public
YouTube source through the established local export executor and receive a
single redacted verification record. The command refuses to contact a provider
unless two authorization flags, a validated external descriptor, the configured
yt-dlp provider, and local tool prerequisites are all present. It deletes the
entire temporary workspace—including full source and produced package—before
returning.

## Smallest end-to-end proof

Given an absolute descriptor outside the repository containing one authorized
11-character YouTube video ID and exact normalized original/English transcript
snapshots for a bounded range, preflight yt-dlp, FFmpeg, and FFprobe without
network access. Seed a fresh temporary local database and immutable export-only
request, then delegate once to `runConfiguredLocalExportOnce`. Verify real media,
both SRTs, manifest/metadata hashes, terminal state, and source-scratch absence.
Delete and verify the whole temporary root absent, then emit only sanitized
roles/hashes, media properties, subtitle bounds, status, and cleanup booleans.

## Decisions and invariants

1. `export:live-smoke` is setup/verification glue around the existing processor,
   not a second executor, queue, provider, retry path, or retained fixture.
2. Both `--authorization-confirmed` and `--live-smoke-authorized` are mandatory
   per invocation. The descriptor also carries an explicit rights-cleared
   attestation. Missing or malformed input fails before any provider call.
3. `--smoke-config` must name one absolute external JSON file outside the
   repository. It contains no credentials, cookies, tokens, or local paths—only
   source identity, bounded range, and exact normalized bilingual tracks.
4. The command requires `EXPORT_SOURCE_PROVIDER=yt-dlp`, validates the
   configured `YT_DLP_PATH`, FFmpeg, and FFprobe locally, and never falls back to
   fixture success. Provider/network unavailability is a truthful blocked gate.
5. The external source range is at least one second and at most 30 seconds.
   Track/video linkage, original/English roles, versions, cue coverage, and
   English-to-original lineage are strict before acquisition.
6. Output excludes video ID/URL/title, request/job/track IDs, descriptor or local
   paths, source identity/checksum, transcript text, raw tool output, credentials,
   tokens, and errors that may contain any of those values.
7. The temporary root is private and is removed on success, block, failure, or
   interruption. A cleanup failure is itself a failed smoke and cannot be
   reported as passed.
8. Normal tests remain network-free. They use injected preflight/executor/
   verifier boundaries and prove no network-capable provider can run without
   every opt-in condition.

## Affected boundaries

- New local CLI/orchestrator and unit tests for parsing, descriptor validation,
  preflight, setup, redacted evidence, and unconditional temporary cleanup.
- Root `export:live-smoke` script and dormant `.env.example` documentation.
- Existing local database/transcript index and one-shot runtime are composed,
  not changed semantically.

## Explicit non-goals

- Hard-coded public source IDs, committed smoke descriptors/transcripts,
  cookies, browser session reuse, credentials, provider fallback, or live calls
  from the normal test suite.
- A new export executor, cloud API, migration, persisted live-smoke history,
  UI, batch/group behavior, M6 Clip Library, or M7 pilot work.
- Declaring Milestone 5 complete without an actually authorized successful live
  run and the subsequent final matrix.

## Acceptance criteria

1. Missing either authorization flag, a non-absolute/in-repository descriptor,
   disabled provider, missing tool, malformed descriptor, invalid video ID,
   invalid/overlong range, mismatched tracks, or absent in-range cues fails
   before the export provider is invoked.
2. The valid path creates one fresh private workspace, indexes only the exact
   descriptor tracks, creates one immutable foreign export-only request, and
   calls the existing configured one-shot executor once with authorization true.
3. Verification requires a completed six-file bilingual package, matching
   manifest/metadata/artifact hashes, conforming FFprobe media, valid zero-based
   in-range SRTs from the exact track versions, persisted completion, deleted
   source evidence, and empty source/render scratch.
4. Success/failure/block output is strict and redacted. It contains only bounded
   codes, artifact roles/sizes/hashes, media properties, subtitle counts/bounds,
   and cleanup booleans; adversarial paths/URLs/tokens/IDs/text never appear.
5. The full temporary workspace is removed and verified absent on every path.
   Cleanup failure prevents a passed result and remains explicitly actionable
   without revealing the path.
6. Normal focused tests use no live source or network. The actual smoke is run
   only after a separate explicit user authorization and external descriptor;
   absent either, M5 remains truthfully blocked at this gate.

## Verification plan

Run focused parser/descriptor/preflight/fake-executor/cleanup/redaction tests,
then formatting, typecheck, full unit/integration tests, web build, both migration
CLIs, `git diff --check`, and Playwright. Only after the user separately supplies
authorization and an external descriptor should `npm run export:live-smoke --
--authorization-confirmed --live-smoke-authorized --smoke-config <absolute>` run.
Record the sanitized result and delete verification; never retain or commit the
descriptor, downloaded source, temporary package, or raw provider output.

## Completion record

### Decisions delivered

- Added one dormant `export:live-smoke` command around the established
  `runConfiguredLocalExportOnce` executor. Both explicit authorization flags,
  an external rights-cleared descriptor, the configured yt-dlp provider, and
  local tool preflight are required before acquisition.
- Kept the descriptor deeply strict and external to the repository, with exact
  original/English track lineage, cue linkage, range coverage, and no secret or
  local-path fields.
- Forwarded one abort signal through acquisition and rendering, awaited
  termination and cleanup for `SIGINT`/`SIGTERM`, verified all promoted bytes
  and transcript-derived SRT cues, and removed the whole private workspace
  before emitting a bounded redacted result.

### Files changed

- `apps/local-agent/src/live-youtube-smoke.ts`
- `apps/local-agent/src/live-youtube-smoke.test.ts`
- `apps/local-agent/src/export-run-once.ts`
- `apps/local-agent/src/export-run-once.test.ts`
- `package.json`
- `.env.example`

No contract or database migration was required.

### Verification evidence

- Network-free focused live-smoke/run-once tests: 17 passed.
- `npm run typecheck`: passed.
- `npm run test`: 268 passed, one declared skip.
- `npm run build:web`: passed.
- `npm run db:migrate:local:test`: 24 migrations passed.
- `npm run db:migrate:cloud:test`: 19 migrations passed.
- `npm run test:e2e`: four Playwright flows passed.
- `git diff --check`: passed.
- After separate user authorization, Homebrew yt-dlp was upgraded from
  `2025.04.30` to official stable `2026.08.19` and the guarded live command ran
  once for an exact 15-second foreign-language range. The sanitized result was
  `passed`: H.264/AAC MP4, 852x480, duration 15,000 ms; six original cues and
  six English cues, each clamped from 0 to 15,000 ms; six independently hashed
  final artifacts; `sourceScratchAbsent: true`; and
  `temporaryWorkspaceRemoved: true`.
- The external descriptor, downloaded caption inputs, isolated release binary,
  full source, rendered package, local database, and smoke workspace were all
  removed after evidence capture. No live source ID, URL, transcript text,
  local path, raw provider output, or credential was retained in the repository.

### Remaining follow-up

Milestone 5 is not yet declared complete. M5-27 must run and record the final
aggregate release matrix over the completed slices and confirm the worktree
contains no unaccounted-for milestone changes.

### Commits

- Implementation and network-free verification: `47d86e7`
- Completion documentation: recorded by the documentation commit that moves
  this spec to `specs/completed/`.
