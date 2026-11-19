import { spawn } from "node:child_process";

import {
  AudioPeakCount,
  MaxAudioBytes,
  MaxAudioDurationMs,
} from "@research-video/contracts";

const PCM_SAMPLE_RATE = 8_000;
const PCM_BYTES_PER_SAMPLE = 2;
const MAX_AUDIO_SECONDS = MaxAudioDurationMs / 1_000;
// Decode a small amount past the accepted duration so an input that is just
// over the limit cannot be mistaken for a valid, exactly-limit recording.
const DURATION_PROBE_GRACE_SECONDS = 0.5;
const MAX_DECODED_SAMPLES = (MaxAudioDurationMs * PCM_SAMPLE_RATE) / 1_000;
const MAX_DECODED_BYTES = Math.ceil(
  (MAX_AUDIO_SECONDS + DURATION_PROBE_GRACE_SECONDS) *
    PCM_SAMPLE_RATE *
    PCM_BYTES_PER_SAMPLE,
);
const FFMPEG_TIMEOUT_MS = 60_000;
const MAX_FFMPEG_ALLOCATION_BYTES = 64 * 1024 * 1024;
const MAX_PROCESS_STDERR_BYTES = 64 * 1024;
const VIDEO_PROBE_STDOUT_BYTES = 64 * 1024;

type PublicAudioMimeType =
  | "audio/mpeg"
  | "audio/wav"
  | "audio/mp4"
  | "audio/ogg"
  | "audio/flac"
  | "audio/webm";

type AudioFormat = {
  demuxer: "mp3" | "wav" | "mp4" | "ogg" | "flac" | "matroska,webm";
  mimeType: PublicAudioMimeType;
  /** Containers that can carry video must be checked before audio decoding. */
  mayContainVideo: boolean;
};

type ProcessResult = {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
};

/** A supplied asset is not a supported, bounded audio recording. */
export class InvalidAudio extends Error {
  readonly code = "invalid_audio";

  constructor(message = "The supplied file is not a supported audio asset.") {
    super(message);
    this.name = "InvalidAudio";
  }
}

export async function preparePublicAudio(bytes: Buffer): Promise<{
  durationMs: number;
  peaks: number[];
  mimeType: PublicAudioMimeType;
}> {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    throw new InvalidAudio("The audio upload is empty or malformed.");
  }
  if (bytes.byteLength > MaxAudioBytes) {
    throw new InvalidAudio("This audio exceeds the 50 MiB upload limit.");
  }

  const format = detectFormat(bytes);
  if (!format) {
    throw new InvalidAudio(
      "Unsupported audio format. Upload MP3, WAV, MP4/M4A, OGG, FLAC or WebM audio.",
    );
  }

  if (format.mayContainVideo) await rejectVideo(bytes, format);

  const result = await runFfmpeg(
    [
      ...commonInputArgs(format),
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-ac",
      "1",
      "-ar",
      String(PCM_SAMPLE_RATE),
      "-t",
      String(MAX_AUDIO_SECONDS + DURATION_PROBE_GRACE_SECONDS),
      "-f",
      "s16le",
      "pipe:1",
    ],
    bytes,
    MAX_DECODED_BYTES,
  );

  if (result.timedOut || result.outputLimitExceeded) {
    throw new InvalidAudio(
      result.timedOut
        ? "Audio decoding exceeded the processing time limit."
        : "Audio decoding exceeded the output limit.",
    );
  }
  if (result.code !== 0) {
    throw new InvalidAudio("The audio could not be decoded.");
  }
  if (result.stdout.byteLength === 0 || result.stdout.byteLength % 2 !== 0) {
    throw new InvalidAudio("The audio contains no decodable samples.");
  }

  const sampleCount = result.stdout.byteLength / PCM_BYTES_PER_SAMPLE;
  if (sampleCount > MAX_DECODED_SAMPLES) {
    throw new InvalidAudio("Audio duration cannot exceed 30 minutes.");
  }
  const durationMs = Math.max(
    1,
    Math.round((sampleCount * 1_000) / PCM_SAMPLE_RATE),
  );
  if (durationMs > MaxAudioDurationMs) {
    throw new InvalidAudio("Audio duration cannot exceed 30 minutes.");
  }

  return {
    durationMs,
    peaks: calculatePeaks(result.stdout, sampleCount),
    mimeType: format.mimeType,
  };
}

function detectFormat(bytes: Buffer): AudioFormat | undefined {
  const head = bytes.subarray(0, 12);
  const firstFour = head.subarray(0, 4).toString("latin1");

  if (
    (firstFour === "RIFF" || firstFour === "RIFX" || firstFour === "RF64") &&
    head.subarray(8, 12).toString("latin1") === "WAVE"
  ) {
    return { demuxer: "wav", mimeType: "audio/wav", mayContainVideo: false };
  }
  if (firstFour === "fLaC") {
    return { demuxer: "flac", mimeType: "audio/flac", mayContainVideo: false };
  }
  if (firstFour === "OggS") {
    return { demuxer: "ogg", mimeType: "audio/ogg", mayContainVideo: true };
  }
  if (firstFour === "\x1aE\xdf\xa3") {
    return {
      demuxer: "matroska,webm",
      mimeType: "audio/webm",
      mayContainVideo: true,
    };
  }
  if (head.subarray(4, 8).toString("latin1") === "ftyp") {
    return { demuxer: "mp4", mimeType: "audio/mp4", mayContainVideo: true };
  }
  if (looksLikeMpegAudio(bytes)) {
    return { demuxer: "mp3", mimeType: "audio/mpeg", mayContainVideo: false };
  }
  return undefined;
}

