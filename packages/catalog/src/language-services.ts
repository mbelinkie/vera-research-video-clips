import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CloudProviderAccessRequestSchema,
  CloudProviderDescriptorSchema,
  CloudProviderLaunchGrantSchema,
  CloudProviderPreferenceSchema,
  CloudProviderServerConfigurationSchema,
  CloudProviderUsageSchema,
  LocalModelCandidateSchema,
  LocalModelEvaluationFindingSchema,
  LocalModelOperationSchema,
  LocalModelSourceSchema,
  LocalModelVersionSchema,
  ProviderPricingScheduleSchema,
  SignedLocalModelCatalogReleaseSchema,
  type AuthenticatedActor,
  type CloudProviderAccessDecision,
  type CloudProviderAccessRequest,
  type CloudProviderDescriptor,
  type CloudProviderLaunchGrant,
  type CloudProviderPreference,
  type ClearCloudProviderPreferenceRequest,
  type CreateCloudProviderAccessRequest,
  type EvaluateLocalModelCandidateRequest,
  type IssueCloudProviderLaunchGrantRequest,
  type LocalModelCandidate,
  type LocalModelOperation,
  type LocalModelSource,
  type LocalModelVersion,
  type RefreshLocalModelSourceRequest,
  type RevokeCloudProviderLaunchGrantRequest,
  type SignedLocalModelCatalogRelease,
  type UpdateCloudProviderConfigurationRequest,
  type UpdateCloudProviderPreferenceRequest,
  type UpdateCloudProviderStateRequest,
  type UpdateLocalModelVersionAvailabilityRequest,
  type UpdateLocalModelSourceRequest,
  type WithdrawCloudProviderAccessRequest,
} from "@research-video/contracts";
import {
  asCloudDatabase,
  type CloudDatabase,
  type CloudDatabaseInput,
  type CloudQueryRow,
} from "@research-video/db-cloud";

export class LanguageServiceNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
}

export class LanguageServiceConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "conflict";
}

export class LanguageServiceInvalidRequestError extends Error {
  readonly statusCode = 400;
  readonly code = "invalid_request";
}

export class LanguageServiceIdempotencyError extends Error {
  readonly statusCode = 409;
  readonly code = "idempotency_conflict";
}

export interface LocalModelCatalogReleaseSigner {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<string>;
}

export type AdminCloudProvider = {
  descriptor: CloudProviderDescriptor;
  recommended: boolean;
  version: number;
  serverConfiguration?: ReturnType<
    typeof CloudProviderServerConfigurationSchema.parse
  >;
};

export type LocalModelArtifactSource = {
  catalogReleaseId: string;
  versionId: string;
  mirroredArtifactId: string;
  artifactSha256: string;
  artifactByteSize: number;
};

type Row = CloudQueryRow;

/**
 * Durable, provider-neutral control plane. It stores only credential references
 * and grant hashes; clear grant material is returned once to the desktop caller.
 */
export class LanguageServiceControlPlane {
  readonly #database: CloudDatabase;

  constructor(
    database: CloudDatabaseInput,
    private readonly now: () => Date = () => new Date(),
    private readonly signer?: LocalModelCatalogReleaseSigner,
  ) {
    this.#database = asCloudDatabase(database);
  }

