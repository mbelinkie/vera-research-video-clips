import {
  TranslateClient,
  TranslateTextCommand,
  type TranslateTextCommandInput,
  type TranslateTextCommandOutput,
} from "@aws-sdk/client-translate";

import {
  ProviderExecutionError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./index.ts";

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

  async translate(input: TranslationRequest): Promise<TranslationResult> {
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

export function createTranslationProvider(options: {
  mode: "disabled" | "aws-translate";
  region: string;
  terminologyName?: string;
  sender?: AwsTranslateSender;
}): TranslationProvider | undefined {
  if (options.mode === "disabled") return undefined;
  return new AwsTranslationProvider({
    region: options.region,
    ...(options.terminologyName
      ? { terminologyName: options.terminologyName }
      : {}),
    ...(options.sender ? { sender: options.sender } : {}),
  });
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

export const amazonTranslateMaximumRequestBytes = maximumRequestBytes;
