import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NormalizedTranscript } from "@research-video/contracts";
import { SpawnMediaCommandRunner } from "@research-video/media";
import { applyAcousticAlignment } from "@research-video/transcript";
import { z } from "zod";

import { SpawnCommandRunner, type CommandRunner } from "./captions-local.ts";
import { ProviderExecutionError } from "./index.ts";
import {
  AlignmentShutdownUnconfirmedError,
  runCancelableAlignment,
} from "./word-timing-process.ts";

export { AlignmentShutdownUnconfirmedError } from "./word-timing-process.ts";

const artifactId = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceMs = z.number().int().nonnegative();
const audioIdentity = z.object({
  hash: artifactId,
  sampleRate: z.literal(16_000),
  durationSamples: z.number().int().positive(),
});
const recognitionArtifact = z.object({
  schemaVersion: z.literal("recognition-artifact/v1"),
  artifactId,
  identity: z.object({ audio: audioIdentity }),
  tokens: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      display: z.string(),
      kind: z.enum(["word", "event"]),
    }),
  ),
});
const alignmentArtifact = z.object({
  schemaVersion: z.literal("alignment-artifact/v1"),
  artifactId,
  identity: z.object({
    recognitionArtifactId: artifactId,
    audio: audioIdentity,
    aligner: z.object({
      name: z.literal("montreal-forced-aligner"),
      version: z.string().min(1),
      acousticModel: z.string().min(1),
      parametersHash: artifactId,
    }),
  }),
  words: z.array(
    z.object({
      tokenIndex: z.number().int().nonnegative(),
      sub: z.number().int().nonnegative(),
      status: z.enum(["acoustic", "interpolated", "unaligned"]),
      startMs: sourceMs.nullable(),
      endMs: sourceMs.nullable(),
    }),
  ),
});

type CaptionEntry = {
  ids: string[];
  text: string;
  startMs: number;
  endMs: number;
  kind: "word" | "event";
};

type TokenAlignment =
  | { tokenId: string; status: "acoustic"; startMs: number; endMs: number }
  | { tokenId: string; status: "unaligned"; startMs: null; endMs: null };

const pythonCli = ["-m", "vera_word_timing.cli"];

type WorkerAlignmentContext = {
  scratchDirectory: string;
  signal: AbortSignal;
};

export async function createLocalAlignmentProvider(options: {
  python: string;
  ffmpeg: string;
}) {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new ProviderExecutionError(
      "Local worker word alignment requires macOS or Linux.",
    );
  const runner = new SpawnMediaCommandRunner();
  const help = await runner
    .run(options.python, [...pythonCli, "align", "--help"], {
      timeoutMs: 15_000,
    })
    .catch(() => undefined);
  if (!help?.stdout.includes("--cancel-file")) {
    throw new ProviderExecutionError(
      "Install the Timeline word-timing package with worker cancellation support and set VERA_WORD_TIMING_PYTHON.",
    );
  }
  return {
    supports({ track }: NormalizedTranscript) {
      return track.source === "generated"
        ? !!track.model && /^(?:en|de|fr|sv)(?:-|$)/iu.test(track.language)
        : (track.source === "youtube-auto" ||
            track.source === "youtube-manual") &&
            /^en(?:-|$)/iu.test(track.language);
    },
    async align(
      input: WorkerAlignmentContext & {
        transcript: NormalizedTranscript;
        inputPath: string;
      },
    ) {
      const wav = join(input.scratchDirectory, "alignment-input.wav");
      await runner.run(
        options.ffmpeg,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-n",
          "-i",
          input.inputPath,
          "-map",
          "0:a:0",
          "-vn",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        { signal: input.signal },
      );
      input.signal.throwIfAborted();
      const alignment = await alignTranscript(
        input.transcript,
        wav,
        options.python,
        pythonCli,
        runner,
        input,
      );
      return applyAcousticAlignment(input.transcript, alignment);
    },
  };
}

/** Local handoff to Timeline's installed word-timing CLI. WAV is 16 kHz mono PCM. */
export async function alignEnglishCaptions(
  transcript: NormalizedTranscript,
  wavPath: string,
  executable: string,
  runner: CommandRunner = new SpawnCommandRunner(),
) {
  if (
    !/^en(?:-|$)/iu.test(transcript.track.language) ||
    !["youtube-manual", "youtube-auto"].includes(transcript.track.source)
  ) {
    throw new ProviderExecutionError(
      "Local caption alignment requires English captions.",
    );
  }
  return alignTranscript(transcript, wavPath, executable, [], runner);
}

