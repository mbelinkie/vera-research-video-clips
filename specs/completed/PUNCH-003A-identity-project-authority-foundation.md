# PUNCH-003A — Identity and project-authority foundation

- Status: active
- Parent entry: `PUNCH-003`
- Priority: P1 high
- Dependencies: existing centralized authentication/catalog authorization and
  completed PUNCH-006A UI decomposition

## User-visible outcome

Every user has one stable, normalized, case-insensitively unique handle, and
every project explicitly reports whether it is personal or shared plus its safe
visibility. New shared memberships use Owner, Administrator, or Researcher.
Legacy Editors are compatibility-migrated to Researcher without gaining
administrative power; legacy Viewers remain readable but cannot be newly
assigned. Authorized project summaries expose the current user's exact role and
bounded member count without revealing nonmember content.

## Smallest end-to-end proof

Register users with colliding handle variants and prove only one normalized
identity succeeds. Create one personal and one invitation-only shared project,
read their authorized summaries, and exercise the complete role matrix: Owner
may add Administrators or Researchers; Administrator may add Researchers only;
Researcher and legacy Editor/Viewer cannot manage membership; personal projects
cannot add members. Migrate representative legacy projects/users and prove
Editors become Researchers, Viewers remain compatibility-only, existing
projects become invitation-only shared projects, and exactly one Owner remains.

## Affected authority boundaries and persisted records

- Shared contracts own handle, project kind/visibility, role, create/update,
  member-assignment, and project-summary shapes.
- `packages/auth` owns the closed permission matrix; components and routes do
  not infer powers from role names.
- A forward-only cloud migration adds normalized unique handles, explicit
  project kind/visibility, the new role constraint, safe legacy role mapping,
  and a true one-Owner-per-project uniqueness safeguard.
- The catalog owns handle registration/update, project creation/list summaries,
  current membership lookup, personal-project enforcement, and target-role
  authorization. The cloud API validates all request/response shapes.
- Existing stable user/project IDs, project content, transcripts, clips, jobs,
  immutable artifacts, and local caches remain unchanged.

## Failure, restart, concurrency, authorization, and migration behavior

- Handle normalization is deterministic; case-equivalent concurrent claims are
  serialized by the database unique constraint and return a bounded conflict.
- Nonmembers receive no project summary/content. Project list results include
  only current memberships.
- Personal projects are private and owner-only. Shared visibility is explicit;
  open discovery/join is deferred and no visibility value grants content access
  in this slice.
- Only an Owner may add an Administrator. Owners and Administrators may add a
  Researcher. Researchers, legacy Editors, legacy Viewers, nonmembers, and
  Administrators targeting Administrator/Owner/legacy roles are denied.
- Duplicate same-role membership replay is harmless; conflicting existing-role
  assignment does not silently overwrite authority. Role changes, removal,
  ownership transfer, and invitation state are later slices.
- Clean and representative populated migrations preserve stable IDs and data,
  map every Editor to Researcher, retain Viewer rows, and enforce one Owner.
- Restart adds no process-local authority. No local migration is required.

## Explicit non-goals

- Invitations, accept/reject/revoke, open-project discovery/self-join, notices,
  governance audit, role changes/removal, ownership transfer, or personal-to-
  shared conversion.
- Project Settings or the final VERA shell; no PUNCH-004 through PUNCH-010 state.
- Anonymous/public reads, email/directory integrations, deployment, production
  data changes, live providers/media, or PUNCH-009 work.

## Acceptance criteria

1. Handles normalize and compare case-insensitively, bind to stable user IDs,
   survive display-name changes, and reject exact/case-equivalent collisions.
2. Projects persist and return explicit valid kind/visibility combinations;
   legacy projects read as shared invitation-only and personal projects remain
   private/owner-only.
3. New assignments accept only Administrator or Researcher; legacy Editor is
   not assignable and gains no Administrator permission; legacy Viewer remains
   readable but compatibility-only.
4. The closed permission and target-role matrix passes for Owner,
   Administrator, Researcher, legacy Editor, legacy Viewer, and nonmember.
5. Authorized project summaries include current-user role and bounded member
   count; nonmembers receive no project content or summary.
6. Clean/populated migration, contract, auth, catalog, cloud API, typecheck,
   build, formatting, and aggregate affected tests pass without a local
   migration or external call.

