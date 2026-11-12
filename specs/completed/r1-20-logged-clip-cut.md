# R1 / #20 — Cut an authorized logged clip to a local file

- Status: completed for the bounded foreground implementation (2026-11-12); live authorized Mac acceptance remains unverified
- Task/thread: issue #20 only; branch from `origin/main`

## User-visible outcome

A project member can request one or more already logged clips by project and
clip ID, confirm source rights, and receive editing-ready clip folders on the
local machine. A foreground command and a loopback endpoint share the same
cutter. Two clips from one video in the same invocation use one temporary
source download; the entire source is deleted before success is returned.

## Boundaries and decisions

- Source of authority: authenticated cloud GET for each project clip; never
  manufacture a queued local export or accept a caller-provided video URL.
- Resolve immutable original/English transcript artifacts from a verified
  project/video bundle, and reject any mismatch to the logged selection's
  exact track ID, numeric version and source video. A newer active transcript
  does **not** silently replace the logged version.
- Precisely re-encode logged **export** bounds to H.264/AAC MP4; retain the
  independent speech/selection bounds. Required SRT sidecars use those same
  export bounds, clamp and shift timestamps to the new clip's zero. Confirmed
  English requires English; foreign/mixed/unknown requires original + English.
- Group equal trusted source IDs _within one active invocation_ only; a later
  request may redownload. Never retain a full-source cache.
- Use opt-in yt-dlp and FFmpeg/FFprobe through validated argument arrays,
  protected temporary directories and injectible seams. Stage/verify package
  contents before promotion; verify source deletion before returning success.
- Output is under configured local `DATA_DIR/exports` with fixed safe names,
  not a client-specified path. Return per-clip output identity and small local
  manifest with track IDs, version, bounds and artifact hashes.

## Failure states

- Missing/invalid authentication, wrong project/clip, unconfirmed rights or
  conflicting source identity: fail before source acquisition.
- No exact logged transcript track/version, missing required original or
  English normalized artifact, corrupt cached bytes, or unconfirmed language:
  refuse instead of synthesizing subtitles from an unrelated track.
- Disabled/inaccessible provider, bad download, unsafe path, source shorter
  than requested bounds, FFmpeg failure, nonconforming output, or output
  collision: do not report a completed package.
- Any source cleanup failure overrides an otherwise rendered output; never
  claim success while full-length media is retained.

## Non-goals

Desktop UI, cloud workers/storage, durable leases and export queue changes,
Google Sheets, presets, source media caching between independent requests,
Resolve and the archived M7 local supervisor. Do not merge the archived
`codex/vera-pilot-checkpoint` branch.

## Acceptance and staged verification

1. Pure English and bilingual SRT tests prove strict overlap, padded cut
   bounds, zero-relative time, clamping, no source mutation and invalid bounds
   refusal. Verified cached original/English reader tests reject missing,
   changed, wrong-video, wrong-track and wrong-version artifacts. Run focused
   transcript/sync tests and `npm run typecheck` in phase 1.
2. Injected media/cutter tests prove rights-first acquisition, one source for
   two siblings, safe staging, output validation and mandatory deletion on
   success/error/cancellation (phase 2).
3. CLI and loopback route tests prove authenticated project clips, bounded
   request shape, disabled-provider failure and unchanged `POST /api/exports`
   queueing (phase 3).
4. Run `npm run check`, targeted guard mutation tests, safe local fixture and
   optional explicitly authorized Mac audible-boundary playback check; record
   actual results and remaining limitations. Complete spec only then (phase 4).

## Phase 1 evidence

On the isolated Linux pipeline worktree:

- `vitest run packages/transcript/src/index.test.ts packages/sync/src/index.test.ts --maxWorkers=1`:
  2 files, 32 tests passed.
- `npm run typecheck`: passed (`tsc --noEmit`).
- `git diff --check`: passed; changed files formatted with Prettier.
- `npm run check`: passed. Format, typecheck, 174 passing tests (4 explicitly
  skipped), production Vite build, 4 local and 8 cloud migrations valid.
- Reversible mutation proof: forcing the exact logged-track ID/version
  comparison to false made the focused wrong-track test fail with the expected
  assertion; original code restored, with no remaining source diff.

Subsequent phases will update this spec with their own verified evidence
before completion. No network video or Resolve check was attempted in phase 1.

## Phase 2 evidence

- Added distinct **opt-in** yt-dlp full-MP4 acquisition, FFprobe media
  inspection, and exact-range FFmpeg H.264/AAC rendering ports; existing
  transcription/audio acquisition remains separate. Spawned commands use
  no shell, bounded output, timeout, cancellation and credential/URL error
  sanitization. Scratch and output files reject symlinks and hardlinks.
- Added an injected foreground cutter that authorizes and pins every requested
  clip/track before acquiring media, groups one active acquisition per source,
  rejects overlong cuts or wrong codecs, stages hashed MP4/SRT/manifest
  artifacts in private directories, refuses overwrites and promotes validated
  packages. It removes/validates absence of full-source scratch on all normal
  success/error paths; a cleanup error **rejects** the entire call.
