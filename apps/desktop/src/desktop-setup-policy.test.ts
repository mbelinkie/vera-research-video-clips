import { describe, expect, it } from "vitest";

import {
  deriveReadinessReport,
  type ComponentHealth,
  type SetupSnapshot,
} from "@research-video/contracts";

import {
  applyModelPinAvailability,
  mergeDesktopReadiness,
  modelDownloadCanCancel,
  parseTrustedRuntimePaths,
  resolveWorkerConfiguration,
  setupActionRequiresRuntimeRestart,
  shouldRunExportSupervisor,
  shouldRunTranscriptionWorker,
} from "./desktop-setup-policy.ts";

const now = "2026-08-23T12:00:00.000Z";
const ready = (component: ComponentHealth["component"]): ComponentHealth => ({
  component,
  state: "ready",
  reason: "ready",
  remediation: "none",
  checkedAt: now,
});

const setupSnapshot: SetupSnapshot = {
  setup: {
    schemaVersion: 1,
    rightsAcknowledged: true,
    privacyAcknowledged: true,
    workerEnabled: true,
    translationConsent: false,
    captionProvider: "disabled",
    mediaProvider: "yt_dlp_audio",
    exportSourceProvider: "yt_dlp",
    speechToTextProvider: "whisper_cpp",
    translationProvider: "disabled",
    updatedAt: now,
  },
  activeComponents: [
    {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee65",
      target: "whisper_model",
      displayName: "Fixture Whisper",
      version: "fixture-v1",
      validatedAt: now,
    },
  ],
};

