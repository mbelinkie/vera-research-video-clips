/**
 * Browser-only audio preparation for Library audio sources.
 *
 * The source File is decoded in the browser and is never returned from this
 * module. Callers can persist the returned low-resolution preview and
 * analysis, while the original remains with the user until they explicitly
 * relink it.
 */

import {
  AudioPeakCount,
  AudioPreviewLimitMs,
  MaxAudioBytes,
  MaxAudioDurationMs,
} from "@research-video/contracts";

export const AUDIO_PREVIEW_SAMPLE_RATE = 8_000;

// Keep analysis work bounded if a decoder returns an unusual multichannel
// buffer. The decoded buffer itself is owned by the browser's decoder.
const MAX_ANALYSIS_SAMPLES = 64 * 1024 * 1024;
const MAX_PEAK_BINS = 65_536;

export type AudioBufferLike = {
  readonly duration?: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): ArrayLike<number>;
};

type AudioAnalysis = {
  durationMs: number;
  peaks: number[];
};

export type PreparedLocalAudio = AudioAnalysis & {
  preview: Blob;
};

export class AudioPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioPreparationError";
  }
}

type AudioContextLike = {
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
  close?: () => Promise<void> | void;
};

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContextLike;

type AudioChannels = {
  channels: ArrayLike<number>[];
  frameCount: number;
  sampleRate: number;
};

function isAudioBufferLike(value: unknown): value is AudioBufferLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    getChannelData?: unknown;
    length?: unknown;
    numberOfChannels?: unknown;
    sampleRate?: unknown;
  };
  return (
    typeof candidate.getChannelData === "function" &&
    typeof candidate.length === "number" &&
    typeof candidate.numberOfChannels === "number" &&
    typeof candidate.sampleRate === "number"
  );
}

function validateSampleRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AudioPreparationError("Audio sample rate is invalid.");
  }
  return value;
}

function readChannels(
  source: AudioBufferLike | readonly ArrayLike<number>[],
  sampleRate?: number,
): AudioChannels {
  if (isAudioBufferLike(source)) {
    const numberOfChannels = Math.floor(source.numberOfChannels);
    if (
      numberOfChannels < 0 ||
      numberOfChannels !== source.numberOfChannels ||
      numberOfChannels > 256
    ) {
      throw new AudioPreparationError("Audio channel count is invalid.");
    }

    const channels: ArrayLike<number>[] = [];
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const samples = source.getChannelData(channel);
      if (!samples || typeof samples.length !== "number") {
        throw new AudioPreparationError("Audio channel data is invalid.");
      }
      channels.push(samples);
    }

    const declaredLength = Math.floor(source.length);
    const frameCount =
      Number.isFinite(declaredLength) && declaredLength >= 0
        ? declaredLength
        : channels.reduce(
            (longest, channel) => Math.max(longest, channel.length),
            0,
          );

    return {
      channels,
      frameCount,
      sampleRate: validateSampleRate(source.sampleRate),
    };
  }

  if (!Array.isArray(source)) {
    throw new AudioPreparationError("Audio channel data is invalid.");
  }
  const resolvedSampleRate = validateSampleRate(sampleRate ?? Number.NaN);
  let frameCount = 0;
  const channels: ArrayLike<number>[] = [];
  for (const channel of source) {
    if (!channel || typeof channel.length !== "number") {
      throw new AudioPreparationError("Audio channel data is invalid.");
    }
    channels.push(channel);
    frameCount = Math.max(frameCount, Math.floor(channel.length));
  }
  return { channels, frameCount, sampleRate: resolvedSampleRate };
}

function roundPeak(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000) / 1_000;
}

/**
 * Extract max-absolute-amplitude bins across all channels.
 *
 * Very short sources can reuse one sample across more than one bin.
 * Rounding keeps the persisted waveform compact.
 */
export function extractWaveformPeaks(
  source: AudioBufferLike | readonly ArrayLike<number>[],
  binCount = AudioPeakCount,
): number[] {
  if (!Number.isInteger(binCount) || binCount < 1 || binCount > MAX_PEAK_BINS) {
    throw new RangeError(
      `Waveform bin count must be between 1 and ${MAX_PEAK_BINS}.`,
    );
  }

  const { channels, frameCount } = readChannels(
    source,
    isAudioBufferLike(source) ? undefined : 1,
  );
  const peaks = new Array<number>(binCount).fill(0);
  if (frameCount <= 0 || channels.length === 0) return peaks;

  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * frameCount) / binCount);
    const end = Math.min(
      frameCount,
      Math.max(start + 1, Math.floor(((bin + 1) * frameCount) / binCount)),
    );
    let peak = 0;

    for (let frame = start; frame < end; frame += 1) {
      for (const channel of channels) {
        if (frame >= channel.length) continue;
        const sample = Number(channel[frame]);
        if (!Number.isFinite(sample)) continue;
        peak = Math.max(peak, Math.abs(sample));
      }
    }

    peaks[bin] = roundPeak(peak);
  }

  return peaks;
}

function clampPcmSample(sample: number): number {
  if (!Number.isFinite(sample)) return 0;
  return Math.min(1, Math.max(-1, sample));
}

