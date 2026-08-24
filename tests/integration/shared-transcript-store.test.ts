import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { AuthorizationError } from "@research-video/auth";
import { SharedProjectCatalog } from "@research-video/catalog";
import type {
  AuthenticatedActor,
  FinalizeProjectKeywordScanRequest,
  ProjectKeywordScanArtifactUploadGrant,
  ProjectKeywordScanClaim,
  ProjectKeywordScanInputSnapshot,
  TranscriptManifest,
} from "@research-video/contracts";
import { ProjectKeywordMatchArtifactSchema } from "@research-video/contracts";
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
import {
  ClaimingProjectKeywordScanWorker,
  type ProjectKeywordScanControlPlane,
} from "../../apps/worker/src/keyword-scan.ts";
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
    expect(realpathSync(secondResolution.cachePath)).toBe(
      realpathSync(cachePath),
    );
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

  it("runs an exact keyword scan and lets a second authorized client verify the pinned artifact", async () => {
    const cloud = new PGlite();
    databases.add(cloud);
    await runCloudMigrations(cloud);
    const objectStore = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(cloud, objectStore);
    const workerCatalog = new SharedProjectCatalog(cloud, objectStore);
    const secondClient = new SharedProjectCatalog(cloud, objectStore);
    const owner = actor("keyword-owner");
    const worker = actor("keyword-worker");
    const collaborator = actor("keyword-collaborator");
    const outsider = actor("keyword-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Keyword owner"),
      catalog.registerUser(worker, "Keyword worker"),
      catalog.registerUser(collaborator, "Keyword collaborator"),
      catalog.registerUser(outsider, "Keyword outsider"),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Shared keyword evidence",
    });
    await catalog.addMember(owner, project.id, worker.userId, "researcher");
    await catalog.addMember(
      owner,
      project.id,
      collaborator.userId,
      "researcher",
    );
    const video = await catalog.addVideo(
      owner,
      project.id,
      {
        youtubeVideoId: "KeywordShared01",
        canonicalUrl: "https://www.youtube.com/watch?v=KeywordShared01",
        title: "Shared keyword fixture",
        durationMs: 4_000,
        sourceLanguage: "en",
      },
      { automaticLocalProcessing: false },
    );
    const transcript = normalizeTranscriptFixture({
      ...wordFixture,
      track: { ...wordFixture.track, videoId: video.youtubeVideoId },
    });
    const transcriptBytes = new TextEncoder().encode(
      JSON.stringify(transcript),
    );
    const upload = await catalog.createTranscriptUpload(owner, {
      projectId: project.id,
      catalogVideoId: video.id,
      lineageId: randomUUID(),
      version: 1,
      artifactTypes: ["english-normalized", "english-srt"],
    });
    const normalizedTarget = upload.targets.find(
      (target) => target.type === "english-normalized",
    )!;
    const subtitleTarget = upload.targets.find(
      (target) => target.type === "english-srt",
    )!;
    const normalizedStored = await objectStore.put({
      key: normalizedTarget.objectKey,
      bytes: transcriptBytes,
      contentType: "application/json",
      sha256: digest(transcriptBytes),
    });
    const subtitleBytes = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:04,000\nAccurate word timing\n",
    );
    const subtitleStored = await objectStore.put({
      key: subtitleTarget.objectKey,
      bytes: subtitleBytes,
      contentType: "application/x-subrip",
      sha256: digest(subtitleBytes),
    });
    const transcriptVersionId = randomUUID();
    const manifest: TranscriptManifest = {
      schemaVersion: 1,
      id: transcriptVersionId,
      projectId: project.id,
      catalogVideoId: video.id,
      videoId: video.youtubeVideoId,
      lineageId: upload.lineageId,
      version: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      timingPrecision: "word",
      provider: "fixture",
      normalizationSchemaVersion: 1,
      jobId: upload.jobId,
      createdBy: owner.userId,
      createdAt: new Date().toISOString(),
      artifacts: [
        {
          type: "english-normalized",
          objectKey: normalizedStored.key,
          objectVersionId: normalizedStored.versionId,
          byteSize: transcriptBytes.byteLength,
          sha256: digest(transcriptBytes),
        },
        {
          type: "english-srt",
          objectKey: subtitleStored.key,
          objectVersionId: subtitleStored.versionId,
          byteSize: subtitleBytes.byteLength,
          sha256: digest(subtitleBytes),
        },
      ],
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestTarget = upload.targets.find(
      (target) => target.type === "manifest",
    )!;
    const manifestStored = await objectStore.put({
      key: manifestTarget.objectKey,
      bytes: manifestBytes,
      contentType: "application/json",
      sha256: digest(manifestBytes),
    });
    await catalog.finalizeTranscript(owner, {
      uploadId: upload.uploadId,
      idempotencyKey: `finalize:${transcriptVersionId}`,
      manifest: {
        type: "manifest",
        objectKey: manifestStored.key,
        objectVersionId: manifestStored.versionId,
        byteSize: manifestBytes.byteLength,
        sha256: digest(manifestBytes),
      },
    });

    const suggestion = await catalog.suggestProjectKeyword(owner, project.id, {
      proposedLabel: "Timing",
      language: "en",
      phrase: "accurate word timing",
      idempotencyKey: "suggest-shared-keyword-timing",
    });
    if (suggestion.resolution === "already_approved") {
      throw new Error("Expected a pending keyword suggestion.");
    }
    await catalog.reviewProjectKeywordSuggestion(
      owner,
      project.id,
      suggestion.suggestion.id,
      {
        action: "approve",
        expectedSuggestionVersion: 1,
        expectedKeywordSetVersion: 1,
        idempotencyKey: "approve-shared-keyword-timing",
      },
    );

    let delivered = false;
    const workerClient: ProjectKeywordScanControlPlane = {
      claim: async () => {
        if (delivered) return undefined;
        delivered = true;
        return workerCatalog.claimProjectKeywordScan(worker, undefined, {
          leaseSeconds: 120,
        });
      },
      getInput: (claim: ProjectKeywordScanClaim) =>
        workerCatalog.getProjectKeywordScanInput(
          worker,
          claim.job.projectId,
          claim.job.id,
          { attempt: claim.attempt },
        ),
      heartbeat: (claim: ProjectKeywordScanClaim) =>
        workerCatalog.heartbeatProjectKeywordScan(
          worker,
          claim.job.projectId,
          claim.job.id,
          { attempt: claim.attempt, leaseSeconds: 120 },
        ),
      createUpload: (claim: ProjectKeywordScanClaim) =>
        workerCatalog.createProjectKeywordScanArtifactUpload(
          worker,
          claim.job.projectId,
          claim.job.id,
          { attempt: claim.attempt },
        ),
      upload: async (
        grant: ProjectKeywordScanArtifactUploadGrant,
        bytes: Uint8Array,
      ) => {
        const stored = await objectStore.put({
          key: grant.objectKey,
          bytes,
          contentType: "application/json",
          sha256: digest(bytes),
        });
        return stored.versionId;
      },
      finalize: (
        claim: ProjectKeywordScanClaim,
        request: FinalizeProjectKeywordScanRequest,
      ) =>
        workerCatalog.finalizeProjectKeywordScan(
          worker,
          claim.job.projectId,
          claim.job.id,
          request,
        ),
      fail: (claim, error) =>
        workerCatalog.failProjectKeywordScan(
          worker,
          claim.job.projectId,
          claim.job.id,
          { attempt: claim.attempt, error },
        ),
      download: async (target) => {
        const stored = await objectStore.get(
          target.objectKey,
          target.objectVersionId,
        );
        if (!stored) throw new Error("Missing transcript fixture object.");
        return stored.bytes;
      },
    };
    await expect(
      new ClaimingProjectKeywordScanWorker(workerClient).runOnce(),
    ).resolves.toBe("processed");
    await expect(
      new ClaimingProjectKeywordScanWorker(workerClient).runOnce(),
    ).resolves.toBe("idle");

    const summary = await secondClient.getProjectKeywordScanSummary(
      collaborator,
      project.id,
      video.id,
    );
    expect(summary).toMatchObject({
      status: "current",
      transcriptVersionId,
      keywordSetVersion: 2,
      occurrenceCount: 1,
      matchedKeywordCount: 1,
    });
    if (!summary.artifact) throw new Error("Expected a scan artifact.");
    if (!summary.scanId) throw new Error("Expected a stable scan ID.");
    const scanId = summary.scanId;
    const target = await secondClient.getProjectKeywordScanArtifactDownload(
      collaborator,
      project.id,
      scanId,
    );
    await objectStore.put({
      key: target.artifact.objectKey,
      bytes: new TextEncoder().encode("replacement"),
      contentType: "application/json",
      sha256: digest(new TextEncoder().encode("replacement")),
    });
    const pinned = await objectStore.get(
      target.artifact.objectKey,
      target.artifact.objectVersionId,
    );
    expect(pinned).toBeDefined();
    expect(digest(pinned!.bytes)).toBe(target.artifact.sha256);
    expect(pinned!.bytes.byteLength).toBe(target.artifact.sizeBytes);
    expect(
      ProjectKeywordMatchArtifactSchema.parse(
        JSON.parse(new TextDecoder().decode(pinned!.bytes)),
      ),
    ).toMatchObject({
      projectId: project.id,
      projectVideoId: video.id,
      transcriptVersionId,
      keywordSetVersion: 2,
      occurrences: [
        {
          startMs: 950,
          endMs: 1_800,
          evidence: [{ language: "en" }],
        },
      ],
    });

    const replacementUpload = await catalog.createTranscriptUpload(owner, {
      projectId: project.id,
      catalogVideoId: video.id,
      lineageId: upload.lineageId,
      version: 2,
      artifactTypes: ["english-normalized", "english-srt"],
    });
    const replacementNormalizedTarget = replacementUpload.targets.find(
      (candidate) => candidate.type === "english-normalized",
    )!;
    const replacementSubtitleTarget = replacementUpload.targets.find(
      (candidate) => candidate.type === "english-srt",
    )!;
    const replacementNormalized = await objectStore.put({
      key: replacementNormalizedTarget.objectKey,
      bytes: transcriptBytes,
      contentType: "application/json",
      sha256: digest(transcriptBytes),
    });
    const replacementSubtitle = await objectStore.put({
      key: replacementSubtitleTarget.objectKey,
      bytes: subtitleBytes,
      contentType: "application/x-subrip",
      sha256: digest(subtitleBytes),
    });
    const replacementTranscriptVersionId = randomUUID();
    const replacementManifest: TranscriptManifest = {
      ...manifest,
      id: replacementTranscriptVersionId,
      version: 2,
      jobId: replacementUpload.jobId,
      createdAt: new Date().toISOString(),
      artifacts: [
        {
          type: "english-normalized",
          objectKey: replacementNormalized.key,
          objectVersionId: replacementNormalized.versionId,
          byteSize: transcriptBytes.byteLength,
          sha256: digest(transcriptBytes),
        },
        {
          type: "english-srt",
          objectKey: replacementSubtitle.key,
          objectVersionId: replacementSubtitle.versionId,
          byteSize: subtitleBytes.byteLength,
          sha256: digest(subtitleBytes),
        },
      ],
    };
    const replacementManifestBytes = new TextEncoder().encode(
      JSON.stringify(replacementManifest),
    );
    const replacementManifestTarget = replacementUpload.targets.find(
      (candidate) => candidate.type === "manifest",
    )!;
    const replacementManifestStored = await objectStore.put({
      key: replacementManifestTarget.objectKey,
      bytes: replacementManifestBytes,
      contentType: "application/json",
      sha256: digest(replacementManifestBytes),
    });
    await catalog.finalizeTranscript(owner, {
      uploadId: replacementUpload.uploadId,
      idempotencyKey: `finalize:${replacementTranscriptVersionId}`,
      manifest: {
        type: "manifest",
        objectKey: replacementManifestStored.key,
        objectVersionId: replacementManifestStored.versionId,
        byteSize: replacementManifestBytes.byteLength,
        sha256: digest(replacementManifestBytes),
      },
    });
    await expect(
      secondClient.getProjectKeywordScanSummary(
        collaborator,
        project.id,
        video.id,
      ),
    ).resolves.toMatchObject({
      status: "queued",
      transcriptVersionId: replacementTranscriptVersionId,
      keywordSetVersion: 2,
    });
    const replacementClaim = await secondClient.claimProjectKeywordScan(
      collaborator,
      undefined,
      { leaseSeconds: 120 },
    );
    expect(replacementClaim).toMatchObject({
      job: {
        transcriptVersionId: replacementTranscriptVersionId,
        keywordSetVersion: 2,
      },
      attempt: 1,
    });
    if (!replacementClaim) throw new Error("Expected replacement scan claim.");
    await expect(
      secondClient.getProjectKeywordScanArtifactDownload(
        collaborator,
        project.id,
        scanId,
      ),
    ).resolves.toMatchObject({ artifact: target.artifact });

    await cloud.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, collaborator.userId],
    );
    const replacementFailure = {
      attempt: replacementClaim.attempt,
      error: {
        code: "replacement_fixture_failed",
        message: "Replacement fixture failed independently.",
      },
    };
    await expect(
      secondClient.getProjectKeywordScanInput(
        collaborator,
        project.id,
        replacementClaim.job.id,
        { attempt: replacementClaim.attempt },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      secondClient.failProjectKeywordScan(
        collaborator,
        project.id,
        replacementClaim.job.id,
        replacementFailure,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await catalog.addMember(
      owner,
      project.id,
      collaborator.userId,
      "researcher",
    );
    const failedReplacement = await secondClient.failProjectKeywordScan(
      collaborator,
      project.id,
      replacementClaim.job.id,
      replacementFailure,
    );
    expect(failedReplacement).toMatchObject({
      status: "failed",
      transcriptVersionId: replacementTranscriptVersionId,
      error: replacementFailure.error,
    });
    await expect(
      secondClient.failProjectKeywordScan(
        collaborator,
        project.id,
        replacementClaim.job.id,
        replacementFailure,
      ),
    ).resolves.toEqual(failedReplacement);
    await expect(
      secondClient.failProjectKeywordScan(
        collaborator,
        project.id,
        replacementClaim.job.id,
        {
          ...replacementFailure,
          error: {
            ...replacementFailure.error,
            message: "Divergent terminal failure.",
          },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      secondClient.getProjectKeywordScanArtifactDownload(
        collaborator,
        project.id,
        scanId,
      ),
    ).resolves.toMatchObject({ artifact: target.artifact });
    await expect(
      secondClient.getProjectKeywordScanArtifactDownload(
        outsider,
        project.id,
        scanId,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("activates a corrected bilingual candidate and freezes its clip and export provenance", async () => {
    const cloud = new PGlite();
    databases.add(cloud);
    await runCloudMigrations(cloud);
    const objectStore = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(cloud, objectStore);
    const owner = actor("corrected-owner");
    await catalog.registerUser(owner, "Corrected transcript owner");

    const project = await catalog.createProject(owner, {
      name: "Corrected transcript project",
    });
    const youtubeVideoId = "CorrectedDzongkha1";
    const canonicalUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    const title = "Corrected bilingual fixture";
    const batch = await catalog.createTranscriptionBatch(owner, {
      projectId: project.id,
      name: "Corrected bilingual batch",
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
          input: canonicalUrl,
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId,
          canonicalUrl,
          title,
          durationMs: 60_000,
          sourceLanguage: "dz",
        },
      ],
    });
    const item = batch.items[0]!;
    const catalogVideoId = item.catalogVideoId!;
    const initialGate = await catalog.getProjectVideoLanguageGate(
      owner,
      project.id,
      catalogVideoId,
    );
    const decision = await catalog.confirmProjectVideoLanguageDecision(
      owner,
      project.id,
      catalogVideoId,
      {
        idempotencyKey: "corrected-confirm-dz",
        expectedDecisionVersion: initialGate.decision?.decisionVersion ?? 0,
        resolvedLanguage: "dz",
        basis: "user_confirmation",
      },
    );

    const makeSrt = (first: string, second: string) =>
      new TextEncoder().encode(
        [
          "1",
          "00:00:00,000 --> 00:00:01,500",
          first,
          "",
          "2",
          "00:00:01,500 --> 00:00:03,000",
          second,
          "",
        ].join("\n"),
      );

    const finalizeCandidate = async (input: {
      suffix: string;
      original: Uint8Array;
      english: Uint8Array;
    }) => {
      const actionable = await cloud.query<{ version: number }>(
        `UPDATE transcription_batch_items
         SET state = 'needs_language_confirmation',
             manual_timed_transcript_candidate_id = NULL,
             version = version + 1
         WHERE id = $1
         RETURNING version`,
        [item.id],
      );
      const grant = await catalog.createManualTimedTranscriptImport(
        owner,
        project.id,
        catalogVideoId,
        {
          idempotencyKey: `corrected-import-${input.suffix}`,
          languageDecisionId: decision.decision.id,
          expectedDecisionVersion: decision.decision.decisionVersion,
          batchItemId: item.id,
          expectedBatchItemVersion: actionable.rows[0]!.version,
          original: {
            format: "srt",
            byteSize: input.original.byteLength,
            sha256: digest(input.original),
          },
          english: {
            format: "srt",
            byteSize: input.english.byteLength,
            sha256: digest(input.english),
          },
        },
      );
      const originalTarget = grant.targets.find(
        (target) => target.role === "original",
      )!;
      const englishTarget = grant.targets.find(
        (target) => target.role === "english",
      )!;
      const storedOriginal = await objectStore.put({
        key: originalTarget.objectKey,
        bytes: input.original,
        contentType: "application/x-subrip",
        sha256: digest(input.original),
      });
      const storedEnglish = await objectStore.put({
        key: englishTarget.objectKey,
        bytes: input.english,
        contentType: "application/x-subrip",
        sha256: digest(input.english),
      });
      const finalized = await catalog.finalizeManualTimedTranscriptImport(
        owner,
        project.id,
        catalogVideoId,
        grant.importId,
        {
          idempotencyKey: `corrected-finalize-${input.suffix}`,
          original: {
            objectVersionId: storedOriginal.versionId,
            byteSize: storedOriginal.bytes.byteLength,
            sha256: storedOriginal.sha256,
          },
          english: {
            objectVersionId: storedEnglish.versionId,
            byteSize: storedEnglish.bytes.byteLength,
            sha256: storedEnglish.sha256,
          },
        },
      );
      const review = await catalog.reviewManualTimedTranscriptCandidate(
        owner,
        project.id,
        catalogVideoId,
        finalized.candidate!.candidateId,
        { offset: 0, limit: 25 },
      );
      const activation = await catalog.activateManualTimedTranscriptCandidate(
        owner,
        project.id,
        catalogVideoId,
        {
          idempotencyKey: `corrected-activate-${input.suffix}`,
          importId: review.importId,
          candidateId: review.candidateId,
          transcriptVersionId: review.transcriptVersionId,
          expectedProjectVideoVersion: review.projectVideoVersion,
          languageDecisionId: review.languageDecisionId,
          expectedLanguageDecisionVersion: review.languageDecisionVersion,
        },
      );
      expect(activation).toMatchObject({
        state: "activated",
        candidateId: review.candidateId,
        transcriptVersionId: review.transcriptVersionId,
      });
      return { finalized, review, activation };
    };

    const correctedOriginal = makeSrt("བཀྲ་ཤིས།", "ལེགས་སོ།");
    const correctedEnglish = makeSrt("Hello", "This is corrected.");
    const corrected = await finalizeCandidate({
      suffix: "v1",
      original: correctedOriginal,
      english: correctedEnglish,
    });
    const active = await catalog.getActiveTranscript(
      owner,
      project.id,
      catalogVideoId,
    );
    expect(active.transcriptVersionId).toBe(
      corrected.review.transcriptVersionId,
    );
    expect(active.manifest).toMatchObject({
      id: corrected.review.transcriptVersionId,
      manualImportId: corrected.review.importId,
      sourceLanguage: "dz",
      targetLanguage: "en",
      languageDecision: {
        decisionId: decision.decision.id,
        decisionVersion: decision.decision.decisionVersion,
      },
    });

    const resolveOnWorkstation = async (name: string) => {
      const root = mkdtempSync(join(tmpdir(), `corrected-cache-${name}-`));
      temporaryDirectories.add(root);
      const localDatabase = openLocalDatabase(join(root, "catalog.sqlite"));
      try {
        runLocalMigrations(localDatabase);
        const downloader = new ObjectStoreArtifactDownloader(objectStore);
        let downloadCount = 0;
        const cacheRoot = join(root, "artifacts");
        const service = new SharedTranscriptWorkspaceService(
          new SharedFirstTranscriptResolver(
            {
              getActiveTranscript: (projectId, videoId) =>
                catalog.getActiveTranscript(owner, projectId, videoId),
            },
            new VerifiedTranscriptCache(
              localDatabase,
              {
                download: async (target) => {
                  downloadCount += 1;
                  return downloader.download(target);
                },
              },
              cacheRoot,
            ),
          ),
          new CachedTranscriptDocumentReader(
            new LocalTranscriptIndex(localDatabase),
            cacheRoot,
          ),
        );
        const first = await service.resolve(project.id, catalogVideoId);
        expect(first.source).toBe("shared-store");
        expect(first.bundle.transcriptVersionId).toBe(
          corrected.review.transcriptVersionId,
        );
        expect(downloadCount).toBeGreaterThan(0);
        const downloadsAfterFirst = downloadCount;
        const second = await service.resolve(project.id, catalogVideoId);
        expect(second.source).toBe("verified-local-cache");
        expect(second.bundle.transcriptVersionId).toBe(
          first.bundle.transcriptVersionId,
        );
        expect(realpathSync(second.cachePath)).toBe(
          realpathSync(first.cachePath),
        );
        expect(downloadCount).toBe(downloadsAfterFirst);
        return {
          transcriptVersionId: first.workspace.transcriptVersionId,
          original: first.workspace.original,
          english: first.workspace.english,
        };
      } finally {
        localDatabase.close();
      }
    };

    const workstationA = await resolveOnWorkstation("a");
    const workstationB = await resolveOnWorkstation("b");
    expect(workstationB).toEqual(workstationA);
    expect(workstationA).toMatchObject({
      transcriptVersionId: corrected.review.transcriptVersionId,
      original: {
        track: {
          id: corrected.review.original.trackId,
          version: corrected.review.original.trackVersion,
          language: "dz",
          kind: "original",
          source: "manual-import",
        },
      },
      english: {
        track: {
          id: corrected.review.english.trackId,
          version: corrected.review.english.trackVersion,
          language: "en",
          kind: "english",
          source: "manual-import",
          sourceTrackId: corrected.review.original.trackId,
        },
      },
    });

    const englishFirst = workstationA.english.segments[0]!;
    const englishLast = workstationA.english.segments.at(-1)!;
    const selection = {
      trackId: workstationA.english.track.id,
      transcriptVersion: workstationA.english.track.version,
      firstSegmentId: englishFirst.id,
      lastSegmentId: englishLast.id,
      transcriptStartMs: englishFirst.startMs,
      transcriptEndMs: englishLast.endMs,
      exportStartMs: englishFirst.startMs,
      exportEndMs: englishLast.endMs,
      text: workstationA.english.segments
        .map((segment) => segment.text)
        .join(" "),
      timingPrecision: workstationA.english.track.timingPrecision,
    };
    const nativeText = workstationA.original.segments
      .map((segment) => segment.text)
      .join(" ");
    const clip = await catalog.createClipCandidate(owner, project.id, {
      idempotencyKey: "corrected-clip-v1",
      video: {
        youtubeVideoId,
        canonicalUrl,
        title,
        sourceLanguage: "dz",
      },
      selection,
      languageEvidence: {
        schemaVersion: 2,
        native: {
          role: "native",
          language: workstationA.original.track.language,
          text: nativeText,
          trackId: workstationA.original.track.id,
          trackVersion: workstationA.original.track.version,
          timingPrecision: workstationA.original.track.timingPrecision,
        },
        english: {
          role: "english",
          language: workstationA.english.track.language,
          text: selection.text,
          trackId: workstationA.english.track.id,
          trackVersion: workstationA.english.track.version,
          sourceTrackId: workstationA.english.track.sourceTrackId,
          timingPrecision: workstationA.english.track.timingPrecision,
        },
      },
      notes: "Corrected transcript provenance",
      tags: ["correction"],
    });
    expect(clip.selection).toEqual(selection);
    expect(clip.languageEvidence).toEqual({
      schemaVersion: 2,
      native: {
        role: "native",
        language: workstationA.original.track.language,
        text: nativeText,
        trackId: workstationA.original.track.id,
        trackVersion: workstationA.original.track.version,
        timingPrecision: workstationA.original.track.timingPrecision,
      },
      english: {
        role: "english",
        language: workstationA.english.track.language,
        text: selection.text,
        trackId: workstationA.english.track.id,
        trackVersion: workstationA.english.track.version,
        sourceTrackId: workstationA.original.track.id,
        timingPrecision: workstationA.english.track.timingPrecision,
      },
    });

    const settingsSelection = {
      base: "application_default" as const,
      overrides: {},
    };
    const preview = await catalog.previewProjectExportSettings(
      owner,
      project.id,
      { sourceLanguageClass: "foreign", selection: settingsSelection },
    );
    const subtitleTracks = {
      original: {
        trackId: workstationA.original.track.id,
        trackVersion: workstationA.original.track.version,
      },
      english: {
        trackId: workstationA.english.track.id,
        trackVersion: workstationA.english.track.version,
      },
    };
    const sourceRights = {
      schemaVersion: 1 as const,
      source: "youtube" as const,
      youtubeVideoId,
      confirmation: "authorized_to_process" as const,
      disclosureVersion: 1,
    };
    const exportRequest = await catalog.createClipExport(
      owner,
      project.id,
      clip.id,
      {
        idempotencyKey: "corrected-export-v1",
        sourceLanguageClass: "foreign",
        subtitleTracks,
        sourceRights,
        settingsSelection,
        expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
      },
    );
    expect(exportRequest).toMatchObject({
      selection,
      subtitleTracks,
      sourceRights,
      resolvedSettingsSnapshot: {
        resolutionFingerprint: preview.snapshot.resolutionFingerprint,
      },
    });
    const persisted = await cloud.query<{
      selection_snapshot: typeof selection;
      subtitle_tracks_snapshot: typeof subtitleTracks;
      source_rights_snapshot: typeof sourceRights;
      resolved_settings_snapshot: typeof exportRequest.resolvedSettingsSnapshot;
      payload: {
        selection: typeof selection;
        subtitleTracks: typeof subtitleTracks;
        sourceRights: typeof sourceRights;
        resolvedSettingsSnapshot: typeof exportRequest.resolvedSettingsSnapshot;
      };
    }>(
      `SELECT er.selection_snapshot, er.subtitle_tracks_snapshot,
              er.source_rights_snapshot, er.resolved_settings_snapshot,
              j.payload
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       WHERE er.id = $1`,
      [exportRequest.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      selection_snapshot: selection,
      subtitle_tracks_snapshot: subtitleTracks,
      source_rights_snapshot: sourceRights,
      resolved_settings_snapshot: exportRequest.resolvedSettingsSnapshot,
      payload: {
        selection,
        subtitleTracks,
        sourceRights,
        resolvedSettingsSnapshot: exportRequest.resolvedSettingsSnapshot,
      },
    });
    const frozenClip = await catalog.getClipCandidate(
      owner,
      project.id,
      clip.id,
    );
    const frozenExport = await catalog.getLoggedExportRequest(
      owner,
      project.id,
      exportRequest.id,
    );

    const later = await finalizeCandidate({
      suffix: "v2",
      original: makeSrt("ཕྱིས་ཀྱི་ཐོན་རིམ།", "གསར་པ།"),
      english: makeSrt("Later version", "New evidence"),
    });
    expect(later.review.transcriptVersionId).not.toBe(
      corrected.review.transcriptVersionId,
    );
    expect(
      (await catalog.getActiveTranscript(owner, project.id, catalogVideoId))
        .transcriptVersionId,
    ).toBe(later.review.transcriptVersionId);
    expect(await catalog.getClipCandidate(owner, project.id, clip.id)).toEqual(
      frozenClip,
    );
    expect(
      await catalog.getLoggedExportRequest(owner, project.id, exportRequest.id),
    ).toEqual(frozenExport);
  });
});
