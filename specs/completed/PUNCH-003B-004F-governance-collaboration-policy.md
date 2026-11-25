# PUNCH-003B / PUNCH-004F — Governance and collaboration policy closure

- Status: completed 2026-08-24
- Parent entries: `PUNCH-003`, `PUNCH-004`
- Priority wave: final core-pilot governance before expanded validation

## Smallest user-visible end-to-end result

A project Owner can convert a personal project once, control shared-project
visibility, invite a current `@handle`, administer roles without stranding the
project, and transfer ownership to an accepted member. Invitees can safely
accept/reject/replay invitations; authenticated users can discover bounded open
projects and explicitly join as Researchers before seeing project content.
Project Settings exposes these commands and a sanitized governance history.
The worklist's automatic local/paid-hosted gates and existing activity inbox
remain authoritative and are proven against the final member lifecycle.

## Authority and persisted boundaries

- The cloud catalog owns invitations, membership transitions, project
  conversion/visibility, ownership transfer, and append-only governance events.
- Stable user/project IDs remain authoritative; handle/display snapshots are
  audit presentation only. Invitation resolution never grants access before
  acceptance.
- Existing project-video processing policy, hosted approval, review/triage
  events, and per-user activity receipts remain the PUNCH-004 authorities; this
  slice composes them with member lifecycle rather than creating replacements.
- No local schema is needed. SQLite remains a bounded authorized cache and
  purges project scope after revoked authority.

## Failure, replay, concurrency, and authorization

- Every command is idempotent; divergent key reuse and stale versions conflict.
- Invitations expire, reject, or revoke without membership. Acceptance creates
  one membership transactionally and binds to the invited stable user ID.
- Discovery returns only bounded project summary fields. Content remains denied
  until explicit self-join commits Researcher membership.
- Only the Owner manages Administrators, converts a personal project, or
  transfers ownership. Administrators manage Researchers only. The final Owner
  cannot leave or be removed; transfer changes both roles atomically.
- Removed members receive no further project notices and lose reads immediately.
  Existing immutable project evidence remains intact.

## Non-goals

- Email invitations, anonymous/public content, external directories, OS
  notifications, deployment, live providers/media, paid-provider execution, or
  PUNCH-009 expansion.
- Reverting shared projects to personal or hard-deleting project evidence.

## Acceptance criteria

1. Invite accept/reject/revoke and exact replay are transactional and stale-safe.
2. Open discovery leaks no project content; explicit join grants Researcher.
3. Personal conversion is one-way, Owner-only, optimistic, and audited.
4. Owner-only Administrator management/transfer and Administrator Researcher
   management preserve exactly one Owner.
5. Project Settings exposes only role-valid commands and sanitized audit rows.
6. Removed/reassigned users obey current authorization across worklist,
   comments, activity, processing policy, and hosted approval.
7. Migration, contracts, catalog/API/browser, typecheck, build, formatting, and
   deterministic aggregate checks pass.

## Narrow tests first

1. Contracts and populated cloud migration.
2. Catalog invitation/discovery/conversion/role/transfer concurrency matrix.
3. Cloud routes, Project Settings browser flow, and cross-authority regressions.

## Completion record

### Decisions and delivered behavior

- Governance commands are cloud-catalog authority and retain actor-scoped
  idempotency receipts in the same transaction as the mutation. Exact replay is
  safe; divergent reuse and stale versions conflict.
- Invitation acceptance creates membership transactionally. Reject, revoke,
  expiration, and a conflicting existing membership grant no access.
- Open discovery returns only bounded summary fields. Explicit join creates a
  Researcher before any project content read succeeds.
- Every project/member mutation locks and rechecks the current actor role.
  Ownership transfer increments the project governance version, changes both
  roles atomically, rejects self/nonmember successors, and leaves exactly one
  Owner under concurrent requests.
- The governance endpoint consistently returns the current project summary;
  member removal no longer fabricates a synthetic removed-member record.
- Project Settings exposes conversion, visibility, invitation/revocation,
  member role/removal, ownership transfer, and body-free governance history.
  The separate access panel remains usable for accounts with no current project.
- Existing explicit current-Administrator approval remains the supported paid
  hosted gate. Monetary project budgets and idle/overnight OS scheduling remain
  optional later policy modes, not hidden pilot requirements.

### Principal files

- `packages/contracts/src/index.ts`
- `packages/catalog/src/index.ts`
- `packages/db-cloud/migrations/0040_project_governance_lifecycle.sql`
- `apps/cloud-api/src/app.ts`
- `apps/web/src/project-governance.tsx`
- `apps/web/src/batch-workspace.tsx`
- `packages/contracts/src/index.test.ts`
- `packages/catalog/src/index.test.ts`
- `packages/db-cloud/src/index.test.ts`
- `apps/cloud-api/src/app.test.ts`
- `tests/e2e/workspace.spec.ts`
- `PROJECT_GUIDE.md`, `outline.md`, and `specs/future/PILOT-punch-list.md`

### Verification evidence

- `npm run typecheck` — passed.
- Focused catalog governance lifecycle — 3 passed, 60 skipped.
- Focused cloud governance route — 1 passed, 26 skipped.
- Contracts plus cloud migration suites — 79 passed, 2 optional skipped.
- Focused Project Settings browser flow — 1 passed.
- Aggregate network-free Vitest — 58 files passed, 1 optional file skipped;
  644 tests passed, 4 skipped.
- Full Playwright with one deterministic worker — 18 passed. The first
  eight-worker run had two 30-second contention timeouts; both failing flows
  passed together with one worker before the full one-worker rerun passed.
- Local migration CLI — 33 newly applied.
- Cloud migration CLI — 40 newly applied.
- Desktop production build — passed; only the existing Vite chunk-size warning
  remained.
- Real 30-second foreign-language FFmpeg fixture — passed with clip-relative
  language-policy artifacts.
- Fresh Electron Forge x64 package — passed. The unsigned local app at
  `/Users/matthewbelinkie/Library/Application Support/Codex/Youtube Clip Converter/out/Research Video Clips-darwin-x64/Research Video Clips.app`
  launched from the app bundle, remained running with its sandboxed renderer,
  created/reopened its durable SQLite store, and passed `PRAGMA quick_check`.
  Its Mach-O executable is x86_64 and its packaged web bundle contains the new
  governance/access controls.
- Scoped Prettier and `git diff --check` — passed (SQL excluded from Prettier's
  unsupported parser set and validated by the migration CLI).

### Remaining risks and external follow-ups

- Live provider/media, production Cognito/AWS deployment, signing/notarization,
  and publication remain explicitly unauthorized external gates; no evidence
  was fabricated.
- PUNCH-009 remains a separate proposed M8 expansion. Its completed
  platform-neutral YouTube-search foundation does not imply shipped social or
  AI acquisition.
- No commit was created in this bounded run; the completion record therefore
  has no new commit ID.