/** Uses the incumbent recognizer's words and segment anchors without retranscribing. */
export async function alignLocalRecognition(
  transcript: NormalizedTranscript,
  wavPath: string,
  python: string,
  runner: CommandRunner = new SpawnCommandRunner(),
) {
  if (
    transcript.track.source !== "generated" ||
    !transcript.track.model ||
    !/^(?:en|de|fr|sv)(?:-|$)/iu.test(transcript.track.language)
  ) {
    throw new ProviderExecutionError(
      "Local word alignment requires a supported language and the recognizer's model.",
    );
  }
  return alignTranscript(transcript, wavPath, python, pythonCli, runner);
}

async function alignTranscript(
  transcript: NormalizedTranscript,
  wavPath: string,
  executable: string,
  cliPrefix: readonly string[],
  runner: CommandRunner,
  worker?: WorkerAlignmentContext,
) {
  const entries = alignmentEntries(transcript);
  if (!entries.some((entry) => entry.kind === "word")) {
    throw new ProviderExecutionError("The transcript has no words to align.");
  }
  const scratch = await mkdtemp(
    join(worker?.scratchDirectory ?? tmpdir(), "vera-caption-alignment-"),
  );
  let retainScratch = false;
  try {
    const audio = resolve(wavPath);
    const input = join(scratch, "recognition-input.json");
    const recognitionPath = join(scratch, "recognition.json");
    const alignmentPath = join(scratch, "alignment.json");
    const fromRecognition = transcript.track.source === "generated";
    const recognitionArgs = fromRecognition
      ? [
          fileURLToPath(
            new URL("./word-timing-recognition.py", import.meta.url),
          ),
          "--input",
          input,
        ]
      : [
          ...cliPrefix,
          "recognise",
          "--engine",
          "youtube",
          "--language",
          "en",
          "--captions",
          input,
        ];
    const recognitionInput = fromRecognition
      ? {
          language: transcript.track.language.toLowerCase(),
          provider: transcript.track.provider,
          model: transcript.track.model,
          tokens: entries.map(({ text, startMs, endMs }) => ({
            display: text,
            startMs,
            endMs,
          })),
        }
      : {
          // These anchors only place words near speech.
          events: entries.map(({ text, startMs, endMs }) => ({
            tStartMs: startMs,
            dDurationMs: endMs - startMs,
            segs: [{ utf8: text }],
          })),
        };
    await writeFile(input, JSON.stringify(recognitionInput));
    await runner
      .run(
        executable,
        [...recognitionArgs, "--audio", audio, "--out", recognitionPath],
        { ...(worker ? { signal: worker.signal } : {}), timeoutMs: 120_000 },
      )
      .catch(() => {
        worker?.signal.throwIfAborted();
        throw new ProviderExecutionError(
          "Could not prepare the transcript for vera-word-timing. Check the runtime and WAV input.",
        );
      });
    const recognition = await readArtifact(
      recognitionPath,
      recognitionArtifact,
    );
    if (
      recognition.tokens.length !== entries.length ||
      recognition.tokens.some(
        (token, index) =>
          token.index !== index ||
          token.display !== entries[index]!.text ||
          token.kind !== entries[index]!.kind,
      )
    )
      throw invalidArtifacts();

    const start = performance.now();
    // The installed CLI gives VAD and MFA their own 30-minute timeouts.
    const alignArgs = [
      ...cliPrefix,
      "align",
      "--audio",
      audio,
      "--recognition",
      recognitionPath,
      "--out",
      alignmentPath,
    ];
    if (worker) {
      await runCancelableAlignment(
        executable,
        alignArgs,
        join(scratch, "cancel"),
        worker.signal,
      );
    } else {
      await runner
        .run(executable, alignArgs, { timeoutMs: 65 * 60_000 })
        .catch(() => {
          throw new ProviderExecutionError(
            "Word alignment failed. Check the local Silero VAD and MFA setup and the audio and caption inputs.",
          );
        });
    }
    const alignmentSeconds = (performance.now() - start) / 1_000;
    const alignment = await readArtifact(alignmentPath, alignmentArtifact);
    const audioInfo = recognition.identity.audio;
    if (
      alignment.identity.recognitionArtifactId !== recognition.artifactId ||
      alignment.identity.audio.hash !== audioInfo.hash ||
      alignment.identity.audio.durationSamples !== audioInfo.durationSamples
    )
      throw invalidArtifacts();

    const audioSeconds = audioInfo.durationSamples / audioInfo.sampleRate;
    return {
      artifactId: alignment.artifactId,
      aligner: alignment.identity.aligner,
      audioSeconds,
      alignmentSeconds,
      minutesPerAudioHour: (60 * alignmentSeconds) / audioSeconds,
      tokens: projectAlignment(entries, alignment.words, audioSeconds * 1_000),
    };
  } catch (error) {
    retainScratch = error instanceof AlignmentShutdownUnconfirmedError;
    throw error;
  } finally {
    if (!retainScratch) await rm(scratch, { recursive: true, force: true });
  }
}

