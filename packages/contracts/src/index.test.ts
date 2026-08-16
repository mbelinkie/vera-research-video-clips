import { describe, expect, it } from "vitest";

import {
  BatchPreflightRequestSchema,
  CreateClipExportRequestSchema,
  CreateTranscriptionBatchRequestSchema,
  ExportSettingsSchema,
  HealthResponseSchema,
  JobSchema,
  ProjectSchema,
  TranscriptionBatchControlRequestSchema,
  UpdateReviewStatusRequestSchema,
} from "./index.ts";

const now = "2026-08-01T12:00:00.000Z";
const id = "019fbb95-cd76-7920-93fa-e23ba755ee3f";

describe("shared contracts", () => {
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
});
