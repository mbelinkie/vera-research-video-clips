import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

import type { TranscriptAlignmentProvenance } from "@research-video/contracts";

import type { MediaCommandRunner } from "./index.ts";
import { readAlignmentWave } from "./alignment-wave.ts";
import { assertRegularMediaFile } from "./video.ts";

type AlignmentAudio = NonNullable<TranscriptAlignmentProvenance["audio"]>;
type Rational = { numerator: number; denominator: number };
type PcmClock = { first: bigint; rate: bigint; samples: bigint };
export type SourceAudioClock = { audio: AlignmentAudio; native: PcmClock };

export type VerifiedVideoClock = {
  firstFrame: Rational;
  frameDuration: Rational;
  frameCount: number;
};

const maximumVideoClockBytes = 64 * 1024 * 1024;
const signedInteger = /^-?\d+$/u;
const ratePattern = /^(\d+)\/(\d+)$/u;

async function* traceRows(path: string) {
  await assertRegularMediaFile(path);
  const stream = createReadStream(path);
  try {
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) yield line.trim().split(/\s+/u);
  } finally {
    stream.destroy();
  }
}

async function audioClock(path: string): Promise<PcmClock | undefined> {
  let timeBase: string | undefined;
  let index = 0;
  let first: bigint | undefined;
  let samples = 0n;
  for await (const [n, pts, base, prior, count, extra] of traceRows(path)) {
    timeBase ??= base;
    if (
      extra !== undefined ||
      n !== String(index) ||
      base !== timeBase ||
      !pts ||
      !prior ||
      !count ||
      ![pts, prior, count].every((field) => signedInteger.test(field))
    )
      return;
    first ??= BigInt(pts);
    if (
      BigInt(prior) !== samples ||
      BigInt(pts) !== first + samples ||
      BigInt(count) <= 0n
    )
      return;
    samples += BigInt(count);
    index++;
  }
  const rate = exactRate(timeBase);
  if (rate?.[0] === 1n && first !== undefined)
    return { first, rate: rate[1], samples };
}

function exactRate(value: unknown) {
  if (typeof value !== "string") return;
  const match = ratePattern.exec(value);
  if (!match) return;
  const numerator = BigInt(match[1]!);
  const denominator = BigInt(match[2]!);
  return numerator > 0n && denominator > 0n
    ? ([numerator, denominator] as const)
    : undefined;
}

function wire(n: bigint, d: bigint): Rational | undefined {
  const numerator = Number(n);
  const denominator = Number(d);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator))
    return;
  return { numerator, denominator };
}

function verifyVideoClock(
  rows: string[][],
  decoded: { timeBase: unknown; pts: unknown[] },
  sourceAudio: PcmClock,
  pcmSamples: number,
): VerifiedVideoClock | undefined {
  if (rows.length < 2 || rows.length !== decoded.pts.length) return;
  const source = exactRate(rows[0]?.[3]);
  const output = exactRate(decoded.timeBase);
  if (!source || !output) return;
  const [sourceN, sourceD] = source;
  const [outN, outD] = output;
  const origins: bigint[] = [];
  for (const [index, row] of rows.entries()) {
    const [n, inputIndex, normalizedInputPts, inputBase] = row;
    if (
      row.length !== 4 ||
      n !== String(index) ||
      !inputIndex ||
      !normalizedInputPts ||
      !signedInteger.test(inputIndex) ||
      !signedInteger.test(normalizedInputPts) ||
      inputBase !== rows[0]?.[3] ||
      !Number.isSafeInteger(decoded.pts[index])
    )
      return;
    if (
      BigInt(inputIndex) !== BigInt(rows[0]![1]!) + BigInt(index) ||
      BigInt(inputIndex) < 0n
    )
      return;
    origins.push(BigInt(normalizedInputPts));
  }
  const first = origins[0]!;
  const step = origins[1]! - first;
  const outOrigin = BigInt(decoded.pts[0] as number);
  if (
    step <= 0n ||
    origins.some((pts, index) => {
      const distance = BigInt(index) * step;
      return (
        pts - first !== distance ||
        (BigInt(decoded.pts[index] as number) - outOrigin) * outN * sourceD !==
          distance * sourceN * outD
      );
    })
  )
    return;
  const audioScale = sourceD * sourceAudio.rate;
  const firstInAudio =
    first * sourceN * sourceAudio.rate - sourceAudio.first * sourceD;
  if (
    firstInAudio < 0n ||
    (firstInAudio + BigInt(rows.length) * step * sourceN * sourceAudio.rate) *
      16000n >
      BigInt(pcmSamples) * audioScale
  )
    return;
  const firstFrame = wire(firstInAudio, audioScale);
  const frameDuration = wire(step * sourceN, sourceD);
  if (!firstFrame || !frameDuration) return;
  return { firstFrame, frameDuration, frameCount: rows.length };
}

