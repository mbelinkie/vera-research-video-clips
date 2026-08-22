import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactVersionSummarySchema,
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
  LoggedExportSuccessResultSchema,
  type ArtifactVersionSummary,
} from "@research-video/contracts";
import {
  canonicalJson,
  resolveExportSettings,
  resolvedPresetForCompatibility,
  sha256Fingerprint,
} from "@research-video/export-settings";
import {
  LocalArtifactLocatorRepository,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import {
  LocalArtifactLocatorService,
  validateArtifactPackageSegment,
  validateConfiguredRootPath,
} from "./artifact-locators.ts";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

describe("local artifact locator verification", () => {
  it("verifies, persists, restarts, and invalidates one exact M5 package", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const repository = new LocalArtifactLocatorRepository(
      database,
      () => new Date("2026-08-22T12:00:00.000Z"),
    );
    const service = new LocalArtifactLocatorService(repository);
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot);

    const verified = await service.verifyArtifactVersion(
      configured.id,
      fixture.summary,
    );
    expect(verified).toMatchObject({
      artifactVersionId: fixture.summary.artifactVersionId,
      rootId: configured.id,
      availability: "verified",
      manifestSchemaVersion: 2,
    });
    expect(JSON.stringify({ configured, verified })).not.toMatch(
      /absolutePath|relativePackagePath|manifest\.json|clip-.*\.mp4|artifact-locator-/u,
    );
    expect(new LocalArtifactLocatorRepository(database).listLocators()).toEqual(
      [verified],
    );

    for (const { path, bytes } of fixture.artifactFiles) {
      const tampered = Buffer.from(bytes);
      tampered[0] = tampered[0]! ^ 1;
      await writeFile(path, tampered);
      expect(
        await service.verifyArtifactVersion(configured.id, fixture.summary),
      ).toMatchObject({
        id: verified.id,
        availability: "invalid",
        failureClass: expect.stringMatching(
          /^(?:artifact_mismatch|manifest_invalid)$/u,
        ),
        lastVerifiedAt: verified.lastVerifiedAt,
      });
      await writeFile(path, bytes);
      expect(
        await service.verifyArtifactVersion(configured.id, fixture.summary),
      ).toMatchObject({ id: verified.id, availability: "verified" });
    }
    const movedPackage = `${fixture.packagePath}-moved`;
    await rename(fixture.packagePath, movedPackage);
    expect(
      await service.verifyArtifactVersion(configured.id, fixture.summary),
    ).toMatchObject({
      id: verified.id,
      availability: "missing",
      failureClass: "package_missing",
      lastVerifiedAt: verified.lastVerifiedAt,
    });
    await rename(movedPackage, fixture.packagePath);
    expect(
      await service.verifyArtifactVersion(configured.id, fixture.summary),
    ).toMatchObject({ id: verified.id, availability: "verified" });
    database.close();
  });

  it("adopts a supported version-one M5 package without guessing its schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-v1-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const service = new LocalArtifactLocatorService(
      new LocalArtifactLocatorRepository(database),
    );
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot, 1);

    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).resolves.toMatchObject({
      availability: "verified",
      manifestSchemaVersion: 1,
    });
    database.close();
  });

  it("binds a confirmed-English sidecar ledger to its success provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-sidecar-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const service = new LocalArtifactLocatorService(
      new LocalArtifactLocatorRepository(database),
    );
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot, 2, "english");
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).resolves.toMatchObject({ availability: "verified" });
    const contradictoryWithoutFingerprint = {
      ...fixture.summary,
      englishSubtitleProvenance: {
        ...fixture.summary.englishSubtitleProvenance!,
        byteSize: fixture.summary.englishSubtitleProvenance!.byteSize + 1,
      },
    };
    const contradictory = ArtifactVersionSummarySchema.parse({
      ...contradictoryWithoutFingerprint,
      resultFingerprint: sha256Fingerprint(
        successResultForSummary(contradictoryWithoutFingerprint),
      ),
    });
    await expect(
      service.verifyArtifactVersion(configured.id, contradictory),
    ).resolves.toMatchObject({
      availability: "invalid",
      failureClass: "snapshot_mismatch",
    });
    database.close();
  });

  it("verifies both exact sidecars for a foreign-language package", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-bilingual-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const service = new LocalArtifactLocatorService(
      new LocalArtifactLocatorRepository(database),
    );
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot, 2, "bilingual");

    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).resolves.toMatchObject({ availability: "verified" });
    database.close();
  });

  it("rejects unexpected entries, links, and changed roots without adopting bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-hostile-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const repository = new LocalArtifactLocatorRepository(database);
    const service = new LocalArtifactLocatorService(repository);
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot);
    await writeFile(join(fixture.packagePath, ".DS_Store"), "extra");
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).rejects.toMatchObject({
      code: "artifact_verification_artifact_mismatch",
    });
    expect(repository.listLocators()).toEqual([]);
    await rm(join(fixture.packagePath, ".DS_Store"));
    const external = join(root, "external-video");
    await writeFile(external, fixture.videoBytes);
    await rm(fixture.videoPath);
    await symlink(external, fixture.videoPath);
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).rejects.toMatchObject({
      code: "artifact_verification_artifact_mismatch",
    });
    expect(repository.listLocators()).toEqual([]);
    await rm(fixture.videoPath);
    await writeFile(fixture.videoPath, fixture.videoBytes);
    const hardlink = join(root, "hardlinked-video");
    await link(fixture.videoPath, hardlink);
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).rejects.toMatchObject({
      code: "artifact_verification_filesystem_untrusted",
    });
    await rm(hardlink);
    await rm(fixture.videoPath);
    await mkdir(fixture.videoPath);
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).rejects.toMatchObject({
      code: "artifact_verification_artifact_mismatch",
    });
    await rm(fixture.packagePath, { recursive: true });
    await rename(packageRoot, `${packageRoot}-replaced`);
    await mkdir(packageRoot);
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).rejects.toMatchObject({
      code: "artifact_verification_root_changed",
    });
    database.close();
  });

  it("does not overwrite verified evidence when locator persistence conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-conflict-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const repository = new LocalArtifactLocatorRepository(database);
    const service = new LocalArtifactLocatorService(repository);
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot);
    const prior = repository.recordVerified({
      artifactVersionId: fixture.summary.artifactVersionId,
      rootId: configured.id,
      relativePackagePath: fixture.summary.packageIdentity,
      platform: "posix",
      projectId: randomUUID(),
      clipId: fixture.summary.clipId,
      requestId: fixture.summary.requestId,
      packageIdentity: fixture.summary.packageIdentity,
      manifestSha256: fixture.summary.manifest.contentSha256,
      manifestSchemaVersion: 2,
      resultFingerprint: fixture.summary.resultFingerprint,
    });
    await expect(
      service.verifyArtifactVersion(configured.id, fixture.summary),
    ).rejects.toMatchObject({ code: "artifact_catalog_conflict" });
    expect(
      repository.getLocator(configured.id, fixture.summary.artifactVersionId),
    ).toEqual(prior);
    database.close();
  });

  it.runIf(process.platform === "win32")(
    "rejects a physical Windows package junction",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "artifact-junction-win32-"));
      temporaryRoots.add(root);
      const database = openLocalDatabase(join(root, "local.sqlite"));
      runLocalMigrations(database);
      const repository = new LocalArtifactLocatorRepository(database);
      const service = new LocalArtifactLocatorService(repository);
      const packageRoot = join(root, "exports");
      await mkdir(packageRoot);
      const configured = await service.configureRoot({
        label: "Managed exports",
        platform: "windows",
        absolutePath: packageRoot,
      });
      const fixture = await writeVerifiedPackage(packageRoot);
      const external = join(root, "external-package");
      await rename(fixture.packagePath, external);
      await symlink(external, fixture.packagePath, "junction");

      await expect(
        service.verifyArtifactVersion(configured.id, fixture.summary),
      ).rejects.toMatchObject({
        code: "artifact_verification_filesystem_untrusted",
      });
      expect(repository.listLocators()).toEqual([]);
      database.close();
    },
  );

  it("rejects a self-consistent hash ledger whose manifest contradicts success provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-locator-lineage-"));
    temporaryRoots.add(root);
    const database = openLocalDatabase(join(root, "local.sqlite"));
    runLocalMigrations(database);
    const repository = new LocalArtifactLocatorRepository(database);
    const service = new LocalArtifactLocatorService(repository);
    const packageRoot = join(root, "exports");
    await mkdir(packageRoot);
    const configured = await service.configureRoot({
      label: "Managed exports",
      platform: "posix",
      absolutePath: packageRoot,
    });
    const fixture = await writeVerifiedPackage(packageRoot);
    const manifestPath = join(fixture.packagePath, "manifest.json");
    const original = ExportClipManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    const contradictory = ExportClipManifestSchema.parse({
      ...original,
      artifacts: original.artifacts.map((artifact) =>
        artifact.role === "thumbnail_jpg"
          ? {
              ...artifact,
              thumbnail: {
                ...artifact.thumbnail!,
                extractionTimeMs: artifact.thumbnail!.extractionTimeMs + 1,
              },
            }
          : artifact,
      ),
    });
    const manifestBytes = Buffer.from(canonicalJson(contradictory));
    await writeFile(manifestPath, manifestBytes);
    const artifacts = fixture.summary.artifacts.map((artifact) =>
      artifact.role === "manifest_json"
        ? {
            ...artifact,
            byteSize: manifestBytes.byteLength,
            contentSha256: sha(manifestBytes),
          }
        : artifact,
    );
    const summaryWithoutFingerprint = {
      ...fixture.summary,
      artifacts,
      manifest: {
        contentSha256: sha(manifestBytes),
        schemaVersion: 2 as const,
      },
    };
    const summary = ArtifactVersionSummarySchema.parse({
      ...summaryWithoutFingerprint,
      resultFingerprint: sha256Fingerprint(
        successResultForSummary(summaryWithoutFingerprint),
      ),
    });

    await expect(
      service.verifyArtifactVersion(configured.id, summary),
    ).rejects.toMatchObject({
      code: "artifact_verification_snapshot_mismatch",
    });
    expect(repository.listLocators()).toEqual([]);
    database.close();
  });

  it("rejects portable path ambiguity before filesystem access", () => {
    const requestId = randomUUID();
    expect(validateArtifactPackageSegment(`clip-${requestId}`, "posix")).toBe(
      `clip-${requestId}`,
    );
    for (const candidate of [
      "../clip-019fbb95-cd76-7920-93fa-e23ba755ee61",
      "/clip-019fbb95-cd76-7920-93fa-e23ba755ee61",
      "C:clip-019fbb95-cd76-7920-93fa-e23ba755ee61",
      "C:\\clip-019fbb95-cd76-7920-93fa-e23ba755ee61",
      "\\\\server\\clip-019fbb95-cd76-7920-93fa-e23ba755ee61",
      "\\\\?\\C:\\clip-019fbb95-cd76-7920-93fa-e23ba755ee61",
      "clip-019FBB95-CD76-7920-93FA-E23BA755EE61",
      "clip-019fbb95-cd76-7920-93fa-e23ba755ee61:stream",
      "CON",
      "clip-019fbb95-cd76-7920-93fa-e23ba755ee61/child",
      "clip-019fbb95-cd76-7920-93fa-e23ba755ee61\\child",
      "clip-019fbb95-cd76-7920-93fa-e23ba755ee61\0",
    ]) {
      expect(() =>
        validateArtifactPackageSegment(candidate, "windows"),
      ).toThrowError(
        expect.objectContaining({ code: "artifact_verification_unsafe_path" }),
      );
    }
    expect(() => validateConfiguredRootPath("C:relative", "windows")).toThrow();
    expect(() =>
      validateConfiguredRootPath("\\\\?\\C:\\root", "windows"),
    ).toThrow();
    expect(() =>
      validateConfiguredRootPath("\\\\server\\share", "windows"),
    ).toThrow();
    expect(() => validateConfiguredRootPath("relative", "posix")).toThrow();
  });
});

