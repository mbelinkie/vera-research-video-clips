# R1-49 — Safe project membership and last-Owner invariant

- Status: active; draft implementation, not accepted
- GitHub: https://github.com/mbelinkie/vera-research-video-clips/issues/49
- Parent: #48; owned boundary: catalog/API permissions, not browser membership UI

## User-visible outcome

An Owner can grant an existing registered member Editor/Viewer access, list
members, safely change roles, revoke access or explicitly transfer ownership.
Sole Owners cannot be demoted or removed. Stale member versions fail with a
conflict instead of overwriting newer roles.

## Implementation boundary

Use a single transaction with a locked project row and current-Owner
authorization checked inside the same transaction as the write. Preserve the
legacy `researcher` role. The existing `POST .../members` grant stays
create-only/idempotent and never grants Owner. `PATCH .../members/:userId`
performs explicit versioned role changes, `DELETE .../members/:userId` performs
versioned revocation, and `POST .../members/transfer` atomically promotes an
already-registered project member to Owner before demoting the acting Owner to
Editor. No browser UI, signup, production authentication, deployment, real
data, provider spending, #50 adapter or #53 operations.

The actor identity always comes from server authentication; no request body is
accepted as the acting user. `authenticateDevBearer` remains a test/development
fixture and is not a production authentication mode.

## Failure states

- Unauthorized/nonmember/cross-project actor: `403` without project or member
  disclosure.
- Missing member or target user, for a currently authorized Owner: `404`.
- Last-Owner demotion/removal, conflicting-role grant, stale member version or
  stale transfer precondition: `409`.
- Malformed payload or a role outside the permitted request shape: `400`.
- A failed operation leaves the database unchanged because authorization,
  version checks, remaining-Owner checks and writes share one transaction.

## Retry and idempotency contract

- Granting an existing member the same role is a deterministic no-op; the
  membership version does not change.
- Granting an existing member a different role is `409`; only the explicit
  versioned `PATCH` changes a role.
- A `PATCH` with the current version and the same role is a no-op; a stale
  version is `409`.
- Replaying a completed `DELETE` returns `404` (the member is gone), never a
  silent success.
- Replaying a transfer after the acting Owner has stepped down returns `403`;
  stale preconditions never succeed.

## Acceptance

Synthetic PGlite catalog/API authorization, grant, transfer, stale, retry and
revocation tests. Real multi-connection PostgreSQL concurrency and
transaction-affinity proof remain pending #50 integration and are a hard gate
before this issue is accepted.

## Verification record

Commands actually executed on 2026-11-04 in this worktree:

- RED baseline before implementation:
  `npx vitest run packages/catalog/src/index.test.ts` → 3 failed
  (sole-Owner self-demotion accepted, identical-role grant bumped version to 2,
  conflicting-role grant overwrote the role), 1 passed (existing claimed
  transcript finalization test).
- After implementation:
  `npx vitest run packages/catalog/src/index.test.ts apps/cloud-api/src/app.test.ts packages/auth/src/index.test.ts packages/contracts/src/index.test.ts`
  → 4 files passed, 34 tests passed (15 catalog, 9 cloud API, 8 contracts,
  2 auth).
- `npm run check` → formatting, typecheck, full test suite (21 files passed,
  1 skipped; 118 tests passed, 1 skipped), web build, and both local/cloud
  migration checks passed.
- `npm run typecheck` → passed with no diagnostics.
- `npx prettier --check` on the changed files → passed after formatting.

2026-11-12 phase-1 integration verification (Linux Zodex worktree; PR #68
DeepSeek draft rebased by merging `origin/main` with the completed #50 adapter
and #51 authentication work):

- `npm ci --no-audit --no-fund` → clean worktree dependencies installed; the
  parent checkout's platform-mismatched dependencies were not used for the
  accepted results.
- `npm test -- packages/catalog/src/index.test.ts apps/cloud-api/src/app.test.ts packages/contracts/src/index.test.ts packages/auth/src/index.test.ts`
  → **4 files passed, 34 tests passed**.
- `npm run typecheck` → **passed** after integrating the catalog with #50's
  native connection-affine `withTransaction` API and preserving PGlite's own
  transactional callback handle.
- `VERA49_TEST_PG_URL=postgres://root@127.0.0.1:5432/vera49_test_membership_pipeline_49 VERA49_TEST_PG_ALLOW_SCHEMA_CREATE=1 npm test -- packages/catalog/src/membership.postgres.integration.test.ts`
  → **1 file passed, 1 test passed** on local PostgreSQL 16, with two separate
  pools/clients and an empty disposable database. The test covers concurrent
  conflicting Owner demotions, transactionally current Owner permission,
  last-Owner refusal, versioned stale retry, and transfer-vs-revoke safety.

Do not mark #49 accepted until phase-2 full `npm run check`, independent
security mutation/review and CI are complete. The PostgreSQL proof is a local
two-connection integration test, not a deployment or production authentication
test; browser sharing remains outside this issue.
