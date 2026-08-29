import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { normalizeTranscriptFixture } from "@research-video/transcript";
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import { CloudDerivedTranslationClient } from "./derived-translation-client.ts";

const identity = {
  projectId: "019fbb95-cd76-7920-93fa-e23ba755e391",
  catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755e392",
  baseTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e399",
  originalTrackId: "019fbb95-cd76-7920-93fa-e23ba755e501",
  originalContentSha256: "1".repeat(64),
  targetLanguage: "es-MX",
  provider: "amazon-translate",
  normalizationSchemaVersion: 1,
};

function readyTranslation() {
  const transcript = normalizeTranscriptFixture(multilingualFixture.spanish);
  transcript.track.provider = "amazon-translate";
  return {
    manifest: {
      schemaVersion: 1,
      id: randomUUID(),
      lineageId: randomUUID(),
      version: 1,
      identity,
      translatedTrackId: transcript.track.id,
      translatedTrackVersion: transcript.track.version,
      sourceTrackId: identity.originalTrackId,
      timingPrecision: transcript.track.timingPrecision,
      idempotencyKey: "fixture-ready",
      createdBy: randomUUID(),
      createdAt: "2026-08-20T12:00:00.000Z",
      artifacts: [
        {
          type: "translated-normalized",
          objectKey: "private/translation.json",
          objectVersionId: "version-1",
          byteSize: 1,
          sha256: "a".repeat(64),
        },
      ],
    },
    transcript,
  };
}

describe("CloudDerivedTranslationClient", () => {
  it("looks up the exact identity without creating work and keeps cloud authorization server-side", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(readyTranslation()), { status: 200 }),
    );
    const client = new CloudDerivedTranslationClient(
      "https://api.example.test",
      "Bearer private-desktop-token",
      fetcher as unknown as typeof fetch,
    );

    await expect(
      client.lookupDerivedTranslation(identity),
    ).resolves.toMatchObject({
      transcript: { track: { kind: "translation", language: "es" } },
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://api.example.test/api/projects/${identity.projectId}/videos/${identity.catalogVideoId}/derived-translations/lookup`,
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer private-desktop-token",
      }),
    });
    expect(JSON.parse(String(init.body))).toEqual({ identity });
  });

  it("uses the read-only lookup endpoint with identity only and treats 204 as an ordinary miss", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new CloudDerivedTranslationClient(
      "https://api.example.test",
      "Bearer private-desktop-token",
      fetcher as unknown as typeof fetch,
    );
    await expect(
      client.lookupDerivedTranslation(identity),
    ).resolves.toBeUndefined();
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://api.example.test/api/projects/${identity.projectId}/videos/${identity.catalogVideoId}/derived-translations/lookup`,
    );
    expect(JSON.parse(String(init.body))).toEqual({ identity });
  });

  it("publishes a locally normalized translation through the authorized durable lineage", async () => {
    const published = readyTranslation();
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(published), { status: 201 }),
    );
    const client = new CloudDerivedTranslationClient(
      "https://api.example.test",
      "Bearer private-desktop-token",
      fetcher as unknown as typeof fetch,
    );
    const result = await client.publishDerivedTranslation({
      identity,
      idempotencyKey: "local-argos:fixture",
      transcript: published.transcript,
    });
    expect(result.manifest.identity).toEqual(identity);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://api.example.test/api/projects/${identity.projectId}/videos/${identity.catalogVideoId}/derived-translations/publish`,
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer private-desktop-token",
      }),
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      identity,
      idempotencyKey: "local-argos:fixture",
    });
  });

  it("rejects malformed or mismatched upstream responses with safe bounded errors", async () => {
    const malformedReady = new CloudDerivedTranslationClient(
      "https://api.example.test",
      "Bearer private-desktop-token",
      (async () =>
        new Response(JSON.stringify({ manifest: { state: "ready" } }), {
          status: 200,
        })) as unknown as typeof fetch,
    );
    const mismatchedReady = readyTranslation();
    mismatchedReady.manifest.identity = { ...identity, targetLanguage: "fr" };
    const mismatchedIdentity = new CloudDerivedTranslationClient(
      "https://api.example.test",
      "Bearer private-desktop-token",
      (async () =>
        new Response(JSON.stringify(mismatchedReady), {
          status: 200,
        })) as unknown as typeof fetch,
    );
    for (const client of [malformedReady, mismatchedIdentity]) {
      await expect(
        client.lookupDerivedTranslation(identity),
      ).rejects.toMatchObject({
        statusCode: 502,
        code: "derived_translation_invalid_response",
        message: "The preferred translation is temporarily unavailable.",
      });
    }
  });

  it("maps authentication failures without leaking credentials or response detail", async () => {
    const client = new CloudDerivedTranslationClient(
      "https://api.example.test",
      "Bearer private-desktop-token",
      (async () =>
        new Response(
          JSON.stringify({ error: { message: "token private-desktop-token" } }),
          { status: 401 },
        )) as unknown as typeof fetch,
    );
    await expect(
      client.lookupDerivedTranslation(identity),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "authentication_required",
      message: "The preferred translation is temporarily unavailable.",
    });
  });
});
