# Local startup and end-to-end testing

This guide describes the source-checkout workflow through Milestone 6. The
examples use a macOS/Linux `zsh` or `bash` shell. Milestone 7 replaces these
ordinary-use steps on the current Intel Mac with a locally built, unsigned
Electron `.app`, real Cognito login, supervised services/workers, and in-app
setup. Signed cross-platform installers, automatic updates, remote-tester
documentation, reporting, and independent QA are Milestone 8 work.

## What works locally today

There are three useful test levels:

1. **Network-free verification** proves the contracts, databases, UI, M6 Clip
   Library, authoring handoff, and real FFmpeg/FFprobe fixture exports.
2. **Interactive browser smoke** runs the web app, local agent, and cloud API,
   and lets you create a development identity/project, navigate the two built-in
   transcript fixtures, log clips, use the Clip Library, preflight batches, and
   test restart persistence.
3. **Authorized live-source processing** uses `yt-dlp` only after you confirm
   that you may process the source. It is deliberately opt-in.

Two limits are important:

- The current review UI supplies selectable transcripts only for the built-in
  `M7lc1UVf-VE` English fixture and `Romanian001` multilingual fixture. An
  arbitrary batch item can open in the player, but its resolved transcript is
  not yet hydrated into the selection UI.
- The default `OBJECT_STORE_MODE=memory` is suitable for UI/catalog development
  and tests, but a separate transcription worker cannot publish through its
  process-local `memory-upload://` grants. A real batch-to-published-transcript
  run requires the configured S3 development stack. This is not required for
  Clip Library or local export testing.

Accordingly, the most repeatable end-to-end proof today is the browser/catalog
smoke plus the deterministic media fixture test. Do not interpret the built-in
YouTube fixture as permission to download or render that source.

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- FFmpeg and FFprobe on `PATH` for export tests
- Chromium installed by Playwright for browser tests
- Optional: `yt-dlp` for an explicitly authorized live-source run
- Optional: `whisper.cpp`, a GGML model, Amazon Translate credentials, and the
  S3 development stack for real transcription batches

Verify the core tools:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## First-time setup

From the repository root:

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

The application has safe defaults even without `.env`. The npm scripts do not
load `.env` automatically, however. After editing it, load it into each new
shell before running a service:

```bash
set -a
source .env
set +a
```

The default local data is stored under `./data`:

- `data/cloud-catalog/` — persistent PGlite shared catalog
- `data/local.sqlite` — local cache, export queue, Clip Library state, and
  artifact locators
- `data/exports/` — finalized local clip packages

To test from a clean state without deleting existing work, set `DATA_DIR` in
`.env` to a new directory, such as `./data-smoke-1`.

## Start the application

In terminal 1:

```bash
set -a
source .env
set +a
npm run dev
```

This starts:

- web: <http://127.0.0.1:43112>
- local agent: <http://127.0.0.1:43110>
- cloud API: <http://127.0.0.1:43111>

With the default disabled providers, the transcription worker prints a standby
message and exits; the other three development services remain running.

In terminal 2, verify the services:

```bash
curl -fsS http://127.0.0.1:43110/health
curl -fsS http://127.0.0.1:43111/health
curl -fsS http://127.0.0.1:43112/
```

## Create a development identity and project

Development authentication uses a stable UUID and external subject. Reuse the
same credential after restarts or the existing projects will belong to a
different development user.

In terminal 2:

```bash
export DEV_USER_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
export DEV_AUTHORIZATION="Bearer ${DEV_USER_ID}|local-dev"

curl -fsS -X POST http://127.0.0.1:43111/api/session/register \
  -H "Authorization: ${DEV_AUTHORIZATION}" \
  -H 'Content-Type: application/json' \
  --data '{"displayName":"Local Researcher"}'

curl -fsS -X POST http://127.0.0.1:43111/api/projects \
  -H "Authorization: ${DEV_AUTHORIZATION}" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Local Smoke Project","description":"M6 local test"}'
```

The value printed by the following command is the credential to paste into the
browser's **Development session credential** field:

```bash
printf '%s\n' "${DEV_AUTHORIZATION}"
```

Click **Connect**. The credential is held only in browser memory, so reconnect
after a page reload.

## Interactive research and Clip Library smoke

Use this sequence to exercise the currently wired UI path:

1. Keep the default English URL and click **Load video**.
2. Click transcript words and confirm the player seek message changes.
3. Search for `accurate`, then use the next/previous match controls.
4. Drag across a contiguous transcript phrase to create a selection.
5. Choose `Local Smoke Project`, add a note and tags, and click
   **Queue / log only**. This must create a clip without creating an export.
6. In **Clip Library**, search for the note or tag. Edit the note/tags and test
   the research/export-status filters.
