# R1-49 — Safe project membership and last-Owner invariant

- Status: active; draft implementation, not accepted
- GitHub: https://github.com/mbelinkie/vera-research-video-clips/issues/49
- Parent: #48; owned boundary: catalog/API permissions, not browser membership UI
- Producer authorized a bounded attempt on the `chat/issue-49-membership-safety` branch; not merge, deployment or other R1 slices.

## User-visible outcome

A Project Owner may safely grant an existing registered user access, list members, change Editor/Viewer roles, revoke a member or explicitly transfer ownership. It is impossible to demote/revoke the last Owner, including through the existing POST grant/upsert API. Stale writes fail rather than clobbering current roles; revocation takes effect on the next authorized request.

## Verified source evidence

- `packages/catalog/src/index.ts` currently uses a role-changing `ON CONFLICT DO UPDATE` when granting an existing member, without guarding the last Owner.
- `project_members` records a positive version; `packages/auth` holds the role permission matrix.
- `apps/cloud-api/src/app.ts` currently exposes only POST grant.
- The current catalog is typed to PGlite. **#50** separately introduces the native local PostgreSQL adapter; passing PGlite tests is not proof of PostgreSQL race safety.

## In scope

- Narrow, project-scoped transactions for member writes: lock the project row before checking current Owner authorization, version and target role; commit the write inside that transaction.
- Existing POST grant becomes **create-only or idempotent for the same role**; a different role requires the new explicit, version-checked update operation. Never allow the legacy upsert to demote an Owner.
- Add owner-only member list, version-checked role update, version-checked revoke and version-checked ownership transfer for an **already registered project member**. Successful transfer makes the target Owner and the acting Owner an Editor in one commit.
- Preserve legacy `researcher` membership/authorization. Do not expose new public signup.
- Keep security/non-enumeration behavior, server-derived actor authority and coherent 403/404/409 failures.
- Focused catalog/API tests, including stale versions, post-revocation access and last-Owner invariant.

## Non-goals

- React membership panel (#52), Cognito browser login (#51), PostgreSQL adapter (#50), Cloudflare tunnel/deployment (#53), billing, queue changes or merging.
- Full cross-process PostgreSQL concurrency acceptance is **deferred as a verifiable integration gate**, not assumed from embedded-database tests.

## Failure states and acceptance

- Sole Owner demotion/revoke: conflict, no write.
- Grant existing member with different role: conflict; require explicit versioned change.
- Wrong expected version: conflict; unchanged data.
- Missing member: not found for authorized Owner only.
- Non-Owner/nonmember: access denied before exposing member information.
- Concurrent writes: serialized via a project row lock in actual PostgreSQL using a connection-affine transaction; **must be tested after #50**.
- Tests of membership visibility, legacy researcher compatibility and revocation across existing authenticated sessions.

## Verification record

Not yet executed at draft creation. Code changes and actual tests must be listed in PR before acceptance. No untested success claim.
