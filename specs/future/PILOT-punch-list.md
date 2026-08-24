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
- Priority: `unassigned | P0 critical | P1 high | P2 medium | P3 low`
- Completion requires a linked completed spec and verification record, not only
  a code change.

## Prioritization and dependency plan

Priority describes pilot value and urgency; it is not a promise to implement
the numbered entries in heading order. Implementation follows the dependency
waves below, and each wave must still be promoted into one or more bounded
active specifications before code changes begin.

### Sequencing decision

- Complete M7-05 export integration and its deterministic packaged-app
  regression/smoke evidence before reorganizing the workspace or changing the
  established selection/export surfaces.
- Do not wait for full M7-06 dogfood to begin PUNCH-001 through PUNCH-008 or
  PUNCH-010.
  M7-06 depends on external production-cloud, model-pin, and authorized-source
  inputs; it remains a validation stream and final M7 exit gate rather than a
  technical prerequisite for the new project, worklist, keyword, UI, logging,
  comment, or topic contracts.
- M7-01 production AWS/Cognito acceptance likewise remains an explicit external
  prerequisite for real-cloud proof, not a blocker for deterministic contract,
  migration, repository-fixture, or packaged-app implementation.
- Run a short fixture-backed baseline regression after M7-05, then dogfood the
  expanded VERA workflow again before signed-pilot distribution. Any available
  authorized live-source evidence supplements rather than replaces the
  deterministic gates.

### Priority map

| Entry     | Priority    | Pilot role                                                                                       |
| --------- | ----------- | ------------------------------------------------------------------------------------------------ |
| PUNCH-001 | `P1 high`   | Integrity gate for language-dependent scans, logs, and exports.                                  |
| PUNCH-002 | `P2 medium` | Product identity and shell integration; important, but it composes higher-priority authorities.  |
| PUNCH-003 | `P1 high`   | Authorization and identity foundation for administration, keywords, mentions, and collaboration. |
| PUNCH-004 | `P1 high`   | Canonical high-volume research worklist and triage backbone.                                     |
| PUNCH-005 | `P1 high`   | Primary fifty-video relevance workflow and shared keyword evidence.                              |
| PUNCH-006 | `P1 high`   | Usability and maintainability required to expose the new workflow coherently.                    |
| PUNCH-007 | `P2 medium` | Important expansion beyond transcript-driven logging, after the worklist baseline is stable.     |
| PUNCH-008 | `P1 high`   | Essential collaborative research context and safe Script to Timeline handoff.                    |
| PUNCH-009 | `P3 low`    | Unprioritized M8 discovery/platform/AI candidates after the core pilot workflow.                 |
| PUNCH-010 | `P1 high`   | Optional clip topics for research organization and script-building retrieval.                    |

Within `P1 high`, the dependency waves below are authoritative. A later-numbered
P1 entry may begin before an earlier-numbered P2 entry, and an entry may be
split across waves when it contains both foundation and integration work.

### Cross-entry dependency map

| Entry     | Depends on                                                                                                                    | Enables or constrains                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PUNCH-001 | Existing transcript/provider boundaries                                                                                       | Must precede authoritative PUNCH-005 scans and language-dependent player-range export claims.                               |
| PUNCH-002 | PUNCH-003 project summaries/roles and PUNCH-006 component/layout boundaries                                                   | Supplies the visible shell and destinations used by the final Workbench and Project Settings.                               |
| PUNCH-003 | Existing centralized authentication/catalog authorization                                                                     | Its handles, role matrix, and project summaries precede administrative PUNCH-004/PUNCH-005 commands and PUNCH-008 mentions. |
| PUNCH-004 | PUNCH-003 authorization foundation and completed M7-04 transcript supervision                                                 | Becomes the canonical row/notification authority consumed by PUNCH-005, PUNCH-006, and PUNCH-008.                           |
| PUNCH-005 | PUNCH-001 language integrity, PUNCH-003 keyword permissions, and PUNCH-004 project-video identity                             | Supplies durable relevance summaries, filters, context, and highlighting to the Workbench.                                  |
| PUNCH-006 | Slice 1 follows M7-05; final layout composes PUNCH-002, PUNCH-004, and PUNCH-005                                              | Provides bounded UI seams for PUNCH-007/PUNCH-008/PUNCH-010 without changing their domain authority.                        |
| PUNCH-007 | Existing M7-05 selection/export behavior; atomic initial-comment completion depends on PUNCH-008 comment core                 | Extends worklist and Clip Library reads with manual range and structured speech state.                                      |
| PUNCH-008 | PUNCH-003 stable handles/authorization and PUNCH-004 activity receipts; its core comment transaction is required by PUNCH-007 | Supplies collaborative context, no-speech explanation, and immutable authoring snapshots.                                   |
| PUNCH-009 | Stabilized core pilot contracts; platform-neutral source identity must be its first slice                                     | Keeps each new provider or AI capability separate from literal evidence and human authority.                                |
| PUNCH-010 | Existing project-scoped clip tags and M6 authoring handoff; visible workflow composes PUNCH-006                               | Gives Clip Library and Script to Timeline a shared topic vocabulary without coupling it to comments or scan keywords.       |

### Implementation waves

0. **Close the active baseline.** Complete M7-05 through its bounded active
   specification, then run the deterministic packaged-app regression/smoke
   needed to establish a known-good transcript, selection, export, Clip Library,
   and recovery baseline. Do not make M7-06 external/live completion a gate.
1. **Protect language integrity.** Implement PUNCH-001 before publishing new
   language-dependent keyword evidence. Its bounded contract/migration work may
   proceed independently of later UI decomposition, but the conflict gate must
   be complete before PUNCH-005 scan acceptance.
2. **Create safe UI seams.** Implement only PUNCH-006 slice 1: decompose the
   oversized workspace behind unchanged behavior and existing browser tests.
   Do not perform the visible redesign or manufacture future worklist state in
   components.
3. **Establish collaboration authority.** Implement PUNCH-003 slice 1: handles,
   project kind/visibility, new roles, legacy compatibility, project summaries,
   migrations, and the closed permission matrix. This is the authorization
   foundation; invitations, discovery, and complete settings UI may follow in a
   later wave.
4. **Replace the inbox authority.** Implement PUNCH-004's canonical
   project-video rows, per-user flags, unified direct/bulk ingest, independent
   state axes, claims/review cycles, priority, dismissal/restore, bounded reads,
   and durable activity receipts. Compose existing transcription batches/jobs;
   do not replace them.
5. **Deliver shared relevance.** Implement PUNCH-005 keyword/alias governance,
   suggestions, deterministic multilingual scanning, versioned private match
   artifacts, aggregate summaries, stable groups, context, highlighting, and
   rescan behavior on the canonical worklist.
6. **Assemble the VERA interface.** Combine PUNCH-002 with PUNCH-006 slices
   2–4: add the persistent shell, Project Settings/account destinations,
   responsive 1440×900 Workbench, worklist/keyword integration, separate Clip
   Library, fast clip opening, and navigation restoration. Branding work must
   not absorb authorization or data authority from PUNCH-003–005.
7. **Add the comment foundation.** Implement PUNCH-008 slice 1 and the atomic
   first-comment portion of slice 2, reusing PUNCH-003 identity and PUNCH-004
   activity receipts. Preserve Clip description as separate curated metadata.
8. **Add manual-range logging.** Implement PUNCH-007 across player-range
   selection, guarded shortcuts, transcript attachment, structured speech
   status, required description/initial comment, no-speech subtitle provenance,
   transcript-unavailable blocking, and split-button actions.
9. **Complete the authoring conversation and topic organization.** Finish
   PUNCH-008 offline replay, mentions/follows, search/activity, stable comment
   export, and authorized Script to Timeline live-thread plus explicit
   immutable snapshot handoff. Implement PUNCH-010 topic entry, filtering,
   grouping, authoring reads, and build-snapshot compatibility on the existing
   project-scoped clip-tag authority.
10. **Finish governance and collaboration policy.** Complete PUNCH-003
    invitations/open discovery/ownership/settings/audit slices and any remaining
    PUNCH-004 automatic-processing, budget, cancellation, notification, and
    multi-user acceptance work not required by earlier vertical slices.
11. **Validate the expanded pilot workflow.** Exercise migrations, two-user
    authorization/concurrency, fifty-video keyword triage, no-speech logging,
    comments, optional topic tagging, topic-driven script retrieval,
    restart/offline behavior, export/recovery, and 1440×900 plus responsive UI.
    Run authorized real-cloud/live-source M7-06 evidence when its external
    inputs are available; otherwise retain the explicit external blocker
    without stalling deterministic work.
12. **Treat PUNCH-009 separately in M8.** Generalize source identity first, then
    prioritize YouTube search, each additional platform, AI discovery,
    contextual relevance, and visual annotations as independent candidates.
    None silently displaces signing, updater, documentation, diagnostics, or
    independent-QA obligations.

## Open items

### PUNCH-001 — Conflicting source-language evidence and unsupported-language recovery

