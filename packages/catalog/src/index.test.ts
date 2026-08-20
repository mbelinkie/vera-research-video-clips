import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthenticatedActor,
  TranscriptManifest,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  currentExportWorkerAdvertisement,
  exportWorkerAdvertisementFingerprint,
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
});

function fixtureActor(name: string): AuthenticatedActor {
  return { userId: randomUUID(), externalSubject: `fixture:${name}` };
}

async function createLoggedExportFixture(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  idempotencyKey: string,
  family: "h264" | "hevc" = "h264",
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
    sourceLanguageClass: "confirmed_english",
    selection,
  });
  return catalog.createClipExport(actor, projectId, clipId, {
    idempotencyKey,
    sourceLanguageClass: "confirmed_english",
    settingsSelection: selection,
    expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
  });
}
