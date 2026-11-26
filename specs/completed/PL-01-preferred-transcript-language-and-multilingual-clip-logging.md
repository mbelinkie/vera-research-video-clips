# PL-01 — Preferred transcript language and multilingual clip logging

- Status: completed
- Task/thread: PL-01 only
- Product decision date: 2026-08-20
- Completion date: 2026-08-20

## User-visible outcome

A signed-in user can choose a preferred transcript language in account
settings. The research workspace displays and searches a verified transcript in
that language when the source and preferred languages differ. The original
speech and canonical English transcript remain available as separate views.

When that user logs a clip, the durable project record always contains the
native-language text and English text for the selected source-video time range.
If the preference is non-English and is distinct from both the native language
and English, the same atomic log operation also stores the preferred-language
text and its language/track provenance. For example, a Spanish-preferring user
reviewing a Romanian video sees Spanish, while the logged clip contains
Romanian, English, and Spanish. Existing clips never change when the user later
changes their preference.

## Smallest end-to-end proof

Use a deterministic Romanian fixture with time-linked Romanian and English
tracks and a fake Romanian-to-Spanish translation result. Set one user to
Spanish, resolve the Spanish display track through the real contracts/cache
boundary, select a range, run `Queue / log only`, reload the project queue, and
export CSV. The UI, API response, database, and CSV must all show the same
Romanian, English, and Spanish text for the selected time range with exact track
and version identities. No export job is created and the project's active base
transcript remains Romanian plus English.

## Focused context

Read `PROJECT_GUIDE.md`, especially sections 3.4–3.8, 3.14, 5.3–5.4,
6.1–6.7, 7.1–7.4, 8, 10, 13, and 15; read `outline.md`; inspect the existing
contracts, cloud/local migrations, catalog clip commands/CSV, worker transcript
pipeline, translation adapter, local transcript index, research workspace, and
clip queue before editing.

Current constraints that this slice must address rather than work around:

- `TranscriptTrack.kind` is only `original | english`.
- The worker rejects any batch target whose primary language is not English and
  publishes a source-plus-English bundle with fixed English artifact roles.
- Local transcript lookup has separate hard-coded original/English methods.
- A clip candidate stores one selection track/version, `english_text`, and an
  optional `original_text`; the browser currently submits selected English text.
- CSV and the queue render English plus optional original text only.
- `users` has no durable preferred-language setting.

Preserve the established shared-first resolution, immutable publication,
time-linked tracks, authorization, idempotency, offline/sync, and logging-action
invariants.

## Product rules and language matrix

Normalize user input to a valid BCP-47 tag. For this initial feature, language
equivalence uses the normalized primary language so `en`, `en-US`, and `en-GB`
all satisfy the canonical English role and `es`/`es-MX` do not trigger duplicate
Spanish work. Preserve the user's normalized display tag, but use the
provider-supported canonical target code at the adapter boundary.

| Native source | User preference | Display track                      | Logged language roles                                      | Optional preferred fields                     |
| ------------- | --------------- | ---------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Romanian      | English         | English                            | Romanian + English                                         | Absent                                        |
| Romanian      | Spanish         | Spanish translation                | Romanian + English + Spanish                               | Present                                       |
| Spanish       | Spanish         | Original Spanish                   | Spanish + English                                          | Absent                                        |
| English       | Spanish         | Spanish translation                | English native + English canonical + Spanish               | Present                                       |
| English       | English         | English/original                   | English native + English canonical (same track is allowed) | Absent                                        |
| Mixed/unknown | Spanish         | Spanish translation when supported | Original evidence + English + Spanish                      | Present unless equivalence can be established |

The native and English roles may reference the same track and text for an
English source. Do not create or display duplicate transcript tracks merely to
make those logical logging roles distinct.

## Durable decisions

### 1. The preference is user-level, not project-level

Add `preferredLanguage` to the authenticated user's durable profile with
English as the default. Only the user may update their own setting. A preference
change affects future display resolution and future logs; it does not change a
project default, another member's view, a transcription batch's canonical
English target, or existing clip rows.

### 2. Keep source plus English as the active base transcript

Do not repurpose `transcription_batches.target_language`, replace the English
track, or publish a user-specific bundle as the project's active base
transcript. The base transcript remains the immutable source-plus-English
collaboration artifact and retains the current active-version semantics.

