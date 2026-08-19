import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import {
  assertEditingFriendlyH264AacMp4Settings,
  assertEditingFriendlySourceCompatibility,
  ExportSourceAcquisitionError,
  inspectAndValidateRenderedExportOutput,
  inspectVerifiedExportSource,
  resolveExportBounds,
  withExportSourceScratch,
  type ExportSourceAcquisitionProvider,
  type ExportSourceInspector,
  type FfmpegRangeRenderer,
} from "@research-video/media";
import { type LocalExportQueue } from "@research-video/db-local";
import {
  ExportClipManifestSchema,
  ExportClipManifestSchemaVersion,
  type ExportClipManifest,
  type ExportRequest,
  type NormalizedTranscript,
  type RenderedExportMediaProvenance,
  type ResolvedExportBounds,
} from "@research-video/contracts";
import {
  deriveClipRelativeSrtCues,
  parseSrt,
  serializeSrtCues,
  validateClipRelativeSrtCues,
} from "@research-video/transcript";

/**
 * The local export job boundary carries M5-01 acquisition through M5-02 media
 * inspection, rendering, and output validation in one attempt-owned scratch
 * directory. It owns source and temporary-output cleanup on every terminal path.
 */
export class LocalExportSourceProcessor {
  constructor(
    private readonly queue: LocalExportQueue,
    private readonly sourceProvider:
      ExportSourceAcquisitionProvider | undefined,
    private readonly inspector: ExportSourceInspector,
    private readonly renderer: FfmpegRangeRenderer,
    private readonly dataRoot: string,
  ) {}

