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

  it("keeps a queued export's resolved settings stable after its project default advances", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const owner = fixtureActor("queued-export-settings-owner");
    await catalog.registerUser(owner, "Queued export settings owner");
    const project = await catalog.createProject(owner, {
      name: "Queued export settings project",
    });
    const [clip] = await createBatchClips(catalog, owner, project.id, 1);
    const preset = await catalog.createProjectExportPreset(owner, project.id, {
      idempotencyKey: "queued-export-preset-v1",
      name: "Queued export default",
      description: "Initial default",
      settings: editingSettings,
    });
    await catalog.setProjectExportPresetDefault(owner, project.id, {
      idempotencyKey: "queued-export-default-v1",
      expectedEntityVersion: 0,
      presetId: preset.id,
      presetVersion: 1,
    });
    const selection = { base: "context_default" as const, overrides: {} };
    const previewV1 = await catalog.previewProjectExportSettings(
      owner,
      project.id,
      { sourceLanguageClass: "confirmed_english", selection },
    );
    const command = {
      idempotencyKey: "queued-export-request-v1",
      sourceLanguageClass: "confirmed_english" as const,
      settingsSelection: selection,
      expectedResolutionFingerprint: previewV1.snapshot.resolutionFingerprint!,
    };
    const queued = await catalog.createClipExport(
      owner,
      project.id,
      clip!.id,
      command,
    );
    const originalSnapshot = queued.resolvedSettingsSnapshot!;
    expect(queued).toMatchObject({ state: "queued" });
    expect(originalSnapshot).toMatchObject({
      context: "logged",
      base: "context_default",
      contextDefault: {
        presetId: preset.id,
        presetVersion: 1,
        settings: editingSettings,
      },
      resolutionFingerprint: previewV1.snapshot.resolutionFingerprint,
    });

    const revised = await catalog.reviseProjectExportPreset(owner, project.id, {
      idempotencyKey: "queued-export-preset-v2",
      presetId: preset.id,
      expectedEntityVersion: 1,
      name: "Queued export default",
      description: "Revised default",
      settings: { ...editingSettings, maxWidth: 1_280 },
    });
    await catalog.setProjectExportPresetDefault(owner, project.id, {
      idempotencyKey: "queued-export-default-v2",
      expectedEntityVersion: 1,
      presetId: preset.id,
      presetVersion: revised.currentVersion,
    });
    const previewV2 = await catalog.previewProjectExportSettings(
      owner,
      project.id,
      { sourceLanguageClass: "confirmed_english", selection },
    );
    expect(previewV2.snapshot).toMatchObject({
      contextDefault: {
        presetId: preset.id,
        presetVersion: 2,
        settings: { maxWidth: 1_280 },
      },
    });
    expect(previewV2.snapshot.resolutionFingerprint).not.toBe(
      originalSnapshot.resolutionFingerprint,
    );

    const replayed = await catalog.createClipExport(
      owner,
      project.id,
      clip!.id,
      { ...command, requestOrigin: "authoring_build" },
    );
    expect(replayed).toEqual(queued);
    expect(replayed.requestOrigin).toBe("selection_action");
    expect(replayed.resolvedSettingsSnapshot).toEqual(originalSnapshot);
    expect(replayed.resolvedSettingsSnapshot!.resolutionFingerprint).toBe(
      originalSnapshot.resolutionFingerprint,
    );
    const persisted = await database.query<{
      request_snapshot: ExportRequest["resolvedSettingsSnapshot"];
      job_snapshot: ExportRequest["resolvedSettingsSnapshot"];
    }>(
      `SELECT er.resolved_settings_snapshot AS request_snapshot,
              j.payload->'resolvedSettingsSnapshot' AS job_snapshot
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       WHERE er.id = $1`,
      [queued.id],
    );
    expect(persisted.rows[0]!.request_snapshot).toEqual(originalSnapshot);
    expect(persisted.rows[0]!.job_snapshot).toEqual(originalSnapshot);
    expect(persisted.rows[0]!.job_snapshot!.resolutionFingerprint).toBe(
      originalSnapshot.resolutionFingerprint,
    );
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

  it("derives bounded authorized artifact history from immutable M5 success IDs", async () => {
    const clock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const first = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    clock.now = new Date("2026-08-20T12:00:01.000Z");
    const secondRequest = await createLoggedExportFromClip(
      fixture.catalog,
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.clipId!,
      "clip-library-reexport",
      "h264",
      "confirmed_english",
      "clip_library",
    );
    const reserved = (
      await fixture.catalog.claimLoggedExportDelivery(fixture.owner, {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
      })
    ).delivery!;
    const accepted = await fixture.catalog.acceptLoggedExportDelivery(
      fixture.owner,
      {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
        deliveryId: reserved.deliveryId,
        generation: reserved.generation,
        reservationToken: reserved.reservationToken,
      },
    );
    const second = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      {
        workerId: accepted.workerId,
        workerEpoch: accepted.workerEpoch,
        deliveryId: accepted.deliveryId,
        generation: accepted.generation,
        reservationToken: accepted.reservationToken,
        result: loggedExportSuccessFixture(
          secondRequest,
          clock.now.toISOString(),
        ),
      },
    );

    const firstPage = await fixture.catalog.listArtifactVersionHistory(
      fixture.owner,
      secondRequest.projectId!,
      secondRequest.clipId!,
      { limit: 1 },
    );
    expect(firstPage).toMatchObject({
      nextCursor: second.id,
      versions: [
        {
          artifactVersionId: second.id,
          requestId: secondRequest.id,
          requestOrigin: "clip_library",
          manifest: { schemaVersion: "unknown" },
        },
      ],
    });
    const secondPage = await fixture.catalog.listArtifactVersionHistory(
      fixture.owner,
      secondRequest.projectId!,
      secondRequest.clipId!,
      { limit: 1, cursor: firstPage.nextCursor },
    );
    expect(secondPage).toMatchObject({
      versions: [
        {
          artifactVersionId: first.id,
          requestId: fixture.accepted.request.id,
          requestOrigin: "selection_action",
        },
      ],
    });
    expect(secondPage.nextCursor).toBeUndefined();
    expect(
      await fixture.catalog.getArtifactVersion(
        fixture.owner,
        secondRequest.projectId!,
        secondRequest.clipId!,
        second.id,
      ),
    ).toMatchObject({
      artifactVersionId: second.id,
      preset: secondRequest.preset,
      resolvedExportBounds: second.result.resolvedExportBounds,
      renderedMediaProvenance: second.result.renderedMediaProvenance,
      thumbnailProvenance: second.result.thumbnailProvenance,
    });
    expect(
      JSON.stringify([...firstPage.versions, ...secondPage.versions]),
    ).not.toMatch(/localPath|filename|reservationToken|notes|tags/u);

    const outsider = fixtureActor("artifact-history-outsider");
    await fixture.catalog.registerUser(outsider, "History outsider");
    await expect(
      fixture.catalog.listArtifactVersionHistory(
        outsider,
        secondRequest.projectId!,
        secondRequest.clipId!,
        { limit: 25 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      fixture.catalog.getArtifactVersion(
        outsider,
        secondRequest.projectId!,
        secondRequest.clipId!,
        second.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lists an authorized bounded Clip Library with stable cursors and separate history", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const projectId = fixture.accepted.request.projectId!;
    const clipId = fixture.accepted.request.clipId!;
    const clip = await fixture.catalog.getClipCandidate(
      fixture.owner,
      projectId,
      clipId,
    );
    await fixture.catalog.updateClipCandidate(
      fixture.owner,
      projectId,
      clipId,
      {
        expectedVersion: clip.version,
        notes: "Needle quotation for the library at Cafe\u0301",
        tags: ["Featured Quote"],
      },
    );
    const searched = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 25, query: "needle quotation", completed: "no" },
    );
    expect(searched.entries).toHaveLength(1);
    expect(searched.entries[0]).toMatchObject({
      clip: { id: clipId, tags: ["Featured Quote"] },
      currentLeaves: [
        {
          requestId: fixture.accepted.request.id,
          requestOrigin: "selection_action",
        },
      ],
      completedVersionCount: 0,
      recentArtifactVersions: [],
    });
    expect(
      (
        await fixture.catalog.listClipLibrary(fixture.owner, projectId, {
          limit: 25,
          query: "Café",
          completed: "any",
        })
      ).entries.map((entry) => entry.clip.id),
    ).toEqual([clipId]);
    expect(
      (
        await fixture.catalog.listClipLibrary(fixture.owner, projectId, {
          limit: 25,
          tag: "featured quote",
          completed: "any",
        })
      ).entries.map((entry) => entry.clip.id),
    ).toEqual([clipId]);

    const success = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    const completed = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 25, completed: "yes" },
    );
    expect(completed.entries[0]).toMatchObject({
      completedVersionCount: 1,
      recentArtifactVersions: [
        {
          artifactVersionId: success.id,
          requestId: fixture.accepted.request.id,
        },
      ],
    });
    expect(JSON.stringify(completed)).not.toMatch(
      /localPath|filename|absolutePath|reservationToken/u,
    );
    const beforeConcurrentUpdate = completed.entries[0]!.clip;
    const [coherentRead, afterConcurrentUpdate] = await Promise.all([
      fixture.catalog.listClipLibrary(fixture.owner, projectId, {
        limit: 25,
        completed: "yes",
      }),
      fixture.catalog.updateClipCandidate(fixture.owner, projectId, clipId, {
        expectedVersion: beforeConcurrentUpdate.version,
        notes: "Concurrent updated note",
        tags: ["Concurrent Tag"],
      }),
    ]);
    const coherentClip = coherentRead.entries[0]!.clip;
    if (coherentClip.version === beforeConcurrentUpdate.version) {
      expect(coherentClip).toMatchObject({
        notes: beforeConcurrentUpdate.notes,
        tags: beforeConcurrentUpdate.tags,
      });
      expect(coherentRead.syncCursor).toBe(completed.syncCursor);
    } else {
      expect(coherentClip).toMatchObject({
        version: afterConcurrentUpdate.version,
        notes: afterConcurrentUpdate.notes,
        tags: afterConcurrentUpdate.tags,
      });
      expect(BigInt(coherentRead.syncCursor)).toBeGreaterThan(
        BigInt(completed.syncCursor),
      );
    }

    await createBatchClips(fixture.catalog, fixture.owner, projectId, 2);
    const firstPage = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 2, completed: "any" },
    );
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 2, cursor: firstPage.nextCursor, completed: "any" },
    );
    expect(secondPage.entries).toHaveLength(1);
    expect(
      secondPage.entries.some((entry) =>
        firstPage.entries.some(
          (firstEntry) => firstEntry.clip.id === entry.clip.id,
        ),
      ),
    ).toBe(false);
    await expect(
      fixture.catalog.listClipLibrary(fixture.owner, projectId, {
        limit: 2,
        cursor: firstPage.nextCursor,
        query: "different-filter",
        completed: "any",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const outsider = fixtureActor("clip-library-outsider");
    await fixture.catalog.registerUser(outsider, "Clip Library outsider");
    await expect(
      fixture.catalog.listClipLibrary(outsider, projectId, {
        limit: 25,
        completed: "any",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("reads a parseable legacy success with unknown origin and manifest schema", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    const legacyJobId = randomUUID();
    const legacyRequestId = randomUUID();
    const legacyDeliveryId = randomUUID();
    const legacySuccessId = randomUUID();
    const completedAt = "2026-08-20T12:00:01.000Z";
    await fixture.database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, attempt, payload,
          created_at, updated_at)
       SELECT $1, project_id, kind, 'complete', $2, attempt, payload, $3, $3
       FROM jobs WHERE id = $4`,
      [
        legacyJobId,
        `legacy-history:${legacyRequestId}`,
        completedAt,
        fixture.accepted.request.jobId,
      ],
    );
    await fixture.database.query(
      `INSERT INTO export_requests
         (id, job_id, clip_id, project_id, mode, video_snapshot,
          selection_snapshot, source_language_class, subtitle_tracks_snapshot,
          preset_snapshot, resolved_settings_snapshot, requested_by,
          retry_of_request_id, retry_ordinal, retry_idempotency_key,
          batch_item_id, request_origin, created_at, updated_at)
       SELECT $1, $2, clip_id, project_id, mode, video_snapshot,
              selection_snapshot, source_language_class,
              subtitle_tracks_snapshot, preset_snapshot,
              resolved_settings_snapshot, requested_by,
              NULL, 0, NULL, NULL, NULL, $3, $3
       FROM export_requests WHERE id = $4`,
      [legacyRequestId, legacyJobId, completedAt, fixture.accepted.request.id],
    );
    await fixture.database.query(
      `INSERT INTO logged_export_deliveries
         (id, export_request_id, generation, reservation_token, worker_id,
          worker_epoch, reserved_at, reservation_expires_at, accepted_at,
          created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $6, $6, $6)`,
      [
        legacyDeliveryId,
        legacyRequestId,
        randomUUID(),
        fixture.worker.workerId,
        fixture.worker.epoch,
        completedAt,
        "2026-08-20T12:00:31.000Z",
      ],
    );
    const legacyRequest: ExportRequest = {
      ...fixture.accepted.request,
      id: legacyRequestId,
      jobId: legacyJobId,
      requestOrigin: undefined,
      createdAt: completedAt,
      updatedAt: completedAt,
    };
    const legacyResult = loggedExportSuccessFixture(legacyRequest, completedAt);
    await fixture.database.query(
      `INSERT INTO logged_export_success_results
         (id, export_request_id, delivery_id, delivery_generation, worker_id,
          worker_epoch, result_schema_version, result_json,
          result_fingerprint, reconciled_at)
       VALUES ($1, $2, $3, 1, $4, $5, 1, $6, $7, $8)`,
      [
        legacySuccessId,
        legacyRequestId,
        legacyDeliveryId,
        fixture.worker.workerId,
        fixture.worker.epoch,
        JSON.stringify(legacyResult),
        sha256Fingerprint(legacyResult),
        completedAt,
      ],
    );

    const history = await fixture.catalog.listArtifactVersionHistory(
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.clipId!,
      { limit: 25 },
    );
    expect(history.versions[0]).toMatchObject({
      artifactVersionId: legacySuccessId,
      requestId: legacyRequestId,
      requestOrigin: null,
      manifest: { schemaVersion: "unknown" },
    });
    expect(JSON.stringify(history.versions[0])).not.toMatch(
      /localPath|filename|reservationToken|workerId|workerEpoch/u,
    );
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

  it("creates one immutable retry lineage, replays concurrently, and advances only through the newest failed child", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.reconcileLoggedExportFailure(
      fixture.owner,
      reconcileFailureCommand(fixture),
    );
    const parentId = fixture.accepted.request.id;
    const projectId = fixture.accepted.request.projectId!;
    const clipId = fixture.accepted.request.clipId!;
    const before = await fixture.database.query<Record<string, unknown>>(
      `SELECT er.*, j.state AS job_state, j.payload AS job_payload,
              failure.result_json AS failure_result,
              delivery.reservation_token, delivery.worker_id,
              delivery.worker_epoch, delivery.accepted_at
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       JOIN logged_export_failure_results failure
         ON failure.export_request_id = er.id
       JOIN logged_export_deliveries delivery
         ON delivery.id = failure.delivery_id
       WHERE er.id = $1`,
      [parentId],
    );
    const versionBefore = Number(
      (
        await fixture.database.query<{ version: number }>(
          "SELECT version FROM clip_candidates WHERE id = $1",
          [clipId],
        )
      ).rows[0]!.version,
    );
    const command = { idempotencyKey: "retry-terminal-failure-1" };
    const concurrent = await Promise.all([
      fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        parentId,
        command,
      ),
      fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        parentId,
        command,
      ),
    ]);
    expect(concurrent[1]).toEqual(concurrent[0]);
    expect(await countOrphanExportJobs(fixture.database, projectId)).toBe(0);
    const child = concurrent[0]!.request;
    expect(child).toMatchObject({
      state: "queued",
      retryOfRequestId: parentId,
      retryOrdinal: 1,
      requestOrigin: fixture.accepted.request.requestOrigin,
      projectId,
      clipId,
    });
    expect(child.id).not.toBe(parentId);
    expect(child.jobId).not.toBe(fixture.accepted.request.jobId);
    expect(retrySnapshot(child)).toEqual(
      retrySnapshot(fixture.accepted.request),
    );
    expect(
      await fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        parentId,
        command,
      ),
    ).toEqual(concurrent[0]);
    await expect(
      fixture.catalog.retryLoggedExport(fixture.owner, projectId, parentId, {
        idempotencyKey: "branching-retry-forbidden",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const after = await fixture.database.query<Record<string, unknown>>(
      `SELECT er.*, j.state AS job_state, j.payload AS job_payload,
              failure.result_json AS failure_result,
              delivery.reservation_token, delivery.worker_id,
              delivery.worker_epoch, delivery.accepted_at
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       JOIN logged_export_failure_results failure
         ON failure.export_request_id = er.id
       JOIN logged_export_deliveries delivery
         ON delivery.id = failure.delivery_id
       WHERE er.id = $1`,
      [parentId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM export_requests
           WHERE retry_of_request_id = $1`,
          [parentId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE entity_id = $1
             AND event_type = 'clip_candidate.export_retried'`,
          [clipId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      Number(
        (
          await fixture.database.query<{ version: number }>(
            "SELECT version FROM clip_candidates WHERE id = $1",
            [clipId],
          )
        ).rows[0]!.version,
      ),
    ).toBe(versionBefore + 1);
    const event = (
      await fixture.database.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM sync_events
         WHERE entity_id = $1
           AND event_type = 'clip_candidate.export_retried'`,
        [clipId],
      )
    ).rows[0]!.payload;
    expect(event).toEqual({
      clipId,
      parentExportRequestId: parentId,
      exportRequestId: child.id,
      jobId: child.jobId,
      retryOrdinal: 1,
    });
    expect(JSON.stringify(event)).not.toMatch(
      /reservation|worker|failure|error|token|path|url/i,
    );
    expect(
      (
        await fixture.database.query<{ snapshots_match: boolean }>(
          `SELECT child.project_id = parent.project_id
                    AND child.clip_id = parent.clip_id
                    AND child.mode = parent.mode
                    AND child.video_snapshot = parent.video_snapshot
                    AND child.selection_snapshot = parent.selection_snapshot
                    AND child.source_language_class = parent.source_language_class
                    AND child.subtitle_tracks_snapshot IS NOT DISTINCT FROM parent.subtitle_tracks_snapshot
                    AND child.preset_snapshot = parent.preset_snapshot
                    AND child.resolved_settings_snapshot = parent.resolved_settings_snapshot
                    AS snapshots_match
           FROM export_requests child
           JOIN export_requests parent ON parent.id = child.retry_of_request_id
           WHERE child.id = $1`,
          [child.id],
        )
      ).rows[0]!.snapshots_match,
    ).toBe(true);
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM logged_export_failure_results
           WHERE export_request_id = $1`,
          [parentId],
        )
      ).rows[0]!.count,
    ).toBe("1");

    const reservedChild = (
      await fixture.catalog.claimLoggedExportDelivery(fixture.owner, {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
      })
    ).delivery!;
    expect(reservedChild.request).toEqual(child);
    expect(JSON.stringify(reservedChild)).not.toContain(
      fixture.accepted.reservationToken,
    );
    const acceptedChild = await fixture.catalog.acceptLoggedExportDelivery(
      fixture.owner,
      {
        workerId: reservedChild.workerId,
        workerEpoch: reservedChild.workerEpoch,
        deliveryId: reservedChild.deliveryId,
        generation: reservedChild.generation,
        reservationToken: reservedChild.reservationToken,
      },
    );
    await fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
      workerId: acceptedChild.workerId,
      workerEpoch: acceptedChild.workerEpoch,
      deliveryId: acceptedChild.deliveryId,
      generation: acceptedChild.generation,
      reservationToken: acceptedChild.reservationToken,
      result: loggedExportFailureFixture(acceptedChild.request),
    });
    const grandchild = (
      await fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        child.id,
        { idempotencyKey: "retry-terminal-failure-2" },
      )
    ).request;
    expect(grandchild).toMatchObject({
      retryOfRequestId: child.id,
      retryOrdinal: 2,
      state: "queued",
    });
    expect(retrySnapshot(grandchild)).toEqual(retrySnapshot(child));
    const childPayload = (
      await fixture.database.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM jobs WHERE id = $1",
        [child.jobId],
      )
    ).rows[0]!.payload;
    expect(childPayload).toMatchObject({
      exportRequestId: child.id,
      retryOfRequestId: parentId,
      retryOrdinal: 1,
    });
    expect(childPayload).not.toHaveProperty("projectId");
    expect(JSON.stringify(childPayload)).not.toContain(
      reconcileFailureCommand(fixture).result.error.message,
    );
    expect(JSON.stringify(childPayload)).not.toContain(
      fixture.accepted.reservationToken,
    );
    expect(await countOrphanExportJobs(fixture.database, projectId)).toBe(0);
  });

  it("serializes divergent concurrent retries without leaving an orphan export job", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.reconcileLoggedExportFailure(
      fixture.owner,
      reconcileFailureCommand(fixture),
    );
    const parentId = fixture.accepted.request.id;
    const projectId = fixture.accepted.request.projectId!;

    const results = await Promise.allSettled([
      fixture.catalog.retryLoggedExport(fixture.owner, projectId, parentId, {
        idempotencyKey: "divergent-concurrent-a",
      }),
      fixture.catalog.retryLoggedExport(fixture.owner, projectId, parentId, {
        idempotencyKey: "divergent-concurrent-b",
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM export_requests
           WHERE retry_of_request_id = $1`,
          [parentId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(await countOrphanExportJobs(fixture.database, projectId)).toBe(0);
  });

  it("authorizes retry writers and rejects ineligible or inconsistent parents without mutation", async () => {
    const terminal = await createAcceptedLoggedExportResultFixture();
    await terminal.catalog.reconcileLoggedExportFailure(
      terminal.owner,
      reconcileFailureCommand(terminal),
    );
    const projectId = terminal.accepted.request.projectId!;
    const viewer = fixtureActor("retry-viewer");
    const outsider = fixtureActor("retry-outsider");
    await terminal.catalog.registerUser(viewer, "Retry viewer");
    await terminal.catalog.registerUser(outsider, "Retry outsider");
    await terminal.catalog.addMember(
      terminal.owner,
      projectId,
      viewer.userId,
      "viewer",
    );
    for (const actor of [viewer, outsider]) {
      await expect(
        terminal.catalog.retryLoggedExport(
          actor,
          projectId,
          terminal.accepted.request.id,
          { idempotencyKey: `forbidden-${actor.userId}` },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    await terminal.database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, terminal.owner.userId],
    );
    await expect(
      terminal.catalog.retryLoggedExport(
        terminal.owner,
        projectId,
        terminal.accepted.request.id,
        { idempotencyKey: "lost-membership" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await terminal.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM export_requests WHERE retry_of_request_id IS NOT NULL",
        )
      ).rows[0]!.count,
    ).toBe("0");
    await terminal.database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, version, created_at, updated_at)
       VALUES ($1, $2, 'owner', 1, now(), now())`,
      [projectId, terminal.owner.userId],
    );
    for (const state of [
      "queued",
      "claimed",
      "processing",
      "needs_user_action",
      "complete",
      "canceled",
    ]) {
      await terminal.database.query(
        "UPDATE jobs SET state = $1 WHERE id = $2",
        [state, terminal.accepted.request.jobId],
      );
      await expect(
        terminal.catalog.retryLoggedExport(
          terminal.owner,
          projectId,
          terminal.accepted.request.id,
          { idempotencyKey: `ineligible-job-${state}` },
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    await terminal.database.query(
      "UPDATE jobs SET state = 'failed' WHERE id = $1",
      [terminal.accepted.request.jobId],
    );
    for (const state of ["not_requested", "queued", "processing", "complete"]) {
      await terminal.database.query(
        "UPDATE clip_candidates SET export_status = $1 WHERE id = $2",
        [state, terminal.accepted.request.clipId],
      );
      await expect(
        terminal.catalog.retryLoggedExport(
          terminal.owner,
          projectId,
          terminal.accepted.request.id,
          { idempotencyKey: `ineligible-clip-${state}` },
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(await countOrphanExportJobs(terminal.database, projectId)).toBe(0);

    const inconsistent = await createAcceptedLoggedExportResultFixture();
    await inconsistent.catalog.reconcileLoggedExportFailure(
      inconsistent.owner,
      reconcileFailureCommand(inconsistent),
    );
    await inconsistent.database.query(
      `UPDATE jobs SET payload = payload || '{"unexpected":"mutation"}'::jsonb
       WHERE id = $1`,
      [inconsistent.accepted.request.jobId],
    );
    await expect(
      inconsistent.catalog.retryLoggedExport(
        inconsistent.owner,
        inconsistent.accepted.request.projectId!,
        inconsistent.accepted.request.id,
        { idempotencyKey: "inconsistent-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const queued = await createAcceptedLoggedExportResultFixture();
    await expect(
      queued.catalog.retryLoggedExport(
        queued.owner,
        queued.accepted.request.projectId!,
        queued.accepted.request.id,
        { idempotencyKey: "queued-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const successful = await createAcceptedLoggedExportResultFixture();
    await successful.catalog.reconcileLoggedExportSuccess(
      successful.owner,
      reconcileSuccessCommand(successful),
    );
    await expect(
      successful.catalog.retryLoggedExport(
        successful.owner,
        successful.accepted.request.projectId!,
        successful.accepted.request.id,
        { idempotencyKey: "successful-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const missingFailure = await createAcceptedLoggedExportResultFixture();
    await missingFailure.database.query(
      "UPDATE jobs SET state = 'canceled' WHERE id = $1",
      [missingFailure.accepted.request.jobId],
    );
    await missingFailure.database.query(
      "UPDATE clip_candidates SET export_status = 'failed' WHERE id = $1",
      [missingFailure.accepted.request.clipId],
    );
    await expect(
      missingFailure.catalog.retryLoggedExport(
        missingFailure.owner,
        missingFailure.accepted.request.projectId!,
        missingFailure.accepted.request.id,
        { idempotencyKey: "canceled-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  }, 30_000);

  it("cancels queued unaccepted work atomically and excludes it from delivery", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-21T16:00:00.000Z"),
    );
    const owner = fixtureActor("queued-cancel-owner");
    await catalog.registerUser(owner, "Queued cancel owner");
    const fixture = await createLoggedExportFixture(
      catalog,
      owner,
      "queued-cancel",
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
    const viewer = fixtureActor("queued-cancel-viewer");
    const outsider = fixtureActor("queued-cancel-outsider");
    await catalog.registerUser(viewer, "Queued cancel viewer");
    await catalog.registerUser(outsider, "Queued cancel outsider");
    await catalog.addMember(owner, fixture.projectId, viewer.userId, "viewer");
    for (const actor of [viewer, outsider]) {
      await expect(
        catalog.cancelLoggedExport(
          actor,
          fixture.projectId,
          fixture.request.id,
          { idempotencyKey: `forbidden-${actor.userId}` },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    const canceled = await catalog.cancelLoggedExport(
      owner,
      fixture.projectId,
      fixture.request.id,
      { idempotencyKey: "cancel-queued-1" },
    );
    expect(canceled).toMatchObject({
      outcome: "canceled",
      request: { state: "canceled" },
    });
    expect(
      await catalog.cancelLoggedExport(
        owner,
        fixture.projectId,
        fixture.request.id,
        { idempotencyKey: "cancel-queued-1" },
      ),
    ).toEqual(canceled);
    const row = await database.query<Record<string, unknown>>(
      "SELECT * FROM logged_export_canceled_results WHERE export_request_id = $1",
      [fixture.request.id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.delivery_id).toBeNull();
    await expect(
      catalog.acceptLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: worker.epoch,
        deliveryId: reserved.deliveryId,
        generation: reserved.generation,
        reservationToken: reserved.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(JSON.stringify(row.rows[0])).not.toMatch(
      /reservation_token|lease_token|owner_user_id|source_identity|path|url/i,
    );
  });

  it("starts one exact execution, observes cancel intent, and reconciles cancellation exclusively", async () => {
    const clock = { now: new Date("2026-08-21T17:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const credential = {
      workerId: fixture.accepted.workerId,
      workerEpoch: fixture.accepted.workerEpoch,
      deliveryId: fixture.accepted.deliveryId,
      generation: fixture.accepted.generation,
      reservationToken: fixture.accepted.reservationToken,
    };
    const started = await fixture.catalog.startLoggedExportExecution(
      fixture.owner,
      credential,
    );
    expect(started).toMatchObject({
      status: "started",
      execution: { attempt: 1, requestId: fixture.accepted.request.id },
    });
    if (started.status !== "started") throw new Error("execution not started");
    expect(
      await fixture.catalog.startLoggedExportExecution(
        fixture.owner,
        credential,
      ),
    ).toMatchObject({
      status: "started",
      execution: {
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
      },
    });
    const cancel = await fixture.catalog.cancelLoggedExport(
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.id,
      { idempotencyKey: "cancel-executing-1" },
    );
    expect(cancel.outcome).toBe("cancel_requested");
    expect(
      await fixture.catalog.startLoggedExportExecution(
        fixture.owner,
        credential,
      ),
    ).toMatchObject({
      status: "started",
      execution: {
        executionId: started.execution.executionId,
        cancelRequestedAt: cancel.cancelRequestedAt,
      },
    });
    await expect(
      fixture.catalog.heartbeatLoggedExportExecution(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const heartbeat = await fixture.catalog.heartbeatLoggedExportExecution(
      fixture.owner,
      {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: started.execution.leaseToken,
        progress: {
          schemaVersion: 1,
          executionId: started.execution.executionId,
          requestId: fixture.accepted.request.id,
          attempt: started.execution.attempt,
          sequence: 1,
          stage: "rendering",
          basisPoints: 3_500,
          updatedAt: clock.now.toISOString(),
        },
      },
    );
    expect(heartbeat.execution.cancelRequestedAt).toBe(
      cancel.cancelRequestedAt,
    );
    expect(heartbeat.progress).toMatchObject({
      sequence: 1,
      stage: "rendering",
      basisPoints: 3_500,
    });
    expect(
      await fixture.catalog.getLoggedExportProgress(
        fixture.owner,
        fixture.accepted.request.projectId!,
        fixture.accepted.request.id,
      ),
    ).toMatchObject({
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      state: "processing",
      progress: { executionId: started.execution.executionId, sequence: 1 },
    });
    expect(
      await fixture.catalog.startLoggedExportExecution(
        fixture.owner,
        credential,
      ),
    ).toMatchObject({
      status: "started",
      progress: { executionId: started.execution.executionId, sequence: 1 },
    });
    await expect(
      fixture.catalog.heartbeatLoggedExportExecution(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: started.execution.leaseToken,
        progress: {
          ...heartbeat.progress!,
          sequence: 2,
          stage: "acquiring_source",
          basisPoints: 3_600,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const outsider = fixtureActor("progress-outsider");
    await fixture.catalog.registerUser(outsider, "Progress outsider");
    await expect(
      fixture.catalog.getLoggedExportProgress(
        outsider,
        fixture.accepted.request.projectId!,
        fixture.accepted.request.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const result = {
      schemaVersion: 1 as const,
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      projectId: fixture.accepted.request.projectId!,
      clipId: fixture.accepted.request.clipId!,
      reason: "user_requested" as const,
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" as const },
      executionId: started.execution.executionId,
      executionAttempt: started.execution.attempt,
    };
    const reconciled = await fixture.catalog.reconcileLoggedExportCanceled(
      fixture.owner,
      {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result,
      },
    );
    expect(reconciled.result).toEqual(result);
    expect(
      await fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result,
      }),
    ).toEqual(reconciled);
    await expect(
      fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result: { ...result, reason: "execution_lease_lost" },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        reconcileSuccessCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(
        fixture.owner,
        reconcileFailureCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await fixture.catalog.registerExportWorker(fixture.owner, {
      ...fixture.worker,
      epoch: fixture.worker.epoch + 1,
    });
    await expect(
      fixture.catalog.startLoggedExportExecution(fixture.owner, credential),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("closes accepted but never-started work with attempt-zero evidence", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const credential = {
      workerId: fixture.accepted.workerId,
      workerEpoch: fixture.accepted.workerEpoch,
      deliveryId: fixture.accepted.deliveryId,
      generation: fixture.accepted.generation,
      reservationToken: fixture.accepted.reservationToken,
    };
    const cancel = await fixture.catalog.cancelLoggedExport(
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.id,
      { idempotencyKey: "cancel-accepted-not-started" },
    );
    expect(cancel.outcome).toBe("cancel_requested");
    await expect(
      fixture.catalog.startLoggedExportExecution(fixture.owner, credential),
    ).resolves.toEqual({
      status: "cancel_requested",
      cancelRequestedAt: cancel.cancelRequestedAt,
    });
    const result = {
      schemaVersion: 1 as const,
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      projectId: fixture.accepted.request.projectId!,
      clipId: fixture.accepted.request.clipId!,
      reason: "user_requested" as const,
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" as const },
    };
    await expect(
      fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        result,
      }),
    ).resolves.toMatchObject({ result });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_executions WHERE export_request_id = $1",
          [fixture.accepted.request.id],
        )
      ).rows[0]!.count,
    ).toBe("0");
  });

  it("expires stale execution ownership without allowing another attempt", async () => {
    const clock = { now: new Date("2026-08-21T18:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const credential = {
      workerId: fixture.accepted.workerId,
      workerEpoch: fixture.accepted.workerEpoch,
      deliveryId: fixture.accepted.deliveryId,
      generation: fixture.accepted.generation,
      reservationToken: fixture.accepted.reservationToken,
    };
    const started = await fixture.catalog.startLoggedExportExecution(
      fixture.owner,
      credential,
    );
    if (started.status !== "started") throw new Error("execution not started");
    clock.now = new Date("2026-08-21T18:00:31.000Z");
    await expect(
      fixture.catalog.heartbeatLoggedExportExecution(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: started.execution.leaseToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const result = {
      schemaVersion: 1 as const,
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      projectId: fixture.accepted.request.projectId!,
      clipId: fixture.accepted.request.clipId!,
      reason: "execution_lease_lost" as const,
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" as const },
      executionId: started.execution.executionId,
      executionAttempt: started.execution.attempt,
    };
    await expect(
      fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result,
      }),
    ).resolves.toMatchObject({ result });
    const executions = await fixture.database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM logged_export_executions WHERE export_request_id = $1",
      [fixture.accepted.request.id],
    );
    expect(executions.rows[0]!.count).toBe("1");
  });
});

describe("logged export batches", () => {
  it("creates and replays one atomic sanitized batch with isolated derived status", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-22T12:00:00.000Z"),
    );
    const owner = fixtureActor("batch-owner");
    await catalog.registerUser(owner, "Batch owner");
    const project = await catalog.createProject(owner, {
      name: "Batch project",
    });
    const clips = await createBatchClips(catalog, owner, project.id, 3);
    const command = await createBatchCommand(catalog, owner, project.id, clips);
    const [batch, concurrentReplay] = await Promise.all([
      catalog.createLoggedExportBatch(owner, project.id, command),
      catalog.createLoggedExportBatch(owner, project.id, command),
    ]);
    expect(concurrentReplay).toEqual(batch);
    expect(batch).toMatchObject({
      projectId: project.id,
      summary: {
        total: 3,
        queued: 3,
        complete: 0,
        failed: 0,
        canceled: 0,
        status: "active",
      },
    });
    expect(batch.items.map((item) => item.ordinal)).toEqual([0, 1, 2]);
    expect(new Set(batch.items.map((item) => item.id)).size).toBe(3);
    const membership = await database.query<{
      id: string;
      batch_item_id: string;
    }>("SELECT id, batch_item_id FROM export_requests ORDER BY id");
    expect(
      membership.rows.every((request) => Boolean(request.batch_item_id)),
    ).toBe(true);
    expect(
      await catalog.createLoggedExportBatch(owner, project.id, command),
    ).toEqual(batch);
    expect(
      await catalog.createLoggedExportBatch(owner, project.id, {
        ...command,
        items: command.items.map((item) => ({
          ...item,
          export: { ...item.export, requestOrigin: "authoring_build" },
        })),
      }),
    ).toEqual(batch);
    expect(
      (
        await database.query<{ request_origin: string }>(
          "SELECT request_origin FROM export_requests ORDER BY id",
        )
      ).rows.every(
        ({ request_origin }) => request_origin === "selection_action",
      ),
    ).toBe(true);
    await expect(
      catalog.createClipExport(owner, project.id, clips[0]!.id, {
        ...command.items[0]!.export,
        idempotencyKey: "second-export-for-batch-clip",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      catalog.createLoggedExportBatch(owner, project.id, {
        ...command,
        items: [...command.items].reverse(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await catalog.listLoggedExportBatches(owner, project.id)).toEqual({
      batches: [batch],
    });
    const outsider = fixtureActor("batch-outsider");
    await catalog.registerUser(outsider, "Batch outsider");
    await expect(
      catalog.getLoggedExportBatch(outsider, project.id, batch.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(JSON.stringify(batch)).not.toMatch(
      /reservation|leaseToken|workerId|sourceIdentity|artifactLocator|path|url|createdBy/i,
    );

    for (const [index, state] of ["complete", "failed", "canceled"].entries()) {
      await database.query("UPDATE jobs SET state = $1 WHERE id = $2", [
        state,
        batch.items[index]!.currentRequest.jobId,
      ]);
    }
    const mixed = await catalog.getLoggedExportBatch(
      owner,
      project.id,
      batch.id,
    );
    expect(mixed.summary).toMatchObject({
      complete: 1,
      failed: 1,
      canceled: 1,
      status: "mixed_terminal",
    });
    expect(mixed.items.map((item) => item.currentRequest.id)).toEqual(
      batch.items.map((item) => item.currentRequest.id),
    );
  });

  it("rolls back invalid siblings and keeps retry lineage on its batch item", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-22T13:00:00.000Z"),
    );
    const owner = fixtureActor("batch-retry-owner");
    await catalog.registerUser(owner, "Batch retry owner");
    const project = await catalog.createProject(owner, {
      name: "Batch retry project",
    });
    const clips = await createBatchClips(catalog, owner, project.id, 2);
    const command = await createBatchCommand(catalog, owner, project.id, clips);
    await expect(
      catalog.createLoggedExportBatch(owner, project.id, {
        ...command,
        idempotencyKey: "invalid-batch",
        items: [
          command.items[0]!,
          { ...command.items[1]!, clipId: randomUUID() },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_batches",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(await countOrphanExportJobs(database, project.id)).toBe(0);
    const batch = await catalog.createLoggedExportBatch(
      owner,
      project.id,
      command,
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
    expect(reserved.sourceGroup).toEqual({
      batchId: batch.id,
      batchItemId: reserved.request.batchItemId,
    });
    const accepted = await catalog.acceptLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: worker.epoch,
      deliveryId: reserved.deliveryId,
      generation: reserved.generation,
      reservationToken: reserved.reservationToken,
    });
    await catalog.reconcileLoggedExportFailure(owner, {
      workerId: accepted.workerId,
      workerEpoch: accepted.workerEpoch,
      deliveryId: accepted.deliveryId,
      generation: accepted.generation,
      reservationToken: accepted.reservationToken,
      result: loggedExportFailureFixture(accepted.request),
    });
    const retried = await catalog.retryLoggedExport(
      owner,
      project.id,
      accepted.request.id,
      { idempotencyKey: "batch-item-retry" },
    );
    const failedItem = batch.items.find(
      (item) => item.currentRequest.id === accepted.request.id,
    )!;
    expect(retried.request).toMatchObject({
      batchItemId: failedItem.id,
      retryOfRequestId: accepted.request.id,
      retryOrdinal: 1,
    });
    const afterRetry = await catalog.getLoggedExportBatch(
      owner,
      project.id,
      batch.id,
    );
    expect(
      afterRetry.items.find((item) => item.id === failedItem.id)!
        .currentRequest,
    ).toMatchObject({ id: retried.request.id, state: "queued" });
    expect(afterRetry.summary).toMatchObject({ queued: 2, status: "active" });
  });
});

function fixtureActor(name: string): AuthenticatedActor {
  return { userId: randomUUID(), externalSubject: `fixture:${name}` };
}

async function createBatchClips(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  projectId: string,
  count: number,
) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const trackId = randomUUID();
      return catalog.createClipCandidate(actor, projectId, {
        idempotencyKey: `batch-clip-${index}`,
        video: {
          youtubeVideoId: "M7lc1UVf-VE",
          canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
          title: `Batch fixture ${index}`,
        },
        selection: {
          trackId,
          transcriptVersion: 1,
          firstSegmentId: randomUUID(),
          lastSegmentId: randomUUID(),
          firstTokenId: randomUUID(),
          lastTokenId: randomUUID(),
          transcriptStartMs: 300 + index * 100,
          transcriptEndMs: 2_900 + index * 100,
          exportStartMs: index * 100,
          exportEndMs: 3_400 + index * 100,
          text: `Batch fixture selection ${index}`,
          timingPrecision: "word",
        },
        languageEvidence: {
          schemaVersion: 2,
          native: {
            role: "native",
            language: "en",
            text: `Batch fixture selection ${index}`,
            trackId,
            trackVersion: 1,
            timingPrecision: "word",
          },
          english: {
            role: "english",
            language: "en",
            text: `Batch fixture selection ${index}`,
            trackId,
            trackVersion: 1,
            timingPrecision: "word",
          },
        },
        notes: "",
        tags: [],
      });
    }),
  );
}

async function createBatchCommand(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  projectId: string,
  clips: Awaited<ReturnType<typeof createBatchClips>>,
) {
  const selection = {
    base: "application_default" as const,
    overrides: {},
  };
  const preview = await catalog.previewProjectExportSettings(actor, projectId, {
    sourceLanguageClass: "confirmed_english",
    selection,
  });
  return {
    idempotencyKey: "batch-create-1",
    items: clips.map((clip, index) => ({
      clipId: clip.id,
      export: {
        idempotencyKey: `batch-item-${index}`,
        sourceLanguageClass: "confirmed_english" as const,
        settingsSelection: selection,
        expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
      },
    })),
  };
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
  requestOrigin:
    | "selection_action"
    | "clip_library"
    | "authoring_build" = "selection_action",
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
    requestOrigin,
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

function retrySnapshot(request: ExportRequest) {
  return {
    projectId: request.projectId,
    clipId: request.clipId,
    video: request.video,
    selection: request.selection,
    sourceLanguageClass: request.sourceLanguageClass,
    subtitleTracks: request.subtitleTracks,
    preset: request.preset,
    resolvedSettingsSnapshot: request.resolvedSettingsSnapshot,
  };
}

async function countOrphanExportJobs(
  database: PGlite,
  projectId: string,
): Promise<number> {
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM jobs job
     LEFT JOIN export_requests request ON request.job_id = job.id
     WHERE job.project_id = $1 AND job.kind = 'export' AND request.id IS NULL`,
    [projectId],
  );
  return Number(result.rows[0]!.count);
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
