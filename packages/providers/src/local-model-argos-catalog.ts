import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

/**
 * A deliberately server-only, storage-agnostic Argos model catalog core.
 * Callers persist snapshots, candidates, evaluations, and releases; this module
 * makes their identities and safety/lifecycle decisions deterministic.
 */
export type LocalModelFinding = {
  code:
    | "artifact_fetch_failed"
    | "artifact_too_large"
    | "invalid_zip"
    | "unsafe_archive_path"
    | "missing_metadata"
    | "malformed_metadata"
    | "unsupported_model_format"
    | "incompatible_runtime"
    | "missing_license"
    | "missing_provenance"
    | "quality_not_recommended";
  severity: "hard" | "advisory";
  message: string;
};

export type ArgosIndexEntry = {
  from_code: string;
  to_code: string;
  package_version?: string;
  package_url?: string;
  links?: readonly string[];
  [key: string]: unknown;
};

export type LocalModelSourceSnapshot = {
  id: string;
  sourceId: "argos-package-index";
  sourceUrl: string;
  fetchedAt: string;
  feedSha256: string;
  rawFeed: string;
  entries: readonly ArgosIndexEntry[];
};

export type LocalModelCandidate = {
  id: string;
  snapshotId: string;
  sourceId: "argos-package-index";
  artifactUrl: string;
  sourceLanguage: string;
  targetLanguage: string;
  packageVersion: string;
  rawEntry: ArgosIndexEntry;
};

export type ArchiveInspection = {
  entryNames: readonly string[];
  metadata: Readonly<Record<string, unknown>> | undefined;
  modelFormat: "argos-legacy" | "unknown";
};

export type EvaluatedLocalModel = {
  id: string;
  candidate: LocalModelCandidate;
  artifactSha256: string;
  byteSize: number;
  archive: ArchiveInspection | undefined;
  findings: readonly LocalModelFinding[];
  evaluatedAt: string;
  runtimeFamily: string;
  runtimeVersion: string | undefined;
  recommendation: "recommended" | "not_recommended";
};

export type LocalModelAvailability =
  | "evaluated"
  | "enabled"
  | "enabled_by_override"
  | "disabled"
  | "revoked"
  | "rejected";

export type AvailabilityAudit = {
  actorId: string;
  at: string;
  reason?: string;
  action:
    "enable" | "enable_override" | "disable" | "revoke" | "reject" | "rollback";
};

export type LocalModelVersion = {
  evaluation: EvaluatedLocalModel;
  availability: LocalModelAvailability;
  audit: readonly AvailabilityAudit[];
};

export type CatalogReleasePayload = {
  contractVersion: 1;
  catalogRevision: number;
  models: readonly CatalogReleaseModel[];
  revokedModelIds?: readonly string[];
};

export type CatalogReleaseModel = {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  packageVersion: string;
  runtimeFamily: string;
  runtimeVersion?: string;
  artifactSha256: string;
  byteSize: number;
  availability: "enabled" | "enabled_by_override";
};

export type SignedCatalogRelease = {
  id: string;
  payload: CatalogReleasePayload;
  canonicalPayload: string;
  keyId: string;
  signature: string;
  /** Present when the signature covers the provider-neutral cloud envelope. */
  signedPayload?: unknown;
  catalogSha256?: string;
};

export interface CatalogSigner {
  readonly keyId: string;
  sign(canonicalPayload: Uint8Array): Promise<string>;
}

export interface CatalogVerifier {
  verify(
    canonicalPayload: Uint8Array,
    signature: string,
    keyId: string,
  ): Promise<boolean>;
}

export type ArgosCatalogOptions = {
  sourceUrl: string;
  runtimeFamily: string;
  supportedRuntimeVersions?: readonly string[];
  maxArtifactBytes?: number;
  mapLanguage?: (code: string) => string | undefined;
  signer: CatalogSigner;
};

export class LocalModelCatalogError extends Error {}

