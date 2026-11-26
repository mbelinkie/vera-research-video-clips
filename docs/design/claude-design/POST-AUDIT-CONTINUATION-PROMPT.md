# Continue VERA after the final Claude Design approval audit

You are continuing the VERA Research Video Clips redesign review after a
completed independent audit of the live Claude Design prototype. The prior
Codex task became unsafe to open in the desktop app because its history contains
very large browser payloads. Do not navigate to that task or load its full
JSONL. This prompt and the checked-in design-review documents preserve its
conclusions.

## Current decision

The Claude Design prototype is **not approved** as the visual model for
implementation planning.

The final live audit passed 26 of the 33 correction items. Seven remain open:

- `CD-001`
- `CD-005`
- `CD-022`
- `CD-023`
- `CD-027`
- `CD-030`
- `CD-031`

Do not begin production implementation from the prototype while any of those
items remains open. Do not reinterpret an accidental mockup state as a product
decision. `BEHAVIOR-CONTRACT.md` remains authoritative and was not changed by
the audit.

## Objective for the next task

Continue from the completed audit without repeating the entire historical
review:

1. Read the authoritative project and design documents listed below.
2. Use the consolidated correction prompt in this file when the user asks you
   to submit the remaining fixes to Claude Design. Do not send it without that
   explicit authorization.
3. After Claude reports a new revision, independently retest all seven open
   items and their cross-screen/handoff implications in the live prototype.
4. Update `APPROVAL-CHECKLIST.md` with exact live evidence.
5. Approve the prototype for implementation planning only when every final gate
   in the checklist passes.

Preserve unrelated changes in the dirty worktree. Do not modify production
application code as part of design approval unless the user explicitly asks for
implementation and a bounded implementation spec has first been created.

## Read these sources in order

### Product and project authority

1. [`PROJECT_GUIDE.md`](../../../PROJECT_GUIDE.md)
2. [`outline.md`](../../../outline.md)
3. [Research-video workflow skill](../../../.agents/skills/research-video-clip-workflow/SKILL.md)

### Design-review authority

4. [`README.md`](./README.md)
5. [`BEHAVIOR-CONTRACT.md`](./BEHAVIOR-CONTRACT.md)
6. [`APPROVAL-CHECKLIST.md`](./APPROVAL-CHECKLIST.md)
7. [`UI-CONTEXT.md`](./UI-CONTEXT.md)
8. [`SANITIZATION.md`](./SANITIZATION.md)

The checklist contains the exact evidence and pass/fail status for all
`CD-001` through `CD-033` and `VB-001` through `VB-018`. This prompt preserves
the final conclusions but does not replace the checklist's item-level authority.

### Prototype

