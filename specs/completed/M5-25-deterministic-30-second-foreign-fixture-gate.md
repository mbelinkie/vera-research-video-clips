# M5-25 — Deterministic 30-second foreign fixture gate

- Status: completed 2026-08-22
- Task/thread: M5-25 only
- Dependencies: completed M5-08 real-tool composition, M5-14 capability
  conformance, and M5-24 same-source lifecycle

## User-visible outcome

A redistributable repository fixture proves that an exact approximately
30-second foreign-language selection produces verified media plus separate
original-language and translated-English SRTs. Both subtitle files name the
immutable snapshotted tracks, contain only clip-relative in-range cues, and are
covered by the promoted package manifest and hashes. No full-source scratch
media remains after completion or replay.

## Smallest end-to-end proof

Generate a repository-owned synthetic source longer than 30 seconds and pair it
with repository-authored, time-linked foreign/English transcript tracks that
include cues before, across, within, and after the selected range. Run the
existing authorized fixture provider and one-shot export processor over an
exact 30-second subrange with real FFmpeg and FFprobe. Verify the output
duration and codecs, both trimmed/zero-based SRTs, exact track IDs and versions,
artifact byte counts and SHA-256 hashes, metadata/manifest contents, replay
idempotency, and verified source-scratch deletion.

## Decisions and invariants

1. The media is created only from FFmpeg synthetic generators and the bilingual
   text is authored for this repository. Fixture provenance and regeneration
   are documented beside the bytes; no third-party media, transcript, or live
   provider is involved.
2. The source duration exceeds the export range. The selected bounds are exact
   integer source-video milliseconds and resolve to 30,000 milliseconds; cues
   deliberately exercise exclusion and boundary trimming at both ends.
3. This test invokes the established persisted request, source acquisition,
   inspection, range renderer, subtitle, thumbnail, metadata, manifest,
   promotion, and cleanup path. It does not introduce a fixture executor or
   bypass terminal evidence.
4. Mandatory foreign-language policy remains original plus translated English,
   even when the selected preset carries the English-only omission preference.
5. The promoted manifest and metadata must identify the exact snapshotted
   subtitle tracks and versions. Every artifact digest is recomputed from the
   promoted bytes, and every parsed cue ends within the verified rendered media
   duration.
6. Normal tests remain deterministic and network-free. The separately
   user-authorized live YouTube smoke is the next slice and cannot be replaced
   by this fixture.

## Affected boundaries

- Fixture generator and fixture documentation: synthetic long-form media and
  authored bilingual transcript provenance.
- Local one-shot export real-tool tests: exact foreign snapshot, range,
  package, provenance, replay, and cleanup assertions.
- Root test command only if a narrowly named deterministic fixture gate is
  useful for final release evidence.

## Explicit non-goals

- Live YouTube access, yt-dlp/provider changes, credentials, network calls, or
  user authorization for a real source.
- New contracts, database migrations, executor/runtime behavior, preset UI,
  batch/group logic, Clip Library/M6, or pilot/QA/M7 work.
- Treating synthetic fixture evidence as proof of live-provider availability.

## Acceptance criteria

1. Fixture media and text are deterministic, redistributable, documented, and
   reproducible with the repository command and installed FFmpeg.
2. An exact 30,000 ms foreign selection completes through the real local export
   path with the requested supported H.264/AAC MP4 properties and duration
   within the established tolerance.
3. The package contains video, original SRT, English SRT, thumbnail, metadata,
   and manifest only. Both SRTs parse, start at or after zero, contain the
   expected boundary-trimmed/in-range cues, and end at or before FFprobe's
   verified output duration.
4. Metadata and manifest carry the exact request bounds, source language class,
   mandatory bilingual policy, track IDs/versions, renderer capability, and
   observed media. Manifest artifact sizes and SHA-256 hashes match every
   promoted file.
5. The persisted request is complete only with all six artifact records and
   deleted source evidence. The exact source-scratch root is absent, and replay
   performs no reacquisition or rerender.
6. The focused fixture gate, full `npm run check`, Playwright regression, and
   `git diff --check` pass with actual counts recorded before completion.

## Verification plan

Run the fixture generator and FFprobe its source. Run the focused real-tool
one-shot export test, then formatting, typecheck, the complete unit/integration
suite, web build, both migration test CLIs, `git diff --check`, and Playwright.
Inspect the promoted SRT timing and manifest hashes in the test itself so the
gate is reproducible without retaining temporary output.

## Completion evidence

Implementation commit `b9b1809` adds a 334,746-byte CC0 synthetic 32-second
H.264/AAC source, machine-readable provenance with committed SHA-256, and
repository-authored Spanish/English tracks with cues outside and across both
gate boundaries. The generator retains the original four-second fixture and
creates both sources only from FFmpeg `lavfi` color and sine inputs. The fixture
README explicitly limits this proof to export/subtitle behavior rather than
acoustic language detection.

`npm run test:fixture:foreign-30s` passed the real FFmpeg/FFprobe gate through
the existing persisted one-shot processor. The 1,000–31,000 ms source range
rendered as 30,000 ms H.264/AAC media within the established tolerance. Both
sidecars contain exactly four clip-relative cues at 0–1,500, 4,000–8,000,
14,000–18,000, and 29,000–30,000 ms; pre/post-range text is absent. Metadata and
manifest assertions verify mandatory bilingual policy despite the
English-only omission setting, exact track IDs/versions, observed media and
resolved bounds. The test reads and recomputes the size and SHA-256 of every
promoted file, including `manifest.json`, then proves six persisted artifacts,
deleted source evidence, an empty source-scratch root, and replay without a
second acquisition or render.

The final aggregate gate passed formatting, typecheck, 259 tests with one
declared skip, the production web build, 24 local and 19 cloud migrations, and
`git diff --check`; Playwright passed four of four flows. Independent Terra
audits found no remaining fixture, integrity, provenance, privacy, or scope
defect after the manifest self-hash assertion was added. The opt-in explicitly
user-authorized live YouTube smoke and final Milestone 5 matrix remain open.
