# AWS-DEV-01 low-cost development boundary

Date: 2026-08-25

## Decision

Use a separate CloudFormation stack for the first real personal Cognito and
Finder-launched desktop dogfood. It contains an admin-invite-only Cognito public
PKCE client and one encrypted `t4g.micro` API instance with IMDSv2 and automatic
HTTPS. The API uses disk-backed PGlite plus the existing explicit development
memory object-store and queue adapters.

Do not modify, shrink, or relabel the reviewed production template. Production
still requires private PostgreSQL, durable private S3, SQS, least-privilege
roles, managed TLS/DNS, backups, alarms, and controlled rollback evidence.

## Rationale

The production-shaped stack has a materially higher always-on cost and requires
domain/certificate, network-egress, container-image, IAM-role, and database-role
bootstrap decisions that were not approved. The separate stack gives the
desktop real public Cognito/API identifiers and allows managed-login dogfood at
an approximate $11/month infrastructure floor without pretending that memory
transcript storage is a shared authority.

## Consequences

- Real Cognito PKCE, native callback, refresh/revoke, API JWT verification, and
  personal project UI paths can be tested now.
- PGlite catalog data survives an ordinary process or instance restart on the
  same root volume.
- Transcript objects and queue messages are lost when the API process restarts;
  replacing/deleting the instance also loses the PGlite catalog.
- SMS/MFA and server-side Translate are disabled in this development pool.
- The stack must not be cited as M7-01 production, durable shared-transcript, or
  multi-workstation acceptance evidence.
