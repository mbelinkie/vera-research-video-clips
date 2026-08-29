# Continue the VERA Claude Design approval audit

You are continuing the interrupted Codex task **Compare redesign with current
UI** for the VERA Research Video Clips project. The previous task was archived
after the ChatGPT desktop app repeatedly froze; do not try to load or summarize
its entire 107 MB transcript. This prompt contains the recovered state from its
last turn.

## Objective

Finish the approval audit of the current Claude Design prototype. Read Claude's
latest completion notes first, then independently verify the prototype rather
than treating those notes as proof. Exercise every advertised scenario, both
desktop viewports, all three primary screens, onboarding, Account Settings,
Platform Administration, project lifecycle states, and both handoff sheets
against `CD-001` through `CD-033`.

Update the approval checklist with evidence from the live prototype. If blockers
remain, produce one consolidated, actionable correction prompt for Claude. Do
not send that prompt to Claude or modify production application code unless the
user explicitly asks. Preserve unrelated work in the dirty worktree.

## Read these sources in order

### Product and project authority

1. [`PROJECT_GUIDE.md`](../../../PROJECT_GUIDE.md) — authoritative description
   of behavior implemented today.
2. [`outline.md`](../../../outline.md) — completed and remaining product scope.
3. [Research-video workflow skill](../../../.agents/skills/research-video-clip-workflow/SKILL.md)
   — project invariants and review requirements.

### Design-review bundle

4. [`README.md`](./README.md) — entry point and source order.
5. [`CLAUDE-DESIGN-PROMPT.md`](./CLAUDE-DESIGN-PROMPT.md) — original brief.
6. [`UI-CONTEXT.md`](./UI-CONTEXT.md) — audience, terminology, screen
   inventory, constraints, and production source map.
7. [`BEHAVIOR-CONTRACT.md`](./BEHAVIOR-CONTRACT.md) — authoritative product
   decisions made during redesign review. A mockup cannot silently override it.
8. [`APPROVAL-CHECKLIST.md`](./APPROVAL-CHECKLIST.md) — stable `CD-*` and `VB-*`
   IDs. It predates the interrupted final sweep and must be reconciled with the
   evidence below.
9. [`SANITIZATION.md`](./SANITIZATION.md) — safety rules for fixtures and
   screenshots.
10. [`screenshots/README.md`](./screenshots/README.md) — required fictional
    screenshot states and capture procedure.

### Prototype and exported reference bundle

