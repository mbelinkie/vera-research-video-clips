# PUNCH-008A — Comment authority and atomic first comment

- Status: completed 2026-08-24
- Parent entry: `PUNCH-008`
- Priority wave: comment foundation before PUNCH-007 manual-range logging

## User-visible outcome

Authorized project members can read a bounded chronological clip conversation,
add separate comments without changing Clip description/tags or clip version,
edit/delete their own comments with optimistic versions, and follow safe
moderation rules. A researcher may optionally enter the first comment while
logging; the clip and comment commit or replay atomically.

The existing notes field is presented as **Clip description / intended use**.
Comments remain flat contributions with author/time and an optional exact
source-video time constrained to the immutable logged clip range.

## Authority and persistent boundaries

- Add shared comment contracts plus cloud migration 0036. Comments use stable
  IDs, project/clip identity, stable author ID and safe author snapshots, body,
  optional `sourceTimeMs`, optimistic version, timestamps, and a deletion
  tombstone. No body is retained in the public read shape after tombstoning.
- The cloud catalog remains authoritative. Every command rechecks current
  project membership; Researchers can create and mutate their own comments,
  Owners/Administrators can moderation-delete any comment, and legacy Viewer
  access remains read-only.
- Create/edit/delete commands have bounded idempotency evidence. Exact replay
  returns the same result; divergent key reuse or stale versions conflicts.
- Optional first-comment fields are part of `CreateClipCandidateRequest` and
  the existing clip idempotency transaction. Duplicate clip replay returns the
  same clip/comment pair; divergent replay conflicts instead of silently
  discarding or changing the first comment.
- Append safe sync events for comment changes and first-comment creation. This
  slice does not yet add local outbox commands for later comments; full offline
  replay remains PUNCH-008B.

## Failure and authorization behavior

- Reject empty/oversized bodies, out-of-range time anchors, cross-project clip
  or comment identities, nonmember writes, Viewer writes, another Researcher's
  edit/delete, stale optimistic versions, and divergent idempotency replay.
- Removed-member comments remain safely attributed and readable to current
  authorized members. Current handle/display changes do not rewrite the stored
  author snapshot.
- Moderation produces a tombstone with moderator evidence and no readable body;
  it never deletes or mutates clip evidence, description, tags, statuses, or
  exports.

## Non-goals

- Mentions, follows, notification fan-out, comment search/counts, comments CSV,
  offline outbox replay, or Script to Timeline live/snapshot handoff; those are
  PUNCH-008B/C.
- PUNCH-007 speech state/manual player ranges, PUNCH-010 topics, PUNCH-009,
  nested threads, reactions, attachments, rich text, live providers, or
  external service actions.

## Acceptance criteria

1. Two members add distinct ordered comments without changing the clip version
   or description/tags; bounded cursor pagination is deterministic.
2. Exact create/edit/delete replay is stable; divergent idempotency and stale
   optimistic versions conflict without losing content.
3. Authors can edit/delete their own; another Researcher cannot; an Owner or
   Administrator can moderation-tombstone without leaking the body.
4. Optional source time must be within the immutable clip export bounds and is
   returned unchanged when valid.
5. Clip plus optional first comment is one transaction through success,
   failure, exact replay, divergent replay, and concurrent replay.
6. The existing notes field remains compatible but is labeled Clip description
   / intended use in logging and Clip Library editing.
7. Contracts, migration, catalog/API tests, typecheck, build, both migration
   gates, aggregate Vitest, scoped formatting, and `git diff --check` pass.

## Narrow tests first

1. Contract validation for comment bodies, cursors, tombstones, commands, and
   optional atomic first-comment request/response.
2. Catalog fixture for two-member ordering, stable author snapshots,
   authorization, anchors, optimistic/idempotent mutations, moderation, and
   clip-version independence.
3. Catalog fixture for atomic first-comment success/failure/replay/concurrency.
4. Cloud route parsing/status tests, then repository gates.

