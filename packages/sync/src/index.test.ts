import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  ActiveTranscriptBundleSchema,
  DerivedTranslationSchema,
} from "@research-video/contracts";
import { createHash, randomUUID } from "node:crypto";

import {
  CachedTranscriptDocumentReader,
  HttpArtifactDownloader,
  LocalCacheIntegrityError,
  OfflineTranscriptUnavailableError,
  MemoryJobQueue,
  OfflineOutbox,
  SharedFirstTranscriptResolver,
  SharedDerivedTranslationResolver,
  SharedTranscriptWorkspaceService,
  TranscriptCatalogError,
  VerifiedTranscriptCache,
} from "./index.ts";
import {
  buildClipLanguageEvidence,
  normalizeTranscriptFixture,
} from "@research-video/transcript";
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

describe("memory job queue", () => {
  it("models at-least-once delivery", async () => {
    const queue = new MemoryJobQueue<{ jobId: string }>();
    await queue.send("message-1", { jobId: "job-1" });

    const first = await queue.receive();
    expect(first?.deliveryCount).toBe(1);
    expect(await queue.extendVisibility(first!.receipt, 30)).toBe(true);
    expect(await queue.receive()).toBeUndefined();
    expect(await queue.release(first!.receipt)).toBe(true);

    const second = await queue.receive();
    expect(second?.deliveryCount).toBe(2);
    expect(await queue.acknowledge(second!.receipt)).toBe(true);
    expect(await queue.receive()).toBeUndefined();
  });
});

