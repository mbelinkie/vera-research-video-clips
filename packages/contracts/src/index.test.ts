import { describe, expect, it } from "vitest";

import {
  AcceptLoggedExportDeliveryRequestSchema,
  BatchPreflightRequestSchema,
  ClipLanguageEvidenceV2Schema,
  CreateClipExportRequestSchema,
  CreateTranscriptionBatchRequestSchema,
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
  ExportPresetCatalogEntrySchema,
  ExportPresetDefaultSchema,
  ExportPresetSnapshotSchema,
  ExportSettingsSchema,
  InstalledExportWorkerCapabilitySummarySchema,
  ClaimLoggedExportDeliveryRequestSchema,
  LoggedExportDeliverySchema,
  LoggedExportFailureResultSchema,
  LoggedExportFailureSchema,
  LoggedExportSuccessResultSchema,
  LoggedExportSuccessSchema,
  ProcessAcceptedLoggedExportRequestSchema,
  ProcessAcceptedLoggedExportResponseSchema,
  ReconcileLoggedExportFailureRequestSchema,
  ReconcileLoggedExportSuccessRequestSchema,
  FinalArtifactProvenanceSchema,
  HealthResponseSchema,
  JobSchema,
  ProjectSchema,
  TranscriptTrackSchema,
  TranscriptionBatchControlRequestSchema,
  UpdateReviewStatusRequestSchema,
  UpdatePreferredLanguageRequestSchema,
  languagesEquivalent,
} from "./index.ts";

const now = "2026-08-01T12:00:00.000Z";
const id = "019fbb95-cd76-7920-93fa-e23ba755ee3f";

