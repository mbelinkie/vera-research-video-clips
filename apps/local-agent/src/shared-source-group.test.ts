import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ExportRequest,
  LoggedExportDelivery,
} from "@research-video/contracts";
import type { LocalExportQueue } from "@research-video/db-local";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalLoggedExportSourceGroupCoordinator } from "./shared-source-group.ts";

const roots = new Set<string>();

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.clear();
});

describe("LocalLoggedExportSourceGroupCoordinator", () => {
  it("acquires and inspects once, isolates member failure, and releases both only after one cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "logged-source-group-"));
    roots.add(root);
    const batchId = "019fbb95-cd76-7920-93fa-e23ba755ef40";
    const first = requestFixture(
      "019fbb95-cd76-7920-93fa-e23ba755ef41",
      "019fbb95-cd76-7920-93fa-e23ba755ef42",
      "019fbb95-cd76-7920-93fa-e23ba755ef43",
    );
    const second = requestFixture(
      "019fbb95-cd76-7920-93fa-e23ba755ef44",
      "019fbb95-cd76-7920-93fa-e23ba755ef45",
      "019fbb95-cd76-7920-93fa-e23ba755ef46",
    );
    const deliveries = new Map(
      [first, second].map((request, index) => [
        request.id,
        deliveryFixture(request, batchId, index),
      ]),
    );
    const events: string[] = [];
    const queue = {
      getAcceptedLoggedDelivery: (requestId: string) =>
        deliveries.get(requestId),
      getLoggedExecution: (requestId: string) => ({
        executionId: `${requestId.slice(0, -1)}9`,
        requestId,
        attempt: 1,
        workerId: "019fbb95-cd76-7920-93fa-e23ba755ef47",
        workerEpoch: 1,
      }),
      getLoggedExportSourceGroupByCompatibilityKey: () => undefined,
      createLoggedExportSourceGroup: vi.fn(() => events.push("group-created")),
      recordLoggedExportSourceGroupReady: vi.fn(() =>
        events.push("group-ready"),
      ),
      releaseLoggedExportSourceGroupMember: vi.fn(
        (_groupId: string, requestId: string, outcome: string) => {
          events.push(`released:${requestId}:${outcome}`);
          return true;
        },
      ),
      recordLoggedExportSourceGroupCleanupStarted: vi.fn(() =>
        events.push("cleanup-started"),
      ),
      recordLoggedExportSourceGroupCleanupSucceeded: vi.fn(() =>
        events.push("cleanup-succeeded"),
      ),
      recordLoggedExportSourceGroupCleanupFailed: vi.fn(),
    } as unknown as LocalExportQueue;
    const acquire = vi.fn(async ({ videoId, scratchDirectory }) => {
      const scratchPath = join(scratchDirectory, `source-${videoId}.mp4`);
      await writeFile(scratchPath, "fixture source");
      return {
        scratchPath,
        sourceIdentity: videoId,
        byteSize: 14,
        provider: "fixture",
        contentSha256: "a".repeat(64),
      };
    });
    const inspect = vi.fn(async () => ({
      durationMs: 4_000,
      containerFormat: "mov,mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "fixture",
    }));
    const coordinator = new LocalLoggedExportSourceGroupCoordinator(
      queue,
      { acquireAuthorizedFullSource: acquire },
      { inspect },
      root,
      undefined,
      5,
    );
    const staging = new Set<string>();
    const run = (request: ExportRequest, fail: boolean) =>
      coordinator.run({
        request,
        attempt: 1,
        handoff: async ({ stagingDirectory }) => {
          staging.add(stagingDirectory);
          events.push(`handoff:${request.id}`);
          if (fail)
            throw Object.assign(new Error("member failed"), {
              code: "member_failed",
            });
        },
        sourceReady: () => events.push(`ready:${request.id}`),
        cleanupStarted: () => events.push(`cleaning:${request.id}`),
        cleanupSucceeded: () => events.push(`cleaned:${request.id}`),
        cleanupFailed: () => events.push(`cleanup-failed:${request.id}`),
      });
    const [succeeded, failed] = await Promise.allSettled([
      run(first, false),
      run(second, true),
    ]);

    expect(succeeded).toEqual({ status: "fulfilled", value: true });
    expect(failed).toMatchObject({
      status: "rejected",
      reason: { code: "member_failed" },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(staging.size).toBe(2);
    expect(events.indexOf("cleanup-succeeded")).toBeGreaterThan(
      events.indexOf(`released:${second.id}:failed`),
    );
    expect(events).not.toContain(`cleanup-failed:${first.id}`);
    expect(await readdir(join(root, "jobs", "export-source-groups"))).toEqual(
      [],
    );
  });

  it("falls back without acquisition when no active compatible sibling joins", async () => {
    const root = await mkdtemp(join(tmpdir(), "logged-source-singleton-"));
    roots.add(root);
    const request = requestFixture(
      "019fbb95-cd76-7920-93fa-e23ba755ef51",
      "019fbb95-cd76-7920-93fa-e23ba755ef52",
      "019fbb95-cd76-7920-93fa-e23ba755ef53",
    );
    const delivery = deliveryFixture(
      request,
      "019fbb95-cd76-7920-93fa-e23ba755ef50",
      0,
    );
    const acquire = vi.fn();
    const queue = {
      getAcceptedLoggedDelivery: () => delivery,
      getLoggedExecution: () => ({ executionId: "execution", attempt: 1 }),
      getLoggedExportSourceGroupByCompatibilityKey: () => undefined,
    } as unknown as LocalExportQueue;
    const coordinator = new LocalLoggedExportSourceGroupCoordinator(
      queue,
      { acquireAuthorizedFullSource: acquire },
      { inspect: vi.fn() },
      root,
      undefined,
      1,
    );
    await expect(
      coordinator.run({
        request,
        attempt: 1,
        handoff: vi.fn(),
        sourceReady: vi.fn(),
        cleanupStarted: vi.fn(),
        cleanupSucceeded: vi.fn(),
        cleanupFailed: vi.fn(),
      }),
    ).resolves.toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("falls back after restart when the compatibility key already has durable lifecycle evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "logged-source-restart-"));
    roots.add(root);
    const request = requestFixture(
      "019fbb95-cd76-7920-93fa-e23ba755ef54",
      "019fbb95-cd76-7920-93fa-e23ba755ef55",
      "019fbb95-cd76-7920-93fa-e23ba755ef56",
    );
    const delivery = deliveryFixture(
      request,
      "019fbb95-cd76-7920-93fa-e23ba755ef50",
      0,
    );
    const acquire = vi.fn();
    const queue = {
      getAcceptedLoggedDelivery: () => delivery,
      getLoggedExecution: () => ({ executionId: "execution", attempt: 1 }),
      getLoggedExportSourceGroupByCompatibilityKey: () => ({
        id: "019fbb95-cd76-7920-93fa-e23ba755ef57",
        lifecycleState: "deleted",
      }),
    } as unknown as LocalExportQueue;
    const coordinator = new LocalLoggedExportSourceGroupCoordinator(
      queue,
      { acquireAuthorizedFullSource: acquire },
      { inspect: vi.fn() },
      root,
    );
    await expect(
      coordinator.run({
        request,
        attempt: 1,
        handoff: vi.fn(),
        sourceReady: vi.fn(),
        cleanupStarted: vi.fn(),
        cleanupSucceeded: vi.fn(),
        cleanupFailed: vi.fn(),
      }),
    ).resolves.toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("blocks every member and redacts cleanup evidence when durable deletion settlement fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "logged-source-cleanup-fail-"));
    roots.add(root);
    const batchId = "019fbb95-cd76-7920-93fa-e23ba755ef58";
    const first = requestFixture(
      "019fbb95-cd76-7920-93fa-e23ba755ef59",
      "019fbb95-cd76-7920-93fa-e23ba755ef5a",
      "019fbb95-cd76-7920-93fa-e23ba755ef5b",
    );
    const second = requestFixture(
      "019fbb95-cd76-7920-93fa-e23ba755ef5c",
      "019fbb95-cd76-7920-93fa-e23ba755ef5d",
      "019fbb95-cd76-7920-93fa-e23ba755ef5e",
    );
    const deliveries = new Map(
      [first, second].map((request, index) => [
        request.id,
        deliveryFixture(request, batchId, index),
      ]),
    );
    const cleanupFailed = vi.fn();
    const queue = {
      getAcceptedLoggedDelivery: (requestId: string) =>
        deliveries.get(requestId),
      getLoggedExecution: (requestId: string) => ({
        executionId: `${requestId.slice(0, -1)}9`,
        requestId,
        attempt: 1,
        workerId: "019fbb95-cd76-7920-93fa-e23ba755ef47",
        workerEpoch: 1,
      }),
      getLoggedExportSourceGroupByCompatibilityKey: () => undefined,
      createLoggedExportSourceGroup: vi.fn(),
      recordLoggedExportSourceGroupReady: vi.fn(),
      releaseLoggedExportSourceGroupMember: vi.fn(() => true),
      recordLoggedExportSourceGroupCleanupStarted: vi.fn(),
      recordLoggedExportSourceGroupCleanupSucceeded: vi.fn(() => {
        throw new Error("could not settle /private/secret/source.mp4");
      }),
      recordLoggedExportSourceGroupCleanupFailed: cleanupFailed,
    } as unknown as LocalExportQueue;
    const coordinator = new LocalLoggedExportSourceGroupCoordinator(
      queue,
      {
        acquireAuthorizedFullSource: async ({ videoId, scratchDirectory }) => {
          const scratchPath = join(scratchDirectory, `source-${videoId}.mp4`);
          await writeFile(scratchPath, "fixture source");
          return {
            scratchPath,
            sourceIdentity: videoId,
            byteSize: 14,
            provider: "fixture",
            contentSha256: "a".repeat(64),
          };
        },
      },
      {
        inspect: async () => ({
          durationMs: 4_000,
          videoCodec: "h264",
          audioCodec: "aac",
        }),
      },
      root,
      undefined,
      1,
    );
    const run = (request: ExportRequest) =>
      coordinator.run({
        request,
        attempt: 1,
        handoff: async () => {},
        sourceReady: () => {},
        cleanupStarted: () => {},
        cleanupSucceeded: () => {},
        cleanupFailed: () => {},
      });
    const results = await Promise.allSettled([run(first), run(second)]);
    expect(results).toEqual([
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({ code: "source_cleanup_failed" }),
      }),
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({ code: "source_cleanup_failed" }),
      }),
    ]);
    expect(JSON.stringify(results)).not.toContain("/private/secret");
    expect(cleanupFailed).toHaveBeenCalledWith(
      expect.any(String),
      "Shared source scratch cleanup could not remove the exact group directory.",
    );
  });
});

