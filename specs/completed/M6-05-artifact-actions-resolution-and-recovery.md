# M6-05 — Artifact actions, resolution, and recovery

- Status: complete
- Task/thread: M6-05 only
- Dependencies: M6-01 immutable artifact history, M6-02 local roots/locators and
  full package verifier, M6-03 restart-safe Clip Library, and M6-04 durable Clip
  Library export composition are complete

## User-visible outcome and current evidence

A researcher can inspect one completed artifact version in the Clip Library and
receive an honest compatibility/availability result. A currently verified local
locator can be verified, revealed, or opened by opaque locator ID. Moving or
tampering with the package changes only local availability; selecting a
configured root for relink restores reuse only after complete M6-02 package
verification. If reuse is impossible, the researcher can explicitly request a
new immutable export without changing the older history or locator.

M6-02 already persists path-private roots/locators and proves exact package
identity. M6-01 exposes the authorized immutable success lineage, M6-03 displays
history separately from local availability, and M6-04 submits the ordinary M5
export path. This slice composes those boundaries; it does not create another
artifact identity, filesystem scanner, renderer, or remote store.

## Smallest end-to-end proof

Start with one completed version and verified locator. Resolve exact compatible
requirements as `reusable_local`, verify it again, and invoke an injected local
reveal/open adapter using only the locator ID. Move the package and prove
resolution becomes `missing`; restore the exact package beneath a configured
root and relink it through full verification; tamper with a byte and prove
`invalid`; request incompatible settings and prove `incompatible`. Finally,
request an explicit re-export through the existing M5 request pipeline and prove
the old success/locator remain while the new request can later produce a second
artifact version.

## Affected boundaries

- Shared contracts: strict compatibility requirements, the exact six-state
  resolution union, locator-ID-only local action/relink requests, sanitized
  action results, and explicit re-export request identity.
- Cloud catalog/API: current-authorized exact history/candidate reads and one
  explicit idempotent re-export command that creates an ordinary logged export
  request with `requestOrigin = clip_library`; no locator/path fields.
- Local persistence: reuse M6-02 roots/locators. Preserve immutable locator
  identity and prior verification timestamps while only availability/failure
  changes. Add no migration unless implementation requires new durable state.
- Local agent: authorize against the exact cloud version, compare compatibility,
  re-run the M6-02 verifier, and reveal/open only a freshly verified locator
  through a platform adapter. Paths remain internal implementation values.
- Web: expose per-version resolution, verify, reveal/open, relink-to-configured-
  root, and explicit re-export controls without conflating history and current
  local availability.

## In-scope behavior

1. Define `ArtifactCompatibilityRequirements` over exact clip/version evidence:
   clip ID, selection/export bounds, transcript track/version snapshots,
   required artifact roles/subtitle policy, accepted manifest schemas, and
   either an exact settings fingerprint or bounded accepted renderer profiles.
2. Return exactly `reusable_local`, `missing`, `invalid`, `incompatible`,
   `remote_only`, or `needs_export`. `remote_only` is representable but never
   emitted because M6 has no configured cloud clip provider.
3. Resolve cloud history before workstation availability. No compatible
   completed version is `needs_export`; a compatible version with no locator is
   `missing`; failed local verification is `missing` or `invalid`; verified bytes
   with caller-incompatible requirements are `incompatible`; only fully matched,
   freshly verified bytes are `reusable_local`.
4. Verify/reveal/open/relink accept opaque local IDs and immutable cloud IDs, not
   a path. Relink selects a configured root and derives the one deterministic
   package segment from the authorized version; M6-02 performs the complete
   identity/schema/role/size/hash/snapshot/subtitle/settings verification.
5. Reveal/open reverify current bytes immediately before invoking an injected
   platform adapter. The adapter receives the internally resolved package path,
   but responses, errors, diagnostics, events, tests, and UI receive no path or
   filename.
6. Preserve old completed history and locator identity through missing, invalid,
   incompatible, relink, and re-export transitions. An explicit re-export uses
   a new durable request/package identity and never edits or repairs the old
   success row.
7. Online cloud authorization is mandatory for shared resolution, relink, and
   re-export. Offline reveal/open is allowed only when the presented local
   authorization scope has cached project evidence and the locator re-verifies;
   it is labeled stale and creates no shared mutation.

## Explicit non-goals

- Cloud clip storage, `remote_only` production behavior, arbitrary-path input,
  root browsing, whole-disk scanning, package repair, overwriting package bytes,
  deleting old locators/history, or exposing a path to the browser/cloud.
- Authoring-client descriptors/copy policy (M6-06) or runtime drain/failure
  diagnostics (M6-07).
