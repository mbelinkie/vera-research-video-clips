# R1 #46 — Preserve YouTube auto-caption word starts

Issue: https://github.com/mbelinkie/vera-research-video-clips/issues/46

## Scope and contract

- Only `youtube-auto` WebVTT normalization reads inline timestamp tags. Manual captions and generated/translated tracks keep their original cue-only behavior and identities.
- Retain each rendered whitespace token, original cue text and cue times. Recognize source-ms start times only for unambiguous single-token spans after an inline marker, or the single initial token anchored by the cue start when later inline markers are present. Multiword, missing, out-of-range, duplicate, backward and word-internal markers never manufacture word starts.
- For a recognized start, derive an estimated end as the minimum of the **immediately following** timed word's start, start + 500 ms, and that cue's end. If the resulting interval is not positive, it cannot be used as a word range. Never cross the containing cue, including when cues overlap.
- A track with parsed word times has precision `estimated` (exact caption starts, _derived_ ends), not `word`; a cue-only track remains `cue`. The phase 2 contract/persistence change adds an optional explicit `endTiming: "derived"` field; phase 1 computes the end and carries the internal provenance without changing persistent schemas prematurely.
- Hash canonical rendered cue text and cue bounds, plus per-token timing/provenance **when any word starts are recognized**. These timed tracks use schema version 2 and distinct stable IDs, so verified caches do not confuse them with cue-only versions. Untimed/manual canonical hashes, schema version 1 and IDs stay unchanged; equivalent CRLF/LF and markup produce equal identities.

## Acceptance and exclusions

The checked-in VTT fixture proves exact `11_840` ms starts, next-word/500-ms/cue clamps, overlapping cues, Unicode/entities, and hour stamps. Tests additionally cover malformed, absent and ambiguous markers, changed-timestamp identity and manual-caption regression. No new recognizer, aligner, media acquisition, English translation word alignment, playback UI or SQL migration occurs in phase 1. Phases 2–4 cover durable provenance, UI/export propagation and full acceptance.
