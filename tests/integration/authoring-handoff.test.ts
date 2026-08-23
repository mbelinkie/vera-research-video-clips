import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SharedProjectCatalog } from "@research-video/catalog";
import { LocalAuthoringArtifactDescriptorSchema } from "@research-video/contracts";
import { createCloudApi } from "../../apps/cloud-api/src/app.ts";
import { createLocalAgent } from "../../apps/local-agent/src/app.ts";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

describe("simulated same-workstation authoring client", () => {
  it("searches, resolves, reuses verified local bytes, and requests one missing build", async () => {
    const projectId = randomUUID();
    const clipId = randomUUID();
    const missingClipId = randomUUID();
    const artifactVersionId = randomUUID();
    const locatorId = randomUUID();
    const requestId = randomUUID();
    const packageIdentity = `clip-${requestId}`;
    const authorization = "Bearer authoring-session";
    const root = await mkdtemp(join(tmpdir(), "authoring-client-"));
    temporaryRoots.add(root);
    const packagePath = join(root, packageIdentity);
    const destination = join(root, "authoring-copy");
    await Promise.all([mkdir(packagePath), mkdir(destination)]);
    const roles = [
      "video_mp4",
      "clip_metadata_json",
      "thumbnail_jpg",
      "manifest_json",
    ] as const;
    const artifacts = [];
    for (const role of roles) {
      const bytes = Buffer.from(`verified-${role}`);
      const absolutePath = join(packagePath, `${role}.fixture`);
      await writeFile(absolutePath, bytes);
      artifacts.push({
        role,
        absolutePath,
        byteSize: bytes.byteLength,
        contentSha256: digest(bytes),
      });
    }
    const manifest = artifacts.find(
      (artifact) => artifact.role === "manifest_json",
    )!;
    const descriptor = LocalAuthoringArtifactDescriptorSchema.parse({
      schemaVersion: 1,
      projectId,
      clipId,
      artifactVersionId,
      requestId,
      locatorId,
      packageIdentity,
      resultFingerprint: "a".repeat(64),
      manifest: {
        schemaVersion: 2,
        contentSha256: manifest.contentSha256,
      },
      packagePath,
      artifacts,
    });
    const requirements = compatibilityRequirements(clipId);
    const listClipLibrary = vi.fn(async () => ({
      entries: [{ clip: { id: clipId } }, { clip: { id: missingClipId } }],
    }));
    const listArtifactVersionHistory = vi.fn(async () => ({
      versions: [{ artifactVersionId }],
    }));
    const resolveArtifactVersionCompatibility = vi.fn(async () => ({
      state: "candidate" as const,
      version: { artifactVersionId },
    }));
    const actor = { userId: randomUUID(), externalSubject: "authoring:test" };
    const cloud = createCloudApi({
      catalog: {
        listClipLibrary,
        listArtifactVersionHistory,
        resolveArtifactVersionCompatibility,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    const createAuthoringArtifactDescriptor = vi.fn(async () => descriptor);
    const prepareAuthoringExport = vi.fn(async () => ({
      preflightFingerprint: "b".repeat(64),
    })) as never;
    const submitAuthoringExport = vi.fn(async () => ({
      kind: "individual" as const,
      request: { id: randomUUID(), requestOrigin: "authoring_build" as const },
    })) as never;
    const local = createLocalAgent({
      createAuthoringArtifactDescriptor,
      prepareAuthoringExport,
      submitAuthoringExport,
    });

    const search = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clip-library?completed=yes`,
      headers: { authorization },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({
      entries: [{ clip: { id: clipId } }, { clip: { id: missingClipId } }],
    });
    const history = await cloud.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${clipId}/artifact-versions`,
      headers: { authorization },
    });
    expect(history.json()).toEqual({ versions: [{ artifactVersionId }] });
    const compatible = await cloud.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${clipId}/artifact-versions/${artifactVersionId}/compatibility`,
      headers: { authorization },
      payload: { requirements },
    });
    expect(compatible.json()).toMatchObject({ state: "candidate" });
    const handoff = await local.inject({
      method: "POST",
      url: `/api/authoring/projects/${projectId}/clips/${clipId}/artifact-descriptor`,
      headers: { authorization },
      payload: { artifactVersionId, locatorId, requirements },
    });
    expect(handoff.statusCode).toBe(200);
    const received = LocalAuthoringArtifactDescriptorSchema.parse(
      handoff.json(),
    );
    for (const artifact of received.artifacts) {
      const copied = join(destination, artifact.role);
      await copyFile(artifact.absolutePath, copied);
      expect(digest(await readFile(copied))).toBe(artifact.contentSha256);
      expect(digest(await readFile(artifact.absolutePath))).toBe(
        artifact.contentSha256,
      );
    }

    const exportRequest = {
      clipIds: [missingClipId],
      settingsSelection: {
        base: "application_default" as const,
        overrides: {},
      },
    };
    const preflight = await local.inject({
      method: "POST",
      url: `/api/authoring/projects/${projectId}/export-preflight`,
      headers: { authorization },
      payload: exportRequest,
    });
    expect(preflight.statusCode).toBe(200);
    const submitted = await local.inject({
      method: "POST",
      url: `/api/authoring/projects/${projectId}/exports`,
      headers: { authorization },
      payload: {
        ...exportRequest,
        expectedPreflightFingerprint: "b".repeat(64),
        confirmUnknownSourceSizes: true,
      },
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json()).toMatchObject({
      request: { requestOrigin: "authoring_build" },
    });
    expect(createAuthoringArtifactDescriptor).toHaveBeenCalledTimes(1);
    expect(prepareAuthoringExport).toHaveBeenCalledTimes(1);
    expect(submitAuthoringExport).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify([search.json(), history.json(), compatible.json()]),
    ).not.toContain(root);

    await Promise.all([cloud.close(), local.close()]);
  });
});

function compatibilityRequirements(clipId: string) {
  return {
    clipId,
    selection: {
      trackId: randomUUID(),
      transcriptVersion: 1,
      firstSegmentId: randomUUID(),
      lastSegmentId: randomUUID(),
      transcriptStartMs: 1_000,
      transcriptEndMs: 2_000,
      exportStartMs: 1_000,
      exportEndMs: 2_000,
      timingPrecision: "word" as const,
    },
    resolvedBounds: { startMs: 1_000, endMs: 2_000 },
    sourceLanguageClass: "confirmed_english" as const,
    subtitlePolicy: { requiredSidecars: ["english" as const] },
    requiredArtifactRoles: [
      "video_mp4" as const,
      "clip_metadata_json" as const,
      "thumbnail_jpg" as const,
      "manifest_json" as const,
    ],
    acceptedManifestSchemas: [2 as const],
    settings: {
      mode: "exact_fingerprint" as const,
      resolutionFingerprint: "c".repeat(64),
    },
  };
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