7. Click **Export CSV** and verify that the row includes the stable project and
   clip IDs.
8. Reload the browser, reconnect with the same credential, and confirm that the
   clip, filters/page snapshot, and selected Clip Library items recover.
9. Load `Romanian001` as the video ID to exercise Romanian original, English,
   and Spanish preferred-language evidence. This is a transcript fixture, not a
   playable or downloadable YouTube source.
10. Log two more selections so the project has three clips from two fixture
    video IDs. Select clips in the Clip Library, click **Preflight … clips**,
    confirm unknown source sizes if prompted, and click **Submit durable
    batch**. This tests M6 storage preflight and durable batch creation; it does
    not itself run media processing.

Expected behavior:

- Queue-only clips stay at `not requested` until an export is submitted.
- Notes, tags, language evidence, filters, and selection survive a restart.
- Clip Library completion history and local artifact availability are displayed
  separately.
- Low disk blocks only the heavy export operation, not browsing or logging.

## Run a deterministic media export

This is the preferred way to test real FFmpeg/FFprobe processing without a live
provider or rights question:

```bash
npm run test:fixture:foreign-30s
```

It renders the checked-in 32-second synthetic source to an exact 30-second
H.264/AAC clip, generates original-language and English SRTs, verifies media and
artifact hashes, checks clip-relative subtitle bounds, proves replay does not
reacquire media, and verifies source scratch deletion.

To test all supported renderer families and the complete repository gate, run:

```bash
npm run check
npm run test:e2e
```

`npm run check` runs formatting, type checking, the network-free unit and
integration suite, the production web build, and both migration validators.
`npm run test:e2e` runs four mocked Chromium UI flows and starts only the Vite
web server; it is not a live-service or live-YouTube test.

For a focused M6 regression run:

```bash
npx vitest run \
  packages/contracts/src/index.test.ts \
  packages/catalog/src/index.test.ts \
  apps/cloud-api/src/app.test.ts \
  apps/local-agent/src/clip-library.test.ts \
  apps/local-agent/src/export-storage-preflight.test.ts \
  apps/local-agent/src/artifact-locators.test.ts \
  apps/local-agent/src/local-runtime.test.ts \
  tests/integration/authoring-handoff.test.ts
```

## Process a local export-only request

Only do this for a source you are authorized to process.

1. Install `yt-dlp` and set these values in `.env`:

   ```dotenv
   EXPORT_SOURCE_PROVIDER=yt-dlp
   YT_DLP_PATH=/absolute/path/to/yt-dlp
   ```

2. Restart `npm run dev` after sourcing `.env` so the local agent is composed
   with the provider.
3. In the UI, select a passage and click **Export only**.
4. List the local requests and copy the newest request's `id`:

   ```bash
   curl -fsS http://127.0.0.1:43110/api/exports
   ```

5. In another sourced shell, run exactly one confirmed request:

   ```bash
   npm run export:run-once -- \
     --request-id <request-uuid> \
     --authorization-confirmed
   ```

The package is finalized under `data/exports/` only after its media, subtitle,
metadata, thumbnail, and manifest checks pass and source scratch deletion is
verified. Re-running the same completed request reports it without rendering it
again.

If the selectable UI fixture is not a source you are authorized to process, do
not run this path; use the deterministic fixture test instead.

## Process a logged export manually

Logged export delivery is durable but does not yet have an always-on local
export supervisor UI. The current source-checkout operator flow is explicit:
register the workstation, claim one request, then process that accepted request.
The local agent must have started with `EXPORT_SOURCE_PROVIDER=yt-dlp`, and the
source must be authorized.

Register the local export worker immediately before submitting/claiming work:

```bash
curl -fsS -X POST http://127.0.0.1:43110/api/export-workers/register \
  -H "Authorization: ${DEV_AUTHORIZATION}"
```

The registration expires after 60 seconds. Refresh it when needed:

```bash
curl -fsS -X POST http://127.0.0.1:43110/api/export-workers/heartbeat \
  -H "Authorization: ${DEV_AUTHORIZATION}"
```

In the browser, use **Export + log** or submit a Clip Library export. Then claim
one queued request:

```bash
curl -fsS -X POST http://127.0.0.1:43110/api/export-deliveries/claim \
  -H "Authorization: ${DEV_AUTHORIZATION}"
```

Copy `delivery.request.id` from the response, then process it:

```bash
curl -fsS -X POST http://127.0.0.1:43110/api/export-deliveries/process \
  -H "Authorization: ${DEV_AUTHORIZATION}" \
  -H 'Content-Type: application/json' \
  --data '{"requestId":"<request-uuid>","authorizationConfirmed":true}'
```

