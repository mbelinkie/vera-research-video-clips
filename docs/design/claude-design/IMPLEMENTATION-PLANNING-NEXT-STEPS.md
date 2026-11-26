# VERA redesign implementation planning: next steps

- Status: planning record only; not an implementation specification
- Last updated: 2026-08-27
- Implementation authorized: no
- Visual reference: [Claude Design prototype](https://claude.ai/design/p/011eee38-8b6b-48aa-a154-d6c0060d4f23?file=VERA+Redesign.dc.html)
- Behavioral reference: [`BEHAVIOR-CONTRACT.md`](./BEHAVIOR-CONTRACT.md)
- Approval evidence: [`APPROVAL-CHECKLIST.md`](./APPROVAL-CHECKLIST.md)

## Why this document exists

The redesign is a major product revision that adds behavior, removes controls
from the primary interface, and changes the information architecture. It must
not be implemented as one large UI rewrite or as a sequence of disconnected
visual edits.

This record preserves the intended execution strategy while the design is
being completed. It is not detailed enough to hand directly to an
implementation agent. After both VERA product designs are frozen, a separate
planning-only audit must produce the code-level implementation map and the
first bounded executable spec described below.

## Preconditions before implementation planning

1. Complete the remaining Research Video Clips prototype corrections and mark
   the final approval gate in `APPROVAL-CHECKLIST.md` complete. At the time this
   record was written, CD-004, CD-009, CD-023, CD-027, and CD-030 remained
   open.
2. Explicitly approve the linked Claude Design prototype as the visual model.
3. Prototype VERA Script to Timeline before Research Video Clips implementation
   begins.
4. From both approved designs, freeze a shared design-language contract for
   tokens, shell grammar, tables, comments, Topics, readiness and remediation,
   contextual actions, dialogs, empty/error states, and language-service
   terminology.
5. Keep the products independently deployable. Implement local component
   libraries in each repository; do not create a shared UI code package until
   both implementations demonstrate genuinely identical reusable behavior.

## Required implementation-planning deliverables

The planning-only audit must inspect the approved live prototypes, their
captured handoff evidence, this repository's current code, contracts,
persistence, authorization, and tests. It must add a durable planning package
containing:

1. **Approved design inventory** — permanent links and captured references for
   every approved screen, viewport, role, dialog, component state, and visual
   token used for implementation acceptance.
2. **Design-to-code traceability matrix** — every decision in
   `BEHAVIOR-CONTRACT.md` mapped to the existing components, contracts, APIs,
   database authorities, permissions, tests, and documentation it affects.
3. **Change classification** — classify every item as retained behavior,
   presentation replacement, new functional work, UI removal with backend
   retention, or deliberately retired behavior.
4. **Deletion map** — identify the superseded JSX, styles, props, test mocks,
   terminology, and routes that must be removed in the same slice as their
   replacement. Separately identify hidden durable capabilities that must
   remain available contextually or through established APIs.
5. **Interface and migration map** — define every shared-schema, read-model,
   command, authorization, cloud migration, and local migration change, plus
   populated-data compatibility and concurrency behavior.
6. **Dependency-ordered slice backlog** — small end-to-end slices with explicit
   prerequisites and merge order. Do not group the entire redesign into one
   active spec.
7. **Executable slice specifications** — one Markdown spec per authorized
   implementation task, naming exact user-visible outcomes, affected symbols
   and boundaries, failure states, non-goals, acceptance criteria, narrow test
   commands, broader gates, and manual visual states.
8. **First architecture-runway spec** — a behavior-neutral renderer
   decomposition that prevents the redesigned screens from extending the
   existing top-level monoliths.
9. **Regression matrix** — automated and manual coverage for every approved
   scenario at `1280 × 800` and `1024 × 768`, including roles, keyboard use,
   focus behavior, compact composition, and degraded states.

No production code should change during this planning-only audit.

## Execution strategy after the planning package is approved

### Baseline and branch discipline

- Finish, commit, or safely isolate the current language-service work before
  starting the redesign. The worktree was substantially dirty when this record
  was created, so a redesign agent must not assume the current diff belongs to
  its task.
- Reconcile milestone/status documentation with the actual committed state,
  run the complete repository gate, back up the personal dogfood database, and
  tag the known-good pre-redesign commit.
- Use one short-lived `codex/redesign-*` branch and one bounded active spec per
  slice. Merge verified slices in dependency order.
- Because the product is pre-alpha and has no production users, do not maintain
  complete old and new interfaces behind a runtime feature flag. Replace one
  destination at a time and delete its superseded presentation code in the
  same slice. Git history and the pre-redesign tag provide rollback.
- Intermediate mainline UX may be incomplete between slices, but every merged
  slice must have coherent contracts, migrations, authorization, and tests.

### Renderer architecture guardrails

- Reduce `App` to session, active-project, destination, and cross-screen
  navigation orchestration. It must not own destination-specific form state or
  API command implementations.
- Give each destination a controller boundary for server reads and commands,
  plus a mostly pure screen driven by typed view models and grouped action
  objects.
- Leaf presentation components must not call APIs, infer roles, or duplicate
  shared contract shapes.
- Create one local foundation for tokens and reusable buttons, badges, dialogs,
  menus, tables, tooltips/popovers, and loading, empty, blocked, and error
  states.
- Split screen styles and tests by destination. Do not replace the current
  monoliths with new files that mix orchestration, persistence, and thousands of
  lines of rendering.
- Keep player, transcript, provider, media, worker, storage, catalog, and sync
  behavior behind their established boundaries.

### Functional vertical-slice order

1. **Behavior-neutral architecture runway**
   - Extract destination controllers and pure screen seams from the current
     renderer without changing visible behavior.
   - Add the local design primitives and deterministic approved-state fixture
     harness.
   - Split the existing large Playwright suite by destination while preserving
     coverage.

2. **Sources contracts and screen**
   - Add preferred-language readiness, per-user Viewed receipts, Date Added and
     added-by evidence, current-user versus other-member clip counts, bounded
     Logged by summaries, visible/hidden duplicate outcomes, and
     All/Unopened/Viewed filters.
   - Enforce Owner/Administrator Hide/Restore and all-member Show hidden.
   - Replace the existing Add/Review/worklist presentation with one Sources
     destination and contextual remediation.
   - Remove ordinary Claim, assignment, completion, priority, flagger,
     bulk-triage, Reviewed, and Dismissed UI while retaining durable history and
     supporting authorities required by the contract.

3. **Workspace readiness and review**
   - Gate every Workspace entry route on a verified transcript in the current
     user's preferred language.
   - Record Viewed exactly once only after successful ready entry, regardless
     of the authorized navigation route.
   - Preserve canonical original-plus-English clip evidence regardless of
     which display track the researcher selected.
   - Keep manual range selection only after readiness. Enforce the redesigned
     required Description for No speech in both shared validation and UI.
   - Implement the approved logged-range, overlap, playback, selection,
     keyword, search, and All/Mine treatments.
   - Add the managed Electron companion-player window without moving Workspace
     authority out of the main renderer.

4. **Clips contracts and screen**
   - Add clip Date Added sorting and per-user unified New receipts for clips
     logged by other members and unread comments.
   - Preserve the specified unique-clip badge count and independent clearing
     transitions for clip preview and comment-thread expansion.
   - Rebuild the table around comments-first disclosure, Topics, neutral-row
     preview, explicit Edit, and contextual multi-selection Export.
   - Present the original-language excerpt as primary content, the source-video
     title as smaller metadata, and the English companion below
     `Translation from {source language}`.
   - Keep presets, storage preflight, progress, retry/cancel, verification,
     relink, reveal/open, and re-export contextual rather than permanently
     occupying the default table.

5. **Account, onboarding, and platform administration**
   - Keep online transcription and online translation as independent
     provider-and-service-specific access decisions.
   - Add the optional normalized 500-character requester message and prove its
     exact authorized round trip into account history and the platform-admin
     queue.
   - Keep Transcription, Translation, and Export independently skippable, with
     the smallest contextual remediation at the first blocked action.
   - Expose platform administration only through the global capability;
     project roles never imply access.

6. **Project lifecycle**
   - Add optimistic, idempotent Archive/Restore with actor, timestamp, version,
     and audit evidence.
   - Archive removes the project from active lists and blocks new user
     mutations without deleting membership, content, jobs, or artifacts.
   - Pause queued or unstarted project work without changing job identity.
     Already executing transcription, translation, and export work may drain
     through finalization and mandatory cleanup. Restore resumes eligible
     paused work under the existing project processing policy.
   - Add archived-project management and safe archived deep-link handling for
     authorized roles.

7. **Consolidation and release gate**
   - Remove obsolete renderer paths, CSS rules, test fixtures, compatibility
     props, and stale terminology.
   - Confirm that no destination-specific orchestration has migrated back into
     `App` and no replacement screen has become another monolith.
   - Update `PROJECT_GUIDE.md`, `outline.md`, and completed specs only for
     verified behavior.

## Expected interface and compatibility work

- Add shared schemas/read models for project archive lifecycle, successful
  Workspace-open Viewed receipts, preferred-language readiness, Sources
  summaries and duplicate outcomes, and unified per-user clip New state.
- Extend cloud-provider access requests with the optional requester message and
  its authorized administrator projection.
- Tighten No speech clip creation so Description is mandatory; an initial
  comment alone no longer satisfies the redesigned rule.
- Preserve existing schema-version-2 preferred-language evidence as secondary
  viewer-context provenance unless a bounded compatibility analysis proves a
  new schema version is necessary.
- Use additive local/cloud migrations and preserve current dogfood projects,
  transcripts, clips, comments, jobs, artifacts, and audit history.
- Do not change transcript, export, worker, object-storage, local-agent, or
  authoring-handoff authority except where a bounded redesign slice explicitly
  requires it.

## Verification and acceptance expectations

Each functional slice must include contract validation, empty and populated
migration tests, role/authorization tests, optimistic conflict and idempotent
replay tests, focused API/controller tests, and manual verification of the
affected approved states.

The renderer acceptance suite should be separated into Sources, Workspace,
Clips, Account/Administration, Project Lifecycle, and shell/navigation suites.
Every approved prototype scenario must be exercised at `1280 × 800` and
`1024 × 768`, including keyboard activation, focus containment/restoration,
compact sorting, blocked states, and role variants. Maintain selected visual
baselines for the representative screens and manually compare the complete
approved scenario matrix before final acceptance.

The final gate includes formatting, typecheck, all Vitest tests, both migration
suites, production web and desktop builds, the complete Playwright suite, a
packaged Electron smoke test, an existing-data migration smoke, a dead-
presentation-code audit, and manual verification of the critical workflow.

## Prompt for the future planning-only task

When both designs are final, start a fresh planning task with this request:

> Perform a planning-only implementation audit of the approved VERA Research
> Clips and Script-to-Timeline designs. Inspect the live prototypes, captured
> handoff evidence, current code, contracts, persistence, authorization, tests,
> and dirty-worktree baseline. Produce a repo-tracked redesign implementation
> map, dependency-ordered slice backlog, deletion map, design-to-code
> traceability matrix, interface/migration map, regression matrix, and the
> complete executable spec for the first slice. Link every approved visual
> source and identify the exact existing files and symbols affected. Do not
> implement production changes.

That task's output—not this planning record—is the artifact that should be
handed to the first implementation agent.
