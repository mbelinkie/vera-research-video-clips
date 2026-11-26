import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ArgosLocalModelCatalog,
  LocalModelCatalogError,
  verifyCatalogRelease,
  type CatalogSigner,
  type CatalogVerifier,
} from "./local-model-argos-catalog.ts";

const signer: CatalogSigner & CatalogVerifier = {
  keyId: "test-root-v1",
  async sign(bytes) {
    return digest(bytes);
  },
  async verify(bytes, signature, keyId) {
    return keyId === this.keyId && signature === digest(bytes);
  },
};

function catalog() {
  return new ArgosLocalModelCatalog({
    sourceUrl: "https://example.test/argos/index.json",
    runtimeFamily: "argos-translate",
    supportedRuntimeVersions: ["1.9"],
    maxArtifactBytes: 100_000,
    signer,
  });
}

function index(
  url = "https://example.test/es-en.argosmodel",
  version = "1.0.0",
) {
  return JSON.stringify([
    {
      from_code: "es",
      to_code: "en",
      package_version: version,
      package_url: url,
    },
  ]);
}

function validPack(metadata: Record<string, unknown> = {}) {
  return storedZip({
    "metadata.json": JSON.stringify({
      argos_version: "1.9",
      license: "MIT",
      provenance: "fixture",
      ...metadata,
    }),
    "model.bin": "fixture-model",
  });
}

async function evaluated(
  catalogue: ArgosLocalModelCatalog,
  bytes = validPack(),
  version = "1.0.0",
) {
  const { candidates } = catalogue.discover(
    index(undefined, version),
    "2026-08-26T00:00:00.000Z",
  );
  return catalogue.evaluate(
    candidates[0]!,
    async () => bytes,
    "2026-08-26T00:01:00.000Z",
  );
}

describe("ArgosLocalModelCatalog", () => {
  it("snapshots mutable feed bytes and gives each candidate an immutable identity", () => {
    const catalogue = catalog();
    const first = catalogue.discover(
      index("https://example.test/first.argosmodel"),
      "2026-08-26T00:00:00.000Z",
    );
    const changed = catalogue.discover(
      index("https://example.test/changed.argosmodel"),
      "2026-08-26T01:00:00.000Z",
    );

    expect(first.snapshot.id).not.toBe(changed.snapshot.id);
    expect(first.candidates[0]!.id).not.toBe(changed.candidates[0]!.id);
    expect(first.candidates[0]).toMatchObject({
      artifactUrl: "https://example.test/first.argosmodel",
      sourceLanguage: "es",
      targetLanguage: "en",
    });
    expect(first.snapshot.rawFeed).toContain("first.argosmodel");
  });

  it("rejects unsafe archives as hard findings that cannot be overridden", async () => {
    const catalogue = catalog();
    const evaluation = await evaluated(
      catalogue,
      storedZip({
        "metadata.json": JSON.stringify({
          argos_version: "1.9",
          license: "MIT",
          provenance: "fixture",
        }),
        "../escape": "no",
        "model.bin": "model",
      }),
    );
    catalogue.register(evaluation);

    expect(evaluation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe_archive_path",
          severity: "hard",
        }),
      ]),
    );
    expect(() =>
      catalogue.enable(
        evaluation.id,
        "admin-1",
        "2026-08-26T00:02:00.000Z",
        "please allow it",
      ),
    ).toThrow(LocalModelCatalogError);
  });

  it("requires and records a reason to enable a hard-safe but not-recommended package", async () => {
    const catalogue = catalog();
    const evaluation = await evaluated(
      catalogue,
      validPack({ license: undefined, provenance: undefined }),
    );
    catalogue.register(evaluation);

    expect(() =>
      catalogue.enable(evaluation.id, "admin-1", "2026-08-26T00:02:00.000Z"),
    ).toThrow("audited override reason");
    const enabled = catalogue.enable(
      evaluation.id,
      "admin-1",
      "2026-08-26T00:03:00.000Z",
      "license review accepted for internal pilot",
    );
    expect(enabled.availability).toBe("enabled_by_override");
    expect(enabled.audit.at(-1)).toMatchObject({
      action: "enable_override",
      reason: "license review accepted for internal pilot",
    });
  });

  it("maintains one active directed pair/runtime, derives English routes, and supports disable/revoke/rollback", async () => {
    const catalogue = catalog();
    const first = catalogue.register(
      await evaluated(catalogue, validPack(), "1.0.0"),
    );
    const second = catalogue.register(
      await evaluated(catalogue, validPack({ model_revision: "2" }), "2.0.0"),
    );

    catalogue.enable(
      first.evaluation.id,
      "admin-1",
      "2026-08-26T00:02:00.000Z",
    );
    catalogue.enable(
      second.evaluation.id,
      "admin-1",
      "2026-08-26T00:03:00.000Z",
    );
    expect(catalogue.get(first.evaluation.id)!.availability).toBe("disabled");
    expect(catalogue.enabledEnglishHubRoutes()).toEqual([
      {
        sourceLanguage: "es",
        targetLanguage: "en",
        modelId: second.evaluation.id,
      },
    ]);

    catalogue.disable(
      second.evaluation.id,
      "admin-1",
      "2026-08-26T00:04:00.000Z",
      "hold downloads while validating",
    );
    expect(catalogue.enabledEnglishHubRoutes()).toEqual([]);
    catalogue.rollback(
      first.evaluation.id,
      "admin-1",
      "2026-08-26T00:05:00.000Z",
      "return to verified prior package",
    );
    expect(catalogue.get(first.evaluation.id)!.availability).toBe("enabled");
    catalogue.revoke(
      first.evaluation.id,
      "admin-1",
      "2026-08-26T00:06:00.000Z",
      "artifact compromise",
    );
    expect(catalogue.get(first.evaluation.id)!.availability).toBe("revoked");
    expect(() =>
      catalogue.rollback(
        first.evaluation.id,
        "admin-1",
        "2026-08-26T00:07:00.000Z",
        "undo",
      ),
    ).toThrow("not eligible");
  });

  it("publishes deterministic signed immutable releases and detects tampering", async () => {
    const catalogue = catalog();
    const version = catalogue.register(await evaluated(catalogue));
    catalogue.enable(
      version.evaluation.id,
      "admin-1",
      "2026-08-26T00:02:00.000Z",
    );

    const first = await catalogue.publish();
    const repeat = await catalogue.publish();
    expect(repeat).toBe(first);
    await expect(verifyCatalogRelease(first, signer)).resolves.toBe(true);
    await expect(
      verifyCatalogRelease(
        { ...first, canonicalPayload: `${first.canonicalPayload} ` },
        signer,
      ),
    ).resolves.toBe(false);
    expect(first.payload.models).toEqual([
      expect.objectContaining({
        id: version.evaluation.id,
        availability: "enabled",
        artifactSha256: version.evaluation.artifactSha256,
      }),
    ]);
  });
});

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
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
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
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
