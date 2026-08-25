import { createHash, randomUUID } from "node:crypto";

import {
  AuthorizationError,
  requirePermission,
  requireProjectRoleAssignment,
} from "@research-video/auth";
import {
  asCloudDatabase,
  type CloudDatabase,
  type CloudDatabaseInput,
} from "@research-video/db-cloud";
import {
  ActiveTranscriptBundleSchema,
  ActivateManualTimedTranscriptCandidateRequestSchema,
  ArtifactVersionHistoryResponseSchema,
  ArtifactVersionHistoryQuerySchema,
  ArtifactVersionSummarySchema,
  ArtifactCompatibilityResolutionSchema,
  AcceptLoggedExportDeliveryRequestSchema,
  CancelLoggedExportRequestSchema,
  CancelLoggedExportResponseSchema,
  CancelTranscriptionBatchItemRequestSchema,
  CancelTranscriptionBatchItemResponseSchema,
  RetryTranscriptionBatchItemRequestSchema,
  RetryTranscriptionBatchItemResponseSchema,
  ArchiveTranscriptionBatchRequestSchema,
  ArchiveTranscriptionBatchResponseSchema,
  BatchPreflightSummarySchema,
  ClaimedTranscriptionJobSchema,
  ClipCandidateSchema,
  ClipSelectionSchema,
  ClipCommentListQuerySchema,
  ClipCommentPageSchema,
  ClipCommentSchema,
  ClipFollowSchema,
  ClipCommentNoticePageSchema,
  ClipCommentNoticeSchema,
  AuthoringBuildSnapshotSchema,
  CreateAuthoringBuildSnapshotRequestSchema,
  ClipLibraryPageSchema,
  ClipLibraryQuerySchema,
  ClipLanguageEvidenceV2Schema,
  CreateClipCandidateRequestSchema,
  CreateClipCandidateResponseSchema,
  CreateClipCommentRequestSchema,
  DeleteClipCommentRequestSchema,
  ModerateClipCommentRequestSchema,
  UpdateClipFollowRequestSchema,
  MarkClipCommentNoticeSeenRequestSchema,
  NotificationEventSchema,
  NotificationFeedPageSchema,
  NotificationFeedQuerySchema,
  sanitizeNotificationLabel,
  UpdateClipCommentRequestSchema,
  DerivedTranslationJobSchema,
  DerivedTranslationIdentitySchema,
  DerivedTranslationManifestSchema,
  DerivedTranslationSchema,
  NormalizedTranscriptSchema,
  PublishDerivedTranslationRequestSchema,
  RequestDerivedTranslationSchema,
  CreateTranscriptionBatchResponseSchema,
  CreateClipExportRequestSchema,
  ReexportArtifactVersionRequestSchema,
  CreateLoggedExportBatchRequestSchema,
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
  LoggedExportBatchSchema,
  LoggedExportBatchListResponseSchema,
  ReconcileLoggedExportFailureRequestSchema,
  ReconcileLoggedExportSuccessRequestSchema,
  ReconcileLoggedExportCanceledRequestSchema,
  RetryLoggedExportRequestSchema,
  RetryLoggedExportResponseSchema,
  StartLoggedExportExecutionRequestSchema,
  StartLoggedExportExecutionResponseSchema,
  ExportSettingsSchema,
  ResolvedExportSettingsSnapshotSchema,
  ExportWorkerCompatibilityRequestSchema,
  HeartbeatExportWorkerRequestSchema,
  HostedTranscriptionApprovalResponseSchema,
  RegisterExportWorkerRequestSchema,
  RegisteredExportWorkerSchema,
  RevokeExportWorkerRequestSchema,
  ExportWorkerAvailabilityResponseSchema,
  CreateProjectVideoLanguageDecisionRequestSchema,
  LanguageDecisionSnapshotSchema,
  LanguageGateSchema,
  LanguageTagSchema,
  ProjectVideoLanguageDecisionResponseSchema,
  ProjectVideoLanguageDecisionSchema,
  ProviderLanguageEvidenceSchema,
  ExportPresetCatalogEntrySchema,
  ExportPresetDefaultSchema,
  PersonalExportPresetCatalogSchema,
  ProjectExportPresetCatalogSchema,
  JobSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ProjectInvitationSchema,
  ProjectMemberSummarySchema,
  OpenProjectDiscoverySchema,
  ProjectGovernanceEventSchema,
  ProjectVideoOwnFlagResponseSchema,
  ProjectVideoClaimResponseSchema,
  ProjectVideoGovernanceResponseSchema,
  BulkUpdateProjectVideoPriorityRequestSchema,
  BulkUpdateProjectVideoPriorityResponseSchema,
  ProjectVideoReviewResponseSchema,
  ProjectVideoTriageResponseSchema,
  ProjectVideoActivityPageSchema,
  ProjectVideoActivityQuerySchema,
  ProjectLocalProcessingStatusSchema,
  ProjectKeywordCatalogSchema,
  SuggestProjectKeywordRequestSchema,
  SuggestProjectKeywordResponseSchema,
  ReviewProjectKeywordSuggestionRequestSchema,
  ReviewProjectKeywordSuggestionResponseSchema,
  WithdrawProjectKeywordSuggestionRequestSchema,
  WithdrawProjectKeywordSuggestionResponseSchema,
  UpdateProjectKeywordRequestSchema,
  UpdateProjectKeywordResponseSchema,
  UpdateProjectKeywordAliasRequestSchema,
  UpdateProjectKeywordAliasResponseSchema,
  ProjectBookmarkQuerySchema,
  ProjectBookmarkPageSchema,
  ProjectBookmarkMutationResponseSchema,
  CreateProjectBookmarkRequestSchema,
  UpdateProjectBookmarkRequestSchema,
  ChangeProjectBookmarkStateRequestSchema,
  ClaimProjectKeywordScanRequestSchema,
  ProjectKeywordScanClaimSchema,
  ProjectKeywordScanJobSchema,
  ProjectKeywordScanSummarySchema,
  ProjectKeywordMatchArtifactSchema,
  ProjectKeywordScannerSchemaVersion,
  HeartbeatProjectKeywordScanRequestSchema,
  GetProjectKeywordScanInputRequestSchema,
  ProjectKeywordScanInputSnapshotSchema,
  FinalizeProjectKeywordScanRequestSchema,
  FailProjectKeywordScanRequestSchema,
  CreateProjectKeywordScanArtifactUploadRequestSchema,
  ProjectKeywordScanArtifactUploadGrantSchema,
  ProjectKeywordScanArtifactDownloadTargetSchema,
  UpdateProjectLocalProcessingRequestSchema,
  UpdateProjectLocalProcessingResponseSchema,
  MarkProjectVideoActivitySeenResponseSchema,
  MarkProjectVideoActivitySeenRequestSchema,
  ProjectVideoWorklistPageSchema,
  ProjectVideoWorklistQuerySchema,
  UpdateProjectVideoClaimRequestSchema,
  UpdateProjectVideoGovernanceRequestSchema,
  UpdateProjectVideoReviewRequestSchema,
  UpdateProjectVideoTriageRequestSchema,
  UpdateHostedTranscriptionApprovalRequestSchema,
  ReviewInboxItemSchema,
  ReviewInboxResponseSchema,
  TranscriptManifestSchema,
  FinalizedObjectSchema,
  TranscriptionJobPayloadSchema,
  TranscriptionBatchItemSchema,
  TranscriptUploadGrantSchema,
  TranscriptionBatchListResponseSchema,
  UserSchema,
  VideoSchema,
  WorkerLeaseSchema,
  WorkerHeartbeatResponseSchema,
  WorkerObserveLanguageEvidenceRequestSchema,
  WorkerObserveLanguageEvidenceResponseSchema,
  WorkerTranslateTranscriptResponseSchema,
  CreateManualTimedTranscriptImportRequestSchema,
  FinalizeManualTimedTranscriptImportRequestSchema,
  ManualTimedTranscriptImportStatusSchema,
  ManualTimedTranscriptImportUploadGrantSchema,
  ManualTimedTranscriptFormatSchema,
  ManualTimedTranscriptActivationStatusSchema,
  ManualTimedTranscriptCandidateReviewPageSchema,
  ManualTimedTranscriptCandidateReviewQuerySchema,
  languagesEquivalent,
  normalizeUserHandle,
  normalizeProjectKeywordPhrase,
  normalizeBookmarkSearch,
  primaryLanguage,
  type ActiveTranscriptBundle,
  type ActivateManualTimedTranscriptCandidateRequest,
  type ArtifactVersionHistoryQuery,
  type ArtifactVersionHistoryResponse,
  type ArtifactVersionSummary,
  type ArtifactCompatibilityRequirements,
  type ArtifactCompatibilityResolution,
  type AcceptLoggedExportDeliveryRequest,
  type CancelLoggedExportRequest,
  type CancelLoggedExportResponse,
  type CancelTranscriptionBatchItemRequest,
  type CancelTranscriptionBatchItemResponse,
  type RetryTranscriptionBatchItemRequest,
  type RetryTranscriptionBatchItemResponse,
  type ArchiveTranscriptionBatchRequest,
  type ArchiveTranscriptionBatchResponse,
  type AuthenticatedActor,
  type BatchOptions,
  type BatchPreflightItem,
  type ClaimedTranscriptionJob,
  type CloudTranslationConsent,
  type ClipCandidate,
  type ClipComment,
  type ClipFollow,
  type ClipCommentNoticePage,
  type AuthoringBuildSnapshot,
  type ClipCommentListQuery,
  type ClipCommentPage,
  type ClipLibraryPage,
  type ClipLibraryQuery,
  type ClipLanguageEvidence,
  type CreateClipCandidateRequest,
  type CreateClipCandidateResponse,
  type CreateClipCommentRequest,
  type UpdateClipCommentRequest,
  type DeleteClipCommentRequest,
  type ModerateClipCommentRequest,
  type UpdateClipFollowRequest,
  type MarkClipCommentNoticeSeenRequest,
  type NotificationEvent,
  type NotificationFeedPage,
  type NotificationFeedQuery,
  type CreateAuthoringBuildSnapshotRequest,
  type ClaimLoggedExportDeliveryRequest,
  type ClaimLoggedExportDeliveryResponse,
  type CreateClipExportRequest,
  type ReexportArtifactVersionRequest,
  type CreateTranscriptionBatchResponse,
  type CreateLoggedExportBatchRequest,
  type CreateProjectVideoLanguageDecisionRequest,
  type DerivedTranslation,
  type DerivedTranslationIdentity,
  type DerivedTranslationJob,
  type FinalizeTranscriptRequest,
  type FinalizedObject,
  type ExportRequest,
  type ExportPresetCatalogEntry,
  type ExportPresetDefault,
  type ExportPresetScope,
  type ExportPresetReference,
  type ExportPresetSnapshot,
  type ExportSettingsPreview,
  type ExportWorkerCompatibilityRequest,
  type HeartbeatExportWorkerRequest,
  type HostedTranscriptionApprovalResponse,
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
  type LoggedExportBatch,
  type LoggedExportBatchListResponse,
  type LoggedExportProgressSnapshot,
  type LoggedExportProgressStage,
  type LoggedExportSuccess,
  type LoggedExportSuccessResult,
  type NormalizedTranscript,
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
  type ProjectKind,
  type ProjectRole,
  type ProjectSummary,
  type ProjectInvitation,
  type ProjectMemberSummary,
  type OpenProjectDiscovery,
  type ProjectGovernanceEvent,
  type CreateProjectInvitationRequest,
  type DecideProjectInvitationRequest,
  type RevokeProjectInvitationRequest,
  type JoinOpenProjectRequest,
  type UpdateProjectGovernanceRequest,
  type ProjectLocalProcessingStatus,
  type ProjectKeyword,
  type ProjectKeywordCatalog,
  type ProjectKeywordSuggestion,
  type SuggestProjectKeywordRequest,
  type SuggestProjectKeywordResponse,
  type ReviewProjectKeywordSuggestionRequest,
  type ReviewProjectKeywordSuggestionResponse,
  type WithdrawProjectKeywordSuggestionRequest,
  type WithdrawProjectKeywordSuggestionResponse,
  type UpdateProjectKeywordRequest,
  type UpdateProjectKeywordResponse,
  type UpdateProjectKeywordAliasRequest,
  type UpdateProjectKeywordAliasResponse,
  type ProjectBookmark,
  type ProjectBookmarkQuery,
  type ProjectBookmarkPage,
  type ProjectBookmarkMutationResponse,
  type CreateProjectBookmarkRequest,
  type UpdateProjectBookmarkRequest,
  type ChangeProjectBookmarkStateRequest,
  type ClaimProjectKeywordScanRequest,
  type ProjectKeywordScanClaim,
  type ProjectKeywordScanJob,
  type ProjectKeywordScanSummary,
  type HeartbeatProjectKeywordScanRequest,
  type GetProjectKeywordScanInputRequest,
  type ProjectKeywordScanInputSnapshot,
  type FinalizeProjectKeywordScanRequest,
  type FailProjectKeywordScanRequest,
  type CreateProjectKeywordScanArtifactUploadRequest,
  type ProjectKeywordScanArtifactUploadGrant,
  type ProjectKeywordScanArtifactDownloadTarget,
  type ProjectVideoOwnFlagResponse,
  type ProjectVideoClaimResponse,
  type ProjectVideoGovernanceResponse,
  type BulkUpdateProjectVideoPriorityRequest,
  type BulkUpdateProjectVideoPriorityResponse,
  type ProjectVideoReviewResponse,
  type ProjectVideoTriageResponse,
  type ProjectVideoActivityPage,
  type ProjectVideoActivityQuery,
  type MarkProjectVideoActivitySeenRequest,
  type MarkProjectVideoActivitySeenResponse,
  type ProjectVideoWorklistPage,
  type ProjectVideoWorklistProcessingState,
  type ProjectVideoWorklistQuery,
  type ProjectVisibility,
  type SourceFingerprintEvidence,
  type SourceIdentityV1,
  type SourceProvider,
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
  type UpdateOwnProjectVideoFlagRequest,
  type UpdateProjectVideoClaimRequest,
  type UpdateProjectVideoGovernanceRequest,
  type UpdateProjectVideoReviewRequest,
  type UpdateProjectVideoTriageRequest,
  type UpdateHostedTranscriptionApprovalRequest,
  type UpdateProjectLocalProcessingRequest,
  type UpdateProjectLocalProcessingResponse,
  type UpdateClipCandidateRequest,
  type UpdatePreferredLanguageRequest,
  type TranscriptSourcePlan,
  type LanguageDecisionSnapshot,
  type LanguageGate,
  type ProjectVideoLanguageDecisionResponse,
  type ProviderLanguageEvidence,
  type User,
  type Video,
  type WorkerLease,
  type WorkerHeartbeatResponse,
  type WorkerObserveLanguageEvidenceRequest,
  type WorkerObserveLanguageEvidenceResponse,
  type WorkerTranslateTranscriptResponse,
  type WorkerFailureRequest,
  type WorkerProgressStage,
  type CreateManualTimedTranscriptImportRequest,
  type FinalizeManualTimedTranscriptImportRequest,
  type ManualTimedTranscriptImportStatus,
  type ManualTimedTranscriptImportUploadGrant,
  type ManualTimedTranscriptActivationStatus,
  type ManualTimedTranscriptCandidateReviewPage,
  type ManualTimedTranscriptCandidateReviewQuery,
} from "@research-video/contracts";
import {
  canonicalJson,
  artifactVersionMatchesRequirements,
  exportWorkerAdvertisementFingerprint,
  isRegisterableExportWorkerCapability,
  resolveExportSettings,
  resolvedPresetForCompatibility,
  sha256Fingerprint,
} from "@research-video/export-settings";
import {
  MemoryStagedUploadUrlIssuer,
  type StagedUploadUrlIssuer,
  type StoredObject,
  type TranscriptObjectStore,
} from "@research-video/storage";
import { normalizeManualTimedBilingualImport } from "@research-video/transcript";

export class CatalogNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
}

export class CatalogConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "conflict";
}

export class CatalogInvalidRequestError extends Error {
  readonly statusCode = 400;
  readonly code = "invalid_request";
}

export class TranscriptIntegrityError extends Error {
  readonly statusCode = 422;
  readonly code = "transcript_integrity_failed";
}

export class CatalogValidationError extends Error {
  readonly statusCode = 422;
  readonly code = "invalid_language_evidence";
}

class ManualTimedTranscriptImportError extends Error {
  readonly statusCode = 422;
  constructor(
    readonly code: string,
    message = "Timed transcript import is invalid.",
  ) {
    super(message);
  }
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
  /**
   * The caller verified active transcript artifacts while producing `items`.
   * Preserve a ready item instead of trusting a stale project-video pointer.
   */
  trustVerifiedPreflight?: boolean;
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

const jsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value === "string") {
    try {
      return jsonRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
};

const jsonArray = (value: unknown): unknown[] | undefined => {
  if (typeof value === "string") {
    try {
      return jsonArray(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return Array.isArray(value) ? value : undefined;
};

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const sameFinalizedObject = (
  left: Pick<
    FinalizedObject,
    "type" | "objectKey" | "objectVersionId" | "byteSize" | "sha256"
  >,
  right: Pick<FinalizedObject, "type" | "objectKey" | "byteSize" | "sha256"> & {
    objectVersionId?: string | undefined;
  },
) =>
  left.type === right.type &&
  left.objectKey === right.objectKey &&
  left.objectVersionId === right.objectVersionId &&
  left.byteSize === right.byteSize &&
  left.sha256 === right.sha256;

type ClipLibraryCursor = {
  projectId: string;
  id: string;
  createdAt: string;
  filterFingerprint: string;
};

function makeClipLibraryCursor(cursor: ClipLibraryCursor) {
  return Buffer.from(canonicalJson(cursor)).toString("base64url");
}

function parseClipLibraryCursor(value: string): ClipLibraryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const keys = Object.keys(parsed).sort();
    if (
      canonicalJson(keys) !==
        canonicalJson(["createdAt", "filterFingerprint", "id", "projectId"]) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.filterFingerprint !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        parsed.projectId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        parsed.id,
      ) ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      !/^[a-f0-9]{64}$/u.test(parsed.filterFingerprint)
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as ClipLibraryCursor;
  } catch {
    throw new CatalogInvalidRequestError("Clip Library cursor is invalid.");
  }
}

type ClipCommentCursor = {
  projectId: string;
  clipId: string;
  commentId: string;
  createdAt: string;
};

function makeClipCommentCursor(cursor: ClipCommentCursor) {
  return Buffer.from(canonicalJson(cursor)).toString("base64url");
}

function parseClipCommentCursor(value: string): ClipCommentCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      canonicalJson(Object.keys(parsed).sort()) !==
        canonicalJson(["clipId", "commentId", "createdAt", "projectId"]) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.clipId !== "string" ||
      typeof parsed.commentId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.projectId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.clipId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.commentId,
      ) ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as ClipCommentCursor;
  } catch {
    throw new CatalogInvalidRequestError("Clip comment cursor is invalid.");
  }
}

type ProjectVideoWorklistCursor = {
  projectId: string;
  videoId: string;
  createdAt: string;
  view: NonNullable<ProjectVideoWorklistQuery["view"]>;
};

function makeProjectVideoWorklistCursor(cursor: ProjectVideoWorklistCursor) {
  return Buffer.from(canonicalJson(cursor)).toString("base64url");
}

function parseProjectVideoWorklistCursor(
  value: string,
): ProjectVideoWorklistCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const keys = Object.keys(parsed).sort();
    if (
      canonicalJson(keys) !==
        canonicalJson(["createdAt", "projectId", "videoId", "view"]) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.videoId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !["all", "queue", "reviewed", "dismissed"].includes(parsed.view) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.projectId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.videoId,
      ) ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as ProjectVideoWorklistCursor;
  } catch {
    throw new CatalogInvalidRequestError("Project worklist cursor is invalid.");
  }
}

type ProjectVideoActivityCursor = {
  projectId: string;
  eventId: string;
  createdAt: string;
  state: ProjectVideoActivityQuery["state"];
};

function makeProjectVideoActivityCursor(cursor: ProjectVideoActivityCursor) {
  return Buffer.from(canonicalJson(cursor)).toString("base64url");
}

function parseProjectVideoActivityCursor(
  value: string,
): ProjectVideoActivityCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      canonicalJson(Object.keys(parsed).sort()) !==
        canonicalJson(["createdAt", "eventId", "projectId", "state"]) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !["all", "unread", "seen"].includes(parsed.state) ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as ProjectVideoActivityCursor;
  } catch {
    throw new CatalogInvalidRequestError("Project activity cursor is invalid.");
  }
}

type NotificationFeedCursor = { createdAt: string; id: string };

function makeNotificationFeedCursor(cursor: NotificationFeedCursor) {
  return Buffer.from(canonicalJson(cursor)).toString("base64url");
}

function parseNotificationFeedCursor(value: string): NotificationFeedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      canonicalJson(Object.keys(parsed).sort()) !==
        canonicalJson(["createdAt", "id"]) ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parsed.id,
      )
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as NotificationFeedCursor;
  } catch {
    throw new CatalogInvalidRequestError("Notification cursor is invalid.");
  }
}

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
   delivery_clip.export_status AS delivery_clip_export_status,
   delivery_batch_item.batch_id AS delivery_batch_id
 FROM logged_export_deliveries d
 JOIN export_requests er ON er.id = d.export_request_id
 JOIN jobs j ON j.id = er.job_id
 JOIN clip_candidates delivery_clip ON delivery_clip.id = er.clip_id
 LEFT JOIN logged_export_batch_items delivery_batch_item
   ON delivery_batch_item.id = er.batch_item_id
 LEFT JOIN logged_export_success_results export_success
   ON export_success.export_request_id = er.id`;
const projectInvitationSelect = `SELECT
   pi.id, pi.project_id, p.name AS project_name, pi.invitee_user_id,
   invitee.handle AS invitee_handle, pi.inviter_user_id,
   inviter.handle AS inviter_handle, pi.role, pi.state, pi.version,
   pi.expires_at, pi.created_at, pi.updated_at
 FROM project_invitations pi
 JOIN projects p ON p.id = pi.project_id
 JOIN users invitee ON invitee.id = pi.invitee_user_id
 JOIN users inviter ON inviter.id = pi.inviter_user_id`;

export class SharedProjectCatalog {
  private readonly database: CloudDatabase;

  constructor(
    database: CloudDatabaseInput,
    private readonly store: TranscriptObjectStore,
    private readonly now: () => Date = () => new Date(),
    private readonly uploadUrlIssuer: StagedUploadUrlIssuer = new MemoryStagedUploadUrlIssuer(),
  ) {
    this.database = asCloudDatabase(database);
  }

  private governanceRequestHash(commandType: string, request: unknown): string {
    return createHash("sha256")
      .update(canonicalJson({ commandType, request }))
      .digest("hex");
  }

  private async readGovernanceReplay(
    actor: AuthenticatedActor,
    projectId: string,
    idempotencyKey: string,
    commandType: string,
    request: unknown,
  ): Promise<unknown | undefined> {
    const result = await this.database.query<DbRow>(
      `SELECT project_id, actor_user_id, command_type, request_hash, result_json
       FROM project_governance_commands
       WHERE actor_user_id = $1 AND idempotency_key = $2`,
      [actor.userId, idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (
      row.command_type !== commandType ||
      row.request_hash !== this.governanceRequestHash(commandType, request)
    ) {
      throw new CatalogIdempotencyConflictError(
        "This governance command key was already used for another request.",
      );
    }
    if (row.project_id !== projectId || row.actor_user_id !== actor.userId) {
      throw new CatalogIdempotencyConflictError();
    }
    return typeof row.result_json === "string"
      ? JSON.parse(row.result_json)
      : row.result_json;
  }

  private async storeGovernanceCommand(
    actor: AuthenticatedActor,
    projectId: string,
    idempotencyKey: string,
    commandType: string,
    request: unknown,
    result: unknown,
    now: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO project_governance_commands
         (idempotency_key, project_id, actor_user_id, command_type,
          request_hash, result_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        idempotencyKey,
        projectId,
        actor.userId,
        commandType,
        this.governanceRequestHash(commandType, request),
        JSON.stringify(result),
        now,
      ],
    );
  }

  async registerUser(
    actor: AuthenticatedActor,
    displayName: string,
    requestedHandle?: string,
  ): Promise<User> {
    const now = this.now().toISOString();
    const existing = await this.database.query<DbRow>(
      `SELECT handle FROM users WHERE id = $1 AND external_subject = $2`,
      [actor.userId, actor.externalSubject],
    );
    const handle = normalizeUserHandle(
      requestedHandle ??
        String(
          existing.rows[0]?.handle ??
            `user_${actor.userId.replaceAll("-", "").slice(0, 20)}`,
        ),
    );
    try {
      const result = await this.database.query<DbRow>(
        `INSERT INTO users
           (id, external_subject, handle, normalized_handle, display_name,
            created_at, updated_at)
         VALUES ($1, $2, $3, $3, $4, $5, $5)
         ON CONFLICT (external_subject) DO UPDATE
         SET handle = EXCLUDED.handle,
             normalized_handle = EXCLUDED.normalized_handle,
             display_name = EXCLUDED.display_name,
             updated_at = EXCLUDED.updated_at
         RETURNING id, external_subject, handle, display_name,
                   preferred_language, created_at, updated_at`,
        [actor.userId, actor.externalSubject, handle, displayName.trim(), now],
      );
      return mapUser(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CatalogConflictError("That handle is already in use.");
      }
      throw error;
    }
  }

  async getCurrentUser(actor: AuthenticatedActor): Promise<User> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT id, external_subject, handle, display_name, preferred_language,
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
           AND er.source_rights_snapshot IS NOT NULL
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
           AND er.source_rights_snapshot IS NOT NULL
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
      await this.emitLoggedExportNotification({
        exportRequestId: String(delivery.id),
        status: "completed",
        createdAt: nowIso,
      });
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
      await this.emitLoggedExportNotification({
        exportRequestId: String(delivery.id),
        status: "action_needed",
        createdAt: nowIso,
      });
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
       RETURNING id, external_subject, handle, display_name, preferred_language,
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
    input: {
      name: string;
      description?: string;
      kind?: ProjectKind;
      visibility?: ProjectVisibility;
    },
  ): Promise<Project> {
    await this.requireRegistered(actor);
    const id = randomUUID();
    const now = this.now().toISOString();
    const kind = input.kind ?? "shared";
    const visibility =
      input.visibility ?? (kind === "personal" ? "private" : "invitation_only");
    if (
      (kind === "personal" && visibility !== "private") ||
      (kind === "shared" && visibility === "private")
    ) {
      throw new CatalogValidationError(
        "Project kind and visibility are incompatible.",
      );
    }
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO projects
           (id, name, description, kind, visibility, version, created_by,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $7)`,
        [
          id,
          input.name.trim(),
          input.description?.trim() ?? "",
          kind,
          visibility,
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

  async listProjects(actor: AuthenticatedActor): Promise<ProjectSummary[]> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT p.id, p.name, p.description, p.kind, p.visibility, p.version,
              p.created_at, p.updated_at, pm.role AS current_user_role,
              (SELECT count(*)::integer FROM project_members members
               WHERE members.project_id = p.id) AS member_count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = $1
       ORDER BY p.updated_at DESC`,
      [actor.userId],
    );
    return result.rows.map(mapProjectSummary);
  }

  async getProjectSummary(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectSummary> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT p.id, p.name, p.description, p.kind, p.visibility, p.version,
              p.created_at, p.updated_at, pm.role AS current_user_role,
              (SELECT count(*)::integer FROM project_members members
               WHERE members.project_id = p.id) AS member_count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, actor.userId],
    );
    if (!result.rows[0]) throw new CatalogNotFoundError();
    return mapProjectSummary(result.rows[0]);
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
  ): Promise<CreateClipCandidateResponse> {
    await this.authorize(actor, projectId, "write");
    input = CreateClipCandidateRequestSchema.parse(input);
    const normalizedSelection =
      input.selection.selectionType === "player_time_range"
        ? input.selection
        : { ...input.selection, selectionType: "transcript_range" as const };
    input = { ...input, selection: normalizedSelection };
    const user = await this.getCurrentUser(actor);
    const candidateId = randomUUID();
    const now = this.now().toISOString();
    let persistedCandidateId: string = candidateId;
    const requestFingerprint = sha256Fingerprint(input);
    const evidence = input.languageEvidence;
    if (
      input.firstComment?.sourceTimeMs !== undefined &&
      (input.firstComment.sourceTimeMs < input.selection.exportStartMs ||
        input.firstComment.sourceTimeMs > input.selection.exportEndMs)
    ) {
      throw new CatalogInvalidRequestError(
        "Comment source time must be inside the immutable clip export range.",
      );
    }
    if (
      normalizedSelection.selectionType === "player_time_range" &&
      normalizedSelection.speechStatus === "no_speech" &&
      (normalizedSelection.noSpeechAttestation?.actor.id !== user.id ||
        normalizedSelection.noSpeechAttestation.actor.handle !== user.handle ||
        normalizedSelection.noSpeechAttestation.actor.displayName !==
          user.displayName)
    ) {
      throw new CatalogValidationError(
        "No-speech attestation must identify the current authenticated user snapshot.",
      );
    }
    const transcriptSelection =
      normalizedSelection.selectionType === "player_time_range"
        ? normalizedSelection.transcriptAttachment
        : normalizedSelection;
    if (Boolean(transcriptSelection) !== Boolean(evidence)) {
      throw new CatalogValidationError(
        "Transcript selection and language evidence must be present together.",
      );
    }
    if (!evidence || !transcriptSelection) {
      // Player-origin speech state is authoritative when no exact transcript
      // attachment exists. No preference or track identity is inferred.
    } else {
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
        transcriptSelection.trackId !== displayEvidence.trackId ||
        transcriptSelection.transcriptVersion !==
          displayEvidence.trackVersion ||
        transcriptSelection.timingPrecision !== displayEvidence.timingPrecision
      ) {
        throw new CatalogValidationError(
          "The selected display track changed. Re-resolve or reselect before logging.",
        );
      }
    }

    await this.transaction(async () => {
      const videoId = randomUUID();
      const videoResult = await this.database.query<DbRow>(
        `INSERT INTO videos
           (id, youtube_video_id, canonical_url, title, channel, source_language,
            created_at, updated_at, source_provider, provider_media_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)
         ON CONFLICT (source_provider, provider_media_id) DO UPDATE
         SET canonical_url = EXCLUDED.canonical_url,
             title = EXCLUDED.title,
             channel = EXCLUDED.channel,
             source_language = COALESCE(EXCLUDED.source_language, videos.source_language),
             source_provider = EXCLUDED.source_provider,
             provider_media_id = EXCLUDED.provider_media_id,
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
          input.video.sourceIdentity?.provider ?? "youtube",
          input.video.sourceIdentity?.providerMediaId ??
            input.video.youtubeVideoId,
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
      await this.database.query(
        `INSERT INTO project_video_review_cycles
           (id, project_id, video_id, cycle_number, status, version,
            opened_by, opened_at, updated_at)
         VALUES ($1, $2, $3, 1, 'open', 1, $4, $5, $5)
         ON CONFLICT (project_id, video_id, cycle_number) DO NOTHING`,
        [randomUUID(), projectId, catalogVideoId, actor.userId, now],
      );

      const selection = normalizedSelection;
      const legacySelection =
        selection.selectionType === "transcript_range" ? selection : undefined;
      const noSpeechAttestation =
        selection.selectionType === "player_time_range"
          ? selection.noSpeechAttestation
          : undefined;
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO clip_candidates
           (id, project_id, video_id, youtube_video_id, canonical_url,
            video_title, video_channel, source_language, idempotency_key,
            request_sha256,
            transcript_track_id, transcript_version, first_segment_id,
            last_segment_id, first_token_id, last_token_id,
            transcript_start_ms, transcript_end_ms, export_start_ms,
            export_end_ms, timing_precision, english_text, original_text,
            selection_text, language_evidence_schema_version, notes,
            selection_kind, speech_status, selection_snapshot,
            no_speech_attested_by, no_speech_attested_handle,
            no_speech_attested_display_name, no_speech_attested_at,
            no_speech_attestation_version,
            research_status, export_status, created_by, version, created_at,
            updated_at, source_provider, provider_media_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
                 $26, $27, $28, $29, $30, $31, $32, $33, $34,
                 'candidate', 'not_requested', $35, 1, $36, $36, $37, $38)
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
          requestFingerprint,
          legacySelection?.trackId ?? null,
          legacySelection?.transcriptVersion ?? null,
          legacySelection?.firstSegmentId ?? null,
          legacySelection?.lastSegmentId ?? null,
          legacySelection?.firstTokenId ?? null,
          legacySelection?.lastTokenId ?? null,
          legacySelection?.transcriptStartMs ?? null,
          legacySelection?.transcriptEndMs ?? null,
          selection.exportStartMs,
          selection.exportEndMs,
          legacySelection?.timingPrecision ?? null,
          evidence?.english.text ?? null,
          evidence && evidence.native.trackId === evidence.english.trackId
            ? null
            : (evidence?.native.text ?? null),
          transcriptSelection?.text ?? null,
          evidence ? 2 : 3,
          input.notes,
          selection.selectionType,
          selection.selectionType === "player_time_range"
            ? selection.speechStatus
            : null,
          JSON.stringify(selection),
          noSpeechAttestation?.actor.id ?? null,
          noSpeechAttestation?.actor.handle ?? null,
          noSpeechAttestation?.actor.displayName ?? null,
          noSpeechAttestation?.attestedAt ?? null,
          noSpeechAttestation?.schemaVersion ?? null,
          actor.userId,
          now,
          input.video.sourceIdentity?.provider ?? "youtube",
          input.video.sourceIdentity?.providerMediaId ??
            input.video.youtubeVideoId,
        ],
      );
      const created = Boolean(inserted.rows[0]);
      if (!created) {
        const existing = await this.database.query<DbRow>(
          `SELECT id, request_sha256 FROM clip_candidates
           WHERE project_id = $1 AND idempotency_key = $2`,
          [projectId, input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (!row) {
          throw new CatalogConflictError(
            "The clip could not be resolved after idempotent creation.",
          );
        }
        if (
          (row.request_sha256 &&
            String(row.request_sha256) !== requestFingerprint) ||
          (!row.request_sha256 && input.firstComment)
        ) {
          throw new CatalogIdempotencyConflictError(
            "This clip command identity already belongs to different clip or first-comment evidence.",
          );
        }
        persistedCandidateId = String(row.id);
        return;
      }

      if (evidence) {
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
        `INSERT INTO clip_follows
           (project_id, clip_id, user_id, following, version, updated_at)
         VALUES ($1, $2, $3, true, 1, $4)
         ON CONFLICT (project_id, clip_id, user_id) DO UPDATE
         SET following = true,
             version = clip_follows.version + 1,
             updated_at = EXCLUDED.updated_at`,
        [projectId, candidateId, user.id, now],
      );
      const firstCommentId = input.firstComment ? randomUUID() : undefined;
      if (input.firstComment && firstCommentId) {
        await this.database.query(
          `INSERT INTO clip_comments
             (id, project_id, clip_id, author_id, author_handle,
              author_display_name, body, source_time_ms, initial_comment,
              version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 1, $9, $9)`,
          [
            firstCommentId,
            projectId,
            candidateId,
            user.id,
            user.handle,
            user.displayName,
            input.firstComment.body,
            input.firstComment.sourceTimeMs ?? null,
            now,
          ],
        );
        await this.persistCommentCollaboration({
          projectId,
          clipId: candidateId,
          commentId: firstCommentId,
          commentVersion: 1,
          body: input.firstComment.body,
          actor: user,
          sourceTimeMs: input.firstComment.sourceTimeMs,
          now,
        });
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
            languageEvidence: evidence ?? {
              schemaVersion: 3,
              state: "unavailable",
              reason:
                selection.selectionType === "player_time_range"
                  ? selection.speechStatus
                  : "transcript_unavailable",
            },
          }),
          now,
        ],
      );
      if (firstCommentId) {
        await this.database.query(
          `INSERT INTO sync_events
             (project_id, event_type, entity_id, server_version, payload,
              created_at)
           VALUES ($1, 'clip_comment.created', $2, 1, $3, $4)`,
          [
            projectId,
            firstCommentId,
            JSON.stringify({
              clipId: candidateId,
              commentId: firstCommentId,
              authorId: user.id,
              initialComment: true,
              sourceTimeMs: input.firstComment?.sourceTimeMs ?? null,
            }),
            now,
          ],
        );
      }
    });

    const [clip, initialComment] = await Promise.all([
      this.getClipCandidate(actor, projectId, persistedCandidateId),
      this.database.query<DbRow>(
        `SELECT * FROM clip_comments
         WHERE project_id = $1 AND clip_id = $2 AND initial_comment`,
        [projectId, persistedCandidateId],
      ),
    ]);
    const firstCommentRow = initialComment.rows[0];
    return CreateClipCandidateResponseSchema.parse({
      ...clip,
      ...(firstCommentRow
        ? {
            firstComment: mapClipComment(
              firstCommentRow,
              await this.loadClipCommentMentions(String(firstCommentRow.id)),
            ),
          }
        : {}),
    });
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

  async listClipLibrary(
    actor: AuthenticatedActor,
    projectId: string,
    query: ClipLibraryQuery,
  ): Promise<ClipLibraryPage> {
    await this.authorize(actor, projectId, "read");
    const parsed = ClipLibraryQuerySchema.parse(query);
    return this.transaction(
      async () => {
        const normalizedQuery = parsed.query
          ? parsed.query.normalize("NFKC").toLocaleLowerCase("en-US")
          : undefined;
        const normalizedTopics = [
          ...new Set(
            [...(parsed.topics ?? []), ...(parsed.tag ? [parsed.tag] : [])].map(
              normalizeTagName,
            ),
          ),
        ].sort();
        const filterFingerprint = sha256Fingerprint({
          query: normalizedQuery ?? null,
          topics: normalizedTopics,
          topicMatch: parsed.topicMatch ?? "any",
          researchStatus: parsed.researchStatus ?? null,
          exportStatus: parsed.exportStatus ?? null,
          completed: parsed.completed,
        });
        let cursorCreatedAt: string | undefined;
        let cursorId: string | undefined;
        if (parsed.cursor) {
          const cursor = parseClipLibraryCursor(parsed.cursor);
          if (
            cursor.projectId !== projectId ||
            cursor.filterFingerprint !== filterFingerprint
          ) {
            throw new CatalogInvalidRequestError(
              "Clip Library cursor does not match this project and filter.",
            );
          }
          const boundary = await this.database.query<DbRow>(
            `SELECT created_at FROM clip_candidates
         WHERE id = $1 AND project_id = $2 AND created_at = $3::timestamptz`,
            [cursor.id, projectId, cursor.createdAt],
          );
          if (!boundary.rows[0]) {
            throw new CatalogInvalidRequestError(
              "Clip Library cursor is no longer valid.",
            );
          }
          cursorCreatedAt = cursor.createdAt;
          cursorId = cursor.id;
        }

        const result = await this.database.query<DbRow>(
          `${clipCandidateSelect}
       WHERE c.project_id = $1
         AND ($2::text IS NULL OR
              position($2::text in lower(normalize(c.video_title, NFKC))) > 0 OR
              position($2::text in lower(normalize(c.english_text, NFKC))) > 0 OR
              position($2::text in lower(normalize(coalesce(c.original_text, ''), NFKC))) > 0 OR
              position($2::text in lower(normalize(coalesce(c.selection_text, ''), NFKC))) > 0 OR
              position($2::text in lower(normalize(c.notes, NFKC))) > 0 OR
              EXISTS (
                SELECT 1 FROM clip_candidate_tags candidate_tag
                JOIN clip_tags tag ON tag.id = candidate_tag.tag_id
                WHERE candidate_tag.clip_id = c.id
                  AND position($2::text in lower(normalize(tag.name, NFKC))) > 0
              ) OR EXISTS (
                SELECT 1 FROM clip_comments searchable_comment
                WHERE searchable_comment.project_id = c.project_id
                  AND searchable_comment.clip_id = c.id
                  AND searchable_comment.deleted_at IS NULL
                  AND position($2::text in lower(normalize(searchable_comment.body, NFKC))) > 0
              ))
         AND (cardinality($3::text[]) = 0 OR
              ($4::text = 'any' AND EXISTS (
                SELECT 1 FROM clip_candidate_tags exact_candidate_tag
                JOIN clip_tags exact_tag ON exact_tag.id = exact_candidate_tag.tag_id
                WHERE exact_candidate_tag.clip_id = c.id
                  AND exact_tag.normalized_name = ANY($3::text[])
              )) OR
              ($4::text = 'all' AND (
                SELECT count(DISTINCT exact_tag.normalized_name)
                FROM clip_candidate_tags exact_candidate_tag
                JOIN clip_tags exact_tag ON exact_tag.id = exact_candidate_tag.tag_id
                WHERE exact_candidate_tag.clip_id = c.id
                  AND exact_tag.normalized_name = ANY($3::text[])
              ) = cardinality($3::text[])))
         AND ($5::text IS NULL OR c.research_status = $5::text)
         AND ($6::text IS NULL OR c.export_status = $6::text)
         AND ($7::text = 'any' OR
              ($7::text = 'yes') = EXISTS (
                SELECT 1 FROM export_requests completed_request
                JOIN logged_export_success_results completed_success
                  ON completed_success.export_request_id = completed_request.id
                WHERE completed_request.clip_id = c.id
                  AND completed_request.project_id = c.project_id
              ))
         AND ($8::timestamptz IS NULL OR
              (c.created_at, c.id) < ($8::timestamptz, $9::uuid))
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $10`,
          [
            projectId,
            normalizedQuery ?? null,
            normalizedTopics,
            parsed.topicMatch ?? "any",
            parsed.researchStatus ?? null,
            parsed.exportStatus ?? null,
            parsed.completed,
            cursorCreatedAt ?? null,
            cursorId ?? null,
            parsed.limit + 1,
          ],
        );
        const pageRows = result.rows.slice(0, parsed.limit);
        const entries = await Promise.all(
          pageRows.map(async (row) => {
            const clipId = String(row.id);
            const [tags, languageEvidence, leaves, history, commentActivity] =
              await Promise.all([
                this.loadClipTags(clipId),
                this.loadClipLanguageEvidence(clipId),
                this.loadClipLibraryLeaves(projectId, clipId),
                this.loadClipLibraryHistory(projectId, clipId),
                this.database.query<DbRow>(
                  `SELECT count(*)::text AS comment_count,
                          max(updated_at) AS latest_comment_at,
                          (array_agg(id ORDER BY updated_at DESC, id DESC)
                            FILTER (WHERE deleted_at IS NULL AND
                              ($3::text IS NULL OR position($3::text in lower(normalize(body, NFKC))) > 0)))[1]
                            AS matching_comment_id
                   FROM clip_comments
                   WHERE project_id = $1 AND clip_id = $2`,
                  [projectId, clipId, normalizedQuery ?? null],
                ),
              ]);
            const activity = commentActivity.rows[0];
            const matchingComment = activity?.matching_comment_id
              ? await this.database.query<DbRow>(
                  "SELECT * FROM clip_comments WHERE id = $1 AND deleted_at IS NULL",
                  [activity.matching_comment_id],
                )
              : undefined;
            const matching = matchingComment?.rows[0];
            return {
              clip: mapClipCandidate(row, tags, languageEvidence),
              commentCount: Number(activity?.comment_count ?? 0),
              ...(activity?.latest_comment_at
                ? { latestCommentAt: iso(activity.latest_comment_at) }
                : {}),
              ...(matching && normalizedQuery
                ? {
                    matchingComment: {
                      commentId: matching.id,
                      version: Number(matching.version),
                      author: {
                        id: matching.author_id,
                        handle: matching.author_handle,
                        displayName: matching.author_display_name,
                      },
                      ...(matching.source_time_ms === null
                        ? {}
                        : { sourceTimeMs: Number(matching.source_time_ms) }),
                      excerpt: String(matching.body).slice(0, 500),
                    },
                  }
                : {}),
              currentLeaves: leaves.rows.slice(0, 10).map((leaf) => ({
                requestId: leaf.id,
                jobId: leaf.job_id,
                state: leaf.state,
                requestOrigin: leaf.request_origin
                  ? String(leaf.request_origin)
                  : null,
                ...(leaf.retry_of_request_id
                  ? {
                      retryOfRequestId: leaf.retry_of_request_id,
                      retryOrdinal: Number(leaf.retry_ordinal),
                    }
                  : {}),
                ...(leaf.batch_item_id
                  ? { batchItemId: leaf.batch_item_id }
                  : {}),
                ...(leaf.batch_id ? { batchId: leaf.batch_id } : {}),
                ...(leaf.resolved_settings_snapshot
                  ? {
                      resolvedSettingsSnapshot:
                        ResolvedExportSettingsSnapshotSchema.parse(
                          leaf.resolved_settings_snapshot,
                        ),
                    }
                  : {}),
                ...(leaf.execution_id
                  ? {
                      progress: mapLoggedExportProgress({
                        execution_id: leaf.execution_id,
                        export_request_id: leaf.export_request_id,
                        attempt: leaf.attempt,
                        sequence: leaf.sequence,
                        stage: leaf.stage,
                        basis_points: leaf.basis_points,
                        updated_at: leaf.progress_updated_at,
                      }),
                    }
                  : {}),
                updatedAt: iso(leaf.updated_at),
              })),
              hasMoreLeaves: leaves.rows.length > 10,
              completedVersionCount: history.rows[0]
                ? Number(history.rows[0].completed_count)
                : 0,
              recentArtifactVersions: history.rows.map(
                mapArtifactVersionSummary,
              ),
            };
          }),
        );
        const sync = await this.database.query<{ cursor: string }>(
          `SELECT coalesce(max(sequence), 0)::text AS cursor
       FROM sync_events WHERE project_id = $1`,
          [projectId],
        );
        const last = pageRows[pageRows.length - 1];
        return ClipLibraryPageSchema.parse({
          projectId,
          entries,
          ...(result.rows.length > parsed.limit && last
            ? {
                nextCursor: makeClipLibraryCursor({
                  projectId,
                  id: String(last.id),
                  createdAt: iso(last.created_at),
                  filterFingerprint,
                }),
              }
            : {}),
          syncCursor: sync.rows[0]?.cursor ?? "0",
          fetchedAt: this.now().toISOString(),
        });
      },
      { repeatableRead: true },
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
      "selection_type",
      "speech_status",
      "source_start_ms",
      "source_end_ms",
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
      "comment_count",
      "latest_comment_at",
      "created_at",
      "updated_at",
    ];
    const commentActivity = await this.database.query<DbRow>(
      `SELECT clip_id, count(*)::text AS comment_count,
              max(updated_at) AS latest_comment_at
       FROM clip_comments WHERE project_id = $1
       GROUP BY clip_id`,
      [projectId],
    );
    const commentActivityByClip = new Map(
      commentActivity.rows.map((row) => [String(row.clip_id), row]),
    );
    const rows = clips.map((clip) => {
      const activity = commentActivityByClip.get(clip.id);
      const transcriptSelection =
        clip.selection.selectionType === "player_time_range"
          ? clip.selection.transcriptAttachment
          : clip.selection;
      return [
        project.id,
        project.name,
        clip.id,
        clip.researchStatus,
        clip.exportStatus,
        clip.video.youtubeVideoId,
        clip.video.title,
        clip.video.canonicalUrl,
        clip.video.sourceLanguage ?? "",
        clip.selection.selectionType ?? "transcript_range",
        clip.selection.selectionType === "player_time_range"
          ? clip.selection.speechStatus
          : "speech",
        clip.selection.selectionType === "player_time_range"
          ? clip.selection.sourceStartMs
          : clip.selection.transcriptStartMs,
        clip.selection.selectionType === "player_time_range"
          ? clip.selection.sourceEndMs
          : clip.selection.transcriptEndMs,
        transcriptSelection?.trackId ?? "",
        transcriptSelection?.transcriptVersion ?? "",
        transcriptSelection?.transcriptStartMs ?? "",
        transcriptSelection?.transcriptEndMs ?? "",
        clip.selection.exportStartMs,
        clip.selection.exportEndMs,
        transcriptSelection?.timingPrecision ?? "",
        clip.englishText ?? "",
        clip.originalText ?? "",
        clip.languageEvidence.schemaVersion === 2
          ? (clip.languageEvidence.preferred?.language ?? "")
          : "",
        clip.languageEvidence.schemaVersion === 2
          ? (clip.languageEvidence.preferred?.text ?? "")
          : "",
        clip.notes,
        clip.tags.join(" | "),
        Number(activity?.comment_count ?? 0),
        activity?.latest_comment_at ? iso(activity.latest_comment_at) : "",
        clip.createdAt,
        clip.updatedAt,
      ];
    });
    return [columns, ...rows].map(csvRow).join("\r\n").concat("\r\n");
  }

  async exportClipCommentsCsv(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<string> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT * FROM clip_comments WHERE project_id = $1
       ORDER BY clip_id, created_at, id`,
      [projectId],
    );
    const columns = [
      "project_id",
      "clip_id",
      "comment_id",
      "author_id",
      "author_handle",
      "author_display_name",
      "version",
      "status",
      "body",
      "source_time_ms",
      "created_at",
      "updated_at",
      "deleted_at",
    ];
    const rows: Array<Array<string | number>> = result.rows.map((row) => [
      String(row.project_id),
      String(row.clip_id),
      String(row.id),
      String(row.author_id),
      String(row.author_handle),
      String(row.author_display_name),
      Number(row.version),
      row.deleted_at ? "deleted" : "active",
      row.deleted_at ? "" : String(row.body),
      row.source_time_ms === null ? "" : Number(row.source_time_ms),
      iso(row.created_at),
      iso(row.updated_at),
      row.deleted_at ? iso(row.deleted_at) : "",
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

  async listClipComments(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    query: ClipCommentListQuery,
  ): Promise<ClipCommentPage> {
    await this.authorize(actor, projectId, "read");
    const parsed = ClipCommentListQuerySchema.parse(query);
    return this.transaction(
      async () => {
        await this.requireClipCommentRange(projectId, clipId);
        let cursorCreatedAt: string | undefined;
        let cursorCommentId: string | undefined;
        if (parsed.cursor) {
          const cursor = parseClipCommentCursor(parsed.cursor);
          if (cursor.projectId !== projectId || cursor.clipId !== clipId) {
            throw new CatalogInvalidRequestError(
              "Clip comment cursor does not match this project and clip.",
            );
          }
          const boundary = await this.database.query<DbRow>(
            `SELECT 1 FROM clip_comments
             WHERE project_id = $1 AND clip_id = $2 AND id = $3
               AND created_at = $4::timestamptz`,
            [projectId, clipId, cursor.commentId, cursor.createdAt],
          );
          if (!boundary.rows[0]) {
            throw new CatalogInvalidRequestError(
              "Clip comment cursor is no longer valid.",
            );
          }
          cursorCreatedAt = cursor.createdAt;
          cursorCommentId = cursor.commentId;
        }
        const result = await this.database.query<DbRow>(
          `SELECT * FROM clip_comments
           WHERE project_id = $1 AND clip_id = $2
             AND ($3::timestamptz IS NULL OR
                  (created_at, id) > ($3::timestamptz, $4::uuid))
           ORDER BY created_at, id
           LIMIT $5`,
          [
            projectId,
            clipId,
            cursorCreatedAt ?? null,
            cursorCommentId ?? null,
            parsed.limit + 1,
          ],
        );
        const pageRows = result.rows.slice(0, parsed.limit);
        const last = pageRows[pageRows.length - 1];
        return ClipCommentPageSchema.parse({
          projectId,
          clipId,
          comments: await Promise.all(
            pageRows.map(async (row) =>
              mapClipComment(
                row,
                await this.loadClipCommentMentions(String(row.id)),
              ),
            ),
          ),
          ...(result.rows.length > parsed.limit && last
            ? {
                nextCursor: makeClipCommentCursor({
                  projectId,
                  clipId,
                  commentId: String(last.id),
                  createdAt: iso(last.created_at),
                }),
              }
            : {}),
          fetchedAt: this.now().toISOString(),
        });
      },
      { repeatableRead: true },
    );
  }

  async createClipComment(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: CreateClipCommentRequest,
  ): Promise<ClipComment> {
    await this.authorize(actor, projectId, "write");
    const parsed = CreateClipCommentRequestSchema.parse(input);
    const user = await this.getCurrentUser(actor);
    const requestFingerprint = sha256Fingerprint({
      projectId,
      clipId,
      input: parsed,
    });
    const commentId = await this.transaction(async () => {
      const replay = await this.resolveClipCommentCommandReplay(
        projectId,
        clipId,
        actor.userId,
        "create",
        parsed.idempotencyKey,
        requestFingerprint,
      );
      if (replay) return replay;
      const range = await this.requireClipCommentRange(projectId, clipId);
      assertClipCommentSourceTime(parsed.sourceTimeMs, range);
      const candidateCommentId = randomUUID();
      const now = this.now().toISOString();
      await this.database.query(
        `INSERT INTO clip_comments
           (id, project_id, clip_id, author_id, author_handle,
            author_display_name, body, source_time_ms, initial_comment,
            version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 1, $9, $9)`,
        [
          candidateCommentId,
          projectId,
          clipId,
          user.id,
          user.handle,
          user.displayName,
          parsed.body,
          parsed.sourceTimeMs ?? null,
          now,
        ],
      );
      await this.persistCommentCollaboration({
        projectId,
        clipId,
        commentId: candidateCommentId,
        commentVersion: 1,
        body: parsed.body,
        actor: user,
        sourceTimeMs: parsed.sourceTimeMs,
        now,
      });
      const won = await this.recordClipCommentCommand(
        projectId,
        clipId,
        actor.userId,
        "create",
        parsed.idempotencyKey,
        requestFingerprint,
        candidateCommentId,
        1,
        now,
      );
      if (!won) {
        await this.database.query("DELETE FROM clip_comments WHERE id = $1", [
          candidateCommentId,
        ]);
        const concurrentReplay = await this.resolveClipCommentCommandReplay(
          projectId,
          clipId,
          actor.userId,
          "create",
          parsed.idempotencyKey,
          requestFingerprint,
        );
        if (!concurrentReplay) {
          throw new CatalogConflictError(
            "The comment could not be resolved after idempotent creation.",
          );
        }
        return concurrentReplay;
      }
      await this.appendClipCommentSyncEvent(
        projectId,
        candidateCommentId,
        1,
        "clip_comment.created",
        {
          clipId,
          commentId: candidateCommentId,
          authorId: user.id,
          initialComment: false,
          sourceTimeMs: parsed.sourceTimeMs ?? null,
        },
        now,
      );
      return candidateCommentId;
    });
    return this.getClipComment(projectId, clipId, commentId);
  }

  async readClipComment(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    commentId: string,
  ): Promise<ClipComment> {
    await this.authorize(actor, projectId, "read");
    await this.requireClipCommentRange(projectId, clipId);
    return this.getClipComment(projectId, clipId, commentId);
  }

  async updateClipComment(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    commentId: string,
    input: UpdateClipCommentRequest,
  ): Promise<ClipComment> {
    await this.authorize(actor, projectId, "write");
    const parsed = UpdateClipCommentRequestSchema.parse(input);
    const requestFingerprint = sha256Fingerprint({
      projectId,
      clipId,
      commentId,
      input: parsed,
    });
    const resolvedCommentId = await this.transaction(async () => {
      const replay = await this.resolveClipCommentCommandReplay(
        projectId,
        clipId,
        actor.userId,
        "update",
        parsed.idempotencyKey,
        requestFingerprint,
        commentId,
      );
      if (replay) return replay;
      const row = await this.requireActiveClipComment(
        projectId,
        clipId,
        commentId,
      );
      if (String(row.author_id) !== actor.userId) {
        throw new AuthorizationError(
          "Researchers may edit only their own clip comments.",
        );
      }
      const range = await this.requireClipCommentRange(projectId, clipId);
      if (parsed.sourceTimeMs !== null)
        assertClipCommentSourceTime(parsed.sourceTimeMs, range);
      const nextSourceTime = Object.hasOwn(parsed, "sourceTimeMs")
        ? (parsed.sourceTimeMs ?? null)
        : (row.source_time_ms ?? null);
      const now = this.now().toISOString();
      const won = await this.recordClipCommentCommand(
        projectId,
        clipId,
        actor.userId,
        "update",
        parsed.idempotencyKey,
        requestFingerprint,
        commentId,
        parsed.expectedVersion + 1,
        now,
      );
      if (!won) {
        const concurrentReplay = await this.resolveClipCommentCommandReplay(
          projectId,
          clipId,
          actor.userId,
          "update",
          parsed.idempotencyKey,
          requestFingerprint,
          commentId,
        );
        if (concurrentReplay) return concurrentReplay;
        throw new CatalogConflictError(
          "The comment could not be resolved after idempotent update.",
        );
      }
      const updated = await this.database.query<DbRow>(
        `UPDATE clip_comments
         SET body = $1, source_time_ms = $2, version = version + 1,
             updated_at = $3
         WHERE project_id = $4 AND clip_id = $5 AND id = $6
           AND author_id = $7 AND deleted_at IS NULL AND version = $8
         RETURNING version`,
        [
          parsed.body,
          nextSourceTime,
          now,
          projectId,
          clipId,
          commentId,
          actor.userId,
          parsed.expectedVersion,
        ],
      );
      if (!updated.rows[0]) {
        throw new CatalogConflictError(
          "This comment changed elsewhere. Reload it before saving edits.",
        );
      }
      const user = await this.getCurrentUser(actor);
      await this.persistCommentCollaboration({
        projectId,
        clipId,
        commentId,
        commentVersion: Number(updated.rows[0].version),
        body: parsed.body,
        actor: user,
        sourceTimeMs:
          nextSourceTime === null ? undefined : Number(nextSourceTime),
        now,
      });
      await this.appendClipCommentSyncEvent(
        projectId,
        commentId,
        Number(updated.rows[0].version),
        "clip_comment.updated",
        { clipId, commentId, authorId: actor.userId },
        now,
      );
      return commentId;
    });
    return this.getClipComment(projectId, clipId, resolvedCommentId);
  }

  async deleteOwnClipComment(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    commentId: string,
    input: DeleteClipCommentRequest,
  ): Promise<ClipComment> {
    await this.authorize(actor, projectId, "write");
    const parsed = DeleteClipCommentRequestSchema.parse(input);
    return this.deleteClipCommentInternal(
      actor,
      projectId,
      clipId,
      commentId,
      parsed,
      "author",
    );
  }

  async moderateClipComment(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    commentId: string,
    input: ModerateClipCommentRequest,
  ): Promise<ClipComment> {
    await this.authorize(actor, projectId, "write");
    await this.requireClipCommentModerator(actor.userId, projectId);
    const parsed = ModerateClipCommentRequestSchema.parse(input);
    return this.deleteClipCommentInternal(
      actor,
      projectId,
      clipId,
      commentId,
      parsed,
      "moderation",
    );
  }

  async updateClipFollow(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: UpdateClipFollowRequest,
  ): Promise<ClipFollow> {
    await this.authorize(actor, projectId, "write");
    const parsed = UpdateClipFollowRequestSchema.parse(input);
    const fingerprint = sha256Fingerprint({ projectId, clipId, input: parsed });
    return this.transaction(async () => {
      await this.requireClipCommentRange(projectId, clipId);
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, clip_id, result_json
         FROM clip_follow_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, parsed.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (
          replay.rows[0].request_sha256 !== fingerprint ||
          String(replay.rows[0].clip_id) !== clipId
        ) {
          throw new CatalogIdempotencyConflictError(
            "This follow command identity already belongs to different evidence.",
          );
        }
        return ClipFollowSchema.parse(replay.rows[0].result_json);
      }
      const now = this.now().toISOString();
      const result = await this.database.query<DbRow>(
        `INSERT INTO clip_follows
           (project_id, clip_id, user_id, following, version, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5)
         ON CONFLICT (project_id, clip_id, user_id) DO UPDATE
         SET following = EXCLUDED.following,
             version = clip_follows.version + 1,
             updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [projectId, clipId, actor.userId, parsed.following, now],
      );
      const follow = ClipFollowSchema.parse({
        projectId,
        clipId,
        userId: actor.userId,
        following: result.rows[0]!.following,
        version: Number(result.rows[0]!.version),
        updatedAt: iso(result.rows[0]!.updated_at),
      });
      await this.database.query(
        `INSERT INTO clip_follow_commands
           (project_id, actor_id, idempotency_key, request_sha256, clip_id,
            result_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          projectId,
          actor.userId,
          parsed.idempotencyKey,
          fingerprint,
          clipId,
          JSON.stringify(follow),
          now,
        ],
      );
      return follow;
    });
  }

  async listClipCommentNotices(
    actor: AuthenticatedActor,
  ): Promise<ClipCommentNoticePage> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT notice.*
       FROM clip_comment_notices notice
       JOIN project_members member
         ON member.project_id = notice.project_id
        AND member.user_id = notice.recipient_id
       WHERE notice.recipient_id = $1
       ORDER BY notice.created_at DESC, notice.id DESC
       LIMIT 50`,
      [actor.userId],
    );
    const unread = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM clip_comment_notices notice
       JOIN project_members member
         ON member.project_id = notice.project_id
        AND member.user_id = notice.recipient_id
       WHERE notice.recipient_id = $1 AND notice.state = 'unread'`,
      [actor.userId],
    );
    return ClipCommentNoticePageSchema.parse({
      notices: result.rows.map(mapClipCommentNotice),
      unreadCount: Number(unread.rows[0]?.count ?? 0),
      fetchedAt: this.now().toISOString(),
    });
  }

  async listNotificationFeed(
    actor: AuthenticatedActor,
    input: NotificationFeedQuery,
  ): Promise<NotificationFeedPage> {
    await this.requireRegistered(actor);
    const query = NotificationFeedQuerySchema.parse(input);
    const cursor = query.cursor
      ? parseNotificationFeedCursor(query.cursor)
      : undefined;
    const page = await this.database.query<DbRow>(
      `WITH candidates AS (
         SELECT event.id, event.event_type, event.status, event.project_id,
                event.batch_id, event.batch_item_id, event.video_id,
                event.clip_id, event.export_request_id, event.project_label,
                event.batch_label, event.source_label, event.clip_label,
                NULL::uuid AS comment_id, NULL::bigint AS source_time_ms,
                NULL::text AS actor_label, event.created_at
         FROM workflow_notification_events event
         JOIN project_members member
           ON member.project_id = event.project_id
          AND member.user_id = event.recipient_id
         WHERE event.recipient_id = $1
         UNION ALL
         SELECT notice.id, 'mention'::text, 'mentioned'::text,
                notice.project_id, NULL::uuid, NULL::uuid, clip.video_id,
                notice.clip_id, NULL::uuid, left(project.name, 160),
                NULL::text, left(clip.video_title, 160),
                left(clip.video_title, 160), notice.comment_id,
                notice.source_time_ms,
                left(notice.actor_display_name, 160), notice.created_at
         FROM clip_comment_notices notice
         JOIN project_members member
           ON member.project_id = notice.project_id
          AND member.user_id = notice.recipient_id
         JOIN projects project ON project.id = notice.project_id
         JOIN clip_candidates clip
           ON clip.project_id = notice.project_id AND clip.id = notice.clip_id
         WHERE notice.recipient_id = $1 AND notice.reason = 'mention'
       )
       SELECT * FROM candidates
       WHERE ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $5`,
      [
        actor.userId,
        query.since ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        query.limit + 1,
      ],
    );
    const hasMore = page.rows.length > query.limit;
    const rows = page.rows.slice(0, query.limit);
    const events = rows.map((row) => mapNotificationEvent(row));
    const last = rows.at(-1);
    return NotificationFeedPageSchema.parse({
      events,
      ...(hasMore && last
        ? {
            nextCursor: makeNotificationFeedCursor({
              createdAt: iso(last.created_at),
              id: String(last.id),
            }),
          }
        : {}),
      fetchedAt: this.now().toISOString(),
    });
  }

  async markClipCommentNoticeSeen(
    actor: AuthenticatedActor,
    noticeId: string,
    input: MarkClipCommentNoticeSeenRequest,
  ) {
    await this.requireRegistered(actor);
    const parsed = MarkClipCommentNoticeSeenRequestSchema.parse(input);
    const now = this.now().toISOString();
    const result = await this.database.query<DbRow>(
      `UPDATE clip_comment_notices notice
       SET state = 'seen', seen_at = $1, updated_at = $1,
           version = version + 1
       WHERE notice.id = $2 AND notice.recipient_id = $3
         AND notice.version = $4 AND notice.state = 'unread'
         AND EXISTS (
           SELECT 1 FROM project_members member
           WHERE member.project_id = notice.project_id
             AND member.user_id = notice.recipient_id
         )
       RETURNING notice.*`,
      [now, noticeId, actor.userId, parsed.expectedVersion],
    );
    if (!result.rows[0]) {
      throw new CatalogConflictError(
        "This comment notice was already seen, changed, or is no longer authorized.",
      );
    }
    return mapClipCommentNotice(result.rows[0]);
  }

  async createAuthoringBuildSnapshot(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateAuthoringBuildSnapshotRequest,
  ): Promise<AuthoringBuildSnapshot> {
    await this.authorize(actor, projectId, "read");
    const parsed = CreateAuthoringBuildSnapshotRequestSchema.parse(input);
    const fingerprint = sha256Fingerprint({ projectId, input: parsed });
    return this.transaction(async () => {
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, snapshot_json
         FROM authoring_build_snapshots
         WHERE project_id = $1 AND created_by = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, parsed.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_sha256 !== fingerprint) {
          throw new CatalogIdempotencyConflictError(
            "This authoring snapshot identity already belongs to different evidence.",
          );
        }
        return AuthoringBuildSnapshotSchema.parse(replay.rows[0].snapshot_json);
      }
      const clips = [];
      for (const requested of parsed.clips) {
        const clip = await this.getClipCandidate(
          actor,
          projectId,
          requested.clipId,
        );
        if (clip.version !== requested.expectedClipVersion) {
          throw new CatalogConflictError(
            "A selected clip changed before the authoring snapshot was created.",
          );
        }
        const promotedComments = [];
        for (const selected of requested.promotedComments) {
          const comment = await this.getClipComment(
            projectId,
            clip.id,
            selected.commentId,
          );
          if (
            comment.status !== "active" ||
            comment.version !== selected.expectedVersion
          ) {
            throw new CatalogConflictError(
              "A promoted comment changed or was deleted before snapshot creation.",
            );
          }
          promotedComments.push({
            commentId: comment.id,
            version: comment.version,
            text: comment.body,
            author: comment.author,
            ...(comment.sourceTimeMs === undefined
              ? {}
              : { sourceTimeMs: comment.sourceTimeMs }),
          });
        }
        clips.push({
          clipId: clip.id,
          clipVersion: clip.version,
          topics: clip.tags,
          promotedComments,
        });
      }
      const now = this.now().toISOString();
      const snapshot = AuthoringBuildSnapshotSchema.parse({
        id: randomUUID(),
        projectId,
        createdBy: actor.userId,
        clips,
        createdAt: now,
      });
      await this.database.query(
        `INSERT INTO authoring_build_snapshots
           (id, project_id, created_by, idempotency_key, request_sha256,
            snapshot_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          snapshot.id,
          projectId,
          actor.userId,
          parsed.idempotencyKey,
          fingerprint,
          JSON.stringify(snapshot),
          now,
        ],
      );
      return snapshot;
    });
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
    return this.createClipExportInternal(
      actor,
      projectId,
      clipId,
      CreateClipExportRequestSchema.parse(input),
    );
  }

  async reexportArtifactVersion(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    artifactVersionId: string,
    input: ReexportArtifactVersionRequest,
  ): Promise<ExportRequest> {
    const parsed = ReexportArtifactVersionRequestSchema.parse(input);
    await this.authorize(actor, projectId, "write");
    const source = await this.getArtifactVersion(
      actor,
      projectId,
      clipId,
      artifactVersionId,
    );
    if (
      parsed.sourceLanguageClass !== source.sourceLanguageClass ||
      sha256Fingerprint(parsed.subtitleTracks ?? null) !==
        sha256Fingerprint(source.subtitleTracks ?? null) ||
      sha256Fingerprint(parsed.noSpeechAttestation ?? null) !==
        sha256Fingerprint(source.noSpeechAttestation ?? null)
    ) {
      throw new CatalogConflictError(
        "An explicit re-export must preserve the source version's language, subtitle, and speech evidence.",
      );
    }
    return this.createClipExportInternal(actor, projectId, clipId, parsed, {
      artifactVersionId,
    });
  }

  private async createClipExportInternal(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: CreateClipExportRequest,
    reexport?: { artifactVersionId: string },
  ): Promise<ExportRequest> {
    await this.authorize(actor, projectId, "write");
    const clip = await this.getClipCandidate(actor, projectId, clipId);
    const clipNoSpeechAttestation =
      clip.selection.selectionType === "player_time_range"
        ? clip.selection.noSpeechAttestation
        : undefined;
    if (
      JSON.stringify(input.noSpeechAttestation ?? null) !==
      JSON.stringify(clipNoSpeechAttestation ?? null)
    ) {
      throw new CatalogValidationError(
        "Export speech attestation must match the immutable logged clip selection.",
      );
    }
    if (
      clip.selection.selectionType === "player_time_range" &&
      clip.selection.speechStatus !== "no_speech" &&
      !clip.selection.transcriptAttachment
    ) {
      throw new CatalogValidationError(
        clip.selection.speechStatus === "transcript_unavailable"
          ? "This clip can be logged, but export requires a new selection after exact transcript evidence becomes available."
          : "This speech range can be logged, but export requires exact attached transcript evidence.",
      );
    }
    const idempotencyKey = reexport
      ? `clip-reexport:${clipId}:${reexport.artifactVersionId}:${input.idempotencyKey}`
      : `clip-export:${clipId}:${input.idempotencyKey}`;
    const adoptCompatibleReplay = (row: DbRow) => {
      const persisted = mapLoggedExportRequest(row);
      const persistedFingerprint =
        persisted.resolvedSettingsSnapshot?.resolutionFingerprint;
      const divergent =
        persisted.clipId !== clipId ||
        persisted.sourceLanguageClass !== input.sourceLanguageClass ||
        sha256Fingerprint(persisted.subtitleTracks ?? null) !==
          sha256Fingerprint(input.subtitleTracks ?? null) ||
        sha256Fingerprint(persisted.noSpeechAttestation ?? null) !==
          sha256Fingerprint(input.noSpeechAttestation ?? null) ||
        sha256Fingerprint(persisted.sourceRights ?? null) !==
          sha256Fingerprint(input.sourceRights) ||
        (input.expectedResolutionFingerprint !== undefined &&
          persistedFingerprint !== input.expectedResolutionFingerprint) ||
        (input.preset !== undefined &&
          sha256Fingerprint(persisted.preset) !==
            sha256Fingerprint(input.preset));
      if (divergent) {
        throw new CatalogIdempotencyConflictError(
          "This clip export command identity already belongs to different source, subtitle, or settings evidence.",
        );
      }
      return persisted;
    };
    const existing = await this.database.query<DbRow>(
      `${loggedExportRequestSelect}
       WHERE j.idempotency_key = $1 AND er.project_id = $2`,
      [idempotencyKey, projectId],
    );
    if (existing.rows[0]) {
      assertExportSourceRightsMatchVideo(input.sourceRights, clip.video);
      return adoptCompatibleReplay(existing.rows[0]);
    }
    const requestId = randomUUID();
    let resolvedRequestId: string = requestId;
    const jobId = randomUUID();
    const now = this.now().toISOString();
    await this.transaction(async () => {
      const lockedClip = await this.database.query<{ export_status: string }>(
        `SELECT export_status FROM clip_candidates
         WHERE id = $1 AND project_id = $2
         FOR UPDATE`,
        [clipId, projectId],
      );
      if (!lockedClip.rows[0]) {
        throw new CatalogNotFoundError("Clip candidate not found.");
      }
      assertExportSourceRightsMatchVideo(input.sourceRights, clip.video);
      const racedReplay = await this.database.query<DbRow>(
        `${loggedExportRequestSelect}
         WHERE j.idempotency_key = $1 AND er.project_id = $2`,
        [idempotencyKey, projectId],
      );
      if (racedReplay.rows[0]) {
        resolvedRequestId = adoptCompatibleReplay(racedReplay.rows[0]).id;
        return;
      }
      if (
        !reexport &&
        input.requestOrigin === "clip_library" &&
        lockedClip.rows[0].export_status !== "not_requested"
      ) {
        throw new CatalogConflictError(
          "A new Clip Library export requires a not-requested clip; recover the existing request instead.",
        );
      }
      const batchMembership = reexport
        ? { rows: [] }
        : await this.database.query(
            `SELECT 1 FROM export_requests
         WHERE project_id = $1 AND clip_id = $2
           AND batch_item_id IS NOT NULL
         LIMIT 1`,
            [projectId, clipId],
          );
      if (batchMembership.rows[0]) {
        throw new CatalogConflictError(
          "A batch clip cannot receive a second independent export request.",
        );
      }
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
      if (
        clipNoSpeechAttestation &&
        preview.snapshot.settings.embedEnglishSubtitleTrack
      ) {
        throw new ExportSettingsCapabilityError(
          "An attested no-speech export cannot embed an empty subtitle stream.",
          [
            {
              field: "embedEnglishSubtitleTrack",
              code: "unsupported_combination",
              message:
                "Disable embedded English subtitles for this no-speech range; required empty sidecars remain included.",
            },
          ],
        );
      }
      const preset = resolvedPresetForCompatibility(preview.snapshot);
      const payload = {
        exportRequestId: requestId,
        mode: "logged",
        requestOrigin: input.requestOrigin ?? "selection_action",
        clipId,
        video: clip.video,
        selection: clip.selection,
        sourceLanguageClass: input.sourceLanguageClass,
        sourceRights: input.sourceRights,
        ...(clipNoSpeechAttestation
          ? { noSpeechAttestation: clipNoSpeechAttestation }
          : {}),
        ...(input.subtitleTracks
          ? { subtitleTracks: input.subtitleTracks }
          : {}),
        preset,
        resolvedSettingsSnapshot: preview.snapshot,
        ...(reexport
          ? { reexportOfArtifactVersionId: reexport.artifactVersionId }
          : {}),
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
            source_rights_snapshot, resolved_settings_snapshot, requested_by, request_origin,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'logged', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
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
          JSON.stringify(input.sourceRights),
          JSON.stringify(preview.snapshot),
          actor.userId,
          input.requestOrigin ?? "selection_action",
          now,
        ],
      );
      const queued = await this.database.query<{ version: number }>(
        `UPDATE clip_candidates
         SET export_status = 'queued', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3
         RETURNING version`,
        [now, clipId, projectId],
      );
      if (!queued.rows[0]) {
        throw new CatalogConflictError(
          "This clip changed while its export was being created.",
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_queued', $2,
                 $3, $4, $5)`,
        [
          projectId,
          clipId,
          queued.rows[0].version,
          JSON.stringify({
            clipId,
            exportRequestId: requestId,
            jobId,
            ...(reexport
              ? { reexportOfArtifactVersionId: reexport.artifactVersionId }
              : {}),
          }),
          now,
        ],
      );
    });
    return this.getLoggedExportRequest(actor, projectId, resolvedRequestId);
  }

  async createLoggedExportBatch(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateLoggedExportBatchRequest,
  ): Promise<LoggedExportBatch> {
    await this.requireRegistered(actor);
    const parsed = CreateLoggedExportBatchRequestSchema.parse(input);
    const requestFingerprint = sha256Fingerprint({
      ...parsed,
      items: parsed.items.map(({ clipId, export: itemExport }) => {
        const { requestOrigin: _diagnosticOrigin, ...compatibleExport } =
          itemExport;
        return { clipId, export: compatibleExport };
      }),
    });
    const now = this.now().toISOString();
    let batchId: string | undefined;

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

      const existing = await this.database.query<DbRow>(
        `SELECT * FROM logged_export_batches
         WHERE project_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [projectId, parsed.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (
          String(existing.rows[0].request_fingerprint) !== requestFingerprint
        ) {
          throw new CatalogIdempotencyConflictError(
            "This batch command identity already belongs to different items or settings.",
          );
        }
        batchId = String(existing.rows[0].id);
        return;
      }

      const resolvedItems: Array<{
        clip: ClipCandidate;
        input: CreateLoggedExportBatchRequest["items"][number]["export"];
        preset: ExportPresetSnapshot;
        snapshot: ReturnType<typeof resolveExportSettings>["snapshot"];
      }> = [];
      for (const item of parsed.items) {
        const clipResult = await this.database.query<DbRow>(
          `SELECT c.* FROM clip_candidates c
           WHERE c.id = $1 AND c.project_id = $2
           FOR UPDATE OF c`,
          [item.clipId, projectId],
        );
        const clipRow = clipResult.rows[0];
        if (!clipRow) {
          throw new CatalogNotFoundError("Batch clip candidate not found.");
        }
        if (String(clipRow.export_status) !== "not_requested") {
          throw new CatalogConflictError(
            "Every batch clip must be eligible and not previously exported.",
          );
        }
        const clip = mapClipCandidate(
          clipRow,
          await this.loadClipTags(item.clipId),
          await this.loadClipLanguageEvidence(item.clipId),
        );
        const clipNoSpeechAttestation =
          clip.selection.selectionType === "player_time_range"
            ? clip.selection.noSpeechAttestation
            : undefined;
        if (
          sha256Fingerprint(item.export.noSpeechAttestation ?? null) !==
          sha256Fingerprint(clipNoSpeechAttestation ?? null)
        ) {
          throw new CatalogValidationError(
            "Batch export speech attestation must match the immutable logged clip selection.",
          );
        }
        if (
          clip.selection.selectionType === "player_time_range" &&
          clip.selection.speechStatus !== "no_speech" &&
          !clip.selection.transcriptAttachment
        ) {
          throw new CatalogValidationError(
            clip.selection.speechStatus === "transcript_unavailable"
              ? "This batch clip can be logged, but export requires a new selection after exact transcript evidence becomes available."
              : "This batch speech range requires exact attached transcript evidence before export.",
          );
        }
        assertExportSourceRightsMatchVideo(
          item.export.sourceRights,
          clip.video,
        );
        const preview = item.export.preset
          ? resolveExportSettings({
              context: "logged",
              sourceLanguageClass: item.export.sourceLanguageClass,
              legacyPreset: item.export.preset,
              resolvedAt: now,
            })
          : await this.resolveCatalogExportSettings(
              actor,
              "logged",
              projectId,
              {
                sourceLanguageClass: item.export.sourceLanguageClass,
                selection: item.export.settingsSelection!,
              },
              now,
            );
        if (
          item.export.expectedResolutionFingerprint &&
          preview.snapshot.resolutionFingerprint !==
            item.export.expectedResolutionFingerprint
        ) {
          throw new ExportSettingsStaleError(
            "Batch export settings changed after preview.",
          );
        }
        if (!item.export.preset && preview.issues.length) {
          throw new ExportSettingsCapabilityError(
            "The current worker cannot render one batch item's resolved settings.",
            preview.issues,
          );
        }
        if (
          clipNoSpeechAttestation &&
          preview.snapshot.settings.embedEnglishSubtitleTrack
        ) {
          throw new ExportSettingsCapabilityError(
            "An attested no-speech batch export cannot embed an empty subtitle stream.",
            [
              {
                field: "embedEnglishSubtitleTrack",
                code: "unsupported_combination",
                message:
                  "Disable embedded English subtitles for this no-speech range; required empty sidecars remain included.",
              },
            ],
          );
        }
        resolvedItems.push({
          clip,
          input: item.export,
          preset: resolvedPresetForCompatibility(preview.snapshot),
          snapshot: preview.snapshot,
        });
      }

      batchId = randomUUID();
      await this.database.query(
        `INSERT INTO logged_export_batches
           (id, project_id, created_by, idempotency_key,
            request_fingerprint, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          batchId,
          projectId,
          actor.userId,
          parsed.idempotencyKey,
          requestFingerprint,
          now,
        ],
      );
      for (const [ordinal, resolved] of resolvedItems.entries()) {
        const batchItemId = randomUUID();
        const requestId = randomUUID();
        const jobId = randomUUID();
        await this.database.query(
          `INSERT INTO logged_export_batch_items
             (id, batch_id, clip_id, ordinal, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [batchItemId, batchId, resolved.clip.id, ordinal, now],
        );
        const payload = {
          exportRequestId: requestId,
          mode: "logged",
          requestOrigin: resolved.input.requestOrigin ?? "selection_action",
          clipId: resolved.clip.id,
          batchItemId,
          video: resolved.clip.video,
          selection: resolved.clip.selection,
          sourceLanguageClass: resolved.input.sourceLanguageClass,
          sourceRights: resolved.input.sourceRights,
          ...(resolved.clip.selection.selectionType === "player_time_range" &&
          resolved.clip.selection.noSpeechAttestation
            ? {
                noSpeechAttestation:
                  resolved.clip.selection.noSpeechAttestation,
              }
            : {}),
          ...(resolved.input.subtitleTracks
            ? { subtitleTracks: resolved.input.subtitleTracks }
            : {}),
          preset: resolved.preset,
          resolvedSettingsSnapshot: resolved.snapshot,
        };
        await this.database.query(
          `INSERT INTO jobs
             (id, project_id, kind, state, idempotency_key, attempt, payload,
              created_at, updated_at)
           VALUES ($1, $2, 'export', 'queued', $3, 0, $4, $5, $5)`,
          [
            jobId,
            projectId,
            `logged-export-batch:${batchId}:${ordinal}`,
            JSON.stringify(payload),
            now,
          ],
        );
        await this.database.query(
          `INSERT INTO export_requests
             (id, job_id, clip_id, project_id, mode, video_snapshot,
              selection_snapshot, source_language_class,
              subtitle_tracks_snapshot, preset_snapshot,
              source_rights_snapshot, resolved_settings_snapshot, requested_by, request_origin,
              batch_item_id,
              created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'logged', $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14, $15, $15)`,
          [
            requestId,
            jobId,
            resolved.clip.id,
            projectId,
            JSON.stringify(resolved.clip.video),
            JSON.stringify(resolved.clip.selection),
            resolved.input.sourceLanguageClass,
            resolved.input.subtitleTracks
              ? JSON.stringify(resolved.input.subtitleTracks)
              : null,
            JSON.stringify(resolved.preset),
            JSON.stringify(resolved.input.sourceRights),
            JSON.stringify(resolved.snapshot),
            actor.userId,
            resolved.input.requestOrigin ?? "selection_action",
            batchItemId,
            now,
          ],
        );
        await this.database.query(
          `UPDATE logged_export_batch_items
           SET root_export_request_id = $1 WHERE id = $2`,
          [requestId, batchItemId],
        );
        const queued = await this.database.query<{ version: number }>(
          `UPDATE clip_candidates
           SET export_status = 'queued', version = version + 1, updated_at = $1
           WHERE id = $2 AND project_id = $3
             AND export_status = 'not_requested'
           RETURNING version`,
          [now, resolved.clip.id, projectId],
        );
        if (!queued.rows[0]) {
          throw new CatalogConflictError(
            "A batch sibling changed while the batch was being created.",
          );
        }
        await this.database.query(
          `INSERT INTO sync_events
             (project_id, event_type, entity_id, server_version, payload, created_at)
           VALUES ($1, 'clip_candidate.export_queued', $2, $3, $4, $5)`,
          [
            projectId,
            resolved.clip.id,
            queued.rows[0].version,
            JSON.stringify({
              clipId: resolved.clip.id,
              exportRequestId: requestId,
              jobId,
              batchId,
              batchItemId,
              ordinal,
            }),
            now,
          ],
        );
      }
    });

    if (!batchId)
      throw new CatalogConflictError("Batch creation did not persist.");
    return this.getLoggedExportBatch(actor, projectId, batchId);
  }

  async getLoggedExportBatch(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
  ): Promise<LoggedExportBatch> {
    await this.authorize(actor, projectId, "read");
    const rows = await this.loadLoggedExportBatchRows(projectId, batchId);
    if (!rows.length) throw new CatalogNotFoundError("Export batch not found.");
    return mapLoggedExportBatchRows(rows);
  }

  async listLoggedExportBatches(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<LoggedExportBatchListResponse> {
    await this.authorize(actor, projectId, "read");
    const batches = await this.database.query<{ id: string }>(
      `SELECT id FROM logged_export_batches
       WHERE project_id = $1 ORDER BY created_at DESC, id LIMIT 100`,
      [projectId],
    );
    return LoggedExportBatchListResponseSchema.parse({
      batches: await Promise.all(
        batches.rows.map(async ({ id }) =>
          mapLoggedExportBatchRows(
            await this.loadLoggedExportBatchRows(projectId, id),
          ),
        ),
      ),
    });
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
        requestOrigin: parent.requestOrigin,
        clipId: parent.clipId!,
        video: parent.video,
        selection: parent.selection,
        sourceLanguageClass: parent.sourceLanguageClass,
        ...(parent.sourceRights ? { sourceRights: parent.sourceRights } : {}),
        ...(parent.noSpeechAttestation
          ? { noSpeechAttestation: parent.noSpeechAttestation }
          : {}),
        ...(parent.subtitleTracks
          ? { subtitleTracks: parent.subtitleTracks }
          : {}),
        preset: parent.preset,
        resolvedSettingsSnapshot: parent.resolvedSettingsSnapshot!,
        retryOfRequestId: parent.id,
        retryOrdinal,
        ...(parent.batchItemId ? { batchItemId: parent.batchItemId } : {}),
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
            source_rights_snapshot, resolved_settings_snapshot, requested_by, retry_of_request_id,
            retry_ordinal, retry_idempotency_key, request_origin, batch_item_id,
            created_at, updated_at)
         SELECT $1, $2, parent.clip_id, parent.project_id, parent.mode,
                parent.video_snapshot, parent.selection_snapshot,
                parent.source_language_class, parent.subtitle_tracks_snapshot,
                parent.preset_snapshot, parent.source_rights_snapshot,
                parent.resolved_settings_snapshot, $3, parent.id, $4, $5,
                parent.request_origin, parent.batch_item_id, $6, $6
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

  async listArtifactVersionHistory(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    query: ArtifactVersionHistoryQuery,
  ): Promise<ArtifactVersionHistoryResponse> {
    await this.authorize(actor, projectId, "read");
    const parsedQuery = ArtifactVersionHistoryQuerySchema.parse(query);
    const clip = await this.database.query<{ id: string }>(
      "SELECT id FROM clip_candidates WHERE id = $1 AND project_id = $2",
      [clipId, projectId],
    );
    if (!clip.rows[0]) {
      throw new CatalogNotFoundError("Clip candidate not found.");
    }

    let cursorCompletedAt: string | undefined;
    if (parsedQuery.cursor) {
      const cursor = await this.database.query<DbRow>(
        `SELECT success.reconciled_at
         FROM logged_export_success_results success
         JOIN export_requests request ON request.id = success.export_request_id
         WHERE success.id = $1 AND request.project_id = $2 AND request.clip_id = $3`,
        [parsedQuery.cursor, projectId, clipId],
      );
      if (!cursor.rows[0]) {
        throw new CatalogNotFoundError("Artifact history cursor not found.");
      }
      cursorCompletedAt = iso(cursor.rows[0].reconciled_at);
    }

    const result = await this.database.query<DbRow>(
      `SELECT success.id AS artifact_version_id,
              success.result_json, success.result_fingerprint,
              success.reconciled_at, request.*
       FROM logged_export_success_results success
       JOIN export_requests request ON request.id = success.export_request_id
       WHERE request.project_id = $1 AND request.clip_id = $2
         AND ($3::timestamptz IS NULL OR
              (success.reconciled_at, success.id) < ($3::timestamptz, $4::uuid))
       ORDER BY success.reconciled_at DESC, success.id DESC
       LIMIT $5`,
      [
        projectId,
        clipId,
        cursorCompletedAt ?? null,
        parsedQuery.cursor ?? null,
        parsedQuery.limit + 1,
      ],
    );
    const page = result.rows.slice(0, parsedQuery.limit);
    return ArtifactVersionHistoryResponseSchema.parse({
      versions: page.map(mapArtifactVersionSummary),
      ...(result.rows.length > parsedQuery.limit && page.length
        ? { nextCursor: String(page[page.length - 1]!.artifact_version_id) }
        : {}),
    });
  }

  async getArtifactVersion(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    artifactVersionId: string,
  ): Promise<ArtifactVersionSummary> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT success.id AS artifact_version_id,
              success.result_json, success.result_fingerprint,
              success.reconciled_at, request.*
       FROM logged_export_success_results success
       JOIN export_requests request ON request.id = success.export_request_id
       WHERE success.id = $1 AND request.project_id = $2 AND request.clip_id = $3`,
      [artifactVersionId, projectId, clipId],
    );
    if (!result.rows[0]) {
      throw new CatalogNotFoundError("Artifact version not found.");
    }
    return mapArtifactVersionSummary(result.rows[0]);
  }

  async resolveArtifactVersionCompatibility(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    artifactVersionId: string,
    requirements: ArtifactCompatibilityRequirements,
  ): Promise<ArtifactCompatibilityResolution> {
    const version = await this.getArtifactVersion(
      actor,
      projectId,
      clipId,
      artifactVersionId,
    );
    return ArtifactCompatibilityResolutionSchema.parse(
      artifactVersionMatchesRequirements(version, requirements)
        ? { state: "candidate", version }
        : { state: "incompatible", artifactVersionId },
    );
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
      `SELECT id, name, description, kind, visibility, version,
              created_at, updated_at
       FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!result.rows[0]) throw new CatalogNotFoundError("Project not found.");
    return mapProject(result.rows[0]);
  }

  async listProjectMembers(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectMemberSummary[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT pm.project_id, pm.user_id, pm.role, pm.version,
              pm.created_at, pm.updated_at, u.handle, u.display_name
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 ELSE 2 END,
                u.normalized_handle, u.id`,
      [projectId],
    );
    return result.rows.map(mapProjectMemberSummary);
  }

  async listGovernanceEvents(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectGovernanceEvent[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT id, project_id, event_type, actor_user_id, target_user_id,
              created_at
       FROM project_governance_audit_events
       WHERE project_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [projectId],
    );
    return result.rows.map(mapProjectGovernanceEvent);
  }

  async discoverOpenProjects(
    actor: AuthenticatedActor,
  ): Promise<OpenProjectDiscovery[]> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT p.id, p.name, p.description, count(pm.user_id)::int AS member_count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE p.kind = 'shared' AND p.visibility = 'open_to_join'
         AND NOT EXISTS (
           SELECT 1 FROM project_members own
           WHERE own.project_id = p.id AND own.user_id = $1
         )
       GROUP BY p.id, p.name, p.description
       ORDER BY lower(p.name), p.id LIMIT 100`,
      [actor.userId],
    );
    return result.rows.map((row) =>
      OpenProjectDiscoverySchema.parse({
        id: row.id,
        name: row.name,
        description: row.description,
        memberCount: Number(row.member_count),
      }),
    );
  }

  async listMyProjectInvitations(
    actor: AuthenticatedActor,
  ): Promise<ProjectInvitation[]> {
    await this.requireRegistered(actor);
    const now = this.now().toISOString();
    await this.database.query(
      `UPDATE project_invitations
       SET state = 'expired', version = version + 1, updated_at = $2
       WHERE invitee_user_id = $1 AND state = 'pending' AND expires_at <= $2`,
      [actor.userId, now],
    );
    const result = await this.database.query<DbRow>(
      `${projectInvitationSelect}
       WHERE pi.invitee_user_id = $1
       ORDER BY pi.created_at DESC, pi.id DESC LIMIT 100`,
      [actor.userId],
    );
    return result.rows.map(mapProjectInvitation);
  }

  async listProjectInvitations(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectInvitation[]> {
    await this.requireRegistered(actor);
    const membership = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, actor.userId],
    );
    requirePermission(membership.rows[0]?.role, "manage_researchers");
    const now = this.now().toISOString();
    await this.database.query(
      `UPDATE project_invitations
       SET state = 'expired', version = version + 1, updated_at = $2
       WHERE project_id = $1 AND state = 'pending' AND expires_at <= $2`,
      [projectId, now],
    );
    const result = await this.database.query<DbRow>(
      `${projectInvitationSelect}
       WHERE pi.project_id = $1
       ORDER BY pi.created_at DESC, pi.id DESC LIMIT 100`,
      [projectId],
    );
    return result.rows.map(mapProjectInvitation);
  }

  async createProjectInvitation(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateProjectInvitationRequest,
  ): Promise<ProjectInvitation> {
    await this.requireRegistered(actor);
    const membership = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, actor.userId],
    );
    requireProjectRoleAssignment(membership.rows[0]?.role, input.role);
    const replay = await this.readGovernanceReplay(
      actor,
      projectId,
      input.idempotencyKey,
      "invitation.create",
      input,
    );
    if (replay) return ProjectInvitationSchema.parse(replay);
    const now = this.now();
    const result = await this.transaction(async () => {
      const project = await this.database.query<DbRow>(
        "SELECT kind FROM projects WHERE id = $1 FOR UPDATE",
        [projectId],
      );
      const lockedReplay = await this.readGovernanceReplay(
        actor,
        projectId,
        input.idempotencyKey,
        "invitation.create",
        input,
      );
      if (lockedReplay) return ProjectInvitationSchema.parse(lockedReplay);
      if (!project.rows[0]) throw new CatalogNotFoundError();
      if (project.rows[0].kind !== "shared")
        throw new CatalogConflictError(
          "Convert this personal project before inviting members.",
        );
      const target = await this.database.query<DbRow>(
        `SELECT id, handle FROM users WHERE normalized_handle = $1`,
        [normalizeUserHandle(input.handle)],
      );
      if (!target.rows[0]) throw new CatalogNotFoundError("User not found.");
      const targetId = String(target.rows[0].id);
      if (targetId === actor.userId)
        throw new CatalogInvalidRequestError(
          "You already belong to the project.",
        );
      const existingMember = await this.database.query(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        [projectId, targetId],
      );
      if (existingMember.rows[0])
        throw new CatalogConflictError(
          "This user is already a project member.",
        );
      const existing = await this.database.query<DbRow>(
        `${projectInvitationSelect}
         WHERE pi.project_id = $1 AND pi.invitee_user_id = $2
           AND pi.state = 'pending' FOR UPDATE`,
        [projectId, targetId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].role !== input.role)
          throw new CatalogConflictError(
            "A pending invitation already proposes another role.",
          );
        const invitation = mapProjectInvitation(existing.rows[0]);
        await this.storeGovernanceCommand(
          actor,
          projectId,
          input.idempotencyKey,
          "invitation.create",
          input,
          invitation,
          now.toISOString(),
        );
        return invitation;
      }
      const id = randomUUID();
      const nowIso = now.toISOString();
      const expiresAt = new Date(
        now.getTime() + input.expiresInDays * 86_400_000,
      ).toISOString();
      await this.database.query(
        `INSERT INTO project_invitations
           (id, project_id, invitee_user_id, inviter_user_id, role, state,
            version, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6, $7, $7)`,
        [id, projectId, targetId, actor.userId, input.role, expiresAt, nowIso],
      );
      await insertGovernanceEvent(
        this.database,
        projectId,
        "invitation_created",
        actor.userId,
        targetId,
        nowIso,
      );
      const inserted = await this.database.query<DbRow>(
        `${projectInvitationSelect} WHERE pi.id = $1`,
        [id],
      );
      const invitation = mapProjectInvitation(inserted.rows[0]!);
      await this.storeGovernanceCommand(
        actor,
        projectId,
        input.idempotencyKey,
        "invitation.create",
        input,
        invitation,
        nowIso,
      );
      return invitation;
    });
    return result;
  }

  async decideProjectInvitation(
    actor: AuthenticatedActor,
    invitationId: string,
    input: DecideProjectInvitationRequest,
  ): Promise<ProjectInvitation> {
    await this.requireRegistered(actor);
    const identity = await this.database.query<DbRow>(
      "SELECT project_id FROM project_invitations WHERE id = $1 AND invitee_user_id = $2",
      [invitationId, actor.userId],
    );
    if (!identity.rows[0])
      throw new CatalogNotFoundError("Invitation not found.");
    const projectId = String(identity.rows[0].project_id);
    const replay = await this.readGovernanceReplay(
      actor,
      projectId,
      input.idempotencyKey,
      `invitation.${input.decision}`,
      { invitationId, ...input },
    );
    if (replay) return ProjectInvitationSchema.parse(replay);
    const now = this.now().toISOString();
    const result = await this.transaction(async () => {
      const current = await this.database.query<DbRow>(
        `${projectInvitationSelect}
         WHERE pi.id = $1 AND pi.invitee_user_id = $2 FOR UPDATE`,
        [invitationId, actor.userId],
      );
      const row = current.rows[0];
      if (!row) throw new CatalogNotFoundError("Invitation not found.");
      const lockedReplay = await this.readGovernanceReplay(
        actor,
        projectId,
        input.idempotencyKey,
        `invitation.${input.decision}`,
        { invitationId, ...input },
      );
      if (lockedReplay) return ProjectInvitationSchema.parse(lockedReplay);
      if (row.state !== "pending")
        throw new CatalogConflictError("This invitation is no longer pending.");
      if (Number(row.version) !== input.expectedVersion)
        throw new CatalogConflictError("The invitation version is stale.");
      if (new Date(iso(row.expires_at)).getTime() <= new Date(now).getTime())
        throw new CatalogConflictError("This invitation has expired.");
      const state = input.decision === "accept" ? "accepted" : "rejected";
      if (state === "accepted") {
        const existingMembership = await this.database.query(
          "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
          [projectId, actor.userId],
        );
        if (existingMembership.rows[0]) {
          throw new CatalogConflictError(
            "This account is already a project member; the invitation was not changed.",
          );
        }
        await this.database.query(
          `INSERT INTO project_members
             (project_id, user_id, role, version, created_at, updated_at)
           VALUES ($1, $2, $3, 1, $4, $4)
             ON CONFLICT (project_id, user_id) DO NOTHING`,
          [projectId, actor.userId, row.role, now],
        );
      }
      await this.database.query(
        `UPDATE project_invitations
         SET state = $2, version = version + 1, updated_at = $3 WHERE id = $1`,
        [invitationId, state, now],
      );
      await insertGovernanceEvent(
        this.database,
        projectId,
        state === "accepted" ? "invitation_accepted" : "invitation_rejected",
        actor.userId,
        actor.userId,
        now,
      );
      const updated = await this.database.query<DbRow>(
        `${projectInvitationSelect} WHERE pi.id = $1`,
        [invitationId],
      );
      const invitation = mapProjectInvitation(updated.rows[0]!);
      await this.storeGovernanceCommand(
        actor,
        projectId,
        input.idempotencyKey,
        `invitation.${input.decision}`,
        { invitationId, ...input },
        invitation,
        now,
      );
      return invitation;
    });
    return result;
  }

  async revokeProjectInvitation(
    actor: AuthenticatedActor,
    projectId: string,
    invitationId: string,
    input: RevokeProjectInvitationRequest,
  ): Promise<ProjectInvitation> {
    await this.requireRegistered(actor);
    const currentRole = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, actor.userId],
    );
    const current = await this.database.query<DbRow>(
      `${projectInvitationSelect} WHERE pi.id = $1 AND pi.project_id = $2`,
      [invitationId, projectId],
    );
    if (!current.rows[0])
      throw new CatalogNotFoundError("Invitation not found.");
    requireProjectRoleAssignment(
      currentRole.rows[0]?.role,
      current.rows[0].role as "administrator" | "researcher",
    );
    const replay = await this.readGovernanceReplay(
      actor,
      projectId,
      input.idempotencyKey,
      "invitation.revoke",
      { invitationId, ...input },
    );
    if (replay) return ProjectInvitationSchema.parse(replay);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const locked = await this.database.query<DbRow>(
        `${projectInvitationSelect}
         WHERE pi.id = $1 AND pi.project_id = $2 FOR UPDATE`,
        [invitationId, projectId],
      );
      const row = locked.rows[0];
      if (!row) throw new CatalogNotFoundError("Invitation not found.");
      const lockedRole = await this.database.query<{ role: ProjectRole }>(
        "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
        [projectId, actor.userId],
      );
      requireProjectRoleAssignment(
        lockedRole.rows[0]?.role,
        row.role as "administrator" | "researcher",
      );
      const lockedReplay = await this.readGovernanceReplay(
        actor,
        projectId,
        input.idempotencyKey,
        "invitation.revoke",
        { invitationId, ...input },
      );
      if (lockedReplay) return ProjectInvitationSchema.parse(lockedReplay);
      if (
        row.state !== "pending" ||
        Number(row.version) !== input.expectedVersion
      ) {
        throw new CatalogConflictError("The invitation is no longer current.");
      }
      await this.database.query(
        `UPDATE project_invitations
         SET state = 'revoked', version = version + 1, updated_at = $3
         WHERE id = $1 AND project_id = $2`,
        [invitationId, projectId, now],
      );
      await insertGovernanceEvent(
        this.database,
        projectId,
        "invitation_revoked",
        actor.userId,
        String(row.invitee_user_id),
        now,
      );
      const updated = await this.database.query<DbRow>(
        `${projectInvitationSelect} WHERE pi.id = $1`,
        [invitationId],
      );
      const result = mapProjectInvitation(updated.rows[0]!);
      await this.storeGovernanceCommand(
        actor,
        projectId,
        input.idempotencyKey,
        "invitation.revoke",
        { invitationId, ...input },
        result,
        now,
      );
      return result;
    });
  }

  async joinOpenProject(
    actor: AuthenticatedActor,
    projectId: string,
    input: JoinOpenProjectRequest,
  ): Promise<ProjectSummary> {
    await this.requireRegistered(actor);
    const replay = await this.readGovernanceReplay(
      actor,
      projectId,
      input.idempotencyKey,
      "project.open_join",
      input,
    );
    if (replay) return ProjectSummarySchema.parse(replay);
    const now = this.now().toISOString();
    const result = await this.transaction(async () => {
      const project = await this.database.query<DbRow>(
        "SELECT * FROM projects WHERE id = $1 FOR UPDATE",
        [projectId],
      );
      const lockedReplay = await this.readGovernanceReplay(
        actor,
        projectId,
        input.idempotencyKey,
        "project.open_join",
        input,
      );
      if (lockedReplay) return ProjectSummarySchema.parse(lockedReplay);
      if (!project.rows[0] || project.rows[0].visibility !== "open_to_join")
        throw new CatalogNotFoundError("Open project not found.");
      const existingMembership = await this.database.query(
        "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
        [projectId, actor.userId],
      );
      if (existingMembership.rows[0]) {
        throw new CatalogConflictError("This account is already a member.");
      }
      await this.database.query(
        `INSERT INTO project_members
           (project_id, user_id, role, version, created_at, updated_at)
         VALUES ($1, $2, 'researcher', 1, $3, $3)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [projectId, actor.userId, now],
      );
      await insertGovernanceEvent(
        this.database,
        projectId,
        "open_joined",
        actor.userId,
        actor.userId,
        now,
      );
      const summary = await this.getProjectSummary(actor, projectId);
      await this.storeGovernanceCommand(
        actor,
        projectId,
        input.idempotencyKey,
        "project.open_join",
        input,
        summary,
        now,
      );
      return summary;
    });
    return result;
  }

  async updateProjectGovernance(
    actor: AuthenticatedActor,
    projectId: string,
    input: UpdateProjectGovernanceRequest,
  ): Promise<ProjectSummary> {
    await this.requireRegistered(actor);
    const actorMembership = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, actor.userId],
    );
    const actorRole = actorMembership.rows[0]?.role;
    const ownerOnly = [
      "convert_to_shared",
      "set_visibility",
      "transfer_ownership",
    ].includes(input.action.type);
    if (ownerOnly && actorRole !== "owner") throw new AuthorizationError();
    const targetRole =
      input.action.type === "set_member_role"
        ? input.action.role
        : "researcher";
    if (!ownerOnly) requireProjectRoleAssignment(actorRole, targetRole);
    const replay = await this.readGovernanceReplay(
      actor,
      projectId,
      input.idempotencyKey,
      `project.${input.action.type}`,
      input,
    );
    if (replay) {
      return ProjectSummarySchema.parse(replay);
    }
    const now = this.now().toISOString();
    const result = await this.transaction(async () => {
      const project = await this.database.query<DbRow>(
        "SELECT * FROM projects WHERE id = $1 FOR UPDATE",
        [projectId],
      );
      const row = project.rows[0];
      if (!row) throw new CatalogNotFoundError();
      const lockedActorMembership = await this.database.query<{
        role: ProjectRole;
      }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR UPDATE`,
        [projectId, actor.userId],
      );
      const lockedActorRole = lockedActorMembership.rows[0]?.role;
      if (ownerOnly && lockedActorRole !== "owner")
        throw new AuthorizationError();
      if (!ownerOnly) requireProjectRoleAssignment(lockedActorRole, targetRole);
      const lockedReplay = await this.readGovernanceReplay(
        actor,
        projectId,
        input.idempotencyKey,
        `project.${input.action.type}`,
        input,
      );
      if (lockedReplay) return ProjectSummarySchema.parse(lockedReplay);
      if (Number(row.version) !== input.expectedVersion)
        throw new CatalogConflictError("The project version is stale.");
      let eventType: ProjectGovernanceEvent["eventType"];
      let targetUserId: string | undefined;
      if (input.action.type === "convert_to_shared") {
        if (row.kind !== "personal")
          throw new CatalogConflictError("This project is already shared.");
        await this.database.query(
          `UPDATE projects SET kind = 'shared', visibility = $2,
             version = version + 1, updated_at = $3 WHERE id = $1`,
          [projectId, input.action.visibility, now],
        );
        eventType = "project_converted";
      } else if (input.action.type === "set_visibility") {
        if (row.kind !== "shared")
          throw new CatalogConflictError("Convert the project first.");
        await this.database.query(
          `UPDATE projects SET visibility = $2, version = version + 1,
             updated_at = $3 WHERE id = $1`,
          [projectId, input.action.visibility, now],
        );
        eventType = "visibility_changed";
      } else if (input.action.type === "transfer_ownership") {
        targetUserId = input.action.userId;
        if (targetUserId === actor.userId) {
          throw new CatalogInvalidRequestError(
            "Choose another accepted member as the next Owner.",
          );
        }
        const target = await this.database.query<DbRow>(
          `SELECT role FROM project_members
           WHERE project_id = $1 AND user_id = $2 FOR UPDATE`,
          [projectId, targetUserId],
        );
        if (!target.rows[0] || target.rows[0].role === "viewer")
          throw new CatalogInvalidRequestError(
            "Ownership can transfer only to an accepted writable member.",
          );
        await this.database.query(
          `UPDATE project_members SET role = 'administrator',
             version = version + 1, updated_at = $3
           WHERE project_id = $1 AND user_id = $2`,
          [projectId, actor.userId, now],
        );
        await this.database.query(
          `UPDATE project_members SET role = 'owner',
             version = version + 1, updated_at = $3
           WHERE project_id = $1 AND user_id = $2`,
          [projectId, targetUserId, now],
        );
        eventType = "ownership_transferred";
      } else {
        targetUserId = input.action.userId;
        if (targetUserId === actor.userId)
          throw new CatalogInvalidRequestError(
            "Use ownership transfer before changing the Owner.",
          );
        const target = await this.database.query<DbRow>(
          `SELECT role, version FROM project_members
           WHERE project_id = $1 AND user_id = $2 FOR UPDATE`,
          [projectId, targetUserId],
        );
        if (!target.rows[0])
          throw new CatalogNotFoundError("Member not found.");
        if (target.rows[0].role === "owner") throw new AuthorizationError();
        if (
          Number(target.rows[0].version) !== input.action.expectedMemberVersion
        )
          throw new CatalogConflictError("The member version is stale.");
        requireProjectRoleAssignment(
          lockedActorRole,
          target.rows[0].role === "administrator" ||
            (input.action.type === "set_member_role" &&
              input.action.role === "administrator")
            ? "administrator"
            : "researcher",
        );
        if (input.action.type === "remove_member") {
          await this.database.query(
            "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
            [projectId, targetUserId],
          );
          eventType = "member_removed";
        } else {
          await this.database.query(
            `UPDATE project_members SET role = $3, version = version + 1,
               updated_at = $4 WHERE project_id = $1 AND user_id = $2`,
            [projectId, targetUserId, input.action.role, now],
          );
          eventType = "member_role_changed";
        }
      }
      await insertGovernanceEvent(
        this.database,
        projectId,
        eventType,
        actor.userId,
        targetUserId,
        now,
      );
      if (
        input.action.type !== "convert_to_shared" &&
        input.action.type !== "set_visibility"
      ) {
        await this.database.query(
          `UPDATE projects SET version = version + 1, updated_at = $2
           WHERE id = $1`,
          [projectId, now],
        );
      }
      const summary = await this.getProjectSummary(actor, projectId);
      await this.storeGovernanceCommand(
        actor,
        projectId,
        input.idempotencyKey,
        `project.${input.action.type}`,
        input,
        summary,
        now,
      );
      return summary;
    });
    return result;
  }

  async addMember(
    actor: AuthenticatedActor,
    projectId: string,
    userId: string,
    role: "administrator" | "researcher" | "viewer",
  ): Promise<void> {
    await this.requireRegistered(actor);
    const [membership, project] = await Promise.all([
      this.database.query<{ role: ProjectRole }>(
        "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
        [projectId, actor.userId],
      ),
      this.database.query<DbRow>("SELECT kind FROM projects WHERE id = $1", [
        projectId,
      ]),
    ]);
    if (role === "viewer") {
      // Compatibility-only catalog setup path. The public command contract
      // deliberately cannot assign Viewer.
      requirePermission(membership.rows[0]?.role, "manage_administrators");
    } else {
      requireProjectRoleAssignment(membership.rows[0]?.role, role);
    }
    if (!project.rows[0]) throw new CatalogNotFoundError("Project not found.");
    if (project.rows[0].kind === "personal") {
      throw new CatalogConflictError(
        "Personal projects cannot have additional members.",
      );
    }
    const target = await this.database.query(
      "SELECT id FROM users WHERE id = $1",
      [userId],
    );
    if (!target.rows[0]) throw new CatalogNotFoundError("User not found.");
    const now = this.now().toISOString();
    const existing = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    if (existing.rows[0]?.role === role) return;
    if (existing.rows[0]) {
      throw new CatalogConflictError(
        "This member already has a different project role.",
      );
    }
    await this.database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, version, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $4)`,
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
      sourceIdentity?: SourceIdentityV1;
      sourceFingerprint?: SourceFingerprintEvidence;
    },
    options: { automaticLocalProcessing?: boolean } = {},
  ): Promise<Video> {
    await this.authorize(actor, projectId, "write");
    const now = this.now().toISOString();
    const id = await this.transaction(async () => {
      const catalogVideoId = await this.upsertProjectVideo(
        actor.userId,
        projectId,
        input,
        now,
      );
      const project = await this.database.query<DbRow>(
        `SELECT local_processing_state FROM projects
         WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (
        options.automaticLocalProcessing &&
        project.rows[0]?.local_processing_state === "automatic"
      ) {
        await this.enqueueMissingProjectLocalVideos(
          actor,
          projectId,
          now,
          1,
          catalogVideoId,
        );
      }
      return catalogVideoId;
    });
    const result = await this.database.query<DbRow>(
      `SELECT id, youtube_video_id, canonical_url, title, channel, duration_ms,
              source_language, source_provider, provider_media_id,
              source_fingerprint_evidence, created_at, updated_at
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
              v.duration_ms, v.source_language, v.source_provider,
              v.provider_media_id, v.source_fingerprint_evidence,
              v.created_at, v.updated_at
       FROM project_videos pv
       JOIN videos v ON v.id = pv.video_id
       WHERE pv.project_id = $1
       ORDER BY pv.updated_at DESC, v.id`,
      [projectId],
    );
    return result.rows.map(mapVideo);
  }

  async getProjectLocalProcessingStatus(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectLocalProcessingStatus> {
    await this.authorize(actor, projectId, "read");
    return this.loadProjectLocalProcessingStatus(projectId);
  }

  async updateProjectLocalProcessing(
    actor: AuthenticatedActor,
    projectId: string,
    input: UpdateProjectLocalProcessingRequest,
  ): Promise<UpdateProjectLocalProcessingResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectLocalProcessingRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();

    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2
         FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "manage_project");
      const selected = await this.database.query<DbRow>(
        `SELECT local_processing_version FROM projects
         WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (!selected.rows[0]) {
        throw new CatalogNotFoundError("Project not found.");
      }
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM project_local_processing_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This local-processing command key was already used for another request.",
          );
        }
        return UpdateProjectLocalProcessingResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }
      if (
        Number(selected.rows[0].local_processing_version) !==
        command.expectedVersion
      ) {
        throw new CatalogConflictError(
          "The local-processing policy changed; reload before trying again.",
        );
      }
      await this.database.query(
        `UPDATE projects
         SET local_processing_state = $1,
             local_processing_version = local_processing_version + 1,
             local_processing_updated_by = $2,
             local_processing_updated_at = $3,
             updated_at = $3
         WHERE id = $4`,
        [command.state, actor.userId, now, projectId],
      );
      const enqueuedCount =
        command.state === "automatic"
          ? await this.enqueueMissingProjectLocalVideos(
              actor,
              projectId,
              now,
              50,
            )
          : 0;
      const status = await this.loadProjectLocalProcessingStatus(projectId);
      const response = UpdateProjectLocalProcessingResponseSchema.parse({
        ...status,
        enqueuedCount,
        remainingUnprocessedCount: status.workload.unprocessedActiveVideoCount,
      });
      await this.database.query(
        `INSERT INTO project_local_processing_commands
           (id, project_id, actor_id, requested_state, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          projectId,
          actor.userId,
          command.state,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          now,
        ],
      );
      return response;
    });
  }

  async listProjectKeywords(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ProjectKeywordCatalog> {
    await this.authorize(actor, projectId, "read");
    return ProjectKeywordCatalogSchema.parse({
      ...(await this.loadProjectKeywordCatalog(projectId)),
      currentUserId: actor.userId,
    });
  }

  async getProjectKeywordScanSummary(
    actor: AuthenticatedActor,
    projectId: string,
    projectVideoId: string,
  ): Promise<ProjectKeywordScanSummary> {
    await this.authorize(actor, projectId, "read");
    return this.loadProjectKeywordScanSummary(projectId, projectVideoId);
  }

  async scheduleProjectKeywordScan(
    actor: AuthenticatedActor,
    projectId: string,
    projectVideoId: string,
  ): Promise<ProjectKeywordScanSummary> {
    await this.requireRegistered(actor);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "write");
      const current = await this.database.query<DbRow>(
        `SELECT pv.active_transcript_version_id, p.keyword_set_version,
                (SELECT count(*)::integer FROM project_keywords k
                 WHERE k.project_id = p.id AND k.enabled) AS approved_keyword_count
         FROM project_videos pv
         JOIN projects p ON p.id = pv.project_id
         WHERE pv.project_id = $1 AND pv.video_id = $2
         FOR UPDATE OF pv, p`,
        [projectId, projectVideoId],
      );
      const row = current.rows[0];
      if (!row) throw new CatalogNotFoundError("Project video not found.");
      if (!row.active_transcript_version_id) {
        return this.loadProjectKeywordScanSummary(projectId, projectVideoId);
      }
      const existing = await this.database.query<DbRow>(
        `SELECT id, state FROM project_keyword_scans
         WHERE project_id = $1 AND video_id = $2
           AND transcript_version_id = $3 AND keyword_set_version = $4
           AND scanner_schema_version = $5
         FOR UPDATE`,
        [
          projectId,
          projectVideoId,
          row.active_transcript_version_id,
          row.keyword_set_version,
          ProjectKeywordScannerSchemaVersion,
        ],
      );
      if (!existing.rows[0]) {
        await this.database.query(
          `INSERT INTO project_keyword_scans
             (id, project_id, video_id, transcript_version_id,
              keyword_set_version, scanner_schema_version, state, attempt,
              approved_keyword_count, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0, $7, $8, $8)`,
          [
            randomUUID(),
            projectId,
            projectVideoId,
            row.active_transcript_version_id,
            row.keyword_set_version,
            ProjectKeywordScannerSchemaVersion,
            Number(row.approved_keyword_count),
            now,
          ],
        );
      } else if (existing.rows[0].state === "failed") {
        await this.database.query(
          `UPDATE project_keyword_scans
           SET state = 'queued', error_code = NULL, error_message = NULL,
               terminal_actor_id = NULL, completed_at = NULL, updated_at = $1
           WHERE id = $2`,
          [now, existing.rows[0].id],
        );
      }
      return this.loadProjectKeywordScanSummary(projectId, projectVideoId);
    });
  }

  async claimProjectKeywordScan(
    actor: AuthenticatedActor,
    projectId: string | undefined,
    input: ClaimProjectKeywordScanRequest,
  ): Promise<ProjectKeywordScanClaim | undefined> {
    await this.requireRegistered(actor);
    const command = ClaimProjectKeywordScanRequestSchema.parse(input);
    const claimedAt = this.now();
    const expiresAt = new Date(
      claimedAt.getTime() + command.leaseSeconds * 1_000,
    );
    return this.transaction(async () => {
      const candidate = await this.database.query<DbRow>(
        `SELECT s.*
         FROM project_keyword_scans s
         JOIN project_members pm
           ON pm.project_id = s.project_id AND pm.user_id = $1
         JOIN projects p ON p.id = s.project_id
         JOIN project_videos pv
           ON pv.project_id = s.project_id AND pv.video_id = s.video_id
         WHERE ($2::uuid IS NULL OR s.project_id = $2)
           AND pm.role IN ('owner', 'administrator', 'researcher')
           AND pv.active_transcript_version_id = s.transcript_version_id
           AND p.keyword_set_version = s.keyword_set_version
           AND s.scanner_schema_version = $3
           AND (s.state = 'queued'
                OR (s.state = 'scanning' AND s.expires_at <= $4))
         ORDER BY s.created_at, s.id
         LIMIT 1 FOR UPDATE OF s SKIP LOCKED`,
        [
          actor.userId,
          projectId ?? null,
          ProjectKeywordScannerSchemaVersion,
          claimedAt.toISOString(),
        ],
      );
      const row = candidate.rows[0];
      if (!row) return undefined;
      const attempt = Number(row.attempt) + 1;
      await this.database.query(
        `UPDATE project_keyword_scans
         SET state = 'scanning', attempt = $1, worker_id = $2,
             claimed_at = $3, heartbeat_at = $3, expires_at = $4,
             terminal_actor_id = NULL, completed_at = NULL, updated_at = $3
         WHERE id = $5`,
        [
          attempt,
          actor.userId,
          claimedAt.toISOString(),
          expiresAt.toISOString(),
          row.id,
        ],
      );
      return ProjectKeywordScanClaimSchema.parse({
        job: mapProjectKeywordScanJob({
          ...row,
          state: "scanning",
          attempt,
          updated_at: claimedAt.toISOString(),
        }),
        workerId: actor.userId,
        attempt,
        claimedAt: claimedAt.toISOString(),
        heartbeatAt: claimedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    });
  }

  async getProjectKeywordScanInput(
    actor: AuthenticatedActor,
    projectId: string,
    scanId: string,
    input: GetProjectKeywordScanInputRequest,
  ): Promise<ProjectKeywordScanInputSnapshot> {
    await this.requireRegistered(actor);
    const command = GetProjectKeywordScanInputRequestSchema.parse(input);
    const now = this.now().toISOString();
    const snapshot = await this.transaction(
      async () => {
        const selected = await this.database.query<DbRow>(
          `SELECT s.*, v.duration_ms
           FROM project_keyword_scans s
           JOIN project_members pm
             ON pm.project_id = s.project_id AND pm.user_id = $1
           JOIN projects p ON p.id = s.project_id
           JOIN project_videos pv
             ON pv.project_id = s.project_id AND pv.video_id = s.video_id
           JOIN videos v ON v.id = s.video_id
           WHERE s.id = $2 AND s.project_id = $3 AND s.state = 'scanning'
             AND s.worker_id = $1 AND s.attempt = $4 AND s.expires_at > $5
             AND pm.role IN ('owner', 'administrator', 'researcher')
             AND p.keyword_set_version = s.keyword_set_version
             AND pv.active_transcript_version_id = s.transcript_version_id`,
          [actor.userId, scanId, projectId, command.attempt, now],
        );
        const row = selected.rows[0];
        if (!row) {
          throw new AuthorizationError(
            "The keyword scan input is stale, expired, removed, or not owned by this worker.",
          );
        }
        const aliases = await this.database.query<DbRow>(
          `SELECT a.id, a.keyword_id, a.language, a.phrase
           FROM project_keyword_aliases a
           JOIN project_keywords k
             ON k.project_id = a.project_id AND k.id = a.keyword_id
           WHERE a.project_id = $1 AND a.enabled AND k.enabled
           ORDER BY a.keyword_id, a.id
           LIMIT 20000`,
          [projectId],
        );
        return {
          row,
          aliases: aliases.rows.map((alias) => ({
            keywordId: String(alias.keyword_id),
            aliasId: String(alias.id),
            language: String(alias.language),
            phrase: String(alias.phrase),
          })),
        };
      },
      { repeatableRead: true },
    );
    const transcript = await this.loadTranscriptBundleByVersion(
      projectId,
      String(snapshot.row.video_id),
      String(snapshot.row.transcript_version_id),
    );
    return ProjectKeywordScanInputSnapshotSchema.parse({
      job: mapProjectKeywordScanJob(snapshot.row),
      attempt: command.attempt,
      aliases: snapshot.aliases,
      transcript,
      ...(snapshot.row.duration_ms === null ||
      snapshot.row.duration_ms === undefined
        ? {}
        : { durationMs: Number(snapshot.row.duration_ms) }),
    });
  }

  async heartbeatProjectKeywordScan(
    actor: AuthenticatedActor,
    projectId: string,
    scanId: string,
    input: HeartbeatProjectKeywordScanRequest,
  ): Promise<ProjectKeywordScanClaim> {
    await this.authorize(actor, projectId, "write");
    const command = HeartbeatProjectKeywordScanRequestSchema.parse(input);
    const heartbeatAt = this.now();
    const expiresAt = new Date(
      heartbeatAt.getTime() + command.leaseSeconds * 1_000,
    );
    const updated = await this.database.query<DbRow>(
      `UPDATE project_keyword_scans
       SET heartbeat_at = $1, expires_at = $2, updated_at = $1
       WHERE id = $3 AND project_id = $4 AND state = 'scanning'
         AND worker_id = $5 AND attempt = $6 AND expires_at > $1
       RETURNING *`,
      [
        heartbeatAt.toISOString(),
        expiresAt.toISOString(),
        scanId,
        projectId,
        actor.userId,
        command.attempt,
      ],
    );
    const row = updated.rows[0];
    if (!row) {
      throw new AuthorizationError(
        "The keyword scan lease is stale, expired, or not owned by this worker.",
      );
    }
    return ProjectKeywordScanClaimSchema.parse({
      job: mapProjectKeywordScanJob(row),
      workerId: actor.userId,
      attempt: command.attempt,
      claimedAt: iso(row.claimed_at),
      heartbeatAt: heartbeatAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  async createProjectKeywordScanArtifactUpload(
    actor: AuthenticatedActor,
    projectId: string,
    scanId: string,
    input: CreateProjectKeywordScanArtifactUploadRequest,
  ): Promise<ProjectKeywordScanArtifactUploadGrant> {
    const command =
      CreateProjectKeywordScanArtifactUploadRequestSchema.parse(input);
    const now = this.now();
    const selected = await this.database.query<DbRow>(
      `SELECT s.video_id, s.expires_at
       FROM project_keyword_scans s
       JOIN project_members pm
         ON pm.project_id = s.project_id AND pm.user_id = $1
       WHERE s.id = $2 AND s.project_id = $3 AND s.state = 'scanning'
         AND s.worker_id = $1 AND s.attempt = $4 AND s.expires_at > $5
         AND pm.role IN ('owner', 'administrator', 'researcher')`,
      [actor.userId, scanId, projectId, command.attempt, now.toISOString()],
    );
    const row = selected.rows[0];
    if (!row) {
      throw new AuthorizationError(
        "The keyword scan lease is stale, expired, removed, or not owned by this worker.",
      );
    }
    const expiresAt = new Date(
      Math.min(now.getTime() + 15 * 60_000, Date.parse(iso(row.expires_at))),
    );
    const expiresInSeconds = Math.max(
      1,
      Math.floor((expiresAt.getTime() - now.getTime()) / 1_000),
    );
    const objectKey = `keyword-scans/${projectId}/${row.video_id}/${scanId}/matches.json`;
    return ProjectKeywordScanArtifactUploadGrantSchema.parse({
      scanId,
      objectKey,
      uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
        objectKey,
        expiresInSeconds,
      }),
      expiresAt: expiresAt.toISOString(),
    });
  }

  async getProjectKeywordScanArtifactDownload(
    actor: AuthenticatedActor,
    projectId: string,
    scanId: string,
  ): Promise<ProjectKeywordScanArtifactDownloadTarget> {
    await this.authorize(actor, projectId, "read");
    const selected = await this.database.query<DbRow>(
      `SELECT * FROM project_keyword_scans
       WHERE id = $1 AND project_id = $2 AND state = 'completed'`,
      [scanId, projectId],
    );
    const row = selected.rows[0];
    if (!row)
      throw new CatalogNotFoundError("Completed keyword scan not found.");
    const expiresInSeconds = 300;
    const expiresAt = new Date(
      this.now().getTime() + expiresInSeconds * 1_000,
    ).toISOString();
    const artifact = {
      objectKey: row.artifact_object_key,
      objectVersionId: row.artifact_object_version_id,
      sha256: row.artifact_sha256,
      sizeBytes: Number(row.artifact_size_bytes),
      schemaVersion: Number(row.artifact_schema_version),
    };
    return ProjectKeywordScanArtifactDownloadTargetSchema.parse({
      scanId,
      artifact,
      downloadUrl: await this.uploadUrlIssuer.issueGetUrl({
        objectKey: String(row.artifact_object_key),
        objectVersionId: String(row.artifact_object_version_id),
        expiresInSeconds,
      }),
      expiresAt,
    });
  }

  async finalizeProjectKeywordScan(
    actor: AuthenticatedActor,
    projectId: string,
    scanId: string,
    input: FinalizeProjectKeywordScanRequest,
  ): Promise<ProjectKeywordScanSummary> {
    await this.authorize(actor, projectId, "write");
    const command = FinalizeProjectKeywordScanRequestSchema.parse(input);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_keyword_scans
         WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [scanId, projectId],
      );
      const row = selected.rows[0];
      if (!row) throw new CatalogNotFoundError("Keyword scan not found.");
      const exactTerminal =
        row.state === "completed" &&
        String(row.terminal_actor_id) === actor.userId &&
        Number(row.attempt) === command.attempt &&
        String(row.artifact_object_key) === command.artifact.objectKey &&
        String(row.artifact_object_version_id) ===
          command.artifact.objectVersionId &&
        String(row.artifact_sha256) === command.artifact.sha256 &&
        Number(row.artifact_size_bytes) === command.artifact.sizeBytes &&
        Number(row.occurrence_count) === command.occurrenceCount &&
        Number(row.matched_keyword_count) === command.matchedKeywordCount &&
        canonicalJson(jsonArray(row.keyword_counts) ?? []) ===
          canonicalJson(command.keywordCounts) &&
        (row.duration_ms === null
          ? command.durationMs === undefined
          : Number(row.duration_ms) === command.durationMs);
      if (exactTerminal) {
        return this.loadProjectKeywordScanSummary(
          projectId,
          String(row.video_id),
        );
      }
      if (
        row.state !== "scanning" ||
        String(row.worker_id) !== actor.userId ||
        Number(row.attempt) !== command.attempt ||
        Date.parse(iso(row.expires_at)) <= Date.parse(now)
      ) {
        throw new CatalogConflictError(
          "The keyword scan lease changed or a divergent result already finalized.",
        );
      }
      const expectedObjectKey = `keyword-scans/${projectId}/${row.video_id}/${scanId}/matches.json`;
      if (command.artifact.objectKey !== expectedObjectKey) {
        throw new CatalogValidationError(
          "The keyword scan artifact key does not match this exact job.",
        );
      }
      if (
        command.matchedKeywordCount > Number(row.approved_keyword_count) ||
        command.artifact.schemaVersion !== Number(row.scanner_schema_version)
      ) {
        throw new CatalogValidationError(
          "The keyword scan aggregate or artifact schema exceeds its exact input snapshot.",
        );
      }
      const stored = await this.store.getBounded(
        command.artifact.objectKey,
        command.artifact.objectVersionId,
        50_000_000,
      );
      const actualSha256 = stored
        ? createHash("sha256").update(stored.bytes).digest("hex")
        : undefined;
      if (
        !stored ||
        stored.bytes.byteLength !== command.artifact.sizeBytes ||
        actualSha256 !== command.artifact.sha256
      ) {
        throw new TranscriptIntegrityError(
          "The private keyword scan artifact is missing or failed checksum verification.",
        );
      }
      let artifact;
      try {
        artifact = ProjectKeywordMatchArtifactSchema.parse(
          JSON.parse(new TextDecoder().decode(stored.bytes)),
        );
      } catch {
        throw new TranscriptIntegrityError(
          "The private keyword scan artifact is not valid scanner evidence.",
        );
      }
      const artifactMatchedKeywordCount = new Set(
        artifact.occurrences.map((occurrence) => occurrence.keywordId),
      ).size;
      const artifactKeywordCountMap = new Map<string, number>();
      for (const occurrence of artifact.occurrences) {
        artifactKeywordCountMap.set(
          occurrence.keywordId,
          (artifactKeywordCountMap.get(occurrence.keywordId) ?? 0) + 1,
        );
      }
      const artifactKeywordCounts = [...artifactKeywordCountMap]
        .map(([keywordId, occurrenceCount]) => ({
          keywordId,
          occurrenceCount,
        }))
        .sort((left, right) => left.keywordId.localeCompare(right.keywordId));
      if (
        artifact.projectId !== projectId ||
        artifact.projectVideoId !== String(row.video_id) ||
        artifact.transcriptVersionId !== String(row.transcript_version_id) ||
        artifact.keywordSetVersion !== Number(row.keyword_set_version) ||
        artifact.scannerSchemaVersion !== Number(row.scanner_schema_version) ||
        artifact.occurrences.length !== command.occurrenceCount ||
        artifactMatchedKeywordCount !== command.matchedKeywordCount ||
        canonicalJson(artifactKeywordCounts) !==
          canonicalJson(
            [...command.keywordCounts].sort((left, right) =>
              left.keywordId.localeCompare(right.keywordId),
            ),
          )
      ) {
        throw new TranscriptIntegrityError(
          "The private keyword scan artifact does not match this exact scan input and aggregate.",
        );
      }
      await this.database.query(
        `UPDATE project_keyword_scans
         SET state = 'completed', worker_id = NULL, claimed_at = NULL,
             heartbeat_at = NULL, expires_at = NULL,
             artifact_object_key = $1, artifact_sha256 = $2,
             artifact_object_version_id = $3,
             artifact_size_bytes = $4, artifact_schema_version = $5,
             occurrence_count = $6, matched_keyword_count = $7,
             keyword_counts = $8::jsonb, duration_ms = $9,
             terminal_actor_id = $10,
             completed_at = $11, updated_at = $11
         WHERE id = $12`,
        [
          command.artifact.objectKey,
          command.artifact.sha256,
          command.artifact.objectVersionId,
          command.artifact.sizeBytes,
          command.artifact.schemaVersion,
          command.occurrenceCount,
          command.matchedKeywordCount,
          JSON.stringify(artifactKeywordCounts),
          command.durationMs ?? null,
          actor.userId,
          now,
          scanId,
        ],
      );
      const recipients = await this.database.query<{ user_id: string }>(
        `SELECT user_id FROM project_members WHERE project_id = $1`,
        [projectId],
      );
      await this.createProjectVideoActivity(
        projectId,
        String(row.video_id),
        actor.userId,
        "keyword_scan_completed",
        `keyword-scan:${scanId}`,
        undefined,
        recipients.rows.map((member) => String(member.user_id)),
        now,
      );
      return this.loadProjectKeywordScanSummary(
        projectId,
        String(row.video_id),
      );
    });
  }

  async failProjectKeywordScan(
    actor: AuthenticatedActor,
    projectId: string,
    scanId: string,
    input: FailProjectKeywordScanRequest,
  ): Promise<ProjectKeywordScanSummary> {
    await this.authorize(actor, projectId, "write");
    const command = FailProjectKeywordScanRequestSchema.parse(input);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_keyword_scans
         WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [scanId, projectId],
      );
      const row = selected.rows[0];
      if (!row) throw new CatalogNotFoundError("Keyword scan not found.");
      const exactTerminal =
        row.state === "failed" &&
        String(row.terminal_actor_id) === actor.userId &&
        Number(row.attempt) === command.attempt &&
        String(row.error_code) === command.error.code &&
        String(row.error_message) === command.error.message;
      if (exactTerminal) {
        return this.loadProjectKeywordScanSummary(
          projectId,
          String(row.video_id),
        );
      }
      if (
        row.state !== "scanning" ||
        String(row.worker_id) !== actor.userId ||
        Number(row.attempt) !== command.attempt ||
        Date.parse(iso(row.expires_at)) <= Date.parse(now)
      ) {
        throw new CatalogConflictError(
          "The keyword scan lease changed or a divergent failure already finalized.",
        );
      }
      await this.database.query(
        `UPDATE project_keyword_scans
         SET state = 'failed', worker_id = NULL, claimed_at = NULL,
             heartbeat_at = NULL, expires_at = NULL,
             error_code = $1, error_message = $2, terminal_actor_id = $3,
             completed_at = $4, updated_at = $4
         WHERE id = $5`,
        [command.error.code, command.error.message, actor.userId, now, scanId],
      );
      return this.loadProjectKeywordScanSummary(
        projectId,
        String(row.video_id),
      );
    });
  }

  private async enqueueCurrentProjectKeywordScans(
    projectId: string,
    now: string,
  ): Promise<void> {
    const videos = await this.database.query<DbRow>(
      `SELECT pv.video_id, pv.active_transcript_version_id
       FROM project_videos pv
       WHERE pv.project_id = $1 AND pv.active_transcript_version_id IS NOT NULL
       ORDER BY pv.video_id
       LIMIT 500`,
      [projectId],
    );
    for (const video of videos.rows) {
      await this.enqueueProjectVideoKeywordScan(
        projectId,
        String(video.video_id),
        String(video.active_transcript_version_id),
        now,
      );
    }
  }

  private async enqueueProjectVideoKeywordScan(
    projectId: string,
    projectVideoId: string,
    transcriptVersionId: string,
    now: string,
  ): Promise<void> {
    const project = await this.database.query<DbRow>(
      `SELECT p.keyword_set_version,
              (SELECT count(*)::integer FROM project_keywords k
               WHERE k.project_id = p.id AND k.enabled) AS approved_keyword_count
       FROM projects p WHERE p.id = $1`,
      [projectId],
    );
    const row = project.rows[0];
    if (!row) throw new CatalogNotFoundError("Project not found.");
    await this.database.query(
      `INSERT INTO project_keyword_scans
         (id, project_id, video_id, transcript_version_id,
          keyword_set_version, scanner_schema_version, state, attempt,
          approved_keyword_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0, $7, $8, $8)
       ON CONFLICT
         (project_id, video_id, transcript_version_id,
          keyword_set_version, scanner_schema_version)
       DO NOTHING`,
      [
        randomUUID(),
        projectId,
        projectVideoId,
        transcriptVersionId,
        row.keyword_set_version,
        ProjectKeywordScannerSchemaVersion,
        Number(row.approved_keyword_count),
        now,
      ],
    );
  }

  private async loadProjectKeywordScanSummary(
    projectId: string,
    projectVideoId: string,
  ): Promise<ProjectKeywordScanSummary> {
    const current = await this.database.query<DbRow>(
      `SELECT pv.active_transcript_version_id, p.keyword_set_version,
              (SELECT count(*)::integer FROM project_keywords k
               WHERE k.project_id = p.id AND k.enabled) AS approved_keyword_count
       FROM project_videos pv
       JOIN projects p ON p.id = pv.project_id
       WHERE pv.project_id = $1 AND pv.video_id = $2`,
      [projectId, projectVideoId],
    );
    const identity = current.rows[0];
    if (!identity) throw new CatalogNotFoundError("Project video not found.");
    const base = {
      projectId,
      projectVideoId,
      keywordSetVersion: Number(identity.keyword_set_version),
      scannerSchemaVersion: ProjectKeywordScannerSchemaVersion,
      approvedKeywordCount: Number(identity.approved_keyword_count),
    };
    if (!identity.active_transcript_version_id) {
      return ProjectKeywordScanSummarySchema.parse({
        ...base,
        status: "waiting_for_transcript",
      });
    }
    const exact = await this.database.query<DbRow>(
      `SELECT * FROM project_keyword_scans
       WHERE project_id = $1 AND video_id = $2
         AND transcript_version_id = $3 AND keyword_set_version = $4
         AND scanner_schema_version = $5
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [
        projectId,
        projectVideoId,
        identity.active_transcript_version_id,
        identity.keyword_set_version,
        ProjectKeywordScannerSchemaVersion,
      ],
    );
    let row = exact.rows[0];
    let status: ProjectKeywordScanSummary["status"];
    if (row) {
      status =
        row.state === "completed"
          ? "current"
          : row.state === "scanning" &&
              Date.parse(iso(row.expires_at)) <= this.now().getTime()
            ? "queued"
            : row.state === "scanning"
              ? "scanning"
              : row.state === "failed"
                ? "failed"
                : "queued";
    } else {
      const prior = await this.database.query<DbRow>(
        `SELECT * FROM project_keyword_scans
         WHERE project_id = $1 AND video_id = $2 AND state = 'completed'
         ORDER BY completed_at DESC, id DESC LIMIT 1`,
        [projectId, projectVideoId],
      );
      row = prior.rows[0];
      status = row ? "stale" : "not_scanned";
    }
    if (!row) {
      return ProjectKeywordScanSummarySchema.parse({
        ...base,
        status,
        transcriptVersionId: identity.active_transcript_version_id,
      });
    }
    const terminal = status === "current" || status === "stale";
    const prior = terminal
      ? undefined
      : (
          await this.database.query<DbRow>(
            `SELECT * FROM project_keyword_scans
             WHERE project_id = $1 AND video_id = $2 AND state = 'completed'
               AND id <> $3
             ORDER BY completed_at DESC, id DESC LIMIT 1`,
            [projectId, projectVideoId, row.id],
          )
        ).rows[0];
    const completedResult = (completed: DbRow) => ({
      scanId: completed.id,
      transcriptVersionId: completed.transcript_version_id,
      keywordSetVersion: Number(completed.keyword_set_version),
      scannerSchemaVersion: Number(completed.scanner_schema_version),
      occurrenceCount: Number(completed.occurrence_count),
      matchedKeywordCount: Number(completed.matched_keyword_count),
      ...(jsonArray(completed.keyword_counts)
        ? { keywordCounts: jsonArray(completed.keyword_counts) }
        : {}),
      approvedKeywordCount: Number(completed.approved_keyword_count),
      ...(completed.duration_ms === null || completed.duration_ms === undefined
        ? {}
        : {
            durationMs: Number(completed.duration_ms),
            matchesPerMinute:
              (Number(completed.occurrence_count) * 60_000) /
              Number(completed.duration_ms),
          }),
      artifact: {
        objectKey: completed.artifact_object_key,
        objectVersionId: completed.artifact_object_version_id,
        sha256: completed.artifact_sha256,
        sizeBytes: Number(completed.artifact_size_bytes),
        schemaVersion: Number(completed.artifact_schema_version),
      },
      completedAt: iso(completed.completed_at),
    });
    return ProjectKeywordScanSummarySchema.parse({
      ...base,
      scanId: row.id,
      status,
      transcriptVersionId: row.transcript_version_id,
      keywordSetVersion: Number(row.keyword_set_version),
      approvedKeywordCount: Number(row.approved_keyword_count),
      ...(terminal
        ? {
            occurrenceCount: Number(row.occurrence_count),
            matchedKeywordCount: Number(row.matched_keyword_count),
            ...(jsonArray(row.keyword_counts)
              ? { keywordCounts: jsonArray(row.keyword_counts) }
              : {}),
            artifact: {
              objectKey: row.artifact_object_key,
              objectVersionId: row.artifact_object_version_id,
              sha256: row.artifact_sha256,
              sizeBytes: Number(row.artifact_size_bytes),
              schemaVersion: Number(row.artifact_schema_version),
            },
            completedAt: iso(row.completed_at),
          }
        : {}),
      ...(row.duration_ms === null || row.duration_ms === undefined
        ? {}
        : {
            durationMs: Number(row.duration_ms),
            ...(terminal
              ? {
                  matchesPerMinute:
                    (Number(row.occurrence_count) * 60_000) /
                    Number(row.duration_ms),
                }
              : {}),
          }),
      ...(status === "failed"
        ? {
            error: {
              code: String(row.error_code),
              message: String(row.error_message),
            },
          }
        : {}),
      ...(prior ? { priorResult: completedResult(prior) } : {}),
    });
  }

  async suggestProjectKeyword(
    actor: AuthenticatedActor,
    projectId: string,
    input: SuggestProjectKeywordRequest,
  ): Promise<SuggestProjectKeywordResponse> {
    await this.requireRegistered(actor);
    const command = SuggestProjectKeywordRequestSchema.parse(input);
    const normalizedPhrase = normalizeProjectKeywordPhrase(command.phrase);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "write");
      const project = await this.database.query(
        "SELECT id FROM projects WHERE id = $1 FOR UPDATE",
        [projectId],
      );
      if (!project.rows[0])
        throw new CatalogNotFoundError("Project not found.");
      const replay = await this.loadProjectKeywordCommandReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) return SuggestProjectKeywordResponseSchema.parse(replay);
      if (command.keywordId) {
        const target = await this.database.query(
          `SELECT id FROM project_keywords
           WHERE project_id = $1 AND id = $2`,
          [projectId, command.keywordId],
        );
        if (!target.rows[0]) {
          throw new CatalogNotFoundError("Project keyword not found.");
        }
      }
      const approved = await this.database.query<DbRow>(
        `SELECT a.id, a.keyword_id
         FROM project_keyword_aliases a
         WHERE a.project_id = $1 AND a.language = $2
           AND a.normalized_phrase = $3`,
        [projectId, command.language, normalizedPhrase],
      );
      let response: SuggestProjectKeywordResponse;
      if (approved.rows[0]) {
        const catalog = await this.loadProjectKeywordCatalog(projectId);
        const keyword = catalog.keywords.find(
          (entry) => entry.id === String(approved.rows[0]!.keyword_id),
        )!;
        response = SuggestProjectKeywordResponseSchema.parse({
          resolution: "already_approved",
          keyword,
          alias: keyword.aliases.find(
            (alias) => alias.id === String(approved.rows[0]!.id),
          ),
        });
      } else {
        const pending = await this.database.query<DbRow>(
          `SELECT id FROM project_keyword_suggestions
           WHERE project_id = $1 AND language = $2
             AND normalized_phrase = $3 AND state = 'pending'`,
          [projectId, command.language, normalizedPhrase],
        );
        const suggestionId = pending.rows[0]?.id
          ? String(pending.rows[0].id)
          : randomUUID();
        if (!pending.rows[0]) {
          await this.database.query(
            `INSERT INTO project_keyword_suggestions
               (id, project_id, keyword_id, proposed_label,
                proposed_description, language, phrase, normalized_phrase,
                rationale, state, version, proposed_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                     'pending', 1, $10, $11, $11)`,
            [
              suggestionId,
              projectId,
              command.keywordId ?? null,
              command.proposedLabel ?? null,
              command.proposedDescription ?? null,
              command.language,
              command.phrase,
              normalizedPhrase,
              command.rationale ?? null,
              actor.userId,
              now,
            ],
          );
        }
        const catalog = await this.loadProjectKeywordCatalog(projectId);
        response = SuggestProjectKeywordResponseSchema.parse({
          resolution: pending.rows[0] ? "existing_pending" : "created",
          suggestion: catalog.suggestions.find(
            (entry) => entry.id === suggestionId,
          ),
        });
      }
      await this.recordProjectKeywordCommand(
        projectId,
        actor.userId,
        "suggest",
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  async reviewProjectKeywordSuggestion(
    actor: AuthenticatedActor,
    projectId: string,
    suggestionId: string,
    input: ReviewProjectKeywordSuggestionRequest,
  ): Promise<ReviewProjectKeywordSuggestionResponse> {
    await this.requireRegistered(actor);
    const command = ReviewProjectKeywordSuggestionRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson({ suggestionId, ...command }))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "manage_project");
      const project = await this.database.query<DbRow>(
        `SELECT keyword_set_version FROM projects
         WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (!project.rows[0])
        throw new CatalogNotFoundError("Project not found.");
      const replay = await this.loadProjectKeywordCommandReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) {
        return ReviewProjectKeywordSuggestionResponseSchema.parse(replay);
      }
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_keyword_suggestions
         WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [suggestionId, projectId],
      );
      const suggestion = selected.rows[0];
      if (!suggestion) {
        throw new CatalogNotFoundError("Keyword suggestion not found.");
      }
      if (Number(suggestion.version) !== command.expectedSuggestionVersion) {
        throw new CatalogConflictError(
          "The keyword suggestion changed; reload before reviewing it.",
        );
      }
      if (suggestion.state !== "pending") {
        throw new CatalogConflictError(
          "This keyword suggestion was already reviewed.",
        );
      }
      let keywordId = suggestion.keyword_id
        ? String(suggestion.keyword_id)
        : undefined;
      let keywordSetVersion = Number(project.rows[0].keyword_set_version);
      if (command.action === "approve") {
        if (keywordSetVersion !== command.expectedKeywordSetVersion) {
          throw new CatalogConflictError(
            "The project keyword set changed; reload before approving.",
          );
        }
        if (!keywordId) {
          const label = String(suggestion.proposed_label);
          const normalizedLabel = normalizeProjectKeywordPhrase(label);
          if (normalizedLabel.length > 120) {
            throw new CatalogValidationError(
              "The normalized keyword label exceeds 120 characters.",
            );
          }
          const duplicateLabel = await this.database.query(
            `SELECT id FROM project_keywords
             WHERE project_id = $1 AND normalized_label = $2`,
            [projectId, normalizedLabel],
          );
          if (duplicateLabel.rows[0]) {
            throw new CatalogConflictError(
              "A project keyword with that display label already exists; suggest this phrase as an alias for it.",
            );
          }
          keywordId = randomUUID();
          await this.database.query(
            `INSERT INTO project_keywords
               (id, project_id, label, normalized_label, description,
                enabled, version, created_by, updated_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, true, 1, $6, $6, $7, $7)`,
            [
              keywordId,
              projectId,
              label,
              normalizedLabel,
              suggestion.proposed_description,
              actor.userId,
              now,
            ],
          );
        } else {
          const target = await this.database.query(
            `SELECT id FROM project_keywords
             WHERE id = $1 AND project_id = $2 FOR UPDATE`,
            [keywordId, projectId],
          );
          if (!target.rows[0]) {
            throw new CatalogConflictError(
              "The target keyword no longer exists.",
            );
          }
        }
        const aliasCount = await this.database.query<{ count: number }>(
          `SELECT count(*)::integer AS count
           FROM project_keyword_aliases
           WHERE project_id = $1 AND keyword_id = $2`,
          [projectId, keywordId],
        );
        if (Number(aliasCount.rows[0]?.count ?? 0) >= 100) {
          throw new CatalogConflictError(
            "This project keyword already has the maximum 100 aliases.",
          );
        }
        const duplicateAlias = await this.database.query(
          `SELECT id FROM project_keyword_aliases
           WHERE project_id = $1 AND language = $2
             AND normalized_phrase = $3`,
          [projectId, suggestion.language, suggestion.normalized_phrase],
        );
        if (duplicateAlias.rows[0]) {
          throw new CatalogConflictError(
            "That language-specific project keyword alias is already approved.",
          );
        }
        await this.database.query(
          `INSERT INTO project_keyword_aliases
             (id, project_id, keyword_id, language, phrase,
              normalized_phrase, enabled, version, created_by, updated_by,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, true, 1, $7, $7, $8, $8)`,
          [
            randomUUID(),
            projectId,
            keywordId,
            suggestion.language,
            suggestion.phrase,
            suggestion.normalized_phrase,
            actor.userId,
            now,
          ],
        );
        keywordSetVersion += 1;
        await this.database.query(
          `UPDATE projects
           SET keyword_set_version = $1, updated_at = $2 WHERE id = $3`,
          [keywordSetVersion, now, projectId],
        );
        await this.enqueueCurrentProjectKeywordScans(projectId, now);
      }
      await this.database.query(
        `UPDATE project_keyword_suggestions
         SET keyword_id = $1, state = $2, version = version + 1,
             reviewed_by = $3, reviewed_at = $4, review_reason = $5,
             updated_at = $4
         WHERE id = $6`,
        [
          keywordId ?? null,
          command.action === "approve" ? "approved" : "rejected",
          actor.userId,
          now,
          command.reason ?? null,
          suggestionId,
        ],
      );
      const catalog = await this.loadProjectKeywordCatalog(projectId);
      const reviewed = catalog.suggestions.find(
        (entry) => entry.id === suggestionId,
      )!;
      const keyword = keywordId
        ? catalog.keywords.find((entry) => entry.id === keywordId)
        : undefined;
      const response = ReviewProjectKeywordSuggestionResponseSchema.parse({
        projectId,
        keywordSetVersion,
        suggestion: reviewed,
        ...(command.action === "approve" && keyword
          ? {
              keyword,
              alias: keyword.aliases.find(
                (entry) =>
                  entry.language === reviewed.language &&
                  entry.normalizedPhrase === reviewed.normalizedPhrase,
              ),
            }
          : {}),
      });
      await this.recordProjectKeywordCommand(
        projectId,
        actor.userId,
        "review",
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  async withdrawProjectKeywordSuggestion(
    actor: AuthenticatedActor,
    projectId: string,
    suggestionId: string,
    input: WithdrawProjectKeywordSuggestionRequest,
  ): Promise<WithdrawProjectKeywordSuggestionResponse> {
    await this.requireRegistered(actor);
    const command = WithdrawProjectKeywordSuggestionRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson({ suggestionId, ...command }))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "write");
      const project = await this.database.query<DbRow>(
        `SELECT keyword_set_version FROM projects WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (!project.rows[0])
        throw new CatalogNotFoundError("Project not found.");
      const replay = await this.loadProjectKeywordCommandReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) {
        return WithdrawProjectKeywordSuggestionResponseSchema.parse(replay);
      }
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_keyword_suggestions
         WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [suggestionId, projectId],
      );
      const suggestion = selected.rows[0];
      if (!suggestion) {
        throw new CatalogNotFoundError("Keyword suggestion not found.");
      }
      if (String(suggestion.proposed_by) !== actor.userId) {
        throw new AuthorizationError(
          "Only the member who proposed this suggestion may withdraw it.",
        );
      }
      if (Number(suggestion.version) !== command.expectedSuggestionVersion) {
        throw new CatalogConflictError(
          "The keyword suggestion changed; reload before withdrawing it.",
        );
      }
      if (suggestion.state !== "pending") {
        throw new CatalogConflictError(
          "Only a pending keyword suggestion may be withdrawn.",
        );
      }
      await this.database.query(
        `UPDATE project_keyword_suggestions
         SET state = 'withdrawn', version = version + 1,
             withdrawn_by = $1, withdrawn_at = $2, withdraw_reason = $3,
             updated_at = $2
         WHERE id = $4`,
        [actor.userId, now, command.reason ?? null, suggestionId],
      );
      const catalog = await this.loadProjectKeywordCatalog(projectId);
      const response = WithdrawProjectKeywordSuggestionResponseSchema.parse({
        projectId,
        keywordSetVersion: Number(project.rows[0].keyword_set_version),
        suggestion: catalog.suggestions.find(
          (entry) => entry.id === suggestionId,
        ),
      });
      await this.recordProjectKeywordCommand(
        projectId,
        actor.userId,
        "withdraw",
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  async updateProjectKeyword(
    actor: AuthenticatedActor,
    projectId: string,
    keywordId: string,
    input: UpdateProjectKeywordRequest,
  ): Promise<UpdateProjectKeywordResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectKeywordRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson({ keywordId, ...command }))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "manage_project");
      const project = await this.database.query<DbRow>(
        `SELECT keyword_set_version FROM projects WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (!project.rows[0])
        throw new CatalogNotFoundError("Project not found.");
      const replay = await this.loadProjectKeywordCommandReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) return UpdateProjectKeywordResponseSchema.parse(replay);
      if (
        Number(project.rows[0].keyword_set_version) !==
        command.expectedKeywordSetVersion
      ) {
        throw new CatalogConflictError(
          "The project keyword set changed; reload before updating it.",
        );
      }
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_keywords
         WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [projectId, keywordId],
      );
      const keyword = selected.rows[0];
      if (!keyword)
        throw new CatalogNotFoundError("Project keyword not found.");
      if (Number(keyword.version) !== command.expectedKeywordVersion) {
        throw new CatalogConflictError(
          "The project keyword changed; reload before updating it.",
        );
      }
      const label = command.label ?? String(keyword.label);
      const normalizedLabel = normalizeProjectKeywordPhrase(label);
      if (normalizedLabel.length > 120) {
        throw new CatalogValidationError(
          "The normalized keyword label exceeds 120 characters.",
        );
      }
      const description =
        command.description === undefined
          ? keyword.description
          : command.description;
      const enabled = command.enabled ?? Boolean(keyword.enabled);
      if (enabled) {
        const enabledAliases = await this.database.query<{ count: number }>(
          `SELECT count(*)::integer AS count
           FROM project_keyword_aliases
           WHERE project_id = $1 AND keyword_id = $2 AND enabled`,
          [projectId, keywordId],
        );
        if (Number(enabledAliases.rows[0]?.count ?? 0) === 0) {
          throw new CatalogConflictError(
            "An enabled project keyword must have at least one enabled alias.",
          );
        }
      }
      const changed =
        label !== String(keyword.label) ||
        normalizedLabel !== String(keyword.normalized_label) ||
        (description ?? null) !== (keyword.description ?? null) ||
        enabled !== Boolean(keyword.enabled);
      if (!changed) {
        throw new CatalogConflictError(
          "The project keyword update does not change any stored value.",
        );
      }
      try {
        await this.database.query(
          `UPDATE project_keywords
           SET label = $1, normalized_label = $2, description = $3,
               enabled = $4, version = version + 1, updated_by = $5,
               updated_at = $6
           WHERE project_id = $7 AND id = $8`,
          [
            label,
            normalizedLabel,
            description ?? null,
            enabled,
            actor.userId,
            now,
            projectId,
            keywordId,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new CatalogConflictError(
            "A project keyword with that normalized display label already exists.",
          );
        }
        throw error;
      }
      const keywordSetVersion = command.expectedKeywordSetVersion + 1;
      await this.database.query(
        `UPDATE projects SET keyword_set_version = $1, updated_at = $2
         WHERE id = $3`,
        [keywordSetVersion, now, projectId],
      );
      await this.enqueueCurrentProjectKeywordScans(projectId, now);
      const catalog = await this.loadProjectKeywordCatalog(projectId);
      const response = UpdateProjectKeywordResponseSchema.parse({
        projectId,
        keywordSetVersion,
        keyword: catalog.keywords.find((entry) => entry.id === keywordId),
      });
      await this.recordProjectKeywordCommand(
        projectId,
        actor.userId,
        "keyword_update",
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  async updateProjectKeywordAlias(
    actor: AuthenticatedActor,
    projectId: string,
    keywordId: string,
    aliasId: string,
    input: UpdateProjectKeywordAliasRequest,
  ): Promise<UpdateProjectKeywordAliasResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectKeywordAliasRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson({ keywordId, aliasId, ...command }))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "manage_project");
      const project = await this.database.query<DbRow>(
        `SELECT keyword_set_version FROM projects WHERE id = $1 FOR UPDATE`,
        [projectId],
      );
      if (!project.rows[0])
        throw new CatalogNotFoundError("Project not found.");
      const replay = await this.loadProjectKeywordCommandReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) return UpdateProjectKeywordAliasResponseSchema.parse(replay);
      if (
        Number(project.rows[0].keyword_set_version) !==
        command.expectedKeywordSetVersion
      ) {
        throw new CatalogConflictError(
          "The project keyword set changed; reload before updating it.",
        );
      }
      const selected = await this.database.query<DbRow>(
        `SELECT a.*, k.enabled AS keyword_enabled
         FROM project_keyword_aliases a
         JOIN project_keywords k
           ON k.project_id = a.project_id AND k.id = a.keyword_id
         WHERE a.project_id = $1 AND a.keyword_id = $2 AND a.id = $3
         FOR UPDATE OF a, k`,
        [projectId, keywordId, aliasId],
      );
      const alias = selected.rows[0];
      if (!alias)
        throw new CatalogNotFoundError("Project keyword alias not found.");
      if (Number(alias.version) !== command.expectedAliasVersion) {
        throw new CatalogConflictError(
          "The project keyword alias changed; reload before updating it.",
        );
      }
      const language = command.language ?? String(alias.language);
      const phrase = command.phrase ?? String(alias.phrase);
      const normalizedPhrase = normalizeProjectKeywordPhrase(phrase);
      const enabled = command.enabled ?? Boolean(alias.enabled);
      if (
        Boolean(alias.keyword_enabled) &&
        Boolean(alias.enabled) &&
        !enabled
      ) {
        const enabledAliases = await this.database.query<{ count: number }>(
          `SELECT count(*)::integer AS count
           FROM project_keyword_aliases
           WHERE project_id = $1 AND keyword_id = $2 AND enabled`,
          [projectId, keywordId],
        );
        if (Number(enabledAliases.rows[0]?.count ?? 0) <= 1) {
          throw new CatalogConflictError(
            "Disable the project keyword before disabling its last enabled alias.",
          );
        }
      }
      const changed =
        language !== String(alias.language) ||
        phrase !== String(alias.phrase) ||
        normalizedPhrase !== String(alias.normalized_phrase) ||
        enabled !== Boolean(alias.enabled);
      if (!changed) {
        throw new CatalogConflictError(
          "The project keyword alias update does not change any stored value.",
        );
      }
      try {
        await this.database.query(
          `UPDATE project_keyword_aliases
           SET language = $1, phrase = $2, normalized_phrase = $3,
               enabled = $4, version = version + 1, updated_by = $5,
               updated_at = $6
           WHERE project_id = $7 AND keyword_id = $8 AND id = $9`,
          [
            language,
            phrase,
            normalizedPhrase,
            enabled,
            actor.userId,
            now,
            projectId,
            keywordId,
            aliasId,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new CatalogConflictError(
            "That normalized language-specific alias is already reserved in this project.",
          );
        }
        throw error;
      }
      const keywordSetVersion = command.expectedKeywordSetVersion + 1;
      await this.database.query(
        `UPDATE projects SET keyword_set_version = $1, updated_at = $2
         WHERE id = $3`,
        [keywordSetVersion, now, projectId],
      );
      await this.enqueueCurrentProjectKeywordScans(projectId, now);
      const catalog = await this.loadProjectKeywordCatalog(projectId);
      const keyword = catalog.keywords.find((entry) => entry.id === keywordId);
      const response = UpdateProjectKeywordAliasResponseSchema.parse({
        projectId,
        keywordSetVersion,
        keyword,
        alias: keyword?.aliases.find((entry) => entry.id === aliasId),
      });
      await this.recordProjectKeywordCommand(
        projectId,
        actor.userId,
        "alias_update",
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  async listProjectBookmarks(
    actor: AuthenticatedActor,
    projectId: string,
    input: ProjectBookmarkQuery,
  ): Promise<ProjectBookmarkPage> {
    await this.authorize(actor, projectId, "read");
    const query = ProjectBookmarkQuerySchema.parse(input);
    const search = query.search ? normalizeBookmarkSearch(query.search) : "";
    const cursor = query.cursor ? parseBookmarkCursor(query.cursor) : undefined;
    const identity = canonicalJson({
      projectId,
      scope: query.scope,
      videoId: query.videoId ?? null,
      state: query.state,
      search,
    });
    if (cursor && cursor.identity !== identity) {
      throw new CatalogInvalidRequestError(
        "Bookmark cursor belongs to another query.",
      );
    }
    const values: unknown[] = [projectId];
    const clauses = ["b.project_id = $1"];
    if (query.scope === "video") {
      values.push(query.videoId);
      clauses.push(`b.video_id = $${values.length}`);
    }
    if (query.state !== "all") {
      values.push(query.state);
      clauses.push(`b.state = $${values.length}`);
    }
    if (search) {
      values.push(search);
      clauses.push(`position($${values.length} in b.search_text) > 0`);
    }
    if (cursor) {
      values.push(cursor.sourceTimeMs, cursor.id);
      clauses.push(
        `(b.source_time_ms > $${values.length - 1} OR (b.source_time_ms = $${values.length - 1} AND b.id > $${values.length}))`,
      );
    }
    values.push(query.limit + 1);
    const result = await this.database.query<DbRow>(
      `SELECT b.*, v.youtube_video_id AS bookmark_youtube_video_id,
              v.canonical_url AS bookmark_canonical_url,
              v.title AS bookmark_source_title
       FROM project_bookmarks b JOIN videos v ON v.id = b.video_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY b.source_time_ms, b.id LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return ProjectBookmarkPageSchema.parse({
      projectId,
      items: rows.map(mapProjectBookmark),
      ...(hasMore && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                identity,
                sourceTimeMs: Number(last.source_time_ms),
                id: String(last.id),
              }),
            ).toString("base64url"),
          }
        : {}),
    });
  }

  async createProjectBookmark(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateProjectBookmarkRequest,
  ): Promise<ProjectBookmarkMutationResponse> {
    await this.requireRegistered(actor);
    const command = CreateProjectBookmarkRequestSchema.parse(input);
    const requestSha256 = hashCommand(command);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "write");
      const replay = await this.loadProjectBookmarkReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) return ProjectBookmarkMutationResponseSchema.parse(replay);
      const source = await this.database.query<DbRow>(
        `SELECT v.duration_ms FROM project_videos pv JOIN videos v ON v.id = pv.video_id
         WHERE pv.project_id = $1 AND pv.video_id = $2 FOR SHARE OF pv`,
        [projectId, command.videoId],
      );
      if (!source.rows[0])
        throw new CatalogNotFoundError("Project video not found.");
      if (
        source.rows[0].duration_ms !== null &&
        command.sourceTimeMs > Number(source.rows[0].duration_ms)
      ) {
        throw new CatalogValidationError(
          "Bookmark time exceeds the known source duration.",
        );
      }
      const profile = await this.database.query<DbRow>(
        `SELECT handle, display_name FROM users WHERE id = $1`,
        [actor.userId],
      );
      const bookmarkId = randomUUID();
      const title = command.title ?? null;
      const note = command.note ?? null;
      await this.database.query(
        `INSERT INTO project_bookmarks
           (id, project_id, video_id, source_time_ms, title, note, search_text,
            state, version, created_by, created_by_handle, created_by_display_name,
            updated_by, updated_by_handle, updated_by_display_name, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',1,$8,$9,$10,$8,$9,$10,$11,$11)`,
        [
          bookmarkId,
          projectId,
          command.videoId,
          command.sourceTimeMs,
          title,
          note,
          normalizeBookmarkSearch(`${title ?? ""} ${note ?? ""}`),
          actor.userId,
          String(profile.rows[0]?.handle),
          String(profile.rows[0]?.display_name),
          now,
        ],
      );
      const response = ProjectBookmarkMutationResponseSchema.parse({
        bookmark: mapProjectBookmark(
          (
            await this.database.query<DbRow>(
              "SELECT * FROM project_bookmarks WHERE id = $1",
              [bookmarkId],
            )
          ).rows[0]!,
        ),
      });
      await this.recordProjectBookmarkCommand(
        projectId,
        bookmarkId,
        actor.userId,
        "create",
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  async updateProjectBookmark(
    actor: AuthenticatedActor,
    projectId: string,
    bookmarkId: string,
    input: UpdateProjectBookmarkRequest,
  ): Promise<ProjectBookmarkMutationResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectBookmarkRequestSchema.parse(input);
    return this.mutateProjectBookmark(
      actor,
      projectId,
      bookmarkId,
      "update",
      command,
      async (row, now, profile) => {
        if (String(row.created_by) !== actor.userId) {
          throw new AuthorizationError(
            "Only the bookmark creator may edit its title or note.",
          );
        }
        const title = command.title === undefined ? row.title : command.title;
        const note = command.note === undefined ? row.note : command.note;
        await this.database.query(
          `UPDATE project_bookmarks SET title=$1,note=$2,search_text=$3,version=version+1,
         updated_by=$4,updated_by_handle=$5,updated_by_display_name=$6,updated_at=$7 WHERE id=$8`,
          [
            title,
            note,
            normalizeBookmarkSearch(`${title ?? ""} ${note ?? ""}`),
            actor.userId,
            profile.handle,
            profile.display_name,
            now,
            bookmarkId,
          ],
        );
      },
    );
  }

  archiveProjectBookmark(
    actor: AuthenticatedActor,
    projectId: string,
    bookmarkId: string,
    input: ChangeProjectBookmarkStateRequest,
  ) {
    return this.changeProjectBookmarkState(
      actor,
      projectId,
      bookmarkId,
      "archive",
      "archived",
      input,
    );
  }

  restoreProjectBookmark(
    actor: AuthenticatedActor,
    projectId: string,
    bookmarkId: string,
    input: ChangeProjectBookmarkStateRequest,
  ) {
    return this.changeProjectBookmarkState(
      actor,
      projectId,
      bookmarkId,
      "restore",
      "active",
      input,
    );
  }

  private async changeProjectBookmarkState(
    actor: AuthenticatedActor,
    projectId: string,
    bookmarkId: string,
    kind: "archive" | "restore",
    state: "active" | "archived",
    input: ChangeProjectBookmarkStateRequest,
  ): Promise<ProjectBookmarkMutationResponse> {
    await this.requireRegistered(actor);
    const command = ChangeProjectBookmarkStateRequestSchema.parse(input);
    return this.mutateProjectBookmark(
      actor,
      projectId,
      bookmarkId,
      kind,
      command,
      async (row, now, profile, role) => {
        if (
          String(row.created_by) !== actor.userId &&
          !["owner", "administrator"].includes(role)
        ) {
          throw new AuthorizationError(
            "Only the creator or a project administrator may change bookmark state.",
          );
        }
        if (row.state === state)
          throw new CatalogConflictError(`Bookmark is already ${state}.`);
        await this.database.query(
          `UPDATE project_bookmarks SET state=$1,version=version+1,updated_by=$2,
         updated_by_handle=$3,updated_by_display_name=$4,updated_at=$5 WHERE id=$6`,
          [
            state,
            actor.userId,
            profile.handle,
            profile.display_name,
            now,
            bookmarkId,
          ],
        );
      },
    );
  }

  private async mutateProjectBookmark(
    actor: AuthenticatedActor,
    projectId: string,
    bookmarkId: string,
    kind: "update" | "archive" | "restore",
    command: UpdateProjectBookmarkRequest | ChangeProjectBookmarkStateRequest,
    mutation: (
      row: DbRow,
      now: string,
      profile: DbRow,
      role: ProjectRole,
    ) => Promise<void>,
  ): Promise<ProjectBookmarkMutationResponse> {
    const requestSha256 = hashCommand({ bookmarkId, ...command });
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE`,
        [projectId, actor.userId],
      );
      const role = membership.rows[0]?.role;
      requirePermission(role, "write");
      const replay = await this.loadProjectBookmarkReplay(
        projectId,
        actor.userId,
        command.idempotencyKey,
        requestSha256,
      );
      if (replay) return ProjectBookmarkMutationResponseSchema.parse(replay);
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_bookmarks WHERE project_id=$1 AND id=$2 FOR UPDATE`,
        [projectId, bookmarkId],
      );
      const row = selected.rows[0];
      if (!row) throw new CatalogNotFoundError("Project bookmark not found.");
      if (Number(row.version) !== command.expectedVersion)
        throw new CatalogConflictError(
          "Bookmark changed; reload before trying again.",
        );
      const profile = (
        await this.database.query<DbRow>(
          "SELECT handle,display_name FROM users WHERE id=$1",
          [actor.userId],
        )
      ).rows[0]!;
      await mutation(row, now, profile, role!);
      const updated = (
        await this.database.query<DbRow>(
          "SELECT * FROM project_bookmarks WHERE id=$1",
          [bookmarkId],
        )
      ).rows[0]!;
      const response = ProjectBookmarkMutationResponseSchema.parse({
        bookmark: mapProjectBookmark(updated),
      });
      await this.recordProjectBookmarkCommand(
        projectId,
        bookmarkId,
        actor.userId,
        kind,
        command.idempotencyKey,
        requestSha256,
        response,
        now,
      );
      return response;
    });
  }

  private async loadProjectBookmarkReplay(
    projectId: string,
    actorId: string,
    key: string,
    hash: string,
  ) {
    const result = await this.database.query<DbRow>(
      `SELECT request_sha256,response_json FROM project_bookmark_commands
       WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
      [projectId, actorId, key],
    );
    if (!result.rows[0]) return undefined;
    if (result.rows[0].request_sha256 !== hash)
      throw new CatalogIdempotencyConflictError(
        "Bookmark command key was already used for another request.",
      );
    return jsonRecord(result.rows[0].response_json);
  }

  private async recordProjectBookmarkCommand(
    projectId: string,
    bookmarkId: string,
    actorId: string,
    kind: string,
    key: string,
    hash: string,
    response: unknown,
    now: string,
  ) {
    await this.database.query(
      `INSERT INTO project_bookmark_commands
       (id,project_id,bookmark_id,actor_id,command_kind,idempotency_key,request_sha256,response_json,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        projectId,
        bookmarkId,
        actorId,
        kind,
        key,
        hash,
        JSON.stringify(response),
        now,
      ],
    );
  }

  async listProjectVideoWorklist(
    actor: AuthenticatedActor,
    projectId: string,
    input: ProjectVideoWorklistQuery,
  ): Promise<ProjectVideoWorklistPage> {
    await this.authorize(actor, projectId, "read");
    const query = ProjectVideoWorklistQuerySchema.parse(input);
    const view = query.view ?? "all";
    const cursor = query.cursor
      ? parseProjectVideoWorklistCursor(query.cursor)
      : undefined;
    if (cursor && cursor.projectId !== projectId) {
      throw new CatalogInvalidRequestError(
        "Project worklist cursor belongs to another project.",
      );
    }
    if (cursor && cursor.view !== view) {
      throw new CatalogInvalidRequestError(
        "Project worklist cursor belongs to another view.",
      );
    }

    return this.transaction(
      async () => {
        const parameters: unknown[] = [projectId, actor.userId];
        const viewClause =
          view === "dismissed"
            ? "AND pv.triage_state = 'dismissed'"
            : view === "reviewed"
              ? `AND pv.triage_state = 'active'
                 AND EXISTS (
                   SELECT 1 FROM project_video_review_cycles view_cycle
                   WHERE view_cycle.project_id = pv.project_id
                     AND view_cycle.video_id = pv.video_id
                     AND view_cycle.status = 'completed'
                     AND NOT EXISTS (
                       SELECT 1 FROM project_video_review_cycles later_cycle
                       WHERE later_cycle.project_id = view_cycle.project_id
                         AND later_cycle.video_id = view_cycle.video_id
                         AND later_cycle.cycle_number > view_cycle.cycle_number
                     )
                 )`
              : view === "queue"
                ? `AND pv.triage_state = 'active'
                   AND EXISTS (
                     SELECT 1 FROM project_video_review_cycles view_cycle
                     WHERE view_cycle.project_id = pv.project_id
                       AND view_cycle.video_id = pv.video_id
                       AND view_cycle.status = 'open'
                   )`
                : "";
        let cursorClause = "";
        if (cursor) {
          parameters.push(cursor.createdAt, cursor.videoId);
          cursorClause = `
            AND (
              pv.created_at < $3::timestamptz
              OR (pv.created_at = $3::timestamptz AND pv.video_id < $4)
            )`;
        }
        parameters.push(query.limit + 1);
        const limitParameter = parameters.length;
        const rows = await this.database.query<DbRow>(
          `SELECT pv.project_id, pv.video_id, pv.active_transcript_version_id,
                  pv.version AS project_video_version,
                  pv.worklist_priority, pv.review_completion_policy,
                  pv.triage_state, pv.triage_version, pv.dismissed_at,
                  pv.dismissal_reason, pv.dismissed_by,
                  dismissed.handle AS dismissed_handle,
                  dismissed.display_name AS dismissed_display_name,
                  pv.created_at AS project_video_created_at,
                  pv.updated_at AS project_video_updated_at,
                  v.id, v.youtube_video_id, v.canonical_url, v.title,
                  v.channel, v.duration_ms, v.source_language,
                  v.created_at, v.updated_at,
                  own.active AS own_flag_active,
                  own.version AS own_flag_version,
                  own.created_at AS own_flag_created_at,
                  own.updated_at AS own_flag_updated_at,
                  own.deactivated_at AS own_flag_deactivated_at
           FROM project_videos pv
           JOIN videos v ON v.id = pv.video_id
           LEFT JOIN project_members dismissed_member
             ON dismissed_member.project_id = pv.project_id
            AND dismissed_member.user_id = pv.dismissed_by
           LEFT JOIN users dismissed
             ON dismissed.id = dismissed_member.user_id
           LEFT JOIN project_video_flags own
             ON own.project_id = pv.project_id
            AND own.video_id = pv.video_id
            AND own.user_id = $2
           WHERE pv.project_id = $1 ${viewClause}${cursorClause}
           ORDER BY pv.created_at DESC, pv.video_id DESC
           LIMIT $${limitParameter}`,
          parameters,
        );
        const pageRows = rows.rows.slice(0, query.limit);
        const videoIds = pageRows.map((row) => String(row.video_id));
        const total = Number(
          (
            await this.database.query<DbRow>(
              `SELECT count(*)::integer AS total
               FROM project_videos pv
               WHERE pv.project_id = $1 ${viewClause}`,
              [projectId],
            )
          ).rows[0]?.total ?? 0,
        );
        if (videoIds.length === 0) {
          return ProjectVideoWorklistPageSchema.parse({ items: [], total });
        }
        const readNow = this.now();

        const [
          flagRows,
          processingRows,
          clipRows,
          claimRows,
          reviewRows,
          unreadRows,
          keywordScanRows,
        ] = await Promise.all([
          this.database.query<DbRow>(
            `SELECT * FROM (
               SELECT f.video_id, f.user_id, f.updated_at, u.handle,
                      u.display_name,
                      row_number() OVER (
                        PARTITION BY f.video_id
                        ORDER BY f.updated_at DESC, f.user_id
                      ) AS flag_rank,
                      count(*) OVER (PARTITION BY f.video_id) AS flag_count
               FROM project_video_flags f
               JOIN project_members pm
                 ON pm.project_id = f.project_id AND pm.user_id = f.user_id
               JOIN users u ON u.id = f.user_id
               WHERE f.project_id = $1 AND f.active
                 AND f.video_id = ANY($2::uuid[])
             ) ranked
             WHERE flag_rank <= 25
             ORDER BY video_id, flag_rank`,
            [projectId, videoIds],
          ),
          this.database.query<DbRow>(
            `SELECT * FROM (
               SELECT bi.catalog_video_id AS video_id, bi.batch_id,
                      bi.id AS batch_item_id, bi.job_id, bi.state, bi.attempt,
                      bi.error_code, bi.error_message, bi.error_retryable,
                      bi.updated_at,
                      row_number() OVER (
                        PARTITION BY bi.catalog_video_id
                        ORDER BY bi.updated_at DESC, bi.id DESC
                      ) AS processing_rank
               FROM transcription_batch_items bi
               JOIN transcription_batches b ON b.id = bi.batch_id
               WHERE b.project_id = $1
                 AND bi.catalog_video_id = ANY($2::uuid[])
             ) ranked
             WHERE processing_rank = 1`,
            [projectId, videoIds],
          ),
          this.database.query<DbRow>(
            `SELECT video_id, count(*)::integer AS clip_count
             FROM clip_candidates
             WHERE project_id = $1 AND video_id = ANY($2::uuid[])
             GROUP BY video_id`,
            [projectId, videoIds],
          ),
          this.database.query<DbRow>(
            `SELECT c.*, u.handle, u.display_name
             FROM project_video_claims c
             JOIN project_members pm
               ON pm.project_id = c.project_id
              AND pm.user_id = c.claimant_user_id
             JOIN users u ON u.id = c.claimant_user_id
             WHERE c.project_id = $1 AND c.video_id = ANY($2::uuid[])`,
            [projectId, videoIds],
          ),
          this.database.query<DbRow>(
            `SELECT DISTINCT ON (c.video_id)
                    c.*,
                    opened.handle AS opened_handle,
                    opened.display_name AS opened_display_name,
                    completed.handle AS completed_handle,
                    completed.display_name AS completed_display_name
             FROM project_video_review_cycles c
             LEFT JOIN project_members opened_member
               ON opened_member.project_id = c.project_id
              AND opened_member.user_id = c.opened_by
             LEFT JOIN users opened ON opened.id = opened_member.user_id
             LEFT JOIN project_members completed_member
               ON completed_member.project_id = c.project_id
              AND completed_member.user_id = c.completed_by
             LEFT JOIN users completed
               ON completed.id = completed_member.user_id
             WHERE c.project_id = $1 AND c.video_id = ANY($2::uuid[])
             ORDER BY c.video_id, c.cycle_number DESC`,
            [projectId, videoIds],
          ),
          this.database.query<DbRow>(
            `SELECT event.video_id, count(*)::integer AS unread_count
               FROM project_video_activity_receipts receipt
               JOIN project_video_activity_events event
                 ON event.id = receipt.event_id
               JOIN project_members actor_member
                 ON actor_member.project_id = event.project_id
                AND actor_member.user_id = event.actor_id
               WHERE event.project_id = $1 AND receipt.user_id = $2
                 AND receipt.state = 'unread'
                 AND event.video_id = ANY($3::uuid[])
               GROUP BY event.video_id`,
            [projectId, actor.userId, videoIds],
          ),
          Promise.all(
            videoIds.map((videoId) =>
              this.loadProjectKeywordScanSummary(projectId, videoId),
            ),
          ),
        ]);
        const flagsByVideo = new Map<string, DbRow[]>();
        for (const row of flagRows.rows) {
          const key = String(row.video_id);
          flagsByVideo.set(key, [...(flagsByVideo.get(key) ?? []), row]);
        }
        const processingByVideo = new Map(
          processingRows.rows.map((row) => [String(row.video_id), row]),
        );
        const clipsByVideo = new Map(
          clipRows.rows.map((row) => [
            String(row.video_id),
            Number(row.clip_count),
          ]),
        );
        const claimsByVideo = new Map(
          claimRows.rows.map((row) => [String(row.video_id), row]),
        );
        const reviewsByVideo = new Map(
          reviewRows.rows.map((row) => [String(row.video_id), row]),
        );
        const unreadByVideo = new Map(
          unreadRows.rows.map((row) => [
            String(row.video_id),
            Number(row.unread_count),
          ]),
        );
        const keywordScansByVideo = new Map(
          keywordScanRows.map((summary) => [summary.projectVideoId, summary]),
        );
        const items = pageRows.map((row) => {
          const videoId = String(row.video_id);
          const flaggers = flagsByVideo.get(videoId) ?? [];
          const processing = processingByVideo.get(videoId);
          const claim = claimsByVideo.get(videoId);
          const review = reviewsByVideo.get(videoId);
          if (!review) {
            throw new CatalogConflictError(
              "The canonical project video has no review cycle.",
            );
          }
          const processingState = processing
            ? mapProjectVideoWorklistProcessingState(String(processing.state))
            : "not_requested";
          return {
            projectId,
            video: mapVideo(row),
            projectVideoVersion: Number(row.project_video_version),
            priority: row.worklist_priority,
            completionPolicy: row.review_completion_policy,
            triage: mapProjectVideoTriage(row),
            unreadActivityCount: unreadByVideo.get(videoId) ?? 0,
            ...(claim
              ? {
                  claim: mapProjectVideoClaim(claim, actor.userId, readNow),
                }
              : {}),
            review: mapProjectVideoReviewCycle(review),
            ...(row.active_transcript_version_id === null
              ? {}
              : {
                  activeTranscriptVersionId: String(
                    row.active_transcript_version_id,
                  ),
                }),
            activeFlagCount: Number(flaggers[0]?.flag_count ?? 0),
            flaggers: flaggers.map((flagger) => ({
              userId: flagger.user_id,
              handle: flagger.handle,
              displayName: flagger.display_name,
              flaggedAt: iso(flagger.updated_at),
            })),
            flaggersTruncated: Number(flaggers[0]?.flag_count ?? 0) > 25,
            ...(row.own_flag_version === null
              ? {}
              : { ownFlag: mapProjectVideoOwnFlag(row) }),
            processing: {
              state: processingState,
              ...(processing?.batch_id
                ? { batchId: String(processing.batch_id) }
                : {}),
              ...(processing?.batch_item_id
                ? { batchItemId: String(processing.batch_item_id) }
                : {}),
              ...(processing?.job_id
                ? { jobId: String(processing.job_id) }
                : {}),
              attempt: Number(processing?.attempt ?? 0),
              updatedAt: iso(
                processing?.updated_at ?? row.project_video_updated_at,
              ),
              ...(processing?.error_code && processing?.error_message
                ? {
                    error: {
                      code: String(processing.error_code),
                      message: String(processing.error_message),
                      ...(processing.error_retryable === null ||
                      processing.error_retryable === undefined
                        ? {}
                        : {
                            retryable: Boolean(processing.error_retryable),
                          }),
                    },
                  }
                : {}),
            },
            keywordScan: keywordScansByVideo.get(videoId),
            clipCount: clipsByVideo.get(videoId) ?? 0,
            createdAt: iso(row.project_video_created_at),
            updatedAt: iso(row.project_video_updated_at),
          };
        });
        const last = pageRows.at(-1);
        return ProjectVideoWorklistPageSchema.parse({
          items,
          total,
          ...(rows.rows.length > query.limit && last
            ? {
                nextCursor: makeProjectVideoWorklistCursor({
                  projectId,
                  videoId: String(last.video_id),
                  createdAt: iso(last.project_video_created_at),
                  view,
                }),
              }
            : {}),
        });
      },
      { repeatableRead: true },
    );
  }

  async updateOwnProjectVideoFlag(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: UpdateOwnProjectVideoFlagRequest,
  ): Promise<ProjectVideoOwnFlagResponse> {
    await this.authorize(actor, projectId, "write");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      await this.requireProjectVideo(projectId, videoId);
      const existing = await this.database.query<DbRow>(
        `SELECT active, version, created_at, updated_at, deactivated_at
         FROM project_video_flags
         WHERE project_id = $1 AND video_id = $2 AND user_id = $3
         FOR UPDATE`,
        [projectId, videoId, actor.userId],
      );
      const row = existing.rows[0];
      if (!row) {
        if (!input.active || input.expectedVersion !== 0) {
          throw new CatalogConflictError(
            "The project-video flag version is stale.",
          );
        }
        const inserted = await this.database.query<DbRow>(
          `INSERT INTO project_video_flags
             (project_id, video_id, user_id, active, version, created_at,
              updated_at)
           VALUES ($1, $2, $3, true, 1, $4, $4)
           RETURNING active, version, created_at, updated_at, deactivated_at`,
          [projectId, videoId, actor.userId, now],
        );
        await this.database.query(
          `UPDATE project_videos
           SET version = version + 1, updated_at = $1
           WHERE project_id = $2 AND video_id = $3`,
          [now, projectId, videoId],
        );
        return ProjectVideoOwnFlagResponseSchema.parse({
          projectId,
          videoId,
          flag: mapProjectVideoOwnFlag(inserted.rows[0]!),
        });
      }
      if (Number(row.version) !== input.expectedVersion) {
        throw new CatalogConflictError(
          "The project-video flag version is stale.",
        );
      }
      if (Boolean(row.active) === input.active) {
        return ProjectVideoOwnFlagResponseSchema.parse({
          projectId,
          videoId,
          flag: mapProjectVideoOwnFlag(row),
        });
      }
      const updated = await this.database.query<DbRow>(
        `UPDATE project_video_flags
         SET active = $1, version = version + 1, updated_at = $2,
             deactivated_at = CASE WHEN $1 THEN NULL ELSE $2::timestamptz END
         WHERE project_id = $3 AND video_id = $4 AND user_id = $5
         RETURNING active, version, created_at, updated_at, deactivated_at`,
        [input.active, now, projectId, videoId, actor.userId],
      );
      await this.database.query(
        `UPDATE project_videos
         SET version = version + 1, updated_at = $1
         WHERE project_id = $2 AND video_id = $3`,
        [now, projectId, videoId],
      );
      return ProjectVideoOwnFlagResponseSchema.parse({
        projectId,
        videoId,
        flag: mapProjectVideoOwnFlag(updated.rows[0]!),
      });
    });
  }

  async updateProjectVideoClaim(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: UpdateProjectVideoClaimRequest,
  ): Promise<ProjectVideoClaimResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectVideoClaimRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now();
    const nowIso = now.toISOString();

    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2
         FOR SHARE`,
        [projectId, actor.userId],
      );
      if (
        !membership.rows[0] ||
        !new Set<ProjectRole>(["owner", "administrator", "researcher"]).has(
          membership.rows[0].role,
        )
      ) {
        throw new AuthorizationError(
          "Your project role cannot coordinate review claims.",
        );
      }
      const projectVideo = await this.database.query(
        `SELECT 1 FROM project_videos
         WHERE project_id = $1 AND video_id = $2
         FOR UPDATE`,
        [projectId, videoId],
      );
      if (!projectVideo.rows[0]) {
        throw new CatalogNotFoundError("Project video not found.");
      }
      const receipt = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM project_video_claim_events
         WHERE project_id = $1 AND video_id = $2 AND actor_id = $3
           AND idempotency_key = $4`,
        [projectId, videoId, actor.userId, command.idempotencyKey],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_sha256 !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This claim command key was already used for another request.",
          );
        }
        return ProjectVideoClaimResponseSchema.parse(
          jsonRecord(receipt.rows[0].response_json),
        );
      }

      const currentResult = await this.database.query<DbRow>(
        `SELECT c.*, u.handle, u.display_name
         FROM project_video_claims c
         JOIN users u ON u.id = c.claimant_user_id
         WHERE c.project_id = $1 AND c.video_id = $2
         FOR UPDATE OF c`,
        [projectId, videoId],
      );
      const current = currentResult.rows[0];
      const latestEvent = current
        ? undefined
        : (
            await this.database.query<DbRow>(
              `SELECT MAX(claim_generation) AS claim_generation,
                      MAX(claim_version) AS claim_version
               FROM project_video_claim_events
               WHERE project_id = $1 AND video_id = $2`,
              [projectId, videoId],
            )
          ).rows[0];
      const active = current
        ? Date.parse(iso(current.expires_at)) > now.getTime()
        : false;
      let eventType: "claimed" | "renewed" | "taken_over" | "released";
      let response: ProjectVideoClaimResponse;
      let claimGeneration = Number(
        current?.generation ?? latestEvent?.claim_generation ?? 1,
      );
      let claimVersion = Number(
        current?.version ?? latestEvent?.claim_version ?? 1,
      );
      const previousClaimant = current
        ? String(current.claimant_user_id)
        : undefined;

      if (command.action === "release") {
        if (
          !current ||
          !active ||
          current.claimant_user_id !== actor.userId ||
          Number(current.version) !== command.expectedClaimVersion
        ) {
          throw new CatalogConflictError(
            "The active project-video claim changed before release.",
          );
        }
        await this.database.query(
          `DELETE FROM project_video_claims
           WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        );
        eventType = "released";
        response = ProjectVideoClaimResponseSchema.parse({
          projectId,
          videoId,
        });
      } else if (command.action === "renew") {
        if (command.leaseSeconds === undefined) {
          throw new CatalogValidationError(
            "A renewable project-video claim requires a bounded lease.",
          );
        }
        if (
          !current ||
          !active ||
          current.claimant_user_id !== actor.userId ||
          Number(current.version) !== command.expectedClaimVersion
        ) {
          throw new CatalogConflictError(
            "Only the current claimant can renew this claim version.",
          );
        }
        const expiresAt = new Date(
          now.getTime() + command.leaseSeconds * 1_000,
        ).toISOString();
        const renewed = await this.database.query<DbRow>(
          `UPDATE project_video_claims
           SET version = version + 1, heartbeat_at = $1, expires_at = $2
           WHERE project_id = $3 AND video_id = $4
           RETURNING *`,
          [nowIso, expiresAt, projectId, videoId],
        );
        claimVersion = Number(renewed.rows[0]!.version);
        eventType = "renewed";
        response = ProjectVideoClaimResponseSchema.parse({
          projectId,
          videoId,
          claim: mapProjectVideoClaim(
            {
              ...renewed.rows[0]!,
              handle: current.handle,
              display_name: current.display_name,
            },
            actor.userId,
            now,
          ),
        });
      } else {
        if (command.leaseSeconds === undefined) {
          throw new CatalogValidationError(
            "A project-video claim requires a bounded lease.",
          );
        }
        if (
          current &&
          Number(current.version) !== command.expectedClaimVersion &&
          (active || command.expectedClaimVersion !== 0)
        ) {
          throw new CatalogConflictError(
            "The project-video claim version is stale.",
          );
        }
        if (!current && command.expectedClaimVersion !== 0) {
          throw new CatalogConflictError(
            "The project-video claim version is stale.",
          );
        }
        if (current && current.claimant_user_id !== actor.userId) {
          if (!command.takeoverConfirmed) {
            throw new CatalogConflictError(
              "Another member has or had this claim. Confirm takeover to continue.",
            );
          }
          eventType = "taken_over";
        } else {
          eventType = "claimed";
        }
        if (active && current!.claimant_user_id === actor.userId) {
          response = ProjectVideoClaimResponseSchema.parse({
            projectId,
            videoId,
            claim: mapProjectVideoClaim(current!, actor.userId, now),
          });
        } else {
          claimGeneration = current
            ? Number(current.generation) + 1
            : latestEvent
              ? Number(latestEvent.claim_generation) + 1
              : 1;
          claimVersion = current
            ? Number(current.version) + 1
            : latestEvent
              ? Number(latestEvent.claim_version) + 1
              : 1;
          const expiresAt = new Date(
            now.getTime() + command.leaseSeconds * 1_000,
          ).toISOString();
          const claimed = await this.database.query<DbRow>(
            `INSERT INTO project_video_claims
               (project_id, video_id, claimant_user_id, generation, version,
                claimed_at, heartbeat_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
             ON CONFLICT (project_id, video_id) DO UPDATE
             SET claimant_user_id = EXCLUDED.claimant_user_id,
                 generation = EXCLUDED.generation,
                 version = EXCLUDED.version,
                 claimed_at = EXCLUDED.claimed_at,
                 heartbeat_at = EXCLUDED.heartbeat_at,
                 expires_at = EXCLUDED.expires_at
             RETURNING *`,
            [
              projectId,
              videoId,
              actor.userId,
              claimGeneration,
              claimVersion,
              nowIso,
              expiresAt,
            ],
          );
          const user = await this.database.query<DbRow>(
            "SELECT handle, display_name FROM users WHERE id = $1",
            [actor.userId],
          );
          response = ProjectVideoClaimResponseSchema.parse({
            projectId,
            videoId,
            claim: mapProjectVideoClaim(
              {
                ...claimed.rows[0]!,
                ...user.rows[0]!,
              },
              actor.userId,
              now,
            ),
          });
        }
      }

      await this.database.query(
        `INSERT INTO project_video_claim_events
           (id, project_id, video_id, event_type, actor_id,
            previous_claimant_user_id, claim_generation, claim_version,
            idempotency_key, request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          randomUUID(),
          projectId,
          videoId,
          eventType,
          actor.userId,
          eventType === "taken_over" ? previousClaimant : null,
          claimGeneration,
          claimVersion,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          nowIso,
        ],
      );
      return response;
    });
  }

  async updateProjectVideoGovernance(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: UpdateProjectVideoGovernanceRequest,
  ): Promise<ProjectVideoGovernanceResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectVideoGovernanceRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const role = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2
         FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(role.rows[0]?.role, "manage_project");
      const projectVideo = await this.database.query<DbRow>(
        `SELECT * FROM project_videos
         WHERE project_id = $1 AND video_id = $2
         FOR UPDATE`,
        [projectId, videoId],
      );
      if (!projectVideo.rows[0]) {
        throw new CatalogNotFoundError("Project video not found.");
      }
      const receipt = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM project_video_governance_events
         WHERE project_id = $1 AND video_id = $2 AND actor_id = $3
           AND idempotency_key = $4`,
        [projectId, videoId, actor.userId, command.idempotencyKey],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_sha256 !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This governance command key was already used for another request.",
          );
        }
        return ProjectVideoGovernanceResponseSchema.parse(
          jsonRecord(receipt.rows[0].response_json),
        );
      }
      if (
        Number(projectVideo.rows[0].version) !==
        command.expectedProjectVideoVersion
      ) {
        throw new CatalogConflictError(
          "The project-video governance version is stale.",
        );
      }
      const result = await this.database.query<DbRow>(
        `UPDATE project_videos
         SET worklist_priority = COALESCE($1, worklist_priority),
             review_completion_policy = COALESCE(
               $2, review_completion_policy
             ),
             version = version + 1, updated_at = $3
         WHERE project_id = $4 AND video_id = $5
         RETURNING worklist_priority, review_completion_policy, version,
                   updated_at`,
        [
          command.priority ?? null,
          command.completionPolicy ?? null,
          now,
          projectId,
          videoId,
        ],
      );
      const response = ProjectVideoGovernanceResponseSchema.parse({
        projectId,
        videoId,
        priority: result.rows[0]!.worklist_priority,
        completionPolicy: result.rows[0]!.review_completion_policy,
        projectVideoVersion: Number(result.rows[0]!.version),
        updatedAt: iso(result.rows[0]!.updated_at),
      });
      await this.database.query(
        `INSERT INTO project_video_governance_events
           (id, project_id, video_id, actor_id, priority,
            review_completion_policy, project_video_version, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          randomUUID(),
          projectId,
          videoId,
          actor.userId,
          command.priority ?? null,
          command.completionPolicy ?? null,
          response.projectVideoVersion,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          now,
        ],
      );
      return response;
    });
  }

  async bulkUpdateProjectVideoPriority(
    actor: AuthenticatedActor,
    projectId: string,
    input: BulkUpdateProjectVideoPriorityRequest,
  ): Promise<BulkUpdateProjectVideoPriorityResponse> {
    await this.requireRegistered(actor);
    const command = BulkUpdateProjectVideoPriorityRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2 FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "manage_project");
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM project_video_priority_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This bulk priority command key was already used for another request.",
          );
        }
        return BulkUpdateProjectVideoPriorityResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }
      const expected = new Map(
        command.items.map((item) => [
          item.videoId,
          item.expectedProjectVideoVersion,
        ]),
      );
      const selected = await this.database.query<DbRow>(
        `SELECT * FROM project_videos
         WHERE project_id = $1 AND video_id = ANY($2::uuid[])
         ORDER BY video_id FOR UPDATE`,
        [projectId, [...expected.keys()]],
      );
      if (
        selected.rows.length !== expected.size ||
        selected.rows.some(
          (row) => Number(row.version) !== expected.get(String(row.video_id)),
        )
      ) {
        throw new CatalogConflictError(
          "A selected project video changed; no priorities were updated.",
        );
      }
      const items: ProjectVideoGovernanceResponse[] = [];
      for (const row of selected.rows) {
        const updated = await this.database.query<DbRow>(
          `UPDATE project_videos
           SET worklist_priority = $1, version = version + 1, updated_at = $2
           WHERE project_id = $3 AND video_id = $4
           RETURNING worklist_priority, review_completion_policy, version,
                     updated_at`,
          [command.priority, now, projectId, row.video_id],
        );
        items.push(
          ProjectVideoGovernanceResponseSchema.parse({
            projectId,
            videoId: row.video_id,
            priority: updated.rows[0]!.worklist_priority,
            completionPolicy: updated.rows[0]!.review_completion_policy,
            projectVideoVersion: Number(updated.rows[0]!.version),
            updatedAt: iso(updated.rows[0]!.updated_at),
          }),
        );
      }
      const response = BulkUpdateProjectVideoPriorityResponseSchema.parse({
        projectId,
        priority: command.priority,
        items,
      });
      await this.database.query(
        `INSERT INTO project_video_priority_commands
           (id, project_id, actor_id, requested_priority, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          projectId,
          actor.userId,
          command.priority,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          now,
        ],
      );
      return response;
    });
  }

  async updateProjectVideoReview(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: UpdateProjectVideoReviewRequest,
  ): Promise<ProjectVideoReviewResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectVideoReviewRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();

    return this.transaction(async () => {
      const [projectVideo, membership] = await Promise.all([
        this.database.query<DbRow>(
          `SELECT * FROM project_videos
           WHERE project_id = $1 AND video_id = $2
           FOR UPDATE`,
          [projectId, videoId],
        ),
        this.database.query<{ role: ProjectRole }>(
          `SELECT role FROM project_members
           WHERE project_id = $1 AND user_id = $2
           FOR SHARE`,
          [projectId, actor.userId],
        ),
      ]);
      const projectVideoRow = projectVideo.rows[0];
      if (!projectVideoRow) {
        throw new CatalogNotFoundError("Project video not found.");
      }
      const receipt = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM project_video_review_events
         WHERE project_id = $1 AND video_id = $2 AND actor_id = $3
           AND idempotency_key = $4`,
        [projectId, videoId, actor.userId, command.idempotencyKey],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_sha256 !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This review command key was already used for another request.",
          );
        }
        return ProjectVideoReviewResponseSchema.parse(
          jsonRecord(receipt.rows[0].response_json),
        );
      }

      const current = await this.loadCurrentProjectVideoReviewCycle(
        projectId,
        videoId,
        true,
      );
      if (
        String(current.id) !== command.expectedCycleId ||
        Number(current.version) !== command.expectedCycleVersion
      ) {
        throw new CatalogConflictError(
          "The project-video review cycle changed before this command.",
        );
      }
      const roleValue = membership.rows[0]?.role;
      let eventType: "completed" | "reopened";
      let previousCycleId: string | undefined;

      if (command.action === "complete") {
        if (current.status !== "open") {
          throw new CatalogConflictError(
            "This review cycle is already closed.",
          );
        }
        const policy = String(projectVideoRow.review_completion_policy);
        const allowedRoles =
          policy === "administrator_only"
            ? new Set<ProjectRole>(["owner", "administrator"])
            : new Set<ProjectRole>(["owner", "administrator", "researcher"]);
        if (!roleValue || !allowedRoles.has(roleValue)) {
          throw new AuthorizationError(
            "Your project role cannot complete this review cycle.",
          );
        }
        const transcriptVersionId = projectVideoRow.active_transcript_version_id
          ? String(projectVideoRow.active_transcript_version_id)
          : undefined;
        if (
          !transcriptVersionId &&
          command.acknowledgeTranscriptUnavailable !== true
        ) {
          throw new CatalogConflictError(
            "Confirm that this review is being completed without a ready transcript.",
          );
        }
        await this.database.query(
          `UPDATE project_video_review_cycles
           SET status = 'completed', version = version + 1,
               completion_policy = $1, completed_by = $2, completed_at = $3,
               completion_basis = $4, transcript_version_id = $5,
               updated_at = $3
           WHERE id = $6`,
          [
            policy,
            actor.userId,
            now,
            transcriptVersionId
              ? "ready_transcript"
              : "without_ready_transcript_acknowledged",
            transcriptVersionId ?? null,
            current.id,
          ],
        );
        eventType = "completed";
      } else {
        if (current.status !== "completed") {
          throw new CatalogConflictError(
            "Only a completed review cycle can be reopened.",
          );
        }
        if (
          !roleValue ||
          !new Set<ProjectRole>(["owner", "administrator", "researcher"]).has(
            roleValue,
          )
        ) {
          throw new AuthorizationError(
            "Your project role cannot reopen this review cycle.",
          );
        }
        previousCycleId = String(current.id);
        await this.database.query(
          `INSERT INTO project_video_review_cycles
             (id, project_id, video_id, cycle_number, status, version,
              opened_by, opened_at, reopen_reason, updated_at)
           VALUES ($1, $2, $3, $4, 'open', 1, $5, $6, $7, $6)`,
          [
            randomUUID(),
            projectId,
            videoId,
            Number(current.cycle_number) + 1,
            actor.userId,
            now,
            command.reason,
          ],
        );
        eventType = "reopened";
      }

      const resulting = await this.loadCurrentProjectVideoReviewCycle(
        projectId,
        videoId,
      );
      const response = ProjectVideoReviewResponseSchema.parse({
        projectId,
        videoId,
        review: mapProjectVideoReviewCycle(resulting),
      });
      await this.database.query(
        `INSERT INTO project_video_review_events
           (id, project_id, video_id, cycle_id, previous_cycle_id, event_type,
            actor_id, cycle_version, idempotency_key, request_sha256,
            response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          randomUUID(),
          projectId,
          videoId,
          response.review.id,
          previousCycleId ?? null,
          eventType,
          actor.userId,
          response.review.version,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          now,
        ],
      );
      await this.createProjectVideoActivity(
        projectId,
        videoId,
        actor.userId,
        eventType === "completed" ? "review_completed" : "review_reopened",
        `review:${response.review.id}:${eventType}:${response.review.version}`,
        eventType === "reopened" ? command.reason : undefined,
        eventType === "reopened" && current.completed_by
          ? [String(current.completed_by)]
          : [],
        now,
      );
      return response;
    });
  }

  async updateProjectVideoTriage(
    actor: AuthenticatedActor,
    projectId: string,
    input: UpdateProjectVideoTriageRequest,
  ): Promise<ProjectVideoTriageResponse> {
    await this.requireRegistered(actor);
    const command = UpdateProjectVideoTriageRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();

    return this.transaction(async () => {
      const role = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2
         FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(role.rows[0]?.role, "manage_project");
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM project_video_triage_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This triage command key was already used for another request.",
          );
        }
        return ProjectVideoTriageResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }

      const videoIds = command.items.map((item) => item.videoId).sort();
      const current = await this.database.query<DbRow>(
        `SELECT pv.*, dismissed.handle AS dismissed_handle,
                dismissed.display_name AS dismissed_display_name
         FROM project_videos pv
         LEFT JOIN users dismissed ON dismissed.id = pv.dismissed_by
         WHERE pv.project_id = $1 AND pv.video_id = ANY($2::uuid[])
         ORDER BY pv.video_id
         FOR UPDATE OF pv`,
        [projectId, videoIds],
      );
      if (current.rows.length !== videoIds.length) {
        throw new CatalogNotFoundError("A project video was not found.");
      }
      const expectedByVideo = new Map(
        command.items.map((item) => [
          item.videoId,
          item.expectedProjectVideoVersion,
        ]),
      );
      for (const row of current.rows) {
        if (Number(row.version) !== expectedByVideo.get(String(row.video_id))) {
          throw new CatalogConflictError(
            "A project-video triage version changed before this command.",
          );
        }
        const expectedState =
          command.action === "dismiss" ? "active" : "dismissed";
        if (String(row.triage_state) !== expectedState) {
          throw new CatalogConflictError(
            `A project video is already ${command.action === "dismiss" ? "dismissed" : "active"}.`,
          );
        }
      }

      const updatedRows: DbRow[] = [];
      const actorSummary = (
        await this.database.query<DbRow>(
          "SELECT handle, display_name FROM users WHERE id = $1",
          [actor.userId],
        )
      ).rows[0]!;
      for (const row of current.rows) {
        const updated = await this.database.query<DbRow>(
          command.action === "dismiss"
            ? `UPDATE project_videos
               SET triage_state = 'dismissed', triage_version = triage_version + 1,
                   dismissed_by = $1, dismissed_at = $2,
                   dismissal_reason = $3, version = version + 1,
                   updated_at = $2
               WHERE project_id = $4 AND video_id = $5
               RETURNING *`
            : `UPDATE project_videos
               SET triage_state = 'active', triage_version = triage_version + 1,
                   dismissed_by = NULL, dismissed_at = NULL,
                   dismissal_reason = NULL, version = version + 1,
                   updated_at = $1
               WHERE project_id = $2 AND video_id = $3
               RETURNING *`,
          command.action === "dismiss"
            ? [
                actor.userId,
                now,
                command.reason ?? null,
                projectId,
                row.video_id,
              ]
            : [now, projectId, row.video_id],
        );
        updatedRows.push({
          ...updated.rows[0]!,
          ...(command.action === "dismiss"
            ? {
                dismissed_handle: actorSummary.handle,
                dismissed_display_name: actorSummary.display_name,
              }
            : {}),
        });
      }

      let queuedJobsCanceled = 0;
      let activeJobsRequested = 0;
      let requestsRevoked = 0;
      const jobs = await this.database.query<DbRow>(
        `SELECT j.id, j.state
         FROM jobs j
         WHERE j.kind = 'transcription'
           AND j.id IN (
             SELECT item.job_id
             FROM transcription_batch_items item
             JOIN transcription_batches batch ON batch.id = item.batch_id
             WHERE batch.project_id = $1
               AND item.catalog_video_id = ANY($2::uuid[])
               AND item.job_id IS NOT NULL
           )
         ORDER BY j.id
         FOR UPDATE OF j`,
        [projectId, videoIds],
      );
      for (const job of jobs.rows) {
        const activeDependency = Boolean(
          (
            await this.database.query(
              `SELECT 1
               FROM transcription_batch_items dependency
               JOIN transcription_batches dependency_batch
                 ON dependency_batch.id = dependency.batch_id
               JOIN project_videos dependency_video
                 ON dependency_video.project_id = dependency_batch.project_id
                AND dependency_video.video_id = dependency.catalog_video_id
               WHERE dependency.job_id = $1
                 AND dependency_video.triage_state = 'active'
               LIMIT 1`,
              [job.id],
            )
          ).rows[0],
        );
        if (command.action === "dismiss" && !activeDependency) {
          if (job.state === "queued") {
            await this.database.query(
              `UPDATE jobs SET state = 'canceled', updated_at = $1
               WHERE id = $2 AND state = 'queued'`,
              [now, job.id],
            );
            await this.database.query(
              `UPDATE transcription_batch_items
               SET state = 'canceled', version = version + 1, updated_at = $1
               WHERE job_id = $2 AND state = 'queued'`,
              [now, job.id],
            );
            queuedJobsCanceled += 1;
          } else if (["claimed", "processing"].includes(String(job.state))) {
            const requested = await this.database.query(
              `INSERT INTO transcription_job_cancel_requests
                 (job_id, project_id, requested_by, requested_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (job_id) DO UPDATE
               SET requested_by = EXCLUDED.requested_by,
                   requested_at = EXCLUDED.requested_at,
                   revoked_at = NULL, completed_at = NULL
               WHERE transcription_job_cancel_requests.revoked_at IS NOT NULL
               RETURNING job_id`,
              [job.id, projectId, actor.userId, now],
            );
            if (requested.rows[0]) activeJobsRequested += 1;
          }
        } else if (command.action === "restore" && activeDependency) {
          const revoked = await this.database.query(
            `UPDATE transcription_job_cancel_requests
             SET revoked_at = $1
             WHERE job_id = $2 AND revoked_at IS NULL AND completed_at IS NULL
             RETURNING job_id`,
            [now, job.id],
          );
          if (revoked.rows[0]) requestsRevoked += 1;
        }
      }

      const response = ProjectVideoTriageResponseSchema.parse({
        projectId,
        items: updatedRows.map((row) => ({
          videoId: String(row.video_id),
          projectVideoVersion: Number(row.version),
          triage: mapProjectVideoTriage(row),
        })),
        cancellation: {
          queuedJobsCanceled,
          activeJobsRequested,
          requestsRevoked,
        },
      });
      const commandId = randomUUID();
      await this.database.query(
        `INSERT INTO project_video_triage_commands
           (id, project_id, actor_id, action, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          commandId,
          projectId,
          actor.userId,
          command.action,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          now,
        ],
      );
      for (const result of response.items) {
        const eventId = randomUUID();
        await this.database.query(
          `INSERT INTO project_video_triage_events
             (id, command_id, project_id, video_id, event_type, actor_id,
              previous_state, triage_version, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            eventId,
            commandId,
            projectId,
            result.videoId,
            command.action === "dismiss" ? "dismissed" : "restored",
            actor.userId,
            command.action === "dismiss" ? "active" : "dismissed",
            result.triage.version,
            command.reason ?? null,
            now,
          ],
        );
        await this.createProjectVideoActivity(
          projectId,
          result.videoId,
          actor.userId,
          command.action === "dismiss" ? "video_dismissed" : "video_restored",
          `triage:${eventId}`,
          command.reason,
          [],
          now,
        );
      }
      return response;
    });
  }

  async listProjectVideoActivity(
    actor: AuthenticatedActor,
    projectId: string,
    input: ProjectVideoActivityQuery,
  ): Promise<ProjectVideoActivityPage> {
    await this.authorize(actor, projectId, "read");
    const query = ProjectVideoActivityQuerySchema.parse(input);
    const cursor = query.cursor
      ? parseProjectVideoActivityCursor(query.cursor)
      : undefined;
    if (cursor && cursor.projectId !== projectId) {
      throw new CatalogInvalidRequestError(
        "Project activity cursor belongs to another project.",
      );
    }
    if (cursor && cursor.state !== query.state) {
      throw new CatalogInvalidRequestError(
        "Project activity cursor belongs to another state filter.",
      );
    }
    const parameters: unknown[] = [projectId, actor.userId];
    const stateClause = query.state === "all" ? "" : `AND receipt.state = $3`;
    if (query.state !== "all") parameters.push(query.state);
    let cursorClause = "";
    if (cursor) {
      parameters.push(cursor.createdAt, cursor.eventId);
      const createdParameter = parameters.length - 1;
      const eventParameter = parameters.length;
      cursorClause = `AND (
        event.created_at < $${createdParameter}::timestamptz OR
        (event.created_at = $${createdParameter}::timestamptz
         AND event.id < $${eventParameter})
      )`;
    }
    parameters.push(query.limit + 1);
    const rows = await this.database.query<DbRow>(
      `SELECT receipt.*, event.project_id, event.video_id, event.event_type,
              event.actor_id, event.reason, event.created_at AS event_created_at,
              actor.handle AS actor_handle,
              actor.display_name AS actor_display_name, video.title AS video_title
       FROM project_video_activity_receipts receipt
       JOIN project_video_activity_events event ON event.id = receipt.event_id
       JOIN project_members member
         ON member.project_id = event.project_id AND member.user_id = receipt.user_id
       JOIN users actor ON actor.id = event.actor_id
       JOIN project_members actor_member
         ON actor_member.project_id = event.project_id
        AND actor_member.user_id = event.actor_id
       JOIN videos video ON video.id = event.video_id
       WHERE event.project_id = $1 AND receipt.user_id = $2
         ${stateClause} ${cursorClause}
       ORDER BY event.created_at DESC, event.id DESC
       LIMIT $${parameters.length}`,
      parameters,
    );
    const unreadCount = Number(
      (
        await this.database.query<DbRow>(
          `SELECT count(*)::integer AS count
           FROM project_video_activity_receipts receipt
           JOIN project_video_activity_events event ON event.id = receipt.event_id
           JOIN project_members member
             ON member.project_id = event.project_id AND member.user_id = receipt.user_id
           JOIN project_members actor_member
             ON actor_member.project_id = event.project_id
            AND actor_member.user_id = event.actor_id
           WHERE event.project_id = $1 AND receipt.user_id = $2
             AND receipt.state = 'unread'`,
          [projectId, actor.userId],
        )
      ).rows[0]?.count ?? 0,
    );
    const pageRows = rows.rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return ProjectVideoActivityPageSchema.parse({
      items: pageRows.map(mapProjectVideoActivityReceipt),
      unreadCount,
      ...(rows.rows.length > query.limit && last
        ? {
            nextCursor: makeProjectVideoActivityCursor({
              projectId,
              eventId: String(last.event_id),
              createdAt: iso(last.event_created_at),
              state: query.state,
            }),
          }
        : {}),
    });
  }

  async markProjectVideoActivitySeen(
    actor: AuthenticatedActor,
    projectId: string,
    input: MarkProjectVideoActivitySeenRequest,
  ): Promise<MarkProjectVideoActivitySeenResponse> {
    await this.authorize(actor, projectId, "read");
    const command = MarkProjectVideoActivitySeenRequestSchema.parse(input);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const rows: DbRow[] = [];
      for (const item of command.items) {
        const current = await this.database.query<DbRow>(
          `SELECT receipt.*, event.project_id, event.video_id, event.event_type,
                  event.actor_id, event.reason,
                  event.created_at AS event_created_at,
                  actor.handle AS actor_handle,
                  actor.display_name AS actor_display_name,
                  video.title AS video_title
           FROM project_video_activity_receipts receipt
           JOIN project_video_activity_events event ON event.id = receipt.event_id
           JOIN users actor ON actor.id = event.actor_id
           JOIN project_members actor_member
             ON actor_member.project_id = event.project_id
            AND actor_member.user_id = event.actor_id
           JOIN videos video ON video.id = event.video_id
           WHERE receipt.event_id = $1 AND receipt.user_id = $2
             AND event.project_id = $3
           FOR UPDATE OF receipt`,
          [item.eventId, actor.userId, projectId],
        );
        if (!current.rows[0]) {
          throw new CatalogNotFoundError("Project activity receipt not found.");
        }
        if (current.rows[0].state === "seen") {
          rows.push(current.rows[0]);
          continue;
        }
        if (Number(current.rows[0].version) !== item.expectedVersion) {
          throw new CatalogConflictError(
            "A project activity receipt changed before it was marked seen.",
          );
        }
        await this.database.query(
          `UPDATE project_video_activity_receipts
           SET state = 'seen', version = version + 1, seen_at = $1,
               updated_at = $1
           WHERE event_id = $2 AND user_id = $3`,
          [now, item.eventId, actor.userId],
        );
        rows.push({
          ...current.rows[0],
          state: "seen",
          version: Number(current.rows[0].version) + 1,
          seen_at: now,
        });
      }
      return MarkProjectVideoActivitySeenResponseSchema.parse({
        projectId,
        items: rows.map(mapProjectVideoActivityReceipt),
      });
    });
  }

  async findProjectVideoTranscriptStates(
    actor: AuthenticatedActor,
    projectId: string,
    youtubeVideoIds: readonly string[],
  ): Promise<Map<string, ProjectVideoTranscriptState>> {
    const sourceStates = await this.findProjectSourceTranscriptStates(
      actor,
      projectId,
      [...new Set(youtubeVideoIds)].map((youtubeVideoId) => ({
        schemaVersion: 1 as const,
        provider: "youtube" as const,
        providerMediaId: youtubeVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      })),
    );
    return new Map(
      [...new Set(youtubeVideoIds)].flatMap((youtubeVideoId) => {
        const state = sourceStates.get(`youtube:${youtubeVideoId}`);
        return state ? [[youtubeVideoId, state] as const] : [];
      }),
    );
  }

  async findProjectSourceTranscriptStates(
    actor: AuthenticatedActor,
    projectId: string,
    sources: readonly SourceIdentityV1[],
  ): Promise<Map<string, ProjectVideoTranscriptState>> {
    await this.authorize(actor, projectId, "read");
    const states = new Map<string, ProjectVideoTranscriptState>();
    const uniqueSources = new Map(
      sources.map((source) => [
        `${source.provider}:${source.providerMediaId}`,
        source,
      ]),
    );
    for (const [identityKey, source] of uniqueSources) {
      const result = await this.database.query<DbRow>(
        `SELECT v.id, v.canonical_url, v.title, v.channel, v.duration_ms,
                v.source_language, pv.active_transcript_version_id
         FROM project_videos pv
         JOIN videos v ON v.id = pv.video_id
         WHERE pv.project_id = $1 AND v.source_provider = $2
           AND v.provider_media_id = $3`,
        [projectId, source.provider, source.providerMediaId],
      );
      const row = result.rows[0];
      if (row) {
        states.set(identityKey, {
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

  async getProjectVideoLanguageGate(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
  ): Promise<LanguageGate> {
    await this.authorize(actor, projectId, "read");
    return this.loadProjectVideoLanguageGate(projectId, videoId);
  }

  async confirmProjectVideoLanguageDecision(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: CreateProjectVideoLanguageDecisionRequest,
  ): Promise<ProjectVideoLanguageDecisionResponse> {
    await this.authorize(actor, projectId, "write");
    const command =
      CreateProjectVideoLanguageDecisionRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();

    return this.transaction(async () => {
      const replay = await this.database.query<DbRow>(
        `SELECT * FROM project_video_language_decisions
         WHERE project_id = $1 AND video_id = $2 AND actor_id = $3
           AND idempotency_key = $4`,
        [projectId, videoId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "That language-decision idempotency key was already used for different input.",
          );
        }
        return ProjectVideoLanguageDecisionResponseSchema.parse({
          decision: mapProjectVideoLanguageDecision(replay.rows[0]),
          gate: await this.loadProjectVideoLanguageGate(projectId, videoId),
        });
      }

      const projectVideo = await this.database.query<DbRow>(
        `SELECT * FROM project_videos
         WHERE project_id = $1 AND video_id = $2 FOR UPDATE`,
        [projectId, videoId],
      );
      const current = projectVideo.rows[0];
      if (!current) throw new CatalogNotFoundError("Project video not found.");
      const currentDecisionVersion = await this.database.query<DbRow>(
        `SELECT COALESCE(MAX(decision_version), 0) AS decision_version
         FROM project_video_language_decisions
         WHERE project_id = $1 AND video_id = $2`,
        [projectId, videoId],
      );
      if (
        Number(currentDecisionVersion.rows[0]?.decision_version ?? 0) !==
        command.expectedDecisionVersion
      ) {
        throw new CatalogConflictError(
          "The language decision changed; reload it before confirming.",
        );
      }
      if (command.evidenceId) {
        const evidence = await this.database.query(
          `SELECT 1 FROM project_video_language_evidence
           WHERE id = $1 AND project_id = $2 AND video_id = $3`,
          [command.evidenceId, projectId, videoId],
        );
        if (!evidence.rows[0]) {
          throw new CatalogConflictError(
            "The selected language evidence does not belong to this project video.",
          );
        }
      }

      const decision = {
        id: randomUUID(),
        projectId,
        videoId,
        decisionVersion: command.expectedDecisionVersion + 1,
        status: "confirmed" as const,
        basis: command.basis,
        resolvedLanguage: command.resolvedLanguage,
        ...(command.evidenceId ? { evidenceId: command.evidenceId } : {}),
        actorId: actor.userId,
        createdAt: now,
      };
      await this.database.query(
        `INSERT INTO project_video_language_decisions
           (id, project_id, video_id, decision_version, status, basis,
            resolved_language, evidence_id, actor_id, idempotency_key,
            request_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          decision.id,
          projectId,
          videoId,
          decision.decisionVersion,
          decision.status,
          decision.basis,
          decision.resolvedLanguage,
          command.evidenceId ?? null,
          actor.userId,
          command.idempotencyKey,
          requestSha256,
          now,
        ],
      );
      await this.database.query(
        `UPDATE project_videos
         SET current_language_decision_id = $1, language_gate_status = 'confirmed',
             version = version + 1, updated_at = $2
         WHERE project_id = $3 AND video_id = $4`,
        [decision.id, now, projectId, videoId],
      );

      if (command.batchItemId) {
        await this.requeueLanguageConfirmedBatchItem({
          actor,
          projectId,
          videoId,
          batchItemId: command.batchItemId,
          expectedBatchItemVersion: command.expectedBatchItemVersion!,
          decision: LanguageDecisionSnapshotSchema.parse({
            schemaVersion: 1,
            decisionId: decision.id,
            decisionVersion: decision.decisionVersion,
            status: decision.status,
            basis: decision.basis,
            resolvedLanguage: decision.resolvedLanguage,
            ...(command.evidenceId ? { evidenceId: command.evidenceId } : {}),
          }),
          now,
        });
      }
      return ProjectVideoLanguageDecisionResponseSchema.parse({
        decision,
        gate: await this.loadProjectVideoLanguageGate(projectId, videoId),
      });
    });
  }

  async observeWorkerLanguageEvidence(
    actor: AuthenticatedActor,
    jobId: string,
    input: WorkerObserveLanguageEvidenceRequest,
  ): Promise<WorkerObserveLanguageEvidenceResponse> {
    const request = WorkerObserveLanguageEvidenceRequestSchema.parse(input);
    await this.requireActiveWorkerLease(actor, jobId, request.attempt);
    const now = this.now().toISOString();
    return this.transaction(async () => {
      const jobResult = await this.database.query<DbRow>(
        `SELECT * FROM jobs WHERE id = $1 AND kind = 'transcription' FOR UPDATE`,
        [jobId],
      );
      const job = jobResult.rows[0];
      if (!job) throw new CatalogNotFoundError("Transcription job not found.");
      if (!["claimed", "processing"].includes(String(job.state))) {
        throw new AuthorizationError("The worker lease is no longer active.");
      }
      await this.requireActiveWorkerLease(actor, jobId, request.attempt);
      const payload = TranscriptionJobPayloadSchema.parse(
        typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload,
      );
      const evidence = ProviderLanguageEvidenceSchema.parse(request.evidence);
      if (
        evidence.jobId !== jobId ||
        evidence.attempt !== request.attempt ||
        evidence.projectId !== job.project_id ||
        evidence.videoId !== payload.catalogVideoId
      ) {
        throw new CatalogConflictError(
          "Observed language evidence does not belong to this worker attempt.",
        );
      }
      const existing = await this.database.query<DbRow>(
        "SELECT * FROM project_video_language_evidence WHERE id = $1",
        [evidence.id],
      );
      if (existing.rows[0]) {
        if (
          canonicalJson(mapProviderLanguageEvidence(existing.rows[0])) !==
          canonicalJson(evidence)
        ) {
          throw new CatalogIdempotencyConflictError(
            "Language evidence ID was already used for different evidence.",
          );
        }
      } else {
        await this.database.query(
          `INSERT INTO project_video_language_evidence
             (id, project_id, video_id, source, provider, reported_language,
              track_fingerprint, caption_kind, job_id, attempt, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            evidence.id,
            evidence.projectId,
            evidence.videoId,
            evidence.source,
            evidence.provider,
            evidence.reportedLanguage ?? null,
            evidence.trackFingerprint ?? null,
            evidence.captionKind ?? null,
            evidence.jobId,
            evidence.attempt,
            evidence.createdAt,
          ],
        );
      }

      const projectVideo = await this.database.query<DbRow>(
        `SELECT current_language_decision_id
         FROM project_videos
         WHERE project_id = $1 AND video_id = $2
         FOR UPDATE`,
        [job.project_id, payload.catalogVideoId],
      );
      if (!projectVideo.rows[0]) {
        throw new CatalogNotFoundError("Project video not found.");
      }
      const currentGate = await this.loadProjectVideoLanguageGate(
        String(job.project_id),
        payload.catalogVideoId,
      );
      const currentDecisionId = projectVideo.rows[0]
        .current_language_decision_id
        ? String(projectVideo.rows[0].current_language_decision_id)
        : undefined;
      const observesCurrentDecision = currentDecisionId
        ? payload.languageDecision?.decisionId === currentDecisionId
        : payload.languageDecision === undefined;
      const conflictsCreator =
        payload.languageDecision?.status !== "confirmed" &&
        evidence.reportedLanguage !== undefined &&
        payload.creatorReportedLanguage !== undefined &&
        !languagesEquivalent(
          evidence.reportedLanguage,
          payload.creatorReportedLanguage,
        );
      const conflictsDecision =
        evidence.reportedLanguage !== undefined &&
        payload.languageDecision?.status === "confirmed" &&
        payload.languageDecision.resolvedLanguage !== undefined &&
        !languagesEquivalent(
          evidence.reportedLanguage,
          payload.languageDecision.resolvedLanguage,
        );
      const status =
        conflictsCreator || conflictsDecision
          ? "conflict"
          : (payload.languageDecision?.status ?? currentGate.status);
      const hasConfirmedDecision =
        payload.languageDecision?.status === "confirmed" &&
        payload.languageDecision.resolvedLanguage !== undefined;
      const gateState =
        status === "conflict"
          ? "needs_language_confirmation"
          : !hasConfirmedDecision && evidence.reportedLanguage === undefined
            ? "needs_language_confirmation"
            : request.speechCapability !== undefined &&
                request.speechCapability.state !== "supported"
              ? "needs_transcript"
              : request.translationCapability !== undefined &&
                  request.translationCapability.state !== "supported"
                ? "needs_translation"
                : "ready";
      const gate = LanguageGateSchema.parse({
        state: gateState,
        status,
        ...(payload.creatorReportedLanguage
          ? { creatorReportedLanguage: payload.creatorReportedLanguage }
          : {}),
        providerEvidence: evidence,
        ...(observesCurrentDecision && currentGate.decision
          ? { decision: currentGate.decision }
          : {}),
        ...(request.speechCapability
          ? { speechCapability: request.speechCapability }
          : {}),
        ...(request.translationCapability
          ? { translationCapability: request.translationCapability }
          : {}),
        remediationReason:
          gateState === "ready"
            ? "none"
            : gateState === "needs_language_confirmation"
              ? status === "conflict"
                ? "resolve_conflict"
                : "confirm_language"
              : "select_supported_provider",
      });
      if (observesCurrentDecision) {
        await this.database.query(
          `UPDATE project_videos
           SET current_language_evidence_id = $1, language_gate_status = $2,
               version = version + 1, updated_at = $3
           WHERE project_id = $4 AND video_id = $5`,
          [evidence.id, status, now, job.project_id, payload.catalogVideoId],
        );
      }
      if (gateState !== "ready") {
        await this.database.query(
          `UPDATE jobs SET state = 'needs_user_action', updated_at = $1
           WHERE id = $2`,
          [now, jobId],
        );
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = $1, language_gate = $2::jsonb,
               language_decision_id = $3, language_decision_video_id = $4,
               version = version + 1, updated_at = $5
           WHERE job_id = $6 AND attempt = $7
             AND state NOT IN ('canceling', 'canceled')`,
          [
            gateState === "needs_language_confirmation"
              ? "needs_language_confirmation"
              : "blocked",
            JSON.stringify(gate),
            payload.languageDecision?.decisionId ?? null,
            payload.languageDecision ? payload.catalogVideoId : null,
            now,
            jobId,
            request.attempt,
          ],
        );
        const affectedBatch = await this.database.query<DbRow>(
          "SELECT batch_id FROM transcription_batch_items WHERE job_id = $1 LIMIT 1",
          [jobId],
        );
        if (affectedBatch.rows[0]) {
          await this.emitTranscriptionNotificationsForBatch(
            String(affectedBatch.rows[0].batch_id),
            now,
          );
        }
        await this.database.query(
          `DELETE FROM worker_leases
           WHERE job_id = $1 AND worker_id = $2 AND attempt = $3`,
          [jobId, actor.userId, request.attempt],
        );
      }
      return WorkerObserveLanguageEvidenceResponseSchema.parse({
        evidence,
        gate,
      });
    });
  }

  async createTranscriptionBatch(
    actor: AuthenticatedActor,
    input: CreateTranscriptionBatchInput,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, input.projectId, "write");
    const batchId = randomUUID();
    const createdAt = this.now().toISOString();
    await this.transaction(async () => {
      await this.insertTranscriptionBatch(
        batchId,
        actor.userId,
        input.projectId,
        input.name,
        input.options,
        createdAt,
        "manual",
      );
      for (const item of input.items) {
        await this.insertTranscriptionBatchItem(
          actor,
          input.projectId,
          batchId,
          input.options,
          item,
          createdAt,
          true,
          Boolean(input.trustVerifiedPreflight),
        );
      }
      await this.emitTranscriptionNotificationsForBatch(batchId, createdAt);
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
      `SELECT b.*, decision_user.handle AS decision_handle,
              decision_user.display_name AS decision_display_name
       FROM transcription_batches b
       LEFT JOIN project_members decision_member
         ON decision_member.project_id = b.project_id
        AND decision_member.user_id = b.hosted_approval_by
       LEFT JOIN users decision_user
         ON decision_user.id = decision_member.user_id
       WHERE b.id = $1 AND b.project_id = $2`,
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
        ...(batch.execution_location === "hosted"
          ? {
              hostedApproval: {
                state: batch.hosted_approval_state,
                version: Number(batch.hosted_approval_version),
                ...(batch.hosted_approval_state === "pending"
                  ? {}
                  : {
                      decidedBy: {
                        userId: String(batch.hosted_approval_by),
                        handle:
                          batch.decision_handle === null
                            ? "former_member"
                            : String(batch.decision_handle),
                        displayName:
                          batch.decision_display_name === null
                            ? "Former project member"
                            : String(batch.decision_display_name),
                      },
                      decidedAt: iso(batch.hosted_approval_at),
                    }),
              },
            }
          : {}),
        ...(batch.translation_provider === null
          ? {}
          : {
              translationConsent: {
                provider: batch.translation_provider,
                disclosureVersion: Number(batch.translation_disclosure_version),
                transcriptTextTransferAccepted: true,
              },
            }),
        dispatchStatus: batch.dispatch_status,
        createdBy: batch.created_by,
        ...(batch.archived_at === null
          ? {}
          : {
              archivedBy: batch.archived_by,
              archivedAt: iso(batch.archived_at),
            }),
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
       WHERE project_id = $1 AND processing_origin = 'manual'
         AND archived_at IS NULL
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
       WHERE b.project_id = $1 AND b.processing_origin = 'manual'
         AND bi.state = 'ready_for_review'
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

  private async hasLiveTranscriptionDependency(
    jobId: string,
    excludedItemIds: readonly string[] = [],
  ): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1
       FROM transcription_batch_items dependency
       WHERE dependency.job_id = $1
         AND dependency.state IN (
           'queued', 'resolving', 'acquiring', 'transcribing', 'translating',
           'aligning', 'uploading'
         )
         AND NOT (dependency.id = ANY($2::uuid[]))
       LIMIT 1`,
      [jobId, excludedItemIds],
    );
    return Boolean(result.rows[0]);
  }

  private async requestTranscriptionJobCancellation(
    projectId: string,
    jobId: string,
    actorId: string,
    requestedAt: string,
  ): Promise<"requested" | "settled"> {
    const selected = await this.database.query<DbRow>(
      "SELECT state FROM jobs WHERE id = $1 FOR UPDATE",
      [jobId],
    );
    const state = String(selected.rows[0]?.state ?? "");
    if (state === "queued") {
      await this.database.query(
        `UPDATE jobs SET state = 'canceled', updated_at = $1
         WHERE id = $2 AND state = 'queued'`,
        [requestedAt, jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = 'canceled', version = version + 1, updated_at = $1
         WHERE job_id = $2 AND state = 'canceling'`,
        [requestedAt, jobId],
      );
      return "settled";
    }
    if (!new Set(["claimed", "processing"]).has(state)) return "settled";

    await this.database.query(
      `INSERT INTO transcription_job_cancel_requests
         (job_id, project_id, requested_by, requested_at, reason)
       VALUES ($1, $2, $3, $4, 'batch_item')
       ON CONFLICT (job_id) DO UPDATE
       SET requested_by = EXCLUDED.requested_by,
           requested_at = EXCLUDED.requested_at,
           revoked_at = NULL, completed_at = NULL,
           reason = 'batch_item'`,
      [jobId, projectId, actorId, requestedAt],
    );
    return "requested";
  }

  async cancelTranscriptionBatchItem(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    itemId: string,
    input: CancelTranscriptionBatchItemRequest,
  ): Promise<CancelTranscriptionBatchItemResponse> {
    await this.authorize(actor, projectId, "write");
    const command = CancelTranscriptionBatchItemRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const canceledAt = this.now().toISOString();

    return this.transaction(async () => {
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM transcription_batch_item_cancel_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This batch-item cancellation key was already used for another request.",
          );
        }
        return CancelTranscriptionBatchItemResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }

      const selected = await this.database.query<DbRow>(
        `SELECT bi.*
         FROM transcription_batch_items bi
         JOIN transcription_batches b ON b.id = bi.batch_id
         WHERE bi.id = $1 AND bi.batch_id = $2 AND b.project_id = $3
         FOR UPDATE OF bi`,
        [itemId, batchId, projectId],
      );
      let item = selected.rows[0];
      if (!item)
        throw new CatalogNotFoundError("Transcription batch item not found.");

      let outcome: "canceled" | "canceling" | "already_canceled";
      let jobCancellationRequested = false;
      if (String(item.state) === "canceled") {
        outcome = "already_canceled";
      } else {
        if (Number(item.version) !== command.expectedVersion) {
          throw new CatalogConflictError(
            "The transcription batch item changed; reload it before canceling.",
          );
        }
        const active = transcriptionActiveStates.has(
          String(item.state) as TranscriptionBatchItem["state"],
        );
        if (active && item.job_id) {
          item = (
            await this.database.query<DbRow>(
              `UPDATE transcription_batch_items
               SET state = 'canceling', version = version + 1, updated_at = $1
               WHERE id = $2 RETURNING *`,
              [canceledAt, itemId],
            )
          ).rows[0]!;
          const hasSibling = await this.hasLiveTranscriptionDependency(
            String(item.job_id),
            [itemId],
          );
          if (hasSibling) {
            item = (
              await this.database.query<DbRow>(
                `UPDATE transcription_batch_items
                 SET state = 'canceled', version = version + 1, updated_at = $1
                 WHERE id = $2 RETURNING *`,
                [canceledAt, itemId],
              )
            ).rows[0]!;
            outcome = "canceled";
          } else {
            const disposition = await this.requestTranscriptionJobCancellation(
              projectId,
              String(item.job_id),
              actor.userId,
              canceledAt,
            );
            jobCancellationRequested = disposition === "requested";
            if (disposition === "requested") {
              outcome = "canceling";
            } else {
              item = (
                await this.database.query<DbRow>(
                  `UPDATE transcription_batch_items
                   SET state = 'canceled', version = version + 1, updated_at = $1
                   WHERE id = $2 RETURNING *`,
                  [canceledAt, itemId],
                )
              ).rows[0]!;
              outcome = "canceled";
            }
          }
        } else if (String(item.state) === "canceling") {
          outcome = "canceling";
        } else {
          const wasQueued = String(item.state) === "queued";
          item = (
            await this.database.query<DbRow>(
              `UPDATE transcription_batch_items
               SET state = 'canceled', version = version + 1, updated_at = $1
               WHERE id = $2 RETURNING *`,
              [canceledAt, itemId],
            )
          ).rows[0]!;
          outcome = "canceled";
          if (wasQueued && item.job_id) {
            const hasSibling = await this.hasLiveTranscriptionDependency(
              String(item.job_id),
              [itemId],
            );
            if (!hasSibling) {
              await this.requestTranscriptionJobCancellation(
                projectId,
                String(item.job_id),
                actor.userId,
                canceledAt,
              );
            }
          }
        }
      }

      const response = CancelTranscriptionBatchItemResponseSchema.parse({
        projectId,
        batchId,
        item: mapBatchItem(item),
        outcome,
        jobCancellationRequested,
      });
      await this.database.query(
        `INSERT INTO transcription_batch_item_cancel_commands
           (id, project_id, batch_id, item_id, actor_id, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          projectId,
          batchId,
          itemId,
          actor.userId,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          canceledAt,
        ],
      );
      return response;
    });
  }

  async retryTranscriptionBatchItem(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    itemId: string,
    input: RetryTranscriptionBatchItemRequest,
  ): Promise<RetryTranscriptionBatchItemResponse> {
    await this.authorize(actor, projectId, "write");
    const command = RetryTranscriptionBatchItemRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const queuedAt = this.now().toISOString();

    return this.transaction(async () => {
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM transcription_batch_item_retry_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This batch-item retry key was already used for another request.",
          );
        }
        return RetryTranscriptionBatchItemResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }

      const selected = await this.database.query<DbRow>(
        `SELECT bi.*, b.archived_at
         FROM transcription_batch_items bi
         JOIN transcription_batches b ON b.id = bi.batch_id
         WHERE bi.id = $1 AND bi.batch_id = $2 AND b.project_id = $3
         FOR UPDATE OF bi, b`,
        [itemId, batchId, projectId],
      );
      let item = selected.rows[0];
      if (!item)
        throw new CatalogNotFoundError("Transcription batch item not found.");
      if (item.archived_at !== null) {
        throw new CatalogConflictError(
          "Archived transcription batches cannot be retried.",
        );
      }

      let outcome: "queued" | "already_queued";
      if (String(item.state) === "queued") {
        outcome = "already_queued";
      } else {
        if (Number(item.version) !== command.expectedVersion) {
          throw new CatalogConflictError(
            "The transcription batch item changed; reload it before retrying.",
          );
        }
        if (
          String(item.state) !== "failed" ||
          item.error_retryable !== true ||
          !item.job_id
        ) {
          throw new CatalogConflictError(
            "Only retryable failed transcription items can be retried.",
          );
        }
        const job = await this.database.query<DbRow>(
          "SELECT state FROM jobs WHERE id = $1 FOR UPDATE",
          [item.job_id],
        );
        if (String(job.rows[0]?.state) !== "failed") {
          throw new CatalogConflictError(
            "The transcription job is no longer failed; reload it before retrying.",
          );
        }
        await this.database.query(
          `UPDATE transcription_job_cancel_requests
           SET revoked_at = $1
           WHERE job_id = $2 AND revoked_at IS NULL AND completed_at IS NULL`,
          [queuedAt, item.job_id],
        );
        await this.database.query(
          `UPDATE jobs
           SET state = 'queued',
               payload = payload - 'lastError' - 'queueDispatchedAt' - 'queueDeliveredAt',
               updated_at = $1
           WHERE id = $2`,
          [queuedAt, item.job_id],
        );
        item = (
          await this.database.query<DbRow>(
            `UPDATE transcription_batch_items
             SET state = 'queued', error_code = NULL, error_message = NULL,
                 error_retryable = NULL, version = version + 1, updated_at = $1
             WHERE id = $2 RETURNING *`,
            [queuedAt, itemId],
          )
        ).rows[0]!;
        await this.database.query(
          `UPDATE transcription_batches
           SET dispatch_status = 'active', version = version + 1, updated_at = $1
           WHERE id = $2`,
          [queuedAt, batchId],
        );
        outcome = "queued";
      }

      const response = RetryTranscriptionBatchItemResponseSchema.parse({
        projectId,
        batchId,
        item: mapBatchItem(item),
        outcome,
      });
      await this.database.query(
        `INSERT INTO transcription_batch_item_retry_commands
           (id, project_id, batch_id, item_id, actor_id, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          projectId,
          batchId,
          itemId,
          actor.userId,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          queuedAt,
        ],
      );
      return response;
    });
  }

  async archiveTranscriptionBatch(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    input: ArchiveTranscriptionBatchRequest,
  ): Promise<ArchiveTranscriptionBatchResponse> {
    await this.authorize(actor, projectId, "write");
    const command = ArchiveTranscriptionBatchRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const archivedAt = this.now().toISOString();

    return this.transaction(async () => {
      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM transcription_batch_archive_commands
         WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
        [projectId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This batch archive key was already used for another request.",
          );
        }
        return ArchiveTranscriptionBatchResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }

      const selected = await this.database.query<DbRow>(
        `SELECT * FROM transcription_batches
         WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [batchId, projectId],
      );
      const batch = selected.rows[0];
      if (!batch)
        throw new CatalogNotFoundError("Transcription batch not found.");

      let outcome: "archived" | "already_archived";
      if (batch.archived_at !== null) {
        outcome = "already_archived";
      } else {
        if (Number(batch.version) !== command.expectedVersion) {
          throw new CatalogConflictError(
            "The transcription batch changed; reload it before removing it.",
          );
        }
        const remaining = await this.database.query<DbRow>(
          `SELECT count(*)::integer AS count
           FROM transcription_batch_items
           WHERE batch_id = $1 AND state <> 'canceled'`,
          [batchId],
        );
        if (Number(remaining.rows[0]?.count ?? 0) > 0) {
          throw new CatalogConflictError(
            "Cancel every batch item before removing this batch from the list.",
          );
        }
        await this.database.query(
          `UPDATE transcription_batches
           SET dispatch_status = 'canceled', archived_by = $1,
               archived_at = $2, updated_at = $2,
               version = version + 1
           WHERE id = $3`,
          [actor.userId, archivedAt, batchId],
        );
        outcome = "archived";
      }

      const detail = await this.getTranscriptionBatch(
        actor,
        projectId,
        batchId,
      );
      const response = ArchiveTranscriptionBatchResponseSchema.parse({
        projectId,
        batch: detail.batch,
        outcome,
      });
      await this.database.query(
        `INSERT INTO transcription_batch_archive_commands
           (id, project_id, batch_id, actor_id, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          projectId,
          batchId,
          actor.userId,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          archivedAt,
        ],
      );
      return response;
    });
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
        `SELECT id, dispatch_status, processing_origin, version
         FROM transcription_batches
         WHERE id = $1 AND project_id = $2
         FOR UPDATE`,
        [batchId, projectId],
      );
      const batch = result.rows[0];
      if (!batch) {
        throw new CatalogNotFoundError("Transcription batch not found.");
      }
      if (batch.processing_origin === "project_local") {
        throw new CatalogConflictError(
          "Automatic local work is controlled by the project local-processing policy.",
        );
      }
      if (Number(batch.version) !== command.expectedVersion) {
        throw new CatalogConflictError(
          "The transcription batch changed; reload it before trying again.",
        );
      }
      if (
        batch.dispatch_status === "canceled" &&
        !["cancel_unstarted", "cancel_all"].includes(command.action)
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
        await this.database.query(
          `UPDATE jobs j
           SET payload = payload - 'queueDispatchedAt' - 'queueDeliveredAt', updated_at = $1
           WHERE j.kind = 'transcription' AND j.state = 'queued'
             AND EXISTS (
               SELECT 1 FROM transcription_batch_items bi
               WHERE bi.batch_id = $2 AND bi.job_id = j.id
                 AND bi.state = 'queued'
             )`,
          [updatedAt, batchId],
        );
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
      } else if (command.action === "cancel_all") {
        dispatchStatus = "canceled";
        const canceling = await this.database.query<DbRow>(
          `UPDATE transcription_batch_items
           SET state = CASE
                 WHEN state IN (
                   'resolving', 'acquiring', 'transcribing', 'translating',
                   'aligning', 'uploading'
                 ) THEN 'canceling'
                 ELSE 'canceled'
               END,
               version = version + 1, updated_at = $1
           WHERE batch_id = $2 AND state NOT IN ('canceling', 'canceled')
           RETURNING id, job_id, state`,
          [updatedAt, batchId],
        );
        const jobIds = [
          ...new Set(
            canceling.rows
              .filter((item) => item.job_id)
              .map((item) => String(item.job_id)),
          ),
        ];
        for (const jobId of jobIds) {
          const canceledItemIds = canceling.rows
            .filter((item) => String(item.job_id) === jobId)
            .map((item) => String(item.id));
          const hasSibling = await this.hasLiveTranscriptionDependency(
            jobId,
            canceledItemIds,
          );
          if (hasSibling) {
            await this.database.query(
              `UPDATE transcription_batch_items
               SET state = 'canceled', version = version + 1, updated_at = $1
               WHERE id = ANY($2::uuid[]) AND state = 'canceling'`,
              [updatedAt, canceledItemIds],
            );
            continue;
          }
          const disposition = await this.requestTranscriptionJobCancellation(
            projectId,
            jobId,
            actor.userId,
            updatedAt,
          );
          if (disposition === "settled") {
            await this.database.query(
              `UPDATE transcription_batch_items
               SET state = 'canceled', version = version + 1, updated_at = $1
               WHERE id = ANY($2::uuid[]) AND state = 'canceling'`,
              [updatedAt, canceledItemIds],
            );
          }
        }
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
             SET state = 'queued',
                 payload = payload - 'lastError' - 'queueDispatchedAt' - 'queueDeliveredAt',
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

  async updateHostedTranscriptionApproval(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    input: UpdateHostedTranscriptionApprovalRequest,
  ): Promise<HostedTranscriptionApprovalResponse> {
    await this.requireRegistered(actor);
    const command = UpdateHostedTranscriptionApprovalRequestSchema.parse(input);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(command))
      .digest("hex");
    const now = this.now().toISOString();

    return this.transaction(async () => {
      const membership = await this.database.query<{ role: ProjectRole }>(
        `SELECT role FROM project_members
         WHERE project_id = $1 AND user_id = $2
         FOR SHARE`,
        [projectId, actor.userId],
      );
      requirePermission(membership.rows[0]?.role, "manage_project");

      const selected = await this.database.query<DbRow>(
        `SELECT * FROM transcription_batches
         WHERE id = $1 AND project_id = $2
         FOR UPDATE`,
        [batchId, projectId],
      );
      const batch = selected.rows[0];
      if (!batch) {
        throw new CatalogNotFoundError("Transcription batch not found.");
      }
      if (batch.execution_location !== "hosted") {
        throw new CatalogConflictError(
          "Local transcription batches do not require hosted approval.",
        );
      }

      const replay = await this.database.query<DbRow>(
        `SELECT request_sha256, response_json
         FROM hosted_transcription_approval_commands
         WHERE project_id = $1 AND batch_id = $2 AND actor_id = $3
           AND idempotency_key = $4`,
        [projectId, batchId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "This hosted-approval command key was already used for another request.",
          );
        }
        return HostedTranscriptionApprovalResponseSchema.parse(
          jsonRecord(replay.rows[0].response_json),
        );
      }

      if (Number(batch.hosted_approval_version) !== command.expectedVersion) {
        throw new CatalogConflictError(
          "The hosted approval changed; reload the batch before trying again.",
        );
      }
      const currentState = String(batch.hosted_approval_state);
      if (
        (command.action === "approve" &&
          !["pending", "revoked"].includes(currentState)) ||
        (command.action === "revoke" && currentState !== "approved")
      ) {
        throw new CatalogConflictError(
          command.action === "approve"
            ? "This hosted batch is already approved."
            : "Only an approved hosted batch can be revoked.",
        );
      }

      const nextState = command.action === "approve" ? "approved" : "revoked";
      const updated = await this.database.query<DbRow>(
        `UPDATE transcription_batches
         SET hosted_approval_state = $1,
             hosted_approval_version = hosted_approval_version + 1,
             hosted_approval_by = $2, hosted_approval_at = $3,
             updated_at = $3
         WHERE id = $4 AND project_id = $5
         RETURNING hosted_approval_version`,
        [nextState, actor.userId, now, batchId, projectId],
      );
      const actorSummary = (
        await this.database.query<DbRow>(
          "SELECT handle, display_name FROM users WHERE id = $1",
          [actor.userId],
        )
      ).rows[0]!;
      const response = HostedTranscriptionApprovalResponseSchema.parse({
        projectId,
        batchId,
        approval: {
          state: nextState,
          version: Number(updated.rows[0]!.hosted_approval_version),
          decidedBy: {
            userId: actor.userId,
            handle: String(actorSummary.handle),
            displayName: String(actorSummary.display_name),
          },
          decidedAt: now,
        },
      });
      await this.database.query(
        `INSERT INTO hosted_transcription_approval_commands
           (id, project_id, batch_id, actor_id, action, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          projectId,
          batchId,
          actor.userId,
          command.action,
          command.idempotencyKey,
          requestSha256,
          JSON.stringify(response),
          now,
        ],
      );
      return response;
    });
  }

  async listUndispatchedTranscriptionJobs(
    limit = 25,
  ): Promise<Array<{ jobId: string; executionLocation: "local" | "hosted" }>> {
    const result = await this.database.query<DbRow>(
      `SELECT DISTINCT j.id, j.payload->>'executionLocation' AS execution_location
       FROM jobs j
       JOIN transcription_batch_items bi ON bi.job_id = j.id
       JOIN transcription_batches b ON b.id = bi.batch_id
       JOIN projects p ON p.id = b.project_id
       WHERE j.kind = 'transcription' AND j.state = 'queued'
         AND j.payload->>'queueDeliveredAt' IS NULL
         AND (
           j.payload->>'queueDispatchedAt' IS NULL
           OR (j.payload->>'queueDispatchedAt')::timestamptz <= $2::timestamptz
         )
         AND b.dispatch_status = 'active' AND bi.state = 'queued'
         AND (
           (j.payload->>'executionLocation' = 'local'
             AND p.local_processing_state = 'automatic')
           OR b.hosted_approval_state = 'approved'
         )
       ORDER BY j.id
       LIMIT $1::integer`,
      [
        Math.max(1, Math.min(100, limit)),
        new Date(this.now().getTime() - 5 * 60_000).toISOString(),
      ],
    );
    return result.rows.map((row) => ({
      jobId: String(row.id),
      executionLocation:
        row.execution_location === "hosted" ? "hosted" : "local",
    }));
  }

  async markTranscriptionJobDispatched(jobId: string): Promise<boolean> {
    const result = await this.database.query<DbRow>(
      `UPDATE jobs
       SET payload = payload || jsonb_build_object(
             'queueDispatchedAt', $1::text
           ),
           updated_at = $1::timestamptz
       WHERE id = $2 AND kind = 'transcription' AND state = 'queued'
         AND payload->>'queueDeliveredAt' IS NULL
         AND EXISTS (
           SELECT 1
           FROM transcription_batch_items bi
           JOIN transcription_batches b ON b.id = bi.batch_id
           JOIN projects p ON p.id = b.project_id
           WHERE bi.job_id = jobs.id
             AND b.dispatch_status = 'active' AND bi.state = 'queued'
             AND (
               (jobs.payload->>'executionLocation' = 'local'
                 AND p.local_processing_state = 'automatic')
               OR b.hosted_approval_state = 'approved'
             )
         )
       RETURNING id`,
      [this.now().toISOString(), jobId],
    );
    return Boolean(result.rows[0]);
  }

  async markTranscriptionJobQueueDelivered(
    jobId: string,
    executionLocation: "local" | "hosted",
  ): Promise<boolean> {
    const deliveredAt = this.now().toISOString();
    const result = await this.database.query<DbRow>(
      `UPDATE jobs
       SET payload = payload || jsonb_build_object(
             'queueDeliveredAt', $1::text
           ),
           updated_at = $1::timestamptz
       WHERE id = $2 AND kind = 'transcription' AND state = 'queued'
         AND payload->>'executionLocation' = $3
         AND EXISTS (
           SELECT 1
           FROM transcription_batch_items bi
           JOIN transcription_batches b ON b.id = bi.batch_id
           JOIN projects p ON p.id = b.project_id
           WHERE bi.job_id = jobs.id
             AND b.dispatch_status = 'active' AND bi.state = 'queued'
             AND (($3 = 'local' AND p.local_processing_state = 'automatic')
               OR b.hosted_approval_state = 'approved')
         )
       RETURNING id`,
      [deliveredAt, jobId, executionLocation],
    );
    return Boolean(result.rows[0]);
  }

  async claimTranscriptionJob(
    actor: AuthenticatedActor,
    executionLocation: "local" | "hosted",
    leaseSeconds: number,
    requireQueueDelivery = false,
  ): Promise<ClaimedTranscriptionJob | undefined> {
    await this.requireRegistered(actor);
    const claimedAt = this.now();
    const expiresAt = new Date(claimedAt.getTime() + leaseSeconds * 1_000);
    return this.transaction(async () => {
      const expiredCancellations = await this.database.query<DbRow>(
        `SELECT request.job_id
         FROM transcription_job_cancel_requests request
         JOIN jobs job ON job.id = request.job_id
         LEFT JOIN worker_leases lease ON lease.job_id = request.job_id
         WHERE request.reason = 'batch_item'
           AND request.revoked_at IS NULL AND request.completed_at IS NULL
           AND job.state IN ('claimed', 'processing')
           AND (lease.job_id IS NULL OR lease.expires_at <= $1)
         FOR UPDATE OF request, job`,
        [claimedAt.toISOString()],
      );
      for (const cancellation of expiredCancellations.rows) {
        const cancellationJobId = String(cancellation.job_id);
        const activeDependency =
          await this.hasLiveTranscriptionDependency(cancellationJobId);
        if (activeDependency) {
          await this.database.query(
            `UPDATE transcription_job_cancel_requests SET revoked_at = $1
             WHERE job_id = $2`,
            [claimedAt.toISOString(), cancellationJobId],
          );
        } else {
          await this.database.query(
            `UPDATE jobs SET state = 'canceled', updated_at = $1
             WHERE id = $2 AND state IN ('claimed', 'processing')`,
            [claimedAt.toISOString(), cancellationJobId],
          );
          await this.database.query(
            `UPDATE transcription_job_cancel_requests SET completed_at = $1
             WHERE job_id = $2`,
            [claimedAt.toISOString(), cancellationJobId],
          );
        }
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'canceled', version = version + 1, updated_at = $1
           WHERE job_id = $2 AND state = 'canceling'`,
          [claimedAt.toISOString(), cancellationJobId],
        );
        await this.database.query(
          "DELETE FROM worker_leases WHERE job_id = $1",
          [cancellationJobId],
        );
      }
      const candidate = await this.database.query<DbRow>(
        `SELECT j.*
         FROM jobs j
         JOIN project_members pm
           ON pm.project_id = j.project_id AND pm.user_id = $1
         JOIN projects p ON p.id = j.project_id
         LEFT JOIN worker_leases wl ON wl.job_id = j.id
         WHERE j.kind = 'transcription'
           AND pm.role IN ('owner', 'administrator', 'researcher')
           AND j.payload->>'executionLocation' = $2
           AND ($2 = 'hosted' OR p.local_processing_state = 'automatic')
           ${requireQueueDelivery ? "AND j.payload->>'queueDeliveredAt' IS NOT NULL" : ""}
           AND EXISTS (
             SELECT 1
             FROM transcription_batch_items bi
             JOIN transcription_batches b ON b.id = bi.batch_id
             WHERE bi.job_id = j.id
               AND ($2 = 'local' OR b.hosted_approval_state = 'approved')
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
           AND NOT EXISTS (
             SELECT 1 FROM transcription_job_cancel_requests cancel_request
             WHERE cancel_request.job_id = j.id
               AND cancel_request.revoked_at IS NULL
               AND cancel_request.completed_at IS NULL
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
      if (!row) return undefined;
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
         WHERE job_id = $3
           AND state NOT IN ('ready_for_review', 'canceling', 'canceled')`,
        [attempt, claimedAt.toISOString(), row.id],
      );
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
    });
  }

  async heartbeatTranscriptionJob(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    leaseSeconds: number,
    stage: WorkerProgressStage,
  ): Promise<WorkerHeartbeatResponse> {
    const heartbeatAt = this.now();
    const expiresAt = new Date(heartbeatAt.getTime() + leaseSeconds * 1_000);
    return this.transaction(async () => {
      const job = await this.database.query<DbRow>(
        "SELECT state FROM jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      if (
        !job.rows[0] ||
        !["claimed", "processing"].includes(String(job.rows[0].state))
      ) {
        throw new AuthorizationError("The worker lease is no longer active.");
      }
      const lease = await this.requireActiveWorkerLease(actor, jobId, attempt);
      const cancellation = await this.database.query<DbRow>(
        `SELECT requested_at, reason
         FROM transcription_job_cancel_requests
         WHERE job_id = $1 AND revoked_at IS NULL AND completed_at IS NULL
         FOR UPDATE`,
        [jobId],
      );
      if (cancellation.rows[0]) {
        const activeDependency =
          cancellation.rows[0].reason === "batch_item"
            ? await this.hasLiveTranscriptionDependency(jobId)
            : Boolean(
                (
                  await this.database.query(
                    `SELECT 1
               FROM transcription_batch_items dependency
               JOIN transcription_batches dependency_batch
                 ON dependency_batch.id = dependency.batch_id
               JOIN project_videos dependency_video
                 ON dependency_video.project_id = dependency_batch.project_id
                AND dependency_video.video_id = dependency.catalog_video_id
               WHERE dependency.job_id = $1
                 AND dependency_video.triage_state = 'active'
               LIMIT 1`,
                    [jobId],
                  )
                ).rows[0],
              );
        if (!activeDependency) {
          await this.database.query(
            `UPDATE jobs SET state = 'canceled', updated_at = $1
             WHERE id = $2 AND state IN ('claimed', 'processing')`,
            [heartbeatAt.toISOString(), jobId],
          );
          await this.database.query(
            `UPDATE transcription_batch_items
             SET state = 'canceled', version = version + 1, updated_at = $1
             WHERE job_id = $2 AND attempt = $3
               AND state NOT IN ('ready_for_review', 'canceled')`,
            [heartbeatAt.toISOString(), jobId, attempt],
          );
          await this.database.query(
            `UPDATE transcription_job_cancel_requests SET completed_at = $1
             WHERE job_id = $2`,
            [heartbeatAt.toISOString(), jobId],
          );
          await this.database.query(
            `DELETE FROM worker_leases
             WHERE job_id = $1 AND worker_id = $2 AND attempt = $3`,
            [jobId, actor.userId, attempt],
          );
          return WorkerHeartbeatResponseSchema.parse({
            status: "cancellation_requested",
            requestedAt: iso(cancellation.rows[0].requested_at),
          });
        }
        await this.database.query(
          `UPDATE transcription_job_cancel_requests SET revoked_at = $1
           WHERE job_id = $2`,
          [heartbeatAt.toISOString(), jobId],
        );
        if (cancellation.rows[0].reason === "batch_item") {
          await this.database.query(
            `UPDATE transcription_batch_items
             SET state = 'canceled', version = version + 1, updated_at = $1
             WHERE job_id = $2 AND state = 'canceling'`,
            [heartbeatAt.toISOString(), jobId],
          );
        }
      }
      const renewed = await this.database.query(
        `UPDATE worker_leases
         SET heartbeat_at = $1, expires_at = $2
         WHERE job_id = $3 AND worker_id = $4 AND attempt = $5
         RETURNING job_id`,
        [
          heartbeatAt.toISOString(),
          expiresAt.toISOString(),
          jobId,
          actor.userId,
          attempt,
        ],
      );
      if (!renewed.rows[0]) {
        throw new AuthorizationError("The worker lease is no longer active.");
      }
      await this.database.query(
        `UPDATE jobs SET state = 'processing', updated_at = $1
         WHERE id = $2 AND state IN ('claimed', 'processing')`,
        [heartbeatAt.toISOString(), jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = $1, version = version + 1, updated_at = $2
         WHERE job_id = $3 AND attempt = $4
           AND state NOT IN ('ready_for_review', 'canceling', 'canceled')`,
        [stage, heartbeatAt.toISOString(), jobId, attempt],
      );
      return WorkerHeartbeatResponseSchema.parse({
        status: "active",
        lease: {
          jobId,
          workerId: actor.userId,
          attempt,
          claimedAt: iso(lease.claimed_at),
          heartbeatAt: heartbeatAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
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
         WHERE job_id = $3 AND attempt = $4
           AND state NOT IN ('canceling', 'canceled')`,
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
           AND state NOT IN ('ready_for_review', 'canceling', 'canceled')`,
        [
          failure.code,
          failure.message,
          failure.retryable,
          failedAt,
          jobId,
          failure.attempt,
        ],
      );
      const affectedBatches = await this.database.query<DbRow>(
        "SELECT DISTINCT batch_id FROM transcription_batch_items WHERE job_id = $1",
        [jobId],
      );
      for (const batch of affectedBatches.rows) {
        await this.emitTranscriptionNotificationsForBatch(
          String(batch.batch_id),
          failedAt,
        );
      }
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

  async createManualTimedTranscriptImport(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: CreateManualTimedTranscriptImportRequest,
  ): Promise<ManualTimedTranscriptImportUploadGrant> {
    await this.authorize(actor, projectId, "write");
    const command = CreateManualTimedTranscriptImportRequestSchema.parse(input);
    const requestSha256 = sha256(
      new TextEncoder().encode(canonicalJson(command)),
    );
    const now = this.now();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1_000);
    let importId: string = randomUUID();
    let sourceLanguage = "";

    await this.transaction(async () => {
      const replay = await this.database.query<DbRow>(
        `SELECT * FROM manual_timed_transcript_imports
         WHERE project_id = $1 AND video_id = $2 AND created_by = $3
           AND idempotency_key = $4`,
        [projectId, videoId, actor.userId, command.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "That timed transcript import idempotency key was already used for different input.",
          );
        }
        sourceLanguage = await this.loadManualImportSourceLanguage(
          replay.rows[0],
        );
        importId = String(replay.rows[0].id);
        return;
      }

      const video = await this.database.query<DbRow>(
        `SELECT pv.version AS project_video_version, v.duration_ms,
                v.updated_at AS video_updated_at,
                d.id AS decision_id, d.decision_version, d.status,
                d.resolved_language
         FROM project_videos pv
         JOIN videos v ON v.id = pv.video_id
         LEFT JOIN project_video_language_decisions d
           ON d.id = pv.current_language_decision_id
         WHERE pv.project_id = $1 AND pv.video_id = $2
         FOR UPDATE OF pv`,
        [projectId, videoId],
      );
      const projectVideo = video.rows[0];
      if (!projectVideo)
        throw new CatalogNotFoundError("Project video not found.");
      // The project-video lock serializes same-key creators. Recheck after
      // acquiring it so a concurrent exact create returns its original grant.
      const replayAfterLock = await this.database.query<DbRow>(
        `SELECT * FROM manual_timed_transcript_imports
         WHERE project_id = $1 AND video_id = $2 AND created_by = $3
           AND idempotency_key = $4`,
        [projectId, videoId, actor.userId, command.idempotencyKey],
      );
      if (replayAfterLock.rows[0]) {
        if (String(replayAfterLock.rows[0].request_sha256) !== requestSha256) {
          throw new CatalogIdempotencyConflictError(
            "That timed transcript import idempotency key was already used for different input.",
          );
        }
        sourceLanguage = await this.loadManualImportSourceLanguage(
          replayAfterLock.rows[0],
        );
        importId = String(replayAfterLock.rows[0].id);
        return;
      }
      if (
        String(projectVideo.decision_id ?? "") !== command.languageDecisionId ||
        Number(projectVideo.decision_version ?? 0) !==
          command.expectedDecisionVersion ||
        projectVideo.status !== "confirmed" ||
        !isImportableSourceLanguage(projectVideo.resolved_language)
      ) {
        throw new CatalogConflictError(
          "The confirmed source-language decision changed; reload before importing.",
        );
      }
      if (
        !Number.isSafeInteger(Number(projectVideo.duration_ms)) ||
        Number(projectVideo.duration_ms) <= 0
      ) {
        throw new CatalogConflictError(
          "A known video duration is required for timed transcript import.",
        );
      }
      const batchItem = await this.database.query<DbRow>(
        `SELECT bi.id, bi.batch_id, bi.version, bi.state
         FROM transcription_batch_items bi
         JOIN transcription_batches b ON b.id = bi.batch_id
         WHERE bi.id = $1 AND b.project_id = $2 AND bi.catalog_video_id = $3
         FOR UPDATE OF bi`,
        [command.batchItemId, projectId, videoId],
      );
      const item = batchItem.rows[0];
      if (
        !item ||
        Number(item.version) !== command.expectedBatchItemVersion ||
        !["needs_language_confirmation", "blocked"].includes(String(item.state))
      ) {
        throw new CatalogConflictError(
          "The selected batch item is no longer actionable for timed import.",
        );
      }
      sourceLanguage = String(projectVideo.resolved_language);
      await this.database.query(
        `INSERT INTO manual_timed_transcript_imports
           (id, project_id, video_id, language_decision_id,
            language_decision_version, project_video_version, video_duration_ms,
            video_updated_at, batch_item_id, batch_id, batch_item_version, original_format,
            english_format, original_byte_size, english_byte_size, original_sha256,
            english_sha256, state, idempotency_key, request_sha256, expires_at,
            created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, 'staged', $18, $19, $20, $21, $22)`,
        [
          importId,
          projectId,
          videoId,
          command.languageDecisionId,
          command.expectedDecisionVersion,
          Number(projectVideo.project_video_version),
          Number(projectVideo.duration_ms),
          iso(projectVideo.video_updated_at),
          command.batchItemId,
          item.batch_id,
          command.expectedBatchItemVersion,
          command.original.format,
          command.english.format,
          command.original.byteSize,
          command.english.byteSize,
          command.original.sha256,
          command.english.sha256,
          command.idempotencyKey,
          requestSha256,
          expiresAt.toISOString(),
          actor.userId,
          now.toISOString(),
        ],
      );
      for (const target of [
        { role: "original", format: command.original.format },
        { role: "english", format: command.english.format },
      ] as const) {
        await this.database.query(
          `INSERT INTO manual_timed_transcript_import_targets
             (import_id, role, object_key) VALUES ($1, $2, $3)`,
          [
            importId,
            target.role,
            `staging/manual-imports/projects/${projectId}/videos/${videoId}/${importId}/${target.role}.${target.format}`,
          ],
        );
      }
    });

    const persisted = await this.loadManualTimedTranscriptImport(importId);
    return this.issueManualTimedTranscriptImportGrant(
      persisted,
      sourceLanguage,
    );
  }

  async finalizeManualTimedTranscriptImport(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    importId: string,
    input: FinalizeManualTimedTranscriptImportRequest,
  ): Promise<ManualTimedTranscriptImportStatus> {
    await this.authorize(actor, projectId, "write");
    const command =
      FinalizeManualTimedTranscriptImportRequestSchema.parse(input);
    const requestSha256 = sha256(
      new TextEncoder().encode(canonicalJson(command)),
    );
    let importRow = await this.loadManualTimedTranscriptImport(importId);
    if (
      String(importRow.project_id) !== projectId ||
      String(importRow.video_id) !== videoId
    ) {
      throw new CatalogNotFoundError("Timed transcript import not found.");
    }
    if (String(importRow.state) === "finalized") {
      if (
        String(importRow.finalize_idempotency_key) !== command.idempotencyKey ||
        String(importRow.finalize_request_sha256) !== requestSha256
      ) {
        throw new CatalogIdempotencyConflictError(
          "Timed transcript import was already finalized with different input.",
        );
      }
      return this.loadManualTimedTranscriptImportStatus(importId);
    }
    let finalizationToken: string | undefined;
    let resuming = false;
    if (String(importRow.state) === "finalizing") {
      if (
        String(importRow.finalize_idempotency_key) !== command.idempotencyKey ||
        String(importRow.finalize_request_sha256) !== requestSha256
      ) {
        throw new CatalogIdempotencyConflictError(
          "Timed transcript import finalization is already in progress.",
        );
      }
      const startedAt = new Date(
        iso(importRow.finalization_started_at),
      ).getTime();
      if (startedAt > this.now().getTime() - 5 * 60 * 1_000) {
        return this.loadManualTimedTranscriptImportStatus(importId);
      }
      const takeoverToken = randomUUID();
      const resumed = await this.database.query<DbRow>(
        `UPDATE manual_timed_transcript_imports
         SET finalization_token = $1, finalization_started_at = $2,
             version = version + 1
         WHERE id = $3 AND state = 'finalizing' AND finalization_token = $4
         RETURNING *`,
        [
          takeoverToken,
          this.now().toISOString(),
          importId,
          importRow.finalization_token,
        ],
      );
      if (!resumed.rows[0]) {
        return this.loadManualTimedTranscriptImportStatus(importId);
      }
      importRow = resumed.rows[0];
      finalizationToken = takeoverToken;
      resuming = true;
    }
    if (new Date(iso(importRow.expires_at)).getTime() <= this.now().getTime()) {
      await this.expireManualTimedTranscriptImport(importRow);
      throw new CatalogConflictError(
        "Timed transcript import grant has expired.",
      );
    }
    const targets = await this.loadManualTimedTranscriptImportTargets(importId);
    const originalReceipt = resuming
      ? this.manualTimedImportStoredReceipt(importRow, "original")
      : command.original;
    const englishReceipt = resuming
      ? this.manualTimedImportStoredReceipt(importRow, "english")
      : command.english;
    const original = await this.loadManualTimedTranscriptImportObject(
      targets.get("original"),
      originalReceipt,
      importRow.original_byte_size,
      importRow.original_sha256,
    );
    const english = await this.loadManualTimedTranscriptImportObject(
      targets.get("english"),
      englishReceipt,
      importRow.english_byte_size,
      importRow.english_sha256,
    );
    const sourceLanguage = await this.loadManualImportSourceLanguage(importRow);
    let normalized: Awaited<
      ReturnType<typeof normalizeManualTimedBilingualImport>
    >;
    try {
      normalized = await normalizeManualTimedBilingualImport({
        importId,
        videoId: await this.loadYoutubeVideoId(videoId),
        sourceLanguage,
        durationMs: Number(importRow.video_duration_ms),
        original: {
          format: ManualTimedTranscriptFormatSchema.parse(
            importRow.original_format,
          ),
          bytes: original.bytes,
        },
        english: {
          format: ManualTimedTranscriptFormatSchema.parse(
            importRow.english_format,
          ),
          bytes: english.bytes,
        },
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "manual_import_invalid_format";
      throw new ManualTimedTranscriptImportError(code);
    }
    const claimToken = finalizationToken ?? randomUUID();
    let reserved = resuming;
    if (!resuming)
      await this.transaction(async () => {
        const locked = await this.database.query<DbRow>(
          `SELECT state, expires_at, finalize_idempotency_key,
                  finalize_request_sha256
         FROM manual_timed_transcript_imports WHERE id = $1 FOR UPDATE`,
          [importId],
        );
        const current = locked.rows[0];
        if (!current) {
          throw new CatalogNotFoundError("Timed transcript import not found.");
        }
        if (String(current.state) === "finalized") {
          if (
            String(current.finalize_idempotency_key) !==
              command.idempotencyKey ||
            String(current.finalize_request_sha256) !== requestSha256
          ) {
            throw new CatalogIdempotencyConflictError(
              "Timed transcript import was already finalized with different input.",
            );
          }
          return;
        }
        if (String(current.state) === "finalizing") {
          if (
            String(current.finalize_idempotency_key) !==
              command.idempotencyKey ||
            String(current.finalize_request_sha256) !== requestSha256
          ) {
            throw new CatalogIdempotencyConflictError(
              "Timed transcript import finalization is already in progress.",
            );
          }
          return;
        }
        if (
          String(current.state) !== "staged" ||
          new Date(iso(current.expires_at)).getTime() <= this.now().getTime()
        ) {
          return;
        }
        const reservation = await this.database.query<DbRow>(
          `UPDATE manual_timed_transcript_imports
         SET state = 'finalizing', finalize_idempotency_key = $1,
             finalize_request_sha256 = $2, finalization_token = $3,
             finalization_started_at = $4,
             original_object_version_id = $5, english_object_version_id = $6,
             version = version + 1
         WHERE id = $7 AND state = 'staged' AND expires_at > $4
         RETURNING id`,
          [
            command.idempotencyKey,
            requestSha256,
            claimToken,
            this.now().toISOString(),
            originalReceipt.objectVersionId,
            englishReceipt.objectVersionId,
            importId,
          ],
        );
        reserved = reservation.rows.length === 1;
      });
    if (!reserved) return this.loadManualTimedTranscriptImportStatus(importId);
    const finalizedAt = this.now().toISOString();
    const transcriptVersionId = randomUUID();
    const candidateId = randomUUID();
    const prefix = `projects/${projectId}/videos/${videoId}/manual-imports/${importId}/candidate`;
    const candidateObjects: Array<{
      objectKey: string;
      objectVersionId: string;
    }> = [];
    try {
      const artifacts = await this.storeManualTimedTranscriptCandidateArtifacts(
        prefix,
        normalized,
        (artifact) => candidateObjects.push(artifact),
      );
      const manifest = TranscriptManifestSchema.parse({
        schemaVersion: 1,
        id: transcriptVersionId,
        projectId,
        catalogVideoId: videoId,
        videoId: await this.loadYoutubeVideoId(videoId),
        lineageId: importId,
        version: 1,
        sourceLanguage,
        targetLanguage: "en",
        timingPrecision: "cue",
        provider: normalized.original.track.provider,
        normalizationSchemaVersion: normalized.original.track.schemaVersion,
        manualImportId: importId,
        createdBy: actor.userId,
        createdAt: finalizedAt,
        languageDecision: {
          schemaVersion: 1,
          decisionId: importRow.language_decision_id,
          decisionVersion: Number(importRow.language_decision_version),
          status: "confirmed",
          basis: await this.loadManualImportDecisionBasis(importRow),
          resolvedLanguage: sourceLanguage,
        },
        artifacts,
      });
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      const manifestObject = await this.store.put({
        key: `${prefix}/manifest.json`,
        bytes: manifestBytes,
        contentType: "application/json",
        sha256: sha256(manifestBytes),
      });
      candidateObjects.push({
        objectKey: manifestObject.key,
        objectVersionId: manifestObject.versionId,
      });

      await this.transaction(async () => {
        const locked = await this.database.query<DbRow>(
          `SELECT mi.*, pv.version AS current_project_video_version,
                v.duration_ms AS current_duration_ms,
                v.updated_at AS current_video_updated_at,
                pv.current_language_decision_id,
                d.decision_version, d.status, d.basis, d.resolved_language
         FROM manual_timed_transcript_imports mi
         JOIN project_videos pv ON pv.project_id = mi.project_id AND pv.video_id = mi.video_id
         JOIN videos v ON v.id = mi.video_id
         LEFT JOIN project_video_language_decisions d ON d.id = pv.current_language_decision_id
         WHERE mi.id = $1 FOR UPDATE OF mi, pv`,
          [importId],
        );
        const current = locked.rows[0];
        if (!current)
          throw new CatalogNotFoundError("Timed transcript import not found.");
        if (
          String(current.state) !== "finalizing" ||
          String(current.finalization_token ?? "") !== claimToken
        ) {
          throw new CatalogConflictError(
            "Timed transcript import finalization reservation was lost.",
          );
        }
        if (
          Number(current.current_project_video_version) !==
            Number(current.project_video_version) ||
          Number(current.current_duration_ms) !==
            Number(current.video_duration_ms) ||
          iso(current.current_video_updated_at) !==
            iso(current.video_updated_at) ||
          String(current.current_language_decision_id ?? "") !==
            String(current.language_decision_id) ||
          Number(current.decision_version ?? 0) !==
            Number(current.language_decision_version) ||
          current.status !== "confirmed" ||
          new Date(iso(current.expires_at)).getTime() <= this.now().getTime() ||
          !languagesEquivalent(
            String(current.resolved_language ?? ""),
            sourceLanguage,
          )
        ) {
          throw new CatalogConflictError(
            "The project video or confirmed language decision changed; restart the import.",
          );
        }
        const batchItem = await this.database.query<DbRow>(
          `SELECT bi.id, bi.version, bi.state
         FROM transcription_batch_items bi
         WHERE bi.id = $1 AND bi.catalog_video_id = $2 FOR UPDATE`,
          [current.batch_item_id, videoId],
        );
        if (
          !batchItem.rows[0] ||
          Number(batchItem.rows[0].version) !==
            Number(current.batch_item_version) ||
          !["needs_language_confirmation", "blocked"].includes(
            String(batchItem.rows[0].state),
          )
        ) {
          throw new CatalogConflictError(
            "The selected batch item changed; restart the timed import.",
          );
        }
        await this.database.query(
          `INSERT INTO transcript_versions
           (id, project_id, video_id, lineage_id, version, schema_version,
            source_language, target_language, timing_precision,
            manifest_object_key, manifest_object_version_id, manifest_sha256,
            idempotency_key, finalized_at, created_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 'en', 'cue', $7, $8, $9,
                 $10, $11, $11)`,
          [
            transcriptVersionId,
            projectId,
            videoId,
            importId,
            normalized.original.track.schemaVersion,
            sourceLanguage,
            manifestObject.key,
            manifestObject.versionId,
            manifestObject.sha256,
            `manual-import:${importId}`,
            finalizedAt,
          ],
        );
        for (const artifact of [
          {
            type: "manifest" as const,
            objectKey: manifestObject.key,
            objectVersionId: manifestObject.versionId,
            byteSize: manifestObject.bytes.byteLength,
            sha256: manifestObject.sha256,
          },
          ...artifacts,
        ]) {
          await this.database.query(
            `INSERT INTO transcript_artifacts
             (transcript_version_id, artifact_type, object_key, object_version_id,
              byte_size, sha256) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              transcriptVersionId,
              artifact.type,
              artifact.objectKey,
              artifact.objectVersionId,
              artifact.byteSize,
              artifact.sha256,
            ],
          );
        }
        await this.database.query(
          `INSERT INTO manual_timed_transcript_candidates
           (id, import_id, project_id, video_id, transcript_version_id,
            language_decision_id, language_decision_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            candidateId,
            importId,
            projectId,
            videoId,
            transcriptVersionId,
            current.language_decision_id,
            current.language_decision_version,
            finalizedAt,
          ],
        );
        await this.database.query(
          `UPDATE manual_timed_transcript_imports
         SET state = 'finalized', finalization_token = NULL,
             finalization_started_at = NULL, finalized_at = $1,
             version = version + 1
         WHERE id = $2`,
          [finalizedAt, importId],
        );
        await this.database.query(
          `UPDATE transcription_batch_items
         SET state = 'ready_for_review', manual_timed_transcript_candidate_id = $1,
             error_code = NULL, error_message = NULL, error_retryable = NULL,
             version = version + 1, updated_at = $2
         WHERE id = $3`,
          [candidateId, finalizedAt, current.batch_item_id],
        );
        const finalizedBatch = await this.database.query<DbRow>(
          "SELECT batch_id FROM transcription_batch_items WHERE id = $1",
          [current.batch_item_id],
        );
        if (finalizedBatch.rows[0]) {
          await this.emitTranscriptionNotificationsForBatch(
            String(finalizedBatch.rows[0].batch_id),
            finalizedAt,
          );
        }
        await this.database.query(
          `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload)
         VALUES ($1, 'transcript.candidate_finalized', $2, 1, $3)`,
          [projectId, candidateId, JSON.stringify({ videoId })],
        );
      });
    } catch (error) {
      await this.database.query(
        `UPDATE manual_timed_transcript_imports
         SET state = 'staged', finalize_idempotency_key = NULL,
             finalize_request_sha256 = NULL, finalization_token = NULL,
             finalization_started_at = NULL, version = version + 1
         WHERE id = $1 AND state = 'finalizing' AND finalization_token = $2`,
        [importId, claimToken],
      );
      await Promise.allSettled(
        candidateObjects.map((object) =>
          this.store.deleteVersion(object.objectKey, object.objectVersionId),
        ),
      );
      const current = await this.loadManualTimedTranscriptImport(importId);
      if (
        ["staged", "finalizing"].includes(String(current.state)) &&
        new Date(iso(current.expires_at)).getTime() <= this.now().getTime()
      ) {
        await this.expireManualTimedTranscriptImport(current);
      }
      throw error;
    }
    return this.loadManualTimedTranscriptImportStatus(importId);
  }

  async getManualTimedTranscriptImportForBatchItem(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    batchItemId: string,
  ): Promise<ManualTimedTranscriptImportStatus> {
    await this.authorize(actor, projectId, "write");
    const result = await this.database.query<DbRow>(
      `SELECT mi.id
       FROM manual_timed_transcript_imports mi
       LEFT JOIN manual_timed_transcript_candidates candidate
         ON candidate.import_id = mi.id
       WHERE mi.project_id = $1 AND mi.video_id = $2 AND mi.batch_item_id = $3
       ORDER BY (candidate.id IS NOT NULL) DESC, mi.created_at DESC, mi.id DESC
       LIMIT 1`,
      [projectId, videoId, batchItemId],
    );
    if (!result.rows[0]) {
      throw new CatalogNotFoundError("Timed transcript import not found.");
    }
    return this.loadManualTimedTranscriptImportStatus(
      String(result.rows[0].id),
    );
  }

  async reviewManualTimedTranscriptCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    candidateId: string,
    input: ManualTimedTranscriptCandidateReviewQuery,
  ): Promise<ManualTimedTranscriptCandidateReviewPage> {
    // Corrected candidate text is remediation evidence, not a general project
    // transcript read. Compatibility viewers cannot approve the candidate and
    // therefore do not receive this pre-activation review surface.
    await this.authorize(actor, projectId, "write");
    const query = ManualTimedTranscriptCandidateReviewQuerySchema.parse(input);
    const verified = await this.loadVerifiedManualTimedTranscriptCandidate(
      projectId,
      videoId,
      candidateId,
    );
    const cuePage = (transcript: NormalizedTranscript) =>
      transcript.segments
        .slice(query.offset, query.offset + query.limit)
        .map(({ trackId: _trackId, ...cue }) => cue);
    const trackPage = (transcript: NormalizedTranscript) => ({
      trackId: transcript.track.id,
      trackVersion: transcript.track.version,
      language: transcript.track.language,
      kind: transcript.track.kind,
      source: transcript.track.source,
      provider: transcript.track.provider,
      ...(transcript.track.sourceTrackId
        ? { sourceTrackId: transcript.track.sourceTrackId }
        : {}),
      timingPrecision: transcript.track.timingPrecision,
      contentSha256: transcript.track.contentSha256,
      totalCues: transcript.segments.length,
      cues: cuePage(transcript),
    });
    return ManualTimedTranscriptCandidateReviewPageSchema.parse({
      candidateId: verified.row.candidate_id,
      importId: verified.row.import_id,
      transcriptVersionId: verified.row.transcript_version_id,
      projectId,
      catalogVideoId: videoId,
      projectVideoVersion: Number(verified.row.project_video_version),
      languageDecisionId: verified.row.language_decision_id,
      languageDecisionVersion: Number(verified.row.language_decision_version),
      finalizedAt: iso(verified.row.finalized_at),
      offset: query.offset,
      limit: query.limit,
      hasMore:
        verified.original.segments.length > query.offset + query.limit ||
        verified.english.segments.length > query.offset + query.limit,
      original: trackPage(verified.original),
      english: trackPage(verified.english),
    });
  }

  async activateManualTimedTranscriptCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    input: ActivateManualTimedTranscriptCandidateRequest,
  ): Promise<ManualTimedTranscriptActivationStatus> {
    await this.authorize(actor, projectId, "write");
    const command =
      ActivateManualTimedTranscriptCandidateRequestSchema.parse(input);
    const requestSha256 = sha256(
      new TextEncoder().encode(canonicalJson(command)),
    );
    const replay = await this.loadManualTimedTranscriptActivationReplay(
      actor,
      projectId,
      videoId,
      command.idempotencyKey,
      requestSha256,
    );
    if (replay) return replay;

    // Verify every immutable object before entering the pointer transaction.
    // The subsequent row locks revalidate all mutable optimistic snapshots.
    const verified = await this.loadVerifiedManualTimedTranscriptCandidate(
      projectId,
      videoId,
      command.candidateId,
    );
    if (
      String(verified.row.import_id) !== command.importId ||
      String(verified.row.transcript_version_id) !==
        command.transcriptVersionId ||
      String(verified.row.language_decision_id) !==
        command.languageDecisionId ||
      Number(verified.row.language_decision_version) !==
        command.expectedLanguageDecisionVersion
    ) {
      throw new CatalogConflictError(
        "The corrected transcript candidate identity changed; reload before activation.",
      );
    }

    const activationId = randomUUID();
    const activatedAt = this.now().toISOString();
    let status: ManualTimedTranscriptActivationStatus | undefined;
    await this.transaction(async () => {
      const projectVideo = await this.database.query<DbRow>(
        `SELECT pv.version, pv.active_transcript_version_id,
                pv.current_language_decision_id,
                d.decision_version, d.status
         FROM project_videos pv
         LEFT JOIN project_video_language_decisions d
           ON d.id = pv.current_language_decision_id
         WHERE pv.project_id = $1 AND pv.video_id = $2
         FOR UPDATE OF pv`,
        [projectId, videoId],
      );
      const current = projectVideo.rows[0];
      if (!current) throw new CatalogNotFoundError("Project video not found.");

      const replayAfterLock =
        await this.loadManualTimedTranscriptActivationReplay(
          actor,
          projectId,
          videoId,
          command.idempotencyKey,
          requestSha256,
        );
      if (replayAfterLock) {
        status = replayAfterLock;
        return;
      }
      if (
        Number(current.version) !== command.expectedProjectVideoVersion ||
        String(current.current_language_decision_id ?? "") !==
          command.languageDecisionId ||
        Number(current.decision_version ?? 0) !==
          command.expectedLanguageDecisionVersion ||
        current.status !== "confirmed"
      ) {
        throw new CatalogConflictError(
          "The project video or confirmed language decision changed; reload before activation.",
        );
      }
      const candidate = await this.database.query<DbRow>(
        `SELECT candidate.id
         FROM manual_timed_transcript_candidates candidate
         JOIN manual_timed_transcript_imports mi
           ON mi.id = candidate.import_id
         WHERE candidate.id = $1 AND candidate.project_id = $2
           AND candidate.video_id = $3 AND candidate.import_id = $4
           AND candidate.transcript_version_id = $5
           AND candidate.language_decision_id = $6
           AND candidate.language_decision_version = $7
           AND mi.state = 'finalized'
         FOR UPDATE OF candidate`,
        [
          command.candidateId,
          projectId,
          videoId,
          command.importId,
          command.transcriptVersionId,
          command.languageDecisionId,
          command.expectedLanguageDecisionVersion,
        ],
      );
      if (!candidate.rows[0]) {
        throw new CatalogConflictError(
          "The corrected transcript candidate changed; reload before activation.",
        );
      }
      const priorActivation = await this.database.query<DbRow>(
        `SELECT id FROM manual_timed_transcript_activations
         WHERE candidate_id = $1`,
        [command.candidateId],
      );
      if (priorActivation.rows[0]) {
        throw new CatalogIdempotencyConflictError(
          "That corrected transcript candidate was already activated by another command.",
        );
      }
      const resultingProjectVideoVersion = Number(current.version) + 1;
      await this.database.query(
        `UPDATE project_videos
         SET active_transcript_version_id = $1, version = $2, updated_at = $3
         WHERE project_id = $4 AND video_id = $5`,
        [
          command.transcriptVersionId,
          resultingProjectVideoVersion,
          activatedAt,
          projectId,
          videoId,
        ],
      );
      await this.enqueueProjectVideoKeywordScan(
        projectId,
        videoId,
        command.transcriptVersionId,
        activatedAt,
      );
      await this.database.query(
        `INSERT INTO manual_timed_transcript_activations
           (id, project_id, video_id, import_id, candidate_id,
            transcript_version_id, language_decision_id,
            language_decision_version, expected_project_video_version,
            resulting_project_video_version, previous_transcript_version_id,
            actor_id, idempotency_key, request_sha256, activated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15)`,
        [
          activationId,
          projectId,
          videoId,
          command.importId,
          command.candidateId,
          command.transcriptVersionId,
          command.languageDecisionId,
          command.expectedLanguageDecisionVersion,
          command.expectedProjectVideoVersion,
          resultingProjectVideoVersion,
          current.active_transcript_version_id,
          actor.userId,
          command.idempotencyKey,
          requestSha256,
          activatedAt,
        ],
      );
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload)
         VALUES ($1, 'transcript.activated', $2, 1, $3)`,
        [
          projectId,
          command.transcriptVersionId,
          JSON.stringify({
            videoId,
            candidateId: command.candidateId,
            activationId,
          }),
        ],
      );
      status = ManualTimedTranscriptActivationStatusSchema.parse({
        activationId,
        state: "activated",
        projectId,
        catalogVideoId: videoId,
        importId: command.importId,
        candidateId: command.candidateId,
        transcriptVersionId: command.transcriptVersionId,
        languageDecisionId: command.languageDecisionId,
        languageDecisionVersion: command.expectedLanguageDecisionVersion,
        projectVideoVersion: resultingProjectVideoVersion,
        activatedAt,
      });
    });
    if (!status) {
      throw new CatalogConflictError(
        "Corrected transcript activation could not be resolved.",
      );
    }
    return status;
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
      await this.transaction(async () => {
        const activeLease = await this.database.query<DbRow>(
          `SELECT 1 FROM worker_leases
           WHERE job_id = $1 AND worker_id = $2 AND attempt = $3
             AND expires_at > $4
           FOR UPDATE`,
          [jobId, actor.userId, attempt, this.now().toISOString()],
        );
        if (!activeLease.rows[0]) {
          throw new CatalogConflictError(
            "Worker lease is no longer active for this attempt.",
          );
        }
        await this.database.query(
          "UPDATE transcript_uploads SET state = 'staged', expires_at = $1 WHERE id = $2",
          [expiresAt.toISOString(), existing.id],
        );
      });
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
    const inserted = await this.transaction(async () => {
      const activeLease = await this.database.query<DbRow>(
        `SELECT 1 FROM worker_leases
         WHERE job_id = $1 AND worker_id = $2 AND attempt = $3
           AND expires_at > $4
         FOR UPDATE`,
        [jobId, actor.userId, attempt, this.now().toISOString()],
      );
      if (!activeLease.rows[0]) {
        throw new CatalogConflictError(
          "Worker lease is no longer active for this attempt.",
        );
      }
      const created = await this.database.query<DbRow>(
        `INSERT INTO transcript_uploads
           (id, job_id, project_id, video_id, lineage_id, version, state,
            expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'staged', $7, $8, $9)
         ON CONFLICT (job_id) DO NOTHING
         RETURNING id`,
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
      if (!created.rows[0]) return false;
      for (const target of targets) {
        await this.database.query(
          `INSERT INTO transcript_upload_targets
             (upload_id, artifact_type, object_key)
           VALUES ($1, $2, $3)`,
          [uploadId, target.type, target.objectKey],
        );
      }
      return true;
    });
    if (!inserted) {
      return this.createClaimedTranscriptUpload(actor, jobId, attempt, input);
    }
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

  async uploadClaimedTranscriptArtifact(
    actor: AuthenticatedActor,
    jobId: string,
    uploadId: string,
    input: {
      attempt: number;
      type: TranscriptArtifact["type"];
      objectKey: string;
      contentType: "application/json" | "application/x-subrip";
      bytes: Uint8Array;
      sha256: string;
    },
  ): Promise<FinalizedObject> {
    await this.requireRegistered(actor);
    const now = this.now().toISOString();
    const target = await this.database.query<DbRow>(
      `SELECT target.artifact_type, target.object_key
       FROM transcript_uploads upload
       JOIN transcript_upload_targets target ON target.upload_id = upload.id
       JOIN worker_leases lease ON lease.job_id = upload.job_id
       WHERE upload.id = $1 AND upload.job_id = $2
         AND upload.state = 'staged' AND upload.expires_at > $3
         AND target.artifact_type = $4 AND target.object_key = $5
         AND lease.worker_id = $6 AND lease.attempt = $7
         AND lease.expires_at > $3`,
      [
        uploadId,
        jobId,
        now,
        input.type,
        input.objectKey,
        actor.userId,
        input.attempt,
      ],
    );
    if (!target.rows[0]) {
      throw new CatalogConflictError(
        "The claimed transcript upload target or worker lease is no longer active.",
      );
    }
    const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
    if (actualSha256 !== input.sha256) {
      throw new CatalogInvalidRequestError(
        "The transcript artifact checksum does not match its bytes.",
      );
    }
    const stored = await this.store.put({
      key: input.objectKey,
      bytes: input.bytes,
      contentType: input.contentType,
      sha256: input.sha256,
    });
    return FinalizedObjectSchema.parse({
      type: input.type,
      objectKey: stored.key,
      objectVersionId: stored.versionId,
      byteSize: stored.bytes.byteLength,
      sha256: stored.sha256,
    });
  }

  async loadClaimedTranscriptTranslationSource(
    actor: AuthenticatedActor,
    jobId: string,
    input: {
      attempt: number;
      consent: CloudTranslationConsent;
      uploadId: string;
      sourceArtifact: FinalizedObject & { type: "original-normalized" };
      targetLanguage: string;
    },
  ): Promise<NormalizedTranscript> {
    await this.requireActiveWorkerLease(actor, jobId, input.attempt);
    const jobResult = await this.database.query<DbRow>(
      "SELECT project_id, payload FROM jobs WHERE id = $1 AND kind = 'transcription'",
      [jobId],
    );
    const job = jobResult.rows[0];
    if (!job) throw new CatalogNotFoundError("Transcription job not found.");
    const payload = TranscriptionJobPayloadSchema.parse(
      typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload,
    );
    const projectId = String(job.project_id ?? "");
    await this.authorize(actor, projectId, "write");
    if (
      !payload.translationConsent ||
      JSON.stringify(payload.translationConsent) !==
        JSON.stringify(input.consent)
    ) {
      throw new AuthorizationError(
        "This job does not carry the required translation consent.",
      );
    }
    if (!languagesEquivalent(payload.targetLanguage, input.targetLanguage)) {
      throw new CatalogConflictError(
        "Translation target does not match the claimed job.",
      );
    }

    const upload = await this.loadUpload(input.uploadId);
    if (
      String(upload.job_id) !== jobId ||
      String(upload.project_id) !== projectId ||
      String(upload.video_id) !== payload.catalogVideoId ||
      String(upload.state) !== "staged" ||
      new Date(iso(upload.expires_at)).getTime() <= this.now().getTime()
    ) {
      throw new CatalogConflictError(
        "Translation source upload does not match the active claimed job.",
      );
    }
    const targets = await this.loadTargets(input.uploadId);
    if (targets.get("original-normalized") !== input.sourceArtifact.objectKey) {
      throw new TranscriptIntegrityError(
        "Translation source was uploaded outside its grant.",
      );
    }
    const sourceBytes = await this.verifyObject(input.sourceArtifact);
    let sourceValue: unknown;
    try {
      sourceValue = JSON.parse(new TextDecoder().decode(sourceBytes));
    } catch {
      throw new TranscriptIntegrityError(
        "Translation source is not valid JSON.",
      );
    }
    const source = NormalizedTranscriptSchema.parse(sourceValue);
    if (
      source.track.videoId !== payload.youtubeVideoId ||
      source.track.kind !== "original" ||
      languagesEquivalent(source.track.language, input.targetLanguage)
    ) {
      throw new TranscriptIntegrityError(
        "Translation source identity does not match the claimed job.",
      );
    }
    return source;
  }

  async getClaimedTranscriptTranslationPublication(
    actor: AuthenticatedActor,
    jobId: string,
    input: {
      attempt: number;
      uploadId: string;
      sourceArtifact: FinalizedObject & { type: "original-normalized" };
      targetLanguage: string;
    },
  ): Promise<WorkerTranslateTranscriptResponse | undefined> {
    await this.requireActiveWorkerLease(actor, jobId, input.attempt);
    const result = await this.database.query<DbRow>(
      "SELECT payload FROM jobs WHERE id = $1 AND kind = 'transcription'",
      [jobId],
    );
    const payload = jsonRecord(result.rows[0]?.payload);
    const receipt = jsonRecord(payload?.cloudTranslationReceipt);
    if (!receipt) return undefined;
    if (
      receipt.uploadId !== input.uploadId ||
      !sameFinalizedObject(
        FinalizedObjectSchema.parse(receipt.sourceArtifact),
        input.sourceArtifact,
      ) ||
      !languagesEquivalent(
        String(receipt.targetLanguage ?? ""),
        input.targetLanguage,
      )
    ) {
      throw new CatalogConflictError(
        "The claimed job already has a different cloud translation result.",
      );
    }
    const normalizedArtifact = FinalizedObjectSchema.extend({
      type: FinalizedObjectSchema.shape.type.extract(["english-normalized"]),
    }).parse(receipt.normalizedArtifact);
    const subtitleArtifact = FinalizedObjectSchema.extend({
      type: FinalizedObjectSchema.shape.type.extract(["english-srt"]),
    }).parse(receipt.subtitleArtifact);
    const normalizedBytes = await this.verifyObject(normalizedArtifact);
    await this.verifyObject(subtitleArtifact);
    let transcriptValue: unknown;
    try {
      transcriptValue = JSON.parse(new TextDecoder().decode(normalizedBytes));
    } catch {
      throw new TranscriptIntegrityError(
        "Cloud translation result is not valid JSON.",
      );
    }
    return WorkerTranslateTranscriptResponseSchema.parse({
      transcript: transcriptValue,
      normalizedArtifact,
      subtitleArtifact,
    });
  }

  async publishClaimedTranscriptTranslation(
    actor: AuthenticatedActor,
    jobId: string,
    input: {
      attempt: number;
      consent: CloudTranslationConsent;
      uploadId: string;
      sourceArtifact: FinalizedObject & { type: "original-normalized" };
      targetLanguage: string;
      transcript: NormalizedTranscript;
      subtitleBytes: Uint8Array;
    },
  ): Promise<WorkerTranslateTranscriptResponse> {
    const source = await this.loadClaimedTranscriptTranslationSource(
      actor,
      jobId,
      input,
    );
    const transcript = NormalizedTranscriptSchema.parse(input.transcript);
    if (
      transcript.track.kind !== "english" ||
      transcript.track.provider !== "amazon-translate" ||
      transcript.track.sourceTrackId !== source.track.id ||
      transcript.track.videoId !== source.track.videoId ||
      !languagesEquivalent(transcript.track.language, input.targetLanguage)
    ) {
      throw new TranscriptIntegrityError(
        "Cloud translation output does not match its verified source.",
      );
    }
    const existing = await this.getClaimedTranscriptTranslationPublication(
      actor,
      jobId,
      {
        attempt: input.attempt,
        uploadId: input.uploadId,
        sourceArtifact: input.sourceArtifact,
        targetLanguage: input.targetLanguage,
      },
    );
    if (existing) return existing;

    const targets = await this.loadTargets(input.uploadId);
    const normalizedKey = targets.get("english-normalized");
    const subtitleKey = targets.get("english-srt");
    if (!normalizedKey || !subtitleKey) {
      throw new TranscriptIntegrityError(
        "Transcript upload grant omitted cloud translation targets.",
      );
    }
    const normalizedBytes = new TextEncoder().encode(
      JSON.stringify(transcript),
    );
    const normalizedStored = await this.store.put({
      key: normalizedKey,
      bytes: normalizedBytes,
      contentType: "application/json",
      sha256: sha256(normalizedBytes),
    });
    const subtitleStored = await this.store.put({
      key: subtitleKey,
      bytes: input.subtitleBytes,
      contentType: "application/x-subrip",
      sha256: sha256(input.subtitleBytes),
    });
    const normalizedArtifact = FinalizedObjectSchema.parse({
      type: "english-normalized",
      objectKey: normalizedStored.key,
      objectVersionId: normalizedStored.versionId,
      byteSize: normalizedStored.bytes.byteLength,
      sha256: normalizedStored.sha256,
    });
    const subtitleArtifact = FinalizedObjectSchema.parse({
      type: "english-srt",
      objectKey: subtitleStored.key,
      objectVersionId: subtitleStored.versionId,
      byteSize: subtitleStored.bytes.byteLength,
      sha256: subtitleStored.sha256,
    });
    const receipt = {
      uploadId: input.uploadId,
      sourceArtifact: input.sourceArtifact,
      targetLanguage: input.targetLanguage,
      normalizedArtifact,
      subtitleArtifact,
    };
    const stored = await this.database.query<DbRow>(
      `UPDATE jobs
       SET payload = payload || jsonb_build_object(
             'cloudTranslationReceipt', $1::jsonb
           ),
           updated_at = $2
       WHERE id = $3 AND payload->'cloudTranslationReceipt' IS NULL
       RETURNING id`,
      [JSON.stringify(receipt), this.now().toISOString(), jobId],
    );
    if (!stored.rows[0]) {
      const winner = await this.getClaimedTranscriptTranslationPublication(
        actor,
        jobId,
        {
          attempt: input.attempt,
          uploadId: input.uploadId,
          sourceArtifact: input.sourceArtifact,
          targetLanguage: input.targetLanguage,
        },
      );
      if (!winner) {
        throw new CatalogConflictError(
          "Cloud translation publication could not be resolved.",
        );
      }
      return winner;
    }
    return WorkerTranslateTranscriptResponseSchema.parse({
      transcript,
      normalizedArtifact,
      subtitleArtifact,
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
    if (claim) {
      const jobResult = await this.database.query<DbRow>(
        "SELECT payload FROM jobs WHERE id = $1 AND kind = 'transcription'",
        [claim.jobId],
      );
      const jobPayload = jsonRecord(jobResult.rows[0]?.payload);
      const parsedJobPayload =
        TranscriptionJobPayloadSchema.safeParse(jobPayload);
      if (
        parsedJobPayload.success &&
        (parsedJobPayload.data.languageDecision || manifest.languageDecision) &&
        canonicalJson(parsedJobPayload.data.languageDecision ?? null) !==
          canonicalJson(manifest.languageDecision ?? null)
      ) {
        throw new TranscriptIntegrityError(
          "Transcript manifest language decision does not match the claimed job.",
        );
      }
      if (
        parsedJobPayload.success &&
        parsedJobPayload.data.languageDecision?.status === "confirmed" &&
        parsedJobPayload.data.languageDecision.resolvedLanguage !== undefined &&
        !languagesEquivalent(
          manifest.sourceLanguage,
          parsedJobPayload.data.languageDecision.resolvedLanguage,
        )
      ) {
        throw new TranscriptIntegrityError(
          "Transcript source language does not match the confirmed job decision.",
        );
      }
      if (
        jobPayload?.translationConsent &&
        !languagesEquivalent(manifest.sourceLanguage, manifest.targetLanguage)
      ) {
        const receipt = jsonRecord(jobPayload.cloudTranslationReceipt);
        const sourceReceipt = FinalizedObjectSchema.safeParse(
          receipt?.sourceArtifact,
        );
        const normalizedReceipt = FinalizedObjectSchema.safeParse(
          receipt?.normalizedArtifact,
        );
        const subtitleReceipt = FinalizedObjectSchema.safeParse(
          receipt?.subtitleArtifact,
        );
        const normalizedManifest = manifest.artifacts.find(
          (artifact) => artifact.type === "english-normalized",
        );
        const sourceManifest = manifest.artifacts.find(
          (artifact) => artifact.type === "original-normalized",
        );
        const subtitleManifest = manifest.artifacts.find(
          (artifact) => artifact.type === "english-srt",
        );
        if (
          receipt?.uploadId !== request.uploadId ||
          !languagesEquivalent(
            String(receipt?.targetLanguage ?? ""),
            manifest.targetLanguage,
          ) ||
          !sourceReceipt.success ||
          sourceReceipt.data.type !== "original-normalized" ||
          !normalizedReceipt.success ||
          normalizedReceipt.data.type !== "english-normalized" ||
          !subtitleReceipt.success ||
          subtitleReceipt.data.type !== "english-srt" ||
          !sourceManifest ||
          !normalizedManifest ||
          !subtitleManifest ||
          !sameFinalizedObject(sourceReceipt.data, sourceManifest) ||
          !sameFinalizedObject(normalizedReceipt.data, normalizedManifest) ||
          !sameFinalizedObject(subtitleReceipt.data, subtitleManifest)
        ) {
          throw new TranscriptIntegrityError(
            "Translated artifacts do not match the server-produced result.",
          );
        }
        const decodeTranscript = async (artifact: FinalizedObject) => {
          const bytes = await this.verifyObject(artifact);
          try {
            return NormalizedTranscriptSchema.parse(
              JSON.parse(new TextDecoder().decode(bytes)),
            );
          } catch {
            throw new TranscriptIntegrityError(
              "Server-bound transcript artifact is invalid.",
            );
          }
        };
        const source = await decodeTranscript(sourceReceipt.data);
        const translated = await decodeTranscript(normalizedReceipt.data);
        if (
          source.track.kind !== "original" ||
          source.track.videoId !== manifest.videoId ||
          !languagesEquivalent(
            source.track.language,
            manifest.sourceLanguage,
          ) ||
          source.track.provider !== manifest.provider ||
          translated.track.kind !== "english" ||
          translated.track.provider !== "amazon-translate" ||
          translated.track.sourceTrackId !== source.track.id ||
          translated.track.videoId !== manifest.videoId ||
          !languagesEquivalent(
            translated.track.language,
            manifest.targetLanguage,
          ) ||
          translated.track.timingPrecision !== manifest.timingPrecision ||
          translated.track.schemaVersion !== manifest.normalizationSchemaVersion
        ) {
          throw new TranscriptIntegrityError(
            "Transcript manifest metadata does not match the server-produced result.",
          );
        }
      }
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
      await this.enqueueProjectVideoKeywordScan(
        manifest.projectId,
        manifest.catalogVideoId,
        manifest.id,
        this.now().toISOString(),
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
           WHERE job_id = $3 AND attempt = $4
             AND state NOT IN ('canceling', 'canceled')`,
          [manifest.id, this.now().toISOString(), claim.jobId, claim.attempt],
        );
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'canceled', version = version + 1, updated_at = $1
           WHERE job_id = $2 AND attempt = $3 AND state = 'canceling'`,
          [this.now().toISOString(), claim.jobId, claim.attempt],
        );
        await this.database.query(
          `UPDATE transcription_job_cancel_requests SET completed_at = $1
           WHERE job_id = $2 AND revoked_at IS NULL AND completed_at IS NULL`,
          [this.now().toISOString(), claim.jobId],
        );
        const completedBatches = await this.database.query<DbRow>(
          "SELECT DISTINCT batch_id FROM transcription_batch_items WHERE job_id = $1",
          [claim.jobId],
        );
        for (const batch of completedBatches.rows) {
          await this.emitTranscriptionNotificationsForBatch(
            String(batch.batch_id),
            this.now().toISOString(),
          );
        }
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
      `SELECT active_transcript_version_id
       FROM project_videos
       WHERE project_id = $1 AND video_id = $2`,
      [projectId, catalogVideoId],
    );
    const row = result.rows[0];
    if (!row?.active_transcript_version_id) {
      throw new CatalogNotFoundError("No active transcript found.");
    }
    return this.loadTranscriptBundleByVersion(
      projectId,
      catalogVideoId,
      String(row.active_transcript_version_id),
    );
  }

  async getActiveTranscriptArtifact(
    actor: AuthenticatedActor,
    projectId: string,
    catalogVideoId: string,
    transcriptVersionId: string,
    artifactType: TranscriptArtifact["type"],
  ): Promise<StoredObject> {
    const bundle = await this.getActiveTranscript(
      actor,
      projectId,
      catalogVideoId,
    );
    if (bundle.transcriptVersionId !== transcriptVersionId) {
      throw new CatalogNotFoundError("Transcript version is not active.");
    }
    const descriptor = bundle.downloads.find(
      (candidate) => candidate.type === artifactType,
    );
    if (!descriptor) {
      throw new CatalogNotFoundError("Transcript artifact not found.");
    }
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
        "Transcript artifact does not match its active descriptor.",
      );
    }
    return object;
  }

  private async loadTranscriptBundleByVersion(
    projectId: string,
    catalogVideoId: string,
    transcriptVersionId: string,
  ): Promise<ActiveTranscriptBundle> {
    const result = await this.database.query<DbRow>(
      `SELECT tv.id, tv.manifest_object_key, tv.manifest_object_version_id,
              tv.manifest_sha256, ta.byte_size
       FROM transcript_versions tv
       JOIN transcript_artifacts ta
         ON ta.transcript_version_id = tv.id AND ta.artifact_type = 'manifest'
       WHERE tv.project_id = $1 AND tv.video_id = $2 AND tv.id = $3`,
      [projectId, catalogVideoId, transcriptVersionId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Transcript version not found.");
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
    if (
      manifest.id !== transcriptVersionId ||
      manifest.projectId !== projectId ||
      manifest.catalogVideoId !== catalogVideoId
    ) {
      throw new TranscriptIntegrityError(
        "Transcript manifest identity does not match its catalog version.",
      );
    }
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
      transcriptVersionId,
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

  private async verifyObjectBounded(
    descriptor: {
      objectKey: string;
      objectVersionId: string;
      byteSize: number;
      sha256: string;
    },
    maxBytes: number,
  ): Promise<Uint8Array> {
    if (descriptor.byteSize > maxBytes) {
      throw new TranscriptIntegrityError(
        "Corrected transcript candidate exceeds its review limit.",
      );
    }
    let object;
    try {
      object = await this.store.getBounded(
        descriptor.objectKey,
        descriptor.objectVersionId,
        maxBytes,
      );
    } catch {
      throw new TranscriptIntegrityError(
        "Corrected transcript candidate object verification failed.",
      );
    }
    if (
      !object ||
      object.bytes.byteLength !== descriptor.byteSize ||
      sha256(object.bytes) !== descriptor.sha256
    ) {
      throw new TranscriptIntegrityError(
        "Corrected transcript candidate object verification failed.",
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

  private async loadManualTimedTranscriptImport(
    importId: string,
  ): Promise<DbRow> {
    const result = await this.database.query<DbRow>(
      "SELECT * FROM manual_timed_transcript_imports WHERE id = $1",
      [importId],
    );
    if (!result.rows[0]) {
      throw new CatalogNotFoundError("Timed transcript import not found.");
    }
    return result.rows[0];
  }

  private async loadManualTimedTranscriptActivationReplay(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    idempotencyKey: string,
    requestSha256: string,
  ): Promise<ManualTimedTranscriptActivationStatus | undefined> {
    const result = await this.database.query<DbRow>(
      `SELECT activation.*, pv.active_transcript_version_id
       FROM manual_timed_transcript_activations activation
       JOIN project_videos pv
         ON pv.project_id = activation.project_id
        AND pv.video_id = activation.video_id
       WHERE activation.project_id = $1 AND activation.video_id = $2
         AND activation.actor_id = $3 AND activation.idempotency_key = $4`,
      [projectId, videoId, actor.userId, idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (String(row.request_sha256) !== requestSha256) {
      throw new CatalogIdempotencyConflictError(
        "That corrected transcript activation key was already used for different input.",
      );
    }
    return ManualTimedTranscriptActivationStatusSchema.parse({
      activationId: row.id,
      state:
        String(row.active_transcript_version_id ?? "") ===
        String(row.transcript_version_id)
          ? "activated"
          : "superseded",
      projectId: row.project_id,
      catalogVideoId: row.video_id,
      importId: row.import_id,
      candidateId: row.candidate_id,
      transcriptVersionId: row.transcript_version_id,
      languageDecisionId: row.language_decision_id,
      languageDecisionVersion: Number(row.language_decision_version),
      projectVideoVersion: Number(row.resulting_project_video_version),
      activatedAt: iso(row.activated_at),
    });
  }

  private async loadVerifiedManualTimedTranscriptCandidate(
    projectId: string,
    videoId: string,
    candidateId: string,
  ): Promise<{
    row: DbRow;
    manifest: ReturnType<typeof TranscriptManifestSchema.parse>;
    original: NormalizedTranscript;
    english: NormalizedTranscript;
  }> {
    const result = await this.database.query<DbRow>(
      `SELECT candidate.id AS candidate_id, candidate.import_id,
              candidate.transcript_version_id,
              candidate.language_decision_id,
              candidate.language_decision_version,
              candidate.created_at AS finalized_at,
              mi.state AS import_state,
              pv.version AS project_video_version,
              pv.current_language_decision_id,
              decision.decision_version AS current_decision_version,
              decision.status AS current_decision_status,
              tv.manifest_object_key, tv.manifest_object_version_id,
              tv.manifest_sha256,
              manifest_artifact.byte_size AS manifest_byte_size,
              original_artifact.object_key AS original_object_key,
              original_artifact.object_version_id AS original_object_version_id,
              original_artifact.byte_size AS original_byte_size,
              original_artifact.sha256 AS original_sha256,
              english_artifact.object_key AS english_object_key,
              english_artifact.object_version_id AS english_object_version_id,
              english_artifact.byte_size AS english_byte_size,
              english_artifact.sha256 AS english_sha256
       FROM manual_timed_transcript_candidates candidate
       JOIN manual_timed_transcript_imports mi ON mi.id = candidate.import_id
       JOIN project_videos pv
         ON pv.project_id = candidate.project_id AND pv.video_id = candidate.video_id
       LEFT JOIN project_video_language_decisions decision
         ON decision.id = pv.current_language_decision_id
       JOIN transcript_versions tv ON tv.id = candidate.transcript_version_id
       JOIN transcript_artifacts manifest_artifact
         ON manifest_artifact.transcript_version_id = tv.id
        AND manifest_artifact.artifact_type = 'manifest'
       JOIN transcript_artifacts original_artifact
         ON original_artifact.transcript_version_id = tv.id
        AND original_artifact.artifact_type = 'original-normalized'
       JOIN transcript_artifacts english_artifact
         ON english_artifact.transcript_version_id = tv.id
        AND english_artifact.artifact_type = 'english-normalized'
       WHERE candidate.id = $1 AND candidate.project_id = $2
         AND candidate.video_id = $3`,
      [candidateId, projectId, videoId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new CatalogNotFoundError(
        "Corrected transcript candidate not found.",
      );
    }
    if (
      row.import_state !== "finalized" ||
      String(row.current_language_decision_id ?? "") !==
        String(row.language_decision_id) ||
      Number(row.current_decision_version ?? 0) !==
        Number(row.language_decision_version) ||
      row.current_decision_status !== "confirmed"
    ) {
      throw new CatalogConflictError(
        "The corrected transcript candidate no longer matches the confirmed language decision.",
      );
    }
    const manifestDescriptor = FinalizedObjectSchema.parse({
      type: "manifest",
      objectKey: row.manifest_object_key,
      objectVersionId: row.manifest_object_version_id,
      byteSize: Number(row.manifest_byte_size),
      sha256: row.manifest_sha256,
    });
    const originalDescriptor = FinalizedObjectSchema.parse({
      type: "original-normalized",
      objectKey: row.original_object_key,
      objectVersionId: row.original_object_version_id,
      byteSize: Number(row.original_byte_size),
      sha256: row.original_sha256,
    });
    const englishDescriptor = FinalizedObjectSchema.parse({
      type: "english-normalized",
      objectKey: row.english_object_key,
      objectVersionId: row.english_object_version_id,
      byteSize: Number(row.english_byte_size),
      sha256: row.english_sha256,
    });
    const [manifestBytes, originalBytes, englishBytes] = await Promise.all([
      this.verifyObjectBounded(manifestDescriptor, 2 * 1024 * 1024),
      this.verifyObjectBounded(originalDescriptor, 20 * 1024 * 1024),
      this.verifyObjectBounded(englishDescriptor, 20 * 1024 * 1024),
    ]);
    let manifest: ReturnType<typeof TranscriptManifestSchema.parse>;
    let original: NormalizedTranscript;
    let english: NormalizedTranscript;
    try {
      manifest = TranscriptManifestSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
        ),
      );
      original = NormalizedTranscriptSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(originalBytes),
        ),
      );
      english = NormalizedTranscriptSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(englishBytes),
        ),
      );
    } catch {
      throw new TranscriptIntegrityError(
        "Corrected transcript candidate content is invalid.",
      );
    }
    const manifestOriginal = manifest.artifacts.find(
      (artifact) => artifact.type === "original-normalized",
    );
    const manifestEnglish = manifest.artifacts.find(
      (artifact) => artifact.type === "english-normalized",
    );
    if (
      manifest.id !== String(row.transcript_version_id) ||
      manifest.projectId !== projectId ||
      manifest.catalogVideoId !== videoId ||
      manifest.manualImportId !== String(row.import_id) ||
      manifest.languageDecision?.decisionId !==
        String(row.language_decision_id) ||
      manifest.languageDecision?.decisionVersion !==
        Number(row.language_decision_version) ||
      manifest.languageDecision?.status !== "confirmed" ||
      !manifestOriginal ||
      !manifestEnglish ||
      !sameFinalizedObject(originalDescriptor, manifestOriginal) ||
      !sameFinalizedObject(englishDescriptor, manifestEnglish) ||
      original.track.kind !== "original" ||
      original.track.source !== "manual-import" ||
      original.track.timingPrecision !== "cue" ||
      english.track.kind !== "english" ||
      english.track.source !== "manual-import" ||
      english.track.language !== "en" ||
      english.track.timingPrecision !== "cue" ||
      english.track.sourceTrackId !== original.track.id ||
      original.segments.some(
        (segment, index) =>
          segment.trackId !== original.track.id || segment.ordinal !== index,
      ) ||
      english.segments.some(
        (segment, index) =>
          segment.trackId !== english.track.id || segment.ordinal !== index,
      )
    ) {
      throw new TranscriptIntegrityError(
        "Corrected transcript candidate identity is inconsistent.",
      );
    }
    return { row, manifest, original, english };
  }

  private async loadManualTimedTranscriptImportTargets(
    importId: string,
  ): Promise<Map<string, string>> {
    const result = await this.database.query<DbRow>(
      `SELECT role, object_key FROM manual_timed_transcript_import_targets
       WHERE import_id = $1`,
      [importId],
    );
    const targets = new Map(
      result.rows.map((row) => [String(row.role), String(row.object_key)]),
    );
    if (
      !targets.has("original") ||
      !targets.has("english") ||
      targets.size !== 2
    ) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_target_invalid",
      );
    }
    return targets;
  }

  private async loadManualImportSourceLanguage(
    importRow: DbRow,
  ): Promise<string> {
    const result = await this.database.query<DbRow>(
      `SELECT resolved_language, status, decision_version
       FROM project_video_language_decisions
       WHERE id = $1 AND project_id = $2 AND video_id = $3`,
      [
        importRow.language_decision_id,
        importRow.project_id,
        importRow.video_id,
      ],
    );
    const decision = result.rows[0];
    if (
      !decision ||
      decision.status !== "confirmed" ||
      Number(decision.decision_version) !==
        Number(importRow.language_decision_version) ||
      !isImportableSourceLanguage(decision.resolved_language)
    ) {
      throw new CatalogConflictError(
        "The confirmed source-language decision is no longer valid for this import.",
      );
    }
    return String(decision.resolved_language);
  }

  private async loadManualImportDecisionBasis(importRow: DbRow) {
    const result = await this.database.query<DbRow>(
      `SELECT basis, status, resolved_language, decision_version
       FROM project_video_language_decisions
       WHERE id = $1 AND project_id = $2 AND video_id = $3`,
      [
        importRow.language_decision_id,
        importRow.project_id,
        importRow.video_id,
      ],
    );
    const decision = result.rows[0];
    if (
      !decision ||
      decision.status !== "confirmed" ||
      Number(decision.decision_version) !==
        Number(importRow.language_decision_version) ||
      !isImportableSourceLanguage(decision.resolved_language)
    ) {
      throw new CatalogConflictError(
        "The confirmed source-language decision is no longer valid for this import.",
      );
    }
    return decision.basis;
  }

  private async issueManualTimedTranscriptImportGrant(
    importRow: DbRow,
    sourceLanguage: string,
  ): Promise<ManualTimedTranscriptImportUploadGrant> {
    if (String(importRow.state) !== "staged") {
      throw new CatalogConflictError(
        "Timed transcript import is already finalized.",
      );
    }
    if (new Date(iso(importRow.expires_at)).getTime() <= this.now().getTime()) {
      throw new CatalogConflictError(
        "Timed transcript import grant has expired.",
      );
    }
    const targets = await this.loadManualTimedTranscriptImportTargets(
      String(importRow.id),
    );
    return ManualTimedTranscriptImportUploadGrantSchema.parse({
      importId: importRow.id,
      projectId: importRow.project_id,
      catalogVideoId: importRow.video_id,
      batchItemId: importRow.batch_item_id,
      sourceLanguage,
      languageDecisionId: importRow.language_decision_id,
      languageDecisionVersion: Number(importRow.language_decision_version),
      expiresAt: iso(importRow.expires_at),
      targets: await Promise.all(
        (["original", "english"] as const).map(async (role) => ({
          role,
          format:
            role === "original"
              ? importRow.original_format
              : importRow.english_format,
          objectKey: targets.get(role)!,
          uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
            objectKey: targets.get(role)!,
            expiresInSeconds: 15 * 60,
          }),
        })),
      ),
    });
  }

  private async loadManualTimedTranscriptImportObject(
    objectKey: string | undefined,
    receipt: { objectVersionId: string; byteSize: number; sha256: string },
    expectedByteSize: unknown,
    expectedSha256: unknown,
  ) {
    if (
      !objectKey ||
      receipt.byteSize !== Number(expectedByteSize) ||
      receipt.sha256 !== String(expectedSha256)
    ) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_object_invalid",
      );
    }
    let object;
    try {
      object = await this.store.getBounded(
        objectKey,
        receipt.objectVersionId,
        receipt.byteSize,
      );
    } catch {
      throw new ManualTimedTranscriptImportError(
        "manual_import_object_invalid",
      );
    }
    if (
      !object ||
      object.versionId !== receipt.objectVersionId ||
      object.bytes.byteLength !== receipt.byteSize ||
      sha256(object.bytes) !== receipt.sha256
    ) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_object_invalid",
      );
    }
    return object;
  }

  private manualTimedImportStoredReceipt(
    importRow: DbRow,
    role: "original" | "english",
  ) {
    const objectVersionId = String(
      role === "original"
        ? (importRow.original_object_version_id ?? "")
        : (importRow.english_object_version_id ?? ""),
    );
    if (!objectVersionId) {
      throw new ManualTimedTranscriptImportError(
        "manual_import_object_invalid",
      );
    }
    return {
      objectVersionId,
      byteSize: Number(
        role === "original"
          ? importRow.original_byte_size
          : importRow.english_byte_size,
      ),
      sha256: String(
        role === "original"
          ? importRow.original_sha256
          : importRow.english_sha256,
      ),
    };
  }

  private async expireManualTimedTranscriptImport(importRow: DbRow) {
    const expired = await this.database.query<DbRow>(
      `UPDATE manual_timed_transcript_imports
       SET state = 'expired', finalization_token = NULL,
           finalization_started_at = NULL, version = version + 1
       WHERE id = $1 AND state IN ('staged', 'finalizing')
         AND version = $2 AND expires_at <= $3
       RETURNING original_object_version_id, english_object_version_id`,
      [importRow.id, importRow.version, this.now().toISOString()],
    );
    const row = expired.rows[0];
    if (!row) return;
    const targets = await this.loadManualTimedTranscriptImportTargets(
      String(importRow.id),
    );
    await Promise.all(
      (["original", "english"] as const).map(async (role) => {
        const versionId =
          role === "original"
            ? row.original_object_version_id
            : row.english_object_version_id;
        const objectKey = targets.get(role);
        if (objectKey && versionId) {
          await this.store.deleteVersion(objectKey, String(versionId));
        }
      }),
    );
  }

  private async loadYoutubeVideoId(catalogVideoId: string): Promise<string> {
    const result = await this.database.query<DbRow>(
      "SELECT youtube_video_id FROM videos WHERE id = $1",
      [catalogVideoId],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("Project video not found.");
    return String(result.rows[0].youtube_video_id);
  }

  private async storeManualTimedTranscriptCandidateArtifacts(
    prefix: string,
    normalized: Awaited<ReturnType<typeof normalizeManualTimedBilingualImport>>,
    onStored: (artifact: {
      objectKey: string;
      objectVersionId: string;
    }) => void,
  ) {
    const values = [
      {
        type: "original-normalized" as const,
        suffix: "original.normalized.json",
        bytes: new TextEncoder().encode(JSON.stringify(normalized.original)),
        contentType: "application/json",
      },
      {
        type: "english-normalized" as const,
        suffix: "english.normalized.json",
        bytes: new TextEncoder().encode(JSON.stringify(normalized.english)),
        contentType: "application/json",
      },
      {
        type: "original-srt" as const,
        suffix: "original.srt",
        bytes: new TextEncoder().encode(normalized.originalSrt),
        contentType: "application/x-subrip",
      },
      {
        type: "english-srt" as const,
        suffix: "english.srt",
        bytes: new TextEncoder().encode(normalized.englishSrt),
        contentType: "application/x-subrip",
      },
    ];
    const artifacts: Array<{
      type: (typeof values)[number]["type"];
      objectKey: string;
      objectVersionId: string;
      byteSize: number;
      sha256: string;
    }> = [];
    for (const value of values) {
      const object = await this.store.put({
        key: `${prefix}/${value.suffix}`,
        bytes: value.bytes,
        contentType: value.contentType,
        sha256: sha256(value.bytes),
      });
      const artifact = {
        type: value.type,
        objectKey: object.key,
        objectVersionId: object.versionId,
        byteSize: object.bytes.byteLength,
        sha256: object.sha256,
      };
      onStored(artifact);
      artifacts.push(artifact);
    }
    return artifacts;
  }

  private async loadManualTimedTranscriptImportStatus(
    importId: string,
  ): Promise<ManualTimedTranscriptImportStatus> {
    const importRow = await this.loadManualTimedTranscriptImport(importId);
    if (
      ["staged", "finalizing"].includes(String(importRow.state)) &&
      new Date(iso(importRow.expires_at)).getTime() <= this.now().getTime()
    ) {
      await this.expireManualTimedTranscriptImport(importRow);
    }
    const result = await this.database.query<DbRow>(
      `SELECT mi.*, d.resolved_language,
              candidate.id AS candidate_id,
              candidate.transcript_version_id,
              candidate.created_at AS candidate_created_at
       FROM manual_timed_transcript_imports mi
       JOIN project_video_language_decisions d
         ON d.id = mi.language_decision_id
        AND d.project_id = mi.project_id AND d.video_id = mi.video_id
       LEFT JOIN manual_timed_transcript_candidates candidate
         ON candidate.import_id = mi.id
       WHERE mi.id = $1`,
      [importId],
    );
    const row = result.rows[0];
    if (!row)
      throw new CatalogNotFoundError("Timed transcript import not found.");
    return ManualTimedTranscriptImportStatusSchema.parse({
      importId: row.id,
      projectId: row.project_id,
      catalogVideoId: row.video_id,
      batchItemId: row.batch_item_id,
      state: row.state,
      version: Number(row.version),
      sourceLanguage: row.resolved_language,
      targetLanguage: "en",
      languageDecisionId: row.language_decision_id,
      languageDecisionVersion: Number(row.language_decision_version),
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      ...(row.candidate_id
        ? {
            candidate: {
              candidateId: row.candidate_id,
              transcriptVersionId: row.transcript_version_id,
              timingPrecision: "cue",
              finalizedAt: iso(row.candidate_created_at),
            },
          }
        : {}),
    });
  }

  private async loadProjectVideoLanguageGate(
    projectId: string,
    videoId: string,
  ): Promise<LanguageGate> {
    const result = await this.database.query<DbRow>(
      `SELECT pv.language_gate_status, v.source_language AS creator_reported_language,
              e.id AS evidence_id, e.project_id AS evidence_project_id,
              e.video_id AS evidence_video_id, e.source AS evidence_source,
              e.provider AS evidence_provider,
              e.reported_language AS evidence_reported_language,
              e.track_fingerprint AS evidence_track_fingerprint,
              e.caption_kind AS evidence_caption_kind, e.job_id AS evidence_job_id,
              e.attempt AS evidence_attempt, e.created_at AS evidence_created_at,
              d.id AS decision_id, d.project_id AS decision_project_id,
              d.video_id AS decision_video_id,
              d.decision_version AS decision_version, d.status AS decision_status,
              d.basis AS decision_basis, d.resolved_language AS decision_resolved_language,
              d.evidence_id AS decision_evidence_id, d.actor_id AS decision_actor_id,
              d.created_at AS decision_created_at
       FROM project_videos pv
       JOIN videos v ON v.id = pv.video_id
       LEFT JOIN project_video_language_evidence e
         ON e.id = pv.current_language_evidence_id
       LEFT JOIN project_video_language_decisions d
         ON d.id = pv.current_language_decision_id
       WHERE pv.project_id = $1 AND pv.video_id = $2`,
      [projectId, videoId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Project video not found.");
    const status = String(row.language_gate_status ?? "unverified");
    const creatorReportedLanguage = LanguageTagSchema.safeParse(
      row.creator_reported_language,
    );
    const evidence = row.evidence_id
      ? mapProviderLanguageEvidence({
          id: row.evidence_id,
          project_id: row.evidence_project_id,
          video_id: row.evidence_video_id,
          source: row.evidence_source,
          provider: row.evidence_provider,
          reported_language: row.evidence_reported_language,
          track_fingerprint: row.evidence_track_fingerprint,
          caption_kind: row.evidence_caption_kind,
          job_id: row.evidence_job_id,
          attempt: row.evidence_attempt,
          created_at: row.evidence_created_at,
        })
      : undefined;
    const decision = row.decision_id
      ? mapProjectVideoLanguageDecision({
          id: row.decision_id,
          project_id: row.decision_project_id,
          video_id: row.decision_video_id,
          decision_version: row.decision_version,
          status: row.decision_status,
          basis: row.decision_basis,
          resolved_language: row.decision_resolved_language,
          evidence_id: row.decision_evidence_id,
          actor_id: row.decision_actor_id,
          created_at: row.decision_created_at,
        })
      : undefined;
    const hasKnownLanguage =
      creatorReportedLanguage.success ||
      evidence?.reportedLanguage !== undefined ||
      (decision?.status === "confirmed" &&
        decision.resolvedLanguage !== undefined);
    const state =
      status === "conflict" || !hasKnownLanguage
        ? "needs_language_confirmation"
        : "ready";
    return LanguageGateSchema.parse({
      state,
      status,
      ...(creatorReportedLanguage.success
        ? { creatorReportedLanguage: creatorReportedLanguage.data }
        : {}),
      ...(evidence ? { providerEvidence: evidence } : {}),
      ...(decision ? { decision } : {}),
      remediationReason:
        state === "ready"
          ? "none"
          : status === "conflict"
            ? "resolve_conflict"
            : "confirm_language",
    });
  }

  private async ensureCreatorMetadataLanguageDecision(
    actor: AuthenticatedActor,
    projectId: string,
    videoId: string,
    language: string,
    now: string,
  ): Promise<void> {
    const resolvedLanguage = LanguageTagSchema.parse(language);
    const projectVideo = await this.database.query<DbRow>(
      `SELECT current_language_decision_id
       FROM project_videos
       WHERE project_id = $1 AND video_id = $2
       FOR UPDATE`,
      [projectId, videoId],
    );
    if (!projectVideo.rows[0]) {
      throw new CatalogNotFoundError("Project video not found.");
    }
    const currentDecisionId = projectVideo.rows[0].current_language_decision_id;
    if (currentDecisionId) {
      const current = await this.database.query<DbRow>(
        "SELECT * FROM project_video_language_decisions WHERE id = $1",
        [currentDecisionId],
      );
      const decision = current.rows[0]
        ? mapProjectVideoLanguageDecision(current.rows[0])
        : undefined;
      if (
        decision?.status === "confirmed" ||
        (decision?.status === "unverified" &&
          decision.basis === "creator_metadata" &&
          decision.resolvedLanguage !== undefined &&
          languagesEquivalent(decision.resolvedLanguage, resolvedLanguage))
      ) {
        return;
      }
    }
    const versionResult = await this.database.query<DbRow>(
      `SELECT COALESCE(MAX(decision_version), 0) AS decision_version
       FROM project_video_language_decisions
       WHERE project_id = $1 AND video_id = $2`,
      [projectId, videoId],
    );
    const decisionVersion =
      Number(versionResult.rows[0]?.decision_version ?? 0) + 1;
    const id = randomUUID();
    const idempotencyKey = `creator-metadata:${resolvedLanguage}:v${decisionVersion}`;
    const requestSha256 = createHash("sha256")
      .update(
        canonicalJson({
          projectId,
          videoId,
          decisionVersion,
          status: "unverified",
          basis: "creator_metadata",
          resolvedLanguage,
        }),
      )
      .digest("hex");
    await this.database.query(
      `INSERT INTO project_video_language_decisions
         (id, project_id, video_id, decision_version, status, basis,
          resolved_language, actor_id, idempotency_key, request_sha256,
          created_at)
       VALUES ($1, $2, $3, $4, 'unverified', 'creator_metadata', $5, $6,
               $7, $8, $9)`,
      [
        id,
        projectId,
        videoId,
        decisionVersion,
        resolvedLanguage,
        actor.userId,
        idempotencyKey,
        requestSha256,
        now,
      ],
    );
    await this.database.query(
      `UPDATE project_videos
       SET current_language_decision_id = $1, language_gate_status = 'unverified',
           version = version + 1, updated_at = $2
       WHERE project_id = $3 AND video_id = $4`,
      [id, now, projectId, videoId],
    );
  }

  private async requeueLanguageConfirmedBatchItem(input: {
    actor: AuthenticatedActor;
    projectId: string;
    videoId: string;
    batchItemId: string;
    expectedBatchItemVersion: number;
    decision: LanguageDecisionSnapshot;
    now: string;
  }): Promise<void> {
    const result = await this.database.query<DbRow>(
      `SELECT bi.*, b.target_language, b.transcription_profile, b.source_policy,
              b.execution_location, b.priority, b.translation_provider,
              b.translation_disclosure_version
       FROM transcription_batch_items bi
       JOIN transcription_batches b ON b.id = bi.batch_id
       WHERE bi.id = $1 AND b.project_id = $2 FOR UPDATE OF bi`,
      [input.batchItemId, input.projectId],
    );
    const item = result.rows[0];
    if (!item || String(item.catalog_video_id) !== input.videoId) {
      throw new CatalogNotFoundError(
        "Language-confirmation batch item not found.",
      );
    }
    if (Number(item.version) !== input.expectedBatchItemVersion) {
      throw new CatalogConflictError(
        "The language-confirmation item changed; reload it before retrying.",
      );
    }
    if (item.state !== "needs_language_confirmation") {
      throw new CatalogConflictError(
        "Only language-confirmation items can be explicitly requeued.",
      );
    }
    const creatorReportedLanguage = LanguageTagSchema.safeParse(
      item.source_language,
    );
    const payload = TranscriptionJobPayloadSchema.parse({
      batchId: item.batch_id,
      catalogVideoId: item.catalog_video_id,
      youtubeVideoId: item.youtube_video_id,
      ...(item.provider_media_id && item.canonical_url
        ? {
            sourceIdentity: {
              schemaVersion: 1 as const,
              provider: item.source_provider ?? "youtube",
              providerMediaId: item.provider_media_id,
              canonicalUrl: item.canonical_url,
            },
          }
        : {}),
      targetLanguage: item.target_language,
      transcriptionProfile: item.transcription_profile,
      sourcePolicy: item.source_policy,
      executionLocation: item.execution_location,
      priority: item.priority,
      ...(item.translation_provider
        ? {
            translationConsent: {
              provider: item.translation_provider,
              disclosureVersion: Number(item.translation_disclosure_version),
              transcriptTextTransferAccepted: true,
            },
          }
        : {}),
      ...(creatorReportedLanguage.success
        ? { creatorReportedLanguage: creatorReportedLanguage.data }
        : {}),
      languageDecision: input.decision,
    });
    const idempotencyKey = transcriptionJobIdempotencyKey(
      input.projectId,
      input.videoId,
      payload,
    );
    const candidateJobId = randomUUID();
    const inserted = await this.database.query<DbRow>(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, attempt, payload,
          created_at, updated_at)
       VALUES ($1, $2, 'transcription', 'queued', $3, 0, $4, $5, $5)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [
        candidateJobId,
        input.projectId,
        idempotencyKey,
        JSON.stringify(payload),
        input.now,
      ],
    );
    const jobId = inserted.rows[0]?.id
      ? String(inserted.rows[0].id)
      : String(
          (
            await this.database.query<DbRow>(
              "SELECT id FROM jobs WHERE idempotency_key = $1",
              [idempotencyKey],
            )
          ).rows[0]?.id ?? "",
        );
    if (!jobId) {
      throw new CatalogConflictError(
        "The confirmed transcription job could not be resolved.",
      );
    }
    const gate = LanguageGateSchema.parse({
      state: "ready",
      status: "confirmed",
      ...(creatorReportedLanguage.success
        ? { creatorReportedLanguage: creatorReportedLanguage.data }
        : {}),
      remediationReason: "none",
    });
    await this.database.query(
      `UPDATE transcription_batch_items
       SET state = 'queued', job_id = $1, idempotency_key = $2,
           language_gate = $3::jsonb, language_decision_id = $4,
           language_decision_video_id = $5,
           error_code = NULL, error_message = NULL, error_retryable = NULL,
           version = version + 1, updated_at = $6
       WHERE id = $7`,
      [
        jobId,
        idempotencyKey,
        JSON.stringify(gate),
        input.decision.decisionId,
        input.videoId,
        input.now,
        input.batchItemId,
      ],
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

  private async createProjectVideoActivity(
    projectId: string,
    videoId: string,
    actorId: string,
    eventType:
      | "review_completed"
      | "review_reopened"
      | "video_dismissed"
      | "video_restored"
      | "keyword_scan_completed",
    sourceKey: string,
    reason: string | undefined,
    additionalRecipientIds: string[],
    createdAt: string,
  ): Promise<void> {
    const eventId = randomUUID();
    const inserted = await this.database.query<DbRow>(
      `INSERT INTO project_video_activity_events
         (id, project_id, video_id, event_type, actor_id, source_key, reason,
          created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, event_type, source_key) DO NOTHING
       RETURNING id`,
      [
        eventId,
        projectId,
        videoId,
        eventType,
        actorId,
        sourceKey,
        reason ?? null,
        createdAt,
      ],
    );
    if (!inserted.rows[0]) return;
    await this.database.query(
      `INSERT INTO project_video_activity_receipts
         (event_id, user_id, state, version, created_at, updated_at)
       SELECT $1, recipients.user_id, 'unread', 1, $2, $2
       FROM (
         SELECT flag.user_id
         FROM project_video_flags flag
         JOIN project_members member
           ON member.project_id = flag.project_id
          AND member.user_id = flag.user_id
         WHERE flag.project_id = $3 AND flag.video_id = $4 AND flag.active
         UNION
         SELECT member.user_id
         FROM project_members member
         WHERE member.project_id = $3
           AND member.user_id = ANY($5::uuid[])
       ) recipients
       WHERE recipients.user_id <> $6
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [eventId, createdAt, projectId, videoId, additionalRecipientIds, actorId],
    );
  }

  private async emitTranscriptionNotificationsForBatch(
    batchId: string,
    createdAt: string,
  ): Promise<void> {
    const actionNeeded = await this.database.query<DbRow>(
      `SELECT bi.id AS batch_item_id, bi.attempt, bi.state, bi.catalog_video_id,
              b.id AS batch_id, b.project_id, b.name AS batch_label,
              p.name AS project_label,
              coalesce(nullif(btrim(bi.title), ''), 'Untitled source') AS source_label,
              recipient.user_id AS recipient_id
       FROM transcription_batch_items bi
       JOIN transcription_batches b ON b.id = bi.batch_id
       JOIN projects p ON p.id = b.project_id
       CROSS JOIN LATERAL (
         SELECT b.created_by AS user_id
         UNION
         SELECT flag.user_id
         FROM project_video_flags flag
         WHERE flag.project_id = b.project_id
           AND flag.video_id = bi.catalog_video_id AND flag.active
       ) recipient
       JOIN project_members member
         ON member.project_id = b.project_id
        AND member.user_id = recipient.user_id
       WHERE bi.batch_id = $1
         AND bi.state IN ('blocked', 'failed', 'needs_language_confirmation')`,
      [batchId],
    );
    for (const row of actionNeeded.rows) {
      await this.database.query(
        `INSERT INTO workflow_notification_events
           (id, recipient_id, event_type, source_key, project_id, batch_id,
            batch_item_id, video_id, status, project_label, batch_label,
            source_label, created_at)
         VALUES ($1, $2, 'transcription_action_needed', $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12)
         ON CONFLICT (recipient_id, event_type, source_key) DO NOTHING`,
        [
          randomUUID(),
          row.recipient_id,
          `${row.batch_item_id}:attempt:${Number(row.attempt)}:${row.state}`,
          row.project_id,
          row.batch_id,
          row.batch_item_id,
          row.catalog_video_id ?? null,
          row.state === "needs_language_confirmation"
            ? "action_needed"
            : row.state,
          safeNotificationLabel(row.project_label),
          safeNotificationLabel(row.batch_label),
          safeNotificationLabel(row.source_label),
          createdAt,
        ],
      );
    }

    const terminal = await this.database.query<DbRow>(
      `SELECT b.id AS batch_id, b.project_id, b.created_by AS recipient_id,
              b.name AS batch_label, p.name AS project_label,
              bool_and(bi.state IN (
                'ready_for_review', 'blocked', 'failed', 'canceled',
                'needs_language_confirmation'
              )) AS terminal,
              bool_or(bi.state IN (
                'blocked', 'failed', 'needs_language_confirmation'
              )) AS action_needed,
              count(*) FILTER (WHERE bi.state <> 'canceled')::integer AS relevant_count
       FROM transcription_batches b
       JOIN projects p ON p.id = b.project_id
       JOIN transcription_batch_items bi ON bi.batch_id = b.id
       JOIN project_members member
         ON member.project_id = b.project_id AND member.user_id = b.created_by
       WHERE b.id = $1
       GROUP BY b.id, b.project_id, b.created_by, b.name, p.name`,
      [batchId],
    );
    const summary = terminal.rows[0];
    if (summary?.terminal && Number(summary.relevant_count) > 0) {
      await this.database.query(
        `INSERT INTO workflow_notification_events
           (id, recipient_id, event_type, source_key, project_id, batch_id,
            status, project_label, batch_label, created_at)
         VALUES ($1, $2, 'transcription_batch_terminal', $3, $4, $5, $6,
                 $7, $8, $9)
         ON CONFLICT (recipient_id, event_type, source_key) DO NOTHING`,
        [
          randomUUID(),
          summary.recipient_id,
          String(summary.batch_id),
          summary.project_id,
          summary.batch_id,
          summary.action_needed ? "action_needed" : "ready",
          safeNotificationLabel(summary.project_label),
          safeNotificationLabel(summary.batch_label),
          createdAt,
        ],
      );
    }
  }

  private async emitLoggedExportNotification(input: {
    exportRequestId: string;
    status: "completed" | "action_needed";
    createdAt: string;
  }): Promise<void> {
    const result = await this.database.query<DbRow>(
      `SELECT er.id, er.project_id, er.clip_id, er.requested_by,
              p.name AS project_label, c.video_title AS source_label
       FROM export_requests er
       JOIN projects p ON p.id = er.project_id
       JOIN clip_candidates c
         ON c.project_id = er.project_id AND c.id = er.clip_id
       JOIN project_members member
         ON member.project_id = er.project_id
        AND member.user_id = er.requested_by
       WHERE er.id = $1`,
      [input.exportRequestId],
    );
    const row = result.rows[0];
    if (!row) return;
    await this.database.query(
      `INSERT INTO workflow_notification_events
         (id, recipient_id, event_type, source_key, project_id, clip_id,
          export_request_id, status, project_label, source_label, clip_label,
          created_at)
       VALUES ($1, $2, 'logged_export_terminal', $3, $4, $5, $6, $7,
               $8, $9, $10, $11)
       ON CONFLICT (recipient_id, event_type, source_key) DO NOTHING`,
      [
        randomUUID(),
        row.requested_by,
        row.id,
        row.project_id,
        row.clip_id,
        row.id,
        input.status,
        safeNotificationLabel(row.project_label),
        safeNotificationLabel(row.source_label),
        safeNotificationLabel(`Clip from ${String(row.source_label)}`),
        input.createdAt,
      ],
    );
  }

  private async loadCurrentProjectVideoReviewCycle(
    projectId: string,
    videoId: string,
    lock = false,
  ): Promise<DbRow> {
    const result = await this.database.query<DbRow>(
      `SELECT c.*,
              opened.handle AS opened_handle,
              opened.display_name AS opened_display_name,
              completed.handle AS completed_handle,
              completed.display_name AS completed_display_name
       FROM project_video_review_cycles c
       LEFT JOIN project_members opened_member
         ON opened_member.project_id = c.project_id
        AND opened_member.user_id = c.opened_by
       LEFT JOIN users opened ON opened.id = opened_member.user_id
       LEFT JOIN project_members completed_member
         ON completed_member.project_id = c.project_id
        AND completed_member.user_id = c.completed_by
       LEFT JOIN users completed ON completed.id = completed_member.user_id
       WHERE c.project_id = $1 AND c.video_id = $2
       ORDER BY c.cycle_number DESC
       LIMIT 1${lock ? " FOR UPDATE OF c" : ""}`,
      [projectId, videoId],
    );
    if (!result.rows[0]) {
      throw new CatalogConflictError(
        "The project video has no review cycle evidence.",
      );
    }
    return result.rows[0];
  }

  private async loadProjectKeywordCatalog(
    projectId: string,
  ): Promise<ProjectKeywordCatalog> {
    const project = await this.database.query<DbRow>(
      "SELECT keyword_set_version FROM projects WHERE id = $1",
      [projectId],
    );
    if (!project.rows[0]) throw new CatalogNotFoundError("Project not found.");
    const keywords = await this.database.query<DbRow>(
      `SELECT k.*, creator.handle AS creator_handle,
              creator.display_name AS creator_display_name,
              updater.handle AS updater_handle,
              updater.display_name AS updater_display_name
       FROM project_keywords k
       LEFT JOIN project_members creator_member
         ON creator_member.project_id = k.project_id
        AND creator_member.user_id = k.created_by
       LEFT JOIN users creator ON creator.id = creator_member.user_id
       LEFT JOIN project_members updater_member
         ON updater_member.project_id = k.project_id
        AND updater_member.user_id = k.updated_by
       LEFT JOIN users updater ON updater.id = updater_member.user_id
       WHERE k.project_id = $1
       ORDER BY k.normalized_label, k.id
       LIMIT 200`,
      [projectId],
    );
    const aliases = await this.database.query<DbRow>(
      `SELECT a.*, creator.handle AS creator_handle,
              creator.display_name AS creator_display_name,
              updater.handle AS updater_handle,
              updater.display_name AS updater_display_name
       FROM project_keyword_aliases a
       LEFT JOIN project_members creator_member
         ON creator_member.project_id = a.project_id
        AND creator_member.user_id = a.created_by
       LEFT JOIN users creator ON creator.id = creator_member.user_id
       LEFT JOIN project_members updater_member
         ON updater_member.project_id = a.project_id
        AND updater_member.user_id = a.updated_by
       LEFT JOIN users updater ON updater.id = updater_member.user_id
       WHERE a.project_id = $1
       ORDER BY a.keyword_id, a.language, a.normalized_phrase, a.id
       LIMIT 20000`,
      [projectId],
    );
    const suggestions = await this.database.query<DbRow>(
      `SELECT s.*, proposer.handle AS proposer_handle,
              proposer.display_name AS proposer_display_name,
              reviewer.handle AS reviewer_handle,
              reviewer.display_name AS reviewer_display_name,
              withdrawer.handle AS withdrawer_handle,
              withdrawer.display_name AS withdrawer_display_name
       FROM project_keyword_suggestions s
       LEFT JOIN project_members proposer_member
         ON proposer_member.project_id = s.project_id
        AND proposer_member.user_id = s.proposed_by
       LEFT JOIN users proposer ON proposer.id = proposer_member.user_id
       LEFT JOIN project_members reviewer_member
         ON reviewer_member.project_id = s.project_id
        AND reviewer_member.user_id = s.reviewed_by
       LEFT JOIN users reviewer ON reviewer.id = reviewer_member.user_id
       LEFT JOIN project_members withdrawer_member
         ON withdrawer_member.project_id = s.project_id
        AND withdrawer_member.user_id = s.withdrawn_by
       LEFT JOIN users withdrawer ON withdrawer.id = withdrawer_member.user_id
       WHERE s.project_id = $1
       ORDER BY CASE s.state WHEN 'pending' THEN 0 ELSE 1 END,
                s.created_at DESC, s.id DESC
       LIMIT 200`,
      [projectId],
    );
    const actor = (userId: unknown, handle: unknown, displayName: unknown) => ({
      userId: String(userId),
      handle: handle === null ? "former_member" : String(handle),
      displayName:
        displayName === null ? "Former project member" : String(displayName),
    });
    const mappedAliases = aliases.rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      keywordId: String(row.keyword_id),
      language: String(row.language),
      phrase: String(row.phrase),
      normalizedPhrase: String(row.normalized_phrase),
      enabled: Boolean(row.enabled),
      version: Number(row.version),
      createdBy: actor(
        row.created_by,
        row.creator_handle,
        row.creator_display_name,
      ),
      updatedBy: actor(
        row.updated_by,
        row.updater_handle,
        row.updater_display_name,
      ),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
    return ProjectKeywordCatalogSchema.parse({
      projectId,
      keywordSetVersion: Number(project.rows[0].keyword_set_version),
      keywords: keywords.rows.map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        label: String(row.label),
        ...(row.description === null
          ? {}
          : { description: String(row.description) }),
        enabled: Boolean(row.enabled),
        version: Number(row.version),
        createdBy: actor(
          row.created_by,
          row.creator_handle,
          row.creator_display_name,
        ),
        updatedBy: actor(
          row.updated_by,
          row.updater_handle,
          row.updater_display_name,
        ),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        aliases: mappedAliases.filter(
          (entry) => entry.keywordId === String(row.id),
        ),
      })),
      suggestions: suggestions.rows.map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        ...(row.keyword_id === null
          ? {}
          : { keywordId: String(row.keyword_id) }),
        ...(row.proposed_label === null
          ? {}
          : { proposedLabel: String(row.proposed_label) }),
        ...(row.proposed_description === null
          ? {}
          : { proposedDescription: String(row.proposed_description) }),
        language: String(row.language),
        phrase: String(row.phrase),
        normalizedPhrase: String(row.normalized_phrase),
        ...(row.rationale === null ? {} : { rationale: String(row.rationale) }),
        state: String(row.state),
        version: Number(row.version),
        proposedBy: actor(
          row.proposed_by,
          row.proposer_handle,
          row.proposer_display_name,
        ),
        ...(row.reviewed_by === null
          ? {}
          : {
              reviewedBy: actor(
                row.reviewed_by,
                row.reviewer_handle,
                row.reviewer_display_name,
              ),
              reviewedAt: iso(row.reviewed_at),
            }),
        ...(row.review_reason === null
          ? {}
          : { reviewReason: String(row.review_reason) }),
        ...(row.withdrawn_by === null
          ? {}
          : {
              withdrawnBy: actor(
                row.withdrawn_by,
                row.withdrawer_handle,
                row.withdrawer_display_name,
              ),
              withdrawnAt: iso(row.withdrawn_at),
            }),
        ...(row.withdraw_reason === null
          ? {}
          : { withdrawReason: String(row.withdraw_reason) }),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
    });
  }

  private async loadProjectKeywordCommandReplay(
    projectId: string,
    actorId: string,
    idempotencyKey: string,
    requestSha256: string,
  ): Promise<Record<string, unknown> | undefined> {
    const replay = await this.database.query<DbRow>(
      `SELECT request_sha256, response_json FROM project_keyword_commands
       WHERE project_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
      [projectId, actorId, idempotencyKey],
    );
    if (!replay.rows[0]) return undefined;
    if (String(replay.rows[0].request_sha256) !== requestSha256) {
      throw new CatalogIdempotencyConflictError(
        "This project-keyword command key was already used for another request.",
      );
    }
    return jsonRecord(replay.rows[0].response_json);
  }

  private async recordProjectKeywordCommand(
    projectId: string,
    actorId: string,
    commandKind:
      "suggest" | "review" | "withdraw" | "keyword_update" | "alias_update",
    idempotencyKey: string,
    requestSha256: string,
    response: unknown,
    createdAt: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO project_keyword_commands
         (id, project_id, actor_id, command_kind, idempotency_key,
          request_sha256, response_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        projectId,
        actorId,
        commandKind,
        idempotencyKey,
        requestSha256,
        JSON.stringify(response),
        createdAt,
      ],
    );
  }

  private async loadProjectLocalProcessingStatus(
    projectId: string,
  ): Promise<ProjectLocalProcessingStatus> {
    const project = await this.database.query<DbRow>(
      `SELECT p.local_processing_state, p.local_processing_version,
              p.local_processing_updated_by, p.local_processing_updated_at,
              updater.handle AS updater_handle,
              updater.display_name AS updater_display_name
       FROM projects p
       LEFT JOIN project_members updater_member
         ON updater_member.project_id = p.id
        AND updater_member.user_id = p.local_processing_updated_by
       LEFT JOIN users updater ON updater.id = updater_member.user_id
       WHERE p.id = $1`,
      [projectId],
    );
    const row = project.rows[0];
    if (!row) throw new CatalogNotFoundError("Project not found.");
    const jobs = await this.database.query<DbRow>(
      `SELECT j.id, j.state, max(v.duration_ms)::bigint AS duration_ms
       FROM jobs j
       JOIN transcription_batch_items bi ON bi.job_id = j.id
       JOIN transcription_batches b ON b.id = bi.batch_id
       JOIN videos v ON v.id = bi.catalog_video_id
       WHERE b.project_id = $1 AND b.execution_location = 'local'
         AND j.kind = 'transcription'
         AND j.state IN ('queued', 'claimed', 'processing')
         AND bi.state NOT IN ('ready_for_review', 'failed', 'canceled')
       GROUP BY j.id, j.state`,
      [projectId],
    );
    const unprocessed = await this.database.query<DbRow>(
      `SELECT count(*)::integer AS total
       FROM project_videos pv
       WHERE pv.project_id = $1 AND pv.triage_state = 'active'
         AND pv.active_transcript_version_id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM transcription_batch_items bi
           JOIN transcription_batches b ON b.id = bi.batch_id
           WHERE b.project_id = pv.project_id
             AND b.execution_location = 'local'
             AND bi.catalog_video_id = pv.video_id
         )`,
      [projectId],
    );
    const queued = jobs.rows.filter((job) => job.state === "queued");
    const active = jobs.rows.filter((job) => job.state !== "queued");
    const knownDuration = (rows: DbRow[]) =>
      rows.reduce(
        (total, job) =>
          total + (job.duration_ms === null ? 0 : Number(job.duration_ms)),
        0,
      );
    const unknownDuration = (rows: DbRow[]) =>
      rows.filter((job) => job.duration_ms === null).length;
    return ProjectLocalProcessingStatusSchema.parse({
      projectId,
      policy: {
        state: row.local_processing_state,
        version: Number(row.local_processing_version),
        ...(row.local_processing_updated_by === null
          ? {}
          : {
              updatedBy: {
                userId: String(row.local_processing_updated_by),
                handle:
                  row.updater_handle === null
                    ? "former_member"
                    : String(row.updater_handle),
                displayName:
                  row.updater_display_name === null
                    ? "Former project member"
                    : String(row.updater_display_name),
              },
              updatedAt: iso(row.local_processing_updated_at),
            }),
      },
      workload: {
        queuedJobs: queued.length,
        activeJobs: active.length,
        queuedKnownDurationMs: knownDuration(queued),
        activeKnownDurationMs: knownDuration(active),
        queuedUnknownDurationCount: unknownDuration(queued),
        activeUnknownDurationCount: unknownDuration(active),
        unprocessedActiveVideoCount: Number(unprocessed.rows[0]?.total ?? 0),
      },
    });
  }

  private async enqueueMissingProjectLocalVideos(
    actor: AuthenticatedActor,
    projectId: string,
    createdAt: string,
    limit: number,
    catalogVideoId?: string,
  ): Promise<number> {
    const candidates = await this.database.query<DbRow>(
      `SELECT v.id, v.youtube_video_id, v.canonical_url, v.title, v.channel,
              v.duration_ms, v.source_language, v.source_provider,
              v.provider_media_id
       FROM project_videos pv
       JOIN videos v ON v.id = pv.video_id
       WHERE pv.project_id = $1 AND pv.triage_state = 'active'
         AND pv.active_transcript_version_id IS NULL
         AND ($2::uuid IS NULL OR pv.video_id = $2::uuid)
         AND NOT EXISTS (
           SELECT 1
           FROM transcription_batch_items bi
           JOIN transcription_batches b ON b.id = bi.batch_id
           WHERE b.project_id = pv.project_id
             AND b.execution_location = 'local'
             AND bi.catalog_video_id = pv.video_id
         )
       ORDER BY pv.created_at, pv.video_id
       LIMIT $3::integer`,
      [projectId, catalogVideoId ?? null, Math.max(1, Math.min(50, limit))],
    );
    if (candidates.rows.length === 0) return 0;
    const automaticBatch = await this.database.query<DbRow>(
      `SELECT id FROM transcription_batches
       WHERE project_id = $1 AND processing_origin = 'project_local'`,
      [projectId],
    );
    const batchId = automaticBatch.rows[0]?.id
      ? String(automaticBatch.rows[0].id)
      : randomUUID();
    const options: BatchOptions = {
      targetLanguage: "en",
      transcriptionProfile: "default",
      sourcePolicy: "captions-then-generate",
      executionLocation: "local",
      priority: "normal",
    };
    if (!automaticBatch.rows[0]) {
      await this.insertTranscriptionBatch(
        batchId,
        actor.userId,
        projectId,
        "Automatic local processing",
        options,
        createdAt,
        "project_local",
      );
    }
    const nextIndex = await this.database.query<DbRow>(
      `SELECT coalesce(max(input_index), -1)::integer + 1 AS next_index
       FROM transcription_batch_items WHERE batch_id = $1`,
      [batchId],
    );
    let inputIndex = Number(nextIndex.rows[0]?.next_index ?? 0);
    for (const candidate of candidates.rows) {
      await this.insertTranscriptionBatchItem(
        actor,
        projectId,
        batchId,
        options,
        {
          inputIndex,
          input: String(candidate.canonical_url),
          status: "ready",
          processingNeed: "transcription",
          catalogVideoId: String(candidate.id),
          youtubeVideoId: String(candidate.youtube_video_id),
          canonicalUrl: String(candidate.canonical_url),
          sourceIdentity: {
            schemaVersion: 1,
            provider: sourceProviderFromRow(candidate.source_provider),
            providerMediaId: String(
              candidate.provider_media_id ?? candidate.youtube_video_id,
            ),
            canonicalUrl: String(candidate.canonical_url),
          },
          title: String(candidate.title),
          ...(candidate.channel === null
            ? {}
            : { channel: String(candidate.channel) }),
          ...(candidate.duration_ms === null
            ? {}
            : { durationMs: Number(candidate.duration_ms) }),
          ...(candidate.source_language === null
            ? {}
            : { sourceLanguage: String(candidate.source_language) }),
        },
        createdAt,
        false,
      );
      inputIndex += 1;
    }
    return candidates.rows.length;
  }

  private async insertTranscriptionBatch(
    batchId: string,
    actorId: string,
    projectId: string,
    name: string,
    options: BatchOptions,
    createdAt: string,
    processingOrigin: "manual" | "project_local",
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO transcription_batches
         (id, project_id, name, target_language, execution_location,
          transcription_profile, source_policy, priority, created_by,
          translation_provider, translation_disclosure_version,
          translation_consent_accepted_at, hosted_approval_state,
          hosted_approval_version, processing_origin, version, created_at,
          updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, 1, $14, 1, $15, $15)`,
      [
        batchId,
        projectId,
        name.trim(),
        options.targetLanguage,
        options.executionLocation,
        options.transcriptionProfile,
        options.sourcePolicy,
        options.priority,
        actorId,
        options.translationConsent?.provider ?? null,
        options.translationConsent?.disclosureVersion ?? null,
        options.translationConsent ? createdAt : null,
        options.executionLocation === "hosted" ? "pending" : "not_required",
        processingOrigin,
        createdAt,
      ],
    );
  }

  private async insertTranscriptionBatchItem(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    options: BatchOptions,
    item: BatchPreflightItem,
    createdAt: string,
    upsertVideo: boolean,
    trustVerifiedPreflight = false,
  ): Promise<void> {
    let catalogVideoId = item.catalogVideoId;
    if (
      upsertVideo &&
      item.youtubeVideoId &&
      item.canonicalUrl &&
      item.title &&
      ["ready", "existing-transcript"].includes(item.status)
    ) {
      catalogVideoId = await this.upsertProjectVideo(
        actor.userId,
        projectId,
        item,
        createdAt,
      );
    }

    let persistedItem = item;
    if (
      item.status === "ready" &&
      catalogVideoId &&
      !trustVerifiedPreflight &&
      options.sourcePolicy !== "force-generate"
    ) {
      const active = await this.database.query<DbRow>(
        `SELECT active_transcript_version_id
         FROM project_videos
         WHERE project_id = $1 AND video_id = $2`,
        [projectId, catalogVideoId],
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
    let languageGate: LanguageGate | undefined;
    let languageDecision: LanguageDecisionSnapshot | undefined;
    let creatorReportedLanguage: string | undefined;
    if (catalogVideoId) {
      languageGate = await this.loadProjectVideoLanguageGate(
        projectId,
        catalogVideoId,
      );
      creatorReportedLanguage = languageGate.creatorReportedLanguage;
      if (
        creatorReportedLanguage &&
        languageGate.decision?.status !== "confirmed"
      ) {
        await this.ensureCreatorMetadataLanguageDecision(
          actor,
          projectId,
          catalogVideoId,
          creatorReportedLanguage,
          createdAt,
        );
        languageGate = await this.loadProjectVideoLanguageGate(
          projectId,
          catalogVideoId,
        );
      }
      if (languageGate.decision) {
        languageDecision = LanguageDecisionSnapshotSchema.parse({
          schemaVersion: 1,
          decisionId: languageGate.decision.id,
          decisionVersion: languageGate.decision.decisionVersion,
          status: languageGate.decision.status,
          basis: languageGate.decision.basis,
          ...(languageGate.decision.resolvedLanguage
            ? { resolvedLanguage: languageGate.decision.resolvedLanguage }
            : {}),
          ...(languageGate.decision.evidenceId
            ? { evidenceId: languageGate.decision.evidenceId }
            : {}),
        });
      }
    }
    let state:
      | "queued"
      | "ready_for_review"
      | "blocked"
      | "canceled"
      | "needs_language_confirmation";
    if (persistedItem.status === "ready" && catalogVideoId) {
      if (languageGate?.state === "needs_language_confirmation") {
        state = "needs_language_confirmation";
      } else {
        const payload = TranscriptionJobPayloadSchema.parse({
          batchId,
          catalogVideoId,
          youtubeVideoId: persistedItem.youtubeVideoId,
          ...(persistedItem.sourceIdentity
            ? { sourceIdentity: persistedItem.sourceIdentity }
            : {}),
          targetLanguage: options.targetLanguage,
          transcriptionProfile: options.transcriptionProfile,
          sourcePolicy: options.sourcePolicy,
          executionLocation: options.executionLocation,
          priority: options.priority,
          ...(options.translationConsent
            ? { translationConsent: options.translationConsent }
            : {}),
          ...(creatorReportedLanguage ? { creatorReportedLanguage } : {}),
          ...(languageDecision ? { languageDecision } : {}),
        });
        const equivalent = await this.database.query<DbRow>(
          `SELECT id, idempotency_key
           FROM jobs
           WHERE project_id = $1 AND kind = 'transcription'
             AND state IN ('queued', 'claimed', 'processing', 'needs_user_action')
             AND payload->>'catalogVideoId' = $2
             AND payload->>'targetLanguage' = $3
             AND payload->>'transcriptionProfile' = $4
             AND payload->>'executionLocation' = $5
             AND (
               payload->>'sourcePolicy' = $6
               OR (
                 payload->>'sourcePolicy' <> 'force-generate'
                 AND $6 <> 'force-generate'
               )
             )
             AND coalesce(payload->'translationConsent', 'null'::jsonb)
                 = $7::jsonb
             AND coalesce(payload->>'creatorReportedLanguage', '') = $8
             AND coalesce(payload->'languageDecision', 'null'::jsonb)
                 = $9::jsonb
           ORDER BY created_at, id
           LIMIT 1`,
          [
            projectId,
            catalogVideoId,
            payload.targetLanguage,
            payload.transcriptionProfile,
            payload.executionLocation,
            payload.sourcePolicy,
            JSON.stringify(payload.translationConsent ?? null),
            payload.creatorReportedLanguage ?? "",
            JSON.stringify(payload.languageDecision ?? null),
          ],
        );
        if (equivalent.rows[0]) {
          jobId = String(equivalent.rows[0].id);
          idempotencyKey = String(equivalent.rows[0].idempotency_key);
        } else {
          idempotencyKey = transcriptionJobIdempotencyKey(
            projectId,
            catalogVideoId,
            payload,
          );
          const candidateJobId = randomUUID();
          const insertedJob = await this.database.query<DbRow>(
            `INSERT INTO jobs
             (id, project_id, kind, state, idempotency_key, attempt,
              payload, created_at, updated_at)
             VALUES ($1, $2, 'transcription', 'queued', $3, 0, $4, $5, $5)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [
              candidateJobId,
              projectId,
              idempotencyKey,
              JSON.stringify(payload),
              createdAt,
            ],
          );
          if (insertedJob.rows[0]) {
            jobId = String(insertedJob.rows[0].id);
          } else {
            const existingJob = await this.database.query<DbRow>(
              "SELECT id FROM jobs WHERE idempotency_key = $1",
              [idempotencyKey],
            );
            if (!existingJob.rows[0]) {
              throw new CatalogConflictError(
                "The transcription job could not be resolved after deduplication.",
              );
            }
            jobId = String(existingJob.rows[0].id);
          }
        }
        state = "queued";
      }
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
         language_gate, language_decision_id, language_decision_video_id,
          version, created_at, updated_at, source_provider, provider_media_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, 'unreviewed', $17, $18, $19, $20,
               0, $21, $22, $23, 1, $24, $24, $25, $26)`,
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
        languageGate ? JSON.stringify(languageGate) : null,
        languageDecision?.decisionId ?? null,
        languageDecision ? catalogVideoId : null,
        createdAt,
        persistedItem.sourceIdentity?.provider ??
          (persistedItem.youtubeVideoId ? "youtube" : null),
        persistedItem.sourceIdentity?.providerMediaId ??
          persistedItem.youtubeVideoId ??
          null,
      ],
    );
  }

  private async upsertProjectVideo(
    actorId: string,
    projectId: string,
    item: {
      youtubeVideoId?: string | undefined;
      canonicalUrl?: string | undefined;
      title?: string | undefined;
      channel?: string | undefined;
      durationMs?: number | undefined;
      sourceLanguage?: string | undefined;
      sourceIdentity?: SourceIdentityV1 | undefined;
      sourceFingerprint?: SourceFingerprintEvidence | undefined;
    },
    now: string,
  ): Promise<string> {
    if (!item.youtubeVideoId || !item.canonicalUrl || !item.title) {
      throw new CatalogInvalidRequestError(
        "A canonical video identity and title are required.",
      );
    }
    const insertedVideo = await this.database.query<DbRow>(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, channel, duration_ms,
          source_language, created_at, updated_at, source_provider,
          provider_media_id, source_fingerprint_evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)
       ON CONFLICT (source_provider, provider_media_id) DO UPDATE
       SET canonical_url = EXCLUDED.canonical_url,
           title = EXCLUDED.title,
           channel = EXCLUDED.channel,
           duration_ms = EXCLUDED.duration_ms,
           source_language = EXCLUDED.source_language,
           source_provider = EXCLUDED.source_provider,
           provider_media_id = EXCLUDED.provider_media_id,
           source_fingerprint_evidence = COALESCE(
             EXCLUDED.source_fingerprint_evidence,
             videos.source_fingerprint_evidence
           ),
           updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [
        randomUUID(),
        item.youtubeVideoId,
        item.canonicalUrl,
        item.title.trim(),
        item.channel ?? null,
        item.durationMs ?? null,
        item.sourceLanguage ?? null,
        now,
        item.sourceIdentity?.provider ?? "youtube",
        item.sourceIdentity?.providerMediaId ?? item.youtubeVideoId,
        item.sourceFingerprint ? JSON.stringify(item.sourceFingerprint) : null,
      ],
    );
    const id = String(insertedVideo.rows[0]!.id);
    await this.database.query(
      `INSERT INTO project_videos
         (project_id, video_id, version, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $3)
       ON CONFLICT (project_id, video_id) DO NOTHING`,
      [projectId, id, now],
    );
    await this.database.query(
      `INSERT INTO project_video_review_cycles
         (id, project_id, video_id, cycle_number, status, version, opened_by,
          opened_at, updated_at)
       VALUES ($1, $2, $3, 1, 'open', 1, $4, $5, $5)
       ON CONFLICT (project_id, video_id, cycle_number) DO NOTHING`,
      [randomUUID(), projectId, id, actorId, now],
    );
    const insertedFlag = await this.database.query<DbRow>(
      `INSERT INTO project_video_flags
         (project_id, video_id, user_id, active, version, created_at,
          updated_at)
       VALUES ($1, $2, $3, true, 1, $4, $4)
       ON CONFLICT (project_id, video_id, user_id) DO NOTHING
       RETURNING version`,
      [projectId, id, actorId, now],
    );
    if (!insertedFlag.rows[0]) {
      const restored = await this.database.query<DbRow>(
        `UPDATE project_video_flags
         SET active = true, version = version + 1, updated_at = $1,
             deactivated_at = NULL
         WHERE project_id = $2 AND video_id = $3 AND user_id = $4
           AND NOT active
         RETURNING version`,
        [now, projectId, id, actorId],
      );
      if (restored.rows[0]) {
        await this.database.query(
          `UPDATE project_videos
           SET version = version + 1, updated_at = $1
           WHERE project_id = $2 AND video_id = $3`,
          [now, projectId, id],
        );
      }
    }
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

  private loadClipLibraryLeaves(projectId: string, clipId: string) {
    return this.database.query<DbRow>(
      `SELECT request.*, job.state, batch_item.batch_id,
              progress.execution_id, progress.export_request_id,
              progress.attempt, progress.sequence, progress.stage,
              progress.basis_points, progress.updated_at AS progress_updated_at
       FROM export_requests request
       JOIN jobs job ON job.id = request.job_id
       LEFT JOIN logged_export_batch_items batch_item
         ON batch_item.id = request.batch_item_id
       LEFT JOIN logged_export_execution_progress progress
         ON progress.export_request_id = request.id
       WHERE request.project_id = $1 AND request.clip_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM export_requests child
           WHERE child.retry_of_request_id = request.id
         )
       ORDER BY request.updated_at DESC, request.id DESC
       LIMIT 11`,
      [projectId, clipId],
    );
  }

  private loadClipLibraryHistory(projectId: string, clipId: string) {
    return this.database.query<DbRow>(
      `SELECT success.id AS artifact_version_id,
              success.result_json, success.result_fingerprint,
              success.reconciled_at, request.*,
              count(*) OVER () AS completed_count
       FROM logged_export_success_results success
       JOIN export_requests request ON request.id = success.export_request_id
       WHERE request.project_id = $1 AND request.clip_id = $2
       ORDER BY success.reconciled_at DESC, success.id DESC
       LIMIT 5`,
      [projectId, clipId],
    );
  }

  private async loadLoggedExportBatchRows(
    projectId: string,
    batchId: string,
  ): Promise<DbRow[]> {
    const result = await this.database.query<DbRow>(
      `SELECT batch.id AS batch_id,
              batch.project_id AS batch_project_id,
              batch.created_at AS batch_created_at,
              item.id AS batch_item_id_value,
              item.ordinal AS batch_item_ordinal,
              item.clip_id AS batch_clip_id,
              item.root_export_request_id,
              er.*, job.state,
              success.result_json AS export_success_result_json,
              progress.execution_id AS progress_execution_id,
              progress.export_request_id AS progress_export_request_id,
              progress.attempt AS progress_attempt,
              progress.sequence AS progress_sequence,
              progress.stage AS progress_stage,
              progress.basis_points AS progress_basis_points,
              progress.updated_at AS progress_updated_at
       FROM logged_export_batches batch
       JOIN logged_export_batch_items item ON item.batch_id = batch.id
       JOIN export_requests er ON er.id = (
         SELECT leaf.id FROM export_requests leaf
         WHERE leaf.batch_item_id = item.id
         ORDER BY leaf.retry_ordinal DESC, leaf.created_at DESC, leaf.id
         LIMIT 1
       )
       JOIN jobs job ON job.id = er.job_id
       LEFT JOIN logged_export_success_results success
         ON success.export_request_id = er.id
       LEFT JOIN logged_export_execution_progress progress
         ON progress.export_request_id = er.id
       WHERE batch.id = $1 AND batch.project_id = $2
       ORDER BY item.ordinal, item.id`,
      [batchId, projectId],
    );
    return result.rows;
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

  private async deleteClipCommentInternal(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    commentId: string,
    input: DeleteClipCommentRequest | ModerateClipCommentRequest,
    deletionKind: "author" | "moderation",
  ): Promise<ClipComment> {
    const user = await this.getCurrentUser(actor);
    const commandKind = deletionKind === "author" ? "delete" : "moderate";
    const requestFingerprint = sha256Fingerprint({
      projectId,
      clipId,
      commentId,
      input,
      deletionKind,
    });
    const resolvedCommentId = await this.transaction(async () => {
      const replay = await this.resolveClipCommentCommandReplay(
        projectId,
        clipId,
        actor.userId,
        commandKind,
        input.idempotencyKey,
        requestFingerprint,
        commentId,
      );
      if (replay) return replay;
      const row = await this.requireActiveClipComment(
        projectId,
        clipId,
        commentId,
      );
      if (deletionKind === "author" && String(row.author_id) !== actor.userId) {
        throw new AuthorizationError(
          "Researchers may delete only their own clip comments.",
        );
      }
      const now = this.now().toISOString();
      const won = await this.recordClipCommentCommand(
        projectId,
        clipId,
        actor.userId,
        commandKind,
        input.idempotencyKey,
        requestFingerprint,
        commentId,
        input.expectedVersion + 1,
        now,
      );
      if (!won) {
        const concurrentReplay = await this.resolveClipCommentCommandReplay(
          projectId,
          clipId,
          actor.userId,
          commandKind,
          input.idempotencyKey,
          requestFingerprint,
          commentId,
        );
        if (concurrentReplay) return concurrentReplay;
        throw new CatalogConflictError(
          "The comment could not be resolved after idempotent deletion.",
        );
      }
      const deleted = await this.database.query<DbRow>(
        `UPDATE clip_comments
         SET body = NULL, version = version + 1, updated_at = $1,
             deleted_at = $1, deleted_by = $2, deleted_by_handle = $3,
             deleted_by_display_name = $4, deletion_kind = $5
         WHERE project_id = $6 AND clip_id = $7 AND id = $8
           AND deleted_at IS NULL AND version = $9
         RETURNING version`,
        [
          now,
          user.id,
          user.handle,
          user.displayName,
          deletionKind,
          projectId,
          clipId,
          commentId,
          input.expectedVersion,
        ],
      );
      if (!deleted.rows[0]) {
        throw new CatalogConflictError(
          "This comment changed elsewhere. Reload it before deleting.",
        );
      }
      await this.appendClipCommentSyncEvent(
        projectId,
        commentId,
        Number(deleted.rows[0].version),
        deletionKind === "author"
          ? "clip_comment.deleted"
          : "clip_comment.moderated",
        {
          clipId,
          commentId,
          deletedBy: user.id,
          deletionKind,
        },
        now,
      );
      return commentId;
    });
    return this.getClipComment(projectId, clipId, resolvedCommentId);
  }

  private async requireClipCommentModerator(
    actorId: string,
    projectId: string,
  ): Promise<void> {
    const result = await this.database.query<{ role: ProjectRole }>(
      `SELECT role FROM project_members
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, actorId],
    );
    if (
      result.rows[0]?.role !== "owner" &&
      result.rows[0]?.role !== "administrator"
    ) {
      throw new AuthorizationError(
        "Only project Owners and Administrators may moderate clip comments.",
      );
    }
  }

  private async requireClipCommentRange(
    projectId: string,
    clipId: string,
  ): Promise<{ exportStartMs: number; exportEndMs: number }> {
    const result = await this.database.query<DbRow>(
      `SELECT export_start_ms, export_end_ms FROM clip_candidates
       WHERE project_id = $1 AND id = $2`,
      [projectId, clipId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Clip candidate not found.");
    return {
      exportStartMs: Number(row.export_start_ms),
      exportEndMs: Number(row.export_end_ms),
    };
  }

  private async requireActiveClipComment(
    projectId: string,
    clipId: string,
    commentId: string,
  ): Promise<DbRow> {
    const result = await this.database.query<DbRow>(
      `SELECT * FROM clip_comments
       WHERE project_id = $1 AND clip_id = $2 AND id = $3`,
      [projectId, clipId, commentId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Clip comment not found.");
    if (row.deleted_at) {
      throw new CatalogConflictError(
        "Deleted clip comments cannot be changed.",
      );
    }
    return row;
  }

  private async getClipComment(
    projectId: string,
    clipId: string,
    commentId: string,
  ): Promise<ClipComment> {
    const result = await this.database.query<DbRow>(
      `SELECT * FROM clip_comments
       WHERE project_id = $1 AND clip_id = $2 AND id = $3`,
      [projectId, clipId, commentId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Clip comment not found.");
    return mapClipComment(row, await this.loadClipCommentMentions(commentId));
  }

  private async resolveClipCommentCommandReplay(
    projectId: string,
    clipId: string,
    actorId: string,
    commandKind: "create" | "update" | "delete" | "moderate",
    idempotencyKey: string,
    requestFingerprint: string,
    expectedCommentId?: string,
  ): Promise<string | undefined> {
    const result = await this.database.query<DbRow>(
      `SELECT clip_id, comment_id, request_sha256
       FROM clip_comment_commands
       WHERE project_id = $1 AND actor_id = $2 AND command_kind = $3
         AND idempotency_key = $4`,
      [projectId, actorId, commandKind, idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (
      String(row.clip_id) !== clipId ||
      String(row.request_sha256) !== requestFingerprint ||
      (expectedCommentId !== undefined &&
        String(row.comment_id) !== expectedCommentId)
    ) {
      throw new CatalogIdempotencyConflictError(
        "This clip-comment command identity already belongs to different evidence.",
      );
    }
    return String(row.comment_id);
  }

  private async recordClipCommentCommand(
    projectId: string,
    clipId: string,
    actorId: string,
    commandKind: "create" | "update" | "delete" | "moderate",
    idempotencyKey: string,
    requestFingerprint: string,
    commentId: string,
    resultVersion: number,
    now: string,
  ): Promise<boolean> {
    const inserted = await this.database.query<DbRow>(
      `INSERT INTO clip_comment_commands
         (id, project_id, clip_id, actor_id, command_kind, idempotency_key,
          request_sha256, comment_id, result_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (project_id, actor_id, command_kind, idempotency_key)
       DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        projectId,
        clipId,
        actorId,
        commandKind,
        idempotencyKey,
        requestFingerprint,
        commentId,
        resultVersion,
        now,
      ],
    );
    return Boolean(inserted.rows[0]);
  }

  private async appendClipCommentSyncEvent(
    projectId: string,
    commentId: string,
    version: number,
    eventType:
      | "clip_comment.created"
      | "clip_comment.updated"
      | "clip_comment.deleted"
      | "clip_comment.moderated",
    payload: Record<string, unknown>,
    now: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO sync_events
         (project_id, event_type, entity_id, server_version, payload,
          created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [projectId, eventType, commentId, version, JSON.stringify(payload), now],
    );
  }

  private async persistCommentCollaboration(input: {
    projectId: string;
    clipId: string;
    commentId: string;
    commentVersion: number;
    body: string;
    actor: User;
    sourceTimeMs?: number | undefined;
    now: string;
  }): Promise<void> {
    const handles = [
      ...new Set(
        [...input.body.matchAll(/@([a-z][a-z0-9_]{2,31})/giu)].map((match) =>
          match[1]!.normalize("NFKC").toLocaleLowerCase("en-US"),
        ),
      ),
    ].slice(0, 50);
    const mentions = handles.length
      ? await this.database.query<DbRow>(
          `SELECT user_record.id, user_record.handle,
                  user_record.display_name, member.user_id AS member_user_id
           FROM users user_record
           LEFT JOIN project_members member
             ON member.project_id = $1 AND member.user_id = user_record.id
           WHERE user_record.normalized_handle = ANY($2::text[])`,
          [input.projectId, handles],
        )
      : { rows: [] as DbRow[] };
    if (
      mentions.rows.length !== handles.length ||
      mentions.rows.some((row) => !row.member_user_id)
    ) {
      throw new CatalogInvalidRequestError(
        "Every @mention must resolve to a current member of this project.",
      );
    }
    await this.database.query(
      "DELETE FROM clip_comment_mentions WHERE comment_id = $1",
      [input.commentId],
    );
    for (const mention of mentions.rows) {
      await this.database.query(
        `INSERT INTO clip_comment_mentions
           (comment_id, mentioned_user_id, mentioned_handle,
            mentioned_display_name, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.commentId,
          mention.id,
          mention.handle,
          mention.display_name,
          input.now,
        ],
      );
    }
    await this.database.query(
      `INSERT INTO clip_follows
         (project_id, clip_id, user_id, following, version, updated_at)
       VALUES ($1, $2, $3, true, 1, $4)
       ON CONFLICT (project_id, clip_id, user_id) DO UPDATE
       SET following = true,
           version = CASE WHEN clip_follows.following THEN clip_follows.version
                          ELSE clip_follows.version + 1 END,
           updated_at = EXCLUDED.updated_at`,
      [input.projectId, input.clipId, input.actor.id, input.now],
    );
    const followers = await this.database.query<DbRow>(
      `SELECT follow.user_id
       FROM clip_follows follow
       JOIN project_members member
         ON member.project_id = follow.project_id
        AND member.user_id = follow.user_id
       WHERE follow.project_id = $1 AND follow.clip_id = $2
         AND follow.following AND follow.user_id <> $3`,
      [input.projectId, input.clipId, input.actor.id],
    );
    const mentionIds = new Set(mentions.rows.map((row) => String(row.id)));
    const recipientIds = new Set([
      ...followers.rows.map((row) => String(row.user_id)),
      ...mentionIds,
    ]);
    for (const recipientId of recipientIds) {
      await this.database.query(
        `INSERT INTO clip_comment_notices
           (id, project_id, clip_id, comment_id, comment_version,
            recipient_id, reason, actor_id, actor_handle,
            actor_display_name, source_time_ms, state, version,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'unread', 1, $12, $12)
         ON CONFLICT (comment_id, comment_version, recipient_id) DO NOTHING`,
        [
          randomUUID(),
          input.projectId,
          input.clipId,
          input.commentId,
          input.commentVersion,
          recipientId,
          mentionIds.has(recipientId) ? "mention" : "followed_comment",
          input.actor.id,
          input.actor.handle,
          input.actor.displayName,
          input.sourceTimeMs ?? null,
          input.now,
        ],
      );
    }
  }

  private async loadClipCommentMentions(commentId: string): Promise<DbRow[]> {
    const result = await this.database.query<DbRow>(
      `SELECT mentioned_user_id AS id, mentioned_handle AS handle,
              mentioned_display_name AS display_name
       FROM clip_comment_mentions WHERE comment_id = $1
       ORDER BY mentioned_handle, mentioned_user_id`,
      [commentId],
    );
    return result.rows;
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

  private async transaction<Result>(
    action: () => Promise<Result>,
    options: { repeatableRead?: boolean } = {},
  ) {
    return options.repeatableRead
      ? this.database.transaction(action, {
          repeatableRead: true,
          readOnly: true,
        })
      : this.database.transaction(action);
  }
}

function assertClipCommentSourceTime(
  sourceTimeMs: number | undefined,
  range: { exportStartMs: number; exportEndMs: number },
): void {
  if (
    sourceTimeMs !== undefined &&
    (sourceTimeMs < range.exportStartMs || sourceTimeMs > range.exportEndMs)
  ) {
    throw new CatalogInvalidRequestError(
      "Comment source time must be inside the immutable clip export range.",
    );
  }
}

function mapClipComment(row: DbRow, mentions: DbRow[] = []): ClipComment {
  const common = {
    id: row.id,
    projectId: row.project_id,
    clipId: row.clip_id,
    author: {
      id: row.author_id,
      handle: row.author_handle,
      displayName: row.author_display_name,
    },
    ...(row.source_time_ms !== null && row.source_time_ms !== undefined
      ? { sourceTimeMs: Number(row.source_time_ms) }
      : {}),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.bookmark_youtube_video_id
      ? {
          source: {
            youtubeVideoId: String(row.bookmark_youtube_video_id),
            canonicalUrl: String(row.bookmark_canonical_url),
            title: String(row.bookmark_source_title),
          },
        }
      : {}),
    mentions: mentions.map((mention) => ({
      id: mention.id,
      handle: mention.handle,
      displayName: mention.display_name,
    })),
  };
  return ClipCommentSchema.parse(
    row.deleted_at
      ? {
          ...common,
          status: "deleted",
          deletionKind: row.deletion_kind,
          deletedBy: {
            id: row.deleted_by,
            handle: row.deleted_by_handle,
            displayName: row.deleted_by_display_name,
          },
          deletedAt: iso(row.deleted_at),
        }
      : { ...common, status: "active", body: row.body },
  );
}

function mapClipCommentNotice(row: DbRow) {
  return ClipCommentNoticeSchema.parse({
    id: row.id,
    projectId: row.project_id,
    clipId: row.clip_id,
    commentId: row.comment_id,
    commentVersion: Number(row.comment_version),
    reason: row.reason,
    actor: {
      id: row.actor_id,
      handle: row.actor_handle,
      displayName: row.actor_display_name,
    },
    ...(row.source_time_ms === null || row.source_time_ms === undefined
      ? {}
      : { sourceTimeMs: Number(row.source_time_ms) }),
    state: row.state,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    ...(row.seen_at ? { seenAt: iso(row.seen_at) } : {}),
  });
}

function mapUser(row: DbRow | undefined): User {
  if (!row) throw new CatalogNotFoundError("User not found.");
  return UserSchema.parse({
    id: row.id,
    externalSubject: row.external_subject,
    handle: row.handle,
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
    ...(row.delivery_batch_id && row.batch_item_id
      ? {
          sourceGroup: {
            batchId: row.delivery_batch_id,
            batchItemId: row.batch_item_id,
          },
        }
      : {}),
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
    ...(request.requestOrigin ? { requestOrigin: request.requestOrigin } : {}),
    clipId: request.clipId,
    video: request.video,
    selection: request.selection,
    sourceLanguageClass: request.sourceLanguageClass,
    ...(request.sourceRights ? { sourceRights: request.sourceRights } : {}),
    ...(request.noSpeechAttestation
      ? { noSpeechAttestation: request.noSpeechAttestation }
      : {}),
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
    ...(request.batchItemId ? { batchItemId: request.batchItemId } : {}),
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
  if (
    sha256Fingerprint(result.noSpeechAttestation ?? null) !==
    sha256Fingerprint(request.noSpeechAttestation ?? null)
  ) {
    throw new CatalogConflictError(
      "Export result speech attestation does not match the immutable queued request.",
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

  if (request.noSpeechAttestation) {
    const expectedRoles =
      request.sourceLanguageClass === "confirmed_english"
        ? ["english"]
        : ["english", "original"];
    const sidecars = result.subtitleSidecars ?? [];
    const actualRoles = sidecars.map((sidecar) => sidecar.role).sort();
    if (
      result.subtitleOmissionProvenance ||
      result.englishSubtitleProvenance ||
      sidecars.length !== expectedRoles.length ||
      expectedRoles.some((role, index) => actualRoles[index] !== role) ||
      sidecars.some(
        (sidecar) =>
          !("emptyReason" in sidecar) ||
          sidecar.emptyReason !== "attested_no_speech" ||
          sidecar.cueCount !== 0 ||
          sha256Fingerprint(sidecar.noSpeechAttestation) !==
            sha256Fingerprint(request.noSpeechAttestation),
      )
    ) {
      throw new CatalogConflictError(
        "No-speech subtitle result does not match the immutable attestation and language policy.",
      );
    }
    return;
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
      const transcriptSelection =
        request.selection.selectionType === "player_time_range"
          ? request.selection.transcriptAttachment
          : request.selection;
      const expectedEnglish =
        request.subtitleTracks?.english ??
        (transcriptSelection
          ? {
              trackId: transcriptSelection.trackId,
              trackVersion: transcriptSelection.transcriptVersion,
            }
          : undefined);
      const actualEnglish = result.englishSubtitleProvenance;
      if (
        !expectedEnglish ||
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

function safeNotificationLabel(value: unknown): string {
  return sanitizeNotificationLabel(value);
}

function exportPresetCommandHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapProject(row: DbRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    visibility: row.visibility,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapProjectSummary(row: DbRow): ProjectSummary {
  return ProjectSummarySchema.parse({
    ...mapProject(row),
    currentUserRole: row.current_user_role,
    memberCount: Number(row.member_count),
  });
}

function mapNotificationEvent(row: DbRow): NotificationEvent {
  const common = {
    id: String(row.id),
    createdAt: iso(row.created_at),
    ...(row.project_label === null
      ? {}
      : { projectLabel: safeNotificationLabel(row.project_label) }),
    ...(row.source_label === null
      ? {}
      : { sourceLabel: safeNotificationLabel(row.source_label) }),
    ...(row.clip_label === null
      ? {}
      : { clipLabel: safeNotificationLabel(row.clip_label) }),
  };
  if (row.event_type === "transcription_batch_terminal") {
    return NotificationEventSchema.parse({
      ...common,
      kind: row.event_type,
      status: row.status,
      batchLabel: safeNotificationLabel(row.batch_label),
      navigation: {
        kind: "transcription",
        projectId: row.project_id,
        batchId: row.batch_id,
        ...(row.video_id === null ? {} : { videoId: row.video_id }),
      },
    });
  }
  if (row.event_type === "transcription_action_needed") {
    return NotificationEventSchema.parse({
      ...common,
      kind: row.event_type,
      status: row.status,
      batchLabel: safeNotificationLabel(row.batch_label),
      navigation: {
        kind: "transcription",
        projectId: row.project_id,
        batchId: row.batch_id,
        ...(row.video_id === null ? {} : { videoId: row.video_id }),
      },
    });
  }
  if (row.event_type === "logged_export_terminal") {
    return NotificationEventSchema.parse({
      ...common,
      kind: row.event_type,
      status: row.status,
      navigation: {
        kind: "logged_export",
        projectId: row.project_id,
        clipId: row.clip_id,
        requestId: row.export_request_id,
      },
    });
  }
  return NotificationEventSchema.parse({
    ...common,
    kind: "mention",
    status: "mentioned",
    actorLabel: safeNotificationLabel(row.actor_label),
    navigation: {
      kind: "mention",
      projectId: row.project_id,
      clipId: row.clip_id,
      commentId: row.comment_id,
      ...(row.source_time_ms === null
        ? {}
        : { sourceTimeMs: Number(row.source_time_ms) }),
    },
  });
}

function hashCommand(command: unknown): string {
  return createHash("sha256").update(canonicalJson(command)).digest("hex");
}

function mapProjectBookmark(row: DbRow): ProjectBookmark {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    videoId: String(row.video_id),
    sourceTimeMs: Number(row.source_time_ms),
    ...(row.title === null ? {} : { title: String(row.title) }),
    ...(row.note === null ? {} : { note: String(row.note) }),
    state: row.state as "active" | "archived",
    version: Number(row.version),
    createdBy: {
      userId: String(row.created_by),
      handle: String(row.created_by_handle),
      displayName: String(row.created_by_display_name),
    },
    updatedBy: {
      userId: String(row.updated_by),
      handle: String(row.updated_by_handle),
      displayName: String(row.updated_by_display_name),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.bookmark_youtube_video_id &&
    row.bookmark_canonical_url &&
    row.bookmark_source_title
      ? {
          source: {
            youtubeVideoId: String(row.bookmark_youtube_video_id),
            canonicalUrl: String(row.bookmark_canonical_url),
            title: String(row.bookmark_source_title),
          },
        }
      : {}),
  };
}

function parseBookmarkCursor(value: string): {
  identity: string;
  sourceTimeMs: number;
  id: string;
} {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed.identity !== "string" ||
      !Number.isSafeInteger(parsed.sourceTimeMs) ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new CatalogInvalidRequestError("Bookmark cursor is invalid.");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
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
  const selection = ClipSelectionSchema.parse(
    row.selection_snapshot ?? {
      selectionType: "transcript_range",
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
  );
  const evidence =
    languageEvidence ??
    (Number(row.language_evidence_schema_version) === 3
      ? ({
          schemaVersion: 3,
          state: "unavailable",
          reason:
            selection.selectionType === "player_time_range"
              ? selection.speechStatus
              : "transcript_unavailable",
        } satisfies ClipLanguageEvidence)
      : ({
          schemaVersion: 1,
          englishText: String(row.english_text),
          ...(row.original_text
            ? { originalText: String(row.original_text) }
            : {}),
        } satisfies ClipLanguageEvidence));
  return ClipCandidateSchema.parse({
    id: row.id,
    projectId: row.project_id,
    catalogVideoId: row.video_id,
    video: {
      youtubeVideoId: row.youtube_video_id,
      canonicalUrl: row.canonical_url,
      sourceIdentity: {
        schemaVersion: 1,
        provider: row.source_provider ?? "youtube",
        providerMediaId: row.provider_media_id ?? row.youtube_video_id,
        canonicalUrl: row.canonical_url,
      },
      title: row.video_title,
      ...(row.video_channel ? { channel: row.video_channel } : {}),
      ...(row.source_language ? { sourceLanguage: row.source_language } : {}),
    },
    selection,
    languageEvidence: evidence,
    ...(row.english_text ? { englishText: row.english_text } : {}),
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

function mapLoggedExportBatchRows(rows: DbRow[]): LoggedExportBatch {
  if (!rows[0]) throw new CatalogNotFoundError("Export batch not found.");
  const counts = {
    queued: 0,
    claimed: 0,
    processing: 0,
    needsUserAction: 0,
    complete: 0,
    failed: 0,
    canceled: 0,
  };
  const items = rows.map((row) => {
    const state = String(row.state);
    if (state === "needs_user_action") counts.needsUserAction += 1;
    else if (state in counts) counts[state as keyof typeof counts] += 1;
    else
      throw new CatalogConflictError("Export batch contains an invalid state.");
    const currentRequest = mapLoggedExportRequest(row);
    return {
      id: row.batch_item_id_value,
      batchId: row.batch_id,
      ordinal: Number(row.batch_item_ordinal),
      clipId: row.batch_clip_id,
      rootRequestId: row.root_export_request_id,
      currentRequest: {
        id: currentRequest.id,
        jobId: currentRequest.jobId,
        state: currentRequest.state,
        ...(currentRequest.retryOfRequestId
          ? {
              retryOfRequestId: currentRequest.retryOfRequestId,
              retryOrdinal: currentRequest.retryOrdinal,
            }
          : {}),
      },
      ...(row.progress_execution_id
        ? {
            progress: mapLoggedExportProgress({
              execution_id: row.progress_execution_id,
              export_request_id: row.progress_export_request_id,
              attempt: row.progress_attempt,
              sequence: row.progress_sequence,
              stage: row.progress_stage,
              basis_points: row.progress_basis_points,
              updated_at: row.progress_updated_at,
            }),
          }
        : {}),
    };
  });
  const total = items.length;
  const terminal = counts.complete + counts.failed + counts.canceled;
  return LoggedExportBatchSchema.parse({
    id: rows[0].batch_id,
    projectId: rows[0].batch_project_id,
    createdAt: iso(rows[0].batch_created_at),
    summary: {
      total,
      ...counts,
      status:
        counts.complete === total
          ? "complete"
          : terminal === total
            ? "mixed_terminal"
            : "active",
    },
    items,
  });
}

function mapLoggedExportRequest(row: DbRow): ExportRequest {
  const selection = ClipSelectionSchema.parse(row.selection_snapshot);
  const noSpeechAttestation =
    selection.selectionType === "player_time_range"
      ? selection.noSpeechAttestation
      : undefined;
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
    ...(row.request_origin
      ? { requestOrigin: String(row.request_origin) }
      : {}),
    projectId: row.project_id,
    clipId: row.clip_id,
    ...(row.retry_of_request_id
      ? {
          retryOfRequestId: row.retry_of_request_id,
          retryOrdinal: Number(row.retry_ordinal),
        }
      : {}),
    ...(row.batch_item_id ? { batchItemId: row.batch_item_id } : {}),
    video: row.video_snapshot,
    selection,
    sourceLanguageClass: row.source_language_class,
    ...(row.source_rights_snapshot
      ? { sourceRights: row.source_rights_snapshot }
      : {}),
    ...(row.subtitle_tracks_snapshot
      ? { subtitleTracks: row.subtitle_tracks_snapshot }
      : {}),
    ...(noSpeechAttestation ? { noSpeechAttestation } : {}),
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

function assertExportSourceRightsMatchVideo(
  sourceRights: ExportRequest["sourceRights"],
  video: ExportRequest["video"],
): asserts sourceRights is NonNullable<ExportRequest["sourceRights"]> {
  if (!sourceRights) {
    throw new CatalogValidationError(
      "A new export command requires an exact source-rights confirmation snapshot.",
    );
  }
  if (sourceRights.youtubeVideoId !== video.youtubeVideoId) {
    throw new CatalogValidationError(
      "The source-rights confirmation does not match this exact clip video.",
    );
  }
}

function mapArtifactVersionSummary(row: DbRow) {
  const result = LoggedExportSuccessResultSchema.parse(
    typeof row.result_json === "string"
      ? JSON.parse(row.result_json)
      : row.result_json,
  );
  const manifest = result.artifacts.find(
    (artifact) => artifact.role === "manifest_json",
  );
  if (!manifest) {
    throw new CatalogConflictError(
      "Immutable export history is missing its manifest artifact identity.",
    );
  }
  const packageIdentity = result.artifacts[0]!.packageIdentity;
  const selection = ClipSelectionSchema.parse(row.selection_snapshot);
  const noSpeechAttestation =
    selection.selectionType === "player_time_range"
      ? selection.noSpeechAttestation
      : undefined;
  return ArtifactVersionSummarySchema.parse({
    artifactVersionId: row.artifact_version_id,
    requestId: row.id,
    jobId: row.job_id,
    projectId: row.project_id,
    clipId: row.clip_id,
    requestOrigin: row.request_origin ? String(row.request_origin) : null,
    ...(row.retry_of_request_id
      ? {
          retryOfRequestId: row.retry_of_request_id,
          retryOrdinal: Number(row.retry_ordinal),
        }
      : {}),
    ...(row.batch_item_id ? { batchItemId: row.batch_item_id } : {}),
    packageIdentity,
    video: row.video_snapshot,
    selection,
    sourceLanguageClass: row.source_language_class,
    ...(row.source_rights_snapshot
      ? { sourceRights: row.source_rights_snapshot }
      : {}),
    ...(row.subtitle_tracks_snapshot
      ? { subtitleTracks: row.subtitle_tracks_snapshot }
      : {}),
    ...(noSpeechAttestation ? { noSpeechAttestation } : {}),
    preset: row.preset_snapshot,
    resolvedSettingsSnapshot: row.resolved_settings_snapshot,
    resolvedExportBounds: result.resolvedExportBounds,
    renderedMediaProvenance: result.renderedMediaProvenance,
    thumbnailProvenance: result.thumbnailProvenance,
    ...(result.subtitleOmissionProvenance
      ? { subtitleOmissionProvenance: result.subtitleOmissionProvenance }
      : {}),
    ...(result.englishSubtitleProvenance
      ? { englishSubtitleProvenance: result.englishSubtitleProvenance }
      : {}),
    ...(result.subtitleSidecars
      ? { subtitleSidecars: result.subtitleSidecars }
      : {}),
    artifacts: result.artifacts,
    manifest: {
      contentSha256: manifest.contentSha256,
      // M5 success lineage stores the manifest hash but no verified schema
      // number. M6-02 may enrich local availability after reading the bytes;
      // cloud history must not guess.
      schemaVersion: "unknown",
    },
    resultFingerprint: row.result_fingerprint,
    completedAt: iso(row.reconciled_at),
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

function sourceProviderFromRow(value: unknown): SourceProvider {
  return value === "tiktok" || value === "instagram" || value === "facebook"
    ? value
    : "youtube";
}

function mapVideo(row: DbRow | undefined): Video {
  if (!row) throw new CatalogNotFoundError("Video not found.");
  return VideoSchema.parse({
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    canonicalUrl: row.canonical_url,
    sourceIdentity: {
      schemaVersion: 1,
      provider: row.source_provider ?? "youtube",
      providerMediaId: row.provider_media_id ?? row.youtube_video_id,
      canonicalUrl: row.canonical_url,
    },
    ...(row.source_fingerprint_evidence
      ? { sourceFingerprint: row.source_fingerprint_evidence }
      : {}),
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

function mapProjectVideoOwnFlag(row: DbRow) {
  return {
    active: Boolean(row.own_flag_active ?? row.active),
    version: Number(row.own_flag_version ?? row.version),
    createdAt: iso(row.own_flag_created_at ?? row.created_at),
    updatedAt: iso(row.own_flag_updated_at ?? row.updated_at),
    ...((row.own_flag_deactivated_at ?? row.deactivated_at) === null ||
    (row.own_flag_deactivated_at ?? row.deactivated_at) === undefined
      ? {}
      : {
          deactivatedAt: iso(row.own_flag_deactivated_at ?? row.deactivated_at),
        }),
  };
}

function mapProjectVideoClaim(row: DbRow, currentUserId: string, now: Date) {
  return {
    claimant: {
      userId: String(row.claimant_user_id),
      handle: String(row.handle),
      displayName: String(row.display_name),
    },
    isCurrentUser: String(row.claimant_user_id) === currentUserId,
    active: Date.parse(iso(row.expires_at)) > now.getTime(),
    generation: Number(row.generation),
    version: Number(row.version),
    claimedAt: iso(row.claimed_at),
    heartbeatAt: iso(row.heartbeat_at),
    expiresAt: iso(row.expires_at),
  };
}

function mapProjectVideoReviewCycle(row: DbRow) {
  return {
    id: String(row.id),
    cycleNumber: Number(row.cycle_number),
    status: String(row.status),
    version: Number(row.version),
    openedAt: iso(row.opened_at),
    ...(row.opened_by
      ? {
          openedBy: mapCurrentOrFormerProjectActor(
            row.opened_by,
            row.opened_handle,
            row.opened_display_name,
          ),
        }
      : {}),
    ...(row.reopen_reason ? { reopenReason: String(row.reopen_reason) } : {}),
    ...(row.completion_policy
      ? { completionPolicy: String(row.completion_policy) }
      : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.completed_by
      ? {
          completedBy: mapCurrentOrFormerProjectActor(
            row.completed_by,
            row.completed_handle,
            row.completed_display_name,
          ),
        }
      : {}),
    ...(row.completion_basis
      ? { completionBasis: String(row.completion_basis) }
      : {}),
    ...(row.transcript_version_id
      ? { transcriptVersionId: String(row.transcript_version_id) }
      : {}),
  };
}

function mapProjectVideoTriage(row: DbRow) {
  return {
    state: String(row.triage_state),
    version: Number(row.triage_version),
    ...(row.dismissed_at ? { dismissedAt: iso(row.dismissed_at) } : {}),
    ...(row.dismissed_by
      ? {
          dismissedBy: mapCurrentOrFormerProjectActor(
            row.dismissed_by,
            row.dismissed_handle,
            row.dismissed_display_name,
          ),
        }
      : {}),
    ...(row.dismissal_reason ? { reason: String(row.dismissal_reason) } : {}),
  };
}

function mapCurrentOrFormerProjectActor(
  userId: unknown,
  handle: unknown,
  displayName: unknown,
) {
  return {
    userId: String(userId),
    handle: handle ? String(handle) : "former_member",
    displayName: displayName ? String(displayName) : "Former project member",
  };
}

function mapProjectVideoActivityReceipt(row: DbRow) {
  return {
    eventId: String(row.event_id),
    projectId: String(row.project_id),
    videoId: String(row.video_id),
    videoTitle: String(row.video_title),
    eventType: String(row.event_type),
    actor: {
      userId: String(row.actor_id),
      handle: String(row.actor_handle),
      displayName: String(row.actor_display_name),
    },
    ...(row.reason ? { reason: String(row.reason) } : {}),
    state: String(row.state),
    version: Number(row.version),
    createdAt: iso(row.event_created_at),
    ...(row.seen_at ? { seenAt: iso(row.seen_at) } : {}),
  };
}

function mapProjectKeywordScanJob(row: DbRow): ProjectKeywordScanJob {
  return ProjectKeywordScanJobSchema.parse({
    id: row.id,
    projectId: row.project_id,
    projectVideoId: row.video_id,
    transcriptVersionId: row.transcript_version_id,
    keywordSetVersion: Number(row.keyword_set_version),
    scannerSchemaVersion: Number(row.scanner_schema_version),
    state: row.state,
    attempt: Number(row.attempt),
    approvedKeywordCount: Number(row.approved_keyword_count),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapProjectVideoWorklistProcessingState(
  state: string,
): ProjectVideoWorklistProcessingState {
  if (state === "ready_for_review") return "ready";
  if (
    [
      "queued",
      "resolving",
      "acquiring",
      "transcribing",
      "translating",
      "aligning",
      "uploading",
      "needs_language_confirmation",
      "blocked",
      "failed",
      "canceled",
    ].includes(state)
  ) {
    return state as ProjectVideoWorklistProcessingState;
  }
  return "not_requested";
}

function mapProviderLanguageEvidence(row: DbRow): ProviderLanguageEvidence {
  return ProviderLanguageEvidenceSchema.parse({
    id: row.id,
    projectId: row.project_id,
    videoId: row.video_id,
    source: row.source,
    provider: row.provider,
    ...(row.reported_language === null || row.reported_language === undefined
      ? {}
      : { reportedLanguage: row.reported_language }),
    ...(row.track_fingerprint === null || row.track_fingerprint === undefined
      ? {}
      : { trackFingerprint: row.track_fingerprint }),
    ...(row.caption_kind === null || row.caption_kind === undefined
      ? {}
      : { captionKind: row.caption_kind }),
    ...(row.job_id === null || row.job_id === undefined
      ? {}
      : { jobId: row.job_id }),
    ...(row.attempt === null || row.attempt === undefined
      ? {}
      : { attempt: Number(row.attempt) }),
    createdAt: iso(row.created_at),
  });
}

function mapProjectVideoLanguageDecision(row: DbRow) {
  return ProjectVideoLanguageDecisionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    videoId: row.video_id,
    decisionVersion: Number(row.decision_version),
    status: row.status,
    basis: row.basis,
    ...(row.resolved_language === null || row.resolved_language === undefined
      ? {}
      : { resolvedLanguage: row.resolved_language }),
    ...(row.evidence_id === null || row.evidence_id === undefined
      ? {}
      : { evidenceId: row.evidence_id }),
    actorId: row.actor_id,
    createdAt: iso(row.created_at),
  });
}

function isImportableSourceLanguage(value: unknown): boolean {
  const parsed = LanguageTagSchema.safeParse(value);
  if (!parsed.success) return false;
  const language = primaryLanguage(parsed.data);
  return language !== "en" && language !== "und" && language !== "mul";
}

function transcriptionJobIdempotencyKey(
  projectId: string,
  catalogVideoId: string,
  payload: ReturnType<typeof TranscriptionJobPayloadSchema.parse>,
) {
  return [
    "transcription",
    projectId,
    catalogVideoId,
    payload.transcriptionProfile,
    payload.targetLanguage,
    payload.sourcePolicy,
    payload.translationConsent
      ? `translate-${payload.translationConsent.provider}-v${payload.translationConsent.disclosureVersion}`
      : "translate-disabled",
    payload.creatorReportedLanguage ?? "creator-unknown",
    payload.languageDecision
      ? `decision-${payload.languageDecision.decisionId}-v${payload.languageDecision.decisionVersion}-${payload.languageDecision.status}-${payload.languageDecision.resolvedLanguage ?? "unresolved"}`
      : "decision-none",
    "schema-2",
  ].join(":");
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
    ...(row.provider_media_id === null || row.canonical_url === null
      ? {}
      : {
          sourceIdentity: {
            schemaVersion: 1,
            provider: row.source_provider ?? "youtube",
            providerMediaId: row.provider_media_id,
            canonicalUrl: row.canonical_url,
          },
        }),
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
    ...(row.language_gate === null || row.language_gate === undefined
      ? {}
      : {
          languageGate: LanguageGateSchema.parse(
            typeof row.language_gate === "string"
              ? JSON.parse(row.language_gate)
              : row.language_gate,
          ),
        }),
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

function mapProjectMemberSummary(row: DbRow): ProjectMemberSummary {
  return ProjectMemberSummarySchema.parse({
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    user: {
      id: row.user_id,
      handle: row.handle,
      displayName: row.display_name,
    },
  });
}

function mapProjectInvitation(row: DbRow): ProjectInvitation {
  return ProjectInvitationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    invitee: { id: row.invitee_user_id, handle: row.invitee_handle },
    inviter: { id: row.inviter_user_id, handle: row.inviter_handle },
    role: row.role,
    state: row.state,
    version: Number(row.version),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapProjectGovernanceEvent(row: DbRow): ProjectGovernanceEvent {
  return ProjectGovernanceEventSchema.parse({
    id: row.id,
    projectId: row.project_id,
    eventType: row.event_type,
    actorId: row.actor_user_id,
    ...(row.target_user_id ? { targetUserId: row.target_user_id } : {}),
    createdAt: iso(row.created_at),
  });
}

async function insertGovernanceEvent(
  database: CloudDatabase,
  projectId: string,
  eventType: ProjectGovernanceEvent["eventType"],
  actorId: string,
  targetUserId: string | undefined,
  createdAt: string,
): Promise<void> {
  await database.query(
    `INSERT INTO project_governance_audit_events
       (id, project_id, event_type, actor_user_id, target_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      projectId,
      eventType,
      actorId,
      targetUserId ?? null,
      createdAt,
    ],
  );
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
  const countReview = (status: TranscriptionBatchItem["reviewStatus"]) =>
    items.filter(
      (item) =>
        item.state === "ready_for_review" && item.reviewStatus === status,
    ).length;
  return {
    total: items.length,
    queued: countState("queued"),
    active: items.filter(
      (item) =>
        transcriptionActiveStates.has(item.state) || item.state === "canceling",
    ).length,
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

const transcriptionActiveStates = new Set<TranscriptionBatchItem["state"]>([
  "resolving",
  "acquiring",
  "transcribing",
  "translating",
  "aligning",
  "uploading",
]);

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
