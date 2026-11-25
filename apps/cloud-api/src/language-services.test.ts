import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import { LanguageServiceControlPlane } from "@research-video/catalog/language-services";
import type {
  AuthenticatedActor,
  CloudProviderDescriptor,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { createCloudApi, type CloudApiDependencies } from "./app.ts";

const resources: Array<{ app: ReturnType<typeof createCloudApi>; db: PGlite }> =
  [];

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ app, db }) => {
      await app.close();
      await db.close();
    }),
  );
});

function descriptor(id: string, service: "translation" | "transcription") {
  return {
    id,
    service,
    displayName: `${id} fixture`,
    adapterContractVersion: 1,
    configurationRevision: "fixture-config-1",
    capabilityRevision: "fixture-capability-1",
    supportedLanguages: [
      {
        language: "en",
        roles: ["source", "target"],
        supportsAutoDetection: false,
      },
    ],
    inputModes: service === "translation" ? ["text_segments"] : ["object_uri"],
    disclosure: {
      version: 1,
      title: `${id} disclosure`,
      summary: "Data leaves the workstation only after explicit approval.",
      dataCategories:
        service === "translation" ? ["transcript_text"] : ["audio_media"],
      publishedAt: "2026-08-26T12:00:00.000Z",
    },
    pricing: {
      currency: "USD",
      unit: service === "translation" ? "characters" : "audio_seconds",
      amountMicros: 1,
      quantity: 1,
      effectiveAt: "2026-08-26T12:00:00.000Z",
    },
    state: "enabled",
  } satisfies CloudProviderDescriptor;
}

async function fixture(
  localModelArtifactDownloads?: CloudApiDependencies["localModelArtifactDownloads"],
) {
  const db = new PGlite();
  await runCloudMigrations(db);
  const catalog = new SharedProjectCatalog(
    db,
    new MemoryTranscriptObjectStore(),
    () => new Date("2026-08-26T15:00:00.000Z"),
  );
  const admin: AuthenticatedActor = {
    userId: randomUUID(),
    externalSubject: "fixture:platform-admin",
    platformCapabilities: ["manage_language_services"],
  };
  const user: AuthenticatedActor = {
    userId: randomUUID(),
    externalSubject: "fixture:user",
  };
  await catalog.registerUser(admin, "Platform Admin", "platform_admin");
  await catalog.registerUser(user, "Research User", "research_user");
  const controlPlane = new LanguageServiceControlPlane(
    db,
    () => new Date("2026-08-26T15:00:00.000Z"),
  );
  await controlPlane.synchronizeDeployedProviders([
    descriptor("third-translate", "translation"),
    descriptor("third-transcribe", "transcription"),
  ]);
  const app = createCloudApi({
    catalog,
    languageServices: controlPlane,
    ...(localModelArtifactDownloads ? { localModelArtifactDownloads } : {}),
    authenticate: async (request) => {
      const token = request.headers.authorization;
      if (token === "Bearer admin") return admin;
      if (token === "Bearer user") return user;
      throw new Error("fixture authentication failed");
    },
    videoMetadataProvider: {
      resolve: async (videoId) => ({
        videoId,
        title: "Provider policy fixture",
        channel: "Fixture channel",
        sourceLanguage: "en",
      }),
    },
  });
  resources.push({ app, db });
  return { app, db, catalog, controlPlane, admin, user };
}