- Status: `completed` — all three slices completed 2026-08-24
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

1. **Completed 2026-08-24:** add versioned language decisions, conflict-aware
   caption selection, provider capability preflight, and the
   `needs_language_confirmation` UI path. See
   `../completed/PUNCH-001A-language-decision-conflict-gate.md`.
2. **Completed 2026-08-24:** add strict timed original/English transcript import
   through the existing immutable upload/finalize boundary. See
   `../completed/PUNCH-001B-timed-bilingual-transcript-import.md`.
3. **Completed 2026-08-24:** add side-by-side approval/activation,
   second-workstation reuse, and complete clip/export regressions for corrected
   versions. See
   `../completed/PUNCH-001C-corrected-transcript-review-activation.md`.

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

### PUNCH-002 — VERA identity and application shell

- Status: `completed` — VERA shell and project destinations completed 2026-08-24
- Priority: `P2 medium`
- Area: product identity, application shell, project navigation, account settings
- Candidate window: after the M7-05 deterministic baseline and before signed-pilot work
- Depends on: PUNCH-003 foundation and PUNCH-006 component/layout boundaries
- Discovered by: pilot workflow and interface planning

#### Problem

The current renderer presents setup, account preference, video loading, research,
batch processing, review, and clip-library controls as a long workspace headed
by implementation-oriented labels such as `Research video workspace` and
`Navigate video by transcript`. Project choice and account settings are repeated
inside the page rather than expressed through a durable application shell. The
result does not communicate the relationship between the research product and
its authoring companion, makes the active project difficult to verify at a
glance, and consumes vertical space needed to keep the queue, transcript, and
player visible together.

Language tags are also shown inconsistently as raw BCP-47 values. Reducing them
to two letters would lose meaningful script or region information, while raw
tags alone are not readable enough for ordinary users.

#### User-visible outcome

The broader suite is branded **VERA — Video Essay Research and Authoring**. This
application remains **Research Video Clips**, and the authorized authoring
companion is named **Script to Timeline**. Research Video Clips opens into a
persistent project-aware shell: the active project is visible at upper left,
Workbench and Clips are first-class project destinations, and the signed-in
user plus unread activity count appear at upper right.

The project control distinguishes personal and shared projects, remembers the
most recently used authorized project, supports project creation, and never
conceals the target used by a logging action. The account menu contains personal
preferences such as preferred transcript language; project governance remains
in Project Settings. Language choices use readable labels such as `Spanish
(es)` and `French (Canada) (fr-CA)`.

#### Current evidence and seams

- `apps/web/src/main.tsx` owns the current top bar, preferred-language form,
  loader, workspace, selection actions, and batch-workspace composition in one
  large component.
- `apps/web/src/desktop-setup.tsx` combines first-run readiness and project
  setup concerns that should not occupy the ordinary workbench permanently.
- `ProjectSchema` does not return the current member role, project kind,
  visibility, member count, or per-user recency needed by the proposed selector.
- `UserSchema` already owns `displayName` and `preferredLanguage`; it has no
  unique collaboration handle.
- The companion authoring product already uses the authorized clip/history/
  artifact handoff. VERA branding must not introduce direct cross-application
  database access or change artifact authority.

#### Scoped fix

1. **Suite and product identity**
   - Use `VERA` as the suite mark and `Research Video Clips` as this product's
     name in the shell, desktop title, and user-facing help.
   - Use `Script to Timeline` for the companion product in new UI and planning
     records. Treat existing Script-to-Resolve names as an explicit later
     documentation/code-identity migration; do not rename dirty or unrelated
     documents mechanically.
   - Preserve the current package names, API boundaries, database ownership,
     and immutable artifact identity until a bounded rename spec says otherwise.

2. **Persistent application shell**
   - Put the active-project selector at upper left, project destinations in the
     center, and the user's display name plus notification badge at upper right.
   - Provide `Workbench` and `Clips` project destinations and a role-aware
     `Project Settings` destination.
   - Move preferred language, personal/local settings, and sign-out into the
     account menu. Keep membership, visibility, keywords, and review policy in
     Project Settings.

3. **Project selection and recency**
   - Return a bounded project summary containing kind, visibility, current
     membership role, member count, and stable project identity.
   - Remember the last authorized project per account/install and validate
     membership before restoring it. Fall back to an explicit no-project state
     rather than silently targeting a stale or inaccessible project.
   - Group personal and shared projects visually. Project creation chooses an
     explicit kind and never implies that a one-member shared project is
     personal.
   - Continue showing the active project beside every logging command even when
     the global selector preselects it.

4. **Language presentation**
   - Add one shared BCP-47 display formatter that preserves the normalized full
     tag, uses localized language/region/script names when available, and has a
     deterministic fallback.
   - Use the formatter in account preferences, transcript views, worklist rows,
     clip evidence, keyword aliases, and export language summaries.

#### Suggested implementation slices

1. Add the read-only project-summary and language-label contracts, then render
   the VERA shell without moving feature ownership.
2. Move account and project settings into their final destinations and add safe
   recent-project restoration.
3. Complete the Workbench/Clips navigation after PUNCH-006 defines the contained
   layouts and manual viewport acceptance.

#### Acceptance checks

1. The shell identifies VERA, Research Video Clips, the active project, the
   current destination, the user's display name, and unread count without
   requiring vertical scrolling.
2. Personal and shared projects are visibly grouped; switching projects clears
   stale video, transcript, selection, and clip state before loading the new
   authorized context.
3. Restart restores only a still-authorized recent project. Removed membership
   produces an explicit project choice and never leaks cached project content.
4. Both logging actions still show and require their project destination; the
   projectless export-only command remains distinct.
5. Account settings contain preferred language and sign-out, while project
   administration is unavailable there and is role-gated in Project Settings.
6. Language labels preserve normalized tags and distinguish regional/script
   variants in deterministic unit and browser tests.
7. Script to Timeline continues to consume authorized APIs and verified
   artifacts rather than sharing a database connection.

#### Non-goals

- Renaming package scopes, repository directories, database tables, or every
  historical document as part of shell work.
- Combining Research Video Clips and Script to Timeline into one executable.
- Hiding the active project because a recent project was restored.
- Changing project permissions, comments, keyword scans, or worklist authority
  inside this shell-only entry; those belong to the following entries.

### PUNCH-003 — Project kinds, membership, and access governance

- Status: `in_progress` — identity/authority foundation completed 2026-08-24
- Priority: `P1 high`
- Area: projects, identity, membership, invitations, authorization, audit
- Candidate window: after the M7-05 deterministic baseline and before signed-pilot work
- Depends on: existing centralized authentication/catalog authorization
- Discovered by: collaborative project and project-keyword planning

#### Problem

Projects currently have one implicit shared shape and roles
`owner | editor | researcher | viewer`. Only the owner can manage membership,
while editor and researcher have the same broad write permission. The catalog
has no explicit personal-project kind, open-versus-invitation visibility,
unique user handles, pending invitations, self-join flow, ownership transfer,
or durable governance audit. The UI therefore cannot safely distinguish a
private personal workspace from a shared project or support the requested
Administrator/Researcher model.

Simply renaming roles would be unsafe. Promoting legacy Editors automatically
to Administrator would grant new membership and keyword powers; allowing all
Administrators to manage one another could remove the final trusted authority.
Making an open project readable before membership would also expose project or
transcript existence across an access boundary.

#### User-visible outcome

Users create either a private personal project or a shared project. A personal
project has only its Owner and can convert once to shared; it never becomes
shared merely because of a display heuristic. Shared projects are either
invitation-only or discoverable/open-to-join. An authenticated user may discover
an open project and explicitly join as a Researcher, but receives no project
content before membership exists.

Each shared project has one protected Owner, zero or more Administrators, and
Researchers. The Owner alone manages Administrator access and ownership
transfer. Administrators invite, remove, and manage Researchers and control
project triage and keywords. Invitations addressed to a unique `@handle` require
acceptance before membership begins and arrive in the in-app activity inbox.

#### Current evidence and seams

- `ProjectRoleSchema` and `packages/auth/src/index.ts` currently map owner,
  editor, researcher, and viewer to coarse read/write/manage-members permissions.
- `project_members` has a stable project/user key and optimistic version but no
  invitation or role-history records.
- `ProjectSchema` stores only name, description, version, and timestamps.
- `UserSchema` stores display name and preferred language but no unique handle;
  member creation currently requires a raw user UUID.
- Project authorization is centralized in the catalog/auth packages, which is
  the correct boundary for the new permission matrix.

#### Scoped fix

1. **Project kind and visibility**
   - Add immutable-at-creation `personal | shared` project kind. Permit only the
     Owner to perform an audited, optimistic, one-way personal-to-shared
     conversion.
   - Add shared-project visibility `invitation_only | open_to_join`, defaulting
     to invitation-only. Personal projects are always private.
   - Expose only bounded discovery fields for open projects. Require an explicit
     join transaction before any videos, transcripts, clips, members, keywords,
     or activity are readable.

