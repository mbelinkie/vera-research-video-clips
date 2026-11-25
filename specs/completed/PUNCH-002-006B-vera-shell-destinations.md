# PUNCH-002 / PUNCH-006B — VERA shell and project destinations

- Status: completed 2026-08-24
- Parent entries: `PUNCH-002`, `PUNCH-006`
- Priority wave: assemble the VERA interface after completed PUNCH-003A,
  PUNCH-004 foundations, PUNCH-005, and PUNCH-006A decomposition

## User-visible outcome

Research Video Clips runs inside a persistent **VERA — Video Essay Research
and Authoring** shell. The header always identifies this product, the active
authorized project, the Workbench/Clips/Project Settings destination, the
signed-in user, role, and unread activity count. Personal and shared projects
are grouped from authoritative project summaries. Account language and sign-out
live in the personal account menu; project governance is available only in the
role-aware Project Settings destination.

Workbench composes compact ingest, the canonical keyword worklist shelf, and
the transcript/player logger as bounded viewport regions. Clips is a separate
project destination. Project switching clears stale workspace and destination
state. Layout controls have accessible range inputs, persisted per install,
bounded minimums, and a reset command; narrow layouts stack player above
transcript while retaining internal scrolling and sticky logging controls.

## Smallest end-to-end proof

An authorized user with one personal and two shared project summaries connects,
sees grouped projects and readable language labels, chooses a shared project,
opens each permitted destination, and sees no duplicate account/project
settings. The shell stores the recent project and layout sizes. Reload restores
the recent project only when it remains in the newly authorized summary list;
an invalid stored project produces no stale project content. A 1440×900 browser
fixture proves the shell, ingest, bounded worklist shelf, transcript/player,
and sticky logging seam fit without document scrolling; a narrow fixture proves
the stacked order and bounded controls.

## Authority and compatibility boundaries

- `ProjectSummarySchema` remains the only project-selector input and carries
  kind, visibility, current role, member count, and stable project identity.
- Recent project, destination, layout, playhead, and navigation history are
  private browser/install state. Every restoration revalidates membership and
  exact project/video identity before rendering or hydration.
- Existing catalog, transcript, clip, export, keyword, and activity APIs remain
  authoritative. Shell components only receive typed view state and commands.
- Existing three selection-command effects and visible project destination at
  the logging point remain unchanged.
- Language display uses one shared formatter that preserves the normalized
  full BCP-47 tag and has a deterministic fallback when localized display names
  are unavailable.

## Failure and responsive behavior

- Changing authorization or project synchronously clears workspace target,
  transcript/search/selection, clip command state, evidence intent, and private
  Back state before requesting the next project.
- A stored recent project absent from the current authorized summaries is
  removed and never substituted with cached content.
- Researchers do not receive project-governance controls. Owners and
  Administrators can open Project Settings; compatibility Viewer/Editor roles
  remain read-only and do not gain new power.
- Shelf and split dimensions clamp to documented minimum/maximum values. Range
  controls support keyboard adjustment, survive reload, and reset without
  changing transcript selection.
- Below the primary viewport, player precedes transcript in visual order and
  document-level overflow remains available as a safe fallback; evidence panes
  use bounded internal scrolling.

## Explicit non-goals

- New invitation/member/ownership commands (remaining PUNCH-003 governance).
- Comment, speech-status, or topic filters before PUNCH-007/008/010 provide
  those authoritative fields.
- Direct database access by Script to Timeline, package/database renames,
  PUNCH-009, deployment, live providers/media, or external service actions.
- Claiming packaged-app restart recovery before deterministic browser/local
  persistence and later packaged validation both pass.

## Acceptance criteria

1. Shell identity, active project, destination, user, role, and unread count are
   visible and accessible without implementation-oriented headings.
2. Selector uses complete project summaries, groups personal/shared projects,
   and never infers kind from member count.
3. Recent-project restoration is account-scoped, membership-revalidated, and
   fails closed for a removed project.
4. Workbench, Clips, and role-aware Project Settings are distinct destinations;
   account preferences and sign-out do not expose project administration.
5. Every logging command still shows the active project; export-only remains
   explicitly projectless.
6. Shared language formatting produces readable language/script/region labels
   while preserving normalized tags in deterministic tests and key UI seams.
7. Persisted accessible layout controls clamp/reset correctly and primary/narrow
   browser fixtures prove bounded geometry without stale project state.
8. Existing transcript, selection, export, batch/worklist, keyword, Clip
   Library, and failure-flow browser tests remain green.
9. Typecheck, build, migrations, scoped formatting, aggregate Vitest, focused
   Playwright, and `git diff --check` pass network-free.

## Narrow tests first

1. Shared language formatter and complete project-summary contract fixtures.
2. Shell component tests through Playwright: grouping, destinations, roles,
   unread count, recent-project restore/removal, account/settings separation.
3. 1440×900 and narrow geometry assertions/screenshots plus layout persistence.
4. Existing workspace browser regression, then repository gates.

## Completed behavior and evidence

- The renderer and desktop window now identify **VERA — Research Video Clips**
  while preserving package, database, and artifact identities.
- The persistent shell consumes only authoritative `ProjectSummary` records,
  groups personal/shared projects, displays role and unread activity, and keeps
  Workbench, Clips, role-aware Project Settings, and personal account settings
  separate.
- Recent projects are private, account-scoped, and revalidated. An authorized
  recent project restores; a removed identity is deleted and leaves an explicit
  no-project state without requesting removed project content. Project and
  authorization changes synchronously clear transcript, selection, command,
  evidence, destination, and unread state.
- `Bulk add` now focuses the existing bounded multi-URL/CSV transcription batch
  seam instead of presenting a disabled placeholder.
- Workbench uses a persisted 260px worklist shelf and 42% transcript split with
  bounded keyboard-operable range controls and reset. The 1440×900 browser
  fixture proves no document scroll, a 260px shelf, and remaining research
  height; the narrow fixture proves player-before-transcript ordering.
- One shared BCP-47 formatter supplies deterministic readable labels while
  retaining normalized full tags in account, transcript, clip evidence,
  keyword alias/evidence, and corrected-transcript review seams.
- The complete Clip Library remains a distinct project destination. Fast
  artifact/source opening and bounded Back/restart history remain the explicit
  next PUNCH-006 slice rather than being claimed here.

Verification completed network-free on 2026-08-24:

- `npm run typecheck` — passed.
- `npm run build:desktop` — passed (the existing Vite chunk-size warning is
  informational).
- `npm run db:migrate:cloud:test` — 35 migrations applied successfully.
- `npm run db:migrate:local:test` — 30 migrations applied successfully.
- `npm test` — 54 files passed, 1 skipped; 606 tests passed, 4 skipped.
- `npx playwright test tests/e2e/workspace.spec.ts` — 13 passed.
- Scoped Prettier check and `git diff --check` — passed.

No deployment, live provider/media use, external service action, commit, or
independent-review claim was made.
