# M6-01 — Artifact identity and project history

- Status: active
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
