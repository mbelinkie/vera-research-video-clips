import { describe, expect, it, vi } from "vitest";
import type { TranslateTextCommandInput } from "@aws-sdk/client-translate";

import { normalizeTranscriptFixture } from "@research-video/transcript";
import fixture from "../../../tests/fixtures/transcripts/spanish-bilingual.json" with { type: "json" };

import { translateCanonicalTranscript } from "./index.ts";
import {
  AwsTranslationProvider,
  createAwsTranslationProviderAdapterFactory,
  createTranslationProvider,
  splitForAmazonTranslate,
} from "./translation-aws.ts";

describe("AwsTranslationProvider", () => {
  it("preflights its pinned language table without sending transcript text", async () => {
    const sender = vi.fn();
    const provider = new AwsTranslationProvider({
      region: "us-east-1",
      sender,
    });

    expect(provider.checkLanguagePair("ko-KR", "en-US")).toMatchObject({
      state: "supported",
      provider: "amazon-translate",
      operation: "translation",
      sourceLanguage: "ko-KR",
      targetLanguage: "en-US",
      version: expect.any(String),
    });
    expect(provider.checkLanguagePair("dz", "en")).toMatchObject({
      state: "unsupported",
      sourceLanguage: "dz",
      targetLanguage: "en",
      reason: "language_not_supported",
    });
    await expect(
      provider.translate({
        sourceLanguage: "dz",
        targetLanguage: "en",
        segments: [{ id: "segment-1", text: "fixture text" }],
      }),
    ).rejects.toMatchObject({ code: "provider_execution_failed" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("is opt-in and sends only segment text through the AWS adapter", async () => {
    const sender = vi.fn(async () => ({
      TranslatedText: "This is a short example.",
      SourceLanguageCode: "es",
      TargetLanguageCode: "en",
    }));
    const provider = createTranslationProvider({
      mode: "aws-translate",
      region: "us-east-1",
      terminologyName: "essay-terms",
      sender,
    });
    const original = normalizeTranscriptFixture(fixture.original);

    expect(
      createTranslationProvider({ mode: "disabled", region: "us-east-1" }),
    ).toBeUndefined();
    await expect(
      translateCanonicalTranscript(provider!, original, "en"),
    ).resolves.toMatchObject({
      track: {
        sourceTrackId: original.track.id,
        provider: "amazon-translate",
        language: "en",
      },
      segments: [
        { startMs: 500, endMs: 2_500, text: "This is a short example." },
      ],
    });
    expect(sender).toHaveBeenCalledWith(
      {
        Text: "Este es un ejemplo breve.",
        SourceLanguageCode: "es",
        TargetLanguageCode: "en",
        TerminologyNames: ["essay-terms"],
      },
      undefined,
    );
  });

  it("keeps the Amazon registry factory descriptor safe while retaining historical provenance", async () => {
    const sender = vi.fn(async () => ({ TranslatedText: "Hello" }));
    const factory = createAwsTranslationProviderAdapterFactory({
      region: "us-east-1",
      terminologyName: "essay-terms",
      sender,
    });

    expect(factory.descriptor).toMatchObject({
      id: "amazon-translate",
      service: "translation",
      state: "enabled",
    });
    expect(factory.descriptor).not.toHaveProperty("region");
    expect(factory.descriptor).not.toHaveProperty("terminologyName");
    expect(factory.descriptor).not.toHaveProperty("sender");
    await expect(
      factory.create().translate({
        sourceLanguage: "es",
        targetLanguage: "en",
        segments: [{ id: "segment-1", text: "Hola" }],
      }),
    ).resolves.toMatchObject({ provider: "amazon-translate" });
  });

  it("keeps every request below the service byte limit", async () => {
    const sender = vi.fn(async (input: TranslateTextCommandInput) => ({
      TranslatedText: input.Text,
    }));
    const provider = new AwsTranslationProvider({
      region: "us-east-1",
      concurrency: 1,
      sender,
    });
    const text = `${"palabra ".repeat(1_500)}終`;
    const pieces = splitForAmazonTranslate(text);

    expect(pieces.length).toBeGreaterThan(1);
    expect(
      pieces.every(
        (piece) => new TextEncoder().encode(piece).byteLength < 10_000,
      ),
    ).toBe(true);
    await expect(
      provider.translate({
        sourceLanguage: "es-MX",
        targetLanguage: "en-US",
        segments: [{ id: "segment-1", text }],
      }),
    ).resolves.toMatchObject({
      provider: "amazon-translate",
      segments: [{ sourceSegmentId: "segment-1" }],
    });
    expect(sender).toHaveBeenCalledTimes(pieces.length);
  });

  it("supports cooperative cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("lease lost"));
    const sender = vi.fn();
    const provider = new AwsTranslationProvider({
      region: "us-east-1",
      sender,
    });

    await expect(
      provider.translate({
        sourceLanguage: "es",
        targetLanguage: "en",
        segments: [{ id: "segment-1", text: "Hola" }],
        signal: controller.signal,
      }),
    ).rejects.toThrow("lease lost");
    expect(sender).not.toHaveBeenCalled();
  });
});