  async process(input: {
    requestId: string;
    authorizationConfirmed: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const request = this.queue.get(input.requestId);
    if (!request) {
      throw new ExportSourceAcquisitionError("Export request not found.", {
        code: "export_request_not_found",
        retryable: false,
      });
    }
    let subtitlePlan: RequiredSubtitlePlan;
    try {
      subtitlePlan = resolveRequiredSubtitlePlan(this.queue, request);
    } catch (error) {
      this.queue.recordSourceNotStartedFailure(
        input.requestId,
        errorCode(error),
        safeErrorMessage(error),
      );
      throw error;
    }
    if (!this.sourceProvider) {
      const error = new ExportSourceAcquisitionError(
        "Full-source acquisition is disabled. Configure EXPORT_SOURCE_PROVIDER before retrying.",
        { code: "export_source_provider_unconfigured", retryable: true },
      );
      this.queue.recordSourceNotStartedFailure(
        input.requestId,
        error.code,
        error.message,
      );
      throw error;
    }
    if (!input.authorizationConfirmed) {
      const error = new ExportSourceAcquisitionError(
        "Confirm authorization to process this source before acquisition.",
        { code: "source_authorization_required", retryable: true },
      );
      this.queue.recordSourceNotStartedFailure(
        input.requestId,
        error.code,
        error.message,
      );
      throw error;
    }
    try {
      assertEditingFriendlyH264AacMp4Settings(request.preset.settings);
    } catch (error) {
      this.queue.recordSourceNotStartedFailure(
        input.requestId,
        errorCode(error),
        safeErrorMessage(error),
      );
      throw error;
    }
    const started = this.queue.beginSourceAcquisition(input.requestId);

    try {
      return await withExportSourceScratch({
        scratchRoot: join(this.dataRoot, "jobs", "export-source-scratch"),
        attemptId: `${started.request.jobId}-a${started.attempt}`,
        provider: this.sourceProvider,
        videoId: started.request.video.youtubeVideoId,
        authorizationConfirmed: input.authorizationConfirmed,
        ...(input.signal ? { signal: input.signal } : {}),
        handoff: async (source, scratchDirectory) => {
          const inspection = await inspectVerifiedExportSource({
            sourcePath: source.scratchPath,
            scratchDirectory,
            inspector: this.inspector,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          assertEditingFriendlySourceCompatibility(inspection);
          const resolvedBounds = resolveExportBounds({
            requestedStartMs: started.request.selection.exportStartMs,
            requestedEndMs: started.request.selection.exportEndMs,
            durationMs: inspection.durationMs,
          });
          this.queue.recordSourceInspection(
            started.request.jobId,
            started.attempt,
            inspection,
            resolvedBounds,
          );
          const persistedRequest = this.queue.get(started.request.id);
          const persistedBounds = persistedRequest?.resolvedExportBounds;
          if (
            !persistedBounds ||
            persistedBounds.sourceAttempt !== started.attempt
          ) {
            throw new ExportSourceAcquisitionError(
              "Resolved export bounds were not persisted for this source attempt. Retry this export.",
              { code: "resolved_export_bounds_missing" },
            );
          }
          const outputPath = join(scratchDirectory, "rendered-range.mp4");
          await this.renderer.render({
            sourcePath: source.scratchPath,
            stagingDirectory: scratchDirectory,
            outputPath,
            startMs: persistedBounds.startMs,
            endMs: persistedBounds.endMs,
            settings: started.request.preset.settings,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          const outputInspection = await inspectAndValidateRenderedExportOutput(
            {
              outputPath,
              stagingDirectory: scratchDirectory,
              inspector: this.inspector,
              startMs: persistedBounds.startMs,
              endMs: persistedBounds.endMs,
              settings: started.request.preset.settings,
              ...(input.signal ? { signal: input.signal } : {}),
            },
          );
          const ffmpegVersion = await readEncoderVersion(
            this.renderer,
            input.signal,
          );
          this.queue.recordRenderedOutputValidation(
            started.request.jobId,
            started.attempt,
            {
              ...outputInspection,
              ...(ffmpegVersion ? { ffmpegVersion } : {}),
            },
          );
          if (subtitlePlan.policy === "confirmed_english_omission") {
            await assertNoStagedSrtFiles(scratchDirectory);
            this.queue.recordConfirmedEnglishSubtitleOmission(
              started.request.jobId,
              started.attempt,
            );
          } else {
            const sidecars = await stageAndValidateRequiredSidecars({
              stagingDirectory: scratchDirectory,
              renderedOutputPath: outputPath,
              renderedDurationMs: outputInspection.durationMs,
              sidecars: subtitlePlan.sidecars,
              resolvedStartMs: persistedBounds.startMs,
              resolvedEndMs: persistedBounds.endMs,
              ...(input.signal ? { signal: input.signal } : {}),
            });
            if (subtitlePlan.policy === "confirmed_english") {
              const sidecar = sidecars[0]!;
              this.queue.recordEnglishSubtitleValidation(
                started.request.jobId,
                started.attempt,
                sidecar,
              );
            } else {
              this.queue.recordBilingualSubtitleValidation(
                started.request.jobId,
                started.attempt,
                sidecars as [SidecarValidation, SidecarValidation],
              );
            }
          }
          const promoted = await promoteVerifiedFinalPackage({
            request: this.queue.get(started.request.id) ?? started.request,
            stagingDirectory: scratchDirectory,
            sourcePath: source.scratchPath,
            dataRoot: this.dataRoot,
            attempt: started.attempt,
            ...(input.signal ? { signal: input.signal } : {}),
          });
          try {
            this.queue.recordFinalArtifactPromotion(
              started.request.jobId,
              started.attempt,
              promoted,
            );
          } catch (error) {
            await removePromotedPackage(
              this.dataRoot,
              promoted[0]!.packageIdentity,
            );
            throw error;
          }
        },
        hooks: {
          sourceReady: async (source) => {
            this.queue.recordSourceReady(
              started.request.jobId,
              started.attempt,
              source,
            );
          },
          cleanupStarted: async () => {
            this.queue.recordSourceCleanupStarted(
              started.request.jobId,
              started.attempt,
            );
          },
          cleanupSucceeded: async () => {
            this.queue.recordSourceCleanupSucceeded(
              started.request.jobId,
              started.attempt,
            );
          },
          cleanupFailed: async (message) => {
            this.queue.recordSourceCleanupFailed(
              started.request.jobId,
              started.attempt,
              message,
            );
          },
        },
      });
    } catch (error) {
      if (errorCode(error) !== "source_cleanup_failed") {
        this.queue.recordSourceAttemptFailure(
          started.request.jobId,
          started.attempt,
          errorCode(error),
          safeErrorMessage(error),
        );
      }
      throw error;
    }
  }
}

type RequiredSubtitlePlan = {
  policy: "confirmed_english" | "confirmed_english_omission" | "bilingual";
  sidecars: readonly RequiredSidecar[];
};

type RequiredSidecar = {
  role: "original" | "english";
  transcript: NormalizedTranscript;
};

type FinalArtifact = {
  role: "video_mp4" | "english_srt" | "original_srt" | "manifest_json";
  packageIdentity: string;
  byteSize: number;
  contentSha256: string;
  sourceAttempt: number;
  validatedAt: string;
};

type StagedArtifactDigest = { byteSize: number; contentSha256: string };

const ClipManifestName = "manifest.json";

type SidecarValidation = {
  role: "original" | "english";
  language: string;
  trackId: string;
  trackVersion: number;
  cueCount: number;
  byteSize: number;
  contentSha256: string;
  startMs: number;
  endMs: number;
};

function resolveRequiredSubtitlePlan(
  queue: LocalExportQueue,
  request: ExportRequest,
): RequiredSubtitlePlan {
  if (request.sourceLanguageClass === "confirmed_english") {
    if (request.preset.settings.omitSubtitleFilesForConfirmedEnglish) {
      return { policy: "confirmed_english_omission", sidecars: [] };
    }
    return {
      policy: "confirmed_english",
      sidecars: [
        {
          role: "english",
          transcript: resolveExactEnglishTranscript(
            queue,
            request.selection.trackId,
            request.selection.transcriptVersion,
            request.video.youtubeVideoId,
          ),
        },
      ],
    };
  }
  if (!request.subtitleTracks) {
    throw new ExportSourceAcquisitionError(
      "This export is missing immutable original and English subtitle track identities. Recreate the export request after resolving both verified tracks.",
      { code: "subtitle_track_snapshot_missing", retryable: true },
    );
  }
  const original = resolveExactOriginalTranscript(
    queue,
    request.subtitleTracks.original.trackId,
    request.subtitleTracks.original.trackVersion,
    request.video.youtubeVideoId,
  );
  const english = resolveExactEnglishTranscript(
    queue,
    request.subtitleTracks.english.trackId,
    request.subtitleTracks.english.trackVersion,
    request.video.youtubeVideoId,
  );
  if (
    english.track.source !== "translated" ||
    english.track.sourceTrackId !== original.track.id
  ) {
    throw new ExportSourceAcquisitionError(
      "The snapshotted English track is not the verified translation of the snapshotted original track. Re-resolve both tracks before retrying.",
      { code: "english_translation_mismatched", retryable: true },
    );
  }
  return {
    policy: "bilingual",
    sidecars: [
      { role: "original", transcript: original },
      { role: "english", transcript: english },
    ],
  };
}

/**
 * Encoder provenance is best effort: a version read that fails on an otherwise
 * working installation must never fail an already verified render, and requests
 * exported before this provenance existed legitimately have none.
 */
async function readEncoderVersion(
  renderer: FfmpegRangeRenderer,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    return await renderer.readVersion?.(signal);
  } catch {
    return undefined;
  }
}

async function assertNoStagedSrtFiles(stagingDirectory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(stagingDirectory, { withFileTypes: true });
  } catch {
    throw new ExportSourceAcquisitionError(
      "Subtitle omission staging could not be verified. Retry this export.",
      { code: "subtitle_omission_staging_unreadable", retryable: true },
    );
  }
  if (
    entries.some(
      (entry) =>
        entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".srt"),
    )
  ) {
    throw new ExportSourceAcquisitionError(
      "Confirmed-English subtitle omission cannot retain staged subtitle files.",
      { code: "subtitle_omission_sidecar_present", retryable: false },
    );
  }
}

async function promoteVerifiedFinalPackage(input: {
  request: ExportRequest;
  stagingDirectory: string;
  sourcePath: string;
  dataRoot: string;
  attempt: number;
  signal?: AbortSignal;
}): Promise<FinalArtifact[]> {
  const policy = resolveVerifiedPackagePolicy(input.request, input.attempt);
  const packageIdentity = `clip-${input.request.id}`;
  const outputRoot = join(input.dataRoot, "exports");
  const destination = join(outputRoot, packageIdentity);
  const promotionDirectory = join(
    outputRoot,
    `.${packageIdentity}.a${input.attempt}.promoting`,
  );
  if (
    !isInsideStaging(outputRoot, destination) ||
    !isInsideStaging(outputRoot, promotionDirectory)
  ) {
    throw new ExportSourceAcquisitionError(
      "Final artifact destination is invalid. Retry this export.",
      { code: "final_artifact_destination_invalid", retryable: false },
    );
  }
  await assertNoExistingPath(
    destination,
    "final_artifact_destination_collision",
  );
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await assertNoExistingPath(
    promotionDirectory,
    "final_artifact_promotion_collision",
  );
  await mkdir(promotionDirectory, { mode: 0o700 });
  let renamed = false;
  try {
    throwIfPromotionCanceled(input.signal);
    const stagedDigests = await validateStagedPackage({
      stagingDirectory: input.stagingDirectory,
      sourcePath: input.sourcePath,
      policy,
    });
    stagedDigests.set(
      "manifest_json",
      await stageVerifiedClipManifest(
        input.stagingDirectory,
        buildVerifiedClipManifest({
          request: input.request,
          policy,
          packageIdentity,
          attempt: input.attempt,
          digests: stagedDigests,
        }),
      ),
    );
    for (const artifact of policy.artifacts) {
      throwIfPromotionCanceled(input.signal);
      await copyFile(
        join(input.stagingDirectory, artifact.stagedName),
        join(promotionDirectory, artifact.finalName),
        0,
      );
    }
    throwIfPromotionCanceled(input.signal);
    await rename(promotionDirectory, destination);
    renamed = true;
    throwIfPromotionCanceled(input.signal);
    const artifacts = await verifyPromotedPackage({
      destination,
      policy,
      packageIdentity,
      attempt: input.attempt,
    });
    assertPromotedArtifactsMatchStagedBytes(artifacts, stagedDigests);
    throwIfPromotionCanceled(input.signal);
    return artifacts;
  } catch (error) {
    await rm(renamed ? destination : promotionDirectory, {
      recursive: true,
      force: true,
    });
    throw error;
  }
}

type VerifiedPackageArtifact = {
  role: FinalArtifact["role"];
  stagedName: string;
  finalName: string;
  sidecar?: {
    language: string;
    trackId: string;
    trackVersion: number;
    cueCount: number;
    byteSize: number;
    contentSha256: string;
    startMs: number;
    endMs: number;
    sourceAttempt: number;
  };
};

type VerifiedPackagePolicy = {
  rendered: RenderedExportMediaProvenance;
  bounds: ResolvedExportBounds;
  requiredSidecars: readonly ("original" | "english")[];
  omittedReason?: "confirmed_english_user_setting";
  artifacts: readonly VerifiedPackageArtifact[];
};

function resolveVerifiedPackagePolicy(
  request: ExportRequest,
  attempt: number,
): VerifiedPackagePolicy {
  const rendered = request.renderedMediaProvenance;
  if (rendered?.sourceAttempt !== attempt) {
    throw new ExportSourceAcquisitionError(
      "The validated rendered MP4 is unavailable for this source attempt. Retry this export.",
      { code: "rendered_package_provenance_missing", retryable: true },
    );
  }
  const bounds = request.resolvedExportBounds;
  if (bounds?.sourceAttempt !== attempt) {
    throw new ExportSourceAcquisitionError(
      "Resolved export bounds were not persisted for this source attempt. Retry this export.",
      { code: "resolved_export_bounds_missing", retryable: true },
    );
  }
  const video = {
    role: "video_mp4" as const,
    stagedName: "rendered-range.mp4",
    finalName: `clip-${request.id}.mp4`,
  };
  const manifest = {
    role: "manifest_json" as const,
    stagedName: ClipManifestName,
    finalName: ClipManifestName,
  };
  if (request.sourceLanguageClass === "confirmed_english") {
    if (request.preset.settings.omitSubtitleFilesForConfirmedEnglish) {
      if (
        request.subtitleOmissionProvenance?.policy !==
          "confirmed_english_user_setting" ||
        request.subtitleOmissionProvenance.sourceAttempt !== attempt
      ) {
        throw new ExportSourceAcquisitionError(
          "Confirmed-English omission was not validated for this source attempt. Retry this export.",
          { code: "subtitle_omission_provenance_missing", retryable: true },
        );
      }
      return {
        rendered,
        bounds,
        requiredSidecars: [],
        omittedReason: "confirmed_english_user_setting",
        artifacts: [video, manifest],
      };
    }
    const english = request.englishSubtitleProvenance;
    if (!english || english.sourceAttempt !== attempt) {
      throw new ExportSourceAcquisitionError(
        "The required English subtitle was not validated for this source attempt. Retry this export.",
        { code: "english_subtitle_provenance_missing", retryable: true },
      );
    }
    return {
      rendered,
      bounds,
      requiredSidecars: ["english"],
      artifacts: [
        video,
        {
          role: "english_srt",
          stagedName: "english.srt",
          finalName: `clip-${request.id}.en.srt`,
          // A confirmed-English request snapshots no sidecar language because
          // its verified track is already proven English before derivation.
          sidecar: { ...english, language: "en" },
        },
        manifest,
      ],
    };
  }
  const sidecars = request.subtitleSidecars;
  if (!sidecars || sidecars.length !== 2) {
    throw new ExportSourceAcquisitionError(
      "The required bilingual subtitles were not validated for this source attempt. Retry this export.",
      { code: "bilingual_subtitle_provenance_missing", retryable: true },
    );
  }
  const original = sidecars.find((sidecar) => sidecar.role === "original");
  const english = sidecars.find((sidecar) => sidecar.role === "english");
  if (
    !original ||
    !english ||
    original.sourceAttempt !== attempt ||
    english.sourceAttempt !== attempt
  ) {
    throw new ExportSourceAcquisitionError(
      "The required bilingual subtitles were not validated for this source attempt. Retry this export.",
      { code: "bilingual_subtitle_provenance_missing", retryable: true },
    );
  }
  return {
    rendered,
    bounds,
    requiredSidecars: ["original", "english"],
    artifacts: [
      video,
      {
        role: "original_srt",
        stagedName: "original.srt",
        finalName: `clip-${request.id}.original.srt`,
        sidecar: original,
      },
      {
        role: "english_srt",
        stagedName: "english.srt",
        finalName: `clip-${request.id}.en.srt`,
        sidecar: english,
      },
      manifest,
    ],
  };
}

/**
 * The manifest is the package's auditable provenance record. It is derived only
 * from the immutable request snapshot, persisted validation provenance, and the
 * staged bytes it names, and it takes every timestamp from persisted
 * provenance so replaying one request reproduces the same file.
 */
function buildVerifiedClipManifest(input: {
  request: ExportRequest;
  policy: VerifiedPackagePolicy;
  packageIdentity: string;
  attempt: number;
  digests: ReadonlyMap<FinalArtifact["role"], StagedArtifactDigest>;
}): ExportClipManifest {
  const { policy, request } = input;
  const manifest: ExportClipManifest = {
    schemaVersion: ExportClipManifestSchemaVersion,
    exportRequestId: request.id,
    jobId: request.jobId,
    mode: request.mode,
    packageIdentity: input.packageIdentity,
    sourceAttempt: input.attempt,
    validatedAt: policy.rendered.validatedAt,
    video: request.video,
    sourceLanguageClass: request.sourceLanguageClass,
    resolvedExportBounds: {
      startMs: policy.bounds.startMs,
      endMs: policy.bounds.endMs,
      sourceAttempt: policy.bounds.sourceAttempt,
    },
    renderedDurationMs: policy.rendered.durationMs,
    subtitlePolicy: {
      requiredSidecars: [...policy.requiredSidecars],
      ...(policy.omittedReason
        ? { subtitleSidecarsOmittedReason: policy.omittedReason }
        : {}),
    },
    toolVersions: {
      ...(policy.rendered.ffprobeVersion
        ? { ffprobeVersion: policy.rendered.ffprobeVersion }
        : {}),
      ...(policy.rendered.ffmpegVersion
        ? { ffmpegVersion: policy.rendered.ffmpegVersion }
        : {}),
    },
    artifacts: policy.artifacts.flatMap((artifact) => {
      if (artifact.role === "manifest_json") return [];
      const digest = input.digests.get(artifact.role);
      if (!digest) {
        throw new ExportSourceAcquisitionError(
          "A validated clip artifact could not be recorded in its manifest. Retry this export.",
          { code: "clip_manifest_artifact_missing", retryable: false },
        );
      }
      return [
        {
          role: artifact.role,
          filename: artifact.finalName,
          byteSize: digest.byteSize,
          contentSha256: digest.contentSha256,
          ...(artifact.sidecar
            ? {
                subtitle: {
                  language: artifact.sidecar.language,
                  trackId: artifact.sidecar.trackId,
                  trackVersion: artifact.sidecar.trackVersion,
                  // The snapshotted selection carries the only honest timing
                  // precision this slice persists; it is never upgraded here.
                  timingPrecision: request.selection.timingPrecision,
                  cueCount: artifact.sidecar.cueCount,
                  startMs: artifact.sidecar.startMs,
                  endMs: artifact.sidecar.endMs,
                },
              }
            : {}),
        },
      ];
    }),
  };
  assertManifestMatchesSubtitlePolicy(manifest, policy);
  return manifest;
}

function assertManifestMatchesSubtitlePolicy(
  manifest: ExportClipManifest,
  policy: VerifiedPackagePolicy,
) {
  const listed = manifest.artifacts
    .filter((artifact) => artifact.role !== "video_mp4")
    .map((artifact) =>
      artifact.role === "original_srt" ? "original" : "english",
    );
  if (
    listed.length !== policy.requiredSidecars.length ||
    policy.requiredSidecars.some((role, index) => listed[index] !== role)
  ) {
    throw new ExportSourceAcquisitionError(
      "The clip manifest does not match the resolved subtitle policy. Retry this export.",
      { code: "clip_manifest_subtitle_policy_mismatch", retryable: false },
    );
  }
}

async function stageVerifiedClipManifest(
  stagingDirectory: string,
  manifest: ExportClipManifest,
): Promise<StagedArtifactDigest> {
  const path = join(stagingDirectory, ClipManifestName);
  if (!isInsideStaging(stagingDirectory, path)) {
    throw new ExportSourceAcquisitionError(
      "Clip manifest staging is invalid. Retry this export.",
      { code: "clip_manifest_staging_invalid", retryable: false },
    );
  }
  const validated = ExportClipManifestSchema.safeParse(manifest);
  if (!validated.success) {
    throw new ExportSourceAcquisitionError(
      "The clip manifest failed its own provenance contract. Retry this export.",
      { code: "clip_manifest_invalid", retryable: false },
    );
  }
  try {
    await writeFile(path, `${JSON.stringify(validated.data, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new ExportSourceAcquisitionError(
      "The clip manifest could not be staged. Retry this export.",
      { code: "clip_manifest_staging_failed", retryable: true },
    );
  }
  return digestStagedArtifact(
    path,
    "Clip manifest",
    "staged_package_manifest_invalid",
  );
}

function assertPromotedArtifactsMatchStagedBytes(
  artifacts: readonly FinalArtifact[],
  staged: ReadonlyMap<FinalArtifact["role"], StagedArtifactDigest>,
) {
  if (artifacts.length !== staged.size) {
    throw promotedArtifactMismatch();
  }
  for (const artifact of artifacts) {
    const digest = staged.get(artifact.role);
    if (
      !digest ||
      digest.byteSize !== artifact.byteSize ||
      digest.contentSha256 !== artifact.contentSha256
    ) {
      throw promotedArtifactMismatch();
    }
  }
}

function promotedArtifactMismatch() {
  return new ExportSourceAcquisitionError(
    "A promoted clip artifact no longer matches the verified bytes its manifest names. Retry this export.",
    { code: "final_package_artifact_mismatched", retryable: false },
  );
}

async function validateStagedPackage(input: {
  stagingDirectory: string;
  sourcePath: string;
  policy: VerifiedPackagePolicy;
}): Promise<Map<FinalArtifact["role"], StagedArtifactDigest>> {
  const expectedNames = new Set([
    basename(input.sourcePath),
    ...input.policy.artifacts.map((artifact) => artifact.stagedName),
  ]);
  const entries = await readdir(input.stagingDirectory, {
    withFileTypes: true,
  }).catch(() => {
    throw new ExportSourceAcquisitionError(
      "Validated clip staging is unavailable. Retry this export.",
      { code: "staged_package_unreadable", retryable: true },
    );
  });
  if (
    entries.some((entry) => !entry.isFile() || !expectedNames.has(entry.name))
  ) {
    throw new ExportSourceAcquisitionError(
      "Validated clip staging contains unexpected subtitle artifacts. Retry this export.",
      { code: "staged_package_extra_artifact", retryable: false },
    );
  }
  const digests = new Map<FinalArtifact["role"], StagedArtifactDigest>();
  for (const artifact of input.policy.artifacts) {
    // The manifest names these verified bytes, so it is staged only after they
    // are hashed and always before anything becomes a visible package.
    if (artifact.role === "manifest_json") continue;
    const source = join(input.stagingDirectory, artifact.stagedName);
    if (!isInsideStaging(input.stagingDirectory, source)) {
      throw new ExportSourceAcquisitionError(
        "Validated clip staging is invalid. Retry this export.",
        { code: "staged_package_path_invalid", retryable: false },
      );
    }
    const info = await regularNonemptyStagedFile(
      source,
      "Validated clip artifact",
      "staged_package_artifact_invalid",
    );
    const contents = await readFile(source);
    const contentSha256 = createHash("sha256").update(contents).digest("hex");
    if (artifact.sidecar) {
      try {
        validateClipRelativeSrtCues(
          parseSrt(contents),
          input.policy.rendered.durationMs,
        );
      } catch {
        throw new ExportSourceAcquisitionError(
          "Validated subtitle staging is malformed. Retry this export.",
          { code: "staged_package_sidecar_malformed", retryable: false },
        );
      }
      if (
        info.size !== artifact.sidecar.byteSize ||
        contentSha256 !== artifact.sidecar.contentSha256
      ) {
        throw new ExportSourceAcquisitionError(
          "Validated subtitle staging no longer matches its verified provenance. Retry this export.",
          { code: "staged_package_sidecar_mismatched", retryable: false },
        );
      }
    }
    digests.set(artifact.role, { byteSize: info.size, contentSha256 });
  }
  return digests;
}

async function digestStagedArtifact(
  path: string,
  label: string,
  code: string,
): Promise<StagedArtifactDigest> {
  const info = await regularNonemptyStagedFile(path, label, code);
  return {
    byteSize: info.size,
    contentSha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  };
}

async function verifyPromotedPackage(input: {
  destination: string;
  policy: VerifiedPackagePolicy;
  packageIdentity: string;
  attempt: number;
}): Promise<FinalArtifact[]> {
  const entries = await readdir(input.destination, {
    withFileTypes: true,
  }).catch(() => {
    throw new ExportSourceAcquisitionError(
      "Promoted clip package is unavailable. Retry this export.",
      { code: "final_package_unreadable", retryable: true },
    );
  });
  const expected = new Set(
    input.policy.artifacts.map((artifact) => artifact.finalName),
  );
  if (
    entries.length !== expected.size ||
    entries.some((entry) => !entry.isFile() || !expected.has(entry.name))
  ) {
    throw new ExportSourceAcquisitionError(
      "Promoted clip package is incomplete or contains unexpected artifacts. Retry this export.",
      { code: "final_package_policy_mismatch", retryable: false },
    );
  }
  const validatedAt = new Date().toISOString();
  const artifacts: FinalArtifact[] = [];
  for (const artifact of input.policy.artifacts) {
    const path = join(input.destination, artifact.finalName);
    const info = await regularNonemptyStagedFile(
      path,
      "Promoted clip artifact",
      "final_package_artifact_invalid",
    );
    const contents = await readFile(path);
    artifacts.push({
      role: artifact.role,
      packageIdentity: input.packageIdentity,
      byteSize: info.size,
      contentSha256: createHash("sha256").update(contents).digest("hex"),
      sourceAttempt: input.attempt,
      validatedAt,
    });
  }
  return artifacts;
}

async function assertNoExistingPath(path: string, code: string) {
  try {
    await lstat(path);
  } catch {
    return;
  }
  throw new ExportSourceAcquisitionError(
    "Final artifact destination already exists. Retry with a new export request.",
    { code, retryable: false },
  );
}

async function removePromotedPackage(
  dataRoot: string,
  packageIdentity: string,
) {
  if (!/^clip-[a-f0-9-]{36}$/u.test(packageIdentity)) return;
  const outputRoot = join(dataRoot, "exports");
  const destination = join(outputRoot, packageIdentity);
  if (isInsideStaging(outputRoot, destination)) {
    await rm(destination, { recursive: true, force: true });
  }
}

function throwIfPromotionCanceled(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new ExportSourceAcquisitionError(
      "Final package promotion was canceled.",
      {
        code: "final_package_promotion_canceled",
        retryable: true,
      },
    );
  }
}

function resolveExactEnglishTranscript(
  queue: LocalExportQueue,
  trackId: string,
  trackVersion: number,
  videoId: string,
): NormalizedTranscript {
  let transcript: NormalizedTranscript | undefined;
  try {
    transcript = queue.getVerifiedEnglishTranscript({
      trackId,
      trackVersion,
      videoId,
    });
  } catch {
    throw new ExportSourceAcquisitionError(
      "The snapshotted English transcript is malformed locally. Re-resolve the verified transcript before retrying.",
      { code: "english_transcript_malformed", retryable: true },
    );
  }
  if (!transcript) {
    throw new ExportSourceAcquisitionError(
      "The exact snapshotted English transcript version is unavailable locally. Re-resolve that transcript version before retrying.",
      { code: "english_transcript_version_unavailable", retryable: true },
    );
  }
  if (
    transcript.track.kind !== "english" ||
    primaryLanguage(transcript.track.language) !== "en"
  ) {
    throw new ExportSourceAcquisitionError(
      "The snapshotted transcript is not a verified English track. Re-resolve the English transcript before retrying.",
      { code: "english_transcript_version_mismatched", retryable: true },
    );
  }
  return transcript;
}

function resolveExactOriginalTranscript(
  queue: LocalExportQueue,
  trackId: string,
  trackVersion: number,
  videoId: string,
): NormalizedTranscript {
  let transcript: NormalizedTranscript | undefined;
  try {
    transcript = queue.getVerifiedOriginalTranscript({
      trackId,
      trackVersion,
      videoId,
    });
  } catch {
    throw new ExportSourceAcquisitionError(
      "The snapshotted original transcript is malformed locally. Re-resolve the verified transcript before retrying.",
      { code: "original_transcript_malformed", retryable: true },
    );
  }
  if (!transcript) {
    throw new ExportSourceAcquisitionError(
      "The exact snapshotted original transcript version is unavailable locally. Re-resolve that transcript version before retrying.",
      { code: "original_transcript_version_unavailable", retryable: true },
    );
  }
  if (transcript.track.kind !== "original") {
    throw new ExportSourceAcquisitionError(
      "The snapshotted transcript is not a verified original-language track. Re-resolve the original transcript before retrying.",
      { code: "original_transcript_version_mismatched", retryable: true },
    );
  }
  return transcript;
}

async function stageAndValidateRequiredSidecars(input: {
  stagingDirectory: string;
  renderedOutputPath: string;
  renderedDurationMs: number;
  sidecars: readonly RequiredSidecar[];
  resolvedStartMs: number;
  resolvedEndMs: number;
  signal?: AbortSignal;
}): Promise<SidecarValidation[]> {
  throwIfSubtitleCanceled(input.signal);
  await regularNonemptyStagedFile(
    input.renderedOutputPath,
    "Rendered output",
    "render_output_invalid",
  );
  const validations: SidecarValidation[] = [];
  for (const sidecar of input.sidecars) {
    validations.push(
      await stageAndValidateSidecar({
        ...input,
        sidecar,
      }),
    );
  }
  throwIfSubtitleCanceled(input.signal);
  return validations;
}

async function stageAndValidateSidecar(input: {
  stagingDirectory: string;
  renderedDurationMs: number;
  sidecar: RequiredSidecar;
  resolvedStartMs: number;
  resolvedEndMs: number;
  signal?: AbortSignal;
}): Promise<SidecarValidation> {
  const label = input.sidecar.role === "english" ? "English" : "Original";
  const cues = deriveClipRelativeSrtCues({
    transcript: input.sidecar.transcript,
    startMs: input.resolvedStartMs,
    endMs: input.resolvedEndMs,
    missingCue: {
      code: `${input.sidecar.role}_subtitle_cue_missing`,
      message: `The verified ${label.toLocaleLowerCase()} transcript has no cue in the resolved export range. Adjust the range or re-resolve that track before retrying.`,
    },
  });
  throwIfSubtitleCanceled(input.signal);
  const sidecarPath = join(input.stagingDirectory, `${input.sidecar.role}.srt`);
  if (!isInsideStaging(input.stagingDirectory, sidecarPath)) {
    throw new ExportSourceAcquisitionError(
      `${label} subtitle staging is invalid. Retry this export.`,
      {
        code: `${input.sidecar.role}_subtitle_staging_invalid`,
        retryable: false,
      },
    );
  }
  try {
    await writeFile(sidecarPath, serializeSrtCues(cues), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new ExportSourceAcquisitionError(
      `The ${label.toLocaleLowerCase()} subtitle sidecar could not be staged. Retry this export.`,
      {
        code: `${input.sidecar.role}_subtitle_staging_failed`,
        retryable: true,
      },
    );
  }
  const sidecarInfo = await regularNonemptyStagedFile(
    sidecarPath,
    `${label} subtitle sidecar`,
    `${input.sidecar.role}_subtitle_file_invalid`,
  );
  if (sidecarInfo.size > 20 * 1024 * 1024) {
    throw new ExportSourceAcquisitionError(
      `${label} subtitle sidecar exceeds the allowed size.`,
      {
        code: `${input.sidecar.role}_subtitle_file_too_large`,
        retryable: false,
      },
    );
  }
  let parsed;
  let contents: Buffer;
  try {
    contents = await readFile(sidecarPath);
    parsed = parseSrt(contents);
    validateClipRelativeSrtCues(parsed, input.renderedDurationMs);
  } catch (error) {
    throw new ExportSourceAcquisitionError(
      `${label} subtitle sidecar validation failed. Re-resolve the transcript or adjust the export range before retrying.`,
      {
        code:
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : `${input.sidecar.role}_subtitle_validation_failed`,
        retryable: false,
      },
    );
  }
  throwIfSubtitleCanceled(input.signal);
  return {
    role: input.sidecar.role,
    language: input.sidecar.transcript.track.language,
    trackId: input.sidecar.transcript.track.id,
    trackVersion: input.sidecar.transcript.track.version,
    cueCount: parsed.length,
    byteSize: sidecarInfo.size,
    contentSha256: createHash("sha256").update(contents).digest("hex"),
    startMs: Math.min(...parsed.map((cue) => cue.startMs)),
    endMs: Math.max(...parsed.map((cue) => cue.endMs)),
  };
}

async function regularNonemptyStagedFile(
  path: string,
  label: string,
  code: string,
) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size <= 0) throw new Error("invalid");
    return info;
  } catch {
    throw new ExportSourceAcquisitionError(
      `${label} must be a regular nonempty staged file.`,
      { code, retryable: false },
    );
  }
}

function throwIfSubtitleCanceled(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new ExportSourceAcquisitionError(
      "English subtitle staging was canceled.",
      {
        code: "english_subtitle_canceled",
        retryable: true,
      },
    );
  }
}

function isInsideStaging(directory: string, path: string) {
  return resolve(path).startsWith(`${resolve(directory)}${sep}`);
}

function primaryLanguage(language: string) {
  return language.toLocaleLowerCase().split("-")[0];
}

function errorCode(error: unknown) {
  if (error instanceof ExportSourceAcquisitionError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "export_source_processing_failed";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(/(?:[A-Za-z]:)?\/(?:[^\s'"]+)/gu, "<path>")
    .replaceAll(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 500);
}
