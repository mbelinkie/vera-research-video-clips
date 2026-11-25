# PUNCH-006C — Fast clip opening and private navigation history

- Status: completed 2026-08-24
- Parent entry: `PUNCH-006`
- Priority wave: finish the visible VERA interface before comment/range work

## User-visible outcome

Opening a Clip Library card immediately opens a still-verified compatible local
artifact when one exists. Otherwise VERA opens the authorized project source in
Workbench at the logged clip range and loops that range without waiting for a
render. A visible Back/breadcrumb control returns to the prior source with its
playhead, transcript view, search, match, and safely revalidated selection.

Recent source state is bounded private install data scoped by account and
project. Reconnecting after reload restores only a project/video/transcript
identity still present in current authorized summaries and project-video reads.
Stale, malformed, cross-account, cross-project, or superseded transcript state
is discarded rather than hydrated.

## Authority and persisted state

- Cloud project summaries, project-video rows, active transcript versions,
  clips, artifact histories, and local artifact locator verification remain
  authoritative.
- Navigation snapshots are schema-versioned private `localStorage` records;
  they never become project activity or shared catalog data.
- Artifact opening uses the existing local-agent action, which freshly verifies
  bytes and current authorization. Metadata marked verified is not treated as
  playable bytes without that action succeeding.
- Source fallback uses only the clip's exact project/catalog/source identity and
  immutable logged transcript/export bounds.

## Failure, restart, and authorization behavior

- Failed fresh artifact verification falls back to the authorized source range
  and reports the artifact failure without claiming local playback.
- Back/history restoration revalidates project membership, exact project-video
  identity, and transcript version/track/segment identity before applying
  playhead, view, search, or selection.
- Project, account, or authorization changes clear in-memory history before any
  next-project hydration. History is bounded to 20 entries per account/project.
- Invalid private storage is removed/ignored and cannot trigger a removed
  project/video request.

## Non-goals

- Shared navigation state, a forward stack, or direct database access.
- Comment/speech/topic filters whose authoritative contracts arrive in
  PUNCH-007/PUNCH-008/PUNCH-010.
- New media acquisition, render work, live source/provider use, PUNCH-009, or
  external service actions.

## Acceptance criteria

1. A verified compatible locator is freshly verified/opened before source
   fallback; an invalid/missing locator is never reported as playable.
2. Source fallback opens the exact project video at the clip start and loops the
   logged range without creating an export.
3. Back restores prior video, playhead, transcript view, search/match, and an
   exact safe selection; stale transcript identity restores no selection.
4. Reload/reconnect restores a recent authorized source but not a removed or
   cross-account/project video.
5. History is visible, bounded, private, and cleared across project/account
   switches.
6. Existing workspace/Clip Library operations, typecheck, build, migrations,
   aggregate Vitest, scoped formatting, Playwright, and `git diff --check` pass.

## Narrow tests first

1. Browser fixture: verified artifact preference and failed-verification source
   fallback.
2. Browser fixture: source A state → source B/clip → Back exact restoration.
3. Browser fixture: reload authorization revalidation and stale video/transcript
   rejection.
4. Existing workspace browser file, then repository gates.

## Completion record

### Decisions and delivered behavior

- Clip-card opening resolves the exact immutable artifact requirements before
  using a local locator, then invokes the existing local-agent `open` action so
  current authorization and bytes are freshly verified. Failed resolution or
  fresh-open verification falls back honestly to the authorized source.
- Source fallback revalidates exact project/catalog/YouTube/canonical identity,
  opens Workbench at the immutable logged export bounds, restores an exact
  track/version/segment/token/text selection when available, and loops the
  range without creating export work.
- Back/recent navigation retains up to 20 account/project-private snapshots
  containing source identity, transcript-version identity, playhead, language
  view, query, exact match index, and optional selection. Same-video distinct
  clip intents preserve the prior state as well as cross-video navigation.
- Reload restoration first revalidates membership and the exact current
  project-video list. Invalid or removed private state is sanitized without a
  transcript request. A changed active transcript retains the authorized
  source, playhead, view, and query while discarding only stale selection.
- Project/account/authorization changes clear in-memory history. The state is
  never shared catalog data or project activity.

### Files changed

- `apps/web/src/main.tsx`
- `apps/web/src/workspace-shell.tsx`
- `apps/web/src/player-panel.tsx`
- `apps/web/src/clip-queue.tsx`
- `apps/web/src/batch-workspace.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/workspace.spec.ts`
- `PROJECT_GUIDE.md`
- `outline.md`
- `specs/future/PILOT-punch-list.md`

No catalog/local schema or migration changed in this slice.

### Verification

- `npm run typecheck` — passed.
- Focused Playwright navigation/artifact flows — 2 passed.
- `npx playwright test tests/e2e/workspace.spec.ts --workers=1` — 15
  passed.
- `npm run build:desktop` — passed; Vite retained its existing informational
  large-chunk warning.
- `npm run db:migrate:cloud:test` — passed, 35 migrations.
- `npm run db:migrate:local:test` — passed, 30 migrations.
- `npm test` — 54 files passed, 1 skipped; 606 tests passed, 4 skipped.
- Scoped Prettier and `git diff --check` — passed.

### Remaining risk and follow-up

- Browser evidence is deterministic and fixture-backed; no live media,
  provider, operating-system artifact open, deployment, or external service
  action was performed. Existing M6 local-artifact verification remains the
  implementation authority beneath the exercised local-agent action.
- Comment, speech-status, and topic facets remain intentionally assigned to
  PUNCH-008, PUNCH-007, and PUNCH-010 rather than being manufactured as local
  PUNCH-006 state.
- No commit was requested or created.