  async synchronizeDeployedProviders(
    descriptors: readonly CloudProviderDescriptor[],
  ): Promise<void> {
    for (const value of descriptors) {
      const descriptor = CloudProviderDescriptorSchema.parse(value);
      await this.#database.query(
        `INSERT INTO language_service_providers
           (id, service, display_name, adapter_contract_version,
            configuration_revision, capability_revision, supported_languages,
            input_modes, disclosure, pricing, state, recommended, version,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', false, 1, $11, $11)
         ON CONFLICT (id) DO UPDATE SET
           service = EXCLUDED.service,
           display_name = EXCLUDED.display_name,
           adapter_contract_version = EXCLUDED.adapter_contract_version,
           capability_revision = EXCLUDED.capability_revision,
           supported_languages = EXCLUDED.supported_languages,
           input_modes = EXCLUDED.input_modes,
           updated_at = EXCLUDED.updated_at`,
        [
          descriptor.id,
          descriptor.service,
          descriptor.displayName,
          descriptor.adapterContractVersion,
          descriptor.configurationRevision,
          descriptor.capabilityRevision,
          JSON.stringify(descriptor.supportedLanguages),
          JSON.stringify(descriptor.inputModes),
          JSON.stringify(descriptor.disclosure),
          JSON.stringify(descriptor.pricing),
          this.now().toISOString(),
        ],
      );
    }
  }

  async listEnabledProviders(): Promise<CloudProviderDescriptor[]> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM language_service_providers
       WHERE state = 'enabled' ORDER BY service, recommended DESC, display_name`,
    );
    return result.rows.map(mapProviderDescriptor);
  }

  async listAdminProviders(): Promise<AdminCloudProvider[]> {
    const result = await this.#database.query<Row>(
      `SELECT p.*, c.region, c.protected_credential_reference,
              c.version AS configuration_version, c.updated_at AS configuration_updated_at
       FROM language_service_providers p
       LEFT JOIN language_service_provider_server_configurations c
         ON c.provider_id = p.id
       ORDER BY p.service, p.display_name`,
    );
    return result.rows.map((row) => ({
      descriptor: mapProviderDescriptor(row),
      recommended: Boolean(row.recommended),
      version: Number(row.version),
      ...(row.configuration_version === null ||
      row.configuration_version === undefined
        ? {}
        : {
            serverConfiguration: CloudProviderServerConfigurationSchema.parse({
              providerId: row.id,
              ...(row.region ? { region: row.region } : {}),
              ...(row.protected_credential_reference
                ? {
                    protectedCredentialReference:
                      row.protected_credential_reference,
                  }
                : {}),
              version: Number(row.configuration_version),
              updatedAt: iso(row.configuration_updated_at),
            }),
          }),
    }));
  }

  async getProviderRuntimeConfiguration(providerId: string): Promise<{
    region?: string;
    protectedCredentialReference?: string;
    configurationRevision: string;
  }> {
    const result = await this.#database.query<Row>(
      `SELECT provider.configuration_revision, configuration.region,
              configuration.protected_credential_reference
       FROM language_service_providers provider
       LEFT JOIN language_service_provider_server_configurations configuration
         ON configuration.provider_id = provider.id
       WHERE provider.id = $1`,
      [providerId],
    );
    if (!result.rows[0])
      throw new LanguageServiceNotFoundError("Provider not found.");
    return {
      configurationRevision: String(result.rows[0].configuration_revision),
      ...(result.rows[0].region
        ? { region: String(result.rows[0].region) }
        : {}),
      ...(result.rows[0].protected_credential_reference
        ? {
            protectedCredentialReference: String(
              result.rows[0].protected_credential_reference,
            ),
          }
        : {}),
    };
  }

  async updateProviderState(
    actor: AuthenticatedActor,
    providerId: string,
    request: UpdateCloudProviderStateRequest,
  ): Promise<AdminCloudProvider> {
    return this.#mutate(
      actor,
      "provider_state",
      request.idempotencyKey,
      {
        providerId,
        request,
      },
      async () => {
        if (request.recommended === true && request.state !== "enabled") {
          throw new LanguageServiceInvalidRequestError(
            "Only an enabled provider can be recommended.",
          );
        }
        const now = this.now().toISOString();
        if (request.recommended) {
          await this.#database.query(
            `UPDATE language_service_providers
             SET recommended = false, version = version + 1, updated_at = $1
             WHERE service = (SELECT service FROM language_service_providers WHERE id = $2)
               AND id <> $2 AND recommended = true`,
            [now, providerId],
          );
        }
        const updated = await this.#database.query<Row>(
          `UPDATE language_service_providers
         SET state = $1,
             recommended = COALESCE($2, recommended),
             version = version + 1,
             updated_at = $3
         WHERE id = $4 AND version = $5
         RETURNING id`,
          [
            request.state,
            request.recommended ?? null,
            now,
            providerId,
            request.expectedVersion,
          ],
        );
        if (!updated.rows[0])
          await this.#throwMissingOrStaleProvider(providerId);
        return this.#getAdminProvider(providerId);
      },
    );
  }

  async updateProviderConfiguration(
    actor: AuthenticatedActor,
    providerId: string,
    request: UpdateCloudProviderConfigurationRequest,
  ): Promise<AdminCloudProvider> {
    return this.#mutate(
      actor,
      "provider_configuration",
      request.idempotencyKey,
      {
        providerId,
        request,
      },
      async () => {
        const current = await this.#getAdminProvider(providerId);
        if (current.version !== request.expectedVersion) {
          throw new LanguageServiceConflictError(
            "Provider configuration is stale.",
          );
        }
        const now = this.now().toISOString();
        const nextRevision = `admin-${current.version + 1}`;
        const updated = await this.#database.query<Row>(
          `UPDATE language_service_providers
         SET configuration_revision = $1,
             pricing = COALESCE($2, pricing),
             disclosure = COALESCE($3, disclosure),
             version = version + 1,
             updated_at = $4
         WHERE id = $5 AND version = $6 RETURNING version`,
          [
            nextRevision,
            request.pricing ? JSON.stringify(request.pricing) : null,
            request.disclosure ? JSON.stringify(request.disclosure) : null,
            now,
            providerId,
            request.expectedVersion,
          ],
        );
        if (!updated.rows[0])
          throw new LanguageServiceConflictError(
            "Provider configuration is stale.",
          );
        const priorConfigVersion = current.serverConfiguration?.version ?? 0;
        const changesServerConfiguration =
          request.region !== undefined ||
          request.protectedCredentialReference !== undefined;
        if (
          changesServerConfiguration &&
          !current.serverConfiguration &&
          !request.protectedCredentialReference
        ) {
          throw new LanguageServiceInvalidRequestError(
            "A new provider configuration requires a protected credential reference.",
          );
        }
        if (changesServerConfiguration) {
          await this.#database.query(
            `INSERT INTO language_service_provider_server_configurations
           (provider_id, region, protected_credential_reference, version, updated_at)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (provider_id) DO UPDATE SET
           region = COALESCE(EXCLUDED.region, language_service_provider_server_configurations.region),
           protected_credential_reference = COALESCE(
             EXCLUDED.protected_credential_reference,
             language_service_provider_server_configurations.protected_credential_reference
           ),
           version = language_service_provider_server_configurations.version + 1,
           updated_at = EXCLUDED.updated_at`,
            [
              providerId,
              request.region ?? null,
              request.protectedCredentialReference ??
                current.serverConfiguration?.protectedCredentialReference,
              now,
            ],
          );
        }
        const changedFields = [
          ...(request.region !== undefined ? ["region"] : []),
          ...(request.protectedCredentialReference !== undefined
            ? ["protected_credential_reference"]
            : []),
          ...(request.pricing !== undefined ? ["pricing"] : []),
          ...(request.disclosure !== undefined ? ["disclosure"] : []),
        ];
        await this.#database.query(
          `INSERT INTO language_service_provider_configuration_audits
           (id, provider_id, actor_id, prior_version, next_version,
            changed_fields, reason, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            providerId,
            actor.userId,
            priorConfigVersion,
            priorConfigVersion + 1,
            JSON.stringify(changedFields),
            request.reason,
            now,
          ],
        );
        return this.#getAdminProvider(providerId);
      },
    );
  }

  async listAccountAccess(
    actor: AuthenticatedActor,
  ): Promise<CloudProviderAccessRequest[]> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM cloud_provider_access_requests
       WHERE account_id = $1 ORDER BY created_at DESC`,
      [actor.userId],
    );
    return result.rows.map(mapAccessRequest);
  }

  async getAccountProviderPreferences(
    actor: AuthenticatedActor,
  ): Promise<CloudProviderPreference[]> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM cloud_provider_account_preferences
       WHERE account_id = $1 ORDER BY service`,
      [actor.userId],
    );
    return result.rows.map((row) =>
      CloudProviderPreferenceSchema.parse({
        service: row.service,
        providerId: row.provider_id,
        accessRequestId: row.access_request_id,
        version: Number(row.version),
        updatedAt: iso(row.updated_at),
      }),
    );
  }

  async updateAccountProviderPreference(
    actor: AuthenticatedActor,
    service: "translation" | "transcription",
    request: UpdateCloudProviderPreferenceRequest,
  ): Promise<CloudProviderPreference> {
    return this.#mutate(
      actor,
      "provider_preference",
      request.idempotencyKey,
      { service, request },
      async () => {
        await this.requireApprovedProviderAccess(
          actor,
          request.providerId,
          service,
        );
        const access = await this.#database.query<Row>(
          `SELECT 1 FROM cloud_provider_access_requests
           WHERE id = $1 AND account_id = $2 AND provider_id = $3
             AND service = $4 AND state = 'approved'`,
          [request.accessRequestId, actor.userId, request.providerId, service],
        );
        if (!access.rows[0])
          throw new LanguageServiceInvalidRequestError(
            "The provider preference requires its exact approved access request.",
          );
        const now = this.now().toISOString();
        const result =
          request.expectedVersion === 0
            ? await this.#database.query<Row>(
                `INSERT INTO cloud_provider_account_preferences
                   (account_id, service, provider_id, access_request_id, version, updated_at)
                 VALUES ($1, $2, $3, $4, 1, $5)
                 ON CONFLICT (account_id, service) DO NOTHING RETURNING *`,
                [
                  actor.userId,
                  service,
                  request.providerId,
                  request.accessRequestId,
                  now,
                ],
              )
            : await this.#database.query<Row>(
                `UPDATE cloud_provider_account_preferences
                 SET provider_id = $1, access_request_id = $2,
                     version = version + 1, updated_at = $3
                 WHERE account_id = $4 AND service = $5 AND version = $6
                 RETURNING *`,
                [
                  request.providerId,
                  request.accessRequestId,
                  now,
                  actor.userId,
                  service,
                  request.expectedVersion,
                ],
              );
        if (!result.rows[0])
          throw new LanguageServiceConflictError(
            "The provider preference is stale; reload before changing it.",
          );
        return CloudProviderPreferenceSchema.parse({
          service: result.rows[0].service,
          providerId: result.rows[0].provider_id,
          accessRequestId: result.rows[0].access_request_id,
          version: Number(result.rows[0].version),
          updatedAt: iso(result.rows[0].updated_at),
        });
      },
    );
  }

  async clearAccountProviderPreference(
    actor: AuthenticatedActor,
    service: "translation" | "transcription",
    request: ClearCloudProviderPreferenceRequest,
  ): Promise<void> {
    await this.#mutate(
      actor,
      "clear_provider_preference",
      request.idempotencyKey,
      { service, request },
      async () => {
        const removed = await this.#database.query<Row>(
          `DELETE FROM cloud_provider_account_preferences
           WHERE account_id = $1 AND service = $2 AND version = $3
           RETURNING account_id`,
          [actor.userId, service, request.expectedVersion],
        );
        if (!removed.rows[0])
          throw new LanguageServiceConflictError(
            "The provider preference is stale; reload before clearing it.",
          );
        return { cleared: true };
      },
    );
  }

  async requestProviderAccess(
    actor: AuthenticatedActor,
    request: CreateCloudProviderAccessRequest,
  ): Promise<CloudProviderAccessRequest> {
    return this.#mutate(
      actor,
      "request_provider_access",
      request.idempotencyKey,
      request,
      async () => {
        const provider = await this.#getAdminProvider(request.providerId);
        if (
          provider.descriptor.service !== request.service ||
          provider.descriptor.state !== "enabled"
        ) {
          throw new LanguageServiceInvalidRequestError(
            "That provider is not available for this service.",
          );
        }
        if (
          provider.descriptor.disclosure.version !== request.disclosureVersion
        ) {
          throw new LanguageServiceConflictError(
            "The provider disclosure has changed.",
          );
        }
        const now = this.now().toISOString();
        const id = randomUUID();
        try {
          await this.#database.query(
            `INSERT INTO cloud_provider_access_requests
             (id, provider_id, service, account_id, disclosure_version,
              consent_accepted_at, state, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'requested', 1, $6, $6)`,
            [
              id,
              request.providerId,
              request.service,
              actor.userId,
              request.disclosureVersion,
              now,
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new LanguageServiceConflictError(
              "An active request already exists for this provider.",
            );
          }
          throw error;
        }
        return this.#getAccessRequest(id);
      },
    );
  }

  async withdrawProviderAccess(
    actor: AuthenticatedActor,
    requestId: string,
    request: WithdrawCloudProviderAccessRequest,
  ): Promise<CloudProviderAccessRequest> {
    return this.#mutate(
      actor,
      "withdraw_provider_access",
      request.idempotencyKey,
      {
        requestId,
        request,
      },
      async () => {
        const now = this.now().toISOString();
        const result = await this.#database.query<Row>(
          `UPDATE cloud_provider_access_requests
         SET state = 'withdrawn', version = version + 1, updated_at = $1
         WHERE id = $2 AND account_id = $3 AND state = 'requested' AND version = $4
         RETURNING id`,
          [now, requestId, actor.userId, request.expectedVersion],
        );
        if (!result.rows[0])
          throw new LanguageServiceConflictError(
            "The access request is missing, stale, or no longer withdrawable.",
          );
        return this.#getAccessRequest(requestId);
      },
    );
  }

  async listPendingAccessRequests(): Promise<CloudProviderAccessRequest[]> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM cloud_provider_access_requests
       WHERE state = 'requested' ORDER BY created_at`,
    );
    return result.rows.map(mapAccessRequest);
  }

  async requireApprovedProviderAccess(
    actor: AuthenticatedActor,
    providerId: string,
    service: "translation" | "transcription",
  ): Promise<CloudProviderAccessRequest> {
    const result = await this.#database.query<Row>(
      `SELECT access.*
       FROM cloud_provider_access_requests access
       JOIN language_service_providers provider
         ON provider.id = access.provider_id AND provider.service = access.service
       WHERE access.account_id = $1 AND access.provider_id = $2
         AND access.service = $3 AND access.state = 'approved'
         AND provider.state = 'enabled'
       ORDER BY access.updated_at DESC LIMIT 1`,
      [actor.userId, providerId, service],
    );
    if (!result.rows[0]) {
      throw new LanguageServiceInvalidRequestError(
        "Approved access to the selected provider is required.",
      );
    }
    return mapAccessRequest(result.rows[0]);
  }

  async requireProviderAvailable(
    providerId: string,
    service: "translation" | "transcription",
    existingOperationId?: string,
  ): Promise<void> {
    const result = await this.#database.query<Row>(
      `SELECT 1 FROM language_service_providers
       WHERE id = $1 AND service = $2
         AND (
           state = 'enabled'
           OR EXISTS (
             SELECT 1 FROM cloud_provider_operations operation
             WHERE operation.id = $3 AND operation.provider_id = $1
               AND operation.service = $2
               AND operation.state IN ('staging', 'submitted', 'running')
           )
         )`,
      [providerId, service, existingOperationId ?? null],
    );
    if (!result.rows[0]) {
      throw new LanguageServiceInvalidRequestError(
        "The selected provider is not enabled for new work.",
      );
    }
  }

  async requireActiveLaunchGrant(
    actor: AuthenticatedActor,
    providerId: string,
    service: "translation" | "transcription",
    accessRequestId: string,
  ): Promise<{ id: string; expiresAt: string }> {
    const result = await this.#database.query<Row>(
      `SELECT launch_grant.id, launch_grant.expires_at
       FROM cloud_provider_launch_grants launch_grant
       JOIN cloud_provider_access_requests access
         ON access.id = launch_grant.access_request_id
       JOIN language_service_providers provider
         ON provider.id = launch_grant.provider_id AND provider.service = launch_grant.service
       WHERE launch_grant.account_id = $1 AND launch_grant.provider_id = $2
         AND launch_grant.service = $3 AND launch_grant.access_request_id = $4
         AND launch_grant.revoked_at IS NULL AND launch_grant.expires_at > $5
         AND access.state = 'approved' AND provider.state = 'enabled'
       ORDER BY launch_grant.expires_at DESC LIMIT 1`,
      [
        actor.userId,
        providerId,
        service,
        accessRequestId,
        this.now().toISOString(),
      ],
    );
    if (!result.rows[0]) {
      throw new LanguageServiceInvalidRequestError(
        "An active launch grant for the selected provider is required.",
      );
    }
    return {
      id: String(result.rows[0].id),
      expiresAt: iso(result.rows[0].expires_at),
    };
  }

  async decideProviderAccess(
    actor: AuthenticatedActor,
    requestId: string,
    request: CloudProviderAccessDecision,
  ): Promise<CloudProviderAccessRequest> {
    return this.#mutate(
      actor,
      "decide_provider_access",
      request.idempotencyKey,
      {
        requestId,
        request,
      },
      async () => {
        const nextState =
          request.action === "approve"
            ? "approved"
            : request.action === "deny"
              ? "denied"
              : "revoked";
        const allowedPrior =
          request.action === "revoke" ? "approved" : "requested";
        const now = this.now().toISOString();
        const result = await this.#database.query<Row>(
          `UPDATE cloud_provider_access_requests
         SET state = $1, decision_by = $2, decision_at = $3,
             decision_reason = $4, version = version + 1, updated_at = $3
         WHERE id = $5 AND state = $6 AND version = $7 RETURNING id`,
          [
            nextState,
            actor.userId,
            now,
            request.reason ?? null,
            requestId,
            allowedPrior,
            request.expectedVersion,
          ],
        );
        if (!result.rows[0])
          throw new LanguageServiceConflictError(
            "The access request is missing, stale, or no longer decidable.",
          );
        if (nextState === "revoked") {
          await this.#database.query(
            `UPDATE cloud_provider_launch_grants SET revoked_at = $1
           WHERE access_request_id = $2 AND revoked_at IS NULL`,
            [now, requestId],
          );
        }
        return this.#getAccessRequest(requestId);
      },
    );
  }

  async issueLaunchGrant(
    actor: AuthenticatedActor,
    request: IssueCloudProviderLaunchGrantRequest,
    lifetimeMs = 15 * 60 * 1_000,
  ): Promise<CloudProviderLaunchGrant> {
    return this.#mutate(
      actor,
      "issue_provider_grant",
      request.idempotencyKey,
      request,
      async () => {
        const access = await this.#getAccessRequest(request.accessRequestId);
        if (
          access.accountId !== actor.userId ||
          access.providerId !== request.providerId ||
          access.service !== request.service ||
          access.version !== request.expectedAccessVersion ||
          access.state !== "approved"
        ) {
          throw new LanguageServiceInvalidRequestError(
            "Approved provider-specific access is required.",
          );
        }
        const provider = await this.#getAdminProvider(request.providerId);
        if (
          provider.descriptor.service !== request.service ||
          provider.descriptor.state !== "enabled"
        ) {
          throw new LanguageServiceConflictError(
            "The provider cannot issue new grants.",
          );
        }
        const issuedAt = this.now();
        const expiresAt = new Date(issuedAt.getTime() + lifetimeMs);
        const id = randomUUID();
        const grantReference = `lsg_${randomBytes(32).toString("base64url")}`;
        await this.#database.query(
          `INSERT INTO cloud_provider_launch_grants
           (id, provider_id, service, access_request_id, account_id,
            grant_reference_sha256, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            request.providerId,
            request.service,
            request.accessRequestId,
            actor.userId,
            sha256(grantReference),
            issuedAt.toISOString(),
            expiresAt.toISOString(),
          ],
        );
        return CloudProviderLaunchGrantSchema.parse({
          id,
          providerId: request.providerId,
          service: request.service,
          accessRequestId: request.accessRequestId,
          grantReference,
          version: 1,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      },
    );
  }

  async revokeLaunchGrant(
    actor: AuthenticatedActor,
    grantId: string,
    request: RevokeCloudProviderLaunchGrantRequest,
  ): Promise<void> {
    await this.#mutate(
      actor,
      "revoke_provider_grant",
      request.idempotencyKey,
      {
        grantId,
        request,
      },
      async () => {
        const result = await this.#database.query<Row>(
          `UPDATE cloud_provider_launch_grants
           SET revoked_at = $1, version = version + 1
           WHERE id = $2 AND account_id = $3 AND revoked_at IS NULL
             AND version = $4 RETURNING id`,
          [
            this.now().toISOString(),
            grantId,
            actor.userId,
            request.expectedVersion,
          ],
        );
        if (!result.rows[0])
          throw new LanguageServiceNotFoundError("Grant not found.");
        return { revoked: true };
      },
    );
  }

  async listUsage(): Promise<
    ReturnType<typeof CloudProviderUsageSchema.parse>[]
  > {
    const result = await this.#database.query<Row>(
      `SELECT * FROM cloud_provider_usage ORDER BY recorded_at DESC`,
    );
    return result.rows.map((row) =>
      CloudProviderUsageSchema.parse({
        id: row.id,
        providerId: row.provider_id,
        service: row.service,
        accountId: row.account_id,
        ...(row.operation_id ? { operationId: row.operation_id } : {}),
        pricing: json(row.pricing_snapshot),
        quantity: Number(row.quantity),
        estimatedCostMicros: Number(row.estimated_cost_micros),
        recordedAt: iso(row.recorded_at),
      }),
    );
  }

  async beginProviderOperation(input: {
    operationId: string;
    providerId: string;
    service: "translation" | "transcription";
    grantId: string;
    attempt: number;
    policySnapshot: unknown;
    inputMode:
      | "text_segments"
      | "object_uri"
      | "direct_upload"
      | "byte_stream"
      | "source_url";
  }): Promise<void> {
    await this.#database.transaction(async () => {
      const authority = await this.#database.query<Row>(
        `SELECT launch_grant.account_id, provider.configuration_revision,
                provider.capability_revision
         FROM cloud_provider_launch_grants launch_grant
         JOIN cloud_provider_access_requests access
           ON access.id = launch_grant.access_request_id
         JOIN language_service_providers provider
           ON provider.id = launch_grant.provider_id AND provider.service = launch_grant.service
         WHERE launch_grant.id = $1 AND launch_grant.provider_id = $2 AND launch_grant.service = $3
           AND (
             (launch_grant.revoked_at IS NULL AND launch_grant.expires_at > $4
              AND access.state = 'approved' AND provider.state = 'enabled')
             OR EXISTS (
               SELECT 1 FROM cloud_provider_operations existing
               WHERE existing.id = $5 AND existing.provider_id = $2
                 AND existing.service = $3
                 AND existing.state IN ('staging', 'submitted', 'running')
             )
           )`,
        [
          input.grantId,
          input.providerId,
          input.service,
          this.now().toISOString(),
          input.operationId,
        ],
      );
      const row = authority.rows[0];
      if (!row)
        throw new LanguageServiceInvalidRequestError(
          "The provider launch authority is no longer active.",
        );
      const now = this.now().toISOString();
      await this.#database.query(
        `INSERT INTO cloud_provider_operations
           (id, provider_id, service, account_id, grant_id, policy_snapshot,
            configuration_revision, capability_revision, input_mode, state,
            cleanup_state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running', 'pending', $10, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.operationId,
          input.providerId,
          input.service,
          row.account_id,
          input.grantId,
          JSON.stringify(input.policySnapshot),
          row.configuration_revision,
          row.capability_revision,
          input.inputMode,
          now,
        ],
      );
      const operation = await this.#database.query<Row>(
        `SELECT provider_id, service, grant_id, policy_snapshot
         FROM cloud_provider_operations WHERE id = $1`,
        [input.operationId],
      );
      if (
        !operation.rows[0] ||
        operation.rows[0].provider_id !== input.providerId ||
        operation.rows[0].service !== input.service ||
        operation.rows[0].grant_id !== input.grantId ||
        canonicalJson(json(operation.rows[0].policy_snapshot)) !==
          canonicalJson(input.policySnapshot)
      ) {
        throw new LanguageServiceConflictError(
          "The durable provider operation identity belongs to different work.",
        );
      }
      await this.#database.query(
        `INSERT INTO cloud_provider_operation_attempts
           (operation_id, attempt, state, progress_percent, started_at)
         VALUES ($1, $2, 'running', 0, $3)
         ON CONFLICT (operation_id, attempt) DO NOTHING`,
        [input.operationId, input.attempt, now],
      );
    });
  }

  async finishProviderOperation(input: {
    operationId: string;
    attempt: number;
    state: "succeeded" | "failed" | "canceled";
    cleanup: "completed" | "failed";
    sanitizedFailureCode?: string;
    quantity?: number;
  }): Promise<void> {
    const now = this.now().toISOString();
    await this.#database.transaction(async () => {
      const operation = await this.#database.query<Row>(
        `SELECT operation.*, provider.pricing
         FROM cloud_provider_operations operation
         JOIN language_service_providers provider
           ON provider.id = operation.provider_id
          AND provider.service = operation.service
         WHERE operation.id = $1 FOR UPDATE`,
        [input.operationId],
      );
      const row = operation.rows[0];
      if (!row)
        throw new LanguageServiceNotFoundError("Provider operation not found.");
      if (["succeeded", "failed", "canceled"].includes(String(row.state)))
        return;
      const failureCode = input.sanitizedFailureCode
        ?.replace(/[^a-z0-9_.-]/giu, "_")
        .slice(0, 160);
      await this.#database.query(
        `UPDATE cloud_provider_operations
         SET state = $2, cleanup_state = $3,
             cleanup_completed_at = CASE
               WHEN $3 = 'completed' THEN $4::timestamptz
               ELSE NULL::timestamptz
             END,
             cleanup_failure_code = CASE WHEN $3 = 'failed' THEN $5 ELSE NULL END,
             terminal_at = $4::timestamptz, updated_at = $4::timestamptz
         WHERE id = $1`,
        [
          input.operationId,
          input.state,
          input.cleanup,
          now,
          failureCode ?? "cleanup_failed",
        ],
      );
      await this.#database.query(
        `UPDATE cloud_provider_operation_attempts
         SET state = $3,
             progress_percent = CASE WHEN $3 = 'succeeded' THEN 100 ELSE progress_percent END,
             sanitized_failure_code = $4, finished_at = $5
         WHERE operation_id = $1 AND attempt = $2`,
        [
          input.operationId,
          input.attempt,
          input.state,
          failureCode ?? null,
          now,
        ],
      );
      if (input.quantity !== undefined) {
        const pricing = ProviderPricingScheduleSchema.parse(json(row.pricing));
        const estimatedCostMicros = Math.ceil(
          (input.quantity / pricing.quantity) * pricing.amountMicros,
        );
        await this.#database.query(
          `INSERT INTO cloud_provider_usage
             (id, provider_id, service, account_id, operation_id,
              pricing_snapshot, quantity, estimated_cost_micros, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            row.provider_id,
            row.service,
            row.account_id,
            input.operationId,
            JSON.stringify(pricing),
            input.quantity,
            estimatedCostMicros,
            now,
          ],
        );
      }
    });
  }

  async synchronizeLocalModelSources(
    sources: readonly LocalModelSource[],
  ): Promise<void> {
    for (const value of sources) {
      const source = LocalModelSourceSchema.parse(value);
      await this.#database.query(
        `INSERT INTO local_model_sources
           (id, adapter, source_url, state, refresh_interval_hours, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'disabled', $4, 1, $5, $5)
         ON CONFLICT (id) DO UPDATE SET adapter = EXCLUDED.adapter,
           source_url = EXCLUDED.source_url,
           refresh_interval_hours = EXCLUDED.refresh_interval_hours,
           updated_at = EXCLUDED.updated_at`,
        [
          source.id,
          source.adapter,
          source.sourceUrl,
          source.refreshIntervalHours,
          this.now().toISOString(),
        ],
      );
    }
  }

  async listLocalModelSources(): Promise<LocalModelSource[]> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM local_model_sources ORDER BY id`,
    );
    return result.rows.map(mapLocalModelSource);
  }

  async updateLocalModelSource(
    actor: AuthenticatedActor,
    sourceId: string,
    request: UpdateLocalModelSourceRequest,
  ): Promise<LocalModelSource> {
    return this.#mutate(
      actor,
      "update_local_model_source",
      request.idempotencyKey,
      { sourceId, request },
      async () => {
        const result = await this.#database.query<Row>(
          `UPDATE local_model_sources
           SET state = $1,
               refresh_interval_hours = COALESCE($2, refresh_interval_hours),
               version = version + 1,
               updated_at = $3
           WHERE id = $4 AND version = $5 RETURNING *`,
          [
            request.state,
            request.refreshIntervalHours ?? null,
            this.now().toISOString(),
            sourceId,
            request.expectedVersion,
          ],
        );
        if (!result.rows[0]) {
          throw new LanguageServiceConflictError(
            "Local-model source is missing or stale.",
          );
        }
        return mapLocalModelSource(result.rows[0]);
      },
    );
  }

  async queueSourceRefresh(
    actor: AuthenticatedActor,
    sourceId: string,
    request: RefreshLocalModelSourceRequest,
  ): Promise<LocalModelOperation> {
    return this.#mutate(
      actor,
      "refresh_local_model_source",
      request.idempotencyKey,
      {
        sourceId,
        request,
      },
      async () => {
        const source = await this.#database.query<Row>(
          `SELECT version FROM local_model_sources WHERE id = $1`,
          [sourceId],
        );
        if (!source.rows[0])
          throw new LanguageServiceNotFoundError(
            "Local-model source not found.",
          );
        if (Number(source.rows[0].version) !== request.expectedVersion) {
          throw new LanguageServiceConflictError(
            "Local-model source is stale.",
          );
        }
        return this.#insertModelOperation(
          actor,
          "refresh_source",
          request.idempotencyKey,
          { sourceId },
        );
      },
    );
  }

  async listLocalModelCandidates(): Promise<LocalModelCandidate[]> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM local_model_candidates ORDER BY discovered_at DESC`,
    );
    return result.rows.map(mapLocalModelCandidate);
  }

  async queueCandidateEvaluation(
    actor: AuthenticatedActor,
    candidateId: string,
    request: EvaluateLocalModelCandidateRequest,
  ): Promise<LocalModelOperation> {
    return this.#mutate(
      actor,
      "evaluate_local_model_candidate",
      request.idempotencyKey,
      {
        candidateId,
        request,
      },
      async () => {
        const updated = await this.#database.query<Row>(
          `UPDATE local_model_candidates
         SET state = 'evaluating', version = version + 1
         WHERE id = $1 AND state = 'discovered' AND version = $2 RETURNING id`,
          [candidateId, request.expectedVersion],
        );
        if (!updated.rows[0])
          throw new LanguageServiceConflictError(
            "Candidate is missing or no longer discoverable.",
          );
        return this.#insertModelOperation(
          actor,
          "evaluate_candidate",
          request.idempotencyKey,
          { candidateId },
        );
      },
    );
  }

  async listLocalModelVersions(): Promise<LocalModelVersion[]> {
    const result = await this.#database.query<Row>(
      `SELECT version.*, candidate.package_version, candidate.runtime_version
       FROM local_model_versions version
       JOIN local_model_candidates candidate ON candidate.id = version.candidate_id
       ORDER BY version.source_language, version.target_language,
                version.availability_changed_at DESC`,
    );
    return result.rows.map(mapLocalModelVersion);
  }

  async updateLocalModelAvailability(
    actor: AuthenticatedActor,
    versionId: string,
    request: UpdateLocalModelVersionAvailabilityRequest,
  ): Promise<{
    version: LocalModelVersion;
    release: SignedLocalModelCatalogRelease;
  }> {
    return this.#mutate(
      actor,
      "update_local_model_availability",
      request.idempotencyKey,
      {
        versionId,
        request,
      },
      async () => {
        if (!this.signer)
          throw new LanguageServiceConflictError(
            "Catalog signing is not configured.",
          );
        const evidence = await this.#database.query<Row>(
          `SELECT v.*, e.findings, candidate.package_version,
                  candidate.runtime_version
           FROM local_model_versions v
         JOIN local_model_evaluations e ON e.id = v.evaluation_id
         JOIN local_model_candidates candidate ON candidate.id = v.candidate_id
         WHERE v.id = $1`,
          [versionId],
        );
        const row = evidence.rows[0];
        if (!row)
          throw new LanguageServiceNotFoundError(
            "Local-model version not found.",
          );
        if (Number(row.availability_version) !== request.expectedVersion) {
          throw new LanguageServiceConflictError(
            "Local-model availability is stale.",
          );
        }
        const findings = LocalModelEvaluationFindingSchema.array().safeParse(
          json(row.findings),
        );
        if (!findings.success)
          throw new LanguageServiceConflictError(
            "The model evaluation findings are invalid and cannot be approved.",
          );
        const hardFailure = findings.data.some(
          (finding) =>
            finding.class === "hard_safety" && finding.state === "fail",
        );
        if (
          hardFailure &&
          ["enabled", "enabled_by_override"].includes(request.state)
        ) {
          throw new LanguageServiceInvalidRequestError(
            "A hard-unsafe model cannot be enabled.",
          );
        }
        const advisory = findings.data.some(
          (finding) =>
            finding.class === "recommendation" &&
            finding.state === "not_recommended",
        );
        if (advisory && request.state === "enabled") {
          throw new LanguageServiceInvalidRequestError(
            "A not-recommended model requires an audited override.",
          );
        }
        if (!advisory && request.state === "enabled_by_override") {
          throw new LanguageServiceInvalidRequestError(
            "An override is only valid for recommendation findings.",
          );
        }
        const now = this.now().toISOString();
        if (["enabled", "enabled_by_override"].includes(request.state)) {
          const siblings = await this.#database.query<Row>(
            `SELECT id, availability_version FROM local_model_versions
           WHERE source_language = $1 AND target_language = $2 AND runtime_family = $3
             AND id <> $4 AND availability_state IN ('enabled', 'enabled_by_override')`,
            [
              row.source_language,
              row.target_language,
              row.runtime_family,
              versionId,
            ],
          );
          for (const sibling of siblings.rows) {
            await this.#database.query(
              `UPDATE local_model_versions SET availability_state = 'disabled',
               availability_version = availability_version + 1,
               availability_changed_at = $1, availability_changed_by = NULL,
               override_reason = NULL WHERE id = $2`,
              [now, sibling.id],
            );
            await this.#insertAvailabilityAudit(
              sibling.id as string,
              actor.userId,
              Number(sibling.availability_version),
              Number(sibling.availability_version) + 1,
              "disabled",
              "Automatically disabled when another version was activated.",
              now,
            );
          }
        }
        const updated = await this.#database.query<Row>(
          `UPDATE local_model_versions SET availability_state = $1,
           availability_version = availability_version + 1,
           availability_changed_at = $2,
           availability_changed_by = $3,
           override_reason = $4
         WHERE id = $5 AND availability_version = $6 RETURNING *`,
          [
            request.state,
            now,
            request.state === "enabled_by_override" ? actor.userId : null,
            request.state === "enabled_by_override"
              ? request.overrideReason
              : null,
            versionId,
            request.expectedVersion,
          ],
        );
        if (!updated.rows[0])
          throw new LanguageServiceConflictError(
            "Local-model availability is stale.",
          );
        await this.#insertAvailabilityAudit(
          versionId,
          actor.userId,
          request.expectedVersion,
          request.expectedVersion + 1,
          request.state,
          request.overrideReason ?? request.reason,
          now,
        );
        const release = await this.#publishCatalogRelease(now);
        return {
          version: mapLocalModelVersion({
            ...updated.rows[0],
            package_version: row.package_version,
            runtime_version: row.runtime_version,
          }),
          release,
        };
      },
    );
  }

  async getLocalModelCatalog(): Promise<
    SignedLocalModelCatalogRelease | undefined
  > {
    const result = await this.#database.query<Row>(
      `SELECT * FROM signed_local_model_catalog_releases ORDER BY sequence DESC LIMIT 1`,
    );
    if (!result.rows[0]) return undefined;
    return this.#mapRelease(result.rows[0]);
  }

  async getLocalModelArtifactSource(
    catalogReleaseId: string,
    versionId: string,
  ): Promise<LocalModelArtifactSource> {
    const result = await this.#database.query<Row>(
      `SELECT release.id AS catalog_release_id, version.id AS version_id,
              version.mirrored_artifact_id, version.artifact_sha256,
              version.artifact_byte_size
       FROM signed_local_model_catalog_releases release
       JOIN signed_local_model_catalog_release_versions release_version
         ON release_version.release_id = release.id
       JOIN local_model_versions version
         ON version.id = release_version.local_model_version_id
       WHERE release.id = $1 AND version.id = $2
         AND release.sequence = (
           SELECT MAX(sequence) FROM signed_local_model_catalog_releases
         )
         AND version.availability_state IN ('enabled', 'enabled_by_override')`,
      [catalogReleaseId, versionId],
    );
    const row = result.rows[0];
    if (!row)
      throw new LanguageServiceNotFoundError(
        "The model is not downloadable from the current signed catalog.",
      );
    return {
      catalogReleaseId: String(row.catalog_release_id),
      versionId: String(row.version_id),
      mirroredArtifactId: String(row.mirrored_artifact_id),
      artifactSha256: String(row.artifact_sha256),
      artifactByteSize: Number(row.artifact_byte_size),
    };
  }

  async #getAdminProvider(providerId: string): Promise<AdminCloudProvider> {
    const providers = await this.listAdminProviders();
    const provider = providers.find(
      (candidate) => candidate.descriptor.id === providerId,
    );
    if (!provider)
      throw new LanguageServiceNotFoundError(
        "Language-service provider not found.",
      );
    return provider;
  }

  async #throwMissingOrStaleProvider(providerId: string): Promise<never> {
    const result = await this.#database.query<Row>(
      `SELECT id FROM language_service_providers WHERE id = $1`,
      [providerId],
    );
    if (!result.rows[0])
      throw new LanguageServiceNotFoundError(
        "Language-service provider not found.",
      );
    throw new LanguageServiceConflictError(
      "Language-service provider configuration is stale.",
    );
  }

  async #getAccessRequest(id: string): Promise<CloudProviderAccessRequest> {
    const result = await this.#database.query<Row>(
      `SELECT * FROM cloud_provider_access_requests WHERE id = $1`,
      [id],
    );
    if (!result.rows[0])
      throw new LanguageServiceNotFoundError(
        "Provider access request not found.",
      );
    return mapAccessRequest(result.rows[0]);
  }

  async #insertModelOperation(
    actor: AuthenticatedActor,
    kind: "refresh_source" | "evaluate_candidate",
    idempotencyKey: string,
    reference: { sourceId: string } | { candidateId: string },
  ): Promise<LocalModelOperation> {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    await this.#database.query(
      `INSERT INTO local_model_operations
         (id, kind, source_id, candidate_id, state, version, idempotency_key,
          progress_percent, created_by, created_at)
       VALUES ($1, $2, $3, $4, 'queued', 1, $5, 0, $6, $7)`,
      [
        id,
        kind,
        "sourceId" in reference ? reference.sourceId : null,
        "candidateId" in reference ? reference.candidateId : null,
        idempotencyKey,
        actor.userId,
        createdAt,
      ],
    );
    return LocalModelOperationSchema.parse({
      id,
      kind,
      ...reference,
      state: "queued",
      version: 1,
      idempotencyKey,
      progressPercent: 0,
      createdBy: actor.userId,
      createdAt,
    });
  }

  async #insertAvailabilityAudit(
    versionId: string,
    actorId: string,
    priorVersion: number,
    nextVersion: number,
    state: string,
    reason: string,
    changedAt: string,
  ) {
    await this.#database.query(
      `INSERT INTO local_model_availability_audits
         (id, local_model_version_id, actor_id, prior_version, next_version, state, reason, changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        versionId,
        actorId,
        priorVersion,
        nextVersion,
        state,
        reason,
        changedAt,
      ],
    );
  }

  async #publishCatalogRelease(
    publishedAt: string,
  ): Promise<SignedLocalModelCatalogRelease> {
    if (!this.signer)
      throw new LanguageServiceConflictError(
        "Catalog signing is not configured.",
      );
    const versions = await this.listLocalModelVersions();
    const enabled = versions.filter((version) =>
      ["enabled", "enabled_by_override"].includes(version.availability.state),
    );
    const revokedVersionIds = versions
      .filter((version) => version.availability.state === "revoked")
      .map((version) => version.id);
    const sequenceResult = await this.#database.query<Row>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM signed_local_model_catalog_releases`,
    );
    const sequence = Number(sequenceResult.rows[0]?.next_sequence ?? 1);
    const expiresAt = new Date(
      Date.parse(publishedAt) + 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const payload = {
      contractVersion: 1 as const,
      sequence,
      publishedAt,
      expiresAt,
      versions: enabled,
      revokedVersionIds,
    };
    const canonical = canonicalJson(payload);
    const catalogSha256 = sha256(canonical);
    const signatureBase64 = await this.signer.sign(
      new TextEncoder().encode(canonical),
    );
    const id = randomUUID();
    await this.#database.query(
      `INSERT INTO signed_local_model_catalog_releases
         (id, sequence, catalog_sha256, signing_key_id, signature_base64, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        sequence,
        catalogSha256,
        this.signer.keyId,
        signatureBase64,
        publishedAt,
      ],
    );
    for (const version of enabled) {
      await this.#database.query(
        `INSERT INTO signed_local_model_catalog_release_versions
           (release_id, local_model_version_id) VALUES ($1, $2)`,
        [id, version.id],
      );
    }
    for (const revokedVersionId of revokedVersionIds) {
      await this.#database.query(
        `INSERT INTO signed_local_model_catalog_release_revocations
           (release_id, local_model_version_id) VALUES ($1, $2)`,
        [id, revokedVersionId],
      );
    }
    return SignedLocalModelCatalogReleaseSchema.parse({
      contractVersion: 1,
      id,
      sequence,
      catalogSha256,
      signingKeyId: this.signer.keyId,
      signatureBase64,
      publishedAt,
      expiresAt,
      canonicalPayload: canonical,
      versions: enabled,
      revokedVersionIds,
    });
  }

  async #mapRelease(row: Row): Promise<SignedLocalModelCatalogRelease> {
    const versions = await this.#database.query<Row>(
      `SELECT v.*, candidate.package_version, candidate.runtime_version
       FROM local_model_versions v
       JOIN signed_local_model_catalog_release_versions rv
         ON rv.local_model_version_id = v.id
       JOIN local_model_candidates candidate ON candidate.id = v.candidate_id
       WHERE rv.release_id = $1 ORDER BY v.source_language, v.target_language`,
      [row.id],
    );
    const revocations = await this.#database.query<Row>(
      `SELECT local_model_version_id
       FROM signed_local_model_catalog_release_revocations
       WHERE release_id = $1 ORDER BY local_model_version_id`,
      [row.id],
    );
    const publishedAt = iso(row.published_at);
    const expiresAt = new Date(
      Date.parse(publishedAt) + 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const payload = {
      contractVersion: 1 as const,
      sequence: Number(row.sequence),
      publishedAt,
      expiresAt,
      versions: versions.rows.map(mapLocalModelVersion),
      revokedVersionIds: revocations.rows.map(
        (revocation) => revocation.local_model_version_id,
      ),
    };
    const canonicalPayload = canonicalJson(payload);
    if (sha256(canonicalPayload) !== row.catalog_sha256)
      throw new LanguageServiceConflictError(
        "The persisted catalog release no longer matches its signed payload.",
      );
    return SignedLocalModelCatalogReleaseSchema.parse({
      contractVersion: 1,
      id: row.id,
      sequence: Number(row.sequence),
      catalogSha256: row.catalog_sha256,
      signingKeyId: row.signing_key_id,
      signatureBase64: row.signature_base64,
      publishedAt,
      expiresAt,
      canonicalPayload,
      versions: payload.versions,
      revokedVersionIds: payload.revokedVersionIds,
    });
  }

  async #mutate<Result>(
    actor: AuthenticatedActor,
    commandType: string,
    idempotencyKey: string,
    request: unknown,
    action: () => Promise<Result>,
  ): Promise<Result> {
    return this.#database.transaction(async () => {
      const requestSha256 = sha256(canonicalJson(request));
      const replay = await this.#database.query<Row>(
        `SELECT request_sha256, response_json FROM language_service_command_receipts
         WHERE actor_id = $1 AND command_type = $2 AND idempotency_key = $3`,
        [actor.userId, commandType, idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_sha256 !== requestSha256) {
          throw new LanguageServiceIdempotencyError(
            "That idempotency key was already used for different input.",
          );
        }
        return json(replay.rows[0].response_json) as Result;
      }
      const result = await action();
      await this.#database.query(
        `INSERT INTO language_service_command_receipts
           (id, actor_id, command_type, idempotency_key, request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          actor.userId,
          commandType,
          idempotencyKey,
          requestSha256,
          JSON.stringify(result ?? null),
          this.now().toISOString(),
        ],
      );
      return result;
    });
  }
}

