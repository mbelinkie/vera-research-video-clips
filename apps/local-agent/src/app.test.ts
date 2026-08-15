import { afterEach, describe, expect, it } from "vitest";

import { HealthResponseSchema } from "@research-video/contracts";
import type { WorkspaceTranscriptResolution } from "@research-video/sync";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import transcriptFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };

import { createLocalAgent } from "./app.ts";

const apps = new Set<ReturnType<typeof createLocalAgent>>();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

describe("local agent", () => {
  it("reports a contract-valid health response", async () => {
    const app = createLocalAgent();
    apps.add(app);
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).service).toBe(
      "local-agent",
    );
  });

  it("requires authentication and returns a resolved normalized transcript", async () => {
    const transcript = normalizeTranscriptFixture(transcriptFixture);
    const transcriptVersionId = "019fbb95-cd76-7920-93fa-e23ba755e399";
    const app = createLocalAgent({
      resolveTranscript: async () =>
        ({
          source: "verified-local-cache",
          cachePath: "/private/cache/fixture",
          transcript,
          bundle: { transcriptVersionId },
        }) as WorkspaceTranscriptResolution,
    });
    apps.add(app);
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755e391";
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755e392";
    const url = `/api/projects/${projectId}/videos/${videoId}/transcript`;

    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const response = await app.inject({
      method: "GET",
      url,
      headers: { authorization: "Bearer fixture-session" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "verified-local-cache",
      transcriptVersionId,
      transcript: { track: { timingPrecision: "word" } },
    });
    expect(response.json()).not.toHaveProperty("cachePath");
  });

  it("accepts a projectless export-only request through the loopback boundary", async () => {
    const now = "2026-08-01T12:00:00.000Z";
    const app = createLocalAgent({
      createExportOnly: (input) => ({
        id: "019fbb95-cd76-7920-93fa-e23ba755ee381",
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ee382",
        mode: "export_only",
        video: input.video,
        selection: input.selection,
        sourceLanguageClass: input.sourceLanguageClass,
        preset: input.preset,
        state: "queued",
        createdAt: now,
        updatedAt: now,
      }),
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/exports",
      payload: exportOnlyFixture(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      mode: "export_only",
      state: "queued",
      preset: { name: "Editing MP4" },
    });
    expect(response.json()).not.toHaveProperty("projectId");
    expect(response.json()).not.toHaveProperty("clipId");
  });
});

function exportOnlyFixture() {
  return {
    idempotencyKey: "fixture-export-only",
    video: {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Fixture video",
    },
    selection: {
      trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
      transcriptVersion: 1,
      firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e311",
      lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e312",
      firstTokenId: "019fbb95-cd76-7920-93fa-e23ba755e322",
      lastTokenId: "019fbb95-cd76-7920-93fa-e23ba755e326",
      transcriptStartMs: 300,
      transcriptEndMs: 2_900,
      exportStartMs: 0,
      exportEndMs: 3_400,
      text: "fixture has accurate word timing. Click any word",
      timingPrecision: "word" as const,
    },
    sourceLanguageClass: "confirmed_english" as const,
    preset: {
      presetVersion: 1,
      name: "Editing MP4",
      settings: {
        container: "mp4" as const,
        videoCodec: "h264" as const,
        videoRateControl: { mode: "crf" as const, value: 20 },
        maxWidth: 1_920,
        frameRate: "source" as const,
        audioCodec: "aac" as const,
        audioKilobitsPerSecond: 192,
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    },
  };
}
