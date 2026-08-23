import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  readdir,
  type FileHandle,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { posix, resolve, sep, win32 } from "node:path";

import {
  ArtifactVersionSummarySchema,
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
  LocalAuthoringArtifactDescriptorSchema,
  LoggedExportSuccessResultSchema,
  type ArtifactLocatorSummary,
  type ArtifactCompatibilityRequirements,
  type ArtifactLocatorActionResult,
  type ArtifactResolutionFreshness,
  type ArtifactResolutionResult,
  type ArtifactRootSummary,
  type ArtifactStoragePlatform,
  type ArtifactVerificationFailureClass,
  type ArtifactVersionSummary,
  type LocalAuthoringArtifactDescriptor,
  type ConfigureLocalArtifactRootRequest,
} from "@research-video/contracts";
import {
  canonicalJson,
  artifactVersionMatchesRequirements,
  rendererCapabilityForSettings,
  resolvedPresetForCompatibility,
  sha256Fingerprint,
} from "@research-video/export-settings";
import {
  LocalArtifactLocatorRepository,
  type LocalArtifactLocatorRecord,
  type LocalArtifactRootRecord,
} from "@research-video/db-local";

const MaxPackageJsonBytes = 2 * 1024 * 1024;
const PackageIdentityPattern = /^clip-[a-f0-9-]{36}$/u;

export interface LocalArtifactLauncher {
  revealPackage(packagePath: string): Promise<void>;
  openMedia(mediaPath: string): Promise<void>;
}

type VerifiedArtifactPaths = {
  platform: ArtifactStoragePlatform;
  manifestSchemaVersion: 1 | 2;
  packagePath: string;
  mediaPath: string;
};

export async function resolveArtifactActionEvidence(input: {
  fetchCloud(): Promise<ArtifactVersionSummary>;
  findCached(): ArtifactVersionSummary | undefined;
  onAuthorizationDenied(statusCode: 401 | 403): void;
}): Promise<{
  summary: ArtifactVersionSummary;
  freshness: ArtifactResolutionFreshness;
}> {
  try {
    return {
      summary: ArtifactVersionSummarySchema.parse(await input.fetchCloud()),
      freshness: "fresh",
    };
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 401 || statusCode === 403) {
      input.onAuthorizationDenied(statusCode);
      throw new LocalArtifactActionError("not_found", 404);
    }
    if (statusCode === undefined || statusCode < 500) throw error;
    const cached = input.findCached();
    if (!cached) throw error;
    return {
      summary: ArtifactVersionSummarySchema.parse(cached),
      freshness: "stale",
    };
  }
}

export async function resolveAuthoringArtifactEvidence(input: {
  fetchCloud(): Promise<ArtifactVersionSummary>;
  onAuthorizationDenied(statusCode: 401 | 403): void;
}): Promise<ArtifactVersionSummary> {
  try {
    return ArtifactVersionSummarySchema.parse(await input.fetchCloud());
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 401 || statusCode === 403) {
      input.onAuthorizationDenied(statusCode);
      throw new LocalArtifactActionError("not_found", 404);
    }
    throw error;
  }
}

export class LocalArtifactLocatorService {
  constructor(
    private readonly repository: LocalArtifactLocatorRepository,
    private readonly launcher?: LocalArtifactLauncher,
  ) {}

  async configureRoot(
    input: ConfigureLocalArtifactRootRequest,
  ): Promise<ArtifactRootSummary> {
    const platform = input.platform;
    const absolutePath = validateConfiguredRootPath(
      input.absolutePath,
      platform,
    );
    requireHostPlatform(platform);
    const evidence = await inspectRoot(absolutePath);
    return this.repository.configureRoot({
      label: input.label.trim(),
      platform,
      absolutePath: evidence.realPath,
      pathFingerprint: createHash("sha256")
        .update(`${platform}\0${evidence.realPath}`)
        .digest("hex"),
      filesystemIdentity: evidence.filesystemIdentity,
    });
  }

  listRoots(): ArtifactRootSummary[] {
    return this.repository.listRoots();
  }

  listLocators(artifactVersionId?: string): ArtifactLocatorSummary[] {
    return this.repository.listLocators(artifactVersionId);
  }

  getLocatorCloudIdentity(locatorId: string): {
    projectId: string;
    clipId: string;
    artifactVersionId: string;
  } {
    const locator = this.requireLocator(locatorId);
    return {
      projectId: locator.projectId,
      clipId: locator.clipId,
      artifactVersionId: locator.artifactVersionId,
    };
  }

