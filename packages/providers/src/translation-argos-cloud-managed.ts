import {
  LanguageCapabilityResultSchema,
  LocalModelArtifactDownloadSchema,
  SignedLocalModelCatalogReleaseSchema,
  languagesEquivalent,
  normalizeLanguageTag,
  type LanguageCapabilityResult,
  type SignedLocalModelCatalogRelease,
} from "@research-video/contracts";

import { cacheableArgosCatalogFromCloud } from "./cloud-local-model-catalog.ts";
import {
  LocalArgosModelError,
  type ArgosModelDescriptor,
  type LocalArgosModelManager,
} from "./local-argos-model-manager.ts";
import {
  ArgosLocalTranslationProvider,
  type ArgosLocalTranslationProviderOptions,
} from "./translation-argos-local.ts";
import {
  ProviderExecutionError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./index.ts";

/** Supplies a complete Authorization header (for example, `Bearer <token>`). */
export type CloudManagedArgosAuthorizationProvider = {
  authorizationHeader(signal?: AbortSignal): Promise<string>;
};

export type CloudManagedArgosTranslationProviderOptions = {
  /** The authenticated control-plane API, never an upstream Argos feed. */
  baseUrl: string;
  authorizationProvider: CloudManagedArgosAuthorizationProvider;
  manager: LocalArgosModelManager;
  executable: string;
  runner?: ArgosLocalTranslationProviderOptions["runner"];
  timeoutMs?: number;
  leaseTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  /** Limits catalog JSON and any issued artifact target before allocation. */
  maxCatalogBytes?: number;
  /** A second client-side ceiling in addition to the signed model byte size. */
  maxArtifactBytes?: number;
};

type Route =
  | readonly [ArgosModelDescriptor]
  | readonly [ArgosModelDescriptor, ArgosModelDescriptor];

const defaultMaxCatalogBytes = 20 * 1024 * 1024;
const defaultMaxArtifactBytes = 1_000_000_000;
const providerId = "cloud-managed-argos-local";

/** The immutable local execution identity selected from the signed snapshot. */
export type CloudManagedArgosTranslationProvenance = {
  provider: typeof providerId;
  model: string;
};

/**
 * Desktop-only adapter for the platform-managed local Argos catalogue.
 * It talks exclusively to the authenticated control-plane release and download
 * endpoints; it never receives or follows mutable Argos upstream package URLs.
 */
export class CloudManagedArgosTranslationProvider implements TranslationProvider {
  readonly #baseUrl: URL;
  readonly #authorizationProvider: CloudManagedArgosAuthorizationProvider;
  readonly #manager: LocalArgosModelManager;
  readonly #executable: string;
  readonly #runner: ArgosLocalTranslationProviderOptions["runner"];
  readonly #timeoutMs: number | undefined;
  readonly #leaseTtlMs: number | undefined;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => string;
  readonly #maxCatalogBytes: number;
  readonly #maxArtifactBytes: number;
  #routes = new Map<string, Route>();
  #hasRouteSnapshot = false;
  #initializing: Promise<void> | undefined;

  constructor(options: CloudManagedArgosTranslationProviderOptions) {
    this.#baseUrl = controlPlaneUrl(options.baseUrl);
    this.#authorizationProvider = options.authorizationProvider;
    this.#manager = options.manager;
    this.#executable = options.executable;
    this.#runner = options.runner;
    this.#timeoutMs = options.timeoutMs;
    this.#leaseTtlMs = options.leaseTtlMs;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#maxCatalogBytes = boundedBytes(
      options.maxCatalogBytes ?? defaultMaxCatalogBytes,
      "catalog",
    );
    this.#maxArtifactBytes = boundedBytes(
      options.maxArtifactBytes ?? defaultMaxArtifactBytes,
      "artifact",
    );
  }

  checkLanguagePair(
    sourceLanguage: string,
    targetLanguage: string,
  ): LanguageCapabilityResult {
    const source = normalizeLanguageTag(sourceLanguage);
    const target = normalizeLanguageTag(targetLanguage);
    // This preflight must not acquire a token, contact the cloud, or send text.
    // initialize() (called at desktop startup and before execution) publishes an
    // immutable, in-memory view of the last verified catalog for this method.
    const route = this.#findRoute(source, target);
    return LanguageCapabilityResultSchema.parse({
      state: route
        ? "supported"
        : this.#hasRouteSnapshot
          ? "unsupported"
          : "unknown",
      provider: providerId,
      operation: "translation",
      sourceLanguage: source,
      targetLanguage: target,
      version: "signed-local-argos-catalog-v1",
      ...(route
        ? {}
        : {
            reason: this.#hasRouteSnapshot
              ? "language_not_supported"
              : "configuration_unknown",
          }),
    });
  }

  /**
   * Loads the latest signed catalog when available, otherwise a verified local
   * cache. This deliberately never reads the mutable upstream Argos feed.
   */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (!this.#initializing) {
      this.#initializing = this.#initialize(signal).finally(() => {
        this.#initializing = undefined;
      });
    }
    await this.#initializing;
  }

  /** Refreshes the route snapshot; retained as an explicit admin/sync hook. */
  async refresh(signal?: AbortSignal): Promise<void> {
    await this.initialize(signal);
  }

  /**
   * Returns the exact route identity selected by the current verified snapshot.
   * It is intentionally synchronous and never refreshes, downloads, or leases.
   */
  getTranslationProvenance(
    sourceLanguage: string,
    targetLanguage: string,
  ): CloudManagedArgosTranslationProvenance | undefined {
    const route = this.#findRoute(
      normalizeLanguageTag(sourceLanguage),
      normalizeLanguageTag(targetLanguage),
    );
    return route
      ? {
          provider: providerId,
          model: route.map((model) => model.id).join("+"),
        }
      : undefined;
  }

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    await this.refresh(input.signal);
    const now = this.#now();
    const source = normalizeLanguageTag(input.sourceLanguage);
    const target = normalizeLanguageTag(input.targetLanguage);
    const route = this.#route(source, target);

    let segments = input.segments;
    for (const model of route) {
      await this.#ensureInstalled(model, input.signal, now);
      const local = new ArgosLocalTranslationProvider({
        executable: this.#executable,
        manager: this.#manager,
        resolveModel: (candidateSource, candidateTarget) =>
          candidateSource === model.sourceLanguage &&
          candidateTarget === model.targetLanguage
            ? model
            : undefined,
        ...(this.#runner ? { runner: this.#runner } : {}),
        ...(this.#timeoutMs === undefined
          ? {}
          : { timeoutMs: this.#timeoutMs }),
        ...(this.#leaseTtlMs === undefined
          ? {}
          : { leaseTtlMs: this.#leaseTtlMs }),
        now: this.#now,
      });
      const output = await local.translate({
        sourceLanguage: model.sourceLanguage,
        targetLanguage: model.targetLanguage,
        segments,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      segments = output.segments.map(({ sourceSegmentId: id, text }) => ({
        id,
        text,
      }));
    }
    return {
      provider: providerId,
      model: route.map((model) => model.id).join("+"),
      segments: segments.map(({ id: sourceSegmentId, text }) => ({
        sourceSegmentId,
        text,
      })),
    };
  }

  async #refreshOrUseVerifiedCache(
    signal: AbortSignal | undefined,
    now: string,
  ): Promise<void> {
    try {
      const release = await this.#fetchRelease(signal);
      await this.#manager.cacheCatalog(
        cacheableArgosCatalogFromCloud(release, now),
      );
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const state = await this.#manager.catalogState(now).catch(() => ({
        state: "missing" as const,
      }));
      if (state.state === "current" || state.state === "stale") return;
      throw providerError(
        error,
        "The managed local-model catalog is unavailable.",
      );
    }
  }

  async #initialize(signal: AbortSignal | undefined): Promise<void> {
    const now = this.#now();
    await this.#refreshOrUseVerifiedCache(signal, now);
    const catalog = await this.#manager.catalogState(now);
    if (catalog.state !== "current" && catalog.state !== "stale") {
      throw new ProviderExecutionError(
        "No verified managed local-model catalog is available.",
      );
    }
    this.#routes = createRouteSnapshot(
      catalog.release.payload.models.map(toDescriptor),
    );
    this.#hasRouteSnapshot = true;
  }

  #route(source: string, target: string): Route {
    const route = this.#findRoute(source, target);
    if (route) return route;
    if (!this.#hasRouteSnapshot) {
      throw new ProviderExecutionError(
        "No verified managed local-model catalog is available.",
      );
    }

    // The sole fallback topology is source -> English -> target.  It is never
    // an arbitrary graph search and therefore can never silently add a third hop.
    throw new ProviderExecutionError(
      "No approved direct or English-hub local Argos route supports this language pair.",
    );
  }

  #findRoute(source: string, target: string): Route | undefined {
    const exact = this.#routes.get(routeKey(source, target));
    if (exact) return exact;
    const compatible = [...this.#routes.values()].filter(
      (route) =>
        languagesEquivalent(route[0].sourceLanguage, source) &&
        languagesEquivalent(route.at(-1)!.targetLanguage, target),
    );
    // A base-language pack can serve a regional BCP-47 preference only when
    // the signed catalog makes that mapping unambiguous. Multiple candidates
    // fail closed instead of silently selecting a regional model.
    return compatible.length === 1 ? compatible[0] : undefined;
  }

  async #ensureInstalled(
    model: ArgosModelDescriptor,
    signal: AbortSignal | undefined,
    now: string,
  ): Promise<void> {
    try {
      const acquired = await this.#manager.acquireLease({
        model,
        holderId: "cloud-managed-argos-install-check",
        now,
        ttlMs: 1_000,
      });
      await this.#manager.releaseLease(acquired.lease, now);
      return;
    } catch (error) {
      if (
        !(error instanceof LocalArgosModelError) ||
        error.code !== "model_unavailable"
      ) {
        throw providerError(
          error,
          "The approved local Argos model is unavailable.",
        );
      }
    }

    try {
      await this.#manager.install(
        model,
        async () => this.#downloadExactArtifact(model, signal),
        now,
      );
    } catch (error) {
      throw providerError(
        error,
        "The approved local Argos model could not be installed.",
      );
    }
  }

  async #fetchRelease(
    signal: AbortSignal | undefined,
  ): Promise<SignedLocalModelCatalogRelease> {
    const response = await this.#request("api/local-model-catalog", signal);
    if (response.status === 204)
      throw new ProviderExecutionError(
        "No managed local-model catalog is published.",
      );
    if (!response.ok)
      throw new ProviderExecutionError(
        "The managed local-model catalog request failed.",
      );
    return SignedLocalModelCatalogReleaseSchema.parse(
      parseJson(
        await readBounded(response, this.#maxCatalogBytes, "catalog"),
        "catalog",
      ),
    );
  }

  async #downloadExactArtifact(
    model: ArgosModelDescriptor,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const catalog = await this.#manager.catalogState(this.#now());
    if (catalog.state !== "current")
      throw new ProviderExecutionError(
        "A current verified managed catalog is required to download a model.",
      );
    const descriptorResponse = await this.#request(
      `api/local-model-catalog/${encodeURIComponent(catalog.release.id)}/versions/${encodeURIComponent(model.id)}/download`,
      signal,
    );
    if (!descriptorResponse.ok)
      throw new ProviderExecutionError(
        "The managed model download target request failed.",
      );
    const descriptor = LocalModelArtifactDownloadSchema.parse(
      parseJson(
        await readBounded(
          descriptorResponse,
          this.#maxCatalogBytes,
          "download descriptor",
        ),
        "download descriptor",
      ),
    );
    const issuedAt = Date.parse(this.#now());
    const expiresAt = Date.parse(descriptor.expiresAt);
    if (
      descriptor.catalogReleaseId !== catalog.release.id ||
      descriptor.versionId !== model.id ||
      descriptor.artifactSha256 !== model.artifactSha256 ||
      descriptor.artifactByteSize !== model.byteSize ||
      descriptor.artifactByteSize > this.#maxArtifactBytes ||
      expiresAt <= issuedAt ||
      expiresAt > issuedAt + 15 * 60 * 1_000
    ) {
      throw new ProviderExecutionError(
        "The managed model download target does not match the approved release descriptor.",
      );
    }
    const target = safeDownloadTarget(descriptor.downloadUrl);
    const artifactResponse = await this.#fetch(target, {
      method: "GET",
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
    if (!artifactResponse.ok)
      throw new ProviderExecutionError(
        "The managed model artifact download failed.",
      );
    return readBounded(
      artifactResponse,
      descriptor.artifactByteSize,
      "model artifact",
    );
  }

  async #request(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const authorization =
      await this.#authorizationProvider.authorizationHeader(signal);
    if (!authorization.trim() || /[\r\n]/u.test(authorization))
      throw new ProviderExecutionError(
        "Managed catalog authorization is unavailable.",
      );
    return this.#fetch(new URL(path, this.#baseUrl), {
      method: "GET",
      redirect: "error",
      headers: { authorization },
      ...(signal ? { signal } : {}),
    });
  }
}

