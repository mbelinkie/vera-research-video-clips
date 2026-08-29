import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthenticatedActor,
  CloudProviderDescriptor,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";

import {
  LanguageServiceConflictError,
  LanguageServiceControlPlane,
  LanguageServiceIdempotencyError,
} from "./language-services.ts";

const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

function descriptor(
  id: string,
  service: "translation" | "transcription" = "translation",
): CloudProviderDescriptor {
  return {
    id,
    service,
    displayName: `Fixture ${service}`,
    adapterContractVersion: 1,
    configurationRevision: "fixture-config-1",
    capabilityRevision: "fixture-capabilities-1",
    supportedLanguages: [
      {
        language: "en",
        roles: ["source", "target"],
        supportsAutoDetection: false,
      },
    ],
    inputModes: service === "translation" ? ["text_segments"] : ["object_uri"],
    disclosure: {
      version: 1,
      title: "Fixture disclosure",
      summary: "Fixture data is transferred only after explicit consent.",
      dataCategories:
        service === "translation" ? ["transcript_text"] : ["audio_media"],
      publishedAt: "2026-08-26T12:00:00.000Z",
    },
    pricing: {
      currency: "USD",
      unit: service === "translation" ? "characters" : "audio_seconds",
      amountMicros: 15_000_000,
      quantity: 1_000_000,
      effectiveAt: "2026-08-26T12:00:00.000Z",
    },
    state: "enabled",
  };
}

async function fixture() {
  const database = new PGlite();
  databases.add(database);
  await runCloudMigrations(database);
  const admin = await insertActor(database, "admin");
  const user = await insertActor(database, "user");
  const catalog = new LanguageServiceControlPlane(
    database,
    () => new Date("2026-08-26T15:00:00.000Z"),
    {
      keyId: "fixture-catalog-key",
      sign: async (payload) => Buffer.from(payload).toString("base64"),
    },
  );
  return { admin, catalog, database, user };
}

async function insertActor(
  database: PGlite,
  name: string,
): Promise<AuthenticatedActor> {
  const userId = randomUUID();
  await database.query(
    `INSERT INTO users
       (id, external_subject, handle, normalized_handle, display_name,
        created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, now(), now())`,
    [userId, `fixture:${name}`, `fixture_${name}`, `Fixture ${name}`],
  );
  return { userId, externalSubject: `fixture:${name}` };
}