2. **Identity and invitations**
   - Add a normalized, unique, case-insensitive `@handle` alongside the mutable
     display name. Store stable user IDs on all relations so later handle or
     display-name changes do not break identity.
   - Create expiring, idempotent pending invitations addressed to an existing
     handle, with inviter, proposed role, state, timestamps, and optimistic
     version. Acceptance creates membership transactionally; rejection or
     revocation creates no access.
   - Do not reveal private project membership or content while resolving an
     invalid/unauthorized handle or invitation.

3. **Permission matrix and safeguards**
   - Use `owner | administrator | researcher` for new memberships. Open self-join
     always creates Researcher access.
   - Owner: all project powers, Administrator management, ownership transfer,
     and personal-to-shared conversion.
   - Administrator: manage Researcher invitations/removal, approved keywords,
     review policy, priorities, dismissal/restoration, and ordinary research
     work; cannot create/remove Administrators or transfer ownership.
   - Researcher: flag/ingest videos, perform permitted reviews, log/comment on
     clips, and suggest keywords; cannot change governance or administer triage.
   - Require an accepted successor before ownership transfer and prevent the
     Owner from leaving or being removed without transfer.

4. **Legacy compatibility and audit**
   - Migrate legacy Editors to Researcher to avoid privilege escalation unless
     the Owner deliberately promotes them later.
   - Preserve legacy Viewers as compatibility-only read memberships, omit Viewer
     from new assignment choices, and require deliberate reassignment/removal.
   - Add append-only governance events for project-kind/visibility changes,
     invitations, joins, removals, role changes, and ownership transfer. Events
     retain actor/target IDs and safe display snapshots without credentials.

#### Suggested implementation slices

1. **Completed:** add handles, project kind/visibility, new roles, migrations,
   authorized project summaries, and the closed authorization matrix while
   retaining safe legacy reads
   (`specs/completed/PUNCH-003A-identity-project-authority-foundation.md`).
2. Add pending invitations, acceptance/rejection/revocation, open discovery,
   explicit self-join, and in-app invitation notices.
3. Add Project Settings, personal-to-shared conversion, ownership transfer,
   member administration, and complete audit/activity views.

#### Acceptance checks

1. A personal project is owner-only, undiscoverable, and cannot accept members
   until its Owner completes the one-way shared conversion.
2. An invitation-only project reveals nothing to a nonmember; a pending invite
   reveals only its bounded invitation summary and grants no content access.
3. An open project is discoverable, but its videos/transcripts/clips remain
   denied until explicit self-join atomically creates Researcher membership.
4. Only the Owner can promote/demote Administrators or transfer ownership;
   Administrators can manage Researchers but cannot strand the project.
5. Invitation acceptance/rejection/revocation and exact duplicate replay are
   idempotent; stale versions conflict without duplicate memberships.
6. Handles are unique case-insensitively and mentions/invitations remain bound
   to stable user IDs after display-name changes.
7. Legacy Editors receive no new administrative authority and legacy Viewers
   remain readable without becoming selectable new roles.
8. Every governance mutation has authorization, migration, concurrency, and
   sanitized audit tests.

#### Non-goals

- Anonymous/public project content or link possession as authorization.
- Email invitations, operating-system notifications, or external directory
  synchronization in the first collaboration version.
- Reverting a shared project to personal after collaborators gained access.
- Real-time presence or conflict-rich collaborative editing beyond the bounded
  soft review claim in PUNCH-004.

### PUNCH-004 — Canonical project-video worklist and bulk triage

- Status: `in_progress` — canonical worklist/flag/ingest,
  claims/review-policy/priority, dismissal/cancellation/activity, explicit
  paid-hosted approval, and automatic local-processing slices completed
- Priority: `P1 high`
- Area: ingest, project videos, transcription orchestration, review, triage, activity
- Candidate window: after the M7-05 deterministic baseline and before signed-pilot work
- Depends on: PUNCH-003 authorization foundation and completed M7-04 transcript supervision
- Discovered by: high-volume keyword-driven research workflow planning

#### Problem

The current user-facing queue is derived from transcription batch items and only
becomes a review inbox after an item reaches `ready_for_review`. It does not
represent every video intentionally flagged for a project, direct and bulk
ingest as one worklist, multiple researchers' interest in the same source,
review ownership, administrative review requirements, dismiss/restore triage,
or per-video clip and keyword summaries.

This is the wrong authority for a workflow that may add fifty videos, process
them in the background, and dismiss most without watching them. Batch items are
processing attempts; project videos are the durable research collection. Hard
deletion would also be unsafe when a source has multiple flaggers, active work,
an immutable transcript, clips, or audit history.

#### User-visible outcome

Every active project has one canonical video worklist covering direct URL ingest
and bulk newline/CSV submissions. Adding an existing project source records the
new researcher's flag rather than creating a duplicate row. Shared transcript
reuse, accessible captions, and configured local Whisper work start
automatically within resource limits; paid hosted work waits for Administrator
approval or a configured project budget.

Queue rows expose processing, review, triage, priority, review policy, keyword
scan, clip count, and current-user history as independent facts. Researchers can
soft-claim work and complete ordinary reviews. Administrators can require
Administrator completion, set priority, and bulk dismiss/restore sources.
Reviewed and Dismissed remain recoverable, audited views rather than destructive
dead ends.

#### Current evidence and seams

- `project_videos` already provides the project/video identity and active
  transcript pointer but lacks flagger, lifecycle, review-event, priority,
  claim, and dismissal records.
- `transcription_batch_items` combines processing stage and review status and is
  currently the source of `Ready for review` UI rows.
- Direct `addVideo` and batch creation can converge on the same project/video;
  a new worklist must preserve batch/job idempotency rather than duplicate it.
- Clip candidates already reference `catalogVideoId`, so clip counts can be
  aggregated without deriving worklist identity from clips.
- Existing batch pause/resume/cancel-unstarted/retry and worker lease behavior
  remain the processing controls to compose, not replace.

#### Scoped fix

1. **Canonical worklist identity and flags**
   - Add project-video worklist state independent of transcription attempts.
   - Add one durable flag per project/video/user with created time and active
     state. Duplicate ingest restores/adds the flag and returns the existing
     project-video row; it never creates a duplicate research item.
   - Display `Flagged by Alice +2` from authorized member summaries. Removing a
     user's own flag stops their flag-derived notifications but does not remove
     the shared video.

2. **Independent state axes**
   - Processing: exact shared transcript/job stage and actionable failure state.
   - Review: unreviewed, actively/softly claimed, or reviewed, with append-only
     review cycles and reviewer/time evidence.
   - Triage: active or dismissed, with actor/time/reason and restore history.
   - Completion policy: Researcher-or-Administrator or Administrator-only.
   - Priority: high, normal, or low, independent of the worker's immutable batch
     priority snapshot.
   - Scan: the versioned keyword summary defined by PUNCH-005.

3. **Ingest and automatic processing**
   - Keep a fast single-URL action and expose `Bulk add` using the existing
     newline/CSV preflight, duplicate reporting, shared-version lookup, and
     bounded submission behavior.
   - Automatically reuse verified local/shared transcripts, then accessible
     manual/automatic captions, then configured local Whisper under project and
     workstation concurrency limits.
   - Treat local work as resource-intensive rather than monetarily billed. Show
     queue length/estimated load and provide project pause/resume plus optional
     run-while-idle/overnight policy without blocking light review work.
   - Require Administrator approval or an explicit project budget policy before
     paid hosted transcription/translation starts automatically.

4. **Collaborative review**
   - Add a renewable soft claim with claimant, heartbeat/last activity, and a
     bounded stale timeout. Opening remains nonexclusive; takeover requires an
     explicit confirmation and audit event.
   - Allow review before transcript completion after an explicit warning and
     record that the cycle completed without a ready transcript.
   - Enforce Administrator-only completion when configured without preventing
     Researchers from opening, logging clips, commenting, or suggesting
     keywords.
   - Reopening requires a short reason, creates a new review cycle, and notifies
     the previous reviewer and active flaggers.

5. **Dismissal, restore, and notifications**
   - Provide Administrator-only individual/bulk `Dismiss from project` and
     Restore. Dismissal removes the row from active/reviewed work, records an
     optional reason, and never deletes global video identity, finalized
     transcripts, clips, artifacts, flags, or audit history.
   - Cancel unstarted work and cooperatively request cancellation of active work
     only when no active project-video dependency still requires it. Preserve
     immutable finalized transcript versions for instant reuse on restore.
   - Add an in-app activity inbox with per-user unread/seen state for invitation,
     review of a flagged video by another user, reopen, dismissal/restore,
     keyword-suggestion decisions, comments/mentions, and actionable job events.

6. **Bounded aggregate read model**
   - Return title, channel, duration, flagger summary, processing stage/error,
     claim/reviewer, priority, completion policy, keyword summary, clip count,
     last project activity, and whether the current user has opened/flagged the
     source.
   - Use cursor pagination and stable relevance groups so large queues remain
     bounded and rows do not reorder chaotically as jobs complete.

