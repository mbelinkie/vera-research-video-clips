import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { SharedProjectCatalog } from "@research-video/catalog";
import type { TranscriptManifest } from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  LocalStagedUploadUrlIssuer,
  LocalTranscriptObjectStore,
} from "@research-video/storage";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import { expect, it } from "vitest";

import {
  createCloudApi,
  authenticateDevBearer,
} from "../../apps/cloud-api/src/app.ts";
import wordFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// The target Mac can prove on-disk PGlite reopen; this Linux pipeline image
// stalls on embedded PGlite startup, so don't mistake a timeout for an app bug.
it.skipIf(process.platform !== "darwin")(
  "publishes a full staged transcript through signed local HTTP and reopens committed PGlite/catalog objects",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vera50-pglite-http-"));
    let db: PGlite | undefined;
    try {
      const dbPath = join(root, "catalog");
      const objectRoot = join(root, "private-objects");
      const store = new LocalTranscriptObjectStore(objectRoot);
      const signer = new LocalStagedUploadUrlIssuer(
        "http://127.0.0.1:43111/",
        "synthetic-fixture-signing-key-32-bytes-minimum",
      );
      db = new PGlite(dbPath);
      await runCloudMigrations(db);
      const catalog = new SharedProjectCatalog(
        db,
        store,
        () => new Date(),
        signer,
      );
      const actor = {
        userId: randomUUID(),
        externalSubject: "synthetic:verafifty",
      };
      await catalog.registerUser(actor, "Fixture author");
      const project = await catalog.createProject(actor, {
        name: "Synthetic published transcript",
      });
      const video = await catalog.addVideo(actor, project.id, {
        youtubeVideoId: "fixture-english",
        canonicalUrl: "https://www.youtube.com/watch?v=fixture-english",
        title: "Fixture video",
        durationMs: 4_000,
        sourceLanguage: "en",
      });
      const grant = await catalog.createTranscriptUpload(actor, {
        projectId: project.id,
        catalogVideoId: video.id,
        lineageId: randomUUID(),
        version: 1,
        artifactTypes: ["english-normalized", "english-srt"],
      });
      const app = createCloudApi({
        catalog,
        authenticate: authenticateDevBearer,
        localArtifacts: { store, issuer: signer, objectRoot },
      });
      try {
        const upload = async (
          type: "english-normalized" | "english-srt" | "manifest",
          bytes: Uint8Array,
        ) => {
          const target = grant.targets.find((item) => item.type === type)!;
          const response = await app.inject({
            method: "PUT",
            url: new URL(target.uploadUrl).pathname,
            payload: Buffer.from(bytes),
            headers: {
              "content-type":
                type === "english-srt"
                  ? "application/x-subrip"
                  : "application/json",
            },
          });
          expect(response.statusCode).toBe(200);
          return {
            type,
            objectKey: target.objectKey,
            objectVersionId: String(response.headers["x-amz-version-id"]),
            byteSize: bytes.length,
            sha256: digest(bytes),
          };
        };
        const transcript = normalizeTranscriptFixture({
          ...wordFixture,
          track: { ...wordFixture.track, videoId: video.youtubeVideoId },
        });
        const normalized = await upload(
          "english-normalized",
          new TextEncoder().encode(JSON.stringify(transcript)),
        );
        const srt = await upload(
          "english-srt",
          new TextEncoder().encode(
            "1\n00:00:00,000 --> 00:00:04,000\nFixture\n",
          ),
        );
        const transcriptId = randomUUID();
        const manifest: TranscriptManifest = {
          schemaVersion: 1,
          id: transcriptId,
          projectId: project.id,
          catalogVideoId: video.id,
          videoId: video.youtubeVideoId,
          lineageId: grant.lineageId,
          version: 1,
          sourceLanguage: "en",
          targetLanguage: "en",
          timingPrecision: "word",
          provider: "fixture",
          normalizationSchemaVersion: 1,
          jobId: grant.jobId,
          createdBy: actor.userId,
          createdAt: new Date().toISOString(),
          artifacts: [normalized, srt],
        };
        const manifestRef = await upload(
          "manifest",
          new TextEncoder().encode(JSON.stringify(manifest)),
        );
        const finalized = await app.inject({
          method: "POST",
          url: "/api/transcripts/finalize",
          headers: {
            authorization:
              "Bearer " + actor.userId + "|" + actor.externalSubject,
          },
          payload: {
            uploadId: grant.uploadId,
            idempotencyKey: "synthetic:" + transcriptId,
            manifest: manifestRef,
          },
        });
        expect(finalized.statusCode).toBe(200);
        expect(finalized.json().transcriptVersionId).toBe(transcriptId);
        // The head is not the authority for reads; the catalog's pinned version is.
        const active = await catalog.getActiveTranscript(
          actor,
          project.id,
          video.id,
        );
        const getUrl = active.downloads.find(
          (artifact) => artifact.type === "english-normalized",
        )!.downloadUrl;
        const fetched = await app.inject({
          method: "GET",
          url: new URL(getUrl).pathname,
        });
        expect(fetched.statusCode).toBe(200);
        expect(digest(fetched.rawPayload)).toBe(normalized.sha256);
      } finally {
        await app.close();
      }
      await db.close();
      db = undefined;
      db = new PGlite(dbPath);
      await runCloudMigrations(db);
      const reopened = new SharedProjectCatalog(
        db,
        new LocalTranscriptObjectStore(objectRoot),
        () => new Date(),
        signer,
      );
      expect(
        (await reopened.getActiveTranscript(actor, project.id, video.id))
          .transcriptVersionId,
      ).toBeTruthy();
      expect(
        (await reopened.listProjects(actor)).map((item) => item.id),
      ).toContain(project.id);
      expect(
        (
          await db.query<{ state: string }>(
            "SELECT state FROM jobs WHERE id = $1",
            [grant.jobId],
          )
        ).rows[0]?.state,
      ).toBe("complete");
    } finally {
      await db?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