export class ArgosLocalModelCatalog {
  readonly #sourceUrl: string;
  readonly #runtimeFamily: string;
  readonly #supportedRuntimeVersions: ReadonlySet<string>;
  readonly #maxArtifactBytes: number;
  readonly #mapLanguage: (code: string) => string | undefined;
  readonly #signer: CatalogSigner;
  readonly #versions = new Map<string, LocalModelVersion>();
  readonly #releases = new Map<string, SignedCatalogRelease>();
  #revision = 0;

  constructor(options: ArgosCatalogOptions) {
    this.#sourceUrl = options.sourceUrl;
    this.#runtimeFamily = options.runtimeFamily;
    this.#supportedRuntimeVersions = new Set(
      options.supportedRuntimeVersions ?? [],
    );
    this.#maxArtifactBytes = options.maxArtifactBytes ?? 1_000_000_000;
    this.#mapLanguage = options.mapLanguage ?? defaultLanguageMapper;
    this.#signer = options.signer;
  }

  discover(
    rawFeed: string,
    fetchedAt: string,
  ): {
    snapshot: LocalModelSourceSnapshot;
    candidates: readonly LocalModelCandidate[];
  } {
    const entries = parseArgosIndex(rawFeed);
    const feedSha256 = sha256(rawFeed);
    const snapshot: LocalModelSourceSnapshot = {
      id: `argos-snapshot:${feedSha256}`,
      sourceId: "argos-package-index",
      sourceUrl: this.#sourceUrl,
      fetchedAt,
      feedSha256,
      rawFeed,
      entries,
    };
    const candidates = entries.flatMap((entry) => {
      const sourceLanguage = this.#mapLanguage(entry.from_code);
      const targetLanguage = this.#mapLanguage(entry.to_code);
      const artifactUrl = entry.package_url ?? entry.links?.[0];
      if (!sourceLanguage || !targetLanguage || !artifactUrl) return [];
      const packageVersion = entry.package_version ?? "unknown";
      const identity = stableJson({
        snapshotId: snapshot.id,
        artifactUrl,
        sourceLanguage,
        targetLanguage,
        packageVersion,
        rawEntry: entry,
      });
      return [
        {
          id: `argos-candidate:${sha256(identity)}`,
          snapshotId: snapshot.id,
          sourceId: "argos-package-index" as const,
          artifactUrl,
          sourceLanguage,
          targetLanguage,
          packageVersion,
          rawEntry: entry,
        },
      ];
    });
    return { snapshot, candidates };
  }

  async evaluate(
    candidate: LocalModelCandidate,
    fetchArtifact: (url: string) => Promise<Uint8Array>,
    evaluatedAt: string,
    quality: "recommended" | "not_recommended" = "recommended",
  ): Promise<EvaluatedLocalModel> {
    const findings: LocalModelFinding[] = [];
    let bytes: Uint8Array | undefined;
    try {
      bytes = await fetchArtifact(candidate.artifactUrl);
    } catch {
      findings.push(
        hard(
          "artifact_fetch_failed",
          "The package bytes could not be fetched.",
        ),
      );
    }
    if (bytes && bytes.byteLength > this.#maxArtifactBytes) {
      findings.push(
        hard(
          "artifact_too_large",
          "The package exceeds the configured byte limit.",
        ),
      );
    }
    let archive: ArchiveInspection | undefined;
    if (bytes && findings.length === 0) {
      const inspection = inspectArgosZip(bytes);
      archive = inspection.archive;
      findings.push(...inspection.findings);
    }
    const declaredRuntime = readString(archive?.metadata?.argos_version);
    if (
      declaredRuntime &&
      this.#supportedRuntimeVersions.size > 0 &&
      !this.#supportedRuntimeVersions.has(declaredRuntime)
    ) {
      findings.push(
        hard(
          "incompatible_runtime",
          `Argos runtime ${declaredRuntime} is not supported.`,
        ),
      );
    }
    if (!readString(archive?.metadata?.license)) {
      findings.push(
        advisory(
          "missing_license",
          "No package license was found in metadata.",
        ),
      );
    }
    if (
      !readString(archive?.metadata?.provenance) &&
      !readString(archive?.metadata?.source)
    ) {
      findings.push(
        advisory(
          "missing_provenance",
          "No package provenance was found in metadata.",
        ),
      );
    }
    if (quality === "not_recommended") {
      findings.push(
        advisory(
          "quality_not_recommended",
          "Automated quality evaluation is not recommended.",
        ),
      );
    }
    const artifactSha256 = bytes ? sha256(bytes) : sha256(candidate.id);
    const evaluation: EvaluatedLocalModel = {
      id: `argos-model:${sha256(stableJson({ candidateId: candidate.id, artifactSha256, runtimeFamily: this.#runtimeFamily }))}`,
      candidate,
      artifactSha256,
      byteSize: bytes?.byteLength ?? 0,
      archive,
      findings,
      evaluatedAt,
      runtimeFamily: this.#runtimeFamily,
      runtimeVersion: declaredRuntime,
      recommendation: findings.some(
        (finding) => finding.severity === "advisory",
      )
        ? "not_recommended"
        : "recommended",
    };
    return evaluation;
  }

  register(evaluation: EvaluatedLocalModel): LocalModelVersion {
    const existing = this.#versions.get(evaluation.id);
    if (existing) return existing;
    const version: LocalModelVersion = {
      evaluation,
      availability: "evaluated",
      audit: [],
    };
    this.#versions.set(evaluation.id, version);
    return version;
  }

  get(versionId: string): LocalModelVersion | undefined {
    return this.#versions.get(versionId);
  }

  list(): readonly LocalModelVersion[] {
    return [...this.#versions.values()].sort((left, right) =>
      left.evaluation.id.localeCompare(right.evaluation.id),
    );
  }

  enable(
    versionId: string,
    actorId: string,
    at: string,
    overrideReason?: string,
  ): LocalModelVersion {
    const current = this.required(versionId);
    if (
      current.evaluation.findings.some((finding) => finding.severity === "hard")
    ) {
      throw new LocalModelCatalogError(
        "A model with hard safety findings cannot be enabled.",
      );
    }
    const hasAdvisory = current.evaluation.findings.some(
      (finding) => finding.severity === "advisory",
    );
    if (hasAdvisory && !overrideReason?.trim()) {
      throw new LocalModelCatalogError(
        "An audited override reason is required for a not-recommended model.",
      );
    }
    if (current.availability === "revoked") {
      throw new LocalModelCatalogError(
        "A revoked model cannot be re-enabled; register a newly evaluated artifact.",
      );
    }
    this.disableActiveSiblings(current, actorId, at);
    const next: LocalModelVersion = {
      ...current,
      availability: hasAdvisory ? "enabled_by_override" : "enabled",
      audit: [
        ...current.audit,
        {
          actorId,
          at,
          ...(hasAdvisory ? { reason: overrideReason!.trim() } : {}),
          action: hasAdvisory ? "enable_override" : "enable",
        },
      ],
    };
    this.#versions.set(versionId, next);
    this.#revision += 1;
    return next;
  }

  disable(
    versionId: string,
    actorId: string,
    at: string,
    reason?: string,
  ): LocalModelVersion {
    return this.setTerminalAvailability(
      versionId,
      "disabled",
      "disable",
      actorId,
      at,
      reason,
    );
  }

  revoke(
    versionId: string,
    actorId: string,
    at: string,
    reason?: string,
  ): LocalModelVersion {
    return this.setTerminalAvailability(
      versionId,
      "revoked",
      "revoke",
      actorId,
      at,
      reason,
    );
  }

  reject(
    versionId: string,
    actorId: string,
    at: string,
    reason?: string,
  ): LocalModelVersion {
    return this.setTerminalAvailability(
      versionId,
      "rejected",
      "reject",
      actorId,
      at,
      reason,
    );
  }

  rollback(
    versionId: string,
    actorId: string,
    at: string,
    reason: string,
  ): LocalModelVersion {
    if (!reason.trim())
      throw new LocalModelCatalogError("Rollback requires an audit reason.");
    const target = this.required(versionId);
    if (
      target.availability === "revoked" ||
      target.evaluation.findings.some((finding) => finding.severity === "hard")
    ) {
      throw new LocalModelCatalogError(
        "This version is not eligible for rollback.",
      );
    }
    this.disableActiveSiblings(target, actorId, at);
    const hasAdvisory = target.evaluation.findings.some(
      (finding) => finding.severity === "advisory",
    );
    const next: LocalModelVersion = {
      ...target,
      availability: hasAdvisory ? "enabled_by_override" : "enabled",
      audit: [
        ...target.audit,
        { actorId, at, reason: reason.trim(), action: "rollback" },
      ],
    };
    this.#versions.set(versionId, next);
    this.#revision += 1;
    return next;
  }

  enabledEnglishHubRoutes(): readonly {
    sourceLanguage: string;
    targetLanguage: string;
    modelId: string;
  }[] {
    return this.list()
      .filter(
        (model) =>
          model.availability === "enabled" ||
          model.availability === "enabled_by_override",
      )
      .filter(
        (model) =>
          model.evaluation.candidate.sourceLanguage === "en" ||
          model.evaluation.candidate.targetLanguage === "en",
      )
      .map((model) => ({
        sourceLanguage: model.evaluation.candidate.sourceLanguage,
        targetLanguage: model.evaluation.candidate.targetLanguage,
        modelId: model.evaluation.id,
      }));
  }

  async publish(): Promise<SignedCatalogRelease> {
    const payload: CatalogReleasePayload = {
      contractVersion: 1,
      catalogRevision: this.#revision,
      models: this.list()
        .filter(
          (
            model,
          ): model is LocalModelVersion & {
            availability: "enabled" | "enabled_by_override";
          } =>
            model.availability === "enabled" ||
            model.availability === "enabled_by_override",
        )
        .map((model) => ({
          id: model.evaluation.id,
          sourceLanguage: model.evaluation.candidate.sourceLanguage,
          targetLanguage: model.evaluation.candidate.targetLanguage,
          packageVersion: model.evaluation.candidate.packageVersion,
          runtimeFamily: model.evaluation.runtimeFamily,
          ...(model.evaluation.runtimeVersion
            ? { runtimeVersion: model.evaluation.runtimeVersion }
            : {}),
          artifactSha256: model.evaluation.artifactSha256,
          byteSize: model.evaluation.byteSize,
          availability: model.availability,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      revokedModelIds: this.list()
        .filter((model) => model.availability === "revoked")
        .map((model) => model.evaluation.id)
        .sort(),
    };
    const canonicalPayload = stableJson(payload);
    const id = `argos-release:${sha256(canonicalPayload)}`;
    const previous = this.#releases.get(id);
    if (previous) return previous;
    const signature = await this.#signer.sign(utf8(canonicalPayload));
    const release: SignedCatalogRelease = {
      id,
      payload,
      canonicalPayload,
      keyId: this.#signer.keyId,
      signature,
    };
    this.#releases.set(id, release);
    return release;
  }

  private required(versionId: string): LocalModelVersion {
    const value = this.#versions.get(versionId);
    if (!value)
      throw new LocalModelCatalogError("Unknown local model version.");
    return value;
  }

  private disableActiveSiblings(
    target: LocalModelVersion,
    actorId: string,
    at: string,
  ): void {
    for (const [id, sibling] of this.#versions) {
      if (id === target.evaluation.id || !sameRouteFamily(sibling, target))
        continue;
      if (
        sibling.availability !== "enabled" &&
        sibling.availability !== "enabled_by_override"
      )
        continue;
      this.#versions.set(id, {
        ...sibling,
        availability: "disabled",
        audit: [
          ...sibling.audit,
          {
            actorId,
            at,
            reason: "superseded_by_active_version",
            action: "disable",
          },
        ],
      });
    }
  }

  private setTerminalAvailability(
    versionId: string,
    availability: "disabled" | "revoked" | "rejected",
    action: AvailabilityAudit["action"],
    actorId: string,
    at: string,
    reason?: string,
  ): LocalModelVersion {
    const current = this.required(versionId);
    const next: LocalModelVersion = {
      ...current,
      availability,
      audit: [
        ...current.audit,
        {
          actorId,
          at,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
          action,
        },
      ],
    };
    this.#versions.set(versionId, next);
    this.#revision += 1;
    return next;
  }
}

