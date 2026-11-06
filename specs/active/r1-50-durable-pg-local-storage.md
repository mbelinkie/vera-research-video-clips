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
