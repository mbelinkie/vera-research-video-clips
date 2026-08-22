import { readdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  CreateExportOnlyRequestSchema,
  ExportObservedMediaPropertiesSchema,
  ExportRequestSchema,
  LoggedExportDeliverySchema,
  LoggedExportFailureResultSchema,
  LoggedExportCanceledResultSchema,
  LoggedExportExecutionSchema,
  LoggedExportSuccessResultSchema,
  NormalizedTranscriptSchema,
  ResolvedExportSettingsSnapshotSchema,
  languagesEquivalent,
  primaryLanguage,
  sanitizeLoggedExportFailureCode,
  sanitizeLoggedExportFailureMessage,
  type CreateExportOnlyRequest,
  type DerivedTranslationIdentity,
  type ExportRequest,
  type LoggedExportDelivery,
  type LoggedExportFailureResult,
  type LoggedExportCanceledResult,
  type LoggedExportExecution,
  type LoggedExportSuccessResult,
  type ExportObservedMediaProperties,
  type ResolvedExportSettingsSnapshot,
  type NormalizedTranscript,
} from "@research-video/contracts";
import {
  resolveExportSettings,
  canonicalJson,
  resolvedPresetForCompatibility,
  sha256Fingerprint,
} from "@research-video/export-settings";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

const SourceScratchLayoutVersion = 2;
const SourceScratchCleanupClaimLeaseMs = 5 * 60 * 1_000;
const MaxSourceScratchCleanupClaims = 25;

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
  er.rendered_conformance_schema_version,
  er.rendered_settings_sha256,
  er.rendered_observed_properties_json,
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
  database.function("legacy_export_settings_fingerprint", (value) => {
    const digest = createHash("md5").update(String(value)).digest("hex");
    return `${digest}${digest}`;
  });
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

  createExportOnly(
    input: CreateExportOnlyRequest,
    resolvedSettingsSnapshot?: ResolvedExportSettingsSnapshot,
  ): ExportRequest {
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
    const resolved =
      resolvedSettingsSnapshot ??
      (request.preset
        ? resolveExportSettings({
            context: "export_only",
            sourceLanguageClass: request.sourceLanguageClass,
            legacyPreset: request.preset,
            resolvedAt: now,
          }).snapshot
        : undefined);
    if (!resolved) {
      throw new LocalExportLifecycleError(
        "Catalog export creation requires an authoritative resolved settings snapshot.",
        "resolved_export_settings_required",
      );
    }
    const preset = resolvedPresetForCompatibility(resolved);
    const videoSnapshot = JSON.stringify(request.video);
    const selectionSnapshot = JSON.stringify(request.selection);
    const presetSnapshot = JSON.stringify(preset);
    const resolvedSettingsSnapshotJson = JSON.stringify(resolved);
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
            preset,
            resolvedSettingsSnapshot: resolved,
          }),
          now,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO export_requests
             (id, job_id, mode, video_snapshot_json,
              selection_snapshot_json, source_language_class,
              preset_snapshot_json, resolved_settings_snapshot_json,
              subtitle_tracks_snapshot_json, created_at, updated_at)
           VALUES (?, ?, 'export_only', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          requestId,
          jobId,
          videoSnapshot,
          selectionSnapshot,
          request.sourceLanguageClass,
          presetSnapshot,
          resolvedSettingsSnapshotJson,
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

  importLoggedDeliveryPending(input: LoggedExportDelivery): ExportRequest {
    const delivery = LoggedExportDeliverySchema.parse(input);
    const request = delivery.request;
    const physicalMode = "export_only";
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.database
        .prepare(
          `${localExportRequestSelect}
           WHERE er.id = ? OR er.cloud_delivery_id = ?`,
        )
        .get(request.id, delivery.deliveryId) as
        Record<string, unknown> | undefined;
      if (existing) {
        try {
          this.assertExactLoggedDelivery(existing, delivery);
          const replay = this.mapRequest(existing);
          this.database.exec("COMMIT;");
          return replay;
        } catch (error) {
          if (
            !(error instanceof LocalLoggedExportDeliveryConflictError) ||
            String(existing.cloud_delivery_state) !== "pending_acceptance" ||
            String(existing.cloud_delivery_id) !== delivery.deliveryId ||
            delivery.generation <= Number(existing.cloud_delivery_generation) ||
            !this.sameImmutableLoggedRequest(existing, delivery)
          ) {
            throw error;
          }
          this.deletePendingLoggedRequestRows(
            String(existing.id),
            String(existing.job_id),
          );
        }
      }

      this.database
        .prepare(
          `INSERT INTO jobs
             (id, project_id, kind, state, idempotency_key, attempt,
              payload_json, created_at, updated_at)
           VALUES (?, NULL, 'export', 'claimed', ?, 0, ?, ?, ?)`,
        )
        .run(
          request.jobId,
          `logged-delivery:${request.id}`,
          JSON.stringify({
            exportRequestId: request.id,
            mode: "logged",
            projectId: request.projectId,
            clipId: request.clipId,
            video: request.video,
            selection: request.selection,
            sourceLanguageClass: request.sourceLanguageClass,
            ...(request.subtitleTracks
              ? { subtitleTracks: request.subtitleTracks }
              : {}),
            preset: request.preset,
            resolvedSettingsSnapshot: request.resolvedSettingsSnapshot,
          }),
          request.createdAt,
          request.updatedAt,
        );
      this.database
        .prepare(
          `INSERT INTO export_requests
             (id, job_id, mode, video_snapshot_json, selection_snapshot_json,
              source_language_class, preset_snapshot_json,
              resolved_settings_snapshot_json, subtitle_tracks_snapshot_json,
              cloud_project_id, cloud_clip_id, cloud_delivery_id,
              cloud_delivery_generation, cloud_reservation_token,
              cloud_worker_id, cloud_worker_epoch, cloud_reserved_at,
              cloud_reservation_expires_at, cloud_delivery_state,
              created_at, updated_at)
           VALUES ($id, $jobId, $mode, $video, $selection, $sourceLanguage,
                   $preset, $resolved, $subtitleTracks, $projectId, $clipId,
                   $deliveryId, $generation, $reservationToken, $workerId,
                   $workerEpoch, $reservedAt, $reservationExpiresAt,
                   'pending_acceptance', $createdAt, $updatedAt)`,
        )
        .run({
          $id: request.id,
          $jobId: request.jobId,
          $mode: physicalMode,
          $video: JSON.stringify(request.video),
          $selection: JSON.stringify(request.selection),
          $sourceLanguage: request.sourceLanguageClass,
          $preset: JSON.stringify(request.preset),
          $resolved: JSON.stringify(request.resolvedSettingsSnapshot),
          $subtitleTracks: request.subtitleTracks
            ? JSON.stringify(request.subtitleTracks)
            : null,
          $projectId: request.projectId!,
          $clipId: request.clipId!,
          $deliveryId: delivery.deliveryId,
          $generation: delivery.generation,
          $reservationToken: delivery.reservationToken,
          $workerId: delivery.workerId,
          $workerEpoch: delivery.workerEpoch,
          $reservedAt: delivery.reservedAt,
          $reservationExpiresAt: delivery.reservationExpiresAt,
          $createdAt: request.createdAt,
          $updatedAt: request.updatedAt,
        });
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return this.get(request.id)!;
  }

  activateLoggedDelivery(input: LoggedExportDelivery): ExportRequest {
    const delivery = LoggedExportDeliverySchema.parse(input);
    if (delivery.status !== "accepted") {
      throw new LocalLoggedExportDeliveryConflictError(
        "Only a cloud-accepted delivery can become runnable locally.",
      );
    }
    const acceptedAt = delivery.acceptedAt!;
    const existing = this.database
      .prepare(`${localExportRequestSelect} WHERE er.id = ?`)
      .get(delivery.request.id) as Record<string, unknown> | undefined;
    if (!existing) throw new LocalExportRequestNotFoundError();
    this.assertExactLoggedDelivery(existing, delivery);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const activated = this.database
        .prepare(
          `UPDATE export_requests
           SET cloud_delivery_state = 'accepted', cloud_accepted_at = ?,
               updated_at = ?
           WHERE id = ? AND cloud_delivery_state = 'pending_acceptance'
             AND cloud_delivery_id = ? AND cloud_delivery_generation = ?
             AND cloud_reservation_token = ?`,
        )
        .run(
          acceptedAt,
          acceptedAt,
          delivery.request.id,
          delivery.deliveryId,
          delivery.generation,
          delivery.reservationToken,
        );
      if (activated.changes === 1) {
        this.database
          .prepare(
            `UPDATE jobs SET state = 'queued', updated_at = ?
             WHERE id = ? AND state = 'claimed'`,
          )
          .run(acceptedAt, delivery.request.jobId);
      } else if (String(existing.cloud_delivery_state) !== "accepted") {
        throw new LocalLoggedExportDeliveryConflictError(
          "The pending local delivery no longer matches the cloud acceptance.",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return this.get(delivery.request.id)!;
  }

  rejectPendingLoggedDelivery(input: LoggedExportDelivery): void {
    const delivery = LoggedExportDeliverySchema.parse(input);
    const existing = this.database
      .prepare(`${localExportRequestSelect} WHERE er.id = ?`)
      .get(delivery.request.id) as Record<string, unknown> | undefined;
    if (!existing) return;
    this.assertExactLoggedDelivery(existing, delivery);
    if (String(existing.cloud_delivery_state) === "accepted") {
      throw new LocalLoggedExportDeliveryConflictError(
        "An accepted local delivery cannot be rejected.",
      );
    }
    this.removePendingLoggedRequest(
      delivery.request.id,
      delivery.request.jobId,
    );
  }

  getPendingLoggedDelivery(): LoggedExportDelivery | undefined {
    const row = this.database
      .prepare(
        `${localExportRequestSelect}
         WHERE er.cloud_delivery_state = 'pending_acceptance'
         ORDER BY er.created_at, er.id LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return LoggedExportDeliverySchema.parse({
      deliveryId: row.cloud_delivery_id,
      generation: Number(row.cloud_delivery_generation),
      reservationToken: row.cloud_reservation_token,
      workerId: row.cloud_worker_id,
      workerEpoch: Number(row.cloud_worker_epoch),
      status: "reserved",
      reservedAt: row.cloud_reserved_at,
      reservationExpiresAt: row.cloud_reservation_expires_at,
      request: this.mapRequest(row),
    });
  }

  getAcceptedLoggedDelivery(
    requestId: string,
  ): LoggedExportDelivery | undefined {
    const row = this.database
      .prepare(
        `${localExportRequestSelect}
         WHERE er.id = ? AND er.cloud_delivery_state = 'accepted'`,
      )
      .get(requestId) as Record<string, unknown> | undefined;
    if (!row || !row.cloud_accepted_at) return undefined;
    return LoggedExportDeliverySchema.parse({
      deliveryId: row.cloud_delivery_id,
      generation: Number(row.cloud_delivery_generation),
      reservationToken: row.cloud_reservation_token,
      workerId: row.cloud_worker_id,
      workerEpoch: Number(row.cloud_worker_epoch),
      status: "accepted",
      reservedAt: row.cloud_reserved_at,
      reservationExpiresAt: row.cloud_reservation_expires_at,
      acceptedAt: row.cloud_accepted_at,
      request: this.mapRequest(row),
    });
  }

  activateLoggedExecution(input: LoggedExportExecution): LoggedExportExecution {
    const execution = LoggedExportExecutionSchema.parse(input);
    const accepted = this.getAcceptedLoggedDelivery(execution.requestId);
    if (
      !accepted ||
      accepted.workerId !== execution.workerId ||
      accepted.workerEpoch !== execution.workerEpoch
    ) {
      throw new LocalExportLifecycleError(
        "The cloud execution does not match this accepted delivery.",
        "logged_export_execution_ownership_mismatch",
      );
    }
    const row = this.database
      .prepare(
        `SELECT cloud_execution_id, cloud_execution_attempt,
                cloud_execution_lease_token, cloud_execution_started_at
         FROM export_requests WHERE id = ?`,
      )
      .get(execution.requestId) as Record<string, unknown> | undefined;
    if (!row) throw new LocalExportRequestNotFoundError();
    if (row.cloud_execution_id) {
      const existing = this.getLoggedExecution(execution.requestId);
      if (
        !existing ||
        existing.executionId !== execution.executionId ||
        existing.requestId !== execution.requestId ||
        existing.attempt !== execution.attempt ||
        existing.workerId !== execution.workerId ||
        existing.workerEpoch !== execution.workerEpoch ||
        existing.leaseToken !== execution.leaseToken ||
        existing.startedAt !== execution.startedAt
      ) {
        throw new LocalExportLifecycleError(
          "The cloud execution conflicts with persisted local ownership.",
          "logged_export_execution_conflict",
        );
      }
      this.recordLoggedExecutionHeartbeat(execution);
      return this.getLoggedExecution(execution.requestId)!;
    }
    const job = this.database
      .prepare("SELECT attempt, state FROM jobs WHERE id = ?")
      .get(accepted.request.jobId) as
      { attempt: number; state: string } | undefined;
    if (!job || Number(job.attempt) !== 0 || job.state !== "queued") {
      throw new LocalExportLifecycleError(
        "The local request is not ready to adopt its first execution.",
        "logged_export_execution_state_conflict",
      );
    }
    const result = this.database
      .prepare(
        `UPDATE export_requests
         SET cloud_execution_id = ?, cloud_execution_attempt = ?,
             cloud_execution_lease_token = ?, cloud_execution_started_at = ?,
             cloud_execution_heartbeat_at = ?, cloud_execution_expires_at = ?,
             cloud_cancel_requested_at = ?, updated_at = ?
         WHERE id = ? AND cloud_execution_id IS NULL`,
      )
      .run(
        execution.executionId,
        execution.attempt,
        execution.leaseToken,
        execution.startedAt,
        execution.heartbeatAt,
        execution.expiresAt,
        execution.cancelRequestedAt ?? null,
        execution.heartbeatAt,
        execution.requestId,
      );
    if (result.changes !== 1) {
      throw new LocalExportLifecycleError(
        "The local execution could not be persisted.",
        "logged_export_execution_conflict",
      );
    }
    return this.getLoggedExecution(execution.requestId)!;
  }

  getLoggedExecution(requestId: string): LoggedExportExecution | undefined {
    const row = this.database
      .prepare(
        `SELECT cloud_execution_id, cloud_execution_attempt,
                cloud_execution_lease_token, cloud_execution_started_at,
                cloud_execution_heartbeat_at, cloud_execution_expires_at,
                cloud_cancel_requested_at, cloud_worker_id, cloud_worker_epoch
         FROM export_requests
         WHERE id = ? AND cloud_execution_id IS NOT NULL`,
      )
      .get(requestId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return LoggedExportExecutionSchema.parse({
      executionId: row.cloud_execution_id,
      requestId,
      attempt: Number(row.cloud_execution_attempt),
      workerId: row.cloud_worker_id,
      workerEpoch: Number(row.cloud_worker_epoch),
      leaseToken: row.cloud_execution_lease_token,
      startedAt: row.cloud_execution_started_at,
      heartbeatAt: row.cloud_execution_heartbeat_at,
      expiresAt: row.cloud_execution_expires_at,
      ...(row.cloud_cancel_requested_at
        ? { cancelRequestedAt: row.cloud_cancel_requested_at }
        : {}),
    });
  }

  recordLoggedExecutionHeartbeat(input: LoggedExportExecution): void {
    const execution = LoggedExportExecutionSchema.parse(input);
    const existing = this.getLoggedExecution(execution.requestId);
    if (
      !existing ||
      existing.executionId !== execution.executionId ||
      existing.attempt !== execution.attempt ||
      existing.workerId !== execution.workerId ||
      existing.workerEpoch !== execution.workerEpoch ||
      existing.leaseToken !== execution.leaseToken ||
      existing.startedAt !== execution.startedAt
    ) {
      throw new LocalExportLifecycleError(
        "The execution heartbeat does not match local ownership.",
        "logged_export_execution_ownership_mismatch",
      );
    }
    const updated = this.database
      .prepare(
        `UPDATE export_requests
         SET cloud_execution_heartbeat_at = ?, cloud_execution_expires_at = ?,
             cloud_cancel_requested_at = COALESCE(cloud_cancel_requested_at, ?),
             updated_at = ?
         WHERE id = ? AND cloud_execution_id = ?
           AND cloud_execution_lease_token = ?`,
      )
      .run(
        execution.heartbeatAt,
        execution.expiresAt,
        execution.cancelRequestedAt ?? null,
        execution.heartbeatAt,
        execution.requestId,
        execution.executionId,
        execution.leaseToken,
      );
    if (updated.changes !== 1) throw new LocalExportLifecycleError();
  }

  recordLoggedExportNotStartedCancellation(
    requestId: string,
    reason: "user_requested" | "execution_lease_lost",
    cancelRequestedAt?: string,
  ): void {
    const request = this.get(requestId);
    if (!request || request.mode !== "logged")
      throw new LocalExportRequestNotFoundError();
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const updated = this.database
        .prepare(
          `UPDATE export_requests
           SET cloud_cancel_requested_at = COALESCE(cloud_cancel_requested_at, ?),
               local_cancellation_reason = ?,
               local_canceled_at = ?, updated_at = ?
           WHERE id = ? AND local_cancellation_reason IS NULL`,
        )
        .run(cancelRequestedAt ?? null, reason, now, now, requestId);
      const job = this.database
        .prepare(
          `UPDATE jobs SET state = 'canceled', updated_at = ?
           WHERE id = ? AND state = 'queued' AND attempt = 0`,
        )
        .run(now, request.jobId);
      if (updated.changes !== 1 || job.changes !== 1) {
        throw new LocalExportLifecycleError(
          "The local accepted request is no longer cancelable before execution.",
          "logged_export_cancellation_state_conflict",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordLoggedExportPersistedFailureCancellation(
    requestId: string,
    reason: "user_requested" | "execution_lease_lost",
    cancelRequestedAt?: string,
  ): void {
    const request = this.get(requestId);
    if (!request || request.mode !== "logged") {
      throw new LocalExportRequestNotFoundError();
    }
    const row = this.database
      .prepare(
        `SELECT j.state, j.attempt, er.cloud_execution_id,
                er.cloud_execution_attempt
         FROM export_requests er JOIN jobs j ON j.id = er.job_id
         WHERE er.id = ?`,
      )
      .get(requestId) as
      | {
          state: string;
          attempt: number;
          cloud_execution_id: string | null;
          cloud_execution_attempt: number | null;
        }
      | undefined;
    if (!row || row.state !== "needs_user_action") {
      throw new LocalExportLifecycleError(
        "Only one persisted nonterminal failure can yield to cancellation.",
        "logged_export_cancellation_state_conflict",
      );
    }
    const attempt = Number(row.attempt);
    if (attempt === 0) {
      const count = this.database
        .prepare(
          "SELECT count(*) AS count FROM source_scratch_assets WHERE job_id = ?",
        )
        .get(request.jobId) as { count: number };
      if (Number(count.count) !== 0) {
        throw new LocalExportLifecycleError(
          "Not-started failure cancellation has inconsistent scratch evidence.",
          "logged_export_cancellation_cleanup_inconsistent",
        );
      }
    } else {
      const scratch = this.getSourceAttempt(request.jobId, attempt);
      if (
        !row.cloud_execution_id ||
        Number(row.cloud_execution_attempt) !== attempt ||
        !scratch ||
        scratch.lifecycleState !== "deleted" ||
        !scratch.deletedAt
      ) {
        throw new LocalExportLifecycleError(
          "Failed work cannot yield to cancellation until exact source cleanup is verified.",
          "logged_export_cancellation_cleanup_incomplete",
        );
      }
    }
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const canceled = this.database
        .prepare(
          `UPDATE export_requests
           SET cloud_cancel_requested_at = COALESCE(cloud_cancel_requested_at, ?),
               local_cancellation_reason = ?, local_canceled_at = ?, updated_at = ?
           WHERE id = ? AND local_cancellation_reason IS NULL`,
        )
        .run(cancelRequestedAt ?? null, reason, now, now, requestId);
      const job = this.database
        .prepare(
          `UPDATE jobs
           SET state = 'canceled', payload_json = json_remove(payload_json, '$.lastError'),
               updated_at = ?
           WHERE id = ? AND state = 'needs_user_action' AND attempt = ?`,
        )
        .run(now, request.jobId, attempt);
      if (canceled.changes !== 1 || job.changes !== 1) {
        throw new LocalExportLifecycleError(
          "Persisted failure cancellation lost its exact local state.",
          "logged_export_cancellation_state_conflict",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  buildLoggedExportSuccessResult(requestId: string): LoggedExportSuccessResult {
    const request = this.get(requestId);
    if (!request || request.mode !== "logged") {
      throw new LocalExportRequestNotFoundError();
    }
    if (
      request.state !== "complete" ||
      !request.projectId ||
      !request.clipId ||
      !request.resolvedExportBounds ||
      !request.renderedMediaProvenance ||
      !request.thumbnailProvenance ||
      !request.finalArtifacts
    ) {
      throw new LocalExportLifecycleError(
        "Only a verified, cleanup-complete logged export can be reconciled.",
        "logged_export_result_not_complete",
      );
    }
    const artifacts = [...request.finalArtifacts].sort((left, right) =>
      left.role < right.role ? -1 : left.role > right.role ? 1 : 0,
    );
    const subtitleSidecars = request.subtitleSidecars
      ? [...request.subtitleSidecars].sort((left, right) =>
          left.role < right.role ? -1 : left.role > right.role ? 1 : 0,
        )
      : undefined;
    const result = LoggedExportSuccessResultSchema.safeParse({
      schemaVersion: 1,
      requestId: request.id,
      jobId: request.jobId,
      projectId: request.projectId,
      clipId: request.clipId,
      sourceLanguageClass: request.sourceLanguageClass,
      resolvedExportBounds: request.resolvedExportBounds,
      renderedMediaProvenance: request.renderedMediaProvenance,
      thumbnailProvenance: request.thumbnailProvenance,
      ...(request.subtitleOmissionProvenance
        ? {
            subtitleOmissionProvenance: request.subtitleOmissionProvenance,
          }
        : {}),
      ...(request.englishSubtitleProvenance
        ? { englishSubtitleProvenance: request.englishSubtitleProvenance }
        : {}),
      ...(subtitleSidecars ? { subtitleSidecars } : {}),
      artifacts,
    });
    if (!result.success) {
      throw new LocalExportLifecycleError(
        "Completed local export provenance is not safe to reconcile.",
        "logged_export_result_invalid",
      );
    }
    return result.data;
  }

  buildLoggedExportFailureResult(requestId: string): LoggedExportFailureResult {
    const request = this.get(requestId);
    if (!request || request.mode !== "logged") {
      throw new LocalExportRequestNotFoundError();
    }
    if (!this.getAcceptedLoggedDelivery(requestId)) {
      throw new LocalExportLifecycleError(
        "Only an accepted logged delivery can reconcile a failure.",
        "logged_export_delivery_not_accepted",
      );
    }
    if (request.state !== "needs_user_action") {
      throw new LocalExportLifecycleError(
        "No persisted local failure is ready for reconciliation.",
        "logged_export_failure_not_recorded",
      );
    }
    if (request.finalArtifacts?.length) {
      throw new LocalExportLifecycleError(
        "A request with finalized package provenance cannot reconcile as failed.",
        "logged_export_failure_has_package",
      );
    }
    if (!request.projectId || !request.clipId) {
      throw new LocalExportLifecycleError(
        "Logged export failure identity is incomplete.",
        "logged_export_failure_identity_invalid",
      );
    }

    const job = this.database
      .prepare("SELECT state, attempt, payload_json FROM jobs WHERE id = ?")
      .get(request.jobId) as
      { state: string; attempt: number; payload_json: string } | undefined;
    if (!job || job.state !== "needs_user_action") {
      throw new LocalExportLifecycleError(
        "Persisted local failure state is inconsistent.",
        "logged_export_failure_state_invalid",
      );
    }
    const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
    const lastError = payload.lastError as
      { code?: unknown; message?: unknown } | undefined;
    if (
      !lastError ||
      typeof lastError.code !== "string" ||
      typeof lastError.message !== "string"
    ) {
      throw new LocalExportLifecycleError(
        "Persisted local failure error evidence is missing.",
        "logged_export_failure_error_missing",
      );
    }

    const attempt = Number(job.attempt);
    if (!Number.isSafeInteger(attempt) || attempt < 0) {
      throw new LocalExportLifecycleError(
        "Persisted local failure attempt is invalid.",
        "logged_export_failure_attempt_invalid",
      );
    }
    const scratchRows = this.database
      .prepare(
        `SELECT attempt, lifecycle_state, deleted_at
         FROM source_scratch_assets
         WHERE job_id = ? ORDER BY attempt`,
      )
      .all(request.jobId) as {
      attempt: number;
      lifecycle_state: string;
      deleted_at: string | null;
    }[];

    let sourceCleanup: LoggedExportFailureResult["sourceCleanup"];
    if (attempt === 0) {
      if (scratchRows.length !== 0) {
        throw new LocalExportLifecycleError(
          "A not-started failure cannot have source scratch provenance.",
          "logged_export_failure_cleanup_inconsistent",
        );
      }
      sourceCleanup = { lifecycle: "not_started" };
    } else {
      const source = scratchRows[0];
      if (
        scratchRows.length !== 1 ||
        !source ||
        Number(source.attempt) !== attempt ||
        source.lifecycle_state !== "deleted" ||
        !source.deleted_at
      ) {
        throw new LocalExportLifecycleError(
          "Source cleanup is incomplete; resolve deletion before reconciling the processing failure.",
          "logged_export_failure_cleanup_incomplete",
        );
      }
      sourceCleanup = {
        lifecycle: "deleted",
        deletedAt: String(source.deleted_at),
      };
    }

    return LoggedExportFailureResultSchema.parse({
      schemaVersion: 1,
      requestId: request.id,
      jobId: request.jobId,
      projectId: request.projectId,
      clipId: request.clipId,
      error: {
        code: sanitizeLoggedExportFailureCode(lastError.code),
        message: sanitizeLoggedExportFailureMessage(lastError.message),
      },
      attempt,
      sourceCleanup,
    });
  }

  buildLoggedExportCanceledResult(
    requestId: string,
  ): LoggedExportCanceledResult {
    const request = this.get(requestId);
    if (
      !request ||
      request.mode !== "logged" ||
      !request.projectId ||
      !request.clipId
    ) {
      throw new LocalExportRequestNotFoundError();
    }
    if (!this.getAcceptedLoggedDelivery(requestId)) {
      throw new LocalExportLifecycleError(
        "Only an accepted logged delivery can reconcile cancellation.",
        "logged_export_delivery_not_accepted",
      );
    }
    const row = this.database
      .prepare(
        `SELECT j.state, j.attempt, er.local_cancellation_reason,
                er.local_canceled_at, er.cloud_execution_id,
                er.cloud_execution_attempt
         FROM export_requests er JOIN jobs j ON j.id = er.job_id
         WHERE er.id = ?`,
      )
      .get(requestId) as Record<string, unknown> | undefined;
    if (
      !row ||
      row.state !== "canceled" ||
      !row.local_cancellation_reason ||
      !row.local_canceled_at
    ) {
      throw new LocalExportLifecycleError(
        "No verified local cancellation is ready for reconciliation.",
        "logged_export_cancellation_not_recorded",
      );
    }
    if (request.finalArtifacts?.length) {
      throw new LocalExportLifecycleError(
        "Canceled work cannot retain finalized package provenance.",
        "logged_export_cancellation_has_package",
      );
    }
    const attempt = Number(row.attempt);
    let sourceCleanup: LoggedExportCanceledResult["sourceCleanup"];
    if (attempt === 0) {
      const count = this.database
        .prepare(
          "SELECT count(*) AS count FROM source_scratch_assets WHERE job_id = ?",
        )
        .get(request.jobId) as { count: number };
      if (Number(count.count) !== 0) {
        throw new LocalExportLifecycleError(
          "Not-started cancellation has inconsistent execution evidence.",
          "logged_export_cancellation_cleanup_inconsistent",
        );
      }
      sourceCleanup = { lifecycle: "not_started" };
    } else {
      const scratch = this.database
        .prepare(
          `SELECT lifecycle_state, deleted_at FROM source_scratch_assets
           WHERE job_id = ? AND attempt = ?`,
        )
        .get(request.jobId, attempt) as
        { lifecycle_state: string; deleted_at: string | null } | undefined;
      if (
        !scratch ||
        scratch.lifecycle_state !== "deleted" ||
        !scratch.deleted_at ||
        Number(row.cloud_execution_attempt) !== attempt ||
        !row.cloud_execution_id
      ) {
        throw new LocalExportLifecycleError(
          "Canceled source cleanup is incomplete.",
          "logged_export_cancellation_cleanup_incomplete",
        );
      }
      sourceCleanup = { lifecycle: "deleted", deletedAt: scratch.deleted_at };
    }
    return LoggedExportCanceledResultSchema.parse({
      schemaVersion: 1,
      requestId,
      jobId: request.jobId,
      projectId: request.projectId,
      clipId: request.clipId,
      reason: row.local_cancellation_reason,
      attempt,
      sourceCleanup,
      ...(row.cloud_execution_id
        ? {
            executionId: row.cloud_execution_id,
            executionAttempt: Number(row.cloud_execution_attempt),
          }
        : {}),
    });
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

  getByIdempotencyKey(idempotencyKey: string): ExportRequest | undefined {
    const row = this.database
      .prepare(`${localExportRequestSelect} WHERE j.idempotency_key = ?`)
      .get(`export-only:${idempotencyKey}`) as
      Record<string, unknown> | undefined;
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

  beginSourceAcquisition(
    requestId: string,
    _options: { requireLoggedExecution?: boolean } = {},
  ): LocalExportSourceAttempt {
    const request = this.get(requestId);
    if (!request) throw new LocalExportRequestNotFoundError();
    if (request.state === "complete") {
      throw new LocalExportLifecycleError(
        "A completed export cannot acquire a new source.",
        "export_already_complete",
      );
    }
    this.assertExportDeliveryAccepted(requestId);
    const now = this.now().toISOString();
    const expiresAt = new Date(
      this.now().getTime() + 24 * 60 * 60 * 1_000,
    ).toISOString();
    const attempt = this.database
      .prepare("SELECT attempt, state FROM jobs WHERE id = ?")
      .get(request.jobId) as { attempt: number; state: string };
    if (!["queued", "needs_user_action"].includes(attempt.state)) {
      throw new LocalExportLifecycleError(
        "This export already has active or terminal local work.",
        "export_execution_state_conflict",
      );
    }
    const execution =
      request.mode === "logged"
        ? this.getLoggedExecution(requestId)
        : undefined;
    if (request.mode === "logged" && !execution) {
      throw new LocalExportLifecycleError(
        "This accepted logged export has no durable cloud execution lease.",
        "logged_export_execution_required",
      );
    }
    const nextAttempt = execution?.attempt ?? attempt.attempt + 1;
    if (execution && (attempt.attempt !== 0 || attempt.state !== "queued")) {
      throw new LocalExportLifecycleError(
        "Local execution attempt does not match its cloud ownership.",
        "logged_export_execution_attempt_mismatch",
      );
    }
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
             (id, job_id, attempt, lifecycle_state, scratch_layout_version,
              created_at, expires_at, updated_at)
           VALUES (?, ?, ?, 'acquiring', ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          request.jobId,
          nextAttempt,
          SourceScratchLayoutVersion,
          now,
          expiresAt,
          now,
        );
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return { request, attempt: nextAttempt };
  }

  assertExportDeliveryAccepted(requestId: string): void {
    const request = this.get(requestId);
    if (!request) throw new LocalExportRequestNotFoundError();
    const deliveryState = this.database
      .prepare("SELECT cloud_delivery_state FROM export_requests WHERE id = ?")
      .get(requestId) as { cloud_delivery_state?: string | null } | undefined;
    if (
      request.mode === "logged" &&
      deliveryState?.cloud_delivery_state !== "accepted"
    ) {
      throw new LocalExportLifecycleError(
        "This logged export is pending authoritative cloud delivery acceptance.",
        "logged_export_delivery_not_accepted",
      );
    }
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
         WHERE job_id = ? AND attempt = ? AND lifecycle_state = 'acquiring'
           AND cleanup_claim_token IS NULL`,
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
           WHERE job_id = ? AND attempt = ? AND lifecycle_state = 'ready'
             AND cleanup_claim_token IS NULL`,
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
           AND lifecycle_state IN ('acquiring', 'ready')
           AND cleanup_claim_token IS NULL`,
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
      verificationSchemaVersion: 1;
      settingsSha256: string;
      observedProperties?: ExportObservedMediaProperties;
    },
  ): void {
    const observed = ExportObservedMediaPropertiesSchema.safeParse(
      inspection.observedProperties,
    );
    const snapshotRow = this.database
      .prepare(
        `SELECT resolved_settings_snapshot_json
         FROM export_requests
         WHERE job_id = ? AND resolved_source_attempt = ?`,
      )
      .get(jobId, attempt) as
      { resolved_settings_snapshot_json: string | null } | undefined;
    let settingsSha256: string | undefined;
    if (snapshotRow?.resolved_settings_snapshot_json) {
      try {
        const snapshot = ResolvedExportSettingsSnapshotSchema.parse(
          JSON.parse(snapshotRow.resolved_settings_snapshot_json),
        );
        settingsSha256 = sha256Fingerprint(snapshot.settings);
      } catch {
        settingsSha256 = undefined;
      }
    }
    if (
      !Number.isSafeInteger(inspection.durationMs) ||
      inspection.durationMs <= 0 ||
      inspection.verificationSchemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/u.test(inspection.settingsSha256) ||
      inspection.settingsSha256 !== settingsSha256 ||
      !observed.success ||
      observed.data.durationMs !== inspection.durationMs ||
      !observed.data.ffprobeVersion ||
      (inspection.videoCodec !== undefined &&
        observed.data.video.codec !== inspection.videoCodec) ||
      (inspection.audioCodec !== undefined &&
        observed.data.audio.codec !== inspection.audioCodec) ||
      inspection.ffprobeVersion !== observed.data.ffprobeVersion
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
             rendered_conformance_schema_version = ?,
             rendered_settings_sha256 = ?,
             rendered_observed_properties_json = ?,
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
        inspection.verificationSchemaVersion,
        inspection.settingsSha256,
        JSON.stringify(observed.data),
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
             resolved_settings_snapshot_json,
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
      [...roles].filter((role) =>
        ["video_mp4", "video_mkv", "video_mov"].includes(role),
      ).length !== 1 ||
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
               cleanup_error_code = NULL, cleanup_error_message = NULL,
               cleanup_claim_token = NULL, cleanup_claim_expires_at = NULL,
               cleanup_claim_previous_lifecycle_state = NULL
           WHERE job_id = ? AND attempt = ? AND lifecycle_state = 'deleting'
             AND cleanup_claim_token IS NULL`,
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
               cleanup_error_message = ?, updated_at = ?,
               cleanup_claim_token = NULL, cleanup_claim_expires_at = NULL,
               cleanup_claim_previous_lifecycle_state = NULL
           WHERE job_id = ? AND attempt = ?
             AND lifecycle_state IN ('acquiring', 'ready', 'deleting')
             AND cleanup_claim_token IS NULL`,
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

  /**
   * Reserves a bounded set of deterministic-layout scratch rows for one-shot
   * local recovery. The claim is a short durable lease rather than an in-memory
   * lock so a restart cannot strand a row forever or let two sweepers settle it.
   */
  claimSourceScratchCleanup(limit: number): LocalSourceScratchCleanupClaim[] {
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > MaxSourceScratchCleanupClaims
    ) {
      throw new LocalExportLifecycleError(
        "Source scratch cleanup limit is invalid.",
        "source_scratch_cleanup_limit_invalid",
      );
    }
    const claimedAt = this.now();
    const now = claimedAt.toISOString();
    const claimExpiresAt = new Date(
      claimedAt.getTime() + SourceScratchCleanupClaimLeaseMs,
    ).toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const candidates = this.database
        .prepare(
          `SELECT ssa.job_id, ssa.attempt
           FROM source_scratch_assets ssa
           JOIN jobs j ON j.id = ssa.job_id
           WHERE ssa.scratch_layout_version = ?
             AND (ssa.cleanup_claim_expires_at IS NULL
                  OR ssa.cleanup_claim_expires_at <= ?)
             AND (
               ssa.lifecycle_state = 'cleanup_failed'
               OR (
                 ssa.lifecycle_state IN ('acquiring', 'ready', 'deleting')
                 AND ssa.expires_at <= ?
                 AND NOT (
                   j.state = 'processing'
                   AND j.attempt = ssa.attempt
                   AND ssa.expires_at > ?
                 )
               )
             )
           ORDER BY
             CASE WHEN ssa.lifecycle_state = 'cleanup_failed' THEN 0 ELSE 1 END,
             ssa.expires_at,
             ssa.updated_at,
             ssa.job_id,
             ssa.attempt
           LIMIT ?`,
        )
        .all(SourceScratchLayoutVersion, now, now, now, limit) as Array<{
        job_id: string;
        attempt: number;
      }>;
      const claimed: LocalSourceScratchCleanupClaim[] = [];
      const update = this.database.prepare(
        `UPDATE source_scratch_assets
         SET lifecycle_state = 'deleting', cleanup_started_at = ?,
             cleanup_claim_token = ?, cleanup_claim_expires_at = ?,
             cleanup_claim_previous_lifecycle_state = COALESCE(
               cleanup_claim_previous_lifecycle_state, lifecycle_state
             ),
             updated_at = ?
         WHERE job_id = ? AND attempt = ?
           AND scratch_layout_version = ?
           AND (cleanup_claim_expires_at IS NULL OR cleanup_claim_expires_at <= ?)
           AND (
             lifecycle_state = 'cleanup_failed'
             OR (
               lifecycle_state IN ('acquiring', 'ready', 'deleting')
               AND expires_at <= ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM jobs
                 WHERE jobs.id = source_scratch_assets.job_id
                   AND jobs.state = 'processing'
                   AND jobs.attempt = source_scratch_assets.attempt
                   AND source_scratch_assets.expires_at > ?
               )
             )
           )`,
      );
      for (const candidate of candidates) {
        const claimToken = randomUUID();
        const result = update.run(
          now,
          claimToken,
          claimExpiresAt,
          now,
          candidate.job_id,
          candidate.attempt,
          SourceScratchLayoutVersion,
          now,
          now,
          now,
        );
        if (result.changes === 1) {
          claimed.push({
            jobId: candidate.job_id,
            attempt: Number(candidate.attempt),
            claimToken,
          });
        }
      }
      this.database.exec("COMMIT;");
      return claimed;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  countLegacySourceScratchRecoveryRows(): number {
    const row = this.database
      .prepare(
        `SELECT count(*) AS count
         FROM source_scratch_assets
         WHERE scratch_layout_version IS NULL
           AND lifecycle_state != 'deleted'`,
      )
      .get() as { count: number };
    return Number(row.count);
  }

  completeSourceScratchCleanupClaim(
    claim: LocalSourceScratchCleanupClaim,
  ): LocalSourceScratchCleanupSettlement {
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const source = this.database
        .prepare(
          `SELECT cleanup_claim_previous_lifecycle_state
           FROM source_scratch_assets
           WHERE job_id = ? AND attempt = ?
             AND scratch_layout_version = ?
             AND cleanup_claim_token = ?`,
        )
        .get(
          claim.jobId,
          claim.attempt,
          SourceScratchLayoutVersion,
          claim.claimToken,
        ) as
        { cleanup_claim_previous_lifecycle_state: string | null } | undefined;
      if (!source) {
        throw new LocalExportLifecycleError(
          "Source scratch cleanup claim is no longer current.",
          "source_scratch_cleanup_claim_lost",
        );
      }
      const deleted = this.database
        .prepare(
          `UPDATE source_scratch_assets
           SET lifecycle_state = 'deleted', deleted_at = ?, updated_at = ?,
               cleanup_error_code = NULL, cleanup_error_message = NULL,
               cleanup_claim_token = NULL, cleanup_claim_expires_at = NULL,
               cleanup_claim_previous_lifecycle_state = NULL
           WHERE job_id = ? AND attempt = ?
             AND scratch_layout_version = ?
             AND cleanup_claim_token = ?`,
        )
        .run(
          now,
          now,
          claim.jobId,
          claim.attempt,
          SourceScratchLayoutVersion,
          claim.claimToken,
        );
      if (deleted.changes !== 1) {
        throw new LocalExportLifecycleError(
          "Source scratch cleanup claim is no longer current.",
          "source_scratch_cleanup_claim_lost",
        );
      }
      const job = this.database
        .prepare("SELECT state, attempt, payload_json FROM jobs WHERE id = ?")
        .get(claim.jobId) as
        { state: string; attempt: number; payload_json: string } | undefined;
      if (!job) throw new LocalExportLifecycleError();
      const hasPackage = this.hasCompleteFinalArtifactProvenance(
        claim.jobId,
        claim.attempt,
      );
      let settlement: LocalSourceScratchCleanupSettlement = {
        restoredComplete: false,
        markedNeedsUserAction: false,
      };
      if (
        hasPackage &&
        (job.state === "needs_user_action" || job.state === "processing") &&
        Number(job.attempt) === claim.attempt
      ) {
        const payload = parseLocalJobPayload(job.payload_json);
        delete payload.lastError;
        this.database
          .prepare(
            `UPDATE jobs
             SET state = 'complete', payload_json = ?, updated_at = ?
             WHERE id = ? AND state IN ('needs_user_action', 'processing')
               AND attempt = ?`,
          )
          .run(JSON.stringify(payload), now, claim.jobId, claim.attempt);
        settlement = { restoredComplete: true, markedNeedsUserAction: false };
      } else if (
        !hasPackage &&
        Number(job.attempt) === claim.attempt &&
        job.state === "processing"
      ) {
        this.markJobNeedsUserAction(
          claim.jobId,
          "source_scratch_abandoned",
          "Expired source scratch was removed after interrupted local processing.",
          now,
        );
        settlement = { restoredComplete: false, markedNeedsUserAction: true };
      } else if (
        !hasPackage &&
        Number(job.attempt) === claim.attempt &&
        job.state === "needs_user_action" &&
        source.cleanup_claim_previous_lifecycle_state === "cleanup_failed"
      ) {
        this.markJobNeedsUserAction(
          claim.jobId,
          "source_scratch_cleanup_recovered",
          "Source scratch cleanup completed after a prior cleanup failure.",
          now,
        );
        settlement = { restoredComplete: false, markedNeedsUserAction: true };
      }
      this.database.exec("COMMIT;");
      return settlement;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  failSourceScratchCleanupClaim(
    claim: LocalSourceScratchCleanupClaim,
    message: string,
  ): void {
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const failed = this.database
        .prepare(
          `UPDATE source_scratch_assets
           SET lifecycle_state = 'cleanup_failed',
               cleanup_error_code = 'source_cleanup_failed',
               cleanup_error_message = ?, cleanup_claim_token = NULL,
               cleanup_claim_expires_at = NULL,
               cleanup_claim_previous_lifecycle_state = NULL, updated_at = ?
           WHERE job_id = ? AND attempt = ?
             AND scratch_layout_version = ?
             AND cleanup_claim_token = ?`,
        )
        .run(
          safeLocalError(message),
          now,
          claim.jobId,
          claim.attempt,
          SourceScratchLayoutVersion,
          claim.claimToken,
        );
      if (failed.changes !== 1) {
        throw new LocalExportLifecycleError(
          "Source scratch cleanup claim is no longer current.",
          "source_scratch_cleanup_claim_lost",
        );
      }
      this.markJobNeedsUserAction(
        claim.jobId,
        "source_cleanup_failed",
        message,
        now,
      );
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

  recordSourceAttemptCanceled(
    jobId: string,
    attempt: number,
    reason: "user_requested" | "execution_lease_lost",
  ): void {
    const now = this.now().toISOString();
    const source = this.database
      .prepare(
        `SELECT lifecycle_state, deleted_at FROM source_scratch_assets
         WHERE job_id = ? AND attempt = ?`,
      )
      .get(jobId, attempt) as
      { lifecycle_state: string; deleted_at: string | null } | undefined;
    if (!source || source.lifecycle_state !== "deleted" || !source.deleted_at) {
      throw new LocalExportLifecycleError(
        "Cancellation cannot become terminal until source cleanup is verified.",
        "logged_export_cancellation_cleanup_incomplete",
      );
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const request = this.database
        .prepare(
          `UPDATE export_requests
           SET local_cancellation_reason = ?, local_canceled_at = ?, updated_at = ?
           WHERE job_id = ? AND cloud_execution_attempt = ?
             AND local_cancellation_reason IS NULL`,
        )
        .run(reason, now, now, jobId, attempt);
      const job = this.database
        .prepare(
          `UPDATE jobs SET state = 'canceled', updated_at = ?
           WHERE id = ? AND attempt = ? AND state IN ('queued', 'processing')`,
        )
        .run(now, jobId, attempt);
      if (request.changes !== 1 || job.changes !== 1) {
        throw new LocalExportLifecycleError(
          "Local cancellation ownership changed before settlement.",
          "logged_export_cancellation_state_conflict",
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordCompletedAttemptCanceled(
    requestId: string,
    reason: "user_requested" | "execution_lease_lost",
  ): void {
    const request = this.get(requestId);
    const execution = this.getLoggedExecution(requestId);
    if (
      !request ||
      request.state !== "complete" ||
      !execution ||
      !request.finalArtifacts?.length
    ) {
      throw new LocalExportLifecycleError(
        "Only one exact locally complete execution can lose the cloud terminal race.",
        "logged_export_cancellation_state_conflict",
      );
    }
    const source = this.getSourceAttempt(request.jobId, execution.attempt);
    if (!source || source.lifecycleState !== "deleted" || !source.deletedAt) {
      throw new LocalExportLifecycleError(
        "Completed local work cannot be canceled until source deletion is verified.",
        "logged_export_cancellation_cleanup_incomplete",
      );
    }
    const now = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          "DELETE FROM export_final_artifacts WHERE export_request_id = ?",
        )
        .run(requestId);
      this.database
        .prepare(
          `UPDATE export_requests
           SET local_cancellation_reason = ?, local_canceled_at = ?, updated_at = ?
           WHERE id = ? AND local_cancellation_reason IS NULL`,
        )
        .run(reason, now, now, requestId);
      this.database
        .prepare(
          "UPDATE jobs SET state = 'canceled', updated_at = ? WHERE id = ? AND state = 'complete'",
        )
        .run(now, request.jobId);
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

  private hasCompleteFinalArtifactProvenance(
    jobId: string,
    attempt: number,
  ): boolean {
    const artifacts = this.database
      .prepare(
        `SELECT er.id AS export_request_id, efa.role, efa.package_identity,
                efa.byte_size, efa.content_sha256, efa.source_attempt,
                efa.validated_at
         FROM export_final_artifacts efa
         JOIN export_requests er ON er.id = efa.export_request_id
         WHERE er.job_id = ? AND efa.source_attempt = ?`,
      )
      .all(jobId, attempt) as Array<{
      export_request_id: string;
      role: string;
      package_identity: string;
      byte_size: number;
      content_sha256: string;
      source_attempt: number;
      validated_at: string;
    }>;
    const roles = new Set(artifacts.map((artifact) => artifact.role));
    const requestId = artifacts[0]?.export_request_id;
    const packageIdentity = artifacts[0]?.package_identity;
    const videoRoles = ["video_mp4", "video_mkv", "video_mov"];
    const allowedRoles = new Set([
      ...videoRoles,
      "english_srt",
      "original_srt",
      "clip_metadata_json",
      "thumbnail_jpg",
      "manifest_json",
    ]);
    return (
      artifacts.length >= 4 &&
      artifacts.length <= 6 &&
      roles.size === artifacts.length &&
      Boolean(requestId) &&
      packageIdentity === `clip-${requestId}` &&
      artifacts.every(
        (artifact) =>
          artifact.export_request_id === requestId &&
          artifact.package_identity === packageIdentity &&
          Number(artifact.source_attempt) === attempt &&
          allowedRoles.has(artifact.role) &&
          validFinalArtifactFields({
            packageIdentity: artifact.package_identity,
            byteSize: Number(artifact.byte_size),
            contentSha256: artifact.content_sha256,
            sourceAttempt: Number(artifact.source_attempt),
            validatedAt: artifact.validated_at,
          }),
      ) &&
      videoRoles.filter((role) => roles.has(role)).length === 1 &&
      roles.has("clip_metadata_json") &&
      roles.has("thumbnail_jpg") &&
      roles.has("manifest_json")
    );
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

  private assertExactLoggedDelivery(
    row: Record<string, unknown>,
    delivery: LoggedExportDelivery,
  ): void {
    if (
      !this.sameImmutableLoggedRequest(row, delivery) ||
      String(row.cloud_delivery_id) !== delivery.deliveryId ||
      Number(row.cloud_delivery_generation) !== delivery.generation ||
      String(row.cloud_reservation_token) !== delivery.reservationToken ||
      String(row.cloud_worker_id) !== delivery.workerId ||
      Number(row.cloud_worker_epoch) !== delivery.workerEpoch ||
      String(row.cloud_reserved_at) !== delivery.reservedAt ||
      String(row.cloud_reservation_expires_at) !== delivery.reservationExpiresAt
    ) {
      throw new LocalLoggedExportDeliveryConflictError(
        "The logged export delivery conflicts with an existing immutable local request.",
      );
    }
  }

  private sameImmutableLoggedRequest(
    row: Record<string, unknown>,
    delivery: LoggedExportDelivery,
  ): boolean {
    const existing = this.mapRequest(row);
    const immutableExisting = {
      id: existing.id,
      jobId: existing.jobId,
      mode: existing.mode,
      projectId: existing.projectId,
      clipId: existing.clipId,
      video: existing.video,
      selection: existing.selection,
      sourceLanguageClass: existing.sourceLanguageClass,
      subtitleTracks: existing.subtitleTracks,
      preset: existing.preset,
      resolvedSettingsSnapshot: existing.resolvedSettingsSnapshot,
      createdAt: existing.createdAt,
    };
    const request = delivery.request;
    const immutableIncoming = {
      id: request.id,
      jobId: request.jobId,
      mode: request.mode,
      projectId: request.projectId,
      clipId: request.clipId,
      video: request.video,
      selection: request.selection,
      sourceLanguageClass: request.sourceLanguageClass,
      subtitleTracks: request.subtitleTracks,
      preset: request.preset,
      resolvedSettingsSnapshot: request.resolvedSettingsSnapshot,
      createdAt: request.createdAt,
    };
    return (
      canonicalJson(immutableExisting) === canonicalJson(immutableIncoming)
    );
  }

  private removePendingLoggedRequest(requestId: string, jobId: string): void {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.deletePendingLoggedRequestRows(requestId, jobId);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private deletePendingLoggedRequestRows(requestId: string, jobId: string) {
    this.database
      .prepare(
        `DELETE FROM export_requests
         WHERE id = ? AND cloud_delivery_state = 'pending_acceptance'`,
      )
      .run(requestId);
    this.database
      .prepare(
        `DELETE FROM jobs WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM export_requests WHERE job_id = jobs.id)`,
      )
      .run(jobId);
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
    payload.lastError = {
      code: sanitizeLoggedExportFailureCode(code),
      message: sanitizeLoggedExportFailureMessage(message),
    };
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

export type LocalSourceScratchCleanupClaim = {
  jobId: string;
  attempt: number;
  claimToken: string;
};

export type LocalSourceScratchCleanupSettlement = {
  restoredComplete: boolean;
  markedNeedsUserAction: boolean;
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
    | "video_mkv"
    | "video_mov"
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
  scratchLayoutVersion?: number;
};

export class LocalExportRequestNotFoundError extends Error {
  readonly code = "export_request_not_found";
  readonly statusCode = 404;

  constructor() {
    super("Export request not found.");
  }
}

export class LocalLoggedExportDeliveryConflictError extends Error {
  readonly code = "logged_export_delivery_conflict";
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
  }
}

export type LocalExportWorkerIdentity = {
  workerId: string;
  epoch: number;
  advertisementFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

/** Durable single-workstation identity used only for cloud worker registration. */
export class LocalExportWorkerIdentityRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): LocalExportWorkerIdentity | undefined {
    const row = this.database
      .prepare("SELECT * FROM local_export_worker_identity WHERE singleton = 1")
      .get() as Record<string, unknown> | undefined;
    return row ? mapLocalExportWorkerIdentity(row) : undefined;
  }

  prepareRegistration(
    advertisementFingerprint: string,
  ): LocalExportWorkerIdentity {
    if (!/^[a-f0-9]{64}$/u.test(advertisementFingerprint)) {
      throw new LocalExportLifecycleError(
        "The local worker advertisement fingerprint is invalid.",
        "invalid_worker_advertisement",
      );
    }
    const current = this.get();
    const now = this.now().toISOString();
    if (!current) {
      const identity: LocalExportWorkerIdentity = {
        workerId: randomUUID(),
        epoch: 1,
        advertisementFingerprint,
        createdAt: now,
        updatedAt: now,
      };
      this.database
        .prepare(
          `INSERT INTO local_export_worker_identity
             (singleton, worker_id, epoch, advertisement_fingerprint, created_at, updated_at)
           VALUES (1, ?, ?, ?, ?, ?)`,
        )
        .run(
          identity.workerId,
          identity.epoch,
          identity.advertisementFingerprint,
          identity.createdAt,
          identity.updatedAt,
        );
      return identity;
    }
    if (current.advertisementFingerprint === advertisementFingerprint)
      return current;
    const next = {
      ...current,
      epoch: current.epoch + 1,
      advertisementFingerprint,
      updatedAt: now,
    };
    this.database
      .prepare(
        `UPDATE local_export_worker_identity
         SET epoch = ?, advertisement_fingerprint = ?, updated_at = ?
         WHERE singleton = 1`,
      )
      .run(next.epoch, next.advertisementFingerprint, next.updatedAt);
    return next;
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

function mapLocalExportWorkerIdentity(
  row: Record<string, unknown>,
): LocalExportWorkerIdentity {
  return {
    workerId: String(row.worker_id),
    epoch: Number(row.epoch),
    advertisementFingerprint: String(row.advertisement_fingerprint),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapLocalExportRequest(
  row: Record<string, unknown>,
  subtitleSidecars: readonly Record<string, unknown>[] = [],
  finalArtifacts: readonly Record<string, unknown>[] = [],
): ExportRequest {
  return ExportRequestSchema.parse({
    id: row.id,
    jobId: row.job_id,
    mode: row.cloud_delivery_state ? "logged" : row.mode,
    ...(row.cloud_delivery_state
      ? {
          projectId: row.cloud_project_id,
          clipId: row.cloud_clip_id,
        }
      : {}),
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
    ...(row.resolved_settings_snapshot_json
      ? {
          resolvedSettingsSnapshot: JSON.parse(
            String(row.resolved_settings_snapshot_json),
          ),
        }
      : {}),
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
            ...(row.rendered_conformance_schema_version === null ||
            row.rendered_conformance_schema_version === undefined
              ? {}
              : {
                  verificationSchemaVersion: Number(
                    row.rendered_conformance_schema_version,
                  ),
                }),
            ...(row.rendered_settings_sha256 === null ||
            row.rendered_settings_sha256 === undefined
              ? {}
              : { settingsSha256: String(row.rendered_settings_sha256) }),
            ...(row.rendered_observed_properties_json === null ||
            row.rendered_observed_properties_json === undefined
              ? {}
              : {
                  observedProperties: JSON.parse(
                    String(row.rendered_observed_properties_json),
                  ),
                }),
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
    ...(row.scratch_layout_version === null ||
    row.scratch_layout_version === undefined
      ? {}
      : { scratchLayoutVersion: Number(row.scratch_layout_version) }),
  };
}

function safeLocalError(message: string) {
  return sanitizeLoggedExportFailureMessage(message);
}

function parseLocalJobPayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Report the durable corruption through the ordinary lifecycle boundary.
  }
  throw new LocalExportLifecycleError(
    "Persisted local job payload is invalid.",
    "local_job_payload_invalid",
  );
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
  return validFinalArtifactFields(artifact);
}

function validFinalArtifactFields(artifact: {
  packageIdentity: string;
  byteSize: number;
  contentSha256: string;
  sourceAttempt: number;
  validatedAt: string;
}) {
  return (
    /^clip-[a-f0-9-]{36}$/u.test(artifact.packageIdentity) &&
    Number.isSafeInteger(artifact.byteSize) &&
    artifact.byteSize > 0 &&
    /^[a-f0-9]{64}$/u.test(artifact.contentSha256) &&
    Number.isSafeInteger(artifact.sourceAttempt) &&
    artifact.sourceAttempt > 0 &&
    isCanonicalIsoTimestamp(artifact.validatedAt)
  );
}

function isCanonicalIsoTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const normalized = value.includes(".")
    ? value
    : value.replace(/Z$/u, ".000Z");
  return new Date(timestamp).toISOString() === normalized;
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