function alignmentEntries(transcript: NormalizedTranscript): CaptionEntry[] {
  const fromRecognition = transcript.track.source === "generated";
  const tokensBySegment = new Map<string, NormalizedTranscript["tokens"]>();
  for (const token of transcript.tokens) {
    const tokens = tokensBySegment.get(token.segmentId);
    if (tokens) tokens.push(token);
    else tokensBySegment.set(token.segmentId, [token]);
  }
  return transcript.segments
    .toSorted((a, b) => a.ordinal - b.ordinal)
    .flatMap((segment) => {
      const tokens =
        tokensBySegment
          .get(segment.id)
          ?.toSorted((a, b) => a.ordinal - b.ordinal) ?? [];
      const entries: CaptionEntry[] = [];
      let eventEnd = -1;
      for (const [index, token] of tokens.entries()) {
        if (index <= eventEnd) continue;
        if (!fromRecognition && token.text.startsWith("[")) {
          eventEnd = tokens.findIndex(
            (candidate, position) =>
              position >= index && candidate.text.endsWith("]"),
          );
          if (eventEnd >= index) {
            const event = tokens.slice(index, eventEnd + 1);
            entries.push({
              ids: event.map((part) => part.id),
              text: event.map((part) => part.text).join(" "),
              startMs: segment.startMs,
              endMs: segment.endMs,
              kind: "event",
            });
            continue;
          }
        }
        const wordStartMs = fromRecognition ? undefined : token.startMs;
        const startMs = wordStartMs ?? segment.startMs;
        entries.push({
          ids: [token.id],
          text: token.text,
          startMs,
          endMs:
            wordStartMs === undefined
              ? segment.endMs
              : (token.endMs ?? Math.min(segment.endMs, startMs + 1)),
          kind: "word",
        });
      }
      return entries;
    });
}

function projectAlignment(
  entries: CaptionEntry[],
  words: z.infer<typeof alignmentArtifact>["words"],
  durationMs: number,
): TokenAlignment[] {
  const unitsByIndex = new Map<number, typeof words>();
  for (const word of words) {
    if (entries[word.tokenIndex]?.kind !== "word") throw invalidArtifacts();
    const units = unitsByIndex.get(word.tokenIndex) ?? [];
    if (word.sub !== units.length) throw invalidArtifacts();
    units.push(word);
    unitsByIndex.set(word.tokenIndex, units);
  }
  let previousStartMs = -1;
  let previousEndMs = -1;
  return entries.flatMap((entry, index) => {
    const units = unitsByIndex.get(index) ?? [];
    let startMs: number | null = null;
    let endMs: number | null = null;
    let acoustic = units.length > 0;
    for (const unit of units) {
      if (unit.status === "unaligned") {
        if (unit.startMs !== null || unit.endMs !== null)
          throw invalidArtifacts();
        acoustic = false;
        continue;
      }
      if (
        unit.startMs === null ||
        unit.endMs === null ||
        unit.endMs <= unit.startMs ||
        unit.endMs > Math.round(durationMs) ||
        unit.startMs < previousStartMs ||
        unit.endMs < previousEndMs ||
        (endMs !== null && unit.startMs < endMs)
      )
        throw invalidArtifacts();
      if (unit.status !== "acoustic") acoustic = false;
      startMs ??= unit.startMs;
      endMs = unit.endMs;
      previousStartMs = unit.startMs;
      previousEndMs = endMs;
    }
    return entry.ids.map((tokenId): TokenAlignment =>
      acoustic && startMs !== null && endMs !== null
        ? { tokenId, status: "acoustic", startMs, endMs }
        : { tokenId, status: "unaligned", startMs: null, endMs: null },
    );
  });
}

async function readArtifact<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.output<T>> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw invalidArtifacts();
  }
}

function invalidArtifacts() {
  return new ProviderExecutionError(
    "The word-timing CLI returned an invalid or mismatched artifact.",
  );
}
