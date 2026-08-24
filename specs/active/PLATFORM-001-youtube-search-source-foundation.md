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
