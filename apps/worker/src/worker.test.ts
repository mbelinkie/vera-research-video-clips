import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ClaimedTranscriptionJobSchema,
  JobSchema,
} from "@research-video/contracts";
import { MemoryJobQueue } from "@research-video/sync";

import {
  ClaimingTranscriptionWorker,
  HttpTranscriptionWorkerControlPlane,
  TranscriptionWorkerService,
  Worker,
  type TranscriptionWorkerControlPlane,
  type WorkerVisibilityLease,
} from "./worker.ts";

const job = JobSchema.parse({
  id: "019fbb95-cd76-7920-93fa-e23ba755ee3f",
  kind: "transcription",
  state: "queued",
  projectId: "019fbb95-cd76-7920-93fa-e23ba755ee30",
  idempotencyKey: "fixture",
  attempt: 0,
  payload: {},
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
});

describe("worker", () => {
  it("acknowledges successful work", async () => {
    const queue = new MemoryJobQueue<typeof job>();
    const extendVisibility = vi.spyOn(queue, "extendVisibility");
    const execute = vi.fn(async () => undefined);
    const worker = new Worker(queue, execute, { visibilityRenewalMs: 1 });
    await queue.send("message", job);

    expect(await worker.runOnce()).toBe("completed");
    expect(execute).toHaveBeenCalledWith(job);
    expect(await worker.runOnce()).toBe("idle");
    expect(extendVisibility).toHaveBeenCalledTimes(0);
  });

  it("releases failed work for another delivery", async () => {
    const queue = new MemoryJobQueue<typeof job>();
    const worker = new Worker(queue, async () => {
      throw new Error("fixture failure");
    });
    await queue.send("message", job);

    expect(await worker.runOnce()).toBe("released");
    expect(await worker.runOnce()).toBe("released");
  });

  it("renews queue visibility while a delivery is still running", async () => {
    const queue = new MemoryJobQueue<typeof job>();
    const extendVisibility = vi.spyOn(queue, "extendVisibility");
    let finish: (() => void) | undefined;
    const worker = new Worker(
      queue,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      { visibilitySeconds: 30, visibilityRenewalMs: 5 },
    );
    await queue.send("message", job);

    const result = worker.runOnce();
    await vi.waitFor(() => expect(extendVisibility).toHaveBeenCalled());
    finish?.();

    await expect(result).resolves.toBe("completed");
    expect(extendVisibility).toHaveBeenCalledWith(expect.any(String), 30);
  });
});

const claimed = ClaimedTranscriptionJobSchema.parse({
  job: { ...job, state: "claimed", attempt: 1 },
  lease: {
    jobId: job.id,
    workerId: randomUUID(),
    attempt: 1,
    claimedAt: "2026-08-01T12:00:00.000Z",
    heartbeatAt: "2026-08-01T12:00:00.000Z",
    expiresAt: "2026-08-01T12:02:00.000Z",
  },
});