#### Suggested implementation slices

1. **Completed 2026-08-24 — PUNCH-004A:** add the canonical worklist/flag read
   model and unify direct plus batch ingest without replacing worker or
   transcript authority. See
   `specs/completed/PUNCH-004A-canonical-worklist-flags-and-ingest.md`.
2. **Completed 2026-08-24 — PUNCH-004B:** add soft claims, review cycles,
   Administrator completion policy, priorities, and optimistic multi-user
   commands. See
   `specs/completed/PUNCH-004B-soft-claims-review-policy-and-priority.md`.
3. **Completed 2026-08-24 — PUNCH-004C:** add bulk dismissal/restore,
   dependency-aware queued/active cancellation, durable review/triage activity
   receipts, and restart-safe Queue/Reviewed/Dismissed reads. See
   `specs/completed/PUNCH-004C-dismissal-cancellation-and-activity-receipts.md`.
4. **Completed 2026-08-24 — PUNCH-004D:** persist explicit hosted approval,
   require current Owner/Administrator optimistic approval, and enforce it at
   queue reservation/delivery plus worker claim. See
   `specs/completed/PUNCH-004D-hosted-transcription-approval-gate.md`.
5. **Completed 2026-08-24 — PUNCH-004E:** add project-local Automatic/Paused
   policy, direct caption-first composition, bounded catch-up/workload reads,
   and dispatch/delivery/claim enforcement. See
   `specs/completed/PUNCH-004E-automatic-local-processing-policy.md`. Attach
   keyword summaries from PUNCH-005 after their versioned scan authority exists.

#### Acceptance checks

1. Direct and bulk ingest of the same project/video create one worklist row and
   independent user flags; another project remains isolated.
2. Shared transcript and caption hits avoid Whisper. Captionless work uses the
   configured local worker under concurrency limits without a hosted charge.
3. Paid hosted work does not start without Administrator approval or a valid
   project budget policy.
4. Processing, review, dismissal, priority, and scan changes do not overwrite or
   imply one another.
5. Concurrent claim/review commands conflict or take over explicitly; an
   Administrator-only item cannot be completed by a Researcher.
6. Early review records its warning basis and remains reviewed when later
   transcript processing finishes unless a user deliberately reopens it.
7. Bulk dismissal cancels only avoidable work, preserves finalized evidence,
   notifies flaggers, and restores without retranscription when compatible work
   exists.
8. A user returning after another member reviews their flagged video receives
   one durable unread notice and a `New for you` Reviewed highlight until seen.
9. Worklist pagination, aggregate counts, optimistic versions, authorization,
   offline/restart behavior, and sibling failure isolation pass deterministic
   catalog/API/browser tests.

#### Non-goals

- Hard-deleting global source identity or immutable project evidence as an
  ordinary triage action.
- Automatically dismissing a video because it has no keyword matches.
- Replacing persisted transcription jobs/batches with in-memory UI state.
- Charging for local caption discovery or local Whisper processing; monetary
  controls apply only to explicitly configured paid providers.

### PUNCH-005 — Project keyword governance and relevance scanning

- Status: `completed` — all three slices completed 2026-08-24
- Priority: `P1 high`
- Area: project keywords, transcript analysis, durable jobs, triage UI
- Candidate window: after the M7-05 deterministic baseline and before signed-pilot work
- Depends on: PUNCH-001, PUNCH-003 authorization, and PUNCH-004 worklist identity
- Discovered by: high-volume research-triage planning

#### Problem

A project may intentionally ingest dozens of sources before any researcher has
time to watch them. The current literal transcript search is scoped to the open
video and current browser state. It cannot define a shared approved research
vocabulary, highlight every completed project transcript, rank/partition a
large queue, show contextual evidence without opening each video, or rescan
existing work when the research focus changes.

Project keywords must not be conflated with clip tags. Tags describe a logged
clip; keywords are shared project research rules evaluated against versioned
transcript evidence. Raw counts across original and translated tracks would
double-count the same spoken moment, and transient client-side scans would give
collaborators inconsistent results. Automatically deleting zero-match videos
would also be unsafe because literal matching can miss aliases or context.

#### User-visible outcome

Owners and Administrators maintain an approved, versioned set of positive
project keywords and language-aware aliases. Researchers may suggest new
keywords or aliases; Administrators approve or reject the suggestions with an
auditable decision. As transcripts become ready in the background, every
project video receives a shared, versioned relevance result.

The worklist shows total time-deduplicated occurrences, distinct keyword
coverage such as `4/7 keywords`, matches per minute, scan freshness, and the
number of logged clips. Expanding a row shows matched keyword chips and bounded
timestamped context. Clicking a match opens the source at that time and applies
the project highlight in the transcript. Stable Promising, No matches,
Processing, and Action needed groups make fifty-video triage understandable
without silently discarding anything.

#### Current evidence and seams

- Transcript tracks, segments, tokens, exact source-video milliseconds, track
  linkage, language, version, and timing precision already exist.
- The local workspace can perform literal search, but search results are not a
  shared project artifact and are not keyed to a project keyword version.
- Transcript bytes remain authoritative in private object storage and verified
  local cache. The cloud catalog should store bounded summaries, not become a
  second full transcript store.
- Existing worker/job/finalize patterns provide idempotency, leases, checksums,
  and atomic publication semantics suitable for a keyword-scan job.
- Existing project-scoped clip tags and tag suggestions must remain separate
  and keep their current behavior.

#### Scoped fix

1. **Keyword and alias catalog**
   - Add project-scoped canonical keywords with stable IDs, display label,
     optional explanatory description, enabled state, version, creator, and
     audit timestamps.
   - Add one or more aliases with normalized language tag and literal phrase.
     Match aliases case-insensitively using a deterministic Unicode
     normalization/tokenization schema; do not add stemming, fuzzy matching,
     exclusion rules, Boolean rules, or semantic inference initially.
   - Enforce normalized uniqueness within a project/language while preserving
     approved display capitalization.

2. **Suggestion and approval workflow**
   - Researchers can submit a new keyword or alias suggestion with optional
     rationale. The completed creation/review slice uses `pending | approved |
rejected`, stable ID, proposer, reviewer, optimistic version, and
     timestamps. Own pending-suggestion withdrawal remains a later Project
     Settings maintenance command rather than an unsupported contract state.
   - Owners/Administrators may approve/reject; approval transactionally updates
     the canonical keyword-set version and schedules affected scans.
   - Detect suggestions equivalent to an approved/pending alias and return the
     existing record rather than creating review noise.

3. **Versioned scan boundary**
   - Add a durable keyword-scan job keyed by project, project video, exact active
     transcript version, keyword-set version, and scanner schema version.
   - Scan compatible language tracks. Consolidate matches for the same canonical
     keyword when their source-video intervals overlap across linked
     translations, while retaining per-track/language evidence for inspection.
   - Derive cue/timed-token bounds honestly; never present distributed or cue
     timing as exact word timing.
   - Publish a small private, checksummed match artifact containing keyword/
     alias identity, track/version, timing, precision, and bounded context. Keep
     only authorized aggregate counts/status and artifact identity in the
     catalog and project events.

4. **Freshness and recovery**
   - Represent `not_scanned | waiting_for_transcript | queued | scanning |
current | stale | failed` distinctly. Pending or failed is never displayed
     as zero matches.
   - A new approved keyword set or active transcript version marks older results
     stale and queues an idempotent rescan without retranscription.
   - Duplicate delivery, worker loss, and concurrent finalize adopt one
     canonical result. A prior verified result remains readable while the new
     version recalculates.

5. **Triage and transcript presentation**
   - Show occurrence count, matched/approved coverage, match density, clip count,
     and scan freshness as compact row badges.
   - Expand rows into per-keyword counts and bounded context excerpts with
     language/track/timing labels. Click-to-open seeks to the exact or honest cue
     bound and highlights every visible occurrence for that keyword.
   - Provide filters for keyword, has matches, no matches, not scanned, action
     needed, and newly completed results. Allow sorting within stable result
     groups by coverage, occurrences, density, duration, priority, or recency.
   - Integrate selection with PUNCH-004 bulk priority/dismissal controls, but
     require a deliberate Administrator command; zero matches never dismisses
     automatically.

#### Suggested implementation slices

1. **Completed 2026-08-24:** add keyword/alias/suggestion schemas,
   authorization, migration/versioning, normalized suggestion/approval
   creation, and a real Workbench management path without scans. Direct
   maintenance and the final Project Settings destination remain deliberately
   deferred. See
   `../completed/PUNCH-005A-project-keyword-governance.md`.
2. **Completed 2026-08-24:** add the deterministic multilingual matcher,
   durable lease/replay scan lifecycle, exact transcript/alias snapshot,
   private checksummed result artifact, authorized aggregate catalog summary,
   real worker composition, and transcript-version replacement/reuse. See
   `../completed/PUNCH-005B-deterministic-keyword-scan-evidence.md`.
