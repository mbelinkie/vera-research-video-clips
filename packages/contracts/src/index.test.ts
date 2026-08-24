import { describe, expect, it } from "vitest";

import {
  AcceptLoggedExportDeliveryRequestSchema,
  ActivateManualTimedTranscriptCandidateRequestSchema,
  ArtifactVersionHistoryQuerySchema,
  ArtifactVersionHistoryResponseSchema,
  ArtifactVersionSummarySchema,
  ArtifactLocatorSummarySchema,
  ArtifactCompatibilityRequirementsSchema,
  ArtifactCompatibilityResolutionSchema,
  AuthoringArtifactDescriptorRequestSchema,
  ArtifactLocatorActionRequestSchema,
  ArtifactResolutionResultSchema,
  RelinkArtifactLocatorRequestSchema,
  ArtifactRootSummarySchema,
  ConfigureLocalArtifactRootRequestSchema,
  CancelLoggedExportRequestSchema,
  BatchPreflightRequestSchema,
  CloudTranslationConsentSchema,
  ClipCommentSchema,
  ClipCommentListQuerySchema,
  ClipCommentPageSchema,
  OfflineClipCommentMutationResultSchema,
  OfflineClipCommentReplayResultSchema,
  CreateProjectBookmarkRequestSchema,
  LocalProjectBookmarkPageSchema,
  OfflineProjectBookmarkMutationResultSchema,
  ProjectBookmarkQuerySchema,
  ProjectBookmarkSchema,
  UpdateProjectBookmarkRequestSchema,
  ClipSelectionSchema,
  ClipLanguageEvidenceV2Schema,
  CreateClipCommentRequestSchema,
  CreateClipCandidateRequestSchema,
  CreateExportOnlyRequestSchema,
  UpdateClipCommentRequestSchema,
  DeleteClipCommentRequestSchema,
  InitialClipCommentSchema,
  CreateProjectVideoLanguageDecisionRequestSchema,
  ClipLibraryPageSchema,
  ClipLibraryQuerySchema,
  CreateClipExportRequestSchema,
  CreateLoggedExportBatchRequestSchema,
  CreateTranscriptionBatchRequestSchema,
  CreateManualTimedTranscriptImportRequestSchema,
  DesktopApiRequestSchema,
  DesktopTimedTranscriptUploadRequestSchema,
  DesktopStatusSchema,
  ComponentHealthSchema,
  ReadinessReportSchema,
  SetupActionSchema,
  SetupSnapshotSchema,
  ModelDownloadProgressSchema,
  deriveReadinessReport,
  ExportRequestOriginSchema,
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
  EmptySubtitleSidecarProvenanceSchema,
  ExportPresetCatalogEntrySchema,
  ExportPresetDefaultSchema,
  ExportPresetSnapshotSchema,
  ExportSettingsSchema,
  ExportStoragePreflightSchema,
  ExportStorageSafetyReserveBytes,
  InstalledExportWorkerCapabilitySummarySchema,
  ClaimLoggedExportDeliveryRequestSchema,
  LoggedExportDeliverySchema,
  LoggedExportCanceledResultSchema,
  LoggedExportExecutionSchema,
  LoggedExportBatchSummarySchema,
  LoggedExportProgressSnapshotSchema,
  HeartbeatLoggedExportExecutionRequestSchema,
  GetLoggedExportProgressResponseSchema,
  LoggedExportFailureResultSchema,
  LoggedExportFailureSchema,
  LoggedExportSuccessResultSchema,
  LoggedExportSuccessSchema,
  LocalClipLibraryPageSchema,
  LocalAuthoringArtifactDescriptorSchema,
  LocalOperationFailureSchema,
  LocalRuntimeDrainResultSchema,
  LocalRuntimeQuiescenceSchema,
  LookupDerivedTranslationSchema,
  LanguageCapabilityResultSchema,
  LanguageDecisionSnapshotSchema,
  LanguageGateSchema,
  ProjectVideoLanguageDecisionSchema,
  ProviderLanguageEvidenceSchema,
  PrepareClipLibraryExportRequestSchema,
  SubmitClipLibraryExportRequestSchema,
  UpdateLocalClipLibrarySelectionSchema,
  ProcessAcceptedLoggedExportRequestSchema,
  ProcessAcceptedLoggedExportResponseSchema,
  ReconcileLoggedExportCanceledRequestSchema,
  ReconcileLoggedExportFailureRequestSchema,
  ReconcileLoggedExportSuccessRequestSchema,
  ReexportArtifactVersionRequestSchema,
  RetryLoggedExportRequestSchema,
  RetryLoggedExportResponseSchema,
  StartLoggedExportExecutionResponseSchema,
  FinalArtifactProvenanceSchema,
  HealthResponseSchema,
  HostedTranscriptionApprovalSchema,
  JobSchema,
  AddProjectMemberRequestSchema,
  CreateProjectRequestSchema,
  CreateProjectInvitationRequestSchema,
  DecideProjectInvitationRequestSchema,
  RevokeProjectInvitationRequestSchema,
  JoinOpenProjectRequestSchema,
  UpdateProjectGovernanceRequestSchema,
  ProjectInvitationSchema,
  OpenProjectDiscoverySchema,
  ProjectGovernanceEventSchema,
  ProjectSummarySchema,
  ProjectSchema,
  SourceIdentityV1Schema,
  SourceRightsSnapshotSchema,
  SourceSearchRequestSchema,
  ProjectVideoWorklistPageSchema,
  ProjectVideoWorklistQuerySchema,
  ProjectLocalProcessingStatusSchema,
  ProjectKeywordCatalogSchema,
  SuggestProjectKeywordRequestSchema,
  ReviewProjectKeywordSuggestionRequestSchema,
  WithdrawProjectKeywordSuggestionRequestSchema,
  UpdateProjectKeywordRequestSchema,
  UpdateProjectKeywordAliasRequestSchema,
  ProjectKeywordMatchArtifactSchema,
  ProjectKeywordScanSummarySchema,
  FinalizeProjectKeywordScanRequestSchema,
  UpdateProjectLocalProcessingRequestSchema,
  UpdateProjectLocalProcessingResponseSchema,
  UpdateProjectVideoClaimRequestSchema,
  UpdateProjectVideoGovernanceRequestSchema,
  BulkUpdateProjectVideoPriorityRequestSchema,
  UpdateProjectVideoReviewRequestSchema,
  UpdateProjectVideoTriageRequestSchema,
  ProjectVideoActivityPageSchema,
  MarkProjectVideoActivitySeenRequestSchema,
  UpdateOwnProjectVideoFlagRequestSchema,
  RegisterUserRequestSchema,
  UserHandleSchema,
  normalizeUserHandle,
  FinalizeManualTimedTranscriptImportRequestSchema,
  ManualTimedTranscriptImportStatusSchema,
  ManualTimedTranscriptImportUploadGrantSchema,
  ManualTimedTranscriptActivationStatusSchema,
  ManualTimedTranscriptCandidateReviewPageSchema,
  ManualTimedTranscriptCandidateReviewQuerySchema,
  TranscriptManifestSchema,
  TranscriptTrackSchema,
  TranscriptWorkspaceResponseSchema,
  TranscriptionBatchControlRequestSchema,
  UpdateHostedTranscriptionApprovalRequestSchema,
  UpdateReviewStatusRequestSchema,
  UpdatePreferredLanguageRequestSchema,
  WorkerTranslateTranscriptRequestSchema,
  WorkerObserveLanguageEvidenceRequestSchema,
  DesktopNotificationNavigationTargetSchema,
  DesktopNotificationPreferencesSchema,
  NotificationEventSchema,
  NotificationFeedPageSchema,
  NotificationFeedQuerySchema,
  sanitizeNotificationLabel,
  formatLanguageLabel,
  languagesEquivalent,
  primaryLanguage,
} from "./index.ts";

const now = "2026-08-01T12:00:00.000Z";
const id = "019fbb95-cd76-7920-93fa-e23ba755ee3f";

