# M7-01 — Production cloud and Cognito authentication

- Status: locally implemented; external production acceptance blocked
- Milestone: M7 local desktop completion and personal validation
- Dependencies: Milestones 1–6 and the DOC-02 M7/M8 roadmap split are complete

## User-visible outcome

The production shared service has one real HTTPS, Cognito-authenticated AWS
boundary. An authorized user can complete the protocol-level Cognito managed
login flow, reach only projects permitted by the existing role model, reuse or
publish immutable transcript objects through the established catalog, and opt
in to server-side Amazon Translate without installing AWS credentials locally.
PGlite remains available only for deterministic tests and development.

The native browser launch, custom-scheme delivery into Electron, Keychain-backed
refresh-token persistence, and token-free renderer proxy are composed and
packaged in M7-02. This slice supplies their single tested Cognito PKCE/token
protocol and the production API verifier; it does not claim the Finder-launched
desktop sign-in gate before that shell exists.

## Smallest end-to-end proof

1. Apply all cloud migrations to clean and populated real PostgreSQL using a
   connection-affine transaction adapter, while the existing PGlite migration
   gate remains green.
2. Start the production API configuration against PostgreSQL/S3 with a Cognito
   access-token verifier. Reject unsigned, expired, wrong-issuer,
   wrong-client/token-use, and development bearer credentials in production.
3. Complete a deterministic PKCE authorization-code exchange/callback,
   refresh/replacement, revoke, and managed-login logout protocol test with no
   client secret and exact state/verifier/callback validation.
4. Prove a valid Cognito subject maps to one registered actor and the existing
   project membership checks still deny a nonmember.
5. Submit one explicit, project-scoped Translate consent request. The API—not a
   local worker—loads the exact authorized source evidence, calls the bounded
   provider, and returns/publishes only server-produced output. No AWS
   credential or token appears in the client contract or result.
6. Validate a production CloudFormation change set containing ECS Fargate,
   private RDS PostgreSQL, private versioned S3, SQS/DLQs, Cognito, ALB HTTPS,
   Secrets Manager, backups, alarms, logs, and least-privilege execution/task
   roles. Execute the real-cloud acceptance path only after the exact account,
   region, DNS/certificate, image, database, alert, cost/retention, rollback,
   and deployment authority are confirmed.

## Affected authority boundaries

- `packages/db-cloud` and `packages/catalog`: generic database contract,
  connection-affine PostgreSQL transactions, migrations, and compatibility.
- `packages/auth` and `apps/cloud-api`: Cognito JWT verification, stable actor
  mapping, development-only fallback, PKCE/token protocol, and route errors.
- `packages/contracts`, `packages/catalog`, `apps/cloud-api`, and translation
  provider code: explicit consent, project authorization, exact immutable
  source identity, server-side translation, and idempotent publication.
- `packages/config`, deployment/container entrypoints, and `infra/aws`: fail-
  closed production configuration, service roles, storage/queue/database/
  identity/network/TLS resources, backups, alarms, and outputs.
- Existing S3 object and database job authority remains unchanged. Queue
  delivery remains at-least-once and subordinate to database leases and
  idempotency.

## Required implementation

1. Replace PGlite-specific production types with a narrow shared cloud-database
   interface. Add a `pg` production adapter whose transactions pin one client;
   never implement transactions with unrelated `Pool.query` calls.
2. Keep deterministic PGlite construction and migration tests. Add opt-in real
   PostgreSQL clean/populated migration and catalog acceptance coverage.
3. Add validated production configuration for database, Cognito issuer/user
   pool/client, public API origin, object store, queue, and Translate. Production
   must not silently fall back to PGlite, memory storage, development auth, or
   local AWS credentials.
4. Verify Cognito access tokens using current issuer/JWKS, app client, expiry,
   signature, and `token_use=access` rules. Derive one stable external subject
   and UUID actor identity without accepting client-supplied identity fields.
5. Implement one public-client Cognito OAuth protocol module: high-entropy
   state/verifier, S256 challenge, exact registered callback, five-minute code
   lifetime handling, form-encoded exchange/refresh/revoke, rotation-aware
   refresh replacement, and registered logout URL. It exposes no storage or
   renderer API.
6. Move Amazon Translate invocation behind an authenticated project route and
   ECS task role. Require an explicit closed consent value, validate the exact
   project/video/base transcript identity, keep provider chunking under 10,000
   bytes, and sanitize errors without source text or credentials. Remove direct
   AWS Translate construction from local-worker production composition.
7. Extend the CloudFormation template and deployment tooling without embedding
   account IDs, domains, certificate ARNs, image URIs, passwords, or secrets.
   Produce an inspectable change set before any production mutation.
8. Record material current-primary-source findings under `docs/research/` and
   retain exact commands/results, migration counts, CloudFormation validation,
   change-set/acceptance evidence, rollback behavior, and residual risks.

## Failure states

- PostgreSQL is absent, unreachable, TLS-invalid, or migrations fail: the
  production API stays unhealthy and does not fall back to PGlite or partial
  schema state.
- Cognito token signature, issuer, client, expiry, subject, or token use is
  invalid: return a nonenumerating 401 and perform no catalog/object/provider
  operation.
- OAuth callback state, callback URI, verifier, code, or token response is
  invalid: discard the attempt; never reuse it or retain partial tokens.
- Refresh or revoke fails: report bounded authentication failure. Sign-out
  clears local session state even when remote revocation is unavailable; actual
  protected persistence is completed in M7-02.
- A valid user is unregistered or not a project member: preserve existing 401/
  403 behavior and do not reveal project/object/translation existence.