## Narrow tests first

1. Contract tests for handles, valid project kind/visibility combinations,
   assignable roles, and strict summaries.
2. Auth unit matrix for every role and target-role management decision.
3. Clean/populated migration tests for handles, project defaults, Editor
   downgrade, Viewer retention, and one-owner uniqueness.
4. Catalog tests for handle collision, personal/shared creation, authorized
   summaries, personal member denial, role matrix, and replay/conflict.
5. Cloud API route tests, then typecheck/build, affected aggregate suites,
   scoped Prettier, migration CLI, and `git diff --check`.

## Completion record

Completed 2026-08-24 at the identity/project-authority foundation boundary. No
invitation, discovery, join, role-change/removal, ownership-transfer, settings,
local-schema, deployment, external-service, or live-provider behavior was added.

### Delivered contracts and authority

- Added normalized NFKC/lowercase handles with an optional registration handle,
  deterministic legacy/new-user fallback, and a database-enforced unique
  normalized identity. Re-registering without a handle preserves the current
  handle; exact, case-equivalent, and concurrent equivalent claims return one
  bounded conflict.
- Added explicit `personal | shared` project kind and `private |
invitation_only | open_to_join` visibility. Personal projects are private and
  owner-only; shared projects cannot be private. Existing projects migrate to
  shared/invitation-only, while new omitted fields retain that historical-safe
  default.
- Added Administrator to the compatibility-aware project-role contract and
  centralized the closed permission/target-role matrix. Owner may add
  Administrator or Researcher; Administrator may add Researcher only;
  Researcher, legacy Editor, Viewer, and nonmember cannot manage membership.
  Public member commands accept only Administrator or Researcher.
- Added membership-bounded project summaries carrying the current user's exact
  role and bounded member count. Open visibility does not grant discovery or
  content access in this slice; a registered nonmember still lists no project
  and cannot read one by ID.
- Made same-role membership replay a no-op and conflicting existing-role
  assignment a conflict rather than an implicit authority change. Personal
  projects reject every additional membership.

### Migration and compatibility

- Added forward-only cloud migration
  `0027_identity_project_authority_foundation.sql`; no local migration was
  required.
- Existing users receive deterministic `user_<20 UUID hex characters>` handles.
  Existing Editors become Researchers with no administrative escalation, while
  Viewers remain compatibility-only readable rows.
- Repaired the historical Owner uniqueness index, which incorrectly included
  `user_id`. Before installing the correct project-only partial unique index,
  the migration deterministically restores the project's `created_by` member as
  Owner and maps any extra historical Owner rows to Researcher. Representative
  populated migration coverage proves exactly one Owner remains and a second
  Owner is rejected.

### Verification evidence

- Focused contracts/auth/cloud-migration matrix: 3 files passed; 73 tests
  passed, 2 optional PostgreSQL tests skipped.
- Focused contract/auth/catalog/cloud API/shared-store matrix: 6 files passed;
  129 tests passed, 2 optional PostgreSQL tests skipped.
- Aggregate network-free Vitest: 53 files passed, 1 skipped; 554 tests passed,
  4 skipped.
- Full mocked Playwright workspace suite: 11 passed, 0 failed. Project/profile
  fixtures now carry the required handle and project kind/visibility fields.
- `npm run typecheck`, `npm run build:web`, and `npm run build:desktop` passed.
- Cloud migration validation applied 27 migrations; local migration validation
  still applied 30. The populated PGlite gate passed; the two opt-in real
  PostgreSQL tests remained skipped because `CLOUD_DATABASE_TEST_URL` was not
  configured.
- Scoped Prettier over all affected TypeScript files and `git diff --check`
  passed. Repository-wide Prettier was not used because the known unrelated
  `docs/Script-to-Resolve Product Spec.md` failure remains outside this slice.

### Review and remaining scope

Root review found no unresolved authorization, uniqueness, migration,
compatibility, project-content exposure, or replay issue in this slice.
Terra/multi-agent review tooling was unavailable, so no independent-review
claim is made. PUNCH-003 remains in progress: invitations/open discovery and
join are slice 2; Project Settings, conversion, ownership transfer, role
administration, and governance audit remain slice 3. No commit was requested or
created.
