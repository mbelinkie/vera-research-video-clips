# TRANSLATION-003 — Verified local Argos model runtime

- Status: completed
- Date authorized: 2026-08-26
- Date completed: 2026-08-26

## User-visible outcome

The desktop/local agent can retain the last verified signed local-model catalog,
download and atomically activate a compatible Argos pack, safely lease it for
local translation, and remove revoked bytes only after active leases drain.

## Affected boundaries

- `packages/providers`: local catalog-cache/model-manager and Argos sidecar
  translation adapter, backed by an injectable persistence interface matching
  migration `0036_language_service_catalog_and_model_runtime.sql`.

## Explicit non-goals

- Cloud API, admin UI, database migration/repository changes, network download
  implementation, Argos package execution, cloud translation fallback, and
  changes to shared-first/caption resolution precedence.

## Failure states

- A missing, stale, tampered, corrupt, oversized, traversal-containing, or
  incompatible pack never becomes active.
- Disabled versions receive no new downloads or leases; revoked versions enter
  deletion-pending state and are deleted only once all non-expired leases end.
- Sidecar failures are local-provider failures; no alternate cloud provider is
  selected.

## Acceptance criteria

1. Signed release verification/cache supplies a current or clearly stale local
   catalog for offline installed-model use.
2. Exact byte limit, SHA-256, archive containment, runtime compatibility, and
   atomic filesystem promotion are verified before activation.
3. Concurrent leases protect an active pack; disable/revoke and verified
   cleanup observe the documented drain behavior.
4. The Argos sidecar adapter invokes only safe argv through an injectable local
   boundary and validates normalized one-to-one segment output.

## Narrow verification first

- `vitest run packages/providers/src/local-argos-model-manager.test.ts packages/providers/src/translation-argos-local.test.ts`
- `npm run typecheck`

## Completion record — 2026-08-26

### Decisions and files changed

- Added `packages/providers/src/local-argos-model-manager.ts`, a local-only,
  storage-injected model manager. It verifies signed cached releases on every
  use, exposes current/stale state, accepts stale cache only for already
  verified installed models, bounds download bytes, verifies exact SHA-256,
  inspects archive containment and runtime compatibility, stages files under
  the app-owned root, and atomically promotes them.
- The manager tracks installation lifecycle and exact concurrent leases through
  an interface shaped for local migration `0036`. Current catalog removal,
  disable, or revoke marks installed bytes deletion-pending; cleanup waits for
  non-expired leases and verifies the model directory is absent.
- Added `packages/providers/src/translation-argos-local.ts`, which obtains an
  exact model lease, passes transcript data over bounded JSONL stdin rather than
  argv, invokes a contained no-shell child process, and rejects incomplete,
  reordered, malformed, oversized, or empty sidecar responses before returning
  the existing provider-neutral segment shape.
- Added deterministic fixture tests in
  `packages/providers/src/local-argos-model-manager.test.ts` and
  `packages/providers/src/translation-argos-local.test.ts`; exported both
  modules from `packages/providers/package.json`.

### Checks and actual results

- `npm exec -- vitest run packages/providers/src/local-model-argos-catalog.test.ts packages/providers/src/local-argos-model-manager.test.ts packages/providers/src/translation-argos-local.test.ts`
  — passed: 3 files, 11 tests.
- `npm exec -- prettier --check packages/providers/src/local-model-argos-catalog.ts packages/providers/src/local-model-argos-catalog.test.ts packages/providers/src/local-argos-model-manager.ts packages/providers/src/local-argos-model-manager.test.ts packages/providers/src/translation-argos-local.ts packages/providers/src/translation-argos-local.test.ts packages/providers/package.json`
  — passed.
- `git diff --check` — passed.
- `npm run typecheck` — this slice passed before concurrent shared-worktree
  updates; the final rerun is blocked by unrelated
  `packages/catalog/src/language-services.test.ts` calls that omit the newly
  required `expectedAccessVersion` argument. No type error originated in this
  slice.

### Remaining risks and follow-ups

- The next desktop/local-agent slice must implement the SQLite-backed store
  against migration `0036`, supply production verifier/key rotation and a
  release artifact-download implementation, and select approved model routes
  from the authenticated catalog.
- This slice deliberately does not package or execute a real Argos/CTranslate2
  sidecar, sandbox network access at the OS level, or compose English-hub
  two-pack routing. Those must retain the exact manager/sidecar boundary.
- No commit was created in the shared working tree.
