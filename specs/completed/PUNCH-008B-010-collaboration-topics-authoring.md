# PUNCH-008B / PUNCH-010 — Collaboration, Topics, and authoring snapshots

- Status: completed 2026-08-24
- Parent entries: `PUNCH-008`, `PUNCH-010`
- Priority wave: complete collaboration and scripting organization before
  remaining governance and expanded pilot validation

## Smallest user-visible end-to-end result

Authorized collaborators can discuss a project clip with stable mentions,
follow or unfollow its activity, see deduplicated unread notices, find comments
and Topics in Clip Library, and navigate valid time anchors. VERA exports one
row per clip plus a separate authorized comments CSV. Script to Timeline reads
the live thread and canonical Topics only through authorized APIs, then
explicitly snapshots selected comment versions and clip Topic labels into an
immutable build record that later edits or deletions cannot rewrite.

## Authority and persisted boundaries

- The cloud catalog remains authoritative for comments, resolved mention user
  IDs, clip follows, per-user notices, canonical project-scoped tag rows exposed
  as Topics, and immutable authoring snapshots.
- Cloud migration `0039` adds only the missing collaboration/authoring
  authorities. Existing `clip_tags` and `clip_candidate_tags` remain the sole
  Topic taxonomy; compatibility API/CSV `tags` fields stay readable.
- Local SQLite migration `0033` extends the existing authenticated cache/outbox
  for later comment commands and conflict state without becoming a competing
  authority.
- Every mutation rechecks current project membership and role. Mention handles
  resolve to stable current project-member IDs at command time; nonmembers are
  rejected. Tombstoned bodies never enter notices, CSV, sync events, or
  authoring live reads.
- Comment commands remain independently versioned from clip metadata. Topic
  edits retain clip optimistic versioning and cannot create comment records.
- Authoring snapshots freeze clip ID/version, canonical Topic display labels,
  and only explicitly promoted active comment ID/version/text/author/optional
  source time. Snapshot rows are immutable after creation.

## Failure, restart, concurrency, and authorization behavior

- Exact command replay returns the same follow, notice, comment, or snapshot
  result; divergent idempotency reuse conflicts. Stale comment/clip versions
  conflict without overwriting another member.
- Offline later-comment commands remain queued across restart, replay in order,
  and retain actionable conflict state rather than silently discarding edits.
- Mention and followed-comment fan-out is deduplicated per event/user; mentions
  take precedence when both reasons apply. Removed/nonmember targets receive no
  new notice and cannot read project data.
- Any/all Topic filters are bounded and project-authorized. Grouping is a view
  over canonical results and does not change clip order, artifact identity, or
  keyword scans.
- Invalid anchors, cross-project IDs, deleted comment promotion, and hidden
  comment body access fail closed. Export-only work remains ineligible for
  Topics, comments, Clip Library, and authoring discovery.

## Explicit non-goals

- Nested threads, reactions, attachments, rich text, real-time presence, or
  automatic AI/compiler interpretation of comments.
- A second Topic table, automatic Topics from project keywords/descriptions/
  comments, hierarchical taxonomy, or Topic-driven rendering/scanning.
- PUNCH-009 expansion, live providers/media, deployment, or external service
  calls.

## Acceptance criteria

1. Two members can comment while editing Topics independently; reload and
   offline replay preserve both, and stale conflicts lose neither author's data.
2. Mentions bind to stable current project members, reject nonmembers, and
   create one safe unread notice; creator/commenter follows and explicit
   follow/unfollow produce deduplicated followed-comment notices.
3. Clip Library returns bounded comment count/latest activity, finds authorized
   active comment text, identifies a matching comment/time anchor, and supports
   Topic match-any, match-all, chips, suggestions, and grouping.
4. Main clip CSV stays one row per clip with comment count/latest-comment time;
   separate comments CSV reconciles stable IDs and omits deleted bodies.
5. Authorized authoring reads expose live comments and canonical Topics. An
   explicit build snapshot freezes selected active comment versions and clip
   ID/version/Topic labels; later comment or Topic changes leave it byte-for-byte
   unchanged.
