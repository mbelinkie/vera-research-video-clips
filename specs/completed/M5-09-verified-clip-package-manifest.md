# M5-09 — Verified clip package manifest and export provenance record

- Status: completed
- Task/thread: M5-09 only
- Branch: `claude/M5-09-clip-package-manifest` (from `68c9df0`)

## User-visible outcome

After a successful local `export_only` run, the promoted clip package contains
one additional file, `manifest.json`, beside the already verified MP4 and its
required SRT sidecars. It is a machine-readable, human-auditable provenance
record for exactly that clip: source video identity, source-language
classification, the snapshotted subtitle policy, resolved export bounds, the
verified clip duration, the media tool versions used, and for every artifact its
filename, role, byte size, and SHA-256 — plus, for each SRT, its language,
transcript track ID/version, timing precision, and cue count.

The manifest becomes visible atomically with the rest of the package, never as a
later addition. `npm run export:run-once` reports it as a fourth artifact role
with its own size and hash.

## Focused context

Read `PROJECT_GUIDE.md` sections 7.5–7.7 and 15, `outline.md`, and completed
specs M5-01 through M5-08 before editing. Limit work to the export contract, the
local export processor's promotion path, local SQLite provenance plus one
ordered migration, an optional FFmpeg version read in the media adapter, and
focused tests. Reuse the M5-01 scratch lifecycle, M5-02 resolved bounds, M5-03
render validation, M5-04–M5-06 subtitle policy results, and M5-07 promotion
exactly as they are.

## Decisions made for this slice

These two calls were made deliberately during planning. Implement them as
written; do not relitigate them mid-slice.

### 1. Widen the artifact role with a table rebuild, not a second table

`export_final_artifacts.role` carries
`CHECK (role IN ('video_mp4', 'english_srt', 'original_srt'))`. SQLite cannot
alter a CHECK constraint in place, so migration `0012` rebuilds the table:
create the replacement with the widened CHECK, copy every existing row, drop the
old table, rename, and recreate `idx_export_final_artifacts_request_attempt`.

Reasons:

- `export_final_artifacts` is a child table only. It references
  `export_requests`, and no other table references it, so dropping and renaming
  it under `PRAGMA foreign_keys = ON` violates nothing and rewrites no other
  table's foreign-key clause.
- `runLocalMigrations` already wraps each migration file in
  `BEGIN IMMEDIATE`/`COMMIT`, so the rebuild is atomic and rolls back whole on
  any error.
- The alternative — a separate `export_package_manifests` table — avoids the
  rebuild but splits one concept (a promoted package artifact and its
  provenance) across two tables, forcing both `verifyPromotedPackage` and the
  `export:run-once` output to merge two sources for no durable benefit.
- Dropping the CHECK and validating only in application code was rejected: this
  schema uses CHECK constraints heavily and the role vocabulary is exactly the
  kind of closed set they exist for.

The migration must be forward-only and must preserve every existing row's
values unchanged.

### 2. Capture the FFmpeg version and record it in the manifest

`PROJECT_GUIDE.md` section 7.5 step 12 requires a manifest containing
"hashes/tool versions". `ffprobeVersion` is already captured on
`ExportMediaProvenance`; no FFmpeg version is captured anywhere today.

Add a best-effort `ffmpegVersion` read to `FfmpegH264AacRangeRenderer`, mirroring
the existing `FfprobeExportSourceInspector.#readVersion` pattern exactly:
bounded timeout, cancellation-aware, and returning `undefined` rather than
failing a render when the read fails. Persist it on rendered media provenance
via the same migration `0012`, and record both tool versions in the manifest.

Reason: a provenance record that claims a clip is reproducible while omitting
the encoder version is misleading, which is precisely the failure mode section
7.6 and the section 16 risk table exist to prevent. The cost is bounded — one
optional field, one column, and roughly twenty lines mirroring proven code — and
it stays inside this slice's existing boundary.

A missing `ffmpegVersion` must remain legal everywhere: older requests will not
have one, and a version read may fail on a working installation.

## In scope

1. Add `ExportClipManifestSchema` and its type to `packages/contracts`, with an
   explicit integer `schemaVersion` starting at 1.
2. Derive the manifest **only** from the immutable request snapshot and
   already-persisted provenance. No transcript read, no subtitle re-derivation,
   no filesystem discovery beyond hashing the staged artifacts this slice must
   hash.
3. Compute the staged MP4's SHA-256 before promotion so the manifest can name
   it, then assert it equals the hash `verifyPromotedPackage` independently
   computes on the promoted file.
4. Write the manifest into the attempt-private staging or promotion directory
   and promote it through the existing copy-then-atomic-rename path.
