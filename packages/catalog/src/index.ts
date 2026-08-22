import { createHash, randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { AuthorizationError, requirePermission } from "@research-video/auth";
import {
  ActiveTranscriptBundleSchema,
  AcceptLoggedExportDeliveryRequestSchema,
  CancelLoggedExportRequestSchema,
  CancelLoggedExportResponseSchema,
  BatchPreflightSummarySchema,
  ClaimedTranscriptionJobSchema,
  ClipCandidateSchema,
  ClipLanguageEvidenceV2Schema,
  DerivedTranslationJobSchema,
  DerivedTranslationIdentitySchema,
  DerivedTranslationManifestSchema,
  DerivedTranslationSchema,
  NormalizedTranscriptSchema,
  PublishDerivedTranslationRequestSchema,
  RequestDerivedTranslationSchema,
  CreateTranscriptionBatchResponseSchema,
  ExportRequestSchema,
  ClaimLoggedExportDeliveryRequestSchema,
  ClaimLoggedExportDeliveryResponseSchema,
  LoggedExportDeliverySchema,
  LoggedExportFailureSchema,
  LoggedExportFailureResultSchema,
  LoggedExportSuccessResultSchema,
  LoggedExportSuccessSchema,
  LoggedExportCanceledResultSchema,
  LoggedExportCanceledSchema,
  HeartbeatLoggedExportExecutionRequestSchema,
  HeartbeatLoggedExportExecutionResponseSchema,
  GetLoggedExportProgressResponseSchema,
  ReconcileLoggedExportFailureRequestSchema,
  ReconcileLoggedExportSuccessRequestSchema,
  ReconcileLoggedExportCanceledRequestSchema,
  RetryLoggedExportRequestSchema,
  RetryLoggedExportResponseSchema,
  StartLoggedExportExecutionRequestSchema,
  StartLoggedExportExecutionResponseSchema,
  ExportSettingsSchema,
  ExportWorkerCompatibilityRequestSchema,
  HeartbeatExportWorkerRequestSchema,
  RegisterExportWorkerRequestSchema,
  RegisteredExportWorkerSchema,
  RevokeExportWorkerRequestSchema,
  ExportWorkerAvailabilityResponseSchema,
  ExportPresetCatalogEntrySchema,
  ExportPresetDefaultSchema,
  PersonalExportPresetCatalogSchema,
  ProjectExportPresetCatalogSchema,
  JobSchema,
  ProjectSchema,
  ReviewInboxItemSchema,
  ReviewInboxResponseSchema,
  TranscriptManifestSchema,
  TranscriptionBatchItemSchema,
  TranscriptUploadGrantSchema,
  TranscriptionBatchListResponseSchema,
  UserSchema,
  VideoSchema,
  WorkerLeaseSchema,
  languagesEquivalent,
  primaryLanguage,
  type ActiveTranscriptBundle,
  type AcceptLoggedExportDeliveryRequest,
  type CancelLoggedExportRequest,
  type CancelLoggedExportResponse,
  type AuthenticatedActor,
  type BatchOptions,
  type BatchPreflightItem,
  type ClaimedTranscriptionJob,
  type ClipCandidate,
  type ClipLanguageEvidence,
  type CreateClipCandidateRequest,
  type ClaimLoggedExportDeliveryRequest,
  type ClaimLoggedExportDeliveryResponse,
  type CreateClipExportRequest,
  type CreateTranscriptionBatchResponse,
  type DerivedTranslation,
  type DerivedTranslationIdentity,
  type DerivedTranslationJob,
  type FinalizeTranscriptRequest,
  type ExportRequest,
  type ExportPresetCatalogEntry,
  type ExportPresetDefault,
  type ExportPresetScope,
  type ExportPresetReference,
  type ExportPresetSnapshot,
  type ExportSettingsPreview,
  type ExportWorkerCompatibilityRequest,
  type HeartbeatExportWorkerRequest,
  type RegisterExportWorkerRequest,
  type RegisteredExportWorker,
  type LoggedExportDelivery,
  type LoggedExportFailure,
  type LoggedExportFailureResult,
  type LoggedExportCanceled,
  type LoggedExportCanceledResult,
  type HeartbeatLoggedExportExecutionRequest,
  type HeartbeatLoggedExportExecutionResponse,
  type GetLoggedExportProgressResponse,
  type LoggedExportProgressSnapshot,
  type LoggedExportProgressStage,
  type LoggedExportSuccess,
  type LoggedExportSuccessResult,
  type ReconcileLoggedExportFailureRequest,
  type ReconcileLoggedExportSuccessRequest,
  type ReconcileLoggedExportCanceledRequest,
  type RetryLoggedExportRequest,
  type RetryLoggedExportResponse,
  type StartLoggedExportExecutionRequest,
  type StartLoggedExportExecutionResponse,
  type RevokeExportWorkerRequest,
  type ExportSettingsPreviewRequest,
  type PersonalExportPresetCatalog,
  type ProjectExportPresetCatalog,
  type CreateExportPresetRequest,
  type ReviseExportPresetRequest,
  type SetExportPresetDefaultRequest,
  type Project,
  type ProjectRole,
  type PublishDerivedTranslationRequest,
  type RequestDerivedTranslation,
  type TranscriptArtifact,
  type TranscriptUploadGrant,
  type TranscriptionBatchItem,
  type TranscriptionBatchControlRequest,
  type TranscriptionBatchListResponse,
  type ReviewInboxItem,
  type ReviewInboxResponse,
  type UpdateReviewStatusRequest,
  type UpdateClipCandidateRequest,
  type UpdatePreferredLanguageRequest,
  type TranscriptSourcePlan,
  type User,
  type Video,
  type WorkerLease,
  type WorkerFailureRequest,
  type WorkerProgressStage,
} from "@research-video/contracts";
import {
  canonicalJson,
  exportWorkerAdvertisementFingerprint,
  isRegisterableExportWorkerCapability,
  resolveExportSettings,
  resolvedPresetForCompatibility,
  sha256Fingerprint,
} from "@research-video/export-settings";
import {
  MemoryStagedUploadUrlIssuer,
  type StagedUploadUrlIssuer,
  type TranscriptObjectStore,
} from "@research-video/storage";

export class CatalogNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
}

export class CatalogConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "conflict";
}

export class TranscriptIntegrityError extends Error {
  readonly statusCode = 422;
  readonly code = "transcript_integrity_failed";
}

export class CatalogValidationError extends Error {
  readonly statusCode = 422;
  readonly code = "invalid_language_evidence";
}

export class CatalogIdempotencyConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "idempotency_conflict";
}

export class ExportSettingsCapabilityError extends Error {
  readonly statusCode = 422;
  readonly code = "export_settings_unsupported";
  constructor(
    message: string,
    readonly issues: ExportSettingsPreview["issues"],
  ) {
    super(message);
  }
}

export class ExportSettingsStaleError extends Error {
  readonly statusCode = 409;
  readonly code = "export_settings_stale";
}

export type ArtifactType = TranscriptArtifact["type"];

export interface CreateTranscriptUploadInput {
  projectId: string;
  catalogVideoId: string;
  lineageId: string;
  version: number;
  artifactTypes: Exclude<ArtifactType, "manifest">[];
}

export interface CreateClaimedTranscriptUploadInput {
  lineageId: string;
  version: number;
  artifactTypes: Exclude<ArtifactType, "manifest">[];
}

export interface CreateTranscriptionBatchInput {
  projectId: string;
  name: string;
  options: BatchOptions;
  items: BatchPreflightItem[];
}

export type ProjectVideoTranscriptState = {
  catalogVideoId: string;
  canonicalUrl: string;
  title: string;
  channel?: string;
  durationMs?: number;
  sourceLanguage?: string;
  activeTranscriptVersionId?: string;
};

type DbRow = Record<string, unknown>;

export const ExportWorkerHeartbeatTtlMs = 60_000;
export const LoggedExportDeliveryReservationTtlMs = 30_000;
export const LoggedExportExecutionLeaseTtlMs = 30_000;

const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const LoggedExportProgressStageRank: Record<LoggedExportProgressStage, number> =
  {
    preparing: 1,
    acquiring_source: 2,
    inspecting_source: 3,
    rendering: 4,
    validating_media: 5,
    building_thumbnail: 6,
    building_subtitles: 7,
    packaging: 8,
    cleaning_source: 9,
    local_complete: 10,
  };

const clipCandidateSelect = "SELECT c.* FROM clip_candidates c";
const loggedExportRequestSelect = `SELECT er.*, j.state,
   export_success.result_json AS export_success_result_json
 FROM export_requests er
 JOIN jobs j ON j.id = er.job_id
 LEFT JOIN logged_export_success_results export_success
   ON export_success.export_request_id = er.id`;
const loggedExportDeliverySelect = `SELECT
   d.id AS delivery_id, d.generation AS delivery_generation,
   d.reservation_token, d.worker_id, d.worker_epoch, d.reserved_at,
   d.reservation_expires_at, d.accepted_at, er.*, j.state,
   export_success.result_json AS export_success_result_json,
   delivery_clip.export_status AS delivery_clip_export_status
 FROM logged_export_deliveries d
 JOIN export_requests er ON er.id = d.export_request_id
 JOIN jobs j ON j.id = er.job_id
 JOIN clip_candidates delivery_clip ON delivery_clip.id = er.clip_id
 LEFT JOIN logged_export_success_results export_success
   ON export_success.export_request_id = er.id`;

