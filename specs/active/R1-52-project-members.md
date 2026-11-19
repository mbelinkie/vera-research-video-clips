# R1 #52 — Share a project with existing members

An Owner can grant a registered person Editor or Viewer access from the selected
project, change roles, revoke access and deliberately transfer ownership. An
Editor can log a clip that the Owner sees after refreshing. Viewer access is
read-only. Legacy Researchers retain their existing permissions and role.

The first slice connects verified Cognito sign-in, registered user and the
catalog's locked membership grant. The second connects the browser panel and
verifies permission changes from independent signed-in sessions. Reuse #49's
transaction and membership versions and #51's verified JWT and cookie/CSRF flow.
Migration 0057 follows stills 0055 and avoids audio's 0056.

Exact-email grant resolves only registered accounts with a recent verified
address. Unavailable and ambiguous addresses receive the same response, and
attempts are limited per Owner across projects. Account identity remains the
provider subject. Fresh login updates the association. Ignore addresses from
profile inputs and handle a newer missing or unverified claim by clearing the
association. Preserve the JSON array shape of the Owner-only list and expose
only the caller's own membership to other roles.

On stale writes, refresh and require a new action. Require explicit confirmation
for revocation and transfer. Protect the last Owner on the server. Keep
project/session changes from displaying a stale roster or writing to the wrong
project. Use real browser contexts with synthetic identities on local TLS.
Public signup, account creation, cloud changes, deployment, email delivery and
live collaboration are outside scope.

Start with provider, migration, catalog and API tests, then build the web app
and run the browser-auth suite. Verify keyboard/error/empty states, Editor clip
durability, Viewer/nonmember denials, stale updates, transfer, revocation and
legacy behavior. Finish with independent permission review, npm run check and
the protected Test check.
