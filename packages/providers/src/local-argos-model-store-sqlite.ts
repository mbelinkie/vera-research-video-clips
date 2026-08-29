import type { DatabaseSync } from "node:sqlite";

import type { SignedCatalogRelease } from "./local-model-argos-catalog.ts";
import type {
  CachedArgosCatalog,
  LocalArgosInstallation,
  LocalArgosLease,
  LocalArgosModelStore,
} from "./local-argos-model-manager.ts";

type CatalogRow = {
  release_id: string;
  catalog_sha256: string;
  signing_key_id: string;
  signature_base64: string;
  descriptor_json: string;
};

type InstallationRow = {
  local_model_version_id: string;
  source_language: string;
  target_language: string;
  runtime_family: string;
  artifact_sha256: string;
  artifact_byte_size: number;
  install_state: LocalArgosInstallation["state"];
  installed_at: string | null;
  verified_at: string | null;
  deletion_requested_at: string | null;
  deleted_at: string | null;
};

type LeaseRow = {
  local_model_version_id: string;
  lease_id: string;
  holder_id: string;
  acquired_at: string;
  expires_at: string;
};

/**
 * Durable implementation of the Argos model-manager store over local migration
 * 0036. The caller owns migrations and supplies an already-open local database.
 * Catalog releases remain immutable by ID; the cached expiry metadata is the
 * only refreshable part of an exact release record.
 */
export class SqliteLocalArgosModelStore implements LocalArgosModelStore {
  constructor(private readonly database: DatabaseSync) {}

  async readCatalog(): Promise<CachedArgosCatalog | undefined> {
    const row = this.database
      .prepare(
        `SELECT release_id, catalog_sha256, signing_key_id, signature_base64,
                descriptor_json
           FROM local_model_catalog_releases
          ORDER BY sequence DESC
          LIMIT 1`,
      )
      .get() as CatalogRow | undefined;
    if (!row) return undefined;

    const cached = parseCachedCatalog(row.descriptor_json);
    if (
      cached.release.id !== row.release_id ||
      cached.release.keyId !== row.signing_key_id ||
      cached.release.signature !== row.signature_base64 ||
      sha256(cached.release.canonicalPayload) !== row.catalog_sha256
    ) {
      throw new SqliteLocalArgosModelStoreError(
        "The persisted Argos catalog release is internally inconsistent.",
      );
    }
    return cached;
  }

