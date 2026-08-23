# Pilot punch list

This is the intake and triage ledger for defects and enhancements discovered
while exercising the product before the independent pilot. It is not an active
implementation spec and does not authorize provider access, deployment, or a
single unbounded cleanup task.

Add new observations as stable `PUNCH-###` entries. Before implementation,
group related entries by shared behavior and promote each bounded vertical
slice into `specs/active/` with its own acceptance evidence. Preserve unrelated
entries here until they are deliberately completed or deferred.

## Status and priority

- Status: `proposed | triaged | accepted | in_progress | completed | deferred`
- Priority: `P0 critical | P1 high | P2 medium | P3 low`
- Completion requires a linked completed spec and verification record, not only
  a code change.

## Open items

### PUNCH-001 — Conflicting source-language evidence and unsupported-language recovery

- Status: `triaged`
- Priority: `P1 high`
- Area: transcript acquisition, language provenance, translation, review
- Discovered by: M6 real-source exit-gate preparation

#### Problem

The caption adapter can promote a provider-declared automatic `*-orig`
language directly into the canonical original track. A real authorized source
exposed a conflict: creator-supplied context identified the speech as Dzongkha,
while YouTube/yt-dlp exposed a Korean-original automatic-caption candidate and
Korean-script ASR output. Relabeling that output as Dzongkha would preserve
neither the original speech nor honest provenance.

The current batch UI can request `Force generation`, but it cannot persist a
researcher-confirmed source language. The worker does not carry such a decision
into source resolution or speech recognition, the initial Whisper adapter does
not support every BCP-47 language, the initial translation adapter does not
support every source language, and there is no ordinary user-facing path to
import an accurate timed original transcript plus linked English evidence.

Without a conflict gate, the application can publish and reuse an immutable but
incorrect source-language track, derive an English translation from bad ASR,
and carry the false language into clip logs, subtitle policy, manifests, and
authoring compatibility.

Do not retain the external reproduction URL, downloaded captions, transcript
text, or smoke descriptor in the repository. The authorized temporary evidence
was deleted after the mismatch was confirmed.

#### User-visible outcome

A researcher can see when provider language evidence conflicts with trusted
creator or human evidence, confirm or correct the spoken language, reject an
unusable automatic caption, and continue through a supported transcription or
timed-transcript import path. The application never presents a relabeled bad
ASR track as original speech and never publishes it silently.

If no configured transcription or translation provider supports the resolved
language, the item remains useful and recoverable in an explicit
`needs_language_confirmation`, `needs_transcript`, or `needs_translation`
state. The UI explains the available remediation without acquiring expensive
media unnecessarily.

#### Current evidence and seams

- `packages/providers/src/captions-local.ts` strips `-orig` and maps the
  provider code directly into `CaptionTrackCandidate.language`.
- `packages/providers/src/index.ts` ranks that candidate as canonical source
  evidence and does not represent language confidence or disagreement.
- `apps/worker/src/pipeline.ts` resolves a batch without a persisted human
  source-language decision and invokes speech recognition without a language
  override.
- `packages/providers/src/speech-whisper-cpp.ts` can accept a language hint, but
  the current worker path does not supply one and the provider has a bounded
  supported-language set.
- `ClipLanguageEvidenceV2` and export preflight already preserve immutable
  native/English track identities and safely represent `und` as unknown and
  `mul` as mixed. Reuse those downstream semantics rather than inventing a
  second export-language model.
- Immutable transcript publication, active-version pointers, shared download,
  and second-workstation cache reuse already exist and must remain the only
  canonical publication path.

#### Scoped fix

1. **Language-evidence contract**
   - Separate `providerReportedLanguage` from `resolvedLanguage`.
   - Add a closed decision status:
     `unverified | confirmed | conflict | unknown | mixed`.
   - Add a bounded decision-basis enum covering provider metadata, creator
     metadata, user confirmation, speech detection, and manual transcripts.
   - Preserve provider track identity and raw-caption hash independently of the
     resolved language. Do not treat description text as automatically trusted
     structured metadata.
   - Include the exact decision/version in transcription idempotency and
     immutable manifest provenance.

2. **Durable correction and authorization**
   - Add an append-only, project-authorized language-decision record or
     equivalent versioned project-video evidence; do not overwrite provider
     claims or already-published transcript versions.
   - Snapshot the chosen decision on the batch item/job before claim so replay,
     retry, and another workstation observe the same input.
   - Require project write authorization for confirmation/correction and retain
     actor/time/version audit evidence without exposing it in public artifacts.

3. **Conflict-aware source resolution**
   - Treat conflicting automatic-caption evidence as `needs_user_action` before
     translation or publication.
   - Permit a verified language correction for a correctly authored/manual
     caption while preserving the rejected provider label.
   - When the automatic caption text itself is incompatible with the confirmed
     language, reject the caption and route to supported speech recognition or
     timed-transcript import. Never fix it by changing only the language tag.

