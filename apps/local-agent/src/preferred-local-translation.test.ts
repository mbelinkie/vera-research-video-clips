import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTranscript } from "@research-video/contracts";
import {
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import { CloudDerivedTranslationClient } from "./derived-translation-client.ts";
import {
  createPreferredLocalTranslationResolver,
  type PreferredLocalTranslationProvider,
} from "./preferred-local-translation.ts";

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe("preferred local translation resolver", () => {
  it("uses the exact local route identity, publishes a local result, and promotes the verified response", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-local-preferred-"),
    );
    temporaryDirectories.add(directory);
    const database = openLocalDatabase(join(directory, "test.sqlite"));
    runLocalMigrations(database);
    const index = new LocalTranscriptIndex(database);
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const spanish = normalizeTranscriptFixture(multilingualFixture.spanish);
    const provider: PreferredLocalTranslationProvider = {
      checkLanguagePair: () => ({
        state: "supported",
        provider: "cloud-managed-argos-local",
        operation: "translation",
        sourceLanguage: "ro",
        targetLanguage: "es",
        version: "fixture",
      }),
      getTranslationProvenance: async () => ({
        provider: "cloud-managed-argos-local",
        model: "argos-ro-en+argos-en-es",
      }),
      translate: vi.fn(async () => ({
        provider: "cloud-managed-argos-local",
        model: "argos-ro-en+argos-en-es",
        segments: spanish.segments.map((segment, index) => ({
          sourceSegmentId: original.segments[index]!.id,
          text: segment.text,
        })),
      })),
    };
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        identity: Record<string, unknown>;
        transcript?: NormalizedTranscript;
      };
      if (!body.transcript) return new Response(null, { status: 204 });
      const encoded = JSON.stringify(body.transcript);
      return new Response(
        JSON.stringify({
          manifest: {
            schemaVersion: 1,
            id: randomUUID(),
            lineageId: randomUUID(),
            version: 1,
            identity: body.identity,
            translatedTrackId: body.transcript.track.id,
            translatedTrackVersion: body.transcript.track.version,
            sourceTrackId: body.transcript.track.sourceTrackId,
            timingPrecision: body.transcript.track.timingPrecision,
            idempotencyKey: "local-translation:fixture",
            createdBy: randomUUID(),
            createdAt: "2026-08-27T12:00:00.000Z",
            artifacts: [
              {
                type: "translated-normalized",
                objectKey: "private/translated.normalized.json",
                objectVersionId: "version-1",
                byteSize: Buffer.byteLength(encoded),
                sha256: createHash("sha256").update(encoded).digest("hex"),
              },
            ],
          },
          transcript: body.transcript,
        }),
        { status: 201 },
      );
    });
    const resolver = createPreferredLocalTranslationResolver({
      provider,
      index,
      cloudClient: new CloudDerivedTranslationClient(
        "https://api.example.test",
        "Bearer local-agent-only-token",
        fetcher as unknown as typeof fetch,
      ),
    });
    const input = {
      projectId: "019fbb95-cd76-7920-93fa-e23ba755e381",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e382",
      transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e383",
      preferredLanguage: "es-MX",
      original,
      english: normalizeTranscriptFixture(multilingualFixture.english),
    };

    const generated = await resolver.requestTranslation!(input);
    expect(generated).toMatchObject({
      track: {
        kind: "translation",
        language: "es-MX",
        provider: "cloud-managed-argos-local",
        model: "argos-ro-en+argos-en-es",
        sourceTrackId: original.track.id,
      },
    });
    expect(provider.translate).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/derived-translations/publish");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer local-agent-only-token",
    });

    await expect(resolver.findLocal!(input)).resolves.toEqual(generated);
    expect(fetcher).toHaveBeenCalledOnce();
    database.close();
  });
});
