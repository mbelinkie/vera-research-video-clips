import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthResponseSchema } from "@research-video/contracts";
import type { WorkspaceTranscriptResolution } from "@research-video/sync";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import transcriptFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };

import { createLocalAgent } from "./app.ts";
import { ClipSourceDisabledError } from "./clip-cut-runtime.ts";

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

  it("refuses anonymous, malformed, forged and unconfirmed cut requests before calling the cutter", async () => {
    const cutLoggedClips = vi.fn(async () => []);
    const app = createLocalAgent({ cutLoggedClips });
    apps.add(app);
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755e391";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755e392";
    const url = `/api/projects/${projectId}/clips/cut`;
    const headers = { authorization: "Bearer fixture-session" };
    const payload = { clipIds: [clipId], authorizationConfirmed: true };

    expect(
      (await app.inject({ method: "POST", url, payload })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          payload,
          headers: { authorization: "not-bearer" },
        })
      ).statusCode,
    ).toBe(401);
    for (const bad of [
      { ...payload, authorizationConfirmed: false },
      { ...payload, clipIds: [clipId, clipId] },
      { ...payload, clipIds: ["../../etc/passwd"] },
      { ...payload, outputPath: "/tmp/attacker" },
      { ...payload, sourceUrl: "https://example.invalid/video" },
      { ...payload, authorization: "Bearer forged" },
      { ...payload, clipIds: Array.from({ length: 21 }, () => clipId) },
    ]) {
      expect(
        (await app.inject({ method: "POST", url, payload: bad, headers }))
          .statusCode,
      ).toBe(400);
    }
    expect(cutLoggedClips).not.toHaveBeenCalled();
  });

  it("forwards bounded authorized clip IDs and rights, never supplied media paths", async () => {
    const cutLoggedClips = vi.fn(async () => [
      {
        clipId: "019fbb95-cd76-7920-93fa-e23ba755e392",
        videoId: "M7lc1UVf-VE",
        folder: "/private/exports/clip",
        mediaPath: "/private/exports/clip/clip.mp4",
        subtitlePaths: ["/private/exports/clip/clip.en.srt"],
        manifestPath: "/private/exports/clip/clip.json",
      },
    ]);
    const app = createLocalAgent({ cutLoggedClips });
    apps.add(app);
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755e391";
    const clipIds = [
      "019fbb95-cd76-7920-93fa-e23ba755e392",
      "019fbb95-cd76-7920-93fa-e23ba755e393",
    ];
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/cut`,
      headers: { authorization: "Bearer fixture-session" },
      payload: { clipIds, authorizationConfirmed: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().clips).toHaveLength(1);
    expect(cutLoggedClips).toHaveBeenCalledExactlyOnceWith({
      projectId,
      clipIds,
      authorization: "Bearer fixture-session",
      authorizationConfirmed: true,
    });
  });

  it("returns the explicit disabled-provider error without acquiring anything", async () => {
    const app = createLocalAgent({
      cutLoggedClips: async () => {
        throw new ClipSourceDisabledError();
      },
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/projects/019fbb95-cd76-7920-93fa-e23ba755e391/clips/cut",
      headers: { authorization: "Bearer fixture-session" },
      payload: {
        clipIds: ["019fbb95-cd76-7920-93fa-e23ba755e392"],
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "clip_source_disabled",
    });
  });

  it("leaves queued POST /api/exports unchanged when clip cutting is injected", async () => {
    const cutLoggedClips = vi.fn(async () => []);
    const createExportOnly = vi.fn(
      (input: ReturnType<typeof exportOnlyFixture>) => ({
        id: "019fbb95-cd76-7920-93fa-e23ba755ee381",
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ee382",
        mode: "export_only" as const,
        video: input.video,
        selection: input.selection,
        sourceLanguageClass: input.sourceLanguageClass,
        preset: input.preset,
        state: "queued" as const,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    const app = createLocalAgent({ cutLoggedClips, createExportOnly });
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
    });
    expect(createExportOnly).toHaveBeenCalledTimes(1);
    expect(cutLoggedClips).not.toHaveBeenCalled();
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