- Live prototype: [VERA Redesign](https://claude.ai/design/p/011eee38-8b6b-48aa-a154-d6c0060d4f23?file=VERA+Redesign.dc.html)
- Original exported bundle:
  `/Users/matthewbelinkie/Downloads/VERA design feedback.zip`
- Extracted prototype:
  `/Users/matthewbelinkie/Downloads/VERA design feedback/VERA Redesign.dc.html`
- Extracted support script:
  `/Users/matthewbelinkie/Downloads/VERA design feedback/support.js`
- Exported reference screenshots:
  `/Users/matthewbelinkie/Downloads/VERA design feedback/uploads/`

Use the live prototype for approval. The export is a historical/reference copy,
not proof of the current live state. Do not import private runtime data or bypass
the sanitization rules.

### Optional forensic reference

- Archived Codex task ID:
  `01a03be6-5a33-7ea2-9045-30b6fc4ab48b`
- Archived local session:
  `/Users/matthewbelinkie/.codex/archived_sessions/rollout-2026-08-25T22-29-07-01a03be6-5a33-7ea2-9045-30b6fc4ab48b.jsonl`

Prefer the concise recovered evidence in this prompt. Use `read_thread` for a
small number of recent turns only if necessary; do not read the full archived
JSONL into context.

## Last user request and interrupted audit

The user's last request was:

> Check it all — read Claude's notes first.

The interrupted agent announced this plan:

> Read Claude's completion notes first, then independently exercise every
> scenario control, both viewports, all three primary screens,
> onboarding/settings/admin flows, project lifecycle states, and both handoff
> sheets against the full CD-001–CD-033 checklist.

Claude's notes claimed:

- `CD-027` was done: the Clips header, New tab, summary, and unique affected-row
  count all showed `4`.
- `CD-032` was done: changing `projectRole` to Researcher removed the archived
  project view and Restore controls.
- `CD-033` was done with a correction: Claude said the controls already worked
  but their changed state landed below the fold, so the switchboard was made
  sticky.
- Claude explicitly skipped the complete 1024 px sweep of both handoff sheets
  and the four lifecycle states due to its usage limit.

## Recovered findings from the interrupted sweep

Treat these as strong evidence to reproduce, not as permission to check items
without retesting the live revision.

### Verified or strongly supported

- `CD-027` application count was corrected: the Clips summary showed
  `8 clips · 4 with new activity`, matching the header badge and New tab.
- Account Settings in the unrequested Online translation state put
  `Request access` directly after the local-first explanation. The request flow
  contained the host-cost disclosure, local-first warning, provider context,
  optional administrator message, and 500-character limit.
- The 1024 compact application state contained a named Date Added sort control.
- The 1280 Sources screen showed `11 sources · 6 not ready`, Date Added ordering,
  three Viewed checkmarks, and no Queue, Ready for review ceremony, assignment,
  or Claim controls.
- Bulk add coherently showed `14 lines resolved to 12 videos`, `Add 6 videos`,
  visible duplicates, a hidden duplicate, two invalid inputs, and partial
  success.
- Workspace had removed the internal phrases `Equivalent tracks`, `cue seek`,
  and `cue bounds`.

### Approval blockers and regressions found

1. **Pointer interaction remained defective (`CD-033`).** Keyboard activation
   changed scenario and viewport state, but direct pointer clicks sometimes left
   the old state in place. A `Request access` click was intercepted by a sticky
   overlay; Enter exposed the intended content. Test both click and keyboard
   activation for every scenario and viewport control. A control does not pass
   merely because Enter works.

2. **Owner rights copy remained stale (`CD-023`, `CD-030`).** Owner project
   setup still labeled Rights attestation `needed before export` and said it was
   required before media export or sending a source to an online provider and
   could wait until then. Reconcile this with the behavior contract's normal
   source-processing rights boundary and the required handoff record.

3. **Installation summary contradicted its earlier gate explanation
   (`CD-022`).** Step 2 correctly said storage room, privacy consent, project
   rights basis, and operation-specific requirements still apply. The final
   summary then said:

   > Add sources, read the transcripts and captions that exist, log clips, and
   > comment. None of this waits on anything else.

   That final claim must not survive if those operations still have necessary
   gates.

4. **Component States retained stale Unread terminology (`CD-027`, `CD-030`).**
   It still used phrases such as `most recent unread activity` and
   `latest unread comment`. The user-facing model is one **New** view containing
   new clips and unread comments, with the badge counting unique affected clips.
   Inspect both Component States and Visual Tokens for every stale variant.

5. **Workspace showed an unexplained and inaccessible status mark.** The header
   rendered `English transcript!`, but the `!` had no title, parent title, or
   accessible label. Determine the intended state, remove the mark if redundant,
   or provide visible and accessible meaning consistent with the contract.

6. **Researcher Restore behavior could not be approved (`CD-016`, `CD-032`).**
   During the sweep, the Researcher hidden-duplicate state still exposed a
   Restore button and no Owner/Administrator explanation. The Archived projects
   state still contained two Restore buttons even while saying
   `Owner and Administrator only`. Reproduce role changes from clean state and
   verify both direct hidden duplicates and archived deep links. Authorization
   must be reflected in the DOM and not only in nearby copy.

7. **The interactive preview failed during the required role/reload test.**
   After switching roles and using Claude's Reload control, the prototype iframe
   became blank (`bodyLength: 0`). Reloading the design page and reconnecting did
   not produce a reliable final role-gating verification before interruption.
   Treat this as a reliability blocker until the exact role/reload sequence is
   repeatable.

The interrupted agent's last progress report was:

> The sweep found substantive inconsistencies beyond Claude's three claimed
> fixes. The strongest are: Owner setup still labels rights as export-only, the
> final installation summary again claims research “waits on nothing else,”
> Component States still uses “unread activity/comment,” and Workspace still
> shows an unexplained `!` beside “English transcript.” The interactive preview
> also went blank during the required role/reload test, so Claude's Researcher
> restore fix cannot be approved from this revision.

## Required verification matrix

1. Read Claude's latest notes before interacting with the prototype.
2. At **1280 × 800** and **1024 × 768**, activate every scenario with:
   - a normal pointer click;
   - keyboard activation;
   - confirmation that the visible frame, viewport label, and relevant DOM state
     all changed together.
3. Inspect Sources, Workspace, and Clips in both viewports.
4. Walk every step of Installation setup and Owner project setup; compare early
   gate copy with final summaries.
5. Inspect Account Settings for unrequested, pending, approved, denied, revoked,
   and withdrawn states for both online translation and transcription.
6. Inspect Platform Administration and verify provider/service-specific
   authorization, requester message visibility, and exclusion of project
   content/provider secrets.
7. Verify language decision, readiness blockers, direct and bulk duplicates,
   Show hidden, keyword filtering, transcript-ready manual/no-speech ranges,
   editing, companion player, New activity, selection, export, and recovery.
8. Verify project switcher membership rules, archive confirmation, archived
   project management, direct archived links, and clean role transitions for
   Owner, Administrator, and Researcher.
9. Inspect Component States and Visual Tokens at both widths. Search explicitly
   for stale `Unread`, transcript-free logging, export-only rights,
   Queue/Claim/review, Open-row actions, alternate Viewed treatments, and
   internal evidence/provenance copy in the normal UI.
10. Reconcile every `CD-001`–`CD-033` item and every final approval gate with
    concrete live evidence. Do not approve the prototype while any scenario,
    viewport, role transition, handoff sheet, or reload path is broken.

## Deliverables

1. Update [`APPROVAL-CHECKLIST.md`](./APPROVAL-CHECKLIST.md) with the current
   review date, exact pass/fail evidence, and honest checkboxes.
2. Update [`BEHAVIOR-CONTRACT.md`](./BEHAVIOR-CONTRACT.md) only if the user makes
   a new deliberate product decision; do not rewrite it to match an accidental
   prototype inconsistency.
3. Report:
   - what passed;
   - every remaining blocker, grouped by stable `CD-*` ID;
   - which states could not be verified and why;
   - whether the prototype is approved as the visual model for implementation
     planning.
4. If blockers remain, draft one concise correction prompt for Claude that
   includes reproduction steps and acceptance criteria. Do not send it without
   explicit user authorization.