Store a non-English translation as a shared immutable derivative keyed to the
exact base transcript version and original track. Add `translation` as a
language-addressed track kind while retaining `english` as an explicit
compatibility/collaboration role. Never add a `preferred` track kind: preference
is viewer-relative and mutable.

Use a derived-translation lineage/version/manifest boundary (or an equivalently
typed aggregate) with:

- project, video, base transcript version, and exact original track/content ID
- normalized target language
- translated track ID/version and `sourceTrackId`
- provider/model and normalization schema versions
- timing precision, object versions/keys, sizes, and SHA-256 checksums
- idempotency key, creator, timestamps, and active/superseded state

Publish through job-scoped staging and transactional finalize. Advancing a
target-language derivative may not move the project's active base transcript
pointer. Equivalent concurrent jobs must adopt or supersede one canonical
result.

### 3. Translate directly from the original track

When the preference differs from native and English, translate the same
original segments separately to English and to the preferred target. If English
already exists, translate original to preferred only. Do not silently pivot
original → English → preferred because that compounds translation error and
obscures provenance. The provider-neutral adapter may serve Amazon Translate or
a future provider.

Before implementation, verify current official Amazon Translate language and
request constraints. Keep capability/error mapping behind the adapter. An
unsupported target, disabled provider, partial provider result, or unavailable
original track becomes an actionable `needs_translation` or
`preferred_translation_unavailable` state; it never receives a mislabeled
English fallback.

### 4. Reuse before generating

Resolve a preferred display track in this order:

1. Original track when its primary language matches the preference.
2. Canonical English track when the preference is English.
3. Exact verified local derived-translation cache hit.
4. Exact authorized project-shared derived-translation hit, downloaded and
   checksum/schema verified into local cache.
5. One idempotent derived-translation job from the original track.

The derived idempotency/cache identity includes the base transcript version,
original track/content identity, normalized target language, provider/model,
and normalization schema. Changing preference must not regenerate the base
transcript or hide still-useful original/English tracks.

### 5. Log role-based language evidence atomically

Add a versioned role-based language-evidence contract for new clip writes:

```ts
type ClipLanguageEvidence = {
  schemaVersion: 2;
  native: ClipLanguageSnapshot;
  english: ClipLanguageSnapshot;
  preferred?: ClipLanguageSnapshot;
};

type ClipLanguageSnapshot = {
  role: "native" | "english" | "preferred";
  language: string;
  text: string;
  trackId: string;
  trackVersion: number;
  sourceTrackId?: string;
  timingPrecision: "word" | "cue" | "estimated";
};
```

Use a child table keyed by `(clip_id, role)` or an equivalently constrained
normalized representation rather than adding an unstructured translations
blob. New clip creation writes the candidate, its native/English/optional
preferred evidence, notes, tags, and sync event in one transaction.

The `preferred` row is legal only when all of the following are true:

- the requesting user's snapshotted preference is non-English;
- it differs from the native primary language;
- its language, nonempty text, track ID, positive version, source-track link,
  and timing precision are all present; and
- its cues/text overlap the exact selected source-video time range.

Keep current `english_text`/`original_text` reads compatible during migration,
but do not fabricate missing track identity for legacy rows. Mark legacy
language evidence explicitly (for example schema version 1) and dual-read it;
new writes use schema version 2 and must satisfy the strict role rules. Do not
rewrite old clips from the user's current preference.

### 6. Map tracks by time, never by segment array index

The visible selection retains stable IDs for the displayed track and one
source-video time range. At logging time, derive native, English, and optional
preferred text by selecting overlapping cues/tokens from the exact snapshotted
tracks and that time range. Provider translations copy source cue boundaries,
but the code must still join by time/source-track identity rather than assume
equal array lengths or ordinals.

### 7. Preferred logging does not expand export subtitle policy

This feature changes transcript display and project logging only. Foreign,
mixed, and unknown exports still require original-language and English SRTs;
confirmed-English omission behavior is unchanged. Do not add a preferred SRT,
soft-subtitle, burn-in, export artifact role, or manifest requirement in PL-01.

## Affected boundaries

- Shared contracts: user profile/update, language normalization, track kind,
  derived-translation manifest/job/result, display resolution, and clip language
  evidence.
- Cloud catalog/API: self-only preference update; authorized derivative
  discovery/staging/finalize; clip create/read/search/CSV mapping; sync events.
