import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ExportStorageSafetyReserveBytes,
  type ClipCandidate,
  type CreateClipExportRequest,
  type CreateLoggedExportBatchRequest,
  type ExportRequest,
  type LoggedExportBatch,
  type ExportSourceLanguageClass,
} from "@research-video/contracts";
import { resolveExportSettings } from "@research-video/export-settings";

import {
  ClipLibraryExportOperationError,
  ClipLibraryExportOperationService,
  createPostAcquisitionExportStorageGuard,
  estimateOutputPackageBytes,
} from "./export-storage-preflight.ts";

describe("Clip Library export storage preflight", () => {
  it("counts three clips from two sources, every output, active reserve, and the exact 2 GiB margin", async () => {
    const projectId = randomUUID();
    const clips = [
      clip(projectId, "source-a", 1),
      clip(projectId, "source-a", 2),
      clip(projectId, "source-b", 3),
    ];
    const activeReserve = 321_000_000;
    const service = serviceFixture(clips, {
      availableBytes: Number.MAX_SAFE_INTEGER,
      activeReserve,
    });
    const preflight = await service.prepare({
      projectId,
      authorization: "Bearer preflight-secret",
      request: {
        clipIds: clips.map((candidate) => candidate.id),
        settingsSelection: { base: "application_default", overrides: {} },
      },
    });

    expect(preflight).toMatchObject({
      uniqueSourceCount: 2,
      sourceSharingAssurance: "same_worker_profile_only",
      knownSourceBytes: 0,
      unknownSourceCount: 2,
      activeCheckpointReserveBytes: activeReserve,
      safetyReserveBytes: 2_147_483_648,
      decision: "confirmation_required",
    });
    expect(preflight.outputEstimatedBytes).toBe(
      preflight.items.reduce((sum, item) => sum + item.outputEstimatedBytes, 0),
    );
    expect(preflight.knownRequiredBytes).toBe(
      preflight.outputEstimatedBytes +
        preflight.promotionReserveBytes +
        activeReserve +
        ExportStorageSafetyReserveBytes,
    );
    expect(JSON.stringify(preflight)).not.toMatch(
      /preflight-secret|youtube\.com|source-a|source-b|localPath/u,
    );
  });

  it("blocks when the known floor misses by one and requires confirmation at equality for unknown sources", async () => {
    const projectId = randomUUID();
    const candidate = clip(projectId, "source-a", 1);
    const output = estimateOutputPackageBytes(
      candidate.selection.exportEndMs - candidate.selection.exportStartMs,
      preview("confirmed_english").snapshot.settings,
    );
    const knownFloor = output * 2 + ExportStorageSafetyReserveBytes;
    const insufficient = serviceFixture([candidate], {
      availableBytes: knownFloor - 1,
    });
    const exact = serviceFixture([candidate], { availableBytes: knownFloor });
    const request = {
      clipIds: [candidate.id],
      settingsSelection: {
        base: "application_default" as const,
        overrides: {},
      },
    };

    expect(
      (
        await insufficient.prepare({
          projectId,
          authorization: "Bearer test",
          request,
        })
      ).decision,
    ).toBe("insufficient");
    expect(
      (
        await exact.prepare({
          projectId,
          authorization: "Bearer test",
          request,
        })
      ).decision,
    ).toBe("confirmation_required");
  });

  it("preserves unknown and mixed native-language provenance", async () => {
    const projectId = randomUUID();
    const unknown = clip(projectId, "source-und", 1);
    const mixed = clip(projectId, "source-mul", 2);
    if (
      unknown.languageEvidence.schemaVersion !== 2 ||
      mixed.languageEvidence.schemaVersion !== 2
    ) {
      throw new Error("Expected v2 language evidence fixtures");
    }
    unknown.languageEvidence.native.language = "und";
    mixed.languageEvidence.native.language = "mul";
    const service = serviceFixture([unknown, mixed], {
      availableBytes: Number.MAX_SAFE_INTEGER,
    });

    const preflight = await service.prepare({
      projectId,
      authorization: "Bearer test",
      request: {
        clipIds: [unknown.id, mixed.id],
        settingsSelection: { base: "application_default", overrides: {} },
      },
    });

    expect(
      Object.fromEntries(
        preflight.items.map((item) => [item.clipId, item.sourceLanguageClass]),
      ),
    ).toEqual({ [unknown.id]: "unknown", [mixed.id]: "mixed" });
  });

  it("does not submit an unknown source without confirmation", async () => {
    const projectId = randomUUID();
    const candidate = clip(projectId, "source-a", 1);
    const createIndividual = vi.fn(async () => {
      throw new Error("createIndividual should not be called");
    });
    const service = serviceFixture([candidate], {
      availableBytes: Number.MAX_SAFE_INTEGER,
      createIndividual,
    });
    const request = {
      clipIds: [candidate.id],
      settingsSelection: {
        base: "application_default" as const,
        overrides: {},
      },
    };
    const preflight = await service.prepare({
      projectId,
      authorization: "Bearer test",
      request,
    });

    await expect(
      service.submit({
        projectId,
        authorization: "Bearer test",
        request: {
          ...request,
          expectedPreflightFingerprint: preflight.preflightFingerprint,
          confirmUnknownSourceSizes: false,
        },
      }),
    ).rejects.toMatchObject({
      code: "export_storage_unknown_confirmation_required",
    });
    expect(createIndividual).not.toHaveBeenCalled();
  });

  it("replays one deterministic batch command with clip_library origin", async () => {
    const projectId = randomUUID();
    const clips = [
      clip(projectId, "source-a", 1),
      clip(projectId, "source-b", 2),
    ];
    const batchId = randomUUID();
    const createBatch = vi.fn(
      async ({ command }: { command: CreateLoggedExportBatchRequest }) => {
        for (const candidate of clips) {
          candidate.exportStatus = "queued";
          candidate.version += 1;
        }
        return batchFixture(projectId, batchId, command);
      },
    );
    const service = serviceFixture(clips, {
      availableBytes: Number.MAX_SAFE_INTEGER,
      createBatch,
    });
    const request = {
      clipIds: clips.map((candidate) => candidate.id).toReversed(),
      settingsSelection: {
        base: "application_default" as const,
        overrides: {},
      },
    };
    const preflight = await service.prepare({
      projectId,
      authorization: "Bearer test",
      request,
    });
    const submit = () =>
      service.submit({
        projectId,
        authorization: "Bearer test",
        request: {
          ...request,
          expectedPreflightFingerprint: preflight.preflightFingerprint,
          confirmUnknownSourceSizes: true,
        },
      });

    await expect(submit()).resolves.toMatchObject({
      kind: "batch",
      batch: { id: batchId },
    });
    await expect(submit()).resolves.toMatchObject({
      kind: "batch",
      batch: { id: batchId },
    });
    expect(createBatch).toHaveBeenCalledTimes(2);
    const first = createBatch.mock.calls[0]![0].command;
    const second = createBatch.mock.calls[1]![0].command;
    expect(second).toEqual(first);
    expect(
      first.items.every((item) => item.export.requestOrigin === "clip_library"),
    ).toBe(true);
    expect(first.idempotencyKey).toBe(
      `clip-library:${preflight.preflightFingerprint}`,
    );
  });

  it("rechecks remaining bytes after acquisition without double-counting the source", async () => {
    const projectId = randomUUID();
    const candidate = clip(projectId, "source-a", 1);
    const snapshot = preview("confirmed_english").snapshot;
    const output = estimateOutputPackageBytes(
      candidate.selection.exportEndMs - candidate.selection.exportStartMs,
      snapshot.settings,
    );
    const required = output * 2 + ExportStorageSafetyReserveBytes;
    const guard = createPostAcquisitionExportStorageGuard({
      availableBytes: async () => required,
      activeCheckpointReserveBytes: async () => 0,
    });
    const request = {
      id: randomUUID(),
      jobId: randomUUID(),
      mode: "logged" as const,
      requestOrigin: "clip_library" as const,
      projectId,
      clipId: candidate.id,
      video: candidate.video,
      selection: candidate.selection,
      sourceLanguageClass: "confirmed_english" as const,
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: snapshot.settings,
      },
      resolvedSettingsSnapshot: snapshot,
      state: "processing" as const,
      createdAt: now,
      updatedAt: now,
    };

    const reservation = await guard.assertCanRender(request, 9_000_000_000);
    reservation.release();
    const blocked = createPostAcquisitionExportStorageGuard({
      availableBytes: async () => required - 1,
      activeCheckpointReserveBytes: async () => 0,
    });
    await expect(blocked.assertCanRender(request, 1)).rejects.toMatchObject({
      code: "export_storage_insufficient_after_acquisition",
    });

    const largeRequest = {
      ...request,
      selection: {
        ...request.selection,
        transcriptEndMs: 3_599_000,
        exportEndMs: 3_600_000,
      },
    };
    const largeOutput = estimateOutputPackageBytes(
      3_600_000,
      snapshot.settings,
    );
    expect(largeOutput).toBeGreaterThan(ExportStorageSafetyReserveBytes);
    const promotionPeak = largeOutput * 2 + ExportStorageSafetyReserveBytes;
    const largeReservation = await createPostAcquisitionExportStorageGuard({
      availableBytes: async () => promotionPeak,
      activeCheckpointReserveBytes: async () => 0,
    }).assertCanRender(largeRequest, 1);
    largeReservation.release();
    await expect(
      createPostAcquisitionExportStorageGuard({
        availableBytes: async () => promotionPeak - 1,
        activeCheckpointReserveBytes: async () => 0,
      }).assertCanRender(largeRequest, 1),
    ).rejects.toMatchObject({
      code: "export_storage_insufficient_after_acquisition",
    });

    const sharedGuard = createPostAcquisitionExportStorageGuard({
      availableBytes: async () => required,
      activeCheckpointReserveBytes: async () => 0,
    });
    const firstSibling = await sharedGuard.assertCanRender(request, 1);
    await expect(
      sharedGuard.assertCanRender(
        { ...request, id: randomUUID(), jobId: randomUUID() },
        1,
      ),
    ).rejects.toMatchObject({
      code: "export_storage_insufficient_after_acquisition",
    });
    firstSibling.release();
    const secondSibling = await sharedGuard.assertCanRender(
      { ...request, id: randomUUID(), jobId: randomUUID() },
      1,
    );
    secondSibling.release();
  });
});

