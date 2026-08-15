import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import { MemoryJobQueue, OfflineOutbox } from "./index.ts";

describe("memory job queue", () => {
  it("models at-least-once delivery", async () => {
    const queue = new MemoryJobQueue<{ jobId: string }>();
    await queue.send("message-1", { jobId: "job-1" });

    const first = await queue.receive();
    expect(first?.deliveryCount).toBe(1);
    expect(await queue.extendVisibility(first!.receipt, 30)).toBe(true);
    expect(await queue.receive()).toBeUndefined();
    expect(await queue.release(first!.receipt)).toBe(true);

    const second = await queue.receive();
    expect(second?.deliveryCount).toBe(2);
    expect(await queue.acknowledge(second!.receipt)).toBe(true);
    expect(await queue.receive()).toBeUndefined();
  });
});

describe("offline sync outbox", () => {
  it("deduplicates commands and schedules bounded retries", () => {
    const directory = mkdtempSync(join(tmpdir(), "outbox-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const outbox = new OfflineOutbox(database, () => now);

    const first = outbox.enqueue({
      commandType: "transcript.cache",
      idempotencyKey: "cache:one",
      payload: { version: 1 },
    });
    expect(
      outbox.enqueue({
        commandType: "transcript.cache",
        idempotencyKey: "cache:one",
        payload: { version: 1 },
      }),
    ).toBe(first);
    expect(outbox.due()).toHaveLength(1);
    outbox.retry(first);
    expect(outbox.due()).toHaveLength(0);

    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
