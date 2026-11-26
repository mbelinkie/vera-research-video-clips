# PUNCH-007 — Player-range clip logging and speech status

- Status: completed 2026-08-24
- Parent entry: `PUNCH-007`
- Priority wave: after completed PUNCH-008A comment authority and before the
  later PUNCH-008/PUNCH-010 authoring wave

## User-visible outcome

A researcher can mark a source-video range from the player with visible Set in
and Set out controls or guarded `I`/`O` shortcuts, record `Speech`, `No speech`,
or `Transcript unavailable`, and log that range without fabricating transcript
IDs or text. Verified overlapping transcript evidence is offered explicitly and
can be attached while the immutable selection remains player-originated.

No-speech and transcript-unavailable logs require a nonempty Clip description
or atomic first comment. Attested no-speech exports produce the ordinary
language-policy sidecar roles as explicitly empty artifacts with stable actor,
time, and schema provenance. Speech/transcript-unavailable ranges without exact
required transcript evidence remain loggable but cannot create a finalizable
export request.

The primary action is **Log clip**. An accessible adjacent menu exposes the
separate **Log and export** and **Export without logging** effects.

## Contract and persistence boundaries

- Preserve the current transcript range as the `transcript_range` member of a
  clip-selection union. Add `player_time_range` with separate source and export
  bounds, `manual_player` origin, structured speech status, optional exact
  transcript attachment, and an actor/time/version no-speech attestation.
- Existing transcript-only payloads and persisted snapshots remain readable;
  new writes use explicit selection discriminants.
- Cloud migration 0037 stores one canonical selection snapshot, makes legacy
  transcript-only columns nullable only for player ranges, records selection
  kind/speech state and structured no-speech attestation, and permits genuinely
  absent language text/evidence without sentinel IDs or strings.
- Local migration 0031 stores zero-cue no-speech sidecar validation separately
  from ordinary transcript-derived sidecars. Existing positive-cue provenance
  remains unchanged.
- The cloud catalog stays authoritative for project clips and current actor
  authorization. A client no-speech attestation must identify the current user;
  it is snapshotted and carried unchanged into immutable export requests.
- Export requests, metadata, manifests, reconciliation, artifact compatibility,
  local delivery, and retries preserve the exact player selection and
  attestation. Comments, later transcript availability, and profile changes do
  not mutate an existing request.

## Interaction and failure behavior

- `I` and `O` are ignored for repeated or modified keydown, editable controls,
  contenteditable regions, menus, and dialogs. `O` requires an earlier in-point
  and a strictly later playhead. Known source duration bounds are enforced.
- Visible controls show exact numeric source/export bounds, duration, preview,
  handles, clear, status, and shortcut help. Starting or clearing a manual
  range never mutates a previously logged clip.
- Transcript overlap uses strict source-time intersection against verified
  tracks. Attachment is explicit, keeps track/version/segment identity and
  honest precision, and is removed rather than rewritten when the speech state
  becomes no-speech or transcript-unavailable. Missing overlap never infers
  no-speech.
- No-speech and transcript-unavailable creation rejects empty description plus
  empty first comment, including idempotent/concurrent attempts. Clip and first
  comment still commit atomically.
- No-speech export rejects embedded-subtitle settings, creates a verified media
  package plus the language-policy-required empty sidecars, and records zero
  cues plus the attestation. Transcript-unavailable or unattached speech export
  fails before a render can be queued.
- Projectless export-only receives no project description, first comment,
  topics/tags, clip, CSV row, notice, or sync event.

## Non-goals

- Silence inference, VAD, caption-gap inference, or AI speech classification.
- Transcript editing, weakening subtitle requirements, or inventing evidence.
- PUNCH-008 later-comment offline replay/mentions/follows/search/authoring,
  PUNCH-010 Topics, PUNCH-009, live providers/media, deployment, or app restart.

## Acceptance criteria

1. Exact player bounds can be set by controls and guarded shortcuts; invalid,
   reversed, repeated, modified, editable/menu/dialog, and out-of-media actions
   do not create a loggable range.
2. Transcript-range behavior remains compatible. A player range can explicitly
   attach exact overlapping native/English/preferred evidence while retaining
   player provenance; no overlap is reported without changing speech status.
3. Cloud reads, Clip Library, search, CSV, source opening, and authoring-safe
   selection summaries show `No speech`, `Transcript unavailable`, or `Speech`
   without fabricated IDs/text. Historical rows still parse.
4. No-speech/transcript-unavailable creation requires description or first
   comment and preserves atomic success, rollback, exact replay, divergent
   replay, and actor authorization.
5. Attested no-speech export writes the exact required empty sidecar roles,
   validates zero-cue provenance and immutable actor/time/version evidence,
   reconciles through cloud success, and survives retry/restart paths.
6. Transcript-unavailable or unattached speech can log but cannot create a
   finalizable export; attaching exact evidence requires a new request snapshot.
7. Log clip creates one project clip and no render; Log and export creates the
   clip before its render; Export without logging creates no project research
   record.
8. Focused contracts/catalog/API/database/local-export/UI tests, typecheck,
   aggregate Vitest, browser regression, desktop build, both migration gates,
   scoped formatting, and `git diff --check` pass.

## Narrow tests first

1. Contract tests for both selection members, source/export bounds, attestation,
   transcript-free candidates, export blocking, and zero-cue sidecars.
2. Transcript helper tests for strict time-overlap attachment and unchanged
   transcript selections.
3. Catalog tests for persistence, actor attestation, required context,
   authorization/idempotency, conservative reads/CSV, and export eligibility.
4. Local queue/export fixture tests for zero-cue sidecars, manifest/metadata,
   retry/recovery, and transcript-unavailable blocking.
5. Browser tests for controls, shortcut guards, attachment, required context,
   and the three split-button effects.

## Completion evidence

- Contracts, cloud migration `0037`, local migration `0031`, catalog/API,
  local queue/export, transcript overlap, renderer, and browser paths implement
  the player-range union without transcript sentinels or inferred speech.
- Catalog coverage proves exact replay/conflict, current-actor no-speech
  attestation, context enforcement, atomic first-comment concurrency/rollback,
  batch rollback, delivery/retry preservation, empty-sidecar success
  reconciliation, immutable artifact history, and fail-closed export
  eligibility.
- Local export coverage proves one-byte newline SRT sidecars, zero cues,
  manifest/metadata attestation, close/reopen recovery, idempotent replay, and
  malformed legacy player-request rejection before acquisition or rendering.
- The 16-flow workspace browser file proves guarded `I`/`O`, exact bounds,
  explicit overlap attachment, status switching, context preflight, split-menu
  behavior, and regression coverage for transcript-driven selection.
- Verification on 2026-08-24: typecheck; 625 aggregate Vitest tests passed with
  4 skipped; 16 Playwright flows passed; cloud migrations applied 37 cleanly;
  local migrations applied 31 cleanly; and the desktop production build passed.