function requestFixture(
  requestId: string,
  jobId: string,
  batchItemId: string,
): ExportRequest {
  return {
    id: requestId,
    jobId,
    mode: "logged",
    projectId: "019fbb95-cd76-7920-93fa-e23ba755ef48",
    clipId: `${batchItemId.slice(0, -1)}8`,
    batchItemId,
    video: {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Fixture video",
    },
    selection: {
      trackId: "019fbb95-cd76-7920-93fa-e23ba755ef60",
      transcriptVersion: 1,
      firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ef61",
      lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ef61",
      firstTokenId: "019fbb95-cd76-7920-93fa-e23ba755ef62",
      lastTokenId: "019fbb95-cd76-7920-93fa-e23ba755ef62",
      transcriptStartMs: 0,
      transcriptEndMs: 1_000,
      exportStartMs: 0,
      exportEndMs: 1_000,
      text: "fixture",
      timingPrecision: "word",
    },
    sourceLanguageClass: "confirmed_english",
    preset: {
      presetVersion: 1,
      name: "Fixture",
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
    state: "processing",
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
  };
}

function deliveryFixture(
  request: ExportRequest,
  batchId: string,
  index: number,
): LoggedExportDelivery {
  return {
    deliveryId: `019fbb95-cd76-7920-93fa-e23ba755ef7${index}`,
    generation: 1,
    reservationToken: `019fbb95-cd76-7920-93fa-e23ba755ef8${index}`,
    workerId: "019fbb95-cd76-7920-93fa-e23ba755ef47",
    workerEpoch: 1,
    status: "accepted",
    reservedAt: "2026-08-22T12:00:00.000Z",
    reservationExpiresAt: "2026-08-22T12:01:00.000Z",
    acceptedAt: "2026-08-22T12:00:01.000Z",
    sourceGroup: { batchId, batchItemId: request.batchItemId! },
    request,
  };
}
