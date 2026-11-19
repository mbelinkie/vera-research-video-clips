import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { NormalizedTranscript } from "@research-video/contracts";
import { z } from "zod";

import { SpawnCommandRunner, type CommandRunner } from "./captions-local.ts";
import { ProviderExecutionError } from "./index.ts";

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
  const entries = captionEntries(transcript);
  if (!entries.some((entry) => entry.kind === "word")) {
    throw new ProviderExecutionError("The captions have no words to align.");
  }
  const scratch = await mkdtemp(join(tmpdir(), "vera-caption-alignment-"));
  try {
    const audio = resolve(wavPath);
    const captions = join(scratch, "captions.json");
    const recognitionPath = join(scratch, "recognition.json");
    const alignmentPath = join(scratch, "alignment.json");
    await writeFile(
      captions,
      JSON.stringify({
        // One entry per anchor preserves native auto-caption word starts as well
        // as full cue anchors. The CLI uses these only to place words near speech.
        events: entries.map((entry) => ({
          tStartMs: entry.startMs,
          dDurationMs: entry.endMs - entry.startMs,
          segs: [{ utf8: entry.text }],
        })),
      }),
    );
    await runner
      .run(executable, [
        "recognise",
        "--engine",
        "youtube",
        "--language",
        "en",
        "--audio",
        audio,
        "--captions",
        captions,
        "--out",
        recognitionPath,
      ])
      .catch(() => {
        throw new ProviderExecutionError(
          "Could not read captions using vera-word-timing. Check the CLI installation and WAV input.",
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
    await runner
      .run(
        executable,
        [
          "align",
          "--audio",
          audio,
          "--recognition",
          recognitionPath,
          "--out",
          alignmentPath,
        ],
        { timeoutMs: 65 * 60_000 },
      )
      .catch(() => {
        throw new ProviderExecutionError(
          "Word alignment failed. Check the local Silero VAD and MFA setup and the audio and caption inputs.",
        );
      });
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
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function captionEntries(transcript: NormalizedTranscript): CaptionEntry[] {
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
        if (token.text.startsWith("[")) {
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
        const startMs = token.startMs ?? segment.startMs;
        entries.push({
          ids: [token.id],
          text: token.text,
          startMs,
          endMs:
            token.endMs ??
            Math.min(
              segment.endMs,
              token.startMs === undefined ? segment.endMs : startMs + 1,
            ),
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
