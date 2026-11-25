import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CatalogVerifier,
  SignedCatalogRelease,
} from "./local-model-argos-catalog.ts";
import {
  LocalArgosModelManager,
  MemoryLocalArgosModelStore,
  type ArgosModelDescriptor,
} from "./local-argos-model-manager.ts";
import { ArgosLocalTranslationProvider } from "./translation-argos-local.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ArgosLocalTranslationProvider", () => {
  it("uses safe argv, keeps text on stdin, and normalizes one-to-one sidecar output", async () => {
    const fixture = await setup();
    await fixture.manager.cacheCatalog(fixture.catalog);
    await fixture.manager.install(
      fixture.model,
      async () => fixture.bytes,
      at(0),
    );
    let invocation: { args: readonly string[]; stdin: string } | undefined;
    const provider = new ArgosLocalTranslationProvider({
      executable: "/private/app/argos-sidecar",
      manager: fixture.manager,
      resolveModel: (source, target) =>
        source === "es" && target === "en" ? fixture.model : undefined,
      now: () => at(1),
      runner: {
        async run(input) {
          invocation = input;
          return `${JSON.stringify({ id: "s1", text: "Hola translated" })}\n${JSON.stringify({ id: "s2", text: "Adiós translated" })}\n`;
        },
      },
    });

    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "en",
        segments: [
          { id: "s1", text: "Hola" },
          { id: "s2", text: "Adiós" },
        ],
      }),
    ).resolves.toEqual({
      provider: "argos-local",
      model: fixture.model.id,
      segments: [
        { sourceSegmentId: "s1", text: "Hola translated" },
        { sourceSegmentId: "s2", text: "Adiós translated" },
      ],
    });
    expect(invocation!.args).toEqual(
      expect.arrayContaining([
        "--input-format",
        "jsonl",
        "--output-format",
        "jsonl",
      ]),
    );
    expect(invocation!.args.join(" ")).not.toContain("Hola");
    expect(invocation!.stdin).toContain('"text":"Hola"');
    expect(await fixture.store.listLeases(fixture.model.id)).toEqual([]);
  });

  it("fails closed on out-of-order sidecar segment output", async () => {
    const fixture = await setup();
    await fixture.manager.cacheCatalog(fixture.catalog);
    await fixture.manager.install(
      fixture.model,
      async () => fixture.bytes,
      at(0),
    );
    const provider = new ArgosLocalTranslationProvider({
      executable: "argos-sidecar",
      manager: fixture.manager,
      resolveModel: () => fixture.model,
      runner: {
        async run() {
          return JSON.stringify({ id: "wrong", text: "no" }) + "\n";
        },
      },
    });
    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "en",
        segments: [{ id: "s1", text: "hola" }],
      }),
    ).rejects.toThrow("mismatched");
  });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "rvc-argos-sidecar-"));
  roots.push(root);
  const bytes = storedZip({
    "metadata.json": JSON.stringify({
      argos_version: "1.9",
      license: "MIT",
      provenance: "fixture",
    }),
    "model.bin": "fixture-model",
  });
  const model: ArgosModelDescriptor = {
    id: "argos-es-en-v1",
    sourceLanguage: "es",
    targetLanguage: "en",
    runtimeFamily: "argos-translate",
    runtimeVersion: "1.9",
    artifactSha256: sha256(bytes),
    byteSize: bytes.byteLength,
    availability: "enabled",
  };
  const payload = {
    contractVersion: 1 as const,
    catalogRevision: 1,
    models: [
      {
        id: model.id,
        sourceLanguage: "es",
        targetLanguage: "en",
        packageVersion: "1.0",
        runtimeFamily: model.runtimeFamily,
        ...(model.runtimeVersion
          ? { runtimeVersion: model.runtimeVersion }
          : {}),
        artifactSha256: model.artifactSha256,
        byteSize: model.byteSize,
        availability: "enabled" as const,
      },
    ],
  };
  const canonicalPayload = stableJson(payload);
  const catalog = {
    release: {
      id: `argos-release:${sha256(canonicalPayload)}`,
      payload,
      canonicalPayload,
      keyId: "test-root",
      signature: createHash("sha256")
        .update(canonicalPayload)
        .digest("base64url"),
    } satisfies SignedCatalogRelease,
    cachedAt: at(0),
    expiresAt: at(10),
  };
  const store = new MemoryLocalArgosModelStore();
  const verifier: CatalogVerifier = {
    async verify(bytes, signature, keyId) {
      return (
        keyId === "test-root" &&
        signature === createHash("sha256").update(bytes).digest("base64url")
      );
    },
  };
  return {
    bytes,
    model,
    catalog,
    store,
    manager: new LocalArgosModelManager({
      rootDirectory: root,
      store,
      supportedRuntimeVersions: ["1.9"],
      verifier,
    }),
  };
}
function at(minutes: number) {
  return new Date(Date.UTC(2026, 7, 26, 0, minutes)).toISOString();
}
function sha256(value: string | Uint8Array) {
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
function concat(chunks: readonly Uint8Array[]) {
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
function u16(value: number) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}
function u32(value: number) {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}
