# M5-14B — Optional embedded English soft subtitles

- Status: completed
- Task/thread: M5-14B only
- Dependency: completed M5-14A capability-driven rendering and conformance

## User-visible outcome

An export may opt into one English soft-subtitle stream inside its selected
MP4, MOV, or MKV video while retaining the exact independently verified SRT
sidecars required by the immutable language policy. The embedded stream is
selectable in an editor/player, is never burned into the picture, and is not
marked forced or default. FFprobe must verify its codec, English language,
disposition, and exact stream count without weakening any existing video,
audio, duration, package, manifest, thumbnail, metadata, or cleanup guarantee.

## Smallest end-to-end proof

Use the repository-owned four-second foreign-language fixture and its exact
original/English transcript snapshots. Resolve an immutable export with
`embedEnglishSubtitleTrack = true`, render one H.264/AAC MP4 package through
the real local processor, and prove all of the following:

1. the package still contains both mandatory original-language and English SRT
   sidecars plus metadata, thumbnail, manifest, and one video;
2. the video has exactly one video stream, one audio stream, and one English
   soft-subtitle stream using `mov_text`, with no default/forced disposition;
3. the embedded English cues are derived from the same exact English track and
   resolved clip bounds as the English sidecar;
4. all prior video/audio conformance and final artifact hashes still verify;
5. source and staging scratch are deleted before completion.

Then prove the same stream policy for every installed supported family:

- MP4/H.264/AAC: `mov_text`;
- MOV/ProRes/PCM: `mov_text`;
- MKV/HEVC/AAC: FFmpeg `srt`/`subrip`, observed by FFprobe as `subrip`.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, PL-01, M5-04 through M5-06, M5-09,
M5-13, and M5-14A. Reuse the immutable settings snapshot, exact transcript
lookup, clip-relative SRT derivation, installed-capability discovery, fixed
FFmpeg argument mapping, normalized FFprobe conformance, atomic package
promotion, and cleanup boundaries. Do not add worker delivery, grouping,
retry UI, artifact-library behavior, or any Milestone 6 surface.

## Primary platform evidence

Record the current primary-source findings in `docs/research/` as part of this
slice. At activation time:

- FFmpeg documents MP4 and MOV as MOV/ISOBMFF-family muxers.
- FFmpeg exposes per-stream metadata and disposition controls, including
  subtitle stream specifiers.
- FFmpeg's `mov_text` encoder is 3GPP Timed Text.
- FFmpeg's Matroska mapping identifies `S_TEXT/UTF8` as SubRip.
- The verified local FFmpeg 8.1.2 installation advertises `mov_text`, `srt`,
  and `subrip` subtitle encoders and the MP4, MOV, and Matroska muxers.

Keep all codec and argument choices behind the existing typed media/capability
adapters; tests must not depend on unvalidated ambient tool behavior.

## Product and compatibility decisions

1. `embedEnglishSubtitleTrack` remains an immutable boolean setting and stays
   false in the application default. It is independent of sidecar omission.
2. Foreign, mixed, and unknown exports always retain original plus English SRT
   sidecars even when English embedding is enabled.
3. Confirmed-English exports retain the English SRT by default. If their
   immutable sidecar-omission setting is true and embedding is true, derive the
   exact English cues privately for embedding but promote no SRT sidecar.
4. The one embedded stream is English only. Do not embed original-language or
   preferred-language tracks in this slice.
5. Snapshot an exact English track reference whenever English embedding or the
   confirmed-English sidecar policy needs it. Do not infer English identity
   from the selected display track: PL-01 allows a distinct preferred-language
   display track over an English source.
6. Preserve conservative reads for existing requests. Older non-embedded work
   remains executable under its historical capability profile and selection
   semantics; no completed request/package is rewritten.
7. Bump/version capability, manifest, metadata, observed-media, and persistence
   schemas only where needed. New schema readers must retain M5-14A v1/v2
   compatibility.