- Live prototype: [VERA Redesign](https://claude.ai/design/p/011eee38-8b6b-48aa-a154-d6c0060d4f23?file=VERA+Redesign.dc.html)
- Original exported reference bundle:
  `/Users/matthewbelinkie/Downloads/VERA design feedback.zip`
- Extracted historical prototype:
  `/Users/matthewbelinkie/Downloads/VERA design feedback/VERA Redesign.dc.html`

Use the live prototype for approval. The export is only a historical reference.
Use the user's external browser for the Claude prototype; do not load it in the
Codex in-app browser. Do not import private runtime data or bypass the
sanitization rules.

### Historical task reference

- Archived task title: `design approval`
- Task ID: `01a0448f-01ad-78e3-bfce-9897f44bea94`

Do not open that task in the UI. Its browser-tool history is unusually large
and was associated with a desktop-app freeze. The conclusions needed for future
work are preserved here and in `APPROVAL-CHECKLIST.md`.

## Final audit evidence to preserve

The live audit was completed on 2026-08-27 in external Chrome after reading
Claude's latest completion notes.

### Interaction and coverage that passed

- All 26 advertised scenario controls worked by direct pointer click and Enter
  at both `1280 × 800` and `1024 × 768`.
- In every scenario test, the selected control, visible viewport label, and live
  DOM state changed together.
- Both viewport controls rendered the named width correctly.
- Sources, Workspace, Clips, Installation setup, Owner project setup, Account
  Settings, Platform Administration, all four project-lifecycle presentations,
  Component States, and Visual Tokens were inspected at both widths.
- Compact Sources and Clips exposed the named `Sort · Date added` control.
- `CD-027`'s application counts agreed at four unique affected clips: the
  header badge, New tab, All Clips summary, and affected rows were consistent.
- Owner Restore controls were present for direct and bulk hidden duplicates.
  Researcher Restore controls were absent from the DOM, with the correct
  Owner/Administrator explanation.
- Owner, Administrator, and Researcher archive/deep-link lifecycle behavior
  passed at both widths.
- The exact Researcher → Archived projects → Claude Reload sequence returned a
  nonempty Application frame, preserved the Researcher role, and removed all
  Restore controls when Archived projects was reopened.
- Both Component States and Visual Tokens were reachable at both widths.
- `CD-011`, `CD-012`, `CD-016`, `CD-021`, `CD-026`, `CD-032`, and `CD-033` were
  newly verified by this final audit.

The complete passed set is:

`CD-002`, `CD-003`, `CD-004`, `CD-006`, `CD-007`, `CD-008`, `CD-009`,
`CD-010`, `CD-011`, `CD-012`, `CD-013`, `CD-014`, `CD-015`, `CD-016`,
`CD-017`, `CD-018`, `CD-019`, `CD-020`, `CD-021`, `CD-024`, `CD-025`,
`CD-026`, `CD-028`, `CD-029`, `CD-032`, and `CD-033`.

All 18 verified-baseline items, `VB-001` through `VB-018`, remained checked.
Do not regress them while correcting the seven remaining items.

### Seven open approval items

#### `CD-001` and `CD-005` — both online-service state matrices

The six-state Account Settings simulator controls only Online translation.
Online translation correctly demonstrates Not requested, Pending, Approved,
Denied, Revoked, and Withdrawn. Online transcription remains fixed at Approved,
so these requirements cannot be verified for both services:

- request-first placement in the unrequested state;
- the service-specific request dialog;
- state-driven provider, history, usage, withdrawal, and stop/switch details.

#### `CD-022` — contradictory Installation summary

Installation Step 2 correctly says storage room, privacy consent, project rights
basis, and operation-specific requirements still apply. Step 4 then says
research is ready and that adding sources, reading existing transcripts or
captions, logging clips, and commenting waits on nothing else. That unconditional
summary contradicts Step 2 and the behavior contract.

#### `CD-023` — stale rights timing

Owner setup still labels Rights attestation `needed before export` and frames it
as required only before export or online-provider crossing. Project Settings,
Component States, and Visual Tokens repeat the export/provider-only boundary.
The contract instead uses one project rights attestation for the normal source-
processing rights boundary wherever required, while retaining any stronger
operation-specific safety gate.

#### `CD-027` — stale Unread wording in handoff

The application count and unique-clip behavior are correct, but Component States
still says `most recent unread activity` and `latest unread comment`. The
user-facing model is one **New** view containing newly logged clips and unread
comments, with the badge counting unique affected clips. Both handoff sheets
must be searched for stale Unread variants.

#### `CD-030` — handoff synchronization and dialog accessibility

Component States and Visual Tokens now agree with the application on Workspace
gating, row actions, multilingual presentation, and Viewed. They still repeat
stale Unread terminology and the export/provider-only rights boundary.

The request-access, no-speech Description, export, and archive-confirmation
overlays look like dialogs but are plain `div` elements without dialog role,
modal semantics, accessible names, or the focus behavior promised by the
handoff. The request-message and no-speech Description textareas also lack
accessible DOM labels.

#### `CD-031` — project choices do not switch context

The menu correctly groups five active member projects, excludes archived
projects from active choices, and links to separate archived management at both
widths. However, selecting another project only closes the menu. At 1280,
`Coastal Flood Narratives` did not replace `Urban Heat Research`; at 1024,
`Pavement and shade audit` also did not replace it. The header, Sources,
Workspace, and Clips all remained in the Urban Heat Research fixture context.

### Reliability result

An external-browser connection reset once during the audit, but reconnecting
and using smaller interaction batches completed the matrix. The earlier blank
Researcher reload failure did not reproduce in the final sweep; `CD-032` and
`CD-033` are therefore verified. Do not carry the obsolete reload failure
forward as an open blocker.

## Consolidated correction prompt for Claude Design

The following prompt was drafted after the final audit and has **not been
sent**. Send it only when the user explicitly authorizes sending corrections to
Claude Design.

```text
Please fix the remaining VERA approval blockers below without changing the focused visual direction or contradicting BEHAVIOR-CONTRACT.md.

CD-001 / CD-005 — Account Settings
Provide independently operable Not requested, Pending, Approved, Denied, Revoked, and Withdrawn states for both Online translation and Online transcription. In each Not requested state, put Request access immediately after the local-first explanation and before provider, history, or usage detail. Each service must open its own cost-first, provider-specific request dialog with the optional 500-character administrator message. State-specific provider, history, usage, withdrawal, and stop controls must appear only when relevant.

CD-022 — Installation summary
Make Step 4 agree with Step 2. Remove “None of this waits on anything else” and any unconditional “Research is ready” claim. Explain concisely that optional Transcription, Translation, and Export setup may remain skipped, while storage, privacy, project rights, transcript readiness, and operation-specific requirements still gate the operations that need them.

CD-023 — Rights timing
Update Owner setup, Project Settings, Component States, and Visual Tokens so the single project rights attestation covers the normal source-processing rights boundary wherever required, not merely export or online-provider crossing. Preserve stronger operation-specific safety gates. Remove “needed before export” and categorical claims that reading/logging never wait on rights.

CD-027 / CD-030 — New terminology and handoff synchronization
Replace “most recent unread activity” and “latest unread comment” in Component States with the unified New model. Search both handoff sheets for all stale Unread variants. Keep the verified unique affected-clip count of 4. Ensure the sheets agree with the application on rights, Account Settings, Viewed, multilingual clips, Workspace gating, and row actions.

CD-030 — Dialog accessibility
Give request-access, no-speech Description, export, and archive-confirmation overlays proper dialog/modal semantics, accessible names, focus containment, Escape behavior, and focus restoration. Associate visible labels with the request-message and Description textareas.

CD-031 — Project switching
Make each active project choice actually change the header and fixture context for Sources, Workspace, and Clips. Verify this with pointer and Enter at both widths. Unauthorized and archived projects must remain absent from active choices.

Acceptance:
1. Re-run every advertised scenario and both viewport controls by pointer and Enter.
2. Exercise both online services through all six Account Settings states.
3. Switch to at least two other projects and confirm all three primary destinations change.
4. Recheck Owner, Administrator, and Researcher archive/deep-link behavior, including Reload.
5. Search both handoff sheets for stale Unread and export-only rights copy.
6. Report each listed CD item individually as Done or Not done with the exact live interaction used.
```

## Required retest after Claude changes the prototype

Use the live revision and external browser. At both `1280 × 800` and
`1024 × 768`:

1. Read Claude's latest completion notes, but treat them only as claims.
2. Exercise every advertised scenario and both viewport controls with a normal
   pointer click and Enter.
3. Exercise both Online translation and Online transcription through all six
   Account Settings states and each independent request dialog.
4. Walk every Installation and Owner setup step and compare early gate copy with
   final summaries.
5. Switch to at least two other active projects and confirm the header, Sources,
   Workspace, and Clips all change fixture context.
6. Recheck Owner, Administrator, and Researcher duplicate, archive, archived
   deep-link, and Reload behavior.
7. Inspect the accessibility tree/DOM for all four dialogs and both textareas;
   verify naming, focus containment, Escape, and focus restoration.
8. Search Component States and Visual Tokens for stale Unread terminology and
   export-only rights copy, and ensure the application and both handoff sheets
   agree.
9. Confirm all previously passed `CD-*` and `VB-*` behavior has not regressed.
10. Record exact evidence in `APPROVAL-CHECKLIST.md`; do not approve from notes
    or appearance alone.

## Deliverables

1. An updated `APPROVAL-CHECKLIST.md` with exact live evidence and honest
   checkboxes.
2. A concise report of what passed, what remains blocked, and anything that
   could not be verified.
3. A clear approval or non-approval decision for implementation planning.
4. If blockers remain, one consolidated correction prompt. Do not send it
   without explicit authorization.

Update `BEHAVIOR-CONTRACT.md` only if the user makes a deliberate new product
decision. Do not alter it merely to match a prototype inconsistency.