4. **Provider capability preflight**
   - Let speech and translation adapters advertise or validate supported
     languages through their typed boundaries.
   - Pass a confirmed source language to speech recognition only when the
     provider supports that language; otherwise fail before media acquisition
     with a bounded actionable state.
   - Resolve English only from the accepted original track. If automatic
     translation is unsupported, allow linked supplied English evidence or
     remain in `needs_translation`.

5. **Timed bilingual transcript import**
   - Add a project-authorized import path for bounded UTF-8 VTT/SRT or the
     canonical normalized schema, with explicit original language and
     provenance.
   - Validate cue ordering, bounds, text, file size, schema, hashes, and exact
     English-to-original linkage. Import creates a new immutable transcript
     version through staging and transactional finalize; it does not edit an
     existing object in place.
   - Keep local paths and raw parser/provider errors out of cloud responses,
     events, diagnostics, and support data.

6. **Researcher review UI**
   - Show provider-reported and resolved language separately when they differ.
   - Offer `Confirm language`, `Choose another caption`,
     `Force supported transcription`, and `Import timed transcript`
     remediation as capabilities allow.
   - Preview original and English cues side by side before activation, including
     timing precision and provenance.
   - Activating a corrected version is explicit; legacy or rejected versions
     remain in history and are never silently rewritten.

7. **Downstream preservation**
   - Continue using the existing native/English clip evidence, subtitle-policy,
     artifact-history, and authoring-compatibility contracts after a corrected
     version becomes active.
   - Treat unresolved/conflicting language as unknown for export safety so
     English-only subtitle omission cannot be enabled accidentally.

#### Suggested implementation slices

1. Add versioned language decisions, conflict-aware caption selection, provider
   capability preflight, and the `needs_language_confirmation` UI path.
2. Add strict timed original/English transcript import through the existing
   immutable upload/finalize boundary.
3. Add side-by-side approval/activation, second-workstation reuse, and complete
   clip/export regressions for corrected versions.

These slices form one product enhancement but should remain independently
reviewable and migration-safe.

#### Acceptance checks

1. A provider reporting Korean while a write-authorized user confirms Dzongkha
   creates a durable conflict and performs no translation or publication.
2. A Korean-script automatic ASR result cannot be adopted merely by relabeling
   its track `dz`.
3. A manual caption with a wrong provider label can be corrected only through a
   versioned decision while retaining its provider claim and byte identity.
4. Unsupported speech or translation languages fail before unnecessary media
   acquisition and expose a bounded remediation state.
5. A valid timed Dzongkha original plus linked English import finalizes one new
   immutable bundle, can be explicitly activated, and is reused checksum-first
   by a second authorized workstation.
6. Invalid/mismatched language, cue timing, track linkage, schema, hash, or
   authorization fails without an active-version change or partial bundle.
7. Existing wrong/legacy transcript versions remain readable historical
   evidence and can be superseded, never mutated or silently deleted.
8. A corrected selected range logs exact native and English snapshots and
   produces the required clip-relative bilingual subtitle set.
9. Provider claims, transcript text, URLs, local paths, credentials, and raw
   tool output do not leak through diagnostics or failure responses.
10. Deterministic conflict, manual-import, duplicate replay, concurrent
    finalize, activation, offline cache, and browser tests pass alongside the
    existing shared-transcript and export suites.

#### Non-goals

- Claiming that the initial Whisper or Amazon Translate adapter supports every
  language.
- Automatically trusting free-form video descriptions as canonical language
  metadata.
- Automatically translating or repairing a transcript whose source text is
  already incompatible with the confirmed language.
- In-place editing of immutable published transcript bundles.
- A general transcript editor, subtitle-authoring suite, or new media executor.
- M7 desktop integration, provider/model setup, production deployment, or live
  source access as part of this fix; M8 packaging/distribution also remains
  outside this fix.

## Entry template

### PUNCH-XXX — Short title

- Status: `proposed`
- Priority: `P2 medium`
- Area:
- Discovered by:

#### Problem

Describe observed behavior and its consequence. Keep secrets, credentials,
private research content, and unnecessary source identity out of this file.

#### User-visible outcome

Describe what the user should be able to do and the honest failure state.

#### Current evidence and seams

- Link relevant contracts, migrations, code, tests, or sanitized reproduction
  evidence.

#### Scoped fix

1. Name the smallest complete behavior and affected boundaries.

#### Acceptance checks

1. State a deterministic proof, including failure/restart/authorization cases
   where relevant.

#### Non-goals

- State what this entry must not expand into.
