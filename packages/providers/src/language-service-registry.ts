import {
  CloudProviderDescriptorSchema,
  TranscriptionExecutionPolicySchema,
  TranslationExecutionPolicySchema,
  type CloudProviderDescriptor,
  type CloudProviderState,
  type LanguageServiceKind,
  type ProviderId,
  type TranscriptionExecutionPolicy,
  type TranslationExecutionPolicy,
} from "@research-video/contracts";

import type { SpeechToTextProvider, TranslationProvider } from "./index.ts";

export type {
  CloudProviderDescriptor,
  CloudProviderState,
  LanguageServiceKind,
  ProviderId,
  TranscriptionExecutionPolicy,
  TranslationExecutionPolicy,
} from "@research-video/contracts";

type TranslationProviderDescriptor = CloudProviderDescriptor & {
  readonly service: "translation";
};
type TranscriptionProviderDescriptor = CloudProviderDescriptor & {
  readonly service: "transcription";
};

export type ProviderRuntimeConfiguration = Readonly<{
  region?: string;
  protectedCredentialReference?: string;
  configurationRevision?: string;
}>;

export type TranslationProviderAdapterFactory = Readonly<{
  descriptor: TranslationProviderDescriptor;
  create: (configuration?: ProviderRuntimeConfiguration) => TranslationProvider;
}>;

export type TranscriptionProviderAdapterFactory = Readonly<{
  descriptor: TranscriptionProviderDescriptor;
  create: (
    configuration?: ProviderRuntimeConfiguration,
  ) => SpeechToTextProvider;
}>;

export type LanguageServiceAdapterFactory =
  TranslationProviderAdapterFactory | TranscriptionProviderAdapterFactory;

export class LanguageServiceRegistryError extends Error {
  constructor(
    readonly code:
      | "invalid_provider_descriptor"
      | "duplicate_provider"
      | "unknown_provider"
      | "provider_service_mismatch"
      | "provider_not_available",
    message: string,
  ) {
    super(message);
  }
}

type RegistryEntry = {
  factory: LanguageServiceAdapterFactory;
  descriptor: CloudProviderDescriptor;
};

/**
 * Backend-only registry for adapters deployed with this service. It is
 * deliberately in-memory: durable provider state/configuration is owned by
 * the control-plane persistence slice, while this boundary gives it a
 * vendor-neutral factory target.
 */
export class LanguageServiceRegistry {
  readonly #entries = new Map<ProviderId, RegistryEntry>();

  constructor(factories: readonly LanguageServiceAdapterFactory[] = []) {
    for (const factory of factories) this.register(factory);
  }

  register(factory: LanguageServiceAdapterFactory): CloudProviderDescriptor {
    const descriptor = freezeDescriptor(validateDescriptor(factory.descriptor));
    if (this.#entries.has(descriptor.id)) {
      throw new LanguageServiceRegistryError(
        "duplicate_provider",
        `A language-service provider named ${descriptor.id} is already registered.`,
      );
    }
    this.#entries.set(descriptor.id, { factory, descriptor });
    return descriptor;
  }

  list(service?: LanguageServiceKind): readonly CloudProviderDescriptor[] {
    return Object.freeze(
      [...this.#entries.values()]
        .map(({ descriptor }) => descriptor)
        .filter((descriptor) => !service || descriptor.service === service)
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  describe(providerId: ProviderId): CloudProviderDescriptor {
    return this.#entry(providerId).descriptor;
  }

  setState(
    providerId: ProviderId,
    state: CloudProviderState,
  ): CloudProviderDescriptor {
    const entry = this.#entry(providerId);
    const descriptor = freezeDescriptor(
      validateDescriptor({ ...entry.descriptor, state }),
    );
    this.#entries.set(providerId, { ...entry, descriptor });
    return descriptor;
  }

  resolveTranslation(
    providerId: ProviderId,
    configuration?: ProviderRuntimeConfiguration,
  ): TranslationProvider {
    const entry = this.#availableEntry(providerId, "translation");
    return (entry.factory as TranslationProviderAdapterFactory).create(
      configuration,
    );
  }

  resolveTranscription(
    providerId: ProviderId,
    configuration?: ProviderRuntimeConfiguration,
  ): SpeechToTextProvider {
    const entry = this.#availableEntry(providerId, "transcription");
    return (entry.factory as TranscriptionProviderAdapterFactory).create(
      configuration,
    );
  }

  #entry(providerId: ProviderId): RegistryEntry {
    const entry = this.#entries.get(providerId);
    if (!entry) {
      throw new LanguageServiceRegistryError(
        "unknown_provider",
        `No language-service provider named ${providerId} is registered.`,
      );
    }
    return entry;
  }

  #availableEntry(
    providerId: ProviderId,
    service: LanguageServiceKind,
  ): RegistryEntry {
    const entry = this.#entry(providerId);
    if (entry.descriptor.service !== service) {
      throw new LanguageServiceRegistryError(
        "provider_service_mismatch",
        `Provider ${providerId} does not provide ${service}.`,
      );
    }
    if (entry.descriptor.state !== "enabled") {
      throw new LanguageServiceRegistryError(
        "provider_not_available",
        `Provider ${providerId} is ${entry.descriptor.state} and cannot start new work.`,
      );
    }
    return entry;
  }
}

export function cloudTranslationExecutionPolicy(
  providerId: ProviderId,
): TranslationExecutionPolicy {
  return TranslationExecutionPolicySchema.parse({
    schemaVersion: 1,
    execution: "cloud",
    providerId,
    // The shared schema permits one exact cloud provider and only local
    // fallback; it intentionally has no alternate-cloud-provider field.
    fallback: "local",
  });
}

export function cloudTranscriptionExecutionPolicy(
  providerId: ProviderId,
): TranscriptionExecutionPolicy {
  return TranscriptionExecutionPolicySchema.parse({
    schemaVersion: 1,
    execution: "cloud",
    providerId,
    fallback: "local",
  });
}

function validateDescriptor(
  descriptor: CloudProviderDescriptor,
): CloudProviderDescriptor {
  const parsed = CloudProviderDescriptorSchema.safeParse(descriptor);
  if (!parsed.success) {
    throw new LanguageServiceRegistryError(
      "invalid_provider_descriptor",
      "The language-service provider descriptor is invalid.",
    );
  }
  return parsed.data;
}

function freezeDescriptor(
  descriptor: CloudProviderDescriptor,
): CloudProviderDescriptor {
  return Object.freeze({
    ...descriptor,
    supportedLanguages: Object.freeze(
      descriptor.supportedLanguages.map((language) =>
        Object.freeze({
          ...language,
          roles: Object.freeze([...language.roles]),
        }),
      ),
    ),
    inputModes: Object.freeze([...descriptor.inputModes]),
    disclosure: Object.freeze({
      ...descriptor.disclosure,
      dataCategories: Object.freeze([...descriptor.disclosure.dataCategories]),
    }),
    pricing: Object.freeze({ ...descriptor.pricing }),
  }) as CloudProviderDescriptor;
}