describe("language-service control plane", () => {
  it("discovers deployed adapters as draft and never enables one implicitly", async () => {
    const { catalog } = await fixture();
    await catalog.synchronizeDeployedProviders([
      descriptor("fixture-translate"),
      descriptor("fixture-transcribe", "transcription"),
    ]);

    await expect(catalog.listEnabledProviders()).resolves.toEqual([]);
    await expect(catalog.listAdminProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: expect.objectContaining({
            id: "fixture-translate",
            state: "draft",
          }),
          recommended: false,
          version: 1,
        }),
      ]),
    );
  });

  it("keeps consent, approval, and launch grants provider-specific", async () => {
    const { admin, catalog, database, user } = await fixture();
    await catalog.synchronizeDeployedProviders([
      descriptor("fixture-translate"),
      descriptor("second-translate"),
    ]);
    for (const [index, providerId] of [
      "fixture-translate",
      "second-translate",
    ].entries()) {
      await catalog.updateProviderState(admin, providerId, {
        state: "enabled",
        expectedVersion: 1,
        idempotencyKey: `enable-${index}`,
      });
    }

    const access = await catalog.requestProviderAccess(user, {
      providerId: "fixture-translate",
      service: "translation",
      disclosureVersion: 1,
      consentAccepted: true,
      idempotencyKey: "request-fixture",
    });
    const approved = await catalog.decideProviderAccess(admin, access.id, {
      action: "approve",
      expectedVersion: 1,
      idempotencyKey: "approve-fixture",
    });
    await expect(
      catalog.issueLaunchGrant(user, {
        providerId: "second-translate",
        service: "translation",
        accessRequestId: approved.id,
        expectedAccessVersion: approved.version,
        idempotencyKey: "wrong-provider",
      }),
    ).rejects.toThrow("provider-specific");

    const grant = await catalog.issueLaunchGrant(user, {
      providerId: "fixture-translate",
      service: "translation",
      accessRequestId: approved.id,
      expectedAccessVersion: approved.version,
      idempotencyKey: "right-provider",
    });
    expect(grant.grantReference).toMatch(/^lsg_[A-Za-z0-9_-]+$/u);
    const stored = await database.query<{
      grant_reference_sha256: string;
    }>("SELECT grant_reference_sha256 FROM cloud_provider_launch_grants");
    expect(stored.rows[0]?.grant_reference_sha256).toHaveLength(64);
    expect(stored.rows[0]?.grant_reference_sha256).not.toContain(
      grant.grantReference,
    );
  });

  it("stores an account preference only for its exact approved provider and clears it optimistically", async () => {
    const { admin, catalog, user } = await fixture();
    await catalog.synchronizeDeployedProviders([
      descriptor("fixture-translate"),
      descriptor("second-translate"),
    ]);
    for (const [index, providerId] of [
      "fixture-translate",
      "second-translate",
    ].entries()) {
      await catalog.updateProviderState(admin, providerId, {
        state: "enabled",
        expectedVersion: 1,
        idempotencyKey: `enable-preference-${index}`,
      });
    }
    const requested = await catalog.requestProviderAccess(user, {
      providerId: "fixture-translate",
      service: "translation",
      disclosureVersion: 1,
      consentAccepted: true,
      idempotencyKey: "request-preference",
    });
    const approved = await catalog.decideProviderAccess(admin, requested.id, {
      action: "approve",
      expectedVersion: 1,
      idempotencyKey: "approve-preference",
    });

    await expect(
      catalog.updateAccountProviderPreference(user, "translation", {
        providerId: "second-translate",
        accessRequestId: approved.id,
        expectedVersion: 0,
        idempotencyKey: "wrong-preference-provider",
      }),
    ).rejects.toThrow(/approved/iu);
    const preference = await catalog.updateAccountProviderPreference(
      user,
      "translation",
      {
        providerId: "fixture-translate",
        accessRequestId: approved.id,
        expectedVersion: 0,
        idempotencyKey: "create-preference",
      },
    );
    expect(preference).toMatchObject({
      service: "translation",
      providerId: "fixture-translate",
      accessRequestId: approved.id,
      version: 1,
    });
    await expect(catalog.getAccountProviderPreferences(user)).resolves.toEqual([
      preference,
    ]);
    await catalog.clearAccountProviderPreference(user, "translation", {
      expectedVersion: 1,
      idempotencyKey: "clear-preference",
    });
    await expect(catalog.getAccountProviderPreferences(user)).resolves.toEqual(
      [],
    );
  });

  it("replays identical mutations and rejects a changed idempotent command", async () => {
    const { admin, catalog } = await fixture();
    await catalog.synchronizeDeployedProviders([
      descriptor("fixture-translate"),
    ]);
    const request = {
      state: "enabled" as const,
      expectedVersion: 1,
      idempotencyKey: "provider-state",
    };
    const first = await catalog.updateProviderState(
      admin,
      "fixture-translate",
      request,
    );
    await expect(
      catalog.updateProviderState(admin, "fixture-translate", request),
    ).resolves.toEqual(first);
    await expect(
      catalog.updateProviderState(admin, "fixture-translate", {
        ...request,
        state: "disabled",
      }),
    ).rejects.toBeInstanceOf(LanguageServiceIdempotencyError);
  });

  it("records durable provider attempts, cleanup, and priced usage", async () => {
    const { admin, catalog, database, user } = await fixture();
    await catalog.synchronizeDeployedProviders([
      descriptor("fixture-translate"),
    ]);
    await catalog.updateProviderState(admin, "fixture-translate", {
      state: "enabled",
      expectedVersion: 1,
      idempotencyKey: "enable-operation-provider",
    });
    const access = await catalog.requestProviderAccess(user, {
      providerId: "fixture-translate",
      service: "translation",
      disclosureVersion: 1,
      consentAccepted: true,
      idempotencyKey: "request-operation-provider",
    });
    const approved = await catalog.decideProviderAccess(admin, access.id, {
      action: "approve",
      expectedVersion: 1,
      idempotencyKey: "approve-operation-provider",
    });
    const grant = await catalog.issueLaunchGrant(user, {
      providerId: "fixture-translate",
      service: "translation",
      accessRequestId: approved.id,
      expectedAccessVersion: approved.version,
      idempotencyKey: "grant-operation-provider",
    });
    const operationId = randomUUID();
    await catalog.beginProviderOperation({
      operationId,
      providerId: "fixture-translate",
      service: "translation",
      grantId: grant.id,
      attempt: 1,
      policySnapshot: {
        schemaVersion: 1,
        execution: "cloud",
        providerId: "fixture-translate",
        fallback: "local",
      },
      inputMode: "text_segments",
    });
    await catalog.finishProviderOperation({
      operationId,
      attempt: 1,
      state: "succeeded",
      cleanup: "completed",
      quantity: 250,
    });

    await expect(catalog.listUsage()).resolves.toEqual([
      expect.objectContaining({
        providerId: "fixture-translate",
        operationId,
        quantity: 250,
      }),
    ]);
    const stored = await database.query<{
      state: string;
      cleanup_state: string;
    }>(
      "SELECT state, cleanup_state FROM cloud_provider_operations WHERE id = $1",
      [operationId],
    );
    expect(stored.rows[0]).toEqual({
      state: "succeeded",
      cleanup_state: "completed",
    });
  });

  it("requires an audited override for a hard-safe model with recommendation findings", async () => {
    const { admin, catalog, database } = await fixture();
    const snapshotId = randomUUID();
    const candidateId = randomUUID();
    const evaluationId = randomUUID();
    const versionId = randomUUID();
    await database.query(
      `INSERT INTO local_model_sources
         (id, adapter, source_url, state, refresh_interval_hours)
       VALUES ('argos-package-index', 'argos-package-index',
               'https://example.test/index.json', 'enabled', 24)`,
    );
    await database.query(
      `INSERT INTO local_model_feed_snapshots
         (id, source_id, source_url, feed_sha256, raw_feed_artifact_id,
          raw_feed_byte_size, fetched_at, additions, changes, removals)
       VALUES ($1, 'argos-package-index', 'https://example.test/index.json',
               $2, 'language-model/raw-feed/fixture', 10, now(), 1, 0, 0)`,
      [snapshotId, "1".repeat(64)],
    );
    await database.query(
      `INSERT INTO local_model_candidates
         (id, source_id, feed_snapshot_id, source_language, target_language,
          package_version, runtime_family, runtime_version, artifact_url,
          raw_entry, raw_entry_sha256, raw_entry_artifact_id, state, discovered_at)
       VALUES ($1, 'argos-package-index', $2, 'es', 'en', '1.0',
               'argos-translate', '1.9', 'https://example.test/model.argosmodel',
               '{}', $3, 'language-model/raw-candidate/fixture', 'evaluated', now())`,
      [candidateId, snapshotId, "2".repeat(64)],
    );
    await database.query(
      `INSERT INTO local_model_evaluations
         (id, candidate_id, revision, evaluation_schema_version, evaluated_by,
          raw_evidence_artifact_ids, byte_size, artifact_sha256, archive_format,
          archive_manifest, license_evidence, attribution_evidence,
          training_provenance_evidence, quality_results,
          compatible_runtime_versions, compatible_platforms, findings, evaluated_at)
       VALUES ($1, $2, 1, 1, $3, '["evidence"]', 512, $4,
               'argosmodel', '{}', '["license not found"]', '["unknown"]',
               '["unknown"]', '{"recommendation":"not_recommended"}',
               '["1.9"]', '["desktop"]', $5, now())`,
      [
        evaluationId,
        candidateId,
        admin.userId,
        "3".repeat(64),
        JSON.stringify([
          {
            code: "missing_license",
            class: "recommendation",
            state: "not_recommended",
            message: "No package license evidence was found.",
          },
        ]),
      ],
    );
    await database.query(
      `INSERT INTO local_model_versions
         (id, candidate_id, evaluation_id, source_language, target_language,
          runtime_family, artifact_sha256, artifact_byte_size,
          mirrored_artifact_id)
       VALUES ($1, $2, $3, 'es', 'en', 'argos-translate', $4, 512,
               'language-model/artifact/fixture')`,
      [versionId, candidateId, evaluationId, "3".repeat(64)],
    );

    await expect(
      catalog.updateLocalModelAvailability(admin, versionId, {
        state: "enabled",
        expectedVersion: 1,
        reason: "Enable reviewed model.",
        idempotencyKey: "unsafe-normal-enable",
      }),
    ).rejects.toThrow("requires an audited override");
    const enabled = await catalog.updateLocalModelAvailability(
      admin,
      versionId,
      {
        state: "enabled_by_override",
        expectedVersion: 1,
        reason: "Enable after independent review.",
        overrideReason:
          "The platform administrator verified licensing evidence separately.",
        idempotencyKey: "audited-model-override",
      },
    );
    expect(enabled.version.availability).toMatchObject({
      state: "enabled_by_override",
      changedBy: admin.userId,
    });
    const audit = await database.query<{ reason: string }>(
      `SELECT reason FROM local_model_availability_audits
       WHERE local_model_version_id = $1 ORDER BY changed_at DESC LIMIT 1`,
      [versionId],
    );
    expect(audit.rows[0]?.reason).toContain("verified licensing");
    await expect(
      catalog.getLocalModelArtifactSource(enabled.release.id, versionId),
    ).resolves.toMatchObject({
      catalogReleaseId: enabled.release.id,
      versionId,
      mirroredArtifactId: "language-model/artifact/fixture",
      artifactSha256: "3".repeat(64),
      artifactByteSize: 512,
    });
    await catalog.updateLocalModelAvailability(admin, versionId, {
      state: "disabled",
      expectedVersion: 2,
      reason: "Pause new downloads while retaining verified local bytes.",
      idempotencyKey: "disable-model-version",
    });
    await expect(
      catalog.getLocalModelArtifactSource(enabled.release.id, versionId),
    ).rejects.toThrow("current signed catalog");
  });

  it("blocks new grants as soon as a provider is suspended", async () => {
    const { admin, catalog, user } = await fixture();
    await catalog.synchronizeDeployedProviders([
      descriptor("fixture-translate"),
    ]);
    await catalog.updateProviderState(admin, "fixture-translate", {
      state: "enabled",
      expectedVersion: 1,
      idempotencyKey: "enable",
    });
    const access = await catalog.requestProviderAccess(user, {
      providerId: "fixture-translate",
      service: "translation",
      disclosureVersion: 1,
      consentAccepted: true,
      idempotencyKey: "request",
    });
    await catalog.decideProviderAccess(admin, access.id, {
      action: "approve",
      expectedVersion: 1,
      idempotencyKey: "approve",
    });
    await catalog.updateProviderState(admin, "fixture-translate", {
      state: "suspended",
      expectedVersion: 2,
      idempotencyKey: "suspend",
    });
    await expect(
      catalog.issueLaunchGrant(user, {
        providerId: "fixture-translate",
        service: "translation",
        accessRequestId: access.id,
        expectedAccessVersion: 2,
        idempotencyKey: "grant-after-suspend",
      }),
    ).rejects.toBeInstanceOf(LanguageServiceConflictError);
  });
});
