# Research Video Transcript & Clip Extraction Tool

Shared-project research software for resolving English transcripts, navigating YouTube videos by transcript, logging candidate ranges, and exporting editing-ready clips.

The authoritative product and architecture plan is in [`PROJECT_GUIDE.md`](./PROJECT_GUIDE.md). The active implementation checklist is in [`outline.md`](./outline.md).

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

For an **opt-in local Mac PostgreSQL/transcript-store pilot** (not friend-facing),
see [the #50 data and backup operator guide](./docs/operations/mac-pilot-data.md).
No service installation, live migration or external networking is performed by
the application defaults.

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

When the **original YouTube automatic-caption VTT** includes unambiguous
per-word timestamps, the normalizer preserves its source-reported word starts.
It estimates each word's end as the earliest of the next word start, 500 ms
after the word start, and the caption cue end. The end is labelled **derived**;
the resulting transcript and selections have `estimated` precision, **not**
acoustically aligned or frame-exact word ends. Seeking uses the reported start;
phrase selections retain the last derived end, with independently editable
export padding. Manual captions, generated whisper.cpp output and translated
English from foreign-language captions do **not** gain invented word timings.
The original foreign-language auto-caption track may retain word starts while
its separately stored English translation remains cue-timed. New timed tracks
have their own content identities and persist the derived-end label through
publication, verified caching, logged clips and export snapshots.

The existing browser transcript is still an explicitly labelled demo fixture,
not a live transcript lookup. The deterministic `/?fixture=auto-word-timed`
demo after loading the API test video illustrates exact caption starts,
estimated ends, selection, preview and queue/export payloads; it does not
connect the live YouTube caption provider to browser transcript loading.

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

## Cut logged project clips to local files (#20)

Use this **foreground, opt-in** path on the Mac when a project clip is already
logged and its exact original/English transcript version is published in the
authorized project's verified cache. Install `yt-dlp`, `ffmpeg` and `ffprobe`
on that machine (for example using your local package manager); confirm you
have rights to process the selected video. These tools are not automatically
enabled and the service will never infer consent from a video URL.

```bash
EXPORT_SOURCE_PROVIDER=yt-dlp
YT_DLP_PATH=/absolute/path/to/yt-dlp
FFMPEG_PATH=/absolute/path/to/ffmpeg
FFPROBE_PATH=/absolute/path/to/ffprobe
# Optional: CLIP_EXPORT_DIR=/absolute/private/output/folder
```

Export the settings into the local shell before running the command or server;
editing `.env` alone does not make `npm` load it automatically. If you keep
the settings in an untracked `.env` file, use `set -a; . ./.env; set +a`
in the shell that starts the service (do not source untrusted files). The default
output folder is `DATA_DIR/exports` (by default `./data/exports`), and every
clip is placed in a directory named for its UUID. Start the authenticated
cloud API locally with `npm run dev:cloud-api`, using its documented project
member authorization. The clip cut command opens the local SQLite verified
cache directly; a running local-agent server is **not** required for the CLI.

```bash
export RESEARCH_AUTHORIZATION='Bearer <registered-project-member-credential>'
npm run clip:cut -- \
  --project-id <project-uuid> \
  --clip-id <logged-clip-uuid-1> \
  --clip-id <logged-clip-uuid-2> \
  --confirm-rights
```

`RESEARCH_AUTHORIZATION` is read **only from the environment**, never from
command-line flags or JSON request bodies. Keep it out of shell history and
logs (for an interactive shell, enter it privately with `read -rs RESEARCH_AUTHORIZATION`
and then `export RESEARCH_AUTHORIZATION`). This local path uses the existing
development project-member bearer API, not a browser Cognito cookie session;
do not expose the legacy development bearer endpoint to public networks.
The command exits nonzero with one concise error sentence if the source,
project membership, exact transcript version, required language track, media
tools or source rights are unavailable. Success writes JSON on stdout:

```json
{
  "clips": [
    {
      "clipId": "<logged-clip-uuid>",
      "videoId": "<youtube-video-id>",
      "folder": "<absolute-export-folder>/<logged-clip-uuid>",
      "mediaPath": "<folder>/<logged-clip-uuid>.mp4",
      "subtitlePaths": ["<folder>/<logged-clip-uuid>.en.srt"],
      "manifestPath": "<folder>/<logged-clip-uuid>.json"
    }
  ]
}
```

For the loopback API, run `npm run dev:local-agent` with the **same** provider
settings and the cloud API available. A Prep Media client can call:

```bash
curl --fail-with-body -X POST \
  'http://127.0.0.1:43110/api/projects/<project-uuid>/clips/cut' \
  -H "Authorization: ${RESEARCH_AUTHORIZATION}" \
  -H 'Content-Type: application/json' \
  --data '{"clipIds":["<logged-clip-uuid-1>","<logged-clip-uuid-2>"],"authorizationConfirmed":true}'
```

The endpoint accepts **1–20 distinct clip UUIDs**, an authenticated project
bearer and explicit rights confirmation; rejects caller-provided URLs or
paths; and responds `200` with the same `{ "clips": [...] }` payload. Errors
use `{ "error": { "code", "message", "retryable" } }` and non-2xx HTTP
status. A request with no valid bearer is rejected before catalog lookup or
acquisition. `EXPORT_SOURCE_PROVIDER=disabled` refuses cutting even if other
media adapters are enabled. This is a local file handoff, **not** a cloud
export queue update; existing `POST /api/exports` still enqueues as before.

Two or more clips from the **same video in one invocation** share a single
temporary full-source download. Each result is an editing H.264/AAC MP4, a
small hash/track/bounds manifest, English clip-relative SRT, and (for non-English
or uncertain language) a separate original-language SRT. Full-source scratch
is deleted and absence verified before success is reported. Later, independent
invocations may download the source again rather than retaining full videos.
Existing output folders are never overwritten. The final Mac acceptance check
should inspect codecs/duration with `ffprobe` and **listen** for the logged
first and last spoken words; subtitle metadata alone cannot prove audible
word-exact timing.

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

### R1 invite-only browser authentication (#51, local implementation; external verification pending)

The external pilot uses a **same-origin Fastify browser backend-for-frontend** and Amazon Cognito Managed Login (authorization code + S256 PKCE). Never expose the existing development `Bearer <uuid>|<subject>` API, Vite development server, worker endpoints or `/local-agent` to friends. Production `NODE_ENV=production` fails startup unless `CLOUD_AUTH_MODE=browser`; both modes bind the cloud API to loopback. An approved HTTPS TLS ingress must forward **only** browser BFF traffic; the browser BFF serves the compiled web bundle and rewrites same-origin `/cloud-api/*` to its authenticated routes. Cloudflare Access, if added ahead of the BFF in #53, is an outer gate only—users may see two prompts, and Access does not grant project membership.

Configure server-only `CLOUD_AUTH_MODE=browser`, `BROWSER_PUBLIC_ORIGIN`, `BROWSER_CALLBACK_URL` (exact `${BROWSER_PUBLIC_ORIGIN}/cloud-api/auth/callback`), `BROWSER_LOGOUT_URL` (exact origin root with slash), `COGNITO_ISSUER` (actual Cognito pool issuer), `COGNITO_DOMAIN` (Managed Login HTTPS origin), `COGNITO_CLIENT_ID` and `COGNITO_CLIENT_SECRET`; optionally `TRUSTED_PROXY_PEERS` (explicit loopback peers), `BROWSER_SESSION_IDLE_MS` (default 30 minutes) and `BROWSER_SESSION_ABSOLUTE_MS` (default eight hours). `.env.example` contains **placeholders only**, not real domains or credentials. Build the frontend with `npm run build:web`; the BFF serves `dist/web` on its internal loopback port. TLS termination belongs to the approved ingress; **do not deploy** without a real, Producer-approved external origin/callback and separate authorization.

The Cognito user pool must be **admin-create-only** (`AllowAdminCreateUserOnly=true`, self-service signup disabled), with a confidential server-side web client configured for authorization-code flow, S256 PKCE, and exact HTTPS callback/logout allowlists. Administrators invite new Cognito users outside this application; project owners grant access **only to already-registered VERA users**. The BFF never takes browser-supplied identity or role when registering. The local tests use fake identities; they **do not prove** real Cognito signup restriction, admin-created first-password challenge, live refresh or revocation. Before External acceptance, inspect the pool settings, negatively test public `SignUp`, use two specifically authorized invited test identities through real Managed Login, verify session renewal/revocation and review redacted network evidence. #53 owns the Cloudflare/Tunnel/outside-network pilot. Local Mac sleep/unavailability shows retry; in-memory sessions disappear on server restart and require login again; no authentication downgrade is permitted.

Local-only checks: `npm run check` and the separate secure browser fixture (`npm run build:web` then `npx playwright test --config playwright.auth.config.ts`, with Chromium/Playwright and OpenSSL installed). This fixture generates throwaway self-signed HTTPS certificates at runtime, mocks Cognito entirely and uses two isolated browser contexts. The existing plain HTTP Vite demo still supports its development test credentials **only** on loopback in explicit development mode.
