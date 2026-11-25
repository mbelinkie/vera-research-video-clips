import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SignedLocalModelCatalogRelease } from "@research-video/contracts";

import {
  LocalArgosModelManager,
  MemoryLocalArgosModelStore,
} from "./local-argos-model-manager.ts";
import { CloudManagedArgosTranslationProvider } from "./translation-argos-cloud-managed.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("CloudManagedArgosTranslationProvider", () => {
  it("downloads only the authenticated, release-bound direct route and executes it locally", async () => {
    const fixture = await setup([{ source: "es", target: "fr" }]);
    const fetch = cloudFetch(fixture);
    const runner = localRunner();
    const provider = fixture.provider(fetch, runner);

    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "fr",
        segments: [{ id: "s1", text: "Hola" }],
      }),
    ).resolves.toEqual({
      provider: "cloud-managed-argos-local",
      model: fixture.models[0]!.id,
      segments: [{ sourceSegmentId: "s1", text: "[fr] Hola" }],
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        "https://control.example/api/local-model-catalog",
        expect.stringContaining("/download"),
        `https://object.example/${fixture.models[0]!.id}`,
      ]),
    );
    const authenticated = fetch.mock.calls.filter(([url]) =>
      String(url).startsWith("https://control.example/"),
    );
    expect((authenticated[0]![1] as RequestInit).headers).toEqual({
      authorization: "Bearer fixture-token",
    });
    expect(
      fetch.mock.calls.map(([url]) => String(url)).join(" "),
    ).not.toContain("upstream");
  });

  it("uses exactly two local legs through English when no direct model exists", async () => {
    const fixture = await setup([
      { source: "es", target: "en" },
      { source: "en", target: "fr" },
    ]);
    const runner = localRunner();
    const provider = fixture.provider(cloudFetch(fixture), runner);

    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "fr",
        segments: [{ id: "s1", text: "Hola" }],
      }),
    ).resolves.toMatchObject({
      model: `${fixture.models[0]!.id}+${fixture.models[1]!.id}`,
      segments: [{ sourceSegmentId: "s1", text: "[fr] [en] Hola" }],
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("publishes direct and exactly two-hop English routes to synchronous preflight", async () => {
    const fixture = await setup([
      { source: "es", target: "en" },
      { source: "en", target: "fr" },
    ]);
    const provider = fixture.provider(cloudFetch(fixture), localRunner());

    expect(provider.checkLanguagePair("es", "fr")).toMatchObject({
      state: "unknown",
    });
    expect(provider.getTranslationProvenance("es", "fr")).toBeUndefined();
    await provider.initialize();
    expect(provider.checkLanguagePair("es", "fr")).toMatchObject({
      state: "supported",
    });
    expect(provider.getTranslationProvenance("es", "fr")).toEqual({
      provider: "cloud-managed-argos-local",
      model: `${fixture.models[0]!.id}+${fixture.models[1]!.id}`,
    });
    expect(provider.getTranslationProvenance("es-ES", "fr-CA")).toEqual({
      provider: "cloud-managed-argos-local",
      model: `${fixture.models[0]!.id}+${fixture.models[1]!.id}`,
    });
    expect(provider.checkLanguagePair("fr", "es")).toMatchObject({
      state: "unsupported",
      reason: "language_not_supported",
    });
  });

  it("continues with an installed verified model when the catalog is stale and the cloud is offline", async () => {
    const fixture = await setup([{ source: "es", target: "fr" }]);
    const online = cloudFetch(fixture);
    const runner = localRunner();
    const provider = fixture.provider(online, runner, () => at(0));
    await provider.translate({
      sourceLanguage: "es",
      targetLanguage: "fr",
      segments: [{ id: "s1", text: "Hola" }],
    });
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    const stale = fixture.provider(offline as typeof fetch, runner, () =>
      at(10),
    );

    await expect(
      stale.translate({
        sourceLanguage: "es",
        targetLanguage: "fr",
        segments: [{ id: "s2", text: "Adiós" }],
      }),
    ).resolves.toMatchObject({
      segments: [{ sourceSegmentId: "s2", text: "[fr] Adiós" }],
    });
    expect(offline).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered download descriptor before requesting its target", async () => {
    const fixture = await setup([{ source: "es", target: "fr" }]);
    const fetch = cloudFetch(fixture, { descriptorSha256: "b".repeat(64) });
    const provider = fixture.provider(fetch, localRunner());

    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "fr",
        segments: [{ id: "s1", text: "Hola" }],
      }),
    ).rejects.toThrow("artifact_invalid");
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).startsWith("https://object.example/"),
      ),
    ).toBe(false);
  });

  it("rejects altered artifact bytes and never runs the local sidecar", async () => {
    const fixture = await setup([{ source: "es", target: "fr" }]);
    const runner = localRunner();
    const provider = fixture.provider(
      cloudFetch(fixture, { artifact: Uint8Array.of(1, 2, 3) }),
      runner,
    );

    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "fr",
        segments: [{ id: "s1", text: "Hola" }],
      }),
    ).rejects.toThrow("artifact_invalid");
    expect(runner).not.toHaveBeenCalled();
  });
});