- Translate consent is absent, source identity is stale/mismatched, project
  access is insufficient, provider is unavailable, or output is incomplete:
  invoke no unauthorized provider work and publish no derivative.
- A queue delivery repeats or a worker lease expires: database idempotency and
  lease ownership remain authoritative; no duplicate canonical result wins.
- CloudFormation parameters, credentials, certificate/domain ownership, cost/
  retention choices, or deployment authority are missing: stop after local
  validation and exact change-set preparation rather than guessing or leaving a
  partial stack.

## Explicit non-goals

- `apps/desktop`, Electron packaging, `safeStorage`, custom-scheme OS routing,
  loopback-session injection, service supervision, Finder/Dock launch, first-
  run UI, tool/model installation, transcript hydration UI, automatic local
  export supervision, or personal dogfood. Those are M7-02 through M7-06.
- Signing, notarization, Universal/Windows builds, installers, updates, public
  releases/docs, support bundles, issue delivery, tester provisioning, or
  independent QA. Those are M8.
- Hosted media processing, cloud clip storage, or new research features.
- Inventing or committing production credentials, identifiers, domains,
  certificates, image URIs, callback alternatives, model assets, or secrets.

## Acceptance criteria

1. The production API uses real PostgreSQL through connection-affine
   transactions; clean and populated migrations pass on PGlite and PostgreSQL.
2. Production startup requires PostgreSQL, Cognito access-token auth, S3, and
   explicit production configuration, with no development fallback.
3. Cognito JWT verification and PKCE/token lifecycle tests cover signature,
   issuer, client, token use, expiry, state, verifier, callback, refresh,
   revocation, logout, replay, and sanitized failures.
4. Existing project membership tests remain green and a controlled Cognito
   actor can access only its registered projects.
5. Amazon Translate is reachable only through the authenticated,
   project-authorized, explicit-consent API and ECS task role; local desktop/
   worker configuration carries no AWS Translate credentials.
6. CloudFormation and policy tests prove private database/tasks, HTTPS-only
   ingress, exact security-group edges, private/versioned object storage,
   encrypted queue/DLQ with alarms, managed secrets, positive backups, logs,
   and least-privilege roles.
7. A reviewed production change set and controlled real-cloud acceptance prove
   authorization, migration, secret isolation, object/job/Translate behavior,
   backups/alarms, and rollback/recovery before this spec closes.
8. Focused tests, formatting, typecheck, real/fixture migration validation,
   cloud/container builds, `git diff --check`, and `npm run check` pass; an
   independent Terra review has no unresolved P0/P1 finding.

## Narrow tests first

- `packages/db-cloud` adapter/migration tests, including opt-in PostgreSQL.
- `packages/auth` Cognito verifier and PKCE/token protocol tests.
- `apps/cloud-api` Cognito actor, membership, and translation-consent tests.
- `packages/providers` bounded Amazon Translate tests.
- `packages/config` production fail-closed tests.
- `tests/infra/cloudformation.test.ts` and deployment/change-set script tests.

## Current primary sources

- AWS Cognito app-client, authorization, token, revocation, and logout endpoint
  documentation; RFC 8252 for native public clients and external browsers.
- AWS ECS Fargate networking/service load balancing and ALB HTTPS listeners.
- AWS RDS VPC, encryption, TLS, managed-secret, and automated-backup guidance.
- AWS S3 versioning/public-access/encryption, SQS visibility/DLQ/security, ECS
  task-role, and Amazon Translate IAM/API guidance.

## Local implementation evidence — 2026-08-23

- Production configuration fails closed around PostgreSQL, Cognito access-token
  verification, private S3, SQS service delivery, and task-role Translate. The
  development PGlite and bearer paths remain explicit test/development modes.
- Cloud migrations now total 22. The PostgreSQL adapter pins one checked-out
  client per transaction and serializes concurrent migrations with a
  transaction-scoped advisory lock. PGlite remains the deterministic fixture.
- Cognito verifier and PKCE protocol tests cover issuer/client/token-use/expiry,
  exact callback/state/verifier handling, refresh rotation, revocation, logout,
  and replay. Native callback delivery and protected persistence remain M7-02.
- Translation consent is explicit and durable. The cloud service verifies the
  exact immutable source object and publishes/binds the normalized English and
  SRT objects itself; finalization rejects altered objects or metadata.
- SQS receive/delete is service-side. Authenticated user workers claim only
  database jobs with a durable delivery marker, so they cannot consume another
  project's queue receipt. Stale dispatch markers reopen for safe redelivery.
- Three independent Terra re-reviews found no unresolved P0/P1 in the revised
  authentication, translation, queue, database, or infrastructure boundaries.
- Typecheck, the web build, 22-migration PGlite validation, focused production
  suites, deployment-script syntax, and `git diff --check` passed. Opt-in real
  PostgreSQL tests remain skipped without `CLOUD_DATABASE_TEST_URL`.

## External closure gate

This slice is not complete and was not moved to `specs/completed/`. The user
directed work to continue with M7-02 while these production inputs remain
unavailable:

- approved AWS account/region and deployment authority;
- concrete VPC/subnet/DNS/ACM/domain/Cognito/image/alarm/cost/retention values;
- a bootstrapped least-privilege PostgreSQL runtime role and rotated secret;
- an immutable container image and verified private-subnet egress/endpoints;
- a reviewed CloudFormation change set and controlled real-cloud acceptance;
- a real PostgreSQL clean/populated/concurrent migration run.

No AWS mutation was attempted and no production identifier or secret was
invented. React/renderer token removal, Keychain persistence, native callback
routing, and Finder-launched sign-in are owned by M7-02.