  async resolveArtifactVersion(input: {
    summary?: ArtifactVersionSummary;
    requirements: ArtifactCompatibilityRequirements;
    freshness: ArtifactResolutionFreshness;
  }): Promise<ArtifactResolutionResult> {
    if (!input.summary) {
      return { state: "needs_export", freshness: input.freshness };
    }
    const summary = ArtifactVersionSummarySchema.parse(input.summary);
    if (!artifactVersionMatchesRequirements(summary, input.requirements)) {
      return {
        state: "incompatible",
        artifactVersionId: summary.artifactVersionId,
        freshness: input.freshness,
      };
    }
    const locators = this.repository.listLocators(summary.artifactVersionId);
    if (locators.length === 0) {
      return {
        state: "missing",
        artifactVersionId: summary.artifactVersionId,
        locators: [],
        freshness: input.freshness,
      };
    }
    for (const locator of locators) {
      try {
        const verified = await this.verifyLocator(locator.id, summary);
        if (verified.availability !== "verified") continue;
        if (
          !verified.manifestSchemaVersion ||
          !input.requirements.acceptedManifestSchemas.includes(
            verified.manifestSchemaVersion,
          )
        ) {
          return {
            state: "incompatible",
            artifactVersionId: summary.artifactVersionId,
            freshness: input.freshness,
          };
        }
        return {
          state: "reusable_local",
          artifactVersionId: summary.artifactVersionId,
          locator: verified,
          freshness: input.freshness,
        };
      } catch {
        // Resolution checks every configured copy before choosing the result.
      }
    }
    const checked = this.repository.listLocators(summary.artifactVersionId);
    return checked.some((locator) => locator.availability === "invalid")
      ? {
          state: "invalid",
          artifactVersionId: summary.artifactVersionId,
          locators: checked,
          freshness: input.freshness,
        }
      : {
          state: "missing",
          artifactVersionId: summary.artifactVersionId,
          locators: checked,
          freshness: input.freshness,
        };
  }

  async resolveArtifactHistory(input: {
    summaries: ArtifactVersionSummary[];
    requirements: ArtifactCompatibilityRequirements;
    freshness: ArtifactResolutionFreshness;
  }): Promise<ArtifactResolutionResult> {
    if (input.summaries.length === 0) {
      return { state: "needs_export", freshness: input.freshness };
    }
    const compatible = input.summaries.filter((summary) =>
      artifactVersionMatchesRequirements(summary, input.requirements),
    );
    if (compatible.length === 0) {
      return {
        state: "incompatible",
        artifactVersionId: input.summaries[0]?.artifactVersionId,
        freshness: input.freshness,
      };
    }
    const unavailable: ArtifactResolutionResult[] = [];
    for (const summary of compatible) {
      const resolution = await this.resolveArtifactVersion({
        summary,
        requirements: input.requirements,
        freshness: input.freshness,
      });
      if (resolution.state === "reusable_local") return resolution;
      unavailable.push(resolution);
    }
    return (
      unavailable.find((result) => result.state === "invalid") ??
      unavailable[0]!
    );
  }

  async verifyLocator(
    locatorId: string,
    input: ArtifactVersionSummary,
  ): Promise<ArtifactLocatorSummary> {
    const summary = ArtifactVersionSummarySchema.parse(input);
    const locator = this.requireMatchingLocator(locatorId, summary);
    return this.verifyArtifactVersion(locator.rootId, summary);
  }

  async relinkLocator(
    locatorId: string,
    targetRootId: string,
    input: ArtifactVersionSummary,
  ): Promise<ArtifactLocatorSummary> {
    const summary = ArtifactVersionSummarySchema.parse(input);
    this.requireMatchingLocator(locatorId, summary);
    return this.verifyArtifactVersion(targetRootId, summary);
  }

  async revealLocator(
    locatorId: string,
    input: ArtifactVersionSummary,
    freshness: ArtifactResolutionFreshness,
  ): Promise<ArtifactLocatorActionResult> {
    return this.launchLocator(locatorId, input, freshness, "reveal");
  }

  async openLocator(
    locatorId: string,
    input: ArtifactVersionSummary,
    freshness: ArtifactResolutionFreshness,
  ): Promise<ArtifactLocatorActionResult> {
    return this.launchLocator(locatorId, input, freshness, "open");
  }

