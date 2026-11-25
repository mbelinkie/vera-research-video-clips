import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ProjectKeywordScanClaimSchema,
  ProjectKeywordScanInputSnapshotSchema,
  ProjectKeywordScanSummarySchema,
  TranscriptManifestSchema,
  type FinalizeProjectKeywordScanRequest,
  type ProjectKeywordScanArtifactUploadGrant,
  type ProjectKeywordScanClaim,
  type ProjectKeywordScanInputSnapshot,
  type ProjectKeywordScanSummary,
  type TranscriptDownloadTarget,
} from "@research-video/contracts";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import wordFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };

import {
  ClaimingProjectKeywordScanWorker,
  HttpProjectKeywordScanControlPlane,
  ProjectKeywordScanWorkerError,
  ProjectKeywordScanWorkerService,
  downloadVerifiedTranscriptTracks,
  type ProjectKeywordScanControlPlane,
} from "./keyword-scan.ts";

const now = "2026-08-24T12:00:00.000Z";
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const projectId = randomUUID();
  const projectVideoId = randomUUID();
  const transcriptVersionId = randomUUID();
  const workerId = randomUUID();
  const scanId = randomUUID();
  const transcript = normalizeTranscriptFixture({
    ...wordFixture,
    track: { ...wordFixture.track, videoId: "KeywordWorker01" },
  });
  const transcriptBytes = new TextEncoder().encode(JSON.stringify(transcript));
  const normalized = {
    type: "english-normalized" as const,
    objectKey: `projects/${projectId}/english.normalized.json`,
    objectVersionId: "normalized-version-1",
    byteSize: transcriptBytes.byteLength,
    sha256: sha256(transcriptBytes),
  };
  const manifest = TranscriptManifestSchema.parse({
    schemaVersion: 1,
    id: transcriptVersionId,
    projectId,
    catalogVideoId: projectVideoId,
    videoId: transcript.track.videoId,
    lineageId: randomUUID(),
    version: 1,
    sourceLanguage: "en",
    targetLanguage: "en",
    timingPrecision: "word",
    provider: "fixture",
    normalizationSchemaVersion: 1,
    jobId: randomUUID(),
    createdBy: workerId,
    createdAt: now,
    artifacts: [normalized],
  });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestObject = {
    type: "manifest" as const,
    objectKey: `projects/${projectId}/manifest.json`,
    objectVersionId: "manifest-version-1",
    byteSize: manifestBytes.byteLength,
    sha256: sha256(manifestBytes),
  };
  const downloads = [
    { ...manifestObject, downloadUrl: "https://objects.invalid/manifest" },
    { ...normalized, downloadUrl: "https://objects.invalid/english" },
  ];
  const claim = ProjectKeywordScanClaimSchema.parse({
    job: {
      id: scanId,
      projectId,
      projectVideoId,
      transcriptVersionId,
      keywordSetVersion: 2,
      scannerSchemaVersion: 1,
      state: "scanning",
      attempt: 1,
      approvedKeywordCount: 1,
      createdAt: now,
      updatedAt: now,
    },
    workerId,
    attempt: 1,
    claimedAt: now,
    heartbeatAt: now,
    expiresAt: "2026-08-24T12:02:00.000Z",
  });
  const input = ProjectKeywordScanInputSnapshotSchema.parse({
    job: claim.job,
    attempt: 1,
    aliases: [
      {
        keywordId: randomUUID(),
        aliasId: randomUUID(),
        language: "en",
        phrase: "accurate word timing",
      },
    ],
    transcript: {
      transcriptVersionId,
      manifest,
      manifestObject,
      downloads,
    },
    durationMs: 4_000,
  });
  const objects = new Map([
    [downloads[0]!.downloadUrl, manifestBytes],
    [downloads[1]!.downloadUrl, transcriptBytes],
  ]);
  return { claim, input, objects };
}

