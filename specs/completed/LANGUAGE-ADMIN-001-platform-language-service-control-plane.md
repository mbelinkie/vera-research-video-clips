# LANGUAGE-ADMIN-001 — Platform language-service control plane

- Status: completed
- Date authorized: 2026-08-26
- Date completed: 2026-08-27

## User-visible outcome

A member of the verified `vera-platform-admins` Cognito group can manage the
registered cloud language-service providers and the server-managed Argos model
catalog through authenticated, provider-neutral APIs. Ordinary authenticated
users can inspect enabled providers and their own provider-specific access, but
cannot mutate platform configuration.

## Affected boundaries

- `packages/auth`: derive the narrow platform capability only from a verified
  Cognito access-token group claim and enforce it independently of project role.
- `packages/catalog`: durable provider, access, operation, local-model source,
  candidate, version, availability, release, and audit commands.
- `apps/cloud-api`: public/account/admin routes using shared schemas and stable
  idempotency plus optimistic versions.
- `apps/cloud-api/src/main.ts`: compose the control plane without exposing
  credentials or mutable upstream pack links to clients.

## Explicit non-goals

- Desktop model download/activation, Argos execution, Amazon Transcribe media
  staging, background scheduling, or the account/admin React screens.
- Enabling a provider, approving a user, or publishing a pack automatically.
- Returning protected credential values, AWS SDK objects, raw provider errors,
  or unsigned mutable upstream index entries through an API.

## Failure states

- Project ownership or administrator membership grants platform authority.
- An unverified request header or body can manufacture platform capability.
- Consent or approval for one provider authorizes a different provider.
- A disabled/suspended provider receives a new grant or starts new work.
- A hard-unsafe pack can be enabled, including through administrator override.
- Retried mutations duplicate requests, grants, operations, usage, or releases.

## Acceptance criteria

1. Only the exact verified Cognito group derives `manage_language_services`;
   absent/malformed group claims fail closed and existing sessions remain valid.
2. Provider list/configuration/state, provider-specific access/request/decision,
   launch grants, usage, operation state, and cleanup evidence are durable and
   preserve immutable provider snapshots.
3. Argos feed refresh creates immutable snapshots/candidates; evaluation and
   availability changes publish signed catalog releases from mirrored exact-byte
   identities, with audited advisory overrides and non-overridable safety gates.
4. Routes match the provider-neutral endpoints in the authorized plan and reject
   stale optimistic versions or reused idempotency keys with different payloads.
5. Migrations seed no access, approvals, providers, packs, or fabricated history.

## Narrow verification first

- `npm exec vitest run packages/auth/src/index.test.ts`
- `npm exec vitest run packages/catalog/src/language-services.test.ts`
- `npm exec vitest run apps/cloud-api/src/language-services.test.ts`
- `npm run typecheck`
- `git diff --check`

## Completion record — 2026-08-27

### Decisions and files changed

- Added opaque provider descriptors, server-side adapter factories, provider
  state/configuration, capabilities, pricing, disclosures, provider-specific
  access requests, launch grants, account preferences, operation recovery,
  cleanup evidence, and usage metering. Amazon is registered as an initial
  adapter and does not appear in shared execution-policy enums.
- Added exact `vera-platform-admins` capability derivation and authenticated
  account/admin APIs with optimistic versions and idempotency keys. Protected
  credential values remain server-side and launch secrets remain outside React,
  persisted job payloads, SQLite, and logs.
- Added immutable Argos feed snapshots, durable evaluation jobs, hard-safety vs
  advisory findings, audited override enablement, mirrored artifact identity,
  active-version rules, disable/revoke behavior, signed releases, rollback, and
  authenticated current-release-bound short-lived downloads.
- Added dynamic account/admin/batch UI surfaces that render arbitrary server
  descriptors and enabled pack records without vendor-specific branches.

### Checks and actual results

- Focused auth, control-plane, API, UI, registry, Amazon adapter, grant, usage,
  and catalog suites passed (52 tests in the combined control-plane run, plus
  the later four-test model-download API run).
- `npm run typecheck` passed.
- `npm run db:migrate:local:test` passed with 37 migrations.
- `npm run db:migrate:cloud:test` passed with 52 migrations.
- Aggregate Vitest assertions passed: the initial run exposed one legacy source
  boundary failure, which was corrected; the next run passed 773 assertions and
  five PGlite tests timed out only under deliberate parallel build contention.
  All timed-out files then passed serially: 19 migration tests (two skipped), 7
  language-service tests, 32 cloud-API tests, and 68 catalog tests.
- `npm run build:web` passed without pulling server-only Argos/SQLite modules
  into the browser bundle. `git diff --check` passed.

### Remaining risks and follow-ups

- No provider or pack is enabled automatically. Real AWS calls, upstream pack
  approval, signing-key provisioning, and real-pack quality/license decisions
  require separately authorized live validation.
- Provider configuration changes need no client rebuild; deploying a brand-new
  adapter still requires reviewed backend code deployment as designed.
- The repository-wide Prettier gate retains one pre-existing warning in
  `packages/sync/src/index.test.ts`, outside this feature diff.
- No commit was created in the shared worktree.
