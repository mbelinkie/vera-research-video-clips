import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SignedLocalModelCatalogRelease } from "@research-video/contracts";

import {
  cacheableArgosCatalogFromCloud,
  createEd25519CatalogVerifier,
} from "./cloud-local-model-catalog.ts";
import { verifyCatalogRelease } from "./local-model-argos-catalog.ts";

describe("cloud local-model catalog projection", () => {
  it("accepts only a configured Ed25519 trust root", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = new TextEncoder().encode("signed catalog");
    const signature = sign(null, payload, privateKey).toString("base64");
    const verifier = createEd25519CatalogVerifier({
      "catalog-root-1": publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    });
    await expect(
      verifier.verify(payload, signature, "catalog-root-1"),
    ).resolves.toBe(true);
    await expect(
      verifier.verify(payload, signature, "different-root"),
    ).resolves.toBe(false);
  });

  it("binds the exact signed cloud envelope to the local runtime descriptor", async () => {
    const publishedAt = "2026-08-27T00:00:00.000Z";
    const expiresAt = "2026-09-03T00:00:00.000Z";
    const version = {
      id: randomUUID(),
      candidateId: randomUUID(),
      evaluationId: randomUUID(),
      sourceLanguage: "es",
      targetLanguage: "en",
      packageVersion: "1.0",
      runtimeFamily: "argos-translate",
      runtimeVersion: "1.9",
      artifactSha256: "a".repeat(64),
      artifactByteSize: 512,
      mirroredArtifactId: "language-model/artifact/fixture",
      availability: {
        state: "enabled" as const,
        version: 1,
        changedAt: publishedAt,
      },
    };
    const signedPayload = {
      contractVersion: 1 as const,
      sequence: 4,
      publishedAt,
      expiresAt,
      versions: [version],
      revokedVersionIds: [],
    };
    const canonicalPayload = stableJson(signedPayload);
    const release: SignedLocalModelCatalogRelease = {
      ...signedPayload,
      id: randomUUID(),
      catalogSha256: sha256(canonicalPayload),
      signingKeyId: "fixture-root",
      signatureBase64: digest(canonicalPayload),
      canonicalPayload,
    };
    const cached = cacheableArgosCatalogFromCloud(release, publishedAt);
    await expect(
      verifyCatalogRelease(cached.release, {
        verify: async (bytes, signature, keyId) =>
          keyId === "fixture-root" &&
          signature === digest(new TextDecoder().decode(bytes)),
      }),
    ).resolves.toBe(true);

    cached.release.payload.models[0]!.artifactSha256 = "b".repeat(64);
    await expect(
      verifyCatalogRelease(cached.release, { verify: async () => true }),
    ).resolves.toBe(false);
  });
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function digest(value: string) {
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
