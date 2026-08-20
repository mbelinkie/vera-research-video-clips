import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthenticatedActor,
  ExportRequest,
  LoggedExportFailureResult,
  LoggedExportSuccessResult,
  TranscriptManifest,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  currentExportWorkerAdvertisement,
  exportWorkerAdvertisementFingerprint,
  sha256Fingerprint,
} from "@research-video/export-settings";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { SharedProjectCatalog } from "./index.ts";

const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("claimed transcript finalization", () => {
  it("atomically activates the version, completes the claimed job, and readies linked items", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const store = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(database, store);
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:worker-owner",
    };
    await catalog.registerUser(actor, "Worker owner");
    const project = await catalog.createProject(actor, {
      name: "Worker project",
    });
    const created = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Worker batch",
      options: {
        targetLanguage: "en",
        transcriptionProfile: "default",
        sourcePolicy: "prefer-existing",
        executionLocation: "local",
        priority: "normal",
      },
      items: [
        {
          inputIndex: 0,
          input: "https://youtu.be/M7lc1UVf-VE",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "M7lc1UVf-VE",
          canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
          title: "Fixture video",
        },
      ],
    });
    const item = created.items[0]!;
    const claimed = await catalog.claimTranscriptionJob(actor, "local", 120);
    expect(claimed?.job.id).toBe(item.jobId);

    const lineageId = randomUUID();
    const grant = await catalog.createClaimedTranscriptUpload(
      actor,
      claimed!.job.id,
      claimed!.lease.attempt,
      {
        lineageId,
        version: 1,
        artifactTypes: ["english-normalized", "english-srt"],
      },
    );
    const storedArtifacts = [];
    for (const type of ["english-normalized", "english-srt"] as const) {
      const target = grant.targets.find(
        (candidate) => candidate.type === type,
      )!;
      const bytes = new TextEncoder().encode(
        type === "english-srt"
          ? "1\n00:00:00,000 --> 00:00:01,000\nFixture\n"
          : JSON.stringify({ fixture: true }),
      );
      const stored = await store.put({
        key: target.objectKey,
        bytes,
        contentType:
          type === "english-srt" ? "application/x-subrip" : "application/json",
        sha256: digest(bytes),
      });
      storedArtifacts.push({
        type,
        objectKey: stored.key,
        objectVersionId: stored.versionId,
        byteSize: bytes.byteLength,
        sha256: stored.sha256,
      });
    }
    const transcriptVersionId = randomUUID();
    const manifest: TranscriptManifest = {
      schemaVersion: 1,
      id: transcriptVersionId,
      projectId: project.id,
      catalogVideoId: item.catalogVideoId!,
      videoId: "M7lc1UVf-VE",
      lineageId,
      version: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      timingPrecision: "cue",
      provider: "fixture",
      normalizationSchemaVersion: 1,
      jobId: claimed!.job.id,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
      artifacts: storedArtifacts,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestTarget = grant.targets.find(
      (candidate) => candidate.type === "manifest",
    )!;
    const manifestStored = await store.put({
      key: manifestTarget.objectKey,
      bytes: manifestBytes,
      contentType: "application/json",
      sha256: digest(manifestBytes),
    });
    const finalized = await catalog.finalizeTranscript(
      actor,
      {
        uploadId: grant.uploadId,
        idempotencyKey: `finalize:${transcriptVersionId}`,
        manifest: {
          type: "manifest",
          objectKey: manifestStored.key,
          objectVersionId: manifestStored.versionId,
          byteSize: manifestBytes.byteLength,
          sha256: manifestStored.sha256,
        },
      },
      { jobId: claimed!.job.id, attempt: claimed!.lease.attempt },
    );

    expect(finalized.transcriptVersionId).toBe(transcriptVersionId);
    const batch = await catalog.getTranscriptionBatch(
      actor,
      project.id,
      created.batch.id,
    );
    expect(batch.items[0]).toMatchObject({
      state: "ready_for_review",
      activeTranscriptVersionId: transcriptVersionId,
      reviewStatus: "unreviewed",
    });
    expect(
      await catalog.claimTranscriptionJob(actor, "local", 120),
    ).toBeUndefined();
    await expect(
      catalog.heartbeatTranscriptionJob(
        actor,
        claimed!.job.id,
        claimed!.lease.attempt,
        120,
        "uploading",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

const editingSettings = {
  container: "mp4" as const,
  videoCodec: "h264" as const,
  videoRateControl: { mode: "crf" as const, value: 20 },
  maxWidth: 1_920,
  frameRate: "source" as const,
  audioCodec: "aac" as const,
  audioKilobitsPerSecond: 192,
  omitSubtitleFilesForConfirmedEnglish: false,
  embedEnglishSubtitleTrack: false,
};

describe("versioned export preset catalogs", () => {
  it("keeps personal revisions/defaults fixed and replays durable receipts after CAS advances", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:preset-owner",
    };
    await catalog.registerUser(actor, "Preset owner");
    const createInput = {
      idempotencyKey: "personal-create-1",
      name: "Editing Personal",
      description: "My standard export",
      settings: editingSettings,
    };
    const created = await catalog.createPersonalExportPreset(
      actor,
      createInput,
    );
    expect(
      await catalog.createPersonalExportPreset(actor, createInput),
    ).toEqual(created);
    const revised = await catalog.revisePersonalExportPreset(actor, {
      idempotencyKey: "personal-revise-1",
      presetId: created.id,
      expectedEntityVersion: 1,
      name: "Editing Personal",
      description: "A newer immutable revision",
      settings: { ...editingSettings, maxWidth: 1_280 },
    });
    expect(revised).toMatchObject({ currentVersion: 2, entityVersion: 2 });
    expect(
      await catalog.createPersonalExportPreset(actor, createInput),
    ).toEqual(created);
    const fixedDefault = await catalog.setPersonalExportPresetDefault(actor, {
      idempotencyKey: "personal-default-1",
      expectedEntityVersion: 0,
      presetId: created.id,
      presetVersion: 1,
    });
    await catalog.revisePersonalExportPreset(actor, {
      idempotencyKey: "personal-revise-2",
      presetId: created.id,
      expectedEntityVersion: 2,
      name: "Editing Personal",
      description: "Third revision",
      settings: { ...editingSettings, maxWidth: 960 },
    });
    expect(
      await catalog.revisePersonalExportPreset(actor, {
        idempotencyKey: "personal-revise-1",
        presetId: created.id,
        expectedEntityVersion: 1,
        name: "Editing Personal",
        description: "A newer immutable revision",
        settings: { ...editingSettings, maxWidth: 1_280 },
      }),
    ).toEqual(revised);
    expect(
      await catalog.setPersonalExportPresetDefault(actor, {
        idempotencyKey: "personal-default-1",
        expectedEntityVersion: 0,
        presetId: created.id,
        presetVersion: 1,
      }),
    ).toEqual(fixedDefault);
    const discovered = await catalog.listPersonalExportPresets(actor);
    expect(discovered.presets[0]).toMatchObject({
      currentVersion: 3,
      current: { settings: { maxWidth: 960 } },
    });
    expect(discovered.default).toMatchObject({
      presetVersion: 1,
      snapshot: { settings: { maxWidth: 1_920 } },
    });
    await expect(
      catalog.createPersonalExportPreset(actor, {
        ...createInput,
        name: "Different command",
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(
      Number(
        (
          await database.query<{ count: string }>(
            "SELECT count(*) FROM sync_events",
          )
        ).rows[0]!.count,
      ),
    ).toBe(0);
  });

  it("authorizes project discovery/writes and never exposes another member's personal presets", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const owner: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:project-preset-owner",
    };
    const viewer: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:project-preset-viewer",
    };
    const outsider: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:project-preset-outsider",
    };
    await catalog.registerUser(owner, "Owner");
    await catalog.registerUser(viewer, "Viewer");
    await catalog.registerUser(outsider, "Outsider");
    const project = await catalog.createProject(owner, {
      name: "Preset project",
    });
    await catalog.addMember(owner, project.id, viewer.userId, "viewer");
    await catalog.createPersonalExportPreset(owner, {
      idempotencyKey: "owner-personal",
      name: "Owner private",
      description: "Must not leak",
      settings: editingSettings,
    });
    const projectPreset = await catalog.createProjectExportPreset(
      owner,
      project.id,
      {
        idempotencyKey: "project-create",
        name: "Project Editing",
        description: "Shared",
        settings: editingSettings,
      },
    );
    await catalog.setProjectExportPresetDefault(owner, project.id, {
      idempotencyKey: "project-default",
      expectedEntityVersion: 0,
      presetId: projectPreset.id,
      presetVersion: 1,
    });
    const viewerDiscovery = await catalog.listProjectExportPresets(
      viewer,
      project.id,
    );
    expect(viewerDiscovery.projectPresets).toHaveLength(1);
    expect(viewerDiscovery.personalPresets).toEqual([]);
    expect(viewerDiscovery.projectDefault?.snapshot.name).toBe(
      "Project Editing",
    );
    await expect(
      catalog.createProjectExportPreset(viewer, project.id, {
        idempotencyKey: "viewer-write",
        name: "Forbidden",
        description: "",
        settings: editingSettings,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.listProjectExportPresets(outsider, project.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    const events = await database.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, payload FROM sync_events
       WHERE project_id = $1 AND event_type LIKE 'export_preset.%'
       ORDER BY sequence`,
      [project.id],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "export_preset.created",
      "export_preset.default_set",
    ]);
    expect(JSON.stringify(events.rows)).not.toContain("Owner private");
  });
});

describe("registered local export workers", () => {
  it("keeps immutable epochs, bounded owner heartbeats, revocation, and project-authorized availability", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    let now = new Date("2026-08-20T12:00:00.000Z");
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => now,
    );
    const owner: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:registered-worker-owner",
    };
    const collaborator: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:registered-worker-collaborator",
    };
    const outsider: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:registered-worker-outsider",
    };
    for (const [actor, name] of [
      [owner, "Owner"],
      [collaborator, "Collaborator"],
      [outsider, "Outsider"],
    ] as const) {
      await catalog.registerUser(actor, name);
    }
    const project = await catalog.createProject(owner, {
      name: "Worker project",
    });
    await catalog.addMember(owner, project.id, collaborator.userId, "viewer");
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "libx265", "prores_ks", "mov_text", "srt"],
      muxers: ["mp4", "matroska", "mov"],
      filters: ["scale", "fps"],
    });
    const workerId = randomUUID();
    const registration = { workerId, epoch: 1, ...advertisement };
    const registered = await catalog.registerExportWorker(owner, registration);
    expect(registered).toMatchObject({ id: workerId, epoch: 1 });
    expect(registered).not.toHaveProperty("ownerUserId");
    expect(await catalog.registerExportWorker(owner, registration)).toEqual(
      registered,
    );
    const unsupportedCapability = {
      ...advertisement.capability,
      profileVersion: advertisement.capability.profileVersion + 1,
    };
    await expect(
      catalog.registerExportWorker(owner, {
        ...registration,
        capability: unsupportedCapability,
        advertisementFingerprint: exportWorkerAdvertisementFingerprint({
          capability: unsupportedCapability,
          installedCapabilities: advertisement.installedCapabilities,
        }),
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      catalog.registerExportWorker(outsider, registration),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.registerExportWorker(owner, {
        ...registration,
        installedCapabilities: {
          ...advertisement.installedCapabilities,
          availableRendererIds: ["h264_mp4"],
          unavailableRendererIds: ["hevc_mkv", "prores_mov"],
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    const changedSummary = {
      ...advertisement.installedCapabilities,
      availableRendererIds: ["h264_mp4"],
      unavailableRendererIds: ["hevc_mkv", "prores_mov"],
    } satisfies typeof advertisement.installedCapabilities;
    const changed = {
      ...registration,
      installedCapabilities: changedSummary,
      advertisementFingerprint: exportWorkerAdvertisementFingerprint({
        capability: advertisement.capability,
        installedCapabilities: changedSummary,
      }),
    };
    await expect(
      catalog.registerExportWorker(owner, changed),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      catalog.heartbeatExportWorker(outsider, { workerId, epoch: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    now = new Date("2026-08-20T12:00:30.000Z");
    const heartbeat = await catalog.heartbeatExportWorker(owner, {
      workerId,
      epoch: 1,
    });
    expect(heartbeat.heartbeatAt).toBe(now.toISOString());
    expect(heartbeat.installedCapabilities).toEqual(
      advertisement.installedCapabilities,
    );
    const availabilityRequest = {
      capability: advertisement.capability,
      rendererId: "h264_mp4" as const,
    };
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: true, availableWorkerCount: 1 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        {
          ...availabilityRequest,
          capability: {
            ...advertisement.capability,
            profileVersion: advertisement.capability.profileVersion + 1,
          },
        },
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
    await catalog.registerExportWorker(outsider, {
      ...registration,
      workerId: randomUUID(),
    });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: true, availableWorkerCount: 1 });
    await expect(
      catalog.compatibleExportWorkerAvailability(
        outsider,
        project.id,
        availabilityRequest,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        {
          ...availabilityRequest,
          rendererId: "hevc_mkv",
        },
      ),
    ).toEqual({ compatible: true, availableWorkerCount: 1 });
    await catalog.revokeExportWorker(owner, { workerId, epoch: 1 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
    await expect(
      catalog.registerExportWorker(owner, registration),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(
      await catalog.registerExportWorker(owner, { ...changed, epoch: 2 }),
    ).toMatchObject({ id: workerId, epoch: 2 });
    await expect(
      catalog.registerExportWorker(outsider, { ...changed, epoch: 3 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        {
          ...availabilityRequest,
          rendererId: "hevc_mkv",
        },
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
    now = new Date("2026-08-20T12:02:00.000Z");
    await expect(
      catalog.heartbeatExportWorker(owner, { workerId, epoch: 2 }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
  });
});

describe("logged export delivery", () => {
  it("atomically reserves once, accepts idempotently, and does not replay accepted work as a new claim", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    let now = new Date("2026-08-20T12:00:00.000Z");
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => now,
    );
    const owner = fixtureActor("delivery-owner");
    const collaborator = fixtureActor("delivery-collaborator");
    await catalog.registerUser(owner, "Delivery owner");
    await catalog.registerUser(collaborator, "Delivery collaborator");
    const { projectId, request } = await createLoggedExportFixture(
      catalog,
      owner,
      "single",
    );
    await catalog.addMember(owner, projectId, collaborator.userId, "editor");
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const ownerWorker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    const collaboratorWorker = {
      workerId: randomUUID(),
      epoch: 1,
      ...advertisement,
    };
    await catalog.registerExportWorker(owner, ownerWorker);
    await catalog.registerExportWorker(collaborator, collaboratorWorker);
    await expect(
      catalog.claimLoggedExportDelivery(collaborator, {
        workerId: ownerWorker.workerId,
        workerEpoch: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.claimLoggedExportDelivery(owner, {
        workerId: ownerWorker.workerId,
        workerEpoch: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const revokedWorker = {
      workerId: randomUUID(),
      epoch: 1,
      ...advertisement,
    };
    await catalog.registerExportWorker(owner, revokedWorker);
    await catalog.revokeExportWorker(owner, {
      workerId: revokedWorker.workerId,
      epoch: 1,
    });
    await expect(
      catalog.claimLoggedExportDelivery(owner, {
        workerId: revokedWorker.workerId,
        workerEpoch: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const claims = await Promise.all([
      catalog.claimLoggedExportDelivery(owner, {
        workerId: ownerWorker.workerId,
        workerEpoch: 1,
      }),
      catalog.claimLoggedExportDelivery(collaborator, {
        workerId: collaboratorWorker.workerId,
        workerEpoch: 1,
      }),
    ]);
    const winning = claims.find((claim) => claim.delivery)?.delivery!;
    expect(claims.filter((claim) => claim.delivery)).toHaveLength(1);
    expect(winning.request).toEqual(request);
    expect(winning).not.toHaveProperty("ownerUserId");
    expect(JSON.stringify(winning)).not.toMatch(
      /\/private\/|presigned|credential/i,
    );
    const winningActor =
      winning.workerId === ownerWorker.workerId ? owner : collaborator;
    const otherActor = winningActor === owner ? collaborator : owner;
    await expect(
      catalog.acceptLoggedExportDelivery(otherActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.acceptLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch + 1,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const accepted = await catalog.acceptLoggedExportDelivery(winningActor, {
      workerId: winning.workerId,
      workerEpoch: winning.workerEpoch,
      deliveryId: winning.deliveryId,
      generation: winning.generation,
      reservationToken: winning.reservationToken,
    });
    expect(accepted.status).toBe("accepted");
    expect(
      await catalog.acceptLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).toEqual(accepted);
    now = new Date("2026-08-20T12:00:10.000Z");
    expect(
      await catalog.claimLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
      }),
    ).toEqual({});
    expect(
      Number(
        (
          await database.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM logged_export_deliveries",
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
    await catalog.revokeExportWorker(winningActor, {
      workerId: winning.workerId,
      epoch: winning.workerEpoch,
    });
    await expect(
      catalog.acceptLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("uses one stable delivery ID with a new generation/token after expiry and rejects stale acceptance", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    let now = new Date("2026-08-20T12:00:00.000Z");
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => now,
    );
    const owner = fixtureActor("redelivery-owner");
    const other = fixtureActor("redelivery-other");
    await catalog.registerUser(owner, "Redelivery owner");
    await catalog.registerUser(other, "Redelivery other");
    const { projectId } = await createLoggedExportFixture(
      catalog,
      owner,
      "redelivery",
    );
    await catalog.addMember(owner, projectId, other.userId, "editor");
    const advertisement = currentExportWorkerAdvertisement({
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const firstWorker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    const secondWorker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, firstWorker);
    await catalog.registerExportWorker(other, secondWorker);
    const first = (
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: firstWorker.workerId,
        workerEpoch: 1,
      })
    ).delivery!;
    now = new Date("2026-08-20T12:00:31.000Z");
    const second = (
      await catalog.claimLoggedExportDelivery(other, {
        workerId: secondWorker.workerId,
        workerEpoch: 1,
      })
    ).delivery!;
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(second.generation).toBe(first.generation + 1);
    expect(second.reservationToken).not.toBe(first.reservationToken);
    await expect(
      catalog.acceptLoggedExportDelivery(owner, {
        workerId: first.workerId,
        workerEpoch: first.workerEpoch,
        deliveryId: first.deliveryId,
        generation: first.generation,
        reservationToken: first.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, other.userId],
    );
    await expect(
      catalog.acceptLoggedExportDelivery(other, {
        workerId: second.workerId,
        workerEpoch: second.workerEpoch,
        deliveryId: second.deliveryId,
        generation: second.generation,
        reservationToken: second.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      await catalog.claimLoggedExportDelivery(other, {
        workerId: second.workerId,
        workerEpoch: second.workerEpoch,
      }),
    ).toEqual({});
    await catalog.addMember(owner, projectId, other.userId, "editor");
    expect(
      (
        await catalog.acceptLoggedExportDelivery(other, {
          workerId: second.workerId,
          workerEpoch: second.workerEpoch,
          deliveryId: second.deliveryId,
          generation: second.generation,
          reservationToken: second.reservationToken,
        })
      ).status,
    ).toBe("accepted");
    now = new Date("2026-08-20T12:01:01.000Z");
    await expect(
      catalog.claimLoggedExportDelivery(other, {
        workerId: secondWorker.workerId,
        workerEpoch: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("finds a compatible request after more than one hundred older incompatible requests", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const owner = fixtureActor("fair-claim-owner");
    await catalog.registerUser(owner, "Fair claim owner");
    const fixture = await createLoggedExportFixture(
      catalog,
      owner,
      "incompatible-0",
      "hevc",
    );
    for (let index = 1; index <= 100; index += 1) {
      await createLoggedExportFromClip(
        catalog,
        owner,
        fixture.projectId,
        fixture.clipId,
        `incompatible-${index}`,
        "hevc",
      );
    }
    const advertisement = currentExportWorkerAdvertisement({
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, worker);
    expect(
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: 1,
      }),
    ).toEqual({});
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_deliveries",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM jobs
           WHERE kind = 'export' AND state = 'queued'`,
        )
      ).rows[0]!.count,
    ).toBe("101");
    const compatible = await createLoggedExportFromClip(
      catalog,
      owner,
      fixture.projectId,
      fixture.clipId,
      "compatible-last",
      "h264",
    );
    const claim = await catalog.claimLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: 1,
    });
    expect(claim.delivery?.request.id).toBe(compatible.id);
  });

  it("atomically reconciles one immutable success and replays it without another event or clip version", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const command = reconcileSuccessCommand(fixture);
    const first = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      command,
    );
    expect(first.result).toEqual(fixture.result);
    expect(first.resultFingerprint).toBe(sha256Fingerprint(fixture.result));
    const forbiddenCloudResultFields =
      /reservation_?token|owner_?user_?id|authorization|\/private\/|ffmpeg_?args|source_?identity/i;
    expect(JSON.stringify(first)).not.toMatch(forbiddenCloudResultFields);
    const persistedResultAndEvent = await fixture.database.query<
      Record<string, unknown>
    >(
      `SELECT result.*, event.payload AS event_payload
       FROM logged_export_success_results result
       JOIN sync_events event
         ON event.entity_id = $1
        AND event.event_type = 'clip_candidate.export_completed'
       WHERE result.export_request_id = $2`,
      [fixture.accepted.request.clipId, fixture.accepted.request.id],
    );
    expect(JSON.stringify(persistedResultAndEvent.rows[0])).not.toMatch(
      forbiddenCloudResultFields,
    );
    const afterFirst = await fixture.database.query<{
      state: string;
      export_status: string;
      version: number;
    }>(
      `SELECT j.state, c.export_status, c.version
       FROM jobs j
       JOIN export_requests er ON er.job_id = j.id
       JOIN clip_candidates c ON c.id = er.clip_id
       WHERE er.id = $1`,
      [fixture.accepted.request.id],
    );
    expect(afterFirst.rows[0]).toMatchObject({
      state: "complete",
      export_status: "complete",
    });
    const completedVersion = Number(afterFirst.rows[0]!.version);
    expect(
      await fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        command,
      ),
    ).toEqual(first);
    const divergentResult: LoggedExportSuccessResult = {
      ...fixture.result,
      artifacts: fixture.result.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, contentSha256: "9".repeat(64) } : artifact,
      ),
    };
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
        ...command,
        result: divergentResult,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_completed'
             AND entity_id = $1`,
          [fixture.accepted.request.clipId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      Number(
        (
          await fixture.database.query<{ version: number }>(
            "SELECT version FROM clip_candidates WHERE id = $1",
            [fixture.accepted.request.clipId],
          )
        ).rows[0]!.version,
      ),
    ).toBe(completedVersion);
    expect(
      await fixture.catalog.getLoggedExportRequest(
        fixture.owner,
        fixture.accepted.request.projectId!,
        fixture.accepted.request.id,
      ),
    ).toMatchObject({
      state: "complete",
      resolvedExportBounds: fixture.result.resolvedExportBounds,
      finalArtifacts: fixture.result.artifacts,
    });
    await expect(
      fixture.database.query(
        `UPDATE logged_export_success_results
         SET result_fingerprint = $1 WHERE id = $2`,
        ["0".repeat(64), first.id],
      ),
    ).rejects.toThrow(/immutable/u);
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(
        fixture.owner,
        reconcileFailureCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const failureResult = loggedExportFailureFixture(fixture.accepted.request);
    await expect(
      fixture.database.query(
        `INSERT INTO logged_export_failure_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, result_schema_version, result_json,
            result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
        [
          randomUUID(),
          fixture.accepted.request.id,
          fixture.accepted.deliveryId,
          fixture.accepted.generation,
          fixture.accepted.workerId,
          fixture.accepted.workerEpoch,
          JSON.stringify(failureResult),
          sha256Fingerprint(failureResult),
          "2026-08-20T12:00:20.000Z",
        ],
      ),
    ).rejects.toThrow(/mutually exclusive/u);
  });

  it("atomically reconciles one sanitized immutable failure and replays it without another event or version", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const unsafeResult: LoggedExportFailureResult = {
      ...loggedExportFailureFixture(fixture.accepted.request),
      error: {
        code: "Renderer Failed!",
        message: `failed /private/source.mp4 C:\\Users\\name\\source.mov \\\\server\\share\\source.mov file:///private/source.mov token=${fixture.accepted.reservationToken} Bearer private.jwt-token https://private.invalid/source`,
      },
    };
    const command = {
      ...reconcileFailureCommand(fixture),
      result: unsafeResult,
    };
    const first = await fixture.catalog.reconcileLoggedExportFailure(
      fixture.owner,
      command,
    );
    expect(first.result.error).toEqual({
      code: "renderer_failed",
      message:
        "failed <path> <path> <path> <path> token=<redacted> Bearer <redacted> <url>",
    });
    expect(first.resultFingerprint).toBe(sha256Fingerprint(first.result));
    const forbidden =
      /reservation_?token|owner_?user_?id|authorization|\/private\/|private\.invalid|source_?identity|C:\\Users|\\\\server|file:\/\/|private\.jwt/i;
    expect(JSON.stringify(first)).not.toMatch(forbidden);
    const persisted = await fixture.database.query<Record<string, unknown>>(
      `SELECT result.*, event.payload AS event_payload
       FROM logged_export_failure_results result
       JOIN sync_events event
         ON event.entity_id = $1
        AND event.event_type = 'clip_candidate.export_failed'
       WHERE result.export_request_id = $2`,
      [fixture.accepted.request.clipId, fixture.accepted.request.id],
    );
    expect(JSON.stringify(persisted.rows[0])).not.toMatch(forbidden);
    const afterFirst = await fixture.database.query<{
      state: string;
      export_status: string;
      version: number;
    }>(
      `SELECT j.state, c.export_status, c.version
       FROM jobs j
       JOIN export_requests er ON er.job_id = j.id
       JOIN clip_candidates c ON c.id = er.clip_id
       WHERE er.id = $1`,
      [fixture.accepted.request.id],
    );
    expect(afterFirst.rows[0]).toMatchObject({
      state: "failed",
      export_status: "failed",
    });
    const failedVersion = Number(afterFirst.rows[0]!.version);
    expect(
      await fixture.catalog.reconcileLoggedExportFailure(
        fixture.owner,
        command,
      ),
    ).toEqual(first);
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
        ...command,
        result: {
          ...unsafeResult,
          error: { code: "different_failure", message: "Different failure." },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_failure_results",
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_failed'
             AND entity_id = $1`,
          [fixture.accepted.request.clipId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      Number(
        (
          await fixture.database.query<{ version: number }>(
            "SELECT version FROM clip_candidates WHERE id = $1",
            [fixture.accepted.request.clipId],
          )
        ).rows[0]!.version,
      ),
    ).toBe(failedVersion);
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        reconcileSuccessCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      fixture.database.query(
        `INSERT INTO logged_export_success_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, result_schema_version, result_json,
            result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
        [
          randomUUID(),
          fixture.accepted.request.id,
          fixture.accepted.deliveryId,
          fixture.accepted.generation,
          fixture.accepted.workerId,
          fixture.accepted.workerEpoch,
          JSON.stringify(fixture.result),
          sha256Fingerprint(fixture.result),
          "2026-08-20T12:00:20.000Z",
        ],
      ),
    ).rejects.toThrow(/mutually exclusive/u);
    await expect(
      fixture.database.query(
        `UPDATE logged_export_failure_results
         SET result_fingerprint = $1 WHERE id = $2`,
        ["0".repeat(64), first.id],
      ),
    ).rejects.toThrow(/immutable/u);
  });

  it("permits the original owner to close pinned failures after expiry, revocation, or a newer registration epoch", async () => {
    const expiredClock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const expired = await createAcceptedLoggedExportResultFixture(expiredClock);
    expiredClock.now = new Date("2026-08-20T12:01:01.000Z");
    expect(
      (
        await expired.catalog.reconcileLoggedExportFailure(
          expired.owner,
          reconcileFailureCommand(expired),
        )
      ).result.requestId,
    ).toBe(expired.accepted.request.id);

    const revoked = await createAcceptedLoggedExportResultFixture();
    await revoked.catalog.revokeExportWorker(revoked.owner, {
      workerId: revoked.worker.workerId,
      epoch: revoked.worker.epoch,
    });
    const revokedCommand = reconcileFailureCommand(revoked);
    const revokedResult = await revoked.catalog.reconcileLoggedExportFailure(
      revoked.owner,
      revokedCommand,
    );
    expect(
      await revoked.catalog.reconcileLoggedExportFailure(
        revoked.owner,
        revokedCommand,
      ),
    ).toEqual(revokedResult);

    const advanced = await createAcceptedLoggedExportResultFixture();
    await advanced.catalog.registerExportWorker(advanced.owner, {
      ...advanced.worker,
      epoch: advanced.worker.epoch + 1,
    });
    expect(
      (
        await advanced.catalog.reconcileLoggedExportFailure(
          advanced.owner,
          reconcileFailureCommand(advanced),
        )
      ).workerEpoch,
    ).toBe(advanced.accepted.workerEpoch);
  });

  it("rejects forged pinned failure credentials and membership loss without mutation", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const command = reconcileFailureCommand(fixture);
    for (const mutation of [
      { workerEpoch: command.workerEpoch + 1 },
      { generation: command.generation + 1 },
      { reservationToken: randomUUID() },
      { workerId: randomUUID() },
    ]) {
      await expect(
        fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
          ...command,
          ...mutation,
        }),
      ).rejects.toMatchObject({ statusCode: expect.any(Number) });
    }
    for (const resultMutation of [
      { requestId: randomUUID() },
      { jobId: randomUUID() },
      { projectId: randomUUID() },
      { clipId: randomUUID() },
    ]) {
      await expect(
        fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
          ...command,
          result: { ...command.result, ...resultMutation },
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    const other = fixtureActor("failure-other");
    await fixture.catalog.registerUser(other, "Failure other");
    await fixture.database.query(
      `INSERT INTO project_members (project_id, user_id, role, created_at)
       VALUES ($1, $2, 'editor', $3)`,
      [
        fixture.accepted.request.projectId,
        other.userId,
        new Date().toISOString(),
      ],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(other, command),
    ).rejects.toMatchObject({ statusCode: 403 });
    await fixture.database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [fixture.accepted.request.projectId, fixture.owner.userId],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(fixture.owner, command),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_failure_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
  });

  it("rejects shaped but request-inconsistent result provenance without any partial authoritative mutation", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const differentRequestId = randomUUID();
    const differentPackageIdentity = `clip-${differentRequestId}`;
    const mutations: LoggedExportSuccessResult[] = [
      {
        ...fixture.result,
        requestId: differentRequestId,
        artifacts: fixture.result.artifacts.map((artifact) => ({
          ...artifact,
          packageIdentity: differentPackageIdentity,
        })),
      },
      {
        ...fixture.result,
        renderedMediaProvenance: {
          ...fixture.result.renderedMediaProvenance,
          settingsSha256: "f".repeat(64),
        },
      },
      {
        ...fixture.result,
        renderedMediaProvenance: {
          ...fixture.result.renderedMediaProvenance,
          observedProperties: {
            ...fixture.result.renderedMediaProvenance.observedProperties!,
            video: {
              ...fixture.result.renderedMediaProvenance.observedProperties!
                .video,
              codec: "hevc",
            },
          },
        },
      },
      {
        ...fixture.result,
        resolvedExportBounds: {
          ...fixture.result.resolvedExportBounds,
          startMs: fixture.result.resolvedExportBounds.startMs + 1,
        },
      },
      {
        ...fixture.result,
        englishSubtitleProvenance: {
          ...fixture.result.englishSubtitleProvenance!,
          trackId: randomUUID(),
        },
      },
    ];
    for (const result of mutations) {
      await expect(
        fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
          ...reconcileSuccessCommand(fixture),
          result,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_completed'`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
    expect(
      (
        await fixture.database.query<{ export_status: string }>(
          "SELECT export_status FROM clip_candidates WHERE id = $1",
          [fixture.accepted.request.clipId],
        )
      ).rows[0]!.export_status,
    ).toBe("queued");
  });

  it("binds bilingual sidecar identities, versions, and English language to the immutable snapshots", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture(
      undefined,
      "foreign",
    );
    const command = reconcileSuccessCommand(fixture);
    const englishIndex = fixture.result.subtitleSidecars!.findIndex(
      (sidecar) => sidecar.role === "english",
    );
    const inconsistentResults: LoggedExportSuccessResult[] = [
      {
        ...fixture.result,
        subtitleSidecars: fixture.result.subtitleSidecars!.map(
          (sidecar, index) =>
            index === englishIndex
              ? { ...sidecar, trackId: randomUUID() }
              : sidecar,
        ),
      },
      {
        ...fixture.result,
        subtitleSidecars: fixture.result.subtitleSidecars!.map(
          (sidecar, index) =>
            index === englishIndex
              ? { ...sidecar, trackVersion: sidecar.trackVersion + 1 }
              : sidecar,
        ),
      },
      {
        ...fixture.result,
        subtitleSidecars: fixture.result.subtitleSidecars!.map(
          (sidecar, index) =>
            index === englishIndex ? { ...sidecar, language: "fr" } : sidecar,
        ),
      },
    ];
    for (const result of inconsistentResults) {
      await expect(
        fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
          ...command,
          result,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ state: string; export_status: string }>(
          `SELECT j.state, c.export_status
           FROM jobs j
           JOIN export_requests er ON er.job_id = j.id
           JOIN clip_candidates c ON c.id = er.clip_id
           WHERE er.id = $1`,
          [fixture.accepted.request.id],
        )
      ).rows[0],
    ).toMatchObject({ state: "queued", export_status: "queued" });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_completed'`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.catalog.reconcileLoggedExportSuccess(
          fixture.owner,
          command,
        )
      ).result,
    ).toEqual(fixture.result);
  });

  it("requires the current owner epoch, live registration, and project membership at reconciliation", async () => {
    const clock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const command = reconcileSuccessCommand(fixture);
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
        ...command,
        workerEpoch: command.workerEpoch + 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const differentWorker = {
      ...fixture.worker,
      workerId: randomUUID(),
    };
    await fixture.catalog.registerExportWorker(fixture.owner, differentWorker);
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
        ...command,
        workerId: differentWorker.workerId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const nonOwner = fixtureActor("result-non-owner");
    await fixture.catalog.registerUser(nonOwner, "Result non-owner");
    await fixture.database.query(
      `INSERT INTO project_members (project_id, user_id, role, created_at)
       VALUES ($1, $2, 'editor', $3)`,
      [
        fixture.accepted.request.projectId,
        nonOwner.userId,
        clock.now.toISOString(),
      ],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(nonOwner, command),
    ).rejects.toMatchObject({ statusCode: 403 });
    await fixture.database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [fixture.accepted.request.projectId, fixture.owner.userId],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, command),
    ).rejects.toMatchObject({ statusCode: 409 });
    await fixture.database.query(
      `INSERT INTO project_members (project_id, user_id, role, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [
        fixture.accepted.request.projectId,
        fixture.owner.userId,
        clock.now.toISOString(),
      ],
    );
    clock.now = new Date("2026-08-20T12:01:01.000Z");
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, command),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    await fixture.catalog.registerExportWorker(fixture.owner, fixture.worker);
    expect(
      (
        await fixture.catalog.reconcileLoggedExportSuccess(
          fixture.owner,
          command,
        )
      ).result.requestId,
    ).toBe(fixture.accepted.request.id);
  });

  it("rejects a revoked pinned worker without changing the accepted export", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.revokeExportWorker(fixture.owner, {
      workerId: fixture.worker.workerId,
      epoch: fixture.worker.epoch,
    });
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        reconcileSuccessCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
  });
});

function fixtureActor(name: string): AuthenticatedActor {
  return { userId: randomUUID(), externalSubject: `fixture:${name}` };
}

async function createLoggedExportFixture(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  idempotencyKey: string,
  family: "h264" | "hevc" = "h264",
  sourceLanguageClass: "confirmed_english" | "foreign" = "confirmed_english",
) {
  const project = await catalog.createProject(actor, {
    name: `Delivery ${idempotencyKey}`,
  });
  const trackId = randomUUID();
  const clip = await catalog.createClipCandidate(actor, project.id, {
    idempotencyKey: `clip:${idempotencyKey}`,
    video: {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Delivery fixture",
    },
    selection: {
      trackId,
      transcriptVersion: 1,
      firstSegmentId: randomUUID(),
      lastSegmentId: randomUUID(),
      firstTokenId: randomUUID(),
      lastTokenId: randomUUID(),
      transcriptStartMs: 300,
      transcriptEndMs: 2_900,
      exportStartMs: 0,
      exportEndMs: 3_400,
      text: "Delivery fixture selection",
      timingPrecision: "word",
    },
    languageEvidence: {
      schemaVersion: 2,
      native: {
        role: "native",
        language: "en",
        text: "Delivery fixture selection",
        trackId,
        trackVersion: 1,
        timingPrecision: "word",
      },
      english: {
        role: "english",
        language: "en",
        text: "Delivery fixture selection",
        trackId,
        trackVersion: 1,
        timingPrecision: "word",
      },
    },
    notes: "",
    tags: [],
  });
  const request = await createLoggedExportFromClip(
    catalog,
    actor,
    project.id,
    clip.id,
    idempotencyKey,
    family,
    sourceLanguageClass,
  );
  return { projectId: project.id, clipId: clip.id, request };
}

async function createLoggedExportFromClip(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  projectId: string,
  clipId: string,
  idempotencyKey: string,
  family: "h264" | "hevc",
  sourceLanguageClass: "confirmed_english" | "foreign" = "confirmed_english",
) {
  const overrides =
    family === "hevc"
      ? {
          container: "mkv" as const,
          videoCodec: "hevc" as const,
          audioCodec: "aac" as const,
        }
      : {};
  const selection = { base: "application_default" as const, overrides };
  const preview = await catalog.previewProjectExportSettings(actor, projectId, {
    sourceLanguageClass,
    selection,
  });
  const subtitleTracks =
    sourceLanguageClass === "foreign"
      ? {
          original: { trackId: randomUUID(), trackVersion: 3 },
          english: { trackId: randomUUID(), trackVersion: 4 },
        }
      : undefined;
  return catalog.createClipExport(actor, projectId, clipId, {
    idempotencyKey,
    sourceLanguageClass,
    ...(subtitleTracks ? { subtitleTracks } : {}),
    settingsSelection: selection,
    expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
  });
}

async function createAcceptedLoggedExportResultFixture(
  clock: { now: Date } = { now: new Date("2026-08-20T12:00:00.000Z") },
  sourceLanguageClass: "confirmed_english" | "foreign" = "confirmed_english",
) {
  const database = new PGlite();
  databases.add(database);
  await runCloudMigrations(database);
  const catalog = new SharedProjectCatalog(
    database,
    new MemoryTranscriptObjectStore(),
    () => clock.now,
  );
  const owner = fixtureActor("result-owner");
  await catalog.registerUser(owner, "Result owner");
  const { request } = await createLoggedExportFixture(
    catalog,
    owner,
    randomUUID(),
    "h264",
    sourceLanguageClass,
  );
  const advertisement = currentExportWorkerAdvertisement({
    ffmpegVersion: "8.1.2",
    encoders: ["libx264", "mov_text"],
    muxers: ["mp4"],
    filters: ["scale", "fps"],
  });
  const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
  await catalog.registerExportWorker(owner, worker);
  const reserved = (
    await catalog.claimLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: worker.epoch,
    })
  ).delivery!;
  const accepted = await catalog.acceptLoggedExportDelivery(owner, {
    workerId: worker.workerId,
    workerEpoch: worker.epoch,
    deliveryId: reserved.deliveryId,
    generation: reserved.generation,
    reservationToken: reserved.reservationToken,
  });
  return {
    database,
    catalog,
    owner,
    worker,
    accepted,
    result: loggedExportSuccessFixture(request, clock.now.toISOString()),
  };
}

function reconcileSuccessCommand(
  fixture: Awaited<ReturnType<typeof createAcceptedLoggedExportResultFixture>>,
) {
  return {
    workerId: fixture.accepted.workerId,
    workerEpoch: fixture.accepted.workerEpoch,
    deliveryId: fixture.accepted.deliveryId,
    generation: fixture.accepted.generation,
    reservationToken: fixture.accepted.reservationToken,
    result: fixture.result,
  };
}

function reconcileFailureCommand(
  fixture: Awaited<ReturnType<typeof createAcceptedLoggedExportResultFixture>>,
) {
  return {
    workerId: fixture.accepted.workerId,
    workerEpoch: fixture.accepted.workerEpoch,
    deliveryId: fixture.accepted.deliveryId,
    generation: fixture.accepted.generation,
    reservationToken: fixture.accepted.reservationToken,
    result: loggedExportFailureFixture(fixture.accepted.request),
  };
}

function loggedExportFailureFixture(
  request: ExportRequest,
): LoggedExportFailureResult {
  return {
    schemaVersion: 1,
    requestId: request.id,
    jobId: request.jobId,
    projectId: request.projectId!,
    clipId: request.clipId!,
    error: {
      code: "export_source_provider_unconfigured",
      message: "Configure an authorized source provider before retrying.",
    },
    attempt: 0,
    sourceCleanup: { lifecycle: "not_started" },
  };
}

function loggedExportSuccessFixture(
  request: ExportRequest,
  validatedAt: string,
): LoggedExportSuccessResult {
  const packageIdentity = `clip-${request.id}`;
  const sourceAttempt = 1;
  const artifact = (
    role:
      | "clip_metadata_json"
      | "english_srt"
      | "manifest_json"
      | "original_srt"
      | "thumbnail_jpg"
      | "video_mp4",
    digit: string,
  ) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: digit.repeat(64),
    sourceAttempt,
    validatedAt,
  });
  return {
    schemaVersion: 1,
    requestId: request.id,
    jobId: request.jobId,
    projectId: request.projectId!,
    clipId: request.clipId!,
    sourceLanguageClass: request.sourceLanguageClass,
    resolvedExportBounds: {
      startMs: request.selection.exportStartMs,
      endMs: request.selection.exportEndMs,
      sourceAttempt,
      resolvedAt: validatedAt,
    },
    renderedMediaProvenance: {
      durationMs:
        request.selection.exportEndMs - request.selection.exportStartMs,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: sha256Fingerprint(
        request.resolvedSettingsSnapshot!.settings,
      ),
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
          request.selection.exportEndMs - request.selection.exportStartMs,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt,
      validatedAt,
    },
    thumbnailProvenance: {
      extractionTimeMs: Math.floor(
        (request.selection.exportEndMs - request.selection.exportStartMs) / 2,
      ),
      width: 640,
      height: 360,
      sourceAttempt,
      validatedAt,
    },
    ...(request.sourceLanguageClass === "confirmed_english"
      ? {
          englishSubtitleProvenance: {
            trackId:
              request.subtitleTracks?.english.trackId ??
              request.selection.trackId,
            trackVersion:
              request.subtitleTracks?.english.trackVersion ??
              request.selection.transcriptVersion,
            cueCount: 1,
            byteSize: 64,
            contentSha256: "e".repeat(64),
            startMs: 0,
            endMs: request.selection.transcriptEndMs,
            sourceAttempt,
            validatedAt,
          },
          artifacts: [
            artifact("clip_metadata_json", "1"),
            artifact("english_srt", "2"),
            artifact("manifest_json", "3"),
            artifact("thumbnail_jpg", "4"),
            artifact("video_mp4", "5"),
          ],
        }
      : {
          subtitleSidecars: [
            {
              role: "english" as const,
              language: "en",
              trackId: request.subtitleTracks!.english.trackId,
              trackVersion: request.subtitleTracks!.english.trackVersion,
              cueCount: 1,
              byteSize: 64,
              contentSha256: "e".repeat(64),
              startMs: 0,
              endMs: request.selection.transcriptEndMs,
              sourceAttempt,
              validatedAt,
            },
            {
              role: "original" as const,
              language: "es",
              trackId: request.subtitleTracks!.original.trackId,
              trackVersion: request.subtitleTracks!.original.trackVersion,
              cueCount: 1,
              byteSize: 64,
              contentSha256: "d".repeat(64),
              startMs: 0,
              endMs: request.selection.transcriptEndMs,
              sourceAttempt,
              validatedAt,
            },
          ],
          artifacts: [
            artifact("clip_metadata_json", "1"),
            artifact("english_srt", "2"),
            artifact("manifest_json", "3"),
            artifact("original_srt", "4"),
            artifact("thumbnail_jpg", "5"),
            artifact("video_mp4", "6"),
          ],
        }),
  };
}
