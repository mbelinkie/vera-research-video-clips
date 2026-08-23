import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HealthResponseSchema,
  type LoggedExportDelivery,
  type LoggedExportCanceledResult,
  type LoggedExportFailureResult,
  type LoggedExportSuccessResult,
} from "@research-video/contracts";
import {
  currentExportWorkerAdvertisement,
  resolveExportSettings,
} from "@research-video/export-settings";
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

  it("requires authorization for Clip Library refresh and selection", async () => {
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee65";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee66";
    const now = "2026-08-22T12:00:00.000Z";
    const localPage = {
      projectId,
      entries: [],
      syncCursor: "3",
      fetchedAt: now,
      query: { limit: 10, completed: "yes" as const },
      freshness: "fresh" as const,
      cachedAt: now,
      cacheCoverage: "cached_subset" as const,
      selectedClipIds: [],
      localAvailability: [],
    };
    const resolveClipLibrary = vi.fn(async () => localPage);
    const resolveLatestClipLibrary = vi.fn(async () => localPage);
    const updateClipLibrarySelection = vi.fn(() => [clipId]);
    const app = createLocalAgent({
      resolveClipLibrary,
      resolveLatestClipLibrary,
      updateClipLibrarySelection,
    });
    apps.add(app);
    const pageUrl = `/api/projects/${projectId}/clip-library?limit=10&completed=yes`;
    expect((await app.inject({ method: "GET", url: pageUrl })).statusCode).toBe(
      401,
    );
    const response = await app.inject({
      method: "GET",
      url: pageUrl,
      headers: { authorization: "Bearer project-session" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(localPage);
    expect(resolveClipLibrary).toHaveBeenCalledWith({
      projectId,
      authorization: "Bearer project-session",
      query: { limit: 10, completed: "yes" },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clip-library/latest`,
          headers: { authorization: "Bearer project-session" },
        })
      ).json(),
    ).toEqual(localPage);
    expect(resolveLatestClipLibrary).toHaveBeenCalledWith({
      projectId,
      authorization: "Bearer project-session",
    });
    const selectionUrl = `/api/projects/${projectId}/clip-library/selection`;
    expect(
      (
        await app.inject({
          method: "PUT",
          url: selectionUrl,
          payload: { pageClipIds: [clipId], selectedClipIds: [clipId] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: selectionUrl,
          headers: { authorization: "Bearer project-session" },
          payload: { pageClipIds: [clipId], selectedClipIds: [clipId] },
        })
      ).json(),
    ).toEqual({ selectedClipIds: [clipId] });
    expect(updateClipLibrarySelection).toHaveBeenCalledWith({
      projectId,
      authorization: "Bearer project-session",
      command: { pageClipIds: [clipId], selectedClipIds: [clipId] },
    });
  });

  it("keeps Clip Library preflight and submission behind current authorization", async () => {
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee65";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee66";
    const settingsSelection = {
      base: "application_default" as const,
      overrides: {},
    };
    const request = { clipIds: [clipId], settingsSelection };
    const preflight = {
      schemaVersion: 1 as const,
      projectId,
      preflightFingerprint: "a".repeat(64),
      checkedAt: "2026-08-22T12:00:00.000Z",
      availableBytes: 5_000_000_000,
      uniqueSourceCount: 1,
      sourceSharingAssurance: "same_worker_profile_only" as const,
      knownSourceBytes: 0,
      unknownSourceCount: 1,
      outputEstimatedBytes: 100_000_000,
      promotionReserveBytes: 100_000_000,
      activeCheckpointReserveBytes: 0,
      safetyReserveBytes: 2_147_483_648 as const,
      knownRequiredBytes: 2_347_483_648,
      decision: "confirmation_required" as const,
      items: [],
    } as never;
    const prepareClipLibraryExport = vi.fn(async () => preflight);
    const submitClipLibraryExport = vi.fn(async () => ({
      kind: "individual" as const,
      request: { id: clipId },
    })) as never;
    const prepareAuthoringExport = vi.fn(async () => preflight);
    const submitAuthoringExport = vi.fn(async () => ({
      kind: "individual" as const,
      request: { id: clipId },
    })) as never;
    const app = createLocalAgent({
      prepareClipLibraryExport,
      submitClipLibraryExport,
      prepareAuthoringExport,
      submitAuthoringExport,
    });
    apps.add(app);
    const preflightUrl = `/api/projects/${projectId}/clip-library/export-preflight`;
    const submitUrl = `/api/projects/${projectId}/clip-library/exports`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: preflightUrl,
          payload: request,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: submitUrl,
          payload: {
            ...request,
            expectedPreflightFingerprint: "a".repeat(64),
            confirmUnknownSourceSizes: true,
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: preflightUrl,
          headers: { authorization: "Bearer project-session" },
          payload: request,
        })
      ).statusCode,
    ).toBe(200);
    expect(prepareClipLibraryExport).toHaveBeenCalledWith({
      projectId,
      authorization: "Bearer project-session",
      request,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: submitUrl,
          headers: { authorization: "Bearer project-session" },
          payload: {
            ...request,
            expectedPreflightFingerprint: "a".repeat(64),
            confirmUnknownSourceSizes: true,
          },
        })
      ).statusCode,
    ).toBe(201);
    const authoringPreflightUrl = `/api/authoring/projects/${projectId}/export-preflight`;
    const authoringSubmitUrl = `/api/authoring/projects/${projectId}/exports`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: authoringPreflightUrl,
          payload: request,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: authoringPreflightUrl,
          headers: { authorization: "Bearer project-session" },
          payload: request,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: authoringSubmitUrl,
          headers: { authorization: "Bearer project-session" },
          payload: {
            ...request,
            expectedPreflightFingerprint: "a".repeat(64),
            confirmUnknownSourceSizes: true,
          },
        })
      ).statusCode,
    ).toBe(201);
    expect(prepareAuthoringExport).toHaveBeenCalledWith({
      projectId,
      authorization: "Bearer project-session",
      request,
    });
  });

  it("keeps root paths local and resolves verification evidence through authorization", async () => {
    const rootId = "019fbb95-cd76-7920-93fa-e23ba755ee71";
    const artifactVersionId = "019fbb95-cd76-7920-93fa-e23ba755ee72";
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee73";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee74";
    const now = "2026-08-22T12:00:00.000Z";
    const artifactVersion = { artifactVersionId } as never;
    const locator = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee75",
      artifactVersionId,
      rootId,
      platform: "posix" as const,
      availability: "verified" as const,
      manifestSha256: "a".repeat(64),
      manifestSchemaVersion: 2 as const,
      checkedAt: now,
      lastVerifiedAt: now,
    };
    const resolveArtifactVersion = vi.fn(async () => artifactVersion);
    const verifyArtifactVersion = vi.fn(async () => locator);
    const app = createLocalAgent({
      resolveArtifactVersion,
      verifyArtifactVersion,
    });
    apps.add(app);
    expect(
      (await app.inject({ method: "GET", url: "/api/artifact-roots" }))
        .statusCode,
    ).toBe(404);
    const command = { projectId, clipId, artifactVersionId, rootId };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/artifact-locators/verify",
          payload: command,
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: "POST",
      url: "/api/artifact-locators/verify",
      headers: { authorization: "Bearer project-session" },
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(locator);
    expect(resolveArtifactVersion).toHaveBeenCalledWith({
      projectId,
      clipId,
      artifactVersionId,
      authorization: "Bearer project-session",
    });
    expect(verifyArtifactVersion).toHaveBeenCalledWith({
      rootId,
      artifactVersion,
    });
  });

  it("keeps resolution and local actions ID-only and path-free", async () => {
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee73";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee74";
    const locatorId = "019fbb95-cd76-7920-93fa-e23ba755ee75";
    const rootId = "019fbb95-cd76-7920-93fa-e23ba755ee71";
    const locator = {
      id: locatorId,
      artifactVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee72",
      rootId,
      platform: "posix" as const,
      availability: "verified" as const,
      manifestSha256: "a".repeat(64),
      manifestSchemaVersion: 2 as const,
      checkedAt: "2026-08-22T12:00:00.000Z",
      lastVerifiedAt: "2026-08-22T12:00:00.000Z",
    };
    const resolveArtifact = vi.fn(async () => ({
      state: "needs_export" as const,
      freshness: "fresh" as const,
    }));
    const actOnArtifactLocator = vi.fn(async () => ({
      locator,
      freshness: "fresh" as const,
    }));
    const relinkArtifactLocator = vi.fn(async () => locator);
    const app = createLocalAgent({
      resolveArtifact,
      actOnArtifactLocator,
      relinkArtifactLocator,
      listArtifactRoots: () => [
        {
          id: rootId,
          label: "Managed exports",
          platform: "posix",
          enabled: true,
          createdAt: locator.checkedAt,
          updatedAt: locator.checkedAt,
        },
      ],
    });
    apps.add(app);
    const headers = { authorization: "Bearer project-session" };
    const roots = await app.inject({
      method: "GET",
      url: "/api/artifact-roots",
      headers,
    });
    expect(roots.statusCode).toBe(200);
    expect(JSON.stringify(roots.json())).not.toMatch(/path|filename/iu);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifact-locators/${locatorId}/verify`,
          headers,
          payload: { path: "/private/package" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifact-locators/${locatorId}/relink`,
          headers,
          payload: { targetRootId: rootId, absolutePath: "/private/package" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifact-locators/${locatorId}/open`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(actOnArtifactLocator).toHaveBeenCalledWith({
      locatorId,
      authorization: "Bearer project-session",
      action: "open",
    });
    expect(relinkArtifactLocator).not.toHaveBeenCalled();
    expect(resolveArtifact).not.toHaveBeenCalled();
    expect(JSON.stringify(locator)).not.toMatch(/path|filename/iu);
  });

  it("returns local paths only through an authorized strict authoring descriptor command", async () => {
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee73";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee74";
    const artifactVersionId = "019fbb95-cd76-7920-93fa-e23ba755ee72";
    const locatorId = "019fbb95-cd76-7920-93fa-e23ba755ee75";
    const requestId = "019fbb95-cd76-7920-93fa-e23ba755ee76";
    const packageIdentity = `clip-${requestId}`;
    const requirements = {
      clipId,
      selection: {
        trackId: "019fbb95-cd76-7920-93fa-e23ba755ee77",
        transcriptVersion: 1,
        firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee78",
        lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee79",
        transcriptStartMs: 1_000,
        transcriptEndMs: 2_000,
        exportStartMs: 1_000,
        exportEndMs: 2_000,
        timingPrecision: "word" as const,
      },
      resolvedBounds: { startMs: 1_000, endMs: 2_000 },
      sourceLanguageClass: "confirmed_english" as const,
      subtitlePolicy: { requiredSidecars: ["english" as const] },
      requiredArtifactRoles: [
        "video_mp4" as const,
        "clip_metadata_json" as const,
        "thumbnail_jpg" as const,
        "manifest_json" as const,
      ],
      acceptedManifestSchemas: [2 as const],
      settings: {
        mode: "exact_fingerprint" as const,
        resolutionFingerprint: "a".repeat(64),
      },
    };
    const packagePath = `/private/exports/${packageIdentity}`;
    const manifestSha256 = "c".repeat(64);
    const createAuthoringArtifactDescriptor = vi.fn(async () => ({
      schemaVersion: 1 as const,
      projectId,
      clipId,
      artifactVersionId,
      requestId,
      locatorId,
      packageIdentity,
      resultFingerprint: "b".repeat(64),
      manifest: { schemaVersion: 2 as const, contentSha256: manifestSha256 },
      packagePath,
      artifacts: [
        "video_mp4",
        "clip_metadata_json",
        "thumbnail_jpg",
        "manifest_json",
      ].map((role) => ({
        role,
        absolutePath: `${packagePath}/${role}`,
        byteSize: 1,
        contentSha256:
          role === "manifest_json" ? manifestSha256 : "d".repeat(64),
      })) as never,
    }));
    const app = createLocalAgent({ createAuthoringArtifactDescriptor });
    apps.add(app);
    const url = `/api/authoring/projects/${projectId}/clips/${clipId}/artifact-descriptor`;
    const command = { artifactVersionId, locatorId, requirements };
    expect(
      (await app.inject({ method: "POST", url, payload: command })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: "Bearer project-session" },
          payload: { ...command, packagePath },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer project-session" },
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ packagePath, artifactVersionId });
    expect(createAuthoringArtifactDescriptor).toHaveBeenCalledWith({
      projectId,
      clipId,
      authorization: "Bearer project-session",
      request: command,
    });
    const validDescriptor = response.json<{
      artifacts: Array<{ absolutePath: string }>;
    }>();
    createAuthoringArtifactDescriptor.mockResolvedValueOnce({
      ...validDescriptor,
      artifacts: validDescriptor.artifacts.map((artifact, index) =>
        index === 0
          ? { ...artifact, absolutePath: `${packagePath}/../outside.mp4` }
          : artifact,
      ),
    } as never);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: "Bearer project-session" },
          payload: command,
        })
      ).statusCode,
    ).toBe(400);
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

  it("requires an authoritative ready preview and forwards its immutable snapshot", async () => {
    const snapshotPreview = resolveExportSettings({
      context: "export_only",
      sourceLanguageClass: "confirmed_english",
      resolvedAt: "2026-08-20T12:00:00.000Z",
    });
    const createExportOnly = vi.fn(() => ({ ok: true }));
    const app = createLocalAgent({
      previewExportSettings: async () => snapshotPreview,
      createExportOnly,
    });
    apps.add(app);
    const legacy = exportOnlyFixture();
    const { preset: _preset, ...base } = legacy;
    const payload = {
      ...base,
      settingsSelection: { base: "application_default", overrides: {} },
      expectedResolutionFingerprint:
        snapshotPreview.snapshot.resolutionFingerprint,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/exports",
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { authorization: "Bearer fixture" },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(createExportOnly).toHaveBeenCalledWith(
      expect.objectContaining({ settingsSelection: payload.settingsSelection }),
      snapshotPreview.snapshot,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/exports",
          headers: { authorization: "Bearer fixture" },
          payload: {
            ...payload,
            expectedResolutionFingerprint: "0".repeat(64),
          },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("registers only a discovered durable local advertisement and heartbeats without rediscovery", async () => {
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "libx265", "prores_ks", "mov_text", "srt"],
      muxers: ["mp4", "matroska", "mov"],
      filters: ["scale", "fps"],
    });
    const identity = {
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ee91",
      epoch: 4,
      advertisementFingerprint: advertisement.advertisementFingerprint,
      createdAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:00:00.000Z",
    };
    const prepareRegistration = vi.fn(() => identity);
    const discover = vi.fn(async () => ({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "libx265", "prores_ks", "mov_text", "srt"],
      muxers: ["mp4", "matroska", "mov"],
      filters: ["scale", "fps"],
    }));
    const registerExportWorker = vi.fn(async ({ request }) => ({
      id: request.workerId,
      epoch: request.epoch,
      capability: request.capability,
      installedCapabilities: request.installedCapabilities,
      advertisementFingerprint: request.advertisementFingerprint,
      heartbeatAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-20T12:01:00.000Z",
    }));
    const heartbeatExportWorker = vi.fn(async ({ request }) => ({
      id: request.workerId,
      epoch: request.epoch,
      capability: advertisement.capability,
      installedCapabilities: advertisement.installedCapabilities,
      advertisementFingerprint: advertisement.advertisementFingerprint,
      heartbeatAt: "2026-08-20T12:00:30.000Z",
      expiresAt: "2026-08-20T12:01:30.000Z",
    }));
    const app = createLocalAgent({
      capabilityProvider: { discover },
      workerIdentity: { get: () => identity, prepareRegistration },
      registerExportWorker,
      heartbeatExportWorker,
    });
    apps.add(app);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-workers/register",
        })
      ).statusCode,
    ).toBe(401);
    const registered = await app.inject({
      method: "POST",
      url: "/api/export-workers/register",
      headers: { authorization: "Bearer fixture" },
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).not.toHaveProperty("ownerUserId");
    expect(prepareRegistration).toHaveBeenCalledWith(
      advertisement.advertisementFingerprint,
    );
    expect(registerExportWorker).toHaveBeenCalledWith({
      authorization: "Bearer fixture",
      request: {
        workerId: identity.workerId,
        epoch: identity.epoch,
        ...advertisement,
      },
    });
    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/export-workers/heartbeat",
      headers: { authorization: "Bearer fixture" },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeatExportWorker).toHaveBeenCalledWith({
      authorization: "Bearer fixture",
      request: { workerId: identity.workerId, epoch: identity.epoch },
    });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("does not persist or advertise anything when local capability discovery fails", async () => {
    const prepareRegistration = vi.fn();
    const registerExportWorker = vi.fn();
    const app = createLocalAgent({
      capabilityProvider: {
        discover: async () => {
          throw new Error("FFmpeg discovery unavailable");
        },
      },
      workerIdentity: { get: () => undefined, prepareRegistration },
      registerExportWorker,
    });
    apps.add(app);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-workers/register",
          headers: { authorization: "Bearer fixture" },
        })
      ).statusCode,
    ).toBe(500);
    expect(prepareRegistration).not.toHaveBeenCalled();
    expect(registerExportWorker).not.toHaveBeenCalled();
  });

  it("imports pending, cloud-accepts, then activates one logged delivery", async () => {
    const delivery = loggedDeliveryFixture();
    const accepted = {
      ...delivery,
      status: "accepted" as const,
      acceptedAt: "2026-08-20T12:00:05.000Z",
    };
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const importPending = vi.fn(() => ({ ok: true }) as never);
    const activate = vi.fn(() => ({ ok: true }) as never);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getPendingLoggedDelivery: () => undefined,
      claimLoggedExportDelivery: vi.fn(async () => ({ delivery })),
      importLoggedDeliveryPending: importPending,
      acceptLoggedExportDelivery: vi.fn(async () => accepted),
      activateLoggedDelivery: activate,
      rejectPendingLoggedDelivery: vi.fn(),
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/claim",
      headers: { authorization: "Bearer fixture" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      delivery: { status: "accepted", request: { mode: "logged" } },
    });
    expect(importPending).toHaveBeenCalledWith(delivery);
    expect(activate).toHaveBeenCalledWith(accepted);
  });

  it("recovers a lost acceptance response from local pending provenance before claiming new work", async () => {
    const pending = loggedDeliveryFixture();
    const accepted = {
      ...pending,
      status: "accepted" as const,
      acceptedAt: "2026-08-20T12:00:05.000Z",
    };
    const claim = vi.fn(async () => ({}));
    const activate = vi.fn(() => ({ ok: true }) as never);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => ({
          workerId: pending.workerId,
          epoch: pending.workerEpoch,
          advertisementFingerprint: "a".repeat(64),
          createdAt: pending.reservedAt,
          updatedAt: pending.reservedAt,
        }),
        prepareRegistration: () => {
          throw new Error("not used");
        },
      },
      getPendingLoggedDelivery: () => pending,
      claimLoggedExportDelivery: claim,
      importLoggedDeliveryPending: vi.fn(() => ({ ok: true }) as never),
      acceptLoggedExportDelivery: vi.fn(async () => accepted),
      activateLoggedDelivery: activate,
      rejectPendingLoggedDelivery: vi.fn(),
    });
    apps.add(app);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/claim",
          headers: { authorization: "Bearer fixture" },
        })
      ).json(),
    ).toMatchObject({ delivery: { status: "accepted" } });
    expect(claim).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith(accepted);
  });

  it("removes a stale pending generation before importing its authoritative redelivery", async () => {
    const stale = loggedDeliveryFixture();
    const replacement = {
      ...stale,
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee19",
      reservedAt: "2026-08-20T12:00:31.000Z",
      reservationExpiresAt: "2026-08-20T12:01:01.000Z",
    };
    const accepted = {
      ...replacement,
      status: "accepted" as const,
      acceptedAt: "2026-08-20T12:00:35.000Z",
    };
    const staleConflict = Object.assign(new Error("stale"), {
      statusCode: 409,
    });
    const rejectPending = vi.fn();
    const importPending = vi.fn(() => ({ ok: true }) as never);
    const accept = vi
      .fn()
      .mockRejectedValueOnce(staleConflict)
      .mockResolvedValueOnce(accepted);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => ({
          workerId: stale.workerId,
          epoch: stale.workerEpoch,
          advertisementFingerprint: "a".repeat(64),
          createdAt: stale.reservedAt,
          updatedAt: stale.reservedAt,
        }),
        prepareRegistration: () => {
          throw new Error("not used");
        },
      },
      getPendingLoggedDelivery: () => stale,
      claimLoggedExportDelivery: vi.fn(async () => ({
        delivery: replacement,
      })),
      importLoggedDeliveryPending: importPending,
      acceptLoggedExportDelivery: accept,
      activateLoggedDelivery: vi.fn(() => ({ ok: true }) as never),
      rejectPendingLoggedDelivery: rejectPending,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/claim",
      headers: { authorization: "Bearer fixture" },
    });
    expect(response.statusCode).toBe(200);
    expect(rejectPending).toHaveBeenCalledWith(stale);
    expect(importPending).toHaveBeenCalledWith(replacement);
    expect(response.json()).toMatchObject({
      delivery: { generation: 2, status: "accepted" },
    });
  });

  it("rejects missing authorization, confirmation, or local delivery ownership before processor work", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const run = vi.fn(async () => ({
      requestId: delivery.request.id,
      status: "complete" as const,
      state: "complete",
    }));
    const app = createLocalAgent({
      workerIdentity: {
        get: () => ({
          workerId: "019fbb95-cd76-7920-93fa-e23ba755ee99",
          epoch: delivery.workerEpoch,
          advertisementFingerprint: "a".repeat(64),
          createdAt: delivery.reservedAt,
          updatedAt: delivery.reservedAt,
        }),
        prepareRegistration: () => {
          throw new Error("not used");
        },
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
    });
    apps.add(app);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/process",
          payload: {
            requestId: delivery.request.id,
            authorizationConfirmed: true,
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/process",
          headers: { authorization: "Bearer fixture" },
          payload: {
            requestId: delivery.request.id,
            authorizationConfirmed: false,
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/process",
          headers: { authorization: "Bearer fixture" },
          payload: {
            requestId: delivery.request.id,
            authorizationConfirmed: true,
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });

  it("retries both cloud crash windows from the same locally completed result without rerendering", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const result = localSuccessResultFixture(delivery);
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        requestId: delivery.request.id,
        status: "complete",
        state: "complete",
      })
      .mockResolvedValue({
        requestId: delivery.request.id,
        status: "already_complete",
        state: "complete",
      });
    const unavailable = Object.assign(new Error("cloud unavailable"), {
      statusCode: 503,
      code: "export_result_unavailable",
    });
    const lostResponse = Object.assign(new Error("response lost"), {
      statusCode: 503,
      code: "export_result_response_lost",
    });
    const reconciled = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee81",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result,
      resultFingerprint: "f".repeat(64),
      reconciledAt: "2026-08-20T12:00:20.000Z",
    };
    const reconcile = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(lostResponse)
      .mockResolvedValueOnce(reconciled);
    const buildResult = vi.fn(() => result);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: buildResult,
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: reconcile,
    });
    apps.add(app);
    const command = {
      method: "POST" as const,
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    };
    expect((await app.inject(command)).statusCode).toBe(503);
    expect((await app.inject(command)).statusCode).toBe(503);
    const recovered = await app.inject(command);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      execution: "already_complete",
      reconciliation: { id: reconciled.id },
    });
    expect(run.mock.calls.map((call) => call[0])).toEqual([
      {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
      {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
      {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    ]);
    expect(buildResult).toHaveBeenCalledTimes(3);
    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(reconcile.mock.calls[0]![0]).toEqual(reconcile.mock.calls[1]![0]);
    expect(reconcile.mock.calls[1]![0]).toEqual(reconcile.mock.calls[2]![0]);
    expect(JSON.stringify(recovered.json())).not.toMatch(
      /reservationToken|Bearer fixture|\/private\/|sourceIdentity/i,
    );
  });

  it("reconciles persisted terminal-safe failure before execution, including from a later local epoch", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const result = localFailureResultFixture(delivery);
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch + 1,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const run = vi.fn();
    const failure = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee81",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result,
      resultFingerprint: "f".repeat(64),
      reconciledAt: "2026-08-20T12:00:20.000Z",
    };
    const unavailable = Object.assign(new Error("cloud unavailable"), {
      statusCode: 503,
      code: "export_failure_unavailable",
    });
    const reconcileFailure = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(failure);
    const buildFailure = vi.fn(() => result);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      buildLoggedExportFailureResult: buildFailure,
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
      reconcileLoggedExportFailure: reconcileFailure,
    });
    apps.add(app);
    const command = {
      method: "POST" as const,
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    };
    expect((await app.inject(command)).statusCode).toBe(503);
    const recovered = await app.inject(command);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      execution: "failed",
      failure: { id: failure.id, result },
    });
    expect(run).not.toHaveBeenCalled();
    expect(buildFailure).toHaveBeenCalledTimes(2);
    expect(reconcileFailure).toHaveBeenCalledTimes(2);
    expect(reconcileFailure.mock.calls[0]![0].request).toMatchObject({
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      result,
    });
    expect(JSON.stringify(recovered.json())).not.toMatch(
      /reservationToken|Bearer fixture|\/private\/|sourceIdentity/i,
    );
  });

  it("replays persisted canceled evidence without restarting or extending its lost lease", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch + 1,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const execution = {
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ee8a",
      requestId: delivery.request.id,
      attempt: 1,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ee8b",
      startedAt: "2026-08-20T12:00:10.000Z",
      heartbeatAt: "2026-08-20T12:00:11.000Z",
      expiresAt: "2026-08-20T12:00:41.000Z",
    };
    const result = {
      ...localCanceledResultFixture(delivery, 1, execution.executionId),
      reason: "execution_lease_lost" as const,
    };
    const canceled = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee8c",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result,
      resultFingerprint: "f".repeat(64),
      reconciledAt: "2026-08-20T12:01:00.000Z",
    };
    const unavailable = Object.assign(new Error("cloud unavailable"), {
      statusCode: 503,
    });
    const reconcile = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(canceled);
    const run = vi.fn();
    const start = vi.fn();
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
      buildLoggedExportCanceledResult: () => result,
      getLoggedExecution: () => execution,
      reconcileLoggedExportCanceled: reconcile,
      startLoggedExportExecution: start,
    });
    apps.add(app);
    const command = {
      method: "POST" as const,
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    };
    expect((await app.inject(command)).statusCode).toBe(503);
    const recovered = await app.inject(command);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ execution: "canceled" });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls[0]![0]).toEqual(reconcile.mock.calls[1]![0]);
    expect(run).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("builds a new failure only from persisted state and never executes old accepted work at a newer epoch", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const result = localFailureResultFixture(delivery);
    const exactIdentity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const noFailure = Object.assign(new Error("not recorded"), {
      statusCode: 409,
      code: "logged_export_failure_not_recorded",
    });
    const buildFailure = vi
      .fn()
      .mockImplementationOnce(() => {
        throw noFailure;
      })
      .mockReturnValue(result);
    const run = vi.fn(async () => ({
      requestId: delivery.request.id,
      status: "failed" as const,
      state: "needs_user_action",
      error: {
        code: "transient_untrusted",
        message: "/private/transient-output token=untrusted",
      },
    }));
    const failure = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee82",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result,
      resultFingerprint: "e".repeat(64),
      reconciledAt: "2026-08-20T12:00:20.000Z",
    };
    const reconcileFailure = vi.fn(async (_input: unknown) => failure);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => exactIdentity,
        prepareRegistration: () => exactIdentity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      buildLoggedExportFailureResult: buildFailure,
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
      reconcileLoggedExportFailure: reconcileFailure,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(buildFailure).toHaveBeenCalledTimes(2);
    const reconciledInput = reconcileFailure.mock.calls[0]![0] as {
      request: { result: LoggedExportFailureResult };
    };
    expect(reconciledInput.request.result).toEqual(result);
    expect(JSON.stringify(reconciledInput)).not.toMatch(
      /transient_untrusted|transient-output|untrusted/,
    );

    const laterIdentity = { ...exactIdentity, epoch: exactIdentity.epoch + 1 };
    const laterRun = vi.fn();
    const laterApp = createLocalAgent({
      workerIdentity: {
        get: () => laterIdentity,
        prepareRegistration: () => laterIdentity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      buildLoggedExportFailureResult: () => {
        throw noFailure;
      },
      runLoggedExportOnce: laterRun,
      reconcileLoggedExportSuccess: vi.fn(),
      reconcileLoggedExportFailure: vi.fn(),
    });
    apps.add(laterApp);
    const rejected = await laterApp.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(rejected.statusCode).toBe(409);
    expect(laterRun).not.toHaveBeenCalled();
  });

  it("keeps cleanup failure actionable without processor replay or cloud terminal mutation", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const run = vi.fn();
    const reconcileFailure = vi.fn();
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      buildLoggedExportFailureResult: () => {
        throw Object.assign(
          new Error(
            "Source cleanup is incomplete; resolve deletion before reconciling the processing failure.",
          ),
          {
            statusCode: 409,
            code: "logged_export_failure_cleanup_incomplete",
          },
        );
      },
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
      reconcileLoggedExportFailure: reconcileFailure,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "logged_export_failure_cleanup_incomplete" },
    });
    expect(run).not.toHaveBeenCalled();
    expect(reconcileFailure).not.toHaveBeenCalled();
  });

  it("settles accepted cancellation before local execution without invoking the processor", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const canceledResult = localCanceledResultFixture(delivery, 0);
    const canceled = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee83",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result: canceledResult,
      resultFingerprint: "c".repeat(64),
      reconciledAt: "2026-08-20T12:00:20.000Z",
    };
    const run = vi.fn();
    let cancellationRecorded = false;
    const record = vi.fn(() => {
      cancellationRecorded = true;
    });
    const reconcile = vi.fn(async () => canceled);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
      startLoggedExportExecution: vi.fn(async () => ({
        status: "cancel_requested" as const,
        cancelRequestedAt: "2026-08-20T12:00:15.000Z",
      })),
      heartbeatLoggedExportExecution: vi.fn(),
      activateLoggedExecution: vi.fn(),
      recordLoggedExecutionHeartbeat: vi.fn(),
      recordLoggedExportNotStartedCancellation: record,
      buildLoggedExportCanceledResult: () => {
        if (!cancellationRecorded) throw cancellationNotRecorded();
        return canceledResult;
      },
      reconcileLoggedExportCanceled: reconcile,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ execution: "canceled" });
    expect(record).toHaveBeenCalledWith(
      delivery.request.id,
      "user_requested",
      "2026-08-20T12:00:15.000Z",
    );
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toMatch(
      /leaseToken|reservationToken|Bearer fixture|\/private\//i,
    );
  });

  it("aborts the active executor when a heartbeat observes cancel intent", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const execution = {
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ee84",
      requestId: delivery.request.id,
      attempt: 1,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ee85",
      startedAt: "2026-08-20T12:00:10.000Z",
      heartbeatAt: "2026-08-20T12:00:11.000Z",
      expiresAt: "2026-08-20T12:00:41.000Z",
    };
    const heartbeatExecution = {
      ...execution,
      heartbeatAt: "2026-08-20T12:00:15.000Z",
      expiresAt: "2026-08-20T12:00:45.000Z",
      cancelRequestedAt: "2026-08-20T12:00:14.000Z",
    };
    const result = localCanceledResultFixture(
      delivery,
      1,
      execution.executionId,
    );
    let cancellationRecorded = false;
    const run = vi.fn(async (input: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) =>
        input.signal!.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      cancellationRecorded = true;
      return {
        requestId: delivery.request.id,
        status: "canceled" as const,
        state: "canceled",
      };
    });
    const reconcile = vi.fn(async () => ({
      id: "019fbb95-cd76-7920-93fa-e23ba755ee86",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result,
      resultFingerprint: "d".repeat(64),
      reconciledAt: "2026-08-20T12:00:16.000Z",
    }));
    const persist = vi.fn();
    const progress = {
      schemaVersion: 1 as const,
      executionId: execution.executionId,
      requestId: delivery.request.id,
      attempt: execution.attempt,
      sequence: 4,
      stage: "rendering" as const,
      basisPoints: 3_500,
      updatedAt: "2026-08-20T12:00:12.000Z",
    };
    const heartbeat = vi.fn(async () => ({
      execution: heartbeatExecution,
      progress,
    }));
    const reconcileProgress = vi.fn(() => progress);
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      runLoggedExportOnce: run,
      reconcileLoggedExportSuccess: vi.fn(),
      startLoggedExportExecution: vi.fn(async () => ({
        status: "started" as const,
        execution,
        progress,
      })),
      heartbeatLoggedExportExecution: heartbeat,
      activateLoggedExecution: vi.fn(() => execution),
      recordLoggedExecutionHeartbeat: persist,
      recordLoggedExportNotStartedCancellation: vi.fn(),
      buildLoggedExportCanceledResult: () => {
        if (!cancellationRecorded) throw cancellationNotRecorded();
        return result;
      },
      getLoggedExecution: () => execution,
      getLoggedExportProgress: () => progress,
      reconcileLoggedExportProgress: reconcileProgress,
      reconcileLoggedExportCanceled: reconcile,
      executionHeartbeatIntervalMs: 10,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ execution: "canceled" });
    expect(run.mock.calls[0]![0]).toMatchObject({
      requireLoggedExecution: true,
    });
    expect(
      (run.mock.calls[0]![0] as { signal: AbortSignal }).signal.aborted,
    ).toBe(true);
    expect(persist).toHaveBeenCalledWith(heartbeatExecution);
    expect(reconcileProgress).toHaveBeenCalledWith(progress);
    expect(heartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ progress }),
      }),
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("lets observed cancellation replace a cleaned local failure before cloud failure commits", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const execution = {
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ee8d",
      requestId: delivery.request.id,
      attempt: 1,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ee8e",
      startedAt: "2026-08-20T12:00:10.000Z",
      heartbeatAt: "2026-08-20T12:00:11.000Z",
      expiresAt: "2026-08-20T12:00:41.000Z",
    };
    const heartbeatExecution = {
      ...execution,
      heartbeatAt: "2026-08-20T12:00:15.000Z",
      expiresAt: "2026-08-20T12:00:45.000Z",
      cancelRequestedAt: "2026-08-20T12:00:14.000Z",
    };
    const result = localCanceledResultFixture(
      delivery,
      1,
      execution.executionId,
    );
    let converted = false;
    const convert = vi.fn(() => {
      converted = true;
    });
    const reconcile = vi.fn(async () => ({
      id: "019fbb95-cd76-7920-93fa-e23ba755ee8f",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result,
      resultFingerprint: "9".repeat(64),
      reconciledAt: "2026-08-20T12:00:16.000Z",
    }));
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      runLoggedExportOnce: vi.fn(async () => ({
        requestId: delivery.request.id,
        status: "failed" as const,
        state: "needs_user_action",
        error: { code: "renderer_failed", message: "Renderer failed." },
      })),
      reconcileLoggedExportSuccess: vi.fn(),
      startLoggedExportExecution: vi.fn(async () => ({
        status: "started" as const,
        execution,
      })),
      heartbeatLoggedExportExecution: vi.fn(async () => ({
        execution: heartbeatExecution,
      })),
      activateLoggedExecution: vi.fn(() => execution),
      recordLoggedExecutionHeartbeat: vi.fn(),
      recordLoggedExportNotStartedCancellation: vi.fn(),
      recordLoggedExportPersistedFailureCancellation: convert,
      buildLoggedExportCanceledResult: () => {
        if (!converted) throw cancellationNotRecorded();
        return result;
      },
      getLoggedExecution: () => execution,
      reconcileLoggedExportCanceled: reconcile,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ execution: "canceled" });
    expect(convert).toHaveBeenCalledWith(
      delivery.request.id,
      "user_requested",
      undefined,
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("discards only the exact completed package when cancellation wins the cloud commit race", async () => {
    const delivery = acceptedLoggedDeliveryFixture();
    const identity = {
      workerId: delivery.workerId,
      epoch: delivery.workerEpoch,
      advertisementFingerprint: "a".repeat(64),
      createdAt: delivery.reservedAt,
      updatedAt: delivery.reservedAt,
    };
    const execution = {
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ee87",
      requestId: delivery.request.id,
      attempt: 1,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ee88",
      startedAt: "2026-08-20T12:00:10.000Z",
      heartbeatAt: "2026-08-20T12:00:11.000Z",
      expiresAt: "2026-08-20T12:00:41.000Z",
    };
    const canceledExecution = {
      ...execution,
      heartbeatAt: "2026-08-20T12:00:16.000Z",
      expiresAt: "2026-08-20T12:00:46.000Z",
      cancelRequestedAt: "2026-08-20T12:00:15.000Z",
    };
    const canceledResult = localCanceledResultFixture(
      delivery,
      1,
      execution.executionId,
    );
    const start = vi
      .fn()
      .mockResolvedValueOnce({ status: "started", execution })
      .mockResolvedValueOnce({
        status: "started",
        execution: canceledExecution,
      });
    let discarded = false;
    const discard = vi.fn(async () => {
      discarded = true;
    });
    const reconcileCanceled = vi.fn(async () => ({
      id: "019fbb95-cd76-7920-93fa-e23ba755ee89",
      deliveryId: delivery.deliveryId,
      generation: delivery.generation,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      result: canceledResult,
      resultFingerprint: "e".repeat(64),
      reconciledAt: "2026-08-20T12:00:17.000Z",
    }));
    const app = createLocalAgent({
      workerIdentity: {
        get: () => identity,
        prepareRegistration: () => identity,
      },
      getAcceptedLoggedDelivery: () => delivery,
      buildLoggedExportSuccessResult: () => localSuccessResultFixture(delivery),
      runLoggedExportOnce: vi.fn(async () => ({
        requestId: delivery.request.id,
        status: "complete" as const,
        state: "complete",
      })),
      reconcileLoggedExportSuccess: vi.fn(async () => {
        throw Object.assign(new Error("cancellation intent won"), {
          statusCode: 409,
        });
      }),
      startLoggedExportExecution: start,
      heartbeatLoggedExportExecution: vi.fn(async () => ({ execution })),
      activateLoggedExecution: vi.fn(() => execution),
      recordLoggedExecutionHeartbeat: vi.fn(),
      recordLoggedExportNotStartedCancellation: vi.fn(),
      buildLoggedExportCanceledResult: () => {
        if (!discarded) throw cancellationNotRecorded();
        return canceledResult;
      },
      getLoggedExecution: () => execution,
      discardCompletedLoggedExportForCancellation: discard,
      reconcileLoggedExportCanceled: reconcileCanceled,
    });
    apps.add(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/process",
      headers: { authorization: "Bearer fixture" },
      payload: {
        requestId: delivery.request.id,
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ execution: "canceled" });
    expect(start).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledWith(delivery.request.id, "user_requested");
    expect(reconcileCanceled).toHaveBeenCalledTimes(1);
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

function loggedDeliveryFixture(): LoggedExportDelivery {
  const base = exportOnlyFixture();
  const resolved = resolveExportSettings({
    context: "logged",
    sourceLanguageClass: "confirmed_english",
    resolvedAt: "2026-08-20T11:59:00.000Z",
  }).snapshot;
  return {
    deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee11",
    generation: 1,
    reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee12",
    workerId: "019fbb95-cd76-7920-93fa-e23ba755ee13",
    workerEpoch: 1,
    status: "reserved",
    reservedAt: "2026-08-20T12:00:00.000Z",
    reservationExpiresAt: "2026-08-20T12:00:30.000Z",
    request: {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee14",
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee15",
      mode: "logged",
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee16",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ee17",
      video: base.video,
      selection: base.selection,
      sourceLanguageClass: base.sourceLanguageClass,
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: resolved.settings,
      },
      resolvedSettingsSnapshot: resolved,
      state: "queued",
      createdAt: "2026-08-20T11:59:00.000Z",
      updatedAt: "2026-08-20T11:59:00.000Z",
    },
  };
}

function acceptedLoggedDeliveryFixture(): LoggedExportDelivery {
  return {
    ...loggedDeliveryFixture(),
    status: "accepted",
    acceptedAt: "2026-08-20T12:00:05.000Z",
  };
}

function localSuccessResultFixture(
  delivery: LoggedExportDelivery,
): LoggedExportSuccessResult {
  const at = "2026-08-20T12:00:10.000Z";
  const packageIdentity = `clip-${delivery.request.id}`;
  const artifact = (
    role:
      | "clip_metadata_json"
      | "english_srt"
      | "manifest_json"
      | "thumbnail_jpg"
      | "video_mp4",
    digit: string,
  ) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: digit.repeat(64),
    sourceAttempt: 1,
    validatedAt: at,
  });
  return {
    schemaVersion: 1,
    requestId: delivery.request.id,
    jobId: delivery.request.jobId,
    projectId: delivery.request.projectId!,
    clipId: delivery.request.clipId!,
    sourceLanguageClass: "confirmed_english",
    resolvedExportBounds: {
      startMs: delivery.request.selection.exportStartMs,
      endMs: delivery.request.selection.exportEndMs,
      sourceAttempt: 1,
      resolvedAt: at,
    },
    renderedMediaProvenance: {
      durationMs:
        delivery.request.selection.exportEndMs -
        delivery.request.selection.exportStartMs,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: "a".repeat(64),
      observedProperties: {
        schemaVersion: 1,
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
        durationMs:
          delivery.request.selection.exportEndMs -
          delivery.request.selection.exportStartMs,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt: 1,
      validatedAt: at,
    },
    thumbnailProvenance: {
      extractionTimeMs: 1_700,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: at,
    },
    englishSubtitleProvenance: {
      trackId: delivery.request.selection.trackId,
      trackVersion: delivery.request.selection.transcriptVersion,
      cueCount: 1,
      byteSize: 64,
      contentSha256: "e".repeat(64),
      startMs: 0,
      endMs: 2_900,
      sourceAttempt: 1,
      validatedAt: at,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("english_srt", "2"),
      artifact("manifest_json", "3"),
      artifact("thumbnail_jpg", "4"),
      artifact("video_mp4", "5"),
    ],
  };
}

function localFailureResultFixture(
  delivery: LoggedExportDelivery,
): LoggedExportFailureResult {
  return {
    schemaVersion: 1,
    requestId: delivery.request.id,
    jobId: delivery.request.jobId,
    projectId: delivery.request.projectId!,
    clipId: delivery.request.clipId!,
    error: {
      code: "export_source_provider_unconfigured",
      message: "Configure an authorized source provider before retrying.",
    },
    attempt: 0,
    sourceCleanup: { lifecycle: "not_started" },
  };
}

function localCanceledResultFixture(
  delivery: LoggedExportDelivery,
  attempt: number,
  executionId?: string,
): LoggedExportCanceledResult {
  return {
    schemaVersion: 1,
    requestId: delivery.request.id,
    jobId: delivery.request.jobId,
    projectId: delivery.request.projectId!,
    clipId: delivery.request.clipId!,
    reason: "user_requested",
    attempt,
    sourceCleanup:
      attempt === 0
        ? { lifecycle: "not_started" }
        : {
            lifecycle: "deleted",
            deletedAt: "2026-08-20T12:00:15.000Z",
          },
    ...(executionId ? { executionId, executionAttempt: attempt } : {}),
  };
}

function cancellationNotRecorded() {
  return Object.assign(new Error("Cancellation is not recorded."), {
    code: "logged_export_cancellation_not_recorded",
  });
}