function toDescriptor(model: {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  runtimeFamily: string;
  runtimeVersion?: string;
  artifactSha256: string;
  byteSize: number;
  availability: "enabled" | "enabled_by_override";
}): ArgosModelDescriptor {
  return { ...model };
}

function createRouteSnapshot(
  models: readonly ArgosModelDescriptor[],
): Map<string, Route> {
  const routes = new Map<string, Route>();
  const active = models.filter(
    (model) =>
      model.availability === "enabled" ||
      model.availability === "enabled_by_override",
  );
  for (const model of active) {
    const key = routeKey(model.sourceLanguage, model.targetLanguage);
    if (!routes.has(key)) routes.set(key, [model]);
  }
  const intoEnglish = new Map<string, ArgosModelDescriptor>();
  const outOfEnglish = new Map<string, ArgosModelDescriptor>();
  for (const model of active) {
    if (model.sourceLanguage !== "en" && model.targetLanguage === "en") {
      if (!intoEnglish.has(model.sourceLanguage))
        intoEnglish.set(model.sourceLanguage, model);
    }
    if (model.sourceLanguage === "en" && model.targetLanguage !== "en") {
      if (!outOfEnglish.has(model.targetLanguage))
        outOfEnglish.set(model.targetLanguage, model);
    }
  }
  for (const [sourceLanguage, first] of intoEnglish) {
    for (const [targetLanguage, second] of outOfEnglish) {
      const key = routeKey(sourceLanguage, targetLanguage);
      if (!routes.has(key)) routes.set(key, [first, second]);
    }
  }
  return routes;
}

