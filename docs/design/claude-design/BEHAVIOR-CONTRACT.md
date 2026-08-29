# VERA redesign behavior contract

- Status: approved product-design decisions and implementation-planning input
- Last updated: 2026-08-28
- Implementation status: not implied by this document
- Visual reference: [Claude Design prototype](https://claude.ai/design/p/011eee38-8b6b-48aa-a154-d6c0060d4f23?file=VERA+Redesign.dc.html)

## Purpose and authority

The Claude prototype is the visual model for VERA's redesign. This document is
the complementary behavior contract: it records deliberate product changes
that cannot be inferred safely from screenshots or HTML alone.

Explicit product decisions from the design review override contradictory notes
inside the prototype. `PROJECT_GUIDE.md` remains the authority for behavior
that is implemented today. Before code changes begin, each bounded part of this
contract must become one implementation spec in `specs/active/`, with its
contracts, migrations, authorization, failures, and tests identified. Only
verified implementation work should later update `PROJECT_GUIDE.md` and
`outline.md`.

The redesign should not expose a feature merely because the existing product
supports it. The interface policy is to keep the ordinary research path clear
and reveal uncommon, administrative, recovery, or export controls only in the
context where they are needed.

[`WEB-EDITION-DESIGN-BRIEF.md`](./WEB-EDITION-DESIGN-BRIEF.md) supplements this
contract with the approved limited-Web capability boundary, logged-clip-only
Desktop handoff, and browser-suite navigation to VERA Script to Timeline. It
changes runtime availability and presentation only; shared project, transcript,
clip, language, authorization, and Desktop action semantics remain governed by
this contract.

## Product model

The primary project flow has three destinations:

1. **Sources** — add YouTube videos and decide what is worth opening.
2. **Workspace** — watch one transcript-ready source and log clips.
3. **Clips** — read and write clip comments, organize clips by Topic, and
   select clips for occasional export.

Comments are principally a Clips-screen activity. Export, artifact recovery,
provider administration, and other operational controls are supporting flows,
not peers of the three-part research loop.

## Cross-product decisions

### Language behavior

- A user's preferred transcript language is account-level personal state.
- When a source is not already in that language, VERA attempts to produce the
  preferred-language transcript automatically. This is not a per-video choice.
- The original-language transcript remains available. Product copy must say
  **preferred language**, not assume that every translation is English.
- Preferred language affects only that user's Workspace display, navigation,
  selection, and search. It never changes the source language of a logged clip
  or becomes the clip's canonical transcript language.
- Logging is display-track-independent. When a user selects text from a
  preferred-language translation, VERA freezes the selected source-video time
  range and resolves the exact overlapping canonical original-language and
  English evidence by time. It must not copy the displayed translation into the
  original or English clip roles.
- Every speech clip from a non-English source has two canonical, immutable
  language roles:
  - **Original** — the language actually spoken in the source, with its exact
    track/version provenance;
  - **English companion evidence** — the time-linked canonical English
    track/version and text for the same source-time range. If the clip is
    exported, this supplies the required clip-relative English SRT sidecar.
- A distinct preferred-language snapshot may be retained only as auxiliary
  viewer-context provenance recording what the logging user saw, including its
  language and track/version. It is not primary clip text, does not change clip
  identity or language classification, and should appear only in a secondary
  details/hover disclosure such as “Logged while viewing Spanish.”
- Clips presents the original-language clip text as the primary, unlabeled
  excerpt. When the source is not English, place the paired English text
  directly below it under one concise `Translation from {source language}`
  label, for example **Translation from Spanish**. Do not repeat the original
  excerpt in a separate language-details panel or label either presentation
  **Evidence**. Internal data contracts still retain the canonical Original and
  English roles and may use evidence and provenance terminology where precision
  requires it.
- Do not show implementation commentary such as “Viewer context is secondary
  provenance only — never a third canonical transcript, and never an export
  sidecar” in the product. If useful, a quiet details or hover line may say only
  `Logged while viewing <language>`.
- Preferred-language viewer context is not an export subtitle role, does not
  create a preferred-language sidecar, and does not replace either required
  original or English export sidecar. It also does not become a Topic, comment,
  description, or default Clips-search/CSV field.
- If a non-English speech range cannot resolve both canonical original and
  English evidence, logging fails with an actionable language-evidence state.
  A ready preferred-language display by itself is insufficient evidence for
  logging.
- Changing the user's preferred language later never rewrites a clip's
  original/English evidence or its optional viewer-context provenance.
- Formal invariant: for the same source, transcript version, and source-time
  range, canonical clip language evidence is identical whether the researcher
  selected Original, English, or a distinct preferred-language display track.
- Verified cached and shared transcripts retain precedence over new local or
  cloud work.
- Local Argos translation and local Whisper transcription are the defaults.
- Online translation and online transcription are separately requested and
  separately approved. Approval is provider- and service-specific; one never
  grants the other.
- Account Settings presents Online translation and Online transcription as
  separate, local-first sections. In an unrequested state, each section puts
  its request action immediately after the short explanation and before any
  provider, usage, or request-history detail.
- Clicking that action opens a focused request dialog. The dialog first says
  that each online job creates a cost for the VERA host and asks the user to
  request online processing only when the corresponding local capability does
  not work for the need or is too slow. Provider selection and provider-specific
  cost context follow this disclosure inside the dialog; they are not
  front-loaded on the Account Settings page.
- Every online-service request may include an optional plain-text message to
  the platform administrator explaining the local limitation or urgency. Bound
  it to 500 Unicode characters, normalize and escape it like administrator
  decision messages, preserve it in request history, and show it in the admin
  approval queue. Empty input is absent rather than an empty stored message.
- If only one provider is eligible for the requested service, identify it in
  the dialog without making the user operate a redundant selector. Approval
  remains scoped to that exact provider and service. Provider preferences and
  stop/switch controls appear only after access exists or when a pending request
  needs review or withdrawal.
- Only the global platform-administrator capability may approve cloud-provider
  access or manage the Argos model catalog. Project Owner or Administrator
  status is insufficient.
- Enabled Argos language packs come from the server-managed, evaluated, signed
  catalog. Platform administrators can review newly discovered packs and may
  enable a hard-safe but not-recommended pack only with an audited override.
- Setup should label Transcription, Translation, and Export as optional
  capabilities. A user may skip them and continue using unaffected parts of
  the product.
- When skipped or unavailable setup is later required, the blocked action
  should explain exactly what is missing and offer the smallest relevant setup
  or access-request path. Avoid forcing the user back through an undifferentiated
  full setup wizard.
- Provider-neutral language-service behavior was implemented under
  `specs/completed/LANGUAGE-ADMIN-001-platform-language-service-control-plane.md`
  and the associated completed language-service slices. The older
  `specs/future/TRANSLATION-001-local-first-translation-and-admin-governed-aws.md`
  does not by itself express the newer separate transcription approval and
  dynamic Argos-catalog decisions.

### Onboarding

- Preserve every technically necessary onboarding step, even when that means
  overriding a simplified mockup.
- Distinguish steps needed to enter the application from optional capability
  setup. Login, project access, required storage/privacy/rights acknowledgments,
  and operation-specific readiness remain explicit where necessary.
- Optional capability setup can be skipped without presenting the application
  as broken. The first blocked use should provide contextual remediation.
- The same setup and remediation vocabulary should be reusable by VERA Script
  to Timeline where the underlying capability is shared.

### Rights

- Use one rights attestation per project for normal source processing rather
  than repeating an exact-source confirmation in the ordinary workflow.
- Preserve any stronger operation-specific safety gate required by the existing
  export or provider boundary until a bounded implementation spec proves how
  project attestation satisfies it.

### Comments, descriptions, and Topics

- Comments replace the ordinary clip-description workflow as the primary place
  for research context and discussion.
- Existing clip descriptions remain supported as optional curated metadata,
  hidden behind a contextual **More** or similar secondary action.
- Logging a **No speech** range must open a small dialog with a required
  **Description** field. This is the intentional exception to description being
  optional.
- The implementation spec must deliberately reconcile that rule with the
  current PUNCH-007 behavior, which permits either a description or an atomic
  first comment. The redesign decision is stricter: the no-speech dialog asks
  for a description.
- Project keywords and clip Topics are different taxonomies:
  - project keywords identify promising sources before transcript review;
  - Topics organize logged clips while shaping the eventual essay.
- Existing project-scoped clip tags remain the canonical Topic records.

### Supporting capabilities

- Bookmarks do not need a primary UI. Preserve their implemented storage and
  code unless a later spec explicitly retires them.
- Do not show a general activity digest in the ordinary project interface.
  Use focused indicators such as Unopened sources and a unified New view for
  newly logged clips plus unread clip comments instead.
- Keep advanced batch, provider, governance, export, and artifact-recovery
  capabilities available at the point where they become relevant; do not place
  them in the primary navigation solely for discoverability.
- Do not add playlist/channel expansion or clip deletion as part of this
  redesign.

## Sources behavior

### List model

- The destination is named **Sources**, not Queue.
- Use one source list. Remove the Reviewed and Dismissed tabs.
- Remove source-row checkboxes and the Claim, Assign, Mark Reviewed, priority,
  flagger, and bulk-triage controls from the ordinary Sources UI.
- Do not require a human to mark a source finished. A member's presence in
  **Logged by** indicates that they began reviewing it by logging at least one
  clip.
- Sort by **Date Added**, newest first, by default.
- Date Added means the date this canonical source first entered this project.
- When space permits, expose who originally added it. At tighter desktop widths,
  show `Added by <name> on <full date>` from the Date Added cell's accessible
  tooltip or popover.

### Project keywords

- Show the project's enabled canonical keyword chips above the list so members
  understand keyword-hit flags.
- Clicking a chip filters the list to that one keyword. Initial behavior permits
  only one selected keyword at a time.
- Show roughly six chips, then a `+N more` control that opens a searchable
  popover. Aliases remain managed in Project Settings and are not separate chips.

### Columns and responsive composition

Use these semantic columns:

- **Video** — title, duration, and the per-user Viewed/Unopened indication.
- **Date Added** — project-entry date and compact added-by disclosure.
- **Transcript** — exactly one state badge on every row.
- **Keyword Hits** — current project-keyword match summary.
- **Clips** — split the current user's clips from everyone else's, for example
  `3 you · 6 others`.
- **Logged by** — up to two member names followed by `+N`.

Keyword Hits is a compact numeric column, right-aligned close to the Transcript
state rather than stretched across unused table space. At approximately 1024
px, label it **Hits**, fold Date Added into Video's secondary line, and place
Logged by as secondary text within Clips. Protect enough width for the
Transcript state and keep all semantic data available when visually combined.

### Transcript state and opening Workspace

- Every source row has exactly one Transcript badge.
- A verified transcript in the current user's preferred language is represented
  by a green **Ready for review** badge.
- At compact widths, use short state labels such as **Ready**, **Processing**,
  **Setup needed**, **Language pack needed**, **Access needed**, **Confirm
  language**, and **Retry**. Clicking an actionable state reveals the exact
  remedy; long remediation sentences do not become table badges.
- A badge may be a button when its state has a relevant remediation or setup
  action.
- Clicking a neutral part of a row opens that source in Workspace only when its
  preferred-language transcript is verified and ready.
- A source without that transcript cannot enter Workspace. This is a hard rule
  for the redesign, not merely a disabled transcript panel.
- The blocked row should explain whether it is processing, needs local setup,
  needs cloud-provider approval, failed, or uses an unsupported language route.
- This supersedes the current PUNCH-007 path that permits transcript-free
  player-range logging. Manual in/out range logging remains useful after a
  transcript-ready source is open, including No speech ranges.

### Per-user Viewed state

- Viewed is per user and per project source.
- Adding a source does not mark it Viewed.
- A source becomes Viewed only after it successfully opens in Workspace with a
  verified preferred-language transcript ready.
- Opening through any authorized route counts: Sources, a keyword result, a
  clip/source action, or a deep link.
- An attempted open before readiness does not count.
- Viewed is permanent for that user. There is no historical backfill requirement
  because this product has not yet had real usage.
- Offer quick filters for **All**, **Unopened**, and **Viewed**.
- In the main Sources list, use a quiet checkmark for Viewed rows and no
  persistent marker for Unopened rows. Do not retain the orange dot or offer
  alternate Viewed treatments as a user setting.
- Keep the state explicit through the quick filters, accessible row labels, and
  a concise tooltip or equivalent disclosure on the checkmark.
- The Workspace source picker uses the same **Sources** terminology and carries
  Viewed/Unopened state on every item. It may use the words **Viewed** and
  **Unopened** where the compact list or accessibility context needs them.
  Remove any remaining Queue copy.

### Duplicate submission

- One normalized YouTube video ID may appear only once in a project, regardless
  of `youtu.be`, `watch?v=`, tracking parameters, or other accepted URL forms.
- A direct duplicate should politely say that the video is already a Source and
  offer to reveal/open that row when it is visible.
- If the duplicate is hidden, tell a Researcher that it already exists but is
  hidden and that an Owner or Administrator can restore it.
- Bulk ingest is partial-success: add the new sources, then summarize visible
  duplicates, hidden duplicates, unsupported inputs, and failures separately.
- Duplicate submissions create no second source, flag, transcription job, or
  “added by” identity.
- The redesign's Bulk add surface accepts a pasted newline-separated list of
  URLs or video IDs. Remove **Import a CSV instead** from this interface. Keep
  the existing CSV parser and compatibility code unless a later implementation
  spec explicitly retires it.

### Hide and restore

- Hide is project-wide, not personal.
- Project Owners and Administrators may Hide and restore sources. Researchers
  may not.
- Hide does not require a reason.
- Any current member may enable **Show hidden** and inspect hidden sources.
- Hiding never deletes transcripts, clips, comments, keyword evidence, jobs,
  artifacts, provenance, or audit history.
- Hiding may cancel queued or active transcription/translation only when the
  established dependency-aware cancellation boundary says that doing so is
  safe. It must not strand other sources, clips, or consumers.
- Use the existing durable dismissal/restore authority where compatible, but
  present it as Hide/Restore and apply this simplified permission and reason
  contract deliberately.

### Row actions

- Put a direct copy-link icon on every source row for **Copy YouTube link**.
- Reserve the overflow menu for role-valid administrative actions:
  - Owner/Administrator: **Hide source** on visible rows;
  - Owner/Administrator: **Restore source** on hidden rows.
- Do not show a one-item overflow menu to Researchers.

## Workspace behavior

- Workspace is the second primary destination and the only place where a source
  is reviewed and clip ranges are logged.
- The transcript remains the main navigation and selection surface; the player
  provides audiovisual context.
- Show a compact **Approximate timing** state only when timing precision affects
  use. Keep exact provenance available in details, but remove the internal
  phrases `cue timing`, `cue seek`, and `cue bounds` from the ordinary UI.
- Remove the sentence “Equivalent tracks are shown once. Both stay available
  while you read.” The language choices themselves identify the preferred and
  original tracks without implementation commentary.
- Highlight transcript ranges already logged by any project member. Use one
  accessible treatment for the current user's clips and a second treatment for
  clips logged by other members; do not assign a new color to every person.
- Hovering or focusing a logged range shows every matching clip and logger,
  with its range and Topics. Overlapping logged passages are allowed. Represent
  overlap with stacked gutter marks plus the complete hover/focus disclosure
  rather than preventing another valid log.
- Keep playback, selection, logging, keyword, and search emphasis visually
  independent:
  - the actively playing transcript block uses a subdued full-row background
    plus a narrow gold left rail, including while Following is enabled;
  - the current selection retains the selection treatment;
  - logged ranges use their two-category text-level treatment;
  - exact project-keyword occurrences use bold text with a subtle underline;
  - search matches use their temporary search treatment.
- Already-logged passages should default to a compact collapsed presentation.
- When **Already logged here** is expanded, provide **All** and **Mine** filters.
- Editing a clip updates the same clip identity and preserves its comments.
- Use a managed companion player window for an always-on-top mode rather than
  detaching arbitrary web state. The main Workspace remains authoritative, and
  closing, navigation, recovery, and synchronization must be deterministic.
- No-speech logging invokes the required Description dialog described above.
- The **More** menu beside Log clip contains concise action labels only. Do not
  display implementation-effect descriptions inside the menu; show necessary
  explanation after the user chooses an action.

## Clips behavior

- Clips is the third primary destination and the principal place for comments.
- In the table, place the comments disclosure/twirl control immediately after
  the selection checkbox and before Video. Expanding and collapsing comment
  rows should feel like a left-origin table action, not a far-right action.
- Keep comments flat and chronological with existing authorization, tombstone,
  mention, follow, pagination, and offline-replay behavior.
- Preserve the existing 20,000-character comment-body limit unless usability
  testing supplies evidence for a smaller bound.
- Keep Topics visible and distinct from project keywords.
- Make the logged excerpt the row's primary reading content and demote the
  source-video title to smaller secondary metadata. The reference hierarchy is
  approximately 14.5 px for clip text and 12 px for the video title; preserve
  that relative emphasis when implementation tokens differ.
- Give clip text a readable measure of about 68 characters. In the default row,
  let the primary excerpt wrap to as many as two lines instead of forcing a
  single-line ellipsis. Give the paired translation the same readable measure
  and allow it to wrap naturally.
- For a non-English speech clip, show the original-language excerpt first, then
  its English companion immediately below under `Translation from {source
  language}`. This simplified language presentation replaces the earlier
  two-column **Original language** / **English translation** details block but
  does not change either canonical stored role or export behavior. If a distinct
  Workspace preferred-language snapshot was retained, keep any viewer-context
  disclosure secondary and quiet; do not expose internal provenance or
  export-sidecar rules as instructional UI copy.
- Add a sortable **Date Added** value meaning the time the clip itself was
  logged. The default All Clips order is Date Added newest-first.
- Replace the comment-only Unread destination with a unified **New** view:
  - a clip newly logged by another member is marked **New clip**;
  - unread comments are marked **N new comments**;
  - a row may display both states with visually distinct labels;
  - the header badge counts unique affected clips, not the total number of
    comment events;
  - the New view sorts by the most recent unread activity, so a new comment on
    an older clip rises appropriately;
  - a new-clip receipt clears when that clip's preview opens;
  - comment receipts clear when the comment thread is expanded through the
    latest unread comment;
  - merely visiting the New list clears neither state;
  - clips logged by the current user are not new to that user.
- Remove the ambiguous **+ filter** control. Existing search, All, New,
  Mentions me, Mine, and visible Topic filters cover the focused interface; add
  a real named Filters popover only if a later requirement identifies a needed
  facet.
- Clicking any neutral area of a clip row opens the existing floating companion
  preview. The selection checkbox and comments disclosure retain their own
  behavior, and **Edit** remains the one explicit row action.
- Clip selection checkboxes belong here. Selecting one or more clips reveals an
  **Export** action above the table.
- Export opens a contextual interface for preset/settings, storage preflight,
  progress, retry/cancel, and artifact outcomes. These controls should not
  occupy the default Clips layout when nothing is selected.
- Artifact verification, reveal/open, relink, and re-export remain contextual
  recovery actions attached to a clip or export result.

## Account, project settings, and administration

- Keep account preferences separate from project settings.
- The project name in the header is the active-project switcher. It lists every
  active personal or shared project in which the current user has membership,
  and never lists a project the user is not authorized to enter. Switching it
  changes the project context for Sources, Workspace, and Clips.
- Use account-level New state for newly logged clips plus comment/mention
  activity without turning the main project shell into an activity dashboard.
- Project Settings owns membership, roles, visibility, project keywords,
  project processing policy, and the single project-level rights attestation.
- Project archiving is a project-wide, non-destructive lifecycle action:
  - Owner and Administrator may archive and restore; Researcher may do neither.
  - Archive belongs in a contextual **Project lifecycle** area of Project
    Settings and requires confirmation because it affects every member.
  - An archived project disappears from the normal active-project switcher and
    active project lists for every member. Membership, sources, transcripts,
    clips, comments, Topics, settings, history, jobs, and artifacts remain
    stored; archiving is not deletion.
  - Owner and Administrator can reach a separate **Archived projects**
    management view and restore the project. Restore returns it to every
    member's active-project list without recreating membership or content.
  - A normal or stale deep link to an archived project does not silently open
    it as active. It explains that the project is archived and sends the user
    to an active project; an authorized Owner or Administrator also gets the
    contextual restore route.
  - A bounded implementation spec must decide how already-running ingestion,
    transcription, translation, and export work settles during archive. That
    decision must preserve artifacts and idempotency and must not be inferred
    from the visual mockup.
- Platform administration is a separate global capability-gated destination.
  It owns:
  - cloud transcription-provider configuration and user approvals;
  - cloud translation-provider configuration and user approvals;
  - provider health, pricing, usage, suspension, and draining state;
  - Argos feed refresh, candidate evaluation, warnings, enable/disable/revoke,
    override audit reasons, signed catalog releases, and rollback.
- The platform-admin destination must not expose transcript text, source URLs,
  project membership/content, local paths, credentials, grants, or raw provider
  errors.

## Existing capabilities intentionally removed from the primary UI

These capabilities should not be mistaken for deleted data or permission to
remove established contracts:

| Existing capability                      | Redesign treatment                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Queue / Reviewed / Dismissed source tabs | Replace with one Sources list plus optional Show hidden                 |
| Claim and assignment                     | No UI in this redesign                                                  |
| Explicit review completion/reopen        | No ordinary UI; Logged by reflects actual clip logging                  |
| Source priority and flagger controls     | No ordinary UI                                                          |
| Bulk source triage                       | No ordinary UI                                                          |
| Dismiss/restore terminology              | Present as admin Hide/Restore                                           |
| General activity digest                  | Hide; use Unopened and focused unread indicators                        |
| Project-shared bookmarks                 | Preserve implementation; no primary surface                             |
| Named transcription-batch management     | Hide from the ordinary flow; sources still process through durable jobs |
| CSV source import                        | Remove from Bulk add UI; preserve parser/compatibility code             |
| Provider/tool internals                  | Show only contextual readiness or remediation                           |
| Export dashboards                        | Reveal from Clips selection or an affected export/artifact              |

## Implementation deltas

The following are functional work, not CSS-only changes.

### Contracts and persistence

- Add a project archive lifecycle record, including archive timestamp, actor,
  version/audit data, and an idempotent restore transition. Preserve the
  existing membership and project identifier across both transitions.
- Default project-list and project-switcher reads to active memberships only.
  Expose archived projects through a separate Owner/Administrator-authorized
  management read rather than mixing them into the ordinary switcher.
- Add a per-user/project-video Viewed receipt with the exact successful ready
  Workspace-open transition and timestamp.
- Add or reuse per-user activity receipts for clips created by other members
  and existing unread comments, with a unique affected-clip count and the
  separate clearing transitions defined above.
- Add authorized worklist filters and counts for Unopened and Viewed.
- Expose Date Added and bounded added-by identity from the canonical project
  source record.
- Expose current-user versus other-member clip counts and bounded Logged by
  summaries without leaking removed-member identity.
- Return duplicate outcomes that distinguish visible from hidden canonical
  sources and support partial-success bulk summaries.
- Resolve transcript readiness for the requesting user's preferred language,
  not merely the presence of any source or English track.
- Keep Workspace display evidence separate from canonical clip language
  evidence. A logging command selected from any display track must snapshot the
  source-video range plus original and English track/version/text roles; an
  optional distinct preferred snapshot is viewer-context provenance only.
- Preserve backward readability for existing schema-version-2 `preferred`
  evidence while preventing UI/API consumers from presenting that field as a
  third canonical clip transcript. A bounded implementation spec must decide
  whether clarified naming requires a new schema version or a compatible
  presentation/contract interpretation.
- Preserve Hide/Restore history while changing the user-facing command contract
  and removing the required-reason assumption.
- Add or reuse provider-neutral account approval state independently for cloud
  transcription and cloud translation.
- Extend provider-specific access requests with the optional normalized
  500-character user message and expose it, safely escaped, to the requesting
  user and the authorized platform-administrator queue.
- Expose clip creation time and authorized Date Added sorting independently of
  latest unread activity sorting.

### Authorization

- Owner and Administrator may Archive/Restore a project; Researcher may not.
  Archive state is enforced server-side for project entry and mutation, not
  merely hidden by the renderer.
- Owner and Administrator may Hide/Restore; all members may Show hidden.
- Project roles cannot grant platform language-service administration.
- Cloud-provider approvals are scoped to the exact provider and service.
- Row and remediation actions must be derived from server-authorized capability,
  not renderer inference.

### Orchestration

- Make Archive/Restore concurrency-safe and idempotent. Define the treatment of
  in-flight jobs explicitly before implementation; never delete project data or
  reuse Archive as a cascading cancellation shortcut.
- Gate Workspace entry on verified preferred-language readiness.
- Gate speech-clip logging separately on resolvable canonical original and
  English evidence for the selected source-time range. Never let the displayed
  preferred translation satisfy or overwrite either canonical role.
- Ensure all Workspace entry routes converge on the same atomic Viewed receipt.
- Make Hide cancellation dependency-aware across transcript, translation,
  clip, export, and artifact consumers.
- Preserve direct and bulk ingest idempotency under normalized YouTube identity.
- Keep newline-list Bulk add on the normal path without exposing CSV import.
- Keep optional capability setup and access requests contextual and resumable.
- Keep cloud service selection inside the focused request flow until access is
  approved; do not require an unapproved user to configure a provider before
  they understand why online processing is exceptional.

### Test matrix

- The project switcher contains every active membership and no unauthorized or
  archived project; switching changes all three primary project destinations.
- Archive/Restore role authorization, confirmation, concurrency, audit data,
  deep-link behavior, removal from and return to every member's active list,
  preservation of membership/content/artifacts, and the specified in-flight-job
  policy.
- Direct and bulk duplicate URL variants, including hidden duplicates and
  partial success.
- Viewed is not set by add, pre-ready click, failed open, or denied deep link;
  it is set exactly once by every successful ready Workspace entry route.
- Preferred-language readiness and each processing/remediation badge state.
- Owner/Administrator Hide/Restore, Researcher denial, all-member Show hidden,
  safe cancellation, and preservation of all research evidence.
- Current-user/other clip counts and Logged by identity under member removal.
- Keyword-strip filtering, overflow, aliases, and compact-width composition.
- Optional onboarding skip followed by contextual setup/approval recovery.
- Independent cloud transcription and translation requests/grants, plus Argos
  candidate approval and hard-safety override denial.
- Online request disclosure ordering, optional user-message normalization and
  authorization, one-provider and multi-provider variants, pending withdrawal,
  and visibility of the message in the administrator decision flow.
- Clips comment disclosure placement, selection-triggered Export, and artifact
  recovery without permanent interface clutter.
- Clips reading hierarchy keeps the video title secondary, makes the clip text
  larger, uses a readable wrapping measure, and presents non-English pairs as
  original text followed by `Translation from {source language}` and the
  English text.
- Logged-range overlap, mine/others visual distinction, logger disclosure,
  active-playback separation, project-keyword emphasis, and All/Mine filtering.
- Unified New state for other-member clips and comments, unique badge counts,
  exact clearing transitions, Date Added ordering, and row-to-preview behavior.
- Logging the same time range while viewing Original, English, or a distinct
  preferred translation produces identical canonical original/English clip
  evidence. Preferred viewer context remains optional secondary provenance and
  never alters clip identity, default search/CSV, or the export sidecar set.

## Superseded design assumptions

| Earlier assumption                                           | Current decision                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Queue, Reviewed, and Dismissed are primary source views      | One Sources list; Show hidden is optional                                                  |
| Reviewers claim/assign and explicitly finish sources         | No assignment or completion ceremony                                                       |
| Workspace can open before a transcript and log manual ranges | Preferred-language transcript readiness is a hard entry gate                               |
| Orange dot represents any recent activity                    | Remove it; quietly check Viewed rows and leave Unopened rows unmarked                      |
| Translation is a per-source choice                           | Preferred-language translation is automatic when required and available                    |
| “English version” describes the user's translated view       | Use the user's preferred language; English remains a separate canonical role               |
| One online-language approval is sufficient                   | Online transcription and translation are separately approved per provider/service          |
| A desktop build owns the complete Argos pack list            | Server-managed evaluated signed catalog; compatible packs can be enabled without a rebuild |
| Clip descriptions are the main research annotation           | Comments are primary; description is secondary except required No speech dialog            |
| The transcript visible during logging becomes clip text      | Display language is personal; clips canonically log original plus English by source time   |
| The header badge represents unread comments only             | It opens one New view for other-member clips and unread comments                           |
| Clips rows reveal separate Open and Edit actions             | Neutral row click opens the companion preview; Edit remains explicit                       |
| Bulk add advertises CSV import                               | Bulk add accepts a pasted newline list; CSV import is hidden                               |

## Open design and planning decisions

- Decide whether skipping an optional capability should clear any setup/account
  attention indicator or merely suppress it until the capability is requested.
- Decide how an authorized platform administrator enters the global admin
  destination without making it visible to ordinary members.
- Inventory the complete project Owner/Administrator capability set for product
  documentation; the Sources decisions above are only one part of that list.
- Define the shared design-system contract for VERA Script to Timeline before
  its mockups begin: tokens, shell, tables, comments, Topics, readiness,
  contextual actions, empty/error states, and language-service terminology
  should be reused, while each application's central working surface remains
  purpose-built.

## Planning sequence

Do not implement this entire document as one task. A safe sequence is:

1. Sources read-model and behavior contracts: duplicate outcomes, preferred-
   language readiness, Date Added/added-by, Viewed receipts, counts, filters,
   and Hide authorization.
2. Sources visual implementation against those contracts, including compact
   states and contextual remediation.
3. Workspace readiness gate and converged Viewed transition, followed by the
   managed companion-player and No speech description adjustment.
4. Clips table/comment/selection/export presentation while preserving the
   existing comment, Topic, export, and artifact authorities.
5. Onboarding and contextual capability remediation once the provider-neutral
   language-service and Argos-admin contracts are stable.
6. Project lifecycle contracts and implementation: archive persistence,
   authorization, list/deep-link behavior, in-flight-job policy, and restore.
7. Shared suite design primitives and a dedicated Script to Timeline design
   brief before that product's first high-fidelity prototype.
