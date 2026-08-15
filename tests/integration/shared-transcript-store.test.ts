import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { AuthorizationError } from "@research-video/auth";
import { SharedProjectCatalog } from "@research-video/catalog";
import type {
  AuthenticatedActor,
  TranscriptManifest,
} from "@research-video/contracts";
import {
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import {
  CachedTranscriptDocumentReader,
  ObjectStoreArtifactDownloader,
  SharedFirstTranscriptResolver,
  SharedTranscriptWorkspaceService,
  VerifiedTranscriptCache,
} from "@research-video/sync";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import { afterEach, describe, expect, it } from "vitest";
import wordFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const databases = new Set<PGlite>();
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const actor = (name: string): AuthenticatedActor => ({
  userId: randomUUID(),
  externalSubject: `fixture:${name}`,
});

describe("shared transcript store", () => {
  it("publishes on workstation A and reuses a pinned, verified bundle on workstation B", async () => {
    const cloud = new PGlite();
    databases.add(cloud);
    await runCloudMigrations(cloud);
    const objectStore = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(cloud, objectStore);
    const owner = actor("owner");
    const assistant = actor("assistant");
    const outsider = actor("outsider");
    await catalog.registerUser(owner, "Owner");
    await catalog.registerUser(assistant, "Assistant");
    await catalog.registerUser(outsider, "Outsider");

    const project = await catalog.createProject(owner, {
      name: "Essay research",
    });
    await catalog.addMember(owner, project.id, assistant.userId, "researcher");
    const video = await catalog.addVideo(assistant, project.id, {
      youtubeVideoId: "fixture-english",
      canonicalUrl: "https://www.youtube.com/watch?v=fixture-english",
      title: "Fixture video",
      durationMs: 4_000,
      sourceLanguage: "en",
    });

    const lineageId = randomUUID();
    const grant = await catalog.createTranscriptUpload(assistant, {
      projectId: project.id,
      catalogVideoId: video.id,
      lineageId,
      version: 1,
      artifactTypes: ["english-normalized", "english-srt"],
    });
    const normalizedTranscript = normalizeTranscriptFixture({
      ...wordFixture,
      track: { ...wordFixture.track, videoId: video.youtubeVideoId },
    });
    const normalizedBytes = new TextEncoder().encode(
      JSON.stringify(normalizedTranscript),
    );
    const srtBytes = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:04,000\nFixture\n",
    );
    const normalizedTarget = grant.targets.find(
      (target) => target.type === "english-normalized",
    )!;
    const srtTarget = grant.targets.find(
      (target) => target.type === "english-srt",
    )!;
    const normalizedStored = await objectStore.put({
      key: normalizedTarget.objectKey,
      bytes: normalizedBytes,
      contentType: "application/json",
      sha256: digest(normalizedBytes),
    });
    const srtStored = await objectStore.put({
      key: srtTarget.objectKey,
      bytes: srtBytes,
      contentType: "application/x-subrip",
      sha256: digest(srtBytes),
    });
    const transcriptVersionId = randomUUID();
    const manifest: TranscriptManifest = {
      schemaVersion: 1,
      id: transcriptVersionId,
      projectId: project.id,
      catalogVideoId: video.id,
      videoId: video.youtubeVideoId,
      lineageId,
      version: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      timingPrecision: "word",
      provider: "fixture",
      normalizationSchemaVersion: 1,
      jobId: grant.jobId,
      createdBy: assistant.userId,
      createdAt: new Date().toISOString(),
      artifacts: [
        {
          type: "english-normalized",
          objectKey: normalizedStored.key,
          objectVersionId: normalizedStored.versionId,
          byteSize: normalizedBytes.byteLength,
          sha256: digest(normalizedBytes),
        },
        {
          type: "english-srt",
          objectKey: srtStored.key,
          objectVersionId: srtStored.versionId,
          byteSize: srtBytes.byteLength,
          sha256: digest(srtBytes),
        },
      ],
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestTarget = grant.targets.find(
      (target) => target.type === "manifest",
    )!;
    const manifestStored = await objectStore.put({
      key: manifestTarget.objectKey,
      bytes: manifestBytes,
      contentType: "application/json",
      sha256: digest(manifestBytes),
    });
    const finalizeRequest = {
      uploadId: grant.uploadId,
      idempotencyKey: `finalize:${transcriptVersionId}`,
      manifest: {
        type: "manifest" as const,
        objectKey: manifestStored.key,
        objectVersionId: manifestStored.versionId,
        byteSize: manifestBytes.byteLength,
        sha256: digest(manifestBytes),
      },
    };

    const published = await catalog.finalizeTranscript(
      assistant,
      finalizeRequest,
    );
    expect(
      await catalog.finalizeTranscript(assistant, finalizeRequest),
    ).toEqual(published);

    await objectStore.put({
      key: normalizedStored.key,
      bytes: new Uint8Array([9, 9, 9]),
      contentType: "application/json",
      sha256: digest(new Uint8Array([9, 9, 9])),
    });

    const workstationB = mkdtempSync(join(tmpdir(), "transcript-cache-b-"));
    temporaryDirectories.add(workstationB);
    const localDatabase = openLocalDatabase(
      join(workstationB, "catalog.sqlite"),
    );
    runLocalMigrations(localDatabase);
    const objectDownloader = new ObjectStoreArtifactDownloader(objectStore);
    let downloadCount = 0;
    const cache = new VerifiedTranscriptCache(
      localDatabase,
      {
        download: async (target) => {
          downloadCount += 1;
          return objectDownloader.download(target);
        },
      },
      join(workstationB, "artifacts"),
    );
    const workspaceService = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        {
          getActiveTranscript: (projectId, catalogVideoId) =>
            catalog.getActiveTranscript(assistant, projectId, catalogVideoId),
        },
        cache,
      ),
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(localDatabase),
      ),
    );
    const firstResolution = await workspaceService.resolve(
      project.id,
      video.id,
    );
    const cachePath = firstResolution.cachePath;
    expect(firstResolution.source).toBe("shared-store");
    expect(firstResolution.transcript.track.timingPrecision).toBe("word");
    expect(existsSync(join(cachePath, "manifest.json"))).toBe(true);
    expect(existsSync(join(cachePath, "english-normalized.json"))).toBe(true);
    const downloadsAfterPromotion = downloadCount;
    const secondResolution = await workspaceService.resolve(
      project.id,
      video.id,
    );
    expect(secondResolution.source).toBe("verified-local-cache");
    expect(secondResolution.cachePath).toBe(cachePath);
    expect(downloadCount).toBe(downloadsAfterPromotion);
    const cacheRow = localDatabase
      .prepare(
        "SELECT sync_state FROM verified_transcript_cache WHERE transcript_version_id = ?",
      )
      .get(transcriptVersionId) as { sync_state: string };
    expect(cacheRow.sync_state).toBe("verified");
    localDatabase.close();

    await expect(
      catalog.getActiveTranscript(outsider, project.id, video.id),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
