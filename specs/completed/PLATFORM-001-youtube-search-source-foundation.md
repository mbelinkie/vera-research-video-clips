# PLATFORM-001 — YouTube search and source foundation

## User-visible outcome

Researchers can explicitly search YouTube from ingest, preview exactly one
result at a time, select multiple results, and hand those canonical URLs to the
existing project batch preflight. TikTok, Instagram, and Facebook are visible
but disabled from backend-reported capabilities and are not represented as
supported.

## Boundaries

- Shared source identity, capability, search, candidate, and outcome contracts.
- Expand-first cloud/local identity migrations and legacy YouTube readers.
- Official backend YouTube Data API search adapter and project-authorized API.
- Workspace ingest UI and existing batch-preflight handoff.
- Non-shipping direct-acquisition spike harness and research record.

## Non-goals

- TikTok/Instagram/Facebook shipping ingest, search, transcription, navigation,
  logging, export, or authoring support.
- Unofficial/private social search libraries or a second downloader runtime.
- Cloud source-media/clip-package sync or cross-machine local-media transfer.
- Rewriting immutable historical packages or removing compatibility fields.

## Failure states

- Search unconfigured, unsupported, auth-required, quota-limited, temporarily
  unavailable, malformed, or empty.
- Individual providers can fail without discarding successful sibling results.
- Acquisition spike rejects missing rights confirmation, invalid canonical URLs,
  identity mismatch, malformed metadata/probe output, missing/oversized media,
  cancellation, restrictions, and cleanup failure.

## Acceptance

- Existing YouTube records backfill to `youtube` plus their current stable ID.
- Legacy descriptors remain readable; canonical new writes include source identity.
- Same media-ID string under different providers has distinct composite identity.
- Search uses backend credentials, explicit submission, bounded pagination,
  video/embeddable filters, normalized cards, and per-provider outcomes.
- Search/preview performs no catalog or worker mutation before batch confirmation.
- UI has capability-derived provider controls, multi-select, one preview, and
  selection-to-existing-preflight handoff.
- Deterministic social spike tests use only hardened `yt-dlp`; live runs remain
  explicit and opt-in.

## Narrow checks first

- Contract, provider, config, cloud-route, UI/component, and spike Vitest files.
- Populated cloud/local migration tests.
- Typecheck, web/desktop builds, relevant Playwright flow, format, diff check.

## Completion record

Implementation commit:

- `8423300ffdbd75bd2921c23d6cfcce27eb9be5b7`

### Decisions and delivered boundaries

- Added Facebook to the provider-neutral identity/capability contracts and to
  the disabled search controls after the original plan was approved. Facebook
  is not product-qualified; the cloud API rejects non-YouTube project ingest.
- Added official YouTube Data API v3 search behind the backend-only
  `YOUTUBE_API_KEY`, with bounded explicit submission, pagination,
  embeddable/syndicated video filters, normalized candidates, sanitized
  auth/quota/provider failures, and per-provider outcomes.
- Added capability-derived platform controls, one-at-a-time hardened YouTube
  preview, multi-select, and a side-effect-free handoff into the existing batch
  preflight. Search and preview do not create project records or worker jobs.
- Added expand-first cloud/local source identity migrations, composite source
  reads/writes, job/workspace/authoring compatibility fields, generic rights
  and source-reference contracts, and legacy YouTube fallbacks. Historical
  package schemas remain readable and immutable package bytes are not rewritten.
- Added a non-shipping, opt-in `yt-dlp` acquisition spike for canonical TikTok,
  Instagram, and Facebook URLs. It requires explicit rights/authorization
  flags, disables ambient configuration/cookies/playlists, bounds execution and
  size, validates with FFprobe, hashes by stream, and always removes scratch.
  No live social URL was supplied or run.
- Kept social discovery official-API-only. No TikTokApi, instagrapi,
  gallery-dl, Cobalt, or second acquisition runtime was introduced.

### Verification results

- Focused contracts/providers/config/spike/static-boundary/populated-migration
  run: `6` files, `95` tests passed.
- Contracts/sync/social compatibility run: `3` files, `77` tests passed.
- Catalog full run: `53` tests passed. A later focused job/local-processing run
  passed `5` tests after neutral job/workspace identity was added.
- Local migration suite: `25` tests passed. Focused cloud migration suite: `2`
  tests passed. After integration with PUNCH-007, migration CLIs reported `38`
  cloud and `32` local migrations valid on empty databases. The source-identity
  migrations are cloud `0038` and local `0032`.
- Authoring locator suite: `12` passed, `1` skipped. Cloud search/capability and
  unsupported-social-ingest route test passed.
- Playwright search flow: `1` passed, covering capability controls, two result
  cards, one preview iframe, multi-select, no preflight before handoff, and one
  explicit preflight afterward.
- `npm run build:web` and `npm run build:desktop` passed. The existing Vite
  chunk-size warning remains informational.
- Changed-file Prettier checks and `git diff --check` passed.
- The broad Vitest run reached `606` passed and `4` skipped. Ten migration-list
  expectation failures were then updated and their suites passed. Its one
  remaining failure is in the concurrent PUNCH comment-idempotency work, not
  this implementation.
- The integrated main-workspace `npm run typecheck` passes. Focused integrated
  platform tests passed `100` tests across `6` files; catalog overlap passed
  `3` tests with `56` skipped, cloud API overlap passed `2` with `24` skipped,
  and the cloud/local database suites passed `44` with `2` skipped.
- Repository-wide `npm run format:check` is blocked by the pre-existing,
  untouched `docs/Script-to-Resolve Product Spec.md`; all changed formatted
  files pass Prettier.

### Remaining risks and follow-ups

- The implementation is integrated into the PUNCH workspace. The merge kept
  PUNCH-007 player-range evidence and comment idempotency behavior alongside
  provider-neutral source identity, and the integrated YouTube-search
  Playwright flow passed. The aggregate Vitest and full Playwright gates remain
  part of the final punch-list validation after subsequent slices.
- YouTube search was tested with deterministic official-API fixtures, not a
  live quota-bearing key. Deployment still needs a restricted server-side key
  and normal quota monitoring.
- TikTok, Instagram, and Facebook acquisition results remain fixture-only until
  separate explicitly authorized live URLs are supplied. Even a successful
  smoke proves acquisition feasibility only, not ingest/transcription/
  navigation/logging/export/authoring support.
- Cross-machine source-media transfer and cloud source/clip-media sync remain
  deferred; verified local package reuse and the existing export path are
  unchanged.