6. Existing tags remain losslessly readable through compatibility fields,
   project keywords never become Topics, and export-only stays excluded.
7. Contract, migration, catalog/API/local-outbox, browser, typecheck, build,
   scoped-format, and diff checks pass before closure.

## Narrow tests first

1. Contracts for mentions, follows/notices, Topic any/all queries, comment CSV,
   live authoring reads, and immutable build snapshots.
2. Populated cloud migration plus catalog tests for membership, fan-out,
   deduplication, tombstones, comment search/activity, Topic filters, and
   immutable snapshots.
3. Local migration/outbox replay tests for create/edit/delete conflict and
   restart behavior.
4. Cloud/local route tests, then focused Clip Library and authoring integration
   tests and the relevant Playwright flows.

## Completion record

Completed 2026-08-24 across the shared comment, Topic, local outbox, Clip
Library, activity, CSV, and authoring boundaries.

### Delivered behavior

- Reused `clip_tags` and `clip_candidate_tags` as the only canonical Topic
  taxonomy. Existing `tags` API/CSV fields remain lossless, while VERA exposes
  optional Topic entry/editing, suggestions, chips, match-any/match-all
  filters, and first-Topic grouping. Project keywords, descriptions, comments,
  and export-only requests never become Topics.
- Added stable mention snapshots resolved only against current project members,
  creator/commenter auto-follow, explicit follow/unfollow, deduplicated
  mention/followed-comment notices, and per-user unread/seen state. Notices
  contain actor/reason/clip/time metadata but never comment bodies.
- Added bounded comment search/count/latest activity and matching-comment time
  anchors to Clip Library, visible chronological comment pages, optional anchor
  entry, exact source seeking, author edit/delete commands, moderation through
  the existing Administrator/Owner cloud route, and safe tombstones.
- Added one-row-per-clip CSV comment aggregates plus a separate authorized
  comments CSV. Deleted/moderated bodies remain blank.
- Added authorized authoring Topic filters and paginated live comments. Explicit
  build snapshots freeze clip ID/version, canonical Topic display labels, and
  only promoted active comment ID/version/text/author/time; later edits and
  deletions cannot mutate exact replay.
- Added local migration `0033` and a real local-agent later-comment outbox.
  Create/edit/delete commands persist before cloud delivery, replay in creation
  order after restart, use their original idempotency/version evidence, stop on
  transient outage, and retain stale or revoked-authority conflicts for review
  instead of discarding author text. Authorization denial purges the matching
  cached project scope.
- Added cloud migration `0039` for mention, follow, notice, and immutable
  authoring-snapshot authority without fabricating historical notices.

### Verification evidence

- Scoped Prettier passed for all slice files.
- TypeScript typecheck passed after integration.
- Focused contracts/catalog/cloud API/cloud DB/local DB/sync/local Clip Library
  and comment-outbox matrix: 8 files passed; 213 tests passed, 2 optional tests
  skipped.
- Direct cloud route test covers comments CSV, follow/unfollow, followed-comment
  notice read/seen, authoring Topic reads, paginated live comments, immutable
  build snapshot creation, and deleted-body omission.
- Focused local restart test proves outage queueing, exact replay after reopening
  SQLite, no second replay, and retained stale-version conflict evidence.
- Focused mocked Chromium collaboration/Topics workflow: 1 passed, 0 failed.
- Earlier integrated migration validation applied cloud migrations through 39
  and local migrations through 33; final closure reruns those gates.

### Compatibility and remaining risk

- Existing tag fields and pre-migration clips remain readable without a data
  copy or second taxonomy. Historical clip creators are backfilled as followers
  without historical notices.
- No live provider, production deployment, real cloud credential, or live media
  was used. Multi-agent independent review tooling was unavailable, so no
  independent-review claim is made. Signing/notarization and externally gated
  M7-06 live-source proof remain outside this deterministic slice.
- No commit was requested or created.