- `npx vitest run packages/media/src/index.test.ts apps/local-agent/src/clip-cutter.test.ts --maxWorkers=1`:
  17/17 passing (two same-source clips / one fetch; different sources;
  authorization/rights/version/bounds; English/Spanish SRTs; no leftovers
  after failure; cleanup failure not success; output collision; timeout).
- `npm run typecheck`: passed. `git diff --check`: passed.
- `npm run check`: passed, including Prettier, typecheck, 189 passing tests
  (4 intentionally skipped), web build, four local and eight cloud migrations.
- A temporary authorization-guard mutation replacing `z.literal(true)` with
  `z.boolean()` made the rights-refusal test fail; the original guard was
  restored before the passing full suite. No authorized live video, real
  tool execution, or Mac playback has been attempted in phase 2.

Phase 3 will compose these ports with authenticated cloud catalog and verified
cache readers, then expose the CLI and loopback endpoint. A separate later
request may redownload: no cross-invocation full-source cache is retained.
If source cleanup fails **after** verified promotion, the package may remain
for operator recovery but the API must not report success or overwrite it.

## Phase 3 evidence

- Commit `7033ca3` added the CLI, loopback POST route, registered project-member
  cloud clip fetch and verified cached-transcript composition, separate
  disabled-by-default full-source configuration, tests and README instructions.
- Focused CLI, route and runtime checks passed (38 tests prior to the final
  route assertion). `npm run check` passed: 203 tests, 4 skipped, Vite build,
  4 local and 8 cloud migrations.
- The disabled-provider CLI was invoked with fixed IDs; it exited nonzero with
  one actionable sentence instead of acquiring media.

## Phase 4 evidence and completion record

- Recovered a clean worktree on `7033ca3`; no usable uncommitted changes or
  abandoned phase-4 handoff existed.
- `npx vitest run packages/transcript/src/index.test.ts packages/sync/src/index.test.ts packages/media/src/index.test.ts apps/local-agent/src/clip-cutter.test.ts apps/local-agent/src/clip-cut-runtime.test.ts apps/local-agent/src/clip-cut-cli.test.ts apps/local-agent/src/app.test.ts --maxWorkers=1`: **65 tests passed** in 7 files before the added regression case.
- `CI=1 npm run check`: **passed twice**, including Prettier, TypeScript,
  **203 tests passed / 4 skipped** before the extra regression and **204 passed
  / 4 skipped** on the final full gate, Vite web build, 4 local migration
  applications and 8 cloud migration applications.
- Added a regression test proving a cleanup callback that _returns successfully
  without deleting source_ must still reject the call; `npx vitest run
apps/local-agent/src/clip-cutter.test.ts --maxWorkers=1`: **10/10 passed**.
  Commit `5e4300c` records this test.
- Reversible, one-at-a-time mutations of the bearer guard, exact English track
  version guard, no-overwrite pre-acquisition guard and verified-source-deletion
  guard made their targeted fake tests **fail in all four cases**. Each original
  guard was restored, and the focused cutter suite passed afterward. Transcript
  artifact/manifest integrity is also covered by the 9 sync tests; no mutations
  remain in the worktree.
- **Mac tool check:** The isolated Mac workspace exposed `ffmpeg`, `ffprobe`
  and `yt-dlp`, but launching its `ffmpeg` binary exited 134 because macOS
  Seatbelt blocked loading `libvmaf.3.dylib`. The Linux worktree has no usable
  FFmpeg/FFprobe binaries. The Mac sandbox is network-denied, and no registered
  member bearer, rights-cleared logged clip IDs or independently authorized
  source were supplied. **No real yt-dlp source fetch, two-clip FFprobe smoke,
  native playback or first/last audible-word check is claimed.** Those are
  required for later producer-side real-source acceptance; do not infer them
  from injected media fakes.

### Implementation decisions and limits

- Authenticated logged clip lookup precedes any download. Exact verified
  transcript evidence, export bounds and required languages are pinned; a
  newer active version is not silently substituted. One invocation shares one
  ephemeral acquisition per source, while a later invocation may redownload.
- Completed MP4/SRT/manifest bytes are verified and output folders refuse
  overwrite. No successful response is emitted until source scratch deletion
  is independently verified. A previously promoted clip can remain after a
  different clip fails or cleanup fails, for manual recovery; a subsequent
  invocation refuses to overwrite it.
- This is a bounded **foreground** path, not the full queued M5 worker,
  resumable crash sweeper, new editor UI, arbitrary source provider or cloud
  export/preset system. `outline.md` leaves those broader milestone checks open.
- Implementation files: `apps/local-agent/src/{app,main,clip-cut-cli,clip-cut-runtime,clip-cutter}*`,
  `packages/{config,media,sync,transcript}/src/*`, `.env.example`, `README.md`
  and `package.json`. Commits: `197a1b8`, `853bc52`, `c0ffe7c`, `7033ca3`,
  `5e4300c` (plus the final completion-record commit).