  async createAuthoringDescriptor(
    locatorId: string,
    input: ArtifactVersionSummary,
    requirements: ArtifactCompatibilityRequirements,
  ): Promise<LocalAuthoringArtifactDescriptor> {
    const summary = ArtifactVersionSummarySchema.parse(input);
    if (!artifactVersionMatchesRequirements(summary, requirements)) {
      throw new LocalArtifactActionError("incompatible", 409);
    }
    const stored = this.requireMatchingLocator(locatorId, summary);
    let verified: VerifiedArtifactPaths;
    try {
      verified = await verifyPackage(this.requireRoot(stored.rootId), summary);
    } catch (error) {
      const failure = asVerificationError(error);
      this.repository.recordUnavailable({
        rootId: stored.rootId,
        artifactVersionId: stored.artifactVersionId,
        availability:
          failure.failureClass === "package_missing" ||
          failure.failureClass === "root_unavailable"
            ? "missing"
            : "invalid",
        failureClass: failure.failureClass,
      });
      throw failure;
    }
    const locator = this.repository.recordVerified({
      artifactVersionId: summary.artifactVersionId,
      rootId: stored.rootId,
      relativePackagePath: summary.packageIdentity,
      platform: verified.platform,
      projectId: summary.projectId,
      clipId: summary.clipId,
      requestId: summary.requestId,
      packageIdentity: summary.packageIdentity,
      manifestSha256: summary.manifest.contentSha256,
      manifestSchemaVersion: verified.manifestSchemaVersion,
      resultFingerprint: summary.resultFingerprint,
    });
    if (
      !requirements.acceptedManifestSchemas.includes(
        verified.manifestSchemaVersion,
      )
    ) {
      throw new LocalArtifactActionError("incompatible", 409);
    }
    return LocalAuthoringArtifactDescriptorSchema.parse({
      schemaVersion: 1,
      projectId: summary.projectId,
      clipId: summary.clipId,
      artifactVersionId: summary.artifactVersionId,
      requestId: summary.requestId,
      locatorId: locator.id,
      packageIdentity: summary.packageIdentity,
      resultFingerprint: summary.resultFingerprint,
      manifest: {
        schemaVersion: verified.manifestSchemaVersion,
        contentSha256: summary.manifest.contentSha256,
      },
      packagePath: verified.packagePath,
      artifacts: summary.artifacts.map((artifact) => ({
        role: artifact.role,
        absolutePath: resolve(
          verified.packagePath,
          expectedFilename(artifact.role, summary.requestId),
        ),
        byteSize: artifact.byteSize,
        contentSha256: artifact.contentSha256,
      })),
    });
  }

  async verifyArtifactVersion(
    rootId: string,
    input: ArtifactVersionSummary,
  ): Promise<ArtifactLocatorSummary> {
    const summary = ArtifactVersionSummarySchema.parse(input);
    const existing = this.repository.getLocator(
      rootId,
      summary.artifactVersionId,
    );
    let verified: Awaited<ReturnType<typeof verifyPackage>>;
    try {
      verified = await verifyPackage(this.requireRoot(rootId), summary);
    } catch (error) {
      const failure = asVerificationError(error);
      if (existing) {
        return this.repository.recordUnavailable({
          rootId,
          artifactVersionId: summary.artifactVersionId,
          availability:
            failure.failureClass === "package_missing" ||
            failure.failureClass === "root_unavailable"
              ? "missing"
              : "invalid",
          failureClass: failure.failureClass,
        })!;
      }
      throw failure;
    }
    return this.repository.recordVerified({
      artifactVersionId: summary.artifactVersionId,
      rootId,
      relativePackagePath: summary.packageIdentity,
      platform: verified.platform,
      projectId: summary.projectId,
      clipId: summary.clipId,
      requestId: summary.requestId,
      packageIdentity: summary.packageIdentity,
      manifestSha256: summary.manifest.contentSha256,
      manifestSchemaVersion: verified.manifestSchemaVersion,
      resultFingerprint: summary.resultFingerprint,
    });
  }

