# M5-12 — Versioned conversion preset catalogs

- Status: completed
- Task/thread: M5-12 only
- Completion date: 2026-08-20

## User-visible outcome

An authenticated researcher can discover named personal conversion presets and
one fixed-version personal default while preparing an export-only request. In a
logged project context, the same picker discovers authorized project presets
followed by the caller's personal presets, shows both fixed defaults, and
preselects the project default, a permitted personal default, or the built-in
`Editing MP4` fallback according to the explicit context policy. Submitting a
catalog selection sends the exact immutable `ExportPresetSnapshot` returned by
discovery; a later preset revision or default change cannot alter that export.

## Focused context

Read `PROJECT_GUIDE.md`, `outline.md`, PL-01, M5-10, M5-11, and the completed
Milestone 6 workflow task. Reuse the current export settings/snapshot contract,
project authorization boundary, catalog transaction and sync-event patterns,
cloud migrations, Fastify API, selection action panel, and Playwright proof.

## Scope and decisions

1. Add strict shared contracts for `ExportPresetScope = personal | project`,
   stable preset identity, immutable revisions with versioned display metadata
   and complete `ExportSettings`, current-revision pointers, entity versions,
   fixed-version defaults, idempotent commands, and discovery responses.
2. Add cloud migration `0010_export_preset_catalogs.sql`. A preset has exactly
   one owner (`owner_user_id` for personal or `project_id` for project), and its
   normalized name is unique within that scope owner. Immutable versions are
   append-only. Defaults reference one exact preset version. Durable command
   receipts retain the original response so replay remains stable after later
   optimistic-version changes.
3. Personal commands are self-only and never accept `userId`. Project reads
   require membership; project create/revise/default commands require the
   existing project write roles. Project mutations/default changes emit sync
   events; personal preset data never appears in project events.
4. Advertise and implement:

   - `GET/POST /api/export-presets`
   - `PATCH /api/export-presets`
   - `GET/PUT /api/export-presets/default`
   - `GET/POST /api/projects/:projectId/export-presets`
   - `PATCH /api/projects/:projectId/export-presets`
   - `GET/PUT /api/projects/:projectId/export-presets/default`

5. A revise command requires the current entity version and creates the next
   immutable preset version; it never updates prior versions. A default command
   requires the current default entity version (or zero when absent) and fixes
   the selected preset version rather than following the current pointer.
6. Logged discovery returns project presets/default and caller-personal
   presets/default without leaking other users' data. Export-only discovery
   returns only caller-personal state. Lists are deterministic and strict.
7. The selection picker orders project, then personal, then built-in in logged
   context; personal, then built-in in export-only context. The built-in
   `Editing MP4` snapshot remains available and legacy inline snapshots remain
   valid. Switching projects invalidates a stale project selection. Discovery
   failures are actionable but nonblocking while a current valid or built-in
   fallback remains selectable.

## Explicit selection policy

- Export-only: personal default, otherwise built-in fallback.
- Logged export: project default, otherwise built-in fallback. The caller's
  personal default is displayed but is not an implicit logged-export default;
  it may be explicitly selected by the user.
- An explicit current personal selection remains eligible in either context.
  An explicit project selection is eligible only for its matching project.
- Switching project clears an ineligible project selection and applies the new
  project's default or built-in fallback.

## Affected boundaries

- `packages/contracts`: schemas/types and snapshot compatibility tests.
- `packages/db-cloud`: migration 0010 and empty/current migration proof.
- `packages/catalog`: catalog CRUD/default/discovery, authorization,
  idempotency receipts, optimistic versions, sync-event isolation.
- `apps/cloud-api`: advertised personal and project routes plus strict parsing.
- `apps/web`: catalog discovery, ordered picker, fallback/error behavior, and
  exact immutable snapshot submission.
- `tests/e2e`: export-only and logged picker ordering/defaults, selection
  snapshot, project-switch invalidation, and nonblocking discovery failure.

## Failure states

- Blank/duplicate normalized names and malformed/incomplete settings fail
  without creating a preset or receipt.
- A stale preset/default entity version returns an actionable conflict and
  creates no revision/default/event.
- Reusing an idempotency key with a different command payload is rejected;
  exact replay returns the original result even after the entity advances.
- A personal route cannot address another user. A nonmember cannot discover a
  project's preset existence; a viewer cannot mutate it.
- A project default may reference only a version owned by that project. A
  personal default may reference only the caller's personal preset version.
- A failed picker request does not disable export when its current selection is
  still valid; otherwise the picker falls back to built-in.

## Explicit non-goals

- Field-wise setting resolution or per-field overrides, worker capability
  probing, alternative rendering, embedded/burned subtitles, management or
  history UI, offline preset cache/mutation, Sheets, or logged delivery.
- Any worker, media, local processor, local database, or legacy export request
  change.
- Editing `PROJECT_GUIDE.md`, `outline.md`, the M6 future spec, or either
  scriptwriting product document in the current dirty worktree.

## Acceptance criteria

