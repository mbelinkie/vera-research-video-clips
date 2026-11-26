# PUNCH-006A — Behavior-preserving workspace decomposition

- Status: completed 2026-08-24
- Parent entry: `PUNCH-006`
- Priority: P1 high
- Dependencies: completed deterministic M7-05 export baseline and completed
  PUNCH-001 language-integrity slices

## User-visible outcome

The existing research workspace behaves and renders as it does today, but its
oversized root composition is separated into bounded application-shell, ingest,
transcript-navigation, player, selection-editor, selection-command, batch/
worklist, and Clip Library seams. Existing labels, DOM relationships, browser
locators, transcript behavior, batch review behavior, and all three selection
command effects remain unchanged.

## Smallest end-to-end proof

Open a project video through both direct ingest and Ready for review, resolve
and switch among the exact verified transcript views, search/seek/follow/select,
adjust and preview export bounds, and exercise Queue / log only, Export + log,
and Export only through the decomposed component tree. Then exercise the
existing batch/language-review and Clip Library surfaces and prove the complete
browser suite passes without changed user-visible behavior.

## Affected boundaries

- `apps/web/src/main.tsx` remains the application controller for session,
  project, workspace hydration, transcript evidence, player commands, export
  settings previews, and the three selection commands.
- Extracted React components receive typed view state and callbacks. They do
  not call providers, manufacture transcript/clip/export evidence, authorize
  catalog mutations, or become a competing state authority.
- `api-client.ts` remains the network boundary. Existing local/cloud contracts,
  catalog authorization, immutable transcript versions, SQLite cache, export
  queues, and worker behavior are unchanged.
- Existing `BatchWorkspace`, `ClipQueue`, `ExportBatchPanel`, `DesktopSetup`,
  `VirtualTranscript`, and `YouTubePlayer` boundaries remain reusable seams;
  this slice may recompose them but does not change their domain contracts.

## Failure, stale-state, restart, concurrency, authorization, and migration behavior

- Project, authorization, video, transcript-view, selection, and source-rights
  changes retain the existing clearing and generation guards. A delayed
  transcript response cannot populate a newer project/video context, and a
  stale selection cannot be submitted after its authority changes.
- Offline verified-cache review remains read-only for project logging. Missing,
  unavailable, failed, and retryable transcript states keep their existing
  messages and actions.
- Restart behavior remains owned by existing desktop/local/catalog persistence;
  no new component-local persistence or navigation history is introduced.
- Concurrent/replayed clip and export commands retain their existing durable
  idempotency keys and authoritative API validation. React components only
  dispatch the established controller commands.
- Existing project/session authorization and exact source-rights checks remain
  unchanged. No credentials, delivery tokens, paths, provider output, or
  transcript evidence move into a new boundary.
- No persistent schema changes are required. Cloud and local migration counts
  and compatibility behavior remain unchanged.

## Explicit non-goals

- No visible VERA branding or Workbench redesign, 1440×900 geometry, resizable
  shelves/splits, sticky split-button logging, responsive layout change, or
  Clip Library destination/navigation-history work.
- No new project-role, project-summary, canonical worklist, keyword, comment,
  topic, speech-status, or player-range state from PUNCH-002 through PUNCH-010.
- No change to the effects or project requirements of Queue / log only, Export
  - log, and Export only.
- No provider, catalog, migration, worker, desktop IPC, live-media, cloud
  deployment, or external-service work.
- No PUNCH-009 implementation or scaffolding.

## Acceptance criteria

1. The root component delegates shell/ingest, transcript navigation, player,
   selection editing, and command presentation through typed bounded props;
   components do not issue provider/catalog requests or create evidence.
2. Existing `BatchWorkspace` and `ClipQueue` continue to expose worklist/batch
   and Clip Library seams without losing the completed PUNCH-001 language
   decision/import/review/activation behavior.
3. Switching authorization, project, video, transcript view, or selection
   preserves current stale-response clearing, selection remapping, rights-reset,
   and offline behavior.
4. Transcript load/search/seek/follow/selection and player preview/bounds retain
   their current browser-visible behavior and accessible names.
5. Queue / log only still creates one project clip and no export; Export + log
   creates/logs first and then requests the exact logged export; Export only
   remains projectless and creates no project clip or research row.
