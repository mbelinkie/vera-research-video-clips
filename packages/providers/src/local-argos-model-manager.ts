import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  inspectArgosZip,
  verifyCatalogRelease,
  type CatalogVerifier,
  type SignedCatalogRelease,
} from "./local-model-argos-catalog.ts";

export type ArgosModelDescriptor = {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  runtimeFamily: string;
  runtimeVersion?: string;
  artifactSha256: string;
  byteSize: number;
  availability: "enabled" | "enabled_by_override" | "disabled" | "revoked";
};

export type CachedArgosCatalog = {
  release: SignedCatalogRelease;
  cachedAt: string;
  expiresAt: string;
};

export type LocalArgosInstallation = {
  modelId: string;
  sourceLanguage: string;
  targetLanguage: string;
  runtimeFamily: string;
  artifactSha256: string;
  byteSize: number;
  state: "downloading" | "active" | "deletion_pending" | "deleted" | "failed";
  installedAt?: string;
  verifiedAt?: string;
  deletionRequestedAt?: string;
  deletedAt?: string;
};

export type LocalArgosLease = {
  modelId: string;
  leaseId: string;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
};

/**
 * A persistence seam intentionally shaped around local migration 0036's
 * releases, installations, and model-lease tables. Implementations make these
 * operations transactional; the deterministic in-memory implementation below
 * makes the boundary usable without a SQLite dependency in provider tests.
 */
export interface LocalArgosModelStore {
  readCatalog(): Promise<CachedArgosCatalog | undefined>;
  writeCatalog(catalog: CachedArgosCatalog): Promise<void>;
  getInstallation(modelId: string): Promise<LocalArgosInstallation | undefined>;
  putInstallation(installation: LocalArgosInstallation): Promise<void>;
  listInstallations(): Promise<readonly LocalArgosInstallation[]>;
  createLease(lease: LocalArgosLease): Promise<void>;
  removeLease(modelId: string, leaseId: string): Promise<void>;
  listLeases(modelId: string): Promise<readonly LocalArgosLease[]>;
  removeExpiredLeases(now: string): Promise<void>;
}

export class MemoryLocalArgosModelStore implements LocalArgosModelStore {
  #catalog: CachedArgosCatalog | undefined;
  readonly #installations = new Map<string, LocalArgosInstallation>();
  readonly #leases = new Map<string, LocalArgosLease>();

  async readCatalog() {
    return this.#catalog && structuredClone(this.#catalog);
  }
  async writeCatalog(catalog: CachedArgosCatalog) {
    this.#catalog = structuredClone(catalog);
  }
  async getInstallation(modelId: string) {
    const value = this.#installations.get(modelId);
    return value && structuredClone(value);
  }
  async putInstallation(installation: LocalArgosInstallation) {
    this.#installations.set(
      installation.modelId,
      structuredClone(installation),
    );
  }
  async listInstallations() {
    return [...this.#installations.values()].map((value) =>
      structuredClone(value),
    );
  }
  async createLease(lease: LocalArgosLease) {
    this.#leases.set(
      `${lease.modelId}\u0000${lease.leaseId}`,
      structuredClone(lease),
    );
  }
  async removeLease(modelId: string, leaseId: string) {
    this.#leases.delete(`${modelId}\u0000${leaseId}`);
  }
  async listLeases(modelId: string) {
    return [...this.#leases.values()]
      .filter((lease) => lease.modelId === modelId)
      .map((lease) => structuredClone(lease));
  }
  async removeExpiredLeases(now: string) {
    for (const [key, lease] of this.#leases) {
      if (lease.expiresAt <= now) this.#leases.delete(key);
    }
  }
}

export type ArgosCatalogState =
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "current"; release: SignedCatalogRelease }
  | { state: "stale"; release: SignedCatalogRelease };

export type ArgosModelDownload = (
  model: ArgosModelDescriptor,
) => Promise<Uint8Array>;

export type LocalArgosModelManagerOptions = {
  rootDirectory: string;
  verifier: CatalogVerifier;
  store?: LocalArgosModelStore;
  supportedRuntimeVersions?: readonly string[];
  maxArtifactBytes?: number;
};

export class LocalArgosModelError extends Error {
  readonly code:
    | "catalog_unavailable"
    | "catalog_invalid"
    | "model_disabled"
    | "artifact_invalid"
    | "model_unavailable";