1. Empty cloud migration applies through 0010 and enforces owner XOR,
   scope-owner normalized-name uniqueness, immutable version identity, exact
   default ownership, and command-receipt identity.
2. Personal create/revise/default commands are self-only, optimistic,
   append-only, idempotent across later CAS advances, and create no sync events.
3. Project commands require write permission, reads require membership,
   mutations emit project sync events, and no personal data leaks to project
   events or other users.
4. Discovery returns exact immutable snapshots, stable IDs/current pointers,
   deterministic ordering, and fixed personal/project defaults.
5. Existing inline `Editing MP4` and other legacy preset snapshots still parse
   and persist unchanged.
6. Playwright proves personal/project/default/built-in ordering, exact snapshot
   submission, project-switch invalidation, and actionable nonblocking failure.

## Verification plan

Run focused contracts, cloud migration, catalog, API, and Playwright picker
tests first. Then run typecheck, unit tests, web build, cloud/local migration
checks, full Playwright, format/diff checks, and inspect the staged diff. Commit
only M5-12 files. Record the actual results and commit in this spec before
moving it to `specs/completed/`.

## Documentation constraint

`PROJECT_GUIDE.md`, `outline.md`, `docs/Script-to-Resolve Product Spec.md`, and
`specs/future/M6-project-clip-library-and-authoring-handoff.md` contain
intentional completed work from another task. Do not edit or commit them. Note
deferred guide/outline checklist reconciliation in this completion record.

## Completion record

### Decisions implemented

- Personal and project presets have stable IDs, normalized scope-owner-unique
  names, optimistic entity versions, and append-only immutable revisions. Each
  revision freezes its name, description, complete `ExportSettings`, creator,
  and timestamp; the catalog's current pointer may advance without changing an
  earlier export or fixed default.
- Personal and project defaults are separate fixed-version records. A default
  continues to return its original immutable snapshot after the preset's
  current revision advances.
- Create, revise, and set-default commands persist actor/scope-owner-bound
  receipts with request hashes and exact response snapshots. Exact replay
  returns the original result even after later CAS advances; reuse with a
  different command payload returns an idempotency conflict.
- Personal routes infer the caller and reject extra `userId` input. Project
  reads require membership and mutations require the established write roles.
  Project mutations/default changes emit bounded sync events; personal commands
  create none and no personal name/settings appear in project streams.
- The logged picker orders project, personal, then built-in and implicitly
  chooses only a project default. The export-only picker orders personal, then
  built-in and chooses the personal default. Switching projects clears a stale
  project selection. Discovery failure keeps a valid personal choice or the
  built-in `Editing MP4` fallback usable.
- Selecting a saved option submits its exact catalog `ExportPresetSnapshot`.
  The existing built-in advanced controls affect only the built-in snapshot;
  they cannot mutate a saved selection before submission.

### Files changed

- Shared preset catalog, revision, default, strict response, and command
  contracts/tests in `packages/contracts`.
- Cloud migration `0010_export_preset_catalogs.sql` plus migration constraint
  and empty-database tests in `packages/db-cloud`.
- Catalog authorization, discovery, create/revise/default commands, receipts,
  fixed snapshots, optimistic versions, project sync events, and focused tests
  in `packages/catalog`.
- Personal/project catalog and default routes with integration coverage in
  `apps/cloud-api`.
- Logged/export-only preset discovery, ordering, fallback, selection, and exact
  submission in `apps/web`, with Playwright coverage in
  `tests/e2e/workspace.spec.ts`.
- This completion record. No worker, media, local processor/database, guide,
  outline, M6, or scriptwriting document was changed for M5-12.

### Checks and actual results

- Focused contracts/cloud DB/catalog/API suite: 28 passed across 4 files.
- Focused Playwright selection/picker proof: 1 passed.
- `npm run check`: passed, including Prettier, typecheck, 160 unit/integration
  tests passed with 1 optional test skipped, web production build (105 modules),
  15 local migrations, and 10 cloud migrations.
- `npm run test:e2e`: 4 passed.
- `git diff --check`: passed before completion.

### Compatibility and remaining risks

- Existing built-in and legacy inline `ExportPresetSnapshot` values remain
  schema-valid and persist unchanged. Migration 0010 is cloud-only and does not
  alter existing local export request snapshots or add a local cache.
- The slice intentionally does not add preset management/history UI, offline
  mutation/cache, field-wise settings resolution, worker capability probing,
  alternative rendering, embedded subtitle implementation, Sheets, or logged
  delivery. The current picker is the discovery/selection proof for later
  management surfaces.
- `PROJECT_GUIDE.md` and `outline.md` still need their M5-10/M5-11/M5-12 status
  and next-action reconciliation in the owning documentation task. Their
  intentional uncommitted M6 decisions, the M6 future spec, and both
  scriptwriting product documents were preserved exactly.

### Commit ID(s)

- Reported in the task handoff after the isolated M5-12 commit that moves this
  spec to `specs/completed/`.