describe("provider-neutral language-service API", () => {
  it("requires platform authority and renders arbitrary deployed providers", async () => {
    const { app } = await fixture();
    const denied = await app.inject({
      method: "GET",
      url: "/api/admin/language-service-providers",
      headers: { authorization: "Bearer user" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("platform_access_denied");

    const adminList = await app.inject({
      method: "GET",
      url: "/api/admin/language-service-providers",
      headers: { authorization: "Bearer admin" },
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: expect.objectContaining({
            id: "third-translate",
            state: "draft",
          }),
        }),
        expect.objectContaining({
          descriptor: expect.objectContaining({ id: "third-transcribe" }),
        }),
      ]),
    );
  });

  it("supports provider-specific request, approval, and one-time launch grant", async () => {
    const { app } = await fixture();
    const enable = await app.inject({
      method: "POST",
      url: "/api/admin/language-service-providers/third-transcribe/state",
      headers: { authorization: "Bearer admin" },
      payload: {
        state: "enabled",
        expectedVersion: 1,
        idempotencyKey: "enable-third-transcribe",
      },
    });
    expect(enable.statusCode).toBe(200);

    const providers = await app.inject({
      method: "GET",
      url: "/api/language-service-providers",
      headers: { authorization: "Bearer user" },
    });
    expect(providers.json()).toEqual([
      expect.objectContaining({
        id: "third-transcribe",
        service: "transcription",
      }),
    ]);

    const requested = await app.inject({
      method: "POST",
      url: "/api/account/cloud-provider-requests",
      headers: { authorization: "Bearer user" },
      payload: {
        providerId: "third-transcribe",
        service: "transcription",
        disclosureVersion: 1,
        consentAccepted: true,
        idempotencyKey: "request-third-transcribe",
      },
    });
    expect(requested.statusCode).toBe(201);
    const request = requested.json();

    const decided = await app.inject({
      method: "POST",
      url: `/api/admin/cloud-provider-requests/${request.id}/decision`,
      headers: { authorization: "Bearer admin" },
      payload: {
        action: "approve",
        expectedVersion: 1,
        idempotencyKey: "approve-third-transcribe",
      },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().state).toBe("approved");

    const granted = await app.inject({
      method: "POST",
      url: "/api/account/cloud-provider-launch-grants",
      headers: { authorization: "Bearer user" },
      payload: {
        providerId: "third-transcribe",
        service: "transcription",
        accessRequestId: request.id,
        expectedAccessVersion: 2,
        idempotencyKey: "grant-third-transcribe",
      },
    });
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({
      providerId: "third-transcribe",
      service: "transcription",
      version: 1,
    });
    expect(granted.json().grantReference).toMatch(/^lsg_/u);
  });

  it("persists the exact approved transcription provider on a new batch", async () => {
    const { app, db, catalog, admin, user } = await fixture();
    const project = await catalog.createProject(user, {
      name: "Provider-specific batch",
    });
    await app.inject({
      method: "POST",
      url: "/api/admin/language-service-providers/third-transcribe/state",
      headers: { authorization: "Bearer admin" },
      payload: {
        state: "enabled",
        expectedVersion: 1,
        idempotencyKey: "enable-batch-provider",
      },
    });
    const requested = await app.inject({
      method: "POST",
      url: "/api/account/cloud-provider-requests",
      headers: { authorization: "Bearer user" },
      payload: {
        providerId: "third-transcribe",
        service: "transcription",
        disclosureVersion: 1,
        consentAccepted: true,
        idempotencyKey: "request-batch-provider",
      },
    });
    const access = requested.json();
    await app.inject({
      method: "POST",
      url: `/api/admin/cloud-provider-requests/${access.id}/decision`,
      headers: { authorization: "Bearer admin" },
      payload: {
        action: "approve",
        expectedVersion: 1,
        idempotencyKey: "approve-batch-provider",
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/account/cloud-provider-launch-grants",
      headers: { authorization: "Bearer user" },
      payload: {
        providerId: "third-transcribe",
        service: "transcription",
        accessRequestId: access.id,
        expectedAccessVersion: 2,
        idempotencyKey: "launch-batch-provider",
      },
    });

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/transcription-batches`,
      headers: { authorization: "Bearer user" },
      payload: {
        name: "Cloud selected batch",
        inputs: ["M7lc1UVf-VE"],
        sourcePolicy: "force-generate",
        transcriptionExecutionPolicy: {
          schemaVersion: 1,
          execution: "cloud",
          providerId: "third-transcribe",
          fallback: "local",
        },
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().batch.transcriptionExecutionPolicy).toEqual({
      schemaVersion: 1,
      execution: "cloud",
      providerId: "third-transcribe",
      fallback: "local",
    });
    const stored = await db.query<{
      transcription_access_request_id: string;
    }>(
      "SELECT transcription_access_request_id FROM transcription_batches WHERE id = $1",
      [created.json().batch.id],
    );
    expect(stored.rows[0]?.transcription_access_request_id).toBe(access.id);
    expect(admin.userId).not.toBe(user.userId);
  });

  it("serves a bounded authenticated in-memory model target only before its expiry", async () => {
    const bytes = new TextEncoder().encode("fixture-argos-pack");
    const read = vi.fn(async () => ({
      bytes,
      contentType: "application/octet-stream",
    }));
    const releaseId = randomUUID();
    const versionId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { app, controlPlane } = await fixture({
      issue: async () => ({
        downloadUrl: `https://api.example.test/api/local-model-catalog/${releaseId}/versions/${versionId}/artifact?expiresAt=${encodeURIComponent(expiresAt)}`,
        expiresAt,
      }),
      read,
    });
    vi.spyOn(controlPlane, "getLocalModelArtifactSource").mockResolvedValue({
      catalogReleaseId: releaseId,
      versionId,
      mirroredArtifactId: "models/fixture.argosmodel",
      artifactSha256: "a".repeat(64),
      artifactByteSize: bytes.byteLength,
    });

    const descriptor = await app.inject({
      method: "GET",
      url: `/api/local-model-catalog/${releaseId}/versions/${versionId}/download`,
      headers: { authorization: "Bearer user" },
    });
    expect(descriptor.statusCode).toBe(200);
    expect(descriptor.json()).toMatchObject({
      catalogReleaseId: releaseId,
      versionId,
      expiresAt,
    });

    const artifact = await app.inject({
      method: "GET",
      url: `/api/local-model-catalog/${releaseId}/versions/${versionId}/artifact?expiresAt=${encodeURIComponent(expiresAt)}`,
      headers: { authorization: "Bearer user" },
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.rawPayload).toEqual(Buffer.from(bytes));
    expect(read).toHaveBeenCalledOnce();

    const expired = await app.inject({
      method: "GET",
      url: `/api/local-model-catalog/${releaseId}/versions/${versionId}/artifact?expiresAt=${encodeURIComponent(new Date(Date.now() - 1_000).toISOString())}`,
      headers: { authorization: "Bearer user" },
    });
    expect(expired.statusCode).toBe(410);
    expect(read).toHaveBeenCalledOnce();
  });
});