function controlPlane(input: {
  claim: ProjectKeywordScanClaim;
  snapshot: ProjectKeywordScanInputSnapshot;
  objects: Map<string, Uint8Array>;
  overrides?: Partial<ProjectKeywordScanControlPlane>;
}) {
  const uploaded: Uint8Array[] = [];
  const finalized: FinalizeProjectKeywordScanRequest[] = [];
  const grant: ProjectKeywordScanArtifactUploadGrant = {
    scanId: input.claim.job.id,
    objectKey: `keyword-scans/${input.claim.job.projectId}/${input.claim.job.projectVideoId}/${input.claim.job.id}/matches.json`,
    uploadUrl: "https://objects.invalid/upload",
    expiresAt: "2026-08-24T12:01:00.000Z",
  };
  const api: ProjectKeywordScanControlPlane = {
    claim: vi.fn(async () => input.claim),
    getInput: vi.fn(async () => input.snapshot),
    heartbeat: vi.fn(async () => input.claim),
    createUpload: vi.fn(async () => grant),
    upload: vi.fn(async (_grant, bytes) => {
      uploaded.push(bytes.slice());
      return "artifact-version-1";
    }),
    finalize: vi.fn(async (_claim, request) => {
      finalized.push(request);
      return ProjectKeywordScanSummarySchema.parse({
        projectId: input.claim.job.projectId,
        projectVideoId: input.claim.job.projectVideoId,
        scanId: input.claim.job.id,
        status: "current",
        transcriptVersionId: input.claim.job.transcriptVersionId,
        keywordSetVersion: input.claim.job.keywordSetVersion,
        scannerSchemaVersion: 1,
        occurrenceCount: request.occurrenceCount,
        matchedKeywordCount: request.matchedKeywordCount,
        keywordCounts: request.keywordCounts,
        approvedKeywordCount: input.claim.job.approvedKeywordCount,
        durationMs: request.durationMs,
        matchesPerMinute:
          (request.occurrenceCount * 60_000) / request.durationMs!,
        artifact: request.artifact,
        completedAt: now,
      });
    }),
    fail: vi.fn(async () => {
      throw new Error("unexpected failure");
    }),
    download: vi.fn(async (target: TranscriptDownloadTarget) => {
      const bytes = input.objects.get(target.downloadUrl);
      if (!bytes) throw new Error("missing fixture object");
      return bytes.slice();
    }),
    ...input.overrides,
  };
  return { api, uploaded, finalized };
}