export class SharedProjectCatalog {
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: PGlite,
    private readonly store: TranscriptObjectStore,
    private readonly now: () => Date = () => new Date(),
    private readonly uploadUrlIssuer: StagedUploadUrlIssuer = new MemoryStagedUploadUrlIssuer(),
  ) {}

  async registerUser(
    actor: AuthenticatedActor,
    displayName: string,
  ): Promise<User> {
    const now = this.now().toISOString();
    const result = await this.database.query<DbRow>(
      `INSERT INTO users (id, external_subject, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (external_subject) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
       RETURNING id, external_subject, display_name, preferred_language,
                 created_at, updated_at`,
      [actor.userId, actor.externalSubject, displayName.trim(), now],
    );
    return mapUser(result.rows[0]);
  }

  async getCurrentUser(actor: AuthenticatedActor): Promise<User> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT id, external_subject, display_name, preferred_language,
              created_at, updated_at
       FROM users WHERE id = $1 AND external_subject = $2`,
      [actor.userId, actor.externalSubject],
    );
    return mapUser(result.rows[0]);
  }

  async registerExportWorker(
    actor: AuthenticatedActor,
    input: RegisterExportWorkerRequest,
  ): Promise<RegisteredExportWorker> {
    await this.requireRegistered(actor);
    const parsed = RegisterExportWorkerRequestSchema.parse(input);
    this.assertRegisterableExportWorkerAdvertisement(parsed);
    const now = this.now();
    const expires = new Date(now.getTime() + ExportWorkerHeartbeatTtlMs);
    const existing = await this.database.query<DbRow>(
      "SELECT * FROM registered_export_workers WHERE id = $1",
      [parsed.workerId],
    );
    const current = existing.rows[0];
    if (current && String(current.owner_user_id) !== actor.userId)
      throw new AuthorizationError(
        "This worker identity belongs to another user.",
      );
    if (current && Number(current.epoch) > parsed.epoch)
      throw new CatalogConflictError("Worker registration epoch is stale.");
    if (
      current &&
      current.revoked_at &&
      Number(current.epoch) >= parsed.epoch
    ) {
      throw new CatalogConflictError(
        "A revoked worker must use a higher registration epoch.",
      );
    }
    if (
      current &&
      Number(current.epoch) === parsed.epoch &&
      !sameExportWorkerAdvertisement(current, parsed)
    ) {
      throw new CatalogConflictError(
        "A registration epoch can only replay its original capability advertisement.",
      );
    }
    const result = await this.database.query<DbRow>(
      `INSERT INTO registered_export_workers
         (id, owner_user_id, epoch, capability_json, installed_capabilities_json,
          advertisement_fingerprint, heartbeat_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $7)
       ON CONFLICT (id) DO UPDATE SET
         epoch = EXCLUDED.epoch,
         capability_json = EXCLUDED.capability_json,
         installed_capabilities_json = EXCLUDED.installed_capabilities_json,
         advertisement_fingerprint = EXCLUDED.advertisement_fingerprint,
         heartbeat_at = EXCLUDED.heartbeat_at,
         expires_at = EXCLUDED.expires_at,
         revoked_at = NULL,
         updated_at = EXCLUDED.updated_at
       WHERE registered_export_workers.owner_user_id = EXCLUDED.owner_user_id
         AND (
           registered_export_workers.epoch < EXCLUDED.epoch
           OR (
             registered_export_workers.epoch = EXCLUDED.epoch
             AND registered_export_workers.revoked_at IS NULL
             AND registered_export_workers.capability_json = EXCLUDED.capability_json
             AND registered_export_workers.installed_capabilities_json = EXCLUDED.installed_capabilities_json
             AND registered_export_workers.advertisement_fingerprint = EXCLUDED.advertisement_fingerprint
           )
         )
       RETURNING *`,
      [
        parsed.workerId,
        actor.userId,
        parsed.epoch,
        JSON.stringify(parsed.capability),
        JSON.stringify(parsed.installedCapabilities),
        parsed.advertisementFingerprint,
        now.toISOString(),
        expires.toISOString(),
      ],
    );
    if (!result.rows[0])
      throw new CatalogConflictError("Worker registration epoch is stale.");
    return mapRegisteredExportWorker(result.rows[0]);
  }

  async heartbeatExportWorker(
    actor: AuthenticatedActor,
    input: HeartbeatExportWorkerRequest,
  ): Promise<RegisteredExportWorker> {
    await this.requireRegistered(actor);
    const parsed = HeartbeatExportWorkerRequestSchema.parse(input);
    const now = this.now();
    const expires = new Date(now.getTime() + ExportWorkerHeartbeatTtlMs);
    const existing = await this.database.query<DbRow>(
      "SELECT owner_user_id FROM registered_export_workers WHERE id = $1",
      [parsed.workerId],
    );
    if (
      existing.rows[0] &&
      String(existing.rows[0].owner_user_id) !== actor.userId
    ) {
      throw new AuthorizationError(
        "This worker identity belongs to another user.",
      );
    }
    const result = await this.database.query<DbRow>(
      `UPDATE registered_export_workers
       SET heartbeat_at = $1, expires_at = $2, updated_at = $1
       WHERE id = $3 AND owner_user_id = $4 AND epoch = $5
         AND revoked_at IS NULL AND expires_at > $1
       RETURNING *`,
      [
        now.toISOString(),
        expires.toISOString(),
        parsed.workerId,
        actor.userId,
        parsed.epoch,
      ],
    );
    if (!result.rows[0]) {
      throw new CatalogConflictError(
        "Worker heartbeat is stale, expired, revoked, or not owned by this actor.",
      );
    }
    return mapRegisteredExportWorker(result.rows[0]);
  }

  async revokeExportWorker(
    actor: AuthenticatedActor,
    input: RevokeExportWorkerRequest,
  ): Promise<void> {
    await this.requireRegistered(actor);
    const parsed = RevokeExportWorkerRequestSchema.parse(input);
    const now = this.now().toISOString();
    const existing = await this.database.query<DbRow>(
      "SELECT owner_user_id FROM registered_export_workers WHERE id = $1",
      [parsed.workerId],
    );
    if (
      existing.rows[0] &&
      String(existing.rows[0].owner_user_id) !== actor.userId
    ) {
      throw new AuthorizationError(
        "This worker identity belongs to another user.",
      );
    }
    const result = await this.database.query<DbRow>(
      `UPDATE registered_export_workers
       SET revoked_at = $1, updated_at = $1
       WHERE id = $2 AND owner_user_id = $3 AND epoch = $4
         AND revoked_at IS NULL
       RETURNING id`,
      [now, parsed.workerId, actor.userId, parsed.epoch],
    );
    if (!result.rows[0]) {
      throw new CatalogConflictError(
        "Worker revocation is stale, already revoked, or not owned by this actor.",
      );
    }
  }

  async claimLoggedExportDelivery(
    actor: AuthenticatedActor,
    input: ClaimLoggedExportDeliveryRequest,
  ): Promise<ClaimLoggedExportDeliveryResponse> {
    await this.requireRegistered(actor);
    const parsed = ClaimLoggedExportDeliveryRequestSchema.parse(input);
    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + LoggedExportDeliveryReservationTtlMs,
    ).toISOString();
    let claimed: DbRow | undefined;

    await this.transaction(async () => {
      const workerResult = await this.database.query<DbRow>(
        `SELECT * FROM registered_export_workers
         WHERE id = $1
         FOR UPDATE`,
        [parsed.workerId],
      );
      const workerRow = workerResult.rows[0];
      if (workerRow && String(workerRow.owner_user_id) !== actor.userId) {
        throw new AuthorizationError(
          "This worker identity belongs to another user.",
        );
      }
      if (
        !workerRow ||
        Number(workerRow.epoch) !== parsed.workerEpoch ||
        workerRow.revoked_at ||
        new Date(iso(workerRow.expires_at)).getTime() <= now.getTime()
      ) {
        throw new CatalogConflictError(
          "Worker registration is missing, stale, expired, or revoked.",
        );
      }
      const worker = mapRegisteredExportWorker(workerRow);

      const replay = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect}
         JOIN project_members delivery_members
           ON delivery_members.project_id = er.project_id
          AND delivery_members.user_id = $1
         WHERE d.worker_id = $2 AND d.worker_epoch = $3
           AND d.accepted_at IS NULL AND d.reservation_expires_at > $4
           AND j.state = 'queued'
           AND NOT EXISTS (
             SELECT 1 FROM logged_export_cancel_intents cancel
             WHERE cancel.export_request_id = er.id
           )
         ORDER BY d.reserved_at, d.id
         LIMIT 1
         FOR UPDATE OF d SKIP LOCKED`,
        [actor.userId, parsed.workerId, parsed.workerEpoch, nowIso],
      );
      if (replay.rows[0]) {
        claimed = replay.rows[0];
        return;
      }

      const candidates = await this.database.query<DbRow>(
        `${loggedExportRequestSelect}
         JOIN project_members claim_members
           ON claim_members.project_id = er.project_id
          AND claim_members.user_id = $1
         LEFT JOIN logged_export_deliveries existing_delivery
           ON existing_delivery.export_request_id = er.id
         WHERE j.state = 'queued'
           AND NOT EXISTS (
             SELECT 1 FROM logged_export_cancel_intents cancel
             WHERE cancel.export_request_id = er.id
           )
           AND (
             existing_delivery.id IS NULL OR
             (existing_delivery.accepted_at IS NULL
              AND existing_delivery.reservation_expires_at <= $2)
           )
           AND er.resolved_settings_snapshot IS NOT NULL
           AND er.resolved_settings_snapshot->'capability' = $3::jsonb
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(
               $4::jsonb->'availableRendererIds'
             ) AS available(renderer_id)
             WHERE available.renderer_id = CASE
               WHEN er.resolved_settings_snapshot->'settings'->>'container' = 'mp4'
                AND er.resolved_settings_snapshot->'settings'->>'videoCodec' = 'h264'
                AND er.resolved_settings_snapshot->'settings'->>'audioCodec' = 'aac'
                 THEN 'h264_mp4'
               WHEN er.resolved_settings_snapshot->'settings'->>'container' = 'mkv'
                AND er.resolved_settings_snapshot->'settings'->>'videoCodec' = 'hevc'
                AND er.resolved_settings_snapshot->'settings'->>'audioCodec' = 'aac'
                 THEN 'hevc_mkv'
               WHEN er.resolved_settings_snapshot->'settings'->>'container' = 'mov'
                AND er.resolved_settings_snapshot->'settings'->>'videoCodec' = 'prores'
                AND er.resolved_settings_snapshot->'settings'->>'audioCodec' = 'pcm_s16le'
                 THEN 'prores_mov'
               ELSE NULL
             END
           )
         ORDER BY er.created_at, er.id
         LIMIT 1
         FOR UPDATE OF er SKIP LOCKED`,
        [
          actor.userId,
          nowIso,
          JSON.stringify(worker.capability),
          JSON.stringify(worker.installedCapabilities),
        ],
      );
      const candidate = candidates.rows[0];
      if (!candidate) return;

      const priorDelivery = await this.database.query<{ id: string }>(
        "SELECT id FROM logged_export_deliveries WHERE export_request_id = $1",
        [candidate.id],
      );
      const deliveryId = priorDelivery.rows[0]?.id ?? randomUUID();
      const reservationToken = randomUUID();
      const saved = await this.database.query<DbRow>(
        `INSERT INTO logged_export_deliveries
           (id, export_request_id, generation, reservation_token, worker_id,
            worker_epoch, reserved_at, reservation_expires_at, accepted_at,
            created_at, updated_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, NULL, $6, $6)
         ON CONFLICT (export_request_id) DO UPDATE SET
           generation = logged_export_deliveries.generation + 1,
           reservation_token = EXCLUDED.reservation_token,
           worker_id = EXCLUDED.worker_id,
           worker_epoch = EXCLUDED.worker_epoch,
           reserved_at = EXCLUDED.reserved_at,
           reservation_expires_at = EXCLUDED.reservation_expires_at,
           accepted_at = NULL,
           updated_at = EXCLUDED.updated_at
         WHERE logged_export_deliveries.accepted_at IS NULL
           AND logged_export_deliveries.reservation_expires_at <= $6
         RETURNING id`,
        [
          deliveryId,
          candidate.id,
          reservationToken,
          parsed.workerId,
          parsed.workerEpoch,
          nowIso,
          expiresAt,
        ],
      );
      if (!saved.rows[0]) return;
      const result = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect} WHERE d.id = $1`,
        [saved.rows[0].id],
      );
      claimed = result.rows[0];
    });

    return ClaimLoggedExportDeliveryResponseSchema.parse(
      claimed ? { delivery: mapLoggedExportDelivery(claimed) } : {},
    );
  }

  async acceptLoggedExportDelivery(
    actor: AuthenticatedActor,
    input: AcceptLoggedExportDeliveryRequest,
  ): Promise<LoggedExportDelivery> {
    await this.requireRegistered(actor);
    const parsed = AcceptLoggedExportDeliveryRequestSchema.parse(input);
    const now = this.now().toISOString();
    let accepted: DbRow | undefined;

    await this.transaction(async () => {
      const worker = await this.database.query<DbRow>(
        `SELECT * FROM registered_export_workers WHERE id = $1 FOR UPDATE`,
        [parsed.workerId],
      );
      const workerRow = worker.rows[0];
      if (workerRow && String(workerRow.owner_user_id) !== actor.userId) {
        throw new AuthorizationError(
          "This worker identity belongs to another user.",
        );
      }
      if (
        !workerRow ||
        Number(workerRow.epoch) !== parsed.workerEpoch ||
        workerRow.revoked_at ||
        new Date(iso(workerRow.expires_at)).getTime() <= new Date(now).getTime()
      ) {
        throw new CatalogConflictError(
          "Worker registration is missing, stale, expired, or revoked.",
        );
      }

      const current = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect}
         JOIN project_members delivery_members
           ON delivery_members.project_id = er.project_id
          AND delivery_members.user_id = $1
         WHERE d.id = $2 AND d.worker_id = $3 AND d.worker_epoch = $4
           AND d.generation = $5 AND d.reservation_token = $6
           AND (
             d.accepted_at IS NOT NULL
             OR (
               j.state = 'queued'
               AND delivery_clip.export_status = 'queued'
               AND NOT EXISTS (
                 SELECT 1 FROM logged_export_cancel_intents cancel
                 WHERE cancel.export_request_id = er.id
               )
             )
           )
         FOR UPDATE OF d`,
        [
          actor.userId,
          parsed.deliveryId,
          parsed.workerId,
          parsed.workerEpoch,
          parsed.generation,
          parsed.reservationToken,
        ],
      );
      const row = current.rows[0];
      if (!row) {
        throw new CatalogConflictError(
          "Delivery reservation is stale, reassigned, or unauthorized.",
        );
      }
      if (row.accepted_at) {
        accepted = row;
        return;
      }
      if (
        new Date(iso(row.reservation_expires_at)).getTime() <=
        new Date(now).getTime()
      ) {
        throw new CatalogConflictError(
          "Delivery reservation expired before acceptance.",
        );
      }
      await this.database.query(
        `UPDATE logged_export_deliveries
         SET accepted_at = $1, updated_at = $1
         WHERE id = $2 AND generation = $3 AND reservation_token = $4
           AND accepted_at IS NULL AND reservation_expires_at > $1`,
        [now, parsed.deliveryId, parsed.generation, parsed.reservationToken],
      );
      const result = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect} WHERE d.id = $1`,
        [parsed.deliveryId],
      );
      accepted = result.rows[0];
    });
    if (!accepted) {
      throw new CatalogConflictError("Delivery acceptance did not persist.");
    }
    return mapLoggedExportDelivery(accepted);
  }

  async cancelLoggedExport(
    actor: AuthenticatedActor,
    projectId: string,
    requestId: string,
    input: CancelLoggedExportRequest,
  ): Promise<CancelLoggedExportResponse> {
    await this.requireRegistered(actor);
    const parsed = CancelLoggedExportRequestSchema.parse(input);
    const now = this.now().toISOString();
    let outcome: CancelLoggedExportResponse["outcome"] = "cancel_requested";
    let cancelRequestedAt: string | undefined;

    await this.transaction(async () => {
      const result = await this.database.query<DbRow>(
        `SELECT er.*, j.state,
                export_success.result_json AS export_success_result_json,
                cancel_clip.export_status AS cancel_clip_export_status,
                delivery.accepted_at AS delivery_accepted_at,
                intent.idempotency_key AS intent_idempotency_key,
                intent.requested_at AS intent_requested_at,
                canceled.id AS canceled_id,
                failure.id AS failure_id
         FROM export_requests er
         JOIN jobs j ON j.id = er.job_id
         LEFT JOIN logged_export_success_results export_success
           ON export_success.export_request_id = er.id
         JOIN clip_candidates cancel_clip ON cancel_clip.id = er.clip_id
         JOIN project_members cancel_member
           ON cancel_member.project_id = er.project_id
          AND cancel_member.user_id = $1
         LEFT JOIN logged_export_deliveries delivery
           ON delivery.export_request_id = er.id
         LEFT JOIN logged_export_cancel_intents intent
           ON intent.export_request_id = er.id
         LEFT JOIN logged_export_failure_results failure
           ON failure.export_request_id = er.id
         LEFT JOIN logged_export_canceled_results canceled
           ON canceled.export_request_id = er.id
         WHERE er.id = $2 AND er.project_id = $3
         FOR UPDATE OF er, j, cancel_clip`,
        [actor.userId, requestId, projectId],
      );
      const row = result.rows[0];
      if (!row)
        throw new AuthorizationError("Export cancellation is not authorized.");
      const membership = await this.database.query<{ role: ProjectRole }>(
        "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "write");

      if (
        row.intent_idempotency_key &&
        String(row.intent_idempotency_key) !== parsed.idempotencyKey
      ) {
        throw new CatalogIdempotencyConflictError(
          "This export already has a different cancellation command identity.",
        );
      }
      if (["complete", "failed", "canceled"].includes(String(row.state))) {
        outcome = row.canceled_id ? "canceled" : "already_terminal";
        cancelRequestedAt = row.intent_requested_at
          ? iso(row.intent_requested_at)
          : undefined;
        return;
      }
      if (
        !["queued", "processing"].includes(String(row.state)) ||
        !["queued", "processing"].includes(
          String(row.cancel_clip_export_status),
        )
      ) {
        throw new CatalogConflictError(
          "This export cannot be canceled from its current state.",
        );
      }

      if (!row.intent_requested_at) {
        await this.database.query(
          `INSERT INTO logged_export_cancel_intents
             (export_request_id, project_id, requested_by, idempotency_key, requested_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [requestId, projectId, actor.userId, parsed.idempotencyKey, now],
        );
        cancelRequestedAt = now;
      } else {
        cancelRequestedAt = iso(row.intent_requested_at);
      }

      if (!row.delivery_accepted_at) {
        const request = mapLoggedExportRequest(row);
        const canceledResult = LoggedExportCanceledResultSchema.parse({
          schemaVersion: 1,
          requestId: request.id,
          jobId: request.jobId,
          projectId: request.projectId,
          clipId: request.clipId,
          reason: "user_requested",
          attempt: 0,
          sourceCleanup: { lifecycle: "not_started" },
        });
        const canceledId = randomUUID();
        await this.database.query(
          `INSERT INTO logged_export_canceled_results
             (id, export_request_id, result_schema_version, result_json,
              result_fingerprint, reconciled_at)
           VALUES ($1, $2, 1, $3, $4, $5)`,
          [
            canceledId,
            requestId,
            JSON.stringify(canceledResult),
            sha256Fingerprint(canceledResult),
            now,
          ],
        );
        await this.database.query(
          "UPDATE jobs SET state = 'canceled', updated_at = $1 WHERE id = $2 AND state = 'queued'",
          [now, request.jobId],
        );
        const clip = await this.database.query<DbRow>(
          `UPDATE clip_candidates
           SET export_status = 'canceled', version = version + 1, updated_at = $1
           WHERE id = $2 AND project_id = $3 AND export_status = 'queued'
           RETURNING version`,
          [now, request.clipId, projectId],
        );
        if (!clip.rows[0])
          throw new CatalogConflictError(
            "The queued clip changed during cancellation.",
          );
        await this.database.query(
          `INSERT INTO sync_events
             (project_id, event_type, entity_id, server_version, payload, created_at)
           VALUES ($1, 'clip_candidate.export_canceled', $2, $3, $4, $5)`,
          [
            projectId,
            request.clipId,
            clip.rows[0].version,
            JSON.stringify({
              clipId: request.clipId,
              exportRequestId: request.id,
              jobId: request.jobId,
              canceledResultId: canceledId,
              reason: "user_requested",
              attempt: 0,
              sourceCleanup: { lifecycle: "not_started" },
            }),
            now,
          ],
        );
        outcome = "canceled";
      }
    });

    const request = await this.getLoggedExportRequest(
      actor,
      projectId,
      requestId,
    );
    return CancelLoggedExportResponseSchema.parse({
      outcome,
      request,
      ...(cancelRequestedAt ? { cancelRequestedAt } : {}),
    });
  }

  async startLoggedExportExecution(
    actor: AuthenticatedActor,
    input: StartLoggedExportExecutionRequest,
  ): Promise<StartLoggedExportExecutionResponse> {
    await this.requireRegistered(actor);
    const parsed = StartLoggedExportExecutionRequestSchema.parse(input);
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const expiresAt = new Date(
      nowDate.getTime() + LoggedExportExecutionLeaseTtlMs,
    ).toISOString();
    let response: StartLoggedExportExecutionResponse | undefined;

    await this.transaction(async () => {
      const worker = await this.database.query<DbRow>(
        "SELECT * FROM registered_export_workers WHERE id = $1 FOR UPDATE",
        [parsed.workerId],
      );
      const workerRow = worker.rows[0];
      if (workerRow && String(workerRow.owner_user_id) !== actor.userId) {
        throw new AuthorizationError(
          "This worker identity belongs to another user.",
        );
      }
      if (
        !workerRow ||
        Number(workerRow.epoch) !== parsed.workerEpoch ||
        workerRow.revoked_at ||
        new Date(iso(workerRow.expires_at)).getTime() <= nowDate.getTime()
      ) {
        throw new CatalogConflictError(
          "Worker registration is missing, stale, expired, or revoked.",
        );
      }
      const deliveryResult = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect}
         JOIN project_members execution_member
           ON execution_member.project_id = er.project_id
          AND execution_member.user_id = $1
         LEFT JOIN logged_export_cancel_intents cancel
           ON cancel.export_request_id = er.id
         WHERE d.id = $2 AND d.worker_id = $3 AND d.worker_epoch = $4
           AND d.generation = $5 AND d.reservation_token = $6
           AND d.accepted_at IS NOT NULL
         FOR UPDATE OF d, er, j, delivery_clip`,
        [
          actor.userId,
          parsed.deliveryId,
          parsed.workerId,
          parsed.workerEpoch,
          parsed.generation,
          parsed.reservationToken,
        ],
      );
      const delivery = deliveryResult.rows[0];
      if (!delivery)
        throw new CatalogConflictError(
          "The accepted export delivery is stale or unauthorized.",
        );
      const cancelIntent = await this.database.query<{ requested_at: unknown }>(
        "SELECT requested_at FROM logged_export_cancel_intents WHERE export_request_id = $1",
        [delivery.id],
      );
      const existing = await this.database.query<DbRow>(
        "SELECT * FROM logged_export_executions WHERE delivery_id = $1 FOR UPDATE",
        [parsed.deliveryId],
      );
      let execution = existing.rows[0];
      if (cancelIntent.rows[0] && !execution) {
        response = {
          status: "cancel_requested",
          cancelRequestedAt: iso(cancelIntent.rows[0].requested_at),
        };
        return;
      }
      if (
        !["queued", "processing"].includes(String(delivery.state)) ||
        !["queued", "processing"].includes(
          String(delivery.delivery_clip_export_status),
        )
      ) {
        throw new CatalogConflictError(
          "This accepted export cannot start execution.",
        );
      }
      if (execution) {
        if (
          String(execution.export_request_id) !== String(delivery.id) ||
          Number(execution.delivery_generation) !== parsed.generation ||
          String(execution.worker_id) !== parsed.workerId ||
          Number(execution.worker_epoch) !== parsed.workerEpoch
        ) {
          throw new CatalogConflictError(
            "A different execution already owns this delivery.",
          );
        }
        await this.database.query(
          `UPDATE logged_export_executions
           SET heartbeat_at = $1, expires_at = $2 WHERE id = $3`,
          [now, expiresAt, execution.id],
        );
        execution = {
          ...execution,
          heartbeat_at: now,
          expires_at: expiresAt,
          ...(cancelIntent.rows[0]
            ? { cancel_requested_at: cancelIntent.rows[0].requested_at }
            : {}),
        };
      } else {
        const inserted = await this.database.query<DbRow>(
          `INSERT INTO logged_export_executions
             (id, export_request_id, delivery_id, delivery_generation,
              worker_id, worker_epoch, attempt, lease_token, started_at,
              heartbeat_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8, $9)
           RETURNING *`,
          [
            randomUUID(),
            delivery.id,
            parsed.deliveryId,
            parsed.generation,
            parsed.workerId,
            parsed.workerEpoch,
            randomUUID(),
            now,
            expiresAt,
          ],
        );
        execution = inserted.rows[0];
        await this.database.query(
          "UPDATE jobs SET state = 'processing', attempt = 1, updated_at = $1 WHERE id = $2 AND state = 'queued'",
          [now, delivery.job_id],
        );
        await this.database.query(
          "UPDATE clip_candidates SET export_status = 'processing', updated_at = $1 WHERE id = $2 AND export_status = 'queued'",
          [now, delivery.clip_id],
        );
      }
      response = {
        status: "started",
        execution: mapLoggedExportExecution(execution!),
        ...(await this.loadLoggedExportProgress(String(execution!.id))),
      };
    });
    if (!response)
      throw new CatalogConflictError("Execution start did not persist.");
    return StartLoggedExportExecutionResponseSchema.parse(response);
  }

  async heartbeatLoggedExportExecution(
    actor: AuthenticatedActor,
    input: HeartbeatLoggedExportExecutionRequest,
  ): Promise<HeartbeatLoggedExportExecutionResponse> {
    await this.requireRegistered(actor);
    const parsed = HeartbeatLoggedExportExecutionRequestSchema.parse(input);
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const expiresAt = new Date(
      nowDate.getTime() + LoggedExportExecutionLeaseTtlMs,
    ).toISOString();
    let row: DbRow | undefined;
    await this.transaction(async () => {
      const current = await this.database.query<DbRow>(
        `SELECT execution.*, cancel.requested_at AS cancel_requested_at,
                worker.owner_user_id, worker.epoch AS current_worker_epoch,
                worker.revoked_at, worker.expires_at AS worker_expires_at,
                delivery.generation AS current_delivery_generation,
                delivery.reservation_token
         FROM logged_export_executions execution
         JOIN registered_export_workers worker ON worker.id = execution.worker_id
         JOIN logged_export_deliveries delivery ON delivery.id = execution.delivery_id
         JOIN export_requests er ON er.id = execution.export_request_id
         JOIN project_members member ON member.project_id = er.project_id AND member.user_id = $1
         LEFT JOIN logged_export_cancel_intents cancel ON cancel.export_request_id = er.id
         WHERE execution.id = $2 AND execution.attempt = $3
           AND execution.lease_token = $4
         FOR UPDATE OF execution`,
        [actor.userId, parsed.executionId, parsed.attempt, parsed.leaseToken],
      );
      const execution = current.rows[0];
      if (
        !execution ||
        String(execution.owner_user_id) !== actor.userId ||
        String(execution.worker_id) !== parsed.workerId ||
        Number(execution.worker_epoch) !== parsed.workerEpoch ||
        String(execution.delivery_id) !== parsed.deliveryId ||
        Number(execution.delivery_generation) !== parsed.generation ||
        Number(execution.current_delivery_generation) !== parsed.generation ||
        String(execution.reservation_token) !== parsed.reservationToken ||
        Number(execution.current_worker_epoch) !== parsed.workerEpoch ||
        execution.revoked_at ||
        new Date(iso(execution.worker_expires_at)).getTime() <=
          nowDate.getTime() ||
        new Date(iso(execution.expires_at)).getTime() <= nowDate.getTime()
      ) {
        throw new CatalogConflictError(
          "The logged export execution lease is stale or unauthorized.",
        );
      }
      if (
        parsed.progress &&
        (parsed.progress.executionId !== String(execution.id) ||
          parsed.progress.requestId !== String(execution.export_request_id) ||
          parsed.progress.attempt !== Number(execution.attempt))
      ) {
        throw new CatalogConflictError(
          "Logged export progress belongs to a different execution.",
        );
      }
      if (parsed.progress) {
        await this.persistLoggedExportProgress(parsed.progress);
      }
      const updated = await this.database.query<DbRow>(
        `UPDATE logged_export_executions SET heartbeat_at = $1, expires_at = $2
         WHERE id = $3 RETURNING *`,
        [now, expiresAt, parsed.executionId],
      );
      await this.database.query(
        `UPDATE registered_export_workers
         SET heartbeat_at = $1, expires_at = $2, updated_at = $1
         WHERE id = $3 AND epoch = $4`,
        [
          now,
          new Date(
            nowDate.getTime() + ExportWorkerHeartbeatTtlMs,
          ).toISOString(),
          parsed.workerId,
          parsed.workerEpoch,
        ],
      );
      row = {
        ...updated.rows[0],
        cancel_requested_at: execution.cancel_requested_at,
      };
    });
    if (!row)
      throw new CatalogConflictError("Execution heartbeat did not persist.");
    return HeartbeatLoggedExportExecutionResponseSchema.parse({
      execution: mapLoggedExportExecution(row),
      ...(await this.loadLoggedExportProgress(String(row.id))),
    });
  }

  async getLoggedExportProgress(
    actor: AuthenticatedActor,
    projectId: string,
    requestId: string,
  ): Promise<GetLoggedExportProgressResponse> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT er.id AS export_request_id, er.job_id, j.state,
              progress.execution_id, progress.attempt, progress.sequence,
              progress.stage, progress.basis_points, progress.updated_at
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       LEFT JOIN logged_export_execution_progress progress
         ON progress.export_request_id = er.id
       WHERE er.id = $1 AND er.project_id = $2`,
      [requestId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Export request not found.");
    return GetLoggedExportProgressResponseSchema.parse({
      requestId: row.export_request_id,
      jobId: row.job_id,
      state: row.state,
      ...(row.execution_id ? { progress: mapLoggedExportProgress(row) } : {}),
    });
  }

  async reconcileLoggedExportCanceled(
    actor: AuthenticatedActor,
    input: ReconcileLoggedExportCanceledRequest,
  ): Promise<LoggedExportCanceled> {
    await this.requireRegistered(actor);
    const parsed = ReconcileLoggedExportCanceledRequestSchema.parse(input);
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const resultFingerprint = sha256Fingerprint(parsed.result);
    let reconciled: DbRow | undefined;

    await this.transaction(async () => {
      const worker = await this.database.query<DbRow>(
        "SELECT * FROM registered_export_workers WHERE id = $1 FOR UPDATE",
        [parsed.workerId],
      );
      const workerRow = worker.rows[0];
      if (!workerRow || String(workerRow.owner_user_id) !== actor.userId) {
        throw new AuthorizationError(
          "This accepted delivery belongs to another worker owner.",
        );
      }
      const deliveryResult = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect}
         JOIN project_members cancel_member
           ON cancel_member.project_id = er.project_id
          AND cancel_member.user_id = $1
         LEFT JOIN logged_export_cancel_intents cancel
           ON cancel.export_request_id = er.id
         WHERE d.id = $2 AND d.worker_id = $3 AND d.worker_epoch = $4
           AND d.generation = $5 AND d.reservation_token = $6
           AND d.accepted_at IS NOT NULL
         FOR UPDATE OF d, er, j, delivery_clip`,
        [
          actor.userId,
          parsed.deliveryId,
          parsed.workerId,
          parsed.workerEpoch,
          parsed.generation,
          parsed.reservationToken,
        ],
      );
      const delivery = deliveryResult.rows[0];
      if (!delivery)
        throw new CatalogConflictError(
          "The accepted export delivery is stale or unauthorized.",
        );
      assertLoggedExportCanceledMatchesRequest(delivery, parsed.result);

      const existingSuccess = await this.database.query<DbRow>(
        "SELECT id FROM logged_export_success_results WHERE export_request_id = $1 OR delivery_id = $2 FOR UPDATE",
        [delivery.id, parsed.deliveryId],
      );
      const existingFailure = await this.database.query<DbRow>(
        "SELECT id FROM logged_export_failure_results WHERE export_request_id = $1 OR delivery_id = $2 FOR UPDATE",
        [delivery.id, parsed.deliveryId],
      );
      if (existingSuccess.rows[0] || existingFailure.rows[0]) {
        throw new CatalogConflictError(
          "A different immutable terminal result already exists for this export.",
        );
      }
      const existingCanceled = await this.database.query<DbRow>(
        "SELECT * FROM logged_export_canceled_results WHERE export_request_id = $1 OR delivery_id = $2 FOR UPDATE",
        [delivery.id, parsed.deliveryId],
      );
      if (existingCanceled.rows[0]) {
        const mapped = mapLoggedExportCanceled(existingCanceled.rows[0]);
        if (
          String(existingCanceled.rows[0].result_fingerprint) !==
            resultFingerprint ||
          canonicalJson(mapped.result) !== canonicalJson(parsed.result)
        ) {
          throw new CatalogConflictError(
            "A different immutable cancellation is already reconciled.",
          );
        }
        if (
          String(delivery.state) !== "canceled" ||
          String(delivery.delivery_clip_export_status) !== "canceled"
        ) {
          throw new CatalogConflictError(
            "The existing cancellation has inconsistent authoritative state.",
          );
        }
        reconciled = existingCanceled.rows[0];
        return;
      }

      const intent = await this.database.query<DbRow>(
        "SELECT * FROM logged_export_cancel_intents WHERE export_request_id = $1 FOR UPDATE",
        [delivery.id],
      );
      let execution: DbRow | undefined;
      if (parsed.executionId) {
        const executionResult = await this.database.query<DbRow>(
          `SELECT * FROM logged_export_executions
           WHERE id = $1 AND export_request_id = $2 AND delivery_id = $3
             AND delivery_generation = $4 AND worker_id = $5
             AND worker_epoch = $6 AND lease_token = $7
           FOR UPDATE`,
          [
            parsed.executionId,
            delivery.id,
            parsed.deliveryId,
            parsed.generation,
            parsed.workerId,
            parsed.workerEpoch,
            parsed.leaseToken,
          ],
        );
        execution = executionResult.rows[0];
        if (
          !execution ||
          Number(execution.attempt) !== parsed.result.executionAttempt
        ) {
          throw new CatalogConflictError(
            "Canceled result execution ownership is stale or mismatched.",
          );
        }
      }
      if (parsed.result.reason === "user_requested" && !intent.rows[0]) {
        throw new CatalogConflictError(
          "User-requested cancellation has no durable cancel intent.",
        );
      }
      if (
        parsed.result.reason === "execution_lease_lost" &&
        (!execution ||
          (new Date(iso(execution.expires_at)).getTime() > nowDate.getTime() &&
            Number(workerRow.epoch) === parsed.workerEpoch &&
            !workerRow.revoked_at))
      ) {
        throw new CatalogConflictError(
          "Execution ownership has not durably expired or changed.",
        );
      }
      if (
        !["queued", "processing"].includes(String(delivery.state)) ||
        !["queued", "processing"].includes(
          String(delivery.delivery_clip_export_status),
        )
      ) {
        throw new CatalogConflictError(
          "Only the exact nonterminal accepted export can be canceled.",
        );
      }

      const resultId = randomUUID();
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO logged_export_canceled_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, execution_id, result_schema_version,
            result_json, result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10)
         RETURNING *`,
        [
          resultId,
          delivery.id,
          parsed.deliveryId,
          parsed.generation,
          parsed.workerId,
          parsed.workerEpoch,
          parsed.executionId ?? null,
          JSON.stringify(parsed.result),
          resultFingerprint,
          now,
        ],
      );
      const job = await this.database.query<DbRow>(
        `UPDATE jobs SET state = 'canceled', updated_at = $1
         WHERE id = $2 AND kind = 'export' AND state IN ('queued', 'processing')
         RETURNING id`,
        [now, parsed.result.jobId],
      );
      const clip = await this.database.query<DbRow>(
        `UPDATE clip_candidates
         SET export_status = 'canceled', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3
           AND export_status IN ('queued', 'processing')
         RETURNING version`,
        [now, parsed.result.clipId, parsed.result.projectId],
      );
      if (!job.rows[0] || !clip.rows[0]) {
        throw new CatalogConflictError(
          "The export changed during cancellation reconciliation.",
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_canceled', $2, $3, $4, $5)`,
        [
          parsed.result.projectId,
          parsed.result.clipId,
          clip.rows[0].version,
          JSON.stringify({
            clipId: parsed.result.clipId,
            exportRequestId: parsed.result.requestId,
            jobId: parsed.result.jobId,
            canceledResultId: resultId,
            reason: parsed.result.reason,
            attempt: parsed.result.attempt,
            sourceCleanup: parsed.result.sourceCleanup,
          }),
          now,
        ],
      );
      reconciled = inserted.rows[0];
    });

    if (!reconciled)
      throw new CatalogConflictError("Cancellation reconciliation failed.");
    return mapLoggedExportCanceled(reconciled);
  }

  async reconcileLoggedExportSuccess(
    actor: AuthenticatedActor,
    input: ReconcileLoggedExportSuccessRequest,
  ): Promise<LoggedExportSuccess> {
    await this.requireRegistered(actor);
    const parsed = ReconcileLoggedExportSuccessRequestSchema.parse(input);
    const now = this.now();
    const nowIso = now.toISOString();
    const resultFingerprint = sha256Fingerprint(parsed.result);
    let reconciled: DbRow | undefined;

    await this.transaction(async () => {
      const worker = await this.database.query<DbRow>(
        "SELECT * FROM registered_export_workers WHERE id = $1 FOR UPDATE",
        [parsed.workerId],
      );
      const workerRow = worker.rows[0];
      if (workerRow && String(workerRow.owner_user_id) !== actor.userId) {
        throw new AuthorizationError(
          "This worker identity belongs to another user.",
        );
      }
      if (
        !workerRow ||
        Number(workerRow.epoch) !== parsed.workerEpoch ||
        workerRow.revoked_at ||
        new Date(iso(workerRow.expires_at)).getTime() <= now.getTime()
      ) {
        throw new CatalogConflictError(
          "Worker registration is missing, stale, expired, or revoked.",
        );
      }

      const deliveryResult = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect}
         JOIN project_members result_members
           ON result_members.project_id = er.project_id
          AND result_members.user_id = $1
         WHERE d.id = $2 AND d.worker_id = $3 AND d.worker_epoch = $4
           AND d.generation = $5 AND d.reservation_token = $6
           AND d.accepted_at IS NOT NULL
         FOR UPDATE OF d, er, j, delivery_clip`,
        [
          actor.userId,
          parsed.deliveryId,
          parsed.workerId,
          parsed.workerEpoch,
          parsed.generation,
          parsed.reservationToken,
        ],
      );
      const delivery = deliveryResult.rows[0];
      if (!delivery) {
        throw new CatalogConflictError(
          "The accepted export delivery is stale, mismatched, or unauthorized.",
        );
      }
      assertLoggedExportSuccessMatchesRequest(delivery, parsed.result);

      const cancelIntent = await this.database.query<DbRow>(
        "SELECT export_request_id FROM logged_export_cancel_intents WHERE export_request_id = $1 FOR UPDATE",
        [delivery.id],
      );

      const existingFailure = await this.database.query<DbRow>(
        `SELECT id FROM logged_export_failure_results
         WHERE export_request_id = $1 OR delivery_id = $2
         FOR UPDATE`,
        [delivery.id, parsed.deliveryId],
      );
      if (existingFailure.rows[0]) {
        throw new CatalogConflictError(
          "An immutable failure is already reconciled for this export.",
        );
      }
      const existingCanceled = await this.database.query<DbRow>(
        `SELECT id FROM logged_export_canceled_results
         WHERE export_request_id = $1 OR delivery_id = $2
         FOR UPDATE`,
        [delivery.id, parsed.deliveryId],
      );
      if (existingCanceled.rows[0]) {
        throw new CatalogConflictError(
          "An immutable cancellation is already reconciled for this export.",
        );
      }

      const existingResult = await this.database.query<DbRow>(
        `SELECT * FROM logged_export_success_results
         WHERE export_request_id = $1 OR delivery_id = $2
         FOR UPDATE`,
        [delivery.id, parsed.deliveryId],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        const mapped = mapLoggedExportSuccess(existing);
        if (
          String(existing.export_request_id) !== String(delivery.id) ||
          String(existing.delivery_id) !== parsed.deliveryId ||
          String(existing.result_fingerprint) !== resultFingerprint ||
          canonicalJson(mapped.result) !== canonicalJson(parsed.result)
        ) {
          throw new CatalogConflictError(
            "A different immutable result is already reconciled for this export.",
          );
        }
        if (
          String(delivery.state) !== "complete" ||
          String(delivery.delivery_clip_export_status) !== "complete"
        ) {
          throw new CatalogConflictError(
            "The existing export result has inconsistent authoritative state.",
          );
        }
        reconciled = existing;
        return;
      }

      if (cancelIntent.rows[0]) {
        throw new CatalogConflictError(
          "Cancellation intent won before the first terminal success.",
        );
      }

      if (
        !["queued", "processing"].includes(String(delivery.state)) ||
        !["queued", "processing"].includes(
          String(delivery.delivery_clip_export_status),
        )
      ) {
        throw new CatalogConflictError(
          "Only the exact queued accepted export can record its first result.",
        );
      }

      const resultId = randomUUID();
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO logged_export_success_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, result_schema_version, result_json,
            result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)
         RETURNING *`,
        [
          resultId,
          delivery.id,
          parsed.deliveryId,
          parsed.generation,
          parsed.workerId,
          parsed.workerEpoch,
          JSON.stringify(parsed.result),
          resultFingerprint,
          nowIso,
        ],
      );
      const completedJob = await this.database.query<DbRow>(
        `UPDATE jobs SET state = 'complete', updated_at = $1
         WHERE id = $2 AND kind = 'export' AND state IN ('queued', 'processing')
         RETURNING id`,
        [nowIso, parsed.result.jobId],
      );
      if (!completedJob.rows[0]) {
        throw new CatalogConflictError(
          "The exact export job is no longer queued for completion.",
        );
      }
      const completedClip = await this.database.query<DbRow>(
        `UPDATE clip_candidates
         SET export_status = 'complete', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3
           AND export_status IN ('queued', 'processing')
         RETURNING version`,
        [nowIso, parsed.result.clipId, parsed.result.projectId],
      );
      if (!completedClip.rows[0]) {
        throw new CatalogConflictError(
          "The exact logged clip is no longer queued for completion.",
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_completed', $2, $3, $4, $5)`,
        [
          parsed.result.projectId,
          parsed.result.clipId,
          completedClip.rows[0].version,
          JSON.stringify({
            clipId: parsed.result.clipId,
            exportRequestId: parsed.result.requestId,
            jobId: parsed.result.jobId,
            resultId,
            packageIdentity: parsed.result.artifacts[0]!.packageIdentity,
            artifacts: parsed.result.artifacts.map(
              ({ role, byteSize, contentSha256 }) => ({
                role,
                byteSize,
                contentSha256,
              }),
            ),
          }),
          nowIso,
        ],
      );
      reconciled = inserted.rows[0];
    });

    if (!reconciled) {
      throw new CatalogConflictError("Export result reconciliation failed.");
    }
    return mapLoggedExportSuccess(reconciled);
  }

  async reconcileLoggedExportFailure(
    actor: AuthenticatedActor,
    input: ReconcileLoggedExportFailureRequest,
  ): Promise<LoggedExportFailure> {
    await this.requireRegistered(actor);
    const parsed = ReconcileLoggedExportFailureRequestSchema.parse(input);
    const nowIso = this.now().toISOString();
    const resultFingerprint = sha256Fingerprint(parsed.result);
    let reconciled: DbRow | undefined;

    await this.transaction(async () => {
      const worker = await this.database.query<DbRow>(
        "SELECT * FROM registered_export_workers WHERE id = $1 FOR UPDATE",
        [parsed.workerId],
      );
      const workerRow = worker.rows[0];
      if (!workerRow || String(workerRow.owner_user_id) !== actor.userId) {
        throw new AuthorizationError(
          "This accepted delivery belongs to another worker owner.",
        );
      }

      const deliveryResult = await this.database.query<DbRow>(
        `${loggedExportDeliverySelect}
         JOIN project_members failure_members
           ON failure_members.project_id = er.project_id
          AND failure_members.user_id = $1
         WHERE d.id = $2 AND d.worker_id = $3 AND d.worker_epoch = $4
           AND d.generation = $5 AND d.reservation_token = $6
           AND d.accepted_at IS NOT NULL
         FOR UPDATE OF d, er, j, delivery_clip`,
        [
          actor.userId,
          parsed.deliveryId,
          parsed.workerId,
          parsed.workerEpoch,
          parsed.generation,
          parsed.reservationToken,
        ],
      );
      const delivery = deliveryResult.rows[0];
      if (!delivery) {
        throw new CatalogConflictError(
          "The accepted export delivery is stale, mismatched, or unauthorized.",
        );
      }
      assertLoggedExportFailureMatchesRequest(delivery, parsed.result);

      const cancelIntent = await this.database.query<DbRow>(
        "SELECT export_request_id FROM logged_export_cancel_intents WHERE export_request_id = $1 FOR UPDATE",
        [delivery.id],
      );

      const existingSuccess = await this.database.query<DbRow>(
        `SELECT id FROM logged_export_success_results
         WHERE export_request_id = $1 OR delivery_id = $2
         FOR UPDATE`,
        [delivery.id, parsed.deliveryId],
      );
      if (existingSuccess.rows[0]) {
        throw new CatalogConflictError(
          "An immutable success is already reconciled for this export.",
        );
      }
      const existingCanceled = await this.database.query<DbRow>(
        `SELECT id FROM logged_export_canceled_results
         WHERE export_request_id = $1 OR delivery_id = $2
         FOR UPDATE`,
        [delivery.id, parsed.deliveryId],
      );
      if (existingCanceled.rows[0]) {
        throw new CatalogConflictError(
          "An immutable cancellation is already reconciled for this export.",
        );
      }

      const existingFailure = await this.database.query<DbRow>(
        `SELECT * FROM logged_export_failure_results
         WHERE export_request_id = $1 OR delivery_id = $2
         FOR UPDATE`,
        [delivery.id, parsed.deliveryId],
      );
      const existing = existingFailure.rows[0];
      if (existing) {
        const mapped = mapLoggedExportFailure(existing);
        if (
          String(existing.export_request_id) !== String(delivery.id) ||
          String(existing.delivery_id) !== parsed.deliveryId ||
          String(existing.result_fingerprint) !== resultFingerprint ||
          canonicalJson(mapped.result) !== canonicalJson(parsed.result)
        ) {
          throw new CatalogConflictError(
            "A different immutable failure is already reconciled for this export.",
          );
        }
        if (
          String(delivery.state) !== "failed" ||
          String(delivery.delivery_clip_export_status) !== "failed"
        ) {
          throw new CatalogConflictError(
            "The existing export failure has inconsistent authoritative state.",
          );
        }
        reconciled = existing;
        return;
      }

      if (cancelIntent.rows[0]) {
        throw new CatalogConflictError(
          "Cancellation intent won before the first terminal failure.",
        );
      }

      if (
        !["queued", "processing"].includes(String(delivery.state)) ||
        !["queued", "processing"].includes(
          String(delivery.delivery_clip_export_status),
        )
      ) {
        throw new CatalogConflictError(
          "Only the exact queued accepted export can record its first failure.",
        );
      }

      const resultId = randomUUID();
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO logged_export_failure_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, result_schema_version, result_json,
            result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)
         RETURNING *`,
        [
          resultId,
          delivery.id,
          parsed.deliveryId,
          parsed.generation,
          parsed.workerId,
          parsed.workerEpoch,
          JSON.stringify(parsed.result),
          resultFingerprint,
          nowIso,
        ],
      );
      const failedJob = await this.database.query<DbRow>(
        `UPDATE jobs SET state = 'failed', updated_at = $1
         WHERE id = $2 AND kind = 'export' AND state IN ('queued', 'processing')
         RETURNING id`,
        [nowIso, parsed.result.jobId],
      );
      if (!failedJob.rows[0]) {
        throw new CatalogConflictError(
          "The exact export job is no longer queued for failure reconciliation.",
        );
      }
      const failedClip = await this.database.query<DbRow>(
        `UPDATE clip_candidates
         SET export_status = 'failed', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3
           AND export_status IN ('queued', 'processing')
         RETURNING version`,
        [nowIso, parsed.result.clipId, parsed.result.projectId],
      );
      if (!failedClip.rows[0]) {
        throw new CatalogConflictError(
          "The exact logged clip is no longer queued for failure reconciliation.",
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_failed', $2, $3, $4, $5)`,
        [
          parsed.result.projectId,
          parsed.result.clipId,
          failedClip.rows[0].version,
          JSON.stringify({
            clipId: parsed.result.clipId,
            exportRequestId: parsed.result.requestId,
            jobId: parsed.result.jobId,
            failureResultId: resultId,
            error: parsed.result.error,
            attempt: parsed.result.attempt,
            sourceCleanup: parsed.result.sourceCleanup,
          }),
          nowIso,
        ],
      );
      reconciled = inserted.rows[0];
    });

    if (!reconciled) {
      throw new CatalogConflictError("Export failure reconciliation failed.");
    }
    return mapLoggedExportFailure(reconciled);
  }

  async compatibleExportWorkerAvailability(
    actor: AuthenticatedActor,
    projectId: string,
    input: ExportWorkerCompatibilityRequest,
  ): Promise<{ compatible: boolean; availableWorkerCount: number }> {
    await this.authorize(actor, projectId, "read");
    const parsed = ExportWorkerCompatibilityRequestSchema.parse(input);
    const rows = await this.database.query<DbRow>(
      `SELECT w.* FROM registered_export_workers w
       JOIN project_members members
         ON members.user_id = w.owner_user_id AND members.project_id = $1
       WHERE w.revoked_at IS NULL AND w.expires_at > $2`,
      [projectId, this.now().toISOString()],
    );
    const availableWorkerCount = rows.rows
      .map(mapRegisteredExportWorker)
      .filter(
        (worker) =>
          worker.capability.profileId === parsed.capability.profileId &&
          worker.capability.profileVersion ===
            parsed.capability.profileVersion &&
          worker.capability.fingerprint === parsed.capability.fingerprint &&
          worker.capability.validation === "validated" &&
          worker.installedCapabilities.availableRendererIds.includes(
            parsed.rendererId,
          ),
      ).length;
    return ExportWorkerAvailabilityResponseSchema.parse({
      compatible: availableWorkerCount > 0,
      availableWorkerCount,
    });
  }

  private assertRegisterableExportWorkerAdvertisement(
    input: RegisterExportWorkerRequest,
  ): void {
    if (!isRegisterableExportWorkerCapability(input.capability)) {
      throw new CatalogValidationError(
        "The worker capability profile is not an explicitly supported registered profile.",
      );
    }
    if (
      input.advertisementFingerprint !==
      exportWorkerAdvertisementFingerprint({
        capability: input.capability,
        installedCapabilities: input.installedCapabilities,
      })
    ) {
      throw new CatalogValidationError(
        "The worker installed capability summary does not match its advertisement fingerprint.",
      );
    }
  }

  async updatePreferredLanguage(
    actor: AuthenticatedActor,
    input: UpdatePreferredLanguageRequest,
  ): Promise<User> {
    await this.requireRegistered(actor);
    const now = this.now().toISOString();
    const result = await this.database.query<DbRow>(
      `UPDATE users
       SET preferred_language = $1, updated_at = $2
       WHERE id = $3 AND external_subject = $4
       RETURNING id, external_subject, display_name, preferred_language,
                 created_at, updated_at`,
      [input.preferredLanguage, now, actor.userId, actor.externalSubject],
    );
    return mapUser(result.rows[0]);
  }

  async listPersonalExportPresets(
    actor: AuthenticatedActor,
  ): Promise<PersonalExportPresetCatalog> {
    await this.requireRegistered(actor);
    const [presets, personalDefault] = await Promise.all([
      this.listExportPresetEntries("personal", actor.userId),
      this.getExportPresetDefault("personal", actor.userId),
    ]);
    return PersonalExportPresetCatalogSchema.parse({
      presets,
      ...(personalDefault ? { default: personalDefault } : {}),
    });
  }

  async listProjectExportPresets(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectExportPresetCatalog> {
    await this.authorize(actor, projectId, "read");
    const [projectPresets, projectDefault, personalPresets, personalDefault] =
      await Promise.all([
        this.listExportPresetEntries("project", projectId),
        this.getExportPresetDefault("project", projectId),
        this.listExportPresetEntries("personal", actor.userId),
        this.getExportPresetDefault("personal", actor.userId),
      ]);
    return ProjectExportPresetCatalogSchema.parse({
      projectPresets,
      ...(projectDefault ? { projectDefault } : {}),
      personalPresets,
      ...(personalDefault ? { personalDefault } : {}),
    });
  }

  async getPersonalExportPresetDefault(
    actor: AuthenticatedActor,
  ): Promise<ExportPresetDefault | undefined> {
    await this.requireRegistered(actor);
    return this.getExportPresetDefault("personal", actor.userId);
  }

  async getProjectExportPresetDefault(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ExportPresetDefault | undefined> {
    await this.authorize(actor, projectId, "read");
    return this.getExportPresetDefault("project", projectId);
  }

  async previewPersonalExportSettings(
    actor: AuthenticatedActor,
    input: ExportSettingsPreviewRequest,
  ): Promise<ExportSettingsPreview> {
    await this.requireRegistered(actor);
    return this.resolveCatalogExportSettings(
      actor,
      "export_only",
      undefined,
      input,
      this.now().toISOString(),
    );
  }

  async previewProjectExportSettings(
    actor: AuthenticatedActor,
    projectId: string,
    input: ExportSettingsPreviewRequest,
  ): Promise<ExportSettingsPreview> {
    await this.authorize(actor, projectId, "read");
    return this.resolveCatalogExportSettings(
      actor,
      "logged",
      projectId,
      input,
      this.now().toISOString(),
    );
  }

  async createPersonalExportPreset(
    actor: AuthenticatedActor,
    input: CreateExportPresetRequest,
  ): Promise<ExportPresetCatalogEntry> {
    await this.requireRegistered(actor);
    return this.createExportPreset(actor, "personal", actor.userId, input);
  }

  async createProjectExportPreset(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateExportPresetRequest,
  ): Promise<ExportPresetCatalogEntry> {
    await this.authorize(actor, projectId, "write");
    return this.createExportPreset(actor, "project", projectId, input);
  }

  async revisePersonalExportPreset(
    actor: AuthenticatedActor,
    input: ReviseExportPresetRequest,
  ): Promise<ExportPresetCatalogEntry> {
    await this.requireRegistered(actor);
    return this.reviseExportPreset(actor, "personal", actor.userId, input);
  }

  async reviseProjectExportPreset(
    actor: AuthenticatedActor,
    projectId: string,
    input: ReviseExportPresetRequest,
  ): Promise<ExportPresetCatalogEntry> {
    await this.authorize(actor, projectId, "write");
    return this.reviseExportPreset(actor, "project", projectId, input);
  }

  async setPersonalExportPresetDefault(
    actor: AuthenticatedActor,
    input: SetExportPresetDefaultRequest,
  ): Promise<ExportPresetDefault> {
    await this.requireRegistered(actor);
    return this.setExportPresetDefault(actor, "personal", actor.userId, input);
  }

  async setProjectExportPresetDefault(
    actor: AuthenticatedActor,
    projectId: string,
    input: SetExportPresetDefaultRequest,
  ): Promise<ExportPresetDefault> {
    await this.authorize(actor, projectId, "write");
    return this.setExportPresetDefault(actor, "project", projectId, input);
  }

  async createProject(
    actor: AuthenticatedActor,
    input: { name: string; description?: string },
  ): Promise<Project> {
    await this.requireRegistered(actor);
    const id = randomUUID();
    const now = this.now().toISOString();
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO projects
           (id, name, description, version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, $5, $5)`,
        [
          id,
          input.name.trim(),
          input.description?.trim() ?? "",
          actor.userId,
          now,
        ],
      );
      await this.database.query(
        `INSERT INTO project_members
           (project_id, user_id, role, version, created_at, updated_at)
         VALUES ($1, $2, 'owner', 1, $3, $3)`,
        [id, actor.userId, now],
      );
    });
    return this.getProject(actor, id);
  }

  async listProjects(actor: AuthenticatedActor): Promise<Project[]> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT p.id, p.name, p.description, p.version, p.created_at, p.updated_at
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = $1
       ORDER BY p.updated_at DESC`,
      [actor.userId],
    );
    return result.rows.map(mapProject);
  }

  async requestDerivedTranslation(
    actor: AuthenticatedActor,
    projectId: string,
    input: RequestDerivedTranslation,
  ): Promise<DerivedTranslationJob> {
    await this.authorize(actor, projectId, "write");
    const request = RequestDerivedTranslationSchema.parse(input);
    if (request.identity.projectId !== projectId) {
      throw new CatalogValidationError(
        "Derived translation project identity does not match the route.",
      );
    }
    await this.assertDerivedTranslationIdentity(request.identity);
    const now = this.now().toISOString();
    let lineageId: string = randomUUID();
    await this.transaction(async () => {
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO transcript_translation_lineages
           (id, project_id, video_id, base_transcript_version_id,
            original_track_id, original_content_sha256, target_language,
            target_primary_language, provider, model,
            normalization_schema_version, idempotency_key, created_by,
            created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          lineageId,
          projectId,
          request.identity.catalogVideoId,
          request.identity.baseTranscriptVersionId,
          request.identity.originalTrackId,
          request.identity.originalContentSha256,
          request.identity.targetLanguage,
          primaryLanguage(request.identity.targetLanguage),
          request.identity.provider,
          request.identity.model ?? null,
          request.identity.normalizationSchemaVersion,
          request.idempotencyKey,
          actor.userId,
          now,
        ],
      );
      if (!inserted.rows[0]) {
        const existing = await this.findDerivedTranslationLineage(
          request.identity,
        );
        if (!existing) {
          throw new CatalogConflictError(
            "The translation idempotency key belongs to different work.",
          );
        }
        lineageId = String(existing.id);
      }
      await this.database.query(
        `INSERT INTO transcript_translation_jobs
           (id, lineage_id, state, attempt, requested_by, created_at, updated_at)
         VALUES ($1, $2,
                 CASE WHEN (SELECT active_version_id FROM transcript_translation_lineages WHERE id = $2) IS NULL
                   THEN 'queued' ELSE 'complete' END,
                 0, $3, $4, $4)
         ON CONFLICT (lineage_id) DO NOTHING`,
        [randomUUID(), lineageId, actor.userId, now],
      );
    });
    const result = await this.database.query<DbRow>(
      `SELECT * FROM transcript_translation_jobs WHERE lineage_id = $1`,
      [lineageId],
    );
    return mapDerivedTranslationJob(result.rows[0]);
  }

  async publishDerivedTranslation(
    actor: AuthenticatedActor,
    projectId: string,
    input: PublishDerivedTranslationRequest,
  ): Promise<DerivedTranslation> {
    const request = PublishDerivedTranslationRequestSchema.parse(input);
    const job = await this.requestDerivedTranslation(actor, projectId, {
      identity: request.identity,
      idempotencyKey: request.idempotencyKey,
    });
    const existing = await this.getDerivedTranslation(
      actor,
      projectId,
      request.identity,
    );
    if (existing) return existing;
    const lineage = await this.findDerivedTranslationLineage(request.identity);
    if (!lineage || String(lineage.id) !== job.lineageId) {
      throw new CatalogConflictError("Derived translation lineage changed.");
    }
    const transcript = request.transcript;
    const version = 1;
    const translationVersionId = randomUUID();
    const createdAt = this.now().toISOString();
    const prefix = `projects/${projectId}/videos/${request.identity.catalogVideoId}/transcripts/${request.identity.baseTranscriptVersionId}/translations/${primaryLanguage(request.identity.targetLanguage)}/jobs/${job.id}/${translationVersionId}`;
    const normalizedBytes = new TextEncoder().encode(
      JSON.stringify(transcript),
    );
    const normalizedObject = await this.store.put({
      key: `${prefix}/translated.normalized.json`,
      bytes: normalizedBytes,
      contentType: "application/json",
      sha256: sha256(normalizedBytes),
    });
    const normalizedArtifact = {
      type: "translated-normalized" as const,
      objectKey: normalizedObject.key,
      objectVersionId: normalizedObject.versionId,
      byteSize: normalizedObject.bytes.byteLength,
      sha256: normalizedObject.sha256,
    };
    const manifest = DerivedTranslationManifestSchema.parse({
      schemaVersion: 1,
      id: translationVersionId,
      lineageId: lineage.id,
      version,
      identity: request.identity,
      translatedTrackId: transcript.track.id,
      translatedTrackVersion: transcript.track.version,
      sourceTrackId: transcript.track.sourceTrackId,
      timingPrecision: transcript.track.timingPrecision,
      idempotencyKey: request.idempotencyKey,
      createdBy: actor.userId,
      createdAt,
      artifacts: [normalizedArtifact],
    });
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestObject = await this.store.put({
      key: `${prefix}/manifest.json`,
      bytes: manifestBytes,
      contentType: "application/json",
      sha256: sha256(manifestBytes),
    });
    await this.transaction(async () => {
      const locked = await this.database.query<DbRow>(
        `SELECT active_version_id FROM transcript_translation_lineages
         WHERE id = $1 FOR UPDATE`,
        [lineage.id],
      );
      if (locked.rows[0]?.active_version_id) {
        await this.database.query(
          `UPDATE transcript_translation_jobs
           SET state = 'superseded', updated_at = $1 WHERE lineage_id = $2`,
          [createdAt, lineage.id],
        );
        return;
      }
      await this.database.query(
        `INSERT INTO transcript_translation_versions
           (id, lineage_id, version, translated_track_id,
            translated_track_version, source_track_id, language,
            timing_precision, manifest_object_key,
            manifest_object_version_id, manifest_sha256, status,
            created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'active', $12, $13)`,
        [
          translationVersionId,
          lineage.id,
          version,
          transcript.track.id,
          transcript.track.version,
          transcript.track.sourceTrackId,
          transcript.track.language,
          transcript.track.timingPrecision,
          manifestObject.key,
          manifestObject.versionId,
          manifestObject.sha256,
          actor.userId,
          createdAt,
        ],
      );
      for (const artifact of [
        normalizedArtifact,
        {
          type: "manifest" as const,
          objectKey: manifestObject.key,
          objectVersionId: manifestObject.versionId,
          byteSize: manifestObject.bytes.byteLength,
          sha256: manifestObject.sha256,
        },
      ]) {
        await this.database.query(
          `INSERT INTO transcript_translation_artifacts
             (translation_version_id, artifact_type, object_key,
              object_version_id, byte_size, sha256)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            translationVersionId,
            artifact.type,
            artifact.objectKey,
            artifact.objectVersionId,
            artifact.byteSize,
            artifact.sha256,
          ],
        );
      }
      await this.database.query(
        `UPDATE transcript_translation_lineages SET active_version_id = $1
         WHERE id = $2`,
        [translationVersionId, lineage.id],
      );
      await this.database.query(
        `UPDATE transcript_translation_jobs
         SET state = 'complete', updated_at = $1 WHERE lineage_id = $2`,
        [createdAt, lineage.id],
      );
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'transcript_translation.finalized', $2, 1, $3, $4)`,
        [
          projectId,
          translationVersionId,
          JSON.stringify({
            translationVersionId,
            baseTranscriptVersionId: request.identity.baseTranscriptVersionId,
            targetLanguage: request.identity.targetLanguage,
          }),
          createdAt,
        ],
      );
    });
    const published = await this.getDerivedTranslation(
      actor,
      projectId,
      request.identity,
    );
    if (!published) {
      throw new TranscriptIntegrityError(
        "Finalized derived translation could not be verified.",
      );
    }
    return published;
  }

  async getDerivedTranslation(
    actor: AuthenticatedActor,
    projectId: string,
    identity: DerivedTranslationIdentity,
  ): Promise<DerivedTranslation | undefined> {
    await this.authorize(actor, projectId, "read");
    const parsedIdentity = DerivedTranslationIdentitySchema.parse(identity);
    if (parsedIdentity.projectId !== projectId) {
      throw new CatalogValidationError(
        "Derived translation project identity does not match the route.",
      );
    }
    const lineage = await this.findDerivedTranslationLineage(parsedIdentity);
    if (!lineage?.active_version_id) return undefined;
    const versionResult = await this.database.query<DbRow>(
      `SELECT * FROM transcript_translation_versions
       WHERE id = $1 AND lineage_id = $2 AND status = 'active'`,
      [lineage.active_version_id, lineage.id],
    );
    const version = versionResult.rows[0];
    if (!version) return undefined;
    const artifactResult = await this.database.query<DbRow>(
      `SELECT * FROM transcript_translation_artifacts
       WHERE translation_version_id = $1`,
      [version.id],
    );
    const artifacts = new Map(
      artifactResult.rows.map((row) => [String(row.artifact_type), row]),
    );
    const manifestRow = artifacts.get("manifest");
    const normalizedRow = artifacts.get("translated-normalized");
    if (!manifestRow || !normalizedRow) return undefined;
    const [manifestObject, normalizedObject] = await Promise.all([
      this.store.get(
        String(manifestRow.object_key),
        String(manifestRow.object_version_id),
      ),
      this.store.get(
        String(normalizedRow.object_key),
        String(normalizedRow.object_version_id),
      ),
    ]);
    if (
      !manifestObject ||
      !normalizedObject ||
      sha256(manifestObject.bytes) !== manifestRow.sha256 ||
      sha256(normalizedObject.bytes) !== normalizedRow.sha256
    ) {
      return undefined;
    }
    let manifestValue: unknown;
    let transcriptValue: unknown;
    try {
      manifestValue = JSON.parse(
        new TextDecoder().decode(manifestObject.bytes),
      );
      transcriptValue = JSON.parse(
        new TextDecoder().decode(normalizedObject.bytes),
      );
    } catch {
      return undefined;
    }
    const manifest = DerivedTranslationManifestSchema.safeParse(manifestValue);
    const transcript = NormalizedTranscriptSchema.safeParse(transcriptValue);
    if (!manifest.success || !transcript.success) return undefined;
    if (
      manifest.data.id !== version.id ||
      manifest.data.lineageId !== lineage.id ||
      transcript.data.track.id !== version.translated_track_id ||
      transcript.data.track.version !==
        Number(version.translated_track_version) ||
      transcript.data.track.sourceTrackId !== parsedIdentity.originalTrackId ||
      !languagesEquivalent(
        transcript.data.track.language,
        parsedIdentity.targetLanguage,
      )
    ) {
      return undefined;
    }
    return DerivedTranslationSchema.parse({
      manifest: manifest.data,
      transcript: transcript.data,
    });
  }

  async createClipCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateClipCandidateRequest,
  ): Promise<ClipCandidate> {
    await this.authorize(actor, projectId, "write");
    const user = await this.getCurrentUser(actor);
    const candidateId = randomUUID();
    const now = this.now().toISOString();
    let persistedCandidateId: string = candidateId;
    const evidence = input.languageEvidence;
    const preferredIsDistinct =
      !languagesEquivalent(user.preferredLanguage, "en") &&
      !languagesEquivalent(user.preferredLanguage, evidence.native.language);
    if (
      preferredIsDistinct !== Boolean(evidence.preferred) ||
      (evidence.preferred &&
        !languagesEquivalent(
          evidence.preferred.language,
          user.preferredLanguage,
        ))
    ) {
      throw new CatalogValidationError(
        "Clip evidence does not match the requesting user's snapshotted preference.",
      );
    }
    const displayEvidence = preferredIsDistinct
      ? evidence.preferred
      : languagesEquivalent(user.preferredLanguage, evidence.native.language)
        ? evidence.native
        : evidence.english;
    if (
      !displayEvidence ||
      input.selection.trackId !== displayEvidence.trackId ||
      input.selection.transcriptVersion !== displayEvidence.trackVersion ||
      input.selection.timingPrecision !== displayEvidence.timingPrecision
    ) {
      throw new CatalogValidationError(
        "The selected display track changed. Re-resolve or reselect before logging.",
      );
    }

    await this.transaction(async () => {
      const videoId = randomUUID();
      const videoResult = await this.database.query<DbRow>(
        `INSERT INTO videos
           (id, youtube_video_id, canonical_url, title, channel, source_language,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (youtube_video_id) DO UPDATE
         SET canonical_url = EXCLUDED.canonical_url,
             title = EXCLUDED.title,
             channel = EXCLUDED.channel,
             source_language = COALESCE(EXCLUDED.source_language, videos.source_language),
             updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [
          videoId,
          input.video.youtubeVideoId,
          input.video.canonicalUrl,
          input.video.title,
          input.video.channel ?? null,
          input.video.sourceLanguage ?? null,
          now,
        ],
      );
      const catalogVideoId = String(videoResult.rows[0]!.id);
      await this.database.query(
        `INSERT INTO project_videos
           (project_id, video_id, version, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $3)
         ON CONFLICT (project_id, video_id) DO NOTHING`,
        [projectId, catalogVideoId, now],
      );

      const selection = input.selection;
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO clip_candidates
           (id, project_id, video_id, youtube_video_id, canonical_url,
            video_title, video_channel, source_language, idempotency_key,
            transcript_track_id, transcript_version, first_segment_id,
            last_segment_id, first_token_id, last_token_id,
            transcript_start_ms, transcript_end_ms, export_start_ms,
            export_end_ms, timing_precision, english_text, original_text,
            selection_text, language_evidence_schema_version, notes,
            research_status, export_status, created_by, version, created_at,
            updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 2, $24,
                 'candidate', 'not_requested', $25, 1, $26, $26)
         ON CONFLICT (project_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          candidateId,
          projectId,
          catalogVideoId,
          input.video.youtubeVideoId,
          input.video.canonicalUrl,
          input.video.title,
          input.video.channel ?? null,
          input.video.sourceLanguage ?? null,
          input.idempotencyKey,
          selection.trackId,
          selection.transcriptVersion,
          selection.firstSegmentId,
          selection.lastSegmentId,
          selection.firstTokenId ?? null,
          selection.lastTokenId ?? null,
          selection.transcriptStartMs,
          selection.transcriptEndMs,
          selection.exportStartMs,
          selection.exportEndMs,
          selection.timingPrecision,
          evidence.english.text,
          evidence.native.trackId === evidence.english.trackId
            ? null
            : evidence.native.text,
          selection.text,
          input.notes,
          actor.userId,
          now,
        ],
      );
      const created = Boolean(inserted.rows[0]);
      if (!created) {
        const existing = await this.database.query<DbRow>(
          `SELECT id FROM clip_candidates
           WHERE project_id = $1 AND idempotency_key = $2`,
          [projectId, input.idempotencyKey],
        );
        persistedCandidateId = String(existing.rows[0]!.id);
        return;
      }

      for (const snapshot of [
        evidence.native,
        evidence.english,
        ...(evidence.preferred ? [evidence.preferred] : []),
      ]) {
        await this.database.query(
          `INSERT INTO clip_language_evidence
             (clip_id, role, language, text, track_id, track_version,
              source_track_id, timing_precision)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            candidateId,
            snapshot.role,
            snapshot.language,
            snapshot.text,
            snapshot.trackId,
            snapshot.trackVersion,
            snapshot.sourceTrackId ?? null,
            snapshot.timingPrecision,
          ],
        );
      }

      for (const tagName of uniqueTagNames(input.tags)) {
        const tagResult = await this.database.query<DbRow>(
          `INSERT INTO clip_tags
             (id, project_id, name, normalized_name, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, normalized_name) DO UPDATE
           SET normalized_name = EXCLUDED.normalized_name
           RETURNING id`,
          [randomUUID(), projectId, tagName, normalizeTagName(tagName), now],
        );
        await this.database.query(
          `INSERT INTO clip_candidate_tags (clip_id, tag_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [candidateId, tagResult.rows[0]!.id],
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.created', $2, 1, $3, $4)`,
        [
          projectId,
          candidateId,
          JSON.stringify({
            clipId: candidateId,
            exportStatus: "not_requested",
            languageEvidence: evidence,
          }),
          now,
        ],
      );
    });

    return this.getClipCandidate(actor, projectId, persistedCandidateId);
  }

  async listClipCandidates(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ClipCandidate[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `${clipCandidateSelect}
       WHERE c.project_id = $1
       ORDER BY c.created_at DESC, c.id
       LIMIT 500`,
      [projectId],
    );
    return Promise.all(
      result.rows.map(async (row) =>
        mapClipCandidate(
          row,
          await this.loadClipTags(String(row.id)),
          await this.loadClipLanguageEvidence(String(row.id)),
        ),
      ),
    );
  }

  async exportClipCandidatesCsv(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<string> {
    const [project, clips] = await Promise.all([
      this.getProject(actor, projectId),
      this.listClipCandidates(actor, projectId),
    ]);
    const columns = [
      "project_id",
      "project_name",
      "clip_id",
      "research_status",
      "export_status",
      "youtube_video_id",
      "video_title",
      "canonical_url",
      "source_language",
      "transcript_track_id",
      "transcript_version",
      "transcript_start_ms",
      "transcript_end_ms",
      "export_start_ms",
      "export_end_ms",
      "timing_precision",
      "english_text",
      "original_text",
      "preferred_language",
      "preferred_text",
      "notes",
      "tags",
      "created_at",
      "updated_at",
    ];
    const rows = clips.map((clip) => [
      project.id,
      project.name,
      clip.id,
      clip.researchStatus,
      clip.exportStatus,
      clip.video.youtubeVideoId,
      clip.video.title,
      clip.video.canonicalUrl,
      clip.video.sourceLanguage ?? "",
      clip.selection.trackId,
      clip.selection.transcriptVersion,
      clip.selection.transcriptStartMs,
      clip.selection.transcriptEndMs,
      clip.selection.exportStartMs,
      clip.selection.exportEndMs,
      clip.selection.timingPrecision,
      clip.englishText,
      clip.originalText ?? "",
      clip.languageEvidence.schemaVersion === 2
        ? (clip.languageEvidence.preferred?.language ?? "")
        : "",
      clip.languageEvidence.schemaVersion === 2
        ? (clip.languageEvidence.preferred?.text ?? "")
        : "",
      clip.notes,
      clip.tags.join(" | "),
      clip.createdAt,
      clip.updatedAt,
    ]);
    return [columns, ...rows].map(csvRow).join("\r\n").concat("\r\n");
  }

  async getClipCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
  ): Promise<ClipCandidate> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `${clipCandidateSelect}
       WHERE c.project_id = $1 AND c.id = $2`,
      [projectId, clipId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Clip candidate not found.");
    return mapClipCandidate(
      row,
      await this.loadClipTags(clipId),
      await this.loadClipLanguageEvidence(clipId),
    );
  }

  async updateClipCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: UpdateClipCandidateRequest,
  ): Promise<ClipCandidate> {
    await this.authorize(actor, projectId, "write");
    const now = this.now().toISOString();
    await this.transaction(async () => {
      const updated = await this.database.query<DbRow>(
        `UPDATE clip_candidates
         SET notes = $1, version = version + 1, updated_at = $2
         WHERE id = $3 AND project_id = $4 AND version = $5
         RETURNING id, version`,
        [input.notes, now, clipId, projectId, input.expectedVersion],
      );
      if (!updated.rows[0]) {
        const exists = await this.database.query(
          "SELECT 1 FROM clip_candidates WHERE id = $1 AND project_id = $2",
          [clipId, projectId],
        );
        if (!exists.rows[0])
          throw new CatalogNotFoundError("Clip candidate not found.");
        throw new CatalogConflictError(
          "This clip changed elsewhere. Reload it before saving edits.",
        );
      }
      await this.database.query(
        "DELETE FROM clip_candidate_tags WHERE clip_id = $1",
        [clipId],
      );
      for (const tagName of uniqueTagNames(input.tags)) {
        const tagResult = await this.database.query<DbRow>(
          `INSERT INTO clip_tags
             (id, project_id, name, normalized_name, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, normalized_name) DO UPDATE
           SET normalized_name = EXCLUDED.normalized_name
           RETURNING id`,
          [randomUUID(), projectId, tagName, normalizeTagName(tagName), now],
        );
        await this.database.query(
          `INSERT INTO clip_candidate_tags (clip_id, tag_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [clipId, tagResult.rows[0]!.id],
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.updated', $2, $3, $4, $5)`,
        [
          projectId,
          clipId,
          updated.rows[0]!.version,
          JSON.stringify({ clipId, fields: ["notes", "tags"] }),
          now,
        ],
      );
    });
    return this.getClipCandidate(actor, projectId, clipId);
  }

  async listProjectClipTags(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<string[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<{ name: string }>(
      `SELECT name FROM clip_tags
       WHERE project_id = $1
       ORDER BY normalized_name, id
       LIMIT 500`,
      [projectId],
    );
    return result.rows.map((row) => row.name);
  }

  async createClipExport(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: CreateClipExportRequest,
  ): Promise<ExportRequest> {
    await this.authorize(actor, projectId, "write");
    const clip = await this.getClipCandidate(actor, projectId, clipId);
    const idempotencyKey = `clip-export:${clipId}:${input.idempotencyKey}`;
    const existing = await this.database.query<DbRow>(
      `${loggedExportRequestSelect}
       WHERE j.idempotency_key = $1 AND er.project_id = $2`,
      [idempotencyKey, projectId],
    );
    if (existing.rows[0]) return mapLoggedExportRequest(existing.rows[0]);

    const requestId = randomUUID();
    const jobId = randomUUID();
    const now = this.now().toISOString();
    await this.transaction(async () => {
      const preview = input.preset
        ? resolveExportSettings({
            context: "logged",
            sourceLanguageClass: input.sourceLanguageClass,
            legacyPreset: input.preset,
            resolvedAt: now,
          })
        : await this.resolveCatalogExportSettings(
            actor,
            "logged",
            projectId,
            {
              sourceLanguageClass: input.sourceLanguageClass,
              selection: input.settingsSelection!,
            },
            now,
          );
      if (
        input.expectedResolutionFingerprint &&
        preview.snapshot.resolutionFingerprint !==
          input.expectedResolutionFingerprint
      ) {
        throw new ExportSettingsStaleError(
          "Export settings changed after preview. Resolve them again before exporting.",
        );
      }
      if (!input.preset && preview.issues.length) {
        throw new ExportSettingsCapabilityError(
          "The current worker cannot render the resolved export settings.",
          preview.issues,
        );
      }
      const preset = resolvedPresetForCompatibility(preview.snapshot);
      const payload = {
        exportRequestId: requestId,
        mode: "logged",
        clipId,
        video: clip.video,
        selection: clip.selection,
        sourceLanguageClass: input.sourceLanguageClass,
        ...(input.subtitleTracks
          ? { subtitleTracks: input.subtitleTracks }
          : {}),
        preset,
        resolvedSettingsSnapshot: preview.snapshot,
      };
      await this.database.query(
        `INSERT INTO jobs
           (id, project_id, kind, state, idempotency_key, attempt, payload,
            created_at, updated_at)
         VALUES ($1, $2, 'export', 'queued', $3, 0, $4, $5, $5)`,
        [jobId, projectId, idempotencyKey, JSON.stringify(payload), now],
      );
      await this.database.query(
        `INSERT INTO export_requests
            (id, job_id, clip_id, project_id, mode, video_snapshot,
            selection_snapshot, source_language_class, subtitle_tracks_snapshot, preset_snapshot,
            resolved_settings_snapshot, requested_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'logged', $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [
          requestId,
          jobId,
          clipId,
          projectId,
          JSON.stringify(clip.video),
          JSON.stringify(clip.selection),
          input.sourceLanguageClass,
          input.subtitleTracks ? JSON.stringify(input.subtitleTracks) : null,
          JSON.stringify(preset),
          JSON.stringify(preview.snapshot),
          actor.userId,
          now,
        ],
      );
      await this.database.query(
        `UPDATE clip_candidates
         SET export_status = 'queued', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3`,
        [now, clipId, projectId],
      );
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_queued', $2,
                 (SELECT version FROM clip_candidates WHERE id = $2), $3, $4)`,
        [
          projectId,
          clipId,
          JSON.stringify({ clipId, exportRequestId: requestId, jobId }),
          now,
        ],
      );
    });
    return this.getLoggedExportRequest(actor, projectId, requestId);
  }

  async retryLoggedExport(
    actor: AuthenticatedActor,
    projectId: string,
    parentRequestId: string,
    input: RetryLoggedExportRequest,
  ): Promise<RetryLoggedExportResponse> {
    await this.requireRegistered(actor);
    const parsed = RetryLoggedExportRequestSchema.parse(input);
    const now = this.now().toISOString();
    let retried: DbRow | undefined;

    await this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT members.role
         FROM projects project
         JOIN project_members members
           ON members.project_id = project.id AND members.user_id = $1
         WHERE project.id = $2
         FOR UPDATE OF project, members`,
        [actor.userId, projectId],
      );
      requirePermission(membership.rows[0]?.role, "write");

      const parentResult = await this.database.query<DbRow>(
        `SELECT er.*, j.state, j.payload AS retry_parent_job_payload,
                retry_clip.export_status AS retry_clip_export_status,
                failure.id AS retry_failure_id,
                failure.result_json AS retry_failure_result_json,
                failure.delivery_generation AS retry_failure_generation,
                failure.worker_id AS retry_failure_worker_id,
                failure.worker_epoch AS retry_failure_worker_epoch,
                delivery.id AS retry_delivery_id,
                delivery.generation AS retry_delivery_generation,
                delivery.worker_id AS retry_delivery_worker_id,
                delivery.worker_epoch AS retry_delivery_worker_epoch,
                delivery.accepted_at AS retry_delivery_accepted_at,
                success.id AS retry_success_id
         FROM export_requests er
         JOIN jobs j ON j.id = er.job_id
         JOIN clip_candidates retry_clip ON retry_clip.id = er.clip_id
         JOIN logged_export_failure_results failure
           ON failure.export_request_id = er.id
         JOIN logged_export_deliveries delivery
           ON delivery.id = failure.delivery_id
          AND delivery.export_request_id = er.id
         LEFT JOIN logged_export_success_results success
           ON success.export_request_id = er.id
         WHERE er.id = $1 AND er.project_id = $2
         FOR UPDATE OF er, j, retry_clip, failure, delivery`,
        [parentRequestId, projectId],
      );
      const parentRow = parentResult.rows[0];
      if (!parentRow) {
        throw new CatalogConflictError(
          "Only an exact terminal failed logged export can be retried.",
        );
      }
      const parent = mapLoggedExportRequest(parentRow);
      assertLoggedExportRetryParentEvidence(parentRow, parent);

      const existingCommand = await this.database.query<DbRow>(
        `${loggedExportRequestSelect}
         WHERE er.project_id = $1 AND er.retry_idempotency_key = $2
         FOR UPDATE OF er, j`,
        [projectId, parsed.idempotencyKey],
      );
      if (existingCommand.rows[0]) {
        if (
          String(existingCommand.rows[0].retry_of_request_id) !==
          parentRequestId
        ) {
          throw new CatalogIdempotencyConflictError(
            "This retry command identity already belongs to another export request.",
          );
        }
        retried = existingCommand.rows[0];
        return;
      }

      const existingChild = await this.database.query<DbRow>(
        `${loggedExportRequestSelect}
         WHERE er.retry_of_request_id = $1
         FOR UPDATE OF er, j`,
        [parentRequestId],
      );
      if (existingChild.rows[0]) {
        throw new CatalogConflictError(
          "This failed export already has a retry child. Retry the newest failed child instead of branching the lineage.",
        );
      }
      assertRetryableLoggedExportParent(parentRow);

      const requestId = randomUUID();
      const jobId = randomUUID();
      const retryOrdinal = Number(parentRow.retry_ordinal) + 1;
      if (!Number.isSafeInteger(retryOrdinal) || retryOrdinal <= 0) {
        throw new CatalogConflictError("Export retry lineage is invalid.");
      }
      const payload = {
        exportRequestId: requestId,
        mode: "logged",
        clipId: parent.clipId!,
        video: parent.video,
        selection: parent.selection,
        sourceLanguageClass: parent.sourceLanguageClass,
        ...(parent.subtitleTracks
          ? { subtitleTracks: parent.subtitleTracks }
          : {}),
        preset: parent.preset,
        resolvedSettingsSnapshot: parent.resolvedSettingsSnapshot!,
        retryOfRequestId: parent.id,
        retryOrdinal,
      };
      const jobIdempotencyKey = `logged-export-retry:${sha256Fingerprint({
        projectId,
        idempotencyKey: parsed.idempotencyKey,
      })}`;
      const insertedJob = await this.database.query<{ id: string }>(
        `INSERT INTO jobs
           (id, project_id, kind, state, idempotency_key, attempt, payload,
            created_at, updated_at)
         VALUES ($1, $2, 'export', 'queued', $3, 0, $4, $5, $5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [jobId, projectId, jobIdempotencyKey, JSON.stringify(payload), now],
      );
      if (!insertedJob.rows[0]) {
        const raced = await this.database.query<DbRow>(
          `${loggedExportRequestSelect}
           WHERE er.project_id = $1 AND er.retry_idempotency_key = $2
           FOR UPDATE OF er, j`,
          [projectId, parsed.idempotencyKey],
        );
        if (
          raced.rows[0] &&
          String(raced.rows[0].retry_of_request_id) === parentRequestId
        ) {
          retried = raced.rows[0];
          return;
        }
        throw new CatalogIdempotencyConflictError(
          "This retry command identity already belongs to another export request.",
        );
      }
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO export_requests
           (id, job_id, clip_id, project_id, mode, video_snapshot,
            selection_snapshot, source_language_class,
            subtitle_tracks_snapshot, preset_snapshot,
            resolved_settings_snapshot, requested_by, retry_of_request_id,
            retry_ordinal, retry_idempotency_key, created_at, updated_at)
         SELECT $1, $2, parent.clip_id, parent.project_id, parent.mode,
                parent.video_snapshot, parent.selection_snapshot,
                parent.source_language_class, parent.subtitle_tracks_snapshot,
                parent.preset_snapshot, parent.resolved_settings_snapshot,
                $3, parent.id, $4, $5, $6, $6
         FROM export_requests parent
         WHERE parent.id = $7
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          requestId,
          jobId,
          actor.userId,
          retryOrdinal,
          parsed.idempotencyKey,
          now,
          parent.id,
        ],
      );
      if (!inserted.rows[0]) {
        throw new CatalogConflictError(
          "This failed export already has a divergent retry child.",
        );
      }
      const queuedClip = await this.database.query<{ version: number }>(
        `UPDATE clip_candidates
         SET export_status = 'queued', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3 AND export_status = 'failed'
         RETURNING version`,
        [now, parent.clipId, projectId],
      );
      if (!queuedClip.rows[0]) {
        throw new CatalogConflictError(
          "The exact failed clip is no longer eligible for retry.",
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_retried', $2, $3, $4, $5)`,
        [
          projectId,
          parent.clipId,
          queuedClip.rows[0].version,
          JSON.stringify({
            clipId: parent.clipId,
            parentExportRequestId: parent.id,
            exportRequestId: requestId,
            jobId,
            retryOrdinal,
          }),
          now,
        ],
      );
      const child = await this.database.query<DbRow>(
        `${loggedExportRequestSelect} WHERE er.id = $1`,
        [requestId],
      );
      retried = child.rows[0];
    });

    if (!retried) {
      throw new CatalogConflictError("Export retry did not persist.");
    }
    return RetryLoggedExportResponseSchema.parse({
      request: mapLoggedExportRequest(retried),
    });
  }

  async getLoggedExportRequest(
    actor: AuthenticatedActor,
    projectId: string,
    requestId: string,
  ): Promise<ExportRequest> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `${loggedExportRequestSelect}
       WHERE er.id = $1 AND er.project_id = $2`,
      [requestId, projectId],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("Export request not found.");
    return mapLoggedExportRequest(result.rows[0]);
  }

  async getProject(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<Project> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT id, name, description, version, created_at, updated_at
       FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!result.rows[0]) throw new CatalogNotFoundError("Project not found.");
    return mapProject(result.rows[0]);
  }

  async addMember(
    actor: AuthenticatedActor,
    projectId: string,
    userId: string,
    role: Exclude<ProjectRole, "owner">,
  ): Promise<void> {
    await this.authorize(actor, projectId, "manage_members");
    const target = await this.database.query(
      "SELECT id FROM users WHERE id = $1",
      [userId],
    );
    if (!target.rows[0]) throw new CatalogNotFoundError("User not found.");
    const now = this.now().toISOString();
    await this.database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, version, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           version = project_members.version + 1,
           updated_at = EXCLUDED.updated_at`,
      [projectId, userId, role, now],
    );
  }

  async addVideo(
    actor: AuthenticatedActor,
    projectId: string,
    input: {
      youtubeVideoId: string;
      canonicalUrl: string;
      title: string;
      channel?: string;
      durationMs?: number;
      sourceLanguage?: string;
    },
  ): Promise<Video> {
    await this.authorize(actor, projectId, "write");
    const existing = await this.database.query<DbRow>(
      "SELECT id FROM videos WHERE youtube_video_id = $1",
      [input.youtubeVideoId],
    );
    const id = String(existing.rows[0]?.id ?? randomUUID());
    const now = this.now().toISOString();
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO videos
           (id, youtube_video_id, canonical_url, title, channel, duration_ms,
            source_language, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (youtube_video_id) DO UPDATE
         SET canonical_url = EXCLUDED.canonical_url,
             title = EXCLUDED.title,
             channel = EXCLUDED.channel,
             duration_ms = EXCLUDED.duration_ms,
             source_language = EXCLUDED.source_language,
             updated_at = EXCLUDED.updated_at`,
        [
          id,
          input.youtubeVideoId,
          input.canonicalUrl,
          input.title.trim(),
          input.channel?.trim() ?? null,
          input.durationMs ?? null,
          input.sourceLanguage ?? null,
          now,
        ],
      );
      await this.database.query(
        `INSERT INTO project_videos
           (project_id, video_id, version, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $3)
         ON CONFLICT (project_id, video_id) DO NOTHING`,
        [projectId, id, now],
      );
    });
    const result = await this.database.query<DbRow>(
      `SELECT id, youtube_video_id, canonical_url, title, channel, duration_ms,
              source_language, created_at, updated_at
       FROM videos WHERE id = $1`,
      [id],
    );
    return mapVideo(result.rows[0]);
  }

  async listVideos(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<Video[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT v.id, v.youtube_video_id, v.canonical_url, v.title, v.channel,
              v.duration_ms, v.source_language, v.created_at, v.updated_at
       FROM project_videos pv
       JOIN videos v ON v.id = pv.video_id
       WHERE pv.project_id = $1
       ORDER BY pv.updated_at DESC, v.id`,
      [projectId],
    );
    return result.rows.map(mapVideo);
  }

  async findProjectVideoTranscriptStates(
    actor: AuthenticatedActor,
    projectId: string,
    youtubeVideoIds: readonly string[],
  ): Promise<Map<string, ProjectVideoTranscriptState>> {
    await this.authorize(actor, projectId, "read");
    const states = new Map<string, ProjectVideoTranscriptState>();
    for (const youtubeVideoId of new Set(youtubeVideoIds)) {
      const result = await this.database.query<DbRow>(
        `SELECT v.id, v.canonical_url, v.title, v.channel, v.duration_ms,
                v.source_language, pv.active_transcript_version_id
         FROM project_videos pv
         JOIN videos v ON v.id = pv.video_id
         WHERE pv.project_id = $1 AND v.youtube_video_id = $2`,
        [projectId, youtubeVideoId],
      );
      const row = result.rows[0];
      if (row) {
        states.set(youtubeVideoId, {
          catalogVideoId: String(row.id),
          canonicalUrl: String(row.canonical_url),
          title: String(row.title),
          ...(row.channel === null ? {} : { channel: String(row.channel) }),
          ...(row.duration_ms === null
            ? {}
            : { durationMs: Number(row.duration_ms) }),
          ...(row.source_language === null
            ? {}
            : { sourceLanguage: String(row.source_language) }),
          ...(row.active_transcript_version_id === null
            ? {}
            : {
                activeTranscriptVersionId: String(
                  row.active_transcript_version_id,
                ),
              }),
        });
      }
    }
    return states;
  }

  async createTranscriptionBatch(
    actor: AuthenticatedActor,
    input: CreateTranscriptionBatchInput,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, input.projectId, "write");
    const batchId = randomUUID();
    const createdAt = this.now().toISOString();
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO transcription_batches
           (id, project_id, name, target_language, execution_location,
            transcription_profile, source_policy, priority, created_by,
            version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)`,
        [
          batchId,
          input.projectId,
          input.name.trim(),
          input.options.targetLanguage,
          input.options.executionLocation,
          input.options.transcriptionProfile,
          input.options.sourcePolicy,
          input.options.priority,
          actor.userId,
          createdAt,
        ],
      );

      for (const item of input.items) {
        let catalogVideoId = item.catalogVideoId;
        if (
          item.youtubeVideoId &&
          item.canonicalUrl &&
          item.title &&
          ["ready", "existing-transcript"].includes(item.status)
        ) {
          catalogVideoId = await this.upsertProjectVideo(
            input.projectId,
            item,
            createdAt,
          );
        }

        let persistedItem = item;
        if (
          item.status === "ready" &&
          catalogVideoId &&
          input.options.sourcePolicy !== "force-generate"
        ) {
          const active = await this.database.query<DbRow>(
            `SELECT active_transcript_version_id
             FROM project_videos
             WHERE project_id = $1 AND video_id = $2`,
            [input.projectId, catalogVideoId],
          );
          const activeTranscriptVersionId =
            active.rows[0]?.active_transcript_version_id;
          if (activeTranscriptVersionId) {
            persistedItem = {
              ...item,
              status: "existing-transcript",
              processingNeed: "reuse-shared",
              catalogVideoId,
              activeTranscriptVersionId: String(activeTranscriptVersionId),
            };
          }
        }

        let jobId: string | undefined;
        let idempotencyKey: string | undefined;
        let state: "queued" | "ready_for_review" | "blocked" | "canceled";
        if (persistedItem.status === "ready" && catalogVideoId) {
          idempotencyKey = [
            "transcription",
            input.projectId,
            catalogVideoId,
            input.options.transcriptionProfile,
            input.options.targetLanguage,
            input.options.sourcePolicy,
            "schema-1",
          ].join(":");
          const existingJob = await this.database.query<DbRow>(
            "SELECT id FROM jobs WHERE idempotency_key = $1",
            [idempotencyKey],
          );
          jobId = String(existingJob.rows[0]?.id ?? randomUUID());
          if (!existingJob.rows[0]) {
            await this.database.query(
              `INSERT INTO jobs
                 (id, project_id, kind, state, idempotency_key, attempt,
                  payload, created_at, updated_at)
               VALUES ($1, $2, 'transcription', 'queued', $3, 0, $4, $5, $5)`,
              [
                jobId,
                input.projectId,
                idempotencyKey,
                JSON.stringify({
                  batchId,
                  catalogVideoId,
                  youtubeVideoId: persistedItem.youtubeVideoId,
                  targetLanguage: input.options.targetLanguage,
                  transcriptionProfile: input.options.transcriptionProfile,
                  sourcePolicy: input.options.sourcePolicy,
                  executionLocation: input.options.executionLocation,
                  priority: input.options.priority,
                }),
                createdAt,
              ],
            );
          }
          state = "queued";
        } else if (persistedItem.status === "existing-transcript") {
          state = "ready_for_review";
        } else if (persistedItem.status === "duplicate") {
          state = "canceled";
        } else {
          state = "blocked";
        }

        await this.database.query(
          `INSERT INTO transcription_batch_items
             (id, batch_id, input_index, raw_input, youtube_video_id,
              canonical_url, catalog_video_id, active_transcript_version_id,
              title, channel, duration_ms, source_language, preflight_status,
              processing_need, duplicate_of_input_index, state, review_status,
              job_id, idempotency_key, error_code, error_message, attempt,
              version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, $14, $15, $16, 'unreviewed', $17, $18, $19, $20,
                   0, 1, $21, $21)`,
          [
            randomUUID(),
            batchId,
            persistedItem.inputIndex,
            persistedItem.input,
            persistedItem.youtubeVideoId ?? null,
            persistedItem.canonicalUrl ?? null,
            catalogVideoId ?? null,
            persistedItem.activeTranscriptVersionId ?? null,
            persistedItem.title ?? null,
            persistedItem.channel ?? null,
            persistedItem.durationMs ?? null,
            persistedItem.sourceLanguage ?? null,
            persistedItem.status,
            persistedItem.processingNeed,
            persistedItem.duplicateOfInputIndex ?? null,
            state,
            jobId ?? null,
            idempotencyKey ?? null,
            persistedItem.error?.code ?? null,
            persistedItem.error?.message ?? null,
            createdAt,
          ],
        );
      }
    });
    return this.getTranscriptionBatch(actor, input.projectId, batchId);
  }

  async getTranscriptionBatch(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, projectId, "read");
    const batchResult = await this.database.query<DbRow>(
      "SELECT * FROM transcription_batches WHERE id = $1 AND project_id = $2",
      [batchId, projectId],
    );
    const batch = batchResult.rows[0];
    if (!batch)
      throw new CatalogNotFoundError("Transcription batch not found.");
    const itemResult = await this.database.query<DbRow>(
      `SELECT * FROM transcription_batch_items
       WHERE batch_id = $1 ORDER BY input_index`,
      [batchId],
    );
    const items = itemResult.rows.map(mapBatchItem);
    return CreateTranscriptionBatchResponseSchema.parse({
      batch: {
        id: batch.id,
        projectId: batch.project_id,
        name: batch.name,
        targetLanguage: batch.target_language,
        transcriptionProfile: batch.transcription_profile,
        sourcePolicy: batch.source_policy,
        executionLocation: batch.execution_location,
        priority: batch.priority,
        dispatchStatus: batch.dispatch_status,
        createdBy: batch.created_by,
        version: batch.version,
        createdAt: iso(batch.created_at),
        updatedAt: iso(batch.updated_at),
      },
      items,
      summary: summarizePreflight(items),
      progress: summarizeProgress(items),
    });
  }

  async listTranscriptionBatches(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<TranscriptionBatchListResponse> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT id
       FROM transcription_batches
       WHERE project_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT 200`,
      [projectId],
    );
    const batches = await Promise.all(
      result.rows.map(async (row) => {
        const response = await this.getTranscriptionBatch(
          actor,
          projectId,
          String(row.id),
        );
        return { batch: response.batch, progress: response.progress };
      }),
    );
    return TranscriptionBatchListResponseSchema.parse({ batches });
  }

  async listReviewInbox(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ReviewInboxResponse> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT bi.*, b.name AS batch_name
       FROM transcription_batch_items bi
       JOIN transcription_batches b ON b.id = bi.batch_id
       WHERE b.project_id = $1 AND bi.state = 'ready_for_review'
       ORDER BY
         CASE bi.review_status
           WHEN 'unreviewed' THEN 0
           WHEN 'reviewing' THEN 1
           WHEN 'reviewed' THEN 2
           ELSE 3
         END,
         bi.updated_at DESC,
         bi.id DESC
       LIMIT 500`,
      [projectId],
    );
    return ReviewInboxResponseSchema.parse({
      items: result.rows.map(mapReviewInboxItem),
    });
  }

  async updateReviewStatus(
    actor: AuthenticatedActor,
    projectId: string,
    itemId: string,
    command: UpdateReviewStatusRequest,
  ): Promise<ReviewInboxItem> {
    await this.authorize(actor, projectId, "write");
    const updatedAt = this.now().toISOString();
    let updated: DbRow | undefined;
    await this.transaction(async () => {
      const selected = await this.database.query<DbRow>(
        `SELECT bi.*, b.name AS batch_name
         FROM transcription_batch_items bi
         JOIN transcription_batches b ON b.id = bi.batch_id
         WHERE bi.id = $1 AND b.project_id = $2
         FOR UPDATE OF bi`,
        [itemId, projectId],
      );
      const item = selected.rows[0];
      if (!item) throw new CatalogNotFoundError("Review item not found.");
      if (item.state !== "ready_for_review") {
        throw new CatalogConflictError(
          "Only ready items can change review status.",
        );
      }
      if (Number(item.version) !== command.expectedVersion) {
        throw new CatalogConflictError(
          "The review item changed; reload it before trying again.",
        );
      }
      const result = await this.database.query<DbRow>(
        `UPDATE transcription_batch_items
         SET review_status = $1, version = version + 1, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        [command.reviewStatus, updatedAt, itemId],
      );
      updated = { ...result.rows[0], batch_name: item.batch_name };
    });
    return mapReviewInboxItem(updated!);
  }

  async controlTranscriptionBatch(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    command: TranscriptionBatchControlRequest,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, projectId, "write");
    const updatedAt = this.now().toISOString();
    await this.transaction(async () => {
      const result = await this.database.query<DbRow>(
        `SELECT id, dispatch_status, version
         FROM transcription_batches
         WHERE id = $1 AND project_id = $2
         FOR UPDATE`,
        [batchId, projectId],
      );
      const batch = result.rows[0];
      if (!batch) {
        throw new CatalogNotFoundError("Transcription batch not found.");
      }
      if (Number(batch.version) !== command.expectedVersion) {
        throw new CatalogConflictError(
          "The transcription batch changed; reload it before trying again.",
        );
      }
      if (
        batch.dispatch_status === "canceled" &&
        command.action !== "cancel_unstarted"
      ) {
        throw new CatalogConflictError(
          "Canceled batch dispatch cannot be resumed or retried.",
        );
      }

      let dispatchStatus = String(batch.dispatch_status);
      if (command.action === "pause_pending") {
        dispatchStatus = "paused";
      } else if (command.action === "resume") {
        dispatchStatus = "active";
      } else if (command.action === "cancel_unstarted") {
        dispatchStatus = "canceled";
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'canceled', version = version + 1, updated_at = $1
           WHERE batch_id = $2 AND state = 'queued'`,
          [updatedAt, batchId],
        );
        await this.database.query(
          `UPDATE jobs j
           SET state = 'canceled', updated_at = $1
           WHERE j.project_id = $2 AND j.kind = 'transcription'
             AND j.state = 'queued'
             AND NOT EXISTS (
               SELECT 1
               FROM transcription_batch_items bi
               JOIN transcription_batches b ON b.id = bi.batch_id
               WHERE bi.job_id = j.id
                 AND b.dispatch_status = 'active'
                 AND bi.state IN (
                   'queued', 'resolving', 'acquiring', 'transcribing',
                   'translating', 'aligning', 'uploading'
                 )
             )`,
          [updatedAt, projectId],
        );
      } else if (command.action === "retry_failed") {
        dispatchStatus = "active";
        const retryJobs = await this.database.query<DbRow>(
          `SELECT DISTINCT job_id
           FROM transcription_batch_items
           WHERE batch_id = $1 AND state = 'failed'
             AND error_retryable = true AND job_id IS NOT NULL`,
          [batchId],
        );
        for (const row of retryJobs.rows) {
          await this.database.query(
            `UPDATE jobs
             SET state = 'queued', payload = payload - 'lastError',
                 updated_at = $1
             WHERE id = $2 AND state = 'failed'`,
            [updatedAt, row.job_id],
          );
        }
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'queued', error_code = NULL, error_message = NULL,
               error_retryable = NULL, version = version + 1,
               updated_at = $1
           WHERE batch_id = $2 AND state = 'failed'
             AND error_retryable = true`,
          [updatedAt, batchId],
        );
      }

      await this.database.query(
        `UPDATE transcription_batches
         SET dispatch_status = $1, version = version + 1, updated_at = $2
         WHERE id = $3`,
        [dispatchStatus, updatedAt, batchId],
      );
    });
    return this.getTranscriptionBatch(actor, projectId, batchId);
  }

  async claimTranscriptionJob(
    actor: AuthenticatedActor,
    executionLocation: "local" | "hosted",
    leaseSeconds: number,
  ): Promise<ClaimedTranscriptionJob | undefined> {
    await this.requireRegistered(actor);
    const claimedAt = this.now();
    const expiresAt = new Date(claimedAt.getTime() + leaseSeconds * 1_000);
    await this.database.exec("BEGIN");
    try {
      const candidate = await this.database.query<DbRow>(
        `SELECT j.*
         FROM jobs j
         JOIN project_members pm
           ON pm.project_id = j.project_id AND pm.user_id = $1
         LEFT JOIN worker_leases wl ON wl.job_id = j.id
         WHERE j.kind = 'transcription'
           AND pm.role IN ('owner', 'editor', 'researcher')
           AND j.payload->>'executionLocation' = $2
           AND EXISTS (
             SELECT 1
             FROM transcription_batch_items bi
             JOIN transcription_batches b ON b.id = bi.batch_id
             WHERE bi.job_id = j.id
               AND (
                 (b.dispatch_status = 'active' AND bi.state = 'queued')
                 OR bi.state IN (
                   'resolving', 'acquiring', 'transcribing', 'translating',
                   'aligning', 'uploading'
                 )
               )
           )
           AND (
             j.state = 'queued'
             OR (j.state IN ('claimed', 'processing') AND wl.expires_at <= $3)
           )
         ORDER BY
           CASE j.payload->>'priority'
             WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2
           END,
           j.created_at,
           j.id
         LIMIT 1
         FOR UPDATE OF j SKIP LOCKED`,
        [actor.userId, executionLocation, claimedAt.toISOString()],
      );
      const row = candidate.rows[0];
      if (!row) {
        await this.database.exec("COMMIT");
        return undefined;
      }
      const attempt = Number(row.attempt) + 1;
      await this.database.query(
        `UPDATE jobs
         SET state = 'claimed', attempt = $1, updated_at = $2
         WHERE id = $3`,
        [attempt, claimedAt.toISOString(), row.id],
      );
      await this.database.query(
        `INSERT INTO worker_leases
           (job_id, worker_id, attempt, claimed_at, heartbeat_at, expires_at)
         VALUES ($1, $2, $3, $4, $4, $5)
         ON CONFLICT (job_id) DO UPDATE
         SET worker_id = EXCLUDED.worker_id,
             attempt = EXCLUDED.attempt,
             claimed_at = EXCLUDED.claimed_at,
             heartbeat_at = EXCLUDED.heartbeat_at,
             expires_at = EXCLUDED.expires_at`,
        [
          row.id,
          actor.userId,
          attempt,
          claimedAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = 'resolving', attempt = $1, version = version + 1,
             updated_at = $2
         WHERE job_id = $3 AND state NOT IN ('ready_for_review', 'canceled')`,
        [attempt, claimedAt.toISOString(), row.id],
      );
      await this.database.exec("COMMIT");
      return ClaimedTranscriptionJobSchema.parse({
        job: mapJob({
          ...row,
          state: "claimed",
          attempt,
          updated_at: claimedAt.toISOString(),
        }),
        lease: {
          jobId: row.id,
          workerId: actor.userId,
          attempt,
          claimedAt: claimedAt.toISOString(),
          heartbeatAt: claimedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (error) {
      await this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async heartbeatTranscriptionJob(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    leaseSeconds: number,
    stage: WorkerProgressStage,
  ): Promise<WorkerLease> {
    const lease = await this.requireActiveWorkerLease(actor, jobId, attempt);
    const heartbeatAt = this.now();
    const expiresAt = new Date(heartbeatAt.getTime() + leaseSeconds * 1_000);
    await this.transaction(async () => {
      await this.database.query(
        `UPDATE worker_leases
         SET heartbeat_at = $1, expires_at = $2
         WHERE job_id = $3 AND worker_id = $4 AND attempt = $5`,
        [
          heartbeatAt.toISOString(),
          expiresAt.toISOString(),
          jobId,
          actor.userId,
          attempt,
        ],
      );
      await this.database.query(
        "UPDATE jobs SET state = 'processing', updated_at = $1 WHERE id = $2",
        [heartbeatAt.toISOString(), jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = $1, version = version + 1, updated_at = $2
         WHERE job_id = $3 AND attempt = $4`,
        [stage, heartbeatAt.toISOString(), jobId, attempt],
      );
    });
    return WorkerLeaseSchema.parse({
      jobId,
      workerId: actor.userId,
      attempt,
      claimedAt: iso(lease.claimed_at),
      heartbeatAt: heartbeatAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  async recordTranscriptSourcePlan(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    plan: TranscriptSourcePlan,
  ): Promise<void> {
    await this.requireActiveWorkerLease(actor, jobId, attempt);
    const resolvedAt = this.now().toISOString();
    const encoded = JSON.stringify(plan);
    await this.transaction(async () => {
      await this.database.query(
        `UPDATE jobs
         SET payload = payload || jsonb_build_object('sourcePlan', $1::jsonb),
             state = 'processing', updated_at = $2
         WHERE id = $3`,
        [encoded, resolvedAt, jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET source_plan = $1::jsonb, source_resolved_at = $2,
             version = version + 1, updated_at = $2
         WHERE job_id = $3 AND attempt = $4`,
        [encoded, resolvedAt, jobId, attempt],
      );
    });
  }

  async failTranscriptionJob(
    actor: AuthenticatedActor,
    jobId: string,
    failure: WorkerFailureRequest,
  ): Promise<void> {
    await this.requireActiveWorkerLease(actor, jobId, failure.attempt);
    const failedAt = this.now().toISOString();
    const lastError = JSON.stringify({
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      failedAt,
      attempt: failure.attempt,
    });
    await this.transaction(async () => {
      await this.database.query(
        `UPDATE jobs
         SET state = 'failed',
             payload = payload || jsonb_build_object('lastError', $1::jsonb),
             updated_at = $2
         WHERE id = $3`,
        [lastError, failedAt, jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = 'failed', error_code = $1, error_message = $2,
             error_retryable = $3, version = version + 1, updated_at = $4
         WHERE job_id = $5 AND attempt = $6
           AND state NOT IN ('ready_for_review', 'canceled')`,
        [
          failure.code,
          failure.message,
          failure.retryable,
          failedAt,
          jobId,
          failure.attempt,
        ],
      );
      await this.database.query(
        `DELETE FROM worker_leases
         WHERE job_id = $1 AND worker_id = $2 AND attempt = $3`,
        [jobId, actor.userId, failure.attempt],
      );
    });
  }

  async createTranscriptUpload(
    actor: AuthenticatedActor,
    input: CreateTranscriptUploadInput,
  ): Promise<TranscriptUploadGrant> {
    await this.authorize(actor, input.projectId, "write");
    await this.requireProjectVideo(input.projectId, input.catalogVideoId);
    const artifactTypes = [...new Set(input.artifactTypes)];
    if (
      artifactTypes.length === 0 ||
      artifactTypes.length !== input.artifactTypes.length
    ) {
      throw new CatalogConflictError(
        "Artifact types must be non-empty and unique.",
      );
    }
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1000);
    const allTypes: ArtifactType[] = ["manifest", ...artifactTypes];
    const prefix = `projects/${input.projectId}/videos/${input.catalogVideoId}/transcripts/${input.lineageId}/v${input.version}/${uploadId}`;
    const targets = await Promise.all(
      allTypes.map(async (type) => {
        const objectKey = `${prefix}/${type}.json`;
        return {
          type,
          objectKey,
          uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
            objectKey,
            expiresInSeconds: 15 * 60,
          }),
        };
      }),
    );

    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO jobs
           (id, project_id, kind, state, idempotency_key, attempt, payload, created_at, updated_at)
         VALUES ($1, $2, 'transcription', 'processing', $3, 0, $4, $5, $5)`,
        [
          jobId,
          input.projectId,
          `transcript-upload:${uploadId}`,
          JSON.stringify(input),
          createdAt.toISOString(),
        ],
      );
      await this.database.query(
        `INSERT INTO transcript_uploads
           (id, job_id, project_id, video_id, lineage_id, version, state,
            expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'staged', $7, $8, $9)`,
        [
          uploadId,
          jobId,
          input.projectId,
          input.catalogVideoId,
          input.lineageId,
          input.version,
          expiresAt.toISOString(),
          actor.userId,
          createdAt.toISOString(),
        ],
      );
      for (const target of targets) {
        await this.database.query(
          `INSERT INTO transcript_upload_targets
             (upload_id, artifact_type, object_key)
           VALUES ($1, $2, $3)`,
          [uploadId, target.type, target.objectKey],
        );
      }
    });
    return TranscriptUploadGrantSchema.parse({
      uploadId,
      jobId,
      projectId: input.projectId,
      catalogVideoId: input.catalogVideoId,
      lineageId: input.lineageId,
      version: input.version,
      expiresAt: expiresAt.toISOString(),
      targets,
    });
  }

  async createClaimedTranscriptUpload(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    input: CreateClaimedTranscriptUploadInput,
  ): Promise<TranscriptUploadGrant> {
    await this.requireActiveWorkerLease(actor, jobId, attempt);
    const jobResult = await this.database.query<DbRow>(
      "SELECT project_id, payload FROM jobs WHERE id = $1 AND kind = 'transcription'",
      [jobId],
    );
    const job = jobResult.rows[0];
    if (!job) throw new CatalogNotFoundError("Transcription job not found.");
    const payload =
      typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    const catalogVideoId = String(
      (payload as Record<string, unknown>).catalogVideoId ?? "",
    );
    const projectId = String(job.project_id ?? "");
    await this.authorize(actor, projectId, "write");
    await this.requireProjectVideo(projectId, catalogVideoId);
    const artifactTypes = [...new Set(input.artifactTypes)];
    if (
      artifactTypes.length === 0 ||
      artifactTypes.length !== input.artifactTypes.length
    ) {
      throw new CatalogConflictError(
        "Artifact types must be non-empty and unique.",
      );
    }

    const existingResult = await this.database.query<DbRow>(
      "SELECT * FROM transcript_uploads WHERE job_id = $1",
      [jobId],
    );
    const existing = existingResult.rows[0];
    const expiresAt = new Date(this.now().getTime() + 15 * 60 * 1_000);
    if (existing) {
      if (String(existing.state) === "finalized") {
        throw new CatalogConflictError(
          "The claimed transcription job is already finalized.",
        );
      }
      if (
        String(existing.project_id) !== projectId ||
        String(existing.video_id) !== catalogVideoId ||
        String(existing.lineage_id) !== input.lineageId ||
        Number(existing.version) !== input.version
      ) {
        throw new CatalogConflictError(
          "The claimed job already has a different transcript upload.",
        );
      }
      const targets = await this.loadTargets(String(existing.id));
      const expectedTypes = new Set(["manifest", ...artifactTypes]);
      if (
        targets.size !== expectedTypes.size ||
        [...targets.keys()].some((type) => !expectedTypes.has(type))
      ) {
        throw new CatalogConflictError(
          "The claimed job already has different artifact targets.",
        );
      }
      await this.database.query(
        "UPDATE transcript_uploads SET state = 'staged', expires_at = $1 WHERE id = $2",
        [expiresAt.toISOString(), existing.id],
      );
      return TranscriptUploadGrantSchema.parse({
        uploadId: existing.id,
        jobId,
        projectId,
        catalogVideoId,
        lineageId: input.lineageId,
        version: input.version,
        expiresAt: expiresAt.toISOString(),
        targets: await Promise.all(
          [...targets].map(async ([type, objectKey]) => ({
            type,
            objectKey,
            uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
              objectKey,
              expiresInSeconds: 15 * 60,
            }),
          })),
        ),
      });
    }

    const uploadId = randomUUID();
    const createdAt = this.now();
    const allTypes: ArtifactType[] = ["manifest", ...artifactTypes];
    const prefix = `projects/${projectId}/videos/${catalogVideoId}/transcripts/${input.lineageId}/v${input.version}/${uploadId}`;
    const targets = await Promise.all(
      allTypes.map(async (type) => {
        const objectKey = `${prefix}/${type}.json`;
        return {
          type,
          objectKey,
          uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
            objectKey,
            expiresInSeconds: 15 * 60,
          }),
        };
      }),
    );
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO transcript_uploads
           (id, job_id, project_id, video_id, lineage_id, version, state,
            expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'staged', $7, $8, $9)`,
        [
          uploadId,
          jobId,
          projectId,
          catalogVideoId,
          input.lineageId,
          input.version,
          expiresAt.toISOString(),
          actor.userId,
          createdAt.toISOString(),
        ],
      );
      for (const target of targets) {
        await this.database.query(
          `INSERT INTO transcript_upload_targets
             (upload_id, artifact_type, object_key)
           VALUES ($1, $2, $3)`,
          [uploadId, target.type, target.objectKey],
        );
      }
    });
    return TranscriptUploadGrantSchema.parse({
      uploadId,
      jobId,
      projectId,
      catalogVideoId,
      lineageId: input.lineageId,
      version: input.version,
      expiresAt: expiresAt.toISOString(),
      targets,
    });
  }

  async finalizeTranscript(
    actor: AuthenticatedActor,
    request: FinalizeTranscriptRequest,
    claim?: { jobId: string; attempt: number },
  ): Promise<ActiveTranscriptBundle> {
    const upload = await this.loadUpload(request.uploadId);
    await this.authorize(actor, String(upload.project_id), "write");
    if (claim && String(upload.job_id) !== claim.jobId) {
      throw new CatalogConflictError(
        "Transcript upload does not belong to the claimed job.",
      );
    }
    if (String(upload.state) === "finalized") {
      return this.getActiveTranscript(
        actor,
        String(upload.project_id),
        String(upload.video_id),
      );
    }
    if (new Date(iso(upload.expires_at)).getTime() <= this.now().getTime()) {
      throw new CatalogConflictError("Transcript upload grant has expired.");
    }
    if (claim) {
      await this.requireActiveWorkerLease(actor, claim.jobId, claim.attempt);
    }

    const manifestBytes = await this.verifyObject(request.manifest);
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
      throw new TranscriptIntegrityError("Manifest is not valid JSON.");
    }
    const manifest = TranscriptManifestSchema.parse(manifestJson);
    this.assertManifestMatchesUpload(manifest, upload);

    const targets = await this.loadTargets(request.uploadId);
    const manifestTarget = targets.get("manifest");
    if (!manifestTarget || manifestTarget !== request.manifest.objectKey) {
      throw new TranscriptIntegrityError(
        "Manifest was uploaded outside its grant.",
      );
    }
    const seenTypes = new Set<string>();
    for (const artifact of manifest.artifacts) {
      if (seenTypes.has(artifact.type)) {
        throw new TranscriptIntegrityError(
          "Manifest contains duplicate artifact types.",
        );
      }
      seenTypes.add(artifact.type);
      if (
        artifact.type === "manifest" ||
        targets.get(artifact.type) !== artifact.objectKey
      ) {
        throw new TranscriptIntegrityError(
          "Manifest references an unauthorized object.",
        );
      }
      if (!artifact.objectVersionId) {
        throw new TranscriptIntegrityError(
          "Every artifact must pin an object version.",
        );
      }
      await this.verifyObject({
        ...artifact,
        objectVersionId: artifact.objectVersionId,
      });
    }
    const requiredTypes = [...targets.keys()].filter(
      (type) => type !== "manifest",
    );
    if (requiredTypes.some((type) => !seenTypes.has(type))) {
      throw new TranscriptIntegrityError(
        "Manifest does not include every granted artifact.",
      );
    }

    await this.transaction(async () => {
      if (claim) {
        const lease = await this.database.query<DbRow>(
          `SELECT 1 FROM worker_leases
           WHERE job_id = $1 AND worker_id = $2 AND attempt = $3
             AND expires_at > $4
           FOR UPDATE`,
          [claim.jobId, actor.userId, claim.attempt, this.now().toISOString()],
        );
        if (!lease.rows[0]) {
          throw new CatalogConflictError(
            "Worker lease is no longer active for this attempt.",
          );
        }
      }
      await this.database.query(
        `INSERT INTO transcript_versions
           (id, project_id, video_id, lineage_id, version, schema_version,
            source_language, target_language, timing_precision,
            manifest_object_key, manifest_object_version_id, manifest_sha256,
            idempotency_key, finalized_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          manifest.id,
          manifest.projectId,
          manifest.catalogVideoId,
          manifest.lineageId,
          manifest.version,
          manifest.schemaVersion,
          manifest.sourceLanguage,
          manifest.targetLanguage,
          manifest.timingPrecision,
          request.manifest.objectKey,
          request.manifest.objectVersionId,
          request.manifest.sha256,
          request.idempotencyKey,
          this.now().toISOString(),
          manifest.createdAt,
        ],
      );
      const artifacts = [request.manifest, ...manifest.artifacts];
      for (const artifact of artifacts) {
        await this.database.query(
          `INSERT INTO transcript_artifacts
             (transcript_version_id, artifact_type, object_key,
              object_version_id, byte_size, sha256)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            manifest.id,
            artifact.type,
            artifact.objectKey,
            artifact.objectVersionId,
            artifact.byteSize,
            artifact.sha256,
          ],
        );
      }
      await this.database.query(
        `UPDATE project_videos
         SET active_transcript_version_id = $1, version = version + 1,
             updated_at = $2
         WHERE project_id = $3 AND video_id = $4`,
        [
          manifest.id,
          this.now().toISOString(),
          manifest.projectId,
          manifest.catalogVideoId,
        ],
      );
      await this.database.query(
        "UPDATE transcript_uploads SET state = 'finalized' WHERE id = $1",
        [request.uploadId],
      );
      await this.database.query(
        "UPDATE jobs SET state = 'complete', updated_at = $1 WHERE id = $2",
        [this.now().toISOString(), upload.job_id],
      );
      if (claim) {
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'ready_for_review',
               active_transcript_version_id = $1,
               error_code = NULL, error_message = NULL,
               version = version + 1, updated_at = $2
           WHERE job_id = $3 AND attempt = $4 AND state <> 'canceled'`,
          [manifest.id, this.now().toISOString(), claim.jobId, claim.attempt],
        );
        await this.database.query(
          `DELETE FROM worker_leases
           WHERE job_id = $1 AND worker_id = $2 AND attempt = $3`,
          [claim.jobId, actor.userId, claim.attempt],
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload)
         VALUES ($1, 'transcript.activated', $2, 1, $3)`,
        [
          manifest.projectId,
          manifest.id,
          JSON.stringify({ videoId: manifest.catalogVideoId }),
        ],
      );
    });
    return this.getActiveTranscript(
      actor,
      manifest.projectId,
      manifest.catalogVideoId,
    );
  }

  async getActiveTranscript(
    actor: AuthenticatedActor,
    projectId: string,
    catalogVideoId: string,
  ): Promise<ActiveTranscriptBundle> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT tv.id, tv.manifest_object_key, tv.manifest_object_version_id,
              tv.manifest_sha256, ta.byte_size
       FROM project_videos pv
       JOIN transcript_versions tv ON tv.id = pv.active_transcript_version_id
       JOIN transcript_artifacts ta
         ON ta.transcript_version_id = tv.id AND ta.artifact_type = 'manifest'
       WHERE pv.project_id = $1 AND pv.video_id = $2`,
      [projectId, catalogVideoId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("No active transcript found.");
    const manifestObject = {
      type: "manifest" as const,
      objectKey: String(row.manifest_object_key),
      objectVersionId: String(row.manifest_object_version_id),
      byteSize: Number(row.byte_size),
      sha256: String(row.manifest_sha256),
    };
    const bytes = await this.verifyObject(manifestObject);
    const manifest = TranscriptManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const descriptors = [manifestObject, ...manifest.artifacts].map(
      (artifact) => {
        if (!artifact.objectVersionId) {
          throw new TranscriptIntegrityError(
            "Active transcript artifact does not pin an object version.",
          );
        }
        return { ...artifact, objectVersionId: artifact.objectVersionId };
      },
    );
    const downloads = await Promise.all(
      descriptors.map(async (artifact) => ({
        ...artifact,
        downloadUrl: await this.uploadUrlIssuer.issueGetUrl({
          objectKey: artifact.objectKey,
          objectVersionId: artifact.objectVersionId,
          expiresInSeconds: 15 * 60,
        }),
      })),
    );
    return ActiveTranscriptBundleSchema.parse({
      transcriptVersionId: String(row.id),
      manifest,
      manifestObject,
      downloads,
    });
  }

  private async verifyObject(descriptor: {
    objectKey: string;
    objectVersionId: string;
    byteSize: number;
    sha256: string;
  }): Promise<Uint8Array> {
    const object = await this.store.get(
      descriptor.objectKey,
      descriptor.objectVersionId,
    );
    if (
      !object ||
      object.bytes.byteLength !== descriptor.byteSize ||
      sha256(object.bytes) !== descriptor.sha256
    ) {
      throw new TranscriptIntegrityError(
        `Object verification failed for ${descriptor.objectKey}.`,
      );
    }
    return object.bytes;
  }

  private assertManifestMatchesUpload(
    manifest: ReturnType<typeof TranscriptManifestSchema.parse>,
    upload: DbRow,
  ) {
    if (
      manifest.projectId !== String(upload.project_id) ||
      manifest.catalogVideoId !== String(upload.video_id) ||
      manifest.lineageId !== String(upload.lineage_id) ||
      manifest.version !== Number(upload.version) ||
      manifest.jobId !== String(upload.job_id) ||
      manifest.createdBy !== String(upload.created_by)
    ) {
      throw new TranscriptIntegrityError(
        "Manifest identity does not match its upload grant.",
      );
    }
  }

  private async loadUpload(uploadId: string): Promise<DbRow> {
    const result = await this.database.query<DbRow>(
      "SELECT * FROM transcript_uploads WHERE id = $1",
      [uploadId],
    );
    if (!result.rows[0]) throw new CatalogNotFoundError("Upload not found.");
    return result.rows[0];
  }

  private async loadTargets(uploadId: string): Promise<Map<string, string>> {
    const result = await this.database.query<DbRow>(
      "SELECT artifact_type, object_key FROM transcript_upload_targets WHERE upload_id = $1",
      [uploadId],
    );
    return new Map(
      result.rows.map((row) => [
        String(row.artifact_type),
        String(row.object_key),
      ]),
    );
  }

  private async requireProjectVideo(projectId: string, videoId: string) {
    const result = await this.database.query(
      "SELECT 1 FROM project_videos WHERE project_id = $1 AND video_id = $2",
      [projectId, videoId],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("Project video not found.");
  }

  private async upsertProjectVideo(
    projectId: string,
    item: BatchPreflightItem,
    now: string,
  ): Promise<string> {
    const existing = await this.database.query<DbRow>(
      "SELECT id FROM videos WHERE youtube_video_id = $1",
      [item.youtubeVideoId],
    );
    const id = String(existing.rows[0]?.id ?? randomUUID());
    await this.database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, channel, duration_ms,
          source_language, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (youtube_video_id) DO UPDATE
       SET canonical_url = EXCLUDED.canonical_url,
           title = EXCLUDED.title,
           channel = EXCLUDED.channel,
           duration_ms = EXCLUDED.duration_ms,
           source_language = EXCLUDED.source_language,
           updated_at = EXCLUDED.updated_at`,
      [
        id,
        item.youtubeVideoId,
        item.canonicalUrl,
        item.title,
        item.channel ?? null,
        item.durationMs ?? null,
        item.sourceLanguage ?? null,
        now,
      ],
    );
    await this.database.query(
      `INSERT INTO project_videos
         (project_id, video_id, version, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $3)
       ON CONFLICT (project_id, video_id) DO NOTHING`,
      [projectId, id, now],
    );
    return id;
  }

  private async listExportPresetEntries(
    scope: ExportPresetScope,
    ownerId: string,
  ): Promise<ExportPresetCatalogEntry[]> {
    const ownerColumn =
      scope === "personal" ? "p.owner_user_id" : "p.project_id";
    const result = await this.database.query<DbRow>(
      `SELECT p.*, v.name AS revision_name,
              v.description AS revision_description,
              v.settings_snapshot AS revision_settings,
              v.created_by AS revision_created_by,
              v.created_at AS revision_created_at
       FROM export_presets p
       JOIN export_preset_versions v
         ON v.preset_id = p.id AND v.version = p.current_version
       WHERE p.scope = $1 AND ${ownerColumn} = $2
       ORDER BY p.normalized_name, p.id`,
      [scope, ownerId],
    );
    return result.rows.map(mapExportPresetEntry);
  }

  private async getExportPresetDefault(
    scope: ExportPresetScope,
    ownerId: string,
  ): Promise<ExportPresetDefault | undefined> {
    const table =
      scope === "personal"
        ? "personal_export_preset_defaults"
        : "project_export_preset_defaults";
    const ownerColumn = scope === "personal" ? "user_id" : "project_id";
    const result = await this.database.query<DbRow>(
      `SELECT d.*, v.name AS revision_name,
              v.description AS revision_description,
              v.settings_snapshot AS revision_settings
       FROM ${table} d
       JOIN export_preset_versions v
         ON v.preset_id = d.preset_id AND v.version = d.preset_version
       WHERE d.${ownerColumn} = $1`,
      [ownerId],
    );
    return result.rows[0]
      ? mapExportPresetDefault(scope, ownerId, result.rows[0])
      : undefined;
  }

  private async resolveCatalogExportSettings(
    actor: AuthenticatedActor,
    context: "logged" | "export_only",
    projectId: string | undefined,
    input: ExportSettingsPreviewRequest,
    resolvedAt: string,
  ): Promise<ExportSettingsPreview> {
    const selection = input.selection;
    const contextDefault =
      selection.base === "context_default"
        ? context === "logged"
          ? await this.getExportPresetDefault("project", projectId!)
          : await this.getExportPresetDefault("personal", actor.userId)
        : undefined;
    const selectedPreset = selection.selectedPreset
      ? await this.loadAuthorizedExportPresetRevision(
          actor,
          context,
          projectId,
          selection.selectedPreset,
        )
      : undefined;
    return resolveExportSettings({
      context,
      sourceLanguageClass: input.sourceLanguageClass,
      ...(contextDefault
        ? {
            contextDefault: {
              scope: contextDefault.scope,
              snapshot: contextDefault.snapshot,
            },
          }
        : {}),
      ...(selectedPreset
        ? {
            selectedPreset: {
              scope: selection.selectedPreset!.scope,
              snapshot: selectedPreset,
            },
          }
        : {}),
      useApplicationDefault: selection.base === "application_default",
      overrides: selection.overrides,
      resolvedAt,
    });
  }

  private async loadAuthorizedExportPresetRevision(
    actor: AuthenticatedActor,
    context: "logged" | "export_only",
    projectId: string | undefined,
    reference: ExportPresetReference,
  ): Promise<ExportPresetSnapshot> {
    if (context === "export_only" && reference.scope !== "personal") {
      throw new AuthorizationError(
        "Export-only settings may select personal presets only.",
      );
    }
    const result = await this.database.query<DbRow>(
      `SELECT p.scope, p.owner_user_id, p.project_id, v.name,
              v.settings_snapshot
       FROM export_presets p
       JOIN export_preset_versions v ON v.preset_id = p.id
       WHERE p.id = $1 AND v.version = $2 AND p.scope = $3`,
      [reference.presetId, reference.presetVersion, reference.scope],
    );
    const row = result.rows[0];
    if (!row) {
      throw new CatalogNotFoundError(
        "The selected export preset version is missing.",
      );
    }
    const authorized =
      (reference.scope === "personal" && row.owner_user_id === actor.userId) ||
      (reference.scope === "project" &&
        context === "logged" &&
        row.project_id === projectId);
    if (!authorized) {
      throw new AuthorizationError(
        "The selected export preset version is outside this export scope.",
      );
    }
    return {
      presetId: reference.presetId,
      presetVersion: reference.presetVersion,
      name: String(row.name),
      settings: ExportSettingsSchema.parse(row.settings_snapshot),
    };
  }

  private async createExportPreset(
    actor: AuthenticatedActor,
    scope: ExportPresetScope,
    ownerId: string,
    input: CreateExportPresetRequest,
  ): Promise<ExportPresetCatalogEntry> {
    const replay = await this.readExportPresetReceipt(
      actor,
      scope,
      ownerId,
      "create",
      input.idempotencyKey,
      input,
    );
    if (replay) return ExportPresetCatalogEntrySchema.parse(replay);
    const normalizedName = normalizePresetName(input.name);
    await this.assertExportPresetNameAvailable(scope, ownerId, normalizedName);
    const presetId = randomUUID();
    const now = this.now().toISOString();
    const response = ExportPresetCatalogEntrySchema.parse({
      id: presetId,
      scope,
      ...(scope === "project" ? { projectId: ownerId } : {}),
      currentVersion: 1,
      entityVersion: 1,
      current: {
        presetId,
        presetVersion: 1,
        name: input.name,
        description: input.description,
        settings: input.settings,
        createdBy: actor.userId,
        createdAt: now,
      },
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    return this.transaction(async () => {
      const concurrentReplay = await this.readExportPresetReceipt(
        actor,
        scope,
        ownerId,
        "create",
        input.idempotencyKey,
        input,
      );
      if (concurrentReplay)
        return ExportPresetCatalogEntrySchema.parse(concurrentReplay);
      await this.database.query(
        `INSERT INTO export_presets
           (id, scope, owner_user_id, project_id, normalized_name,
            current_version, entity_version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, 1, $6, $7, $7)`,
        [
          presetId,
          scope,
          scope === "personal" ? ownerId : null,
          scope === "project" ? ownerId : null,
          normalizedName,
          actor.userId,
          now,
        ],
      );
      await this.database.query(
        `INSERT INTO export_preset_versions
           (preset_id, version, name, description, settings_snapshot,
            created_by, created_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [
          presetId,
          input.name,
          input.description,
          JSON.stringify(input.settings),
          actor.userId,
          now,
        ],
      );
      if (scope === "project") {
        await this.insertExportPresetSyncEvent(
          ownerId,
          "export_preset.created",
          presetId,
          1,
          { presetId, presetVersion: 1 },
          now,
        );
      }
      await this.writeExportPresetReceipt(
        actor,
        scope,
        ownerId,
        "create",
        input.idempotencyKey,
        input,
        response,
        now,
      );
      return response;
    });
  }

  private async reviseExportPreset(
    actor: AuthenticatedActor,
    scope: ExportPresetScope,
    ownerId: string,
    input: ReviseExportPresetRequest,
  ): Promise<ExportPresetCatalogEntry> {
    const replay = await this.readExportPresetReceipt(
      actor,
      scope,
      ownerId,
      "revise",
      input.idempotencyKey,
      input,
    );
    if (replay) return ExportPresetCatalogEntrySchema.parse(replay);
    const normalizedName = normalizePresetName(input.name);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const concurrentReplay = await this.readExportPresetReceipt(
        actor,
        scope,
        ownerId,
        "revise",
        input.idempotencyKey,
        input,
      );
      if (concurrentReplay)
        return ExportPresetCatalogEntrySchema.parse(concurrentReplay);
      const preset = await this.findOwnedExportPreset(
        scope,
        ownerId,
        input.presetId,
      );
      if (!preset) throw new CatalogNotFoundError("Export preset not found.");
      if (Number(preset.entity_version) !== input.expectedEntityVersion) {
        throw new CatalogConflictError(
          "This preset changed elsewhere. Reload it before creating a revision.",
        );
      }
      await this.assertExportPresetNameAvailable(
        scope,
        ownerId,
        normalizedName,
        input.presetId,
      );
      const nextPresetVersion = Number(preset.current_version) + 1;
      const nextEntityVersion = Number(preset.entity_version) + 1;
      await this.database.query(
        `INSERT INTO export_preset_versions
           (preset_id, version, name, description, settings_snapshot,
            created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.presetId,
          nextPresetVersion,
          input.name,
          input.description,
          JSON.stringify(input.settings),
          actor.userId,
          now,
        ],
      );
      const advanced = await this.database.query<DbRow>(
        `UPDATE export_presets
         SET normalized_name = $1, current_version = $2,
             entity_version = $3, updated_at = $4
         WHERE id = $5 AND entity_version = $6
         RETURNING id`,
        [
          normalizedName,
          nextPresetVersion,
          nextEntityVersion,
          now,
          input.presetId,
          input.expectedEntityVersion,
        ],
      );
      if (!advanced.rows[0]) {
        throw new CatalogConflictError(
          "This preset changed elsewhere. Reload it before creating a revision.",
        );
      }
      const response = ExportPresetCatalogEntrySchema.parse({
        id: input.presetId,
        scope,
        ...(scope === "project" ? { projectId: ownerId } : {}),
        currentVersion: nextPresetVersion,
        entityVersion: nextEntityVersion,
        current: {
          presetId: input.presetId,
          presetVersion: nextPresetVersion,
          name: input.name,
          description: input.description,
          settings: input.settings,
          createdBy: actor.userId,
          createdAt: now,
        },
        createdBy: preset.created_by,
        createdAt: iso(preset.created_at),
        updatedAt: now,
      });
      if (scope === "project") {
        await this.insertExportPresetSyncEvent(
          ownerId,
          "export_preset.revised",
          input.presetId,
          nextEntityVersion,
          { presetId: input.presetId, presetVersion: nextPresetVersion },
          now,
        );
      }
      await this.writeExportPresetReceipt(
        actor,
        scope,
        ownerId,
        "revise",
        input.idempotencyKey,
        input,
        response,
        now,
      );
      return response;
    });
  }

  private async setExportPresetDefault(
    actor: AuthenticatedActor,
    scope: ExportPresetScope,
    ownerId: string,
    input: SetExportPresetDefaultRequest,
  ): Promise<ExportPresetDefault> {
    const replay = await this.readExportPresetReceipt(
      actor,
      scope,
      ownerId,
      "set_default",
      input.idempotencyKey,
      input,
    );
    if (replay) return ExportPresetDefaultSchema.parse(replay);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const concurrentReplay = await this.readExportPresetReceipt(
        actor,
        scope,
        ownerId,
        "set_default",
        input.idempotencyKey,
        input,
      );
      if (concurrentReplay)
        return ExportPresetDefaultSchema.parse(concurrentReplay);
      const preset = await this.findOwnedExportPreset(
        scope,
        ownerId,
        input.presetId,
      );
      if (!preset) throw new CatalogNotFoundError("Export preset not found.");
      const revisionResult = await this.database.query<DbRow>(
        `SELECT * FROM export_preset_versions
         WHERE preset_id = $1 AND version = $2`,
        [input.presetId, input.presetVersion],
      );
      const revision = revisionResult.rows[0];
      if (!revision)
        throw new CatalogNotFoundError("Export preset revision not found.");
      const existing = await this.getExportPresetDefault(scope, ownerId);
      const currentEntityVersion = existing?.entityVersion ?? 0;
      if (currentEntityVersion !== input.expectedEntityVersion) {
        throw new CatalogConflictError(
          "The default changed elsewhere. Reload it before saving.",
        );
      }
      const nextEntityVersion = currentEntityVersion + 1;
      const table =
        scope === "personal"
          ? "personal_export_preset_defaults"
          : "project_export_preset_defaults";
      const ownerColumn = scope === "personal" ? "user_id" : "project_id";
      await this.database.query(
        `INSERT INTO ${table}
           (${ownerColumn}, preset_id, preset_version, entity_version,
            updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (${ownerColumn}) DO UPDATE
         SET preset_id = EXCLUDED.preset_id,
             preset_version = EXCLUDED.preset_version,
             entity_version = EXCLUDED.entity_version,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at`,
        [
          ownerId,
          input.presetId,
          input.presetVersion,
          nextEntityVersion,
          actor.userId,
          now,
        ],
      );
      const response = ExportPresetDefaultSchema.parse({
        scope,
        ...(scope === "project" ? { projectId: ownerId } : {}),
        presetId: input.presetId,
        presetVersion: input.presetVersion,
        entityVersion: nextEntityVersion,
        snapshot: {
          presetId: input.presetId,
          presetVersion: input.presetVersion,
          name: revision.name,
          settings: revision.settings_snapshot,
        },
        description: revision.description,
        updatedBy: actor.userId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      if (scope === "project") {
        await this.insertExportPresetSyncEvent(
          ownerId,
          "export_preset.default_set",
          input.presetId,
          nextEntityVersion,
          { presetId: input.presetId, presetVersion: input.presetVersion },
          now,
        );
      }
      await this.writeExportPresetReceipt(
        actor,
        scope,
        ownerId,
        "set_default",
        input.idempotencyKey,
        input,
        response,
        now,
      );
      return response;
    });
  }

  private async findOwnedExportPreset(
    scope: ExportPresetScope,
    ownerId: string,
    presetId: string,
  ): Promise<DbRow | undefined> {
    const ownerColumn = scope === "personal" ? "owner_user_id" : "project_id";
    const result = await this.database.query<DbRow>(
      `SELECT * FROM export_presets
       WHERE id = $1 AND scope = $2 AND ${ownerColumn} = $3`,
      [presetId, scope, ownerId],
    );
    return result.rows[0];
  }

  private async assertExportPresetNameAvailable(
    scope: ExportPresetScope,
    ownerId: string,
    normalizedName: string,
    excludingPresetId?: string,
  ): Promise<void> {
    const ownerColumn = scope === "personal" ? "owner_user_id" : "project_id";
    const result = await this.database.query(
      `SELECT 1 FROM export_presets
       WHERE scope = $1 AND ${ownerColumn} = $2 AND normalized_name = $3
         AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [scope, ownerId, normalizedName, excludingPresetId ?? null],
    );
    if (result.rows[0]) {
      throw new CatalogConflictError(
        "A preset with that name already exists in this catalog.",
      );
    }
  }

  private async readExportPresetReceipt(
    actor: AuthenticatedActor,
    scope: ExportPresetScope,
    ownerId: string,
    commandKind: "create" | "revise" | "set_default",
    idempotencyKey: string,
    input: unknown,
  ): Promise<unknown | undefined> {
    const result = await this.database.query<DbRow>(
      `SELECT request_sha256, response_snapshot
       FROM export_preset_command_receipts
       WHERE scope = $1 AND scope_owner_id = $2 AND actor_user_id = $3
         AND command_kind = $4 AND idempotency_key = $5`,
      [scope, ownerId, actor.userId, commandKind, idempotencyKey],
    );
    const receipt = result.rows[0];
    if (!receipt) return undefined;
    if (receipt.request_sha256 !== exportPresetCommandHash(input)) {
      throw new CatalogIdempotencyConflictError(
        "That idempotency key was already used for a different preset command.",
      );
    }
    return receipt.response_snapshot;
  }

  private async writeExportPresetReceipt(
    actor: AuthenticatedActor,
    scope: ExportPresetScope,
    ownerId: string,
    commandKind: "create" | "revise" | "set_default",
    idempotencyKey: string,
    input: unknown,
    response: unknown,
    now: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO export_preset_command_receipts
         (scope, scope_owner_id, actor_user_id, command_kind, idempotency_key,
          request_sha256, response_snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        scope,
        ownerId,
        actor.userId,
        commandKind,
        idempotencyKey,
        exportPresetCommandHash(input),
        JSON.stringify(response),
        now,
      ],
    );
  }

  private async insertExportPresetSyncEvent(
    projectId: string,
    eventType: string,
    entityId: string,
    serverVersion: number,
    payload: unknown,
    now: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO sync_events
         (project_id, event_type, entity_id, server_version, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        projectId,
        eventType,
        entityId,
        serverVersion,
        JSON.stringify(payload),
        now,
      ],
    );
  }

  private async requireRegistered(actor: AuthenticatedActor) {
    const result = await this.database.query(
      "SELECT 1 FROM users WHERE id = $1 AND external_subject = $2",
      [actor.userId, actor.externalSubject],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("User is not registered.");
  }

  private async findDerivedTranslationLineage(
    identity: DerivedTranslationIdentity,
  ): Promise<DbRow | undefined> {
    const result = await this.database.query<DbRow>(
      `SELECT * FROM transcript_translation_lineages
       WHERE project_id = $1 AND video_id = $2
         AND base_transcript_version_id = $3 AND original_track_id = $4
         AND original_content_sha256 = $5 AND target_primary_language = $6
         AND provider = $7 AND COALESCE(model, '') = COALESCE($8, '')
         AND normalization_schema_version = $9`,
      [
        identity.projectId,
        identity.catalogVideoId,
        identity.baseTranscriptVersionId,
        identity.originalTrackId,
        identity.originalContentSha256,
        primaryLanguage(identity.targetLanguage),
        identity.provider,
        identity.model ?? null,
        identity.normalizationSchemaVersion,
      ],
    );
    return result.rows[0];
  }

  private async assertDerivedTranslationIdentity(
    identity: DerivedTranslationIdentity,
  ): Promise<void> {
    const versionResult = await this.database.query<DbRow>(
      `SELECT id FROM transcript_versions
       WHERE id = $1 AND project_id = $2 AND video_id = $3
         AND finalized_at IS NOT NULL`,
      [
        identity.baseTranscriptVersionId,
        identity.projectId,
        identity.catalogVideoId,
      ],
    );
    if (!versionResult.rows[0]) {
      throw new CatalogValidationError(
        "Derived translation base transcript version is missing or not finalized.",
      );
    }
    const artifactResult = await this.database.query<DbRow>(
      `SELECT * FROM transcript_artifacts
       WHERE transcript_version_id = $1
         AND artifact_type IN ('original-normalized', 'english-normalized')
       ORDER BY CASE artifact_type WHEN 'original-normalized' THEN 0 ELSE 1 END
       LIMIT 1`,
      [identity.baseTranscriptVersionId],
    );
    const artifact = artifactResult.rows[0];
    if (!artifact) {
      throw new CatalogValidationError(
        "The base transcript has no native normalized track.",
      );
    }
    const object = await this.store.get(
      String(artifact.object_key),
      String(artifact.object_version_id),
    );
    if (!object || sha256(object.bytes) !== artifact.sha256) {
      throw new TranscriptIntegrityError(
        "The base transcript native track failed checksum verification.",
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder().decode(object.bytes));
    } catch {
      throw new TranscriptIntegrityError(
        "The base transcript native track is not valid JSON.",
      );
    }
    const original = NormalizedTranscriptSchema.parse(decoded);
    if (
      original.track.id !== identity.originalTrackId ||
      original.track.contentSha256 !== identity.originalContentSha256
    ) {
      throw new CatalogValidationError(
        "Derived translation original track identity does not match its base version.",
      );
    }
    if (languagesEquivalent(original.track.language, identity.targetLanguage)) {
      throw new CatalogValidationError(
        "A supplemental translation cannot duplicate the native language.",
      );
    }
  }

  private async loadClipTags(clipId: string): Promise<string[]> {
    const result = await this.database.query<{ name: string }>(
      `SELECT t.name
       FROM clip_candidate_tags ct
       JOIN clip_tags t ON t.id = ct.tag_id
       WHERE ct.clip_id = $1
       ORDER BY t.normalized_name, t.id`,
      [clipId],
    );
    return result.rows.map((row) => row.name);
  }

  private async loadClipLanguageEvidence(
    clipId: string,
  ): Promise<ClipLanguageEvidence | undefined> {
    const result = await this.database.query<DbRow>(
      `SELECT role, language, text, track_id, track_version,
              source_track_id, timing_precision
       FROM clip_language_evidence
       WHERE clip_id = $1
       ORDER BY CASE role
         WHEN 'native' THEN 0 WHEN 'english' THEN 1 ELSE 2 END`,
      [clipId],
    );
    if (!result.rows.length) return undefined;
    const snapshots = new Map(
      result.rows.map((row) => [
        String(row.role),
        {
          role: row.role,
          language: row.language,
          text: row.text,
          trackId: row.track_id,
          trackVersion: Number(row.track_version),
          ...(row.source_track_id
            ? { sourceTrackId: row.source_track_id }
            : {}),
          timingPrecision: row.timing_precision,
        },
      ]),
    );
    return ClipLanguageEvidenceV2Schema.parse({
      schemaVersion: 2,
      native: snapshots.get("native"),
      english: snapshots.get("english"),
      ...(snapshots.has("preferred")
        ? { preferred: snapshots.get("preferred") }
        : {}),
    });
  }

  private async requireActiveWorkerLease(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
  ): Promise<DbRow> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      "SELECT * FROM worker_leases WHERE job_id = $1",
      [jobId],
    );
    const lease = result.rows[0];
    if (!lease || String(lease.worker_id) !== actor.userId) {
      throw new AuthorizationError("This worker does not own the job lease.");
    }
    if (
      Number(lease.attempt) !== attempt ||
      new Date(iso(lease.expires_at)).getTime() <= this.now().getTime()
    ) {
      throw new CatalogConflictError("The worker lease is stale or expired.");
    }
    return lease;
  }

  private async loadLoggedExportProgress(
    executionId: string,
  ): Promise<{ progress?: LoggedExportProgressSnapshot }> {
    const result = await this.database.query<DbRow>(
      "SELECT * FROM logged_export_execution_progress WHERE execution_id = $1",
      [executionId],
    );
    return result.rows[0]
      ? { progress: mapLoggedExportProgress(result.rows[0]) }
      : {};
  }

  private async persistLoggedExportProgress(
    progress: LoggedExportProgressSnapshot,
  ): Promise<void> {
    const currentResult = await this.database.query<DbRow>(
      "SELECT * FROM logged_export_execution_progress WHERE execution_id = $1 FOR UPDATE",
      [progress.executionId],
    );
    const current = currentResult.rows[0];
    const stageRank = LoggedExportProgressStageRank[progress.stage];
    if (current) {
      const mapped = mapLoggedExportProgress(current);
      if (progress.sequence === mapped.sequence) {
        if (
          progress.requestId === mapped.requestId &&
          progress.attempt === mapped.attempt &&
          progress.stage === mapped.stage &&
          progress.basisPoints === mapped.basisPoints &&
          progress.updatedAt === mapped.updatedAt
        ) {
          return;
        }
        throw new CatalogConflictError(
          "A progress sequence can only replay its original snapshot.",
        );
      }
      if (
        progress.requestId !== mapped.requestId ||
        progress.attempt !== mapped.attempt ||
        progress.sequence < mapped.sequence ||
        stageRank < LoggedExportProgressStageRank[mapped.stage] ||
        progress.basisPoints < mapped.basisPoints ||
        Date.parse(progress.updatedAt) < Date.parse(mapped.updatedAt)
      ) {
        throw new CatalogConflictError(
          "Logged export progress cannot move backward or change execution identity.",
        );
      }
      await this.database.query(
        `UPDATE logged_export_execution_progress
         SET sequence = $1, stage = $2, stage_rank = $3,
             basis_points = $4, updated_at = $5
         WHERE execution_id = $6`,
        [
          progress.sequence,
          progress.stage,
          stageRank,
          progress.basisPoints,
          progress.updatedAt,
          progress.executionId,
        ],
      );
      return;
    }
    await this.database.query(
      `INSERT INTO logged_export_execution_progress
         (execution_id, export_request_id, attempt, sequence, stage,
          stage_rank, basis_points, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        progress.executionId,
        progress.requestId,
        progress.attempt,
        progress.sequence,
        progress.stage,
        stageRank,
        progress.basisPoints,
        progress.updatedAt,
      ],
    );
  }

  private async authorize(
    actor: AuthenticatedActor,
    projectId: string,
    permission: "read" | "write" | "manage_members",
  ) {
    await this.requireRegistered(actor);
    const result = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, actor.userId],
    );
    requirePermission(result.rows[0]?.role, permission);
  }

  private async transaction<Result>(action: () => Promise<Result>) {
    const predecessor = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      await this.database.exec("BEGIN");
      try {
        const result = await action();
        await this.database.exec("COMMIT");
        return result;
      } catch (error) {
        await this.database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      release();
    }
  }
}

function mapUser(row: DbRow | undefined): User {
  if (!row) throw new CatalogNotFoundError("User not found.");
  return UserSchema.parse({
    id: row.id,
    externalSubject: row.external_subject,
    displayName: row.display_name,
    preferredLanguage: row.preferred_language ?? "en",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapRegisteredExportWorker(row: DbRow): RegisteredExportWorker {
  return RegisteredExportWorkerSchema.parse({
    id: row.id,
    epoch: Number(row.epoch),
    capability:
      typeof row.capability_json === "string"
        ? JSON.parse(row.capability_json)
        : row.capability_json,
    installedCapabilities:
      typeof row.installed_capabilities_json === "string"
        ? JSON.parse(row.installed_capabilities_json)
        : row.installed_capabilities_json,
    advertisementFingerprint: row.advertisement_fingerprint,
    heartbeatAt: iso(row.heartbeat_at),
    expiresAt: iso(row.expires_at),
  });
}

function mapLoggedExportDelivery(row: DbRow): LoggedExportDelivery {
  return LoggedExportDeliverySchema.parse({
    deliveryId: row.delivery_id,
    generation: Number(row.delivery_generation),
    reservationToken: row.reservation_token,
    workerId: row.worker_id,
    workerEpoch: Number(row.worker_epoch),
    status: row.accepted_at ? "accepted" : "reserved",
    reservedAt: iso(row.reserved_at),
    reservationExpiresAt: iso(row.reservation_expires_at),
    ...(row.accepted_at ? { acceptedAt: iso(row.accepted_at) } : {}),
    request: mapLoggedExportRequest(row),
  });
}

function mapLoggedExportSuccess(row: DbRow): LoggedExportSuccess {
  return LoggedExportSuccessSchema.parse({
    id: row.id,
    deliveryId: row.delivery_id,
    generation: Number(row.delivery_generation),
    workerId: row.worker_id,
    workerEpoch: Number(row.worker_epoch),
    result:
      typeof row.result_json === "string"
        ? JSON.parse(row.result_json)
        : row.result_json,
    resultFingerprint: row.result_fingerprint,
    reconciledAt: iso(row.reconciled_at),
  });
}

function mapLoggedExportFailure(row: DbRow): LoggedExportFailure {
  return LoggedExportFailureSchema.parse({
    id: row.id,
    deliveryId: row.delivery_id,
    generation: Number(row.delivery_generation),
    workerId: row.worker_id,
    workerEpoch: Number(row.worker_epoch),
    result:
      typeof row.result_json === "string"
        ? JSON.parse(row.result_json)
        : row.result_json,
    resultFingerprint: row.result_fingerprint,
    reconciledAt: iso(row.reconciled_at),
  });
}

function mapLoggedExportCanceled(row: DbRow): LoggedExportCanceled {
  return LoggedExportCanceledSchema.parse({
    id: row.id,
    ...(row.delivery_id
      ? {
          deliveryId: row.delivery_id,
          generation: Number(row.delivery_generation),
          workerId: row.worker_id,
          workerEpoch: Number(row.worker_epoch),
        }
      : {}),
    result:
      typeof row.result_json === "string"
        ? JSON.parse(row.result_json)
        : row.result_json,
    resultFingerprint: row.result_fingerprint,
    reconciledAt: iso(row.reconciled_at),
  });
}

function mapLoggedExportExecution(row: DbRow) {
  return {
    executionId: String(row.id),
    requestId: String(row.export_request_id),
    attempt: Number(row.attempt),
    workerId: String(row.worker_id),
    workerEpoch: Number(row.worker_epoch),
    leaseToken: String(row.lease_token),
    startedAt: iso(row.started_at),
    heartbeatAt: iso(row.heartbeat_at),
    expiresAt: iso(row.expires_at),
    ...(row.cancel_requested_at
      ? { cancelRequestedAt: iso(row.cancel_requested_at) }
      : {}),
  };
}

function mapLoggedExportProgress(row: DbRow): LoggedExportProgressSnapshot {
  return {
    schemaVersion: 1,
    executionId: String(row.execution_id),
    requestId: String(row.export_request_id),
    attempt: Number(row.attempt),
    sequence: Number(row.sequence),
    stage: String(row.stage) as LoggedExportProgressStage,
    basisPoints: Number(row.basis_points),
    updatedAt: iso(row.updated_at),
  };
}

function assertLoggedExportFailureMatchesRequest(
  row: DbRow,
  result: LoggedExportFailureResult,
): void {
  const request = mapLoggedExportRequest({
    ...row,
    export_success_result_json: undefined,
  });
  if (
    result.requestId !== request.id ||
    result.jobId !== request.jobId ||
    result.projectId !== request.projectId ||
    result.clipId !== request.clipId
  ) {
    throw new CatalogConflictError(
      "Export failure identity does not match the immutable queued request.",
    );
  }
}

function assertLoggedExportCanceledMatchesRequest(
  row: DbRow,
  result: LoggedExportCanceledResult,
): void {
  const request = mapLoggedExportRequest({
    ...row,
    export_success_result_json: undefined,
  });
  if (
    result.requestId !== request.id ||
    result.jobId !== request.jobId ||
    result.projectId !== request.projectId ||
    result.clipId !== request.clipId
  ) {
    throw new CatalogConflictError(
      "Export cancellation identity does not match the immutable request.",
    );
  }
}

function assertLoggedExportRetryParentEvidence(
  row: DbRow,
  request: ExportRequest,
): void {
  if (
    request.mode !== "logged" ||
    !request.projectId ||
    !request.clipId ||
    !request.resolvedSettingsSnapshot ||
    !row.retry_failure_id ||
    !row.retry_delivery_id ||
    !row.retry_delivery_accepted_at ||
    row.retry_success_id
  ) {
    throw new CatalogConflictError(
      "Only an exact terminal failed logged export can be retried.",
    );
  }
  const failure = LoggedExportFailureResultSchema.parse(
    typeof row.retry_failure_result_json === "string"
      ? JSON.parse(row.retry_failure_result_json)
      : row.retry_failure_result_json,
  );
  if (
    failure.requestId !== request.id ||
    failure.jobId !== request.jobId ||
    failure.projectId !== request.projectId ||
    failure.clipId !== request.clipId ||
    Number(row.retry_failure_generation) !==
      Number(row.retry_delivery_generation) ||
    String(row.retry_failure_worker_id) !==
      String(row.retry_delivery_worker_id) ||
    Number(row.retry_failure_worker_epoch) !==
      Number(row.retry_delivery_worker_epoch)
  ) {
    throw new CatalogConflictError(
      "The immutable failure and accepted delivery do not match the retry parent.",
    );
  }
  const payload =
    typeof row.retry_parent_job_payload === "string"
      ? JSON.parse(row.retry_parent_job_payload)
      : row.retry_parent_job_payload;
  const expectedPayload = {
    exportRequestId: request.id,
    mode: "logged",
    clipId: request.clipId,
    video: request.video,
    selection: request.selection,
    sourceLanguageClass: request.sourceLanguageClass,
    ...(request.subtitleTracks
      ? { subtitleTracks: request.subtitleTracks }
      : {}),
    preset: request.preset,
    resolvedSettingsSnapshot: request.resolvedSettingsSnapshot,
    ...(request.retryOfRequestId
      ? {
          retryOfRequestId: request.retryOfRequestId,
          retryOrdinal: request.retryOrdinal,
        }
      : {}),
  };
  if (canonicalJson(payload) !== canonicalJson(expectedPayload)) {
    throw new CatalogConflictError(
      "The retry parent job payload does not match its immutable request snapshots.",
    );
  }
}

function assertRetryableLoggedExportParent(row: DbRow): void {
  if (
    String(row.state) !== "failed" ||
    String(row.retry_clip_export_status) !== "failed"
  ) {
    throw new CatalogConflictError(
      "Only an exact terminal failed logged export can be retried.",
    );
  }
}

function assertLoggedExportSuccessMatchesRequest(
  row: DbRow,
  result: LoggedExportSuccessResult,
): void {
  const request = mapLoggedExportRequest({
    ...row,
    export_success_result_json: undefined,
  });
  if (
    result.requestId !== request.id ||
    result.jobId !== request.jobId ||
    result.projectId !== request.projectId ||
    result.clipId !== request.clipId ||
    result.sourceLanguageClass !== request.sourceLanguageClass
  ) {
    throw new CatalogConflictError(
      "Export result identity does not match the immutable queued request.",
    );
  }
  const snapshot = request.resolvedSettingsSnapshot;
  const observed = result.renderedMediaProvenance.observedProperties;
  if (
    !snapshot ||
    !observed ||
    result.renderedMediaProvenance.settingsSha256 !==
      sha256Fingerprint(snapshot.settings)
  ) {
    throw new CatalogConflictError(
      "Export result settings provenance does not match the immutable queued request.",
    );
  }
  const expectedFormat =
    snapshot.settings.container === "mkv"
      ? "matroska"
      : snapshot.settings.container;
  const expectedVideoRole = `video_${snapshot.settings.container}`;
  const videoArtifacts = result.artifacts.filter((artifact) =>
    artifact.role.startsWith("video_"),
  );
  if (
    !observed.container.formatNames.includes(expectedFormat) ||
    observed.video.codec !== snapshot.settings.videoCodec ||
    observed.audio.codec !== snapshot.settings.audioCodec ||
    videoArtifacts.length !== 1 ||
    videoArtifacts[0]!.role !== expectedVideoRole
  ) {
    throw new CatalogConflictError(
      "Export result media family does not match the immutable resolved settings.",
    );
  }
  const bounds = result.resolvedExportBounds;
  const expectedDuration = bounds.endMs - bounds.startMs;
  if (
    bounds.startMs !== request.selection.exportStartMs ||
    bounds.endMs > request.selection.exportEndMs ||
    Math.abs(result.renderedMediaProvenance.durationMs - expectedDuration) >
      250 ||
    observed.durationMs !== result.renderedMediaProvenance.durationMs ||
    result.thumbnailProvenance.extractionTimeMs >=
      result.renderedMediaProvenance.durationMs
  ) {
    throw new CatalogConflictError(
      "Export result bounds or duration do not match the immutable requested range.",
    );
  }

  if (request.sourceLanguageClass === "confirmed_english") {
    const shouldOmit = snapshot.settings.omitSubtitleFilesForConfirmedEnglish;
    const omitted = Boolean(result.subtitleOmissionProvenance);
    if (omitted !== shouldOmit) {
      throw new CatalogConflictError(
        "Confirmed-English result omission does not match the immutable setting.",
      );
    }
    if (!shouldOmit) {
      const expectedEnglish = request.subtitleTracks?.english ?? {
        trackId: request.selection.trackId,
        trackVersion: request.selection.transcriptVersion,
      };
      const actualEnglish = result.englishSubtitleProvenance;
      if (
        !actualEnglish ||
        actualEnglish.trackId !== expectedEnglish.trackId ||
        actualEnglish.trackVersion !== expectedEnglish.trackVersion
      ) {
        throw new CatalogConflictError(
          "English subtitle result does not match the immutable transcript snapshot.",
        );
      }
    }
    return;
  }

  const snapshots = request.subtitleTracks;
  const original = result.subtitleSidecars?.find(
    (sidecar) => sidecar.role === "original",
  );
  const english = result.subtitleSidecars?.find(
    (sidecar) => sidecar.role === "english",
  );
  if (
    !snapshots ||
    !original ||
    !english ||
    original.trackId !== snapshots.original.trackId ||
    original.trackVersion !== snapshots.original.trackVersion ||
    english.trackId !== snapshots.english.trackId ||
    english.trackVersion !== snapshots.english.trackVersion ||
    primaryLanguage(english.language) !== "en"
  ) {
    throw new CatalogConflictError(
      "Bilingual result does not match the immutable transcript snapshots.",
    );
  }
}

function sameExportWorkerAdvertisement(
  row: DbRow,
  input: RegisterExportWorkerRequest,
): boolean {
  return (
    String(row.advertisement_fingerprint) === input.advertisementFingerprint
  );
}

function mapExportPresetEntry(row: DbRow): ExportPresetCatalogEntry {
  return ExportPresetCatalogEntrySchema.parse({
    id: row.id,
    scope: row.scope,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    currentVersion: Number(row.current_version),
    entityVersion: Number(row.entity_version),
    current: {
      presetId: row.id,
      presetVersion: Number(row.current_version),
      name: row.revision_name,
      description: row.revision_description,
      settings: row.revision_settings,
      createdBy: row.revision_created_by,
      createdAt: iso(row.revision_created_at),
    },
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapExportPresetDefault(
  scope: ExportPresetScope,
  ownerId: string,
  row: DbRow,
): ExportPresetDefault {
  return ExportPresetDefaultSchema.parse({
    scope,
    ...(scope === "project" ? { projectId: ownerId } : {}),
    presetId: row.preset_id,
    presetVersion: Number(row.preset_version),
    entityVersion: Number(row.entity_version),
    snapshot: {
      presetId: row.preset_id,
      presetVersion: Number(row.preset_version),
      name: row.revision_name,
      settings: row.revision_settings,
    },
    description: row.revision_description,
    updatedBy: row.updated_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function normalizePresetName(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function exportPresetCommandHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapProject(row: DbRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapDerivedTranslationJob(
  row: DbRow | undefined,
): DerivedTranslationJob {
  if (!row) throw new CatalogNotFoundError("Translation job not found.");
  return DerivedTranslationJobSchema.parse({
    id: row.id,
    lineageId: row.lineage_id,
    state: row.state,
    attempt: Number(row.attempt),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapClipCandidate(
  row: DbRow,
  tags: string[],
  languageEvidence?: ClipLanguageEvidence,
): ClipCandidate {
  const evidence =
    languageEvidence ??
    ({
      schemaVersion: 1,
      englishText: String(row.english_text),
      ...(row.original_text ? { originalText: String(row.original_text) } : {}),
    } satisfies ClipLanguageEvidence);
  return ClipCandidateSchema.parse({
    id: row.id,
    projectId: row.project_id,
    catalogVideoId: row.video_id,
    video: {
      youtubeVideoId: row.youtube_video_id,
      canonicalUrl: row.canonical_url,
      title: row.video_title,
      ...(row.video_channel ? { channel: row.video_channel } : {}),
      ...(row.source_language ? { sourceLanguage: row.source_language } : {}),
    },
    selection: {
      trackId: row.transcript_track_id,
      transcriptVersion: Number(row.transcript_version),
      firstSegmentId: row.first_segment_id,
      lastSegmentId: row.last_segment_id,
      ...(row.first_token_id ? { firstTokenId: row.first_token_id } : {}),
      ...(row.last_token_id ? { lastTokenId: row.last_token_id } : {}),
      transcriptStartMs: Number(row.transcript_start_ms),
      transcriptEndMs: Number(row.transcript_end_ms),
      exportStartMs: Number(row.export_start_ms),
      exportEndMs: Number(row.export_end_ms),
      text: row.selection_text ?? row.english_text,
      timingPrecision: row.timing_precision,
    },
    languageEvidence: evidence,
    englishText: row.english_text,
    ...(row.original_text ? { originalText: row.original_text } : {}),
    notes: row.notes,
    tags,
    researchStatus: row.research_status,
    exportStatus: row.export_status,
    createdBy: row.created_by,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapLoggedExportRequest(row: DbRow): ExportRequest {
  const success = row.export_success_result_json
    ? LoggedExportSuccessResultSchema.parse(
        typeof row.export_success_result_json === "string"
          ? JSON.parse(row.export_success_result_json)
          : row.export_success_result_json,
      )
    : undefined;
  return ExportRequestSchema.parse({
    id: row.id,
    jobId: row.job_id,
    mode: row.mode,
    projectId: row.project_id,
    clipId: row.clip_id,
    ...(row.retry_of_request_id
      ? {
          retryOfRequestId: row.retry_of_request_id,
          retryOrdinal: Number(row.retry_ordinal),
        }
      : {}),
    video: row.video_snapshot,
    selection: row.selection_snapshot,
    sourceLanguageClass: row.source_language_class,
    ...(row.subtitle_tracks_snapshot
      ? { subtitleTracks: row.subtitle_tracks_snapshot }
      : {}),
    preset: row.preset_snapshot,
    resolvedSettingsSnapshot: row.resolved_settings_snapshot,
    ...(success
      ? {
          resolvedExportBounds: success.resolvedExportBounds,
          renderedMediaProvenance: success.renderedMediaProvenance,
          thumbnailProvenance: success.thumbnailProvenance,
          ...(success.subtitleOmissionProvenance
            ? {
                subtitleOmissionProvenance: success.subtitleOmissionProvenance,
              }
            : {}),
          ...(success.englishSubtitleProvenance
            ? {
                englishSubtitleProvenance: success.englishSubtitleProvenance,
              }
            : {}),
          ...(success.subtitleSidecars
            ? { subtitleSidecars: success.subtitleSidecars }
            : {}),
          finalArtifacts: success.artifacts,
        }
      : {}),
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function normalizeTagName(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function uniqueTagNames(values: readonly string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeTagName(value);
    if (!unique.has(normalized)) unique.set(normalized, value.trim());
  }
  return [...unique.values()];
}

function csvRow(values: readonly (string | number)[]) {
  return values.map(csvCell).join(",");
}

function csvCell(value: string | number) {
  const text = String(value);
  const formulaSafe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

function mapVideo(row: DbRow | undefined): Video {
  if (!row) throw new CatalogNotFoundError("Video not found.");
  return VideoSchema.parse({
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    canonicalUrl: row.canonical_url,
    title: row.title,
    ...(row.channel === null ? {} : { channel: row.channel }),
    ...(row.duration_ms === null
      ? {}
      : { durationMs: Number(row.duration_ms) }),
    ...(row.source_language === null
      ? {}
      : { sourceLanguage: row.source_language }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapBatchItem(row: DbRow): TranscriptionBatchItem {
  return TranscriptionBatchItemSchema.parse({
    id: row.id,
    batchId: row.batch_id,
    inputIndex: Number(row.input_index),
    input: row.raw_input,
    status: row.preflight_status,
    processingNeed: row.processing_need,
    ...(row.youtube_video_id === null
      ? {}
      : { youtubeVideoId: row.youtube_video_id }),
    ...(row.canonical_url === null ? {} : { canonicalUrl: row.canonical_url }),
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.channel === null ? {} : { channel: row.channel }),
    ...(row.duration_ms === null
      ? {}
      : { durationMs: Number(row.duration_ms) }),
    ...(row.source_language === null
      ? {}
      : { sourceLanguage: row.source_language }),
    ...(row.catalog_video_id === null
      ? {}
      : { catalogVideoId: row.catalog_video_id }),
    ...(row.active_transcript_version_id === null
      ? {}
      : { activeTranscriptVersionId: row.active_transcript_version_id }),
    ...(row.duplicate_of_input_index === null
      ? {}
      : { duplicateOfInputIndex: Number(row.duplicate_of_input_index) }),
    ...(row.error_code === null
      ? {}
      : {
          error: {
            code: row.error_code,
            message: row.error_message,
            ...(row.error_retryable === null
              ? {}
              : { retryable: Boolean(row.error_retryable) }),
          },
        }),
    state: row.state,
    reviewStatus: row.review_status,
    ...(row.job_id === null ? {} : { jobId: row.job_id }),
    ...(row.idempotency_key === null
      ? {}
      : { idempotencyKey: row.idempotency_key }),
    ...(row.source_plan === null ? {} : { sourcePlan: row.source_plan }),
    ...(row.source_resolved_at === null
      ? {}
      : { sourceResolvedAt: iso(row.source_resolved_at) }),
    attempt: Number(row.attempt),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapReviewInboxItem(row: DbRow): ReviewInboxItem {
  return ReviewInboxItemSchema.parse({
    ...mapBatchItem(row),
    batchName: row.batch_name,
  });
}

function summarizeProgress(items: readonly TranscriptionBatchItem[]): {
  total: number;
  queued: number;
  active: number;
  readyForReview: number;
  blocked: number;
  failed: number;
  retryableFailed: number;
  canceled: number;
  unreviewed: number;
  reviewing: number;
  reviewed: number;
  skipped: number;
} {
  const countState = (state: TranscriptionBatchItem["state"]) =>
    items.filter((item) => item.state === state).length;
  const activeStates = new Set<TranscriptionBatchItem["state"]>([
    "resolving",
    "acquiring",
    "transcribing",
    "translating",
    "aligning",
    "uploading",
  ]);
  const countReview = (status: TranscriptionBatchItem["reviewStatus"]) =>
    items.filter(
      (item) =>
        item.state === "ready_for_review" && item.reviewStatus === status,
    ).length;
  return {
    total: items.length,
    queued: countState("queued"),
    active: items.filter((item) => activeStates.has(item.state)).length,
    readyForReview: countState("ready_for_review"),
    blocked: countState("blocked"),
    failed: countState("failed"),
    retryableFailed: items.filter(
      (item) => item.state === "failed" && item.error?.retryable === true,
    ).length,
    canceled: countState("canceled"),
    unreviewed: countReview("unreviewed"),
    reviewing: countReview("reviewing"),
    reviewed: countReview("reviewed"),
    skipped: countReview("skipped"),
  };
}

function mapJob(row: DbRow) {
  return JobSchema.parse({
    id: row.id,
    kind: row.kind,
    state: row.state,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    idempotencyKey: row.idempotency_key,
    attempt: Number(row.attempt),
    payload:
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function summarizePreflight(items: readonly BatchPreflightItem[]) {
  return BatchPreflightSummarySchema.parse({
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    existingTranscripts: items.filter(
      (item) => item.status === "existing-transcript",
    ).length,
    duplicates: items.filter((item) => item.status === "duplicate").length,
    unsupported: items.filter((item) => item.status === "unsupported").length,
    metadataFailed: items.filter((item) => item.status === "metadata-failed")
      .length,
  });
}