8. The embedded stream is neither default nor forced. Set normalized English
   language metadata (`eng`) and a bounded title such as `English` only through
   fixed internal literals.

## In scope

1. Evolve shared contracts for the exact English track snapshot and normalized
   subtitle-stream conformance: codec, language, disposition, count, and safe
   title when observed.
2. Update capability validation and installed discovery so embedding is
   available only when the selected container's fixed subtitle encoder and
   muxer are present. Preserve non-embedded eligibility when a subtitle encoder
   is absent.
3. Generalize the pure FFmpeg builder to accept one processor-owned, validated
   clip-relative English SRT input only when the immutable setting is true.
   Use explicit input/maps, fixed subtitle codec selection, `shell: false`, and
   fixed metadata/disposition arguments. Continue dropping source subtitle,
   data, attachment, chapter, and global metadata streams.
4. Reorder private staging as necessary so the exact English cues exist before
   muxing. A confirmed-English omission plus embedding may use a private
   temporary SRT, but it must never appear in the promoted package.
5. Extend FFprobe inspection/conformance to require zero subtitle streams when
   embedding is false and exactly one conforming English stream when true,
   while retaining exact one-video/one-audio and all existing media checks.
6. Persist only safe normalized embedded-stream provenance. Include it in the
   current manifest/metadata version and verify it against the promoted video;
   do not add a separate final-artifact role because the stream is part of the
   immutable video bytes.
7. Expose the existing checkbox only for container/worker combinations that
   can execute it, with an actionable explanation otherwise. Keep queue/log
   only independent of export capability.
8. Add deterministic pure tests, injected capability tests, processor/package
   tests for all subtitle policies, populated migration compatibility when a
   schema changes, Playwright coverage for setting resolution/gating, and real
   FFmpeg/FFprobe fixture coverage for every installed family.

## Failure states

- Missing exact English track identity or bytes, wrong language/version,
  malformed/empty required cues, or a preferred/original track substituted as
  English fails before source acquisition where possible and never falls back.
- Missing container muxer or required subtitle encoder produces an actionable
  pre-acquisition capability issue; no codec/container fallback is allowed.
- Missing, extra, wrong-codec, wrong-language, default, or forced subtitle
  streams fail conformance, remove the attempted package, and enter the
  established cleanup path.
- Any embedded-versus-sidecar cue/provenance mismatch, schema error, promoted
  hash mismatch, cancellation, or persistence failure fails closed.
- Source-cleanup failure continues to win as `needs_user_action`; an otherwise
  valid embedded package cannot become complete while source scratch remains.

## Explicit non-goals

- Burned-in subtitles, subtitle styling, multiple embedded tracks, original or
  preferred-language embedding, WebVTT artifacts, user-authored subtitle text,
  or arbitrary codec/metadata/disposition arguments.
- Logged/cloud export delivery, worker registration, progress/retry/cancel,
  batches, grouping, cleanup-only retry, abandoned-scratch sweeping, cloud clip
  storage, artifact locators, Clip Library, authoring handoff, Sheets, or M7.
- Preset management/history changes beyond making the already-versioned boolean
  executable and capability-aware.
- Rewriting completed packages or invalidating historical manifest/metadata
  readers.

## Acceptance criteria

1. The application default and every historical non-embedded snapshot retain
   their previous output, stream counts, package cardinality, and compatibility.
2. An enabled MP4 or MOV export contains exactly one `mov_text` English stream;
   an enabled MKV export contains exactly one FFprobe-identified `subrip`
   English stream. None is default or forced.
3. Video/audio codec, profile, pixel format, dimensions, aspect, frame rate,
   sample rate/channels/bitrate where observable, and duration retain M5-14A
   conformance with and without embedding.
4. Foreign/mixed/unknown embedding never removes either mandatory SRT sidecar.
   Confirmed-English default retains `.en.srt`; confirmed-English omission may
   embed English while promoting no SRT.