export async function verifyCatalogRelease(
  release: SignedCatalogRelease,
  verifier: CatalogVerifier,
): Promise<boolean> {
  if (release.signedPayload !== undefined) {
    if (
      release.canonicalPayload !== stableJson(release.signedPayload) ||
      release.catalogSha256 !== sha256(release.canonicalPayload) ||
      !signedPayloadBindsRuntimeCatalog(release.signedPayload, release.payload)
    )
      return false;
  } else {
    if (release.id !== `argos-release:${sha256(release.canonicalPayload)}`)
      return false;
    if (release.canonicalPayload !== stableJson(release.payload)) return false;
  }
  return verifier.verify(
    utf8(release.canonicalPayload),
    release.signature,
    release.keyId,
  );
}

function signedPayloadBindsRuntimeCatalog(
  value: unknown,
  runtime: CatalogReleasePayload,
): boolean {
  if (!isRecord(value) || value.contractVersion !== 1) return false;
  if (
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    !Array.isArray(value.versions)
  )
    return false;
  const mapped = value.versions.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.sourceLanguage !== "string" ||
      typeof candidate.targetLanguage !== "string" ||
      typeof candidate.packageVersion !== "string" ||
      typeof candidate.runtimeFamily !== "string" ||
      typeof candidate.runtimeVersion !== "string" ||
      typeof candidate.artifactSha256 !== "string" ||
      typeof candidate.artifactByteSize !== "number" ||
      !Number.isSafeInteger(candidate.artifactByteSize) ||
      !isRecord(candidate.availability) ||
      !["enabled", "enabled_by_override"].includes(
        String(candidate.availability.state),
      )
    )
      return [];
    return [
      {
        id: candidate.id,
        sourceLanguage: candidate.sourceLanguage,
        targetLanguage: candidate.targetLanguage,
        packageVersion: candidate.packageVersion,
        runtimeFamily: candidate.runtimeFamily,
        runtimeVersion: candidate.runtimeVersion,
        artifactSha256: candidate.artifactSha256,
        byteSize: candidate.artifactByteSize,
        availability: candidate.availability.state,
      },
    ];
  });
  const revokedModelIds = Array.isArray(value.revokedVersionIds)
    ? value.revokedVersionIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  return (
    mapped.length === value.versions.length &&
    stableJson({
      contractVersion: 1,
      catalogRevision: value.sequence,
      models: mapped,
      revokedModelIds,
    }) === stableJson(runtime)
  );
}