  async writeCatalog(catalog: CachedArgosCatalog): Promise<void> {
    const encoded = encodeCachedCatalog(catalog);
    const now = catalog.cachedAt;
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.database
        .prepare(
          `SELECT catalog_sha256, signing_key_id, signature_base64
             FROM local_model_catalog_releases WHERE release_id = ?`,
        )
        .get(catalog.release.id) as
        | {
            catalog_sha256: string;
            signing_key_id: string;
            signature_base64: string;
          }
        | undefined;
      if (
        existing &&
        (existing.catalog_sha256 !== sha256(catalog.release.canonicalPayload) ||
          existing.signing_key_id !== catalog.release.keyId ||
          existing.signature_base64 !== catalog.release.signature)
      ) {
        throw new SqliteLocalArgosModelStoreError(
          "A persisted Argos release ID cannot be reused with different signed bytes.",
        );
      }
      const nextSequence = existing
        ? undefined
        : (
            this.database
              .prepare(
                "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM local_model_catalog_releases",
              )
              .get() as { sequence: number }
          ).sequence;
      if (existing) {
        this.database
          .prepare(
            `UPDATE local_model_catalog_releases
                SET descriptor_json = ?, verified_at = ?
              WHERE release_id = ?`,
          )
          .run(encoded, now, catalog.release.id);
      } else {
        this.database
          .prepare(
            `INSERT INTO local_model_catalog_releases (
               release_id, sequence, catalog_sha256, signing_key_id,
               signature_base64, descriptor_json, verified_at, published_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            catalog.release.id,
            nextSequence!,
            sha256(catalog.release.canonicalPayload),
            catalog.release.keyId,
            catalog.release.signature,
            encoded,
            now,
            now,
          );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async getInstallation(
    modelId: string,
  ): Promise<LocalArgosInstallation | undefined> {
    const row = this.database
      .prepare(
        `SELECT local_model_version_id, source_language, target_language,
                runtime_family, artifact_sha256, artifact_byte_size,
                install_state, installed_at, verified_at, deletion_requested_at,
                deleted_at
           FROM local_model_installations
          WHERE local_model_version_id = ?`,
      )
      .get(requireText(modelId, "Model ID")) as InstallationRow | undefined;
    return row && mapInstallation(row);
  }

  async putInstallation(installation: LocalArgosInstallation): Promise<void> {
    assertInstallation(installation);
    this.database
      .prepare(
        `INSERT INTO local_model_installations (
           local_model_version_id, source_language, target_language,
           runtime_family, artifact_sha256, artifact_byte_size, install_state,
           installed_at, verified_at, deletion_requested_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (local_model_version_id) DO UPDATE SET
           source_language = excluded.source_language,
           target_language = excluded.target_language,
           runtime_family = excluded.runtime_family,
           artifact_sha256 = excluded.artifact_sha256,
           artifact_byte_size = excluded.artifact_byte_size,
           install_state = excluded.install_state,
           installed_at = excluded.installed_at,
           verified_at = excluded.verified_at,
           deletion_requested_at = excluded.deletion_requested_at,
           deleted_at = excluded.deleted_at`,
      )
      .run(
        installation.modelId,
        installation.sourceLanguage,
        installation.targetLanguage,
        installation.runtimeFamily,
        installation.artifactSha256,
        installation.byteSize,
        installation.state,
        installation.installedAt ?? null,
        installation.verifiedAt ?? null,
        installation.deletionRequestedAt ?? null,
        installation.deletedAt ?? null,
      );
  }

  async listInstallations(): Promise<readonly LocalArgosInstallation[]> {
    return (
      this.database
        .prepare(
          `SELECT local_model_version_id, source_language, target_language,
                  runtime_family, artifact_sha256, artifact_byte_size,
                  install_state, installed_at, verified_at,
                  deletion_requested_at, deleted_at
             FROM local_model_installations
            ORDER BY local_model_version_id`,
        )
        .all() as InstallationRow[]
    ).map(mapInstallation);
  }

  async createLease(lease: LocalArgosLease): Promise<void> {
    assertLease(lease);
    this.database
      .prepare(
        `INSERT INTO local_model_leases (
           local_model_version_id, lease_id, holder_id, acquired_at, expires_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (local_model_version_id, lease_id) DO NOTHING`,
      )
      .run(
        lease.modelId,
        lease.leaseId,
        lease.holderId,
        lease.acquiredAt,
        lease.expiresAt,
      );
    const persisted = this.database
      .prepare(
        `SELECT local_model_version_id, lease_id, holder_id, acquired_at,
                expires_at
           FROM local_model_leases
          WHERE local_model_version_id = ? AND lease_id = ?`,
      )
      .get(lease.modelId, lease.leaseId) as LeaseRow | undefined;
    if (
      !persisted ||
      persisted.holder_id !== lease.holderId ||
      persisted.acquired_at !== lease.acquiredAt ||
      persisted.expires_at !== lease.expiresAt
    ) {
      throw new SqliteLocalArgosModelStoreError(
        "A persisted Argos lease ID cannot be reused with different ownership evidence.",
      );
    }
  }

  async removeLease(modelId: string, leaseId: string): Promise<void> {
    this.database
      .prepare(
        `DELETE FROM local_model_leases
          WHERE local_model_version_id = ? AND lease_id = ?`,
      )
      .run(requireText(modelId, "Model ID"), requireText(leaseId, "Lease ID"));
  }

  async listLeases(modelId: string): Promise<readonly LocalArgosLease[]> {
    return (
      this.database
        .prepare(
          `SELECT local_model_version_id, lease_id, holder_id, acquired_at,
                  expires_at
             FROM local_model_leases
            WHERE local_model_version_id = ?
            ORDER BY expires_at, lease_id`,
        )
        .all(requireText(modelId, "Model ID")) as LeaseRow[]
    ).map(mapLease);
  }

  async removeExpiredLeases(now: string): Promise<void> {
    this.database
      .prepare("DELETE FROM local_model_leases WHERE expires_at <= ?")
      .run(requireTimestamp(now, "Lease cleanup timestamp"));
  }
}

export class SqliteLocalArgosModelStoreError extends Error {}

function encodeCachedCatalog(catalog: CachedArgosCatalog): string {
  const encoded = JSON.stringify(catalog);
  return JSON.stringify(parseCachedCatalog(encoded));
}

function parseCachedCatalog(value: string): CachedArgosCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SqliteLocalArgosModelStoreError(
      "Persisted Argos catalog JSON is invalid.",
    );
  }
  if (
    !isRecord(parsed) ||
    !isTimestamp(parsed.cachedAt) ||
    !isTimestamp(parsed.expiresAt)
  ) {
    throw new SqliteLocalArgosModelStoreError(
      "Persisted Argos catalog cache times are invalid.",
    );
  }
  if (Date.parse(parsed.expiresAt) <= Date.parse(parsed.cachedAt)) {
    throw new SqliteLocalArgosModelStoreError(
      "Persisted Argos catalog expiry is invalid.",
    );
  }
  const release = parseRelease(parsed.release);
  return { release, cachedAt: parsed.cachedAt, expiresAt: parsed.expiresAt };
}

function parseRelease(value: unknown): SignedCatalogRelease {
  if (!isRecord(value) || !isRecord(value.payload)) {
    throw new SqliteLocalArgosModelStoreError(
      "Persisted Argos release is invalid.",
    );
  }
  const payload = value.payload;
  if (
    !isText(value.id) ||
    !isText(value.canonicalPayload) ||
    !isText(value.keyId) ||
    !isText(value.signature) ||
    payload.contractVersion !== 1 ||
    typeof payload.catalogRevision !== "number" ||
    !Number.isSafeInteger(payload.catalogRevision) ||
    payload.catalogRevision <= 0 ||
    !Array.isArray(payload.models) ||
    !payload.models.every(isReleaseModel) ||
    (payload.revokedModelIds !== undefined &&
      (!Array.isArray(payload.revokedModelIds) ||
        !payload.revokedModelIds.every(isText)))
  ) {
    throw new SqliteLocalArgosModelStoreError(
      "Persisted Argos release is invalid.",
    );
  }
  const signedPayload = value.signedPayload;
  const catalogSha256 = value.catalogSha256;
  if (
    (signedPayload !== undefined || catalogSha256 !== undefined) &&
    (signedPayload === undefined ||
      typeof catalogSha256 !== "string" ||
      !isSha256(catalogSha256))
  ) {
    throw new SqliteLocalArgosModelStoreError(
      "Persisted Argos cloud release evidence is invalid.",
    );
  }
  const release: SignedCatalogRelease = {
    id: value.id,
    canonicalPayload: value.canonicalPayload,
    keyId: value.keyId,
    signature: value.signature,
    payload: {
      contractVersion: 1,
      catalogRevision: payload.catalogRevision,
      models: payload.models,
      ...(payload.revokedModelIds
        ? { revokedModelIds: payload.revokedModelIds }
        : {}),
    },
  };
  return signedPayload === undefined
    ? release
    : { ...release, signedPayload, catalogSha256: catalogSha256 as string };
}

function isReleaseModel(
  value: unknown,
): value is SignedCatalogRelease["payload"]["models"][number] {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.sourceLanguage) &&
    isText(value.targetLanguage) &&
    isText(value.packageVersion) &&
    isText(value.runtimeFamily) &&
    (value.runtimeVersion === undefined || isText(value.runtimeVersion)) &&
    isSha256(value.artifactSha256) &&
    typeof value.byteSize === "number" &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    (value.availability === "enabled" ||
      value.availability === "enabled_by_override")
  );
}

function assertInstallation(installation: LocalArgosInstallation): void {
  requireText(installation.modelId, "Model ID");
  requireText(installation.sourceLanguage, "Source language");
  requireText(installation.targetLanguage, "Target language");
  requireText(installation.runtimeFamily, "Runtime family");
  if (
    !isSha256(installation.artifactSha256) ||
    !Number.isSafeInteger(installation.byteSize) ||
    installation.byteSize <= 0
  ) {
    throw new SqliteLocalArgosModelStoreError(
      "Argos installation artifact evidence is invalid.",
    );
  }
  for (const [label, value] of [
    ["Installation timestamp", installation.installedAt],
    ["Verification timestamp", installation.verifiedAt],
    ["Deletion request timestamp", installation.deletionRequestedAt],
    ["Deletion timestamp", installation.deletedAt],
  ] as const) {
    if (value !== undefined) requireTimestamp(value, label);
  }
  if (
    installation.state === "active" &&
    (!installation.installedAt || !installation.verifiedAt)
  ) {
    throw new SqliteLocalArgosModelStoreError(
      "Active Argos installations require verification evidence.",
    );
  }
  if (installation.state === "deleted" && !installation.deletedAt) {
    throw new SqliteLocalArgosModelStoreError(
      "Deleted Argos installations require deletion evidence.",
    );
  }
}

function assertLease(lease: LocalArgosLease): void {
  requireText(lease.modelId, "Model ID");
  requireText(lease.leaseId, "Lease ID");
  requireText(lease.holderId, "Lease holder ID");
  requireTimestamp(lease.acquiredAt, "Lease acquisition timestamp");
  requireTimestamp(lease.expiresAt, "Lease expiry timestamp");
  if (Date.parse(lease.expiresAt) <= Date.parse(lease.acquiredAt)) {
    throw new SqliteLocalArgosModelStoreError(
      "Argos lease expiry must be after acquisition.",
    );
  }
}

function mapInstallation(row: InstallationRow): LocalArgosInstallation {
  return {
    modelId: row.local_model_version_id,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    runtimeFamily: row.runtime_family,
    artifactSha256: row.artifact_sha256,
    byteSize: row.artifact_byte_size,
    state: row.install_state,
    ...(row.installed_at ? { installedAt: row.installed_at } : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    ...(row.deletion_requested_at
      ? { deletionRequestedAt: row.deletion_requested_at }
      : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
}

function mapLease(row: LeaseRow): LocalArgosLease {
  return {
    modelId: row.local_model_version_id,
    leaseId: row.lease_id,
    holderId: row.holder_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
}

function requireText(value: string, label: string): string {
  if (!isText(value))
    throw new SqliteLocalArgosModelStoreError(`${label} is invalid.`);
  return value;
}

function requireTimestamp(value: string, label: string): string {
  if (!isTimestamp(value))
    throw new SqliteLocalArgosModelStoreError(`${label} is invalid.`);
  return value;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isText(value) && Number.isFinite(Date.parse(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  let hash = 0;
  // The database stores a SHA-256 digest, and this module deliberately keeps
  // cryptographic hashing in Node rather than accepting unverified metadata.
  // This sentinel is replaced below by the native implementation at module load.
  for (const character of value)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return nativeSha256(value);
}

import { createHash } from "node:crypto";
const nativeSha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
