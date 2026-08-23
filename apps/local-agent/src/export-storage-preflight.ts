import { statfs } from "node:fs/promises";

import {
  ClipCandidateSchema,
  ClipLanguageEvidenceV2Schema,
  ClipLibraryExportSubmissionSchema,
  ExportSettingsPreviewSchema,
  ExportStoragePreflightSchema,
  ExportStorageSafetyReserveBytes,
  PrepareClipLibraryExportRequestSchema,
  SubmitClipLibraryExportRequestSchema,
  languagesEquivalent,
  primaryLanguage,
  type ClipCandidate,
  type ClipLibraryExportSubmission,
  type CreateClipExportRequest,
  type CreateLoggedExportBatchRequest,
  type ExportSettings,
  type ExportSettingsPreview,
  type ExportSourceLanguageClass,
  type ExportStoragePreflight,
  type ExportRequest,
  type ExportRequestOrigin,
  type LoggedExportBatch,
  type PrepareClipLibraryExportRequest,
  type SubmitClipLibraryExportRequest,
} from "@research-video/contracts";
import { sha256Fingerprint } from "@research-video/export-settings";

const OutputEstimatePolicyVersion = 1;
const PackageOverheadBytes = 8 * 1024 * 1024;

export class ClipLibraryExportOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export type ExportStorageCapacityProvider = {
  availableBytes(): Promise<number>;
  activeCheckpointReserveBytes(): Promise<number>;
};

export type PostAcquisitionExportStorageGuard = {
  assertCanRender(
    request: ExportRequest,
    acquiredSourceBytes: number,
  ): Promise<{ release(): void }>;
};

type ExportStorageSourceEstimator = (
  clip: ClipCandidate,
) => Promise<number | undefined>;

type PreparedItem = {
  clip: ClipCandidate;
  sourceLanguageClass: ExportSourceLanguageClass;
  preview: ExportSettingsPreview;
  command: CreateClipExportRequest;
  outputEstimatedBytes: number;
};

type PreparedOperation = {
  preflight: ExportStoragePreflight;
  items: PreparedItem[];
};

export class ClipLibraryExportOperationService {
  constructor(
    private readonly dependencies: {
      getClip(input: {
        projectId: string;
        clipId: string;
        authorization: string;
      }): Promise<ClipCandidate>;
      previewSettings(input: {
        projectId: string;
        authorization: string;
        sourceLanguageClass: ExportSourceLanguageClass;
        selection: PrepareClipLibraryExportRequest["settingsSelection"];
      }): Promise<ExportSettingsPreview>;
      createIndividual(input: {
        projectId: string;
        clipId: string;
        authorization: string;
        command: CreateClipExportRequest;
      }): Promise<ExportRequest>;
      createReexport?(input: {
        projectId: string;
        clipId: string;
        artifactVersionId: string;
        authorization: string;
        command: CreateClipExportRequest;
      }): Promise<ExportRequest>;
      createBatch(input: {
        projectId: string;
        authorization: string;
        command: CreateLoggedExportBatchRequest;
      }): Promise<LoggedExportBatch>;
      capacity: ExportStorageCapacityProvider;
      now?(): Date;
      estimateSourceBytes?: ExportStorageSourceEstimator;
    },
  ) {}

  async prepare(input: {
    projectId: string;
    authorization: string;
    request: PrepareClipLibraryExportRequest;
    requestOrigin?: Extract<
      ExportRequestOrigin,
      "clip_library" | "authoring_build"
    >;
  }): Promise<ExportStoragePreflight> {
    return (
      await this.build(
        { ...input, requestOrigin: input.requestOrigin ?? "clip_library" },
        true,
      )
    ).preflight;
  }