3. **Completed 2026-08-24:** add stable worklist grouping/counts/filters/sorts,
   exact-keyword summary counts, lazy verified bounded context,
   click-to-highlight/seek, current/prior freshness, scan-completed activity
   receipts, second-workstation access, and confirmed optimistic bulk-priority
   integration. See
   `../completed/PUNCH-005C-worklist-keyword-evidence-triage.md`.

#### Acceptance checks

1. A Researcher can suggest but cannot approve a keyword; an Administrator can
   approve once through exact/concurrent replay and advances one set version.
2. Case/Unicode-equivalent aliases deduplicate within a language while distinct
   language aliases remain available for linked tracks.
3. One spoken moment matched in original and English contributes one canonical
   occurrence but retains both track identities for evidence.
4. Fully timed matches seek by exact token bounds; cue-only matches retain cue
   precision and never claim word accuracy.
5. A completed scan is tied to exact transcript/keyword/scanner versions,
   checksum-verifies on another authorized workstation, and is not exposed to a
   nonmember.
6. Keyword approval or active-transcript change marks older results stale,
   queues one rescan, and leaves prior verified evidence readable until finalize.
7. Waiting, stale, failed, and zero-match states are visually and contractually
   distinct.
8. Queue counts/context update after scan finalization without transcript
   regeneration, double-counting translations, or leaking transcript text in
   ordinary events/diagnostics.
9. Fifty-video fixture coverage proves pagination, stable grouping, sibling
   failure isolation, bulk dismissal selection, and bounded rendering.

#### Non-goals

- Clip tags, fuzzy search, semantic similarity, exclusions, Boolean rule groups,
  or AI context scoring in the initial matcher.
- Automatic project-video dismissal or a claim that literal matches establish
  factual relevance.
- Republishing or mutating an immutable transcript bundle merely to add scan
  results.
- Storing full transcript copies or unbounded excerpts in catalog rows, events,
  diagnostics, or notifications.

### PUNCH-006 — Workbench and Clip Library reorganization

- Status: `completed` — all four slices completed 2026-08-24
- Priority: `P1 high`
- Area: web UI, workspace layout, responsive behavior, navigation history
- Candidate window: decomposition after M7-05; final integration after PUNCH-002, PUNCH-004, and PUNCH-005
- Depends on: M7-05 for slice 1; PUNCH-002/PUNCH-004/PUNCH-005 for the final layout
- Discovered by: pilot interface planning and large-worklist workflow

#### Problem

The current page stacks desktop setup, URL loading, account settings, a fixed
transcript/player grid, selection/export controls, transcription batches,
review, and the Clip Library vertically. A researcher must scroll between the
queue and logging surface, while the selection panel can become much taller
than the player because project, notes, bounds, presets, overrides, and four
actions occupy one column. The top-level workspace component is large enough
that a layout-only change risks coupling UI structure to transcript, export,
and project authority.

A long single page also conflicts with the desired interaction: add many
sources, see four queue rows, open one into the logger, mark it reviewed, and
move rapidly between logged clips and earlier sources without losing playback
position.

#### User-visible outcome

At a 1440×900 viewport, the primary Workbench shows the persistent VERA header,
a compact ingest bar, approximately four resizable worklist rows, and the
transcript/player logging workspace without ordinary page scrolling. Queue and
Reviewed are available in the worklist shelf, with Reviewed collapsed/not
selected by default; Dismissed remains an Administrator-facing recovery view.

The full Clip Library is a separate project destination. Opening a clip plays it
as quickly as authorized local/source availability allows. Back and breadcrumb
history return to the prior source, playhead, transcript view, and search state.
Smaller windows collapse secondary information and place the player above the
transcript while retaining bounded scrolling and sticky selection actions.

#### Current evidence and seams

- `apps/web/src/main.tsx` currently owns application state, project/session
  loading, transcript hydration, player commands, selection, preset resolution,
  and every selection command in one component exceeding two thousand lines.
- `BatchWorkspace`, `ClipQueue`, `ExportBatchPanel`, `DesktopSetup`,
  `VirtualTranscript`, and `YouTubePlayer` already provide useful boundaries but
  are composed as long page sections rather than project destinations.
- `styles.css` has a responsive transcript/player stack but fixed transcript
  height and no persisted split/shelf dimensions.
- M7-04 transcript integration is complete. Reorganization should begin only
  after M7-05 establishes the final selection/export baseline; externally
  gated M7-06 dogfood is validation rather than a refactor prerequisite.

#### Scoped fix

1. **Workbench layout**
   - Compose the PUNCH-002 header, compact single-URL ingest with `Bulk add`, a
     resizable worklist shelf defaulting to roughly four compact rows, and a
     transcript/player split that fills remaining viewport height.
   - Provide Queue/Reviewed selection plus Administrator Dismissed recovery
     without rendering all lists at once. Preserve stable result groups and
     virtualize/paginate large collections.
   - Keep the selected passage/range and primary Log clip split button sticky.
     Move advanced export settings behind the secondary export command rather
     than consuming ordinary logging space.

2. **Bounded component/state separation**
   - Extract application shell, ingest, worklist, transcript navigation, player,
     selection editor, command panel, and Clip Library into bounded components
     and controller hooks.
   - Keep network/provider/catalog logic behind the existing API clients and
     typed contracts. Components receive view state/commands; they never
     manufacture transcript evidence or invoke provider tools directly.
   - Preserve all M7-04 load/error/offline states and all three command effects
     while moving presentation.

3. **Clip Library destination**
   - Add project-scoped grouping/sorting/filtering by logger, source, current
     user, tags, speech status, research/export state, comment activity, and
     artifact availability.
   - When a verified compatible local artifact is immediately reusable, open
     it for clip playback. Otherwise open the authorized source player at the
     logged range and loop it without waiting for a new export.
   - Preserve immutable artifact history/relink/re-export controls in the Clip
     destination, with primary research logging remaining in Workbench.

4. **Personal navigation history**
   - Maintain a bounded Back stack containing project/video identity, playhead,
     transcript view, search query/match, and safe selection state.
   - Persist the most recent playhead/view per account/project/video locally for
     restart recovery. Do not make private navigation state shared project data.
   - A breadcrumb/history menu identifies the current source/clip and recent
     sources; restoring state revalidates project access and transcript/artifact
     identity before use.

5. **Responsive and accessible behavior**
   - At 1440×900, verify header, ingest, four worklist rows, player/transcript,
     and sticky logging action are visible without document scrolling.
   - Below the target, collapse the worklist/detail badges first, then stack the
     player over transcript with bounded internal scrolling.
   - Persist split/shelf sizes locally with accessible keyboard alternatives,
     sensible minimums, and a reset-layout command. Preserve logical focus,
     screen-reader labels, and reduced-motion behavior.

#### Suggested implementation slices

1. **Completed 2026-08-24:** decompose the current component behind unchanged
   behavior and browser tests. See
   `../completed/PUNCH-006A-behavior-preserving-workspace-decomposition.md`.
2. **Completed 2026-08-24:** add the VERA shell and responsive Workbench
   geometry using fixture/cached reads, including deterministic 1440×900 and
   narrow browser gates. See
   `../completed/PUNCH-002-006B-vera-shell-destinations.md`.
3. **Completed 2026-08-24:** connect canonical worklist/keyword summaries and
   move the Clip Library into its project destination. See the same completed
   shell/destination record.
4. **Completed 2026-08-24:** add exact compatible-artifact resolution/fresh
   opening, honest authorized-source fallback with range looping, breadcrumb/
   Back state, private bounded persistence, and membership/transcript-
   revalidated restart recovery. See
   `../completed/PUNCH-006C-fast-clip-open-navigation-history.md`.

#### Acceptance checks

1. A 1440×900 screenshot/manual gate shows the complete primary Workbench with
   no document scroll and approximately four worklist rows.
2. Resizing the shelf or transcript/player split respects minimums, persists
   locally, supports keyboard control/reset, and does not disturb selection.
3. Narrow layout places the player above transcript, retains sticky Log clip,
   and exposes queue/details through bounded internal scrolling.
4. Switching project, worklist item, or transcript load cannot retain stale
   transcript/selection/clip evidence from the previous context.
5. Queue, Reviewed, and Dismissed remain paginated/virtualized and preserve
   stable grouping while dynamic counts update.
6. Clip filters/grouping include logger/source/mine/comments/speech/artifact
   state and survive project-tab navigation without cross-project leakage.
7. Opening a clip prefers a verified local compatible artifact, otherwise seeks
   and loops the source immediately; it never reports an unverified catalog row
   as playable bytes.
8. Back restores the previous video/playhead/view/search after opening a queue
   item or clip, including across app restart when still authorized.
9. Existing transcript search/seek/follow/selection, three command effects,
   batch controls, Clip Library operations, and M7 failure states retain browser
   coverage after decomposition.

#### Non-goals