5. Extend the final-artifact role vocabulary with `manifest_json` across
   `FinalArtifactProvenanceSchema`, the local schema, and
   `recordFinalArtifactPromotion` validation; raise
   `ExportRequestSchema.finalArtifacts` max from 3 to 4.
6. Extend staged- and promoted-package validation so `manifest.json` is expected
   exactly once and any absence, extra file, or mismatch still fails closed.
7. Add optional `ffmpegVersion` to `RenderedExportMediaProvenanceSchema` only —
   not to the probe-describing `ExportMediaProvenanceSchema` — plus its capture,
   persistence, and manifest recording.
8. Add one ordered local migration `0012` covering both the role rebuild and the
   rendered FFmpeg version column.

## Explicit non-goals

- The descriptive `clip-<id>.json` clip-metadata sidecar and the `.jpg`
  thumbnail. Both are separate later slices; the thumbnail additionally requires
  a new FFmpeg invocation.
- Logged or cloud export delivery, any cloud persistence or migration, CSV, or
  Sheets.
- Presets, preset versions, capability-aware settings, per-export overrides, or
  any UI change.
- Embedded or burned-in subtitles, retries, cancellation UX, progress reporting,
  same-source grouping, or scratch sweeping.
- Reacquiring source media, rerendering, transcript lookup, subtitle derivation
  or substitution, or mutating any existing request, bounds, or provenance
  snapshot.
- Persisting or logging any absolute path, source URL, command line, credential,
  raw tool output, or subtitle text.
- Backfilling, rewriting, or invalidating packages promoted before this slice.

## Manifest content

Record at least the following, all copied from existing snapshot/provenance
values rather than recomputed from the outside world:

- `schemaVersion`, export request ID, job ID, mode, package identity
- source video: YouTube video ID, canonical URL, title, channel when present
- `sourceLanguageClass` and, when present, the snapshot's source language
- resolved export bounds (`startMs`, `endMs`, source attempt) and the verified
  rendered clip duration
- subtitle policy: the resolved required-sidecar set, and
  `subtitleSidecarsOmittedReason = "confirmed_english_user_setting"` when a
  confirmed-English omission applied
- tool versions: `ffprobeVersion` and `ffmpegVersion`, each optional
- `artifacts[]`: for each promoted file other than the manifest itself — role,
  filename, byte size, SHA-256; and for each SRT additionally language,
  transcript track ID, track version, timing precision, cue count, and its
  clip-relative start/end milliseconds

The manifest never contains its own hash. Its bytes and SHA-256 are recorded in
`export_final_artifacts` under role `manifest_json`.

## Failure states

- Manifest serialization failure, write failure, or any hash mismatch aborts
  promotion, removes the attempted final package, and continues into the
  established M5-01 cleanup path.
- The manifest is written before the atomic `rename`. Nothing may be added to a
  package directory after it becomes visible.
- Source-cleanup failure remains terminal `needs_user_action`. A manifest can
  never make a cleanup-failed export appear complete.
- A manifest listing a sidecar the resolved policy did not require, or omitting
  one it did, fails promotion.
- For confirmed-English omission the manifest records the omission reason and
  lists no SRT artifact; `assertNoStagedSrtFiles` stays in force.
- Promotion persistence failure still removes the promoted package, exactly as
  M5-07 established.

## Invariants that must not regress

- Fail closed and leave no partial package on every failure path.
- Regenerating from the same immutable request produces a byte-identical
  manifest apart from values that are themselves persisted timestamps. Take
  timestamps from persisted `validatedAt` provenance, not from fresh clock
  reads, so replay is deterministic.
- No secrets, paths, URLs, commands, or subtitle text in the manifest, in
  SQLite, or in any log or CLI output.
- Packages promoted before this slice have no manifest. Verification of a new
  package requires one; nothing retroactively invalidates or rewrites an old
  package.
- Every existing M5-01–M5-08 behavior and test stays green and unmodified in
  intent.

## Acceptance criteria

1. A foreign-language fixture export produces a package containing exactly
   `clip-<id>.mp4`, `clip-<id>.original.srt`, `clip-<id>.en.srt`, and
   `manifest.json`.
2. The manifest validates against `ExportClipManifestSchema`, and every listed
   artifact's byte size and SHA-256 equal the promoted file's actual values.
3. Each SRT entry records the exact transcript track ID, track version,
   language, timing precision, cue count, and clip-relative bounds already
   persisted by M5-04/M5-05.
4. A confirmed-English export without omission yields a manifest listing exactly
   one `.en.srt`.
5. A confirmed-English omission export yields a manifest with no SRT artifact
   and `subtitleSidecarsOmittedReason = "confirmed_english_user_setting"`.
6. An injected manifest-write failure and an injected hash mismatch each leave
   no directory under `exports/`, record an actionable sanitized error, and
   still delete source and render scratch.
