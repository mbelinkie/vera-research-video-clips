# FEATURE-002 — Project-shared point bookmarks

## User-visible outcome

Current project members can save a source-video timestamp with an optional
title and searchable note, find active or archived bookmarks across the
project, and open/seek the authorized source. Creator and moderation controls
archive rather than delete records, while offline edits survive restart and
retain conflicts without losing entered text.

## Authority and persistence

- Add cloud bookmark and idempotent command authorities keyed by stable project,
  project-video, bookmark, actor, and request identities.
- Add local SQLite authorized cache, ordered outbox, and conflict records based
  on the existing comment outbox boundary.
- Store integer source milliseconds, optional 120-character title, optional
  4,000-character note, active/archived state, optimistic version, immutable
  creator snapshot, updater snapshot, and timestamps.
- Validate current membership, project-video identity, nonnegative time, and
  known source duration. Bookmarks remain independent of transcript versions.

## Commands, reads, and failure states

- Every current member may create/read. Creators may edit/archive/restore their
  own records. Owners/Administrators may archive/restore any record but cannot
  rewrite another creator's title/note.
- Create/update/archive/restore have exact idempotent replay and reject divergent
  keys, stale versions, cross-project/video identities, and removed members.
- Bounded cursor reads support current-video or project scope, active/archived/
  all state, stable timestamp ordering, and NFKC/case-normalized literal search
  over title/note.
- Offline mutations persist before success is shown, replay in order after
  restart, and retain stale/authorization conflicts with user text intact.

## Workbench UX

- A compact internally scrollable Bookmarks panel captures the current playhead,
  accepts optional title/note, seeks current-video results, and uses the existing
  authorized cross-video navigation path for project search results.
- Edit/archive/restore controls follow creator/role authority. Queued and
  conflict states are visible without introducing primary document scroll at
  1440×900 or narrow responsive widths.

## Non-goals

Ranges, transcript snapshots, nested discussion, attachments, AI
classification, and nonlinear timeline editing are excluded.

## Acceptance gate

Contracts, empty/populated migrations, catalog/API authority and replay,
Unicode search/pagination/isolation, transcript-replacement independence,
offline restart/conflict/membership-loss replay, current/cross-video seek,
responsive browser geometry, typecheck/build, focused and aggregate tests,
formatting, and diff checks must pass before this spec moves to completed.

## Completion record

Completed on 2026-08-24 without a dedicated implementation commit.

- Cloud migration `0042_project_bookmarks.sql` adds stable project/video point
  bookmarks and exact create/update/archive/restore receipts. Local migration
  `0034_bookmark_cache_outbox.sql` adds account-scoped authorized cache records,
  ordered mutation records, and retained conflict evidence without fabricating
  historical bookmarks or commands.
- Strict contracts, catalog transactions, cloud routes, and local-agent routes
  now cover bare/titled/noted bookmarks, known-duration validation,
  creator-only text edits, creator/Owner/Administrator state moderation,
  optimistic versions, exact/divergent idempotency, Unicode literal search,
  stable cursors, project isolation, removed-member denial, and source metadata
  for authorized cross-video navigation. Bookmarks have no transcript-version
  dependency.
- The local cache stores only successful authorized responses under a one-way
  account authorization scope. Every mutation is persisted before transport,
  replay remains ordered across restart and response loss, and 4xx conflicts
  retain title/note input while 401/403 responses purge the affected cache and
  prevent replay.
- The bounded player-column panel captures the playhead, seeks current-video
  points, opens/seeks another authorized project video, searches project-wide,
  and exposes creator/moderator controls plus queued, conflict, and stale-cache
  state. A browser-found nested-scroll hit-target defect was fixed by retaining
  one internal panel scroller.
- Focused contract, catalog, cloud API, local-agent, migration, and offline
  restart/conflict tests passed. The aggregate network-free gate passed `652`
  Vitest tests with `4` optional skips and all `19` one-worker Playwright flows.
  Typecheck, web/desktop builds, local migration CLI (`34` migrations), cloud
  migration CLI (`42` migrations), scoped formatting, and `git diff --check`
  passed. The existing Vite chunk-size warning remains informational.
- No unrelated dirty worktree content was reset or removed. Richer timeline
  overlays, ranges, transcript snapshots, segment notes, discussion,
  attachments, and AI classification remain deferred.