type ClockTools = {
  ffmpeg: string;
  runner: MediaCommandRunner;
  timeoutMs: number;
  signal?: AbortSignal;
};

export async function prepareSourceAudioClock(
  input: ClockTools & {
    sourcePath: string;
    scratchDirectory: string;
  },
): Promise<SourceAudioClock | undefined> {
  const options = {
    timeoutMs: input.timeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  };
  const directory = await mkdtemp(join(input.scratchDirectory, ".clock-"));
  const wav = join(directory, "alignment.wav");
  const flac = join(directory, "alignment.flac");
  const sourceAudioTrace = join(directory, "source-audio.txt");
  const wavTrace = join(directory, "wav.txt");
  try {
    // Reproduce the worker's conversion and measure the native timestamps
    // before the FLAC container resets the clock.
    const common = ["-nostdin", "-hide_banner", "-loglevel", "error", "-n"];
    const traceFlags = (path: string) => [
      "-stats_enc_pre:a",
      path,
      "-stats_enc_pre_fmt:a",
      "{n} {pts} {tb} {sn} {samp}",
    ];
    await input.runner.run(
      input.ffmpeg,
      [
        ...common,
        "-i",
        input.sourcePath,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "flac",
        ...traceFlags(sourceAudioTrace),
        flac,
      ],
      options,
    );
    await input.runner.run(
      input.ffmpeg,
      [
        ...common,
        "-i",
        flac,
        "-map",
        "0:a:0",
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        ...traceFlags(wavTrace),
        wav,
      ],
      options,
    );
    const { audio } = await readAlignmentWave(wav);
    const pcm = await audioClock(wavTrace);
    const native = await audioClock(sourceAudioTrace);
    if (
      !pcm ||
      !native ||
      pcm.first !== 0n ||
      pcm.rate !== 16000n ||
      pcm.samples !== BigInt(audio.durationSamples)
    )
      return;
    const error = native.samples * pcm.rate - pcm.samples * native.rate;
    if (error > -native.rate && error < native.rate) return { audio, native };
  } catch {
    input.signal?.throwIfAborted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function observeVideoClock(
  input: Pick<ClockTools, "runner" | "timeoutMs" | "signal"> & {
    outputPath: string;
    sourceAudio: SourceAudioClock;
    ffprobe: string;
    render: (extraArgs: string[]) => Promise<void>;
  },
): Promise<VerifiedVideoClock | undefined> {
  const { outputPath, sourceAudio, ffprobe, runner, render, signal } = input;
  const options = { timeoutMs: input.timeoutMs, ...(signal ? { signal } : {}) };
  const directory = await mkdtemp(join(dirname(outputPath), ".clock-"));
  const videoTrace = join(directory, "video.txt");
  const decodedPath = join(directory, "decoded.json");
  try {
    await render([
      "-stats_enc_pre:v",
      videoTrace,
      "-stats_enc_pre_fmt:v",
      "{n} {ni} {ptsi} {tbi}",
    ]);
    try {
      await runner.run(
        ffprobe,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=time_base:frame=pts",
          "-of",
          "json",
          "-o",
          decodedPath,
          outputPath,
        ],
        options,
      );
      if (
        (await assertRegularMediaFile(decodedPath)) > maximumVideoClockBytes ||
        (await assertRegularMediaFile(videoTrace)) > maximumVideoClockBytes
      )
        return;
      const decoded = JSON.parse(await readFile(decodedPath, "utf8")) as {
        streams: { time_base: unknown }[];
        frames: { pts: unknown }[];
      };
      const rows: string[][] = [];
      for await (const row of traceRows(videoTrace)) rows.push(row);
      return verifyVideoClock(
        rows,
        {
          timeBase: decoded.streams[0]?.time_base,
          pts: decoded.frames.map(({ pts }) => pts),
        },
        sourceAudio.native,
        sourceAudio.audio.durationSamples,
      );
    } catch {
      signal?.throwIfAborted();
      return;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