- Replacing domain contracts with component-local mock state.
- Guaranteeing no internal scrolling on every small display; 1440×900 is the
  primary no-document-scroll target.
- Moving project administration into the personal account menu.
- Hiding export-only/log-and-export effects; they remain available as explicit
  secondary commands under PUNCH-007.

### PUNCH-007 — Player-range clip logging and speech status

- Status: `proposed`
- Priority: `P2 medium`
- Area: player interaction, selection contracts, clip logging, subtitle policy
- Candidate window: after the M7-05 baseline and PUNCH-008 comment core; before signed-pilot work
- Depends on: M7-05 selection/export behavior and PUNCH-008 atomic initial comments
- Discovered by: silent-visual and transcript-unavailable logging needs

#### Problem

Every current clip candidate requires `TranscriptSelectionSchema` plus complete
native/English language evidence with nonempty text. A researcher therefore
cannot log a useful visual range by player in/out points when there is no
dialogue, when the transcript is not yet ready, or when the desired visual does
not align with a text drag. Faking transcript IDs/text would corrupt clip,
subtitle, artifact, and Script to Timeline provenance.

The current four equally visible selection actions also overemphasize immediate
export. Most researchers need an instant durable log; rendering remains a
secondary edge action and a capability consumed heavily by Script to Timeline.

#### User-visible outcome

The researcher can set an in-point and out-point from the player using visible
controls or guarded `I` and `O` shortcuts. A manual range records whether speech
is present, explicitly absent, or the transcript is unavailable. If verified
transcript cues overlap, the app offers to attach their exact time-linked
evidence without requiring a text drag.

No-speech and transcript-unavailable clips require a Clip description or first
comment so the research log remains meaningful. A no-speech attestation permits
export with the policy-required empty subtitle artifacts and exact actor/time
provenance. Transcript-unavailable speech can be logged immediately but remains
blocked from subtitle-dependent export until evidence is resolved.

`Log clip` is the primary split-button action. Its caret reveals explicit `Log
and export` and `Export without logging` commands with their differing project
and persistence effects.

#### Current evidence and seams

- `TranscriptSelectionSchema` requires track/segment/token identity, nonempty
  text, transcript bounds, export bounds, version, and timing precision.
- `ClipLanguageEvidenceV2Schema` requires nonempty native and English evidence;
  clip creation and CSV/search assume transcript text.
- The player wrapper already exposes seek/play/pause and the selection UI can
  set export bounds from the current playhead.
- The export pipeline already models intentional speech-free empty sidecars as
  distinct from missing transcript failure, but there is no user-facing human
  attestation path.
- The three selection command effects and project requirements are established
  invariants and must remain distinct beneath any split-button presentation.

#### Scoped fix

1. **Selection and speech contracts**
   - Replace transcript-only clip selection with a discriminated union:
     `transcript_range` preserves every current field; `player_time_range`
     stores source-video start/end, selection origin, optional adjusted export
     bounds, and `speech | no_speech | transcript_unavailable` status.
   - Keep source and export bounds separate and validate positive duration,
     media containment, and handle behavior without inventing transcript bounds.
   - Store no-speech attestation actor/time/version separately from free-form
     description/comment text.

2. **Player interaction and shortcuts**
   - Add Set in/Set out buttons beside playhead/range controls. `I` sets or
     replaces the in-point; `O` sets the out-point only after a valid in-point.
   - Ignore shortcuts when focus is in an input, textarea, select, editable
     content, menu, or dialog; ignore modified/system/browser combinations and
     repeated keydown. Provide visible shortcut help and accessible actions.
   - Show range duration, numeric bounds, preview/loop, clear, and validation.
     Starting a manual range does not silently mutate an existing immutable
     transcript selection.

3. **Transcript attachment and logging**
   - Resolve overlapping verified original/English/preferred cues by source
     time and offer an explicit attachment preview with track/version/precision.
   - A transcript-attached manual range retains player-range provenance while
     carrying exact language evidence. No overlap never implies no speech.
   - Require either nonempty Clip description or an initial PUNCH-008 comment
     for no-speech/transcript-unavailable creation; commit the clip and optional
     first comment atomically.
   - Extend queue/search/CSV/Script to Timeline reads conservatively for
     transcript-free legacy/new clips using visible `No speech` or `Transcript
unavailable` labels rather than fabricated text.

4. **Export policy**
   - A no-speech attestation may create valid empty subtitle files for the
     snapshotted required-sidecar set; manifest/metadata records the actor/time,
     basis, cue count zero, and ordinary language-policy decision.
   - A speech or transcript-unavailable range without required exact tracks
     enters `needs_transcript`/`needs_translation` and cannot finalize with
     missing, unrelated, or full-source subtitles.
   - Retry uses the immutable selection/speech snapshot. Later comments or
     transcript availability do not mutate an existing export request; the user
     creates a new compatible request when evidence changes.

5. **Split-button actions**
   - Primary click/keyboard activation runs project-required `Log clip` with no
     render.
   - The accessible caret menu exposes two secondary commands: **Log and
     export** and **Export without logging**. It describes project/log/render
     effects and retains separate disabled/error states.
   - Export-only remains projectless and receives no project description,
     comments, tags, or notifications unless later explicitly added to a project.

#### Suggested implementation slices

1. Add player-range/speech schemas, migrations, conservative reads, and player
   in/out keyboard interaction without export.
2. Add transcript-by-time attachment, atomic description/first-comment logging,
   worklist/Clip Library/CSV/search support, and all permission/offline paths.
3. Add no-speech empty-sidecar execution/provenance, transcript-unavailable
   blocking/recovery, split-button presentation, and Script to Timeline
   compatibility.

#### Acceptance checks

1. `I`/`O` set exact player bounds and never fire while typing, using modifiers,
   interacting with a menu/dialog, or holding a key.
2. Invalid/reversed/out-of-media ranges cannot be logged; clearing/switching
   selection never mutates a prior logged clip.
3. Overlapping transcript attachment preserves exact track/version/time and
   honest precision; absence of cues does not auto-select no-speech.
4. No-speech/transcript-unavailable creation fails without a description or
   initial comment and succeeds atomically with either.
5. A no-speech export produces the correct empty sidecar set, verified media,
   manifest attestation, and cleanup through retry/restart without fake text.
6. Transcript-unavailable speech logs immediately but cannot finalize export
   until required immutable track evidence is supplied in a new request.
7. Log clip creates one project candidate and no render; Log and export creates
   the candidate before render; Export without logging creates no project clip,
   comment, CSV row, or sync event.
8. Keyboard, cue-only, offline, authorization, CSV, artifact compatibility, and
   Script to Timeline regressions pass alongside existing transcript-selection
   behavior.

#### Non-goals

- Inferring no speech from missing captions, silence detection, or an AI model.
- Treating a free-form comment as export-critical speech evidence.
- Editing transcript text or weakening foreign/unknown subtitle guarantees.
- Removing export commands entirely from Research Video Clips.

### PUNCH-008 — Collaborative clip comments and Script to Timeline handoff

- Status: `proposed`
- Priority: `P1 high`
- Area: clip collaboration, comments, notifications, search, authoring handoff
- Candidate window: after PUNCH-003 identity and PUNCH-004 activity receipts; before signed-pilot work
- Depends on: PUNCH-003 stable handles/authorization and PUNCH-004 activity receipts
- Discovered by: silent-visual research context and authoring handoff planning

#### Problem

A logged clip currently has one mutable `notes`/intended-use field owned by the
clip record. That field can carry the creator's curated research context but
cannot represent multiple collaborators' observations, follow-up discussion,
mentions, or time-specific guidance. Replacing it with a shared text blob would
create optimistic-write conflicts and erase authorship.

Comments are especially important for player-range/no-speech clips, where the
useful evidence may be visual and cannot be represented by transcript text.
They are also useful in Script to Timeline, but importing every mutable casual
comment as an editing instruction would make builds irreproducible and allow a
later conversation edit to silently change authoring intent.

#### User-visible outcome

Every project clip retains one curated **Clip description / intended use** and
may have a flat chronological conversation containing comments from multiple
members. Comments show author and time, support `@handle` mentions, may point to
one exact source-video moment inside the clip, and can be edited or deleted by
their author under optimistic versioning. Owners/Administrators can moderate.

A creator may enter the first comment while logging; it is committed atomically
with the clip. Clip Library search and activity include comments, participants
can follow/unfollow a clip, and mentions/relevant activity appear in the in-app
inbox. Script to Timeline can display the latest authorized thread, but a user
must explicitly promote selected comment versions into immutable timeline-build
notes/instructions.

#### Current evidence and seams

- `ClipCandidateSchema` has creator, notes, tags, immutable selection/language
  evidence, and optimistic version but no child comment records.
- Clip creation already commits notes/tags atomically and sync/outbox paths
  preserve the clip across offline replay.
- Clip Library search currently covers selected text, title, notes, tags, and
  status; CSV is one row per clip.