- Cloud PostgreSQL: ordered migrations for user preference,
  translation lineages/versions/artifacts, clip evidence, indexes, uniqueness,
  foreign keys, and all-or-none role constraints.
- Local SQLite/cache: ordered migration allowing `translation` tracks and exact
  language lookup; verified derivative cache identity and promotion.
- Worker/providers: remove the assumption that the only possible translation
  target is English while preserving English as mandatory; support one or two
  direct-from-original translations with bounded concurrency, cancellation,
  leases, retries, and no duplicate publication.
- Object storage/sync: immutable derived manifests/artifacts, checksums,
  project authorization, short-lived URLs, and second-workstation reuse.
- Web UI: account setting, preferred-resolution states, language/view selector,
  preferred display/search, time-stable selection, action validation, and queue
  rendering.
- CSV projection: keep English and original columns and add
  `preferred_language`/`preferred_text`; leave both empty for legacy and
  non-third-language clips. Define the same future mapping for Google Sheets,
  but do not implement Sheets in this slice.

## Implementation order

1. Add language normalization/equivalence helpers and strict shared contracts.
2. Add and test forward-only cloud/local migrations, including migration from
   the current empty/current-version databases and conservative legacy reads.
3. Implement self-only preference persistence and API.
4. Implement derived-translation local/shared resolution, worker execution,
   immutable publication, verification, and reuse with fake providers/storage.
5. Make the workspace resolve/display/search the preferred track and expose
   original/English views without duplicate labels.
6. Build role-based clip evidence from the selected time range and persist it
   atomically in both logging actions; update queue/search and CSV.
7. Add browser coverage for the Romanian/English/Spanish path and the equality
   cases, then run broader checks proportional to migrations and shared data.

## Failure states

- Invalid language tags are rejected with a field-level settings error and do
  not change the stored preference.
- A saved preference may remain stored while the current provider is disabled
  or lacks the target. Show native/English views and a clear action to configure
  translation; do not label fallback text as preferred.
- Missing, corrupt, unauthorized, wrong-base-version, wrong-language, or
  checksum-invalid shared derivatives are not cache hits and are never shown.
- Partial, duplicate, empty, or wrong-target provider results fail closed
  without publishing a ready translation.
- Lease loss, cancellation, duplicate delivery, finalize conflict, and upload
  failure preserve the existing verified base transcript and are retry-safe.
- Logging is disabled while any language role required by the matrix is
  unresolved. A failed log creates no partial candidate, evidence row, tag
  assignment, or sync event.
- Offline logging preserves the exact language evidence in the outbox and does
  not recompute it from a later preference during replay.
- A preference change during an active selection must not mix old displayed
  text with new language metadata. Re-resolve the selection from its source
  time range or require reselection before enabling logging.

## Explicit non-goals

- Preferred-language subtitle sidecars, embedding, burn-in, export manifest
  roles, or any change to the M5 original-plus-English subtitle guarantee.
- Automatic translation of previously logged clips or backfilling preferred
  text from a user's current setting.
- A project-wide preferred language, per-project override, per-video preference,
  multiple simultaneous personal preferences, or collaborator preference sync.
- Translating notes, tags, titles, comments, or source metadata.
- Google Sheets implementation, Airtable, or another logging integration;
  define only the future column mapping while updating the implemented CSV.
- Provider-specific shapes in UI/routes/contracts, live AWS calls in the normal
  test suite, or a promise that every BCP-47 language is supported.
- Changing transcription, caption, alignment, export-media, scratch cleanup, or
  subtitle timing semantics beyond what preferred-track resolution needs.

## Acceptance criteria

1. A user preference defaults to English, accepts and returns a normalized
   valid language, survives a new session/workstation, and cannot be changed by
   another user.
2. Romanian + Spanish resolves Spanish by local cache, then authorized shared
   derivative, then exactly one idempotent provider job; each earlier hit
   prevents later work.
3. The finalized Spanish track is `translation`, points to the exact Romanian
   original track, carries Spanish language/provenance, preserves honest
   source-video cue times, and does not change the active Romanian-plus-English
   base version.
4. Spanish-source + Spanish-preference and English-preference cases issue no
   supplemental translation request and show no duplicate view.
5. Romanian + Spanish logging atomically stores native Romanian, mandatory
   English, and preferred Spanish evidence for the same selected time range,
   with exact track/version identities. Queue reload and CSV return all three.
