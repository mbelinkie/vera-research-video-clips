import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AudioSpeechTranscriptSchema,
  type AudioSpeechTranscript,
} from "@research-video/contracts";
import { decodeAudio } from "./library-audio-media.ts";
import { WhisperCppSpeechToTextProvider } from "./speech-whisper-cpp.ts";

export type LibraryAudioTranscriber = (
  sourceId: string,
  bytes: Buffer,
  durationMs: number,
  signal?: AbortSignal,
) => Promise<AudioSpeechTranscript>;

export class LibraryAudioSpeechError extends Error {
  readonly code = "library_audio_speech_failed";

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function createLibraryAudioTranscriber(options: {
  executable: string;
  modelPath: string;
  modelName: string;
  ffmpeg?: string;
}): LibraryAudioTranscriber {
  const whisper = new WhisperCppSpeechToTextProvider({
    ...options,
    timeoutMs: 15 * 60_000,
  });
  let active = false;
  return async (sourceId, bytes, durationMs, signal) => {
    if (active)
      throw new LibraryAudioSpeechError(
        429,
        "A Speech source is already being transcribed. Try again shortly.",
      );
    active = true;
    try {
      const { pcm } = await decodeAudio(bytes, 16_000, options.ffmpeg);
      signal?.throwIfAborted();
      const folder = await mkdtemp(join(tmpdir(), "research-audio-"));
      try {
        const wav = Buffer.alloc(44 + pcm.length);
        wav.write("RIFF", 0);
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(16_000, 24);
        wav.writeUInt32LE(32_000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(pcm.length, 40);
        pcm.copy(wav, 44);
        const transcript = await whisper.transcribeLibrarySource({
          sourceId,
          wav,
          scratchDirectory: folder,
          ...(signal ? { signal } : {}),
        });
        const segments = transcript.segments
          .map(({ startMs, endMs, text }) => ({
            startMs,
            endMs: Math.min(endMs, durationMs),
            text,
          }))
          .filter(({ startMs, endMs }) => endMs > startMs);
        if (!segments.length)
          throw new LibraryAudioSpeechError(
            422,
            "No speech was detected in this audio.",
          );
        return AudioSpeechTranscriptSchema.parse({
          audioSha256: createHash("sha256").update(bytes).digest("hex"),
          language: transcript.track.language,
          model: options.modelName,
          segments,
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    } catch (error) {
      if (error instanceof LibraryAudioSpeechError) throw error;
      throw new LibraryAudioSpeechError(
        422,
        "Speech transcription failed. Check the audio format and local Whisper setup, then try again.",
      );
    } finally {
      active = false;
    }
  };
}