- M6 authoring handoff exposes authorized clip/history/artifact APIs and stable
  clip/artifact identities, which should carry comments rather than a direct
  database integration.
- PUNCH-003 unique handles and PUNCH-004 in-app activity receipts provide the
  identity and notification primitives for mentions/following.

#### Scoped fix

1. **Description versus comments**
   - Rename the existing notes field in the UI to **Clip description / intended
     use**. Preserve its catalog ownership, search behavior, atomic creation,
     optimistic edits, and compatibility field mapping.
   - Treat description as curated clip metadata and comments as separate member
     contributions. A comment never changes selection, speech status, tags,
     research status, export state, or transcript evidence.

2. **Comment model and permissions**
   - Add project/clip-scoped comments with stable ID, author ID and safe display
     snapshot, body, created/updated time, optimistic version, and deletion
     tombstone. Use flat chronological ordering; do not add nested threads.
   - Permit an optional `sourceTimeMs` constrained to the immutable clip range.
     Clicking it seeks the same source-video moment in both applications.
   - Parse bounded `@handle` mentions to stable user IDs at command time. Keep
     visible text human-readable but never authorize from a mutable handle.
   - Researchers may create comments and edit/delete their own. Owners/
     Administrators may tombstone any comment for moderation. Removed members'
     existing comments remain attributed and readable to authorized members.

3. **Atomic creation and offline sync**
   - Extend project clip creation with an optional first-comment command in the
     same catalog transaction/idempotency boundary. Exact replay returns the
     same clip/comment; divergent reuse conflicts.
   - For existing clips, create/edit/delete commands use stable idempotency,
     optimistic versions, sync events, offline outbox replay, and conflict
     presentation without overwriting another member.
   - Require a nonempty description or first comment when PUNCH-007 logs
     no-speech/transcript-unavailable evidence. Keep the structured speech
     status independently mandatory.

4. **Following, notifications, and search**
   - Clip creators and commenters follow by default; members can explicitly
     follow/unfollow. Mentions notify the resolved member regardless of follow
     state, subject to project membership.
   - Create deduplicated in-app notices for mention and followed-clip comment
     activity with per-user unread/seen state. Tombstoned content does not leak
     through notification previews.
   - Add bounded comment search and comment-count/latest-activity fields to Clip
     Library pages. Search results identify the matching comment and can open
     its clip/time anchor.

5. **Exports and Script to Timeline**
   - Keep the main clip CSV one row per clip and add comment count/latest-comment
     time. Provide a separate project-authorized comments CSV keyed by project,
     clip, comment, author, version, optional time, and tombstone state.
   - Add authorized paginated comment APIs to the existing authoring handoff;
     never expose workstation paths, credentials, hidden/tombstoned bodies, or
     comments from another project.
   - Script to Timeline displays the live current thread as research context.
     Promoting a comment to build notes/instructions explicitly snapshots
     comment ID, version, text, author, and optional source time on the build.
     Later edits/deletion mark the live source changed but never mutate the
     immutable build snapshot.
   - Do not let an AI/compiler treat all comments as executable instructions.
     Only explicit promotion crosses that semantic boundary.

#### Suggested implementation slices

1. Add comment/follow schemas, cloud migrations, authorization, idempotent
   commands, paginated reads, moderation, and optimistic concurrency.
2. Add atomic first comment, offline replay, Clip Library search/counts, time
   anchors, mentions/follows, and in-app notices.
3. Add separate comments CSV and Script to Timeline live-thread plus explicit
   immutable snapshot handoff.

#### Acceptance checks

1. Two members can add distinct comments without changing the clip version or
   overwriting description/tags; ordering is deterministic across reload.
2. Exact comment command replay is a no-op; divergent idempotency or stale edit
   conflicts without losing either author's content.
3. A commenter can edit/delete their own but not another user's comment; an
   Administrator moderation tombstone hides the body while preserving safe
   audit identity.
4. A source-time anchor outside clip bounds is rejected; a valid anchor seeks to
   the same source time in Research Video Clips and Script to Timeline.
5. Mention resolution binds to stable user ID, rejects nonmembers, and produces
   one deduplicated unread notice without leaking private content.
6. Clip plus optional first comment are atomic through success, failure,
   duplicate replay, and offline outbox recovery.
7. No-speech/transcript-unavailable logging requires description or first
   comment but never treats that text as speech/transcript evidence.
8. Clip search finds authorized comment text; the main CSV remains one row per
   clip and the comments export reconciles by stable IDs.
9. Script to Timeline sees the latest authorized thread, snapshots only explicit
   selections, and keeps a prior build unchanged after source comment edit or
   deletion.

#### Non-goals

- Nested discussion threads, reactions, file attachments, or rich-text editing
  in the first comment version.
- Comments on projectless export-only jobs.
- Treating comments as transcript corrections, no-speech proof, project tags,
  or automatic timeline commands.
- Sharing comments through direct cross-application database access.

### PUNCH-009 — M8 discovery, platform, and AI candidates

- Status: `proposed`
- Priority: `P3 low`
- Area: M8 research expansion, source providers, discovery, AI annotations
- Candidate window: M8, sequence intentionally unassigned
- Depends on: stabilized core pilot contracts; platform-neutral source identity is the first slice
- Discovered by: VERA future-state planning

#### Problem

The current source, player, video snapshot, clip selection, export acquisition,
and several durable identities are explicitly YouTube-specific. Adding TikTok
or Instagram directly to those schemas would spread provider conditionals
through UI, catalog, workers, filenames, and authoring compatibility. Platform
access, embedding, metadata, captions, and authorized media acquisition also
vary and cannot be promised for arbitrary public URLs.

The desired future ingest experience also includes YouTube search, AI-assisted
topic discovery, contextual relevance, and optional visual descriptions. These
capabilities can incur quota/cost/privacy implications and produce uncertain
inferences. If they automatically add/process videos, replace literal keyword
counts, overwrite human notes, or become transcript evidence, they would weaken
the project's explicit authority and provenance rules.

#### User-visible outcome

M8 may add provider-backed discovery and additional video platforms through one
platform-neutral source model. Search or AI discovery returns reviewable
candidates with origin/provenance, duplicates, availability, and estimated
resource/cost information. A user explicitly approves candidates before they
enter the project worklist or start processing.

Literal project-keyword evidence remains visible and explainable. Optional AI
context scoring appears as separately versioned analysis with provider/model,
input identity, confidence, and review state. Optional visual descriptions are
editable/rejectable clip annotations; they never overwrite Clip description,
comments, speech status, transcript evidence, or immutable authoring snapshots.

#### Current evidence and seams

- `VideoSchema`, `ClipVideoSnapshotSchema`, project-video lookup, worklist inputs,
  YouTube player wrapper, and source grouping rely on `youtubeVideoId` and
  YouTube canonical URLs.
- Metadata, captions, media acquisition, player, object storage, and worker
  execution already use adapter boundaries that can be extended after the
  canonical source identity is generalized.
- M8 is currently responsible for signed cross-platform distribution, updates,
  documentation, diagnostics, and independent QA. These product candidates are
  unprioritized additions; recording them does not silently displace the release
  obligations.
- PUNCH-005 provides versioned literal keyword evidence and PUNCH-008 provides
  comments/authoring snapshots that AI outputs must not mutate.

#### Scoped fix

1. **Platform-neutral source identity prerequisite**
   - Introduce an immutable source identity containing provider, provider media
     ID, canonical URL, and provider-specific version/fingerprint evidence.
     Preserve safe compatibility readers/migrations for every existing YouTube
     video, clip, transcript, job, package, and authoring reference.
   - Define provider-neutral playback, metadata/search, caption discovery,
     authorized acquisition, and source-availability interfaces. Keep
     provider-specific IDs/responses behind adapters.
   - Update deduplication, cache keys, source grouping, filenames, manifests,
     and artifact compatibility to use canonical source identity without
     changing historical YouTube package identity.

2. **TikTok and Instagram candidates**
   - Add each platform only through its own bounded adapter and current primary
     documentation review. Represent available, authentication-required,
     unsupported, removed, region/age-restricted, and rights-unconfirmed states
     honestly.
   - Do not ship credentials/cookies in source code, logs, catalog events, or
     support data. Require source-specific authorization before caption/media
     acquisition and preserve useful URL/metadata logging when export is
     unavailable.
   - Keep ordinary deterministic tests adapter/fake-backed; any live proof is
     optional, explicitly authorized, redacted, and independently scoped.

3. **YouTube search ingest**
   - Add a quota-aware search provider returning bounded candidate metadata,
     canonical IDs, result provenance, pagination, and actionable quota/error
     states.
   - Selecting candidates enters the existing preflight/duplicate/flag flow;
     viewing search results alone never creates project rows or starts workers.

4. **AI topic discovery**
   - Add a provider-neutral discovery request with topic/prompt, project scope,
     provider/model/version, bounded result count, estimated monetary/resource
     cost, and explicit consent where information leaves the workstation.
   - Return versioned candidates with source/provenance, explanation, confidence,
     duplicate/project-membership checks, and availability. Require explicit
     user approval before ingest and separate Administrator approval/project
     budget before paid processing.
   - Persist rejected/accepted decision evidence without treating a model claim
     as factual source metadata.