function mapProviderDescriptor(row: Row): CloudProviderDescriptor {
  return CloudProviderDescriptorSchema.parse({
    id: row.id,
    service: row.service,
    displayName: row.display_name,
    adapterContractVersion: Number(row.adapter_contract_version),
    configurationRevision: row.configuration_revision,
    capabilityRevision: row.capability_revision,
    supportedLanguages: json(row.supported_languages),
    inputModes: json(row.input_modes),
    disclosure: json(row.disclosure),
    pricing: json(row.pricing),
    state: row.state,
  });
}

function mapAccessRequest(row: Row): CloudProviderAccessRequest {
  return CloudProviderAccessRequestSchema.parse({
    id: row.id,
    providerId: row.provider_id,
    service: row.service,
    accountId: row.account_id,
    disclosureVersion: Number(row.disclosure_version),
    consentAcceptedAt: iso(row.consent_accepted_at),
    state: row.state,
    ...(row.decision_by ? { decisionBy: row.decision_by } : {}),
    ...(row.decision_at ? { decisionAt: iso(row.decision_at) } : {}),
    ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapLocalModelSource(row: Row): LocalModelSource {
  return LocalModelSourceSchema.parse({
    id: row.id,
    adapter: row.adapter,
    sourceUrl: row.source_url,
    state: row.state,
    refreshIntervalHours: Number(row.refresh_interval_hours),
    version: Number(row.version),
  });
}

function mapLocalModelCandidate(row: Row): LocalModelCandidate {
  return LocalModelCandidateSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    feedSnapshotId: row.feed_snapshot_id,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    packageVersion: row.package_version,
    runtimeFamily: row.runtime_family,
    runtimeVersion: row.runtime_version,
    artifactUrl: row.artifact_url,
    rawEntry: json(row.raw_entry),
    rawEntrySha256: row.raw_entry_sha256,
    rawEntryArtifactId: row.raw_entry_artifact_id,
    version: Number(row.version),
    state: row.state,
    discoveredAt: iso(row.discovered_at),
  });
}

function mapLocalModelVersion(row: Row): LocalModelVersion {
  return LocalModelVersionSchema.parse({
    id: row.id,
    candidateId: row.candidate_id,
    evaluationId: row.evaluation_id,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    packageVersion: row.package_version,
    runtimeFamily: row.runtime_family,
    runtimeVersion: row.runtime_version,
    artifactSha256: row.artifact_sha256,
    artifactByteSize: Number(row.artifact_byte_size),
    mirroredArtifactId: row.mirrored_artifact_id,
    availability: {
      state: row.availability_state,
      version: Number(row.availability_version),
      changedAt: iso(row.availability_changed_at),
      ...(row.availability_changed_by
        ? { changedBy: row.availability_changed_by }
        : {}),
      ...(row.override_reason ? { overrideReason: row.override_reason } : {}),
    },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function json(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (("code" in error && (error as { code?: string }).code === "23505") ||
      ("message" in error &&
        /unique|duplicate/i.test(
          String((error as { message?: unknown }).message),
        ))),
  );
}
