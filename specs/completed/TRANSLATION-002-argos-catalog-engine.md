# TRANSLATION-002 — Pure Argos local-model catalog engine

- Status: completed
- Date authorized: 2026-08-26

## User-visible outcome

Platform services can discover an Argos package index, evaluate immutable exact
pack bytes, and publish a signed catalog of administrator-approved local
translation packs without embedding a language list in a desktop build.

## Affected boundaries

- `packages/providers`: pure server-side discovery, byte-evaluation, catalog
  lifecycle, deterministic signing, and verification helper only.

## Explicit non-goals

- Database, HTTP API, object store, scheduler, desktop runtime/download
  manager, Argos invocation, AWS integration, UI, or real network calls.
- Executing package contents. The bounded ZIP inspection reads the central
  directory and only inflates/parses a size-capped `metadata.json` entry.

## Failure states

- Mutable-feed entries never alter an already-created candidate identity.
- Missing/oversized/corrupt ZIP bytes, unsafe paths, malformed metadata,
  incompatible runtime, or unsupported format are hard safety findings and
  cannot be enabled by override.
- Advisory license/provenance/quality findings require an audited nonempty
  override reason for `enabled_by_override`.
- A single directed language pair/runtime family has at most one active version.
- Disabled/revoked versions are omitted from new signed releases; revocation is
  explicitly observable for desktop deletion handling.

## Acceptance criteria

1. Snapshot and candidate identities are immutable hashes of discovered feed
   content and entry identity, while evaluation hashes exact artifact bytes.
2. ZIP traversal is rejected before metadata is trusted; all safety findings
   remain non-overridable.
3. Lifecycle handles normal enable, audited override, disable, revoke, and
   rollback while preserving historical versions.
4. English-hub routes derive only from enabled directed graph edges.
5. Signed releases serialize deterministically and verify through an injected
   verifier; release changes are immutable.

## Narrow verification first

- `vitest run packages/providers/src/local-model-argos-catalog.test.ts`
- `npm run typecheck`

## Completion record — 2026-08-26

### Decisions and files changed

- Added `packages/providers/src/local-model-argos-catalog.ts`: injected-feed
  discovery, immutable snapshot/candidate identities, exact-byte SHA-256 and
  ZIP metadata evaluation, hard/advisory findings, lifecycle/audit controls,
  English-hub derivation, and deterministic signed releases.
- Added deterministic fixture ZIP tests in
  `packages/providers/src/local-model-argos-catalog.test.ts`.
- Exposed the isolated module as
  `@research-video/providers/local-model-argos-catalog`; no dependency or
  migration changed.

### Checks and results

- `npm exec vitest run packages/providers/src/local-model-argos-catalog.test.ts`
  — passed: 1 file, 5 tests.
- `npm exec -- prettier --check ...` — passed for all four changed files.
- `git diff --check` — passed.
- `npm run typecheck` — blocked by concurrent, unrelated uncommitted work in
  `language-service-registry.test.ts` (unexported `SpeechToTextProvider` and
  descriptor-service type widening). The focused Argos test passed after the
  new module was formatted.

### Remaining risks/follow-ups

- Persistence, authenticated administration, server artifact mirroring,
  scheduled refresh, real Argos smoke execution, catalog distribution, and
  desktop download/lease/deletion handling remain intentionally outside this
  pure module.
- The server integration must supply a protected production signer/verifier and
  persist each immutable snapshot/evaluation/release before exposing it.
- No commit was created in this shared working tree.
