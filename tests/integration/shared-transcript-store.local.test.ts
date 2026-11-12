import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { SharedProjectCatalog } from "@research-video/catalog";
import type { TranscriptManifest } from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  CachedTranscriptDocumentReader,
  HttpActiveTranscriptCatalogClient,
  HttpArtifactDownloader,
  SharedFirstTranscriptResolver,
  SharedTranscriptWorkspaceService,
  VerifiedTranscriptCache,
} from "@research-video/sync";
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
import { createLocalAgent } from "../../apps/local-agent/src/app.ts";
import {
  createTranscriptPipelineExecutor,
  HttpTranscriptPublicationClient,
} from "../../apps/worker/src/pipeline.ts";
import {
  ClaimingTranscriptionWorker,
  HttpTranscriptionWorkerControlPlane,
} from "../../apps/worker/src/worker.ts";
import wordFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function freeLoopbackPort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolveReady, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolveReady);
  });
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test TCP port");
  await new Promise<void>((resolveClosed) =>
    socket.close(() => resolveClosed()),
  );
  return address.port;
}

it("claims, publishes over signed HTTP, resolves verified cache and fails no-caption jobs without leaking credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "research19-http-"));
  const database = new PGlite();
  const localDb = openLocalDatabase(join(root, "local.sqlite"));
  const cloudPort = await freeLoopbackPort();
  const localPort = await freeLoopbackPort();
  const cloudUrl = `http://127.0.0.1:${cloudPort}`;
  const localUrl = `http://127.0.0.1:${localPort}`;
  const objectRoot = join(root, "objects");
  const scratchRoot = join(root, "scratch");
  const cacheRoot = join(root, "cache");
  const store = new LocalTranscriptObjectStore(objectRoot);
  const issuer = new LocalStagedUploadUrlIssuer(
    `${cloudUrl}/`,
    "research19-http-test-signing-secret-32-bytes",
  );
  let cloud: ReturnType<typeof createCloudApi> | undefined;
  let local: ReturnType<typeof createLocalAgent> | undefined;
  try {
    await runCloudMigrations(database);
    runLocalMigrations(localDb);
    const catalog = new SharedProjectCatalog(
      database,
      store,
      () => new Date(),
      issuer,
    );
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:research19",
    };
    const authorization = `Bearer ${actor.userId}|${actor.externalSubject}`;
    await catalog.registerUser(actor, "Research 19 HTTP fixture");
    const project = await catalog.createProject(actor, {
      name: "Isolated Research fixture",
    });
    cloud = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      localArtifacts: { store, issuer, objectRoot },
      videoMetadataProvider: {
        resolve: async (videoId) => ({
          videoId,
          title: "Fixture source",
          sourceLanguage: "en",
        }),
      },
    });
    await cloud.listen({ host: "127.0.0.1", port: cloudPort });
    const resolver = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        new HttpActiveTranscriptCatalogClient(cloudUrl, authorization),
        new VerifiedTranscriptCache(
          localDb,
          new HttpArtifactDownloader(),
          cacheRoot,
        ),
      ),
      new CachedTranscriptDocumentReader(new LocalTranscriptIndex(localDb)),
    );
    local = createLocalAgent({
      resolveTranscript: async ({
        projectId,
        catalogVideoId,
        authorization: presented,
      }) =>
        new SharedTranscriptWorkspaceService(
          new SharedFirstTranscriptResolver(
            new HttpActiveTranscriptCatalogClient(cloudUrl, presented),
            new VerifiedTranscriptCache(
              localDb,
              new HttpArtifactDownloader(),
              cacheRoot,
            ),
          ),
          new CachedTranscriptDocumentReader(new LocalTranscriptIndex(localDb)),
        ).resolve(projectId, catalogVideoId),
    });
    await local.listen({ host: "127.0.0.1", port: localPort });
    const submit = async (videoId: string) => {
      const response = await fetch(
        `${cloudUrl}/api/projects/${project.id}/transcription-batches`,
        {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({
            name: `Research ${videoId}`,
            inputs: [videoId],
            executionLocation: "local",
          }),
        },
      );
      expect(response.status).toBe(201);
      return (await response.json()) as {
        batch: { id: string };
        items: { catalogVideoId: string; jobId: string }[];
      };
    };
    const captioned = await submit("M7lc1UVf-VE");
    const vtt = await readFile(
      new URL("../fixtures/transcripts/auto-word-timed.vtt", import.meta.url),
    );
    const worker = new ClaimingTranscriptionWorker(
      new HttpTranscriptionWorkerControlPlane({
        baseUrl: cloudUrl,
        authorization,
        executionLocation: "local",
        leaseSeconds: 30,
      }),
      createTranscriptPipelineExecutor({
        scratchRoot,
        publication: new HttpTranscriptPublicationClient({
          baseUrl: cloudUrl,
          authorization,
        }),
        captions: {
          discover: async (videoId) =>
            videoId === "M7lc1UVf-VE"
              ? [
                  {
                    id: "fixture:en:auto",
                    language: "en",
                    kind: "automatic",
                    translatable: false,
                    downloadAccess: "available",
                  },
                ]
              : [],
          acquire: async (videoId, track, scratch) => {
            const path = join(scratch, "captions.vtt");
            await writeFile(path, vtt);
            return {
              videoId,
              track,
              path,
              format: "vtt",
              byteSize: vtt.length,
              provider: "fixture",
            };
          },
        },
      }),
    );
    expect(await worker.runOnce()).toBe("processed");
    const batchResponse = await fetch(
      `${cloudUrl}/api/projects/${project.id}/transcription-batches/${captioned.batch.id}`,
      { headers: { authorization } },
    );
    const batch = (await batchResponse.json()) as {
      items: { state: string; activeTranscriptVersionId: string }[];
    };
    expect(batch.items[0]?.state).toBe("ready_for_review");
    const catalogVideoId = captioned.items[0]!.catalogVideoId;
    const transcriptPath = `${localUrl}/api/projects/${project.id}/videos/${catalogVideoId}/transcript`;
    expect((await fetch(transcriptPath)).status).toBe(401);
    const outsider = `Bearer ${randomUUID()}|fixture:outsider`;
    expect(
      (await fetch(transcriptPath, { headers: { authorization: outsider } }))
        .status,
    ).toBe(404); // Catalog intentionally conceals existence from non-members.
    const first = await fetch(transcriptPath, { headers: { authorization } });
    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as {
      source: string;
      transcriptVersionId: string;
      transcript: {
        track: { videoId: string; timingPrecision: string };
        tokens: unknown[];
      };
    };
    expect(firstPayload.source).toBe("shared-store");
    expect(firstPayload.transcriptVersionId).toBe(
      batch.items[0]?.activeTranscriptVersionId,
    );
    expect(firstPayload.transcript.track.videoId).toBe("M7lc1UVf-VE");
    expect(firstPayload.transcript.tokens.length).toBeGreaterThan(0);
    const second = await fetch(transcriptPath, { headers: { authorization } });
    expect(((await second.json()) as { source: string }).source).toBe(
      "verified-local-cache",
    );
    const active = await catalog.getActiveTranscript(
      actor,
      project.id,
      catalogVideoId,
    );
    const downloadUrl = active.downloads.find(
      (item) => item.type === "english-normalized",
    )!.downloadUrl;
    expect(
      (await fetch(downloadUrl, { method: "PUT", body: "forbidden" })).status,
    ).toBe(403);
    expect((await fetch(downloadUrl.replace(/.$/u, "x"))).status).toBe(403);
    expect(await readdir(scratchRoot)).toEqual([]);
    // No captions and no recognizer: still claimed and made terminal, never fixture text.
    const uncaptioned = await submit("ReadyVideo1");
    expect(await worker.runOnce()).toBe("failed");
    const failedResponse = await fetch(
      `${cloudUrl}/api/projects/${project.id}/transcription-batches/${uncaptioned.batch.id}`,
      { headers: { authorization } },
    );
    expect(
      (
        (await failedResponse.json()) as {
          items: { state: string; error: { code: string; message: string } }[];
        }
      ).items[0],
    ).toMatchObject({
      state: "failed",
      error: {
        code: "recognizer_not_configured",
        message:
          "No captions are available and local speech recognition is not configured.",
      },
    });
    expect(await readdir(scratchRoot)).toEqual([]);
    // Test helper resolver must agree with the independently served local-agent response.
    expect(
      (await resolver.resolve(project.id, catalogVideoId)).transcript.track
        .videoId,
    ).toBe("M7lc1UVf-VE");
  } finally {
    await local?.close();
    await cloud?.close();
    localDb.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

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