  private async launchLocator(
    locatorId: string,
    input: ArtifactVersionSummary,
    freshness: ArtifactResolutionFreshness,
    action: "reveal" | "open",
  ): Promise<ArtifactLocatorActionResult> {
    const summary = ArtifactVersionSummarySchema.parse(input);
    const stored = this.requireMatchingLocator(locatorId, summary);
    if (!this.launcher) throw new LocalArtifactActionError("unsupported");
    let verified: VerifiedArtifactPaths;
    try {
      verified = await verifyPackage(this.requireRoot(stored.rootId), summary);
    } catch (error) {
      const failure = asVerificationError(error);
      this.repository.recordUnavailable({
        rootId: stored.rootId,
        artifactVersionId: stored.artifactVersionId,
        availability:
          failure.failureClass === "package_missing" ||
          failure.failureClass === "root_unavailable"
            ? "missing"
            : "invalid",
        failureClass: failure.failureClass,
      });
      throw failure;
    }
    const locator = this.repository.recordVerified({
      artifactVersionId: summary.artifactVersionId,
      rootId: stored.rootId,
      relativePackagePath: summary.packageIdentity,
      platform: verified.platform,
      projectId: summary.projectId,
      clipId: summary.clipId,
      requestId: summary.requestId,
      packageIdentity: summary.packageIdentity,
      manifestSha256: summary.manifest.contentSha256,
      manifestSchemaVersion: verified.manifestSchemaVersion,
      resultFingerprint: summary.resultFingerprint,
    });
    try {
      if (action === "reveal") {
        await this.launcher.revealPackage(verified.packagePath);
      } else {
        await this.launcher.openMedia(verified.mediaPath);
      }
    } catch {
      throw new LocalArtifactActionError("launch_failed");
    }
    return { locator, freshness };
  }

  private requireLocator(locatorId: string): LocalArtifactLocatorRecord {
    const locator = this.repository.getLocatorById(locatorId);
    if (!locator) throw new LocalArtifactActionError("not_found", 404);
    return locator;
  }

  private requireMatchingLocator(
    locatorId: string,
    summary: ArtifactVersionSummary,
  ): LocalArtifactLocatorRecord {
    const locator = this.requireLocator(locatorId);
    if (
      locator.artifactVersionId !== summary.artifactVersionId ||
      locator.projectId !== summary.projectId ||
      locator.clipId !== summary.clipId ||
      locator.requestId !== summary.requestId ||
      locator.packageIdentity !== summary.packageIdentity ||
      locator.manifestSha256 !== summary.manifest.contentSha256 ||
      locator.resultFingerprint !== summary.resultFingerprint
    ) {
      throw new LocalArtifactActionError("identity_mismatch", 409);
    }
    return locator;
  }

  private requireRoot(rootId: string): LocalArtifactRootRecord {
    const root = this.repository.getRoot(rootId);
    if (!root || !root.enabled) {
      throw verificationError("root_unavailable");
    }
    return root;
  }
}

export function validateArtifactPackageSegment(
  value: string,
  platform: ArtifactStoragePlatform,
): string {
  if (
    !PackageIdentityPattern.test(value) ||
    value !== value.normalize("NFC") ||
    value !== value.toLocaleLowerCase("en-US") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[a-zA-Z]:/u.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw verificationError("unsafe_path");
  }
  if (platform === "windows" && isWindowsReservedSegment(value)) {
    throw verificationError("unsafe_path");
  }
  return value;
}

export function validateConfiguredRootPath(
  value: string,
  platform: ArtifactStoragePlatform,
): string {
  if (
    !value ||
    value.includes("\0") ||
    value !== value.normalize("NFC") ||
    (platform === "posix" ? !posix.isAbsolute(value) : !win32.isAbsolute(value))
  ) {
    throw verificationError("unsafe_path");
  }
  if (
    platform === "windows" &&
    (/^\\\\/u.test(value) || /^[a-zA-Z]:[^\\/]/u.test(value))
  ) {
    throw verificationError("unsafe_path");
  }
  return value;
}