7. `export_final_artifacts` holds a `manifest_json` row with its own bytes,
   hash, and attempt; the job reaches `complete` only after verified source
   cleanup.
8. Migration `0012` applies cleanly to a database created at `0011`, preserves
   every pre-existing artifact row unchanged, and is rejected as a whole if any
   statement fails.
9. `export:run-once` prints the manifest role with no path, URL, or subtitle
   text anywhere in its output.
10. The real-tool test drives actual FFmpeg and FFprobe against
    `tests/fixtures/media/synthetic-4s.mp4` and asserts a manifest matching the
    real promoted files, including a captured `ffmpegVersion` when the local
    tool reports one.

## Verification

Narrow first, in this order:

```bash
npx vitest run apps/local-agent/src/export-source.test.ts
npx vitest run packages/db-local/src/index.test.ts packages/contracts/src/index.test.ts
npx vitest run packages/media/src/index.test.ts
npx vitest run apps/local-agent/src/export-run-once.test.ts
```

Then broader:

```bash
npm run db:migrate:local:test
npm run check
npm run test:e2e
```

Manual: inspect one real promoted `manifest.json` and confirm its recorded
hashes against `shasum -a 256` on its sibling files.

## Completion record

### Decisions made

- Both planned decisions were implemented as written. Migration `0012` performs
  the `export_final_artifacts` rebuild (create `export_final_artifacts_0012`
  with the widened `role` CHECK, copy every row, drop, rename, recreate
  `idx_export_final_artifacts_request_attempt`) and adds
  `export_requests.rendered_ffmpeg_version` in the same file, inside the one
  immediate transaction `runLocalMigrations` already opens.
- The manifest is written into the attempt-private staging directory with
  `flag: "wx"`, mode `0o600`, then promoted through the existing
  copy-then-atomic-rename path. Nothing is ever added after `rename`.
- Promotion order: validate the staged media package and hash the MP4 plus every
  policy sidecar, build and validate the manifest against
  `ExportClipManifestSchema`, stage and hash it, copy every artifact into the
  private promotion directory, `rename` it into place, verify the promoted
  package, then assert every promoted artifact's byte size and SHA-256 equals
  the staged digest it was named with. That assertion is what proves the MP4's
  pre-promotion hash equals the hash `verifyPromotedPackage` computes
  independently, and it also covers both SRTs and the manifest itself.
- `FfmpegRangeRenderer` gained an optional `readVersion(signal?)` member rather
  than a changed `render` return type, so every existing deterministic fake
  still satisfies the interface and a missing version stays legal.
  `FfmpegH264AacRangeRenderer.readVersion` mirrors
  `FfprobeMediaInspector.#readVersion` exactly (bounded 5s timeout,
  cancellation-aware, `undefined` on failure), and the processor wraps the call
  so a failed read can never fail an already verified render.
- `recordFinalArtifactPromotion` now requires both `video_mp4` and
  `manifest_json` and accepts 2–4 artifacts, so a new package cannot be recorded
  without its manifest.
- Judgment call worth reviewing: the manifest embeds the request's
  `ClipVideoSnapshot`, which includes `canonicalUrl`. The "Manifest content"
  section explicitly requires the canonical URL, while the invariant list says
  no URLs in the manifest. The explicit content requirement was followed because
  the canonical YouTube URL is a public identifier from the immutable snapshot
  (not an acquisition, presigned, or credential-bearing URL) and the video ID
  already implies it. No URL, path, command, or subtitle text reaches SQLite,
  logs, or CLI output. If the invariant was meant strictly, dropping
  `canonicalUrl` is a one-line follow-up.
- Per-SRT `timingPrecision` is copied from the immutable
  `selection.timingPrecision` snapshot, because M5-04/M5-05 persist no per-track
  timing precision and this slice may not read transcripts. The confirmed-English
  sidecar records `language: "en"`, which the resolver already proves before
  derivation; bilingual sidecars use their persisted per-track language.

### Files changed

- `packages/contracts/src/index.ts` (+ test): `ExportClipManifestSchema`,
  `ExportClipManifestArtifactSchema`, `ExportClipManifestSchemaVersion = 1`,
  `FinalArtifactRoleSchema` with `manifest_json`, `finalArtifacts` max 3 -> 4,
  optional `ffmpegVersion` on `RenderedExportMediaProvenanceSchema` only, and
  the new exported types.
- `packages/media/src/index.ts` (+ test): optional `readVersion` on
  `FfmpegRangeRenderer`, `FfmpegH264AacRangeRenderer.readVersion`, and
  `parseFfmpegVersion`.
