import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeGeneratedTranscript } from "@research-video/transcript";

import type { CommandRunner } from "./captions-local.ts";
import { SpawnCommandRunner } from "./captions-local.ts";
import { ProviderExecutionError, type SpeechToTextProvider } from "./index.ts";

export type WhisperCppSpeechToTextOptions = {
  executable?: string;
  modelPath: string;
  modelName: string;
  runner?: CommandRunner;
  timeoutMs?: number;
};

type WhisperJson = {
  result?: { language?: unknown };
  transcription?: unknown;
};

export class WhisperCppSpeechToTextProvider implements SpeechToTextProvider {
  readonly #executable: string;
  readonly #modelPath: string;
  readonly #modelName: string;
  readonly #runner: CommandRunner;
  readonly #timeoutMs: number;

  constructor(options: WhisperCppSpeechToTextOptions) {
    this.#executable = validPath(
      options.executable ?? "whisper-cli",
      "executable",
    );
    this.#modelPath = validPath(options.modelPath, "model path");
    this.#modelName = options.modelName.trim();
    if (!this.#modelName) {
      throw new ProviderExecutionError("Whisper model name is required.");
    }
    this.#runner = options.runner ?? new SpawnCommandRunner();
    this.#timeoutMs = options.timeoutMs ?? 12 * 60 * 60 * 1_000;
  }

  async transcribe(input: {
    videoId: string;
    inputPath: string;
    language?: string;
    signal?: AbortSignal;
  }) {
    validateVideoId(input.videoId);
    validPath(input.inputPath, "audio input path");
    const inputInfo = await stat(input.inputPath).catch(() => undefined);
    if (!inputInfo?.isFile() || inputInfo.size <= 0) {
      throw new ProviderExecutionError(
        "Speech-recognition audio input is missing or empty.",
      );
    }
    const outputBase = join(
      dirname(input.inputPath),
      `whisper-${input.videoId}-${shortHash(this.#modelName)}`,
    );
    const outputPath = `${outputBase}.json`;
    const existing = await readFile(outputPath, "utf8").catch(() => undefined);
    if (!existing) {
      await this.#runner.run(
        this.#executable,
        [
          "-m",
          this.#modelPath,
          "-f",
          input.inputPath,
          "-l",
          whisperLanguage(input.language),
          "-ojf",
          "-of",
          outputBase,
          "-np",
        ],
        {
          timeoutMs: this.#timeoutMs,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    }
    const json =
      existing ?? (await readFile(outputPath, "utf8").catch(() => undefined));
    if (!json) {
      throw new ProviderExecutionError(
        "whisper.cpp completed without producing full JSON output.",
      );
    }
    const parsed = parseWhisperJson(json, input.language);
    return normalizeGeneratedTranscript({
      videoId: input.videoId,
      language: parsed.language,
      provider: "whisper.cpp",
      model: this.#modelName,
      segments: parsed.segments,
    });
  }
}

export function createSpeechToTextProvider(
  configuration:
    | { mode: "disabled" }
    | {
        mode: "whisper-cpp";
        executable: string;
        modelPath: string;
        modelName: string;
      },
  runner?: CommandRunner,
): SpeechToTextProvider | undefined {
  if (configuration.mode === "disabled") return undefined;
  return new WhisperCppSpeechToTextProvider({
    executable: configuration.executable,
    modelPath: configuration.modelPath,
    modelName: configuration.modelName,
    ...(runner ? { runner } : {}),
  });
}

function parseWhisperJson(json: string, requestedLanguage?: string) {
  let payload: WhisperJson;
  try {
    payload = JSON.parse(json) as WhisperJson;
  } catch {
    throw new ProviderExecutionError("whisper.cpp returned invalid JSON.");
  }
  const detected = payload.result?.language;
  const language =
    typeof detected === "string" && detected.trim()
      ? detected.trim()
      : requestedLanguage?.trim();
  if (!language || language === "auto") {
    throw new ProviderExecutionError(
      "whisper.cpp output did not identify the spoken language.",
    );
  }
  if (!Array.isArray(payload.transcription)) {
    throw new ProviderExecutionError(
      "whisper.cpp output omitted the transcription array.",
    );
  }
  const segments = payload.transcription.map((value, index) => {
    if (!value || typeof value !== "object") return invalidSegment(index);
    const record = value as Record<string, unknown>;
    const offsets = record.offsets;
    if (!offsets || typeof offsets !== "object") return invalidSegment(index);
    const { from, to } = offsets as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      (from as number) < 0 ||
      (to as number) <= (from as number) ||
      !text
    ) {
      return invalidSegment(index);
    }
    return { startMs: from as number, endMs: to as number, text };
  });
  return { language, segments };
}

function invalidSegment(index: number): never {
  throw new ProviderExecutionError(
    `whisper.cpp returned an invalid transcription segment at index ${index}.`,
  );
}

function whisperLanguage(language?: string) {
  if (!language?.trim()) return "auto";
  return language.trim().toLowerCase().replaceAll("_", "-").split("-")[0]!;
}

function validPath(path: string, label: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new ProviderExecutionError(`Whisper ${label} is invalid.`);
  }
  return trimmed;
}

function validateVideoId(videoId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new ProviderExecutionError("Invalid YouTube video ID.");
  }
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