async function verifyPackage(
  root: LocalArtifactRootRecord,
  summary: ArtifactVersionSummary,
): Promise<VerifiedArtifactPaths> {
  requireHostPlatform(root.platform);
  const packageIdentity = validateArtifactPackageSegment(
    summary.packageIdentity,
    root.platform,
  );
  if (packageIdentity !== `clip-${summary.requestId}`) {
    throw verificationError("identity_mismatch");
  }
  const rootEvidence = await inspectRoot(root.absolutePath).catch(() => {
    throw verificationError("root_unavailable");
  });
  if (
    rootEvidence.realPath !== root.absolutePath ||
    rootEvidence.filesystemIdentity !== root.filesystemIdentity
  ) {
    throw verificationError("root_changed");
  }
  const packagePath = resolve(rootEvidence.realPath, packageIdentity);
  if (
    !packagePath.startsWith(`${rootEvidence.realPath}${sep}`) ||
    packagePath === rootEvidence.realPath
  ) {
    throw verificationError("unsafe_path");
  }
  const packageInfo = await lstat(packagePath, { bigint: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw verificationError("package_missing");
      throw verificationError("io_error");
    },
  );
  if (!packageInfo.isDirectory() || packageInfo.isSymbolicLink()) {
    throw verificationError("filesystem_untrusted");
  }
  const packageRealPath = await realpath(packagePath).catch(() => {
    throw verificationError("filesystem_untrusted");
  });
  if (packageRealPath !== packagePath) {
    throw verificationError("filesystem_untrusted");
  }

  assertSuccessFingerprint(summary);
  const expectedNames = expectedArtifactNames(summary);
  const entries = await readdir(packagePath, { withFileTypes: true }).catch(
    () => {
      throw verificationError("io_error");
    },
  );
  if (
    entries.length !== expectedNames.size ||
    entries.some(
      (entry) =>
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !expectedNames.has(entry.name) ||
        entry.name !== entry.name.normalize("NFC"),
    )
  ) {
    throw verificationError("artifact_mismatch");
  }

  const manifestArtifact = summary.artifacts.find(
    (artifact) => artifact.role === "manifest_json",
  )!;
  const manifestBytes = await hashStableRegularFile(
    resolve(packagePath, "manifest.json"),
    manifestArtifact.byteSize,
    true,
  );
  if (manifestBytes.sha256 !== summary.manifest.contentSha256) {
    throw verificationError("manifest_invalid");
  }
  const manifestRaw = parseBoundedJson(manifestBytes.contents!);
  const manifestResult = ExportClipManifestSchema.safeParse(manifestRaw);
  if (!manifestResult.success) throw verificationError("unsupported_schema");
  const manifest = manifestResult.data;
  if (canonicalJson(manifestRaw) !== canonicalJson(manifest)) {
    throw verificationError("manifest_invalid");
  }
  if (
    (summary.manifest.schemaVersion !== "unknown" &&
      summary.manifest.schemaVersion !== manifest.schemaVersion) ||
    (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2)
  ) {
    throw verificationError("unsupported_schema");
  }

  assertManifestIdentity(manifest, summary);
  const manifestArtifacts = new Map(
    manifest.artifacts.map((artifact) => [artifact.role, artifact]),
  );
  assertManifestArtifactEvidence(manifestArtifacts, summary);
  for (const artifact of summary.artifacts) {
    if (artifact.role === "manifest_json") continue;
    const named = manifestArtifacts.get(artifact.role);
    const expectedName = expectedFilename(artifact.role, summary.requestId);
    if (
      !named ||
      named.filename !== expectedName ||
      named.byteSize !== artifact.byteSize ||
      named.contentSha256 !== artifact.contentSha256
    ) {
      throw verificationError("artifact_mismatch");
    }
    const actual = await hashStableRegularFile(
      resolve(packagePath, expectedName),
      artifact.byteSize,
      artifact.role === "clip_metadata_json",
    );
    if (actual.sha256 !== artifact.contentSha256) {
      throw verificationError("artifact_mismatch");
    }
    if (artifact.role === "clip_metadata_json") {
      assertMetadata(actual.contents!, summary);
    }
  }
  if (manifestArtifacts.size !== summary.artifacts.length - 1) {
    throw verificationError("artifact_mismatch");
  }

  const endingRoot = await inspectRoot(root.absolutePath).catch(() => {
    throw verificationError("root_changed");
  });
  const endingPackage = await lstat(packagePath, { bigint: true }).catch(() => {
    throw verificationError("filesystem_untrusted");
  });
  if (
    endingRoot.filesystemIdentity !== root.filesystemIdentity ||
    endingPackage.dev !== packageInfo.dev ||
    endingPackage.ino !== packageInfo.ino ||
    endingPackage.mtimeNs !== packageInfo.mtimeNs
  ) {
    throw verificationError("filesystem_untrusted");
  }
  return {
    platform: root.platform,
    manifestSchemaVersion: manifest.schemaVersion,
    packagePath,
    mediaPath: resolve(
      packagePath,
      expectedFilename(
        summary.artifacts.find((artifact) =>
          artifact.role.startsWith("video_"),
        )!.role,
        summary.requestId,
      ),
    ),
  };
}