describe("project keyword scan worker", () => {
  it("downloads the exact verified transcript, scans, uploads, and finalizes", async () => {
    const value = fixture();
    const { api, uploaded, finalized } = controlPlane({
      claim: value.claim,
      snapshot: value.input,
      objects: value.objects,
    });
    const worker = new ClaimingProjectKeywordScanWorker(api);

    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(uploaded).toHaveLength(1);
    const artifact = JSON.parse(new TextDecoder().decode(uploaded[0]));
    expect(artifact).toMatchObject({
      projectId: value.claim.job.projectId,
      transcriptVersionId: value.claim.job.transcriptVersionId,
      occurrences: [
        {
          startMs: 950,
          endMs: 1_800,
          timingPrecision: "word",
          evidence: [{ language: "en" }],
        },
      ],
    });
    expect(finalized).toEqual([
      expect.objectContaining({
        attempt: 1,
        occurrenceCount: 1,
        matchedKeywordCount: 1,
        keywordCounts: [
          {
            keywordId: value.input.aliases[0]!.keywordId,
            occurrenceCount: 1,
          },
        ],
        durationMs: 4_000,
        artifact: expect.objectContaining({
          objectVersionId: "artifact-version-1",
          sha256: sha256(uploaded[0]!),
        }),
      }),
    ]);
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("composes the strict HTTP claim/input/download/upload/finalize path", async () => {
    const value = fixture();
    const requested: Array<{ path: string; method: string; body?: unknown }> =
      [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requested.push({
          path: url.pathname,
          method,
          ...(body ? { body } : {}),
        });
        const json = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), {
            status,
            headers: { "content-type": "application/json" },
          });
        if (url.pathname === "/api/keyword-scans/claim") {
          return json(value.claim);
        }
        if (url.pathname.endsWith("/input")) return json(value.input);
        if (url.pathname.endsWith("/artifact-upload")) {
          return json({
            scanId: value.claim.job.id,
            objectKey: `keyword-scans/${value.claim.job.projectId}/${value.claim.job.projectVideoId}/${value.claim.job.id}/matches.json`,
            uploadUrl: "https://objects.invalid/upload",
            expiresAt: "2026-08-24T12:01:00.000Z",
          });
        }
        if (url.pathname.endsWith("/finalize")) {
          const command = body as FinalizeProjectKeywordScanRequest;
          return json(
            ProjectKeywordScanSummarySchema.parse({
              projectId: value.claim.job.projectId,
              projectVideoId: value.claim.job.projectVideoId,
              scanId: value.claim.job.id,
              status: "current",
              transcriptVersionId: value.claim.job.transcriptVersionId,
              keywordSetVersion: value.claim.job.keywordSetVersion,
              scannerSchemaVersion: 1,
              occurrenceCount: command.occurrenceCount,
              matchedKeywordCount: command.matchedKeywordCount,
              keywordCounts: command.keywordCounts,
              approvedKeywordCount: 1,
              durationMs: command.durationMs,
              matchesPerMinute: 15,
              artifact: command.artifact,
              completedAt: now,
            }),
          );
        }
        if (url.href === "https://objects.invalid/upload") {
          return new Response(null, {
            status: 200,
            headers: { "x-amz-version-id": "http-artifact-version-1" },
          });
        }
        const bytes = value.objects.get(url.href);
        if (bytes) return new Response(bytes, { status: 200 });
        return json(
          { error: { code: "not_found", message: "Not found" } },
          404,
        );
      },
    );
    const controlPlane = new HttpProjectKeywordScanControlPlane({
      baseUrl: "https://api.invalid",
      authorization: "Bearer fixture",
      leaseSeconds: 120,
      fetcher: fetcher as typeof fetch,
    });

    await expect(
      new ClaimingProjectKeywordScanWorker(controlPlane).runOnce(),
    ).resolves.toBe("processed");
    expect(requested.map((request) => request.path)).toEqual([
      "/api/keyword-scans/claim",
      `/api/projects/${value.claim.job.projectId}/keyword-scans/${value.claim.job.id}/input`,
      "/manifest",
      "/english",
      `/api/projects/${value.claim.job.projectId}/keyword-scans/${value.claim.job.id}/artifact-upload`,
      "/upload",
      `/api/projects/${value.claim.job.projectId}/keyword-scans/${value.claim.job.id}/finalize`,
    ]);
    expect(requested.at(-1)?.body).toMatchObject({
      attempt: 1,
      occurrenceCount: 1,
      artifact: { objectVersionId: "http-artifact-version-1" },
    });
  });

  it("rejects changed transcript bytes before matching or upload", async () => {
    const value = fixture();
    const corrupted = new Map(value.objects);
    corrupted.set(
      "https://objects.invalid/english",
      new TextEncoder().encode("corrupted"),
    );
    const failure = vi.fn(async () =>
      ProjectKeywordScanSummarySchema.parse({
        projectId: value.claim.job.projectId,
        projectVideoId: value.claim.job.projectVideoId,
        scanId: value.claim.job.id,
        status: "failed",
        transcriptVersionId: value.claim.job.transcriptVersionId,
        keywordSetVersion: value.claim.job.keywordSetVersion,
        scannerSchemaVersion: 1,
        approvedKeywordCount: 1,
        error: {
          code: "keyword_scan_transcript_integrity_failed",
          message: "Downloaded transcript artifact failed verification.",
        },
      }),
    );
    const { api, uploaded } = controlPlane({
      claim: value.claim,
      snapshot: value.input,
      objects: corrupted,
      overrides: { fail: failure },
    });

    await expect(
      new ClaimingProjectKeywordScanWorker(api).runOnce(),
    ).resolves.toBe("failed");
    expect(uploaded).toHaveLength(0);
    expect(failure).toHaveBeenCalledWith(value.claim, {
      code: "keyword_scan_transcript_integrity_failed",
      message: "Downloaded transcript artifact failed verification.",
    });
  });

  it("finalizes a genuine zero-match result when no aliases are approved", async () => {
    const value = fixture();
    const snapshot = ProjectKeywordScanInputSnapshotSchema.parse({
      ...value.input,
      job: {
        ...value.input.job,
        keywordSetVersion: 1,
        approvedKeywordCount: 0,
      },
      aliases: [],
    });
    const claim = ProjectKeywordScanClaimSchema.parse({
      ...value.claim,
      job: snapshot.job,
    });
    const { api, uploaded, finalized } = controlPlane({
      claim,
      snapshot,
      objects: value.objects,
    });

    await expect(
      new ClaimingProjectKeywordScanWorker(api).runOnce(),
    ).resolves.toBe("processed");
    expect(JSON.parse(new TextDecoder().decode(uploaded[0]))).toMatchObject({
      keywordSetVersion: 1,
      occurrences: [],
    });
    expect(finalized[0]).toMatchObject({
      occurrenceCount: 0,
      matchedKeywordCount: 0,
      keywordCounts: [],
    });
  });

  it("does not persist details from an unknown failure", async () => {
    const value = fixture();
    const failure = vi.fn(async (_claim, error) =>
      ProjectKeywordScanSummarySchema.parse({
        projectId: value.claim.job.projectId,
        projectVideoId: value.claim.job.projectVideoId,
        scanId: value.claim.job.id,
        status: "failed",
        transcriptVersionId: value.claim.job.transcriptVersionId,
        keywordSetVersion: value.claim.job.keywordSetVersion,
        scannerSchemaVersion: 1,
        approvedKeywordCount: value.claim.job.approvedKeywordCount,
        error,
      }),
    );
    const { api } = controlPlane({
      claim: value.claim,
      snapshot: value.input,
      objects: value.objects,
      overrides: {
        getInput: vi.fn(async () => {
          throw new ProjectKeywordScanWorkerError(
            "failed at /private/research with https://objects.invalid/presigned?token=secret",
            { code: "transcript_integrity_failed", retryable: false },
          );
        }),
        fail: failure,
      },
    });

    await expect(
      new ClaimingProjectKeywordScanWorker(api).runOnce(),
    ).resolves.toBe("failed");
    expect(failure).toHaveBeenCalledWith(value.claim, {
      code: "transcript_integrity_failed",
      message: "Keyword scan worker failed.",
    });
  });

  it("reports lease loss when a stale worker cannot record its failure", async () => {
    const value = fixture();
    const api = controlPlane({
      claim: value.claim,
      snapshot: value.input,
      objects: value.objects,
      overrides: {
        heartbeat: vi.fn(async () => {
          throw new Error("lease reclaimed");
        }),
        getInput: vi.fn(
          async () =>
            new Promise<ProjectKeywordScanInputSnapshot>((resolve) =>
              setTimeout(() => resolve(value.input), 20),
            ),
        ),
        fail: vi.fn(async () => {
          throw new Error("stale attempt");
        }),
      },
    }).api;

    await expect(
      new ClaimingProjectKeywordScanWorker(api, {
        heartbeatIntervalMs: 1,
      }).runOnce(),
    ).resolves.toBe("lease-lost");
    expect(api.finalize).not.toHaveBeenCalled();
  });

  it("rejects a transcript download target that no longer matches the manifest", async () => {
    const value = fixture();
    const mismatched = ProjectKeywordScanInputSnapshotSchema.parse({
      ...value.input,
      transcript: {
        ...value.input.transcript,
        downloads: value.input.transcript.downloads.map((target) =>
          target.type === "english-normalized"
            ? { ...target, objectVersionId: "replacement-version" }
            : target,
        ),
      },
    });
    const api = controlPlane({
      claim: value.claim,
      snapshot: mismatched,
      objects: value.objects,
    }).api;

    await expect(
      downloadVerifiedTranscriptTracks(api, mismatched),
    ).rejects.toMatchObject({
      code: "keyword_scan_transcript_integrity_failed",
    });
  });

  it("continues polling sibling scans after one durable failure", async () => {
    const shutdown = new AbortController();
    const results: Array<"failed" | "processed" | "idle"> = [
      "failed",
      "processed",
      "idle",
    ];
    const runOnce = vi.fn(async () => {
      const result = results.shift() ?? "idle";
      if (result === "idle") shutdown.abort();
      return result;
    });
    const service = new ProjectKeywordScanWorkerService(
      { runOnce },
      { idlePollMs: 1, errorBackoffMs: 1 },
    );

    await expect(service.run(shutdown.signal)).resolves.toEqual({
      processed: 1,
      failed: 1,
      leaseLost: 0,
      unexpectedErrors: 0,
    });
    expect(runOnce).toHaveBeenCalledTimes(3);
  });
});