  async submit(input: {
    projectId: string;
    authorization: string;
    request: SubmitClipLibraryExportRequest;
    requestOrigin?: Extract<
      ExportRequestOrigin,
      "clip_library" | "authoring_build"
    >;
  }): Promise<ClipLibraryExportSubmission> {
    const request = SubmitClipLibraryExportRequestSchema.parse(input.request);
    const prepared = await this.build(
      {
        projectId: input.projectId,
        authorization: input.authorization,
        request: {
          clipIds: request.clipIds,
          settingsSelection: request.settingsSelection,
          ...(request.reexportArtifactVersionId
            ? {
                reexportArtifactVersionId: request.reexportArtifactVersionId,
              }
            : {}),
        },
        requestOrigin: input.requestOrigin ?? "clip_library",
      },
      false,
    );
    if (
      prepared.preflight.preflightFingerprint !==
      request.expectedPreflightFingerprint
    ) {
      throw new ClipLibraryExportOperationError(
        "The selected clips or export settings changed after storage preflight.",
        "export_storage_preflight_stale",
        409,
      );
    }
    if (prepared.preflight.decision === "insufficient") {
      throw new ClipLibraryExportOperationError(
        "This export does not fit in the currently available storage.",
        "export_storage_insufficient",
        409,
      );
    }
    if (
      prepared.preflight.decision === "confirmation_required" &&
      !request.confirmUnknownSourceSizes
    ) {
      throw new ClipLibraryExportOperationError(
        "Confirm the unknown source sizes before starting acquisition.",
        "export_storage_unknown_confirmation_required",
        409,
      );
    }

    const idempotencyKey = `clip-library:${prepared.preflight.preflightFingerprint}`;
    if (prepared.items.length === 1) {
      const item = prepared.items[0]!;
      if (request.reexportArtifactVersionId) {
        if (!this.dependencies.createReexport) {
          throw new ClipLibraryExportOperationError(
            "Artifact re-export is unavailable.",
            "artifact_reexport_unavailable",
            503,
          );
        }
        return ClipLibraryExportSubmissionSchema.parse({
          kind: "individual",
          request: await this.dependencies.createReexport({
            projectId: input.projectId,
            clipId: item.clip.id,
            artifactVersionId: request.reexportArtifactVersionId,
            authorization: input.authorization,
            command: { ...item.command, idempotencyKey },
          }),
        });
      }
      return ClipLibraryExportSubmissionSchema.parse({
        kind: "individual",
        request: await this.dependencies.createIndividual({
          projectId: input.projectId,
          clipId: item.clip.id,
          authorization: input.authorization,
          command: { ...item.command, idempotencyKey },
        }),
      });
    }
    return ClipLibraryExportSubmissionSchema.parse({
      kind: "batch",
      batch: await this.dependencies.createBatch({
        projectId: input.projectId,
        authorization: input.authorization,
        command: {
          idempotencyKey,
          items: prepared.items.map((item) => ({
            clipId: item.clip.id,
            export: {
              ...item.command,
              idempotencyKey: `${idempotencyKey}:${item.clip.id}`,
            },
          })),
        },
      }),
    });
  }

