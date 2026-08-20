import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import { DerivedTranslationSchema } from "@research-video/contracts";
import { createHash, randomUUID } from "node:crypto";

import {
  MemoryJobQueue,
  OfflineOutbox,
  SharedDerivedTranslationResolver,
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
