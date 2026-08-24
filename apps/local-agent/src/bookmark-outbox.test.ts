import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalProjectBookmarkRepository,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import { BookmarkOutboxService } from "./bookmark-outbox.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("project bookmark offline cache and replay", () => {
  it("caches authorized reads, replays after restart, and retains stale text conflicts", async () => {
    const root = mkdtempSync(join(tmpdir(), "bookmark-replay-"));
    roots.push(root);
    const databasePath = join(root, "local.sqlite");
    const projectId = randomUUID();
    const videoId = randomUUID();
    const bookmarkId = randomUUID();
    const userId = randomUUID();
    const authorization = "Bearer bookmark-fixture";
    const createdAt = "2026-08-24T12:00:00.000Z";
    const query = {
      scope: "video" as const,
      videoId,
      state: "active" as const,
      limit: 50,
    };
    const bookmark = {
      id: bookmarkId,
      projectId,
      videoId,
      sourceTimeMs: 2_500,
      title: "Opening",
      note: "Retained research context",
      state: "active" as const,
      version: 1,
      createdBy: {
        userId,
        handle: "offline_researcher",
        displayName: "Offline Researcher",
      },
      updatedBy: {
        userId,
        handle: "offline_researcher",
        displayName: "Offline Researcher",
      },
      createdAt,
      updatedAt: createdAt,
      source: {
        youtubeVideoId: "fixture1234",
        canonicalUrl: "https://www.youtube.com/watch?v=fixture1234",
        title: "Fixture source",
      },
    };

    let database = openLocalDatabase(databasePath);
    runLocalMigrations(database);
    const online = new BookmarkOutboxService(
      new LocalProjectBookmarkRepository(database, () => new Date(createdAt)),
      {
        list: vi.fn(async () => ({ projectId, items: [bookmark] })),
        send: vi.fn(async () => bookmark),
      },
    );
    await expect(
      online.list(projectId, authorization, query),
    ).resolves.toMatchObject({
      freshness: "fresh",
      items: [{ id: bookmarkId }],
    });
    const offline = new BookmarkOutboxService(
      new LocalProjectBookmarkRepository(database, () => new Date(createdAt)),
      {
        list: async () => {
          throw Object.assign(new Error("offline"), { statusCode: 503 });
        },
        send: async () => {
          throw Object.assign(new Error("offline"), { statusCode: 503 });
        },
      },
    );
    await expect(
      offline.list(projectId, authorization, query),
    ).resolves.toMatchObject({
      freshness: "stale",
      items: [{ note: "Retained research context" }],
    });
    await expect(
      offline.create(projectId, authorization, {
        videoId,
        sourceTimeMs: 8_000,
        title: "Queued title",
        note: "Queued note survives restart",
        idempotencyKey: "offline-create",
      }),
    ).resolves.toMatchObject({
      state: "queued",
      command: { title: "Queued title", note: "Queued note survives restart" },
    });
    database.close();

    database = openLocalDatabase(databasePath);
    runLocalMigrations(database);
    const replaySend = vi.fn(async () => ({
      ...bookmark,
      id: randomUUID(),
      sourceTimeMs: 8_000,
      title: "Queued title",
      note: "Queued note survives restart",
    }));
    const restarted = new BookmarkOutboxService(
      new LocalProjectBookmarkRepository(
        database,
        () => new Date("2026-08-24T12:00:02.000Z"),
      ),
      {
        list: async () => ({ projectId, items: [bookmark] }),
        send: replaySend,
      },
    );
    await expect(restarted.replay(projectId, authorization)).resolves.toEqual({
      applied: 1,
      queued: 0,
      conflicts: 0,
    });
    expect(replaySend).toHaveBeenCalledTimes(1);
    await expect(restarted.replay(projectId, authorization)).resolves.toEqual({
      applied: 0,
      queued: 0,
      conflicts: 0,
    });

    const stale = new BookmarkOutboxService(
      new LocalProjectBookmarkRepository(database),
      {
        list: async () => ({ projectId, items: [bookmark] }),
        send: async () => {
          throw Object.assign(new Error("stale version"), {
            statusCode: 409,
            code: "version_conflict",
          });
        },
      },
    );
    await expect(
      stale.update(projectId, bookmarkId, authorization, {
        title: "Conflicting title",
        note: "Never discard this edit",
        expectedVersion: 1,
        idempotencyKey: "offline-stale-update",
      }),
    ).resolves.toMatchObject({
      state: "conflict",
      command: {
        code: "version_conflict",
        title: "Conflicting title",
        note: "Never discard this edit",
      },
    });
    database.close();
  });

  it("uses idempotency after a lost response and blocks removed-member replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "bookmark-membership-"));
    roots.push(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const projectId = randomUUID();
    const videoId = randomUUID();
    const bookmarkId = randomUUID();
    const userId = randomUUID();
    const authorization = "Bearer removed-member";
    const now = "2026-08-24T12:00:00.000Z";
    const bookmark = {
      id: bookmarkId,
      projectId,
      videoId,
      sourceTimeMs: 1_000,
      state: "active" as const,
      version: 1,
      createdBy: { userId, handle: "member", displayName: "Member" },
      updatedBy: { userId, handle: "member", displayName: "Member" },
      createdAt: now,
      updatedAt: now,
    };
    let committed = false;
    const lostResponse = new BookmarkOutboxService(
      new LocalProjectBookmarkRepository(database),
      {
        list: async () => ({ projectId, items: [] }),
        send: async () => {
          if (!committed) {
            committed = true;
            throw Object.assign(new Error("response lost"), {
              statusCode: 503,
            });
          }
          return bookmark;
        },
      },
    );
    const request = {
      videoId,
      sourceTimeMs: 1_000,
      idempotencyKey: "lost-response-create",
    };
    await expect(
      lostResponse.create(projectId, authorization, request),
    ).resolves.toMatchObject({ state: "queued" });
    await expect(
      lostResponse.create(projectId, authorization, request),
    ).resolves.toMatchObject({
      state: "applied",
      bookmark: { id: bookmarkId },
    });

    const removed = new BookmarkOutboxService(
      new LocalProjectBookmarkRepository(database),
      {
        list: async () => {
          throw Object.assign(new Error("removed"), { statusCode: 403 });
        },
        send: async () => {
          throw Object.assign(new Error("removed"), {
            statusCode: 403,
            code: "forbidden",
          });
        },
      },
    );
    await expect(
      removed.create(projectId, authorization, {
        videoId,
        sourceTimeMs: 2_000,
        note: "Retain despite membership loss",
        idempotencyKey: "removed-member-create",
      }),
    ).resolves.toMatchObject({
      state: "conflict",
      command: { code: "forbidden", note: "Retain despite membership loss" },
    });
    await expect(
      removed.list(projectId, authorization, {
        scope: "video",
        videoId,
        state: "active",
        limit: 50,
      }),
    ).rejects.toThrow("removed");
    database.close();
  });
});
