import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { TranscriptAlignmentProvenance } from "@research-video/contracts";

import type { MediaCommandRunner } from "./index.ts";
import { assertRegularMediaFile, hashMediaFile } from "./video.ts";

type AlignmentAudio = NonNullable<TranscriptAlignmentProvenance["audio"]>;
type Rational = { numerator: number; denominator: number };
type PcmClock = { first: bigint; rate: bigint; samples: bigint };

export type VerifiedVideoClock = {
  firstFrame: Rational;
  frameDuration: Rational;
  frameCount: number;
};

const maximumTraceBytes = 1024 * 1024;
const signedInteger = /^-?\d+$/u;
const ratePattern = /^(\d+)\/(\d+)$/u;

async function traceRows(path: string) {
  if ((await assertRegularMediaFile(path)) > maximumTraceBytes) return [];
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u));
}

function audioClock(rows: string[][]): PcmClock | undefined {
  const rate = exactRate(rows[0]?.[2]);
  if (!rate || rate[0] !== 1n) return;
  let first: bigint | undefined;
  let samples = 0n;
  for (const [index, [n, pts, base, prior, count, extra]] of rows.entries()) {
    if (
      extra !== undefined ||
      n !== String(index) ||
      base !== rows[0]?.[2] ||
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
  }
  if (first !== undefined) return { first, rate: rate[1], samples };
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

export async function observeVideoClock(input: {
  sourcePath: string;
  outputPath: string;
  audio: AlignmentAudio;
  ffmpeg: string;
  ffprobe: string;
  runner: MediaCommandRunner;
  render: (extraArgs: string[]) => Promise<void>;
  signal?: AbortSignal;
}): Promise<VerifiedVideoClock | undefined> {
  const {
    sourcePath,
    outputPath,
    audio,
    ffmpeg,
    ffprobe,
    runner,
    render,
    signal,
  } = input;
  const options = { timeoutMs: 10 * 60_000, ...(signal ? { signal } : {}) };
  const directory = await mkdtemp(join(dirname(outputPath), ".clock-"));
  const wav = join(directory, "alignment.wav");
  const flac = join(directory, "alignment.flac");
  const sourceAudioTrace = join(directory, "source-audio.txt");
  const wavTrace = join(directory, "wav.txt");
  const videoTrace = join(directory, "video.txt");
  try {
    let sourceAudio: PcmClock | undefined;
    try {
      // The alignment worker reads acquired FLAC. Reproduce that decode path
      // from this video and keep the pre-encoding origin before FLAC resets it.
      const audioFlags = [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
      ];
      const traceFlags = (path: string) => [
        "-stats_enc_pre:a",
        path,
        "-stats_enc_pre_fmt:a",
        "{n} {pts} {tb} {sn} {samp}",
      ];
      await runner.run(
        ffmpeg,
        [
          ...audioFlags,
          "-i",
          sourcePath,
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
      await runner.run(
        ffmpeg,
        [
          ...audioFlags,
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
      if (`sha256:${await hashMediaFile(wav)}` === audio.hash) {
        const pcm = audioClock(await traceRows(wavTrace));
        const native = audioClock(await traceRows(sourceAudioTrace));
        if (
          pcm &&
          native &&
          pcm.first === 0n &&
          pcm.rate === 16000n &&
          pcm.samples === BigInt(audio.durationSamples)
        ) {
          const error = native.samples * pcm.rate - pcm.samples * native.rate;
          if (error > -native.rate && error < native.rate) sourceAudio = native;
        }
      }
    } catch {
      signal?.throwIfAborted();
    }
    await render(
      sourceAudio === undefined
        ? []
        : [
            "-stats_enc_pre:v",
            videoTrace,
            "-stats_enc_pre_fmt:v",
            "{n} {ni} {ptsi} {tbi}",
          ],
    );
    if (sourceAudio === undefined) return;
    try {
      const { stdout } = await runner.run(
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
          outputPath,
        ],
        options,
      );
      const decoded = JSON.parse(stdout) as {
        streams: { time_base: unknown }[];
        frames: { pts: unknown }[];
      };
      return verifyVideoClock(
        await traceRows(videoTrace),
        {
          timeBase: decoded.streams[0]?.time_base,
          pts: decoded.frames.map(({ pts }) => pts),
        },
        sourceAudio,
        audio.durationSamples,
      );
    } catch {
      signal?.throwIfAborted();
      return;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
