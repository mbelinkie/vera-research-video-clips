# VERA Research Video Clips

Shared-project research software for resolving English transcripts, navigating YouTube videos by transcript, logging candidate ranges, and exporting editing-ready clips.

The authoritative product and architecture plan is in [`PROJECT_GUIDE.md`](./PROJECT_GUIDE.md). The concise execution map is in [`outline.md`](./outline.md).

The separate authoring companion is
[`VERA Script to Timeline`](https://github.com/mbelinkie/vera-script-to-timeline).
It consumes versioned, authorized APIs and verified artifact descriptors; it
does not share this application's database or depend on this UI. The completed
research-side integration boundary is documented in
[`specs/completed/M6-06-authoring-client-handoff.md`](./specs/completed/M6-06-authoring-client-handoff.md).

## Current project state

As of 2026-08-24, the deterministic core pilot punch list is complete:
PUNCH-001 through PUNCH-008 and PUNCH-010 are implemented and linked to their
verification records in [`specs/completed`](./specs/completed). This includes
language-integrity and corrected-transcript workflows, the VERA Workbench and
canonical project-video worklist, project governance, keyword scans, manual
player-range logging, collaboration/comments, Topics, and immutable authoring
snapshots.

The separately integrated
[`PLATFORM-001`](./specs/completed/PLATFORM-001-youtube-search-source-foundation.md)
foundation adds provider-neutral source identities and official YouTube search
with an explicit candidate-to-preflight handoff. YouTube remains the only
supported ingest/playback platform. TikTok, Instagram, and Facebook are shown
honestly as disabled; no social or AI capability should be inferred from their
adapter seams or fixture-only acquisition spike.

PUNCH-009 remains proposed M8 expansion scope apart from that completed
foundation. Production AWS/Cognito proof, authorized live-source dogfood,
signing/notarization, cross-platform release publication, updates, diagnostics,
and independent QA remain external or later release gates. The bounded
post-punch keyword maintenance, project bookmarks, desktop mention
notifications, and provider-neutral YouTube search foundation are also
complete. No specification is currently active.

The current deterministic verification gate passes with 667 Vitest tests (4
optional skips), 19 Playwright flows, 35 local migrations, 43 cloud migrations,
typecheck, and web/desktop builds. Earlier release evidence also covers the real
30-second foreign-language FFmpeg fixture, Electron Forge packaging, and
packaged SQLite `PRAGMA quick_check`.

## Delivery workflow

Each implementation task has one bounded spec in [`specs/active`](./specs/active)
and one task/thread. The spec names the outcome, affected boundaries, focused
context, non-goals, acceptance criteria, failure states, and verification plan.
Start with narrow tests, then run broader checks appropriate to the risk; review
the full diff and record actual command output before committing.

When work is complete and verified, move its spec to
[`specs/completed`](./specs/completed) with decisions, checks/results, risks, and
commit IDs. Update product documentation only for completed work. External
research belongs in [`docs/research`](./docs/research); create a
[`docs/decisions`](./docs/decisions) record only when a durable architectural
decision needs its own rationale. After two unsuccessful evidence-based
debugging attempts, start a fresh task with the confirmed facts and a focused
reproduction.

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- SQLite 3 for inspection (the application uses Node's SQLite API)
- FFmpeg and FFprobe for media work

PostgreSQL and AWS are not required for the normal development test suite. Cloud migrations run against an embedded PostgreSQL-compatible test runtime, and object storage/queue tests use in-memory adapters.

## Start

```bash
npm install
cp .env.example .env
npm run dev
```

### Start the packaged desktop app

Build a fresh unsigned Intel macOS package from the current worktree:

```bash
npm run desktop:package:x64
open "out/Research Video Clips-darwin-x64/Research Video Clips.app"
```

Managed sign-in requires the three approved public deployment values to be
exported together when the package is built: `PUBLIC_API_ORIGIN`,
`COGNITO_DOMAIN`, and `COGNITO_CLIENT_ID`. The desktop build embeds those public
connection identifiers in `desktop-config.json`; it never embeds a client
secret. Every build embeds the approved checksum-pinned Whisper model identity
independently. If the cloud values are absent, the app remains usable for local
setup and the approved model download but reports that cloud sign-in is not
configured instead of opening a browser. The current package embeds the
approved low-cost development deployment values. That
single-instance/PGlite/memory-adapter environment enables personal dogfood but
does not satisfy the separate M7-01 production acceptance gate.

The current verified local package is:

```text
out/Research Video Clips-darwin-x64/Research Video Clips.app
```

It is an unsigned, unnotarized x86_64 development/dogfood build, not a pilot
release for remote distribution. The verified package's `app.asar` SHA-256 is
`ff1e09a0669bfaed15b9c0749800c792137929dbb29a3be8f41f81ee03e73ead`;
rebuilding changes the package and requires recording a new hash.

The default development ports are:

- web: `http://127.0.0.1:43112`
- local agent: `http://127.0.0.1:43110`
- cloud API: `http://127.0.0.1:43111`

The browser's transcription-queue panel connects through the Vite
`/cloud-api` same-origin proxy. Enter the current development bearer credential
there; it is kept only in React memory, then choose one of the projects returned
for that identity. A production web deployment must route `/cloud-api` to the
authenticated cloud API on the same origin (or replace this development
credential panel with the planned OIDC session shell).

Batch input accepts newline-separated URLs/video IDs or a CSV file up to 2 MB.
CSV import uses Papa Parse, asks which column contains the YouTube values, and
copies at most 500 nonempty values into the same editable preflight list. It
does not submit automatically; duplicates and unsupported rows remain visible
for the normal server preflight.

The ingest Search tab uses the official YouTube Data API v3 and is enabled only
when the cloud API has a backend-only key:

```bash
YOUTUBE_API_KEY=server-side-api-key
```

Search and preview do not add project records or enqueue processing. Selected
results are copied into the existing editable batch preflight, where the user
must explicitly confirm them. TikTok, Instagram, and Facebook remain visibly
disabled unless a future deployment configures a qualifying official search
adapter; they are not supported ingest platforms in this release.

Caption acquisition is disabled by default. To opt into the local `yt-dlp`
adapter for sources you are authorized to process, set:

```bash
CAPTION_PROVIDER=yt-dlp
YT_DLP_PATH=/absolute/path/to/yt-dlp
```

The adapter invokes the executable with argument arrays, ignores ambient
`yt-dlp` configuration, downloads only the selected VTT caption track into the
job scratch directory, and does not download source video during this step.

Translation is also disabled by default because it sends transcript text to a
remote, billable service. To opt into the initial Amazon Translate adapter, set:

```bash
TRANSLATION_PROVIDER=aws-translate
AWS_PROFILE=research-video-dev
AWS_REGION=us-east-1
# Optional: AWS_TRANSLATE_TERMINOLOGY=research-project-terms
```

The implementation uses the official AWS SDK behind a provider-neutral typed
interface. Normal tests use a fake sender and make no AWS requests. Original
and translated tracks remain separate and time-linked.

The generated-transcript fallback is also opt-in. It uses `yt-dlp` to acquire
authorized source audio into job scratch storage and `whisper.cpp` for local
multilingual recognition:

```bash
MEDIA_PROVIDER=yt-dlp-audio
YT_DLP_PATH=/absolute/path/to/yt-dlp
SPEECH_TO_TEXT_PROVIDER=whisper-cpp
WHISPER_CPP_PATH=/absolute/path/to/whisper-cli
WHISPER_CPP_MODEL_PATH=/absolute/path/to/ggml-large-v3-turbo.bin
WHISPER_CPP_MODEL_NAME=large-v3-turbo
```

The adapters never enable themselves based on installed tools. The caller must
confirm source authorization, use isolated job scratch storage, and delete the
acquired audio after transcript publication or any terminal failure.

To let the local worker claim one shared job, also provide the development
authorization value for a registered project member:

```bash
WORKER_AUTHORIZATION='Bearer <user-uuid>|<external-subject>'
npm run dev:worker
```

The entrypoint processes one claim by default. Without `WORKER_AUTHORIZATION`
it remains in standby. To run it as a bounded service that stops claiming on
`SIGINT`/`SIGTERM` and drains active work before exit:

```bash
WORKER_MODE=continuous
WORKER_CONCURRENCY=2
WORKER_POLL_INTERVAL_MS=2000
WORKER_ERROR_BACKOFF_MS=5000
WORKER_LEASE_SECONDS=120
npm run dev:worker
```

Concurrency is limited to 1–8 complete claim/execution lanes. Use the smallest
value the machine and speech model can sustain; local GPU/model memory is
usually the real limit.

## Worker container

Build the same worker runtime for a local container or a later hosted runner:

```bash
docker build -f apps/worker/Dockerfile -t research-video-worker .
```

The image contains Node 22, FFmpeg, and pinned `yt-dlp`, runs as a non-root
user, defaults to continuous hosted mode, and does not bake in credentials or
large speech models. Mount a compatible `whisper-cli` installation and a
read-only GGML model, then configure the existing provider interface:

```bash
docker run --rm --env-file .env.worker \
  -e WHISPER_CPP_PATH=/opt/whisper/bin/whisper-cli \
  -e WHISPER_CPP_MODEL_PATH=/models/ggml-large-v3-turbo.bin \
  -v /host/whisper:/opt/whisper:ro \
  -v /host/models:/models:ro \
  research-video-worker
```

For a local container talking to services on the host, override
`WORKER_EXECUTION_LOCATION=local` and set `CLOUD_API_HOST` to the host gateway.
Keep `.env.worker` out of source control and inject AWS/worker credentials with
the deployment platform's secret mechanism.

## Checks

```bash
npm run check
npm run test:e2e
```

`npm run check` formats-checks, type-checks, runs unit/integration tests, builds the web app, and verifies both database migration paths without cloud credentials.
