# M6-02 — Local roots, locators, and package verification

- Status: active
- Task/thread: M6-02 only
- Dependencies: M6-01 complete at `6f5d33b`; Milestone 5 package and success
  lineage complete through M5-27

## User-visible outcome and current evidence

At startup, a workstation configures its managed export directory as an
artifact root and can durably record whether an immutable cloud artifact
version has a reusable local package beneath that root. The locator stores only
a root ID and validated relative package path;
cloud history remains authoritative for completion and never receives a local
path or filename.

M5 already creates atomically promoted `clip-<request-id>` packages with a
versioned manifest, metadata, thumbnail, exact role/size/hash provenance, and
local final-artifact rows. M6-01 exposes the immutable cloud success-result ID
and request/artifact lineage. There is no configured-root/locator persistence or
complete package verifier connecting these two existing identities yet.

## Smallest end-to-end proof

Configure one temporary local root, place one complete M5 package beneath it,
verify the package against an authorized M6-01 artifact summary, and persist one
available locator keyed by the exact success-result ID. Reopen the database and
prove the root-relative locator survives. Then tamper with one artifact and
prove verification changes only local availability/failure state without
changing cloud completion or history.

## Affected boundaries

- Shared contracts: local-safe root/locator IDs, platform, availability,
  verification result, and bounded failure classes; no absolute-path field in
  cloud history or events.
- Local persistence: ordered SQLite tables for configured roots and artifact
  locators, immutable artifact-version binding, restart-safe verification state,
  and populated M5 migration compatibility.
- Local package verification: contained path resolution, manifest v1/v2
  parsing, role/size/hash checks, request/package/snapshot/success lineage, and
  regular-file checks.
- Local agent: internal startup root configuration plus an authorized
  verify/backfill composition. Root listing/configuration is not exposed over
  loopback until a real local app-session boundary exists. Verification inputs
  identify roots and authorized artifact versions; outputs are sanitized local
  descriptors.
- Cloud/catalog: add one exact, authorized artifact-version read that reuses the
  M6-01 mapper and exposes the sanitized M5 success provenance required for
  verification. No cloud migration is needed. Web, renderer, worker, remote
  storage, and Clip Library UI do not change.

## In-scope behavior

1. Persist configured artifact roots locally with opaque IDs, normalized
   platform, enabled state, and local-only absolute root path. Never serialize
   the absolute path through shared cloud contracts, events, telemetry,
   diagnostics, or failure text.
2. Make a configured root's path/platform/filesystem-object identity immutable;
   replacing or retargeting it requires a new root ID. Persist
   `export_artifact_locators` keyed to the exact M6-01 `artifactVersionId`, with
   root ID, one internally stored direct-child package segment, platform,
   manifest hash/schema, authoritative result fingerprint, availability,
   verification time, and bounded failure class.
3. Derive the one allowed relative segment from immutable package identity:
   exactly ASCII `clip-<request UUID>`. Clients and cloud responses never
   supply a lookup path. Reject empty/dot, absolute, drive-relative, UNC/device,
   traversal, separator/ADS/reserved-name, NUL, Unicode/case-ambiguous, and
   escaping stored values before filesystem access.
4. Walk and open package entries without following symbolic links, junctions,
   reparse-point escapes, or accepting non-regular files. Recheck containment
   and file type at verification time; fail closed on uncertainty or races.
5. Parse supported manifest v1/v2 bytes and verify manifest SHA-256, package
   identity, request/job plus transitive authorized project/clip binding,
   video/selection/preset snapshots, resolved settings/bounds,
   required artifact roles, exact safe filenames, byte sizes, SHA-256 hashes,
   and M6-01 success lineage before marking a locator reusable.
6. Backfill an M5 package only through an online-authorized exact-version read
   and that complete verifier. Partial,
   pre-manifest, tampered, mismatched, unsupported-schema, or uncorrelated local
   packages remain unavailable with a bounded reason and are never rewritten.