const now = "2026-08-22T20:00:00.000Z";

function serviceFixture(
  clips: ClipCandidate[],
  options: {
    availableBytes: number;
    activeReserve?: number;
    createIndividual?: (input: {
      projectId: string;
      clipId: string;
      authorization: string;
      command: CreateClipExportRequest;
    }) => Promise<ExportRequest>;
    createBatch?: (input: {
      projectId: string;
      authorization: string;
      command: CreateLoggedExportBatchRequest;
    }) => Promise<LoggedExportBatch>;
  },
) {
  return new ClipLibraryExportOperationService({
    getClip: async ({ clipId }) => clips.find((item) => item.id === clipId)!,
    previewSettings: async ({ sourceLanguageClass }) =>
      preview(sourceLanguageClass),
    createIndividual:
      options.createIndividual ??
      (async () => {
        throw new Error("createIndividual is not configured");
      }),
    createBatch:
      options.createBatch ??
      (async () => {
        throw new Error("createBatch is not configured");
      }),
    capacity: {
      availableBytes: async () => options.availableBytes,
      activeCheckpointReserveBytes: async () => options.activeReserve ?? 0,
    },
    now: () => new Date(now),
  });
}

function preview(sourceLanguageClass: ExportSourceLanguageClass) {
  return resolveExportSettings({
    context: "logged",
    sourceLanguageClass,
    useApplicationDefault: true,
    resolvedAt: now,
  });
}

