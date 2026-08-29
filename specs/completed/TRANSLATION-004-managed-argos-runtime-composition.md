# TRANSLATION-004 — Managed Argos runtime composition

- Status: completed
- Date authorized: 2026-08-27
- Date completed: 2026-08-27

## User-visible outcome

Local translation is the default execution path. A configured desktop worker
loads the authenticated signed catalog, installs only an administrator-enabled
release-bound Argos artifact, executes a direct or exactly two-leg English-hub
route, and continues to use already verified installed packs while offline.
Selecting a separately approved cloud provider remains explicit; its failure
may restart the whole translation locally but never hops to another vendor.

## Affected boundaries

- `packages/providers`: authenticated managed-catalog adapter, signed-release
  projection, persistent SQLite model store, route selection, downloads, and
  Argos sidecar execution.
- `apps/worker`: production composition of the durable local database, trust
  roots, model manager, authenticated catalog client, and local-first pipeline.
- `apps/local-agent`: local preferred-language generation and exact provider /
  model provenance where the existing derived-translation boundary permits it.
- `apps/desktop` and `packages/config`: packaged runtime path, compatible
  runtime versions, and catalog verification trust roots.

## Explicit non-goals

- Shipping or approving a real Argos pack, private signing key, or provider
  credential in this change.
- Live paid-provider calls, real package quality approval, or OS-level sidecar
  sandbox validation.
- UI-shell redesign or direct desktop access to the mutable upstream feed.

## Failure states

- Missing trust roots or runtime binaries silently selects cloud translation.
- An unverified/stale catalog authorizes a new download, or a download target
  can escape the exact current signed release.
- A job without provider-specific consent invokes a cloud provider.
- Cloud failure publishes partial/mixed output or selects another cloud vendor.
- Unknown, disabled, revoked, corrupt, oversized, incompatible, or unsafe packs
  execute locally.

## Acceptance criteria

1. The worker uses a migrated SQLite model store and configured Ed25519 trust
   roots; startup reconciliation and shutdown preserve durable installation and
   lease state.
2. Authenticated release/download APIs are the only network source. Descriptor,
   size, SHA-256, archive containment, runtime compatibility, and signature
   checks fail closed before atomic activation.
3. Synchronous language preflight reflects an initialized verified catalog and
   supports only a direct route or exactly two legs through English.
4. No-consent translation uses local Argos even when cloud adapters exist.
   Explicit cloud failure discards partial output and attempts the whole source
   locally once, with immutable local provider/model provenance.
5. Current/stale offline behavior, tampering, routing, local default, cloud
   fallback, migrations, typecheck, aggregate tests, and web/desktop builds pass.

## Narrow verification first

- `npm exec -- vitest run packages/providers/src/translation-argos-cloud-managed.test.ts packages/providers/src/local-argos-model-store-sqlite.test.ts apps/worker/src/pipeline.test.ts`
- `npm run typecheck`
- `git diff --check`

## Completion record — 2026-08-27

### Decisions and files changed

- Added an authenticated cloud-managed Argos provider that initializes a
  synchronous route snapshot from a verified signed release, chooses a direct
  route or exactly two legs through English, exposes the exact model-chain
  provenance before cache lookup, and never reads the mutable upstream feed.
- Added SQLite-backed catalog/install/lease persistence, Ed25519 trust-root
  verification, bounded current-release download descriptors, dev-memory and
  production-S3 download paths, size/SHA/archive/runtime verification, atomic
  activation, stale installed-model operation, and lease-aware revocation.
- Composed the manager into the worker and local agent. Preferred-language
  resolution remains local then shared then generated, publishes verified local
  results through the durable project lineage, and records exact provider/model
  identity. Missing first-launch catalog state does not block base transcript
  review.
- Made local translation the no-consent default. A selected cloud failure
  discards partial output and restarts the whole source locally once. Worker
  transcription resolution now uses the generic adapter registry rather than a
  vendor-name branch.
- Split backend-only provider exports from the browser-safe root package and
  corrected retry selection to use unique catalog-video identity.

### Checks and actual results

- Managed Argos, SQLite store, preferred translation, cloud publication,
  worker pipeline, registry, and download API focused suites passed.
- `npm run typecheck`, both migration-test commands, the production web build,
  and `git diff --check` passed.
- The aggregate suite's assertions passed after the single provider-neutral
  boundary correction; PGlite tests that timed out under parallel CPU load all
  passed in isolated reruns. No paid or live-provider call was made.
- Per the user's direction, no desktop rebuild/package step was run.

### Remaining risks and follow-ups

- Real Argos sidecar/package execution, signed production catalog keys, live AWS
  calls, and macOS/Windows packaged-runtime certification remain separately
  authorized release checks.
- Regional BCP-47 tags use a signed base-language route only when the catalog
  yields one unambiguous model chain; ambiguous mappings fail closed.
- No commit was created in the shared worktree.