7. Make root/locator creation and repeated verification idempotent. Restart
   preserves the last bounded state, while a new verification can move between
   available and unavailable without changing historical completion.

## Explicit non-goals

- Clip Library browsing/search/cache/UI (M6-03), storage preflight/export
  operations (M6-04), or Reveal/Open/Relink/re-export actions (M6-05).
- Cloud artifact upload/storage, remote locators, automatic whole-disk scans,
  renderer/package repair, package rewriting, or a second artifact identity.
- Publishing absolute paths, local filenames, directory listings, OS errors,
  manifest content, or locator records to cloud events/diagnostics.
- Treating local availability as proof of historical completion or widening an
  offline user's project authorization.

## Failures and recovery

- Invalid root or relative-path syntax fails before filesystem access and
  persists no unsafe locator.
- Missing/tampered/partial/unsupported packages retain cloud completion but are
  locally unavailable with one bounded failure class; retrying verification is
  safe after bytes are restored.
- A root moved, disabled, replaced by a file/link, or made inaccessible fails
  closed. No sibling root/locator is changed.
- A root replaced at the same configured path fails filesystem-object identity
  verification and cannot silently retarget its locators.
- A manifest/request/package/artifact mismatch cannot be relabeled, repaired,
  or adopted as another artifact version.
- Duplicate verification adopts the same locator only when immutable binding
  and normalized relative path agree; conflicts fail without overwriting prior
  evidence.
- Filesystem exceptions and diagnostic output are sanitized so absolute paths
  and filenames do not cross the local boundary.

## Migration and data compatibility

Add one ordered local-only migration after 0025. Existing M5/M6-01 SQLite rows stay
unchanged. New root/locator tables use foreign keys and uniqueness constraints
without inventing `artifactVersionId` values. Populated-database tests begin
from the M5/M6-01 migration state and prove migration/idempotency, legacy export
readability, and no eager package rewrite/backfill. No cloud migration is
expected.

## Acceptance criteria

1. Root and locator persistence is local-only, restart-safe, constrained, and
   keyed to a real supplied M6-01 success-result ID.
2. Only a completely verified manifest/package/request/success match becomes
   reusable; every mismatch fails closed without mutating package bytes or
   cloud history.
3. POSIX and Windows lexical containment reject traversal, drive-relative,
   absolute, UNC/device, reserved-name, separator-confused, Unicode/case
   ambiguity, and malformed inputs.
4. Physical containment rejects links/reparse points, root replacement,
   non-directories, non-regular or multiply-linked artifacts, and detected
   replacement races. POSIX reads use no-follow file handles; Windows uses
   conservative realpath/lstat/handle-identity checks and fails closed whenever
   trustworthy containment cannot be established.
5. M5 backfill is explicit and idempotent; incomplete or unsupported legacy
   packages remain unavailable rather than receiving guessed identity/schema.
6. Contracts, local API responses, events, failures, and diagnostics expose no
   absolute path, package filename, credential, command, or raw filesystem
   error.
7. Fresh and populated migrations pass, existing exports remain readable, and
   one locator survives database restart and tamper/reverify transitions.

## Verification plan

Run focused contract, migration, containment, manifest/package verifier,
backfill, restart, idempotency, and leakage tests first. Add deterministic
temporary-directory fixtures for supported v1/v2 packages plus missing,
partial, tampered, collision, link, non-regular, macOS/POSIX, and Windows-path
cases. Then run formatting, typecheck, relevant local-agent integration tests,
both migration CLIs, browser regression, `git diff --check`, and full
`npm run check`. Manually inspect the local rows and sanitized verification
responses while confirming no cloud-facing shape contains the configured path.

The physical Windows junction test is platform-gated and therefore declared
skipped on the current macOS host. It must run on a real Windows host before a
Windows release; macOS evidence does not substitute for that platform result.