describe("HTTP transcript artifact downloader", () => {
  it("authenticates only same-origin development artifact proxies", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const downloader = new HttpArtifactDownloader({
      origin: "http://127.0.0.1:43123",
      authorization: "Bearer desktop-session",
    });
    const target = {
      type: "manifest" as const,
      objectKey: "manifest.json",
      objectVersionId: randomUUID(),
      byteSize: 2,
      sha256: createHash("sha256").update("{}").digest("hex"),
      downloadUrl:
        `https://api.example.test/api/projects/${randomUUID()}/videos/${randomUUID()}/transcripts/${randomUUID()}/artifacts/manifest`,
    };

    try {
      await downloader.download(target);
      expect(fetcher).toHaveBeenLastCalledWith(
        `http://127.0.0.1:43123${new URL(target.downloadUrl).pathname}`,
        {
          method: "GET",
          redirect: "error",
          headers: { authorization: "Bearer desktop-session" },
        },
      );

      const external = {
        ...target,
        downloadUrl: "https://bucket.example.test/presigned-object",
      };
      await downloader.download(external);
      expect(fetcher).toHaveBeenLastCalledWith(external.downloadUrl, {
        method: "GET",
        redirect: "error",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("offline sync outbox", () => {
  it("deduplicates commands and schedules bounded retries", () => {
    const directory = mkdtempSync(join(tmpdir(), "outbox-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const outbox = new OfflineOutbox(database, () => now);

    const first = outbox.enqueue({
      commandType: "transcript.cache",
      idempotencyKey: "cache:one",
      payload: { version: 1 },
    });
    expect(
      outbox.enqueue({
        commandType: "transcript.cache",
        idempotencyKey: "cache:one",
        payload: { version: 1 },
      }),
    ).toBe(first);
    expect(outbox.due()).toHaveLength(1);
    outbox.retry(first);
    expect(outbox.due()).toHaveLength(0);

    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("persists later comment commands across restart and retains conflicts", () => {
    const directory = mkdtempSync(join(tmpdir(), "comment-outbox-test-"));
    const path = join(directory, "local.sqlite");
    let database = openLocalDatabase(path);
    runLocalMigrations(database);
    const projectId = randomUUID();
    const clipId = randomUUID();
    const commentId = randomUUID();
    const outbox = new OfflineOutbox(database);
    const createId = outbox.enqueueClipCommentCreate(projectId, clipId, {
      idempotencyKey: "offline-comment-create",
      body: "Queued while offline",
      sourceTimeMs: 1_000,
    });
    outbox.enqueueClipCommentUpdate(projectId, clipId, commentId, {
      idempotencyKey: "offline-comment-update",
      expectedVersion: 1,
      body: "Edited while offline",
    });
    outbox.enqueueClipCommentDelete(projectId, clipId, commentId, {
      idempotencyKey: "offline-comment-delete",
      expectedVersion: 2,
    });
    database.close();

    database = openLocalDatabase(path);
    runLocalMigrations(database);
    const restarted = new OfflineOutbox(database);
    expect(restarted.due().map((command) => command.commandType)).toEqual([
      "clip_comment.create.v1",
      "clip_comment.update.v1",
      "clip_comment.delete.v1",
    ]);
    restarted.recordConflict(createId, "conflict", {
      expectedVersion: 1,
      actualVersion: 2,
    });
    expect(restarted.due().map((command) => command.id)).not.toContain(
      createId,
    );
    expect(
      database
        .prepare(
          "SELECT last_error_code, conflict_json FROM sync_outbox WHERE id = ?",
        )
        .get(createId),
    ).toMatchObject({ last_error_code: "conflict" });
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("snapshots multilingual clip evidence without recomputing on replay", () => {
    const directory = mkdtempSync(join(tmpdir(), "clip-outbox-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const outbox = new OfflineOutbox(database);
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const english = normalizeTranscriptFixture(multilingualFixture.english);
    const spanish = normalizeTranscriptFixture(multilingualFixture.spanish);
    const evidence = buildClipLanguageEvidence({
      original,
      english,
      preferred: spanish,
      startMs: 0,
      endMs: 4_000,
    });
    outbox.enqueueClipCandidate("project-fixture", {
      idempotencyKey: "offline:romanian-spanish",
      video: {
        youtubeVideoId: "Romanian001",
        canonicalUrl: "https://www.youtube.com/watch?v=Romanian001",
        title: "Romanian fixture",
        sourceLanguage: "ro",
      },
      selection: {
        trackId: spanish.track.id,
        transcriptVersion: spanish.track.version,
        firstSegmentId: spanish.segments[0]!.id,
        lastSegmentId: spanish.segments[1]!.id,
        transcriptStartMs: 0,
        transcriptEndMs: 4_000,
        exportStartMs: 0,
        exportEndMs: 4_000,
        text: spanish.segments.map((segment) => segment.text).join(" "),
        timingPrecision: "cue",
      },
      languageEvidence: evidence,
      notes: "Offline proof",
      tags: ["Multilingual"],
    });
    const command = outbox.due()[0]!;
    expect(command.commandType).toBe("clip_candidate.create.v2");
    expect(command.payload).toMatchObject({ languageEvidence: evidence });
    expect(JSON.stringify(command.payload)).toContain(
      "La selección permanece vinculada por tiempo.",
    );
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("shared derived translation resolution", () => {
  it("verifies and promotes a shared translation for second-workstation reuse", async () => {
    const directory = mkdtempSync(join(tmpdir(), "derived-resolver-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const spanish = normalizeTranscriptFixture(multilingualFixture.spanish);
    const identity = {
      projectId: randomUUID(),
      catalogVideoId: randomUUID(),
      baseTranscriptVersionId: randomUUID(),
      originalTrackId: original.track.id,
      originalContentSha256: original.track.contentSha256,
      targetLanguage: "es-MX",
      provider: spanish.track.provider,
      normalizationSchemaVersion: spanish.track.schemaVersion,
    };
    const normalized = JSON.stringify(spanish);
    const normalizedSha256 = createHash("sha256")
      .update(normalized)
      .digest("hex");
    const shared = DerivedTranslationSchema.parse({
      manifest: {
        schemaVersion: 1,
        id: randomUUID(),
        lineageId: randomUUID(),
        version: 1,
        identity,
        translatedTrackId: spanish.track.id,
        translatedTrackVersion: spanish.track.version,
        sourceTrackId: original.track.id,
        timingPrecision: "cue",
        idempotencyKey: "shared:romanian:spanish",
        createdBy: randomUUID(),
        createdAt: "2026-08-20T12:00:00.000Z",
        artifacts: [
          {
            type: "translated-normalized",
            objectKey: "fixture/translated.normalized.json",
            objectVersionId: "version-1",
            byteSize: new TextEncoder().encode(normalized).byteLength,
            sha256: normalizedSha256,
          },
        ],
      },
      transcript: spanish,
    });
    let sharedCalls = 0;
    const resolver = new SharedDerivedTranslationResolver(
      {
        getDerivedTranslation: async () => {
          sharedCalls += 1;
          return shared;
        },
      },
      new LocalTranscriptIndex(database),
    );
    await expect(resolver.resolve(identity)).resolves.toMatchObject({
      source: "shared-store",
      transcript: { track: { language: "es" } },
    });
    await expect(resolver.resolve(identity)).resolves.toMatchObject({
      source: "verified-local-cache",
      transcript: { track: { language: "es" } },
    });
    expect(sharedCalls).toBe(1);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("shared transcript workspace resolution", () => {
  it("downloads a verified bilingual bundle once, indexes exact base tracks, and reuses it", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-resolver-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    let downloads = 0;
    const cache = new VerifiedTranscriptCache(
      database,
      {
        download: async (target) => {
          downloads += 1;
          const bytes = fixture.bytes.get(target.objectKey);
          if (!bytes) throw new Error(`Unexpected object ${target.objectKey}`);
          return bytes;
        },
      },
      join(directory, "cache"),
    );
    const service = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        { getActiveTranscript: async () => fixture.bundle },
        cache,
      ),
      new CachedTranscriptDocumentReader(new LocalTranscriptIndex(database)),
      {
        findLocal: async ({ preferredLanguage }) =>
          preferredLanguage === "es-MX" ? fixture.spanish : undefined,
      },
    );

    const first = await service.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "es-MX",
    );
    expect(first).toMatchObject({
      source: "shared-store",
      original: { track: { kind: "original", language: "ro" } },
      english: {
        track: { kind: "english", sourceTrackId: fixture.original.track.id },
      },
      preferred: {
        state: "ready",
        source: "local",
        transcript: { track: { language: "es" } },
      },
    });
    const firstDownloadCount = downloads;
    expect(
      new LocalTranscriptIndex(database).get(
        fixture.bundle.transcriptVersionId,
        "original",
      ),
    ).toMatchObject({ track: { id: fixture.original.track.id } });
    expect(
      new LocalTranscriptIndex(database).get(
        fixture.bundle.transcriptVersionId,
        "english",
      ),
    ).toMatchObject({ track: { id: fixture.english.track.id } });

    const second = await service.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "es-MX",
    );
    expect(second.source).toBe("verified-local-cache");
    expect(downloads).toBe(firstDownloadCount);
    expect(second).not.toHaveProperty("cachePath");
    expect(second).not.toHaveProperty("downloads");
    expect(second).not.toHaveProperty("authorization");
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a download target that is not the exact manifest artifact", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-binding-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const cache = new VerifiedTranscriptCache(
      database,
      {
        download: async (target) => fixture.bytes.get(target.objectKey)!,
      },
      join(directory, "cache"),
    );
    const originalTarget = fixture.bundle.downloads.find(
      (target) => target.type === "original-normalized",
    )!;
    const englishTarget = fixture.bundle.downloads.find(
      (target) => target.type === "english-normalized",
    )!;
    const swappedBundle = ActiveTranscriptBundleSchema.parse({
      ...fixture.bundle,
      downloads: fixture.bundle.downloads.map((target) =>
        target.type === "original-normalized"
          ? {
              ...originalTarget,
              objectKey: englishTarget.objectKey,
              objectVersionId: englishTarget.objectVersionId,
              byteSize: englishTarget.byteSize,
              sha256: englishTarget.sha256,
            }
          : target,
      ),
    });

    await expect(cache.download(swappedBundle)).rejects.toBeInstanceOf(
      LocalCacheIntegrityError,
    );
    expect(cache.findVerified(fixture.bundle)).toBeUndefined();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects malformed active bundle bindings on a cache hit without invalidating the prior cache", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-hit-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const cache = new VerifiedTranscriptCache(
      database,
      {
        download: async (target) => fixture.bytes.get(target.objectKey)!,
      },
      join(directory, "cache"),
    );
    await cache.download(fixture.bundle);
    const malformedBundle = ActiveTranscriptBundleSchema.parse({
      ...fixture.bundle,
      downloads: [
        ...fixture.bundle.downloads,
        fixture.bundle.downloads.find(
          (target) => target.type === "english-normalized",
        )!,
      ],
    });

    expect(() => cache.findVerified(malformedBundle)).toThrow(
      LocalCacheIntegrityError,
    );
    expect(cache.findVerified(fixture.bundle)).toBeDefined();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a downloaded manifest that differs from the catalog manifest and retains the prior cache", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-manifest-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const bytes = new Map(fixture.bytes);
    const cache = new VerifiedTranscriptCache(
      database,
      {
        download: async (target) => bytes.get(target.objectKey)!,
      },
      join(directory, "cache"),
    );
    const priorPath = await cache.download(fixture.bundle);
    const alteredManifest = {
      ...fixture.bundle.manifest,
      catalogVideoId: randomUUID(),
    };
    const alteredBytes = new TextEncoder().encode(
      JSON.stringify(alteredManifest),
    );
    const alteredObject = {
      ...fixture.bundle.manifestObject,
      objectKey: `${fixture.bundle.manifestObject.objectKey}.altered`,
      objectVersionId: "manifest-version-altered",
      byteSize: alteredBytes.byteLength,
      sha256: createHash("sha256").update(alteredBytes).digest("hex"),
    };
    bytes.set(alteredObject.objectKey, alteredBytes);
    const mismatchedBundle = ActiveTranscriptBundleSchema.parse({
      ...fixture.bundle,
      manifestObject: alteredObject,
      downloads: fixture.bundle.downloads.map((target) =>
        target.type === "manifest"
          ? { ...alteredObject, downloadUrl: target.downloadUrl }
          : target,
      ),
    });

    await expect(cache.download(mismatchedBundle)).rejects.toBeInstanceOf(
      LocalCacheIntegrityError,
    );
    expect(realpathSync(cache.findVerified(fixture.bundle)!)).toBe(
      realpathSync(priorPath),
    );
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a same-version replacement and leaves immutable cached bytes and metadata intact", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-reuse-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const bytes = new Map(fixture.bytes);
    const cache = new VerifiedTranscriptCache(
      database,
      {
        download: async (target) => bytes.get(target.objectKey)!,
      },
      join(directory, "cache"),
    );
    const priorPath = await cache.download(fixture.bundle);
    const replacementManifest = {
      ...fixture.bundle.manifest,
      provider: "unexpected-replacement",
    };
    const replacementBytes = new TextEncoder().encode(
      JSON.stringify(replacementManifest),
    );
    const replacementObject = {
      ...fixture.bundle.manifestObject,
      objectKey: `${fixture.bundle.manifestObject.objectKey}.replacement`,
      objectVersionId: "manifest-version-replacement",
      byteSize: replacementBytes.byteLength,
      sha256: createHash("sha256").update(replacementBytes).digest("hex"),
    };
    bytes.set(replacementObject.objectKey, replacementBytes);
    const replacementBundle = ActiveTranscriptBundleSchema.parse({
      ...fixture.bundle,
      manifest: replacementManifest,
      manifestObject: replacementObject,
      downloads: fixture.bundle.downloads.map((target) =>
        target.type === "manifest"
          ? { ...replacementObject, downloadUrl: target.downloadUrl }
          : target,
      ),
    });

    await expect(cache.download(replacementBundle)).rejects.toBeInstanceOf(
      LocalCacheIntegrityError,
    );
    expect(realpathSync(cache.findVerified(fixture.bundle)!)).toBe(
      realpathSync(priorPath),
    );
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("aliases the exact English track for a direct-English bundle", async () => {
    const fixture = workspaceBundle({ directEnglish: true });
    const { service, close } = workspaceServiceFor(fixture);
    const workspace = await service.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "en",
    );
    expect(workspace.original).toEqual(workspace.english);
    expect(workspace.preferred).toMatchObject({
      state: "ready",
      source: "original",
    });
    close();
  });

  it.each([
    ["missing original", { omitOriginal: true }],
    ["malformed original", { malformedOriginal: true }],
    ["mismatched original video", { mismatchedOriginalVideo: true }],
    ["unlinked English translation", { unlinkEnglish: true }],
  ] as const)(
    "rejects a %s cached base-track bundle",
    async (_label, options) => {
      const fixture = workspaceBundle(options);
      const { service, close } = workspaceServiceFor(fixture);
      await expect(
        service.resolveWorkspace(
          fixture.projectId,
          fixture.catalogVideoId,
          "en",
        ),
      ).rejects.toBeInstanceOf(LocalCacheIntegrityError);
      close();
    },
  );

  it("allows only the same verified login capability to review an exact cache during a catalog outage", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-offline-test-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const cache = new VerifiedTranscriptCache(
      database,
      {
        download: async (target) => fixture.bytes.get(target.objectKey)!,
      },
      join(directory, "cache"),
    );
    const capability = "c".repeat(43);
    let outage = false;
    const service = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        {
          getActiveTranscript: async () => {
            if (outage) {
              throw new TranscriptCatalogError(
                502,
                "transcript_catalog_unavailable",
              );
            }
            return fixture.bundle;
          },
        },
        cache,
      ),
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(database),
        join(directory, "cache"),
      ),
    );
    await service.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "en",
      capability,
    );
    outage = true;
    await expect(
      service.resolveWorkspace(
        fixture.projectId,
        fixture.catalogVideoId,
        "en",
        capability,
      ),
    ).resolves.toMatchObject({
      source: "verified-local-cache",
      catalogState: "offline_cached",
      original: { track: { id: fixture.original.track.id } },
      english: { track: { id: fixture.english.track.id } },
    });
    await expect(
      service.resolveWorkspace(
        fixture.projectId,
        fixture.catalogVideoId,
        "en",
        "n".repeat(43),
      ),
    ).rejects.toBeInstanceOf(OfflineTranscriptUnavailableError);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("never falls back after authorization denial and rejects a swapped cache path", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-offline-denied-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const cache = new VerifiedTranscriptCache(
      database,
      { download: async (target) => fixture.bytes.get(target.objectKey)! },
      join(directory, "cache"),
    );
    const capability = "c".repeat(43);
    const resolver = new SharedFirstTranscriptResolver(
      { getActiveTranscript: async () => fixture.bundle },
      cache,
    );
    const service = new SharedTranscriptWorkspaceService(
      resolver,
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(database),
        join(directory, "cache"),
      ),
    );
    await service.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "en",
      capability,
    );
    const denied = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        {
          getActiveTranscript: async () => {
            throw new TranscriptCatalogError(403, "authorization_denied");
          },
        },
        cache,
      ),
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(database),
        join(directory, "cache"),
      ),
    );
    await expect(
      denied.resolveWorkspace(
        fixture.projectId,
        fixture.catalogVideoId,
        "en",
        capability,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    database
      .prepare(
        `UPDATE verified_transcript_cache SET cache_path = ?
         WHERE project_id = ? AND video_id = ? AND transcript_version_id = ?`,
      )
      .run(
        directory,
        fixture.projectId,
        fixture.catalogVideoId,
        fixture.bundle.transcriptVersionId,
      );
    const unavailable = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        {
          getActiveTranscript: async () => {
            throw new TranscriptCatalogError(
              502,
              "transcript_catalog_unavailable",
            );
          },
        },
        cache,
      ),
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(database),
        join(directory, "cache"),
      ),
    );
    await expect(
      unavailable.resolveWorkspace(
        fixture.projectId,
        fixture.catalogVideoId,
        "en",
        capability,
      ),
    ).rejects.toBeInstanceOf(LocalCacheIntegrityError);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    [401, "authentication_required"],
    [404, "not_found"],
  ] as const)(
    "never falls back after catalog HTTP %s",
    async (status, code) => {
      const fixture = workspaceBundle();
      const directory = mkdtempSync(join(tmpdir(), "workspace-offline-http-"));
      const database = openLocalDatabase(join(directory, "local.sqlite"));
      runLocalMigrations(database);
      const cache = new VerifiedTranscriptCache(
        database,
        { download: async (target) => fixture.bytes.get(target.objectKey)! },
        join(directory, "cache"),
      );
      const capability = "c".repeat(43);
      const online = new SharedTranscriptWorkspaceService(
        new SharedFirstTranscriptResolver(
          { getActiveTranscript: async () => fixture.bundle },
          cache,
        ),
        new CachedTranscriptDocumentReader(
          new LocalTranscriptIndex(database),
          join(directory, "cache"),
        ),
      );
      await online.resolveWorkspace(
        fixture.projectId,
        fixture.catalogVideoId,
        "en",
        capability,
      );
      const blocked = new SharedTranscriptWorkspaceService(
        new SharedFirstTranscriptResolver(
          {
            getActiveTranscript: async () => {
              throw new TranscriptCatalogError(status, code);
            },
          },
          cache,
        ),
        new CachedTranscriptDocumentReader(
          new LocalTranscriptIndex(database),
          join(directory, "cache"),
        ),
      );
      await expect(
        blocked.resolveWorkspace(
          fixture.projectId,
          fixture.catalogVideoId,
          "en",
          capability,
        ),
      ).rejects.toMatchObject({ statusCode: status });
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  );

  it("rejects corrupted, symlinked, and non-regular cached normalized artifacts", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(join(tmpdir(), "workspace-offline-files-"));
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const root = join(directory, "cache");
    const cache = new VerifiedTranscriptCache(
      database,
      { download: async (target) => fixture.bytes.get(target.objectKey)! },
      root,
    );
    const capability = "c".repeat(43);
    const online = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        { getActiveTranscript: async () => fixture.bundle },
        cache,
      ),
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(database),
        root,
      ),
    );
    await online.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "en",
      capability,
    );
    const row = database
      .prepare(
        `SELECT cache_path FROM verified_transcript_cache
         WHERE project_id = ? AND video_id = ? AND transcript_version_id = ?`,
      )
      .get(
        fixture.projectId,
        fixture.catalogVideoId,
        fixture.bundle.transcriptVersionId,
      ) as { cache_path: string };
    const english = fixture.bundle.manifest.artifacts.find(
      (artifact) => artifact.type === "english-normalized",
    )!;
    const artifactPath = join(
      row.cache_path,
      `english-normalized${extname(english.objectKey) || ".bin"}`,
    );
    const scope = createHash("sha256").update(capability).digest("hex");
    const offline = () =>
      cache.findOfflineAuthorized({
        projectId: fixture.projectId,
        catalogVideoId: fixture.catalogVideoId,
        authorizationScopeSha256: scope,
      });
    unlinkSync(artifactPath);
    mkdirSync(artifactPath);
    expect(offline).toThrow(LocalCacheIntegrityError);
    rmSync(artifactPath, { recursive: true });
    database
      .prepare(
        `UPDATE verified_transcript_cache SET sync_state = 'verified'
         WHERE project_id = ? AND video_id = ? AND transcript_version_id = ?`,
      )
      .run(
        fixture.projectId,
        fixture.catalogVideoId,
        fixture.bundle.transcriptVersionId,
      );
    const outside = join(directory, "outside.json");
    writeFileSync(outside, "not a transcript");
    symlinkSync(outside, artifactPath);
    expect(offline).toThrow(LocalCacheIntegrityError);
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("uses only a local preferred translation during offline cache review", async () => {
    const fixture = workspaceBundle();
    const directory = mkdtempSync(
      join(tmpdir(), "workspace-offline-preferred-"),
    );
    const database = openLocalDatabase(join(directory, "local.sqlite"));
    runLocalMigrations(database);
    const root = join(directory, "cache");
    const cache = new VerifiedTranscriptCache(
      database,
      { download: async (target) => fixture.bytes.get(target.objectKey)! },
      root,
    );
    const shared = vi.fn(async () => fixture.spanish);
    const requested = vi.fn(async () => fixture.spanish);
    let outage = false;
    const service = new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        {
          getActiveTranscript: async () => {
            if (outage)
              throw new TranscriptCatalogError(
                502,
                "transcript_catalog_unavailable",
              );
            return fixture.bundle;
          },
        },
        cache,
      ),
      new CachedTranscriptDocumentReader(
        new LocalTranscriptIndex(database),
        root,
      ),
      {
        findLocal: async () => fixture.spanish,
        findShared: shared,
        requestTranslation: requested,
      },
    );
    const capability = "c".repeat(43);
    await service.resolveWorkspace(
      fixture.projectId,
      fixture.catalogVideoId,
      "es",
      capability,
    );
    shared.mockClear();
    requested.mockClear();
    outage = true;
    await expect(
      service.resolveWorkspace(
        fixture.projectId,
        fixture.catalogVideoId,
        "es",
        capability,
      ),
    ).resolves.toMatchObject({
      catalogState: "offline_cached",
      preferred: { state: "ready", source: "local" },
    });
    expect(shared).not.toHaveBeenCalled();
    expect(requested).not.toHaveBeenCalled();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

function workspaceServiceFor(fixture: ReturnType<typeof workspaceBundle>) {
  const directory = mkdtempSync(join(tmpdir(), "workspace-reader-test-"));
  const database = openLocalDatabase(join(directory, "local.sqlite"));
  runLocalMigrations(database);
  const cache = new VerifiedTranscriptCache(
    database,
    {
      download: async (target) => {
        const bytes = fixture.bytes.get(target.objectKey);
        if (!bytes) throw new Error(`Unexpected object ${target.objectKey}`);
        return bytes;
      },
    },
    join(directory, "cache"),
  );
  return {
    service: new SharedTranscriptWorkspaceService(
      new SharedFirstTranscriptResolver(
        { getActiveTranscript: async () => fixture.bundle },
        cache,
      ),
      new CachedTranscriptDocumentReader(new LocalTranscriptIndex(database)),
    ),
    close: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function workspaceBundle(
  options: {
    directEnglish?: boolean;
    omitOriginal?: boolean;
    malformedOriginal?: boolean;
    mismatchedOriginalVideo?: boolean;
    unlinkEnglish?: boolean;
  } = {},
) {
  const projectId = randomUUID();
  const catalogVideoId = randomUUID();
  const transcriptVersionId = randomUUID();
  const youtubeVideoId = options.directEnglish ? "English001" : "Romanian001";
  const original = normalizeTranscriptFixture({
    ...multilingualFixture.original,
    track: {
      ...multilingualFixture.original.track,
      videoId: options.mismatchedOriginalVideo ? "OtherVideo" : youtubeVideoId,
    },
  });
  const { sourceTrackId: _sourceTrackId, ...directEnglishTrack } =
    multilingualFixture.english.track;
  const english = normalizeTranscriptFixture({
    ...multilingualFixture.english,
    track: {
      ...(options.directEnglish
        ? directEnglishTrack
        : multilingualFixture.english.track),
      videoId: youtubeVideoId,
      ...(options.unlinkEnglish ? { sourceTrackId: randomUUID() } : {}),
    },
  });
  const spanish = normalizeTranscriptFixture({
    ...multilingualFixture.spanish,
    track: { ...multilingualFixture.spanish.track, videoId: youtubeVideoId },
  });
  const encoded = new TextEncoder();
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const bytes = new Map<string, Uint8Array>();
  const artifacts: Array<{
    type: "original-normalized" | "english-normalized";
    objectKey: string;
    objectVersionId: string;
    byteSize: number;
    sha256: string;
  }> = [];
  const addArtifact = (
    type: "original-normalized" | "english-normalized",
    value: unknown,
  ) => {
    const objectKey = `objects/${transcriptVersionId}/${type}.json`;
    const artifactBytes =
      type === "original-normalized" && options.malformedOriginal
        ? encoded.encode("not-json")
        : encoded.encode(JSON.stringify(value));
    bytes.set(objectKey, artifactBytes);
    artifacts.push({
      type,
      objectKey,
      objectVersionId: `version-${type}`,
      byteSize: artifactBytes.byteLength,
      sha256: hash(artifactBytes),
    });
  };
  if (!options.directEnglish && !options.omitOriginal) {
    addArtifact("original-normalized", original);
  }
  addArtifact("english-normalized", english);
  const manifest = {
    schemaVersion: 1,
    id: transcriptVersionId,
    projectId,
    catalogVideoId,
    videoId: youtubeVideoId,
    lineageId: randomUUID(),
    version: 1,
    sourceLanguage: options.directEnglish ? "en" : "ro",
    targetLanguage: "en",
    timingPrecision: "cue" as const,
    provider: "fixture",
    normalizationSchemaVersion: 1,
    jobId: randomUUID(),
    createdBy: randomUUID(),
    createdAt: "2026-08-20T12:00:00.000Z",
    artifacts,
  };
  const manifestBytes = encoded.encode(JSON.stringify(manifest));
  const manifestObjectKey = `objects/${transcriptVersionId}/manifest.json`;
  bytes.set(manifestObjectKey, manifestBytes);
  const manifestObject = {
    type: "manifest" as const,
    objectKey: manifestObjectKey,
    objectVersionId: "manifest-version",
    byteSize: manifestBytes.byteLength,
    sha256: hash(manifestBytes),
  };
  const bundle = ActiveTranscriptBundleSchema.parse({
    transcriptVersionId,
    manifest,
    manifestObject,
    downloads: [
      {
        ...manifestObject,
        downloadUrl: "https://download.example.test/manifest",
      },
      ...artifacts.map((artifact) => ({
        ...artifact,
        downloadUrl: `https://download.example.test/${artifact.type}`,
      })),
    ],
  });
  return {
    projectId,
    catalogVideoId,
    original,
    english,
    spanish,
    bundle,
    bytes,
  };
}