async function setup(routes: Array<{ source: string; target: string }>) {
  const root = await mkdtemp(join(tmpdir(), "rvc-cloud-argos-"));
  roots.push(root);
  const models = routes.map((route, index) => {
    const bytes = pack(`revision-${index}`);
    return {
      id: randomUUID(),
      sourceLanguage: route.source,
      targetLanguage: route.target,
      packageVersion: "1.0",
      runtimeFamily: "argos-translate",
      runtimeVersion: "1.9",
      artifactSha256: sha256(bytes),
      artifactByteSize: bytes.byteLength,
      mirroredArtifactId: `model/${index}`,
      availability: { state: "enabled" as const, version: 1, changedAt: at(0) },
      bytes,
    };
  });
  const payload = {
    contractVersion: 1 as const,
    sequence: 1,
    publishedAt: at(0),
    expiresAt: at(5),
    versions: models.map(({ bytes: _bytes, ...model }) => ({
      candidateId: randomUUID(),
      evaluationId: randomUUID(),
      ...model,
    })),
    revokedVersionIds: [],
  };
  const canonicalPayload = stableJson(payload);
  const release: SignedLocalModelCatalogRelease = {
    ...payload,
    id: randomUUID(),
    catalogSha256: sha256(canonicalPayload),
    signingKeyId: "fixture-root",
    signatureBase64: digest(canonicalPayload),
    canonicalPayload,
  };
  const manager = new LocalArgosModelManager({
    rootDirectory: root,
    store: new MemoryLocalArgosModelStore(),
    supportedRuntimeVersions: ["1.9"],
    verifier: {
      verify: async (bytes, signature, keyId) =>
        keyId === "fixture-root" &&
        signature === digest(new TextDecoder().decode(bytes)),
    },
  });
  return {
    manager,
    models,
    release,
    provider(
      fetch: typeof globalThis.fetch,
      runner: ReturnType<typeof localRunner>,
      now = () => at(0),
    ) {
      return new CloudManagedArgosTranslationProvider({
        baseUrl: "https://control.example",
        authorizationProvider: {
          authorizationHeader: async () => "Bearer fixture-token",
        },
        manager,
        executable: "argos-sidecar",
        runner: { run: runner },
        fetch,
        now,
      });
    },
  };
}

function cloudFetch(
  fixture: Awaited<ReturnType<typeof setup>>,
  overrides: { descriptorSha256?: string; artifact?: Uint8Array } = {},
) {
  return vi.fn(async (input: URL | RequestInfo, _init?: RequestInit) => {
    const url = String(input);
    if (url === "https://control.example/api/local-model-catalog")
      return json(fixture.release);
    const version = fixture.models.find((model) => url.includes(model.id));
    if (version && url.includes("/download")) {
      return json({
        catalogReleaseId: fixture.release.id,
        versionId: version.id,
        artifactSha256: overrides.descriptorSha256 ?? version.artifactSha256,
        artifactByteSize: version.artifactByteSize,
        downloadUrl: `https://object.example/${version.id}`,
        expiresAt: at(4),
      });
    }
    const artifact = fixture.models.find(
      (model) => url === `https://object.example/${model.id}`,
    );
    if (artifact)
      return new Response(Buffer.from(overrides.artifact ?? artifact.bytes), {
        status: 200,
      });
    return new Response("missing", { status: 404 });
  });
}

function localRunner() {
  return vi.fn(async (input: { args: readonly string[]; stdin: string }) => {
    const target = input.args[input.args.indexOf("--target-language") + 1]!;
    return (
      input.stdin
        .trim()
        .split("\n")
        .map((line) => {
          const value = JSON.parse(line) as { id: string; text: string };
          return JSON.stringify({
            id: value.id,
            text: `[${target}] ${value.text}`,
          });
        })
        .join("\n") + "\n"
    );
  });
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function at(minutes: number) {
  return new Date(Date.UTC(2026, 7, 27, 0, minutes)).toISOString();
}
function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("base64");
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
function pack(revision: string): Uint8Array {
  return storedZip({
    "metadata.json": JSON.stringify({
      argos_version: "1.9",
      license: "MIT",
      provenance: "fixture",
      revision,
    }),
    "model.bin": "fixture-model",
  });
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
