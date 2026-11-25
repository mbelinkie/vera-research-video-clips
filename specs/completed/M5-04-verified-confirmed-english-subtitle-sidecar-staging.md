# M5-04 — Verified confirmed-English subtitle sidecar staging

- Status: completed
- Task/thread: M5-04 only

## User-visible outcome

For a confirmed-English export request whose immutable snapshot keeps English
sidecars, the local export worker derives one clip-relative `english.srt` from
the exact verified local English transcript version and M5-02 resolved bounds.
It validates that sidecar together with the M5-03 temporary MP4 inside the
private attempt directory, records only safe provenance, and then retains the
established verified cleanup behavior.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, and completed M5-01, M5-02, and M5-03
specs before edits. Limit implementation to canonical transcript/SRT helpers,
export request contracts, M5 local-agent lifecycle, local SQLite provenance,
and their deterministic tests. Keep provider behavior behind existing
boundaries; routes and UI do not acquire, parse, or derive subtitles.

## In scope

1. Reuse or extend the canonical transcript/SRT boundary to select overlapping
   English cues, clamp to M5-02 resolved bounds, shift to clip-relative zero,
   serialize, and strictly re-parse/validate an SRT against a verified rendered
   duration.
2. Accept only confidently English snapshots that retain English sidecars.
   Treat explicit English-sidecar omission as inapplicable; reject foreign,
   mixed, and unknown snapshots with actionable retry-safe states reserved for
   later bilingual-sidecar work.
3. Require the exact snapshotted, locally verified English track/version and
   fail safely for missing, malformed, mismatched, or no-intersecting-cue
   data. Do not mutate transcript source timing, selection/requested bounds,
   resolved bounds, or transcript-selection metadata.
4. Write one sanitized, bounded `english.srt` only under the current private
   attempt staging directory. Require it to be regular and nonempty, re-parse
   it, and reject timing outside zero through the verified MP4 duration.
5. Validate M5-03's temporary MP4 and SRT as a pair, preserve only safe
   subtitle provenance (track/version identity, cue count, byte size, checksum,
   and timing bounds), and use existing cleanup gates for source, MP4, and SRT.
6. Add a local migration only if subtitle provenance needs durable storage;
   preserve logged-export versus export-only separation.

## Explicit non-goals

- Foreign-language original/translated bilingual sidecars, final artifact
  promotion, manifests, thumbnails, sidecar embedding/burn-in, UI/preset work,
  same-source grouping, render retries, and scratch sweeping.
- Changing transcript selection, transcript acquisition/publication,
  authorization, logged clip semantics, or export-only projectlessness.
- Persisting/exposing transcript text, local paths, URLs, commands,
  credentials, or raw tool output.

## Failure states

- Explicit English omission is rejected as not applicable to this slice;
  foreign/mixed/unknown source snapshots return a retry-safe language-policy
  state for the later bilingual sidecar slice.
- A missing, unverified, malformed, wrong-version, or nonintersecting English
  transcript fails without substituting a different version or track.
- Derivation, sidecar validation, paired MP4/SRT validation, or cancellation
  cleans source, temporary MP4, and sidecar scratch. A cleanup failure remains
  the actionable M5-01 `needs_user_action` outcome.

## Acceptance criteria

- A deterministic fixture proves trimmed, ordered, clip-relative zero-based
  English SRT output and no cue outside the verified rendered duration.
- A valid confirmed-English request validates the temporary MP4 plus one SRT
  and persists only safe subtitle provenance.
- Malformed/out-of-range sidecars and missing/mismatched transcript versions
  fail closed, with no raw transcript or private implementation details in
  durable errors/provenance.
- All derivation, validation, and cancellation failure paths clean all attempt
  scratch, while existing source-cleanup failure behavior stays actionable.
- Logged and export-only job boundaries stay unchanged.

## Verification plan

1. Run focused transcript/SRT and local export lifecycle fixture tests first:
   trimming/zero-basing; happy path; transcript/version and malformed/out-of-
   range rejection; derivation/cancellation/validation cleanup; cleanup failure.
2. Run relevant transcript, media, local-agent, local-database, and worker
   tests.
3. Run formatting, typecheck, broader project checks, and `git diff --check`.
4. Review the final diff for snapshot mutation, path/text/tool leakage,
   cleanup omissions, and logged/export-only boundary regressions.

## Completion record

- Decisions made: The canonical transcript package now owns deterministic SRT
  derivation, parsing, and timing validation. The local export worker resolves
  only the request snapshot's English track ID/version from the verified local
  transcript index; it does not substitute a newer/different track or mutate
  any snapshot/bounds. The worker writes fixed private `english.srt` staging,
  re-parses it, validates it against the M5-03 rendered duration, and persists
  only safe provenance locally. This slice rejects English omission and
  foreign/mixed/unknown snapshots before source acquisition so bilingual policy
  remains a later isolated slice.
- Files changed: Canonical transcript SRT helpers/tests; export request contract;
  local export source processor/tests; local transcript lookup and subtitle
  provenance persistence; local migration
  `0008_export_english_sidecar_validation`; and `outline.md`.
- Checks run and actual results: focused transcript/local-agent/local-DB suite:
  31 passed; relevant transcript/media/local-agent/local-DB/worker suite: 45
  passed; `npm run typecheck`: passed; `npm run format:check`: passed; `git diff
--check`: passed; full Vitest suite: 122 passed, 1 skipped; web production
  build: passed; local migrations: 8 newly applied; cloud migrations: 7 newly
  applied.
- Remaining risks/follow-ups: Foreign-language original/translated bilingual
  sidecars, intentional speech-free empty sidecars, final artifact promotion
  and manifests, retries/grouping, and scratch sweeping remain deferred.
- Commit ID(s): Not committed in this task.
