# Research #83 — Library audio

[Issue #83](https://github.com/mbelinkie/vera-research-video-clips/issues/83) follows the accepted [Research Sources spec](https://github.com/mbelinkie/vera-script-to-timeline/blob/main/docs/plans/research-sources-spec.md) §§4.5, 5.3 and 11.

## Outcome

In the selected project, add an audio file or a direct public audio URL. Open its waveform, play the source, set in and out, and log a named selection with optional role and Topics. A Speech source supports passage selection from the normalized transcript and retains the excerpt in the logged item.

## Boundaries

- Reuse Library sources, items, Topics, project roles and private versioned object storage. Couple source and verified asset publication in one catalog transaction.
- For a file, the browser keeps the original on the device and shares an audio preview of at most 15 seconds, a waveform and an original checksum. Require the original to be relinked when it is no longer open locally. A public URL import keeps a verified playable copy via the existing pinned public URL guard.
- Show provider timing precision, including approximate cue timing. Use synthetic or authorized public inputs for verification.
- Editor-only placement of YouTube clips as audio, the separate aligner issue, and the larger Research redesign are outside this slice.

## Failure states

Reject inaccessible URLs, unsupported or oversize media, unauthorized requests, out-of-bounds selections and mismatched relinked originals. Missing or corrupt stored assets report unavailable. Failed imports never create a project source visible without its asset. A missing or failed Speech transcript must leave waveform and manual selection available.

## Acceptance and verification

- Import a file and a URL as a project writer. Verify waveform, playback, saved name and in/out, optional role, Topics and reload through the Library API.
- Verify reads and writes enforce project membership and permissions, retries are idempotent, private file originals stay local, and corrupt assets cannot play.
- Transcribe generated speech through the existing Research transcription path, save a passage from its words and verify the excerpt and bounds.
- Run focused media, API, catalog and workspace tests before `npm run check`. Exercise the UI with generated files and an authorized public audio URL. Pass protected Test CI before merging.

## Checkpoint handoff

This branch implements the import and playback foundation. The issue remains open with its original acceptance criteria.

- `POST /api/projects/:projectId/audio/from-file` takes `AudioFileImportSchema` JSON. Call `prepareLocalAudio(file)` in the browser for waveform and the mono 8 kHz PCM preview. Compute `originalSha256` locally from the File bytes and base64-encode the preview. Keep the original File for local playback and require the same checksum when relinking.
- `POST /api/projects/:projectId/audio/from-url` takes `AudioUrlImportSchema`. It fetches anonymous direct audio with the pinned public URL guard and uses FFmpeg to inspect and decode within the size and duration limits. URL import requires the existing local FFmpeg tool.
- `GET /api/projects/:projectId/audio/:sourceId` returns the waveform, source duration, playable duration and provenance. Fetch `/playback` with the existing authenticated client, then create and revoke a browser object URL. Use the original File for playback beyond the shared 15-second preview.
- Save through `POST /api/projects/:projectId/items` with `kind: "audio"`, `sourceId`, `content: { title, startMs, endMs, role?, text? }` and `topics`. The Library rejects an unnamed or out-of-bounds selection from an imported source.

### Resume the workspace and Speech integration

1. Sync with current main. The checkpoint started at `9f106ed`. Main advanced to `c596bbd` with #47 while work was underway.
2. Add the Library audio workspace using the selected project and `cloudFetch`, following `stills-workspace.tsx` for project and session handling. Wire import, source list, waveform, playback, checksum-verified Relink, and named in/out selection. List saved selections by source. Distinguish preview length from full source duration.
3. The current worker pipeline accepts a YouTube video ID, acquires media with yt-dlp, and publishes a YouTube transcript bundle. It cannot consume a Library audio asset. Reuse the existing `WhisperCppSpeechToTextProvider` and `normalizeGeneratedTranscript` with a Library source ID validated separately from YouTube IDs. Use bounded job scratch and clean the original audio input after transcription. Public URL sources already have a project-authorized kept copy. Private file originals require a workstation-local path from the open or relinked File. The managed Mac UI has a loopback agent proxy. The hosted browser explicitly blocks local-agent routes, so a hosted-browser Speech flow needs a deliberate workstation integration.
4. Reuse `VirtualTranscript` and `deriveTranscriptSelection` for passage selection. Current Whisper normalization yields stable word tokens with cue-level bounds. Label the timing as approximate and store the excerpt in `content.text`. The distinct word aligner work belongs to #47. Reuse the original-language track for local verification, since the existing English translation route uses a paid provider.
5. Verify in the real Library UI before moving to review. Keep file originals local, save from both origins, and exercise Speech from a generated recording. Run the full repository check and protected Test CI before merging.

### Checkpoint evidence

- In a temporary Chromium harness and project catalog, a generated 20-second WAV produced 256 waveform bins and a 15-second shared preview of 240,044 bytes. The public MDN audio demo downloaded through the live guard and decoded as a 2.091-second MP3. Chromium played both authenticated assets, and both saved named in/out selections with a role and Topic. [MDN audio demo](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio#try_it)
- Existing local Whisper `small.en` transcribed a generated sentence. Selecting “research audio is ready for review” through `deriveTranscriptSelection` yielded the excerpt with cue bounds of 0–2,580 ms. This exercised the provider and selection functions directly. Library Speech still requires integration.
- Focused Vitest passed 19 tests across audio imports, FFmpeg analysis, browser waveform preparation, the project Library API and cloud migrations. The rerun used a 45-second per-test limit after two existing Library tests exceeded the default 15 seconds on this Mac. Formatting, TypeScript, and the web build passed.
- This is a branch checkpoint pending Library UI and Speech integration. The full repository gate and protected CI are pending.
