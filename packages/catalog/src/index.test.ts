import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthenticatedActor,
  TranscriptManifest,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { SharedProjectCatalog } from "./index.ts";

const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("claimed transcript finalization", () => {
  it("atomically activates the version, completes the claimed job, and readies linked items", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const store = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(database, store);
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:worker-owner",
    };
    await catalog.registerUser(actor, "Worker owner");
    const project = await catalog.createProject(actor, {
      name: "Worker project",
    });
    const created = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Worker batch",
      options: {
        targetLanguage: "en",
        transcriptionProfile: "default",
        sourcePolicy: "prefer-existing",
        executionLocation: "local",
        priority: "normal",
      },
      items: [
        {
          inputIndex: 0,
          input: "https://youtu.be/M7lc1UVf-VE",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "M7lc1UVf-VE",
          canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
          title: "Fixture video",
        },
      ],
    });
    const item = created.items[0]!;
    const claimed = await catalog.claimTranscriptionJob(actor, "local", 120);
    expect(claimed?.job.id).toBe(item.jobId);

    const lineageId = randomUUID();
    const grant = await catalog.createClaimedTranscriptUpload(
      actor,
      claimed!.job.id,
      claimed!.lease.attempt,
      {
        lineageId,
        version: 1,
        artifactTypes: ["english-normalized", "english-srt"],
      },
    );
    const storedArtifacts = [];
    for (const type of ["english-normalized", "english-srt"] as const) {
      const target = grant.targets.find(
        (candidate) => candidate.type === type,
      )!;
      const bytes = new TextEncoder().encode(
        type === "english-srt"
          ? "1\n00:00:00,000 --> 00:00:01,000\nFixture\n"
          : JSON.stringify({ fixture: true }),
      );
      const stored = await store.put({
        key: target.objectKey,
        bytes,
        contentType:
          type === "english-srt" ? "application/x-subrip" : "application/json",
        sha256: digest(bytes),
      });
      storedArtifacts.push({
        type,
        objectKey: stored.key,
        objectVersionId: stored.versionId,
        byteSize: bytes.byteLength,
        sha256: stored.sha256,
      });
    }
    const transcriptVersionId = randomUUID();
    const manifest: TranscriptManifest = {
      schemaVersion: 1,
      id: transcriptVersionId,
      projectId: project.id,
      catalogVideoId: item.catalogVideoId!,
      videoId: "M7lc1UVf-VE",
      lineageId,
      version: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      timingPrecision: "cue",
      provider: "fixture",
      normalizationSchemaVersion: 1,
      jobId: claimed!.job.id,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
      artifacts: storedArtifacts,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestTarget = grant.targets.find(
      (candidate) => candidate.type === "manifest",
    )!;
    const manifestStored = await store.put({
      key: manifestTarget.objectKey,
      bytes: manifestBytes,
      contentType: "application/json",
      sha256: digest(manifestBytes),
    });
    const finalized = await catalog.finalizeTranscript(
      actor,
      {
        uploadId: grant.uploadId,
        idempotencyKey: `finalize:${transcriptVersionId}`,
        manifest: {
          type: "manifest",
          objectKey: manifestStored.key,
          objectVersionId: manifestStored.versionId,
          byteSize: manifestBytes.byteLength,
          sha256: manifestStored.sha256,
        },
      },
      { jobId: claimed!.job.id, attempt: claimed!.lease.attempt },
    );

    expect(finalized.transcriptVersionId).toBe(transcriptVersionId);
    const batch = await catalog.getTranscriptionBatch(
      actor,
      project.id,
      created.batch.id,
    );
    expect(batch.items[0]).toMatchObject({
      state: "ready_for_review",
      activeTranscriptVersionId: transcriptVersionId,
      reviewStatus: "unreviewed",
    });
    expect(
      await catalog.claimTranscriptionJob(actor, "local", 120),
    ).toBeUndefined();
    await expect(
      catalog.heartbeatTranscriptionJob(
        actor,
        claimed!.job.id,
        claimed!.lease.attempt,
        120,
        "uploading",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