describe("shared contracts", () => {
  it("keeps transcript and player selections distinct without fabricated transcript fields", () => {
    const attachment = {
      selectionType: "transcript_range" as const,
      trackId: id,
      transcriptVersion: 2,
      firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
      transcriptStartMs: 1_000,
      transcriptEndMs: 2_000,
      exportStartMs: 900,
      exportEndMs: 2_100,
      text: "Exact overlapping evidence",
      timingPrecision: "cue" as const,
    };
    const playerSelection = {
      selectionType: "player_time_range" as const,
      sourceStartMs: 1_000,
      sourceEndMs: 2_000,
      exportStartMs: 900,
      exportEndMs: 2_100,
      origin: "manual_player" as const,
      speechStatus: "speech" as const,
      transcriptAttachment: attachment,
    };
    expect(ClipSelectionSchema.parse(playerSelection)).toEqual(playerSelection);
    expect(
      ClipSelectionSchema.safeParse({
        ...playerSelection,
        trackId: id,
        text: "fabricated hybrid",
      }).success,
    ).toBe(false);
    expect(
      ClipSelectionSchema.safeParse({
        ...playerSelection,
        sourceEndMs: 1_000,
      }).success,
    ).toBe(false);
    expect(
      ClipSelectionSchema.safeParse({
        ...playerSelection,
        transcriptAttachment: {
          ...attachment,
          transcriptStartMs: 999,
        },
      }).success,
    ).toBe(false);
  });

  it("requires explicit context for no-speech and transcript-unavailable clip logs", () => {
    const actor = {
      schemaVersion: 1 as const,
      actor: {
        id,
        handle: "vera_researcher",
        displayName: "VERA Researcher",
      },
      attestedAt: now,
    };
    const video = {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Fixture video",
    };
    const noSpeech = {
      selectionType: "player_time_range" as const,
      sourceStartMs: 1_000,
      sourceEndMs: 2_000,
      exportStartMs: 1_000,
      exportEndMs: 2_000,
      origin: "manual_player" as const,
      speechStatus: "no_speech" as const,
      noSpeechAttestation: actor,
    };
    const base = {
      idempotencyKey: "player-log",
      video,
      selection: noSpeech,
      tags: [],
    };
    expect(CreateClipCandidateRequestSchema.safeParse(base).success).toBe(
      false,
    );
    expect(
      CreateClipCandidateRequestSchema.parse({
        ...base,
        notes: "Silent title card used as visual context.",
      }).selection,
    ).toEqual(noSpeech);
    expect(
      CreateClipCandidateRequestSchema.parse({
        ...base,
        idempotencyKey: "transcript-unavailable-log",
        selection: {
          ...noSpeech,
          speechStatus: "transcript_unavailable",
          noSpeechAttestation: undefined,
        },
        firstComment: { body: "Review the exact source range manually." },
      }).firstComment,
    ).toEqual({ body: "Review the exact source range manually." });
  });

  it("exports only attested no-speech or player speech with exact transcript evidence", () => {
    const noSpeechAttestation = {
      schemaVersion: 1 as const,
      actor: {
        id,
        handle: "vera_researcher",
        displayName: "VERA Researcher",
      },
      attestedAt: now,
    };
    const transcriptAttachment = {
      selectionType: "transcript_range" as const,
      trackId: id,
      transcriptVersion: 1,
      firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
      transcriptStartMs: 100,
      transcriptEndMs: 900,
      exportStartMs: 0,
      exportEndMs: 1_000,
      text: "Verified speech",
      timingPrecision: "cue" as const,
    };
    const base = {
      idempotencyKey: "player-export",
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture video",
        sourceLanguage: "en",
      },
      sourceLanguageClass: "confirmed_english" as const,
      sourceRights: {
        schemaVersion: 1 as const,
        source: "youtube" as const,
        youtubeVideoId: "M7lc1UVf-VE",
        confirmation: "authorized_to_process" as const,
        disclosureVersion: 1,
      },
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4" as const,
          videoCodec: "h264" as const,
          videoRateControl: { mode: "crf" as const, value: 20 },
          frameRate: "source" as const,
          audioCodec: "aac" as const,
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
    };
    const playerBase = {
      selectionType: "player_time_range" as const,
      sourceStartMs: 100,
      sourceEndMs: 900,
      exportStartMs: 0,
      exportEndMs: 1_000,
      origin: "manual_player" as const,
    };
    expect(
      CreateExportOnlyRequestSchema.safeParse({
        ...base,
        selection: { ...playerBase, speechStatus: "speech" },
      }).success,
    ).toBe(false);
    expect(
      CreateExportOnlyRequestSchema.safeParse({
        ...base,
        selection: {
          ...playerBase,
          speechStatus: "transcript_unavailable",
        },
      }).success,
    ).toBe(false);
    expect(
      CreateExportOnlyRequestSchema.parse({
        ...base,
        selection: {
          ...playerBase,
          speechStatus: "speech",
          transcriptAttachment,
        },
      }).selection,
    ).toMatchObject({ speechStatus: "speech", transcriptAttachment });
    const noSpeechRequest = {
      ...base,
      selection: {
        ...playerBase,
        speechStatus: "no_speech" as const,
        noSpeechAttestation,
      },
      noSpeechAttestation,
    };
    expect(CreateExportOnlyRequestSchema.parse(noSpeechRequest)).toMatchObject({
      selection: noSpeechRequest.selection,
      noSpeechAttestation,
    });
    expect(
      CreateExportOnlyRequestSchema.safeParse({
        ...noSpeechRequest,
        noSpeechAttestation: {
          ...noSpeechAttestation,
          attestedAt: "2026-08-01T12:00:01.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("represents attested zero-cue sidecars without transcript sentinels", () => {
    const sidecar = EmptySubtitleSidecarProvenanceSchema.parse({
      role: "english",
      language: "en",
      emptyReason: "attested_no_speech",
      noSpeechAttestation: {
        schemaVersion: 1,
        actor: {
          id,
          handle: "vera_researcher",
          displayName: "VERA Researcher",
        },
        attestedAt: now,
      },
      cueCount: 0,
      byteSize: 1,
      contentSha256: "a".repeat(64),
      startMs: 0,
      endMs: 0,
      sourceAttempt: 1,
      validatedAt: now,
    });
    expect(sidecar).not.toHaveProperty("trackId");
    expect(sidecar).not.toHaveProperty("trackVersion");
    expect(
      EmptySubtitleSidecarProvenanceSchema.safeParse({
        ...sidecar,
        trackId: id,
      }).success,
    ).toBe(false);
  });

  it("validates bounded flat clip comments and body-free tombstones", () => {
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const commentId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const author = {
      id,
      handle: "comment_author",
      displayName: "Comment Author",
    };
    const active = {
      id: commentId,
      projectId: id,
      clipId,
      author,
      status: "active" as const,
      body: "Useful context",
      sourceTimeMs: 1_250,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    expect(ClipCommentSchema.parse(active)).toEqual(active);

    const tombstone = {
      id: commentId,
      projectId: id,
      clipId,
      author,
      status: "deleted" as const,
      deletionKind: "moderation" as const,
      deletedBy: author,
      deletedAt: now,
      version: 2,
      createdAt: now,
      updatedAt: now,
    };
    expect(ClipCommentSchema.parse(tombstone)).toEqual(tombstone);
    expect(
      ClipCommentSchema.safeParse({ ...tombstone, body: "must not leak" })
        .success,
    ).toBe(false);
    expect(
      ClipCommentSchema.safeParse({ ...active, body: "x".repeat(20_001) })
        .success,
    ).toBe(false);

    expect(
      CreateClipCommentRequestSchema.parse({
        idempotencyKey: " create-1 ",
        body: " first comment ",
        sourceTimeMs: 500,
      }),
    ).toEqual({
      idempotencyKey: "create-1",
      body: "first comment",
      sourceTimeMs: 500,
    });
    expect(
      UpdateClipCommentRequestSchema.parse({
        idempotencyKey: "update-1",
        expectedVersion: 1,
        body: "Revised",
        sourceTimeMs: null,
      }),
    ).toMatchObject({ sourceTimeMs: null, expectedVersion: 1 });
    expect(
      DeleteClipCommentRequestSchema.safeParse({
        idempotencyKey: "delete-1",
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      InitialClipCommentSchema.safeParse({ body: " ".repeat(10) }).success,
    ).toBe(false);

    expect(ClipCommentListQuerySchema.parse({ limit: "2" })).toEqual({
      limit: 2,
    });
    expect(ClipCommentListQuerySchema.safeParse({ limit: 51 }).success).toBe(
      false,
    );
    expect(
      ClipCommentPageSchema.parse({
        projectId: id,
        clipId,
        comments: [active, tombstone],
        fetchedAt: now,
      }).comments,
    ).toHaveLength(2);
    expect(
      OfflineClipCommentMutationResultSchema.parse({
        state: "queued",
        outboxId: id,
        commandType: "clip_comment.create.v1",
      }),
    ).toMatchObject({ state: "queued" });
    expect(
      OfflineClipCommentReplayResultSchema.parse({
        applied: 1,
        queued: 0,
        conflicts: 1,
      }),
    ).toEqual({ applied: 1, queued: 0, conflicts: 1 });
  });

  it("keeps provider media identity composite and bounds mixed search requests", () => {
    const youtube = SourceIdentityV1Schema.parse({
      schemaVersion: 1,
      provider: "youtube",
      providerMediaId: "same-provider-id",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    });
    const tiktok = SourceIdentityV1Schema.parse({
      ...youtube,
      provider: "tiktok",
      canonicalUrl: "https://www.tiktok.com/@fixture/video/same-provider-id",
    });
    expect(`${youtube.provider}:${youtube.providerMediaId}`).not.toBe(
      `${tiktok.provider}:${tiktok.providerMediaId}`,
    );
    expect(
      SourceSearchRequestSchema.parse({
        query: "research workflow",
        providers: ["youtube", "tiktok"],
        cursors: { youtube: "page-two" },
      }),
    ).toMatchObject({ pageSize: 12, providers: ["youtube", "tiktok"] });
    expect(() =>
      SourceSearchRequestSchema.parse({
        query: "fixture",
        providers: ["youtube", "youtube"],
      }),
    ).toThrow("unique");
    expect(
      SourceRightsSnapshotSchema.parse({
        schemaVersion: 2,
        sourceIdentity: tiktok,
        confirmation: "authorized_to_process",
        disclosureVersion: 1,
      }),
    ).toMatchObject({ schemaVersion: 2, sourceIdentity: tiktok });
  });

  it("normalizes and bounds project keyword governance", () => {
    const actor = {
      userId: id,
      handle: "keyword_admin",
      displayName: "Keyword Admin",
    };
    const keywordId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const aliasId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const suggestionId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
    expect(
      SuggestProjectKeywordRequestSchema.parse({
        proposedLabel: "Climate change",
        language: "EN_us",
        phrase: "  Climate\u00a0 CHANGE  ",
        idempotencyKey: "suggest-climate",
      }),
    ).toEqual({
      proposedLabel: "Climate change",
      language: "en-US",
      phrase: "Climate\u00a0 CHANGE",
      idempotencyKey: "suggest-climate",
    });
    const catalog = {
      projectId: id,
      keywordSetVersion: 2,
      keywords: [
        {
          id: keywordId,
          projectId: id,
          label: "Climate change",
          enabled: true,
          version: 1,
          createdBy: actor,
          createdAt: now,
          updatedAt: now,
          aliases: [
            {
              id: aliasId,
              projectId: id,
              keywordId,
              language: "en",
              phrase: "Climate change",
              normalizedPhrase: "climate change",
              enabled: true,
              version: 1,
              createdBy: actor,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      ],
      suggestions: [
        {
          id: suggestionId,
          projectId: id,
          keywordId,
          language: "es",
          phrase: "Cambio climático",
          normalizedPhrase: "cambio climático",
          state: "pending",
          version: 1,
          proposedBy: actor,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    expect(ProjectKeywordCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(
      ProjectKeywordCatalogSchema.parse({
        ...catalog,
        suggestions: [
          {
            ...catalog.suggestions[0],
            state: "withdrawn",
            withdrawnBy: actor,
            withdrawnAt: now,
            withdrawReason: "No longer needed",
          },
        ],
      }).suggestions[0]?.state,
    ).toBe("withdrawn");
    expect(
      ReviewProjectKeywordSuggestionRequestSchema.parse({
        action: "approve",
        expectedSuggestionVersion: 1,
        expectedKeywordSetVersion: 2,
        idempotencyKey: "approve-spanish",
      }),
    ).toMatchObject({ action: "approve", expectedKeywordSetVersion: 2 });
    expect(
      SuggestProjectKeywordRequestSchema.safeParse({
        language: "en",
        phrase: "climate",
        idempotencyKey: "missing-target",
      }).success,
    ).toBe(false);
    expect(
      WithdrawProjectKeywordSuggestionRequestSchema.parse({
        expectedSuggestionVersion: 1,
        reason: "Duplicate research direction",
        idempotencyKey: "withdraw-spanish",
      }),
    ).toMatchObject({ expectedSuggestionVersion: 1 });
    expect(
      UpdateProjectKeywordRequestSchema.parse({
        description: null,
        expectedKeywordVersion: 2,
        expectedKeywordSetVersion: 3,
        idempotencyKey: "clear-description",
      }),
    ).toMatchObject({ description: null });
    expect(
      UpdateProjectKeywordAliasRequestSchema.parse({
        language: "EN_us",
        phrase: " Updated phrase ",
        expectedAliasVersion: 1,
        expectedKeywordSetVersion: 3,
        idempotencyKey: "update-alias",
      }),
    ).toMatchObject({ language: "en-US", phrase: "Updated phrase" });
  });

  it("bounds shared bookmark records, searches, and retained offline commands", () => {
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const bookmarkId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const bookmark = ProjectBookmarkSchema.parse({
      id: bookmarkId,
      projectId: id,
      videoId,
      sourceTimeMs: 12_345,
      state: "active",
      version: 1,
      createdBy: {
        userId: id,
        handle: "researcher",
        displayName: "Researcher",
      },
      updatedBy: {
        userId: id,
        handle: "researcher",
        displayName: "Researcher",
      },
      createdAt: now,
      updatedAt: now,
    });
    expect(bookmark.title).toBeUndefined();
    expect(
      CreateProjectBookmarkRequestSchema.parse({
        videoId,
        sourceTimeMs: 0,
        idempotencyKey: "bare-bookmark",
      }),
    ).toMatchObject({ sourceTimeMs: 0 });
    expect(
      UpdateProjectBookmarkRequestSchema.parse({
        title: null,
        note: null,
        expectedVersion: 1,
        idempotencyKey: "clear-bookmark-copy",
      }),
    ).toMatchObject({ title: null, note: null });
    expect(
      ProjectBookmarkQuerySchema.parse({
        scope: "project",
        state: "all",
        search: "Ｃｌｉｍａｔｅ",
        limit: "25",
      }),
    ).toMatchObject({ scope: "project", state: "all", limit: 25 });
    expect(
      ProjectBookmarkQuerySchema.safeParse({ scope: "video" }).success,
    ).toBe(false);
    expect(
      CreateProjectBookmarkRequestSchema.safeParse({
        videoId,
        sourceTimeMs: 1,
        title: "x".repeat(121),
        idempotencyKey: "too-long-title",
      }).success,
    ).toBe(false);
    expect(
      LocalProjectBookmarkPageSchema.parse({
        projectId: id,
        items: [bookmark],
        freshness: "stale",
        cachedAt: now,
        outbox: [
          {
            outboxId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
            commandType: "bookmark.update.v1",
            bookmarkId,
            title: "Retained edit",
            note: "Do not discard this text",
            expectedVersion: 1,
            state: "conflict",
            code: "version_conflict",
            createdAt: now,
          },
        ],
      }).outbox[0],
    ).toMatchObject({ state: "conflict", note: "Do not discard this text" });
    expect(
      OfflineProjectBookmarkMutationResultSchema.parse({
        state: "applied",
        outboxId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
        bookmark,
      }),
    ).toMatchObject({ state: "applied", bookmark: { id: bookmarkId } });
  });

  it("keeps keyword scan lifecycle, aggregate, and private artifact evidence exact", () => {
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const transcriptVersionId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const descriptor = {
      objectKey: `keyword-scans/${id}/${videoId}/scan/matches.json`,
      objectVersionId: "object-version-1",
      sha256: "a".repeat(64),
      sizeBytes: 128,
      schemaVersion: 1 as const,
    };
    expect(
      ProjectKeywordScanSummarySchema.parse({
        projectId: id,
        projectVideoId: videoId,
        scanId: id,
        status: "current",
        transcriptVersionId,
        keywordSetVersion: 2,
        scannerSchemaVersion: 1,
        occurrenceCount: 0,
        matchedKeywordCount: 0,
        keywordCounts: [],
        approvedKeywordCount: 1,
        artifact: descriptor,
        completedAt: now,
      }),
    ).toMatchObject({ status: "current", occurrenceCount: 0 });
    expect(
      ProjectKeywordScanSummarySchema.safeParse({
        projectId: id,
        projectVideoId: videoId,
        status: "queued",
        transcriptVersionId,
        keywordSetVersion: 2,
        scannerSchemaVersion: 1,
        approvedKeywordCount: 1,
        occurrenceCount: 0,
      }).success,
    ).toBe(false);
    const priorResult = {
      scanId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      transcriptVersionId,
      keywordSetVersion: 1,
      scannerSchemaVersion: 1 as const,
      occurrenceCount: 2,
      matchedKeywordCount: 1,
      keywordCounts: [
        {
          keywordId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
          occurrenceCount: 2,
        },
      ],
      approvedKeywordCount: 1,
      durationMs: 60_000,
      matchesPerMinute: 2,
      artifact: descriptor,
      completedAt: now,
    };
    expect(
      ProjectKeywordScanSummarySchema.parse({
        projectId: id,
        projectVideoId: videoId,
        scanId: id,
        status: "scanning",
        transcriptVersionId,
        keywordSetVersion: 2,
        scannerSchemaVersion: 1,
        approvedKeywordCount: 2,
        priorResult,
      }),
    ).toMatchObject({ status: "scanning", priorResult });
    for (const status of ["current", "stale"] as const) {
      expect(
        ProjectKeywordScanSummarySchema.safeParse({
          projectId: id,
          projectVideoId: videoId,
          scanId: id,
          status,
          transcriptVersionId,
          keywordSetVersion: 2,
          scannerSchemaVersion: 1,
          occurrenceCount: 0,
          matchedKeywordCount: 0,
          keywordCounts: [],
          approvedKeywordCount: 1,
          artifact: descriptor,
          completedAt: now,
          priorResult,
        }).success,
      ).toBe(false);
    }
    expect(
      ProjectKeywordMatchArtifactSchema.parse({
        schemaVersion: 1,
        projectId: id,
        projectVideoId: videoId,
        transcriptVersionId,
        keywordSetVersion: 2,
        scannerSchemaVersion: 1,
        occurrences: [],
      }),
    ).toMatchObject({ occurrences: [] });
    expect(
      FinalizeProjectKeywordScanRequestSchema.safeParse({
        attempt: 1,
        artifact: { ...descriptor, objectVersionId: "" },
        occurrenceCount: 0,
        matchedKeywordCount: 0,
        keywordCounts: [],
      }).success,
    ).toBe(false);
  });

  it("bounds project local-processing policy and workload commands", () => {
    const status = {
      projectId: id,
      policy: { state: "automatic" as const, version: 1 },
      workload: {
        queuedJobs: 2,
        activeJobs: 1,
        queuedKnownDurationMs: 120_000,
        activeKnownDurationMs: 60_000,
        queuedUnknownDurationCount: 1,
        activeUnknownDurationCount: 0,
        unprocessedActiveVideoCount: 3,
      },
    };
    expect(ProjectLocalProcessingStatusSchema.parse(status)).toEqual(status);
    expect(
      UpdateProjectLocalProcessingRequestSchema.parse({
        state: "paused",
        expectedVersion: 1,
        idempotencyKey: "pause-local-v1",
      }),
    ).toEqual({
      state: "paused",
      expectedVersion: 1,
      idempotencyKey: "pause-local-v1",
    });
    expect(
      UpdateProjectLocalProcessingResponseSchema.parse({
        ...status,
        enqueuedCount: 50,
        remainingUnprocessedCount: 2,
      }),
    ).toMatchObject({ enqueuedCount: 50, remainingUnprocessedCount: 2 });
    expect(
      UpdateProjectLocalProcessingRequestSchema.safeParse({
        state: "overnight",
        expectedVersion: 1,
        idempotencyKey: "invalid-state",
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectLocalProcessingResponseSchema.safeParse({
        ...status,
        enqueuedCount: 51,
        remainingUnprocessedCount: 0,
      }).success,
    ).toBe(false);
    expect(
      ProjectLocalProcessingStatusSchema.safeParse({
        ...status,
        policy: {
          ...status.policy,
          updatedAt: now,
        },
      }).success,
    ).toBe(false);
  });

  it("bounds canonical project-video worklist reads and optimistic own-flag commands", () => {
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const userId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    expect(ProjectVideoWorklistQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      ProjectVideoWorklistQuerySchema.parse({ limit: "50", cursor: "next" }),
    ).toEqual({ limit: 50, cursor: "next" });
    expect(
      ProjectVideoWorklistQuerySchema.safeParse({ limit: 51 }).success,
    ).toBe(false);
    expect(
      UpdateOwnProjectVideoFlagRequestSchema.parse({
        active: false,
        expectedVersion: 3,
      }),
    ).toEqual({ active: false, expectedVersion: 3 });
    expect(
      UpdateOwnProjectVideoFlagRequestSchema.safeParse({
        active: true,
        expectedVersion: -1,
      }).success,
    ).toBe(false);

    const page = {
      items: [
        {
          projectId: id,
          video: {
            id: videoId,
            youtubeVideoId: "Worklist1",
            canonicalUrl: "https://www.youtube.com/watch?v=Worklist1",
            title: "Canonical worklist fixture",
            channel: "Fixture channel",
            durationMs: 60_000,
            sourceLanguage: "en",
            createdAt: now,
            updatedAt: now,
          },
          projectVideoVersion: 4,
          priority: "normal" as const,
          completionPolicy: "researcher_or_administrator" as const,
          triage: { state: "active" as const, version: 1 },
          unreadActivityCount: 0,
          review: {
            id: "019fbb95-cd76-7920-93fa-e23ba755ee46",
            cycleNumber: 1,
            status: "open" as const,
            version: 1,
            openedAt: now,
          },
          activeTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
          activeFlagCount: 1,
          flaggers: [
            {
              userId,
              handle: "worklist_user",
              displayName: "Worklist User",
              flaggedAt: now,
            },
          ],
          flaggersTruncated: false,
          ownFlag: {
            active: true,
            version: 2,
            createdAt: now,
            updatedAt: now,
          },
          processing: {
            state: "ready",
            batchId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
            batchItemId: "019fbb95-cd76-7920-93fa-e23ba755ee44",
            jobId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
            attempt: 1,
            updatedAt: now,
          },
          keywordScan: {
            projectId: id,
            projectVideoId: videoId,
            status: "waiting_for_transcript" as const,
            keywordSetVersion: 1,
            scannerSchemaVersion: 1 as const,
            approvedKeywordCount: 0,
          },
          clipCount: 2,
          createdAt: now,
          updatedAt: now,
        },
      ],
      total: 1,
      nextCursor: "next-page",
    };
    expect(ProjectVideoWorklistPageSchema.parse(page)).toEqual(page);
    expect(
      ProjectVideoWorklistPageSchema.safeParse({
        ...page,
        items: Array.from({ length: 51 }, () => page.items[0]),
      }).success,
    ).toBe(false);
  });

  it("keeps soft-claim and worklist-governance commands closed and action-specific", () => {
    expect(
      UpdateProjectVideoClaimRequestSchema.parse({
        action: "claim",
        idempotencyKey: "claim-v1",
        expectedClaimVersion: 0,
        leaseSeconds: 300,
        takeoverConfirmed: false,
      }),
    ).toMatchObject({ action: "claim", leaseSeconds: 300 });
    expect(
      UpdateProjectVideoClaimRequestSchema.safeParse({
        action: "renew",
        idempotencyKey: "renew-v1",
        expectedClaimVersion: 1,
        leaseSeconds: 300,
        takeoverConfirmed: true,
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectVideoClaimRequestSchema.safeParse({
        action: "release",
        idempotencyKey: "release-v1",
        expectedClaimVersion: 1,
        leaseSeconds: 300,
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectVideoGovernanceRequestSchema.parse({
        idempotencyKey: "governance-v1",
        expectedProjectVideoVersion: 2,
        priority: "high",
        completionPolicy: "administrator_only",
      }),
    ).toMatchObject({
      priority: "high",
      completionPolicy: "administrator_only",
    });
    expect(
      UpdateProjectVideoGovernanceRequestSchema.safeParse({
        idempotencyKey: "governance-empty",
        expectedProjectVideoVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectVideoReviewRequestSchema.parse({
        action: "complete",
        idempotencyKey: "complete-v1",
        expectedCycleId: "019fbb95-cd76-7920-93fa-e23ba755ee46",
        expectedCycleVersion: 1,
        acknowledgeTranscriptUnavailable: true,
      }),
    ).toMatchObject({ action: "complete" });
    expect(
      UpdateProjectVideoReviewRequestSchema.parse({
        action: "reopen",
        idempotencyKey: "reopen-v1",
        expectedCycleId: "019fbb95-cd76-7920-93fa-e23ba755ee46",
        expectedCycleVersion: 2,
        reason: "Additional evidence arrived.",
      }),
    ).toMatchObject({ action: "reopen" });
    expect(
      UpdateProjectVideoReviewRequestSchema.safeParse({
        action: "reopen",
        idempotencyKey: "reopen-invalid",
        expectedCycleId: "019fbb95-cd76-7920-93fa-e23ba755ee46",
        expectedCycleVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("keeps project governance invitations and lifecycle commands strict", () => {
    expect(
      CreateProjectInvitationRequestSchema.parse({
        idempotencyKey: "invite-researcher",
        handle: "researcher_one",
        role: "researcher",
        expiresInDays: 7,
      }),
    ).toMatchObject({ handle: "researcher_one", role: "researcher" });
    expect(
      CreateProjectInvitationRequestSchema.safeParse({
        idempotencyKey: "invite-owner",
        handle: "owner_one",
        role: "owner",
        expiresInDays: 7,
      }).success,
    ).toBe(false);
    expect(
      DecideProjectInvitationRequestSchema.parse({
        idempotencyKey: "accept-invitation",
        expectedVersion: 1,
        decision: "accept",
      }),
    ).toMatchObject({ decision: "accept" });
    expect(
      RevokeProjectInvitationRequestSchema.parse({
        idempotencyKey: "revoke-invitation",
        expectedVersion: 1,
      }),
    ).toMatchObject({ expectedVersion: 1 });
    expect(
      JoinOpenProjectRequestSchema.safeParse({
        idempotencyKey: "join-open",
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectGovernanceRequestSchema.parse({
        idempotencyKey: "transfer-owner",
        expectedVersion: 2,
        action: { type: "transfer_ownership", userId: id },
      }),
    ).toMatchObject({ action: { type: "transfer_ownership", userId: id } });
    expect(
      UpdateProjectGovernanceRequestSchema.safeParse({
        idempotencyKey: "remove-without-member-version",
        expectedVersion: 2,
        action: { type: "remove_member", userId: id },
      }).success,
    ).toBe(false);

    expect(
      ProjectInvitationSchema.parse({
        id,
        projectId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
        projectName: "Governance fixture",
        invitee: { id, handle: "researcher_one" },
        inviter: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee41",
          handle: "owner_one",
        },
        role: "researcher",
        state: "pending",
        version: 1,
        expiresAt: "2026-08-31T12:00:00.000Z",
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({ state: "pending" });
    expect(
      OpenProjectDiscoverySchema.parse({
        id,
        name: "Open fixture",
        description: "Bounded public summary",
        memberCount: 2,
      }),
    ).not.toHaveProperty("currentUserRole");
    expect(
      ProjectGovernanceEventSchema.parse({
        id,
        projectId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
        eventType: "member_removed",
        actorId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
        targetUserId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        createdAt: now,
      }),
    ).not.toHaveProperty("body");
  });

  it("keeps bulk triage and per-user activity commands bounded and closed", () => {
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const eventId = "019fbb95-cd76-7920-93fa-e23ba755ee47";
    const userId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    expect(
      UpdateProjectVideoTriageRequestSchema.parse({
        action: "dismiss",
        idempotencyKey: "dismiss:1",
        items: [{ videoId, expectedProjectVideoVersion: 4 }],
        reason: "Out of scope for this cut.",
      }),
    ).toMatchObject({ action: "dismiss" });
    expect(
      UpdateProjectVideoTriageRequestSchema.safeParse({
        action: "restore",
        idempotencyKey: "restore:invalid",
        items: [{ videoId, expectedProjectVideoVersion: 5 }],
        reason: "Not valid on restore.",
      }).success,
    ).toBe(false);
    expect(
      BulkUpdateProjectVideoPriorityRequestSchema.parse({
        priority: "high",
        idempotencyKey: "priority:1",
        items: [{ videoId, expectedProjectVideoVersion: 4 }],
      }),
    ).toMatchObject({ priority: "high" });
    expect(
      BulkUpdateProjectVideoPriorityRequestSchema.safeParse({
        priority: "low",
        idempotencyKey: "priority:duplicate",
        items: [
          { videoId, expectedProjectVideoVersion: 4 },
          { videoId, expectedProjectVideoVersion: 4 },
        ],
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectVideoTriageRequestSchema.safeParse({
        action: "dismiss",
        idempotencyKey: "dismiss:duplicate",
        items: [
          { videoId, expectedProjectVideoVersion: 4 },
          { videoId, expectedProjectVideoVersion: 4 },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProjectVideoActivityPageSchema.parse({
        items: [
          {
            eventId,
            projectId: id,
            videoId,
            videoTitle: "Activity fixture",
            eventType: "video_dismissed",
            actor: {
              userId,
              handle: "worklist_user",
              displayName: "Worklist User",
            },
            reason: "Out of scope for this cut.",
            state: "unread",
            version: 1,
            createdAt: now,
          },
        ],
        unreadCount: 1,
      }).items,
    ).toHaveLength(1);
    expect(
      ProjectVideoActivityPageSchema.parse({
        items: [
          {
            eventId,
            projectId: id,
            videoId,
            videoTitle: "Keyword scan fixture",
            eventType: "keyword_scan_completed",
            actor: {
              userId,
              handle: "scan_worker",
              displayName: "Scan Worker",
            },
            state: "unread",
            version: 1,
            createdAt: now,
          },
        ],
        unreadCount: 1,
      }).items[0]?.eventType,
    ).toBe("keyword_scan_completed");
    expect(
      MarkProjectVideoActivitySeenRequestSchema.safeParse({
        items: [
          { eventId, expectedVersion: 1 },
          { eventId, expectedVersion: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps manual timed import commands closed and candidate status storage-free", () => {
    const projectId = id;
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const batchItemId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const decisionId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
    const importId = "019fbb95-cd76-7920-93fa-e23ba755ee43";
    const descriptor = {
      format: "srt" as const,
      byteSize: 128,
      sha256: "a".repeat(64),
    };
    const create = {
      idempotencyKey: "manual-import:create:1",
      languageDecisionId: decisionId,
      expectedDecisionVersion: 2,
      batchItemId,
      expectedBatchItemVersion: 3,
      original: descriptor,
      english: { ...descriptor, sha256: "b".repeat(64) },
    };
    expect(
      CreateManualTimedTranscriptImportRequestSchema.parse(create),
    ).toEqual(create);
    expect(
      CreateManualTimedTranscriptImportRequestSchema.safeParse({
        ...create,
        fileName: "/private/original.srt",
      }).success,
    ).toBe(false);

    const grant = {
      importId,
      projectId,
      catalogVideoId: videoId,
      batchItemId,
      sourceLanguage: "dz",
      languageDecisionId: decisionId,
      languageDecisionVersion: 2,
      expiresAt: now,
      targets: [
        {
          role: "original" as const,
          format: "srt" as const,
          objectKey: "private/import/original",
          uploadUrl: "https://upload.invalid/original",
        },
        {
          role: "english" as const,
          format: "srt" as const,
          objectKey: "private/import/english",
          uploadUrl: "https://upload.invalid/english",
        },
      ],
    };
    expect(ManualTimedTranscriptImportUploadGrantSchema.parse(grant)).toEqual(
      grant,
    );
    expect(
      ManualTimedTranscriptImportUploadGrantSchema.safeParse({
        ...grant,
        targets: [grant.targets[0], grant.targets[0]],
      }).success,
    ).toBe(false);

    const receipt = {
      objectVersionId: "version-1",
      byteSize: 128,
      sha256: "a".repeat(64),
    };
    expect(
      FinalizeManualTimedTranscriptImportRequestSchema.parse({
        idempotencyKey: "manual-import:finalize:1",
        original: receipt,
        english: { ...receipt, sha256: "b".repeat(64) },
      }),
    ).toBeTruthy();
    const status = {
      importId,
      projectId,
      catalogVideoId: videoId,
      batchItemId,
      state: "finalized" as const,
      version: 2,
      sourceLanguage: "dz",
      targetLanguage: "en" as const,
      languageDecisionId: decisionId,
      languageDecisionVersion: 2,
      createdAt: now,
      expiresAt: now,
      candidate: {
        candidateId: "019fbb95-cd76-7920-93fa-e23ba755ee44",
        transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
        timingPrecision: "cue" as const,
        finalizedAt: now,
      },
    };
    expect(ManualTimedTranscriptImportStatusSchema.parse(status)).toEqual(
      status,
    );
    expect(
      ManualTimedTranscriptImportStatusSchema.safeParse({
        ...status,
        objectKey: "private/import/original",
      }).success,
    ).toBe(false);
  });

  it("keeps corrected-candidate review bounded, linked, and activation exact", () => {
    const projectId = id;
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const importId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const candidateId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
    const transcriptVersionId = "019fbb95-cd76-7920-93fa-e23ba755ee43";
    const decisionId = "019fbb95-cd76-7920-93fa-e23ba755ee44";
    const originalTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee45";
    const englishTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee46";
    const cue = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee47",
      ordinal: 0,
      startMs: 0,
      endMs: 1_000,
      text: "Reviewed cue",
    };
    const page = {
      candidateId,
      importId,
      transcriptVersionId,
      projectId,
      catalogVideoId: videoId,
      projectVideoVersion: 4,
      languageDecisionId: decisionId,
      languageDecisionVersion: 2,
      finalizedAt: now,
      offset: 0,
      limit: 25,
      hasMore: false,
      original: {
        trackId: originalTrackId,
        trackVersion: 1,
        language: "dz",
        kind: "original" as const,
        source: "manual-import" as const,
        provider: "researcher-timed-import",
        timingPrecision: "cue" as const,
        contentSha256: "a".repeat(64),
        totalCues: 1,
        cues: [cue],
      },
      english: {
        trackId: englishTrackId,
        trackVersion: 1,
        language: "en" as const,
        kind: "english" as const,
        source: "manual-import" as const,
        provider: "researcher-timed-import",
        sourceTrackId: originalTrackId,
        timingPrecision: "cue" as const,
        contentSha256: "b".repeat(64),
        totalCues: 1,
        cues: [{ ...cue, id: englishTrackId, text: "English cue" }],
      },
    };
    expect(ManualTimedTranscriptCandidateReviewPageSchema.parse(page)).toEqual(
      page,
    );
    expect(
      ManualTimedTranscriptCandidateReviewPageSchema.safeParse({
        ...page,
        objectKey: "private/candidate/original.json",
      }).success,
    ).toBe(false);
    expect(
      ManualTimedTranscriptCandidateReviewPageSchema.safeParse({
        ...page,
        english: { ...page.english, sourceTrackId: englishTrackId },
      }).success,
    ).toBe(false);
    expect(
      ManualTimedTranscriptCandidateReviewQuerySchema.parse({ limit: "100" }),
    ).toEqual({ offset: 0, limit: 100 });
    expect(
      ManualTimedTranscriptCandidateReviewQuerySchema.safeParse({
        limit: 101,
      }).success,
    ).toBe(false);

    const activation = {
      idempotencyKey: "activate-corrected-v1",
      importId,
      candidateId,
      transcriptVersionId,
      expectedProjectVideoVersion: 4,
      languageDecisionId: decisionId,
      expectedLanguageDecisionVersion: 2,
    };
    expect(
      ActivateManualTimedTranscriptCandidateRequestSchema.parse(activation),
    ).toEqual(activation);
    expect(
      ActivateManualTimedTranscriptCandidateRequestSchema.safeParse({
        ...activation,
        signedUrl: "https://private.invalid",
      }).success,
    ).toBe(false);
    expect(
      ManualTimedTranscriptActivationStatusSchema.parse({
        activationId: "019fbb95-cd76-7920-93fa-e23ba755ee48",
        state: "activated",
        projectId,
        catalogVideoId: videoId,
        importId,
        candidateId,
        transcriptVersionId,
        languageDecisionId: decisionId,
        languageDecisionVersion: 2,
        projectVideoVersion: 5,
        activatedAt: now,
      }),
    ).toBeTruthy();
  });

  it("requires exactly one worker-job or manual-import manifest identity", () => {
    const base = {
      schemaVersion: 1,
      id,
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
      videoId: "fixture-video",
      lineageId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      version: 1,
      sourceLanguage: "dz",
      targetLanguage: "en",
      timingPrecision: "cue" as const,
      provider: "researcher-timed-import",
      normalizationSchemaVersion: 1,
      createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      createdAt: now,
      artifacts: [
        {
          type: "original-normalized" as const,
          objectKey: "private/original",
          byteSize: 1,
          sha256: "a".repeat(64),
        },
      ],
    };
    expect(
      TranscriptManifestSchema.parse({ ...base, manualImportId: id }),
    ).toBeTruthy();
    expect(TranscriptManifestSchema.safeParse(base).success).toBe(false);
    expect(
      TranscriptManifestSchema.safeParse({
        ...base,
        jobId: id,
        manualImportId: id,
      }).success,
    ).toBe(false);
  });

  it("bounds the dedicated native timed upload bridge", () => {
    expect(
      DesktopTimedTranscriptUploadRequestSchema.parse({
        importId: id,
        role: "original",
        contentType: "application/x-subrip",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).toBeTruthy();
    expect(
      DesktopTimedTranscriptUploadRequestSchema.safeParse({
        importId: "not-an-id",
        role: "not-a-role",
        contentType: "text/plain",
        bytes: new Uint8Array([1]),
      }).success,
    ).toBe(false);
  });

  it("keeps derived translation lookup read-only and identity-only", () => {
    const identity = {
      projectId: id,
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      baseTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
      originalTrackId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      originalContentSha256: "a".repeat(64),
      targetLanguage: "es-MX",
      provider: "amazon-translate",
      normalizationSchemaVersion: 1,
    };
    expect(LookupDerivedTranslationSchema.parse({ identity })).toEqual({
      identity,
    });
    expect(
      LookupDerivedTranslationSchema.safeParse({
        identity,
        idempotencyKey: "must-not-create-work",
      }).success,
    ).toBe(false);
  });
  it("keeps M7 setup and readiness contracts closed, path-free, and operation-specific", () => {
    const health = [
      {
        component: "authentication",
        state: "ready",
        reason: "ready",
        remediation: "none",
        checkedAt: now,
      },
      {
        component: "cloud_api",
        state: "degraded",
        reason: "cloud_unavailable",
        remediation: "retry",
        checkedAt: now,
      },
      {
        component: "network",
        state: "ready",
        reason: "ready",
        remediation: "none",
        checkedAt: now,
      },
      {
        component: "local_database",
        state: "ready",
        reason: "ready",
        remediation: "none",
        checkedAt: now,
      },
      {
        component: "cache_root",
        state: "ready",
        reason: "ready",
        remediation: "none",
        checkedAt: now,
      },
      {
        component: "export_source_provider",
        state: "ready",
        reason: "ready",
        remediation: "choose_export_source_provider",
        checkedAt: now,
      },
    ] as const;
    expect(
      ComponentHealthSchema.safeParse({ ...health[0], path: "/private" })
        .success,
    ).toBe(false);
    const report = deriveReadinessReport({
      checkedAt: now,
      components: health,
      requirements: {
        project_browsing: ["authentication", "cloud_api", "network"],
        verified_cached_review: ["local_database", "cache_root"],
        project_logging: ["authentication", "cloud_api", "network"],
        transcript_processing: ["authentication", "cloud_api", "network"],
        export_processing: [
          "authentication",
          "cloud_api",
          "network",
          "export_source_provider",
        ],
      },
    });
    expect(report.operations).toEqual([
      {
        operation: "project_browsing",
        state: "degraded",
        blockingComponents: ["cloud_api"],
      },
      {
        operation: "verified_cached_review",
        state: "ready",
        blockingComponents: [],
      },
      {
        operation: "project_logging",
        state: "degraded",
        blockingComponents: ["cloud_api"],
      },
      {
        operation: "transcript_processing",
        state: "degraded",
        blockingComponents: ["cloud_api"],
      },
      {
        operation: "export_processing",
        state: "degraded",
        blockingComponents: ["cloud_api"],
      },
    ]);
    expect(
      ReadinessReportSchema.safeParse({
        ...report,
        operations: report.operations.slice(1),
      }).success,
    ).toBe(false);
    expect(
      SetupActionSchema.safeParse({
        action: "set_worker_enabled",
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      SetupActionSchema.safeParse({
        action: "set_worker_enabled",
        enabled: true,
        path: "/private",
      }).success,
    ).toBe(false);
    const snapshot = {
      activeComponents: [
        { id, target: "ffmpeg", displayName: "FFmpeg", validatedAt: now },
      ],
    };
    expect(SetupSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      SetupSnapshotSchema.safeParse({
        ...snapshot,
        activeComponents: [
          ...snapshot.activeComponents,
          { ...snapshot.activeComponents[0] },
        ],
      }).success,
    ).toBe(false);
    expect(
      ModelDownloadProgressSchema.safeParse({
        target: "whisper_model",
        state: "downloading",
        bytesDownloaded: 9,
        expectedBytes: 8,
      }).success,
    ).toBe(false);
  });

  it("keeps runtime quiescence and operation diagnostics closed and content-free", () => {
    const correlationId = "019fbb95-cd76-7920-93fa-e23ba755ee3e";
    const quiescence = {
      schemaVersion: 1 as const,
      draining: true,
      safeToStop: true,
      activeOperationCount: 0,
      activeOperations: {
        clipLibrary: 0,
        artifact: 0,
        authoring: 0,
        transcript: 0,
        export: 0,
        runtime: 0,
      },
      activeChildProcessCount: 0,
      activeSourceLifecycleCount: 0,
      durableWork: {
        pendingAcceptance: 0,
        accepted: 2,
        executing: 0,
        complete: 3,
        failed: 1,
        canceled: 1,
        needsAttention: 0,
        recoveryRequired: 0,
      },
      checkedAt: now,
    };
    expect(LocalRuntimeQuiescenceSchema.parse(quiescence)).toEqual(quiescence);
    expect(
      LocalRuntimeDrainResultSchema.parse({
        operation: { operation: "runtime", correlationId },
        quiescence,
      }).operation.correlationId,
    ).toBe(correlationId);
    expect(
      LocalOperationFailureSchema.parse({
        operation: "transcript",
        failureClass: "verification_failed",
        retryable: true,
        correlationId,
      }),
    ).not.toHaveProperty("message");
    for (const prohibited of [
      "path",
      "url",
      "token",
      "header",
      "command",
      "output",
      "transcript",
      "notes",
    ]) {
      expect(
        LocalOperationFailureSchema.safeParse({
          operation: "export",
          failureClass: "runtime_draining",
          retryable: false,
          correlationId,
          [prohibited]: "/private/fixture secret fixture text",
        }).success,
      ).toBe(false);
    }
    expect(
      LocalRuntimeQuiescenceSchema.safeParse({
        ...quiescence,
        safeToStop: true,
        activeChildProcessCount: 1,
      }).success,
    ).toBe(false);
  });

  it("requires exact worker epoch plus delivery generation and token for logged handoff", () => {
    const claim = {
      workerId: id,
      workerEpoch: 3,
    };
    expect(ClaimLoggedExportDeliveryRequestSchema.parse(claim)).toEqual(claim);
    const acceptance = {
      ...claim,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      generation: 4,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee41",
    };
    expect(AcceptLoggedExportDeliveryRequestSchema.parse(acceptance)).toEqual(
      acceptance,
    );
    expect(
      AcceptLoggedExportDeliveryRequestSchema.safeParse({
        ...acceptance,
        reservationToken: undefined,
      }).success,
    ).toBe(false);
    expect(
      AcceptLoggedExportDeliveryRequestSchema.safeParse({
        ...acceptance,
        generation: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid logged-delivery reservation and acceptance chronology", () => {
    const delivery = deliveryContractFixture();
    expect(LoggedExportDeliverySchema.safeParse(delivery).success).toBe(true);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        reservationExpiresAt: delivery.reservedAt,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        status: "accepted",
        acceptedAt: "2026-08-20T11:59:59.999Z",
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        status: "accepted",
        acceptedAt: delivery.reservationExpiresAt,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        request: {
          ...delivery.request,
          video: {
            ...delivery.request.video,
            canonicalUrl: `${delivery.request.video.canonicalUrl}&token=private`,
          },
        },
      }).success,
    ).toBe(false);
    const batchItemId = "019fbb95-cd76-7920-93fa-e23ba755ee49";
    const grouped = {
      ...delivery,
      sourceGroup: {
        batchId: "019fbb95-cd76-7920-93fa-e23ba755ee48",
        batchItemId,
      },
      request: { ...delivery.request, batchItemId },
    };
    expect(LoggedExportDeliverySchema.parse(grouped)).toEqual(grouped);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...grouped,
        sourceGroup: undefined,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...delivery,
        sourceGroup: grouped.sourceGroup,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportDeliverySchema.safeParse({
        ...grouped,
        sourceGroup: { ...grouped.sourceGroup, sourcePath: "/private/source" },
      }).success,
    ).toBe(false);
  });

  it("binds logged-export retry provenance as a strict all-or-none lineage", () => {
    const parent = deliveryContractFixture().request;
    const child = {
      ...parent,
      id: "019fbb95-cd76-7920-93fa-e23ba755ee4a",
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee4b",
      retryOfRequestId: parent.id,
      retryOrdinal: 1,
    };
    expect(
      RetryLoggedExportRequestSchema.parse({ idempotencyKey: " retry-1 " }),
    ).toEqual({ idempotencyKey: "retry-1" });
    expect(RetryLoggedExportResponseSchema.parse({ request: child })).toEqual({
      request: child,
    });
    expect(
      RetryLoggedExportResponseSchema.safeParse({
        request: { ...child, retryOrdinal: undefined },
      }).success,
    ).toBe(false);
    expect(
      RetryLoggedExportResponseSchema.safeParse({
        request: {
          ...child,
          mode: "export_only",
          projectId: undefined,
          clipId: undefined,
        },
      }).success,
    ).toBe(false);
    expect(
      RetryLoggedExportRequestSchema.safeParse({
        idempotencyKey: "retry-1",
        preset: "caller replacement forbidden",
      }).success,
    ).toBe(false);
  });

  it("accepts only canonical sanitized logged-export success provenance", () => {
    const result = successResultContractFixture();
    expect(LoggedExportSuccessResultSchema.parse(result)).toEqual(result);
    const reconcile = {
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      workerEpoch: 3,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      result,
    };
    expect(ReconcileLoggedExportSuccessRequestSchema.parse(reconcile)).toEqual(
      reconcile,
    );
    expect(
      LoggedExportSuccessResultSchema.safeParse({
        ...result,
        artifacts: [...result.artifacts].reverse(),
      }).success,
    ).toBe(false);
    expect(
      LoggedExportSuccessResultSchema.safeParse({
        ...result,
        artifacts: result.artifacts.map((artifact, index) => ({
          ...artifact,
          sourceAttempt: index === 0 ? 2 : artifact.sourceAttempt,
        })),
      }).success,
    ).toBe(false);
    expect(
      ProcessAcceptedLoggedExportRequestSchema.safeParse({
        requestId: result.requestId,
        authorizationConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportSuccessSchema.safeParse({
        id,
        deliveryId: reconcile.deliveryId,
        generation: reconcile.generation,
        workerId: reconcile.workerId,
        workerEpoch: reconcile.workerEpoch,
        result,
        resultFingerprint: "a".repeat(64),
        reconciledAt: now,
        reservationToken: reconcile.reservationToken,
      }).success,
    ).toBe(false);
  });

  it("bounds immutable artifact history and keeps request origin diagnostic", () => {
    const request = deliveryContractFixture().request;
    const result = successResultContractFixture();
    const manifest = result.artifacts.find(
      (artifact) => artifact.role === "manifest_json",
    )!;
    const summary = {
      artifactVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee55",
      requestId: result.requestId,
      jobId: result.jobId,
      projectId: result.projectId,
      clipId: result.clipId,
      requestOrigin: "clip_library" as const,
      packageIdentity: manifest.packageIdentity,
      video: request.video,
      selection: request.selection,
      sourceLanguageClass: result.sourceLanguageClass,
      preset: request.preset,
      resolvedSettingsSnapshot: request.resolvedSettingsSnapshot,
      resolvedExportBounds: result.resolvedExportBounds,
      renderedMediaProvenance: result.renderedMediaProvenance,
      thumbnailProvenance: result.thumbnailProvenance,
      subtitleOmissionProvenance: result.subtitleOmissionProvenance,
      artifacts: result.artifacts,
      manifest: {
        contentSha256: manifest.contentSha256,
        schemaVersion: "unknown" as const,
      },
      resultFingerprint: "f".repeat(64),
      completedAt: now,
    };
    expect(ArtifactVersionSummarySchema.parse(summary)).toEqual(summary);
    expect(
      ArtifactVersionHistoryResponseSchema.parse({ versions: [summary] }),
    ).toEqual({ versions: [summary] });
    expect(ArtifactVersionHistoryQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      ArtifactVersionHistoryQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(ExportRequestOriginSchema.safeParse("repair_renderer").success).toBe(
      false,
    );
    expect(
      ArtifactVersionSummarySchema.safeParse({
        ...summary,
        localPath: "/private/export.mov",
      }).success,
    ).toBe(false);

    const { text: _text, ...selection } = summary.selection;
    const requirements = ArtifactCompatibilityRequirementsSchema.parse({
      clipId: summary.clipId,
      selection,
      resolvedBounds: {
        startMs: summary.resolvedExportBounds.startMs,
        endMs: summary.resolvedExportBounds.endMs,
      },
      sourceLanguageClass: summary.sourceLanguageClass,
      subtitlePolicy: {
        requiredSidecars: [],
        omittedReason: "confirmed_english_user_setting",
      },
      requiredArtifactRoles: summary.artifacts.map((artifact) => artifact.role),
      acceptedManifestSchemas: [2],
      settings: {
        mode: "exact_fingerprint",
        resolutionFingerprint:
          summary.resolvedSettingsSnapshot.resolutionFingerprint,
      },
    });
    const locatorId = "019fbb95-cd76-7920-93fa-e23ba755ee63";
    expect(
      AuthoringArtifactDescriptorRequestSchema.parse({
        artifactVersionId: summary.artifactVersionId,
        locatorId,
        requirements,
      }),
    ).toBeTruthy();
    expect(
      ArtifactCompatibilityResolutionSchema.parse({
        state: "candidate",
        version: summary,
      }),
    ).toBeTruthy();
    const packagePath = `/private/exports/${summary.packageIdentity}`;
    const descriptor = {
      schemaVersion: 1 as const,
      projectId: summary.projectId,
      clipId: summary.clipId,
      artifactVersionId: summary.artifactVersionId,
      requestId: summary.requestId,
      locatorId,
      packageIdentity: summary.packageIdentity,
      resultFingerprint: summary.resultFingerprint,
      manifest: {
        schemaVersion: 2 as const,
        contentSha256: manifest.contentSha256,
      },
      packagePath,
      artifacts: summary.artifacts.map((artifact) => ({
        role: artifact.role,
        absolutePath: `${packagePath}/${artifact.role}`,
        byteSize: artifact.byteSize,
        contentSha256: artifact.contentSha256,
      })),
    };
    expect(LocalAuthoringArtifactDescriptorSchema.parse(descriptor)).toEqual(
      descriptor,
    );
    expect(
      LocalAuthoringArtifactDescriptorSchema.safeParse({
        ...descriptor,
        packagePath: "relative/package",
      }).success,
    ).toBe(false);
    expect(
      LocalAuthoringArtifactDescriptorSchema.safeParse({
        ...descriptor,
        artifacts: descriptor.artifacts.map((artifact, index) =>
          index === 0
            ? {
                ...artifact,
                absolutePath: `${packagePath}/../outside.mp4`,
              }
            : artifact,
        ),
      }).success,
    ).toBe(false);
    expect(
      LocalAuthoringArtifactDescriptorSchema.safeParse({
        ...descriptor,
        artifacts: descriptor.artifacts.map((artifact, index) =>
          index === 0
            ? { ...artifact, absolutePath: "/private/outside.mp4" }
            : artifact,
        ),
      }).success,
    ).toBe(false);
    expect(
      ArtifactCompatibilityResolutionSchema.safeParse({
        state: "candidate",
        version: { ...summary, packagePath },
      }).success,
    ).toBe(false);
  });

  it("bounds project Clip Library pages and keeps local overlays path-free", () => {
    const request = deliveryContractFixture().request;
    const clip = {
      id: request.clipId,
      projectId: request.projectId,
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee56",
      video: request.video,
      selection: request.selection,
      languageEvidence: { schemaVersion: 1 as const, englishText: "Fixture" },
      englishText: "Fixture",
      notes: "Review this quotation",
      tags: ["Key Quote"],
      researchStatus: "approved" as const,
      exportStatus: "queued" as const,
      createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee57",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const page = {
      projectId: request.projectId,
      entries: [
        {
          clip,
          currentLeaves: [
            {
              requestId: request.id,
              jobId: request.jobId,
              state: "queued" as const,
              requestOrigin: null,
              updatedAt: now,
            },
          ],
          hasMoreLeaves: false,
          completedVersionCount: 0,
          recentArtifactVersions: [],
        },
      ],
      nextCursor: "cursor_value_1",
      syncCursor: "42",
      fetchedAt: now,
    };
    expect(ClipLibraryPageSchema.parse(page)).toEqual(page);
    expect(ClipLibraryQuerySchema.parse({ query: "  quote  " })).toEqual({
      limit: 25,
      completed: "any",
      query: "quote",
    });
    expect(
      ClipLibraryQuerySchema.safeParse({ limit: 51, localPath: "/private" })
        .success,
    ).toBe(false);
    const localPage = {
      ...page,
      query: { limit: 25, completed: "any" as const },
      freshness: "stale" as const,
      cachedAt: now,
      cacheCoverage: "cached_subset" as const,
      selectedClipIds: [clip.id],
      localAvailability: [],
    };
    expect(LocalClipLibraryPageSchema.parse(localPage)).toEqual(localPage);
    expect(
      UpdateLocalClipLibrarySelectionSchema.parse({
        pageClipIds: [clip.id],
        selectedClipIds: [clip.id],
      }),
    ).toEqual({ pageClipIds: [clip.id], selectedClipIds: [clip.id] });
    expect(
      UpdateLocalClipLibrarySelectionSchema.safeParse({
        pageClipIds: [clip.id],
        selectedClipIds: ["019fbb95-cd76-7920-93fa-e23ba755ee58"],
      }).success,
    ).toBe(false);
    expect(
      LocalClipLibraryPageSchema.safeParse({
        ...localPage,
        selectedClipIds: ["019fbb95-cd76-7920-93fa-e23ba755ee58"],
      }).success,
    ).toBe(false);
    expect(
      LocalClipLibraryPageSchema.safeParse({
        ...localPage,
        absoluteRootPath: "/private/exports",
      }).success,
    ).toBe(false);
  });

  it("keeps Clip Library storage evidence strict, internally consistent, and path-free", () => {
    const request = deliveryContractFixture().request;
    const clipId = request.clipId!;
    const outputEstimatedBytes = 300_000_000;
    const activeCheckpointReserveBytes = 25_000_000;
    const knownRequiredBytes =
      outputEstimatedBytes +
      outputEstimatedBytes +
      activeCheckpointReserveBytes +
      ExportStorageSafetyReserveBytes;
    const command = {
      clipIds: [clipId],
      settingsSelection: {
        base: "application_default" as const,
        overrides: {},
      },
    };
    expect(PrepareClipLibraryExportRequestSchema.parse(command)).toEqual(
      command,
    );
    expect(
      SubmitClipLibraryExportRequestSchema.parse({
        ...command,
        expectedPreflightFingerprint: "a".repeat(64),
        sourceRights: [
          {
            clipId,
            sourceRights: {
              schemaVersion: 1,
              source: "youtube",
              youtubeVideoId: "M7lc1UVf-VE",
              confirmation: "authorized_to_process",
              disclosureVersion: 1,
            },
          },
        ],
      }),
    ).toMatchObject({ confirmUnknownSourceSizes: false });
    const preflight = {
      schemaVersion: 1 as const,
      projectId: request.projectId!,
      preflightFingerprint: "a".repeat(64),
      checkedAt: now,
      availableBytes: knownRequiredBytes,
      uniqueSourceCount: 1,
      sourceSharingAssurance: "same_worker_profile_only" as const,
      knownSourceBytes: 0,
      unknownSourceCount: 1,
      outputEstimatedBytes,
      promotionReserveBytes: outputEstimatedBytes,
      activeCheckpointReserveBytes,
      safetyReserveBytes: ExportStorageSafetyReserveBytes,
      knownRequiredBytes,
      decision: "confirmation_required" as const,
      items: [
        {
          clipId,
          sourceLanguageClass: request.sourceLanguageClass,
          resolvedSettingsSnapshot: request.resolvedSettingsSnapshot!,
          outputEstimatedBytes,
        },
      ],
    };
    expect(ExportStoragePreflightSchema.parse(preflight)).toEqual(preflight);
    expect(
      ExportStoragePreflightSchema.safeParse({
        ...preflight,
        knownRequiredBytes: knownRequiredBytes - 1,
      }).success,
    ).toBe(false);
    expect(
      ExportStoragePreflightSchema.safeParse({
        ...preflight,
        localPath: "/private/exports",
      }).success,
    ).toBe(false);
  });

  it("keeps local root and locator summaries path-free and state-consistent", () => {
    const rootId = "019fbb95-cd76-7920-93fa-e23ba755ee61";
    const artifactVersionId = "019fbb95-cd76-7920-93fa-e23ba755ee62";
    expect(
      ConfigureLocalArtifactRootRequestSchema.parse({
        label: "Managed exports",
        platform: "posix",
        absolutePath: "/private/local-only/exports",
      }),
    ).toMatchObject({ absolutePath: "/private/local-only/exports" });
    expect(
      ArtifactRootSummarySchema.parse({
        id: rootId,
        label: "Managed exports",
        platform: "posix",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }),
    ).not.toHaveProperty("absolutePath");
    const locator = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee63",
      artifactVersionId,
      rootId,
      platform: "posix" as const,
      availability: "verified" as const,
      manifestSha256: "a".repeat(64),
      manifestSchemaVersion: 2 as const,
      checkedAt: now,
      lastVerifiedAt: now,
    };
    expect(ArtifactLocatorSummarySchema.parse(locator)).toEqual(locator);
    expect(
      ArtifactLocatorSummarySchema.safeParse({
        ...locator,
        availability: "missing",
      }).success,
    ).toBe(false);
    expect(
      ArtifactLocatorSummarySchema.safeParse({
        ...locator,
        relativePackagePath: `clip-${artifactVersionId}`,
      }).success,
    ).toBe(false);
  });

  it("keeps artifact resolution strict, exhaustive, and locator-ID-only", () => {
    const locator = ArtifactLocatorSummarySchema.parse({
      id: "019fbb95-cd76-7920-93fa-e23ba755ee63",
      artifactVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee62",
      rootId: "019fbb95-cd76-7920-93fa-e23ba755ee61",
      platform: "posix",
      availability: "verified",
      manifestSha256: "a".repeat(64),
      manifestSchemaVersion: 2,
      checkedAt: now,
      lastVerifiedAt: now,
    });
    const shared = { freshness: "fresh" as const };
    for (const result of [
      {
        state: "reusable_local",
        artifactVersionId: locator.artifactVersionId,
        locator,
        ...shared,
      },
      {
        state: "missing",
        artifactVersionId: locator.artifactVersionId,
        locators: [],
        ...shared,
      },
      {
        state: "invalid",
        artifactVersionId: locator.artifactVersionId,
        locators: [
          {
            ...locator,
            availability: "invalid",
            failureClass: "artifact_mismatch",
          },
        ],
        ...shared,
      },
      {
        state: "incompatible",
        artifactVersionId: locator.artifactVersionId,
        ...shared,
      },
      {
        state: "remote_only",
        artifactVersionId: locator.artifactVersionId,
        ...shared,
      },
      { state: "needs_export", ...shared },
    ]) {
      expect(ArtifactResolutionResultSchema.safeParse(result).success).toBe(
        true,
      );
      expect(
        ArtifactResolutionResultSchema.safeParse({
          ...result,
          absolutePath: "/private/export",
        }).success,
      ).toBe(false);
    }
    expect(
      ArtifactLocatorActionRequestSchema.parse({ locatorId: locator.id }),
    ).toEqual({ locatorId: locator.id });
    expect(
      ArtifactLocatorActionRequestSchema.safeParse({
        locatorId: locator.id,
        path: "/private/export",
      }).success,
    ).toBe(false);
    expect(
      RelinkArtifactLocatorRequestSchema.parse({
        locatorId: locator.id,
        targetRootId: locator.rootId,
      }),
    ).toBeTruthy();
    expect(
      ArtifactCompatibilityRequirementsSchema.safeParse({
        clipId: id,
        selection: { text: "must not cross the boundary" },
      }).success,
    ).toBe(false);
  });

  it("bounds explicit artifact re-export provenance to project export clients", () => {
    const command = {
      idempotencyKey: "reexport-v1",
      sourceLanguageClass: "confirmed_english" as const,
      settingsSelection: {
        base: "application_default" as const,
        overrides: {},
      },
      expectedResolutionFingerprint: "a".repeat(64),
      sourceRights: {
        schemaVersion: 1,
        source: "youtube",
        youtubeVideoId: "M7lc1UVf-VE",
        confirmation: "authorized_to_process",
        disclosureVersion: 1,
      },
    };
    expect(ReexportArtifactVersionRequestSchema.parse(command)).toMatchObject({
      requestOrigin: "clip_library",
    });
    expect(
      ReexportArtifactVersionRequestSchema.safeParse({
        ...command,
        requestOrigin: "authoring_build",
      }).success,
    ).toBe(true);
    expect(
      ReexportArtifactVersionRequestSchema.safeParse({
        ...command,
        requestOrigin: "selection_action",
      }).success,
    ).toBe(false);
  });

  it("sanitizes and binds terminal-safe logged-export failure provenance", () => {
    const result = LoggedExportFailureResultSchema.parse({
      schemaVersion: 1,
      requestId: "019fbb95-cd76-7920-93fa-e23ba755ee51",
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee52",
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee53",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
      error: {
        code: "Renderer Failed!",
        message:
          "failed at /private/source.mp4 C:\\Users\\name\\source.mov \\\\server\\share\\source.mov file:///private/source.mov token=secret Bearer abc.def-123 https://private.invalid/source 019fbb95-cd76-7920-93fa-e23ba755ee55",
      },
      attempt: 1,
      sourceCleanup: { lifecycle: "deleted", deletedAt: now },
    });
    expect(result.error).toEqual({
      code: "renderer_failed",
      message:
        "failed at <path> <path> <path> <path> token=<redacted> Bearer <redacted> <url> <id>",
    });
    expect(LoggedExportFailureResultSchema.parse(result)).toEqual(result);
    const reconcile = ReconcileLoggedExportFailureRequestSchema.parse({
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      workerEpoch: 3,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      result,
    });
    const failure = LoggedExportFailureSchema.parse({
      id,
      deliveryId: reconcile.deliveryId,
      generation: reconcile.generation,
      workerId: reconcile.workerId,
      workerEpoch: reconcile.workerEpoch,
      result,
      resultFingerprint: "a".repeat(64),
      reconciledAt: now,
    });
    expect(
      ProcessAcceptedLoggedExportResponseSchema.parse({
        execution: "failed",
        failure,
      }),
    ).toMatchObject({ execution: "failed", failure: { result } });
    expect(
      LoggedExportFailureResultSchema.safeParse({
        ...result,
        attempt: 0,
      }).success,
    ).toBe(false);
    expect(
      LoggedExportFailureResultSchema.safeParse({
        ...result,
        sourceCleanup: { lifecycle: "not_started" },
      }).success,
    ).toBe(false);
    expect(
      LoggedExportFailureSchema.safeParse({
        ...failure,
        reservationToken: reconcile.reservationToken,
      }).success,
    ).toBe(false);
  });

  it("binds cancellation to one chronological execution without leaking control credentials", () => {
    const execution = {
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ee60",
      requestId: "019fbb95-cd76-7920-93fa-e23ba755ee51",
      attempt: 1,
      workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
      workerEpoch: 3,
      leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ee61",
      startedAt: "2026-08-01T11:59:55.000Z",
      heartbeatAt: now,
      expiresAt: "2026-08-01T12:00:30.000Z",
      cancelRequestedAt: "2026-08-01T11:59:59.000Z",
    };
    expect(
      StartLoggedExportExecutionResponseSchema.parse({
        status: "started",
        execution,
      }),
    ).toEqual({ status: "started", execution });
    expect(
      LoggedExportExecutionSchema.safeParse({
        ...execution,
        expiresAt: execution.heartbeatAt,
      }).success,
    ).toBe(false);

    const result = LoggedExportCanceledResultSchema.parse({
      schemaVersion: 1,
      requestId: execution.requestId,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee52",
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee53",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
      reason: "user_requested",
      attempt: 1,
      sourceCleanup: { lifecycle: "deleted", deletedAt: now },
      executionId: execution.executionId,
      executionAttempt: execution.attempt,
    });
    const reconcile = ReconcileLoggedExportCanceledRequestSchema.parse({
      workerId: execution.workerId,
      workerEpoch: execution.workerEpoch,
      deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      generation: 2,
      reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      executionId: execution.executionId,
      leaseToken: execution.leaseToken,
      result,
    });
    expect(
      ProcessAcceptedLoggedExportResponseSchema.parse({
        execution: "canceled",
        canceled: {
          id,
          deliveryId: reconcile.deliveryId,
          generation: reconcile.generation,
          workerId: reconcile.workerId,
          workerEpoch: reconcile.workerEpoch,
          result,
          resultFingerprint: "a".repeat(64),
          reconciledAt: now,
        },
      }),
    ).toMatchObject({ execution: "canceled", canceled: { result } });
    expect(
      LoggedExportCanceledResultSchema.safeParse({
        ...result,
        executionAttempt: 2,
      }).success,
    ).toBe(false);
    expect(
      ReconcileLoggedExportCanceledRequestSchema.safeParse({
        ...reconcile,
        leaseToken: undefined,
      }).success,
    ).toBe(false);
    expect(
      CancelLoggedExportRequestSchema.parse({ idempotencyKey: " cancel-1 " }),
    ).toEqual({ idempotencyKey: "cancel-1" });
    expect(JSON.stringify(result)).not.toMatch(
      /leaseToken|reservationToken|\/private\/|sourceIdentity|https?:\/\//i,
    );
  });

  it("binds sanitized monotonic progress to one exact execution", () => {
    const progress = {
      schemaVersion: 1 as const,
      executionId: "019fbb95-cd76-7920-93fa-e23ba755ee60",
      requestId: "019fbb95-cd76-7920-93fa-e23ba755ee51",
      attempt: 1,
      sequence: 3,
      stage: "rendering" as const,
      basisPoints: 3_500,
      updatedAt: now,
    };
    expect(LoggedExportProgressSnapshotSchema.parse(progress)).toEqual(
      progress,
    );
    expect(
      HeartbeatLoggedExportExecutionRequestSchema.parse({
        workerId: id,
        workerEpoch: 1,
        deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
        generation: 1,
        reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee44",
        executionId: progress.executionId,
        attempt: 1,
        leaseToken: "019fbb95-cd76-7920-93fa-e23ba755ee61",
        progress,
      }).progress,
    ).toEqual(progress);
    expect(
      LoggedExportProgressSnapshotSchema.safeParse({
        ...progress,
        basisPoints: 10_001,
      }).success,
    ).toBe(false);
    expect(
      GetLoggedExportProgressResponseSchema.safeParse({
        requestId: progress.requestId,
        jobId: id,
        state: "processing",
        progress: { ...progress, leaseToken: id },
      }).success,
    ).toBe(false);
  });

  it("requires bounded unique batch items and exact derived summary counts", () => {
    const exportInput = {
      idempotencyKey: "item-1",
      sourceLanguageClass: "confirmed_english" as const,
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4" as const,
          videoCodec: "h264" as const,
          videoRateControl: { mode: "crf" as const, value: 20 },
          frameRate: "source" as const,
          audioCodec: "aac" as const,
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
      sourceRights: {
        schemaVersion: 1,
        source: "youtube",
        youtubeVideoId: "M7lc1UVf-VE",
        confirmation: "authorized_to_process",
        disclosureVersion: 1,
      },
    };
    expect(
      CreateLoggedExportBatchRequestSchema.safeParse({
        idempotencyKey: "batch-1",
        items: [
          { clipId: id, export: exportInput },
          { clipId: id, export: { ...exportInput, idempotencyKey: "item-2" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      LoggedExportBatchSummarySchema.parse({
        total: 2,
        queued: 1,
        claimed: 0,
        processing: 0,
        needsUserAction: 0,
        complete: 0,
        failed: 1,
        canceled: 0,
        status: "active",
      }),
    ).toMatchObject({ total: 2, queued: 1, failed: 1 });
    expect(
      LoggedExportBatchSummarySchema.safeParse({
        total: 2,
        queued: 2,
        claimed: 0,
        processing: 0,
        needsUserAction: 0,
        complete: 1,
        failed: 0,
        canceled: 0,
        status: "active",
      }).success,
    ).toBe(false);
  });

  it("accepts a versioned project", () => {
    const project = ProjectSchema.parse({
      id,
      name: "Essay research",
      kind: "shared",
      visibility: "invitation_only",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(project.description).toBe("");
  });

  it("normalizes stable handles and rejects invalid shapes", () => {
    expect(normalizeUserHandle("  @Researcher_01 ")).toBe("researcher_01");
    expect(UserHandleSchema.parse("Ｒｅｓｅａｒｃｈｅｒ_01")).toBe(
      "researcher_01",
    );
    expect(
      RegisterUserRequestSchema.parse({
        displayName: "Researcher",
        handle: "@Case_Equivalent",
      }),
    ).toEqual({ displayName: "Researcher", handle: "case_equivalent" });
    for (const handle of ["ab", "1researcher", "research-er", "a".repeat(33)]) {
      expect(UserHandleSchema.safeParse(handle).success).toBe(false);
    }
  });

  it("defaults and validates project kind and visibility combinations", () => {
    expect(CreateProjectRequestSchema.parse({ name: "Shared" })).toMatchObject({
      kind: "shared",
      visibility: "invitation_only",
    });
    expect(
      CreateProjectRequestSchema.parse({ name: "Personal", kind: "personal" }),
    ).toMatchObject({ kind: "personal", visibility: "private" });
    expect(
      CreateProjectRequestSchema.parse({
        name: "Open",
        kind: "shared",
        visibility: "open_to_join",
      }),
    ).toMatchObject({ kind: "shared", visibility: "open_to_join" });
    for (const project of [
      {
        name: "Invalid personal",
        kind: "personal",
        visibility: "open_to_join",
      },
      { name: "Invalid shared", kind: "shared", visibility: "private" },
    ]) {
      expect(CreateProjectRequestSchema.safeParse(project).success).toBe(false);
    }
  });

  it("keeps new role assignments closed to Administrator and Researcher", () => {
    for (const role of ["administrator", "researcher"]) {
      expect(
        AddProjectMemberRequestSchema.safeParse({ userId: id, role }).success,
      ).toBe(true);
    }
    for (const role of ["owner", "editor", "viewer"]) {
      expect(
        AddProjectMemberRequestSchema.safeParse({ userId: id, role }).success,
      ).toBe(false);
    }
  });

  it("requires complete authorized project summaries and valid persisted combinations", () => {
    const summary = {
      id,
      name: "Shared project",
      description: "",
      kind: "shared",
      visibility: "invitation_only",
      version: 1,
      currentUserRole: "administrator",
      memberCount: 2,
      createdAt: now,
      updatedAt: now,
    };
    expect(ProjectSummarySchema.parse(summary)).toMatchObject({
      currentUserRole: "administrator",
      memberCount: 2,
    });
    expect(
      ProjectSummarySchema.safeParse({ ...summary, currentUserRole: undefined })
        .success,
    ).toBe(false);
    expect(
      ProjectSummarySchema.safeParse({ ...summary, memberCount: 0 }).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...summary,
        kind: "personal",
        visibility: "open_to_join",
      }).success,
    ).toBe(false);
  });

  it("rejects a projectless non-export job only at the command boundary, not transport", () => {
    expect(
      JobSchema.parse({
        id,
        kind: "export",
        state: "queued",
        idempotencyKey: "export-only:fixture",
        attempt: 0,
        payload: { mode: "export_only" },
        createdAt: now,
        updatedAt: now,
      }).projectId,
    ).toBeUndefined();
  });

  it("validates health responses", () => {
    expect(
      HealthResponseSchema.safeParse({
        service: "local-agent",
        status: "ok",
        version: "0.1.0",
        timestamp: now,
      }).success,
    ).toBe(true);
  });

  it("requires an ordered complete partition for installed renderer advertisements", () => {
    const complete = {
      schemaVersion: 1,
      availableRendererIds: ["h264_mp4", "prores_mov"],
      unavailableRendererIds: ["hevc_mkv"],
      ffmpegVersion: "8.1.2",
    };
    expect(
      InstalledExportWorkerCapabilitySummarySchema.parse(complete),
    ).toEqual(complete);
    for (const invalid of [
      {
        ...complete,
        availableRendererIds: ["h264_mp4", "h264_mp4"],
      },
      {
        ...complete,
        unavailableRendererIds: ["h264_mp4", "hevc_mkv"],
      },
      {
        ...complete,
        availableRendererIds: ["prores_mov", "h264_mp4"],
      },
      { ...complete, unavailableRendererIds: [] },
      { ...complete, ffmpegVersion: "/usr/local/bin/ffmpeg 8.1" },
    ]) {
      expect(
        InstalledExportWorkerCapabilitySummarySchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("normalizes BCP-47 account preferences and compares primary languages", () => {
    expect(
      UpdatePreferredLanguageRequestSchema.parse({
        preferredLanguage: "ES_mx",
      }),
    ).toEqual({ preferredLanguage: "es-MX" });
    expect(languagesEquivalent("en-US", "en-GB")).toBe(true);
    expect(primaryLanguage("und")).toBe("und");
    expect(primaryLanguage("mul")).toBe("mul");
    expect(
      UpdatePreferredLanguageRequestSchema.safeParse({
        preferredLanguage: "not a language",
      }).success,
    ).toBe(false);
    expect(formatLanguageLabel("ES_mx")).toBe("Spanish (Mexico) (es-MX)");
    expect(formatLanguageLabel("fr-CA")).toBe("French (Canada) (fr-CA)");
    expect(formatLanguageLabel("zh-Hant-TW")).toBe(
      "Chinese (Traditional) (Taiwan) (zh-Hant-TW)",
    );
    expect(formatLanguageLabel("dz")).toBe("Dzongkha (dz)");
  });

  it("keeps provider claims, authorized decisions, capabilities, and gate remediation strict", () => {
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
    const evidenceId = "019fbb95-cd76-7920-93fa-e23ba755ee43";
    const decisionId = "019fbb95-cd76-7920-93fa-e23ba755ee44";
    const evidence = {
      id: evidenceId,
      projectId: id,
      videoId,
      source: "caption" as const,
      provider: "fixture-caption-provider",
      reportedLanguage: "KO_kr",
      trackFingerprint: "a".repeat(64),
      captionKind: "automatic" as const,
      createdAt: now,
    };
    expect(ProviderLanguageEvidenceSchema.parse(evidence)).toMatchObject({
      reportedLanguage: "ko-KR",
    });
    expect(
      ProviderLanguageEvidenceSchema.safeParse({
        ...evidence,
        captionKind: undefined,
      }).success,
    ).toBe(false);
    expect(
      ProviderLanguageEvidenceSchema.safeParse({
        ...evidence,
        source: "speech_detection",
      }).success,
    ).toBe(false);
    for (const provider of [
      "https://provider.example/token",
      "/private/provider",
      "provider bearer-token",
    ]) {
      expect(
        ProviderLanguageEvidenceSchema.safeParse({ ...evidence, provider })
          .success,
      ).toBe(false);
    }

    const decision = {
      id: decisionId,
      projectId: id,
      videoId,
      decisionVersion: 1,
      status: "confirmed" as const,
      basis: "user_confirmation" as const,
      resolvedLanguage: "dz",
      evidenceId,
      actorId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
      createdAt: now,
    };
    expect(ProjectVideoLanguageDecisionSchema.parse(decision)).toEqual(
      decision,
    );
    expect(
      ProjectVideoLanguageDecisionSchema.safeParse({
        ...decision,
        resolvedLanguage: undefined,
      }).success,
    ).toBe(false);

    const snapshot = {
      schemaVersion: 1 as const,
      decisionId,
      decisionVersion: 1,
      status: "confirmed" as const,
      basis: "user_confirmation" as const,
      resolvedLanguage: "dz",
      evidenceId,
    };
    expect(LanguageDecisionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      LanguageDecisionSnapshotSchema.safeParse({
        ...snapshot,
        actorId: decision.actorId,
      }).success,
    ).toBe(false);

    const unsupportedSpeech = {
      state: "unsupported" as const,
      provider: "fixture-speech",
      operation: "speech_to_text" as const,
      sourceLanguage: "dz",
      version: "fixture-v1",
      reason: "language_not_supported" as const,
    };
    expect(LanguageCapabilityResultSchema.parse(unsupportedSpeech)).toEqual(
      unsupportedSpeech,
    );
    expect(
      LanguageCapabilityResultSchema.safeParse({
        ...unsupportedSpeech,
        reason: "free-form provider output",
      }).success,
    ).toBe(false);
    expect(
      LanguageCapabilityResultSchema.safeParse({
        ...unsupportedSpeech,
        version: "/private/runtime",
      }).success,
    ).toBe(false);

    const gate = {
      state: "needs_language_confirmation" as const,
      status: "conflict" as const,
      creatorReportedLanguage: "dz",
      providerEvidence: evidence,
      decision,
      speechCapability: unsupportedSpeech,
      remediationReason: "resolve_conflict" as const,
    };
    expect(LanguageGateSchema.parse(gate)).toMatchObject({
      status: "conflict",
      providerEvidence: { reportedLanguage: "ko-KR" },
    });
    expect(
      LanguageGateSchema.safeParse({
        ...gate,
        state: "ready",
        remediationReason: "none",
      }).success,
    ).toBe(false);

    const command = {
      idempotencyKey: "confirm-dz-1",
      expectedDecisionVersion: 0,
      resolvedLanguage: "dz",
      basis: "user_confirmation" as const,
      evidenceId,
      batchItemId: "019fbb95-cd76-7920-93fa-e23ba755ee46",
      expectedBatchItemVersion: 1,
    };
    expect(
      CreateProjectVideoLanguageDecisionRequestSchema.parse(command),
    ).toEqual(command);
    expect(
      CreateProjectVideoLanguageDecisionRequestSchema.safeParse({
        ...command,
        expectedBatchItemVersion: undefined,
      }).success,
    ).toBe(false);

    expect(
      WorkerObserveLanguageEvidenceRequestSchema.safeParse({
        attempt: 2,
        evidence: {
          ...evidence,
          jobId: "019fbb95-cd76-7920-93fa-e23ba755ee47",
          attempt: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("requires strict native, English, and distinct direct preferred evidence", () => {
    const nativeTrackId = id;
    const englishTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const preferredTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
    const evidence = {
      schemaVersion: 2,
      native: {
        role: "native",
        language: "ro",
        text: "Un exemplu",
        trackId: nativeTrackId,
        trackVersion: 1,
        timingPrecision: "cue",
      },
      english: {
        role: "english",
        language: "en-GB",
        text: "An example",
        trackId: englishTrackId,
        trackVersion: 1,
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
      },
      preferred: {
        role: "preferred",
        language: "es-MX",
        text: "Un ejemplo",
        trackId: preferredTrackId,
        trackVersion: 1,
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
      },
    };
    expect(ClipLanguageEvidenceV2Schema.parse(evidence)).toMatchObject({
      preferred: { language: "es-MX" },
    });
    expect(
      ClipLanguageEvidenceV2Schema.safeParse({
        ...evidence,
        preferred: { ...evidence.preferred, language: "en" },
      }).success,
    ).toBe(false);
    expect(
      ClipLanguageEvidenceV2Schema.safeParse({
        ...evidence,
        preferred: { ...evidence.preferred, sourceTrackId: englishTrackId },
      }).success,
    ).toBe(false);
    expect(
      TranscriptTrackSchema.parse({
        id: preferredTrackId,
        videoId: "Romanian001",
        language: "es",
        kind: "translation",
        source: "translated",
        provider: "fixture",
        sourceTrackId: nativeTrackId,
        timingPrecision: "cue",
        schemaVersion: 1,
        contentSha256: "a".repeat(64),
        version: 1,
      }).kind,
    ).toBe("translation");
  });

  it("defaults bounded batch requests to local shared-first processing", () => {
    expect(
      CreateTranscriptionBatchRequestSchema.parse({
        name: "Launch research",
        inputs: ["https://youtu.be/ReadyVideo1"],
      }),
    ).toMatchObject({
      targetLanguage: "en",
      transcriptionProfile: "default",
      sourcePolicy: "prefer-existing",
      executionLocation: "local",
      priority: "normal",
    });
    expect(BatchPreflightRequestSchema.safeParse({ inputs: [] }).success).toBe(
      false,
    );
  });

  it("requires an explicit closed disclosure for cloud translation", () => {
    const consent = CloudTranslationConsentSchema.parse({
      provider: "amazon-translate",
      disclosureVersion: 1,
      transcriptTextTransferAccepted: true,
    });
    expect(
      CreateTranscriptionBatchRequestSchema.parse({
        name: "Consented translation",
        inputs: ["M7lc1UVf-VE"],
        translationConsent: consent,
      }).translationConsent,
    ).toEqual(consent);
    expect(
      CloudTranslationConsentSchema.safeParse({
        provider: "amazon-translate",
        disclosureVersion: 1,
        transcriptTextTransferAccepted: false,
      }).success,
    ).toBe(false);
    expect(
      WorkerTranslateTranscriptRequestSchema.safeParse({
        attempt: 1,
        consent,
        targetLanguage: "en",
        source: {},
      }).success,
    ).toBe(false);
  });

  it("requires optimistic versions for batch control commands", () => {
    expect(
      TranscriptionBatchControlRequestSchema.parse({
        action: "pause_pending",
        expectedVersion: 2,
      }),
    ).toEqual({ action: "pause_pending", expectedVersion: 2 });
    expect(
      TranscriptionBatchControlRequestSchema.safeParse({
        action: "retry_failed",
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("keeps hosted transcription approval strict and evidence-consistent", () => {
    const actor = {
      userId: id,
      handle: "hosted_admin",
      displayName: "Hosted Admin",
    };
    expect(
      HostedTranscriptionApprovalSchema.parse({ state: "pending", version: 1 }),
    ).toEqual({ state: "pending", version: 1 });
    for (const state of ["approved", "revoked"] as const) {
      expect(
        HostedTranscriptionApprovalSchema.parse({
          state,
          version: 2,
          decidedBy: actor,
          decidedAt: now,
        }),
      ).toMatchObject({ state, decidedBy: actor });
    }
    expect(
      HostedTranscriptionApprovalSchema.safeParse({
        state: "approved",
        version: 2,
      }).success,
    ).toBe(false);
    expect(
      HostedTranscriptionApprovalSchema.safeParse({
        state: "pending",
        version: 1,
        decidedBy: actor,
        decidedAt: now,
      }).success,
    ).toBe(false);
    expect(
      UpdateHostedTranscriptionApprovalRequestSchema.safeParse({
        action: "approve",
        idempotencyKey: "hosted-approval-v1",
        expectedVersion: 1,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("requires optimistic versions for review status changes", () => {
    expect(
      UpdateReviewStatusRequestSchema.parse({
        reviewStatus: "reviewing",
        expectedVersion: 3,
      }),
    ).toEqual({ reviewStatus: "reviewing", expectedVersion: 3 });
  });

  it("validates export setting capabilities before snapshotting a job", () => {
    const settings = {
      container: "mp4",
      videoCodec: "h264",
      videoRateControl: { mode: "crf", value: 20 },
      maxWidth: 1_920,
      frameRate: "source",
      audioCodec: "aac",
      audioKilobitsPerSecond: 192,
      omitSubtitleFilesForConfirmedEnglish: false,
      embedEnglishSubtitleTrack: false,
    };
    expect(ExportSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      ExportSettingsSchema.safeParse({
        ...settings,
        videoCodec: "prores",
      }).error?.issues[0]?.message,
    ).toMatch(/requires MOV or MKV/u);
  });

  it("keeps legacy inline snapshots compatible and makes catalog responses strict", () => {
    const settings = {
      container: "mp4" as const,
      videoCodec: "h264" as const,
      videoRateControl: { mode: "crf" as const, value: 20 },
      frameRate: "source" as const,
      audioCodec: "aac" as const,
      omitSubtitleFilesForConfirmedEnglish: false,
      embedEnglishSubtitleTrack: false,
    };
    expect(
      ExportPresetSnapshotSchema.parse({
        presetVersion: 1,
        name: "Editing MP4",
        settings,
      }),
    ).not.toHaveProperty("presetId");
    const entry = {
      id,
      scope: "personal",
      currentVersion: 1,
      entityVersion: 1,
      current: {
        presetId: id,
        presetVersion: 1,
        name: "My editing preset",
        description: "Personal default",
        settings,
        createdBy: id,
        createdAt: now,
      },
      createdBy: id,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      ExportPresetCatalogEntrySchema.parse(entry).current.settings,
    ).toEqual(settings);
    expect(
      ExportPresetCatalogEntrySchema.safeParse({ ...entry, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      ExportPresetDefaultSchema.safeParse({
        scope: "personal",
        presetId: id,
        presetVersion: 1,
        entityVersion: 1,
        snapshot: {
          presetId: id,
          presetVersion: 2,
          name: "Wrong revision",
          settings,
        },
        description: "Wrong fixed revision",
        updatedBy: id,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(false);
  });

  it("requires immutable bilingual track identities for foreign, mixed, and unknown exports", () => {
    const request = {
      idempotencyKey: "bilingual-fixture",
      sourceLanguageClass: "foreign",
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          frameRate: "source",
          audioCodec: "aac",
          omitSubtitleFilesForConfirmedEnglish: true,
          embedEnglishSubtitleTrack: false,
        },
      },
      sourceRights: {
        schemaVersion: 1,
        source: "youtube",
        youtubeVideoId: "M7lc1UVf-VE",
        confirmation: "authorized_to_process",
        disclosureVersion: 1,
      },
    };
    expect(CreateClipExportRequestSchema.safeParse(request).success).toBe(
      false,
    );
    expect(
      CreateClipExportRequestSchema.parse({
        ...request,
        subtitleTracks: {
          original: { trackId: id, trackVersion: 1 },
          english: {
            trackId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
            trackVersion: 1,
          },
        },
      }).subtitleTracks,
    ).toBeDefined();
  });

  it("validates a versioned clip package manifest with per-sidecar provenance", () => {
    const manifest = {
      schemaVersion: 1,
      exportRequestId: id,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      mode: "export_only",
      packageIdentity: `clip-${id}`,
      sourceAttempt: 1,
      validatedAt: now,
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture video",
        sourceLanguage: "es",
      },
      sourceLanguageClass: "foreign",
      resolvedExportBounds: { startMs: 0, endMs: 2_000, sourceAttempt: 1 },
      renderedDurationMs: 2_000,
      subtitlePolicy: { requiredSidecars: ["original", "english"] },
      toolVersions: { ffprobeVersion: "7.1", ffmpegVersion: "8.1.2" },
      artifacts: [
        {
          role: "video_mp4",
          filename: `clip-${id}.mp4`,
          byteSize: 1_024,
          contentSha256: "a".repeat(64),
        },
        {
          role: "original_srt",
          filename: `clip-${id}.original.srt`,
          byteSize: 96,
          contentSha256: "b".repeat(64),
          subtitle: {
            language: "es",
            trackId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
            trackVersion: 1,
            timingPrecision: "cue",
            cueCount: 2,
            startMs: 0,
            endMs: 2_000,
          },
        },
        {
          role: "clip_metadata_json",
          filename: `clip-${id}.json`,
          byteSize: 512,
          contentSha256: "c".repeat(64),
        },
        {
          role: "thumbnail_jpg",
          filename: `clip-${id}.jpg`,
          byteSize: 640,
          contentSha256: "d".repeat(64),
          thumbnail: {
            extractionTimeMs: 1_000,
            width: 640,
            height: 360,
            jpegQuality: 3,
          },
        },
      ],
    };

    expect(ExportClipManifestSchema.parse(manifest)).toMatchObject({
      schemaVersion: 1,
      subtitlePolicy: { requiredSidecars: ["original", "english"] },
    });
    expect(
      ExportClipManifestSchema.parse({
        ...manifest,
        subtitlePolicy: {
          requiredSidecars: [],
          subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
        },
        artifacts: [manifest.artifacts[0], manifest.artifacts[2]],
      }).subtitlePolicy.subtitleSidecarsOmittedReason,
    ).toBe("confirmed_english_user_setting");
    expect(
      ExportClipManifestSchema.safeParse({ ...manifest, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      ExportClipManifestSchema.safeParse({
        ...manifest,
        artifacts: [
          ...manifest.artifacts.slice(0, 3),
          {
            ...manifest.artifacts[3],
            thumbnail: {
              extractionTimeMs: 1_000,
              width: 641,
              height: 360,
              jpegQuality: 3,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ExportClipManifestSchema.safeParse({
        ...manifest,
        artifacts: manifest.artifacts.slice(0, 2),
      }).success,
    ).toBe(true);
    expect(
      ExportClipManifestSchema.safeParse({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], contentSha256: "not-a-hash" }],
      }).success,
    ).toBe(false);
  });

  it("records a promoted manifest as its own final artifact role", () => {
    expect(
      FinalArtifactProvenanceSchema.parse({
        role: "manifest_json",
        packageIdentity: `clip-${id}`,
        byteSize: 512,
        contentSha256: "c".repeat(64),
        sourceAttempt: 1,
        validatedAt: now,
      }).role,
    ).toBe("manifest_json");
  });

  it("validates descriptive clip metadata with only the canonical public video URL", () => {
    const metadata = {
      schemaVersion: 1,
      exportRequestId: id,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
      mode: "export_only",
      packageIdentity: `clip-${id}`,
      sourceAttempt: 1,
      validatedAt: now,
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture video",
      },
      sourceLanguageClass: "confirmed_english",
      selection: {
        trackId: id,
        transcriptVersion: 1,
        firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee41",
        lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        transcriptStartMs: 100,
        transcriptEndMs: 900,
        exportStartMs: 0,
        exportEndMs: 1_000,
        text: "Selected fixture text",
        timingPrecision: "cue",
      },
      resolvedExportBounds: { startMs: 0, endMs: 1_000, sourceAttempt: 1 },
      renderedDurationMs: 1_000,
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          frameRate: "source",
          audioCodec: "aac",
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
      subtitlePolicy: { requiredSidecars: ["english"] },
    };
    expect(ExportClipMetadataSchema.parse(metadata)).toMatchObject({
      schemaVersion: 1,
      video: { canonicalUrl: metadata.video.canonicalUrl },
    });
    expect(
      ExportClipMetadataSchema.safeParse({
        ...metadata,
        video: {
          ...metadata.video,
          canonicalUrl: "file:///private/source.mp4",
        },
      }).success,
    ).toBe(false);
  });
});

function deliveryContractFixture() {
  const settings = {
    container: "mp4" as const,
    videoCodec: "h264" as const,
    videoRateControl: { mode: "crf" as const, value: 20 },
    frameRate: "source" as const,
    audioCodec: "aac" as const,
    omitSubtitleFilesForConfirmedEnglish: false,
    embedEnglishSubtitleTrack: false,
  };
  return {
    deliveryId: "019fbb95-cd76-7920-93fa-e23ba755ee40",
    generation: 1,
    reservationToken: "019fbb95-cd76-7920-93fa-e23ba755ee41",
    workerId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
    workerEpoch: 1,
    status: "reserved" as const,
    reservedAt: "2026-08-20T12:00:00.000Z",
    reservationExpiresAt: "2026-08-20T12:00:30.000Z",
    request: {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee43",
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee44",
      mode: "logged" as const,
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ee46",
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture",
      },
      selection: {
        trackId: "019fbb95-cd76-7920-93fa-e23ba755ee47",
        transcriptVersion: 1,
        firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee48",
        lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755ee49",
        transcriptStartMs: 0,
        transcriptEndMs: 1_000,
        exportStartMs: 0,
        exportEndMs: 1_000,
        text: "Fixture",
        timingPrecision: "cue" as const,
      },
      sourceLanguageClass: "confirmed_english" as const,
      preset: { presetVersion: 1, name: "Editing MP4", settings },
      resolvedSettingsSnapshot: {
        schemaVersion: 1 as const,
        resolutionKind: "catalog" as const,
        context: "logged" as const,
        base: "application_default" as const,
        applicationDefaultVersion: 1 as const,
        overrides: {},
        overrideFields: [],
        settings,
        capability: {
          profileId: "local-editing-renderer",
          profileVersion: 3,
          fingerprint: "a".repeat(64),
          validation: "validated" as const,
        },
        resolutionFingerprint: "b".repeat(64),
        resolvedAt: "2026-08-20T11:59:00.000Z",
      },
      state: "queued" as const,
      createdAt: "2026-08-20T11:59:00.000Z",
      updatedAt: "2026-08-20T11:59:00.000Z",
    },
  };
}

describe("desktop boundary contracts", () => {
  it("keeps notification events bounded, body-free, and exactly navigable", () => {
    const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee70";
    const batchId = "019fbb95-cd76-7920-93fa-e23ba755ee71";
    const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee72";
    const clipId = "019fbb95-cd76-7920-93fa-e23ba755ee73";
    const requestId = "019fbb95-cd76-7920-93fa-e23ba755ee74";
    const commentId = "019fbb95-cd76-7920-93fa-e23ba755ee75";
    const base = {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee76",
      createdAt: "2026-08-24T12:00:00.000Z",
      projectLabel: "Documentary",
      sourceLabel: "Fixture source",
    };
    const events = [
      {
        ...base,
        kind: "transcription_batch_terminal",
        status: "ready",
        batchLabel: "Morning batch",
        navigation: { kind: "transcription", projectId, batchId },
      },
      {
        ...base,
        kind: "transcription_action_needed",
        status: "failed",
        batchLabel: "Morning batch",
        navigation: { kind: "transcription", projectId, batchId, videoId },
      },
      {
        ...base,
        kind: "logged_export_terminal",
        status: "completed",
        navigation: { kind: "logged_export", projectId, clipId, requestId },
      },
      {
        id: base.id,
        createdAt: base.createdAt,
        sourceLabel: base.sourceLabel,
        kind: "local_export_terminal",
        status: "action_needed",
        navigation: { kind: "local_export", requestId },
      },
      {
        ...base,
        kind: "mention",
        status: "mentioned",
        actorLabel: "A. Researcher",
        navigation: {
          kind: "mention",
          projectId,
          clipId,
          commentId,
          sourceTimeMs: 42,
        },
      },
    ];

    for (const event of events) {
      expect(NotificationEventSchema.parse(event)).toEqual(event);
      for (const forbidden of [
        "commentBody",
        "transcriptText",
        "errorDetails",
        "path",
        "url",
        "artifactLocator",
      ]) {
        expect(
          NotificationEventSchema.safeParse({ ...event, [forbidden]: "secret" })
            .success,
        ).toBe(false);
      }
    }
    expect(
      NotificationEventSchema.safeParse({
        ...events[4],
        actorLabel: "x".repeat(161),
      }).success,
    ).toBe(false);
    expect(
      DesktopNotificationNavigationTargetSchema.safeParse({
        kind: "mention",
        projectId,
        clipId,
        commentId,
        requestId,
      }).success,
    ).toBe(false);
    expect(
      DesktopNotificationNavigationTargetSchema.safeParse({
        kind: "logged_export",
        projectId,
        clipId,
      }).success,
    ).toBe(false);
  });

  it("validates notification preference invariants and bounded feed queries", () => {
    expect(
      sanitizeNotificationLabel(
        "Interview https://private.invalid/watch /Users/research/source.mp4 token=secret",
      ),
    ).toBe("Interview <url> <path> token=<redacted>");
    expect(sanitizeNotificationLabel("News/Politics")).toBe("News/Politics");
    expect(
      DesktopNotificationPreferencesSchema.parse({
        enabled: true,
        enabledAt: "2026-08-24T12:00:00.000Z",
        updatedAt: "2026-08-24T12:00:00.000Z",
      }),
    ).toMatchObject({ enabled: true });
    for (const invalid of [
      {
        enabled: true,
        updatedAt: "2026-08-24T12:00:00.000Z",
      },
      {
        enabled: false,
        enabledAt: "2026-08-24T12:00:00.000Z",
        updatedAt: "2026-08-24T12:00:00.000Z",
      },
    ]) {
      expect(
        DesktopNotificationPreferencesSchema.safeParse(invalid).success,
      ).toBe(false);
    }
    expect(NotificationFeedQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(NotificationFeedQuerySchema.parse({ limit: "50" })).toEqual({
      limit: 50,
    });
    expect(NotificationFeedQuerySchema.safeParse({ limit: 51 }).success).toBe(
      false,
    );
    expect(
      NotificationFeedQuerySchema.safeParse({ cursor: "bad" }).success,
    ).toBe(false);
    expect(
      NotificationFeedPageSchema.safeParse({
        events: Array.from({ length: 51 }, () => ({
          id: "019fbb95-cd76-7920-93fa-e23ba755ee77",
          kind: "local_export_terminal",
          status: "completed",
          navigation: {
            kind: "local_export",
            requestId: "019fbb95-cd76-7920-93fa-e23ba755ee78",
          },
          createdAt: "2026-08-24T12:00:00.000Z",
        })),
        fetchedAt: "2026-08-24T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts only closed token-free renderer requests", () => {
    expect(
      DesktopApiRequestSchema.parse({
        target: "cloud",
        method: "POST",
        path: "/api/projects?limit=25",
        body: "{}",
        contentType: "application/json",
      }),
    ).not.toHaveProperty("authorization");
    expect(() =>
      DesktopApiRequestSchema.parse({
        target: "local",
        method: "DELETE",
        path: "/api/runtime/drain",
        authorization: "Bearer secret",
      }),
    ).toThrow();
    for (const path of [
      "/api/%2e%2e/session",
      "/api/%2E./session",
      "/api/%2f%2fevil.example",
      "/api/..\\session",
      "/api/desktop-setup/foo/../runtime-config",
    ]) {
      expect(() =>
        DesktopApiRequestSchema.parse({
          target: "cloud",
          method: "GET",
          path,
        }),
      ).toThrow();
    }
  });

  it("keeps desktop status closed and credential-free", () => {
    const status = DesktopStatusSchema.parse({
      auth: { state: "signed_in", expiresAt: "2026-08-23T21:00:00.000Z" },
      services: [{ service: "local_agent", state: "healthy", restartCount: 0 }],
    });
    expect(JSON.stringify(status)).not.toMatch(/token|path|authorization/i);
  });

  it("keeps transcript workspaces closed, time-linked, and free of local transport details", () => {
    const workspace = transcriptWorkspaceFixture();
    expect(TranscriptWorkspaceResponseSchema.parse(workspace)).toMatchObject({
      schemaVersion: 1,
      source: "verified-local-cache",
      preferred: { state: "ready", source: "local" },
    });
    expect(
      TranscriptWorkspaceResponseSchema.safeParse({
        ...workspace,
        cachePath: "/private/transcript-cache/should-not-leak",
      }).success,
    ).toBe(false);
    expect(
      TranscriptWorkspaceResponseSchema.safeParse({
        ...workspace,
        downloadUrl: "https://storage.example.test/private-object",
      }).success,
    ).toBe(false);
    expect(
      TranscriptWorkspaceResponseSchema.safeParse({
        ...workspace,
        authorization: "Bearer must-not-cross-the-boundary",
      }).success,
    ).toBe(false);
    expect(
      TranscriptWorkspaceResponseSchema.safeParse({
        ...workspace,
        source: "shared-store",
        catalogState: "offline_cached",
      }).success,
    ).toBe(false);
    expect(
      TranscriptWorkspaceResponseSchema.safeParse({
        ...workspace,
        english: {
          ...workspace.english,
          track: { ...workspace.english.track, sourceTrackId: id },
        },
      }).success,
    ).toBe(false);
  });

  it("permits only an exact canonical-English alias for direct-English workspaces", () => {
    const workspace = transcriptWorkspaceFixture();
    const english = {
      ...workspace.english,
      track: {
        ...workspace.english.track,
        id: "019fbb95-cd76-7920-93fa-e23ba755ee61",
        videoId: workspace.youtubeVideoId,
        contentSha256: "b".repeat(64),
      },
      segments: workspace.english.segments.map((segment) => ({
        ...segment,
        trackId: "019fbb95-cd76-7920-93fa-e23ba755ee61",
      })),
    };
    const directEnglish = {
      ...workspace,
      original: english,
      english,
      preferred: {
        state: "ready" as const,
        source: "english" as const,
        transcript: english,
      },
    };
    expect(
      TranscriptWorkspaceResponseSchema.safeParse(directEnglish).success,
    ).toBe(true);
    expect(
      TranscriptWorkspaceResponseSchema.safeParse({
        ...directEnglish,
        original: { ...english, segments: [] },
      }).success,
    ).toBe(false);
  });
});

function transcriptWorkspaceFixture() {
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
  const catalogVideoId = "019fbb95-cd76-7920-93fa-e23ba755ee42";
  const transcriptVersionId = "019fbb95-cd76-7920-93fa-e23ba755ee43";
  const originalTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee44";
  const englishTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee45";
  const preferredTrackId = "019fbb95-cd76-7920-93fa-e23ba755ee46";
  const youtubeVideoId = "foreign-video";
  const transcript = (input: {
    id: string;
    language: string;
    kind: "original" | "english" | "translation";
    sourceTrackId?: string;
    contentSha256: string;
  }) => ({
    track: {
      id: input.id,
      videoId: youtubeVideoId,
      language: input.language,
      kind: input.kind,
      source: input.kind === "original" ? "youtube-manual" : "translated",
      provider: input.kind === "english" ? "amazon-translate" : "fixture",
      ...(input.sourceTrackId ? { sourceTrackId: input.sourceTrackId } : {}),
      timingPrecision: "cue" as const,
      schemaVersion: 1,
      contentSha256: input.contentSha256,
      version: 1,
    },
    segments: [
      {
        id:
          input.id === originalTrackId
            ? "019fbb95-cd76-7920-93fa-e23ba755ee47"
            : input.id === englishTrackId
              ? "019fbb95-cd76-7920-93fa-e23ba755ee48"
              : "019fbb95-cd76-7920-93fa-e23ba755ee49",
        trackId: input.id,
        ordinal: 0,
        startMs: 0,
        endMs: 1_000,
        text: "Fixture text",
      },
    ],
    tokens: [],
  });
  const original = transcript({
    id: originalTrackId,
    language: "ro",
    kind: "original",
    contentSha256: "a".repeat(64),
  });
  const english = transcript({
    id: englishTrackId,
    language: "en",
    kind: "english",
    sourceTrackId: originalTrackId,
    contentSha256: "b".repeat(64),
  });
  const preferred = transcript({
    id: preferredTrackId,
    language: "es",
    kind: "translation",
    sourceTrackId: originalTrackId,
    contentSha256: "c".repeat(64),
  });
  return {
    schemaVersion: 1 as const,
    projectId,
    catalogVideoId,
    youtubeVideoId,
    transcriptVersionId,
    source: "verified-local-cache" as const,
    catalogState: "active_verified" as const,
    original,
    english,
    preferred: {
      state: "ready" as const,
      source: "local" as const,
      transcript: preferred,
    },
  };
}

function successResultContractFixture() {
  const requestId = "019fbb95-cd76-7920-93fa-e23ba755ee51";
  const packageIdentity = `clip-${requestId}`;
  const artifact = (role: string, hash: string) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: hash.repeat(64),
    sourceAttempt: 1,
    validatedAt: now,
  });
  return {
    schemaVersion: 1 as const,
    requestId,
    jobId: "019fbb95-cd76-7920-93fa-e23ba755ee52",
    projectId: "019fbb95-cd76-7920-93fa-e23ba755ee53",
    clipId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
    sourceLanguageClass: "confirmed_english" as const,
    resolvedExportBounds: {
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      resolvedAt: now,
    },
    renderedMediaProvenance: {
      durationMs: 1_000,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1 as const,
      settingsSha256: "a".repeat(64),
      observedProperties: {
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
          width: 1_920,
          height: 1_080,
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
      },
      sourceAttempt: 1,
      validatedAt: now,
    },
    thumbnailProvenance: {
      extractionTimeMs: 500,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: now,
    },
    subtitleOmissionProvenance: {
      policy: "confirmed_english_user_setting" as const,
      sourceAttempt: 1,
      validatedAt: now,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("manifest_json", "2"),
      artifact("thumbnail_jpg", "3"),
      artifact("video_mp4", "4"),
    ],
  };
}