describe("shared contracts", () => {
  it("requires exact worker epoch plus delivery generation and token for logged handoff", () => {
    const claim = {
      workerId: id,
      workerEpoch: 3,
    };
    expect(ClaimLoggedExportDeliveryRequestSchema.parse(claim)).toEqual(claim);
    const acceptance = {
      ...claim,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      generation: 4,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee41",
    };
    expect(AcceptLoggedExportDeliveryRequestSchema.parse(acceptance)).toEqual(
      acceptance,
    );
    expect(
      AcceptLoggedExportDeliveryRequestSchema.safeParse({
        ...acceptance,
        reservationToken: undefined,
      }).success,
    ).toBe(false);
    expect(
      AcceptLoggedExportDeliveryRequestSchema.safeParse({
        ...acceptance,
        generation: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid logged-delivery reservation and acceptance chronology", () => {
    const delivery = deliveryContractFixture();
    expect(LoggedExportDeliverySchema.safeParse(delivery).success).toBe(true);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        reservationExpiresAt: delivery.reservedAt,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        status: "accepted",
        acceptedAt: "2026-08-20T11:59:59.999Z",
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        status: "accepted",
        acceptedAt: delivery.reservationExpiresAt,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        request: {
          ...delivery.request,
          video: {
            ...delivery.request.video,
            canonicalUrl: `${delivery.request.video.canonicalUrl}&token=private`,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only canonical sanitized logged-export success provenance", () => {
    const result = successResultContractFixture();
    expect(LoggedExportSuccessResultSchema.parse(result)).toEqual(result);
    const reconcile = {
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      workerEpoch: 3,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      result,
    };
    expect(ReconcileLoggedExportSuccessRequestSchema.parse(reconcile)).toEqual(
      reconcile,
    );
    expect(
      LoggedExportSuccessResultSchema.safeParse({
        ...result,
        artifacts: [...result.artifacts].reverse(),
      }).success,
    ).toBe(false);
    expect(
      LoggedExportSuccessResultSchema.safeParse({
        ...result,
        artifacts: result.artifacts.map((artifact, index) => ({
          ...artifact,
          sourceAttempt: index === 0 ? 2 : artifact.sourceAttempt,
        })),
      }).success,
    ).toBe(false);
    expect(
      ProcessAcceptedLoggedExportRequestSchema.safeParse({
        requestId: result.requestId,
        authorizationConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportSuccessSchema.safeParse({
        id,
        deliveryId: reconcile.deliveryId,
        generation: reconcile.generation,
        workerId: reconcile.workerId,
        workerEpoch: reconcile.workerEpoch,
        result,
        resultFingerprint: "a".repeat(64),
        reconciledAt: now,
        reservationToken: reconcile.reservationToken,
      }).success,
    ).toBe(false);
  });

  it("sanitizes and binds terminal-safe logged-export failure provenance", () => {
    const result = LoggedExportFailureResultSchema.parse({
      schemaVersion: 1,
      requestId: "019fbb95-cd76-7920-93fa-e23ba755ee51",
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee52",
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee53",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
      error: {
        code: "Renderer Failed!",
        message:
          "failed at /private/source.mp4 C:\\Users\\name\\source.mov \\\\server\\share\\source.mov file:///private/source.mov token=secret Bearer abc.def-123 https://private.invalid/source 019fbb95-cd76-7920-93fa-e23ba755ee55",
      },
      attempt: 1,
      sourceCleanup: { lifecycle: "deleted", deletedAt: now },
    });
    expect(result.error).toEqual({
      code: "renderer_failed",
      message:
        "failed at <path> <path> <path> <path> token=<redacted> Bearer <redacted> <url> <id>",
    });
    expect(LoggedExportFailureResultSchema.parse(result)).toEqual(result);
    const reconcile = ReconcileLoggedExportFailureRequestSchema.parse({
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      workerEpoch: 3,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      result,
    });
    const failure = LoggedExportFailureSchema.parse({
      id,
      deliveryId: reconcile.deliveryId,
      generation: reconcile.generation,
      workerId: reconcile.workerId,
      workerEpoch: reconcile.workerEpoch,
      result,
      resultFingerprint: "a".repeat(64),
      reconciledAt: now,
    });
    expect(
      ProcessAcceptedLoggedExportResponseSchema.parse({
        execution: "failed",
        failure,
      }),
    ).toMatchObject({ execution: "failed", failure: { result } });
    expect(
      LoggedExportFailureResultSchema.safeParse({
        ...result,
        attempt: 0,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportFailureResultSchema.safeParse({
        ...result,
        sourceCleanup: { lifecycle: "not_started" },
      }).success,
    ).toBe(false);
    expect(
      LoggedExportFailureSchema.safeParse({
        ...failure,
        reservationToken: reconcile.reservationToken,
      }).success,
    ).toBe(false);
  });

  it("accepts a versioned project", () => {
    const project = ProjectSchema.parse({
      id,
      name: "Essay research",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(project.description).toBe("");
  });

  it("rejects a projectless non-export job only at the command boundary, not transport", () => {
    expect(
      JobSchema.parse({
        id,
        kind: "export",
        state: "queued",
        idempotencyKey: "export-only:fixture",
        attempt: 0,
        payload: { mode: "export_only" },
        createdAt: now,
        updatedAt: now,
      }).projectId,
    ).toBeUndefined();
  });

  it("validates health responses", () => {
    expect(
      HealthResponseSchema.safeParse({
        service: "local-agent",
        status: "ok",
        version: "0.1.0",
        timestamp: now,
      }).success,
    ).toBe(true);
  });

  it("requires an ordered complete partition for installed renderer advertisements", () => {
    const complete = {
      schemaVersion: 1,
      availableRendererIds: ["h264_mp4", "prores_mov"],
      unavailableRendererIds: ["hevc_mkv"],
      ffmpegVersion: "8.1.2",
    };
    expect(
      InstalledExportWorkerCapabilitySummarySchema.parse(complete),
    ).toEqual(complete);
    for (const invalid of [
      {
        ...complete,
        availableRendererIds: ["h264_mp4", "h264_mp4"],
      },
      {
        ...complete,
        unavailableRendererIds: ["h264_mp4", "hevc_mkv"],
      },
      {
        ...complete,
        availableRendererIds: ["prores_mov", "h264_mp4"],
      },
      { ...complete, unavailableRendererIds: [] },
      { ...complete, ffmpegVersion: "/usr/local/bin/ffmpeg 8.1" },
    ]) {
      expect(
        InstalledExportWorkerCapabilitySummarySchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("normalizes BCP-47 account preferences and compares primary languages", () => {
    expect(
      UpdatePreferredLanguageRequestSchema.parse({
        preferredLanguage: "ES_mx",
      }),
    ).toEqual({ preferredLanguage: "es-MX" });
    expect(languagesEquivalent("en-US", "en-GB")).toBe(true);
    expect(
      UpdatePreferredLanguageRequestSchema.safeParse({
        preferredLanguage: "not a language",
      }).success,
    ).toBe(false);
  });

  it("requires strict native, English, and distinct direct preferred evidence", () => {
    const nativeTrackId = id;
    const englishTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const preferredTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const evidence = {
      schemaVersion: 2,
      native: {
        role: "native",
        language: "ro",
        text: "Un exemplu",
        trackId: nativeTrackId,
        trackVersion: 1,
        timingPrecision: "cue",
      },
      english: {
        role: "english",
        language: "en-GB",
        text: "An example",
        trackId: englishTrackId,
        trackVersion: 1,
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
      },
      preferred: {
        role: "preferred",
        language: "es-MX",
        text: "Un ejemplo",
        trackId: preferredTrackId,
        trackVersion: 1,
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
      },
    };
    expect(ClipLanguageEvidenceV2Schema.parse(evidence)).toMatchObject({
      preferred: { language: "es-MX" },
    });
    expect(
      ClipLanguageEvidenceV2Schema.safeParse({
        ...evidence,
        preferred: { ...evidence.preferred, language: "en" },
      }).success,
    ).toBe(false);
    expect(
      ClipLanguageEvidenceV2Schema.safeParse({
        ...evidence,
        preferred: { ...evidence.preferred, sourceTrackId: englishTrackId },
      }).success,
    ).toBe(false);
    expect(
      TranscriptTrackSchema.parse({
        id: preferredTrackId,
        videoId: "Romanian001",
        language: "es",
        kind: "translation",
        source: "translated",
        provider: "fixture",
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
        schemaVersion: 1,
        contentSha256: "a".repeat(64),
        version: 1,
      }).kind,
    ).toBe("translation");
  });

  it("defaults bounded batch requests to local shared-first processing", () => {
    expect(
      CreateTranscriptionBatchRequestSchema.parse({
        name: "Launch research",
        inputs: ["https://youtu.be/ReadyVideo1"],
      }),
    ).toMatchObject({
      targetLanguage: "en",
      transcriptionProfile: "default",
      sourcePolicy: "prefer-existing",
      executionLocation: "local",
      priority: "normal",
    });
    expect(BatchPreflightRequestSchema.safeParse({ inputs: [] }).success).toBe(
      false,
    );
  });

  it("requires optimistic versions for batch control commands", () => {
    expect(
      TranscriptionBatchControlRequestSchema.parse({
        action: "pause_pending",
        expectedVersion: 2,
      }),
    ).toEqual({ action: "pause_pending", expectedVersion: 2 });
    expect(
      TranscriptionBatchControlRequestSchema.safeParse({
        action: "retry_failed",
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("requires optimistic versions for review status changes", () => {
    expect(
      UpdateReviewStatusRequestSchema.parse({
        reviewStatus: "reviewing",
        expectedVersion: 3,
      }),
    ).toEqual({ reviewStatus: "reviewing", expectedVersion: 3 });
  });

  it("validates export setting capabilities before snapshotting a job", () => {
    const settings = {
      container: "mp4",
      videoCodec: "h264",
      videoRateControl: { mode: "crf", value: 20 },
      maxWidth: 1_920,
      frameRate: "source",
      audioCodec: "aac",
      audioKilobitsPerSecond: 192,
      omitSubtitleFilesForConfirmedEnglish: false,
      embedEnglishSubtitleTrack: false,
    };
    expect(ExportSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      ExportSettingsSchema.safeParse({
        ...settings,
        videoCodec: "prores",
      }).error?.issues[0]?.message,
    ).toMatch(/requires MOV or MKV/u);
  });

  it("keeps legacy inline snapshots compatible and makes catalog responses strict", () => {
    const settings = {
      container: "mp4" as const,
      videoCodec: "h264" as const,
      videoRateControl: { mode: "crf" as const, value: 20 },
      frameRate: "source" as const,
      audioCodec: "aac" as const,
      omitSubtitleFilesForConfirmedEnglish: false,
      embedEnglishSubtitleTrack: false,
    };
    expect(
      ExportPresetSnapshotSchema.parse({
        presetVersion: 1,
        name: "Editing MP4",
        settings,
      }),
    ).not.toHaveProperty("presetId");
    const entry = {
      id,
      scope: "personal",
      currentVersion: 1,
      entityVersion: 1,
      current: {
        presetId: id,
        presetVersion: 1,
        name: "My editing preset",
        description: "Personal default",
        settings,
        createdBy: id,
        createdAt: now,
      },
      createdBy: id,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      ExportPresetCatalogEntrySchema.parse(entry).current.settings,
    ).toEqual(settings);
    expect(
      ExportPresetCatalogEntrySchema.safeParse({ ...entry, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      ExportPresetDefaultSchema.safeParse({
        scope: "personal",
        presetId: id,
        presetVersion: 1,
        entityVersion: 1,
        snapshot: {
          presetId: id,
          presetVersion: 2,
          name: "Wrong revision",
          settings,
        },
        description: "Wrong fixed revision",
        updatedBy: id,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(false);
  });

  it("requires immutable bilingual track identities for foreign, mixed, and unknown exports", () => {
    const request = {
      idempotencyKey: "bilingual-fixture",
      sourceLanguageClass: "foreign",
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          frameRate: "source",
          audioCodec: "aac",
          omitSubtitleFilesForConfirmedEnglish: true,
          embedEnglishSubtitleTrack: false,
        },
      },
    };
    expect(CreateClipExportRequestSchema.safeParse(request).success).toBe(
      false,
    );
    expect(
      CreateClipExportRequestSchema.parse({
        ...request,
        subtitleTracks: {
          original: { trackId: id, trackVersion: 1 },
          english: {
            trackId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
            trackVersion: 1,
          },
        },
      }).subtitleTracks,
    ).toBeDefined();
  });

  it("validates a versioned clip package manifest with per-sidecar provenance", () => {
    const manifest = {
      schemaVersion: 1,
      exportRequestId: id,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      mode: "export_only",
      packageIdentity: `clip-${id}`,
      sourceAttempt: 1,
      validatedAt: now,
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture video",
        sourceLanguage: "es",
      },
      sourceLanguageClass: "foreign",
      resolvedExportBounds: { startMs: 0, endMs: 2_000, sourceAttempt: 1 },
      renderedDurationMs: 2_000,
      subtitlePolicy: { requiredSidecars: ["original", "english"] },
      toolVersions: { ffprobeVersion: "7.1", ffmpegVersion: "8.1.2" },
      artifacts: [
        {
          role: "video_mp4",
          filename: `clip-${id}.mp4`,
          byteSize: 1_024,
          contentSha256: "a".repeat(64),
        },
        {
          role: "original_srt",
          filename: `clip-${id}.original.srt`,
          byteSize: 96,
          contentSha256: "b".repeat(64),
          subtitle: {
            language: "es",
            trackId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
            trackVersion: 1,
            timingPrecision: "cue",
            cueCount: 2,
            startMs: 0,
            endMs: 2_000,
          },
        },
        {
          role: "clip_metadata_json",
          filename: `clip-${id}.json`,
          byteSize: 512,
          contentSha256: "c".repeat(64),
        },
        {
          role: "thumbnail_jpg",
          filename: `clip-${id}.jpg`,
          byteSize: 640,
          contentSha256: "d".repeat(64),
          thumbnail: {
            extractionTimeMs: 1_000,
            width: 640,
            height: 360,
            jpegQuality: 3,
          },
        },
      ],
    };

    expect(ExportClipManifestSchema.parse(manifest)).toMatchObject({
      schemaVersion: 1,
      subtitlePolicy: { requiredSidecars: ["original", "english"] },
    });
    expect(
      ExportClipManifestSchema.parse({
        ...manifest,
        subtitlePolicy: {
          requiredSidecars: [],
          subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
        },
        artifacts: [manifest.artifacts[0], manifest.artifacts[2]],
      }).subtitlePolicy.subtitleSidecarsOmittedReason,
    ).toBe("confirmed_english_user_setting");
    expect(
      ExportClipManifestSchema.safeParse({ ...manifest, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      ExportClipManifestSchema.safeParse({
        ...manifest,
        artifacts: [
          ...manifest.artifacts.slice(0, 3),
          {
            ...manifest.artifacts[3],
            thumbnail: {
              extractionTimeMs: 1_000,
              width: 641,
              height: 360,
              jpegQuality: 3,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ExportClipManifestSchema.safeParse({
        ...manifest,
        artifacts: manifest.artifacts.slice(0, 2),
      }).success,
    ).toBe(true);
    expect(
      ExportClipManifestSchema.safeParse({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], contentSha256: "not-a-hash" }],
      }).success,
    ).toBe(false);
  });

  it("records a promoted manifest as its own final artifact role", () => {
    expect(
      FinalArtifactProvenanceSchema.parse({
        role: "manifest_json",
        packageIdentity: `clip-${id}`,
        byteSize: 512,
        contentSha256: "c".repeat(64),
        sourceAttempt: 1,
        validatedAt: now,
      }).role,
    ).toBe("manifest_json");
  });

  it("validates descriptive clip metadata with only the canonical public video URL", () => {
    const metadata = {
      schemaVersion: 1,
      exportRequestId: id,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      mode: "export_only",
      packageIdentity: `clip-${id}`,
      sourceAttempt: 1,
      validatedAt: now,
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture video",
      },
      sourceLanguageClass: "confirmed_english",
      selection: {
        trackId: id,
        transcriptVersion: 1,
        firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
        lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        transcriptStartMs: 100,
        transcriptEndMs: 900,
        exportStartMs: 0,
        exportEndMs: 1_000,
        text: "Selected fixture text",
        timingPrecision: "cue",
      },
      resolvedExportBounds: { startMs: 0, endMs: 1_000, sourceAttempt: 1 },
      renderedDurationMs: 1_000,
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          frameRate: "source",
          audioCodec: "aac",
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
      subtitlePolicy: { requiredSidecars: ["english"] },
    };
    expect(ExportClipMetadataSchema.parse(metadata)).toMatchObject({
      schemaVersion: 1,
      video: { canonicalUrl: metadata.video.canonicalUrl },
    });
    expect(
      ExportClipMetadataSchema.safeParse({
        ...metadata,
        video: {
          ...metadata.video,
          canonicalUrl: "file:///private/source.mp4",
        },
      }).success,
    ).toBe(false);
  });
});

function deliveryContractFixture() {
  const settings = {
    container: "mp4" as const,
    videoCodec: "h264" as const,
    videoRateControl: { mode: "crf" as const, value: 20 },
    frameRate: "source" as const,
    audioCodec: "aac" as const,
    omitSubtitleFilesForConfirmedEnglish: false,
    embedEnglishSubtitleTrack: false,
  };
  return {
    deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
    generation: 1,
    reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee41",
    workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
    workerEpoch: 1,
    status: "reserved" as const,
    reservedAt: "2026-08-20T12:00:00.000Z",
    reservationExpiresAt: "2026-08-20T12:00:30.000Z",
    request: {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      mode: "logged" as const,
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ee46",
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture",
      },
      selection: {
        trackId: "019fbb95-cd76-7920-93fa-e23ba755ee47",
        transcriptVersion: 1,
        firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee48",
        lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee49",
        transcriptStartMs: 0,
        transcriptEndMs: 1_000,
        exportStartMs: 0,
        exportEndMs: 1_000,
        text: "Fixture",
        timingPrecision: "cue" as const,
      },
      sourceLanguageClass: "confirmed_english" as const,
      preset: { presetVersion: 1, name: "Editing MP4", settings },
      resolvedSettingsSnapshot: {
        schemaVersion: 1 as const,
        resolutionKind: "catalog" as const,
        context: "logged" as const,
        base: "application_default" as const,
        applicationDefaultVersion: 1 as const,
        overrides: {},
        overrideFields: [],
        settings,
        capability: {
          profileId: "local-editing-renderer",
          profileVersion: 3,
          fingerprint: "a".repeat(64),
          validation: "validated" as const,
        },
        resolutionFingerprint: "b".repeat(64),
        resolvedAt: "2026-08-20T11:59:00.000Z",
      },
      state: "queued" as const,
      createdAt: "2026-08-20T11:59:00.000Z",
      updatedAt: "2026-08-20T11:59:00.000Z",
    },
  };
}

function successResultContractFixture() {
  const requestId = "019fbb95-cd76-7920-93fa-e23ba755ee51";
  const packageIdentity = `clip-${requestId}`;
  const artifact = (role: string, hash: string) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: hash.repeat(64),
    sourceAttempt: 1,
    validatedAt: now,
  });
  return {
    schemaVersion: 1 as const,
    requestId,
    jobId: "019fbb95-cd76-7920-93fa-e23ba755ee52",
    projectId: "019fbb95-cd76-7920-93fa-e23ba755ee53",
    clipId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
    sourceLanguageClass: "confirmed_english" as const,
    resolvedExportBounds: {
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      resolvedAt: now,
    },
    renderedMediaProvenance: {
      durationMs: 1_000,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1 as const,
      settingsSha256: "a".repeat(64),
      observedProperties: {
        schemaVersion: 1 as const,
        container: { formatNames: ["mp4"] },
        streamCounts: {
          total: 2,
          video: 1,
          audio: 1,
          subtitle: 0,
          data: 0,
          other: 0,
        },
        video: {
          codec: "h264",
          profile: "High",
          pixelFormat: "yuv420p",
          width: 1_920,
          height: 1_080,
          sampleAspectRatio: { numerator: 1, denominator: 1 },
          displayAspectRatio: { numerator: 16, denominator: 9 },
          averageFrameRate: { numerator: 30, denominator: 1 },
        },
        audio: {
          codec: "aac",
          sampleRate: 48_000,
          channels: 2,
          channelLayout: "stereo",
        },
        durationMs: 1_000,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt: 1,
      validatedAt: now,
    },
    thumbnailProvenance: {
      extractionTimeMs: 500,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: now,
    },
    subtitleOmissionProvenance: {
      policy: "confirmed_english_user_setting" as const,
      sourceAttempt: 1,
      validatedAt: now,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("manifest_json", "2"),
      artifact("thumbnail_jpg", "3"),
      artifact("video_mp4", "4"),
    ],
  };
}