  private async build(
    input: {
      projectId: string;
      authorization: string;
      request: PrepareClipLibraryExportRequest;
      requestOrigin: Extract<
        ExportRequestOrigin,
        "clip_library" | "authoring_build"
      >;
    },
    requireEligible: boolean,
  ): Promise<PreparedOperation> {
    const request = PrepareClipLibraryExportRequestSchema.parse(input.request);
    const clipIds = request.clipIds.toSorted();
    const clips = await Promise.all(
      clipIds.map(async (clipId) =>
        ClipCandidateSchema.parse(
          await this.dependencies.getClip({
            projectId: input.projectId,
            clipId,
            authorization: input.authorization,
          }),
        ),
      ),
    );
    if (clips.some((clip) => clip.projectId !== input.projectId)) {
      throw new ClipLibraryExportOperationError(
        "One selected clip does not belong to this project.",
        "clip_library_export_scope_mismatch",
        403,
      );
    }
    if (
      requireEligible &&
      !request.reexportArtifactVersionId &&
      clips.some((clip) => clip.exportStatus !== "not_requested")
    ) {
      throw new ClipLibraryExportOperationError(
        "Clip Library export requires every selected clip to be not requested.",
        "clip_library_export_clip_ineligible",
        409,
      );
    }

    const items = await Promise.all(
      clips.map(async (clip): Promise<PreparedItem> => {
        const evidence = ClipLanguageEvidenceV2Schema.safeParse(
          clip.languageEvidence,
        );
        if (!evidence.success) {
          throw new ClipLibraryExportOperationError(
            "This clip lacks complete immutable language evidence for export.",
            "clip_library_export_language_evidence_incomplete",
            409,
          );
        }
        const nativeLanguage = primaryLanguage(evidence.data.native.language);
        const sourceLanguageClass: ExportSourceLanguageClass =
          nativeLanguage === "und"
            ? "unknown"
            : nativeLanguage === "mul"
              ? "mixed"
              : evidence.data.native.trackId ===
                    evidence.data.english.trackId &&
                  languagesEquivalent(evidence.data.native.language, "en")
                ? "confirmed_english"
                : languagesEquivalent(evidence.data.native.language, "en")
                  ? "mixed"
                  : "foreign";
        const preview = ExportSettingsPreviewSchema.parse(
          await this.dependencies.previewSettings({
            projectId: input.projectId,
            authorization: input.authorization,
            sourceLanguageClass,
            selection: request.settingsSelection,
          }),
        );
        if (preview.issues.length || !preview.snapshot.resolutionFingerprint) {
          throw new ClipLibraryExportOperationError(
            "The current worker cannot render one selected clip's resolved settings.",
            "clip_library_export_settings_unsupported",
            422,
          );
        }
        return {
          clip,
          sourceLanguageClass,
          preview,
          command: {
            idempotencyKey: "pending-preflight",
            requestOrigin: input.requestOrigin,
            sourceLanguageClass,
            ...(sourceLanguageClass === "confirmed_english"
              ? {}
              : {
                  subtitleTracks: {
                    original: {
                      trackId: evidence.data.native.trackId,
                      trackVersion: evidence.data.native.trackVersion,
                    },
                    english: {
                      trackId: evidence.data.english.trackId,
                      trackVersion: evidence.data.english.trackVersion,
                    },
                  },
                }),
            settingsSelection: request.settingsSelection,
            expectedResolutionFingerprint:
              preview.snapshot.resolutionFingerprint,
          },
          outputEstimatedBytes: estimateOutputPackageBytes(
            clip.selection.exportEndMs - clip.selection.exportStartMs,
            preview.snapshot.settings,
          ),
        };
      }),
    );

    const uniqueSources = new Map<string, ClipCandidate>();
    for (const item of items) {
      uniqueSources.set(
        sha256Fingerprint({
          schemaVersion: 1,
          projectId: input.projectId,
          youtubeVideoId: item.clip.video.youtubeVideoId,
          canonicalUrl: item.clip.video.canonicalUrl,
          acquisitionProfile: "authorized-youtube-full-source",
        }),
        item.clip,
      );
    }
    let knownSourceBytes = 0;
    let unknownSourceCount = 0;
    for (const clip of uniqueSources.values()) {
      const estimate = await this.dependencies.estimateSourceBytes?.(clip);
      if (estimate === undefined) unknownSourceCount += 1;
      else knownSourceBytes = addBytes(knownSourceBytes, estimate);
    }
    const outputEstimatedBytes = items.reduce(
      (sum, item) => addBytes(sum, item.outputEstimatedBytes),
      0,
    );
    const [availableBytes, activeCheckpointReserveBytes] = await Promise.all([
      this.dependencies.capacity.availableBytes(),
      this.dependencies.capacity.activeCheckpointReserveBytes(),
    ]);
    const knownRequiredBytes = [
      knownSourceBytes,
      outputEstimatedBytes,
      outputEstimatedBytes,
      activeCheckpointReserveBytes,
      ExportStorageSafetyReserveBytes,
    ].reduce(addBytes, 0);
    const preflightFingerprint = sha256Fingerprint({
      schemaVersion: 1,
      outputEstimatePolicyVersion: OutputEstimatePolicyVersion,
      projectId: input.projectId,
      items: items.map((item) => ({
        clipId: item.clip.id,
        sourceLanguageClass: item.sourceLanguageClass,
        subtitleTracks: item.command.subtitleTracks ?? null,
        resolutionFingerprint:
          item.preview.snapshot.resolutionFingerprint ?? null,
        outputEstimatedBytes: item.outputEstimatedBytes,
      })),
      sourceGroups: [...uniqueSources.keys()].toSorted(),
      settingsSelection: request.settingsSelection,
      reexportArtifactVersionId: request.reexportArtifactVersionId ?? null,
    });
    return {
      items,
      preflight: ExportStoragePreflightSchema.parse({
        schemaVersion: 1,
        projectId: input.projectId,
        preflightFingerprint,
        checkedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        availableBytes,
        uniqueSourceCount: uniqueSources.size,
        sourceSharingAssurance: "same_worker_profile_only",
        knownSourceBytes,
        unknownSourceCount,
        outputEstimatedBytes,
        promotionReserveBytes: outputEstimatedBytes,
        activeCheckpointReserveBytes,
        safetyReserveBytes: ExportStorageSafetyReserveBytes,
        knownRequiredBytes,
        decision:
          availableBytes < knownRequiredBytes
            ? "insufficient"
            : unknownSourceCount
              ? "confirmation_required"
              : "ready",
        items: items.map((item) => ({
          clipId: item.clip.id,
          sourceLanguageClass: item.sourceLanguageClass,
          resolvedSettingsSnapshot: item.preview.snapshot,
          outputEstimatedBytes: item.outputEstimatedBytes,
        })),
      }),
    };
  }
}

