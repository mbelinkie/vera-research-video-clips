# M6-06 — Authoring-client handoff

- Status: complete
- Task/thread: M6-06 only
- Dependencies: M6-01 through M6-05 are complete

## User-visible outcome and current evidence

A same-workstation authoring client can search the authorized project Clip
Library, inspect immutable artifact history and compatibility, and request one
freshly verified local package descriptor. If compatible bytes are unavailable,
the client can use the existing storage-preflighted export path with
`requestOrigin = authoring_build`; it does not create a second renderer, queue,
artifact identity, or build-history store.

M6-01 already exposes immutable history, M6-02 verifies exact package bytes and
keeps paths local, M6-03 provides bounded authorized search, M6-04 provides the
storage gate and durable export composition, and M6-05 provides exact
compatibility plus locator recovery. This slice adds only the authoring-specific
trust and descriptor boundary.

## Smallest end-to-end proof

Simulate an authoring client that searches the cloud Clip Library, chooses one
completed version, and submits its exact compatibility requirements plus a
local locator ID to the loopback local agent. The local agent must obtain fresh
online cloud authorization for that exact version, re-run the full package
verifier, and return a strict local-only descriptor containing the verified
package/artifact paths and immutable hashes. Moving, tampering, incompatibility,
offline state, or revoked membership returns no descriptor. A missing version
uses the same local storage preflight and cloud export endpoints with
`authoring_build`, and exact replay adopts one ordinary M5 request.

## Affected boundaries

- Shared contracts/cloud: reuse bounded Clip Library search, history, exact
  artifact reads, and export routes. Add a bounded path-free compatibility page
  only if the cloud cannot otherwise expose honest candidate matching.
- Export compatibility: move the existing pure compatibility predicate to a
  shared implementation used by cloud/local decisions; do not create a second
  compatibility algorithm.
- Local agent: add a strict authoring descriptor command that requires project,
  clip, artifact version, locator, and compatibility evidence. It always calls
  the exact cloud read and never falls back to stale cache.
- Local-only descriptor: absolute paths are permitted only in this response.
  Derive them from the verified root/package and deterministic artifact names;
  never accept them from the caller or persist/log/send them to cloud.
- Export operations: reuse the M6-04 preflight/submission service while
  parameterizing only diagnostic origin. Origin remains absent from preflight,
  compatibility, package, artifact, and idempotency fingerprints.
- Simulated client tests: exercise cloud search/history, local reuse handoff, and
  missing-artifact export fallback without adding an authoring UI.

## In-scope behavior

1. Require loopback transport plus a caller-provided current cloud
   authorization. This proves same-machine network locality for M6, not OS
   process identity; M7 owns desktop/session hardening.
2. Require a fresh successful exact cloud artifact read before every descriptor.
   A cached/stale artifact may still support M6-05 Reveal/Open, but never an
   authoring handoff.
3. Match exact clip selection, resolved bounds/handles, track versions, language
   and subtitle policy, required roles, accepted manifest schemas, and exact
   settings fingerprint or accepted renderer capability before reuse.
4. Re-run the M6-02 verifier immediately before returning the descriptor. Bind
   the requested locator to the exact project/clip/request/package/manifest/
   result tuple, and update only its local verification availability.
5. Return a strict versioned descriptor with artifact/version/request/clip/
   locator identity, verified manifest and result fingerprints, package path,
   and per-role absolute path/size/hash. Return no transcript text, notes, tags,
   source URL, credential, token, command, or raw filesystem error.
6. Keep destination selection, copy/clone policy, timeline placement, and build
   history outside this product. Descriptor handoff never moves or mutates the
   canonical package.
7. Submit missing work through the ordinary M6-04 preflight and M5 cloud
   request/batch pipeline with `authoring_build`. Same material command identity
   adopts across Clip Library/authoring origin differences; divergent material
   evidence conflicts.

## Explicit non-goals

- Script editor UI, authoring destination writes, copy/clone implementation,
  timeline placement, build history, cloud media storage, remote descriptors,
  offline authoring reuse, OS-process attestation, arbitrary-path input, a new
  renderer, or a new queue.
- M6-07 drain/quiescence, operation-failure taxonomy, or correlation IDs.
- Closing the previously declared real-Windows junction/reparse release gate.

