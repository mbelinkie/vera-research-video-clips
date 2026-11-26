# M5-14A — Capability-driven alternative rendering and FFprobe conformance

- Status: completed
- Task/thread: M5-14A only
- Dependency: completed M5-13 immutable resolved export settings

## User-visible outcome

An immutable resolved export-settings snapshot may select one explicit supported
software-rendering family. The local worker revalidates that exact tuple and the
installed FFmpeg encoders/muxers/filters before source acquisition, renders the
requested `.mp4`, `.mkv`, or `.mov` package video without fallback, and accepts
it only after normalized FFprobe evidence conforms to the snapshot. The existing
Editing H.264/AAC MP4 default remains byte-policy compatible.

## Bounded support matrix

Only these precise re-encode families are supported:

1. `mp4` + H.264 (`libx264`, High, `yuv420p`) + CRF or target bitrate + AAC.
2. `mkv` + HEVC (`libx265`, Main, `yuv420p`) + CRF or target bitrate + AAC.
3. `mov` + ProRes 422 (`prores_ks` profile 2, `yuv422p10le`) + PCM s16le with
   codec-fixed rate control.

The current `maxWidth` setting becomes a bounded fit/no-upscale policy using an
allowlisted even width; absence preserves source dimensions. Existing `source`
or allowlisted CFR choices are supported. AAC may use a bounded explicit
bitrate, sample rate, and channel count; PCM supports bounded sample rate and
channels and rejects bitrate. Processing remains software-only. Stable contract
enums map to fixed internal FFmpeg literals; no raw argument, encoder, filter,
muxer, path, basename, template, stream-copy, `auto`, or hardware value is
accepted.

## In scope

1. Expand the canonical M5-13 software capability profile and its pure
   validation/support-matrix helpers. Add injected installed-tool discovery for
   FFmpeg encoders, muxers, and required filters; deterministic tests inject
   fakes. The processor must revalidate both the immutable snapshot and actual
   installation before acquisition.
2. Generalize the FFmpeg range renderer through one pure argument builder using
   explicit maps, precise post-input seek, `shell: false`, bounded process
   output/time/cancellation, software encoders, fixed muxers/filters, and
   metadata/chapter/subtitle/data dropping.
3. Generalize FFprobe into bounded normalized conformance covering container and
   major brand, exact stream counts, video codec/profile/pixel format/dimensions/
   aspect/rational average FPS, audio codec/sample rate/channels/layout/reported
   bitrate, duration, and tool version. Validate the exact selected family with
   documented duration/FPS/aspect/audio-bitrate tolerances. CRF is proven only
   from validated args and immutable provenance, never inferred from FFprobe.
4. Generalize `rendered-range.mp4` and `video_mp4` assumptions to the selected
   extension and `video_mp4 | video_mkv | video_mov`, preserving all legacy
   roles/cardinalities, SRT/metadata/thumbnail/atomic-promotion/hash behavior.
5. Add local migration `0017_alternative_render_conformance.sql` to preserve
   prior rows while persisting the normalized observed properties, conformance
   schema version, settings hash, and widened video-role CHECK.
6. Add a new manifest schema version while retaining the historical v1 reader.
   Record safe resolved technical settings/fingerprints/preset provenance,
   capability IDs, normalized observed properties, verification schema, actual
   tool versions, and the dynamic video role/filename. Version clip metadata as
   needed with one concise conversion summary.
7. Keep the UI limited to the actual canonical allowlist and show local installed
   availability on the existing export-only local preview. Logged cloud preview
   remains authoritative only for the versioned canonical profile; this slice
   does not create a client-authored installed-capability claim or worker
   registration/delivery boundary.
8. Prove default plus HEVC/MKV and ProRes/MOV real-fixture packages when the
   installation exposes the required encoders, with a supported skip only when
   discovery truthfully reports one missing.

## Failure states

- An invalid tuple, rate-control/audio contradiction, nonallowlisted scale/FPS,
  unknown field/raw argument, or unavailable encoder/muxer/filter fails before
  source acquisition with a stable actionable code.
- No family, encoder, rate mode, muxer, or codec fallback is permitted.
- Missing/extra streams or any container/codec/profile/pixel-format/dimension/
  aspect/FPS/audio/duration mismatch fails with a property-specific code,
  removes attempted package/scratch, and retains existing cleanup-failure
  precedence.
- Manifest/metadata/schema/persistence/promotion mismatches fail closed and
  cannot expose a partial package.

## Explicit non-goals

- Preset CRUD/history/resolution changes; embedded or burned subtitles; logged
  delivery/registered-worker capability exchange; progress/retry/cancel UI;
  grouping/batch; sweeper; stream copy; arbitrary hardware acceleration;
  arbitrary FFmpeg args/paths/basenames/templates; cloud clip storage; Sheets;
  or Milestone 6 Clip Library work.