5. The embedded cues and any promoted English sidecar share the exact English
   track/version, resolved clip bounds, clip-relative timing, and cue content
   identity. A distinct PL-01 preferred display track cannot become the
   embedded track.
6. Capability discovery blocks only embedding when a subtitle encoder is
   missing and does so before source acquisition. No fallback is permitted.
7. Manifest, metadata, database provenance, FFprobe observation, staged bytes,
   promoted bytes, and hashes agree; legacy records remain readable.
8. Real-tool tests pass for every installed render family, and every success,
   failure, and cancellation path retains verified source/staging cleanup.

## Verification plan

Run narrow contracts/export-settings/media/transcript/local-database/processor
tests first, followed by the real-tool fixture paths. Run any affected web tests
and focused Playwright path, then `npm run check`, full Playwright, populated
migration checks, and `git diff --check`. Inspect the complete diff for raw
arguments, display-track substitution, relaxed sidecar policy, stream-count
regression, capability-version incompatibility, metadata/path leakage, and
cleanup regressions.

Move this spec to `specs/completed/` only after recording decisions, changed
files, actual command results, compatibility impact, remaining risks, and the
single narrow commit ID. Update `PROJECT_GUIDE.md` and `outline.md` only for the
verified completed behavior.

## Completion record

- Completed 2026-08-20. Enabled the immutable English soft-subtitle setting
  through the fixed typed renderer mapping: MP4/MOV use `mov_text`; MKV uses
  FFmpeg `srt` and requires FFprobe `subrip`. Inputs, maps, codec literals,
  metadata, and disposition are all fixed internally with `shell: false`.
- Exact English identity is snapped by the UI and mandatory for new embedded
  confirmed-English requests; historical non-embedded confirmed-English work
  retains its selection-track compatibility. The private clip-relative SRT is
  offset to the source seek, deleted after muxing, and never promoted.
- Added normalized subtitle codec/language/title/disposition evidence to the
  existing durable observed-media JSON and manifest, plus metadata conversion
  provenance. No migration was needed because the existing JSON field and
  backward-compatible optional schema extension preserve populated records.
- Verification: focused contracts/settings/media/processor suite passed 49/49;
  real FFmpeg/FFprobe 8.1.2 packages passed for embedded H.264/MP4,
  HEVC/MKV, and ProRes/MOV. `npm run typecheck` passed. Playwright requires
  loopback binding and is run with the authorized escalation below.
- Compatibility: profile v3 introduces embedding while a computed M5-14A v2
  capability reference remains valid for its non-embedded snapshots; v1 is
  retained. Existing packages and manifest/metadata readers are unchanged.
- Remaining risk: FFprobe may omit optional stream titles on some builds; title
  is recorded only when safely observed, while codec/language/disposition/count
  remain mandatory.
- Audit follow-up: commit `09bd88897b37d5533dc6207d44c20df5b9187057` used
  `-shortest`, which could truncate a requested video range when the final
  English cue ended early. The follow-up removes that output option: fixed `-t`
  remains authoritative, while the offset subtitle stream stays time-aligned.
  The real family fixture now has a nonzero export start and its final subtitle
  cue ends two seconds before the requested clip end; all embedded packages
  still verify the full requested duration.
- Final audit correction: commit `20d73c0151223998357d30e0f24f6fc1a32ada98`
  fixed duration but direct stream extraction showed its embedded cue timestamps
  were source-relative. The renderer now performs a private first video/audio
  pass using the established post-input seek, then a fixed stream-copy mux of
  that clip and the zero-based validated English SRT. The MP4 real-tool test
  extracts stream `0:s:0` through FFmpeg's fixed SRT encoder and compares parsed
  text and clip-relative timing exactly with the promoted English sidecar.
  The immutable request's exact English track/version is retained in metadata
  subtitle provenance; it remains mandatory for embedding even when the sidecar
  is omitted.
