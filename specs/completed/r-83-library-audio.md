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
- Run focused media, API, catalog and workspace tests before `npm run check`. Exercise the UI with generated files and an authorized public audio URL. Pass protected Check CI before merging.

## Implementation record

Recovered checkpoint `5c5594320125f569d77fcbf3ed63b9bc7511aa22`. Merge
`a991642` brought the checkpoint onto main at `3811944`, including the
mixed Sources and Library workspace from #81 and the alignment work from #47.
Implementation commit `50b0802` wires the audio workspace into those surfaces.

- Sources offers audio URL and file import, waveform and playback, checksum-based
  Relink, role editing, and named in/out selections with Topics. Library details
  can play a saved selection and show its waveform and Speech excerpt.
- The file import shares the waveform and a bounded mono preview. The browser
  keeps the exact original in memory until it leaves the project, loads another
  original, or reloads. Relink restores full playback by matching the original
  SHA-256. Public URL import keeps a verified private asset through the pinned
  public URL transport and bounded FFmpeg decoder.
- Speech uses the existing Whisper CLI adapter and normalized transcript model.
  The workstation verifies the file checksum and feeds bounded PCM through
  stdin. It publishes text, timing, language and model after the user requests
  transcription and sharing. The catalog accepts one complete transcript for
  the kept asset and reuses it for authorized readers. A configured Research
  host can also process kept URL audio using local Whisper. The transcript uses
  the recorded language and labels cue timing as approximate.
- Desktop IPC accepts binary upload only for the workstation Speech route and
  returns binary playback only from the authorized audio playback route. The
  hosted web session keeps its existing separation from the local agent.

## Verification

- Focused Vitest covered media bounds, malformed media, waveform preparation,
  project permissions, idempotency, storage verification, the Speech API,
  desktop client boundaries, Library and migrations. 93 passed and 2 optional
  PostgreSQL tests skipped.
- Chromium passed 20 existing Workspace and Research catalog tests.
- The Linux desktop build bundled the renderer, preload, local agent and
  transcription worker. The final full Check and merge evidence is recorded
  on [PR #147](https://github.com/mbelinkie/vera-research-video-clips/pull/147).
- In the actual Research UI, a generated 20.835-second WAV produced 256
  waveform bins and a 240,044-byte preview covering 15 seconds. After reload,
  the preview played, Relink rejected a different file and restored the full
  recording from the matching file, and the original was sent only to the
  workstation loopback agent. FFmpeg and Whisper `tiny.en` recognized words
  generated after the preview ended. A selection saved “research audio is
  ready for” with Speech role, Topics and approximate bounds of 0–19,760 ms.
- The same UI imported an authorized MDN audio fixture by URL, played its
  waveform and saved a named Sound effect selection with manual bounds and a
  Topic. Both selections survived reload. The fixture host supplied the MDN
  bytes at the fetch adapter because the cloud executor could not reach the
  sample through direct pinned egress. The protected network guard remains on
  the production path. A generated MP3 exercised the host's URL Speech route
  with the real FFmpeg and Whisper runtime. [MDN audio demo](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio#try_it)

## Mac acceptance

Open a real project in the installed macOS Electron app with its configured
FFmpeg and Whisper model. Verify the native file chooser, relink the generated
original, play it through the `rvc://app` renderer, and transcribe it through
the packaged authenticated loopback agent. Reload and verify that the shared
preview and transcript reappear. This is the remaining native check.