function looksLikeMpegAudio(bytes: Buffer): boolean {
  if (bytes.subarray(0, 3).toString("latin1") === "ID3") return true;

  // Do not scan an entire upload just to classify it. An MPEG frame must be
  // near the front for FFmpeg's MP3 demuxer to accept the stream anyway.
  const limit = Math.min(bytes.byteLength - 1, 64 * 1024);
  for (let offset = 0; offset < limit; offset++) {
    const first = bytes[offset] ?? -1;
    const second = bytes[offset + 1] ?? -1;
    if (first !== 0xff || (second & 0xe0) !== 0xe0) continue;

    const version = (second >> 3) & 0x03;
    const layer = (second >> 1) & 0x03;
    const third = bytes[offset + 2] ?? -1;
    const bitrate = (third >> 4) & 0x0f;
    const sampleRate = (third >> 2) & 0x03;
    if (
      version !== 0x01 &&
      layer !== 0 &&
      bitrate !== 0 &&
      bitrate !== 0x0f &&
      sampleRate !== 0x03
    ) {
      return true;
    }
  }
  return false;
}

function commonInputArgs(format: AudioFormat): string[] {
  // The only permitted input protocol is stdin. In particular, do not let a
  // container's metadata or an FFmpeg demuxer resolve a URL or local path.
  return [
    "-hide_banner",
    "-nostdin",
    "-max_alloc",
    String(MAX_FFMPEG_ALLOCATION_BYTES),
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "pipe",
    "-f",
    format.demuxer,
    "-i",
    "pipe:0",
  ];
}

async function rejectVideo(bytes: Buffer, format: AudioFormat): Promise<void> {
  const result = await runFfmpeg(
    [
      ...commonInputArgs(format),
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-an",
      "-sn",
      "-dn",
      "-f",
      "null",
      "pipe:1",
    ],
    bytes,
    VIDEO_PROBE_STDOUT_BYTES,
  );
  if (result.timedOut || result.outputLimitExceeded) {
    throw new InvalidAudio("The audio could not be inspected safely.");
  }
  if (result.code === 0) {
    throw new InvalidAudio("Video files are not supported as audio assets.");
  }
  if (!/matches no streams|does not contain any stream/iu.test(result.stderr)) {
    throw new InvalidAudio("The audio could not be inspected safely.");
  }
}

function runFfmpeg(
  args: readonly string[],
  input: Buffer,
  maxOutputBytes: number,
): Promise<ProcessResult> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  if (executable.includes("\0")) {
    throw new Error("FFMPEG_PATH contains a null byte.");
  }

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, [...args], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const appendStderr = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(
        -MAX_PROCESS_STDERR_BYTES,
      );
    };
    const terminate = (reason: "timeout" | "output") => {
      if (reason === "timeout") timedOut = true;
      else outputLimitExceeded = true;
      if (!child.killed) child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      killTimer.unref?.();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || outputLimitExceeded) return;
      if (stdoutBytes + chunk.byteLength > maxOutputBytes) {
        outputLimitExceeded = true;
        terminate("output");
        return;
      }
      stdoutChunks.push(Buffer.from(chunk));
      stdoutBytes += chunk.byteLength;
    });
    child.stderr?.on("data", appendStderr);
    // A killed child can close stdin before the buffered upload is consumed.
    // That is an expected path, not a second process failure.
    child.stdin?.on("error", () => undefined);

    const timeout = setTimeout(() => terminate("timeout"), FFMPEG_TIMEOUT_MS);
    timeout.unref?.();

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        timedOut,
        outputLimitExceeded,
      });
    });

    child.stdin?.end(input);
  });
}

function calculatePeaks(pcm: Buffer, sampleCount: number): number[] {
  const peaks = Array<number>(AudioPeakCount).fill(0);
  for (let bin = 0; bin < AudioPeakCount; bin++) {
    const start = Math.floor((bin * sampleCount) / AudioPeakCount);
    const end = Math.min(
      sampleCount,
      Math.max(
        start + 1,
        Math.floor(((bin + 1) * sampleCount) / AudioPeakCount),
      ),
    );
    let peak = 0;
    for (let sample = start; sample < end; sample++) {
      const value =
        Math.abs(pcm.readInt16LE(sample * PCM_BYTES_PER_SAMPLE)) / 32_768;
      if (value > peak) peak = value;
    }
    peaks[bin] = Number.isFinite(peak) ? Math.min(1, Math.max(0, peak)) : 0;
  }
  return peaks;
}
