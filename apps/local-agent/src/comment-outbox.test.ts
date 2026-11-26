import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import { OfflineOutbox } from "@research-video/sync";

import { ClipCommentOutboxService } from "./comment-outbox.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("clip comment offline replay", () => {
  it("queues on outage, replays exactly after restart, and retains stale conflicts", async () => {
    const root = mkdtempSync(join(tmpdir(), "comment-replay-"));
    roots.push(root);
    const path = join(root, "local.sqlite");
    const projectId = randomUUID();
    const clipId = randomUUID();
    const userId = randomUUID();
    const commentId = randomUUID();
    const createdAt = "2026-08-24T12:00:00.000Z";
    let database = openLocalDatabase(path);
    runLocalMigrations(database);
    const offlineSend = vi.fn(async () => {
      throw Object.assign(new Error("offline"), { statusCode: 503 });
    });
    const offline = new ClipCommentOutboxService(
      new OfflineOutbox(database, () => new Date(createdAt)),
      { send: offlineSend },
    );
    await expect(
      offline.create(projectId, clipId, "Bearer fixture", {
        idempotencyKey: "offline-create",
        body: "Persist this contribution",
        sourceTimeMs: 500,
      }),
    ).resolves.toMatchObject({
      state: "queued",
      commandType: "clip_comment.create.v1",
    });
    database.close();

    database = openLocalDatabase(path);
    runLocalMigrations(database);
    const replaySend = vi.fn(async (command) => ({
      id: commentId,
      projectId,
      clipId,
      author: {
        id: userId,
        handle: "offline_researcher",
        displayName: "Offline Researcher",
      },
      status: "active" as const,
      body: command.command.body,
      sourceTimeMs: 500,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    }));
    const restarted = new ClipCommentOutboxService(
      new OfflineOutbox(database, () => new Date("2026-08-24T12:00:02.000Z")),
      { send: replaySend },
    );
    await expect(
      restarted.replay(projectId, "Bearer fixture"),
    ).resolves.toEqual({ applied: 1, queued: 0, conflicts: 0 });
    expect(replaySend).toHaveBeenCalledTimes(1);
    await expect(
      restarted.replay(projectId, "Bearer fixture"),
    ).resolves.toEqual({ applied: 0, queued: 0, conflicts: 0 });

    const stale = new ClipCommentOutboxService(new OfflineOutbox(database), {
      send: async () => {
        throw Object.assign(new Error("stale"), {
          statusCode: 409,
          code: "version_conflict",
        });
      },
    });
    await expect(
      stale.update(projectId, clipId, commentId, "Bearer fixture", {
        idempotencyKey: "offline-stale-update",
        expectedVersion: 1,
        body: "Do not discard this edit",
      }),
    ).resolves.toMatchObject({
      state: "conflict",
      code: "version_conflict",
    });
    expect(stale.conflicts(projectId)).toMatchObject([
      { code: "version_conflict", commandType: "clip_comment.update.v1" },
    ]);
    database.close();
  });
});
