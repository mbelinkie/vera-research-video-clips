# Approved Whisper large-v3-turbo model pin

Accessed: 2026-08-25

## Decision

The desktop's approved local speech model is the upstream whisper.cpp GGML
artifact `ggml-large-v3-turbo.bin`. The public release configuration pins this
exact immutable artifact:

| Field                         | Approved value                                                     |
| ----------------------------- | ------------------------------------------------------------------ |
| Public name                   | Whisper large-v3-turbo                                             |
| Upstream repository           | `ggerganov/whisper.cpp` on Hugging Face                            |
| Immutable repository revision | `5359861c739e955e79d9a303bcbc70fb988958b1`                         |
| Artifact                      | `ggml-large-v3-turbo.bin`                                          |
| Exact byte count              | `1,624,555,275`                                                    |
| SHA-256                       | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` |
| License                       | MIT                                                                |

Immutable HTTPS artifact URL:

```text
https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin
```

The URL names a 40-hex repository commit rather than the mutable `main` branch.
The app may follow only its bounded HTTPS artifact-host redirects and still
verifies the complete body against the exact byte count and SHA-256 before
atomic promotion.

The pinned Electron 43 runtime was also checked against the live immutable URL
on 2026-08-25. Electron `net.fetch` rejects `redirect: "manual"` responses with
`Redirect was cancelled`, so it cannot expose the redirect location for this
allowlist decision. The main process therefore uses Node's built-in streaming
HTTPS fetch for this single app-owned download. Renderer authority does not
change: the fixed release URL is still selected natively, every redirect is
handled manually and limited to HTTPS on `huggingface.co` or `*.hf.co`, and the
body remains subject to the same exact size, oversize, SHA-256, cancellation,
private staging, and atomic-promotion checks.

## Primary sources and provenance

- [whisper.cpp model documentation](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)
  identifies the Hugging Face `ggerganov/whisper.cpp` repository as the manual
  source for pre-converted GGML models, lists `large-v3-turbo` as multilingual
  and approximately 1.5 GiB, and labels its displayed 40-hex value as `SHA`.
  That 40-hex value was not used as SHA-256.
- [Immutable Hugging Face repository tree](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1)
  identifies the resolved repository revision and artifact.
- [Hugging Face model card](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/README.md)
  identifies these bytes as OpenAI Whisper models converted to GGML for
  whisper.cpp and declares MIT licensing.
- [OpenAI Whisper license](https://github.com/openai/whisper/blob/main/LICENSE)
  is MIT and permits use, copying, modification, distribution, sublicensing,
  and sale subject to retaining the copyright and permission notice.
- [whisper.cpp license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
  is MIT under the same notice-retention condition.

Those terms are compatible with local application use and a future distributed
dependency/model pack, provided the applicable MIT notices accompany that pack.
This record approves the model identity for the current app-owned download; it
does not itself begin M8 redistribution or satisfy future release-notice work.

## Independent integrity verification

The Hugging Face model API with blob metadata reported:

```text
revision: 5359861c739e955e79d9a303bcbc70fb988958b1
LFS size: 1624555275
LFS SHA-256: 1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69
```

The exact immutable URL was then streamed in full through Python's standard
HTTPS client into an independent `hashlib.sha256` calculation without retaining
a model file. The observed result was:

```text
1624555275 bytes
1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69
```

This independently computed 64-hex SHA-256 matches the host's LFS object
metadata. The desktop still repeats byte-count and SHA-256 verification for
every app-owned download and local-agent activation; metadata alone is never an
activation decision.

## Runtime boundary

`apps/desktop/src/release-config.ts` is the non-secret source of truth for the
approved pin. `scripts/build-desktop.ts` always includes it in
`desktop-config.json`, including builds where the optional three-value cloud
configuration is absent. Cloud values must still be present together or the
build fails. Runtime configuration rejects any syntactically valid model pin
that differs from this release identity, so a stale app-data file cannot select
an arbitrary model host or artifact. The renderer receives only the public
display name and expected byte count in a recommended setup plan; URL, hash,
staging path, destination path, and canonical local model path remain outside
React state.
