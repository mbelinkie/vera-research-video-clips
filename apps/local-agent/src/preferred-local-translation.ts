import { createHash } from "node:crypto";

import {
  DerivedTranslationIdentitySchema,
  type DerivedTranslationIdentity,
  type NormalizedTranscript,
} from "@research-video/contracts";
import { LocalTranscriptIndex } from "@research-video/db-local";
import {
  translateCanonicalTranscript,
  type TranslationProvider,
} from "@research-video/providers";
import {
  SharedDerivedTranslationResolver,
  type PreferredTranscriptResolver,
  type PreferredTranscriptResolverInput,
} from "@research-video/sync";

import { CloudDerivedTranslationClient } from "./derived-translation-client.ts";

/** Immutable provenance chosen from the already verified local catalog route. */
export type LocalTranslationRouteProvenance = {
  provider: string;
  model?: string;
};

/**
 * A local default translation implementation must reveal its selected route
 * before cache lookup. This lets the cache and project-store keys include the
 * exact provider/model without running a paid or model-installing operation.
 */
export type PreferredLocalTranslationProvider = TranslationProvider & {
  getTranslationProvenance(
    sourceLanguage: string,
    targetLanguage: string,
    signal?: AbortSignal,
  ):
    | LocalTranslationRouteProvenance
    | undefined
    | Promise<LocalTranslationRouteProvenance | undefined>;
};

export type PreferredLocalTranslationResolverOptions = {
  provider: PreferredLocalTranslationProvider;
  index: LocalTranscriptIndex;
  cloudClient: CloudDerivedTranslationClient;
};

/**
 * Builds the local-agent-only preferred-language flow. Its public result is a
 * renderer-safe normalized track; authorization and all cloud publication
 * details remain inside the loopback local agent.
 */
export function createPreferredLocalTranslationResolver(
  options: PreferredLocalTranslationResolverOptions,
): Pick<
  PreferredTranscriptResolver,
  "findLocal" | "findShared" | "requestTranslation"
> {
  const identityFor = async (
    input: PreferredTranscriptResolverInput,
  ): Promise<DerivedTranslationIdentity> => {
    const provenance = await options.provider.getTranslationProvenance(
      input.original.track.language,
      input.preferredLanguage,
    );
    if (!provenance) {
      throw new Error(
        "No approved local translation route supports the selected language.",
      );
    }
    return derivedTranslationIdentity(input, provenance);
  };

  return {
    findLocal: async (input) =>
      options.index.findDerivedTranslation(await identityFor(input)),
    findShared: async (input) => {
      const identity = await identityFor(input);
      return (
        await new SharedDerivedTranslationResolver(
          {
            getDerivedTranslation: (candidate) =>
              options.cloudClient.lookupDerivedTranslation(candidate),
          },
          options.index,
        ).resolve(identity)
      )?.transcript;
    },
    requestTranslation: async (input) => {
      const identity = await identityFor(input);
      const transcript = await translateCanonicalTranscript(
        options.provider,
        input.original,
        input.preferredLanguage,
      );
      if (
        transcript.track.provider !== identity.provider ||
        (transcript.track.model ?? undefined) !== (identity.model ?? undefined)
      ) {
        throw new Error(
          "The selected local translation route changed before it completed.",
        );
      }
      const published = await options.cloudClient.publishDerivedTranslation({
        identity,
        idempotencyKey: idempotencyKey(identity, transcript),
        transcript,
      });
      return (
        await new SharedDerivedTranslationResolver(
          { getDerivedTranslation: async () => published },
          options.index,
        ).resolve(identity)
      )?.transcript;
    },
  };
}

function derivedTranslationIdentity(
  input: PreferredTranscriptResolverInput,
  provenance: LocalTranslationRouteProvenance,
): DerivedTranslationIdentity {
  return DerivedTranslationIdentitySchema.parse({
    projectId: input.projectId,
    catalogVideoId: input.catalogVideoId,
    baseTranscriptVersionId: input.transcriptVersionId,
    originalTrackId: input.original.track.id,
    originalContentSha256: input.original.track.contentSha256,
    targetLanguage: input.preferredLanguage,
    provider: provenance.provider,
    ...(provenance.model ? { model: provenance.model } : {}),
    normalizationSchemaVersion: input.original.track.schemaVersion,
  });
}

function idempotencyKey(
  identity: DerivedTranslationIdentity,
  transcript: NormalizedTranscript,
): string {
  return `local-translation:${createHash("sha256")
    .update(
      JSON.stringify({
        identity,
        contentSha256: transcript.track.contentSha256,
      }),
    )
    .digest("hex")}`;
}