- Editing or committing `PROJECT_GUIDE.md`, `outline.md`, either scriptwriting
  spec, the M6 future spec, `CLAUDE.md`, Recorded Performance, or `mistakes.md`.
  Their M5 checklist reconciliation remains with the owning documentation task.

## Acceptance criteria

1. The application default still emits the established H.264/AAC MP4 package
   and all M5-10/M5-11 artifacts/subtitle-policy cardinalities unchanged.
2. A valid immutable alternative snapshot emits its requested extension/role,
   and FFprobe verifies every observable selected property plus exact stream
   counts against that snapshot; validated args/settings provenance proves CRF.
3. Pure argument tests prove only fixed allowlisted literals and paths are used,
   with explicit maps, no subtitle/data/chapters/metadata, post-input seek, and
   no shell/raw/hardware path.
4. Injected capability discovery gates unavailable tools before acquisition;
   normal tests are deterministic and the real fixture runs default plus every
   installed alternative family.
5. Migration from populated `0016` preserves every M5-11 role/row unchanged,
   admits both new video roles, rejects unknown roles, and persists parsed
   normalized conformance/settings identity.
6. Manifest v2 and metadata v2 are safe, deterministic, dynamic-video aware,
   and historical v1 values remain readable. Atomic promotion and staged versus
   promoted hashes remain exact.
7. Confirmed-English default/omission and foreign bilingual packages retain
   their exact SRT, metadata, thumbnail, and manifest counts for each selected
   video extension. Cancellation, cleanup, and completed-request idempotency do
   not regress.

## Verification plan

Run contracts/export-settings/media/local-DB/processor/runtime tests first,
including a populated 0016 migration upgrade and real-tool family fixtures.
Run web tests/build and Playwright only if capability controls change. Then run
local/cloud migrations, `npm run check`, `git diff --check`, and a complete
security/compatibility diff audit. Record actual results, move this spec to
`specs/completed/`, and commit only M5-14A-owned files.

## Completion record

- Completed: 2026-08-20.
- Implemented the three-family software support matrix, stable tuple IDs,
  strict settings allowlists, injected installed-FFmpeg discovery, and
  pre-acquisition immutable snapshot plus installed-capability revalidation.
  The historical M5-13 Editing MP4 capability reference remains executable
  only for its original H.264/AAC policy.
- Added the pure fixed-literal FFmpeg builder and generalized renderer with
  explicit video/audio maps, post-input seek, metadata/chapter/subtitle/data
  dropping, fixed muxers/encoders/filters, selected extension validation, and
  preserved process bounds/cancellation/cleanup behavior.
- Added normalized FFprobe schema v1 and exact family conformance for stream
  counts, container/major brand, codecs/profiles/pixel format, dimensions,
  sample/display aspect, rational average FPS, audio sample rate/channels/layout,
  reported AAC bitrate when FFprobe exposes it, duration, and tool version.
  Duration tolerance is 250 ms; FPS tolerance is 0.001; aspect tolerance is
  0.5%; reported AAC bitrate tolerance is the greater of 32 kbps or 20%.
- Added local migration `0017_alternative_render_conformance.sql`, normalized
  observed/settings-hash persistence, dynamic `video_mp4 | video_mkv |
video_mov` packaging, manifest v2, metadata v2, and retained v1 readers.
  Populated 0016 upgrade coverage preserves every established role/row and the
  request/attempt index while rejecting unknown roles.
- Added local installed-availability preview and export-only action gating
  without changing cloud logged-preview authority; the shared selector marks
  local-only unavailability without claiming it for logged delivery. Preset
  CRUD, registered-agent delivery, embedded
  subtitles, arbitrary args/hardware/paths/templates, and later slices remain
  deferred exactly as scoped.
- Verification: focused contracts/export-settings/media/local-DB/processor/
  real-tool suites passed 66/66; `npm run check` passed formatting, typecheck,
  173 tests with one repository-declared skip, production web build, 17 local
  migrations, and 11 cloud migrations; Playwright passed 4/4 Chromium tests.
  FFmpeg and FFprobe 8.1.2 were present. Real fixtures completed H.264/MP4,
  HEVC/MKV, and ProRes/MOV with no capability skip.
- Security/compatibility audit: command execution remains `shell: false` with
  argument arrays; no raw encoder/filter/muxer/argument, hardware, stream-copy,
  path, basename, or template input was introduced; staged-versus-promoted
  hashes and exact package cardinality remain enforced. The intentional M6 and
  product-guide documentation changes were not edited or committed; their M5
  checklist reconciliation remains deferred to the owning documentation task.
- Risks/blockers: no blocker. Matroska FFprobe may omit per-stream AAC bitrate;
  it is persisted and tolerance-checked whenever reported rather than inferred.
