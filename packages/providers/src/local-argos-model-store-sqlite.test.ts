import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import type { CachedArgosCatalog } from "./local-argos-model-manager.ts";
import {
  SqliteLocalArgosModelStore,
  SqliteLocalArgosModelStoreError,
} from "./local-argos-model-store-sqlite.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("SqliteLocalArgosModelStore", () => {
  it("persists an immutable signed catalog and complete installation evidence", async () => {
    const { database, store } = fixture();
    const catalog = cachedCatalog();
    await store.writeCatalog(catalog);
    await expect(store.readCatalog()).resolves.toEqual(catalog);

    await store.putInstallation({
      modelId: "model-es-en-v1",
      sourceLanguage: "es",
      targetLanguage: "en",
      runtimeFamily: "argos-translate",
      artifactSha256: "a".repeat(64),
      byteSize: 512,
      state: "active",
      installedAt: at(1),
      verifiedAt: at(1),
    });
    await expect(store.listInstallations()).resolves.toEqual([
      expect.objectContaining({
        modelId: "model-es-en-v1",
        sourceLanguage: "es",
        targetLanguage: "en",
        state: "active",
      }),
    ]);

    await expect(
      store.writeCatalog({
        ...catalog,
        release: { ...catalog.release, signature: "different" },
      }),
    ).rejects.toBeInstanceOf(SqliteLocalArgosModelStoreError);
    database.close();
  });

  it("keeps concurrent leases durable and removes only expired leases", async () => {
    const { database, store } = fixture();
    await store.putInstallation({
      modelId: "model-es-en-v1",
      sourceLanguage: "es",
      targetLanguage: "en",
      runtimeFamily: "argos-translate",
      artifactSha256: "b".repeat(64),
      byteSize: 1024,
      state: "active",
      installedAt: at(0),
      verifiedAt: at(0),
    });
    await store.createLease({
      modelId: "model-es-en-v1",
      leaseId: "expired",
      holderId: "job-one",
      acquiredAt: at(1),
      expiresAt: at(2),
    });
    await store.createLease({
      modelId: "model-es-en-v1",
      leaseId: "active",
      holderId: "job-two",
      acquiredAt: at(1),
      expiresAt: at(4),
    });

    await store.removeExpiredLeases(at(3));
    await expect(store.listLeases("model-es-en-v1")).resolves.toEqual([
      expect.objectContaining({ leaseId: "active", holderId: "job-two" }),
    ]);
    await store.removeLease("model-es-en-v1", "active");
    await expect(store.listLeases("model-es-en-v1")).resolves.toEqual([]);
    database.close();
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vera-argos-sqlite-"));
  roots.push(root);
  const database = openLocalDatabase(join(root, "local.sqlite"));
  runLocalMigrations(database);
  return { database, store: new SqliteLocalArgosModelStore(database) };
}

function cachedCatalog(): CachedArgosCatalog {
  const payload = {
    contractVersion: 1 as const,
    catalogRevision: 1,
    models: [],
  };
  const canonicalPayload = stableJson(payload);
  return {
    release: {
      id: `argos-release:${sha256(canonicalPayload)}`,
      payload,
      canonicalPayload,
      keyId: "fixture-root",
      signature: "fixture-signature",
    },
    cachedAt: at(0),
    expiresAt: at(10),
  };
}

function at(minutes: number) {
  return new Date(Date.UTC(2026, 7, 27, 0, minutes)).toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
