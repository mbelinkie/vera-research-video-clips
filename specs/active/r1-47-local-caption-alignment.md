# R1 #47 — Shared local word alignment

[Research #47](https://github.com/mbelinkie/vera-research-video-clips/issues/47)

## First implementation slice

Run the Timeline word-timing CLI from Research TypeScript on authorized local
audio and English captions, and measure the real Mac path. Given a normalized
caption track, preserve its text, token IDs and order, and return measured
source-video bounds or an explicit unaligned result for each token. Use the
provider from a standalone local command so the same boundary can be exercised
without a project, a hosted worker, or a private upload.

Use the existing WebVTT normalizer and the installed `vera-word-timing` CLI
from [Timeline #183](https://github.com/mbelinkie/vera-script-to-timeline/pull/188).
Pass canonical cue and word anchors to the existing caption-to-recognition
command, then use its recognition artifact as the input to alignment. Never
substitute a caption anchor for a missing acoustic interval. Timeline MFA
emits one result per spoken unit, including explicit failures. Combine units
for a displayed token only when every returned unit has a valid acoustic
interval. The shared artifact has no independent expected-unit count, so
use results directly from the configured CLI. A refusal, unsupported
language, malformed result, or unexpected token identity fails the run with
a short local error. Clean command handoff files when the CLI returns.

## Run on a local fixture

Install Timeline's `packages/word-timing` into an isolated Python 3.12
environment. The measured package was built from Timeline main at
`a30967c5a80f659cb7b37bf535ea7906d5bd5c56`. Set
`VERA_WORD_TIMING_PATH` to its installed `vera-word-timing` executable,
`VERA_TOOLS_PYTHON` to the environment with Silero VAD 6.2.1, and
`VERA_MFA_COMMAND` to the installed MFA 3.4.3 Python command. Configure
`VERA_MFA_ROOT_DIR` for the cached MFA models and `VERA_MFA_HOME` for its
scratch data and lock. The shared package expects the English US ARPA
acoustic and dictionary models v3.0.0 and G2P model v2.0.0.

```sh
npm run --silent align:captions -- --audio source.wav --captions source.vtt \
  --video-id fixture0001 --confirm-rights
```

Use a source-aligned, 16 kHz mono signed 16-bit PCM WAV and authorized English
WebVTT. Pass `--auto` for auto captions with inline word anchors. The local
JSON result contains an alignment fingerprint and a status and interval per
Research token ID. The reported wall time includes VAD and MFA initialization
and alignment. Audio preparation and caption processing run before that timer.

## Focused checks

- English manual and automatic captions preserve token sequence and use cue or
  source word anchors as available.
- The result maps by stable Research token ID. A missing or partially aligned
  token stays unaligned. Reject mismatched identities and out-of-source bounds.
- Run the real CLI with authorized generated or public audio on the Intel Mac.
  Record source duration, model and runtime settings, and wall time per hour.

## Mac evidence

Measured using the Research command on a MacBookPro16,1, Intel Core i9-9880H
2.30 GHz (8 cores, 16 threads), 16 GiB RAM, macOS 15.1. MFA 3.4.3 ran its
English US ARPA profile in single-speaker mode with 4 jobs and G2P enabled.
Silero VAD 6.2.1 used ONNX Runtime 1.23.2.

| Input             | Alignment wall time | Minutes per hour of audio | Acoustic tokens |
| ----------------- | ------------------: | ------------------------: | --------------: |
| 89.941 seconds    |     186.110 seconds |                    124.16 |             284 |
| 3,597.630 seconds |     380.105 seconds |                      6.34 |          11,360 |

The long fixture repeats 24 English sentences spoken by macOS Samantha at
165 words per minute, 40 times. Captions use the sentence audio boundaries
with 250 ms of silence between sentences. The two tokens from a bracketed
sound cue remained unaligned in both runs. This measures throughput on clean,
repeated single-speaker audio. Playback accuracy with real video is a separate
acceptance check.

Feeding the short fixture's measured timings to the existing selection
function gave 510–1,440 ms for “opened the interview,” using the first word's
onset and the last word's offset.

## Captionless and publication checkpoint

Research passes the incumbent recognizer's display tokens and segment anchors
to Timeline's recognition-artifact builder, then runs the same MFA model. A
real Mac run on 22 seconds of the generated speech used whisper.cpp
`small.en`, without consulting the fixture captions. Recognition took
20.18 seconds and produced 70 tokens over six segments. The shared alignment
command took 147.32 seconds and returned acoustic bounds for all 70 tokens.
The existing selection function used those acoustic bounds for “opened the
interview” at 510–1,440 ms.

The worker pipeline has an injectable alignment stage before translation and
publication. It acquires audio for a supported caption track or reuses the
recognizer's audio. The tests verify that the audio remains available while
the provider is running and that a job which lost its lease skips publication.
Aligned bundles carry a fingerprint and per-token alignment statuses. SQLite
keeps those fields alongside the existing cue and estimated data. The
transcript view marks unaligned words and uses cue bounds when they are
selection endpoints. Timeline #51 accepted no replacement recognizer.

## Remaining issue acceptance

1. Use a shared CLI release with supported cancellation. A focused mock-engine
   run on the Mac established that sending SIGTERM to the pinned shared runner
   exits its caller while the isolated engine process stays alive. The
   worker's production alignment setting awaits
   [Timeline #664](https://github.com/mbelinkie/vera-script-to-timeline/issues/664).
2. Wire the supported runner into the worker. Prepare 16 kHz mono PCM audio
   in the job directory, pass through the lease abort, and retain scratch
   whenever engine shutdown cannot be confirmed. Limit acoustic bounds to the
   spoken source track and keep cue timing for unsupported languages.
3. Highlight phrases from one authorized captioned video and one authorized
   captionless video. Check first and last word playback and the visible
   unaligned state in the browser before accepting the whole issue.

Hosted execution, audio cleanup, replacing the recognizer, regenerating cached
transcripts, and Resolve work are outside this slice.
