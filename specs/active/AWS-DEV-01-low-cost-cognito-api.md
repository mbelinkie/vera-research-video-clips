# AWS-DEV-01 — Low-cost Cognito and development API

> Live status and routing: [GitHub issue #2](https://github.com/mbelinkie/vera-research-video-clips/issues/2). This file retains detailed design and evidence.

- Status: active
- Date authorized: 2026-08-24
- Environment: AWS account-selected development resources in `us-east-1`

## User-visible outcome

The packaged Intel macOS app has approved public Cognito and HTTPS API values.
An invited developer can use Cognito managed login with the native PKCE
callback, and the app can reach a real development cloud API health endpoint
without deploying the production Multi-AZ RDS/Fargate/ALB/NAT topology.

## Smallest end-to-end behavior

1. Deploy an admin-invite-only Cognito user pool, public native PKCE client, and
   hosted-login domain. Keep SMS/MFA disabled in this development-only pool so
   it needs no SMS role or messaging spend; the production MFA decision remains
   separate.
2. Run the existing Cognito-verifying cloud API on one encrypted, low-cost EC2
   development instance behind automatic HTTPS.
3. Keep its PGlite catalog on the instance volume and use the explicit
   development memory object-store/queue adapters.
4. Invite the approved developer email to Cognito.
5. Embed only the public API origin, Cognito domain, and Cognito client ID in
   the desktop package; never embed a client secret or AWS credential.
6. Verify stack outputs, HTTPS health, Cognito configuration, focused tests,
   and desktop packaging.

## Affected boundaries

- `infra/aws`: a separate low-cost development template that does not weaken or
  replace the production template.
- `scripts`: explicit review/deploy tooling for the development-only stack.
- `tests/infra`: assertions for public-client auth, encrypted compute, bounded
  ingress, IMDSv2, and the absence of production-cost resources.
- Desktop build configuration: existing public-value embedding only.

## Explicit non-goals

- Closing M7-01 production acceptance.
- RDS/PostgreSQL, ECS/Fargate, ALB, NAT gateways, VPC endpoints, Route 53, ACM,
  hosted workers, server-side Translate, or production alarms/backups.
- Claiming durable shared transcript publication: the development instance
  deliberately uses memory object storage and queue delivery, so transcript
  objects do not survive an API process restart.
- Changing existing project/catalog contracts or migrations.
- Committing account IDs, concrete domains, user emails, credentials, tokens,
  or secrets.

## Failure states

- The selected Cognito domain is unavailable: CloudFormation rolls back and no
  desktop values are built.
- Instance bootstrap or HTTPS certificate issuance fails: `/health` never
  passes; stop before packaging and inspect bounded console/system logs.
- Cognito invitation delivery fails: retain the pool and report the exact
  administrative state without exposing a temporary password.
- Any stack output is absent or the API is not HTTPS: do not build a partially
  configured desktop app.
- SSO PowerUser authorization expires: reauthenticate the non-root profile;
  never fall back to root credentials.

## Acceptance criteria

1. CloudFormation validation and focused infrastructure tests pass.
2. The deployed caller is the SSO `PowerUserAccess` role, not root.
3. The stack reaches `CREATE_COMPLETE` or `UPDATE_COMPLETE`, and `/health`
   returns the existing `cloud-api` health contract over trusted HTTPS.
4. Cognito client has no secret, uses authorization-code grant, registers only
   `research-video-clips://oauth/callback`, and supports revocation/logout.
5. The approved developer is invited without recording their temporary
   password in repository files or command output.
6. The rebuilt app contains all three public values together, passes focused
   auth/config tests and typecheck, and receives a new recorded ASAR hash.
7. Documentation states the approximate monthly floor and the development-only
   persistence limitations without claiming M7-01 production completion.

## Narrow verification first

- `vitest run tests/infra/cloudformation-low-cost-development.test.ts`
- `aws cloudformation validate-template`
- `aws cloudformation describe-change-set` before execution
- HTTPS `/health`
- focused desktop auth/runtime-config tests
- `npm run typecheck`
- `npm run desktop:package:x64` with all three public values

## Evidence retained — 2026-08-25

- The current Homebrew AWS CLI authenticated as the approved Identity Center
  `PowerUserAccess` role. The temporary root CLI login remained logged out.
- CloudFormation validation passed. The reviewed change set contained only the
  Cognito pool/client/domain, one security group, one Elastic IP/association,
  and one EC2 instance.
- The first pool create exposed Cognito's requirement for SMS configuration
  when MFA is optional. Development MFA was deliberately set to `OFF`; the
  separate production policy remains unchanged.
- The first instance bootstrap exposed AL2023's `curl-minimal`/`curl` package
  conflict. Bootstrap now retains the patched system `curl-minimal` client.
- The corrected stack reached `CREATE_COMPLETE`. Both EC2 status checks are
  `ok`; the instance is ARM `t4g.micro`, its 12 GiB gp3 volume is encrypted,
  IMDSv2 tokens are required, and ingress contains only TCP 80/443.
- HTTPS `/health` returned the existing `cloud-api` health contract. An
  unauthenticated `/api/session` returned sanitized 401, and Cognito's
  authorization endpoint redirected to managed login with the exact native
  callback.
- The approved email invitation was sent. The user is enabled in
  `FORCE_CHANGE_PASSWORD`; no temporary password was logged or stored in the
  repository.
- Focused auth/runtime/infra gate: 4 files and 20 tests passed. Typecheck,
  CloudFormation validation, shell syntax, formatting, and `git diff --check`
  passed.
- The configured x64 package completed. Its ASAR contains exactly the three
  public deployment values and has SHA-256
  `ff1e09a0669bfaed15b9c0749800c792137929dbb29a3be8f41f81ee03e73ead`.
- The packaged app was launched from its `.app` path. Manual Cognito password
  change, native callback, authenticated profile/project access, and dogfood
  remain the final interactive acceptance step.