6. Romanian + English and Spanish + Spanish logs contain no preferred evidence;
   English + Spanish contains Spanish preferred evidence while its native and
   English roles may safely reference the same English track.
7. The API/database rejects partial, English, native-equivalent, wrong-track,
   or wrong-target preferred evidence. A rejected request leaves no candidate,
   tags, sync event, or export job.
8. `Queue / log only` still creates no export work. `Export + log` creates the
   clip first, and a later render failure cannot remove any language evidence.
9. Changing the account preference after logging leaves prior clip API/queue/CSV
   output byte-for-byte unchanged for all language text/provenance fields.
10. Existing schema-version-1 clips remain readable/exportable without invented
    preferred or original provenance; new writes use strict schema version 2.
11. A second authorized workstation verifies and reuses the shared Spanish
    derivative without calling the provider; a nonmember cannot discover or
    download it.
12. Existing M5 export subtitle tests remain unchanged in intent and green; no
    preferred SRT or export artifact is produced.

## Verification

Run the narrowest tests first, adding exact file paths after implementation:

```bash
npx vitest run packages/contracts/src/index.test.ts
npx vitest run packages/transcript/src/index.test.ts packages/providers/src/translation-aws.test.ts
npx vitest run packages/db-cloud/src/index.test.ts packages/db-local/src/index.test.ts
npx vitest run packages/catalog/src/index.test.ts apps/cloud-api/src/app.test.ts
npx vitest run apps/worker/src/pipeline.test.ts
npx vitest run apps/web/src/selection.test.ts apps/web/src/clip-queue.test.tsx
npx playwright test tests/e2e/research-workspace.spec.ts
npm run typecheck
npm run format:check
npm run check
git diff --check
```

Normal tests use deterministic fake translation, object storage, and queue
adapters. Keep any authorized Amazon Translate smoke test optional, cost-aware,
and excluded from normal CI. Review the complete diff for accidental base
transcript mutation, English regression, track-index joins, partial clip writes,
preference leakage across users, missing authorization, duplicate provider
work, schema-version ambiguity, and any change to export sidecar policy.

## Implementation prompt

Use the following prompt in the dedicated implementation task:

> Implement the bounded active spec
> `specs/active/PL-01-preferred-transcript-language-and-multilingual-clip-logging.md`.
> Read it completely, then read the focused `PROJECT_GUIDE.md` sections and
> `outline.md` it names. Do not broaden the task or change the M5 export subtitle
> policy. Preserve the source-plus-English active transcript as the shared base;
> add reusable immutable non-English derived translations keyed to the exact
> base/original identity; add a self-only account preferred-language setting;
> display/search the resolved preferred track; and atomically log strict
> native/English/optional-third-language evidence for both logging actions.
> Start with language contracts and forward-only migrations, implement the
> smallest Romanian → English + Spanish vertical proof through real
> cache/catalog/API/UI boundaries, use time linkage rather than array indexes,
> and keep normal tests provider-fake and deterministic. Verify current official
> Amazon Translate constraints before relying on provider behavior. Run the
> narrow checks in the spec before broader checks, inspect the complete diff,
> preserve unrelated work, and update `PROJECT_GUIDE.md`/`outline.md` plus move
> the spec to `specs/completed/` only after the entire slice is implemented and
> verified with actual results.

## Completion record

### Decisions implemented

- Account preferences preserve normalized BCP-47 display tags while initial
  equivalence, derivative deduplication, and provider targeting use the primary
  language. English remains the durable default and only the authenticated user
  can update their profile.
- The source-plus-English transcript remains the active collaboration base.
  Supplemental non-English tracks use `kind: "translation"`, point directly to
  the immutable original track, and live in separately versioned/checksummed
  project derivatives keyed by the exact base, original content, language,
  provider/model, and normalization schema.
- Derived publication uses job-scoped immutable object keys and transactional
  catalog finalization. Equivalent requests share one lineage/job and a losing
  publisher adopts the already-active result without advancing the base pointer.
- A project-shared derivative is accepted into SQLite only after exact identity,
  schema, and SHA-256 verification. A second resolution uses the local cache and
  does not call the shared catalog/provider again.
- New clips use strict language-evidence schema version 2 with normalized child
  rows for native, English, and an optional distinct preferred role. Evidence is
  derived from overlapping source-video cue times, committed with the clip/tags/
  sync event, included exactly in offline commands, and never recomputed from a
  later preference. Legacy version-1 reads retain only their historical English/
  optional original text and invent no track provenance.
