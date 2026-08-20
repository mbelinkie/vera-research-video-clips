import { readdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  CreateExportOnlyRequestSchema,
  ExportRequestSchema,
  NormalizedTranscriptSchema,
  languagesEquivalent,
  primaryLanguage,
  type CreateExportOnlyRequest,
  type DerivedTranslationIdentity,
  type ExportRequest,
  type NormalizedTranscript,
} from "@research-video/contracts";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

const localExportRequestSelect = `SELECT er.*, j.state,
  ssa.duration_ms AS media_duration_ms,
  ssa.container_format AS media_container_format,
  ssa.video_codec AS media_video_codec,
  ssa.audio_codec AS media_audio_codec,
  ssa.ffprobe_version AS media_ffprobe_version,
  er.rendered_duration_ms,
  er.rendered_container_format,
  er.rendered_video_codec,
  er.rendered_audio_codec,
  er.rendered_ffprobe_version,
  er.rendered_ffmpeg_version,
  er.rendered_source_attempt,
  er.rendered_validated_at,
  er.subtitle_omission_policy,
  er.subtitle_omission_source_attempt,
  er.subtitle_omission_validated_at,
  er.english_subtitle_track_id,
  er.english_subtitle_track_version,
  er.english_subtitle_cue_count,
  er.english_subtitle_byte_size,
  er.english_subtitle_content_sha256,
  er.english_subtitle_start_ms,
  er.english_subtitle_end_ms,
  er.english_subtitle_source_attempt,
  er.english_subtitle_validated_at,
  er.subtitle_tracks_snapshot_json
  FROM export_requests er
  JOIN jobs j ON j.id = er.job_id
  LEFT JOIN source_scratch_assets ssa
    ON ssa.job_id = er.job_id AND ssa.attempt = er.resolved_source_attempt`;

export function openLocalDatabase(filename: string): DatabaseSync {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  return database;
}

export function runLocalMigrations(
  database: DatabaseSync,
  migrationDirectory = defaultMigrationDirectory,
): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{
    version: string;
  }>;
  const applied = new Set(appliedRows.map((row) => row.version));
  const files = readdirSync(resolve(migrationDirectory))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();
  const newlyApplied: string[] = [];

  for (const filename of files) {
    const version = basename(filename, ".sql");
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(migrationDirectory, filename), "utf8");
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(version, new Date().toISOString());
      database.exec("COMMIT;");
      newlyApplied.push(version);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  return newlyApplied;
}

export class LocalExportQueue {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createExportOnly(input: CreateExportOnlyRequest): ExportRequest {
    const request = CreateExportOnlyRequestSchema.parse(input);
    const idempotencyKey = `export-only:${request.idempotencyKey}`;
    const existing = this.database
      .prepare(
        `${localExportRequestSelect}
         WHERE j.idempotency_key = ?`,
      )
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) return this.mapRequest(existing);

