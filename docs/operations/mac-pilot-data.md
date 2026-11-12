# VERA Research #50: local Mac pilot catalog and transcript data

**Status:** implementation groundwork / disposable proof path, **not** production
readiness, permission to install PostgreSQL, migrate Producer data, or expose
friends to the dev-bearer API. #49 membership safety, #51 authentication and
#53 Mac supervision, tunnel, and off-device encrypted scheduling remain separate.

## Local-only pilot configuration

The `development` mode still creates a persistent filesystem PGlite catalog and
an in-memory transcript store; it is not suitable for use by friends. To select
the PostgreSQL pilot deliberately, the operator must privately provide all of:

```
VERA_RUNTIME_MODE=mac-pilot
DATABASE_MODE=postgres
OBJECT_STORE_MODE=local
CLOUD_API_HOST=127.0.0.1
PILOT_PG_URL=postgresql://<user>:<secret>@127.0.0.1:5432/<pilot_database>
PILOT_OBJECT_ROOT=/absolute/private/encrypted/vera-transcripts
LOCAL_UPLOAD_SIGNING_SECRET=<high-entropy-value-at-least-32-bytes>
```

Never commit credentials or use the demo placeholder strings. The startup
validator rejects omitted PostgreSQL credentials, any non-loopback PostgreSQL
server/API listener, memory/S3 fallback, absent signing secret, relative object
root, and hosted queue mode. PostgreSQL must already be installed, started,
access-controlled, and configured for loopback-only TCP (`listen_addresses` and
`pg_hba.conf`); **this task does not change those settings**. Allocate a
persistent private local volume with POSIX mode `0700`, non-symlink directory,
and verify encryption on the Producer's Mac (for example, FileVault). The
PostgreSQL role needs schema migration permissions on first start and limited
catalog data permissions thereafter. A separate migration role remains a
recommended hardening follow-up; avoid running with PostgreSQL superuser or
trust authentication. Secrets are environment-injected and never printed by
the app. Run the pilot API on loopback only.

The API's `authenticateDevBearer` path is deliberately unchanged: it is **not a
friend-facing identity system**. Keep all external access disabled until the
#51 authentication and #53 network/security work has been delivered and
separately approved. No Cloudflare, hosted workers, RDS, S3 bucket, or service
installation is performed here.

## Transcript publication

The catalog issues 15-minute URL capabilities only after authorized grant
creation. PUT and pinned-version GET routes accept a signed method/key/version
scope, enforce expiry and body limits and never accept raw filesystem paths.
A PUT stores SHA-256 verified bytes under a randomly generated immutable
version and returns `x-amz-version-id`; later finalization checks the exact
version, size, hash, manifest, actor and job as before. GET verifies the pinned
object again. Current-head deletion creates a tombstone without deleting pinned
historical versions. A crash before metadata or head publication does not
expose a verified partial version; orphan temporary files are deliberately not
automatically reclaimed. Only separately reviewed retention/cleanup may reclaim
versions referenced by any committed catalog record.

## Local consistent backup: explicit write-quiescence

Requires installed matching-major-version PostgreSQL `pg_dump` and `pg_restore`
binaries, sufficient disk space, validated encrypted destination, and the
operator's explicit maintenance window. No scheduled or off-device backup is
provided here; #53 owns those. Make no backup while editing/migrating data.

1. Verify the Mac pilot API and worker are the only writers. The API enforces a
   `.vera-backup-writes-blocked` directory barrier at every mutation, including
   local object PUT, and exposes loopback read-only `GET /__maintenance/status`
   with in-flight write count. The backup script creates the barrier, observes
   all admitted writes drain, and keeps it until the backup is published.
2. Supply private `PILOT_PG_URL`, `PILOT_OBJECT_ROOT` and optionally
   `PILOT_CLOUD_API_ORIGIN=http://127.0.0.1:43111`, then run:

   ```sh
   node --import tsx scripts/pilot-data.ts backup /absolute/new-private-backup
   ```

   If both the API and worker are fully stopped, use `backup DEST --offline`;
   the script additionally requires zero other PostgreSQL database connections.
   This is _not_ an alternative while other writers remain running.