export function parseArgosIndex(rawFeed: string): readonly ArgosIndexEntry[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawFeed);
  } catch {
    throw new LocalModelCatalogError(
      "The Argos package index is not valid JSON.",
    );
  }
  const entries = Array.isArray(decoded)
    ? decoded
    : isRecord(decoded) && Array.isArray(decoded.packages)
      ? decoded.packages
      : undefined;
  if (!entries)
    throw new LocalModelCatalogError(
      "The Argos package index does not contain a package list.",
    );
  return entries.flatMap((value) =>
    isArgosIndexEntry(value) ? [structuredClone(value)] : [],
  );
}

export function inspectArgosZip(bytes: Uint8Array): {
  archive: ArchiveInspection | undefined;
  findings: readonly LocalModelFinding[];
} {
  try {
    const entries = parseZipCentralDirectory(bytes);
    const unsafe = entries.find((entry) => !safeArchivePath(entry.name));
    if (unsafe)
      return {
        archive: undefined,
        findings: [
          hard("unsafe_archive_path", `Unsafe archive path: ${unsafe.name}`),
        ],
      };
    const metadataEntry = entries.find(
      (entry) => entry.name === "metadata.json",
    );
    if (!metadataEntry)
      return {
        archive: undefined,
        findings: [
          hard(
            "missing_metadata",
            "The package does not contain metadata.json.",
          ),
        ],
      };
    let metadata: Readonly<Record<string, unknown>>;
    try {
      const data = readZipEntry(bytes, metadataEntry);
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(data),
      );
      if (!isRecord(parsed)) throw new Error("metadata must be an object");
      metadata = parsed;
    } catch {
      return {
        archive: undefined,
        findings: [
          hard(
            "malformed_metadata",
            "metadata.json is unreadable or malformed.",
          ),
        ],
      };
    }
    const names = entries.map((entry) => entry.name).sort();
    const modelFormat = names.some(
      (name) => name === "model.bin" || name.startsWith("model/"),
    )
      ? "argos-legacy"
      : "unknown";
    if (modelFormat === "unknown")
      return {
        archive: { entryNames: names, metadata, modelFormat },
        findings: [
          hard(
            "unsupported_model_format",
            "The package does not contain a supported Argos model layout.",
          ),
        ],
      };
    return {
      archive: { entryNames: names, metadata, modelFormat },
      findings: [],
    };
  } catch {
    return {
      archive: undefined,
      findings: [
        hard("invalid_zip", "The package is not a valid bounded ZIP archive."),
      ],
    };
  }
}

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function parseZipCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12);
  const offset = u32(bytes, eocd + 16);
  if (count > 10_000 || offset + size > bytes.byteLength)
    throw new Error("central directory bounds");
  const result: ZipEntry[] = [];
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50)
      throw new Error("central directory signature");
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const nameStart = cursor + 46;
    const end = nameStart + nameLength + extraLength + commentLength;
    if (end > bytes.byteLength) throw new Error("central name bounds");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(nameStart, nameStart + nameLength),
    );
    result.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = end;
  }
  if (cursor !== offset + size) throw new Error("central directory size");
  return result;
}

