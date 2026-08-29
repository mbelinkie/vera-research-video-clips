import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CatalogVerifier,
  SignedCatalogRelease,
} from "./local-model-argos-catalog.ts";
import {
  LocalArgosModelError,
  LocalArgosModelManager,
  MemoryLocalArgosModelStore,
  type ArgosModelDescriptor,
} from "./local-argos-model-manager.ts";

const verifier: CatalogVerifier = {
  async verify(bytes, signature, keyId) {
    return keyId === "test-root" && signature === digest(bytes);
  },
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LocalArgosModelManager", () => {
  it("serves an installed model from a verified stale offline catalog but never downloads from it", async () => {
    const fixture = await managerWithModel();
    await fixture.manager.cacheCatalog(fixture.catalog);
    await fixture.manager.install(
      fixture.model,
      async () => fixture.bytes,
      at(0),
    );

    expect(await fixture.manager.catalogState(at(10))).toMatchObject({
      state: "stale",
    });
    await expect(
      fixture.manager.acquireLease({
        model: fixture.model,
        holderId: "offline-job",
        now: at(10),
        ttlMs: 1_000,
      }),
    ).resolves.toMatchObject({
      modelPath: expect.stringContaining("package.argosmodel"),
    });
    await expect(
      fixture.manager.install(fixture.model, async () => fixture.bytes, at(10)),
    ).rejects.toMatchObject({ code: "catalog_unavailable" });
  });

  it("fails closed for corrupt bytes without promoting a package", async () => {
    const fixture = await managerWithModel();
    await fixture.manager.cacheCatalog(fixture.catalog);

    await expect(
      fixture.manager.install(
        fixture.model,
        async () => Uint8Array.of(1, 2, 3),
        at(0),
      ),
    ).rejects.toBeInstanceOf(LocalArgosModelError);
    expect(await fixture.store.getInstallation(fixture.model.id)).toMatchObject(
      { state: "failed" },
    );
    await expect(
      fixture.manager.acquireLease({
        model: fixture.model,
        holderId: "job",
        now: at(0),
        ttlMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("shares concurrent leases, blocks new use after disable, and verifies deletion after drain", async () => {
    const fixture = await managerWithModel();
    await fixture.manager.cacheCatalog(fixture.catalog);
    await fixture.manager.install(
      fixture.model,
      async () => fixture.bytes,
      at(0),
    );
    const leases = await Promise.all(
      ["first", "second"].map((holderId) =>
        fixture.manager.acquireLease({
          model: fixture.model,
          holderId,
          now: at(1),
          ttlMs: 600_000,
        }),
      ),
    );
    const first = leases[0]!;
    const second = leases[1]!;

    await fixture.manager.cacheCatalog(
      catalogFor([], at(2), at(20), [fixture.model.id]),
    );
    await expect(
      fixture.manager.acquireLease({
        model: fixture.model,
        holderId: "third",
        now: at(3),
        ttlMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "model_disabled" });
    expect(await fixture.store.getInstallation(fixture.model.id)).toMatchObject(
      { state: "deletion_pending" },
    );

    await fixture.manager.releaseLease(first.lease, at(4));
    expect(await fixture.store.getInstallation(fixture.model.id)).toMatchObject(
      { state: "deletion_pending" },
    );
    await fixture.manager.releaseLease(second.lease, at(5));
    expect(await fixture.store.getInstallation(fixture.model.id)).toMatchObject(
      { state: "deleted", deletedAt: at(5) },
    );
    await expect(readFile(first.modelPath)).rejects.toThrow();
  });

  it("does not disturb a separately verified active package when a replacement download is corrupt", async () => {
    const fixture = await managerWithModel();
    const nextBytes = validPack({ revision: "two" });
    const next = descriptor("argos-es-en-v2", nextBytes);
    await fixture.manager.cacheCatalog(
      catalogFor([fixture.model, next], at(0), at(20)),
    );
    const installed = await fixture.manager.install(
      fixture.model,
      async () => fixture.bytes,
      at(0),
    );

    await expect(
      fixture.manager.install(next, async () => Uint8Array.of(0), at(1)),
    ).rejects.toMatchObject({ code: "artifact_invalid" });
    await expect(readFile(installed.modelPath)).resolves.toEqual(
      Buffer.from(fixture.bytes),
    );
    expect(await fixture.store.getInstallation(fixture.model.id)).toMatchObject(
      { state: "active" },
    );
  });
});

async function managerWithModel() {
  const root = await mkdtemp(join(tmpdir(), "rvc-argos-model-"));
  roots.push(root);
  const bytes = validPack();
  const model = descriptor("argos-es-en-v1", bytes);
  const store = new MemoryLocalArgosModelStore();
  return {
    bytes,
    model,
    store,
    manager: new LocalArgosModelManager({
      rootDirectory: root,
      verifier,
      store,
      supportedRuntimeVersions: ["1.9"],
      maxArtifactBytes: 100_000,
    }),
    catalog: catalogFor([model], at(0), at(5)),
  };
}

function descriptor(id: string, bytes: Uint8Array): ArgosModelDescriptor {
  return {
    id,
    sourceLanguage: "es",
    targetLanguage: "en",
    runtimeFamily: "argos-translate",
    runtimeVersion: "1.9",
    artifactSha256: sha256(bytes),
    byteSize: bytes.byteLength,
    availability: "enabled",
  };
}

function catalogFor(
  models: readonly ArgosModelDescriptor[],
  cachedAt: string,
  expiresAt: string,
  revokedModelIds: readonly string[] = [],
) {
  const payload = {
    contractVersion: 1 as const,
    catalogRevision: 1,
    models: models.map((model) => ({
      id: model.id,
      sourceLanguage: model.sourceLanguage,
      targetLanguage: model.targetLanguage,
      packageVersion: "1.0.0",
      runtimeFamily: model.runtimeFamily,
      ...(model.runtimeVersion ? { runtimeVersion: model.runtimeVersion } : {}),
      artifactSha256: model.artifactSha256,
      byteSize: model.byteSize,
      availability: "enabled" as const,
    })),
    revokedModelIds,
  };
  const canonicalPayload = stableJson(payload);
  const release: SignedCatalogRelease = {
    id: `argos-release:${sha256(canonicalPayload)}`,
    payload,
    canonicalPayload,
    keyId: "test-root",
    signature: digest(new TextEncoder().encode(canonicalPayload)),
  };
  return { release, cachedAt, expiresAt };
}

function validPack(extra: Record<string, unknown> = {}): Uint8Array {
  return storedZip({
    "metadata.json": JSON.stringify({
      argos_version: "1.9",
      license: "MIT",
      provenance: "fixture",
      ...extra,
    }),
    "model.bin": "fixture-model",
  });
}

function at(minutes: number): string {
  return new Date(Date.UTC(2026, 7, 26, 0, minutes)).toISOString();
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}
function sha256(value: string | Uint8Array): string {
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

function storedZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(data.byteLength),
      u32(data.byteLength),
      u16(nameBytes.byteLength),
      u16(0),
      nameBytes,
      data,
    ]);
    chunks.push(local);
    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(data.byteLength),
        u32(data.byteLength),
        u16(nameBytes.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += local.byteLength;
  }
  const centralBytes = concat(central);
  return concat([
    ...chunks,
    centralBytes,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(centralBytes.byteLength),
    u32(offset),
    u16(0),
  ]);
}
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}
function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}
