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

## Local worker enablement

Timeline #664 shipped in [PR #668](https://github.com/mbelinkie/vera-script-to-timeline/pull/668).
The Mac worker uses that package from `897b6110b859fe12e50e5f9546e0d084d9aa5ba8`.
Opt in with `VERA_WORD_TIMING_PYTHON` and local audio acquisition. The provider
prepares 16 kHz mono PCM in job scratch and uses a unique cancellation marker.
On lease loss it waits for the CLI's confirmation before cleaning up. It keeps
job scratch when shutdown is unconfirmed. The worker preserves cue timing
for unsupported tracks.

On the same Intel Mac, the cancellation-capable worker provider processed
3,597.630 seconds of the generated workload in 237.658 seconds, including
audio preparation, caption handoff, VAD, and MFA. That is 3.96 minutes per
hour of audio. It produced 11,360 acoustic tokens and two unaligned sound-cue
tokens. This run used the same four-job MFA profile with worker-mode SQLite.
In a separate Mac run through the same CLI, a fake VAD process was gone
0.10 seconds after a lease abort. Research observed the confirmation first.

## Live browser evidence

- On an authorized NASA Marshall video, Research processed the downloaded
  English manual caption track and published 143 acoustic tokens. Selecting
  “Hi, my name is” gave 0.220–1.160 seconds. Chrome looped the actual embedded
  video through that range. [NASA video](https://www.youtube.com/watch?v=p0W_cxbbTQA)
- The official Blender Foundation Sintel trailer went through whisper.cpp
  with caption acquisition disabled in the managed test worker. The resulting
  transcript had 31 acoustic tokens and six unaligned tokens. Selecting
  “What brings you to” gave 12.220–12.990 seconds, and Chrome looped it.
  Chrome displayed a dotted underline and an accessible cue-timing label on
  the unaligned sound cue. [Sintel trailer](https://www.youtube.com/watch?v=HOfdboHvshg)

The live run led to accepting YouTube's WebVTT `Kind` and `Language` headers,
and to handing both preview bounds to the player. The former preview's
250 ms clock poll could let playback cross the selected end.
[YouTube IFrame player API](https://developers.google.com/youtube/iframe_api_reference#Queueing_Functions)

## Remaining issue acceptance

Repeat the generated-source playback check with an authorized video that has
no available captions in the normal acquisition configuration. Two NASA
candidate videos exposed zero manual and automatic tracks, and neither
produced a verified spoken transcript in the live run.

Hosted execution, audio cleanup, replacing the recognizer, regenerating cached
transcripts, and Resolve work are outside this slice.