function findEocd(bytes: Uint8Array): number {
  const floor = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) return offset;
  }
  throw new Error("missing end of central directory");
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  if (u32(bytes, entry.localOffset) !== 0x04034b50)
    throw new Error("local header signature");
  const nameLength = u16(bytes, entry.localOffset + 26);
  const extraLength = u16(bytes, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength || entry.uncompressedSize > 1_000_000)
    throw new Error("entry bounds");
  const compressed = bytes.slice(start, end);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize)
      throw new Error("stored entry size");
    return compressed;
  }
  if (entry.method === 8) {
    const inflated = inflateRawSync(compressed, { maxOutputLength: 1_000_000 });
    if (inflated.byteLength !== entry.uncompressedSize)
      throw new Error("deflated entry size");
    return inflated;
  }
  throw new Error("unsupported compression method");
}

function safeArchivePath(name: string): boolean {
  if (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  )
    return false;
  const parts = name.endsWith("/")
    ? name.slice(0, -1).split("/")
    : name.split("/");
  return (
    parts.length > 0 && parts.every((part) => part !== ".." && part !== "")
  );
}

function sameRouteFamily(
  left: LocalModelVersion,
  right: LocalModelVersion,
): boolean {
  return (
    left.evaluation.runtimeFamily === right.evaluation.runtimeFamily &&
    left.evaluation.candidate.sourceLanguage ===
      right.evaluation.candidate.sourceLanguage &&
    left.evaluation.candidate.targetLanguage ===
      right.evaluation.candidate.targetLanguage
  );
}

