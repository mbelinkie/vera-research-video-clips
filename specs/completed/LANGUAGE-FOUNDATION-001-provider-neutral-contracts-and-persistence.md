# LANGUAGE-FOUNDATION-001 — Provider-neutral language contracts and persistence

- Status: completed
- Date authorized: 2026-08-26

## User-visible outcome

The platform has validated, provider-neutral durable shapes for dynamically
managed local translation models and any number of approved cloud translation
or transcription services. This foundation does not itself grant cloud access,
enable a model, invoke a provider, or change the UI.

## Affected boundaries

- `packages/contracts`: stable provider, access, operation, model-catalog, and
  platform-capability contracts.
- `packages/db-cloud`: forward-only catalog, approval/grant/usage, operation,
  and model-governance tables.
- `packages/db-local`: verified catalog cache, model installation, and lease
  tables for the later desktop runtime.

## Explicit non-goals

- Provider adapter implementations, credentials, AWS calls, routes, account or
  administration UI, model download/evaluation workers, catalog signing keys,
  or permission derivation from Cognito.
- Backfilling approvals, enabled packs, model versions, grants, operations, or
  metering history.
- Replacing compatibility-only Amazon Translate consent fields already used by
  existing batch workflows.

## Failure states

- A vendor enum leaks into a generic provider identity or a provider descriptor
  contains credentials.
- A recommendation override can disguise a hard safety failure.
- Historical rows receive fabricated approval, availability, usage, or access
  evidence.
- A migration is not forward-only/idempotent or a pre-existing actor fixture
  fails solely because platform capabilities are absent.

## Acceptance criteria

1. Contracts support arbitrary opaque provider IDs, translation and
   transcription descriptors, provider-specific disclosure/access/grant/usage,
   operation cleanup evidence, and local-model discovery through signed release.
2. Provider/mode, operation, availability, and override invariants fail closed.
3. `AuthenticatedActor` exposes optional platform capabilities and a generic
   capability guard with `manage_language_services`, without naming a project
   role.
4. Empty cloud/local databases apply the new migrations once and preserve no
   fabricated operational state.

## Narrow verification first

- `npm exec vitest run packages/contracts/src/index.test.ts`
- `npm exec vitest run packages/db-cloud/src/index.test.ts packages/db-local/src/index.test.ts`
- `npm run typecheck`
- `git diff --check`

## Completion record

Completed 2026-08-26.

### Decisions delivered

- Cloud providers remain opaque IDs and renderer-safe descriptors; server-only
  configuration now requires an opaque protected-store credential reference,
  records changed fields in its audit trail, and never represents a credential
  value in the public contract.
- Cloud account/provider/service access has a partial unique active-request
  index. Provider/service references are relationally constrained, while
  grant, configuration, and model mutations use idempotency keys and optimistic
  versions.
- Local-model discovery preserves immutable raw feed and per-candidate evidence
  identities. Evaluations require integrity, legal, attribution, provenance,
  quality, hard-safety, evaluator, and raw-evidence records before a version can
  be represented.
- Server governance operations and local desktop model-runtime operations are
  durable, lease/heartbeat-aware records with kind-specific references,
  idempotency, monotonic versions, and terminal evidence.
- A signed release explicitly lists revoked model-version IDs. A disabled or
  omitted version is therefore retainable for rollback/offline use and is never
  interpreted as a delete instruction. `mirroredArtifactId` remains the signed,
  opaque artifact-download identity; issuing short-lived download URLs is a
  later authenticated API concern.

### Files changed

- `packages/contracts/src/index.ts`
- `packages/contracts/src/index.test.ts`
- `packages/db-cloud/migrations/0046_language_service_and_local_model_foundation.sql`
- `packages/db-cloud/src/index.test.ts`
- `packages/db-local/migrations/0036_language_service_catalog_and_model_runtime.sql`
- `packages/db-local/src/index.test.ts`

### Verification

- `npm exec vitest run packages/contracts/src/index.test.ts packages/db-cloud/src/index.test.ts packages/db-local/src/index.test.ts` — passed.
- `npm run typecheck` — passed.
- `prettier --check` on the six owned source/migration/test files — passed.
- `git diff --check` — passed.

### Remaining risk / follow-up

No provider is enabled, no credentials are stored, and no account/model state is
backfilled by this foundation. Later API and worker slices must enforce these
contracts transactionally and issue short-lived artifact download URLs through
the authenticated boundary. No commit was created.