function assertManifestArtifactEvidence(
  artifacts: Map<
    string,
    ReturnType<typeof ExportClipManifestSchema.parse>["artifacts"][number]
  >,
  summary: ArtifactVersionSummary,
) {
  const thumbnail = artifacts.get("thumbnail_jpg");
  if (
    !thumbnail ||
    canonicalJson(thumbnail.thumbnail) !==
      canonicalJson({
        extractionTimeMs: summary.thumbnailProvenance.extractionTimeMs,
        width: summary.thumbnailProvenance.width,
        height: summary.thumbnailProvenance.height,
        jpegQuality: 3,
      })
  ) {
    throw verificationError("snapshot_mismatch");
  }

  const expectedSidecars = summary.englishSubtitleProvenance
    ? [
        {
          role: "english" as const,
          language: "en",
          ...summary.englishSubtitleProvenance,
        },
      ]
    : (summary.subtitleSidecars ?? []);
  const expectedRoles = new Set(
    expectedSidecars.map((sidecar) => `${sidecar.role}_srt`),
  );
  for (const role of ["english_srt", "original_srt"] as const) {
    const artifact = artifacts.get(role);
    const provenance = expectedSidecars.find(
      (sidecar) => `${sidecar.role}_srt` === role,
    );
    if (!provenance) {
      if (artifact) throw verificationError("snapshot_mismatch");
      continue;
    }
    if (
      !artifact ||
      artifact.byteSize !== provenance.byteSize ||
      artifact.contentSha256 !== provenance.contentSha256 ||
      canonicalJson(artifact.subtitle) !==
        canonicalJson({
          language: provenance.language,
          trackId: provenance.trackId,
          trackVersion: provenance.trackVersion,
          timingPrecision: summary.selection.timingPrecision,
          cueCount: provenance.cueCount,
          startMs: provenance.startMs,
          endMs: provenance.endMs,
        })
    ) {
      throw verificationError("snapshot_mismatch");
    }
  }
  if (
    [...artifacts.keys()].some(
      (role) =>
        (role === "english_srt" || role === "original_srt") &&
        !expectedRoles.has(role),
    )
  ) {
    throw verificationError("snapshot_mismatch");
  }
  for (const artifact of artifacts.values()) {
    if (
      (artifact.role !== "thumbnail_jpg" && artifact.thumbnail) ||
      (artifact.role !== "english_srt" &&
        artifact.role !== "original_srt" &&
        artifact.subtitle)
    ) {
      throw verificationError("snapshot_mismatch");
    }
  }
}

function assertSuccessFingerprint(summary: ArtifactVersionSummary) {
  const result = LoggedExportSuccessResultSchema.parse({
    schemaVersion: 1,
    requestId: summary.requestId,
    jobId: summary.jobId,
    projectId: summary.projectId,
    clipId: summary.clipId,
    sourceLanguageClass: summary.sourceLanguageClass,
    resolvedExportBounds: summary.resolvedExportBounds,
    renderedMediaProvenance: summary.renderedMediaProvenance,
    thumbnailProvenance: summary.thumbnailProvenance,
    ...(summary.subtitleOmissionProvenance
      ? { subtitleOmissionProvenance: summary.subtitleOmissionProvenance }
      : {}),
    ...(summary.englishSubtitleProvenance
      ? { englishSubtitleProvenance: summary.englishSubtitleProvenance }
      : {}),
    ...(summary.subtitleSidecars
      ? { subtitleSidecars: summary.subtitleSidecars }
      : {}),
    artifacts: summary.artifacts,
  });
  if (sha256Fingerprint(result) !== summary.resultFingerprint) {
    throw verificationError("identity_mismatch");
  }
}

function assertManifestIdentity(
  manifest: ReturnType<typeof ExportClipManifestSchema.parse>,
  summary: ArtifactVersionSummary,
) {
  const expectedPolicy = summary.subtitleOmissionProvenance
    ? {
        requiredSidecars: [] as string[],
        subtitleSidecarsOmittedReason:
          summary.subtitleOmissionProvenance.policy,
      }
    : summary.sourceLanguageClass === "confirmed_english"
      ? { requiredSidecars: ["english"] }
      : { requiredSidecars: ["original", "english"] };
  if (
    manifest.exportRequestId !== summary.requestId ||
    manifest.jobId !== summary.jobId ||
    manifest.mode !== "logged" ||
    manifest.packageIdentity !== summary.packageIdentity ||
    manifest.sourceAttempt !== summary.resolvedExportBounds.sourceAttempt ||
    manifest.validatedAt !== summary.renderedMediaProvenance.validatedAt ||
    canonicalJson(manifest.video) !== canonicalJson(summary.video) ||
    manifest.sourceLanguageClass !== summary.sourceLanguageClass ||
    canonicalJson(manifest.resolvedExportBounds) !==
      canonicalJson({
        startMs: summary.resolvedExportBounds.startMs,
        endMs: summary.resolvedExportBounds.endMs,
        sourceAttempt: summary.resolvedExportBounds.sourceAttempt,
      }) ||
    manifest.renderedDurationMs !==
      summary.renderedMediaProvenance.durationMs ||
    canonicalJson(manifest.subtitlePolicy) !== canonicalJson(expectedPolicy) ||
    manifest.toolVersions.ffprobeVersion !==
      summary.renderedMediaProvenance.ffprobeVersion ||
    manifest.toolVersions.ffmpegVersion !==
      summary.renderedMediaProvenance.ffmpegVersion
  ) {
    throw verificationError("snapshot_mismatch");
  }
  if (
    manifest.schemaVersion === 2 &&
    (manifest.settingsSha256 !==
      summary.renderedMediaProvenance.settingsSha256 ||
      canonicalJson(manifest.resolvedSettingsSnapshot) !==
        canonicalJson(summary.resolvedSettingsSnapshot) ||
      canonicalJson(manifest.observedMedia) !==
        canonicalJson(summary.renderedMediaProvenance.observedProperties))
  ) {
    throw verificationError("snapshot_mismatch");
  }
}

