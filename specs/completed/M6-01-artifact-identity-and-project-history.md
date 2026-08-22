# M6-01 — Artifact identity and project history

- Status: completed 2026-08-22
- Task/thread: M6-01 only
- Dependencies: Milestone 5 complete through M5-27

## User-visible outcome and current evidence

An authorized project member can read a bounded immutable export-version
history for a logged clip. Each entry uses the existing M5
`logged_export_success_results.id` as `artifactVersionId`, retains the exact
request/package/settings lineage needed by later compatibility decisions, and
remains visible when a newer export exists or package bytes are unavailable.

M5 already persists immutable success rows, request snapshots, retry lineage,
batch membership, and sanitized result artifacts. It does not yet expose that
history as a project-authorized clip API, and export requests do not yet record
the diagnostic surface that originated them.

## Smallest end-to-end proof

Create a logged selection-action export, reconcile an immutable success, create
and complete a later clip-library request for the same clip, and read both
versions through one bounded authorized history route in newest-first order.
Prove that each `artifactVersionId` is exactly the underlying M5 success-result
ID, retry children preserve their parent's origin, legacy rows remain readable,
and an outsider is denied.

## Affected boundaries

- Shared contracts: `ExportRequestOrigin`, export-request provenance, bounded
  artifact-version summaries/history response.
- Cloud persistence: one ordered additive migration for request origin and a
  success-history deletion guard; no artifact-version table or result backfill.
- Catalog and authorization: individual/batch creation, retry inheritance,
  request mapping, and project/clip history reads.
- Cloud API: one bounded project-authorized history route and origin-aware
  individual/batch commands.
- Worker/local agent: existing request delivery and execution only; origin is
  diagnostic data and must not change renderer behavior or artifact identity.
- UI: existing selection and M5 batch surfaces send their explicit origins;
  the dedicated Clip Library remains M6-03.
- Local persistence: one additive origin column preserves diagnostic provenance
  across durable cloud-delivery import/restart. Object storage and sync do not
  change.

## In-scope behavior

1. Define `selection_action | clip_library | authoring_build` once in shared
   schemas and include it on every new logged request.
2. Default legacy-compatible creation input at the existing selection action to
   `selection_action`; require explicit origin where later surfaces need it.
3. Persist origin immutably on root individual/batch requests, copy it exactly
   on retry, and expose it on request/history projections.
4. Exclude origin from job/request compatibility, settings fingerprints,
   idempotency keys, batch request fingerprints, renderer selection, package
   identity, success-result identity, and retry snapshot equivalence.
5. Derive bounded newest-first artifact history directly from immutable M5
   request/success lineage. Return request/package identity, clip and settings
   snapshots, roles, manifest hash/schema, completion time, and sanitized
   provenance without local paths or filenames.
6. Preserve every completed version independently of current byte availability
   or later requests, and reject direct or cascading deletion of an immutable
   success-history row.

## Explicit non-goals

- Local roots, locators, availability verification, relink/reveal/open, or M5
  package backfill (M6-02/M6-05).
- Dedicated Clip Library UI/search/cache, storage preflight, authoring client,
  drain/quiescence, remote artifact storage, or any alternate executor.
- Changing M5 package schemas, render output, success-result shape, compatibility
  semantics, or existing idempotency identities.

## Failures and recovery

- Nonmember or cross-project clip history reads are denied without revealing
  whether history exists.
- Invalid or unbounded pagination fails at the shared contract boundary.
- A success row whose stored immutable result cannot validate fails closed; it
  is never converted into invented history.
- Legacy requests without persisted provenance report a null/unknown origin;
  no provenance, success, or artifact identity is invented or rewritten.
- Retry or batch origin drift is rejected by persistence invariants and tests.
- Missing or moved package bytes do not delete or hide historical completion.

## Migration and data compatibility

Add one nullable immutable `request_origin` column to cloud `export_requests`
and one matching nullable column to the local durable delivery/import table,
both constrained to the three shared values. Existing rows remain null rather
than gaining invented provenance; all new roots persist an explicit/defaulted
`selection_action` value and retries copy their parent. Do not rewrite request
snapshots, jobs, success results, IDs, package identities, fingerprints, or sync
events. Extend the existing cloud request-identity/retry invariants and local
immutability protection. Add a cloud deletion guard for existing and future
success-history rows. Test fresh and populated M5 database migration paths.

## Acceptance criteria

1. Shared contracts accept only the three origin values and bound artifact
   history size/cursor inputs and outputs.
2. Individual and batch roots persist the caller's origin; retry descendants
   preserve the exact parent origin.
3. Changing only origin cannot change settings compatibility, request/batch
   idempotency, renderer choice, package identity, or `artifactVersionId`.
4. History is membership-authorized, clip/project-scoped, deterministic,
   newest-first, bounded, and includes all immutable completed versions.
5. Every returned `artifactVersionId` equals a real
   `logged_export_success_results.id`; no parallel table or backfill exists.
6. History exposes the authorized immutable video/selection snapshot needed for
   identity, but no absolute path, local filename, locator, credential, header,
   token, object key, command, command output, note, or tag.
7. Fresh and populated cloud migrations preserve M5 rows and results.
8. Direct or ancestor deletion cannot silently erase a completed artifact
   version or invalidate a history cursor.

## Verification plan