## Failures and recovery

- Missing authorization returns 401; current cloud 401/403 purges the precise
  cached scope and returns a nonenumerating local failure with no descriptor.
- Cloud timeout, 5xx, or contract drift fails closed; cached evidence is not an
  authoring authorization substitute.
- Project/clip/artifact/locator identity mismatch or incompatible requirements
  returns no descriptor and never reveals whether a foreign locator exists.
- Missing, moved, disabled, or replaced roots/packages return no descriptor and
  preserve immutable history. Tampered, linked, raced, or contradictory bytes
  become invalid through the existing verifier.
- Unsupported actual manifest schema returns no descriptor even if legacy cloud
  history records the schema as unknown.
- Export preflight insufficiency or unknown-size refusal creates no cloud work;
  exact accepted replay creates/adopts one request and preserves the first
  stored diagnostic origin.

## Migration and compatibility

No migration is expected. Existing cloud success lineage and local locator rows
contain the required immutable evidence. Descriptors are ephemeral and must not
be cached or persisted. Add a migration only if implementation proves new
durable state is necessary; never edit completed M5/M6 migrations.

## Acceptance criteria

1. Cloud search/history/compatibility/export responses contain no local
   descriptor or path, and current project membership protects every shared
   read/mutation.
2. Only a fresh online-authorized, exact-compatible, freshly verified locator
   returns the strict local descriptor; every other state returns no path.
3. Descriptor paths are internally derived, absolute, role-complete, hash-bound,
   and never persisted, logged, diagnosed, or sent to cloud.
4. Simulated authoring fallback uses the M6-04 storage gate and one M5 executor;
   `authoring_build` is diagnostic only and exact cross-origin replay adopts.
5. Canonical package bytes remain unchanged after handoff, and moved/tampered/
   raced/incompatible/offline/revoked cases fail closed.
6. Focused contracts/catalog/cloud/local-agent/simulated-client tests, aggregate
   checks, builds, migrations, formatting, and `git diff --check` pass.

## Verification plan

Add strict local-descriptor and path-free cloud contract tests; compatibility
matrix and locator binding tests; online-only authorization/denial/unreachable
local-agent tests; cloud membership and origin-insensitive idempotency tests;
storage-preflighted `authoring_build` individual/batch/re-export tests; and a
simulated client flow that searches, resolves, receives a verified descriptor,
rehashes copied fixture bytes, and falls back to one export when bytes are
missing. Then run typecheck, scoped formatting, the full network-free suite, web
build, migration validators, Playwright where relevant, a clean detached
`npm run check`, and `git diff --check` before independent Terra review.

## Completion evidence

- Added one shared exact compatibility predicate used by cloud candidate and
  local byte-resolution decisions. The exact cloud candidate route is bounded
  to a chosen immutable version, membership-authorized, and path-free; legacy
  unknown manifest schema remains only a candidate until local byte verification.
- Added a strict local-only descriptor command bound to project, clip, artifact
  version, locator, request, package, manifest, and result identity. It requires
  a fresh exact cloud read and never uses M6-05's stale offline action evidence.
- The M6-02 verifier runs immediately before descriptor construction. Descriptor
  paths are canonical, absolute, internally derived, package-contained, and
  response-parsed at the HTTP boundary; path traversal and faulty dependency
  output fail closed.
- Reused the M6-04 storage preflight and M5 individual/batch/re-export pipeline
  for `authoring_build`. Origin remains outside material fingerprints and exact
  cross-origin replay adopts the first request and preserves its stored origin.
- A simulated same-workstation authoring client searched cloud clips/history,
  selected a compatibility candidate, received a verified descriptor, copied
  and independently rehashed every role without mutating canonical bytes, then
  submitted one missing clip through the authoring storage gate.
- No migration was added. The full network-free suite passed with 312 tests and
  2 skips; the focused implementation matrix passed with 115 tests and one
  Windows-only skip; typecheck, web build, both migration validators, Playwright
  (4 tests), scoped formatting, and `git diff --check` passed.
- Independent Terra review found no remaining P0/P1 blocker after its descriptor
  containment finding was fixed and regression-tested. The pre-existing M6-02
  real-Windows junction/reparse physical-containment proof remains a release
  gate and was not claimed from macOS.