- The preferred display is language-generic. The Romanian/English/Spanish path
  is a deterministic demo/test fixture, not a production option list. A separate
  English-to-French-Canadian test proves general target handling; provider
  capability failures return an actionable unavailable state without labeling
  English as the requested language.
- Preferred-language text changes display, search, logging, queue, and CSV only.
  The established original-plus-English export subtitle snapshot and artifact
  policy is unchanged, and no preferred SRT is generated.

### Files changed

- Shared language, derived-translation, account, and strict clip-evidence
  contracts and tests in `packages/contracts`.
- Time-based language evidence, preferred resolution, general supplemental
  translation normalization, and tests in `packages/transcript`.
- Forward-only cloud migration `0009` for account preference, immutable derived
  lineages/versions/artifacts/jobs, and normalized clip evidence; forward-only
  local migration `0013` for exact verified derivative cache identity.
- Cloud catalog/API persistence, authorization, derivative publication/reuse,
  clip dual-read/strict-write behavior, and CSV projection with integration
  coverage.
- Local cache promotion/verification and shared-to-local/offline-sync coverage.
- Direct-from-original worker execution with deterministic provider/publication
  fakes; the existing Amazon adapter and normal offline test policy did not need
  a provider behavior change.
- Workspace account setting, generic language resolution/view selector,
  time-stable selection, logging validation, multilingual queue display/search,
  fixture, and Playwright coverage.
- `PROJECT_GUIDE.md`, `outline.md`, and this completion record.

### Checks run and actual results

- Focused contracts/transcript/database/catalog/API/worker/sync runs: all green;
  the final focused run passed 40 tests across 4 files.
- `npm run typecheck`: passed.
- `npm run test`: 150 passed and 1 skipped across 24 test files (23 passed, 1
  skipped).
- `npm run build:web`: passed; Vite built 105 modules.
- `npm run db:migrate:local:test`: `Local migrations valid (13 newly applied)`.
- `npm run db:migrate:cloud:test`: `Cloud migrations valid (9 newly applied)`.
- `npm run test:e2e`: 4 passed, including the extended Romanian/English/Spanish
  selection, language-switch, strict log, queue reload/search, and preference-
  change proof.
- `git diff --check`: clean.
- `npm run format:check` and therefore the aggregate `npm run check` stop on the
  pre-existing unrelated dirty `docs/Script-to-Resolve Product Spec.md`. PL-01
  files were formatted directly and that user-owned document was preserved
  exactly as required; every later `check` stage was run individually and
  passed with the results above.

### Manual verification

The browser-level interaction was verified through Playwright against the real
workspace components and loopback Vite server: save `es-MX`, load the Romanian
fixture, search Spanish, select 0–4 seconds, switch to English and back without
losing the source-time range, log without export work, reload/search the queue,
and then change the preference while the saved Spanish evidence remains. No
live Amazon or YouTube call was required or made.

### Compatibility impact

- Cloud migration `0009` gives existing users the English default and existing
  clip rows language-evidence schema version 1. It does not rewrite historical
  text or provenance. New writes require schema version 2.
- Local migration `0013` only adds the derivative cache and exact-identity
  indexes. Existing base transcript cache rows and active base versions are
  unchanged.
- The compatibility `english_text`/`original_text` columns remain populated for
  new clips and readable for old clips; structured evidence is authoritative
  for new multilingual reads.
- Existing M5 subtitle contracts, sidecar tests, manifests, and artifact roles
  are unchanged.

### Remaining risks and follow-ups

- The current browser workspace still demonstrates transcripts from repository
  fixtures; production transcript loading must supply its resolved translation
  collection through the same generic view/evidence boundary.
- The derived job table carries attempt and lease fields for durable execution,
  while this bounded slice proves worker execution through the deterministic
  direct-from-original function and idempotent publication rather than a new
  unattended translation-only polling service. A dedicated control-plane loop
  may be added when supplemental translation volume requires it.
- Search across all clip languages is implemented in the loaded project queue;
  server-side full-text multilingual indexing remains a later scale feature.
- Google Sheets stays intentionally unimplemented; its future mapping is the
  CSV mapping plus optional preferred language/text columns.

### Commit ID(s)

- Reported in the task handoff after the single PL-01 commit that also moved
  this spec to `specs/completed/`.
