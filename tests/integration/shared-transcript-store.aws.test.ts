import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PGlite } from "@electric-sql/pglite";
import { AuthorizationError } from "@research-video/auth";
import { SharedProjectCatalog } from "@research-video/catalog";
import type {
  AuthenticatedActor,
  TranscriptManifest,
  TranscriptUploadGrant,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  S3StagedUploadUrlIssuer,
  S3TranscriptObjectStore,
} from "@research-video/storage";
import {
  HttpArtifactDownloader,
  VerifiedTranscriptCache,
} from "@research-video/sync";
import { describe, expect, it } from "vitest";

const bucket = process.env.AWS_TRANSCRIPT_TEST_BUCKET;
const region = process.env.AWS_REGION ?? "us-east-1";
const awsDescribe = bucket ? describe : describe.skip;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const actor = (name: string): AuthenticatedActor => ({
  userId: randomUUID(),
  externalSubject: `aws-acceptance:${name}`,
});

awsDescribe("AWS shared transcript acceptance", () => {
  it("publishes through presigned PUTs and downloads through authorized pinned GETs", async () => {
    const client = new S3Client({ region });
    const store = new S3TranscriptObjectStore(client, bucket!);
    const issuer = new S3StagedUploadUrlIssuer(client, bucket!);
    const cloud = new PGlite();
    await runCloudMigrations(cloud);
    const catalog = new SharedProjectCatalog(
      cloud,
      store,
      () => new Date(),
      issuer,
    );
    const owner = actor("owner");
    const assistant = actor("assistant");
    const outsider = actor("outsider");
    let projectPrefix: string | undefined;
    const localDirectory = mkdtempSync(join(tmpdir(), "aws-cache-b-"));

    try {
      await catalog.registerUser(owner, "AWS Owner");
      await catalog.registerUser(assistant, "AWS Assistant");
      await catalog.registerUser(outsider, "AWS Outsider");
      const project = await catalog.createProject(owner, {
        name: `AWS acceptance ${randomUUID()}`,
      });
      projectPrefix = `projects/${project.id}/`;
      await catalog.addMember(
        owner,
        project.id,
        assistant.userId,
        "researcher",
      );
      const video = await catalog.addVideo(assistant, project.id, {
        youtubeVideoId: `aws-fixture-${randomUUID()}`,
        canonicalUrl: "https://www.youtube.com/watch?v=aws-fixture",
        title: "AWS fixture video",
        sourceLanguage: "en",
      });
      const lineageId = randomUUID();
      const grant = await catalog.createTranscriptUpload(assistant, {
        projectId: project.id,
        catalogVideoId: video.id,
        lineageId,
        version: 1,
        artifactTypes: ["english-normalized"],
      });
      const transcriptBytes = new TextEncoder().encode(
        JSON.stringify({
          segments: [{ startMs: 0, endMs: 1_000, text: "AWS fixture" }],
        }),
      );
      const transcriptObject = await upload(
        grant,
        "english-normalized",
        transcriptBytes,
      );
      const manifest: TranscriptManifest = {
        schemaVersion: 1,
        id: randomUUID(),
        projectId: project.id,
        catalogVideoId: video.id,
        videoId: video.youtubeVideoId,
        lineageId,
        version: 1,
        sourceLanguage: "en",
        targetLanguage: "en",
        timingPrecision: "cue",
        provider: "aws-acceptance",
        normalizationSchemaVersion: 1,
        jobId: grant.jobId,
        createdBy: assistant.userId,
        createdAt: new Date().toISOString(),
        artifacts: [transcriptObject],
      };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      const manifestObject = await upload(grant, "manifest", manifestBytes);
      await catalog.finalizeTranscript(assistant, {
        uploadId: grant.uploadId,
        idempotencyKey: `aws-finalize:${manifest.id}`,
        manifest: { ...manifestObject, type: "manifest" },
      });

      const localDatabase = openLocalDatabase(
        join(localDirectory, "catalog.sqlite"),
      );
      runLocalMigrations(localDatabase);
      const active = await catalog.getActiveTranscript(
        assistant,
        project.id,
        video.id,
      );
      const cache = new VerifiedTranscriptCache(
        localDatabase,
        new HttpArtifactDownloader(),
        join(localDirectory, "artifacts"),
      );
      await expect(cache.download(active)).resolves.toContain(manifest.id);
      localDatabase.close();
      await expect(
        catalog.getActiveTranscript(outsider, project.id, video.id),
      ).rejects.toBeInstanceOf(AuthorizationError);
    } finally {
      await cloud.close();
      rmSync(localDirectory, { recursive: true, force: true });
      if (projectPrefix) await deletePrefix(client, bucket!, projectPrefix);
      client.destroy();
    }
  }, 60_000);
});

async function upload(
  grant: TranscriptUploadGrant,
  type: "manifest" | "english-normalized",
  bytes: Uint8Array,
) {
  const target = grant.targets.find((candidate) => candidate.type === type);
  if (!target) throw new Error(`Missing ${type} upload target.`);
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    body: new Blob([bytes.slice().buffer as ArrayBuffer]),
  });
  if (!response.ok) {
    throw new Error(`Presigned upload failed with HTTP ${response.status}.`);
  }
  const objectVersionId = response.headers.get("x-amz-version-id");
  if (!objectVersionId)
    throw new Error("S3 upload did not return a version ID.");
  return {
    type,
    objectKey: target.objectKey,
    objectVersionId,
    byteSize: bytes.byteLength,
    sha256: digest(bytes),
  };
}

async function deletePrefix(
  client: S3Client,
  bucketName: string,
  prefix: string,
) {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        Prefix: prefix,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
      }),
    );
    const objects = [
      ...(listed.Versions ?? []),
      ...(listed.DeleteMarkers ?? []),
    ]
      .filter((item) => item.Key && item.VersionId)
      .map((item) => ({ Key: item.Key!, VersionId: item.VersionId! }));
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
    }
    keyMarker = listed.NextKeyMarker;
    versionIdMarker = listed.NextVersionIdMarker;
  } while (keyMarker);
}