- `packages/db-local/migrations/0012_export_clip_package_manifest.sql` (new).
- `packages/db-local/src/index.ts` (+ test): rendered FFmpeg version read/write,
  widened final-artifact role, manifest-required promotion validation.
- `apps/local-agent/src/export-source.ts` (+ test): encoder-version capture,
  policy extension for all three subtitle policies, manifest build/validate/
  stage, staged digests, and the promoted-versus-staged byte assertion.
- `apps/local-agent/src/export-run-once.test.ts`: real-tool manifest assertions;
  `export-run-once.ts` needed no change because it already reports artifact
  roles, sizes, and hashes generically.
- `PROJECT_GUIDE.md`, `outline.md`, and this spec.

### Checks run and actual results

- `npx vitest run apps/local-agent/src/export-source.test.ts`: 19 passed
  (7 failed before implementation).
- `npx vitest run packages/db-local/src/index.test.ts packages/contracts/src/index.test.ts`:
  13 passed (2 files).
- `npx vitest run packages/media/src/index.test.ts`: 13 passed.
- `npx vitest run apps/local-agent/src/export-run-once.test.ts`: 1 passed, using
  real `/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe` 8.1.2 against
  `tests/fixtures/media/synthetic-4s.mp4`.
- `npm run db:migrate:local:test`: "Local migrations valid (12 newly applied)".
- `npm run check`: format check passed, typecheck passed, 138 passed and 1
  skipped across 23 test files (1 skipped file), web build succeeded, local
  migrations 12 newly applied, cloud migrations 8 newly applied.
- `npm run test:e2e`: 4 passed.
- `git diff --check`: clean.

### Manual verification

Ran one real fixture export through `runConfiguredLocalExportOnce` with real
FFmpeg/FFprobe into a temporary data root and inspected the promoted package.
It contained exactly `clip-<id>.mp4`, `clip-<id>.original.srt`,
`clip-<id>.en.srt`, and `manifest.json`. `shasum -a 256` on all four files
matched the manifest's three recorded artifact hashes and the persisted
`manifest_json` row hash exactly:
`41b8a9ec…38ea9f` (MP4, 33792 bytes), `a2746fbf…36aaf` (original SRT, 61 bytes),
`b7797848…2b0bcd` (English SRT, 57 bytes), `6a0d70b0…77afa9` (manifest, 1984
bytes). The manifest recorded `ffprobeVersion` and `ffmpegVersion` `8.1.2`,
`renderedDurationMs: 3000`, bounds 500–3500, `requiredSidecars`
`["original","english"]`, and cue-level timing precision with clip-relative
0–3000 ms bounds. The CLI-shaped result JSON listed four roles with sizes and
hashes and contained no path, URL, or subtitle text. The temporary script and
workspace were deleted afterwards; `git status --short` confirms nothing extra
remains.

### Compatibility impact

- Migration `0012` is forward-only and preserves every existing
  `export_final_artifacts` row unchanged; a dedicated test migrates a database
  to `0011`, inserts a legacy `video_mp4` row, proves the pre-0012 CHECK rejects
  `manifest_json`, forces the rebuild to fail once (name collision) to show the
  migration is rejected as a whole with rows intact, then applies `0012` and
  proves the row is byte-identical, the index exists, `manifest_json` is
  accepted, and an unknown role is still rejected.
- `rendered_ffmpeg_version` is nullable; requests rendered before this slice
  keep a missing `ffmpegVersion` everywhere.
- Packages promoted before this slice have no manifest and are neither rewritten
  nor invalidated. New promotions require one: `recordFinalArtifactPromotion`
  rejects a package without `manifest_json`, so an in-flight attempt started on
  older code cannot record a manifest-less package on new code — it fails
  closed, rolls the package back, and stays retryable.

### Remaining risks and follow-ups

- Per-track subtitle timing precision is still not persisted, so the manifest
  reports the snapshotted selection precision for every SRT. If a future source
  pairs a word-timed selection with a cue-only counterpart track, that entry
  would overstate the counterpart's precision. Persisting per-sidecar timing
  precision is the smallest sensible follow-up.
- Artifact hashing reads whole files into memory, matching the M5-07 idiom; a
  very long clip would hold its MP4 in memory twice per promotion (staged and
  promoted). Streaming hashes are a separate performance slice.
- The promoted-versus-staged byte assertion is exercised end to end by tampering
  with the promoted MP4 between `rename` and verification through a test-owned
  signal; no production seam was added for it.
- Unchanged deferrals: the descriptive `clip-<id>.json` metadata sidecar, the
  `.jpg` thumbnail, logged/cloud export delivery, presets, retries, grouping,
  scratch sweeping, and live YouTube acquisition.

### Commit ID(s)

- Reported in the task handoff after the single required M5-09 commit, which
  is the commit that also moved this spec to `specs/completed/`.