function clip(
  projectId: string,
  source: string,
  ordinal: number,
): ClipCandidate {
  const nativeTrackId = randomUUID();
  const englishTrackId = randomUUID();
  return {
    id: randomUUID(),
    projectId,
    catalogVideoId: randomUUID(),
    video: {
      youtubeVideoId: source,
      canonicalUrl: `https://www.youtube.com/watch?v=${source}`,
      title: `Clip ${ordinal}`,
      sourceLanguage: "es",
    },
    selection: {
      trackId: nativeTrackId,
      transcriptVersion: 1,
      firstSegmentId: randomUUID(),
      lastSegmentId: randomUUID(),
      transcriptStartMs: 1_000,
      transcriptEndMs: 11_000,
      exportStartMs: 0,
      exportEndMs: 12_000,
      text: `Selection ${ordinal}`,
      timingPrecision: "cue",
    },
    languageEvidence: {
      schemaVersion: 2,
      native: {
        role: "native",
        language: "es",
        text: "Texto",
        trackId: nativeTrackId,
        trackVersion: 1,
        timingPrecision: "cue",
      },
      english: {
        role: "english",
        language: "en",
        text: "Text",
        trackId: englishTrackId,
        trackVersion: 1,
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
      },
    },
    englishText: "Text",
    originalText: "Texto",
    notes: "private note",
    tags: ["private-tag"],
    researchStatus: "candidate",
    exportStatus: "not_requested",
    createdBy: randomUUID(),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function batchFixture(
  projectId: string,
  batchId: string,
  command: CreateLoggedExportBatchRequest,
): LoggedExportBatch {
  return {
    id: batchId,
    projectId,
    createdAt: now,
    summary: {
      total: command.items.length,
      queued: command.items.length,
      claimed: 0,
      processing: 0,
      needsUserAction: 0,
      complete: 0,
      failed: 0,
      canceled: 0,
      status: "active",
    },
    items: command.items.map((item, ordinal) => ({
      id: randomUUID(),
      batchId,
      ordinal,
      clipId: item.clipId,
      rootRequestId: randomUUID(),
      currentRequest: {
        id: randomUUID(),
        jobId: randomUUID(),
        state: "queued",
      },
    })),
  };
}
