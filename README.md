# Research Video Transcript & Clip Extraction Tool

Shared-project research software for resolving English transcripts, navigating YouTube videos by transcript, logging candidate ranges, and exporting editing-ready clips.

The authoritative product and architecture plan is in [`PROJECT_GUIDE.md`](./PROJECT_GUIDE.md). The active implementation checklist is in [`outline.md`](./outline.md).

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
