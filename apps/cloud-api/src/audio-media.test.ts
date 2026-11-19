import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { InvalidAudio, preparePublicAudio } from "./audio-media.ts";

const ffmpegAvailable = (() => {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();

describe("public audio preparation", () => {
  it("rejects empty, unsupported and oversized input before invoking FFmpeg", async () => {
    await expect(preparePublicAudio(Buffer.alloc(0))).rejects.toBeInstanceOf(
      InvalidAudio,
    );
    await expect(
      preparePublicAudio(Buffer.from("this is not an audio file")),
    ).rejects.toMatchObject({ code: "invalid_audio" });
    await expect(
      preparePublicAudio(Buffer.alloc(50 * 1024 * 1024 + 1)),
    ).rejects.toThrow("50 MiB");
  });

  it.skipIf(!ffmpegAvailable)(
    "decodes a synthetic WAV into bounded duration and 256 normalized peaks",
    async () => {
      const sampleRate = 8_000;
      const samples = new Int16Array(sampleRate * 2);
      for (let index = 0; index < samples.length; index++) {
        const phase = index / sampleRate;
        samples[index] =
          phase < 0.5
            ? Math.round(Math.sin(index / 8) * 32_767)
            : Math.round(Math.sin(index / 8) * 8_192);
      }

      const result = await preparePublicAudio(makeWav(samples, sampleRate));
      expect(result.mimeType).toBe("audio/wav");
      expect(result.durationMs).toBe(2_000);
      expect(result.peaks).toHaveLength(256);
      expect(result.peaks.every((peak) => Number.isFinite(peak))).toBe(true);
      expect(result.peaks.every((peak) => peak >= 0 && peak <= 1)).toBe(true);
      expect(Math.max(...result.peaks)).toBeGreaterThan(0.9);
      expect(result.peaks.slice(128).some((peak) => peak < 0.4)).toBe(true);
    },
  );

  it.skipIf(!ffmpegAvailable)(
    "rejects a valid WAV container with no decodable samples",
    async () => {
      await expect(
        preparePublicAudio(makeWav(new Int16Array(0), 8_000)),
      ).rejects.toBeInstanceOf(InvalidAudio);
    },
  );
});

function makeWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.byteLength;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index++)
    bytes.writeInt16LE(samples[index] ?? 0, 44 + index * 2);
  return bytes;
}
