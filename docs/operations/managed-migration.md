# Moving the Research pilot off the MacBook (future, not approved)

The #53 pilot runs on the Producer's MacBook. When usage grows beyond "a few
friends, whenever the laptop is awake", move the API and database to managed
services. **Nothing here is approved or started**; it needs a separate issue,
cost estimate and Producer approval.

## What must not change

- **Identity:** users stay Cognito users. `users.external_subject` stays the
  verified Cognito subject (`cognito:<issuer>#<sub>`), so moving does not
  create new accounts. Keep the same user pool, or plan an explicit
  subject-mapping migration.
- **Projects and permissions:** project, membership, role and last-Owner
  rules (#49/#52) live in the catalog schema and move with the database
  unchanged. No permission is re-derived during the move.
- **Transcripts:** immutable, checksummed versions. A local object version ID
  is **not** an S3 version ID. The move must copy each referenced version,
  record the new version ID and rewrite catalog references in one verified
  migration, as the #50 synthetic import does.

## Likely target (low cost)

| Today (Mac)                           | Later (managed)                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PostgreSQL 18 in Postgres.app         | Amazon RDS for PostgreSQL (same major) or Aurora Serverless v2                                              |
| Local transcript folder               | Private, versioned S3 bucket (the existing `OBJECT_STORE_MODE=s3` path)                                     |
| API under launchd + Cloudflare Tunnel | Small container (ECS/Fargate or App Runner) behind Cloudflare, keeping Access if it should stay invite-only |
| Encrypted iCloud backups              | RDS automated backups + S3 versioning/replication                                                           |

## Outline

1. Freeze: `npm run pilot -- disconnect`, take a final `backup` and `drill`.
2. Restore the PostgreSQL dump into the new managed database with
   `pg_restore --no-owner`, then verify table counts and digests as the drill
   does.
3. Copy every referenced transcript object version to S3, recording new
   version IDs; rewrite references in one transaction; verify every hash.
4. Deploy the API with `NODE_ENV=production`, browser auth and the same
   Cognito client (add the new callback URL first if the hostname changes).
5. Point the Cloudflare hostname at the new origin; keep the Mac pilot
   stopped but intact as the rollback for at least two weeks.