## Completion record — 2026-08-24

### Delivered decisions and behavior

- Cloud migration `0036_clip_comments` adds a nullable canonical request
  fingerprint for new clip commands, a project/clip-bound flat comment table,
  one optional initial comment per clip, and bounded actor/command receipts.
  Historical clips retain nullable fingerprints for read/replay compatibility;
  a historical key cannot be reused to append a new first comment.
- Active and deleted comment contracts are a strict discriminated union. A
  tombstone cannot carry a body. Stable author and deleter snapshots retain
  attribution after a profile change or membership removal without using a
  mutable handle for authorization.
- Chronological reads use an ascending `(created_at, id)` boundary cursor bound
  to the exact project and clip. Cursor boundaries are revalidated inside a
  repeatable-read transaction and pages are capped at 50.
- Researchers create comments and edit/delete only comments whose stable
  `author_id` matches them. Current Owners/Administrators may moderation-delete
  any active comment. Viewer compatibility remains read-only. Every command
  rechecks current registration/membership and every source anchor is inclusive
  within the immutable clip export range.
- Create/edit/delete/moderate receipts bind project, clip, actor, command kind,
  idempotency key, request SHA-256, comment, and result version. Exact replay
  loads the current safe comment state so a later tombstone never resurrects or
  leaks old text. Divergent reuse conflicts and failed/stale commands roll back
  their receipt.
- New clip creation fingerprints the complete normalized request. The optional
  first comment, clip evidence, tags, and both safe sync events commit in one
  transaction. Exact and concurrent replay yield one clip/comment pair;
  divergent payloads conflict and invalid anchors create neither record.
- Cloud comment routes cover bounded list/create/edit/own-delete/moderate
  commands. The closed desktop transport now permits authenticated bounded
  `DELETE` requests through the existing credential proxy.
- The existing `notes` field and API/CSV compatibility remain unchanged, while
  logging and Clip Library editing label it **Clip description / intended use**.
  Logging exposes a separate optional first-comment field for both project log
  actions. Projectless export-only receives neither field.
- Comment sync payloads contain identity, safe actor/version state, and optional
  source time only; comment bodies are not copied into the event stream.

### Verification

- `npm run typecheck` — passed.
- Focused contract, catalog, API, desktop transport, and database tests —
  passed, including two-user ordering, cross-clip cursors, stable snapshots,
  source bounds, own-author authority, Owner/Administrator moderation,
  optimistic/idempotent mutation, safe tombstones, atomic rollback/replay, and
  concurrent first-comment creation.
- `npx playwright test tests/e2e/workspace.spec.ts -g "maps transcript text selection to stable source and export bounds"`
  — 1 passed, including the separate description and atomic first-comment UI.
- `npm test` — 54 files passed, 1 skipped; 610 tests passed, 4 skipped.
- `npm run build:desktop` — passed; the existing informational Vite large-chunk
  warning remains.
- `npm run db:migrate:cloud:test` — 36 migrations valid.
- `npm run db:migrate:local:test` — 30 migrations valid; no local migration was
  needed for this cloud-authoritative foundation.
- Scoped Prettier and `git diff --check` — passed.

### Deferred scope and residual risk

- Later-comment local outbox replay, mentions, follows, notices, comment
  search/counts, comments CSV, and Script to Timeline live-thread plus explicit
  immutable comment snapshots remain PUNCH-008B/C.
- Player-range speech/no-speech selection remains PUNCH-007. Topic wording,
  any/all filters, authoring grouping, and topic build snapshots remain
  PUNCH-010 and are intentionally scheduled with the later authoring wave.
- No deployment, live provider/media call, external service action, or
  independent multi-agent review was performed. No commit ID exists because no
  commit was requested. The existing full workspace browser file was not rerun
  in this slice; its changed critical logging flow passed and the final expanded
  validation wave will rerun the complete deterministic browser matrix.