3. The script captures a PostgreSQL custom-format dump, schema versions and
   table counts; verifies every exact key/version/size/SHA from
   `transcript_artifacts`, cross-checks manifest references, and stores pinned
   immutable object versions plus their current visible heads. It hashes the
   SQL dump and writes a checksummed completion manifest last. The staging
   directory is atomically published to a previously nonexistent destination.
   A failed backup cannot claim completion, and the write gate is released.
   Inspect the result/permissions and copy it off-device only through a future
   approved encrypted backup procedure (#53).

**Safety:** the database and filesystem have no shared transaction. This
protocol only aligns them if **all** writes pass through the pilot API (or all
writers are stopped); direct SQL/file edits outside that gate invalidate the
consistency guarantee. The script does not verify FileVault status. No backup
with unresolved writes or corrupt/missing objects is valid.

## Fresh isolated restore drill

Prepare a separate, **empty** local PostgreSQL database whose name starts
`vera50_test_`, with a non-superuser role and no existing tables. Supply its
URL in `VERA50_TEST_PG_URL`, then:

```sh
node --import tsx scripts/pilot-data.ts restore /absolute/verified-backup /absolute/new-empty-object-root
```

A restore refuses any existing object root, nonempty schema or non-test target.
Before `pg_restore`, it checks the completed-manifest checksum, PostgreSQL dump
checksum, every object file, and every catalog reference. It imports exact
immutable IDs into an isolated staging root, verifies restored schema versions,
table counts, reference inventories and object hashes, and only then renames
the object root into place. It never uses `pg_restore --clean` on real data.
A failed SQL restore may leave **only the disposable test database** partially
populated; discard it and prepare a new one before retrying. The original
source backup and source catalog are untouched.

## Existing PGlite data: synthetic proof and approval boundary

Existing `DATA_DIR/cloud-catalog` is on-disk PGlite and may be populated. Do not
wipe, read, copy, or cut over the Producer's actual data by running this tool.
To rehearse a non-destructive import, create a separate synthetic PGlite folder
named `vera50_synthetic_*` and synthetic local object root; create a new empty
`vera50_test_*` PostgreSQL database and a new target object path:

```sh
VERA50_TEST_PG_URL=postgresql://<test-user>:<secret>@127.0.0.1:5432/vera50_test_import \
  node --import tsx scripts/pilot-import-synthetic.ts \
  /absolute/vera50_synthetic_source /absolute/synthetic-objects \
  /absolute/new-imported-objects /absolute/new-evidence-directory
```

The rehearsal retains a source-directory backup, verifies matching migration
versions, imports rows in dependency order in one PostgreSQL transaction,
checks identities/fields/counts and exact referenced object versions, restores
`sync_events` sequence and emits an inventory report. Missing linked versions,
schema drift, or a populated target fail closed. This does not authorize an
actual Mac PGlite inventory, conversion, schema upgrade or switch. A real
migration requires separate Producer approval and retained source/rollback
backup with independently observed counts, IDs, permissions and versions.

## Future hosted move

A later explicitly approved migration could restore the native PostgreSQL dump
into a new hosted PostgreSQL instance and move immutable blobs to a private
versioned object service with a new issuer. Object version identities and access
patterns would need verified remapping; do not assume that a local version ID
is an S3 version ID, and do not switch automatically. No uptime guarantee,
managed-service spend, external exposure or cloud migration is included here.

## Test evidence still required for #50 acceptance

`npm run check` verifies static, unit and embedded PGlite compatibility. Real
PostgreSQL concurrent migration/transaction/restart tests require an explicit
`VERA50_TEST_PG_URL` and `VERA50_TEST_PG_ALLOW_SCHEMA_CREATE=1` for a fresh
empty isolated `vera50_test_*` database; the test never installs PostgreSQL.
A meaningful pilot acceptance also needs real HTTP PUT/finalize/pinned GET,
corruption/crash and DB restart on Mac, a live disposable `pg_dump`/restore
round trip, security review of private volume/credentials, and separate approval
before any non-synthetic data work. Do not infer those from fake or PGlite tests.