describe("desktop setup policy", () => {
  it("restarts runtime when translation consent changes and makes promotion atomic", () => {
    expect(
      setupActionRequiresRuntimeRestart({
        action: "set_translation_consent",
        consented: true,
      }),
    ).toBe(true);
    expect(
      setupActionRequiresRuntimeRestart({
        action: "set_rights_acknowledgement",
        acknowledged: true,
      }),
    ).toBe(false);
    expect(modelDownloadCanCancel("verifying")).toBe(true);
    expect(modelDownloadCanCancel("promoting")).toBe(false);
  });

  it("starts transcription only for a signed-in, enabled, locally ready setup", () => {
    const components = [
      "cache_root",
      "media_provider",
      "speech_to_text_provider",
      "yt_dlp",
      "whisper_cli",
      "whisper_model",
      "cache_storage",
    ].map((component) => ready(component as ComponentHealth["component"]));
    const localReadiness = deriveReadinessReport({
      checkedAt: now,
      components,
      requirements: {
        project_browsing: [],
        verified_cached_review: [],
        project_logging: [],
        transcript_processing: [],
        export_processing: [],
      },
    });
    expect(
      shouldRunTranscriptionWorker({
        signedIn: true,
        snapshot: setupSnapshot,
        localReadiness,
      }),
    ).toBe(true);
    expect(
      shouldRunTranscriptionWorker({
        signedIn: false,
        snapshot: setupSnapshot,
        localReadiness,
      }),
    ).toBe(false);
    expect(
      shouldRunTranscriptionWorker({
        signedIn: true,
        snapshot: setupSnapshot,
        localReadiness: {
          ...localReadiness,
          components: components.map((component) =>
            component.component === "cache_storage"
              ? {
                  ...component,
                  state: "degraded" as const,
                  reason: "storage_recommended" as const,
                  remediation: "free_storage" as const,
                }
              : component,
          ),
        },
      }),
    ).toBe(true);
    expect(
      shouldRunTranscriptionWorker({
        signedIn: true,
        snapshot: setupSnapshot,
        localReadiness: {
          ...localReadiness,
          components: components.map((component) =>
            component.component === "whisper_model"
              ? {
                  ...component,
                  state: "needs_action" as const,
                  reason: "model_changed" as const,
                  remediation: "select_whisper_model" as const,
                }
              : component,
          ),
        },
      }),
    ).toBe(false);
  });

  it("starts export scheduling only for a signed-in, enabled, locally ready setup", () => {
    const components = [
      "output_root",
      "export_source_provider",
      "ffmpeg",
      "ffprobe",
      "yt_dlp",
      "output_storage",
    ].map((component) => ready(component as ComponentHealth["component"]));
    const localReadiness = deriveReadinessReport({
      checkedAt: now,
      components,
      requirements: {
        project_browsing: [],
        verified_cached_review: [],
        project_logging: [],
        transcript_processing: [],
        export_processing: [],
      },
    });
    expect(
      shouldRunExportSupervisor({
        signedIn: true,
        snapshot: setupSnapshot,
        localReadiness,
      }),
    ).toBe(true);
    expect(
      shouldRunExportSupervisor({
        signedIn: false,
        snapshot: setupSnapshot,
        localReadiness,
      }),
    ).toBe(false);
    expect(
      shouldRunExportSupervisor({
        signedIn: true,
        snapshot: setupSnapshot,
        localReadiness: {
          ...localReadiness,
          components: components.map((component) =>
            component.component === "output_storage"
              ? {
                  ...component,
                  state: "degraded" as const,
                  reason: "storage_recommended" as const,
                  remediation: "free_storage" as const,
                }
              : component,
          ),
        },
      }),
    ).toBe(true);
    expect(
      shouldRunExportSupervisor({
        signedIn: true,
        snapshot: setupSnapshot,
        localReadiness: {
          ...localReadiness,
          components: components.map((component) =>
            component.component === "yt_dlp"
              ? {
                  ...component,
                  state: "needs_action" as const,
                  reason: "tool_changed" as const,
                  remediation: "select_yt_dlp" as const,
                }
              : component,
          ),
        },
      }),
    ).toBe(false);
  });

  it("merges external authority without making cloud failure block cached review", () => {
    const local = deriveReadinessReport({
      checkedAt: now,
      components: [ready("local_database"), ready("cache_root")],
      requirements: {
        project_browsing: [],
        verified_cached_review: [],
        project_logging: [],
        transcript_processing: [],
        export_processing: [],
      },
    });
    const merged = mergeDesktopReadiness({
      checkedAt: now,
      local,
      external: [
        ready("desktop"),
        ready("authentication"),
        ready("network"),
        {
          component: "cloud_api",
          state: "blocked",
          reason: "cloud_unavailable",
          remediation: "retry",
          checkedAt: now,
        },
        {
          component: "transcription_worker",
          state: "needs_action",
          reason: "worker_disabled",
          remediation: "enable_worker",
          checkedAt: now,
        },
      ],
    });
    expect(
      merged.operations.find(
        (operation) => operation.operation === "verified_cached_review",
      )?.state,
    ).toBe("ready");
    expect(
      merged.operations.find(
        (operation) => operation.operation === "project_browsing",
      ),
    ).toMatchObject({ state: "blocked", blockingComponents: ["cloud_api"] });
  });

  it("accepts only the fixed trusted path vocabulary and fails closed worker configuration", () => {
    const paths = parseTrustedRuntimePaths({
      ytDlp: "/tools/yt-dlp",
      whisperCli: "/tools/whisper-cli",
      whisperModel: "/models/fixture.bin",
      cacheRoot: "/workspace/cache",
    });
    expect(resolveWorkerConfiguration(setupSnapshot, paths)).toMatchObject({
      captionProvider: "disabled",
      mediaProvider: "yt-dlp-audio",
      translationProvider: "disabled",
      whisperModelName: "fixture-v1",
      cacheRoot: "/workspace/cache",
    });
    expect(() => parseTrustedRuntimePaths({ shell: "/bin/zsh" })).toThrow();
    expect(() =>
      resolveWorkerConfiguration(setupSnapshot, {
        ytDlp: paths.ytDlp!,
        whisperCli: paths.whisperCli!,
      }),
    ).toThrow("not ready");
  });

  it("makes an absent production model pin explicit even when local bytes exist", () => {
    const report = deriveReadinessReport({
      checkedAt: now,
      components: [ready("whisper_model")],
      requirements: {
        project_browsing: [],
        verified_cached_review: [],
        project_logging: [],
        transcript_processing: ["whisper_model"],
        export_processing: [],
      },
    });
    expect(
      applyModelPinAvailability(report, false, now).components[0],
    ).toMatchObject({
      state: "needs_action",
      reason: "model_pin_required",
      remediation: "configure_model_pin",
    });
  });
});
