# PUNCH-004D — Paid hosted transcription approval gate

- Status: completed 2026-08-24
- Parent entry: `PUNCH-004`
- Priority: P1 high
- Dependencies: completed PUNCH-003A authority and PUNCH-004A–C worklist,
  review, triage, cancellation, and activity foundations

## User-visible outcome

A Researcher may prepare a batch that requests hosted transcription, but no
hosted queue delivery or worker claim can start until a current Owner or
Administrator explicitly approves that exact durable batch. The Workbench shows
Pending/Approved/Revoked hosted status and lets an authorized project
administrator approve or revoke it. Local caption/Whisper work remains automatic
and is never mislabeled as paid hosted work.

## Smallest end-to-end proof

A Researcher creates one hosted batch. It persists as Pending and produces no
dispatchable/claimable hosted job across restart. A Researcher approval attempt
is denied. An Administrator approves with optimistic exact replay; the existing
job becomes dispatchable and claimable without creating a replacement. Revoking
before claim blocks it again. A stale, divergent, removed-member, or wrong-project
command cannot authorize spend.

## Affected boundaries and persisted records

- Contracts add hosted approval state/evidence plus a strict optimistic command.
- Cloud migration 0031 adds hosted approval state to batches and append-only
  command evidence. Historical hosted batches become Pending and paused rather
  than acquiring fabricated approval; local batches are Not required.
- Catalog authorization, dispatch discovery, and worker claim are the authority.
- Cloud API and `BatchWorkspace` expose the real command and status.

## Explicit non-goals

- Dollar/token budgets, provider pricing, billing reconciliation, hosted worker
  provisioning, automatic scaling, email/OS notifications, local run-while-idle
  scheduling, keyword scans, live providers/media, deployment, or PUNCH-009.
- Changing immutable batch options or creating a second job on approval.

## Acceptance criteria

1. Local batches remain automatically dispatchable under existing controls.
2. Hosted batches are Pending by default and cannot dispatch or claim before
   Owner/Administrator approval.
3. Approve/revoke is current-role checked, optimistic, exact-replay safe,
   cross-project isolated, audited, and denied to Researcher/Viewer/nonmember.
4. Approval does not change flags, triage, review, transcript evidence, batch
   options, job identity, or project-video identity.
5. Clean/populated migration, contract/catalog/API/browser tests, typecheck,
   builds, aggregate tests, formatting, and migration CLIs pass.

## Narrow tests first

1. Strict contract and clean/populated migration tests.
2. Catalog role/replay/dispatch/claim/revoke tests.
3. API forwarding and focused Workbench Chromium.

## Completion record

Completed 2026-08-24.

### Decisions and delivered behavior

- Cloud migration `0031_hosted_transcription_approval.sql` adds an independent
  hosted approval state/version/actor/time axis plus durable exact-replay
  command receipts. Local batches backfill `not_required`; historical hosted
  batches backfill Pending and only formerly active dispatch becomes Paused, so
  canceled work is never revived. No historical actor or approval is invented.
- New hosted batches start Pending even when submitted by an Administrator.
  Current Owners and Administrators may explicitly approve Pending/Revoked or
  revoke Approved with optimistic versions, SHA-256 request identity, exact
  replay, divergent-key conflict, and project-scoped row locking. Researchers,
  Viewers, removed members, nonmembers, local batches, stale versions, and
  wrong-project commands cannot authorize work.
- Batch reads expose Pending/Approved/Revoked evidence. A removed decision actor
  is represented as `former_member` / `Former project member` while the durable
  stable user ID and command receipt remain intact.
- Dispatch discovery, atomic pre-publication reservation, queue-delivery
  recording, and worker claim each require at least one active approved hosted
  dependency. Revocation between discovery and reservation skips publication;
  revocation before delivery or claim drops the stale signal and blocks spend.
  Local work follows the existing automatic path. Approval never changes job
  identity, batch options, project-video identity, flags, review, triage,
  transcript evidence, clips, or artifacts.
- The strict cloud API route and Workbench show hosted status and
  approve/revoke controls, forward the current approval version, and use stable
  payload-derived SHA-256 idempotency keys. Backend role checks remain
  authoritative.

### Primary files

- `packages/db-cloud/migrations/0031_hosted_transcription_approval.sql`
- `packages/contracts/src/index.ts`
- `packages/catalog/src/index.ts`
- `apps/cloud-api/src/app.ts`
- `apps/cloud-api/src/job-queue.ts`
- `apps/web/src/batch-workspace.tsx`
- Corresponding contract, migration, catalog, API, queue-pump, and Chromium
  tests.

### Verification evidence

- `npm run typecheck` — passed.
- Focused Vitest matrix (contracts, cloud migrations, catalog, cloud API, queue
  pump) — 5 files passed; 135 tests passed; 2 optional PostgreSQL tests skipped.
- Focused Chromium Workbench hosted approval flow — 1 passed.
- Aggregate `npm test` — 53 files passed, 1 skipped; 577 tests passed, 4
  skipped.
- Full Playwright gate — 11 passed.
- `npm run build:web` and `npm run build:desktop` — passed. Vite retained its
  existing advisory for a roughly 503 kB minified web chunk.
- Cloud migration CLI — 31 migrations applied and validated. Local migration
  CLI — 30 migrations applied and validated; no local migration was required.
- Scoped Prettier on supported changed TypeScript/TSX/Markdown files and
  `git diff --check` — passed. Migration SQL was manually reviewed because
  Prettier has no SQL parser. The known unrelated full-repository Prettier
  failure in `docs/Script-to-Resolve Product Spec.md` remains outside this
  slice.
- Root review covered current-role authorization, concurrent optimistic
  decisions, exact/divergent replay, migration compatibility, removed-member
  privacy, shared-job dependencies, and discovery/reservation/delivery/claim
  races. No unresolved P0/P1 finding remained. Terra tooling was unavailable,
  so no independent-agent review is claimed.

### Remaining bounded risks and follow-ups

- Approval is the explicit Administrator branch of the requirement; project
  dollar/token budgets, provider pricing/billing, and automatic budget approval
  remain separate work.
- Revoking approval does not terminate an already claimed hosted attempt. It
  blocks all later delivery/claim starts; cooperative cancellation of active
  work remains governed by the existing dependency-aware cancellation path.
- Historical hosted batches are deliberately Paused as well as Pending and
  require an explicit approval plus ordinary Resume before dispatch.
- No live provider/media, production data, deployment, commit, push, or external
  service action was used. Commit ID: none (not requested).
