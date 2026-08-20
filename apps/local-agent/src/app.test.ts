import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HealthResponseSchema,
  type LoggedExportDelivery,
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