export function createFileSystemStorageCapacityProvider(
  dataRoot: string,
  activeCheckpointReserveBytes: () => Promise<number> = async () => 0,
): ExportStorageCapacityProvider {
  return {
    async availableBytes() {
      try {
        const storage = await statfs(dataRoot, { bigint: true });
        return safeBytes(storage.bavail * storage.bsize);
      } catch {
        throw new ClipLibraryExportOperationError(
          "Local storage capacity is unavailable.",
          "export_storage_capacity_unavailable",
          503,
        );
      }
    },
    async activeCheckpointReserveBytes() {
      try {
        return safeBytes(await activeCheckpointReserveBytes());
      } catch (error) {
        if (error instanceof ClipLibraryExportOperationError) throw error;
        throw new ClipLibraryExportOperationError(
          "Active storage reserve evidence is unavailable.",
          "export_storage_reserve_unavailable",
          503,
        );
      }
    },
  };
}

export function createPostAcquisitionExportStorageGuard(
  capacity: ExportStorageCapacityProvider,
): PostAcquisitionExportStorageGuard {
  let reservedOutputPeakBytes = 0;
  let reservationTail = Promise.resolve();
  return {
    async assertCanRender(request, acquiredSourceBytes) {
      // The acquired source is already occupying the filesystem. Reconstructing
      // the before-acquisition evidence proves the actual byte count was used,
      // while comparing current free space avoids counting those bytes twice.
      safeBytes(acquiredSourceBytes);
      const snapshot = request.resolvedSettingsSnapshot;
      if (!snapshot) {
        throw new ClipLibraryExportOperationError(
          "Resolved export settings are unavailable for the storage recheck.",
          "export_storage_settings_missing",
          409,
        );
      }
      const outputEstimatedBytes = estimateOutputPackageBytes(
        request.selection.exportEndMs - request.selection.exportStartMs,
        snapshot.settings,
      );
      const outputPeakBytes = addBytes(
        outputEstimatedBytes,
        outputEstimatedBytes,
      );
      const predecessor = reservationTail;
      let unlock!: () => void;
      reservationTail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await predecessor;
      try {
        const [availableBytes, activeCheckpointReserveBytes] =
          await Promise.all([
            capacity.availableBytes(),
            capacity.activeCheckpointReserveBytes(),
          ]);
        const remainingRequiredBytes = [
          reservedOutputPeakBytes,
          outputPeakBytes,
          activeCheckpointReserveBytes,
          ExportStorageSafetyReserveBytes,
        ].reduce(addBytes, 0);
        if (availableBytes < remainingRequiredBytes) {
          throw new ClipLibraryExportOperationError(
            "Available storage fell below this export's measured render requirement after source acquisition.",
            "export_storage_insufficient_after_acquisition",
            409,
          );
        }
        reservedOutputPeakBytes = addBytes(
          reservedOutputPeakBytes,
          outputPeakBytes,
        );
      } finally {
        unlock();
      }
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          reservedOutputPeakBytes -= outputPeakBytes;
        },
      };
    },
  };
}

export function estimateOutputPackageBytes(
  durationMs: number,
  settings: ExportSettings,
): number {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new ClipLibraryExportOperationError(
      "The selected export duration is invalid.",
      "clip_library_export_duration_invalid",
      409,
    );
  }
  const videoKilobitsPerSecond =
    settings.videoRateControl.mode === "bitrate"
      ? settings.videoRateControl.kilobitsPerSecond
      : settings.videoCodec === "prores"
        ? 220_000
        : settings.videoCodec === "hevc"
          ? 80_000
          : 50_000;
  const audioKilobitsPerSecond =
    settings.audioCodec === "pcm_s16le"
      ? 1_536
      : (settings.audioKilobitsPerSecond ?? 320);
  const mediaBytes = Math.ceil(
    ((durationMs / 1_000) *
      ((videoKilobitsPerSecond + audioKilobitsPerSecond) * 1_000)) /
      8,
  );
  return addBytes(Math.ceil(mediaBytes * 1.1), PackageOverheadBytes);
}

function addBytes(left: number, right: number) {
  return safeBytes(BigInt(left) + BigInt(right));
}

function safeBytes(value: number | bigint) {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new ClipLibraryExportOperationError(
      "The storage estimate is outside the supported range.",
      "export_storage_estimate_invalid",
      422,
    );
  }
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  if (numeric < 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ClipLibraryExportOperationError(
      "The storage estimate exceeds the supported range.",
      "export_storage_estimate_overflow",
      422,
    );
  }
  return Number(numeric);
}
