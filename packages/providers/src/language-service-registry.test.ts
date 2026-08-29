import { describe, expect, it } from "vitest";

import type { SpeechToTextProvider } from "./index.ts";
import {
  LanguageServiceRegistry,
  LanguageServiceRegistryError,
  cloudTranscriptionExecutionPolicy,
  cloudTranslationExecutionPolicy,
  type CloudProviderDescriptor,
  type TranscriptionProviderAdapterFactory,
  type TranslationProviderAdapterFactory,
} from "./language-service-registry.ts";

const thirdTranslationFactory: TranslationProviderAdapterFactory = {
  descriptor: descriptor("fixture-third-translate", "translation", "enabled"),
  create: () => ({
    translate: async (input) => ({
      provider: "fixture-third-translate",
      model: "fixture-v3",
      segments: input.segments.map((segment) => ({
        sourceSegmentId: segment.id,
        text: `[fixture] ${segment.text}`,
      })),
    }),
  }),
};

const thirdTranscriptionFactory: TranscriptionProviderAdapterFactory = {
  descriptor: descriptor("fixture-third-transcribe", "transcription", "draft"),
  create: () => fakeSpeechToTextProvider,
};

const fakeSpeechToTextProvider: SpeechToTextProvider = {
  transcribe: async () => {
    throw new Error(
      "The deterministic fixture transcription adapter was not invoked.",
    );
  },
};

describe("LanguageServiceRegistry", () => {
  it("registers arbitrary translation and transcription factories with safe capability descriptors", async () => {
    const registry = new LanguageServiceRegistry([
      thirdTranslationFactory,
      thirdTranscriptionFactory,
    ]);

    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: "fixture-third-transcribe",
        service: "transcription",
        state: "draft",
        inputModes: ["object_uri", "direct_upload"],
      }),
      expect.objectContaining({
        id: "fixture-third-translate",
        service: "translation",
        state: "enabled",
        supportedLanguages: [
          {
            language: "en",
            roles: ["source", "target"],
            supportsAutoDetection: false,
          },
          {
            language: "fr",
            roles: ["source", "target"],
            supportsAutoDetection: false,
          },
        ],
      }),
    ]);
    expect(Object.isFrozen(registry.describe("fixture-third-translate"))).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        registry.describe("fixture-third-translate").supportedLanguages,
      ),
    ).toBe(true);
    expect(registry.describe("fixture-third-translate")).not.toHaveProperty(
      "region",
    );

    const translation = registry.resolveTranslation("fixture-third-translate");
    await expect(
      translation.translate({
        sourceLanguage: "fr",
        targetLanguage: "en",
        segments: [{ id: "segment-1", text: "Bonjour" }],
      }),
    ).resolves.toEqual({
      provider: "fixture-third-translate",
      model: "fixture-v3",
      segments: [{ sourceSegmentId: "segment-1", text: "[fixture] Bonjour" }],
    });
  });

  it("allows only enabled providers to start new work while existing adapters drain", async () => {
    const registry = new LanguageServiceRegistry([
      thirdTranslationFactory,
      thirdTranscriptionFactory,
    ]);
    const activeTranslation = registry.resolveTranslation(
      "fixture-third-translate",
    );

    expect(
      registry.setState("fixture-third-translate", "draining"),
    ).toMatchObject({
      state: "draining",
    });
    expectUnavailable(() =>
      registry.resolveTranslation("fixture-third-translate"),
    );
    await expect(
      activeTranslation.translate({
        sourceLanguage: "fr",
        targetLanguage: "en",
        segments: [{ id: "segment-1", text: "Bonjour" }],
      }),
    ).resolves.toMatchObject({ provider: "fixture-third-translate" });

    for (const state of ["disabled", "suspended"] as const) {
      registry.setState("fixture-third-transcribe", "enabled");
      expect(registry.resolveTranscription("fixture-third-transcribe")).toBe(
        fakeSpeechToTextProvider,
      );
      registry.setState("fixture-third-transcribe", state);
      expectUnavailable(() =>
        registry.resolveTranscription("fixture-third-transcribe"),
      );
    }
  });

  it("rejects duplicate IDs, wrong service kinds, and unsafe provider IDs", () => {
    const registry = new LanguageServiceRegistry([thirdTranslationFactory]);

    expect(() => registry.register(thirdTranslationFactory)).toThrow(
      LanguageServiceRegistryError,
    );
    expectRegistryError("provider_service_mismatch", () =>
      registry.resolveTranscription("fixture-third-translate"),
    );
    expectRegistryError(
      "invalid_provider_descriptor",
      () =>
        new LanguageServiceRegistry([
          {
            descriptor: descriptor(
              "Fixture Translate",
              "translation",
              "enabled",
            ),
            create: () => thirdTranslationFactory.create(),
          },
        ]),
    );
  });

  it("encodes shared local-only fallback for translation and transcription without another cloud provider", () => {
    const translation = cloudTranslationExecutionPolicy(
      "fixture-third-translate",
    );
    const transcription = cloudTranscriptionExecutionPolicy(
      "fixture-third-transcribe",
    );

    expect(translation).toEqual({
      schemaVersion: 1,
      execution: "cloud",
      providerId: "fixture-third-translate",
      fallback: "local",
    });
    expect(transcription).toEqual({
      schemaVersion: 1,
      execution: "cloud",
      providerId: "fixture-third-transcribe",
      fallback: "local",
    });
    expect("fallbackProviderId" in translation).toBe(false);
  });
});

function descriptor<Service extends "translation" | "transcription">(
  id: string,
  service: Service,
  state: CloudProviderDescriptor["state"],
): CloudProviderDescriptor & Readonly<{ service: Service }> {
  return {
    id,
    service,
    displayName: `Fixture ${service}`,
    adapterContractVersion: 1,
    configurationRevision: "fixture-config-v1",
    capabilityRevision: "fixture-capabilities-v1",
    supportedLanguages: [
      {
        language: "en",
        roles: ["source", "target"],
        supportsAutoDetection: false,
      },
      {
        language: "fr",
        roles: ["source", "target"],
        supportsAutoDetection: false,
      },
    ],
    inputModes:
      service === "translation"
        ? ["text_segments"]
        : ["object_uri", "direct_upload"],
    disclosure: {
      version: 1,
      title: "Fixture disclosure",
      summary: "Fixture disclosure.",
      dataCategories: ["transcript_text"],
      publishedAt: "2026-08-26T00:00:00.000Z",
    },
    pricing: {
      currency: "USD",
      unit: "requests",
      amountMicros: 0,
      quantity: 1,
      effectiveAt: "2026-08-26T00:00:00.000Z",
    },
    state,
  } as CloudProviderDescriptor & Readonly<{ service: Service }>;
}

function expectUnavailable(operation: () => unknown) {
  expectRegistryError("provider_not_available", operation);
}

function expectRegistryError(
  code: LanguageServiceRegistryError["code"],
  operation: () => unknown,
) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(LanguageServiceRegistryError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected registry operation to throw ${code}.`);
}