    const requestId = randomUUID();
    const jobId = randomUUID();
    const now = this.now().toISOString();
    const videoSnapshot = JSON.stringify(request.video);
    const selectionSnapshot = JSON.stringify(request.selection);
    const presetSnapshot = JSON.stringify(request.preset);
    const subtitleTracksSnapshot = request.subtitleTracks
      ? JSON.stringify(request.subtitleTracks)
      : null;
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `INSERT INTO jobs
             (id, project_id, kind, state, idempotency_key, attempt,
              payload_json, created_at, updated_at)
           VALUES (?, NULL, 'export', 'queued', ?, 0, ?, ?, ?)`,
        )
        .run(
          jobId,
          idempotencyKey,
          JSON.stringify({
            exportRequestId: requestId,
            mode: "export_only",
            video: request.video,
            selection: request.selection,
            sourceLanguageClass: request.sourceLanguageClass,
            preset: request.preset,
          }),
          now,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO export_requests
             (id, job_id, mode, video_snapshot_json,
              selection_snapshot_json, source_language_class,
              preset_snapshot_json, subtitle_tracks_snapshot_json, created_at, updated_at)
           VALUES (?, ?, 'export_only', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          requestId,
          jobId,
          videoSnapshot,
          selectionSnapshot,
          request.sourceLanguageClass,
          presetSnapshot,
          subtitleTracksSnapshot,
          now,
          now,
        );
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return this.get(requestId)!;
  }

  get(requestId: string): ExportRequest | undefined {
    const row = this.database
      .prepare(
        `${localExportRequestSelect}
         WHERE er.id = ?`,
      )
      .get(requestId) as Record<string, unknown> | undefined;
    return row ? this.mapRequest(row) : undefined;
  }

  list(): ExportRequest[] {
    return (
      this.database
        .prepare(
          `${localExportRequestSelect}
           ORDER BY er.created_at DESC, er.id
           LIMIT 500`,
        )
        .all() as Record<string, unknown>[]
    ).map((row) => this.mapRequest(row));
  }

  getVerifiedEnglishTranscript(input: {
    trackId: string;
    trackVersion: number;
    videoId: string;
  }): NormalizedTranscript | undefined {
    return new LocalTranscriptIndex(this.database).findExactEnglish(input);
  }

  getVerifiedOriginalTranscript(input: {
    trackId: string;
    trackVersion: number;
    videoId: string;
  }): NormalizedTranscript | undefined {
    return new LocalTranscriptIndex(this.database).findExactOriginal(input);
  }

  beginSourceAcquisition(requestId: string): LocalExportSourceAttempt {
    const request = this.get(requestId);
    if (!request) throw new LocalExportRequestNotFoundError();
    if (request.state === "complete") {
      throw new LocalExportLifecycleError(
        "A completed export cannot acquire a new source.",
        "export_already_complete",
      );
    }
    const now = this.now().toISOString();
    const expiresAt = new Date(
      this.now().getTime() + 24 * 60 * 60 * 1_000,
    ).toISOString();
    const attempt = this.database
      .prepare("SELECT attempt FROM jobs WHERE id = ?")
      .get(request.jobId) as { attempt: number };
    const nextAttempt = attempt.attempt + 1;
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `UPDATE jobs
           SET state = 'processing', attempt = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(nextAttempt, now, request.jobId);
      this.database
        .prepare(
          `INSERT INTO source_scratch_assets
             (id, job_id, attempt, lifecycle_state, created_at, expires_at, updated_at)
           VALUES (?, ?, ?, 'acquiring', ?, ?, ?)`,
        )
        .run(randomUUID(), request.jobId, nextAttempt, now, expiresAt, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return { request, attempt: nextAttempt };
  }

  recordSourceNotStartedFailure(
    requestId: string,
    code: string,
    message: string,
  ): void {
    const request = this.get(requestId);
    if (!request) throw new LocalExportRequestNotFoundError();
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.markJobNeedsUserAction(request.jobId, code, message, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordSourceReady(
    jobId: string,
    attempt: number,
    source: {
      provider: string;
      sourceIdentity: string;
      byteSize: number;
      contentSha256: string;
    },
  ): void {
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE source_scratch_assets
         SET provider = ?, source_identity = ?, byte_size = ?, content_sha256 = ?,
             lifecycle_state = 'ready', ready_at = ?, updated_at = ?
         WHERE job_id = ? AND attempt = ? AND lifecycle_state = 'acquiring'`,
      )
      .run(
        source.provider,
        source.sourceIdentity,
        source.byteSize,
        source.contentSha256,
        now,
        now,
        jobId,
        attempt,
      );
    if (result.changes !== 1) throw new LocalExportLifecycleError();
  }

  recordSourceInspection(
    jobId: string,
    attempt: number,
    inspection: {
      durationMs: number;
      containerFormat?: string;
      videoCodec?: string;
      audioCodec?: string;
      ffprobeVersion?: string;
    },
    resolvedBounds: { startMs: number; endMs: number },
  ): void {
    if (
      !Number.isSafeInteger(inspection.durationMs) ||
      inspection.durationMs <= 0 ||
      !Number.isSafeInteger(resolvedBounds.startMs) ||
      !Number.isSafeInteger(resolvedBounds.endMs) ||
      resolvedBounds.startMs < 0 ||
      resolvedBounds.endMs <= resolvedBounds.startMs ||
      resolvedBounds.endMs > inspection.durationMs
    ) {
      throw new LocalExportLifecycleError(
        "Resolved export bounds are invalid for the inspected source.",
        "export_bounds_invalid",
      );
    }
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const source = this.database
        .prepare(
          `UPDATE source_scratch_assets
           SET duration_ms = ?, container_format = ?, video_codec = ?, audio_codec = ?,
               ffprobe_version = ?, updated_at = ?
           WHERE job_id = ? AND attempt = ? AND lifecycle_state = 'ready'`,
        )
        .run(
          inspection.durationMs,
          safeProbeValue(inspection.containerFormat, 240),
          safeProbeValue(inspection.videoCodec, 120),
          safeProbeValue(inspection.audioCodec, 120),
          safeProbeValue(inspection.ffprobeVersion, 120),
          now,
          jobId,
          attempt,
        );
      if (source.changes !== 1) throw new LocalExportLifecycleError();
      const request = this.database
        .prepare(
          `UPDATE export_requests
           SET resolved_export_start_ms = ?, resolved_export_end_ms = ?,
               resolved_source_attempt = ?, resolved_at = ?, updated_at = ?
           WHERE job_id = ?`,
        )
        .run(
          resolvedBounds.startMs,
          resolvedBounds.endMs,
          attempt,
          now,
          now,
          jobId,
        );
      if (request.changes !== 1) throw new LocalExportLifecycleError();
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordSourceCleanupStarted(jobId: string, attempt: number): void {
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE source_scratch_assets
         SET lifecycle_state = 'deleting', cleanup_started_at = ?, updated_at = ?
         WHERE job_id = ? AND attempt = ?
           AND lifecycle_state IN ('acquiring', 'ready')`,
      )
      .run(now, now, jobId, attempt);
    if (result.changes !== 1) throw new LocalExportLifecycleError();
  }

  recordRenderedOutputValidation(
    jobId: string,
    attempt: number,
    inspection: {
      durationMs: number;
      containerFormat?: string;
      videoCodec?: string;
      audioCodec?: string;
      ffprobeVersion?: string;
      ffmpegVersion?: string;
    },
  ): void {
    if (
      !Number.isSafeInteger(inspection.durationMs) ||
      inspection.durationMs <= 0
    ) {
      throw new LocalExportLifecycleError(
        "Rendered output provenance is invalid.",
        "render_output_provenance_invalid",
      );
    }
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE export_requests
         SET rendered_duration_ms = ?, rendered_container_format = ?,
             rendered_video_codec = ?, rendered_audio_codec = ?,
             rendered_ffprobe_version = ?, rendered_ffmpeg_version = ?,
             rendered_source_attempt = ?, rendered_validated_at = ?,
             updated_at = ?
         WHERE job_id = ? AND resolved_source_attempt = ?`,
      )
      .run(
        inspection.durationMs,
        safeProbeValue(inspection.containerFormat, 240),
        safeProbeValue(inspection.videoCodec, 120),
        safeProbeValue(inspection.audioCodec, 120),
        safeProbeValue(inspection.ffprobeVersion, 120),
        safeProbeValue(inspection.ffmpegVersion, 120),
        attempt,
        now,
        now,
        jobId,
        attempt,
      );
    if (result.changes !== 1) throw new LocalExportLifecycleError();
  }

  recordThumbnailValidation(
    jobId: string,
    attempt: number,
    thumbnail: { extractionTimeMs: number; width: number; height: number },
  ): void {
    if (
      !Number.isSafeInteger(thumbnail.extractionTimeMs) ||
      thumbnail.extractionTimeMs < 0 ||
      !Number.isSafeInteger(thumbnail.width) ||
      !Number.isSafeInteger(thumbnail.height) ||
      thumbnail.width <= 0 ||
      thumbnail.height <= 0 ||
      thumbnail.width > 1_280 ||
      thumbnail.height > 720 ||
      thumbnail.width % 2 !== 0 ||
      thumbnail.height % 2 !== 0
    ) {
      throw new LocalExportLifecycleError(
        "Thumbnail provenance is invalid.",
        "thumbnail_provenance_invalid",
      );
    }
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE export_requests
         SET thumbnail_extraction_time_ms = ?, thumbnail_width = ?,
             thumbnail_height = ?, thumbnail_source_attempt = ?,
             thumbnail_validated_at = ?, updated_at = ?
         WHERE job_id = ? AND resolved_source_attempt = ?
           AND rendered_source_attempt = ?
           AND rendered_duration_ms > ?`,
      )
      .run(
        thumbnail.extractionTimeMs,
        thumbnail.width,
        thumbnail.height,
        attempt,
        now,
        now,
        jobId,
        attempt,
        attempt,
        thumbnail.extractionTimeMs,
      );
    if (result.changes !== 1) {
      throw new LocalExportLifecycleError(
        "Thumbnail provenance does not match the rendered export.",
        "thumbnail_provenance_invalid",
      );
    }
  }

  recordConfirmedEnglishSubtitleOmission(jobId: string, attempt: number): void {
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE export_requests
         SET subtitle_omission_policy = ?, subtitle_omission_source_attempt = ?,
             subtitle_omission_validated_at = ?, updated_at = ?
         WHERE job_id = ? AND source_language_class = 'confirmed_english'
           AND resolved_source_attempt = ? AND rendered_source_attempt = ?
           AND json_extract(
             preset_snapshot_json,
             '$.settings.omitSubtitleFilesForConfirmedEnglish'
           ) = 1`,
      )
      .run(
        "confirmed_english_user_setting",
        attempt,
        now,
        now,
        jobId,
        attempt,
        attempt,
      );
    if (result.changes !== 1) {
      throw new LocalExportLifecycleError(
        "Confirmed-English subtitle omission provenance is invalid.",
        "subtitle_omission_provenance_invalid",
      );
    }
  }

  recordEnglishSubtitleValidation(
    jobId: string,
    attempt: number,
    sidecar: {
      trackId: string;
      trackVersion: number;
      cueCount: number;
      byteSize: number;
      contentSha256: string;
      startMs: number;
      endMs: number;
    },
  ): void {
    if (
      !Number.isSafeInteger(sidecar.trackVersion) ||
      sidecar.trackVersion <= 0 ||
      !Number.isSafeInteger(sidecar.cueCount) ||
      sidecar.cueCount <= 0 ||
      !Number.isSafeInteger(sidecar.byteSize) ||
      sidecar.byteSize <= 0 ||
      !/^[a-f0-9]{64}$/u.test(sidecar.contentSha256) ||
      !Number.isSafeInteger(sidecar.startMs) ||
      !Number.isSafeInteger(sidecar.endMs) ||
      sidecar.startMs < 0 ||
      sidecar.endMs <= sidecar.startMs
    ) {
      throw new LocalExportLifecycleError(
        "English subtitle provenance is invalid.",
        "english_subtitle_provenance_invalid",
      );
    }
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE export_requests
         SET english_subtitle_track_id = ?, english_subtitle_track_version = ?,
             english_subtitle_cue_count = ?, english_subtitle_byte_size = ?,
             english_subtitle_content_sha256 = ?, english_subtitle_start_ms = ?,
             english_subtitle_end_ms = ?, english_subtitle_source_attempt = ?,
             english_subtitle_validated_at = ?, updated_at = ?
         WHERE job_id = ? AND resolved_source_attempt = ?
           AND rendered_source_attempt = ?`,
      )
      .run(
        sidecar.trackId,
        sidecar.trackVersion,
        sidecar.cueCount,
        sidecar.byteSize,
        sidecar.contentSha256,
        sidecar.startMs,
        sidecar.endMs,
        attempt,
        now,
        now,
        jobId,
        attempt,
        attempt,
      );
    if (result.changes !== 1) throw new LocalExportLifecycleError();
  }

  recordBilingualSubtitleValidation(
    jobId: string,
    attempt: number,
    sidecars: readonly [
      LocalSubtitleSidecarValidation,
      LocalSubtitleSidecarValidation,
    ],
  ): void {
    const roles = new Set(sidecars.map((sidecar) => sidecar.role));
    if (
      roles.size !== 2 ||
      !roles.has("original") ||
      !roles.has("english") ||
      sidecars.some((sidecar) => !validSubtitleSidecar(sidecar))
    ) {
      throw new LocalExportLifecycleError(
        "Bilingual subtitle provenance is invalid.",
        "bilingual_subtitle_provenance_invalid",
      );
    }
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const request = this.database
        .prepare(
          `SELECT id FROM export_requests
           WHERE job_id = ? AND resolved_source_attempt = ?
             AND rendered_source_attempt = ?`,
        )
        .get(jobId, attempt, attempt) as { id: string } | undefined;
      if (!request) throw new LocalExportLifecycleError();
      const insert = this.database.prepare(
        `INSERT INTO export_subtitle_sidecars
           (export_request_id, role, language, track_id, track_version,
            cue_count, byte_size, content_sha256, start_ms, end_ms,
            source_attempt, validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (export_request_id, role) DO UPDATE SET
           language = excluded.language, track_id = excluded.track_id,
           track_version = excluded.track_version, cue_count = excluded.cue_count,
           byte_size = excluded.byte_size, content_sha256 = excluded.content_sha256,
           start_ms = excluded.start_ms, end_ms = excluded.end_ms,
           source_attempt = excluded.source_attempt, validated_at = excluded.validated_at`,
      );
      for (const sidecar of sidecars) {
        insert.run(
          request.id,
          sidecar.role,
          safeSubtitleLanguage(sidecar.language),
          sidecar.trackId,
          sidecar.trackVersion,
          sidecar.cueCount,
          sidecar.byteSize,
          sidecar.contentSha256,
          sidecar.startMs,
          sidecar.endMs,
          attempt,
          now,
        );
      }
      this.database
        .prepare("UPDATE export_requests SET updated_at = ? WHERE id = ?")
        .run(now, request.id);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordFinalArtifactPromotion(
    jobId: string,
    attempt: number,
    artifacts: readonly LocalFinalArtifactProvenance[],
  ): void {
    const roles = new Set(artifacts.map((artifact) => artifact.role));
    if (
      artifacts.length < 4 ||
      artifacts.length > 6 ||
      roles.size !== artifacts.length ||
      !roles.has("video_mp4") ||
      !roles.has("clip_metadata_json") ||
      !roles.has("thumbnail_jpg") ||
      !roles.has("manifest_json") ||
      artifacts.some((artifact) => !validFinalArtifact(artifact))
    ) {
      throw new LocalExportLifecycleError(
        "Final artifact provenance is invalid.",
        "final_artifact_provenance_invalid",
      );
    }
    const packageIdentity = artifacts[0]?.packageIdentity;
    if (
      !packageIdentity ||
      artifacts.some((a) => a.packageIdentity !== packageIdentity)
    ) {
      throw new LocalExportLifecycleError(
        "Final artifacts must share one package identity.",
        "final_artifact_provenance_invalid",
      );
    }
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const request = this.database
        .prepare(
          `SELECT id FROM export_requests
           WHERE job_id = ? AND resolved_source_attempt = ?
             AND rendered_source_attempt = ?
             AND thumbnail_source_attempt = ?`,
        )
        .get(jobId, attempt, attempt, attempt) as { id: string } | undefined;
      if (!request) throw new LocalExportLifecycleError();
      const insert = this.database.prepare(
        `INSERT INTO export_final_artifacts
           (export_request_id, role, package_identity, byte_size,
            content_sha256, source_attempt, validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (export_request_id, role) DO UPDATE SET
           package_identity = excluded.package_identity,
           byte_size = excluded.byte_size,
           content_sha256 = excluded.content_sha256,
           source_attempt = excluded.source_attempt,
           validated_at = excluded.validated_at`,
      );
      for (const artifact of artifacts) {
        insert.run(
          request.id,
          artifact.role,
          artifact.packageIdentity,
          artifact.byteSize,
          artifact.contentSha256,
          attempt,
          artifact.validatedAt,
        );
      }
      this.database
        .prepare("UPDATE export_requests SET updated_at = ? WHERE id = ?")
        .run(now, request.id);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordSourceCleanupSucceeded(jobId: string, attempt: number): void {
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const deleted = this.database
        .prepare(
          `UPDATE source_scratch_assets
           SET lifecycle_state = 'deleted', deleted_at = ?, updated_at = ?,
               cleanup_error_code = NULL, cleanup_error_message = NULL
           WHERE job_id = ? AND attempt = ? AND lifecycle_state = 'deleting'`,
        )
        .run(now, now, jobId, attempt);
      if (deleted.changes !== 1) throw new LocalExportLifecycleError();
      this.database
        .prepare(
          `UPDATE jobs SET state = CASE WHEN EXISTS (
             SELECT 1 FROM export_final_artifacts efa
             JOIN export_requests er ON er.id = efa.export_request_id
             WHERE er.job_id = ? AND efa.source_attempt = ?
           ) THEN 'complete' ELSE 'queued' END, updated_at = ?
           WHERE id = ? AND state = 'processing'`,
        )
        .run(jobId, attempt, now, jobId);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordSourceCleanupFailed(
    jobId: string,
    attempt: number,
    message: string,
  ): void {
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.database
        .prepare(
          `UPDATE source_scratch_assets
           SET lifecycle_state = 'cleanup_failed', cleanup_error_code = 'source_cleanup_failed',
               cleanup_error_message = ?, updated_at = ?
           WHERE job_id = ? AND attempt = ?
             AND lifecycle_state IN ('acquiring', 'ready', 'deleting')`,
        )
        .run(safeLocalError(message), now, jobId, attempt);
      if (result.changes !== 1) throw new LocalExportLifecycleError();
      this.markJobNeedsUserAction(jobId, "source_cleanup_failed", message, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordSourceAttemptFailure(
    jobId: string,
    attempt: number,
    code: string,
    message: string,
  ): void {
    const now = this.now().toISOString();
    const asset = this.database
      .prepare(
        `SELECT lifecycle_state FROM source_scratch_assets
         WHERE job_id = ? AND attempt = ?`,
      )
      .get(jobId, attempt) as { lifecycle_state: string } | undefined;
    if (!asset) throw new LocalExportLifecycleError();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.markJobNeedsUserAction(jobId, code, message, now);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  getSourceAttempt(
    jobId: string,
    attempt: number,
  ): LocalSourceScratchAsset | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM source_scratch_assets WHERE job_id = ? AND attempt = ?`,
      )
      .get(jobId, attempt) as Record<string, unknown> | undefined;
    return row ? mapLocalSourceScratchAsset(row) : undefined;
  }

  private mapRequest(row: Record<string, unknown>): ExportRequest {
    return mapLocalExportRequest(
      row,
      this.database
        .prepare(
          `SELECT role, language, track_id, track_version, cue_count,
                  byte_size, content_sha256, start_ms, end_ms,
                  source_attempt, validated_at
           FROM export_subtitle_sidecars
           WHERE export_request_id = ? ORDER BY role`,
        )
        .all(String(row.id)) as Record<string, unknown>[],
      this.database
        .prepare(
          `SELECT role, package_identity, byte_size, content_sha256,
                  source_attempt, validated_at
           FROM export_final_artifacts
           WHERE export_request_id = ? ORDER BY role`,
        )
        .all(String(row.id)) as Record<string, unknown>[],
    );
  }

  private markJobNeedsUserAction(
    jobId: string,
    code: string,
    message: string,
    now: string,
  ) {
    const job = this.database
      .prepare("SELECT payload_json FROM jobs WHERE id = ?")
      .get(jobId) as { payload_json: string } | undefined;
    if (!job) throw new LocalExportLifecycleError();
    const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
    payload.lastError = { code, message: safeLocalError(message) };
    this.database
      .prepare(
        `UPDATE jobs
         SET state = 'needs_user_action', payload_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(payload), now, jobId);
  }
}

export type LocalExportSourceAttempt = {
  request: ExportRequest;
  attempt: number;
};

type LocalSubtitleSidecarValidation = {
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

type LocalFinalArtifactProvenance = {
  role:
    | "video_mp4"
    | "english_srt"
    | "original_srt"
    | "clip_metadata_json"
    | "thumbnail_jpg"
    | "manifest_json";
  packageIdentity: string;
  byteSize: number;
  contentSha256: string;
  sourceAttempt: number;
  validatedAt: string;
};

export type LocalSourceScratchAsset = {
  jobId: string;
  attempt: number;
  provider?: string;
  sourceIdentity?: string;
  byteSize?: number;
  contentSha256?: string;
  durationMs?: number;
  containerFormat?: string;
  videoCodec?: string;
  audioCodec?: string;
  ffprobeVersion?: string;
  lifecycleState:
    "acquiring" | "ready" | "deleting" | "deleted" | "cleanup_failed";
  cleanupErrorCode?: string;
  cleanupErrorMessage?: string;
  deletedAt?: string;
  expiresAt: string;
};

export class LocalExportRequestNotFoundError extends Error {
  readonly code = "export_request_not_found";
  readonly statusCode = 404;

  constructor() {
    super("Export request not found.");
  }
}

export class LocalExportLifecycleError extends Error {
  readonly code: string = "export_source_lifecycle_conflict";
  readonly statusCode = 409;

  constructor(
    message = "Export source lifecycle state changed; reload before retrying.",
    code = "export_source_lifecycle_conflict",
  ) {
    super(message);
    this.code = code;
  }
}

function mapLocalExportRequest(
  row: Record<string, unknown>,
  subtitleSidecars: readonly Record<string, unknown>[] = [],
  finalArtifacts: readonly Record<string, unknown>[] = [],
): ExportRequest {
  return ExportRequestSchema.parse({
    id: row.id,
    jobId: row.job_id,
    mode: row.mode,
    video: JSON.parse(String(row.video_snapshot_json)),
    selection: JSON.parse(String(row.selection_snapshot_json)),
    sourceLanguageClass: row.source_language_class,
    ...(row.subtitle_tracks_snapshot_json === null ||
    row.subtitle_tracks_snapshot_json === undefined
      ? {}
      : {
          subtitleTracks: JSON.parse(String(row.subtitle_tracks_snapshot_json)),
        }),
    preset: JSON.parse(String(row.preset_snapshot_json)),
    ...(row.media_duration_ms === null || row.media_duration_ms === undefined
      ? {}
      : {
          mediaProvenance: {
            durationMs: Number(row.media_duration_ms),
            ...(row.media_container_format === null
              ? {}
              : { containerFormat: String(row.media_container_format) }),
            ...(row.media_video_codec === null
              ? {}
              : { videoCodec: String(row.media_video_codec) }),
            ...(row.media_audio_codec === null
              ? {}
              : { audioCodec: String(row.media_audio_codec) }),
            ...(row.media_ffprobe_version === null
              ? {}
              : { ffprobeVersion: String(row.media_ffprobe_version) }),
          },
        }),
    ...(row.resolved_export_start_ms === null ||
    row.resolved_export_start_ms === undefined ||
    row.resolved_export_end_ms === null ||
    row.resolved_source_attempt === null ||
    row.resolved_at === null
      ? {}
      : {
          resolvedExportBounds: {
            startMs: Number(row.resolved_export_start_ms),
            endMs: Number(row.resolved_export_end_ms),
            sourceAttempt: Number(row.resolved_source_attempt),
            resolvedAt: String(row.resolved_at),
          },
        }),
    ...(row.rendered_duration_ms === null ||
    row.rendered_duration_ms === undefined ||
    row.rendered_source_attempt === null ||
    row.rendered_validated_at === null
      ? {}
      : {
          renderedMediaProvenance: {
            durationMs: Number(row.rendered_duration_ms),
            ...(row.rendered_container_format === null
              ? {}
              : { containerFormat: String(row.rendered_container_format) }),
            ...(row.rendered_video_codec === null
              ? {}
              : { videoCodec: String(row.rendered_video_codec) }),
            ...(row.rendered_audio_codec === null
              ? {}
              : { audioCodec: String(row.rendered_audio_codec) }),
            ...(row.rendered_ffprobe_version === null
              ? {}
              : { ffprobeVersion: String(row.rendered_ffprobe_version) }),
            ...(row.rendered_ffmpeg_version === null
              ? {}
              : { ffmpegVersion: String(row.rendered_ffmpeg_version) }),
            sourceAttempt: Number(row.rendered_source_attempt),
            validatedAt: String(row.rendered_validated_at),
          },
        }),
    ...(row.thumbnail_extraction_time_ms === null ||
    row.thumbnail_extraction_time_ms === undefined ||
    row.thumbnail_width === null ||
    row.thumbnail_height === null ||
    row.thumbnail_source_attempt === null ||
    row.thumbnail_validated_at === null
      ? {}
      : {
          thumbnailProvenance: {
            extractionTimeMs: Number(row.thumbnail_extraction_time_ms),
            width: Number(row.thumbnail_width),
            height: Number(row.thumbnail_height),
            sourceAttempt: Number(row.thumbnail_source_attempt),
            validatedAt: String(row.thumbnail_validated_at),
          },
        }),
    ...(row.subtitle_omission_policy === null ||
    row.subtitle_omission_policy === undefined ||
    row.subtitle_omission_source_attempt === null ||
    row.subtitle_omission_validated_at === null
      ? {}
      : {
          subtitleOmissionProvenance: {
            policy: String(row.subtitle_omission_policy),
            sourceAttempt: Number(row.subtitle_omission_source_attempt),
            validatedAt: String(row.subtitle_omission_validated_at),
          },
        }),
    ...(row.english_subtitle_track_id === null ||
    row.english_subtitle_track_id === undefined ||
    row.english_subtitle_track_version === null ||
    row.english_subtitle_cue_count === null ||
    row.english_subtitle_byte_size === null ||
    row.english_subtitle_content_sha256 === null ||
    row.english_subtitle_start_ms === null ||
    row.english_subtitle_end_ms === null ||
    row.english_subtitle_source_attempt === null ||
    row.english_subtitle_validated_at === null
      ? {}
      : {
          englishSubtitleProvenance: {
            trackId: String(row.english_subtitle_track_id),
            trackVersion: Number(row.english_subtitle_track_version),
            cueCount: Number(row.english_subtitle_cue_count),
            byteSize: Number(row.english_subtitle_byte_size),
            contentSha256: String(row.english_subtitle_content_sha256),
            startMs: Number(row.english_subtitle_start_ms),
            endMs: Number(row.english_subtitle_end_ms),
            sourceAttempt: Number(row.english_subtitle_source_attempt),
            validatedAt: String(row.english_subtitle_validated_at),
          },
        }),
    ...(subtitleSidecars.length === 0
      ? {}
      : {
          subtitleSidecars: subtitleSidecars.map((sidecar) => ({
            role: String(sidecar.role),
            language: String(sidecar.language),
            trackId: String(sidecar.track_id),
            trackVersion: Number(sidecar.track_version),
            cueCount: Number(sidecar.cue_count),
            byteSize: Number(sidecar.byte_size),
            contentSha256: String(sidecar.content_sha256),
            startMs: Number(sidecar.start_ms),
            endMs: Number(sidecar.end_ms),
            sourceAttempt: Number(sidecar.source_attempt),
            validatedAt: String(sidecar.validated_at),
          })),
        }),
    ...(finalArtifacts.length === 0
      ? {}
      : {
          finalArtifacts: finalArtifacts.map((artifact) => ({
            role: String(artifact.role),
            packageIdentity: String(artifact.package_identity),
            byteSize: Number(artifact.byte_size),
            contentSha256: String(artifact.content_sha256),
            sourceAttempt: Number(artifact.source_attempt),
            validatedAt: String(artifact.validated_at),
          })),
        }),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapLocalSourceScratchAsset(
  row: Record<string, unknown>,
): LocalSourceScratchAsset {
  return {
    jobId: String(row.job_id),
    attempt: Number(row.attempt),
    ...(row.provider === null ? {} : { provider: String(row.provider) }),
    ...(row.source_identity === null
      ? {}
      : { sourceIdentity: String(row.source_identity) }),
    ...(row.byte_size === null ? {} : { byteSize: Number(row.byte_size) }),
    ...(row.content_sha256 === null
      ? {}
      : { contentSha256: String(row.content_sha256) }),
    ...(row.duration_ms === null
      ? {}
      : { durationMs: Number(row.duration_ms) }),
    ...(row.container_format === null
      ? {}
      : { containerFormat: String(row.container_format) }),
    ...(row.video_codec === null
      ? {}
      : { videoCodec: String(row.video_codec) }),
    ...(row.audio_codec === null
      ? {}
      : { audioCodec: String(row.audio_codec) }),
    ...(row.ffprobe_version === null
      ? {}
      : { ffprobeVersion: String(row.ffprobe_version) }),
    lifecycleState:
      row.lifecycle_state as LocalSourceScratchAsset["lifecycleState"],
    ...(row.cleanup_error_code === null
      ? {}
      : { cleanupErrorCode: String(row.cleanup_error_code) }),
    ...(row.cleanup_error_message === null
      ? {}
      : { cleanupErrorMessage: String(row.cleanup_error_message) }),
    ...(row.deleted_at === null ? {} : { deletedAt: String(row.deleted_at) }),
    expiresAt: String(row.expires_at),
  };
}

function safeLocalError(message: string) {
  return message
    .replaceAll(/(?:[A-Za-z]:)?\/(?:[^\s'"]+)/gu, "<path>")
    .replaceAll(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 500);
}

function safeProbeValue(value: string | undefined, maximumLength: number) {
  if (!value) return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9._,+-]+$/u.test(normalized) &&
    normalized.length <= maximumLength
    ? normalized
    : null;
}

function validSubtitleSidecar(sidecar: LocalSubtitleSidecarValidation) {
  return (
    safeSubtitleLanguage(sidecar.language) !== null &&
    !/\s/u.test(sidecar.trackId) &&
    Number.isSafeInteger(sidecar.trackVersion) &&
    sidecar.trackVersion > 0 &&
    Number.isSafeInteger(sidecar.cueCount) &&
    sidecar.cueCount > 0 &&
    Number.isSafeInteger(sidecar.byteSize) &&
    sidecar.byteSize > 0 &&
    /^[a-f0-9]{64}$/u.test(sidecar.contentSha256) &&
    Number.isSafeInteger(sidecar.startMs) &&
    Number.isSafeInteger(sidecar.endMs) &&
    sidecar.startMs >= 0 &&
    sidecar.endMs > sidecar.startMs
  );
}

function validFinalArtifact(artifact: LocalFinalArtifactProvenance) {
  return (
    /^clip-[a-f0-9-]{36}$/u.test(artifact.packageIdentity) &&
    Number.isSafeInteger(artifact.byteSize) &&
    artifact.byteSize > 0 &&
    /^[a-f0-9]{64}$/u.test(artifact.contentSha256) &&
    Number.isSafeInteger(artifact.sourceAttempt) &&
    artifact.sourceAttempt > 0 &&
    /^\d{4}-\d{2}-\d{2}T/u.test(artifact.validatedAt)
  );
}

function safeSubtitleLanguage(language: string) {
  const normalized = language.trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(normalized) &&
    normalized.length <= 35
    ? normalized
    : null;
}

export class LocalTranscriptIndex {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  replace(input: {
    projectId: string;
    catalogVideoId: string;
    transcriptVersionId: string;
    transcript: NormalizedTranscript;
  }): void {
    const transcript = NormalizedTranscriptSchema.parse(input.transcript);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `DELETE FROM transcript_tracks
           WHERE transcript_version_id = ? AND id = ?`,
        )
        .run(input.transcriptVersionId, transcript.track.id);
      this.database
        .prepare(
          `INSERT INTO transcript_tracks
             (transcript_version_id, id, project_id, catalog_video_id,
              video_id, language, kind, source, provider, model,
              source_track_id, timing_precision, schema_version,
              content_sha256, version, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.transcriptVersionId,
          transcript.track.id,
          input.projectId,
          input.catalogVideoId,
          transcript.track.videoId,
          transcript.track.language,
          transcript.track.kind,
          transcript.track.source,
          transcript.track.provider,
          transcript.track.model ?? null,
          transcript.track.sourceTrackId ?? null,
          transcript.track.timingPrecision,
          transcript.track.schemaVersion,
          transcript.track.contentSha256,
          transcript.track.version,
          this.now().toISOString(),
        );
      const insertSegment = this.database.prepare(
        `INSERT INTO transcript_segments
           (transcript_version_id, id, track_id, ordinal, start_ms, end_ms, text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const segment of transcript.segments) {
        insertSegment.run(
          input.transcriptVersionId,
          segment.id,
          segment.trackId,
          segment.ordinal,
          segment.startMs,
          segment.endMs,
          segment.text,
        );
      }
      const insertToken = this.database.prepare(
        `INSERT INTO transcript_tokens
           (transcript_version_id, id, segment_id, ordinal, text,
            start_ms, end_ms, timing_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const token of transcript.tokens) {
        insertToken.run(
          input.transcriptVersionId,
          token.id,
          token.segmentId,
          token.ordinal,
          token.text,
          token.startMs ?? null,
          token.endMs ?? null,
          token.timingConfidence ?? null,
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  get(
    transcriptVersionId: string,
    kind: "original" | "english",
  ): NormalizedTranscript | undefined {
    const track = this.database
      .prepare(
        `SELECT * FROM transcript_tracks
         WHERE transcript_version_id = ? AND kind = ?`,
      )
      .get(transcriptVersionId, kind) as Record<string, unknown> | undefined;
    if (!track) return undefined;
    const segments = this.database
      .prepare(
        `SELECT * FROM transcript_segments
         WHERE transcript_version_id = ? AND track_id = ? ORDER BY ordinal`,
      )
      .all(transcriptVersionId, String(track.id)) as Record<string, unknown>[];
    const tokens = this.database
      .prepare(
        `SELECT tt.* FROM transcript_tokens tt
         JOIN transcript_segments ts
           ON ts.transcript_version_id = tt.transcript_version_id
          AND ts.id = tt.segment_id
         WHERE tt.transcript_version_id = ? AND ts.track_id = ?
         ORDER BY ts.ordinal, tt.ordinal`,
      )
      .all(transcriptVersionId, String(track.id)) as Record<string, unknown>[];
    return NormalizedTranscriptSchema.parse({
      track: {
        id: track.id,
        videoId: track.video_id,
        language: track.language,
        kind: track.kind,
        source: track.source,
        provider: track.provider,
        ...(track.model === null ? {} : { model: track.model }),
        ...(track.source_track_id === null
          ? {}
          : { sourceTrackId: track.source_track_id }),
        timingPrecision: track.timing_precision,
        schemaVersion: Number(track.schema_version),
        contentSha256: track.content_sha256,
        version: Number(track.version),
      },
      segments: segments.map((segment) => ({
        id: segment.id,
        trackId: segment.track_id,
        ordinal: Number(segment.ordinal),
        startMs: Number(segment.start_ms),
        endMs: Number(segment.end_ms),
        text: segment.text,
      })),
      tokens: tokens.map((token) => ({
        id: token.id,
        segmentId: token.segment_id,
        ordinal: Number(token.ordinal),
        text: token.text,
        ...(token.start_ms === null ? {} : { startMs: Number(token.start_ms) }),
        ...(token.end_ms === null ? {} : { endMs: Number(token.end_ms) }),
        ...(token.timing_confidence === null
          ? {}
          : { timingConfidence: Number(token.timing_confidence) }),
      })),
    });
  }

  findExactEnglish(input: {
    trackId: string;
    trackVersion: number;
    videoId: string;
  }): NormalizedTranscript | undefined {
    return this.findExact(input, "english");
  }

  findExactOriginal(input: {
    trackId: string;
    trackVersion: number;
    videoId: string;
  }): NormalizedTranscript | undefined {
    return this.findExact(input, "original");
  }

  promoteDerivedTranslation(input: {
    identity: DerivedTranslationIdentity;
    translationVersionId: string;
    manifestSha256: string;
    normalizedSha256: string;
    transcript: NormalizedTranscript;
  }): NormalizedTranscript {
    const transcript = NormalizedTranscriptSchema.parse(input.transcript);
    if (
      transcript.track.kind !== "translation" ||
      transcript.track.sourceTrackId !== input.identity.originalTrackId ||
      !languagesEquivalent(
        transcript.track.language,
        input.identity.targetLanguage,
      ) ||
      transcript.track.provider !== input.identity.provider ||
      (transcript.track.model ?? null) !== (input.identity.model ?? null) ||
      transcript.track.schemaVersion !==
        input.identity.normalizationSchemaVersion
    ) {
      throw new Error(
        "Derived translation does not match its exact cache identity.",
      );
    }
    const encoded = JSON.stringify(transcript);
    const encodedSha256 = createHash("sha256").update(encoded).digest("hex");
    if (
      !/^[a-f0-9]{64}$/u.test(input.manifestSha256) ||
      encodedSha256 !== input.normalizedSha256
    ) {
      throw new Error("Derived translation checksum verification failed.");
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `DELETE FROM derived_translation_cache
           WHERE project_id = ? AND catalog_video_id = ?
             AND base_transcript_version_id = ? AND original_track_id = ?
             AND original_content_sha256 = ? AND target_primary_language = ?
             AND provider = ? AND COALESCE(model, '') = COALESCE(?, '')
             AND normalization_schema_version = ?`,
        )
        .run(
          input.identity.projectId,
          input.identity.catalogVideoId,
          input.identity.baseTranscriptVersionId,
          input.identity.originalTrackId,
          input.identity.originalContentSha256,
          primaryLanguage(input.identity.targetLanguage),
          input.identity.provider,
          input.identity.model ?? null,
          input.identity.normalizationSchemaVersion,
        );
      this.database
        .prepare(
          `INSERT INTO derived_translation_cache
             (translation_version_id, project_id, catalog_video_id,
              base_transcript_version_id, original_track_id,
              original_content_sha256, target_language,
              target_primary_language, provider, model,
              normalization_schema_version, translated_track_id,
              translated_track_version, manifest_sha256, normalized_sha256,
              normalized_transcript_json, promoted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.translationVersionId,
          input.identity.projectId,
          input.identity.catalogVideoId,
          input.identity.baseTranscriptVersionId,
          input.identity.originalTrackId,
          input.identity.originalContentSha256,
          input.identity.targetLanguage,
          primaryLanguage(input.identity.targetLanguage),
          input.identity.provider,
          input.identity.model ?? null,
          input.identity.normalizationSchemaVersion,
          transcript.track.id,
          transcript.track.version,
          input.manifestSha256,
          input.normalizedSha256,
          encoded,
          this.now().toISOString(),
        );
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return transcript;
  }

  findDerivedTranslation(
    identity: DerivedTranslationIdentity,
  ): NormalizedTranscript | undefined {
    const row = this.database
      .prepare(
        `SELECT normalized_transcript_json, normalized_sha256,
                translated_track_id, translated_track_version
         FROM derived_translation_cache
         WHERE project_id = ? AND catalog_video_id = ?
           AND base_transcript_version_id = ? AND original_track_id = ?
           AND original_content_sha256 = ? AND target_primary_language = ?
           AND provider = ? AND COALESCE(model, '') = COALESCE(?, '')
           AND normalization_schema_version = ?`,
      )
      .get(
        identity.projectId,
        identity.catalogVideoId,
        identity.baseTranscriptVersionId,
        identity.originalTrackId,
        identity.originalContentSha256,
        primaryLanguage(identity.targetLanguage),
        identity.provider,
        identity.model ?? null,
        identity.normalizationSchemaVersion,
      ) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const encoded = String(row.normalized_transcript_json);
    if (
      createHash("sha256").update(encoded).digest("hex") !==
      row.normalized_sha256
    ) {
      return undefined;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      return undefined;
    }
    const parsed = NormalizedTranscriptSchema.safeParse(decoded);
    if (!parsed.success) return undefined;
    const track = parsed.data.track;
    return track.kind === "translation" &&
      track.id === row.translated_track_id &&
      track.version === Number(row.translated_track_version) &&
      track.sourceTrackId === identity.originalTrackId &&
      languagesEquivalent(track.language, identity.targetLanguage)
      ? parsed.data
      : undefined;
  }

  private findExact(
    input: { trackId: string; trackVersion: number; videoId: string },
    kind: "original" | "english",
  ): NormalizedTranscript | undefined {
    if (!Number.isSafeInteger(input.trackVersion) || input.trackVersion <= 0)
      return undefined;
    const matches = this.database
      .prepare(
        `SELECT transcript_version_id FROM transcript_tracks
         WHERE id = ? AND version = ? AND video_id = ? AND kind = ?
         ORDER BY transcript_version_id
         LIMIT 2`,
      )
      .all(input.trackId, input.trackVersion, input.videoId, kind) as Array<{
      transcript_version_id: string;
    }>;
    if (matches.length !== 1) return undefined;
    const transcript = this.get(matches[0]!.transcript_version_id, kind);
    return transcript?.track.id === input.trackId &&
      transcript.track.version === input.trackVersion &&
      transcript.track.videoId === input.videoId &&
      transcript.track.kind === kind
      ? transcript
      : undefined;
  }
}
