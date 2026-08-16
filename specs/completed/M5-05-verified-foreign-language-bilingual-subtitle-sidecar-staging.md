# M5-05 — Verified foreign-language bilingual subtitle sidecar staging

- Status: completed
- Task/thread: M5-05 only

## User-visible outcome

For a foreign, mixed, or unknown-language export request, the local export
worker derives both required clip-relative subtitle sidecars from the exact
original-language and translated-English transcript versions frozen in the
immutable request snapshot. It validates both SRTs together with the M5-03
temporary MP4 in private attempt staging, stores only safe per-sidecar
provenance, and retains the established cleanup gate on every terminal path.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, and completed M5-01 through M5-04
specifications. Limit changes to canonical transcript/SRT helpers, export
request contracts, M5 local-agent lifecycle, local SQLite subtitle provenance,
and deterministic tests. Reuse the M5-04 private staging and paired-validation
lifecycle; provider acquisition, routes, and UI do not parse or derive
subtitles.

## In scope

1. Resolve foreign, mixed, and unknown snapshots to a mandatory two-sidecar
   policy, ignoring the snapshotted English-only omission preference.
2. Consume only exact snapshot identities, verified local original and English
   tracks/versions, M5-02 persisted resolved bounds, and M5-03 verified
   rendered duration. Do not substitute a track/version or mutate source
   timings, transcript selection, requested bounds, or resolved bounds.
3. Reuse canonical SRT derivation to select intersecting cues, clamp them to
   resolved bounds, shift to clip-relative zero, serialize bounded sanitized
   original-language and English sidecars, and strictly re-parse/revalidate
   both against the verified MP4 duration.
4. Write only fixed sanitized names inside attempt-private staging, verify the
   two SRTs plus temporary MP4 as a required pair, and persist only safe
   sidecar provenance: role/language, track/version identity, cue count, byte
   size, checksum, and timing bounds.
5. Fail closed with retry-safe actionable state for missing, malformed,
   wrong-version, non-English translation, or nonintersecting required tracks.
   Keep M5-01 cleanup failure as the terminal actionable outcome.
6. Cover bilingual trimming/zero-basing, paired validation, required-track and
   version failures, malformed/out-of-range sidecars, cancellation/cleanup,
   and cleanup-failure actionability with deterministic fixtures/fakes.

## Explicit non-goals

- Confirmed-English omission behavior, final artifact promotion, manifests,
  thumbnails, subtitle embedding/burn-in, UI/preset work, retries,
  same-source grouping, or scratch sweeping.
- Transcript acquisition/publication, translation generation, project
  authorization, logged-clip semantics, CSV/Sheets synchronization, or
  export-only projectlessness.
- Persisting transcript text, local paths, URLs, commands, credentials, or raw
  tool output.

## Failure states

- A snapshot outside foreign/mixed/unknown policy remains rejected for this
  slice. Every foreign/mixed/unknown snapshot requires both sidecars even when
  it carries English-sidecar omission.
- Missing/unverified/malformed/wrong-version original or English data, an
  English track whose language is not English, or a required track with no
  intersecting cue fails without fallback or substitution.
- Sidecar write, re-parse, timing validation, paired validation, render-source
  cancellation, and validation failure clean source, MP4, and both SRTs.
- Any verified cleanup failure supersedes normal reporting with M5-01's
  actionable `needs_user_action` outcome.

## Acceptance criteria

- A deterministic bilingual fixture produces ordered original-language and
  English SRTs clipped to the same M5-02 bounds, zero-based, and within the
  M5-03 rendered duration.
- Foreign/mixed/unknown requests pair-validate exactly one original and one
  English sidecar even if the immutable snapshot requests English omission.
- Invalid/missing/mismatched/non-English/nonintersecting source tracks and
  malformed/out-of-range staged SRTs fail closed with no sensitive durable
  detail and no substitute tracks.
- Durable provenance contains only safe per-sidecar identities and validation
  facts; logged exports and export-only jobs keep their current separation.
- All terminal paths clean source, temporary MP4, original SRT, and English
  SRT; cleanup failure stays actionable.

## Verification plan

1. Run focused transcript/SRT and local export lifecycle fixtures first for
   bilingual clipping/zero-basing, paired success, required-track/version
   failures, malformed/out-of-range validation, cancellation cleanup, and
   cleanup failure.
2. Run relevant transcript, media, local-agent, local-database, and worker
   tests.
3. Run formatting, typecheck, broader checks, migration validation, and `git
diff --check`.
4. Review the complete diff for request/bounds mutation, track substitution,
   source/text/path/tool leakage, cleanup omissions, and logged/export-only
   boundary regressions.

## Completion record

- Decisions made: Added immutable original/English track references to foreign,
  mixed, and unknown export requests and persisted them locally and for logged
  cloud requests. The worker resolves only those exact locally indexed tracks,
  requires an `original` source track plus an English `translated` track linked
  to it, and does not let the English-only omission preference bypass this
  policy. Fixed private `original.srt` and `english.srt` staging names are
  sanitized and bounded; each SRT is clipped/zero-based through the canonical
  helper, re-parsed, validated against rendered duration, and persisted only as
  safe per-sidecar provenance.
- Files changed: export request contracts and catalog persistence; local
  subtitle-track/provenance persistence with migrations `0009` local and `0008`
  cloud; local export processor/lifecycle fixtures; canonical SRT missing-cue
  labelling; `PROJECT_GUIDE.md`; and `outline.md`.
- Checks run and actual results: focused contracts/transcript/local-DB/
  local-agent/cloud-DB suite: 42 passed; relevant transcript/media/local-agent/
  local-DB/cloud-DB/catalog/worker suite: 72 passed; targeted bilingual local
  agent suite: 12 passed; `npm run typecheck`: passed; `npm run format:check`:
  passed; `npm run check`: format/typecheck passed, 125 tests passed with 1
  skipped, web production build passed, and local/cloud migrations validated
  with 9/8 newly applied; `git diff --check`: passed.
- Remaining risks/follow-ups: Intentionally speech-free required sidecars,
  confirmed-English omission, final artifact promotion/manifests, thumbnails,
  embedding/burn-in, retries, same-source grouping, and scratch sweeping remain
  separate future slices. No live authorized FFmpeg/source-provider smoke test
  ran; deterministic provider fakes covered the normal lifecycle.
- Commit ID(s): Not committed in this task.
