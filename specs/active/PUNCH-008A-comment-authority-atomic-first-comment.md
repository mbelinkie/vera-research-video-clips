# PUNCH-008A — Comment authority and atomic first comment

- Status: active
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
