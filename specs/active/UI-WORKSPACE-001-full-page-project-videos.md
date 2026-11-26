# UI-WORKSPACE-001 — Add, Review, and Logged workflow

> Live status and routing: [GitHub issue #6](https://github.com/mbelinkie/vera-research-video-clips/issues/6). This file retains detailed design and evidence.

## User-visible outcome

The project workspace follows the research sequence: `Add` owns source ingest
and transcription preparation, `Review` owns the ready inbox and searchable
transcript/player, and `Logged` owns the durable project clip library. Batch
drafts clear after successful submission, every persisted batch item can be
canceled safely, and each item shows honest durable-stage progress.

## Confirmed problems

- Source ingest, queue management, review, and the clip log are grouped by
  implementation history instead of the user's workflow.
- Successful batch creation leaves the submitted name, URLs, CSV, and preflight
  on the left even though the new batch appears on the right.
- The UI exposes only `Cancel unstarted`; active, blocked, failed, and ready
  items cannot be removed from the workflow.
- Batch rows show only a stage label and attempt, with no scannable progress.
- Transcript search filters cues and has no Ctrl/Cmd+F behavior, occurrence
  highlighting, cross-cue phrase matching, or virtualized match navigation.

## Affected boundaries

- Shared transcription item/control contracts, cloud migration, catalog/API
  commands, worker cancellation observation, and finalization races.
- WorkspaceShell and BatchWorkspace destination/layout ownership.
- Batch creation draft state, progress presentation, cancellation/history UI,
  review inbox, and notification routing.
- Transcript search model, virtualized rendering, keyboard handling, and source
  navigation restoration.

## Non-goals

- No deletion or unpublishing of project videos, completed transcript versions,
  staged/finalized immutable artifacts, or logged clips.
- No invented transcription percentage or time-remaining estimate.
- No fuzzy, regex, semantic, or cross-video transcript search.
- Project Settings remains a permission-gated administrative destination.

## Failure states

- A failed batch creation retains the full draft and preflight.
- A stale or unauthorized cancel command changes nothing and returns an
  actionable conflict/authorization error.
- Canceling one dependent item never stops a shared job needed by another live
  item; the canceled item never becomes ready when that job finalizes.
- Active cancellation remains `canceling` until cooperative worker stop or
  lease-expiry recovery proves it terminal.
- Ctrl/Cmd+F falls back to normal application behavior when Review has no
  transcript or a modal owns focus.

## Acceptance criteria

1. Primary navigation is `Add`, `Review`, and `Logged`, with Project Settings
   separate. Transcription notifications open Add; logged-export and mention
   notifications open Logged; opened sources and local exports open Review.
2. Add renders Paste URL/Search first, batch creation/queue next, then the
   canonical project-video worklist and activity using natural page scrolling.
3. Review renders a compact Ready for review inbox above the transcript/player.
   The inbox expands when idle and collapses to a persistent summary after a
   source opens.
4. Logged renders the durable logged-clip list and filters before secondary
   export controls, excluding transcription and export-only work.
5. Successful batch creation selects the new batch, clears name/URLs/CSV/file/
   preflight, preserves processing choices and consent, and focuses batch name.
6. Every batch item shows an accessible segmented durable-stage bar without
   claiming elapsed-time percentage; reduced motion is honored.
7. Every persisted item and the whole batch can be canceled. Queued/actionable/
   terminal items cancel immediately; active work becomes `canceling` and then
   `canceled` after safe cooperative stop. Ready cancellation removes only the
   workflow item. Canceled work is hidden by default with history available.
8. Ctrl+F and Cmd+F on Review focus transcript Find. Literal case-insensitive
   occurrences, including whitespace-normalized cross-cue phrases, are counted
   and highlighted without filtering the transcript. Enter/Shift+Enter wrap,
   seek, and scroll virtualized matches; Escape returns focus without clearing.
9. Focused contract/catalog/API/worker/UI tests, migrations, typecheck, browser
   coverage, web/desktop builds, and packaged wide/narrow verification pass.

## Narrow verification first

- Contract tests for cancellation states/commands and transcript matches.
- Catalog/API tests for per-state cancellation, shared dependencies,
  cancel/finalize races, and exact replay.
- Focused BatchWorkspace tests for draft reset and stage-bar mapping.
- Focused Playwright cases for Add/Review/Logged routing, cancellation history,
  and Ctrl/Cmd+F transcript Find.