6. Existing batch controls, language correction/import/review/activation, Clip
   Library operations, and desktop setup behavior retain browser coverage.
7. Typecheck, web and desktop builds, full Playwright, the aggregate
   network-free suite, scoped Prettier, and `git diff --check` pass. No migration
   is added and no live provider/media evidence is claimed.

## Narrow tests first

1. `npm run typecheck` after each extraction boundary.
2. Focused Playwright workspace transcript/selection flow after transcript and
   player extraction.
3. Focused Playwright three-command export flow after selection-command
   extraction.
4. Full `npm run test:e2e` after all composition changes.
5. Aggregate network-free Vitest, `npm run build:web`, `npm run build:desktop`,
   scoped Prettier over changed files, and `git diff --check` before closure.

## Completion record

Completed 2026-08-24 at the behavior-preserving web-composition boundary. No
visible redesign, domain-contract change, migration, provider call, live media,
deployment, or external service was introduced.

### Delivered boundaries

- Added `WorkspaceShell`, `VideoIngestPanel`, `AccountLanguagePanel`, and
  `ResearchWorkspaceLayout` as slot-based presentation seams that preserve the
  existing DOM order and labels.
- Added `TranscriptNavigationPanel` around the existing virtualized transcript,
  language view, search, follow, selection callbacks, load/error/offline states,
  and retry presentation. Workspace hydration, generation guards, transcript
  evidence, and selection derivation remain in the root controller.
- Added `PlayerPanel` around the existing `YouTubePlayer` wrapper and playback
  status, without changing player commands or timing behavior.
- Added `SelectionEditor` for project visibility/creation, notes/tags, immutable
  transcript bounds, adjustable export bounds, and preview controls.
- Added `SelectionCommandPanel` for preset/override drafts, source-rights
  confirmation, status messages, and dispatch callbacks. The root controller
  still creates exact language/source evidence and owns Queue / log only,
  Export + log, and Export only API commands.
- Preserved the existing `BatchWorkspace`, `ClipQueue`, and
  `ExportBatchPanel` as the bounded batch/worklist and Clip Library seams. Their
  completed PUNCH-001 language-decision/import/review/activation behavior was
  not edited during this slice.
- Reduced `apps/web/src/main.tsx` from 2,466 lines at reconnaissance to 1,676
  lines while retaining application/session/project state and authority.

### Verification evidence

- Incremental `npm run typecheck` passed after each extraction boundary.
- Focused transcript/selection Playwright passed twice after transcript/player
  and selection-command extraction: 1 passed, 0 failed each run.
- Focused contracts/catalog/cloud API/Clip Library matrix: 6 files and 99 tests
  passed.
- Full Playwright: 11 passed. Expected Vite proxy warnings came only from
  intentionally unstarted mocked local/cloud services; every test passed,
  including cross-project and same-project delayed-response guards.
- Aggregate network-free Vitest: 53 files passed, 1 skipped; 544 tests passed,
  4 skipped.
- `npm run typecheck`, `npm run build:web`, and `npm run build:desktop` passed.
- Cloud migration validation applied 26 migrations; local migration validation
  applied 30. This slice added no migration or persistent schema change.
- A separate 1440×900 loopback DOM smoke confirmed the existing primary heading
  and research-workspace landmark after decomposition. The image-inspection
  tool was unavailable, so no visual-layout comparison is claimed; visible
  geometry was deliberately unchanged and remains covered by the browser suite.
- Scoped Prettier over the active spec and all six affected web files passed;
  `git diff --check` passed. Repository-wide Prettier was not rerun because the
  known unrelated `docs/Script-to-Resolve Product Spec.md` failure remains
  outside this slice.

### Review and remaining scope

Root review confirmed that none of the new component files imports `apiFetch`,
provider functions, evidence builders, or contract parsers that could create
domain authority. No unresolved stale-state, authorization, migration,
selection-effect, or privacy issue was found. Terra/multi-agent review tooling
was unavailable, so no independent-review claim is made.

PUNCH-006 remains in progress. Visible VERA shell/Workbench geometry, canonical
worklist/keyword composition, separate Clip Library destination, responsive
resizing, and navigation-history persistence remain deliberately deferred to
later dependency waves. No commit was requested or created.
