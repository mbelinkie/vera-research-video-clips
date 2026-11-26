import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalArtifactLocatorRepository,
  LocalClipLibraryCacheRepository,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import {
  LocalClipLibraryService,
  LocalClipLibraryUnavailableError,
} from "./clip-library.ts";

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.clear();
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "clip-library-service-"));
  temporaryDirectories.add(directory);
  const database = openLocalDatabase(join(directory, "local.sqlite"));
  runLocalMigrations(database);
  const now = "2026-08-22T12:00:00.000Z";
  const cache = new LocalClipLibraryCacheRepository(
    database,
    () => new Date(now),
  );
  return {
    database,
    cache,
    service: new LocalClipLibraryService(
      cache,
      new LocalArtifactLocatorRepository(database),
    ),
    now,
  };
}

describe("local Clip Library service", () => {
  it("returns fresh cloud data and only exact authorization-scoped stale pages", async () => {
    const { database, service, now } = fixture();
    const projectId = randomUUID();
    const page = {
      projectId,
      entries: [],
      syncCursor: "9",
      fetchedAt: now,
    };
    const query = { limit: 25, completed: "any" as const };
    await expect(
      service.resolvePage({
        projectId,
        authorization: "Bearer member-a",
        query,
        fetchCloud: async () => page,
      }),
    ).resolves.toMatchObject({
      ...page,
      query,
      freshness: "fresh",
      cachedAt: now,
      cacheCoverage: "cached_subset",
      selectedClipIds: [],
      localAvailability: [],
    });
    const unavailable = Object.assign(new Error("cloud unavailable"), {
      statusCode: 503,
    });
    await expect(
      service.resolvePage({
        projectId,
        authorization: "Bearer member-a",
        query,
        fetchCloud: async () => Promise.reject(unavailable),
      }),
    ).resolves.toMatchObject({ freshness: "stale", syncCursor: "9" });
    await expect(
      service.resolveLatestPage({
        projectId,
        authorization: "Bearer member-a",
        fetchCloud: async () => Promise.reject(unavailable),
      }),
    ).resolves.toMatchObject({
      query,
      freshness: "stale",
      syncCursor: "9",
    });
    const contractDrift = new Error("invalid successful cloud response");
    await expect(
      service.resolvePage({
        projectId,
        authorization: "Bearer member-a",
        query,
        fetchCloud: async () => Promise.reject(contractDrift),
      }),
    ).rejects.toBe(contractDrift);
    await expect(
      service.resolvePage({
        projectId,
        authorization: "Bearer member-b",
        query,
        fetchCloud: async () => Promise.reject(unavailable),
      }),
    ).rejects.toBeInstanceOf(LocalClipLibraryUnavailableError);
    database.close();
  });

  it("purges denied scopes and does not disguise local persistence conflicts as offline", async () => {
    const { database, service, now } = fixture();
    const projectId = randomUUID();
    const authorization = "Bearer revoked-member";
    const query = { limit: 25, completed: "any" as const };
    const page = {
      projectId,
      entries: [],
      syncCursor: "11",
      fetchedAt: now,
    };
    await service.resolvePage({
      projectId,
      authorization,
      query,
      fetchCloud: async () => page,
    });
    expect(() =>
      service.updateSelection({
        projectId,
        authorization,
        command: {
          pageClipIds: [projectId],
          selectedClipIds: [projectId],
        },
      }),
    ).toThrow(/authorized cached page/u);
    const forbidden = Object.assign(new Error("forbidden"), {
      statusCode: 403,
    });
    await expect(
      service.resolvePage({
        projectId,
        authorization,
        query,
        fetchCloud: async () => Promise.reject(forbidden),
      }),
    ).rejects.toBe(forbidden);
    const unavailable = Object.assign(new Error("cloud unavailable"), {
      statusCode: 503,
    });
    await expect(
      service.resolvePage({
        projectId,
        authorization,
        query,
        fetchCloud: async () => Promise.reject(unavailable),
      }),
    ).rejects.toBeInstanceOf(LocalClipLibraryUnavailableError);
    const otherProjectId = randomUUID();
    await service.resolvePage({
      projectId,
      authorization,
      query,
      fetchCloud: async () => ({ ...page, projectId }),
    });
    await service.resolvePage({
      projectId: otherProjectId,
      authorization,
      query,
      fetchCloud: async () => ({ ...page, projectId: otherProjectId }),
    });
    const unauthorized = Object.assign(new Error("unauthorized"), {
      statusCode: 401,
    });
    await expect(
      service.resolvePage({
        projectId,
        authorization,
        query,
        fetchCloud: async () => Promise.reject(unauthorized),
      }),
    ).rejects.toBe(unauthorized);
    await expect(
      service.resolvePage({
        projectId: otherProjectId,
        authorization,
        query,
        fetchCloud: async () => Promise.reject(unavailable),
      }),
    ).rejects.toBeInstanceOf(LocalClipLibraryUnavailableError);
    await expect(
      service.resolvePage({
        projectId,
        authorization: "Bearer member",
        query,
        fetchCloud: async () => ({ ...page, projectId: randomUUID() }),
      }),
    ).rejects.toMatchObject({ code: "artifact_catalog_conflict" });
    database.close();
  });
});
