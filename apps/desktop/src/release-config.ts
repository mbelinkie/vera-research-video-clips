/**
 * Public, non-secret release configuration. The artifact URL is pinned to an
 * immutable Hugging Face repository revision; provenance and license evidence
 * are recorded in docs/research/Whisper-large-v3-turbo-model-pin.md.
 */
export const approvedWhisperModelPin = Object.freeze({
  name: "Whisper large-v3-turbo",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin",
  byteSize: 1_624_555_275,
  sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
});