function assertMetadata(contents: Buffer, summary: ArtifactVersionSummary) {
  const raw = parseBoundedJson(contents);
  const result = ExportClipMetadataSchema.safeParse(raw);
  if (!result.success || canonicalJson(raw) !== canonicalJson(result.data)) {
    throw verificationError("snapshot_mismatch");
  }
  const metadata = result.data;
  if (
    metadata.exportRequestId !== summary.requestId ||
    metadata.jobId !== summary.jobId ||
    metadata.mode !== "logged" ||
    metadata.packageIdentity !== summary.packageIdentity ||
    metadata.sourceAttempt !== summary.resolvedExportBounds.sourceAttempt ||
    metadata.validatedAt !== summary.renderedMediaProvenance.validatedAt ||
    canonicalJson(metadata.video) !== canonicalJson(summary.video) ||
    metadata.sourceLanguageClass !== summary.sourceLanguageClass ||
    canonicalJson(metadata.selection) !== canonicalJson(summary.selection) ||
    canonicalJson(metadata.preset) !== canonicalJson(summary.preset) ||
    canonicalJson(metadata.subtitlePolicy) !==
      canonicalJson(
        summary.subtitleOmissionProvenance
          ? {
              requiredSidecars: [],
              subtitleSidecarsOmittedReason:
                summary.subtitleOmissionProvenance.policy,
            }
          : summary.sourceLanguageClass === "confirmed_english"
            ? { requiredSidecars: ["english"] }
            : { requiredSidecars: ["original", "english"] },
      ) ||
    canonicalJson(metadata.subtitleTracks) !==
      canonicalJson(summary.subtitleTracks) ||
    canonicalJson(metadata.resolvedExportBounds) !==
      canonicalJson({
        startMs: summary.resolvedExportBounds.startMs,
        endMs: summary.resolvedExportBounds.endMs,
        sourceAttempt: summary.resolvedExportBounds.sourceAttempt,
      }) ||
    metadata.renderedDurationMs !== summary.renderedMediaProvenance.durationMs
  ) {
    throw verificationError("snapshot_mismatch");
  }
  if (
    metadata.schemaVersion === 1 &&
    canonicalJson(metadata.preset) !==
      canonicalJson(
        resolvedPresetForCompatibility(summary.resolvedSettingsSnapshot),
      )
  ) {
    throw verificationError("unsupported_schema");
  }
  if (metadata.schemaVersion === 2) {
    const observed = summary.renderedMediaProvenance.observedProperties;
    const renderer = rendererCapabilityForSettings(
      summary.resolvedSettingsSnapshot.settings,
    );
    const videoRole = summary.artifacts.find((artifact) =>
      artifact.role.startsWith("video_"),
    )?.role;
    if (!observed || !renderer || !videoRole) {
      throw verificationError("snapshot_mismatch");
    }
    const expectedConversion = {
      rendererCapabilityId: renderer.id,
      videoRole,
      videoFilename: expectedFilename(videoRole, summary.requestId),
      container: summary.resolvedSettingsSnapshot.settings.container,
      videoCodec: summary.resolvedSettingsSnapshot.settings.videoCodec,
      videoProfile: observed.video.profile,
      pixelFormat: observed.video.pixelFormat,
      width: observed.video.width,
      height: observed.video.height,
      frameRate: observed.video.averageFrameRate,
      audioCodec: summary.resolvedSettingsSnapshot.settings.audioCodec,
      audioSampleRate: observed.audio.sampleRate,
      audioChannels: observed.audio.channels,
      ...(observed.subtitle
        ? {
            embeddedEnglishSubtitle: {
              codec: observed.subtitle.codec,
              language: "eng",
              ...(observed.subtitle.title === "English"
                ? { title: "English" }
                : {}),
              default: false,
              forced: false,
            },
          }
        : {}),
    };
    if (
      canonicalJson(metadata.conversion) !== canonicalJson(expectedConversion)
    ) {
      throw verificationError("snapshot_mismatch");
    }
  }
}