function routeKey(sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage}\u0000${targetLanguage}`;
}

function controlPlaneUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderExecutionError("Managed catalog base URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProviderExecutionError("Managed catalog base URL is invalid.");
  }
  return new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
}

function boundedBytes(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new ProviderExecutionError(`Managed ${label} byte limit is invalid.`);
  return value;
}

function safeDownloadTarget(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderExecutionError(
      "Managed model download target is invalid.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new ProviderExecutionError(
      "Managed model download target is invalid.",
    );
  }
  return url;
}

async function readBounded(
  response: Response,
  maximum: number,
  label: string,
): Promise<Uint8Array> {
  const advertised = response.headers.get("content-length");
  if (
    advertised &&
    (!/^\d+$/u.test(advertised) || Number(advertised) > maximum)
  ) {
    throw new ProviderExecutionError(
      `Managed ${label} exceeds its byte limit.`,
    );
  }
  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderExecutionError(
          `Managed ${label} exceeds its byte limit.`,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ProviderExecutionError(`Managed ${label} response is invalid.`);
  }
}

function providerError(
  error: unknown,
  fallback: string,
): ProviderExecutionError {
  if (error instanceof ProviderExecutionError) return error;
  if (error instanceof LocalArgosModelError)
    return new ProviderExecutionError(`${fallback} (${error.code}).`);
  return new ProviderExecutionError(fallback);
}
