import { describe, expect, it, vi } from "vitest";

import {
  AudioPeakCount,
  AudioPreviewLimitMs,
  MaxAudioBytes,
  MaxAudioDurationMs,
} from "@research-video/contracts";
import {
  AUDIO_PREVIEW_SAMPLE_RATE,
  AudioPreparationError,
  encodePreviewWav,
  extractWaveformPeaks,
  prepareLocalAudio,
} from "./audio-waveform.ts";

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );
}

function installAudioContext(decoded: {
  duration: number;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}) {
  const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
  const decodeAudioData = vi.fn(async () => decoded);
  class FakeAudioContext {
    decodeAudioData = decodeAudioData;
    close = vi.fn(async () => undefined);
  }
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });
  return {
    decodeAudioData,
    restore: () => {
      if (previous === undefined) {
        delete (globalThis as { AudioContext?: unknown }).AudioContext;
      } else {
        Object.defineProperty(globalThis, "AudioContext", {
          configurable: true,
          value: previous,
        });
      }
    },
  };
}

describe("browser audio waveform preparation", () => {
  it("extracts 256 rounded max-amplitude bins across channels", () => {
    const peaks = extractWaveformPeaks(
      [
        new Float32Array([0.1, -0.8, 0.2, 0]),
        new Float32Array([0.4, 0.3, -0.6, 1]),
      ],
      4,
    );

    expect(peaks).toEqual([0.4, 0.8, 0.6, 1]);
    expect(extractWaveformPeaks([new Float32Array([0.5])])).toHaveLength(
      AudioPeakCount,
    );
    expect(extractWaveformPeaks([new Float32Array([0.5])])[0]).toBe(0.5);
  });

  it("writes a bounded mono 8 kHz signed-16 WAV preview", async () => {
    const preview = encodePreviewWav([new Float32Array([1, -1, 0.5, 0])], 4);
    const bytes = new Uint8Array(await preview.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(preview.type).toBe("audio/wav");
    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(AUDIO_PREVIEW_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(AUDIO_PREVIEW_SAMPLE_RATE * 2);
    expect(bytes.byteLength).toBe(44 + AUDIO_PREVIEW_SAMPLE_RATE * 2);
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(44 + 2_000 * 2, true)).toBe(-32_768);
  });

  it("limits a long preview to the first 15 seconds and retains one sample", async () => {
    const longPreview = encodePreviewWav(
      [new Float32Array(20_000).fill(0.25)],
      1_000,
    );
    const longBytes = new Uint8Array(await longPreview.arrayBuffer());
    const longView = new DataView(longBytes.buffer);
    expect(longView.getUint32(24, true)).toBe(AUDIO_PREVIEW_SAMPLE_RATE);
    expect(longView.getUint32(40, true)).toBe(
      (AUDIO_PREVIEW_SAMPLE_RATE * AudioPreviewLimitMs * 2) / 1_000,
    );

    const tiny = encodePreviewWav([new Float32Array([])], 44_100);
    expect((await tiny.arrayBuffer()).byteLength).toBe(46);
  });

  it("decodes local files in-browser and returns only bounded derived data", async () => {
    const decoded = {
      duration: 2,
      length: 8,
      numberOfChannels: 2,
      sampleRate: 4,
      getChannelData: (channel: number) =>
        new Float32Array(channel === 0 ? [0, 0.5, 0, 0] : [0, 0, -1, 0]),
    };
    const context = installAudioContext(decoded);
    try {
      const sourceBytes = new Uint8Array([1, 2, 3, 4]);
      const file = {
        size: sourceBytes.byteLength,
        arrayBuffer: async () => sourceBytes.buffer,
      } as unknown as File;
      const prepared = await prepareLocalAudio(file);

      expect(prepared.durationMs).toBe(2_000);
      expect(prepared.peaks).toHaveLength(AudioPeakCount);
      expect(prepared.preview.type).toBe("audio/wav");
      expect("file" in prepared).toBe(false);
      expect(context.decodeAudioData).toHaveBeenCalledOnce();
    } finally {
      context.restore();
    }
  });

  it("rejects oversized files before invoking a browser decoder", async () => {
    const decode = vi.fn();
    const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: class {
        decodeAudioData = decode;
      },
    });
    try {
      const file = {
        size: MaxAudioBytes + 1,
        arrayBuffer: vi.fn(),
      } as unknown as File;
      await expect(prepareLocalAudio(file)).rejects.toThrow(
        AudioPreparationError,
      );
      expect(file.arrayBuffer).not.toHaveBeenCalled();
      expect(decode).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete (globalThis as { AudioContext?: unknown }).AudioContext;
      } else {
        Object.defineProperty(globalThis, "AudioContext", {
          configurable: true,
          value: previous,
        });
      }
    }
  });

  it("rejects decoded audio longer than 30 minutes", async () => {
    const decoded = {
      duration: MaxAudioDurationMs / 1_000 + 1,
      length: 1,
      numberOfChannels: 1,
      sampleRate: 1,
      getChannelData: () => new Float32Array([0]),
    };
    const context = installAudioContext(decoded);
    try {
      const file = {
        size: 1,
        arrayBuffer: async () => new ArrayBuffer(1),
      } as unknown as File;
      await expect(prepareLocalAudio(file)).rejects.toThrow(
        "30 minutes or shorter",
      );
    } finally {
      context.restore();
    }
  });
});