function expectedArtifactNames(summary: ArtifactVersionSummary) {
  return new Set(
    summary.artifacts.map((artifact) =>
      expectedFilename(artifact.role, summary.requestId),
    ),
  );
}

function expectedFilename(role: string, requestId: string): string {
  const packageIdentity = `clip-${requestId}`;
  const filenames: Record<string, string> = {
    video_mp4: `${packageIdentity}.mp4`,
    video_mkv: `${packageIdentity}.mkv`,
    video_mov: `${packageIdentity}.mov`,
    english_srt: `${packageIdentity}.en.srt`,
    original_srt: `${packageIdentity}.original.srt`,
    clip_metadata_json: `${packageIdentity}.json`,
    thumbnail_jpg: `${packageIdentity}.jpg`,
    manifest_json: "manifest.json",
  };
  const filename = filenames[role];
  if (!filename) throw verificationError("artifact_mismatch");
  return filename;
}

async function inspectRoot(path: string) {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw verificationError("root_unavailable");
  }
  const resolvedPath = await realpath(path);
  return {
    realPath: resolvedPath,
    filesystemIdentity: `${info.dev}:${info.ino}`,
  };
}

async function hashStableRegularFile(
  path: string,
  expectedSize: number,
  collectContents: boolean,
): Promise<{ sha256: string; contents?: Buffer }> {
  const before = await lstat(path, { bigint: true }).catch(() => {
    throw verificationError("artifact_mismatch");
  });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size !== BigInt(expectedSize) ||
    (collectContents && expectedSize > MaxPackageJsonBytes)
  ) {
    throw verificationError("filesystem_untrusted");
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
    );
    const opened = await handle.stat({ bigint: true });
    assertSameFile(before, opened);
    const hash = createHash("sha256");
    let contents: Buffer | undefined;
    if (collectContents) {
      contents = await handle.readFile();
      hash.update(contents);
    } else {
      const stream = handle.createReadStream({ autoClose: false });
      for await (const chunk of stream) hash.update(chunk);
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstat(path, { bigint: true });
    assertSameFile(opened, afterHandle);
    assertSameFile(opened, afterPath);
    return { sha256: hash.digest("hex"), ...(contents ? { contents } : {}) };
  } catch (error) {
    if (error instanceof LocalArtifactVerificationError) throw error;
    throw verificationError("filesystem_untrusted");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function assertSameFile(left: BigIntStats, right: BigIntStats) {
  if (
    !right.isFile() ||
    right.isSymbolicLink() ||
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    left.size !== right.size ||
    left.mtimeNs !== right.mtimeNs ||
    right.nlink !== 1n
  ) {
    throw verificationError("filesystem_untrusted");
  }
}

function parseBoundedJson(contents: Buffer): unknown {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    throw verificationError("manifest_invalid");
  }
}

function requireHostPlatform(platform: ArtifactStoragePlatform) {
  if ((platform === "windows") !== (process.platform === "win32")) {
    throw verificationError("filesystem_untrusted");
  }
}

function isWindowsReservedSegment(value: string) {
  const stem = value.split(".")[0]!.toUpperCase();
  return (
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem) ||
    /[<>:"|?*\u0000-\u001f]/u.test(value) ||
    /[ .]$/u.test(value)
  );
}

export class LocalArtifactVerificationError extends Error {
  readonly statusCode = 422;
  readonly code: string;

  constructor(readonly failureClass: ArtifactVerificationFailureClass) {
    super("Local artifact verification failed.");
    this.code = `artifact_verification_${failureClass}`;
  }
}

export class LocalArtifactActionError extends Error {
  readonly code: string;

  constructor(
    actionClass:
      | "not_found"
      | "identity_mismatch"
      | "incompatible"
      | "unsupported"
      | "launch_failed",
    readonly statusCode = 422,
  ) {
    super("Local artifact action failed.");
    this.code = `artifact_action_${actionClass}`;
  }
}

function verificationError(failureClass: ArtifactVerificationFailureClass) {
  return new LocalArtifactVerificationError(failureClass);
}

function asVerificationError(error: unknown) {
  return error instanceof LocalArtifactVerificationError
    ? error
    : verificationError("io_error");
}