async function writeVerifiedPackage(
  root: string,
  schemaVersion: 1 | 2 = 2,
  subtitleMode: "omission" | "english" | "bilingual" = "omission",
) {
  const at = "2026-08-22T11:59:00.000Z";
  const requestId = randomUUID();
  const jobId = randomUUID();
  const projectId = randomUUID();
  const clipId = randomUUID();
  const artifactVersionId = randomUUID();
  const trackId = randomUUID();
  const englishTrackId = subtitleMode === "bilingual" ? randomUUID() : trackId;
  const sourceLanguageClass =
    subtitleMode === "bilingual"
      ? ("foreign" as const)
      : ("confirmed_english" as const);
  const subtitleTracks =
    subtitleMode === "bilingual"
      ? {
          original: { trackId, trackVersion: 1 },
          english: { trackId: englishTrackId, trackVersion: 1 },
        }
      : undefined;
  const packageIdentity = `clip-${requestId}`;
  const video = {
    youtubeVideoId: "M7lc1UVf-VE",
    canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    title: "Fixture video",
  };
  const selection = {
    trackId,
    transcriptVersion: 1,
    firstSegmentId: randomUUID(),
    lastSegmentId: randomUUID(),
    transcriptStartMs: 0,
    transcriptEndMs: 1_000,
    exportStartMs: 0,
    exportEndMs: 1_000,
    text: "Fixture selection",
    timingPrecision: "cue" as const,
  };
  const resolved = resolveExportSettings({
    context: "logged",
    sourceLanguageClass,
    useApplicationDefault: true,
    overrides: {
      omitSubtitleFilesForConfirmedEnglish: subtitleMode === "omission",
    },
    resolvedAt: at,
  }).snapshot;
  const preset = resolvedPresetForCompatibility(resolved);
  const observed = {
    schemaVersion: 1 as const,
    container: { formatNames: ["mp4"] },
    streamCounts: {
      total: 2,
      video: 1,
      audio: 1,
      subtitle: 0,
      data: 0,
      other: 0,
    },
    video: {
      codec: "h264",
      profile: "High",
      pixelFormat: "yuv420p",
      width: 640,
      height: 360,
      sampleAspectRatio: { numerator: 1, denominator: 1 },
      displayAspectRatio: { numerator: 16, denominator: 9 },
      averageFrameRate: { numerator: 30, denominator: 1 },
    },
    audio: {
      codec: "aac",
      sampleRate: 48_000,
      channels: 2,
      channelLayout: "stereo",
    },
    durationMs: 1_000,
    ffprobeVersion: "8.1.2",
  };
  const videoBytes = Buffer.from("video");
  const thumbnailBytes = Buffer.from("jpeg");
  const subtitleBytes = Buffer.from(
    "1\n00:00:00,000 --> 00:00:01,000\nFixture selection\n",
  );
  const originalSubtitleBytes = Buffer.from(
    "1\n00:00:00,000 --> 00:00:01,000\nSelección original\n",
  );
  const englishSubtitleProvenance = {
    trackId: englishTrackId,
    trackVersion: 1,
    cueCount: 1,
    byteSize: subtitleBytes.byteLength,
    contentSha256: sha(subtitleBytes),
    startMs: 0,
    endMs: 1_000,
    sourceAttempt: 1,
    validatedAt: at,
  };
  const subtitleSidecars =
    subtitleMode === "bilingual"
      ? [
          {
            role: "english" as const,
            language: "en",
            ...englishSubtitleProvenance,
          },
          {
            role: "original" as const,
            language: "es",
            trackId,
            trackVersion: 1,
            cueCount: 1,
            byteSize: originalSubtitleBytes.byteLength,
            contentSha256: sha(originalSubtitleBytes),
            startMs: 0,
            endMs: 1_000,
            sourceAttempt: 1,
            validatedAt: at,
          },
        ]
      : undefined;
  const metadata = ExportClipMetadataSchema.parse({
    schemaVersion,
    exportRequestId: requestId,
    jobId,
    mode: "logged",
    packageIdentity,
    sourceAttempt: 1,
    validatedAt: at,
    video,
    sourceLanguageClass,
    ...(subtitleTracks ? { subtitleTracks } : {}),
    selection,
    resolvedExportBounds: { startMs: 0, endMs: 1_000, sourceAttempt: 1 },
    renderedDurationMs: 1_000,
    preset,
    subtitlePolicy:
      subtitleMode === "omission"
        ? {
            requiredSidecars: [],
            subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
          }
        : subtitleMode === "english"
          ? { requiredSidecars: ["english"] }
          : { requiredSidecars: ["original", "english"] },
    ...(schemaVersion === 2
      ? {
          conversion: {
            rendererCapabilityId: "h264_mp4",
            videoRole: "video_mp4",
            videoFilename: `${packageIdentity}.mp4`,
            container: "mp4",
            videoCodec: "h264",
            videoProfile: "High",
            pixelFormat: "yuv420p",
            width: 640,
            height: 360,
            frameRate: { numerator: 30, denominator: 1 },
            audioCodec: "aac",
            audioSampleRate: 48_000,
            audioChannels: 2,
          },
        }
      : {}),
  });
  const metadataBytes = Buffer.from(canonicalJson(metadata));
  const artifact = (role: string, filename: string, bytes: Buffer) => ({
    role,
    filename,
    byteSize: bytes.byteLength,
    contentSha256: sha(bytes),
  });
  const manifest = ExportClipManifestSchema.parse({
    schemaVersion,
    exportRequestId: requestId,
    jobId,
    mode: "logged",
    packageIdentity,
    sourceAttempt: 1,
    validatedAt: at,
    video,
    sourceLanguageClass,
    resolvedExportBounds: { startMs: 0, endMs: 1_000, sourceAttempt: 1 },
    renderedDurationMs: 1_000,
    subtitlePolicy:
      subtitleMode === "omission"
        ? {
            requiredSidecars: [],
            subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
          }
        : subtitleMode === "english"
          ? { requiredSidecars: ["english"] }
          : { requiredSidecars: ["original", "english"] },
    toolVersions: { ffprobeVersion: "8.1.2", ffmpegVersion: "8.1.2" },
    ...(schemaVersion === 2
      ? {
          verificationSchemaVersion: 1,
          settingsSha256: sha256Fingerprint(resolved.settings),
          resolvedSettingsSnapshot: resolved,
          rendererCapabilityId: "h264_mp4",
          observedMedia: observed,
          videoArtifact: {
            role: "video_mp4",
            filename: `${packageIdentity}.mp4`,
          },
        }
      : {}),
    artifacts: [
      artifact("clip_metadata_json", `${packageIdentity}.json`, metadataBytes),
      ...(subtitleMode !== "omission"
        ? [
            {
              ...artifact(
                "english_srt",
                `${packageIdentity}.en.srt`,
                subtitleBytes,
              ),
              subtitle: {
                language: "en",
                trackId: englishTrackId,
                trackVersion: 1,
                timingPrecision: "cue" as const,
                cueCount: 1,
                startMs: 0,
                endMs: 1_000,
              },
            },
          ]
        : []),
      ...(subtitleMode === "bilingual"
        ? [
            {
              ...artifact(
                "original_srt",
                `${packageIdentity}.original.srt`,
                originalSubtitleBytes,
              ),
              subtitle: {
                language: "es",
                trackId,
                trackVersion: 1,
                timingPrecision: "cue" as const,
                cueCount: 1,
                startMs: 0,
                endMs: 1_000,
              },
            },
          ]
        : []),
      {
        ...artifact("thumbnail_jpg", `${packageIdentity}.jpg`, thumbnailBytes),
        thumbnail: {
          extractionTimeMs: 500,
          width: 640,
          height: 360,
          jpegQuality: 3,
        },
      },
      artifact("video_mp4", `${packageIdentity}.mp4`, videoBytes),
    ],
  });
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const finalArtifact = (role: string, bytes: Buffer) => ({
    role,
    packageIdentity,
    byteSize: bytes.byteLength,
    contentSha256: sha(bytes),
    sourceAttempt: 1,
    validatedAt: at,
  });
  const artifacts = [
    finalArtifact("clip_metadata_json", metadataBytes),
    ...(subtitleMode !== "omission"
      ? [finalArtifact("english_srt", subtitleBytes)]
      : []),
    finalArtifact("manifest_json", manifestBytes),
    ...(subtitleMode === "bilingual"
      ? [finalArtifact("original_srt", originalSubtitleBytes)]
      : []),
    finalArtifact("thumbnail_jpg", thumbnailBytes),
    finalArtifact("video_mp4", videoBytes),
  ];
  const successResult = LoggedExportSuccessResultSchema.parse({
    schemaVersion: 1,
    requestId,
    jobId,
    projectId,
    clipId,
    sourceLanguageClass,
    resolvedExportBounds: {
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      resolvedAt: at,
    },
    renderedMediaProvenance: {
      durationMs: 1_000,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: sha256Fingerprint(resolved.settings),
      observedProperties: observed,
      sourceAttempt: 1,
      validatedAt: at,
    },
    thumbnailProvenance: {
      extractionTimeMs: 500,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: at,
    },
    ...(subtitleMode === "omission"
      ? {
          subtitleOmissionProvenance: {
            policy: "confirmed_english_user_setting",
            sourceAttempt: 1,
            validatedAt: at,
          },
        }
      : subtitleMode === "english"
        ? { englishSubtitleProvenance }
        : { subtitleSidecars }),
    artifacts,
  });
  const summary = ArtifactVersionSummarySchema.parse({
    artifactVersionId,
    requestId,
    jobId,
    projectId,
    clipId,
    requestOrigin: null,
    packageIdentity,
    video,
    selection,
    sourceLanguageClass,
    ...(subtitleTracks ? { subtitleTracks } : {}),
    preset,
    resolvedSettingsSnapshot: resolved,
    resolvedExportBounds: successResult.resolvedExportBounds,
    renderedMediaProvenance: successResult.renderedMediaProvenance,
    thumbnailProvenance: successResult.thumbnailProvenance,
    ...(successResult.subtitleOmissionProvenance
      ? {
          subtitleOmissionProvenance: successResult.subtitleOmissionProvenance,
        }
      : {}),
    ...(successResult.englishSubtitleProvenance
      ? {
          englishSubtitleProvenance: successResult.englishSubtitleProvenance,
        }
      : {}),
    ...(successResult.subtitleSidecars
      ? { subtitleSidecars: successResult.subtitleSidecars }
      : {}),
    artifacts: successResult.artifacts,
    manifest: {
      contentSha256: sha(manifestBytes),
      schemaVersion: "unknown",
    },
    resultFingerprint: sha256Fingerprint(successResult),
    completedAt: at,
  }) as ArtifactVersionSummary;
  const packagePath = join(root, packageIdentity);
  await mkdir(packagePath);
  const videoPath = join(packagePath, `${packageIdentity}.mp4`);
  await Promise.all([
    writeFile(videoPath, videoBytes),
    writeFile(join(packagePath, `${packageIdentity}.jpg`), thumbnailBytes),
    writeFile(join(packagePath, `${packageIdentity}.json`), metadataBytes),
    writeFile(join(packagePath, "manifest.json"), manifestBytes),
    ...(subtitleMode !== "omission"
      ? [
          writeFile(
            join(packagePath, `${packageIdentity}.en.srt`),
            subtitleBytes,
          ),
        ]
      : []),
    ...(subtitleMode === "bilingual"
      ? [
          writeFile(
            join(packagePath, `${packageIdentity}.original.srt`),
            originalSubtitleBytes,
          ),
        ]
      : []),
  ]);
  return {
    summary,
    packagePath,
    videoPath,
    videoBytes,
    artifactFiles: [
      { path: videoPath, bytes: videoBytes },
      {
        path: join(packagePath, `${packageIdentity}.jpg`),
        bytes: thumbnailBytes,
      },
      {
        path: join(packagePath, `${packageIdentity}.json`),
        bytes: metadataBytes,
      },
      { path: join(packagePath, "manifest.json"), bytes: manifestBytes },
      ...(subtitleMode !== "omission"
        ? [
            {
              path: join(packagePath, `${packageIdentity}.en.srt`),
              bytes: subtitleBytes,
            },
          ]
        : []),
      ...(subtitleMode === "bilingual"
        ? [
            {
              path: join(packagePath, `${packageIdentity}.original.srt`),
              bytes: originalSubtitleBytes,
            },
          ]
        : []),
    ],
  };
}

function sha(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function successResultForSummary(
  summary: Omit<ArtifactVersionSummary, "resultFingerprint">,
) {
  return LoggedExportSuccessResultSchema.parse({
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
}
