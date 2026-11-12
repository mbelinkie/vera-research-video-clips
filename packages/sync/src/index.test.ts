import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ActiveTranscriptBundleSchema,
  ClipCandidateSchema,
  TranscriptManifestSchema,
  type NormalizedTranscript,
  type TranscriptArtifact,
} from "@research-video/contracts";

import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import {
  LocalCacheIntegrityError,
  MemoryJobQueue,
  OfflineOutbox,
  readVerifiedLoggedClipTracks,
} from "./index.ts";

const temporaryCachePaths: string[] = [];
afterEach(() => {
  for (const path of temporaryCachePaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifiedLoggedClipFixture(
  options: {
    bilingual?: boolean;
    includeOriginal?: boolean;
    englishVideoId?: string;
    originalVideoId?: string;
    unlinkTracks?: boolean;
    selectionTrackId?: string;
    selectionVersion?: number;
    englishVersion?: number;
  } = {},
) {
  const bilingual = options.bilingual ?? false;
  const directory = mkdtempSync(join(tmpdir(), "verified-logged-clip-"));
  temporaryCachePaths.push(directory);
  const projectId = randomUUID();
  const catalogVideoId = randomUUID();
  const transcriptVersionId = randomUUID();
  const englishId = randomUUID();
  const originalId = randomUUID();
  const videoId = "M7lc1UVf-VE";
  const sourceLanguage = bilingual ? "es" : "en";
  const english: NormalizedTranscript = {
    track: {
      id: englishId,
      videoId: options.englishVideoId ?? videoId,
      language: "en",
      kind: "english",
      source: bilingual ? "translated" : "generated",
      provider: "fixture",
      ...(bilingual
        ? { sourceTrackId: options.unlinkTracks ? randomUUID() : originalId }
        : {}),
      timingPrecision: "cue",
      schemaVersion: 1,
      contentSha256: "1".repeat(64),
      version: options.englishVersion ?? 1,
    },
    segments: [
      {
        id: randomUUID(),
        trackId: englishId,
        ordinal: 0,
        startMs: 500,
        endMs: 2_500,
        text: "A logged selection.",
      },
    ],
    tokens: [],
  };
  const original: NormalizedTranscript = {
    track: {
      id: originalId,
      videoId: options.originalVideoId ?? videoId,
      language: "es",
      kind: "original",
      source: "generated",
      provider: "fixture",
      timingPrecision: "cue",
      schemaVersion: 1,
      contentSha256: "2".repeat(64),
      version: 1,
    },
    segments: [
      {
        id: randomUUID(),
        trackId: originalId,
        ordinal: 0,
        startMs: 500,
        endMs: 2_500,
        text: "Una selección.",
      },
    ],
    tokens: [],
  };
  const artifactBytes = (value: NormalizedTranscript) =>
    Buffer.from(JSON.stringify(value));
  const artifacts: TranscriptArtifact[] = [];
  const downloadTargets = [];
  for (const [type, transcript] of [
    ["english-normalized", english],
    ...(bilingual && options.includeOriginal !== false
      ? [["original-normalized", original]]
      : []),
  ] as Array<
    ["english-normalized" | "original-normalized", NormalizedTranscript]
  >) {
    const bytes = artifactBytes(transcript);
    const artifact: TranscriptArtifact = {
      type,
      objectKey: `project/transcript/${type}.json`,
      objectVersionId: `version-${type}`,
      byteSize: bytes.byteLength,
      sha256: sha(bytes),
    };
    artifacts.push(artifact);
    downloadTargets.push({
      ...artifact,
      downloadUrl: `https://example.invalid/${type}`,
    });
    writeFileSync(join(directory, `${type}.json`), bytes);
  }
  const manifest = TranscriptManifestSchema.parse({
    schemaVersion: 1,
    id: transcriptVersionId,
    projectId,
    catalogVideoId,
    videoId,
    lineageId: randomUUID(),
    version: 1,
    sourceLanguage,
    targetLanguage: "en",
    timingPrecision: "cue",
    provider: "fixture",
    normalizationSchemaVersion: 1,
    jobId: randomUUID(),
    createdBy: randomUUID(),
    createdAt: "2026-08-01T00:00:00.000Z",
    artifacts,
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  writeFileSync(join(directory, "manifest.json"), manifestBytes);
  const manifestTarget = {
    type: "manifest" as const,
    objectKey: "project/transcript/manifest.json",
    objectVersionId: "manifest-v1",
    byteSize: manifestBytes.byteLength,
    sha256: sha(manifestBytes),
  };
  const bundle = ActiveTranscriptBundleSchema.parse({
    transcriptVersionId,
    manifest,
    manifestObject: manifestTarget,
    downloads: [
      { ...manifestTarget, downloadUrl: "https://example.invalid/manifest" },
      ...downloadTargets,
    ],
  });
  const clip = ClipCandidateSchema.parse({
    id: randomUUID(),
    projectId,
    catalogVideoId,
    video: {
      youtubeVideoId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: "Fixture video",
      sourceLanguage,
    },
    selection: {
      trackId: options.selectionTrackId ?? englishId,
      transcriptVersion: options.selectionVersion ?? 1,
      firstSegmentId: english.segments[0]!.id,
      lastSegmentId: english.segments[0]!.id,
      transcriptStartMs: 500,
      transcriptEndMs: 2_500,
      exportStartMs: 0,
      exportEndMs: 3_000,
      text: "A logged selection.",
      timingPrecision: "cue",
    },
    englishText: "A logged selection.",
    ...(bilingual ? { originalText: "Una selección." } : {}),
    notes: "",
    tags: [],
    researchStatus: "candidate",
    exportStatus: "not_requested",
    createdBy: randomUUID(),
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  return {
    resolution: {
      cachePath: directory,
      bundle,
      source: "verified-local-cache" as const,
    },
    clip,
    directory,
    english,
    original,
  };
}

describe("verified logged-clip transcript artifacts", () => {
  it("pins exact English selection and returns only its independently verified track", () => {
    const { resolution, clip, english } = verifiedLoggedClipFixture();
    expect(
      readVerifiedLoggedClipTracks({
        resolution,
        clip,
        sourceLanguageClass: "confirmed_english",
      }),
    ).toEqual({
      english,
      transcriptVersionId: resolution.bundle.transcriptVersionId,
    });
  });

  it.each(["foreign", "mixed", "unknown"] as const)(
    "requires both linked original and English for %s source class",
    (sourceLanguageClass) => {
      const { resolution, clip, english, original } = verifiedLoggedClipFixture(
        {
          bilingual: true,
        },
      );
      expect(
        readVerifiedLoggedClipTracks({ resolution, clip, sourceLanguageClass }),
      ).toEqual({
        english,
        original,
        transcriptVersionId: resolution.bundle.transcriptVersionId,
      });
    },
  );

  it("refuses absent original, wrong track/version and reclassified foreign source", () => {
    const missing = verifiedLoggedClipFixture({
      bilingual: true,
      includeOriginal: false,
    });
    expect(() =>
      readVerifiedLoggedClipTracks({
        resolution: missing.resolution,
        clip: missing.clip,
        sourceLanguageClass: "foreign",
      }),
    ).toThrow(LocalCacheIntegrityError);
    expect(() =>
      readVerifiedLoggedClipTracks({
        resolution: missing.resolution,
        clip: missing.clip,
        sourceLanguageClass: "confirmed_english",
      }),
    ).toThrow(/not confirmed English/u);
    for (const options of [
      { selectionTrackId: randomUUID() },
      { selectionVersion: 2 },
      { englishVersion: 2 },
    ]) {
      const { resolution, clip } = verifiedLoggedClipFixture(options);
      expect(() =>
        readVerifiedLoggedClipTracks({
          resolution,
          clip,
          sourceLanguageClass: "confirmed_english",
        }),
      ).toThrow(LocalCacheIntegrityError);
    }
  });

  it("refuses unrelated source-video or unlinked bilingual tracks", () => {
    for (const options of [
      { bilingual: true, englishVideoId: "some-other-video" },
      { bilingual: true, originalVideoId: "some-other-video" },
      { bilingual: true, unlinkTracks: true },
    ]) {
      const { resolution, clip } = verifiedLoggedClipFixture(options);
      expect(() =>
        readVerifiedLoggedClipTracks({
          resolution,
          clip,
          sourceLanguageClass: "foreign",
        }),
      ).toThrow(LocalCacheIntegrityError);
    }
  });

  it("refuses tampered artifact bytes, symlinks and forged download descriptors", () => {
    const changed = verifiedLoggedClipFixture();
    writeFileSync(
      join(changed.directory, "english-normalized.json"),
      "tampered",
    );
    expect(() =>
      readVerifiedLoggedClipTracks({
        resolution: changed.resolution,
        clip: changed.clip,
        sourceLanguageClass: "confirmed_english",
      }),
    ).toThrow(/bytes changed/u);

    const symlinked = verifiedLoggedClipFixture();
    unlinkSync(join(symlinked.directory, "english-normalized.json"));
    symlinkSync(
      join(symlinked.directory, "manifest.json"),
      join(symlinked.directory, "english-normalized.json"),
    );
    expect(() =>
      readVerifiedLoggedClipTracks({
        resolution: symlinked.resolution,
        clip: symlinked.clip,
        sourceLanguageClass: "confirmed_english",
      }),
    ).toThrow(/missing or unsafe/u);

    const forged = verifiedLoggedClipFixture();
    const resolution = {
      ...forged.resolution,
      bundle: {
        ...forged.resolution.bundle,
        downloads: forged.resolution.bundle.downloads.map((item) =>
          item.type === "english-normalized"
            ? { ...item, objectVersionId: "wrong-version" }
            : item,
        ),
      },
    };
    expect(() =>
      readVerifiedLoggedClipTracks({
        resolution,
        clip: forged.clip,
        sourceLanguageClass: "confirmed_english",
      }),
    ).toThrow(/missing or unpinned/u);
  });
});

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
});
