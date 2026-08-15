import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CommandRunner } from "./captions-local.ts";
import {
  WhisperCppSpeechToTextProvider,
  createSpeechToTextProvider,
} from "./speech-whisper-cpp.ts";

describe("WhisperCppSpeechToTextProvider", () => {
  it("is opt-in and normalizes detected-language full JSON", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "whisper-provider-"));
    const audioPath = join(scratch, "audio.flac");
    await writeFile(audioPath, "fixture audio");
    const run = vi.fn<CommandRunner["run"]>(async (_executable, args) => {
      const outputBase = args[args.indexOf("-of") + 1]!;
      await writeFile(
        `${outputBase}.json`,
        JSON.stringify({
          result: { language: "es" },
          transcription: [
            {
              offsets: { from: 500, to: 2500 },
              text: " Este es un ejemplo breve. ",
            },
          ],
        }),
      );
      return { stdout: "", stderr: "" };
    });
    const provider = createSpeechToTextProvider(
      {
        mode: "whisper-cpp",
        executable: "/opt/whisper/whisper-cli",
        modelPath: "/opt/whisper/models/ggml-large-v3-turbo.bin",
        modelName: "large-v3-turbo",
      },
      { run },
    );

    try {
      expect(createSpeechToTextProvider({ mode: "disabled" })).toBeUndefined();
      await expect(
        provider!.transcribe({
          videoId: "M7lc1UVf-VE",
          inputPath: audioPath,
        }),
      ).resolves.toMatchObject({
        track: {
          language: "es",
          kind: "original",
          source: "generated",
          provider: "whisper.cpp",
          model: "large-v3-turbo",
          timingPrecision: "cue",
        },
        segments: [
          { startMs: 500, endMs: 2_500, text: "Este es un ejemplo breve." },
        ],
      });
      expect(run.mock.calls[0]?.[1]).toEqual(
        expect.arrayContaining([
          "-l",
          "auto",
          "-ojf",
          "-np",
          "/opt/whisper/models/ggml-large-v3-turbo.bin",
        ]),
      );

      await provider!.transcribe({
        videoId: "M7lc1UVf-VE",
        inputPath: audioPath,
      });
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects malformed provider timing instead of inventing it", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "whisper-provider-"));
    const audioPath = join(scratch, "audio.flac");
    await writeFile(audioPath, "fixture audio");
    const provider = new WhisperCppSpeechToTextProvider({
      modelPath: "/models/model.bin",
      modelName: "fixture",
      runner: {
        run: async (_executable, args) => {
          const outputBase = args[args.indexOf("-of") + 1]!;
          await writeFile(
            `${outputBase}.json`,
            JSON.stringify({
              result: { language: "es" },
              transcription: [
                { offsets: { from: 2_000, to: 1_000 }, text: "bad" },
              ],
            }),
          );
          return { stdout: "", stderr: "" };
        },
      },
    });

    try {
      await expect(
        provider.transcribe({
          videoId: "M7lc1UVf-VE",
          inputPath: audioPath,
        }),
      ).rejects.toMatchObject({ code: "provider_execution_failed" });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
