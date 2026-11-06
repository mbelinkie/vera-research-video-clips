# R1 #50 — Native PostgreSQL and local durable transcripts

## Outcome

Introduce an explicitly selected, loopback-only Mac pilot using real PostgreSQL
and verified, immutable local transcript objects; retain PGlite/memory for tests
and development. Back up both authorities without mismatched generations.

## Boundaries

- Catalog SQL and migrations: transaction-affine \`pg\` client; no ambient pool
  queries during a transaction, consistent migrator advisory lock.
- Object persistence: atomic version publish, verified pinned reads, durable
  current-head pointer, tombstone without deleting referenced versions.
- Local HTTP: narrowly signed temporary PUT/pinned GET grants. Future #51
  authentication and #53 supervision/tunnel/off-device backup are excluded.
- Operator backup: explicitly drained/stopped application writes, PostgreSQL
  snapshot and exact pinned object versions, verified isolated restore.

## Failure states

Invalid configuration, missing/incorrect PostgreSQL credentials, digest mismatch,
tampering, missing version, expired token, concurrent write, interrupted publish,
stale catalog write, incomplete backup and accidental nonempty restore destination
must fail closed. Never modify the Producer's existing data without separate approval.

## Verification

Focused SQL adapter, local store, migration, config and HTTP tests; independently
connected disposable PostgreSQL integration (if available); backup/restore
corruption tests; full \`npm run check\`. Evidence and unverified Mac operations
are recorded in the completion note and handoff.

## Linux pipeline resumption evidence (2026-11-05)

- `npm run format:check` and `npm run typecheck` passed during the full gate.
- Isolated `vitest run --maxWorkers=1 --testTimeout=30000` covering six
  storage, URL, database-adapter, config, HTTP and backup-preflight test files:
  **29 tests passed**. The original five local-store contract tests pass.
- Deliberately disabled HMAC signature comparison and separately disabled
  SHA-256 comparison; in both cases the relevant integrity/security tests
  failed as expected. Both mutations were reverted without retaining changes.
- `npm run build:web` passed; `npm run db:migrate:local:test` passed
  (four applied). A traced embedded PGlite migration run applied all seven
  migrations. The unmodified cloud CLI intermittently exits with Node 13
  (unsettled top-level await) in this Linux container.
- A full `npm run check` attempt was **not green**: heavy simultaneous Vitest
  activity timed out both a new HTTP test and an existing PGlite migration
  test. The HTTP test passed in the isolated 29-test run. The full attempt was
  stopped rather than treated as successful.
- **Not verified:** No `psql`, `postgres`, `pg_ctl`, `pg_dump` or `pg_restore`
  binaries or `VERA50_TEST_PG_URL` were available. Real PostgreSQL migrations,
  independent-client concurrency, restart, synthetic import, database+objects
  backup, fresh restore and macOS filesystem behavior require disposable Mac
  test resources and further review. Do not merge or deploy as production-ready
  on the strength of the Linux results alone.

## Pipeline resume verification (2026-11-06 UTC)

- Diagnosed a **real compatibility deadlock**: PGlite already exposes a native
  `transaction(callback)` method, whose callback receives a transaction handle.
  The new `SqlDatabase.transaction` feature detection mistakenly treated that
  method as the PG connection-affine callback, then executed queries against the
  original PGlite connection, which hung. Both cloud migrations and catalog
  operations were affected. Renamed the PG-only adapter capability to
  `withTransaction`, leaving the existing PGlite `BEGIN`/`COMMIT` route intact;
  added a PGlite method-shape regression assertion. A direct traced migration,
  registration, project creation, listing and close then completed normally.
- The default unrestricted Vitest worker count was also causing otherwise
  working PGlite-heavy tests to exceed their 15-second deadlines under this
  limited Linux runner. Bounded `maxWorkers` to two **without relaxing test
  timeouts or assertions**; the previously timing-out shared-transcript and
  cloud API tests now pass under the normal `npm run check` invocation.
- **`npm run check` passed (exit 0):** Prettier, TypeScript, 25 passing files
  with **119 passed tests and 3 skipped optional/live tests**, Vite web build,
  local embedded migrations (4 applied) and cloud embedded migrations (7
  applied). The prior embedded cloud CLI exit-13 symptom was caused by the
  PGlite transaction collision and no longer reproduces.
- This is **not complete #50 acceptance**: a disposable real PostgreSQL server,
  `pg_dump`/`pg_restore`, a fresh isolated restore, cross-connection tests and
  macOS durability/failure drills still were not available. In particular the
  `postgres.integration.test.ts` test is one of the three skipped tests; it
  cannot be claimed as real-PostgreSQL proof. No system services, real Mac data,
  cloud/network resources or credentials were changed.

## Later disposable PostgreSQL proof (2026-11-06 UTC)

PostgreSQL 16 client/server binaries became available later in this **Linux
container**. Built an isolated, temporary cluster under `/tmp/vera50pg.*`,
bound only to `127.0.0.1:55450` with SCRAM credentials and a non-superuser test
role. The preexisting default cluster remained stopped and untouched. All
databases had the `vera50_test_` prefix; only synthetic data was used.

- `npm run test -- packages/db-cloud/src/postgres.integration.test.ts
--maxWorkers=1 --reporter=verbose`: **1 passed**. Verified concurrent cold
  migrations, independent pool connections, rollback, stale expected version,
  row locking and `FOR UPDATE SKIP LOCKED` against actual PostgreSQL.
- Seeded an actual PostgreSQL catalog through the signed local HTTP PUT,
  transcript finalization and checksum-verified pinned GET path: **passed**;
  three immutable referenced objects, one committed transcript version.
- `node --import tsx scripts/pilot-data.ts backup ... --offline`: **passed**
  with 18 tables and 3 referenced object versions. Fresh restore into a
  separate empty `vera50_test_restore` DB and new object root: **passed**,
  exact object/version/hash and catalog-digest verification. A modified blob
  in a copied backup was rejected **before any restore-target change**;
  neither the original backup nor backup write gate was damaged.
- Rehearsed `scripts/pilot-import-synthetic.ts` using a freshly created,
  file-backed PGlite catalog: 1 user, 1 project, 1 video, 1 committed transcript
  and 3 referenced objects imported with matching identities/counts. Verified
  a **newer unpinned visible head** survives alongside its older committed
  pinned version; source and an independent rollback copy were retained.
- Stopped and restarted **only the disposable PostgreSQL test cluster** and
  reopened local object storage from a fresh Node process. Both catalog
  projects and all three checksum-verified pinned objects survived restart.
- A further `CI=1 npm run check` with the disposable PostgreSQL integration
  enabled was **not green**: with two workers an unrelated PGlite shared-store
  test exceeded its timeout; with one worker the suite stalled before any test
  file completed. The latter was interrupted. Retained the two-worker Vitest
  setting that **did** pass the normal full `npm run check`; do not report
  either CI-mode attempt as successful. The real PostgreSQL test independently
  passed against a fresh test database, as recorded above.

**Remaining acceptance boundary:** These are Linux disposable proofs, not
macOS power-loss, crash/fault-injection or reboot results; no Producer Mac
service, real PGlite catalog, FileVault/private-volume state, external friend
access, or automatic off-device backup was inspected or changed. Review and
Mac-specific acceptance are still required before #50 is delivered as
production-ready. The main `npm run check` intentionally keeps tests requiring
real PostgreSQL opt-in; the targeted PostgreSQL test above ran separately.
