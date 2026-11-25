# Final approval audit for the VERA Claude Design

Claude Design has reported that all remaining VERA redesign issues are fixed.
Perform the final independent approval audit of the newest live prototype.
Claude's completion notes are claims to verify, not proof. Approve the design
only if every required interaction, viewport, role, accessibility behavior,
handoff statement, and regression gate passes in the live revision.

## Scope and authority

This task is a design-review and documentation task. You are authorized to
inspect the live prototype and update the design approval checklist. Do not
modify production application code, create an implementation spec, or send
another correction prompt to Claude unless the user separately asks.

Preserve all unrelated work in the dirty repository.

Read these sources in order before testing:

1. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/PROJECT_GUIDE.md`
2. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/outline.md`
3. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/.agents/skills/research-video-clip-workflow/SKILL.md`
4. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/README.md`
5. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/BEHAVIOR-CONTRACT.md`
6. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/APPROVAL-CHECKLIST.md`
7. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/POST-AUDIT-CONTINUATION-PROMPT.md`
8. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/UI-CONTEXT.md`
9. `/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/SANITIZATION.md`

`BEHAVIOR-CONTRACT.md` is the product authority. Do not change it to excuse a
prototype inconsistency. Update it only if the user makes a deliberate new
product decision; no such decision has been made for this audit.

## Browser safety

Use the user's external Chrome browser and the `chrome:control-chrome` skill for
the entire live audit. Do not load the Claude prototype in Codex's in-app
browser.

Live prototype:

`https://claude.ai/design/p/011eee38-8b6b-48aa-a154-d6c0060d4f23?file=VERA+Redesign.dc.html`

Do not open the archived Codex task titled `design approval` or read its full
local JSONL. Its history contains unusually large browser payloads and was
associated with a desktop-app freeze. The authoritative recovered conclusions
are already in `POST-AUDIT-CONTINUATION-PROMPT.md` and
`APPROVAL-CHECKLIST.md`.

If the external browser connection resets, reconnect and continue in smaller
batches. Do not convert a tool failure, blank frame, or inaccessible state into
a pass. Record it as unverified if it cannot be reproduced reliably.

## Previous audit state

The prior independent audit did **not** approve the prototype. It verified 26
of 33 `CD-*` items and all 18 `VB-*` baseline items. These seven items remained
open:

- `CD-001`
- `CD-005`
- `CD-022`
- `CD-023`
- `CD-027`
- `CD-030`
- `CD-031`

The 26 previously passed items were:

`CD-002`, `CD-003`, `CD-004`, `CD-006`, `CD-007`, `CD-008`, `CD-009`,
`CD-010`, `CD-011`, `CD-012`, `CD-013`, `CD-014`, `CD-015`, `CD-016`,
`CD-017`, `CD-018`, `CD-019`, `CD-020`, `CD-021`, `CD-024`, `CD-025`,
`CD-026`, `CD-028`, `CD-029`, `CD-032`, and `CD-033`.

Do not assume either the seven fixes or the earlier passes remain valid in the
new revision. Retest the repaired behavior and run the complete regression
matrix below.

## Start with Claude's notes

Read Claude's latest completion notes in the live design before interacting
with the switchboard. Record what Claude says changed for each of the seven
open IDs and any additional changes Claude says it made. Then independently
verify the actual prototype. Do not copy Claude's Done labels into the checklist
without live evidence.

## Focused verification of the seven repairs

Test every applicable item at both `1280 × 800` and `1024 × 768`, using both a
normal pointer click and Enter wherever the state is controlled interactively.

### `CD-001` and `CD-005` — Account Settings for both services

Independently operate **Online translation** and **Online transcription**
through all six states:

- Not requested
- Pending
- Approved
- Denied
- Revoked
- Withdrawn

For each service, verify:

- its state can be changed independently without silently changing the other;
- Not requested places **Request access** immediately after the local-first
  explanation and before provider, history, or usage details;
- the request action opens that service's own cost-first, provider-specific
  dialog;
- the dialog offers the optional administrator message and enforces the
  500-character bound;
- provider, history, usage, withdrawal, request, stop, and switch controls
  appear only in states where they are relevant;
- the user's submitted message appears in request history and the authorized
  Platform Administration decision view;
- approval remains scoped to the exact provider and service.

Do not pass these IDs if one service is fixed while the other remains a static
or shared demonstration.

### `CD-022` — Installation gate consistency

Walk every Installation setup step from a clean state. Compare the earlier gate
explanation with the final summary. Verify the final copy no longer claims that
research waits on nothing else or that every research operation is
unconditionally ready.

The final presentation must distinguish skippable optional Transcription,
Translation, and Export setup from storage, privacy, project-rights,
transcript-readiness, and operation-specific gates that still apply when the
corresponding operation needs them.

### `CD-023` — rights timing everywhere

Inspect Owner project setup, Project Settings, Component States, Visual Tokens,
and any relevant normal application copy. Verify that the single project rights
attestation is described as covering the normal source-processing rights
boundary wherever required—not merely export or online-provider crossing—while
stronger operation-specific safety gates remain intact.

Search explicitly for stale variants including:

- `needed before export`
- `before export`
- claims that reading, logging, or commenting never wait on rights
- statements limiting project rights to provider crossing

Judge meaning, not only exact string matches.

### `CD-027` — unified New terminology and count

Verify that the header badge opens Clips filtered to **New**, containing both
newly logged clips and unread comments while counting unique affected clips.
The known fixture count must remain consistent at four across the header badge,
New tab, summary, and affected rows.

