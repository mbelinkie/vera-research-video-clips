# LANGUAGE-MODEL-RUNNER-001 — Durable Argos source operations

- Status: completed
- Date authorized: 2026-08-26

## User-visible outcome

Platform operators can run and recover bounded Argos source refresh, exact-byte
evaluation/mirroring, and signed-release operations without a duplicate worker
changing evidence or exposing raw provider failures.

## Affected boundaries

- `packages/catalog`: durable operation runner, PostgreSQL operation store, and
  injected artifact/Argos-source adapters.
- `packages/db-cloud`: retry, lease recovery, and candidate-evaluation support.

## Explicit non-goals

- API routes, authorization derivation, provider-engine changes, scheduled
  process hosting, provider enablement, or desktop download.

## Failure states

- A mutable feed changes a snapshot/candidate already under evaluation.
- Duplicate or reclaimed delivery creates another immutable evidence artifact.
- Lease loss, crash, or external fetch errors leave an operation running
  forever or persist raw failure content.

## Acceptance criteria

1. The runner claims, heartbeats, recovers, and completes exact idempotent
   operations with kind-correct references.
2. Refresh/evaluate/mirror/release operations persist immutable feed,
   candidate, exact-byte artifact, and evaluation evidence through injected
   storage.
3. Due-source discovery is deterministic and daily-bounded; terminal failures
   are sanitized and recovery remains safe under duplicate delivery.

## Narrow verification first

- `npm exec vitest run packages/catalog/src/local-model-operation-runner.test.ts`
- `npm run typecheck`
- `git diff --check`