5. **Contextual relevance and visual descriptions**
   - Add semantic/contextual relevance as a separate analysis linked to the
     exact transcript, keyword set, provider/model, inputs, and schema. Show it
     beside—not instead of—literal PUNCH-005 results and never auto-dismiss.
   - Add optional visual-description annotations linked to exact clip/source
     bounds and sampled-input hashes. Store provider/model, prompt/policy,
     confidence, creator, version, and review state.
   - Human edits or approval create a new annotation revision. AI annotations
     never overwrite description/comments, assert no-speech, repair transcript
     language, or become Script to Timeline instructions without an explicit
     user promotion/snapshot.

#### Suggested implementation slices

1. Generalize source identity and compatibility across contracts, databases,
   cache/jobs, player/provider boundaries, export packages, and authoring reads
   while keeping all current YouTube tests green.
2. Add YouTube search as the first discovery adapter and prove explicit
   candidate-to-preflight handoff with quota/failure behavior.
3. Evaluate and add TikTok and Instagram separately only where authorized,
   documented access supports the requested read/play/acquire capability.
4. Add AI topic discovery, then contextual relevance, then visual annotations as
   independent opt-in provider-neutral slices with cost/privacy/provenance gates.

#### Acceptance checks

1. Every historical YouTube project/video/transcript/clip/job/artifact remains
   readable, deduplicated, and authoring-compatible after source-identity
   migration.
2. Provider-specific IDs or response shapes do not leak into generic worklist,
   clip, export, or Script to Timeline business logic.
3. Unsupported/authentication/rights/platform failures retain useful project
   state and never claim arbitrary public media access.
4. YouTube search observes bounded pagination/quota behavior and creates no
   project/worker side effect until explicit candidate approval.
5. AI discovery exposes provider/model/provenance/cost, deduplicates candidates,
   and performs no ingest or processing before authorization.
6. Contextual scoring cannot alter literal counts, approved keywords, or
   dismissal automatically; visual descriptions cannot alter speech/transcript/
   comment/description evidence.
7. Explicitly promoted annotation/comment versions remain immutable in Script
   to Timeline builds after later source analysis changes.
8. Normal tests remain deterministic/network-free; live platform/AI checks run
   only with current documentation review, explicit authorization, bounded
   cost, redacted evidence, and cleanup.

#### Non-goals

- Prioritizing these candidates relative to one another in this intake update.
- Displacing M8 signing, updater, documentation, diagnostics, or independent-QA
  requirements without a deliberate roadmap decision.
- Scraping or bypassing platform controls, promising arbitrary public-media
  access, or storing user credentials in research artifacts.
- Allowing AI to ingest/process sources, dismiss work, rewrite human evidence,
  or control a timeline without explicit user action.

### PUNCH-010 — Clip topic tagging and scripting organization

- Status: `proposed`
- Priority: `P1 high`
- Area: clip metadata, Clip Library, search/filter, authoring handoff, scripting
- Candidate window: with the PUNCH-008 authoring handoff; before expanded pilot validation
- Depends on: existing project-scoped clip tags and M6 authoring handoff; PUNCH-006 for the final visible surfaces
- Discovered by: VERA pilot scripting workflow planning

#### Problem

Logged clips already support reusable project-scoped free-form tags, but the
pilot plan does not make topic organization an explicit research or scripting
workflow. Without a visible topic facet, researchers may bury the subject of a
clip in its description or comment thread, and a scriptwriter cannot reliably
retrieve or group all candidate clips about the same subject.

Project keywords solve a different problem: they define shared terms used to
scan whole-video transcripts for relevance. Comments are authored conversation,
and Clip description is curated intended-use metadata. Neither should become an
implicit topic taxonomy or be parsed to guess one.

#### User-visible outcome

A researcher may assign zero or more reusable **Topics** while logging a clip
or later editing it in the Clip Library. Existing project topics are suggested,
new free-form topics are allowed, and no topic is required. Topic changes do
not create, edit, or delete comments.

Clip Library and Script to Timeline can search, filter, and group clips by one
or more topics, making it easy to gather the source material for a script
section. Script builds snapshot the topic labels associated with selected clips
at build time so later metadata edits do not silently rewrite an existing
build's organizational context.

#### Current evidence and seams

- `ClipCandidateSchema` already carries bounded `tags`; clip creation commits
  them atomically with notes and language/selection evidence.
- The shared catalog already stores normalized project-scoped `clip_tags` and
  `clip_candidate_tags`, preserves display names, suggests existing values, and
  supports authorized optimistic edits plus search/filter and CSV projection.
- The current logging UI labels the field `Clip tags`, while the Clip Library
  can edit and filter tags. The pilot work is primarily a clear topic-oriented
  workflow and authoring integration, not a second tag database.
- M6 exposes authorized clip search and handoff APIs to Script to Timeline;
  PUNCH-008 separately adds live comments and explicit comment snapshots.
- PUNCH-005 project keywords remain video-relevance scan inputs and must not be
  silently copied onto clips as topics.

#### Scoped fix

1. **Topic entry and editing**
   - Present the existing project-scoped clip-tag capability as an optional
     **Topics** facet at both logging actions and in Clip Library details.
   - Reuse case/Unicode-normalized uniqueness, preserved display form,
     suggestions, authorization, optimistic versions, atomic clip creation,
     offline replay, and current tag limits. Do not create parallel topic rows
     or silently migrate keywords, descriptions, or comments into topics.
   - Preserve every existing clip tag and compatibility field. If later usage
     demonstrates a need for typed person/theme/topic facets, promote that as a
     separate migration rather than inferring types from punctuation or text.

2. **Research retrieval**
   - Show topic chips on clip cards/details and provide bounded topic
     search/filter with explicit `match any` versus `match all` behavior.
   - Allow topic grouping in the Clip Library without changing canonical clip
     ordering, research status, export status, or artifact identity.
   - Keep topic-only edits out of the comment thread. They may emit the ordinary
     clip-metadata activity receipt without impersonating a comment author.

3. **Scripting handoff**
   - Extend authorized authoring reads to return the same canonical topic labels
     and support bounded topic filters; never use direct database access or a
     second Script to Timeline taxonomy.
   - Let script organization group or shortlist clips by topic while preserving
     the clip's description, comments, transcript evidence, and artifact state
     as separate fields.
   - When a clip enters an immutable script build, snapshot its clip ID/version
     and current topic display labels. Later topic edits update live research
     views but do not mutate that prior build.

4. **Projection and compatibility**
   - Keep the canonical API/CSV compatibility field backed by existing clip
     tags; label it Topics in the user-facing VERA surfaces and authoring
     workflow. Do not create duplicate `Topic` and `Tags` values for one clip.
   - Projectless `Export without logging` remains ineligible for topics,
     comments, Clip Library search, CSV rows, or authoring discovery unless the
     user later adds it to a project.

#### Suggested implementation slices

1. Add topic-oriented UI wording, chips, suggestions, `any`/`all` filters, and
   browser coverage on the existing tag contracts and catalog queries.
2. Extend Script to Timeline authorized reads, topic grouping, and immutable
   build-snapshot compatibility without coupling topics to PUNCH-008 comments.

#### Acceptance checks

1. A clip can be logged with no topics, one topic, or several topics; all three
   paths preserve selection, language, description, comment, and export effects.
2. Topic creation/editing deduplicates case/Unicode-equivalent project values,
   preserves the chosen display form, and survives reload plus offline replay.
3. `Match any` and `match all` topic filters return deterministic bounded Clip
   Library and Script to Timeline results without leaking another project's
   topics or clips.
4. Two members can comment while either member edits topics without overwriting
   or manufacturing comment records; stale topic edits conflict safely.
5. Script to Timeline receives the same canonical topics as the Clip Library,
   can group clips by them, and keeps an earlier build snapshot unchanged after
   a live topic rename/add/remove.
6. Existing clip tags remain readable and searchable with no lossy migration;
   CSV/API compatibility contains one canonical topic/tag value set rather than
   duplicate columns with divergent contents.
7. Project keywords do not become clip topics automatically, and topic edits do
   not trigger keyword rescans, transcript mutation, render work, or artifact
   invalidation.
8. Export-only jobs never acquire topics or appear in topic-filtered authoring
   results until explicitly converted into a project clip.

#### Non-goals

- A hierarchical ontology, mandatory controlled vocabulary, topic ownership,
  colors/icons, or per-topic permissions in the first pilot version.
- AI-generated or keyword-derived automatic topics; suggestions come only from
  the project's existing human-authored topic vocabulary.
- Replacing Clip description, comments, project keywords, speech status,
  transcript evidence, research status, or export status with topics.
- Treating topics as authorization rules, factual claims, transcript
  corrections, or automatic Script to Timeline instructions.

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