Inspect Component States and Visual Tokens and search for stale user-facing
Unread terminology, including `most recent unread activity` and
`latest unread comment`. Contextual phrases such as an unread comment may remain
only where they describe the comment's state rather than rename the unified New
view or badge.

### `CD-030` — synchronized handoff and accessible dialogs

Confirm Component States and Visual Tokens agree with the application and
`BEHAVIOR-CONTRACT.md` on:

- Workspace transcript-readiness gating;
- rights timing;
- unified New activity;
- clip-row actions;
- multilingual presentation;
- Online translation and Online transcription requests;
- the final Viewed treatment.

Test all four overlays as actual dialogs:

- request access;
- no-speech Description;
- export;
- archive confirmation.

Use the rendered accessibility tree or DOM plus real keyboard behavior to
verify:

- dialog semantics and an accessible name;
- modal semantics where appropriate;
- focus moves into the dialog on open;
- Tab and Shift+Tab remain within it while modal;
- Escape closes it when cancellation is allowed;
- focus returns to the invoking control after close;
- the request-message and no-speech Description textareas have programmatically
  associated accessible labels.

Do not approve from visual appearance alone.

### `CD-031` — real active-project switching

At both widths, use pointer and Enter to switch from `Urban Heat Research` to at
least two other active member projects, including the previously failing fixture
choice for that width when it remains available:

- `Coastal Flood Narratives` at 1280;
- `Pavement and shade audit` at 1024.

After each selection, verify the project menu closes and all of these change to
the selected fixture context:

- header project name;
- Sources;
- Workspace;
- Clips.

Navigate among all three destinations after switching so a header-only label
change cannot pass. Switch back and repeat once to catch stale state. Confirm
unauthorized and archived projects never appear among active choices, and that
archived management remains separate.

## Full regression matrix

After the seven focused checks, independently rerun the complete approval
matrix on the newest live revision:

1. At both `1280 × 800` and `1024 × 768`, activate all 26 advertised scenarios
   with a normal pointer click and with Enter.
2. For every activation, confirm the selected switch, viewport label, rendered
   frame width, expected visible state, and relevant DOM state change together.
3. Exercise both viewport controls by pointer and Enter.
4. Inspect Sources, Workspace, and Clips at both widths, including compact
   `Sort · Date added` behavior.
5. Walk Installation setup and Owner project setup completely.
6. Exercise Account Settings for both online services through all six states.
7. Inspect Platform Administration, including provider/service-specific
   authority, requester-message visibility, and exclusion of project content
   and protected provider details.
8. Verify language decisions, readiness blockers, direct and bulk duplicates,
   Show hidden, keyword filtering, transcript-ready manual/no-speech ranges,
   editing, companion player, New activity, selection, export, and recovery.
9. Verify Owner, Administrator, and Researcher behavior for hidden duplicates,
   archive confirmation, archived management, direct archived links, role
   changes, and Claude Reload.
10. Reproduce the exact Researcher → Archived projects → Claude Reload sequence
    and verify a nonempty frame, preserved Researcher role, and no Restore
    control in the DOM.
11. Inspect Component States and Visual Tokens at both widths for stale or
    contradictory behavior.
12. Reconcile every `CD-001` through `CD-033` item and every `VB-001` through
    `VB-018` item against concrete live evidence. Spot-checking only the seven
    repaired items is insufficient for final approval.

Search the application and both handoff sheets for regressions involving:

- Queue, Claim, assignment, Ready-for-review ceremony, or explicit review
  controls in the ordinary Sources UI;
- transcript-free logging as a normal creatable state;
- export-only project rights;
- stale Unread naming for the unified New view;
- an explicit Open clip-row action;
- alternate Viewed treatments;
- user-facing internal evidence/provenance implementation language;
- mismatched bulk counts;
- Researcher Restore or Archive controls;
- project keywords becoming clip Topics;
- preferred-language text replacing canonical Original language and English
  translation roles.

## Evidence standard

For each newly verified item, record:

- viewport;
- scenario and role;
- pointer or keyboard action;
- visible outcome;
- relevant DOM/accessibility outcome when applicable.

Do not mark an item passed based only on Claude's notes, a screenshot, copy on
one screen, or keyboard behavior when pointer behavior is also required. If a
state cannot be exercised, a frame is blank, a control is unreliable, or the
handoff contradicts the application, leave the item open and explain exactly
what prevented approval.

## Checklist update

Update:

`/Users/matthewbelinkie/Desktop/ONGOING/VERA Research Video Clips/docs/design/claude-design/APPROVAL-CHECKLIST.md`

Preserve the stable `CD-*` and `VB-*` IDs. Replace stale prior-failure evidence
only after the corresponding new behavior is independently verified. Update the
review baseline/date and current live-audit evidence.

If every requirement passes:

- check all seven formerly open `CD-*` items;
- keep all 26 prior `CD-*` items and all 18 `VB-*` items checked only after the
  regression sweep confirms them;
- check every Final approval gate;
- change the request status to say the latest revision was independently
  verified and approved;
- record the exact final evidence without erasing useful history about what was
  corrected.

If anything fails or remains unverified, keep the affected item and final gate
unchecked. Do not soften an incomplete result into approval.

## Final response

Lead with one unambiguous decision.

If everything passes, say exactly:

> The Claude Design prototype is approved as the visual model for VERA implementation planning.

Then summarize the decisive evidence, identify the updated checklist, and note
that approval of the visual model does not itself authorize production code
changes; implementation must proceed through bounded specs.

If anything fails, say exactly:

> The Claude Design prototype is not approved yet.

Then list every failing or unverified item by stable `CD-*` ID, include exact
reproduction evidence, and provide one consolidated correction prompt for the
user to review. Do not send it to Claude.
