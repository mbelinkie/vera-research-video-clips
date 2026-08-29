import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CloudProviderAccessRequestSchema,
  CloudProviderDescriptorSchema,
  CloudProviderLaunchGrantSchema,
  CloudProviderPreferenceSchema,
  LocalModelCandidateSchema,
  LocalModelSourceSchema,
  LocalModelVersionSchema,
  SignedLocalModelCatalogReleaseSchema,
  type CloudProviderAccessRequest,
  type CloudProviderDescriptor,
  type CloudProviderPreference,
  type LocalModelCandidate,
  type LocalModelSource,
  type LocalModelVersion,
  type SignedLocalModelCatalogRelease,
  type TranscriptionExecutionPolicy,
} from "@research-video/contracts";

type Request = (
  path: string,
  options?: Pick<RequestInit, "body" | "method" | "signal">,
) => Promise<Response>;

export type AdminProvider = {
  descriptor: CloudProviderDescriptor;
  recommended: boolean;
  version: number;
  serverConfiguration?: { version: number; updatedAt: string };
};

export type LanguageServiceClient = ReturnType<
  typeof createLanguageServiceClient
>;

export function createLanguageServiceClient(request: Request) {
  async function read<T>(
    path: string,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await request(path, signal ? { signal } : {});
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(readError(payload, "Request failed."));
    return parse(payload);
  }

  async function command<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
    method: "POST" | "PUT" | "DELETE" = "POST",
  ): Promise<T> {
    const response = await request(path, {
      method,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(readError(payload, "Command failed."));
    return parse(payload);
  }

  return {
    listEnabledProviders: (signal?: AbortSignal) =>
      read(
        "/api/language-service-providers",
        (payload) => CloudProviderDescriptorSchema.array().parse(payload),
        signal,
      ),
    listAccountAccess: (signal?: AbortSignal) =>
      read(
        "/api/account/cloud-provider-access",
        (payload) => CloudProviderAccessRequestSchema.array().parse(payload),
        signal,
      ),
    listProviderPreferences: (signal?: AbortSignal) =>
      read(
        "/api/account/cloud-provider-preferences",
        (payload) => CloudProviderPreferenceSchema.array().parse(payload),
        signal,
      ),
    updateTranslationProviderPreference: (
      access: CloudProviderAccessRequest,
      current?: CloudProviderPreference,
    ) =>
      command(
        "/api/account/cloud-provider-preferences/translation",
        {
          providerId: access.providerId,
          accessRequestId: access.id,
          expectedVersion: current?.version ?? 0,
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => CloudProviderPreferenceSchema.parse(payload),
        "PUT",
      ),
    clearTranslationProviderPreference: (current: CloudProviderPreference) =>
      command(
        "/api/account/cloud-provider-preferences/translation",
        {
          expectedVersion: current.version,
          idempotencyKey: crypto.randomUUID(),
        },
        () => undefined,
        "DELETE",
      ),
    requestAccess: (provider: CloudProviderDescriptor) =>
      command(
        "/api/account/cloud-provider-requests",
        {
          providerId: provider.id,
          service: provider.service,
          disclosureVersion: provider.disclosure.version,
          consentAccepted: true,
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => CloudProviderAccessRequestSchema.parse(payload),
      ),
    withdrawAccess: (access: CloudProviderAccessRequest) =>
      command(
        `/api/account/cloud-provider-access/${encodeURIComponent(access.id)}/withdraw`,
        {
          expectedVersion: access.version,
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => CloudProviderAccessRequestSchema.parse(payload),
      ),
    issueLaunchGrant: (access: CloudProviderAccessRequest) =>
      command(
        "/api/account/cloud-provider-launch-grants",
        {
          providerId: access.providerId,
          service: access.service,
          accessRequestId: access.id,
          expectedAccessVersion: access.version,
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => CloudProviderLaunchGrantSchema.parse(payload),
      ),
    listAdminProviders: (signal?: AbortSignal) =>
      read(
        "/api/admin/language-service-providers",
        parseAdminProviders,
        signal,
      ),
    listModelSources: (signal?: AbortSignal) =>
      read(
        "/api/admin/local-model-sources",
        (payload) => LocalModelSourceSchema.array().parse(payload),
        signal,
      ),
    listModelCandidates: (signal?: AbortSignal) =>
      read(
        "/api/admin/local-model-candidates",
        (payload) => LocalModelCandidateSchema.array().parse(payload),
        signal,
      ),
    listModelVersions: (signal?: AbortSignal) =>
      read(
        "/api/admin/local-model-versions",
        (payload) => LocalModelVersionSchema.array().parse(payload),
        signal,
      ),
    getModelCatalog: async (signal?: AbortSignal) => {
      const response = await request(
        "/api/local-model-catalog",
        signal ? { signal } : {},
      );
      if (response.status === 204) return undefined;
      const payload = await response.json().catch(() => undefined);
      if (!response.ok)
        throw new Error(readError(payload, "Catalog request failed."));
      return SignedLocalModelCatalogReleaseSchema.parse(payload);
    },
    refreshSource: (source: LocalModelSource) =>
      command(
        `/api/admin/local-model-sources/${encodeURIComponent(source.id)}/refresh`,
        {
          expectedVersion: source.version,
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => payload,
      ),
    evaluateCandidate: (candidate: LocalModelCandidate) =>
      command(
        `/api/admin/local-model-candidates/${encodeURIComponent(candidate.id)}/evaluate`,
        {
          expectedVersion: candidate.version,
          expectedState: "discovered",
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => payload,
      ),
    updateSourceState: (
      source: LocalModelSource,
      state: LocalModelSource["state"],
    ) =>
      command(
        `/api/admin/local-model-sources/${encodeURIComponent(source.id)}/state`,
        {
          state,
          expectedVersion: source.version,
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => LocalModelSourceSchema.parse(payload),
      ),
    updateModelAvailability: (
      version: LocalModelVersion,
      state: "enabled" | "enabled_by_override" | "disabled" | "revoked",
      reason: string,
      overrideReason?: string,
    ) =>
      command(
        `/api/admin/local-model-versions/${encodeURIComponent(version.id)}/availability`,
        {
          state,
          expectedVersion: version.availability.version,
          reason,
          ...(state === "enabled_by_override"
            ? { overrideReason: overrideReason?.trim() }
            : {}),
          idempotencyKey: crypto.randomUUID(),
        },
        (payload) => payload,
      ),
    updateProviderState: (
      provider: AdminProvider,
      state: CloudProviderDescriptor["state"],
      recommended: boolean,
    ) =>
      command(
        `/api/admin/language-service-providers/${encodeURIComponent(provider.descriptor.id)}/state`,
        {
          state,
          recommended,
          expectedVersion: provider.version,
          idempotencyKey: crypto.randomUUID(),
        },
        parseAdminProvider,
      ),
    updateProviderConfiguration: (
      provider: AdminProvider,
      input: {
        region?: string;
        protectedCredentialReference?: string;
        reason: string;
      },
    ) =>
      command(
        `/api/admin/language-service-providers/${encodeURIComponent(provider.descriptor.id)}/configuration`,
        {
          ...(input.region?.trim() ? { region: input.region.trim() } : {}),
          ...(input.protectedCredentialReference?.trim()
            ? {
                protectedCredentialReference:
                  input.protectedCredentialReference.trim(),
              }
            : {}),
          reason: input.reason.trim(),
          expectedVersion: provider.version,
          idempotencyKey: crypto.randomUUID(),
        },
        parseAdminProvider,
      ),
  };
}

export function translationLanguageOptions(
  providers: readonly CloudProviderDescriptor[],
): readonly { value: string; label: string }[] {
  return uniqueLanguages(
    providers
      .filter(
        (provider) =>
          provider.service === "translation" && provider.state === "enabled",
      )
      .flatMap((provider) =>
        provider.supportedLanguages
          .filter((language) => language.roles.includes("target"))
          .map((language) => language.language),
      ),
  );
}

export function transcriptionProviderOptions(
  providers: readonly CloudProviderDescriptor[],
): readonly CloudProviderDescriptor[] {
  return providers.filter(
    (provider) =>
      provider.service === "transcription" && provider.state === "enabled",
  );
}

export function approvedTranscriptionProviderOptions(
  providers: readonly CloudProviderDescriptor[],
  access: readonly CloudProviderAccessRequest[],
): readonly CloudProviderDescriptor[] {
  return transcriptionProviderOptions(providers).filter((provider) =>
    access.some(
      (entry) =>
        entry.providerId === provider.id &&
        entry.service === "transcription" &&
        entry.state === "approved",
    ),
  );
}

type AccountLanguageServicesPanelProps = {
  client: LanguageServiceClient;
  signedIn: boolean;
  preferredLanguage: string;
  disabled: boolean;
  message: string;
  onPreferredLanguageChange(language: string): void;
  onSavePreference(): void;
  onCloudTranslationProviderChange(
    provider?: CloudProviderDescriptor,
    access?: CloudProviderAccessRequest,
  ): void;
};

export function AccountLanguageServicesPanel({
  client,
  signedIn,
  preferredLanguage,
  disabled,
  message,
  onPreferredLanguageChange,
  onSavePreference,
  onCloudTranslationProviderChange,
}: AccountLanguageServicesPanelProps) {
  const [providers, setProviders] = useState<
    readonly CloudProviderDescriptor[]
  >([]);
  const [access, setAccess] = useState<readonly CloudProviderAccessRequest[]>(
    [],
  );
  const [providerPreferences, setProviderPreferences] = useState<
    readonly CloudProviderPreference[]
  >([]);
  const [status, setStatus] = useState("Connect to inspect language services.");
  const [busyId, setBusyId] = useState<string>();
  const options = useMemo(
    () => translationLanguageOptions(providers),
    [providers],
  );

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setProviders([]);
      setAccess([]);
      return;
    }
    setStatus("Loading language services…");
    try {
      const [nextProviders, nextAccess, nextPreferences] = await Promise.all([
        client.listEnabledProviders(),
        client.listAccountAccess(),
        client.listProviderPreferences(),
      ]);
      setProviders(nextProviders);
      setAccess(nextAccess);
      setProviderPreferences(nextPreferences);
      setStatus(
        nextProviders.length
          ? "Provider disclosures are current."
          : "No cloud language providers are enabled for this account.",
      );
    } catch (error) {
      setStatus(errorMessage(error, "Language services are unavailable."));
    }
  }, [client, signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      await refresh();
    } catch (error) {
      setStatus(errorMessage(error, "Provider access could not be updated."));
    } finally {
      setBusyId(undefined);
    }
  }

  const selectedLanguageKnown = options.some(
    (option) => option.value === preferredLanguage,
  );
  const translationPreference = providerPreferences.find(
    (preference) => preference.service === "translation",
  );
  const approvedTranslationAccess = access.filter(
    (entry) => entry.service === "translation" && entry.state === "approved",
  );
  return (
    <section className="account-settings" aria-label="Language services">
      <label htmlFor="provider-preferred-language">
        Preferred translation language
      </label>
      <div className="loader-row">
        <select
          id="provider-preferred-language"
          value={preferredLanguage}
          disabled={disabled}
          onChange={(event) => onPreferredLanguageChange(event.target.value)}
        >
          {!selectedLanguageKnown ? (
            <option value={preferredLanguage}>
              {preferredLanguage} — saved preference
            </option>
          ) : null}
          <option value="en">English</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" disabled={disabled} onClick={onSavePreference}>
          Save preference
        </button>
      </div>
      <p className="form-message" role="status">
        {message}
      </p>
      <p className="form-message" role="status">
        {status}
      </p>
      <label htmlFor="cloud-translation-provider-preference">
        Cloud translation provider
      </label>
      <select
        id="cloud-translation-provider-preference"
        value={translationPreference?.providerId ?? ""}
        disabled={disabled || approvedTranslationAccess.length === 0}
        onChange={(event) => {
          if (!event.target.value && translationPreference) {
            void run("translation-local", async () => {
              await client.clearTranslationProviderPreference(
                translationPreference,
              );
              onCloudTranslationProviderChange();
            });
            return;
          }
          const selected = approvedTranslationAccess.find(
            (entry) => entry.providerId === event.target.value,
          );
          if (selected) {
            const provider = providers.find(
              (candidate) => candidate.id === selected.providerId,
            );
            if (provider)
              void run(selected.providerId, async () => {
                await client.updateTranslationProviderPreference(
                  selected,
                  translationPreference,
                );
                await client.issueLaunchGrant(selected);
                onCloudTranslationProviderChange(provider, selected);
              });
          }
        }}
      >
        <option value="">Local Argos (default)</option>
        {approvedTranslationAccess.map((entry) => {
          const provider = providers.find(
            (candidate) => candidate.id === entry.providerId,
          );
          return (
            <option key={entry.id} value={entry.providerId}>
              {provider?.displayName ?? entry.providerId}
            </option>
          );
        })}
      </select>
      {providers.map((provider) => {
        const request = access.find(
          (entry) =>
            entry.providerId === provider.id &&
            entry.service === provider.service,
        );
        const canWithdraw =
          request?.state === "requested" || request?.state === "approved";
        return (
          <article key={provider.id} className="provider-card">
            <strong>{provider.displayName}</strong>
            <span>{provider.service}</span>
            <p>{provider.disclosure.summary}</p>
            <small>
              Disclosure v{provider.disclosure.version} ·{" "}
              {provider.disclosure.dataCategories.join(", ")}
              {request
                ? ` · access ${request.state}`
                : " · access not requested"}
            </small>
            <div className="action-row">
              {canWithdraw && request ? (
                <button
                  type="button"
                  disabled={busyId === provider.id}
                  onClick={() =>
                    void run(provider.id, () => client.withdrawAccess(request))
                  }
                >
                  Withdraw access
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!signedIn || busyId === provider.id}
                  onClick={() =>
                    void run(provider.id, () => client.requestAccess(provider))
                  }
                >
                  Request access
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

type PlatformLanguageServicesPanelProps = {
  client: LanguageServiceClient;
  signedIn: boolean;
};

export function PlatformLanguageServicesPanel({
  client,
  signedIn,
}: PlatformLanguageServicesPanelProps) {
  const [providers, setProviders] = useState<readonly AdminProvider[]>([]);
  const [sources, setSources] = useState<readonly LocalModelSource[]>([]);
  const [candidates, setCandidates] = useState<readonly LocalModelCandidate[]>(
    [],
  );
  const [catalog, setCatalog] = useState<SignedLocalModelCatalogRelease>();
  const [versions, setVersions] = useState<readonly LocalModelVersion[]>([]);
  const [status, setStatus] = useState(
    "Platform administration requires authorization.",
  );
  const [busyId, setBusyId] = useState<string>();
  const [overrideReasons, setOverrideReasons] = useState<
    Record<string, string>
  >({});
  const [configurationDrafts, setConfigurationDrafts] = useState<
    Record<
      string,
      { region: string; protectedCredentialReference: string; reason: string }
    >
  >({});

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setStatus("Loading platform language services…");
    try {
      const [
        nextProviders,
        nextSources,
        nextCandidates,
        nextVersions,
        nextCatalog,
      ] = await Promise.all([
        client.listAdminProviders(),
        client.listModelSources(),
        client.listModelCandidates(),
        client.listModelVersions(),
        client.getModelCatalog(),
      ]);
      setProviders(nextProviders);
      setSources(nextSources);
      setCandidates(nextCandidates);
      setVersions(nextVersions);
      setCatalog(nextCatalog);
      setStatus("Platform language-service records are current.");
    } catch (error) {
      setStatus(
        errorMessage(error, "Platform language administration is unavailable."),
      );
    }
  }, [client, signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      await refresh();
    } catch (error) {
      setStatus(errorMessage(error, "Platform command failed."));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section
      className="account-settings"
      aria-label="Platform language administration"
    >
      <details>
        <summary>Platform language administration</summary>
        <p className="form-message" role="status">
          {status}
        </p>
        {providers.map((provider) => (
          <article key={provider.descriptor.id} className="provider-card">
            <strong>{provider.descriptor.displayName}</strong>
            <span>{provider.descriptor.service}</span>
            <p>
              {provider.descriptor.state} ·{" "}
              {provider.recommended ? "recommended" : "not recommended"} ·{" "}
              {provider.serverConfiguration
                ? `configuration healthy (v${provider.serverConfiguration.version})`
                : "configuration missing"}
            </p>
            <small>
              Adapter v{provider.descriptor.adapterContractVersion} · capability{" "}
              {provider.descriptor.capabilityRevision}
            </small>
            <div className="action-row">
              {(["enabled", "draining", "disabled", "suspended"] as const).map(
                (state) => (
                  <button
                    key={state}
                    type="button"
                    disabled={
                      busyId === provider.descriptor.id ||
                      provider.descriptor.state === state
                    }
                    onClick={() =>
                      void run(provider.descriptor.id, () =>
                        client.updateProviderState(
                          provider,
                          state,
                          provider.recommended,
                        ),
                      )
                    }
                  >
                    {state}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={busyId === provider.descriptor.id}
                onClick={() =>
                  void run(provider.descriptor.id, () =>
                    client.updateProviderState(
                      provider,
                      provider.descriptor.state,
                      !provider.recommended,
                    ),
                  )
                }
              >
                {provider.recommended ? "Remove recommendation" : "Recommend"}
              </button>
            </div>
            <div className="loader-row">
              <input
                aria-label={`Region for ${provider.descriptor.id}`}
                value={
                  configurationDrafts[provider.descriptor.id]?.region ?? ""
                }
                onChange={(event) =>
                  setConfigurationDrafts((current) => ({
                    ...current,
                    [provider.descriptor.id]: {
                      region: event.target.value,
                      protectedCredentialReference:
                        current[provider.descriptor.id]
                          ?.protectedCredentialReference ?? "",
                      reason: current[provider.descriptor.id]?.reason ?? "",
                    },
                  }))
                }
                placeholder="Region"
              />
              <input
                aria-label={`Protected credential reference for ${provider.descriptor.id}`}
                value={
                  configurationDrafts[provider.descriptor.id]
                    ?.protectedCredentialReference ?? ""
                }
                onChange={(event) =>
                  setConfigurationDrafts((current) => ({
                    ...current,
                    [provider.descriptor.id]: {
                      region: current[provider.descriptor.id]?.region ?? "",
                      protectedCredentialReference: event.target.value,
                      reason: current[provider.descriptor.id]?.reason ?? "",
                    },
                  }))
                }
                placeholder="Protected credential reference"
              />
              <input
                aria-label={`Configuration reason for ${provider.descriptor.id}`}
                value={
                  configurationDrafts[provider.descriptor.id]?.reason ?? ""
                }
                onChange={(event) =>
                  setConfigurationDrafts((current) => ({
                    ...current,
                    [provider.descriptor.id]: {
                      region: current[provider.descriptor.id]?.region ?? "",
                      protectedCredentialReference:
                        current[provider.descriptor.id]
                          ?.protectedCredentialReference ?? "",
                      reason: event.target.value,
                    },
                  }))
                }
                placeholder="Configuration audit reason"
              />
              <button
                type="button"
                disabled={
                  busyId === provider.descriptor.id ||
                  !(
                    configurationDrafts[provider.descriptor.id]?.reason ?? ""
                  ).trim() ||
                  !(
                    (
                      configurationDrafts[provider.descriptor.id]?.region ?? ""
                    ).trim() ||
                    (
                      configurationDrafts[provider.descriptor.id]
                        ?.protectedCredentialReference ?? ""
                    ).trim()
                  )
                }
                onClick={() =>
                  void run(provider.descriptor.id, () =>
                    client.updateProviderConfiguration(
                      provider,
                      configurationDrafts[provider.descriptor.id] ?? {
                        region: "",
                        protectedCredentialReference: "",
                        reason: "",
                      },
                    ),
                  )
                }
              >
                Save configuration
              </button>
            </div>
          </article>
        ))}
        <h3>Argos sources</h3>
        {sources.map((source) => (
          <article key={source.id} className="provider-card">
            <strong>{source.id}</strong>
            <span>{source.state}</span>
            <p>
              {source.adapter} · refresh every {source.refreshIntervalHours}h
            </p>
            <button
              type="button"
              disabled={busyId === source.id || source.state !== "enabled"}
              onClick={() =>
                void run(source.id, () => client.refreshSource(source))
              }
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={busyId === source.id || source.state === "enabled"}
              onClick={() =>
                void run(source.id, () =>
                  client.updateSourceState(source, "enabled"),
                )
              }
            >
              Enable source
            </button>
            <button
              type="button"
              disabled={busyId === source.id || source.state === "disabled"}
              onClick={() =>
                void run(source.id, () =>
                  client.updateSourceState(source, "disabled"),
                )
              }
            >
              Disable source
            </button>
          </article>
        ))}
        <h3>Argos candidates</h3>
        {candidates.map((candidate) => (
          <article key={candidate.id} className="provider-card">
            <strong>
              {candidate.sourceLanguage} → {candidate.targetLanguage}
            </strong>
            <span>{candidate.state}</span>
            <p>
              {candidate.runtimeFamily} {candidate.runtimeVersion} · package{" "}
              {candidate.packageVersion}
            </p>
            <button
              type="button"
              disabled={
                busyId === candidate.id || candidate.state !== "discovered"
              }
              onClick={() =>
                void run(candidate.id, () =>
                  client.evaluateCandidate(candidate),
                )
              }
            >
              Evaluate
            </button>
          </article>
        ))}
        <h3>Approved Argos versions</h3>
        {versions.map((version) => (
          <article key={version.id} className="provider-card">
            <strong>
              {version.sourceLanguage} → {version.targetLanguage}
            </strong>
            <span>{version.availability.state}</span>
            <p>
              {version.runtimeFamily} ·{" "}
              {version.artifactByteSize.toLocaleString()} bytes
            </p>
            <div className="loader-row">
              <input
                aria-label={`Override reason for ${version.id}`}
                value={overrideReasons[version.id] ?? ""}
                onChange={(event) =>
                  setOverrideReasons((current) => ({
                    ...current,
                    [version.id]: event.target.value,
                  }))
                }
                placeholder="Override reason"
              />
              <button
                type="button"
                disabled={busyId === version.id}
                onClick={() =>
                  void run(version.id, () =>
                    client.updateModelAvailability(
                      version,
                      "enabled",
                      "Administrator enabled this evaluated local model.",
                    ),
                  )
                }
              >
                Enable
              </button>
              <button
                type="button"
                disabled={
                  busyId === version.id ||
                  !(overrideReasons[version.id] ?? "").trim()
                }
                onClick={() =>
                  void run(version.id, () =>
                    client.updateModelAvailability(
                      version,
                      "enabled_by_override",
                      "Administrator accepted the recommendation warning for this local model.",
                      overrideReasons[version.id],
                    ),
                  )
                }
              >
                Enable override
              </button>
              <button
                type="button"
                disabled={busyId === version.id}
                onClick={() =>
                  void run(version.id, () =>
                    client.updateModelAvailability(
                      version,
                      "disabled",
                      "Administrator disabled this local model.",
                    ),
                  )
                }
              >
                Disable
              </button>
              <button
                type="button"
                disabled={busyId === version.id}
                onClick={() =>
                  void run(version.id, () =>
                    client.updateModelAvailability(
                      version,
                      "revoked",
                      "Administrator revoked this local model.",
                    ),
                  )
                }
              >
                Revoke
              </button>
            </div>
          </article>
        ))}
      </details>
    </section>
  );
}

export function BatchTranscriptionProviderPanel({
  client,
  signedIn,
  value,
  onChange,
}: {
  client: LanguageServiceClient;
  signedIn: boolean;
  value: TranscriptionExecutionPolicy;
  onChange(value: TranscriptionExecutionPolicy): void;
}) {
  const [providers, setProviders] = useState<
    readonly CloudProviderDescriptor[]
  >([]);
  const [access, setAccess] = useState<readonly CloudProviderAccessRequest[]>(
    [],
  );
  const [status, setStatus] = useState(
    "Local Whisper is the current batch default.",
  );
  useEffect(() => {
    if (!signedIn) {
      setProviders([]);
      setAccess([]);
      return;
    }
    void Promise.all([
      client.listEnabledProviders(),
      client.listAccountAccess(),
    ])
      .then(([nextProviders, nextAccess]) => {
        setProviders(nextProviders);
        setAccess(nextAccess);
        setStatus(
          "Cloud choices require separate approved access for that provider.",
        );
      })
      .catch((error) =>
        setStatus(
          errorMessage(error, "Cloud provider availability is unavailable."),
        ),
      );
  }, [client, signedIn]);
  const cloudProviders = approvedTranscriptionProviderOptions(
    providers,
    access,
  );
  const selectCloudProvider = async (provider: CloudProviderDescriptor) => {
    const approved = access.find(
      (entry) =>
        entry.providerId === provider.id &&
        entry.service === "transcription" &&
        entry.state === "approved",
    );
    if (!approved) return;
    try {
      await client.issueLaunchGrant(approved);
      onChange({
        schemaVersion: 1,
        execution: "cloud",
        providerId: provider.id,
        fallback: "local",
      });
      setStatus(`${provider.displayName} is authorized for this batch.`);
    } catch (error) {
      setStatus(errorMessage(error, "A launch grant could not be issued."));
    }
  };
  return (
    <fieldset className="cloud-translation-consent">
      <legend>Transcription provider</legend>
      <label>
        <input
          type="radio"
          name="batch-transcription-provider"
          checked={value.execution === "local"}
          onChange={() =>
            onChange({
              schemaVersion: 1,
              execution: "local",
              fallback: "local",
            })
          }
        />{" "}
        Local Whisper (default)
      </label>
      {cloudProviders.map((provider) => (
        <label key={provider.id}>
          <input
            type="radio"
            name="batch-transcription-provider"
            checked={
              value.execution === "cloud" && value.providerId === provider.id
            }
            onChange={() => void selectCloudProvider(provider)}
          />
          <span>
            {provider.displayName} — {provider.disclosure.summary} Consent:{" "}
            {provider.disclosure.dataCategories.join(", ")}.
          </span>
        </label>
      ))}
      <small>
        {cloudProviders.length
          ? "Your selection is saved with this batch. Cloud failure may fall back only to local Whisper."
          : status}
      </small>
    </fieldset>
  );
}

function parseAdminProvider(payload: unknown): AdminProvider {
  return parseAdminProviders([payload])[0]!;
}
function parseAdminProviders(payload: unknown): AdminProvider[] {
  if (!Array.isArray(payload))
    throw new Error("Invalid provider administration response.");
  return payload.map((value) => {
    if (!value || typeof value !== "object")
      throw new Error("Invalid provider administration response.");
    const record = value as Record<string, unknown>;
    return {
      descriptor: CloudProviderDescriptorSchema.parse(record.descriptor),
      recommended: record.recommended === true,
      version: positiveInteger(record.version),
      ...(record.serverConfiguration &&
      typeof record.serverConfiguration === "object"
        ? {
            serverConfiguration: parseConfigurationHealth(
              record.serverConfiguration,
            ),
          }
        : {}),
    };
  });
}
function parseConfigurationHealth(value: object): {
  version: number;
  updatedAt: string;
} {
  const record = value as Record<string, unknown>;
  if (typeof record.updatedAt !== "string")
    throw new Error("Invalid provider configuration response.");
  return {
    version: positiveInteger(record.version),
    updatedAt: record.updatedAt,
  };
}
function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error("Invalid provider administration response.");
  return value;
}
function uniqueLanguages(
  values: readonly string[],
): readonly { value: string; label: string }[] {
  return [...new Set(values)]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}
function readError(value: unknown, fallback: string): string {
  if (value && typeof value === "object") {
    const message = (value as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
