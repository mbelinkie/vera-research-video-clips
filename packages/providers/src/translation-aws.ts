import {
  TranslateClient,
  TranslateTextCommand,
  type TranslateTextCommandInput,
  type TranslateTextCommandOutput,
} from "@aws-sdk/client-translate";

import {
  LanguageCapabilityResultSchema,
  normalizeLanguageTag,
  primaryLanguage,
  type LanguageCapabilityResult,
} from "@research-video/contracts";

import {
  ProviderExecutionError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./index.ts";
import {
  LanguageServiceRegistry,
  type TranslationProviderAdapterFactory,
} from "./language-service-registry.ts";

export type AwsTranslateSender = (
  input: TranslateTextCommandInput,
  signal?: AbortSignal,
) => Promise<Pick<TranslateTextCommandOutput, "TranslatedText">>;

export type AwsTranslationProviderOptions = {
  region: string;
  terminologyName?: string;
  concurrency?: number;
  sender?: AwsTranslateSender;
};

const maximumRequestBytes = 10_000;
const safeRequestBytes = 9_500;

/**
 * Pinned to Amazon Translate's supported-language table recorded in
 * docs/research/PUNCH-001-provider-language-capabilities-2026-08-23.md.
 * Keep it isolated here so an AWS capability-table change is deliberate.
 */
export const awsTranslateLanguageCapabilityVersion =
  "amazon-translate-supported-languages-2026-08-23";

const awsTranslateLanguageCodes = new Set([
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fa",
  "fi",
  "fr",
  "ga",
  "gu",
  "ha",
  "he",
  "hi",
  "hr",
  "ht",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "ne",
  "nl",
  "no",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "so",
  "sq",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "zh",
]);

export class AwsTranslationProvider implements TranslationProvider {
  readonly #send: AwsTranslateSender;
  readonly #terminologyName: string | undefined;
  readonly #concurrency: number;

  constructor(options: AwsTranslationProviderOptions) {
    this.#terminologyName = options.terminologyName;
    this.#concurrency = Math.max(1, Math.min(10, options.concurrency ?? 3));
    if (options.sender) {
      this.#send = options.sender;
    } else {
      const client = new TranslateClient({ region: options.region });
      this.#send = (input, signal) =>
        client.send(new TranslateTextCommand(input), {
          ...(signal ? { abortSignal: signal } : {}),
        });
    }
  }

  checkLanguagePair(
    sourceLanguage: string,
    targetLanguage: string,
  ): LanguageCapabilityResult {
    const source = normalizeLanguageTag(sourceLanguage);
    const target = normalizeLanguageTag(targetLanguage);
    const supported =
      awsTranslateLanguageCodes.has(primaryLanguage(source)) &&
      awsTranslateLanguageCodes.has(primaryLanguage(target));
    return LanguageCapabilityResultSchema.parse({
      state: supported ? "supported" : "unsupported",
      provider: "amazon-translate",
      operation: "translation",
      sourceLanguage: source,
      targetLanguage: target,
      version: awsTranslateLanguageCapabilityVersion,
      ...(supported ? {} : { reason: "language_not_supported" }),
    });
  }

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    if (
      this.checkLanguagePair(input.sourceLanguage, input.targetLanguage)
        .state !== "supported"
    ) {
      throw new ProviderExecutionError(
        "Amazon Translate does not support the requested source and target language pair.",
      );
    }
    const results = new Array<{ sourceSegmentId: string; text: string }>(
      input.segments.length,
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < input.segments.length) {
        const index = cursor++;
        const segment = input.segments[index]!;
        if (input.signal?.aborted) throw input.signal.reason;
        results[index] = {
          sourceSegmentId: segment.id,
          text: await this.translateSegment(segment.text, input),
        };
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(this.#concurrency, input.segments.length) },
        worker,
      ),
    );
    return { provider: "amazon-translate", segments: results };
  }

  private async translateSegment(
    text: string,
    request: TranslationRequest,
  ): Promise<string> {
    const pieces = splitForAmazonTranslate(text);
    const translated: string[] = [];
    for (const piece of pieces) {
      let output: Pick<TranslateTextCommandOutput, "TranslatedText">;
      try {
        output = await this.#send(
          {
            Text: piece,
            SourceLanguageCode: amazonLanguageCode(request.sourceLanguage),
            TargetLanguageCode: amazonLanguageCode(request.targetLanguage),
            ...(this.#terminologyName
              ? { TerminologyNames: [this.#terminologyName] }
              : {}),
          },
          request.signal,
        );
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason;
        throw new ProviderExecutionError(
          `Amazon Translate request failed: ${safeErrorMessage(error)}`,
        );
      }
      const value = output.TranslatedText?.trim();
      if (!value) {
        throw new ProviderExecutionError(
          "Amazon Translate returned an empty translation.",
        );
      }
      translated.push(value);
    }
    return translated.join(" ");
  }
}

/**
 * Registers Amazon Translate as one deployed translation adapter. The registry
 * only receives this safe descriptor and a factory closure; AWS SDK values and
 * credential resolution remain private to this module.
 */
export function createAwsTranslationProviderAdapterFactory(
  options: AwsTranslationProviderOptions,
): TranslationProviderAdapterFactory {
  return {
    descriptor: {
      id: "amazon-translate",
      service: "translation",
      displayName: "Amazon Translate",
      adapterContractVersion: 1,
      configurationRevision: awsTranslationConfigurationRevision(options),
      capabilityRevision: awsTranslateLanguageCapabilityVersion,
      supportedLanguages: [...awsTranslateLanguageCodes]
        .sort((left, right) => left.localeCompare(right))
        .map((language) => ({
          language,
          roles: ["source", "target"] as const,
          supportsAutoDetection: false,
        })),
      inputModes: ["text_segments"],
      disclosure: {
        version: 1,
        title: "Amazon Translate disclosure",
        summary:
          "Selected transcript segment text is sent to Amazon Translate.",
        dataCategories: ["transcript_text"],
        publishedAt: "2026-08-26T00:00:00.000Z",
      },
      pricing: {
        currency: "USD",
        unit: "characters",
        amountMicros: 0,
        quantity: 1,
        effectiveAt: "2026-08-26T00:00:00.000Z",
      },
      state: "enabled",
    },
    create: (configuration) => {
      assertAwsCredentialReference(configuration?.protectedCredentialReference);
      return new AwsTranslationProvider({
        ...options,
        region: configuration?.region ?? options.region,
      });
    },
  };
}

function assertAwsCredentialReference(reference?: string) {
  if (reference && reference !== "credential:aws-default") {
    throw new ProviderExecutionError(
      "The configured protected AWS credential reference is unavailable to this adapter.",
    );
  }
}

/**
 * Compatibility entry point retained for the current configuration surface.
 * New composition should register `createAwsTranslationProviderAdapterFactory`
 * alongside other provider factories and resolve by opaque provider ID.
 */
export function createTranslationProvider(options: {
  mode: "disabled" | "aws-translate";
  region: string;
  terminologyName?: string;
  sender?: AwsTranslateSender;
}): TranslationProvider | undefined {
  if (options.mode === "disabled") return undefined;
  const factory = createAwsTranslationProviderAdapterFactory({
    region: options.region,
    ...(options.terminologyName
      ? { terminologyName: options.terminologyName }
      : {}),
    ...(options.sender ? { sender: options.sender } : {}),
  });
  return new LanguageServiceRegistry([factory]).resolveTranslation(
    "amazon-translate",
  );
}

export function splitForAmazonTranslate(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Translation text cannot be empty.");
  if (utf8Bytes(trimmed) <= safeRequestBytes) return [trimmed];

  const pieces: string[] = [];
  let current = "";
  for (const token of trimmed.match(/\S+\s*/gu) ?? []) {
    if (utf8Bytes(token.trimEnd()) > safeRequestBytes) {
      if (current.trim()) pieces.push(current.trim());
      current = "";
      pieces.push(...splitOversizedToken(token.trim()));
      continue;
    }
    if (current && utf8Bytes(current + token) > safeRequestBytes) {
      pieces.push(current.trim());
      current = token;
    } else {
      current += token;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

function splitOversizedToken(token: string) {
  const pieces: string[] = [];
  let current = "";
  for (const character of token) {
    if (utf8Bytes(current + character) > safeRequestBytes) {
      pieces.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function amazonLanguageCode(language: string) {
  const normalized = language.trim().replaceAll("_", "-");
  const lower = normalized.toLowerCase();
  if (lower === "zh-tw" || lower === "zh-hant") return "zh-TW";
  if (lower === "pt-pt") return "pt-PT";
  return lower.split("-")[0]!;
}

function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

function safeErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "unknown provider error";
  return message.replaceAll(/[\r\n\t]+/gu, " ").slice(0, 300);
}

function awsTranslationConfigurationRevision(
  options: AwsTranslationProviderOptions,
) {
  const terminology = options.terminologyName?.trim() || "none";
  // This is a safe revision label, not a credential or an SDK configuration dump.
  return `amazon-translate-v1-${shortStableHash(`${options.region}\u0000${terminology}`)}`;
}

function shortStableHash(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const amazonTranslateMaximumRequestBytes = maximumRequestBytes;
