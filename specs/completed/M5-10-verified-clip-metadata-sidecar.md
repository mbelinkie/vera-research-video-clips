# M5-10 — Verified clip metadata sidecar

- Status: active
- Task/thread: M5-10 only

## User-visible outcome

Every newly promoted local clip package contains a descriptive
`clip-<export-request-id>.json` sidecar beside its verified MP4, required
language-policy SRTs, and `manifest.json`. The metadata describes the immutable
video/selection/export snapshot without becoming a second artifact-hash record.
It is written in attempt-private staging and becomes visible only through the
existing copy-then-atomic-rename package promotion.

## Focused context

Reuse M5-01 source cleanup, M5-02 resolved bounds, M5-03 rendered-media
validation, M5-04–M5-06 subtitle-policy validation, M5-07 package promotion,
M5-08 runtime composition, and M5-09 manifest provenance. Limit this slice to
the shared export contract, local final-artifact role/migration, promotion
path, and focused tests.

## In scope

1. Add `ExportClipMetadataSchema` schema version 1 and one
   `clip_metadata_json` final-artifact role.
2. Describe only immutable request snapshot values and persisted validation
   provenance: package/request/job identity, source attempt and validation
   time, safe video identity, source-language class, selection snapshot,
   resolved bounds/rendered duration, resolved preset, and subtitle policy plus
   snapshotted subtitle track identities where present.
3. Use one shared resolved-subtitle-policy schema for the metadata and M5-09
   manifest contracts.
4. Stage and hash metadata before building the manifest; include its filename,
   byte size, and SHA-256 in the manifest artifact array. Metadata never names
   its own hash and the manifest never names its own hash.
5. Require all newly promoted packages to contain video, metadata, and manifest:
   3 files for confirmed-English omission, 4 for confirmed-English with SRT,
   and 5 for bilingual policy.
6. Add local migration `0014` (after PL-01's `0013`) that atomically rebuilds
   `export_final_artifacts` to widen its role CHECK while preserving existing
   rows and its request/attempt index unchanged.

## Durable URL/privacy decision

Package records may include only the immutable canonical public YouTube watch
URL from the request video snapshot as video identity. Acquisition, presigned,
provider, local-file, command-derived, and other locator URLs remain forbidden
in package records, SQLite provenance, logs, and CLI output. This resolves the
M5-09 wording conflict without changing its schema-version-1 manifest shape.

## Explicit non-goals

- Reacquiring or rerendering media; transcript lookup, subtitle derivation or
  substitution, and changing subtitle policy.
- Thumbnail generation, preset/UI work, logged/cloud delivery, retry/grouping,
  scratch sweeping, embedded/burned subtitles, or preferred-language subtitle
  sidecars.
- Persisting absolute paths, commands, credentials, raw tool output, source
  locators, subtitle cue text, or any URL other than the canonical public watch
  URL above.
- Rewriting or invalidating packages completed before this slice.

## Failure states

- Metadata schema/serialization/staging failure, any staged/promoted hash
  mismatch, cancellation, or final-provenance persistence failure removes the
  attempted package and follows the established source/staging cleanup path.
- Source-cleanup failure remains `needs_user_action`, never `complete`, even
  when the atomically promoted package is otherwise valid.
- Existing completed requests remain readable without metadata; new promotion
  under this code fails closed if metadata cannot be included.

## Acceptance criteria

1. All three subtitle policies produce exact package cardinalities and a valid
   `clip-<id>.json` plus `manifest.json` atomically.
2. Metadata validates against its schema, has only approved snapshot/provenance
   content, and contains no paths, commands, source/provider locators, raw
   subtitle text, or forbidden URL.
3. The manifest names metadata with the promoted byte size/hash; the database
   records `clip_metadata_json` alongside all other roles.
4. Metadata-stage failure, metadata tampering after rename, cancellation, and
   final-provenance failure leave no partial package and preserve source cleanup.
5. Migration from `0013` preserves legacy artifact rows unchanged, rejects
   unknown roles, and accepts the metadata role.
6. The real FFmpeg/FFprobe fixture asserts the five-artifact bilingual package,
   validates metadata/manifest, and verifies every package byte/hash.

## Verification plan

1. Run focused contract, local DB, export processor, and runtime fixture tests.
2. Run local migration validation and the relevant broader checks.
3. Review the complete diff and `git diff --check`.

## Documentation constraint

`PROJECT_GUIDE.md` and `outline.md` contain unrelated uncommitted work owned by
another task. Do not edit or commit either in this slice; root will reconcile
their durable checklist/status updates after this completion record.

## Completion record

### Decisions made

- `clip_metadata_json` is a distinct final-artifact role. New packages contain
  exactly video + metadata + manifest (English omission), add English SRT
  (confirmed English), or add original and English SRTs (foreign/mixed/unknown).
- Metadata is staged and hashed before the manifest. The manifest names the
  metadata hash; neither JSON file names its own hash. Existing pre-M5-10
  manifests remain schema-valid without metadata, while new promotion requires
  the metadata role before final provenance can persist.
- Package video identity accepts only the immutable canonical public
  `https://www.youtube.com/watch?v=<video-id>` URL. Acquisition, presigned,
  provider, local-file, and command-derived URLs stay excluded.
- Migration `0014_export_clip_metadata_sidecar` rebuilds the local child table
  after PL-01's `0013`, preserves rows/indexes, and widens only the role CHECK.

### Files changed

- Shared export contract and contract tests.
- Local export processor/runtime fixture tests.
- Local final-artifact provenance validation, migration `0014`, and migration
  tests.
- This completion record. `PROJECT_GUIDE.md` and `outline.md` were deliberately
  not edited because their uncommitted changes are owned by another task.

### Checks and actual results

- Focused contracts/local DB/export processor/runtime suite: 37 passed.
- Local migration validation: 14 newly applied.
- Full unit suite, run in two deterministic Vitest shards to retain complete
  output: 151 passed, 1 optional AWS test skipped.
- Web production build: passed.
- Cloud migration validation: 9 newly applied.
- Playwright browser suite: 4 passed after allowing its loopback test server;
  the initial sandboxed invocation was blocked from binding `127.0.0.1`.
- `git diff --check`: passed.

### Compatibility and remaining risks

- Existing completed packages and M5-09 manifests are not rewritten or made
  invalid; new promotions require metadata and fail closed if it cannot stage,
  verify, or persist.
- The sidecar deliberately does not add thumbnail generation, cloud/logged
  delivery, presets, retries, grouping, sweeping, or preferred-language
  subtitles. Per-track subtitle timing precision remains the M5-09 follow-up.

### Commit ID(s)

- `2323a0f` — `feat: add verified clip metadata sidecar`