Run focused contract tests; populated/fresh cloud migration tests; catalog
individual, batch, retry, history, authorization, pagination, idempotency, and
sensitive-field tests; cloud API route tests; then formatting, typecheck,
relevant integration/browser checks, both migration CLIs, `git diff --check`,
and full `npm run check`. Manually inspect representative JSON history and the
complete diff/staged inventory. Move this spec to completed and update durable
status documents only after every required check passes.

## Completion record

### Decisions and delivered behavior

- Reused `logged_export_success_results.id` exactly as `artifactVersionId`.
  No artifact-version table, identity backfill, or inferred replacement ID was
  added.
- Added the three-value diagnostic origin to new individual, batch-item, and
  export-only requests. Root creation defaults legacy callers to
  `selection_action`; retries accept no caller origin and copy the parent.
- Excluded origin from individual and batch idempotency, resolved settings,
  compatibility, renderer choice, package identity, and result identity.
- Kept historical provenance honest: pre-M6 requests expose `requestOrigin:
null`, and the M5 manifest artifact hash exposes `schemaVersion: "unknown"`
  because the immutable M5 result did not record a verified manifest schema.
- Added one membership-authorized, project/clip-scoped, deterministic keyset
  history query and API route. The cursor is the exposed success-result ID;
  ordering is `reconciled_at DESC, id DESC`, and pages are capped at 100.
- Added an M6 deletion guard to the existing immutable success-result table so
  direct or cascading deletion cannot silently erase artifact history. This is
  forward hardening in migration 0020; no completed M5 migration was changed.
- Persisted origin through local delivery import/replay/restart in migration 0025. No path, filename, locator, credential, worker lease secret, or local
  availability state was added to the cloud history contract.

### Changed files

- Shared contract and validation: `packages/contracts/src/index.ts` and its
  tests.
- Cloud catalog/history/origin composition: `packages/catalog/src/index.ts`
  and its integration tests.
- Cloud route: `apps/cloud-api/src/app.ts` and its route test.
- Existing selection/batch callers: `apps/web/src/main.tsx` and
  `apps/web/src/export-batch-panel.tsx`.
- Cloud migration and populated compatibility proof:
  `packages/db-cloud/migrations/0020_export_request_origin.sql` and
  `packages/db-cloud/src/index.test.ts`.
- Local migration/import/replay proof:
  `packages/db-local/migrations/0025_export_request_origin.sql`,
  `packages/db-local/src/index.ts`, and its tests.

### Migration impact

- Cloud migration 0020 adds nullable, constrained
  `export_requests.request_origin`, extends retry and update immutability, and
  prevents deletion of success-history rows. Existing rows and result JSON are
  preserved byte-for-byte with null origin.
- Local migration 0025 adds the matching nullable constrained column and an
  immutable update trigger. Existing export rows remain readable, and current
  delivery imports retain their explicit origin across restart.
- Fresh/idempotent inventories are now 20 cloud migrations and 25 local
  migrations. Populated M5 fixtures migrate without an identity or result
  backfill.

### Verification evidence

- `npm run typecheck` — passed.
- `npx vitest run packages/db-cloud/src/index.test.ts --reporter=verbose` — 4
  tests passed, including a parseable pre-0020 success row, unchanged row
  equality, null origin, immutable origin, and direct/ancestor deletion guards.
- `npx vitest run packages/catalog/src/index.test.ts --reporter=dot` — 27 tests
  passed, including exact success IDs, authorization, pagination, re-export
  retention, legacy null/unknown mapping, retry inheritance, and idempotency.
- `npm run test` — 27 files passed and 1 skipped; 273 tests passed and 1
  skipped.
- `npm run test:e2e` — 4 Chromium flows passed.
- `npm run build:web` — passed.
- `npm run db:migrate:local:test` — 25 migrations valid.
- `npm run db:migrate:cloud:test` — 20 migrations valid.
- Scoped `prettier --check` and `git diff --check` — passed. The shared dirty
  tree's broad format gate sees the pre-existing user-owned product-spec
  formatting change, which was intentionally not modified.
- `npm run check` at implementation commit `2c3e3de` in a clean detached
  worktree — passed in full: format, typecheck, 273/274 tests with one skip,
  web build, and both migration CLIs.

Manual inspection confirmed that representative history JSON contains the real
success ID, null legacy origin, unknown legacy manifest schema, immutable
selection/settings/artifact hashes, and none of the prohibited workstation or
delivery-secret fields. The complete staged inventory contained only this
slice's 14 implementation/spec files. No provider, live media, deployment,
push, dependency, or cloud mutation was used.

### Review and residual risks

Independent Sol review identified two material issues before completion: M5
success rows were update-immutable but cascade-deletable, and the first
populated fixture was not a contract-valid success result. Migration 0020 now
guards deletion, and both migration and catalog tests use parseable legacy
results. The reviewer reported no remaining identity, origin, authorization,
pagination, or leakage defect after those findings were addressed.

Legacy manifest schema remains deliberately unknown until M6-02 can verify real
local package bytes. Legacy request origin remains deliberately null. Because
immutable history now blocks cascading project deletion, any future explicit
project-purge/privacy workflow must define and test an authorized destructive
policy rather than silently relying on cascades.

### Commits

- `2c3e3de` — `feat: add immutable artifact history`
- Completion documentation commit: recorded by the immediately following
  documentation-only commit.
