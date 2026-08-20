# M5-11 — Verified clip thumbnail artifact

- Status: completed
- Task/thread: M5-11 only

## User-visible outcome

Every newly promoted local clip package contains one verified JPEG thumbnail,
`clip-<export-request-id>.jpg`, alongside its already verified MP4,
language-policy SRTs, M5-10 metadata sidecar, and manifest. It is derived only
from the rendered clip at deterministic clip-relative time
`floor(renderedDurationMs / 2)`, staged privately, hashed/persisted, named by
the manifest, and exposed only in the existing atomic package rename.

## Scope and decisions

- Use one narrow FFmpeg thumbnail-extraction adapter and an independent bounded
  FFprobe image inspector. Never extract from the full source.
- Fixed M5-11 policy: JPEG/MJPEG at q=3, preserve aspect ratio, no upscale,
  fit within 1280x720, and force even output dimensions. There is no preset,
  UI, or per-export override.
- Persist only extraction time, width, height, source attempt, and validation
  time. Final artifact provenance stores byte size/hash as for other files.
- Keep manifest schema version 1, following M5-10's additive schema strategy:
  widen artifact roles and add an optional thumbnail detail group so older
  manifests remain valid; require the thumbnail only for new promotions.
- Add local migration 0015 after M5-10's 0014: nullable thumbnail validation
  columns plus an atomic final-artifact role CHECK rebuild preserving rows/index.

## Failure states

Extraction, image inspection, staging, hashing, manifest generation, promotion,
provenance persistence, or cancellation fails closed: no final package remains
and the established source/render scratch cleanup executes. Cleanup failure
remains `needs_user_action`, never `complete`.

## Acceptance criteria

1. New omission, confirmed-English, and bilingual packages contain exactly
   4, 5, and 6 files respectively, always including the JPEG.
2. The JPEG is regular/nonempty MJPEG, fits policy dimensions, records the
   deterministic midpoint, and has matching staged/promoted/SQLite/manifest
   bytes and SHA-256.
3. Existing packages and manifest v1 records remain readable and unchanged.
4. A real fixture run uses actual FFmpeg/FFprobe and verifies the JPEG plus the
   complete atomic package and scratch deletion.

## Explicit non-goals

Thumbnail UI/preset overrides, contact sheets, scene detection, source-derived
thumbnails, cloud/logged delivery, grouping, retries, sweeping, and subtitle
changes.

## Verification

Run media, contracts/local-DB, export-processor, and one-shot runtime tests
first; then local migration validation, `npm run check`, `npm run test:e2e`,
and `git diff --check`.

## Documentation constraint

`PROJECT_GUIDE.md` and `outline.md` have unrelated uncommitted user work. Do
not edit or commit them in this slice; record deferred reconciliation here.

## Completion record

### Decisions made

- The thumbnail is extracted only from `rendered-range.mp4` at
  `floor(renderedDurationMs / 2)`, after the existing render/FFprobe validation
  and before sidecar/package promotion. It is never derived from full source
  media.
- `FfmpegJpegThumbnailExtractionAdapter` is a narrow injectable boundary; its
  FFmpeg implementation uses one argument array, no upscale, aspect-preserving
  1280x720 fit, even dimensions, MJPEG/JPEG q=3, a private `.jpg` output, and
  cancellation. `FfprobeJpegThumbnailInspector` independently validates one
  bounded MJPEG stream and safe dimensions.
- M5-10's schema-version-1 additive compatibility strategy remains intact:
  old manifest v1 records stay valid; new promotion requires `thumbnail_jpg`
  and adds optional thumbnail detail to its manifest artifact record.
- Migration `0015` adds nullable safe thumbnail validation fields and atomically
  rebuilds `export_final_artifacts` for `thumbnail_jpg`, preserving all rows and
  the request/attempt index.

### Files changed

- Media JPEG extraction/inspection boundary and focused tests.
- Shared thumbnail provenance/manifest artifact contracts and tests.
- Local thumbnail validation persistence, final artifact enforcement, and
  migration `0015_export_clip_thumbnail_artifact.sql` plus migration tests.
- Local processor/runtime real-fixture tests and this completion record.

### Checks and actual results

- Focused media/contracts/local-DB/processor/runtime suite: 54 passed.
- `npm run typecheck`: passed.
- `npm run db:migrate:local:test`: 15 newly applied.
- `npm run test`: 154 passed, 1 optional test skipped.
- `npm run build:web`: passed.
- `npm run db:migrate:cloud:test`: 9 newly applied.
- `npm run test:e2e`: 4 passed after allowing its loopback test server; the
  initial sandboxed run was blocked from binding `127.0.0.1`.
- `git diff --check`: passed.

### Compatibility and remaining risks

- Existing completed packages, rows, and manifest schema-version-1 records are
  not rewritten or invalidated. New promotions require the thumbnail and fail
  closed if it cannot extract, inspect, stage, verify, or persist.
- No thumbnail selection UI/preset override, scene detection/contact sheet,
  source-derived thumbnail, cloud/logged delivery, grouping, retry, sweeping,
  or subtitle change was added.
- `PROJECT_GUIDE.md` and `outline.md` were deliberately not edited because
  current uncommitted authoritative changes belong to the separate Milestone 6
  workflow task. Reconcile their completion/checklist status separately.

### Commit ID(s)

- Recorded after the isolated M5-11 commit.
