import { describe, expect, it } from "vitest";

import {
  CURRENT_EXPORT_WORKER_CAPABILITY,
  LEGACY_EDITING_EXPORT_WORKER_CAPABILITY,
  resolveExportSettings,
  sha256Fingerprint,
  validateStoredResolvedSettingsSnapshot,
} from "./index.js";

const at = "2026-08-20T12:00:00.000Z";

describe("resolved export settings", () => {
  it("replaces complete preset layers and merges overrides with null clearing", () => {
    const preview = resolveExportSettings({
      context: "logged",
      sourceLanguageClass: "confirmed_english",
      resolvedAt: at,
      contextDefault: {
        scope: "project",
        snapshot: {
          presetId: "10000000-0000-4000-8000-000000000001",
          presetVersion: 3,
          name: "Project",
          settings: {
            container: "mp4",
            videoCodec: "h264",
            videoRateControl: { mode: "crf", value: 18 },
            maxWidth: 1920,
            frameRate: "source",
            audioCodec: "aac",
            audioKilobitsPerSecond: 192,
            omitSubtitleFilesForConfirmedEnglish: false,
            embedEnglishSubtitleTrack: false,
          },
        },
      },
      selectedPreset: {
        scope: "personal",
        snapshot: {
          presetId: "20000000-0000-4000-8000-000000000002",
          presetVersion: 2,
          name: "Personal",
          settings: {
            container: "mp4",
            videoCodec: "h264",
            videoRateControl: { mode: "crf", value: 22 },
            maxWidth: 1280,
            frameRate: "source",
            audioCodec: "aac",
            audioKilobitsPerSecond: 128,
            omitSubtitleFilesForConfirmedEnglish: true,
            embedEnglishSubtitleTrack: false,
          },
        },
      },
      overrides: { maxWidth: null, audioKilobitsPerSecond: null },
    });
    expect(preview.snapshot.settings.videoRateControl).toEqual({
      mode: "crf",
      value: 22,
    });
    expect(preview.snapshot.settings.maxWidth).toBeUndefined();
    expect(preview.snapshot.settings.audioKilobitsPerSecond).toBeUndefined();
    expect(preview.issues).toEqual([]);
  });

  it("keeps omission inert for every non-confidently-English class", () => {
    for (const sourceLanguageClass of [
      "foreign",
      "mixed",
      "unknown",
    ] as const) {
      const preview = resolveExportSettings({
        context: "export_only",
        sourceLanguageClass,
        resolvedAt: at,
        overrides: { omitSubtitleFilesForConfirmedEnglish: true },
      });
      expect(
        preview.snapshot.settings.omitSubtitleFilesForConfirmedEnglish,
      ).toBe(true);
      expect(preview.effectiveSubtitlePolicy.requiredSidecars).toEqual([
        "original",
        "english",
      ]);
    }
  });

  it("accepts the explicit HEVC/MKV family and rejects crossed tuples", () => {
    const supported = resolveExportSettings({
      context: "export_only",
      sourceLanguageClass: "confirmed_english",
      resolvedAt: at,
      overrides: {
        container: "mkv",
        videoCodec: "hevc",
        videoRateControl: { mode: "bitrate", kilobitsPerSecond: 8_000 },
        maxWidth: 1_920,
        frameRate: "24",
        audioCodec: "aac",
        audioKilobitsPerSecond: 192,
      },
    });
    expect(supported.issues).toEqual([]);

    const preview = resolveExportSettings({
      context: "export_only",
      sourceLanguageClass: "confirmed_english",
      resolvedAt: at,
      overrides: {
        container: "mov",
        videoCodec: "hevc",
        videoRateControl: { mode: "bitrate", kilobitsPerSecond: 8_000 },
        maxWidth: 1_920,
        frameRate: "24",
        audioCodec: "pcm_s16le",
        audioKilobitsPerSecond: 192,
        embedEnglishSubtitleTrack: true,
      },
    });
    expect(preview.issues.map((issue) => issue.field)).toEqual([
      "container",
      "audioKilobitsPerSecond",
      "embedEnglishSubtitleTrack",
    ]);
  });

  it("fingerprints the capability profile and snapshot deterministically", () => {
    const first = resolveExportSettings({
      context: "export_only",
      sourceLanguageClass: "confirmed_english",
      resolvedAt: at,
    });
    const second = resolveExportSettings({
      context: "export_only",
      sourceLanguageClass: "confirmed_english",
      resolvedAt: "2026-08-21T12:00:00.000Z",
    });
    expect(CURRENT_EXPORT_WORKER_CAPABILITY.fingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(first.snapshot.resolutionFingerprint).toBe(
      second.snapshot.resolutionFingerprint,
    );
    expect(validateStoredResolvedSettingsSnapshot(first.snapshot)).toEqual([]);
    const legacyEditing = structuredClone(first.snapshot);
    legacyEditing.capability = {
      ...LEGACY_EDITING_EXPORT_WORKER_CAPABILITY,
      validation: "validated",
    };
    const {
      resolutionFingerprint: _legacyFingerprint,
      resolvedAt: _legacyResolvedAt,
      ...legacyUnsigned
    } = legacyEditing;
    legacyEditing.resolutionFingerprint = sha256Fingerprint(legacyUnsigned);
    expect(validateStoredResolvedSettingsSnapshot(legacyEditing)).toEqual([]);
    const changed = structuredClone(first.snapshot);
    changed.settings.videoRateControl = { mode: "crf", value: 19 };
    expect(validateStoredResolvedSettingsSnapshot(changed)).toContainEqual(
      expect.objectContaining({ code: "resolved_settings_snapshot_changed" }),
    );
    const unavailable = structuredClone(first.snapshot);
    unavailable.capability.profileVersion += 1;
    expect(validateStoredResolvedSettingsSnapshot(unavailable)).toContainEqual(
      expect.objectContaining({ code: "capability_profile_unavailable" }),
    );
  });
});