Repeat claim/process for each batch item. The Clip Library should progress from
queued to processing to complete independently for each item. After completion,
test **Resolve**, **Verify**, **Reveal**, and **Open clip**. Moving a completed
package should produce a missing result until it is verified and explicitly
relinked under a configured artifact root; a re-export creates a new immutable
artifact version.

## Optional transcription worker

Real transcription is a separate opt-in path. At minimum, configure authorized
audio acquisition and local speech recognition:

```dotenv
CAPTION_PROVIDER=yt-dlp
MEDIA_PROVIDER=yt-dlp-audio
YT_DLP_PATH=/absolute/path/to/yt-dlp
SPEECH_TO_TEXT_PROVIDER=whisper-cpp
WHISPER_CPP_PATH=/absolute/path/to/whisper-cli
WHISPER_CPP_MODEL_PATH=/absolute/path/to/model.bin
WHISPER_CPP_MODEL_NAME=large-v3-turbo
OBJECT_STORE_MODE=s3
TRANSCRIPT_BUCKET=<development-bucket>
AWS_REGION=us-east-1
```

Non-English sources also require the explicitly enabled translation provider
unless a reusable English track already exists. After the user is registered
and the S3 development stack is available, start a continuous worker in a
separate sourced shell:

```bash
export WORKER_AUTHORIZATION="${DEV_AUTHORIZATION}"
export WORKER_MODE=continuous
export WORKER_CONCURRENCY=1
npm run dev:worker
```

Submit a batch from the browser's **Transcription queue**. Confirm independent
item progress, retry/failure behavior, and `Ready for review`. Stop the worker
with Ctrl-C and allow it to drain its active claim.

## Guarded live-source smoke

The repository also contains a temporary, self-cleaning live-source verifier.
Run it only after separate authorization and with an absolute, external JSON
descriptor matching `LiveYouTubeSmokeDescriptorSchema` in
`apps/local-agent/src/live-youtube-smoke.ts`:

```bash
npm run export:live-smoke -- \
  --authorization-confirmed \
  --live-smoke-authorized \
  --smoke-config /absolute/path/outside-this-repository/smoke.json
```

It requires `EXPORT_SOURCE_PROVIDER=yt-dlp`, validates all opt-ins before
provider access, emits only sanitized evidence, and removes its entire temporary
workspace. This M5 verifier does not by itself satisfy the still-open M6
real-source exit proof.

## Terminal and fixture gaps assigned to M7

Milestone 6 is complete. The source-checkout workflow above remains useful for
development, but M7 cannot close until the locally built Intel macOS `.app`
eliminates every ordinary-user gap below:

- Finder/Dock launch replaces `npm run dev` and supervises the web renderer,
  local agent, transcription worker, and export worker with bounded recovery and
  M6 drain/quiescence.
- Cognito login plus protected desktop storage replaces UUID generation,
  `/api/session/register`, the pasted development bearer credential, and manual
  reconnect after reload.
- In-app first run replaces `.env` editing/sourcing for roots, provider choices,
  tool paths, model selection/download, and translation consent.
- Real shared/local transcript resolution replaces the two selectable fixture-
  only workspace paths; any supported ready project video must hydrate its
  verified original, English, and preferred-language tracks for navigation,
  search, and selection.
- The production S3/control-plane path replaces process-local memory upload
  grants for real transcription publication.
- Supervised transcription replaces a separately sourced `npm run dev:worker`
  shell and manual `WORKER_AUTHORIZATION` configuration.
- Automatic local export-worker registration, heartbeat, claim, execution, and
  reconciliation replace the manual register/heartbeat/claim/process `curl`
  sequence for logged work.
- UI-driven rights confirmation and automatic local execution replace
  `npm run export:run-once` for persisted export-only work.
- In-app health, progress, retry/cancel, and remediation replace terminal logs
  and operator-only troubleshooting for normal supported failure states.

M8 later proves signing, clean remote installation, updating, documentation,
reporting, and cross-platform behavior; those are not M7 exit conditions.

## Troubleshooting

- **The browser says the user is not registered:** call
  `POST /api/session/register` with the exact credential pasted into the UI.
- **No projects appear:** reuse the same UUID/external-subject pair, then click
  **Connect** again.
- **Settings say no compatible worker is available:** install FFmpeg/FFprobe,
  register the local export worker, and submit/claim before its heartbeat
  expires.
- **An export stays queued:** logged delivery is manual in the current checkout;
  run the register, claim, and process calls above.
- **A transcription upload uses `memory-upload://`:** switch to the configured
  S3 development object store; the memory adapter is process-local.
- **Changes to `.env` have no effect:** source it into the shell and restart the
  affected process.
- **A browser reload looks signed out:** the development credential is kept only
  in React memory; paste it and reconnect.
- **Ports are already in use:** stop the older dev processes or change the three
  port values consistently, including the Vite proxy configuration if the
  local-agent/cloud ports change.