  constructor(code: LocalArgosModelError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class LocalArgosModelManager {
  readonly #root: string;
  readonly #modelsRoot: string;
  readonly #stagingRoot: string;
  readonly #verifier: CatalogVerifier;
  readonly #store: LocalArgosModelStore;
  readonly #supportedRuntimeVersions: ReadonlySet<string>;
  readonly #maxArtifactBytes: number;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(options: LocalArgosModelManagerOptions) {
    this.#root = resolveRequiredDirectory(options.rootDirectory, "model root");
    this.#modelsRoot = join(this.#root, "models");
    this.#stagingRoot = join(this.#root, "staging");
    this.#verifier = options.verifier;
    this.#store = options.store ?? new MemoryLocalArgosModelStore();
    this.#supportedRuntimeVersions = new Set(
      options.supportedRuntimeVersions ?? [],
    );
    this.#maxArtifactBytes = options.maxArtifactBytes ?? 1_000_000_000;
  }

  async cacheCatalog(catalog: CachedArgosCatalog): Promise<void> {
    if (!validTimestampOrder(catalog.cachedAt, catalog.expiresAt)) {
      throw new LocalArgosModelError(
        "catalog_invalid",
        "Catalog expiry is invalid.",
      );
    }
    if (!(await verifyCatalogRelease(catalog.release, this.#verifier))) {
      throw new LocalArgosModelError(
        "catalog_invalid",
        "Catalog signature verification failed.",
      );
    }
    await this.#store.writeCatalog(catalog);
    await this.reconcileCatalog(catalog.release, catalog.cachedAt);
  }

  async catalogState(now: string): Promise<ArgosCatalogState> {
    const cached = await this.#store.readCatalog();
    if (!cached) return { state: "missing" };
    if (!(await verifyCatalogRelease(cached.release, this.#verifier))) {
      return { state: "invalid" };
    }
    return cached.expiresAt > now
      ? { state: "current", release: cached.release }
      : { state: "stale", release: cached.release };
  }

  async install(
    model: ArgosModelDescriptor,
    download: ArgosModelDownload,
    now: string,
  ): Promise<{ modelPath: string; reused: boolean }> {
    return this.serial(model.id, async () => {
      const catalog = await this.catalogState(now);
      if (catalog.state === "invalid") {
        throw new LocalArgosModelError(
          "catalog_invalid",
          "Cached catalog verification failed.",
        );
      }
      if (
        catalog.state !== "current" ||
        !approvedByRelease(catalog.release, model)
      ) {
        throw new LocalArgosModelError(
          "catalog_unavailable",
          "A current verified catalog is required to download a model.",
        );
      }
      if (!isActive(model.availability)) {
        throw new LocalArgosModelError(
          "model_disabled",
          "This local model is disabled or revoked.",
        );
      }
      const active = await this.#store.getInstallation(model.id);
      const destination = this.modelDirectory(model);
      if (
        active?.state === "active" &&
        (await this.verifyInstalled(destination, model))
      ) {
        return { modelPath: this.modelPath(model), reused: true };
      }

      await this.#store.putInstallation({
        modelId: model.id,
        sourceLanguage: model.sourceLanguage,
        targetLanguage: model.targetLanguage,
        runtimeFamily: model.runtimeFamily,
        artifactSha256: model.artifactSha256,
        byteSize: model.byteSize,
        state: "downloading",
      });
      let staged: string | undefined;
      try {
        const bytes = await download(model);
        this.verifyArtifactBytes(bytes, model);
        await mkdir(this.#stagingRoot, { recursive: true, mode: 0o700 });
        staged = join(
          this.#stagingRoot,
          `${modelDirectoryName(model)}-${randomUUID()}`,
        );
        ensureContained(this.#stagingRoot, staged);
        await mkdir(staged, { mode: 0o700 });
        const stagedPackage = join(staged, "package.argosmodel");
        await writeFile(stagedPackage, bytes, { mode: 0o600, flag: "wx" });
        if (!(await this.verifyInstalled(staged, model))) {
          throw new LocalArgosModelError(
            "artifact_invalid",
            "Staged model verification failed.",
          );
        }
        await mkdir(this.#modelsRoot, { recursive: true, mode: 0o700 });
        const backup = `${destination}.previous-${randomUUID()}`;
        const hadPrevious = await exists(destination);
        if (hadPrevious) {
          ensureContained(this.#modelsRoot, backup);
          await rename(destination, backup);
        }
        try {
          await rename(staged, destination);
        } catch (error) {
          if (hadPrevious) await rename(backup, destination);
          throw error;
        }
        if (!(await this.verifyInstalled(destination, model))) {
          await rm(destination, { recursive: true, force: true });
          if (hadPrevious) await rename(backup, destination);
          throw new LocalArgosModelError(
            "artifact_invalid",
            "Activated model verification failed.",
          );
        }
        if (hadPrevious) {
          await rm(backup, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
        await this.#store.putInstallation({
          modelId: model.id,
          sourceLanguage: model.sourceLanguage,
          targetLanguage: model.targetLanguage,
          runtimeFamily: model.runtimeFamily,
          artifactSha256: model.artifactSha256,
          byteSize: model.byteSize,
          state: "active",
          installedAt: now,
          verifiedAt: now,
        });
        return { modelPath: this.modelPath(model), reused: false };
      } catch (error) {
        if (staged) await rm(staged, { recursive: true, force: true });
        const restored =
          active?.state === "active" &&
          (await this.verifyInstalled(destination, model));
        await this.#store.putInstallation(
          restored
            ? active
            : {
                modelId: model.id,
                sourceLanguage: model.sourceLanguage,
                targetLanguage: model.targetLanguage,
                runtimeFamily: model.runtimeFamily,
                artifactSha256: model.artifactSha256,
                byteSize: model.byteSize,
                state: "failed",
              },
        );
        if (error instanceof LocalArgosModelError) throw error;
        throw new LocalArgosModelError(
          "artifact_invalid",
          "Model download or verification failed.",
        );
      }
    });
  }

  async acquireLease(input: {
    model: ArgosModelDescriptor;
    holderId: string;
    now: string;
    ttlMs: number;
  }): Promise<{ lease: LocalArgosLease; modelPath: string }> {
    if (
      !input.holderId.trim() ||
      !Number.isSafeInteger(input.ttlMs) ||
      input.ttlMs <= 0
    ) {
      throw new LocalArgosModelError(
        "model_unavailable",
        "Lease request is invalid.",
      );
    }
    return this.serial(input.model.id, async () => {
      if (!isActive(input.model.availability)) {
        throw new LocalArgosModelError(
          "model_disabled",
          "This local model is disabled or revoked.",
        );
      }
      const catalog = await this.catalogState(input.now);
      if (catalog.state === "invalid" || catalog.state === "missing") {
        throw new LocalArgosModelError(
          "catalog_unavailable",
          "No verified local catalog is available.",
        );
      }
      if (
        catalog.state === "current" &&
        !approvedByRelease(catalog.release, input.model)
      ) {
        throw new LocalArgosModelError(
          "model_disabled",
          "The model is no longer enabled by the current catalog.",
        );
      }
      const installation = await this.#store.getInstallation(input.model.id);
      if (
        installation?.state !== "active" ||
        !(await this.verifyInstalled(
          this.modelDirectory(input.model),
          input.model,
        ))
      ) {
        throw new LocalArgosModelError(
          "model_unavailable",
          "Verified model bytes are not installed.",
        );
      }
      const lease: LocalArgosLease = {
        modelId: input.model.id,
        leaseId: randomUUID(),
        holderId: input.holderId.trim(),
        acquiredAt: input.now,
        expiresAt: new Date(Date.parse(input.now) + input.ttlMs).toISOString(),
      };
      await this.#store.createLease(lease);
      return { lease, modelPath: this.modelPath(input.model) };
    });
  }

  async releaseLease(lease: LocalArgosLease, now: string): Promise<void> {
    await this.serial(lease.modelId, async () => {
      await this.#store.removeLease(lease.modelId, lease.leaseId);
      await this.sweepOne(lease.modelId, now);
    });
  }

  async sweep(now: string): Promise<readonly string[]> {
    await this.#store.removeExpiredLeases(now);
    const removed: string[] = [];
    for (const installation of await this.#store.listInstallations()) {
      if (
        await this.serial(installation.modelId, () =>
          this.sweepOne(installation.modelId, now),
        )
      ) {
        removed.push(installation.modelId);
      }
    }
    return removed;
  }

  private async reconcileCatalog(
    release: SignedCatalogRelease,
    now: string,
  ): Promise<void> {
    const revoked = new Set(release.payload.revokedModelIds ?? []);
    for (const installation of await this.#store.listInstallations()) {
      if (
        !revoked.has(installation.modelId) ||
        installation.state === "deleted"
      )
        continue;
      await this.#store.putInstallation({
        ...installation,
        state: "deletion_pending",
        deletionRequestedAt: now,
      });
    }
    await this.sweep(now);
  }

  private async sweepOne(modelId: string, now: string): Promise<boolean> {
    const installation = await this.#store.getInstallation(modelId);
    if (installation?.state !== "deletion_pending") return false;
    const leases = await this.#store.listLeases(modelId);
    if (leases.some((lease) => lease.expiresAt > now)) return false;
    const path = this.modelDirectoryById(modelId);
    ensureContained(this.#modelsRoot, path);
    await rm(path, { recursive: true, force: true });
    if (await exists(path)) {
      throw new LocalArgosModelError(
        "artifact_invalid",
        "Model cleanup could not verify deletion.",
      );
    }
    await this.#store.putInstallation({
      ...installation,
      state: "deleted",
      deletedAt: now,
    });
    return true;
  }

  private verifyArtifactBytes(
    bytes: Uint8Array,
    model: ArgosModelDescriptor,
  ): void {
    if (
      bytes.byteLength !== model.byteSize ||
      bytes.byteLength > this.#maxArtifactBytes
    ) {
      throw new LocalArgosModelError(
        "artifact_invalid",
        "Model byte size does not match the approved descriptor.",
      );
    }
    if (sha256(bytes) !== model.artifactSha256) {
      throw new LocalArgosModelError(
        "artifact_invalid",
        "Model checksum does not match the approved descriptor.",
      );
    }
    const inspection = inspectArgosZip(bytes);
    if (
      !inspection.archive ||
      inspection.findings.some((finding) => finding.severity === "hard")
    ) {
      throw new LocalArgosModelError(
        "artifact_invalid",
        "Model archive failed containment or format verification.",
      );
    }
    const runtime = inspection.archive.metadata?.argos_version;
    if (
      typeof runtime !== "string" ||
      (model.runtimeVersion !== undefined &&
        runtime !== model.runtimeVersion) ||
      (this.#supportedRuntimeVersions.size > 0 &&
        !this.#supportedRuntimeVersions.has(runtime))
    ) {
      throw new LocalArgosModelError(
        "artifact_invalid",
        "Model package is incompatible with the packaged runtime.",
      );
    }
  }

  private async verifyInstalled(
    directory: string,
    model: ArgosModelDescriptor,
  ): Promise<boolean> {
    try {
      const bytes = await readFile(join(directory, "package.argosmodel"));
      this.verifyArtifactBytes(bytes, model);
      return true;
    } catch {
      return false;
    }
  }

  private modelDirectory(model: ArgosModelDescriptor): string {
    return this.modelDirectoryById(model.id);
  }
  private modelDirectoryById(modelId: string): string {
    const path = join(this.#modelsRoot, modelDirectoryName({ id: modelId }));
    ensureContained(this.#modelsRoot, path);
    return path;
  }
  private modelPath(model: ArgosModelDescriptor): string {
    return join(this.modelDirectory(model), "package.argosmodel");
  }
  private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const prior = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    this.#locks.set(key, tail);
    await prior;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
}

function approvedByRelease(
  release: SignedCatalogRelease,
  model: ArgosModelDescriptor,
): boolean {
  return release.payload.models.some(
    (candidate) =>
      candidate.id === model.id &&
      isActive(candidate.availability) &&
      candidate.artifactSha256 === model.artifactSha256 &&
      candidate.byteSize === model.byteSize &&
      candidate.runtimeFamily === model.runtimeFamily &&
      candidate.runtimeVersion === model.runtimeVersion,
  );
}

function isActive(
  value: ArgosModelDescriptor["availability"],
): value is "enabled" | "enabled_by_override" {
  return value === "enabled" || value === "enabled_by_override";
}

function modelDirectoryName(model: { id: string }): string {
  return `model-${createHash("sha256").update(model.id).digest("hex")}`;
}

function resolveRequiredDirectory(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0"))
    throw new LocalArgosModelError("artifact_invalid", `Invalid ${label}.`);
  return resolve(trimmed);
}

function ensureContained(root: string, path: string): void {
  const child = relative(root, path);
  if (
    !child ||
    child === ".." ||
    child.startsWith("../") ||
    child.startsWith("..\\") ||
    child.split(/[\\/]/u).includes("..")
  ) {
    throw new LocalArgosModelError(
      "artifact_invalid",
      "Model path escapes its app-owned root.",
    );
  }
}

function validTimestampOrder(cachedAt: string, expiresAt: string): boolean {
  const start = Date.parse(cachedAt);
  const end = Date.parse(expiresAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
