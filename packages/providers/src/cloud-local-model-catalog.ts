import {
  SignedLocalModelCatalogReleaseSchema,
  type SignedLocalModelCatalogRelease,
} from "@research-video/contracts";

import type { CachedArgosCatalog } from "./local-argos-model-manager.ts";
import type { CatalogVerifier } from "./local-model-argos-catalog.ts";

/**
 * Converts the provider-neutral signed cloud envelope into the local runtime
 * view without changing the bytes covered by the server signature. The model
 * manager verifies both the original envelope and this exact projection.
 */
export function cacheableArgosCatalogFromCloud(
  input: SignedLocalModelCatalogRelease,
  cachedAt: string,
): CachedArgosCatalog {
  const release = SignedLocalModelCatalogReleaseSchema.parse(input);
  const signedPayload = JSON.parse(release.canonicalPayload) as unknown;
  return {
    cachedAt,
    expiresAt: release.expiresAt,
    release: {
      id: release.id,
      keyId: release.signingKeyId,
      signature: release.signatureBase64,
      canonicalPayload: release.canonicalPayload,
      catalogSha256: release.catalogSha256,
      signedPayload,
      payload: {
        contractVersion: 1,
        catalogRevision: release.sequence,
        models: release.versions.map((version) => ({
          id: version.id,
          sourceLanguage: version.sourceLanguage,
          targetLanguage: version.targetLanguage,
          packageVersion: version.packageVersion,
          runtimeFamily: version.runtimeFamily,
          runtimeVersion: version.runtimeVersion,
          artifactSha256: version.artifactSha256,
          byteSize: version.artifactByteSize,
          availability: version.availability.state as
            "enabled" | "enabled_by_override",
        })),
        revokedModelIds: release.revokedVersionIds,
      },
    },
  };
}

export function createEd25519CatalogVerifier(
  trustRoots: Readonly<Record<string, string>>,
): CatalogVerifier {
  const keys = new Map(
    Object.entries(trustRoots).flatMap(([keyId, encoded]) => {
      try {
        const pem = encoded.includes("BEGIN PUBLIC KEY")
          ? encoded
          : Buffer.from(encoded, "base64").toString("utf8");
        const key = createPublicKey(pem);
        return key.asymmetricKeyType === "ed25519"
          ? [[keyId, key] as const]
          : [];
      } catch {
        return [];
      }
    }),
  );
  return {
    async verify(payload, signature, keyId) {
      const key = keys.get(keyId);
      if (!key) return false;
      try {
        return verifySignature(
          null,
          Buffer.from(payload),
          key,
          Buffer.from(signature, "base64"),
        );
      } catch {
        return false;
      }
    },
  };
}
import { createPublicKey, verify as verifySignature } from "node:crypto";