function averagedMonoSample(
  channels: readonly ArrayLike<number>[],
  start: number,
  end: number,
): number {
  if (channels.length === 0 || end <= start) return 0;

  let sum = 0;
  let frameCount = 0;
  for (let frame = start; frame < end; frame += 1) {
    let channelSum = 0;
    for (const channel of channels) {
      const sample = frame < channel.length ? Number(channel[frame]) : 0;
      channelSum += Number.isFinite(sample) ? sample : 0;
    }
    sum += channelSum / channels.length;
    frameCount += 1;
  }

  return frameCount > 0 ? clampPcmSample(sum / frameCount) : 0;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/**
 * Encode a short, downsampled mono PCM WAV preview.
 *
 * The source may be an AudioBuffer-like object or explicit channel arrays plus
 * their source sample rate. Downsampling averages each source interval, which
 * is more useful for a waveform preview than taking only every Nth sample.
 */
export function encodePreviewWav(source: AudioBufferLike): Blob;
export function encodePreviewWav(
  source: readonly ArrayLike<number>[],
  sampleRate: number,
): Blob;
export function encodePreviewWav(
  source: AudioBufferLike | readonly ArrayLike<number>[],
  sampleRate?: number,
): Blob {
  const bufferSource = isAudioBufferLike(source);
  const {
    channels,
    frameCount,
    sampleRate: resolvedSampleRate,
  } = readChannels(source, bufferSource ? undefined : sampleRate);
  const maxDurationMs = AudioPreviewLimitMs;

  const sourceFramesLimit = Math.max(
    1,
    Math.floor((resolvedSampleRate * maxDurationMs) / 1_000),
  );
  const sourceFrames = Math.min(Math.max(0, frameCount), sourceFramesLimit);
  const outputFrames = Math.max(
    1,
    Math.min(
      Math.floor((AUDIO_PREVIEW_SAMPLE_RATE * maxDurationMs) / 1_000),
      Math.ceil(
        (sourceFrames * AUDIO_PREVIEW_SAMPLE_RATE) / resolvedSampleRate,
      ),
    ),
  );
  const dataSize = outputFrames * 2;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, AUDIO_PREVIEW_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_PREVIEW_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let outputFrame = 0; outputFrame < outputFrames; outputFrame += 1) {
    const start = Math.floor((outputFrame * sourceFrames) / outputFrames);
    const end = Math.min(
      sourceFrames,
      Math.max(
        start + 1,
        Math.floor(((outputFrame + 1) * sourceFrames) / outputFrames),
      ),
    );
    const sample = averagedMonoSample(channels, start, end);
    const pcm =
      sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    view.setInt16(44 + outputFrame * 2, pcm, true);
  }

  return new Blob([wav], { type: "audio/wav" });
}

function validateAudioBytes(bytes: ArrayBuffer): void {
  if (bytes.byteLength === 0) {
    throw new AudioPreparationError("Audio data is empty.");
  }
  if (bytes.byteLength > MaxAudioBytes) {
    throw new AudioPreparationError("Audio files must be 50 MiB or smaller.");
  }
}

function createAudioContext(): AudioContextLike {
  const audioGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const constructor =
    audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
  if (!constructor) {
    throw new AudioPreparationError(
      "This browser does not provide an AudioContext for local audio preparation.",
    );
  }
  // Decode at a fixed sample rate to bound the waveform buffer across devices.
  return new constructor({ sampleRate: 16_000 });
}

async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBufferLike> {
  const context = createAudioContext();
  try {
    let decoded: AudioBufferLike;
    try {
      decoded = await context.decodeAudioData(bytes);
    } catch {
      throw new AudioPreparationError(
        "The audio file could not be decoded by this browser.",
      );
    }
    if (!isAudioBufferLike(decoded)) {
      throw new AudioPreparationError("The decoded audio buffer is invalid.");
    }
    return decoded;
  } finally {
    if (context.close) {
      try {
        await context.close();
      } catch {
        // Closing an already-idle context can reject in some browsers. It does
        // not change the prepared bytes, so leave the decoded result intact.
      }
    }
  }
}

function analyzeDecodedAudio(decoded: AudioBufferLike): AudioAnalysis {
  const { channels, frameCount, sampleRate } = readChannels(decoded);
  if (channels.length === 0 || frameCount <= 0) {
    throw new AudioPreparationError("The audio file contains no samples.");
  }
  if (frameCount * channels.length > MAX_ANALYSIS_SAMPLES) {
    throw new AudioPreparationError(
      "The decoded audio sample allocation is too large.",
    );
  }

  const durationSeconds =
    typeof decoded.duration === "number" &&
    Number.isFinite(decoded.duration) &&
    decoded.duration > 0
      ? decoded.duration
      : frameCount / sampleRate;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AudioPreparationError("The audio duration is invalid.");
  }
  if (durationSeconds * 1_000 > MaxAudioDurationMs) {
    throw new AudioPreparationError(
      "Audio files must be 30 minutes or shorter.",
    );
  }

  return {
    durationMs: Math.max(1, Math.round(durationSeconds * 1_000)),
    peaks: extractWaveformPeaks(channels),
  };
}

/**
 * Decode a local File in the browser, returning only bounded derived data.
 * The original File is never uploaded, copied into the result, or retained by
 * this helper.
 */
export async function prepareLocalAudio(
  file: File,
): Promise<PreparedLocalAudio> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new AudioPreparationError("A local audio File is required.");
  }
  if (Number.isFinite(file.size) && file.size > MaxAudioBytes) {
    throw new AudioPreparationError("Audio files must be 50 MiB or smaller.");
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new AudioPreparationError("The local audio file could not be read.");
  }
  validateAudioBytes(bytes);
  const decoded = await decodeAudioBytes(bytes);
  return {
    ...analyzeDecodedAudio(decoded),
    preview: encodePreviewWav(decoded),
  };
}