function isArgosIndexEntry(value: unknown): value is ArgosIndexEntry {
  return (
    isRecord(value) &&
    typeof value.from_code === "string" &&
    typeof value.to_code === "string" &&
    (value.package_url === undefined ||
      typeof value.package_url === "string") &&
    (value.links === undefined ||
      (Array.isArray(value.links) &&
        value.links.every((link) => typeof link === "string")))
  );
}

function defaultLanguageMapper(code: string): string | undefined {
  const normalized = code.trim().toLowerCase().replaceAll("_", "-");
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(normalized)
    ? normalized
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hard(
  code: Extract<
    LocalModelFinding["code"],
    | "artifact_fetch_failed"
    | "artifact_too_large"
    | "invalid_zip"
    | "unsafe_archive_path"
    | "missing_metadata"
    | "malformed_metadata"
    | "unsupported_model_format"
    | "incompatible_runtime"
  >,
  message: string,
): LocalModelFinding {
  return { code, severity: "hard", message };
}

function advisory(
  code: Extract<
    LocalModelFinding["code"],
    "missing_license" | "missing_provenance" | "quality_not_recommended"
  >,
  message: string,
): LocalModelFinding {
  return { code, severity: "advisory", message };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength)
    throw new Error("uint16 bounds");
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength)
    throw new Error("uint32 bounds");
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}
