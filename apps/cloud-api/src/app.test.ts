import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import { HealthResponseSchema } from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import type { VideoMetadataProvider } from "@research-video/providers";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const apps = new Set<ReturnType<typeof createCloudApi>>();
const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

describe("cloud API", () => {
  it("reports a contract-valid health response", async () => {
    const app = createCloudApi();
    apps.add(app);
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).service).toBe(
      "cloud-api",
    );
  });

  it("authenticates a user and exposes only their project catalog", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:api-user`;

    expect(
      (await app.inject({ method: "GET", url: "/api/projects" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/register",
          headers: { authorization },
          payload: { displayName: "API User" },
        })
      ).statusCode,
    ).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Shared research" },
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([{ name: "Shared research" }]);
  });

  it("atomically logs an idempotent tagged clip without creating an export job", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:clip-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Clip Owner" },
    });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Clip research" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;
    const payload = {
      idempotencyKey: "queue:fixture-selection-1",
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "IFrame API demo",
      },
      selection: {
        trackId: randomUUID(),
        transcriptVersion: 1,
        firstSegmentId: randomUUID(),
        lastSegmentId: randomUUID(),
        firstTokenId: randomUUID(),
        lastTokenId: randomUUID(),
        transcriptStartMs: 300,
        transcriptEndMs: 2_900,
        exportStartMs: 0,
        exportEndMs: 3_400,
        text: "A useful selected passage",
        timingPrecision: "word",
      },
      englishText: "A useful selected passage",
      notes: "Use this to establish the central argument.",
      tags: ["Person: Ada", "person: ada", "Opening"],
    };

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      projectId,
      notes: "Use this to establish the central argument.",
      tags: ["Opening", "Person: Ada"],
      researchStatus: "candidate",
      exportStatus: "not_requested",
    });

    const retried = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        ...payload,
        video: { ...payload.video, title: "A changed shared video title" },
        notes: "A retry must not overwrite the clip.",
      },
    });
    expect(retried.json<{ id: string }>().id).toBe(
      created.json<{ id: string }>().id,
    );
    expect(retried.json()).toMatchObject({
      video: { title: payload.video.title },
      notes: payload.notes,
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
    });
    expect(listed.json()).toHaveLength(1);
    const jobs = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE project_id = $1",
      [projectId],
    );
    const events = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_events WHERE project_id = $1 AND event_type = 'clip_candidate.created'",
      [projectId],
    );
    expect(jobs.rows[0]?.count).toBe("0");
    expect(events.rows[0]?.count).toBe("1");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}`,
      headers: { authorization },
      payload: {
        expectedVersion: 1,
        notes: "Use this as the revised opening.",
        tags: ["Opening", "Theme: Institutions"],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      notes: "Use this as the revised opening.",
      tags: ["Opening", "Theme: Institutions"],
      version: 2,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clip-tags`,
          headers: { authorization },
        })
      ).json(),
    ).toEqual(["Opening", "Person: Ada", "Theme: Institutions"]);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}`,
          headers: { authorization },
          payload: {
            expectedVersion: 1,
            notes: "Stale edit",
            tags: [],
          },
        })
      ).statusCode,
    ).toBe(409);
    const csv = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips.csv`,
      headers: { authorization },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(
      `project-clips-${projectId}.csv`,
    );
    expect(csv.body).toContain(
      '"project_id","project_name","clip_id","research_status"',
    );
    expect(csv.body).toContain(`"${projectId}","Clip research"`);
    expect(csv.body).toContain('"Opening | Theme: Institutions"');

    const exportPayload = {
      idempotencyKey: "fixture-logged-export",
      sourceLanguageClass: "confirmed_english",
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          maxWidth: 1_920,
          frameRate: "source",
          audioCodec: "aac",
          audioKilobitsPerSecond: 192,
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
    };
    const exported = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}/exports`,
      headers: { authorization },
      payload: exportPayload,
    });
    expect(exported.statusCode).toBe(201);
    expect(exported.json()).toMatchObject({
      mode: "logged",
      projectId,
      clipId: created.json<{ id: string }>().id,
      state: "queued",
      preset: { name: "Editing MP4", presetVersion: 1 },
    });
    const exportRetry = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}/exports`,
      headers: { authorization },
      payload: {
        ...exportPayload,
        preset: { ...exportPayload.preset, name: "Changed retry" },
      },
    });
    expect(exportRetry.json<{ id: string }>().id).toBe(
      exported.json<{ id: string }>().id,
    );
    expect(exportRetry.json()).toMatchObject({
      preset: { name: "Editing MP4" },
    });
    const queuedJobs = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE project_id = $1 AND kind = 'export' AND state = 'queued'",
      [projectId],
    );
    expect(queuedJobs.rows[0]?.count).toBe("1");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clips`,
          headers: { authorization },
        })
      ).json(),
    ).toMatchObject([{ exportStatus: "queued", version: 3 }]);

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:clip-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/clips`,
          headers: { authorization: outsiderAuthorization },
          payload: { ...payload, idempotencyKey: "queue:outsider" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clips.csv`,
          headers: { authorization: outsiderAuthorization },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("normalizes a YouTube URL, resolves metadata, and persists the project video", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const metadataProvider: VideoMetadataProvider = {
      resolve: async (videoId) => ({
        videoId,
        title: "IFrame API demo",
        channel: "Google Developers",
        durationMs: 60_000,
      }),
    };
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: metadataProvider,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:video-resolver`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Resolver User" },
    });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Resolved videos" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;

    const resolved = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/resolve`,
      headers: { authorization },
      payload: { url: "https://youtu.be/M7lc1UVf-VE?t=12" },
    });
    expect(resolved.statusCode).toBe(201);
    expect(resolved.json()).toMatchObject({
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "IFrame API demo",
      channel: "Google Developers",
      durationMs: 60_000,
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/videos`,
      headers: { authorization },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([
      { youtubeVideoId: "M7lc1UVf-VE", title: "IFrame API demo" },
    ]);
  });

  it("preflights and persists a deduplicated required-project batch while reusing a shared transcript", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const metadataProvider: VideoMetadataProvider = {
      resolve: async (videoId) => {
        if (videoId === "FailedVid01") throw new Error("fixture failure");
        return {
          videoId,
          title: `Fixture ${videoId}`,
          channel: "Fixture channel",
          durationMs: 90_000,
        };
      },
    };
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: metadataProvider,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:batch-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Batch Owner" },
    });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Batch project" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;
    const existingVideo = await catalog.addVideo(
      { userId, externalSubject: "fixture:batch-owner" },
      projectId,
      {
        youtubeVideoId: "Existing001",
        canonicalUrl: "https://www.youtube.com/watch?v=Existing001",
        title: "Existing fixture",
      },
    );
    const transcriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_sha256, finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'cue', $5, $6, now())`,
      [
        transcriptVersionId,
        projectId,
        existingVideo.id,
        randomUUID(),
        "fixture/manifest.json",
        "a".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [transcriptVersionId, projectId, existingVideo.id],
    );
    const inputs = [
      "https://youtu.be/Existing001",
      "ReadyVideo1",
      "RaceVideo01",
      "https://www.youtube.com/watch?v=ReadyVideo1&t=5",
      "https://example.com/not-youtube",
      "FailedVid01",
    ];

    const preflight = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/preflight`,
      headers: { authorization },
      payload: { inputs },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json()).toMatchObject({
      summary: {
        total: 6,
        ready: 2,
        existingTranscripts: 1,
        duplicates: 1,
        unsupported: 1,
        metadataFailed: 1,
      },
      items: [
        {
          status: "existing-transcript",
          activeTranscriptVersionId: transcriptVersionId,
        },
        { status: "ready", processingNeed: "transcription" },
        { status: "ready", processingNeed: "transcription" },
        { status: "duplicate", duplicateOfInputIndex: 1 },
        { status: "unsupported" },
        { status: "metadata-failed" },
      ],
    });

    const racedVideo = await catalog.addVideo(
      { userId, externalSubject: "fixture:batch-owner" },
      projectId,
      {
        youtubeVideoId: "RaceVideo01",
        canonicalUrl: "https://www.youtube.com/watch?v=RaceVideo01",
        title: "Raced shared transcript",
      },
    );
    const racedTranscriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_sha256, finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'cue', $5, $6, now())`,
      [
        racedTranscriptVersionId,
        projectId,
        racedVideo.id,
        randomUUID(),
        "fixture/raced-manifest.json",
        "b".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [racedTranscriptVersionId, projectId, racedVideo.id],
    );

    const createPayload = {
      name: "Mixed fixture batch",
      inputs,
      transcriptionProfile: "balanced",
    };
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      batch: {
        projectId,
        name: "Mixed fixture batch",
        transcriptionProfile: "balanced",
      },
      items: [
        { state: "ready_for_review", reviewStatus: "unreviewed" },
        { state: "queued", reviewStatus: "unreviewed" },
        {
          status: "existing-transcript",
          state: "ready_for_review",
          activeTranscriptVersionId: racedTranscriptVersionId,
        },
        { state: "canceled" },
        { state: "blocked" },
        { state: "blocked" },
      ],
    });
    const batchId = created.json<{ batch: { id: string } }>().batch.id;
    const loaded = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches/${batchId}`,
      headers: { authorization },
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(created.json());

    const listedBatches = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
    });
    expect(listedBatches.json()).toMatchObject({
      batches: [
        {
          batch: { id: batchId, name: "Mixed fixture batch" },
          progress: {
            total: 6,
            queued: 1,
            active: 0,
            readyForReview: 2,
            blocked: 2,
            canceled: 1,
          },
        },
      ],
    });
    const reviewInbox = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/review-inbox`,
      headers: { authorization },
    });
    const reviewBody = reviewInbox.json<{
      items: { id: string; version: number; reviewStatus: string }[];
    }>();
    expect(reviewInbox.statusCode).toBe(200);
    expect(reviewBody.items).toHaveLength(2);
    expect(reviewBody.items[0]).toMatchObject({
      version: 1,
      reviewStatus: "unreviewed",
    });
    const reviewItem = reviewBody.items[0]!;
    const reviewing = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/review-inbox/${reviewItem.id}`,
      headers: { authorization },
      payload: { reviewStatus: "reviewing", expectedVersion: 1 },
    });
    expect(reviewing.json()).toMatchObject({
      id: reviewItem.id,
      version: 2,
      reviewStatus: "reviewing",
      batchName: "Mixed fixture batch",
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/review-inbox/${reviewItem.id}`,
          headers: { authorization },
          payload: { reviewStatus: "reviewed", expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(409);

    const repeated = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: createPayload,
    });
    expect(repeated.statusCode).toBe(201);
    const jobs = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE kind = 'transcription'",
    );
    expect(jobs.rows[0]?.count).toBe("1");

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:batch-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/preflight`,
          headers: { authorization: outsiderAuthorization },
          payload: { inputs: ["ReadyVideo1"] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/review-inbox`,
          headers: { authorization: outsiderAuthorization },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("claims with an expiring lease, rejects stale workers, and persists the selected source plan", async () => {
    let currentTime = new Date("2026-08-01T12:00:00.000Z");
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date(currentTime),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: {
        resolve: async (videoId) => ({
          videoId,
          title: "Lease fixture",
          sourceLanguage: "es",
        }),
      },
    });
    apps.add(app);
    const ownerId = randomUUID();
    const authorization = `Bearer ${ownerId}|fixture:lease-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Lease Owner" },
    });
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Lease project" },
    });
    const projectId = project.json<{ id: string }>().id;
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: { name: "Lease batch", inputs: ["ReadyVideo1"] },
    });
    const createdBody = created.json<{
      batch: { id: string };
      items: { jobId: string }[];
    }>();
    const jobId = createdBody.items[0]!.jobId;

    const firstClaim = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      headers: { authorization },
      payload: { executionLocation: "local", leaseSeconds: 15 },
    });
    expect(firstClaim.statusCode).toBe(200);
    expect(firstClaim.json()).toMatchObject({
      job: { id: jobId, state: "claimed", attempt: 1 },
      lease: { workerId: ownerId, attempt: 1 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcription-jobs/claim",
          headers: { authorization },
          payload: { executionLocation: "local", leaseSeconds: 15 },
        })
      ).statusCode,
    ).toBe(204);

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/heartbeat`,
      headers: { authorization },
      payload: { attempt: 1, leaseSeconds: 15, stage: "resolving" },
    });
    expect(heartbeat.statusCode).toBe(200);
    const pausedAfterStart = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}/control`,
      headers: { authorization },
      payload: { action: "pause_pending", expectedVersion: 1 },
    });
    expect(pausedAfterStart.json()).toMatchObject({
      batch: { dispatchStatus: "paused", version: 2 },
      progress: { active: 1 },
    });
    currentTime = new Date(currentTime.getTime() + 16_000);
    const recovered = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      headers: { authorization },
      payload: { executionLocation: "local", leaseSeconds: 30 },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      job: { id: jobId, attempt: 2 },
      lease: { attempt: 2 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/heartbeat`,
          headers: { authorization },
          payload: { attempt: 1, leaseSeconds: 30, stage: "acquiring" },
        })
      ).statusCode,
    ).toBe(409);

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:lease-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Lease Outsider" },
    });
    const plan = {
      strategy: "caption",
      track: {
        id: "spanish-manual",
        language: "es",
        kind: "manual",
        translatable: true,
        downloadAccess: "available",
      },
      sourceLanguage: "es",
      targetLanguage: "en",
      requiresTranslation: true,
      reason: "manual-original-language",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/source-plan`,
          headers: { authorization: outsiderAuthorization },
          payload: { attempt: 2, plan },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/source-plan`,
          headers: { authorization },
          payload: { attempt: 2, plan },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/heartbeat`,
          headers: { authorization },
          payload: { attempt: 2, leaseSeconds: 30, stage: "acquiring" },
        })
      ).statusCode,
    ).toBe(200);

    const batch = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}`,
      headers: { authorization },
    });
    expect(batch.json()).toMatchObject({
      items: [
        {
          attempt: 2,
          state: "acquiring",
          sourcePlan: plan,
          sourceResolvedAt: currentTime.toISOString(),
        },
      ],
    });

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/fail`,
          headers: { authorization },
          payload: {
            attempt: 2,
            code: "caption_provider_unavailable",
            message: "The configured caption provider is unavailable.",
            retryable: true,
          },
        })
      ).statusCode,
    ).toBe(204);
    const failedBatch = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}`,
      headers: { authorization },
    });
    expect(failedBatch.json()).toMatchObject({
      items: [
        {
          state: "failed",
          error: {
            code: "caption_provider_unavailable",
            message: "The configured caption provider is unavailable.",
          },
        },
      ],
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/heartbeat`,
          headers: { authorization },
          payload: { attempt: 2, leaseSeconds: 30, stage: "acquiring" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("authorizes durable pause, resume, retry, and cancel-unstarted controls", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: {
        resolve: async (videoId) => ({
          videoId,
          title: `Control fixture ${videoId}`,
        }),
      },
    });
    apps.add(app);
    const ownerId = randomUUID();
    const authorization = `Bearer ${ownerId}|fixture:control-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Control Owner" },
    });
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Controlled batch project" },
    });
    const projectId = project.json<{ id: string }>().id;
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: {
        name: "Controlled batch",
        inputs: ["ControlVid1", "ControlVid2", "ControlVid3"],
      },
    });
    const createdBody = created.json<{
      batch: { id: string; version: number };
    }>();
    const controlUrl = `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}/control`;
    expect(created.json()).toMatchObject({
      batch: { dispatchStatus: "active", version: 1 },
      progress: { total: 3, queued: 3, active: 0 },
    });

    const paused = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "pause_pending", expectedVersion: 1 },
    });
    expect(paused.json()).toMatchObject({
      batch: { dispatchStatus: "paused", version: 2 },
      progress: { queued: 3 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcription-jobs/claim",
          headers: { authorization },
          payload: { executionLocation: "local", leaseSeconds: 30 },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: controlUrl,
          headers: { authorization },
          payload: { action: "resume", expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(409);

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:control-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Control Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: controlUrl,
          headers: { authorization: outsiderAuthorization },
          payload: { action: "resume", expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(403);

    const resumed = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "resume", expectedVersion: 2 },
    });
    expect(resumed.json()).toMatchObject({
      batch: { dispatchStatus: "active", version: 3 },
    });

    for (const retryable of [true, false]) {
      const claim = await app.inject({
        method: "POST",
        url: "/api/transcription-jobs/claim",
        headers: { authorization },
        payload: { executionLocation: "local", leaseSeconds: 30 },
      });
      const claimed = claim.json<{
        job: { id: string };
        lease: { attempt: number };
      }>();
      expect(claim.statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/transcription-jobs/${claimed.job.id}/fail`,
            headers: { authorization },
            payload: {
              attempt: claimed.lease.attempt,
              code: retryable ? "temporary_failure" : "unsupported_source",
              message: retryable
                ? "The provider is temporarily unavailable."
                : "This source cannot be processed.",
              retryable,
            },
          })
        ).statusCode,
      ).toBe(204);
    }

    const retried = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "retry_failed", expectedVersion: 3 },
    });
    const retriedBody = retried.json<{
      items: { state: string; error?: { retryable?: boolean } }[];
    }>();
    expect(retriedBody).toMatchObject({
      batch: { dispatchStatus: "active", version: 4 },
      progress: { queued: 2, failed: 1 },
    });
    expect(
      retriedBody.items.filter((item) => item.state === "queued"),
    ).toHaveLength(2);
    expect(
      retriedBody.items.find((item) => item.state === "failed")?.error,
    ).toMatchObject({ retryable: false });

    const retryClaim = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      headers: { authorization },
      payload: { executionLocation: "local", leaseSeconds: 30 },
    });
    expect(retryClaim.statusCode).toBe(200);
    const canceled = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "cancel_unstarted", expectedVersion: 4 },
    });
    expect(canceled.json()).toMatchObject({
      batch: { dispatchStatus: "canceled", version: 5 },
      progress: { active: 1, failed: 1, canceled: 1, queued: 0 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcription-jobs/claim",
          headers: { authorization },
          payload: { executionLocation: "local", leaseSeconds: 30 },
        })
      ).statusCode,
    ).toBe(204);
  });
});