- A new renderer, queue, package schema, artifact identity, compatibility hash,
  or hidden automatic regeneration.

## Failures and recovery

- Missing, disabled, replaced, or inaccessible root/package returns `missing`
  and preserves the historical success and locator identity.
- Manifest, snapshot, role, size, hash, filesystem, or containment failure
  returns `invalid`; no action adapter runs and no package is adopted.
- Requirements that disagree with an otherwise valid completed version return
  `incompatible`; changing requirements never mutates the version.
- No compatible success returns `needs_export`. With no remote provider,
  unavailable bytes never become `remote_only`.
- Revoked/invalid authorization purges the matching cached scope and blocks all
  shared reads/mutations. Offline action never widens a credential/project
  scope.
- Action adapter failure returns a bounded local error, keeps the verified
  locator, and leaks no operating-system/path detail.
- Exact re-export replay adopts one request; divergent reuse conflicts; failure
  to submit leaves prior versions/locators untouched.

## Migration and compatibility

Prefer no migration: M6-02 already stores immutable locator identity and mutable
availability, and cloud M5/M6-01 lineage already stores every new success. If a
persistent field becomes necessary, add the next ordered local/cloud migration
with fresh/populated compatibility coverage. Never edit completed migrations or
backfill inferred versions/paths.

## Acceptance criteria

1. Strict contracts expose only the six resolution states and reject path,
   filename, raw filesystem, credential, source URL, transcript text, note, tag,
   command, and command-output leakage.
2. Exact compatible verified bytes resolve `reusable_local`; moved bytes become
   `missing`; a fully verified relink restores reuse; tampering becomes
   `invalid`; incompatible requirements become `incompatible`; absent compatible
   history becomes `needs_export`; `remote_only` is never emitted without a real
   provider.
3. Verify/reveal/open/relink operate only on validated IDs, recheck current bytes,
   preserve containment, and never invoke the action adapter for unavailable or
   untrusted bytes.
4. Re-export creates or adopts one new ordinary logged request and later version
   without altering the old success result, history order, or locator state.
5. Current membership protects shared resolution/relink/re-export; bounded stale
   local action cannot cross a cached authorization scope.
6. Browser behavior keeps immutable completion and workstation availability
   visibly separate and provides actionable recovery without silent render.
7. Focused contracts/catalog/cloud/local-agent/web/browser tests, aggregate
   checks, builds, migrations, formatting, and `git diff --check` pass.

## Verification plan

Run contract union/strictness tests; compatibility matrices across bounds,
tracks, subtitle policy, roles, schema, settings fingerprint, and renderer
profile; local verifier/action tests for verified, moved, restored/relinked,
tampered, disabled/replaced root, adapter failure, offline scope, and leakage;
catalog/API authorization and exact/concurrent/divergent re-export tests; and a
browser flow covering version expansion plus recovery actions. Then run
typecheck, scoped formatting, web build, both migration validators, the full
network-free suite, Playwright, clean detached `npm run check`, and
`git diff --check`. The existing real-Windows junction gate remains declared and
must not be weakened or claimed from macOS.

## Completion evidence

- Implemented strict path-free compatibility, resolution, action, relink, and
  re-export contracts. `remote_only` remains representable but is never emitted
  without a configured remote provider.
- Reused the M6-02 full verifier for every adoption and immediately before
  Reveal/Open. The platform launcher receives only an internally derived,
  freshly verified package or media path through argument-array process APIs.
- Added opaque locator-ID lookup, configured-root relink with immutable prior
  locator preservation, authorization-scoped offline evidence, denial purge,
  and nonenumerating denied action behavior without a new migration.
- Added a dedicated current-authorized re-export command with a separate durable
  idempotency namespace and `clip_library` origin. Concurrent replay adopts one
  new request; a later reconciled success produces a second artifact version
  while the original remains unchanged and ordered behind it.
- Browser coverage distinguishes immutable completion from workstation
  availability and exercises Resolve, Verify, Reveal, Open, configured-root
  relink, and the ordinary storage-gated re-export preflight.
- Focused compatibility, containment, offline scope, catalog/API, storage, and
  browser tests passed. The final clean-tree aggregate check passed with 309
  tests and 2
  skips; both migration validators passed (27 local, 20 cloud); typecheck, web
  build, Playwright (4 tests), scoped formatting, and `git diff --check` passed.
- Independent Sol review found no remaining P0/P1 or acceptance blocker. The
  M6-02 real-Windows junction/reparse physical-containment proof remains the
  declared release gate and was not claimed from macOS.