function controlPlane(
  overrides: Partial<TranscriptionWorkerControlPlane> = {},
): TranscriptionWorkerControlPlane {
  return {
    claim: vi.fn(async () => claimed),
    heartbeat: vi.fn(async () => claimed.lease),
    recordSourcePlan: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("claiming transcription worker", () => {
  it("returns idle without running an executor when no API job is eligible", async () => {
    const execute = vi.fn(async () => undefined);
    const worker = new ClaimingTranscriptionWorker(
      controlPlane({ claim: vi.fn(async () => undefined) }),
      execute,
    );

    await expect(worker.runOnce()).resolves.toBe("idle");
    expect(execute).not.toHaveBeenCalled();
  });

  it("heartbeats the selected stage and renews transport visibility", async () => {
    const api = controlPlane();
    const visibility: WorkerVisibilityLease = { renew: vi.fn(async () => {}) };
    let finish: (() => void) | undefined;
    const worker = new ClaimingTranscriptionWorker(
      api,
      async (_claimed, context) => {
        await context.setStage("transcribing");
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      visibility,
      { heartbeatIntervalMs: 5, visibilitySeconds: 30 },
    );

    const result = worker.runOnce();
    await vi.waitFor(() =>
      expect(api.heartbeat).toHaveBeenCalledWith(job.id, 1, "transcribing"),
    );
    await vi.waitFor(() => expect(visibility.renew).toHaveBeenCalled());
    finish?.();

    await expect(result).resolves.toBe("processed");
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("durably reports executor failure for the active attempt", async () => {
    const api = controlPlane();
    const worker = new ClaimingTranscriptionWorker(api, async () => {
      throw new Error("caption provider unavailable");
    });

    await expect(worker.runOnce()).resolves.toBe("failed");
    expect(api.fail).toHaveBeenCalledWith(job.id, {
      attempt: 1,
      code: "worker_execution_failed",
      message: "caption provider unavailable",
      retryable: true,
    });
  });

  it("reports lease loss when the failure belongs to a stale attempt", async () => {
    const api = controlPlane({
      fail: vi.fn(async () => {
        throw new Error("stale lease");
      }),
    });
    const worker = new ClaimingTranscriptionWorker(api, async () => {
      throw new Error("late failure");
    });

    await expect(worker.runOnce()).resolves.toBe("lease-lost");
  });
});

describe("continuous transcription worker service", () => {
  it("never exceeds its fixed concurrency", async () => {
    const shutdown = new AbortController();
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    const runner = {
      runOnce: vi.fn(async () => {
        started += 1;
        if (started === 4) shutdown.abort();
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return "processed" as const;
      }),
    };
    const service = new TranscriptionWorkerService(runner, {
      concurrency: 2,
      idlePollMs: 1,
      errorBackoffMs: 1,
    });

    const summary = await service.run(shutdown.signal);

    expect(maximumActive).toBe(2);
    expect(runner.runOnce).toHaveBeenCalledTimes(4);
    expect(summary.processed).toBe(4);
  });

  it("polls after idle and backs off after an unexpected error", async () => {
    const shutdown = new AbortController();
    const waits: number[] = [];
    const unexpected = new Error("control plane unavailable");
    const runner = {
      runOnce: vi
        .fn<() => Promise<"idle">>()
        .mockResolvedValueOnce("idle")
        .mockRejectedValueOnce(unexpected),
    };
    const service = new TranscriptionWorkerService(runner, {
      idlePollMs: 250,
      errorBackoffMs: 1_000,
      onUnexpectedError: vi.fn(),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        if (waits.length === 2) shutdown.abort();
      },
    });

    const summary = await service.run(shutdown.signal);

    expect(waits).toEqual([250, 1_000]);
    expect(summary.unexpectedErrors).toBe(1);
  });

  it("drains active work after shutdown without claiming again", async () => {
    const shutdown = new AbortController();
    let finish: (() => void) | undefined;
    const runner = {
      runOnce: vi.fn(
        () =>
          new Promise<"processed">((resolve) => {
            finish = () => resolve("processed");
          }),
      ),
    };
    const service = new TranscriptionWorkerService(runner);

    const result = service.run(shutdown.signal);
    await vi.waitFor(() => expect(runner.runOnce).toHaveBeenCalledTimes(1));
    shutdown.abort();
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();

    await expect(result).resolves.toEqual({
      processed: 1,
      failed: 0,
      leaseLost: 0,
      unexpectedErrors: 0,
    });
    expect(runner.runOnce).toHaveBeenCalledTimes(1);
  });
});

describe("HTTP worker control plane", () => {
  it("claims with authenticated bounded lease settings", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(claimed), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new HttpTranscriptionWorkerControlPlane({
      baseUrl: "http://127.0.0.1:43111",
      authorization: "Bearer development-worker",
      executionLocation: "local",
      leaseSeconds: 60,
      fetcher,
    });

    await expect(client.claim()).resolves.toEqual(claimed);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:43111/api/transcription-jobs/claim"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer development-worker",
        }),
        body: JSON.stringify({ executionLocation: "local", leaseSeconds: 60 }),
      }),
    );
  });

  it("treats an empty claim response as idle", async () => {
    const client = new HttpTranscriptionWorkerControlPlane({
      baseUrl: "http://127.0.0.1:43111",
      authorization: "Bearer development-worker",
      executionLocation: "local",
      fetcher: vi.fn(async () => new Response(null, { status: 204 })),
    });

    await expect(client.claim()).resolves.toBeUndefined();
  });
});
