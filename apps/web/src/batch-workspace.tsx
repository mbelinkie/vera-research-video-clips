import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiErrorSchema,
  BatchPreflightResponseSchema,
  CancelTranscriptionBatchItemResponseSchema,
  CreateTranscriptionBatchResponseSchema,
  ClipCommentNoticePageSchema,
  ClipCommentNoticeSchema,
  CreateManualTimedTranscriptImportRequestSchema,
  FinalizeManualTimedTranscriptImportRequestSchema,
  HostedTranscriptionApprovalResponseSchema,
  ManualTimedTranscriptImportStatusSchema,
  ManualTimedTranscriptImportUploadGrantSchema,
  ActivateManualTimedTranscriptCandidateRequestSchema,
  ManualTimedTranscriptActivationStatusSchema,
  ManualTimedTranscriptCandidateReviewPageSchema,
  MarkProjectVideoActivitySeenResponseSchema,
  ProjectVideoActivityPageSchema,
  ProjectVideoOwnFlagResponseSchema,
  ProjectVideoClaimResponseSchema,
  ProjectVideoGovernanceResponseSchema,
  BulkUpdateProjectVideoPriorityResponseSchema,
  ProjectVideoReviewResponseSchema,
  ProjectVideoTriageResponseSchema,
  ProjectVideoWorklistPageSchema,
  ProjectLocalProcessingStatusSchema,
  ProjectKeywordCatalogSchema,
  ProjectKeywordMatchArtifactSchema,
  ProjectKeywordScanArtifactDownloadTargetSchema,
  SuggestProjectKeywordResponseSchema,
  ReviewProjectKeywordSuggestionResponseSchema,
  WithdrawProjectKeywordSuggestionResponseSchema,
  UpdateProjectKeywordResponseSchema,
  UpdateProjectKeywordAliasResponseSchema,
  UpdateProjectLocalProcessingResponseSchema,
  ProjectSummarySchema,
  ReviewInboxResponseSchema,
  TranscriptionBatchListResponseSchema,
  formatLanguageLabel,
  languagesEquivalent,
  type BatchPreflightResponse,
  type CreateTranscriptionBatchResponse,
  type ClipSelection,
  type ClipCommentNoticePage,
  type DesktopAuthStatus,
  type DesktopNotificationNavigationTarget,
  type LanguageGate,
  type ManualTimedTranscriptFormat,
  type ManualTimedTranscriptImportStatus,
  type ManualTimedTranscriptActivationStatus,
  type ManualTimedTranscriptCandidateReviewPage,
  type ManualTimedTranscriptUploadReceipt,
  type ProjectSummary,
  type ProjectKeywordCatalog,
  type ProjectKeyword,
  type ProjectKeywordAlias,
  type ProjectKeywordMatchArtifact,
  type ProjectKeywordSuggestion,
  type ProjectLocalProcessingStatus,
  type ProjectVideoActivityPage,
  type ProjectVideoWorklistItem,
  type ProjectVideoWorklistPage,
  type ReviewInboxItem,
  type TranscriptionBatchItem,
  type TranscriptionBatchControlRequest,
  type TranscriptionBatchListResponse,
  type UpdateHostedTranscriptionApprovalRequest,
} from "@research-video/contracts";

import {
  MAX_CSV_BYTES,
  CsvImportError,
  extractCsvInputs,
  parseCsvImport,
  type CsvImportDocument,
} from "./csv-import.ts";
import { ClipQueue } from "./clip-queue.tsx";
import { apiFetch, desktopBridge, isDesktopRuntime } from "./api-client.ts";
import {
  desktopAuthenticationIssue,
  desktopSignInUnavailable,
} from "./desktop-auth-status.ts";
import {
  normalizeSpokenLanguageChoice,
  spokenLanguageChoiceLabel,
  suggestedSpokenLanguages,
} from "./spoken-language-choice.ts";
import { selectTranscriptionBatchId } from "./transcription-action-batch.ts";
import {
  CollaborationAccessPanel,
  ProjectGovernanceControls,
} from "./project-governance.tsx";
import type { ProjectDestination } from "./workspace-shell.tsx";

type BatchWorkspaceProps = {
  authorization: string;
  currentUserId?: string;
  onAuthorizationChange(value: string): void;
  desktopAuthStatus?: DesktopAuthStatus;
  onDesktopSignIn?(): Promise<void>;
  onDesktopSignOut?(): Promise<void>;
  onOpenSourceClip(target: {
    projectId: string;
    catalogVideoId: string;
    youtubeVideoId: string;
    canonicalUrl: string;
    title: string;
    clipId: string;
    selection: ClipSelection;
    fallbackNotice?: string;
    sourceTimeMs?: number;
  }): void;
  onOpenReadyVideo(target: {
    projectId: string;
    catalogVideoId: string;
    youtubeVideoId: string;
    canonicalUrl: string;
    title?: string;
    keywordEvidence?: {
      seekMs: number;
      timingPrecision: "word" | "cue" | "estimated";
      trackId: string;
      aliasPhrase: string;
    };
  }): void;
  onProjectChange(projectId: string): void;
  onProjectsChange(projects: ProjectSummary[]): void;
  onUnreadActivityChange(count: number): void;
  projectId: string;
  projects: readonly ProjectSummary[];
  destination: ProjectDestination;
  notificationTarget?: DesktopNotificationNavigationTarget;
  bulkAddRequest: number;
  externalInputsRequest?: Readonly<{
    generation: number;
    inputs: readonly string[];
  }>;
  hasOpenReviewSource?: boolean;
};

type WorklistView = "all" | "queue" | "reviewed" | "dismissed";
type KeywordResultGroup =
  "all" | "promising" | "no_matches" | "processing" | "action_needed";
type KeywordSort =
  "coverage" | "occurrences" | "density" | "duration" | "priority" | "recency";
type KeywordEvidenceState =
  | { state: "loading"; scanId: string }
  | { state: "error"; scanId: string; message: string }
  | { state: "ready"; scanId: string; artifact: ProjectKeywordMatchArtifact };
type KeywordEvidenceResult = Pick<
  NonNullable<ProjectVideoWorklistItem["keywordScan"]["priorResult"]>,
  | "scanId"
  | "transcriptVersionId"
  | "keywordSetVersion"
  | "scannerSchemaVersion"
  | "artifact"
>;

export function BatchWorkspace({
  authorization,
  currentUserId,
  onAuthorizationChange,
  desktopAuthStatus,
  onDesktopSignIn,
  onDesktopSignOut,
  onOpenSourceClip,
  onOpenReadyVideo,
  onProjectChange,
  onProjectsChange,
  onUnreadActivityChange,
  projectId,
  projects,
  destination,
  notificationTarget,
  bulkAddRequest,
  externalInputsRequest,
  hasOpenReviewSource = false,
}: BatchWorkspaceProps) {
  const [batchName, setBatchName] = useState("Research batch");
  const [inputsText, setInputsText] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState("prefer-existing");
  const [executionLocation, setExecutionLocation] = useState("local");
  const [priority, setPriority] = useState("normal");
  const [translationConsentAccepted, setTranslationConsentAccepted] =
    useState(false);
  const [preflight, setPreflight] = useState<BatchPreflightResponse>();
  const [csvDocument, setCsvDocument] = useState<CsvImportDocument>();
  const [csvColumnIndex, setCsvColumnIndex] = useState("");
  const [batchList, setBatchList] = useState<TranscriptionBatchListResponse>();
  const [selectedBatch, setSelectedBatch] =
    useState<CreateTranscriptionBatchResponse>();
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [showCanceledItems, setShowCanceledItems] = useState(false);
  const [reviewInboxExpanded, setReviewInboxExpanded] =
    useState(!hasOpenReviewSource);
  const [reviewItems, setReviewItems] = useState<ReviewInboxItem[]>([]);
  const [worklist, setWorklist] = useState<ProjectVideoWorklistPage>();
  const [localProcessing, setLocalProcessing] =
    useState<ProjectLocalProcessingStatus>();
  const [keywordCatalog, setKeywordCatalog] = useState<ProjectKeywordCatalog>();
  const [keywordTargetId, setKeywordTargetId] = useState("new");
  const [keywordLabel, setKeywordLabel] = useState("");
  const [keywordDescription, setKeywordDescription] = useState("");
  const [keywordLanguage, setKeywordLanguage] = useState("en");
  const [keywordPhrase, setKeywordPhrase] = useState("");
  const [keywordRationale, setKeywordRationale] = useState("");
  const [worklistView, setWorklistView] = useState<WorklistView>("queue");
  const [selectedWorklistVideoIds, setSelectedWorklistVideoIds] = useState<
    Set<string>
  >(new Set());
  const [keywordResultGroup, setKeywordResultGroup] =
    useState<KeywordResultGroup>("all");
  const [keywordStatusFilter, setKeywordStatusFilter] = useState("all");
  const [keywordIdFilter, setKeywordIdFilter] = useState("");
  const [keywordSort, setKeywordSort] = useState<KeywordSort>("coverage");
  const [keywordEvidence, setKeywordEvidence] = useState<
    Record<string, KeywordEvidenceState>
  >({});
  const [activity, setActivity] = useState<ProjectVideoActivityPage>();
  const [commentNotices, setCommentNotices] = useState<ClipCommentNoticePage>();
  const [activityIssue, setActivityIssue] = useState<string>();
  const [languageDecisionDrafts, setLanguageDecisionDrafts] = useState<
    Record<string, LanguageDecisionDraft>
  >({});
  const [timedImportDrafts, setTimedImportDrafts] = useState<
    Record<string, TimedImportDraft>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Connect with a development session credential to load your projects.",
  );
  const requestGeneration = useRef(0);
  const batchRequestGeneration = useRef(0);
  const createBatchInFlight = useRef(false);
  const timedImportGeneration = useRef(0);
  const bulkInputsRef = useRef<HTMLTextAreaElement>(null);
  const batchNameRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const currentProjectId = useRef(projectId);
  const currentAuthorization = useRef(authorization);
  currentProjectId.current = projectId;
  currentAuthorization.current = authorization;

  function isCurrentRequest(generation: number, targetProjectId: string) {
    return (
      generation === requestGeneration.current &&
      targetProjectId === currentProjectId.current &&
      authorization === currentAuthorization.current
    );
  }

  function clearProjectState() {
    setBatchList(undefined);
    setSelectedBatch(undefined);
    setSelectedBatchId("");
    setShowBatchHistory(false);
    setShowCanceledItems(false);
    setReviewItems([]);
    setWorklist(undefined);
    setLocalProcessing(undefined);
    setKeywordCatalog(undefined);
    setKeywordTargetId("new");
    setKeywordLabel("");
    setKeywordDescription("");
    setKeywordLanguage("en");
    setKeywordPhrase("");
    setKeywordRationale("");
    setSelectedWorklistVideoIds(new Set());
    setKeywordResultGroup("all");
    setKeywordStatusFilter("all");
    setKeywordIdFilter("");
    setKeywordSort("coverage");
    setKeywordEvidence({});
    setActivity(undefined);
    setCommentNotices(undefined);
    setActivityIssue(undefined);
    setPreflight(undefined);
    setLanguageDecisionDrafts({});
    setTimedImportDrafts({});
    timedImportGeneration.current += 1;
  }

  useEffect(() => {
    requestGeneration.current += 1;
    batchRequestGeneration.current += 1;
    clearProjectState();
  }, [projectId, authorization]);

  useEffect(() => {
    setReviewInboxExpanded(!hasOpenReviewSource);
  }, [hasOpenReviewSource]);

  useEffect(() => {
    if (!isDesktopRuntime() || desktopAuthStatus?.state !== "signed_in") return;
    setMessage(
      currentUserId
        ? projects.length
          ? `Connected. ${projects.length} project${projects.length === 1 ? "" : "s"} available.`
          : "Connected. Create your first project from Account → Personal and local setup."
        : "Finish your account profile from Account → Personal and local setup.",
    );
  }, [currentUserId, desktopAuthStatus?.state, projects.length]);

  useEffect(() => {
    onUnreadActivityChange(
      (activity?.unreadCount ?? 0) +
        (commentNotices?.notices.filter(
          (notice) =>
            notice.projectId === projectId && notice.state === "unread",
        ).length ?? 0),
    );
  }, [
    activity?.unreadCount,
    commentNotices,
    onUnreadActivityChange,
    projectId,
  ]);

  useEffect(() => {
    if (!bulkAddRequest) return;
    bulkInputsRef.current?.scrollIntoView({ block: "center" });
    bulkInputsRef.current?.focus();
  }, [bulkAddRequest]);

  useEffect(() => {
    if (!externalInputsRequest?.inputs.length) return;
    setInputsText(externalInputsRequest.inputs.join("\n"));
    setPreflight(undefined);
    setMessage(
      `${externalInputsRequest.inputs.length} selected search result${externalInputsRequest.inputs.length === 1 ? "" : "s"} loaded. Run preflight to check project duplicates before confirmation.`,
    );
    window.setTimeout(() => {
      bulkInputsRef.current?.scrollIntoView({ block: "center" });
      bulkInputsRef.current?.focus();
    });
  }, [externalInputsRequest?.generation]);

  const inputs = useMemo(
    () =>
      inputsText
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    [inputsText],
  );

  const request = useCallback(
    async (
      path: string,
      init: Pick<RequestInit, "body" | "method" | "signal"> = {},
    ) => {
      const response = await apiFetch("cloud", path, init, authorization);
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new CloudRequestError(
          parsed.success ? parsed.data.error.message : "Cloud request failed.",
          parsed.success ? parsed.data.error.code : "request_failed",
        );
      }
      return payload;
    },
    [authorization],
  );

  async function connect() {
    setBusy(true);
    try {
      const loaded = ProjectSummarySchema.array().parse(
        await request("/api/projects"),
      );
      onProjectsChange(loaded);
      onProjectChange(
        loaded.some((project) => project.id === projectId)
          ? projectId
          : (loaded[0]?.id ?? ""),
      );
      setMessage(
        loaded.length
          ? `Connected. ${loaded.length} project${loaded.length === 1 ? "" : "s"} available.`
          : "Connected, but this account has no projects yet.",
      );
    } catch (error) {
      onProjectsChange([]);
      onProjectChange("");
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshProjects() {
    const loaded = ProjectSummarySchema.array().parse(
      await request("/api/projects"),
    );
    onProjectsChange(loaded);
    const nextProjectId = loaded.some((project) => project.id === projectId)
      ? projectId
      : (loaded[0]?.id ?? "");
    if (nextProjectId !== projectId) onProjectChange(nextProjectId);
  }

  async function refreshProject(
    targetProjectId = projectId,
    preferredBatchId = selectedBatchId,
  ) {
    if (!targetProjectId || !authorization) return;
    const generation = requestGeneration.current;
    try {
      const [
        listed,
        inbox,
        canonicalWorklist,
        localProcessingResult,
        projectKeywordResult,
        projectActivityResult,
        commentNoticeResult,
      ] = await Promise.all([
        request(`/api/projects/${targetProjectId}/transcription-batches`),
        request(`/api/projects/${targetProjectId}/review-inbox`),
        request(
          `/api/projects/${targetProjectId}/worklist?limit=50&view=${worklistView}`,
        ),
        request(`/api/projects/${targetProjectId}/local-processing`),
        request(`/api/projects/${targetProjectId}/keywords`),
        request(`/api/projects/${targetProjectId}/activity?limit=10&state=all`)
          .then((payload) => ({ payload }))
          .catch((error: unknown) => ({ error: errorMessage(error) })),
        request("/api/activity/clip-comments")
          .then((payload) => ({ payload }))
          .catch((error: unknown) => ({ error: errorMessage(error) })),
      ]);
      const parsedList = TranscriptionBatchListResponseSchema.parse(listed);
      const parsedInbox = ReviewInboxResponseSchema.parse(inbox);
      const parsedWorklist =
        ProjectVideoWorklistPageSchema.parse(canonicalWorklist);
      const parsedLocalProcessing = ProjectLocalProcessingStatusSchema.parse(
        localProcessingResult,
      );
      const parsedKeywordCatalog =
        ProjectKeywordCatalogSchema.parse(projectKeywordResult);
      const parsedActivity =
        "payload" in projectActivityResult
          ? ProjectVideoActivityPageSchema.parse(projectActivityResult.payload)
          : undefined;
      const parsedCommentNotices =
        "payload" in commentNoticeResult
          ? ClipCommentNoticePageSchema.parse(commentNoticeResult.payload)
          : undefined;
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setBatchList(parsedList);
      setReviewItems(parsedInbox.items);
      setWorklist(parsedWorklist);
      setLocalProcessing(parsedLocalProcessing);
      setKeywordCatalog(parsedKeywordCatalog);
      setActivity(parsedActivity);
      setCommentNotices(parsedCommentNotices);
      setActivityIssue(
        "error" in projectActivityResult
          ? projectActivityResult.error
          : undefined,
      );
      const availableVideoIds = new Set(
        parsedWorklist.items.map((item) => item.video.id),
      );
      setSelectedWorklistVideoIds(
        (current) =>
          new Set(
            [...current].filter((videoId) => availableVideoIds.has(videoId)),
          ),
      );
      const selectedId = selectTranscriptionBatchId(
        showBatchHistory
          ? parsedList.batches
          : parsedList.batches.filter(
              (entry) =>
                entry.progress.total === 0 ||
                entry.progress.canceled < entry.progress.total,
            ),
        parsedWorklist.items,
        preferredBatchId,
      );
      if (selectedId) await loadBatch(targetProjectId, selectedId, generation);
      else {
        if (!isCurrentRequest(generation, targetProjectId)) return;
        setSelectedBatch(undefined);
        setSelectedBatchId("");
      }
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId))
        setMessage(errorMessage(error));
    }
  }

  async function loadBatch(
    targetProjectId: string,
    batchId: string,
    generation = requestGeneration.current,
  ) {
    const batchGeneration = ++batchRequestGeneration.current;
    const payload = await request(
      `/api/projects/${targetProjectId}/transcription-batches/${batchId}`,
    );
    if (
      !isCurrentRequest(generation, targetProjectId) ||
      batchGeneration !== batchRequestGeneration.current
    )
      return;
    const parsed = CreateTranscriptionBatchResponseSchema.parse(payload);
    if (selectedBatchId !== batchId) {
      timedImportGeneration.current += 1;
      setTimedImportDrafts({});
    }
    setSelectedBatch(parsed);
    setSelectedBatchId(batchId);
    void refreshTimedImportStatuses(
      targetProjectId,
      parsed,
      generation,
      batchGeneration,
    );
  }

  useEffect(() => {
    if (
      notificationTarget?.kind !== "transcription" ||
      notificationTarget.projectId !== projectId ||
      !authorization
    ) {
      return;
    }
    void loadBatch(projectId, notificationTarget.batchId).catch((error) =>
      setMessage(errorMessage(error)),
    );
  }, [authorization, notificationTarget, projectId]);

  useEffect(() => {
    if (!projectId || !authorization) return;
    void refreshProject(projectId);
    const timer = window.setInterval(
      () => void refreshProject(projectId),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [projectId, authorization, selectedBatchId, worklistView]);

  const requestOptions = {
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy,
    executionLocation,
    priority,
    ...(translationConsentAccepted
      ? {
          translationConsent: {
            provider: "amazon-translate" as const,
            disclosureVersion: 1 as const,
            transcriptTextTransferAccepted: true as const,
          },
        }
      : {}),
  };

  async function runPreflight() {
    if (!projectId || inputs.length === 0) return;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/videos/preflight`,
        {
          method: "POST",
          body: JSON.stringify({ inputs, ...requestOptions }),
        },
      );
      setPreflight(BatchPreflightResponseSchema.parse(payload));
      setMessage(
        "Preflight complete. Review every row before creating the batch.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadCsv(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_CSV_BYTES) {
        throw new CsvImportError("CSV files must be 2 MB or smaller.");
      }
      const document = parseCsvImport(await file.text());
      setCsvDocument(document);
      setCsvColumnIndex(
        document.suggestedColumnIndex === undefined
          ? ""
          : String(document.suggestedColumnIndex),
      );
      setMessage(
        `Loaded ${document.rows.length} CSV row${document.rows.length === 1 ? "" : "s"}. Choose the URL column before applying it.`,
      );
    } catch (error) {
      setCsvDocument(undefined);
      setCsvColumnIndex("");
      setMessage(errorMessage(error));
    }
  }

  function applyCsv() {
    if (!csvDocument || csvColumnIndex === "") return;
    try {
      const extracted = extractCsvInputs(csvDocument, Number(csvColumnIndex));
      setInputsText(extracted.inputs.join("\n"));
      setPreflight(undefined);
      setMessage(
        `Applied ${extracted.inputs.length} CSV value${extracted.inputs.length === 1 ? "" : "s"}${extracted.ignoredEmptyRows ? ` and ignored ${extracted.ignoredEmptyRows} empty row${extracted.ignoredEmptyRows === 1 ? "" : "s"}` : ""}. Run preflight to validate and deduplicate them.`,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function createBatch() {
    if (
      createBatchInFlight.current ||
      !projectId ||
      !preflight ||
      !batchName.trim()
    )
      return;
    createBatchInFlight.current = true;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/transcription-batches`,
        {
          method: "POST",
          body: JSON.stringify({
            name: batchName,
            inputs,
            ...requestOptions,
          }),
        },
      );
      const created = CreateTranscriptionBatchResponseSchema.parse(payload);
      setSelectedBatch(created);
      setSelectedBatchId(created.batch.id);
      setBatchName("");
      setInputsText("");
      setCsvDocument(undefined);
      setCsvColumnIndex("");
      if (csvInputRef.current) csvInputRef.current.value = "";
      setPreflight(undefined);
      setMessage(`Created “${created.batch.name}”.`);
      await refreshProject(projectId, created.batch.id);
      window.requestAnimationFrame(() => batchNameRef.current?.focus());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      createBatchInFlight.current = false;
      setBusy(false);
    }
  }

  async function controlBatch(
    action: TranscriptionBatchControlRequest["action"],
  ) {
    if (!projectId || !selectedBatch) return;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/transcription-batches/${selectedBatch.batch.id}/control`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            expectedVersion: selectedBatch.batch.version,
          }),
        },
      );
      setSelectedBatch(CreateTranscriptionBatchResponseSchema.parse(payload));
      setMessage("Batch control applied.");
      await refreshProject(projectId);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBatchItem(item: TranscriptionBatchItem) {
    if (!projectId || !selectedBatch) return;
    setBusy(true);
    try {
      const idempotencyKey = await payloadIdempotencyKey(
        "transcription-batch-item-cancel",
        {
          projectId,
          batchId: selectedBatch.batch.id,
          itemId: item.id,
          expectedVersion: item.version,
        },
      );
      CancelTranscriptionBatchItemResponseSchema.parse(
        await request(
          `/api/projects/${projectId}/transcription-batches/${selectedBatch.batch.id}/items/${item.id}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({
              idempotencyKey,
              expectedVersion: item.version,
            }),
          },
        ),
      );
      setMessage(
        transcriptionActiveItemStates.has(item.state)
          ? "Cancellation requested. The worker will stop at its next safe checkpoint."
          : "Item canceled.",
      );
      await refreshProject(projectId, selectedBatch.batch.id);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId, selectedBatch.batch.id);
    } finally {
      setBusy(false);
    }
  }

  async function updateHostedApproval(
    action: UpdateHostedTranscriptionApprovalRequest["action"],
  ) {
    if (!projectId || !selectedBatch?.batch.hostedApproval) return;
    setBusy(true);
    try {
      const expectedVersion = selectedBatch.batch.hostedApproval.version;
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-hosted-approval",
        {
          projectId,
          batchId: selectedBatch.batch.id,
          action,
          expectedVersion,
        },
      );
      HostedTranscriptionApprovalResponseSchema.parse(
        await request(
          `/api/projects/${projectId}/transcription-batches/${selectedBatch.batch.id}/hosted-approval`,
          {
            method: "POST",
            body: JSON.stringify({
              action,
              idempotencyKey,
              expectedVersion,
            }),
          },
        ),
      );
      setMessage(
        action === "approve"
          ? "Hosted processing approved for this exact batch."
          : "Hosted approval revoked. Unclaimed work is blocked.",
      );
      await refreshProject(projectId, selectedBatch.batch.id);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId, selectedBatch.batch.id);
    } finally {
      setBusy(false);
    }
  }

  async function updateLocalProcessing(
    state: ProjectLocalProcessingStatus["policy"]["state"],
  ) {
    if (!projectId || !localProcessing) return;
    setBusy(true);
    try {
      const expectedVersion = localProcessing.policy.version;
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-local-processing",
        { projectId, state, expectedVersion },
      );
      const updated = UpdateProjectLocalProcessingResponseSchema.parse(
        await request(`/api/projects/${projectId}/local-processing`, {
          method: "PATCH",
          body: JSON.stringify({ state, expectedVersion, idempotencyKey }),
        }),
      );
      setLocalProcessing(ProjectLocalProcessingStatusSchema.parse(updated));
      setMessage(
        state === "paused"
          ? "New local processing starts are paused; active work may finish safely."
          : `Local processing is automatic. Queued ${updated.enqueuedCount} missing video${updated.enqueuedCount === 1 ? "" : "s"}${updated.remainingUnprocessedCount ? `; ${updated.remainingUnprocessedCount} remain for another bounded pass` : ""}.`,
      );
      await refreshProject(projectId, selectedBatchId);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId, selectedBatchId);
    } finally {
      setBusy(false);
    }
  }

  async function suggestKeyword() {
    if (!projectId || !keywordCatalog || !keywordPhrase.trim()) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const suggestion = {
      ...(keywordTargetId === "new"
        ? {
            proposedLabel: keywordLabel,
            ...(keywordDescription.trim()
              ? { proposedDescription: keywordDescription }
              : {}),
          }
        : { keywordId: keywordTargetId }),
      language: keywordLanguage,
      phrase: keywordPhrase,
      ...(keywordRationale.trim() ? { rationale: keywordRationale } : {}),
    };
    setBusy(true);
    try {
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-keyword-suggestion",
        { projectId: targetProjectId, ...suggestion },
      );
      const response = SuggestProjectKeywordResponseSchema.parse(
        await request(`/api/projects/${targetProjectId}/keyword-suggestions`, {
          method: "POST",
          body: JSON.stringify({ ...suggestion, idempotencyKey }),
        }),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setKeywordPhrase("");
      setKeywordRationale("");
      if (keywordTargetId === "new") {
        setKeywordLabel("");
        setKeywordDescription("");
      }
      setMessage(
        response.resolution === "created"
          ? "Keyword suggestion submitted for project review."
          : response.resolution === "existing_pending"
            ? "An equivalent language-specific suggestion is already pending."
            : "That language-specific literal alias is already approved.",
      );
      await refreshProject(targetProjectId, selectedBatchId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId, selectedBatchId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reviewKeywordSuggestion(
    suggestion: ProjectKeywordSuggestion,
    action: "approve" | "reject",
  ) {
    if (!projectId || !keywordCatalog) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const reason =
      action === "reject"
        ? window.prompt("Optional reason for rejecting this suggestion:")
        : null;
    if (action === "reject" && reason === null) return;
    const review = {
      action,
      expectedSuggestionVersion: suggestion.version,
      expectedKeywordSetVersion: keywordCatalog.keywordSetVersion,
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    };
    setBusy(true);
    try {
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-keyword-review",
        {
          projectId: targetProjectId,
          suggestionId: suggestion.id,
          ...review,
        },
      );
      ReviewProjectKeywordSuggestionResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/keyword-suggestions/${suggestion.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({ ...review, idempotencyKey }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        action === "approve"
          ? "Keyword suggestion approved; the project keyword-set version advanced."
          : "Keyword suggestion rejected; the approved keyword set is unchanged.",
      );
      await refreshProject(targetProjectId, selectedBatchId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId, selectedBatchId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdrawKeywordSuggestion(
    suggestion: ProjectKeywordSuggestion,
  ) {
    if (!projectId) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const reason = window.prompt(
      "Optional reason for withdrawing this suggestion:",
    );
    if (reason === null) return;
    const withdrawal = {
      expectedSuggestionVersion: suggestion.version,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    setBusy(true);
    try {
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-keyword-withdrawal",
        {
          projectId: targetProjectId,
          suggestionId: suggestion.id,
          ...withdrawal,
        },
      );
      WithdrawProjectKeywordSuggestionResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/keyword-suggestions/${suggestion.id}/withdraw`,
          {
            method: "POST",
            body: JSON.stringify({ ...withdrawal, idempotencyKey }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        "Pending keyword suggestion withdrawn; approved vocabulary is unchanged.",
      );
      await refreshProject(targetProjectId, selectedBatchId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId, selectedBatchId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateKeyword(
    keyword: ProjectKeyword,
    patch: { label?: string; description?: string | null; enabled?: boolean },
  ) {
    if (!projectId || !keywordCatalog) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const command = {
      ...patch,
      expectedKeywordVersion: keyword.version,
      expectedKeywordSetVersion: keywordCatalog.keywordSetVersion,
    };
    setBusy(true);
    try {
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-keyword-update",
        { projectId: targetProjectId, keywordId: keyword.id, ...command },
      );
      UpdateProjectKeywordResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/keywords/${keyword.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ ...command, idempotencyKey }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        "Project vocabulary changed; current scan evidence is stale and replacement scans were queued.",
      );
      await refreshProject(targetProjectId, selectedBatchId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId, selectedBatchId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateKeywordAlias(
    keyword: ProjectKeyword,
    alias: ProjectKeywordAlias,
    patch: { language?: string; phrase?: string; enabled?: boolean },
  ) {
    if (!projectId || !keywordCatalog) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const command = {
      ...patch,
      expectedAliasVersion: alias.version,
      expectedKeywordSetVersion: keywordCatalog.keywordSetVersion,
    };
    setBusy(true);
    try {
      const idempotencyKey = await payloadIdempotencyKey(
        "workbench-keyword-alias-update",
        {
          projectId: targetProjectId,
          keywordId: keyword.id,
          aliasId: alias.id,
          ...command,
        },
      );
      UpdateProjectKeywordAliasResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/keywords/${keyword.id}/aliases/${alias.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ ...command, idempotencyKey }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        "Project vocabulary changed; current scan evidence is stale and replacement scans were queued.",
      );
      await refreshProject(targetProjectId, selectedBatchId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId, selectedBatchId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateReview(item: ReviewInboxItem, reviewStatus: string) {
    if (!projectId) return;
    setBusy(true);
    try {
      await request(`/api/projects/${projectId}/review-inbox/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus, expectedVersion: item.version }),
      });
      setMessage("Review status updated.");
      await refreshProject(projectId);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function updateOwnFlag(item: ProjectVideoWorklistItem) {
    if (!projectId || !item.ownFlag) return;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/worklist/${item.video.id}/flag`,
        {
          method: "PATCH",
          body: JSON.stringify({
            active: !item.ownFlag.active,
            expectedVersion: item.ownFlag.version,
          }),
        },
      );
      ProjectVideoOwnFlagResponseSchema.parse(payload);
      setMessage(
        item.ownFlag.active
          ? "Your flag was removed; shared research evidence was preserved."
          : "Your flag was restored.",
      );
      await refreshProject(projectId);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function updateClaim(
    item: ProjectVideoWorklistItem,
    action: "claim" | "renew" | "release",
    takeoverConfirmed = false,
  ) {
    if (!projectId) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const expectedClaimVersion = item.claim?.version ?? 0;
    const leaseSeconds = action === "release" ? undefined : 300;
    const idempotencyKey = [
      "workbench-claim",
      action,
      `v${expectedClaimVersion}`,
      `lease-${leaseSeconds ?? "none"}`,
      `takeover-${takeoverConfirmed}`,
    ].join(":");
    setBusy(true);
    try {
      ProjectVideoClaimResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/worklist/${item.video.id}/claim`,
          {
            method: "POST",
            body: JSON.stringify({
              action,
              idempotencyKey,
              expectedClaimVersion,
              ...(leaseSeconds ? { leaseSeconds } : {}),
              ...(action === "claim" ? { takeoverConfirmed } : {}),
            }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        action === "release"
          ? "Review claim released."
          : action === "renew"
            ? "Review claim renewed for five minutes."
            : takeoverConfirmed
              ? "Review claim explicitly taken over for five minutes."
              : "Video claimed for review for five minutes.",
      );
      await refreshProject(targetProjectId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateGovernance(
    item: ProjectVideoWorklistItem,
    change:
      | { priority: ProjectVideoWorklistItem["priority"] }
      | {
          completionPolicy: ProjectVideoWorklistItem["completionPolicy"];
        },
  ) {
    if (!projectId) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const idempotencyKey = [
      "workbench-governance",
      `v${item.projectVideoVersion}`,
      "priority" in change ? `priority-${change.priority}` : "priority-keep",
      "completionPolicy" in change
        ? `policy-${change.completionPolicy}`
        : "policy-keep",
    ].join(":");
    setBusy(true);
    try {
      ProjectVideoGovernanceResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/worklist/${item.video.id}/governance`,
          {
            method: "PATCH",
            body: JSON.stringify({
              idempotencyKey,
              expectedProjectVideoVersion: item.projectVideoVersion,
              ...change,
            }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage("Worklist priority and review policy updated.");
      await refreshProject(targetProjectId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateBulkPriority(
    items: ProjectVideoWorklistItem[],
    nextPriority: ProjectVideoWorklistItem["priority"],
  ) {
    if (!projectId || items.length === 0) return;
    if (
      !window.confirm(
        `Set ${items.length} selected video${items.length === 1 ? "" : "s"} to ${nextPriority} priority? Owner or Administrator authority is required, and any stale row will cancel the whole change.`,
      )
    )
      return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const commandItems = items
      .map((item) => ({
        videoId: item.video.id,
        expectedProjectVideoVersion: item.projectVideoVersion,
      }))
      .sort((left, right) => left.videoId.localeCompare(right.videoId));
    const idempotencyKey = await payloadIdempotencyKey(
      "workbench-bulk-priority",
      { priority: nextPriority, items: commandItems },
    );
    setBusy(true);
    try {
      const updated = BulkUpdateProjectVideoPriorityResponseSchema.parse(
        await request(`/api/projects/${targetProjectId}/worklist/priority`, {
          method: "PATCH",
          body: JSON.stringify({
            priority: nextPriority,
            items: commandItems,
            idempotencyKey,
          }),
        }),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setSelectedWorklistVideoIds(new Set());
      setMessage(
        `${updated.items.length} video${updated.items.length === 1 ? "" : "s"} set to ${nextPriority} priority atomically.`,
      );
      await refreshProject(targetProjectId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadKeywordEvidence(
    item: ProjectVideoWorklistItem,
    result: KeywordEvidenceResult,
  ) {
    if (!projectId) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const evidenceKey = `${item.video.id}:${result.scanId}`;
    setKeywordEvidence((current) => ({
      ...current,
      [evidenceKey]: { state: "loading", scanId: result.scanId },
    }));
    try {
      const target = ProjectKeywordScanArtifactDownloadTargetSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/keyword-scans/${result.scanId}/artifact-download`,
        ),
      );
      if (
        target.scanId !== result.scanId ||
        JSON.stringify(target.artifact) !== JSON.stringify(result.artifact)
      ) {
        throw new Error(
          "The authorized keyword artifact descriptor changed. Reload the worklist before trying again.",
        );
      }
      const response = await fetch(target.downloadUrl, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "The private keyword evidence could not be downloaded.",
        );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== result.artifact.sizeBytes) {
        throw new Error("Keyword evidence size verification failed.");
      }
      if ((await sha256Hex(bytes)) !== result.artifact.sha256) {
        throw new Error("Keyword evidence checksum verification failed.");
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error("Keyword evidence is not valid JSON.");
      }
      const artifact = ProjectKeywordMatchArtifactSchema.parse(parsedJson);
      if (
        artifact.projectId !== targetProjectId ||
        artifact.projectVideoId !== item.video.id ||
        artifact.transcriptVersionId !== result.transcriptVersionId ||
        artifact.keywordSetVersion !== result.keywordSetVersion ||
        artifact.scannerSchemaVersion !== result.scannerSchemaVersion ||
        artifact.schemaVersion !== result.artifact.schemaVersion
      ) {
        throw new Error(
          "Keyword evidence does not match this exact project, video, transcript, and keyword set.",
        );
      }
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setKeywordEvidence((current) => ({
        ...current,
        [evidenceKey]: { state: "ready", scanId: result.scanId, artifact },
      }));
    } catch (error) {
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setKeywordEvidence((current) => ({
        ...current,
        [evidenceKey]: {
          state: "error",
          scanId: result.scanId,
          message: errorMessage(error),
        },
      }));
    }
  }

  async function updateCanonicalReview(
    item: ProjectVideoWorklistItem,
    action: "complete" | "reopen",
  ) {
    if (!projectId) return;
    let acknowledgeTranscriptUnavailable: boolean | undefined;
    let reason: string | undefined;
    if (action === "complete" && !item.activeTranscriptVersionId) {
      if (
        !window.confirm(
          "This video has no active transcript. Complete this review cycle with that warning acknowledged?",
        )
      )
        return;
      acknowledgeTranscriptUnavailable = true;
    } else if (action === "complete") {
      acknowledgeTranscriptUnavailable = false;
    } else {
      const entered = window.prompt(
        "Why is this completed review being reopened?",
      );
      if (entered === null || !entered.trim()) return;
      reason = entered.trim();
    }
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const idempotencyKey = [
      "workbench-review",
      action,
      item.review.id,
      `v${item.review.version}`,
      action === "complete"
        ? `ack-${acknowledgeTranscriptUnavailable}`
        : `reason-${reason}`,
    ].join(":");
    setBusy(true);
    try {
      ProjectVideoReviewResponseSchema.parse(
        await request(
          `/api/projects/${targetProjectId}/worklist/${item.video.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              action,
              idempotencyKey,
              expectedCycleId: item.review.id,
              expectedCycleVersion: item.review.version,
              ...(action === "complete"
                ? { acknowledgeTranscriptUnavailable }
                : { reason }),
            }),
          },
        ),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        action === "complete"
          ? "Review cycle completed with durable evidence."
          : "Review reopened in a new cycle; prior completion was preserved.",
      );
      await refreshProject(targetProjectId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateTriage(
    items: ProjectVideoWorklistItem[],
    action: "dismiss" | "restore",
  ) {
    if (!projectId || items.length === 0) return;
    if (
      items.length > 1 &&
      !window.confirm(
        `${action === "dismiss" ? "Dismiss" : "Restore"} ${items.length} selected videos as one all-or-nothing Administrator action?`,
      )
    )
      return;
    let reason: string | undefined;
    if (action === "dismiss") {
      const entered = window.prompt(
        items.length === 1
          ? "Why is this video being dismissed?"
          : `Why are these ${items.length} videos being dismissed?`,
      );
      if (entered === null || !entered.trim()) return;
      reason = entered.trim();
    }
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    const commandItems = items
      .map((item) => ({
        videoId: item.video.id,
        expectedProjectVideoVersion: item.projectVideoVersion,
      }))
      .sort((left, right) => left.videoId.localeCompare(right.videoId));
    const idempotencyKey = await payloadIdempotencyKey("workbench-triage", {
      action,
      items: commandItems,
      reason,
    });
    setBusy(true);
    try {
      const updated = ProjectVideoTriageResponseSchema.parse(
        await request(`/api/projects/${targetProjectId}/worklist/triage`, {
          method: "PATCH",
          body: JSON.stringify({
            action,
            idempotencyKey,
            items: commandItems,
            ...(reason ? { reason } : {}),
          }),
        }),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setSelectedWorklistVideoIds(new Set());
      const cancellationCount =
        updated.cancellation.queuedJobsCanceled +
        updated.cancellation.activeJobsRequested;
      setMessage(
        `${updated.items.length} video${updated.items.length === 1 ? "" : "s"} ${action === "dismiss" ? "dismissed" : "restored"}. Research evidence was preserved${cancellationCount ? `; ${cancellationCount} avoidable transcription job${cancellationCount === 1 ? " was" : "s were"} stopped or asked to stop` : ""}.`,
      );
      await refreshProject(targetProjectId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function markActivitySeen(eventIds?: string[]) {
    if (!projectId || !activity) return;
    const selected = activity.items.filter(
      (item) =>
        item.state === "unread" &&
        (eventIds === undefined || eventIds.includes(item.eventId)),
    );
    if (selected.length === 0) return;
    const targetProjectId = projectId;
    const generation = requestGeneration.current;
    setBusy(true);
    try {
      MarkProjectVideoActivitySeenResponseSchema.parse(
        await request(`/api/projects/${targetProjectId}/activity/seen`, {
          method: "PATCH",
          body: JSON.stringify({
            items: selected.map((item) => ({
              eventId: item.eventId,
              expectedVersion: item.version,
            })),
          }),
        }),
      );
      if (!isCurrentRequest(generation, targetProjectId)) return;
      setMessage(
        `${selected.length} activity item${selected.length === 1 ? "" : "s"} marked seen.`,
      );
      await refreshProject(targetProjectId);
    } catch (error) {
      if (isCurrentRequest(generation, targetProjectId)) {
        setMessage(errorMessage(error));
        await refreshProject(targetProjectId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function markCommentNoticeSeen(noticeId: string) {
    const notice = commentNotices?.notices.find(
      (candidate) => candidate.id === noticeId,
    );
    if (!notice || notice.state !== "unread") return;
    setBusy(true);
    try {
      ClipCommentNoticeSchema.parse(
        await request(`/api/activity/clip-comments/${noticeId}/seen`, {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: notice.version }),
        }),
      );
      await refreshProject(projectId);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmLanguage(
    item: TranscriptionBatchItem,
    gate: LanguageGate,
    resolvedLanguage: string,
  ) {
    if (!projectId || !item.catalogVideoId) return;
    const key = languageDecisionKey(projectId, item.catalogVideoId, item.id);
    const draft = languageDecisionDrafts[key];
    if (!resolvedLanguage) return;
    const idempotencyKey = draft?.idempotencyKey ?? crypto.randomUUID();
    const generation = requestGeneration.current;
    const selectionGeneration = batchRequestGeneration.current;
    setLanguageDecisionDrafts((current) => ({
      ...current,
      [key]: { resolvedLanguage, busy: true, idempotencyKey },
    }));
    try {
      await request(
        `/api/projects/${projectId}/videos/${item.catalogVideoId}/language-decisions`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey,
            expectedDecisionVersion: gate.decision?.decisionVersion ?? 0,
            resolvedLanguage,
            basis: "user_confirmation",
            ...(gate.providerEvidence?.id
              ? { evidenceId: gate.providerEvidence.id }
              : {}),
            batchItemId: item.id,
            expectedBatchItemVersion: item.version,
          }),
        },
      );
      if (!isCurrentRequest(generation, projectId)) return;
      setLanguageDecisionDrafts((current) => {
        const { [key]: _completed, ...remaining } = current;
        return remaining;
      });
      setMessage("Language confirmation recorded. Refreshing the batch.");
    } catch (error) {
      if (!isCurrentRequest(generation, projectId)) return;
      setLanguageDecisionDrafts((current) => ({
        ...current,
        [key]: {
          resolvedLanguage,
          busy: false,
          idempotencyKey,
          error: errorMessage(error),
        },
      }));
    } finally {
      if (
        isCurrentRequest(generation, projectId) &&
        selectionGeneration === batchRequestGeneration.current
      )
        await refreshProject(projectId, selectedBatchId);
    }
  }

  function setLanguageDecisionDraft(
    item: TranscriptionBatchItem,
    resolvedLanguage: string,
  ) {
    if (!projectId || !item.catalogVideoId) return;
    const key = languageDecisionKey(projectId, item.catalogVideoId, item.id);
    setLanguageDecisionDrafts((current) => ({
      ...current,
      [key]: { resolvedLanguage, busy: false },
    }));
  }

  async function refreshTimedImportStatuses(
    targetProjectId: string,
    batch: CreateTranscriptionBatchResponse,
    generation: number,
    selectionGeneration: number,
  ) {
    const candidates = batch.items.filter((item) => item.catalogVideoId);
    const operationGeneration = timedImportGeneration.current;
    await Promise.all(
      candidates.map(async (item) => {
        const key = timedImportKey(
          targetProjectId,
          item.catalogVideoId!,
          item.id,
        );
        try {
          const payload = await request(
            `/api/projects/${targetProjectId}/videos/${item.catalogVideoId}/timed-transcript-imports?batchItemId=${encodeURIComponent(item.id)}`,
          );
          const status = ManualTimedTranscriptImportStatusSchema.parse(payload);
          if (
            !isCurrentRequest(generation, targetProjectId) ||
            selectionGeneration !== batchRequestGeneration.current
          )
            return;
          setTimedImportDrafts((current) => ({
            ...current,
            [key]: { ...(current[key] ?? { phase: "idle" as const }), status },
          }));
          if (status.state === "finalized" && status.candidate) {
            const review = ManualTimedTranscriptCandidateReviewPageSchema.parse(
              await request(
                `/api/projects/${targetProjectId}/videos/${item.catalogVideoId}/timed-transcript-candidates/${status.candidate.candidateId}/review?offset=0&limit=25`,
              ),
            );
            if (
              !isCurrentTimedImport(
                generation,
                selectionGeneration,
                operationGeneration,
                targetProjectId,
              )
            )
              return;
            setTimedImportDrafts((current) => ({
              ...current,
              [key]: {
                ...(current[key] ?? { phase: "finalized" as const }),
                phase:
                  current[key]?.activation?.state === "activated"
                    ? "activated"
                    : "finalized",
                status,
                review,
              },
            }));
          }
        } catch (error) {
          if (error instanceof CloudRequestError && error.code === "not_found")
            return;
          if (
            isCurrentRequest(generation, targetProjectId) &&
            selectionGeneration === batchRequestGeneration.current
          ) {
            setTimedImportDrafts((current) => ({
              ...current,
              [key]: {
                ...(current[key] ?? { phase: "idle" as const }),
                phase: "failed",
                error: errorMessage(error),
              },
            }));
          }
        }
      }),
    );
  }

  function setTimedImportFile(
    item: TranscriptionBatchItem,
    role: "original" | "english",
    file: File | undefined,
  ) {
    if (!projectId || !item.catalogVideoId) return;
    const key = timedImportKey(projectId, item.catalogVideoId, item.id);
    setTimedImportDrafts((current) => {
      const draft = current[key] ?? { phase: "idle" as const };
      const { error: _error, status: _status, ...remaining } = draft;
      const next = (() => {
        if (role === "original") {
          const { original: _original, ...withoutOriginal } = remaining;
          return {
            ...withoutOriginal,
            phase: "idle" as const,
            ...(file ? { original: file } : {}),
          };
        }
        const { english: _english, ...withoutEnglish } = remaining;
        return {
          ...withoutEnglish,
          phase: "idle" as const,
          ...(file ? { english: file } : {}),
        };
      })();
      return { ...current, [key]: next };
    });
  }

  async function createTimedImport(
    item: TranscriptionBatchItem,
    gate: LanguageGate,
  ) {
    if (!projectId || !item.catalogVideoId || !gate.decision) return;
    const key = timedImportKey(projectId, item.catalogVideoId, item.id);
    const draft = timedImportDrafts[key];
    if (!draft?.original || !draft.english) return;
    const generation = requestGeneration.current;
    const selectionGeneration = batchRequestGeneration.current;
    const operationGeneration = ++timedImportGeneration.current;
    if (draft.importId && draft.originalReceipt && draft.englishReceipt) {
      await finalizeTimedImport({
        item,
        key,
        importId: draft.importId,
        original: draft.originalReceipt,
        english: draft.englishReceipt,
        finalizeIdempotencyKey:
          draft.finalizeIdempotencyKey ?? crypto.randomUUID(),
        generation,
        selectionGeneration,
        operationGeneration,
      });
      return;
    }
    const createIdempotencyKey =
      draft.createIdempotencyKey ?? crypto.randomUUID();
    const finalizeIdempotencyKey =
      draft.finalizeIdempotencyKey ?? crypto.randomUUID();
    try {
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...draft,
          phase: "creating",
          createIdempotencyKey,
          finalizeIdempotencyKey,
        },
      }));
      const [original, english] = await Promise.all([
        timedFileDescriptor(draft.original),
        timedFileDescriptor(draft.english),
      ]);
      const created = ManualTimedTranscriptImportUploadGrantSchema.parse(
        await request(
          `/api/projects/${projectId}/videos/${item.catalogVideoId}/timed-transcript-imports`,
          {
            method: "POST",
            body: JSON.stringify(
              CreateManualTimedTranscriptImportRequestSchema.parse({
                idempotencyKey: createIdempotencyKey,
                languageDecisionId: gate.decision.id,
                expectedDecisionVersion: gate.decision.decisionVersion,
                batchItemId: item.id,
                expectedBatchItemVersion: item.version,
                original,
                english,
              }),
            ),
          },
        ),
      );
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: { ...current[key]!, phase: "uploading" },
      }));
      const [originalReceipt, englishReceipt] = await Promise.all([
        uploadTimedFile(
          created.targets.find((target) => target.role === "original"),
          created.importId,
          draft.original,
          original,
        ),
        uploadTimedFile(
          created.targets.find((target) => target.role === "english"),
          created.importId,
          draft.english,
          english,
        ),
      ]);
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...current[key]!,
          phase: "finalizing",
          importId: created.importId,
          originalReceipt,
          englishReceipt,
          finalizeIdempotencyKey,
        },
      }));
      await finalizeTimedImport({
        item,
        key,
        importId: created.importId,
        original: originalReceipt,
        english: englishReceipt,
        finalizeIdempotencyKey,
        generation,
        selectionGeneration,
        operationGeneration,
      });
    } catch (error) {
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...current[key]!,
          phase: "failed",
          error: errorMessage(error),
        },
      }));
    }
  }

  async function finalizeTimedImport(input: {
    item: TranscriptionBatchItem;
    key: string;
    importId: string;
    original: ManualTimedTranscriptUploadReceipt;
    english: ManualTimedTranscriptUploadReceipt;
    finalizeIdempotencyKey: string;
    generation: number;
    selectionGeneration: number;
    operationGeneration: number;
    takeoverAttempts?: number;
  }) {
    if (!projectId || !input.item.catalogVideoId) return;
    const takeoverAttempts = input.takeoverAttempts ?? 0;
    try {
      setTimedImportDrafts((current) => {
        const { error: _error, ...draft } = current[input.key]!;
        return {
          ...current,
          [input.key]: {
            ...draft,
            phase: "finalizing",
            importId: input.importId,
            originalReceipt: input.original,
            englishReceipt: input.english,
            finalizeIdempotencyKey: input.finalizeIdempotencyKey,
            finalizeTakeoverAttempts: takeoverAttempts,
          },
        };
      });
      const status = ManualTimedTranscriptImportStatusSchema.parse(
        await request(
          `/api/projects/${projectId}/videos/${input.item.catalogVideoId}/timed-transcript-imports/${input.importId}/finalize`,
          {
            method: "POST",
            body: JSON.stringify(
              FinalizeManualTimedTranscriptImportRequestSchema.parse({
                idempotencyKey: input.finalizeIdempotencyKey,
                original: input.original,
                english: input.english,
              }),
            ),
          },
        ),
      );
      if (
        !isCurrentTimedImport(
          input.generation,
          input.selectionGeneration,
          input.operationGeneration,
          projectId,
        )
      )
        return;
      if (status.state === "finalized") {
        setTimedImportDrafts((current) => ({
          ...current,
          [input.key]: { phase: "finalized", status },
        }));
        await refreshProject(projectId, selectedBatchId);
        return;
      }
      setTimedImportDrafts((current) => ({
        ...current,
        [input.key]: {
          ...current[input.key]!,
          phase: "finalizing",
          importId: input.importId,
          originalReceipt: input.original,
          englishReceipt: input.english,
          finalizeIdempotencyKey: input.finalizeIdempotencyKey,
          finalizeTakeoverAttempts: takeoverAttempts,
          status,
        },
      }));
      if (takeoverAttempts >= 1) {
        setTimedImportDrafts((current) => ({
          ...current,
          [input.key]: {
            ...current[input.key]!,
            phase: "failed",
            error:
              "Timed transcript finalization is still in progress. Retry confirmation when it is available.",
          },
        }));
        return;
      }
      void pollThenTakeOverTimedImport({
        ...input,
        takeoverAttempts: takeoverAttempts + 1,
      });
    } catch (error) {
      if (
        !isCurrentTimedImport(
          input.generation,
          input.selectionGeneration,
          input.operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [input.key]: {
          ...current[input.key]!,
          phase: "failed",
          importId: input.importId,
          originalReceipt: input.original,
          englishReceipt: input.english,
          finalizeIdempotencyKey: input.finalizeIdempotencyKey,
          error: errorMessage(error),
        },
      }));
    }
  }

  async function pollThenTakeOverTimedImport(input: {
    item: TranscriptionBatchItem;
    key: string;
    importId: string;
    original: ManualTimedTranscriptUploadReceipt;
    english: ManualTimedTranscriptUploadReceipt;
    finalizeIdempotencyKey: string;
    generation: number;
    selectionGeneration: number;
    operationGeneration: number;
    takeoverAttempts: number;
  }) {
    window.setTimeout(async () => {
      if (
        !projectId ||
        !input.item.catalogVideoId ||
        !isCurrentTimedImport(
          input.generation,
          input.selectionGeneration,
          input.operationGeneration,
          projectId,
        )
      )
        return;
      try {
        const status = ManualTimedTranscriptImportStatusSchema.parse(
          await request(
            `/api/projects/${projectId}/videos/${input.item.catalogVideoId}/timed-transcript-imports?batchItemId=${encodeURIComponent(input.item.id)}`,
          ),
        );
        if (
          !isCurrentTimedImport(
            input.generation,
            input.selectionGeneration,
            input.operationGeneration,
            projectId,
          )
        )
          return;
        if (status.state === "finalized") {
          setTimedImportDrafts((current) => ({
            ...current,
            [input.key]: { phase: "finalized", status },
          }));
          await refreshProject(projectId, selectedBatchId);
          return;
        }
        await finalizeTimedImport(input);
      } catch (error) {
        if (
          isCurrentTimedImport(
            input.generation,
            input.selectionGeneration,
            input.operationGeneration,
            projectId,
          )
        ) {
          setTimedImportDrafts((current) => ({
            ...current,
            [input.key]: {
              ...current[input.key]!,
              phase: "failed",
              error: errorMessage(error),
            },
          }));
        }
      }
    }, timedImportFinalizeTakeoverDelayMs);
  }

  function isCurrentTimedImport(
    generation: number,
    selectionGeneration: number,
    operationGeneration: number,
    targetProjectId: string,
  ) {
    return (
      isCurrentRequest(generation, targetProjectId) &&
      selectionGeneration === batchRequestGeneration.current &&
      operationGeneration === timedImportGeneration.current
    );
  }

  async function loadTimedCandidateReviewPage(
    item: TranscriptionBatchItem,
    offset: number,
  ) {
    if (!projectId || !item.catalogVideoId) return;
    const key = timedImportKey(projectId, item.catalogVideoId, item.id);
    const draft = timedImportDrafts[key];
    const candidateId = draft?.status?.candidate?.candidateId;
    if (!candidateId) return;
    const generation = requestGeneration.current;
    const selectionGeneration = batchRequestGeneration.current;
    const operationGeneration = timedImportGeneration.current;
    setTimedImportDrafts((current) => ({
      ...current,
      [key]: { ...current[key]!, phase: "reviewing" },
    }));
    try {
      const review = ManualTimedTranscriptCandidateReviewPageSchema.parse(
        await request(
          `/api/projects/${projectId}/videos/${item.catalogVideoId}/timed-transcript-candidates/${candidateId}/review?offset=${Math.max(0, offset)}&limit=25`,
        ),
      );
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...current[key]!,
          phase: current[key]?.activation ? "activated" : "finalized",
          review,
        },
      }));
    } catch (error) {
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...current[key]!,
          phase: "failed",
          error: errorMessage(error),
        },
      }));
    }
  }

  async function activateTimedCandidate(item: TranscriptionBatchItem) {
    if (!projectId || !item.catalogVideoId) return;
    const key = timedImportKey(projectId, item.catalogVideoId, item.id);
    const draft = timedImportDrafts[key];
    const review = draft?.review;
    if (!review) return;
    const idempotencyKey =
      draft.activationIdempotencyKey ?? crypto.randomUUID();
    const generation = requestGeneration.current;
    const selectionGeneration = batchRequestGeneration.current;
    const operationGeneration = timedImportGeneration.current;
    setTimedImportDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key]!,
        phase: "activating",
        activationIdempotencyKey: idempotencyKey,
      },
    }));
    try {
      const activation = ManualTimedTranscriptActivationStatusSchema.parse(
        await request(
          `/api/projects/${projectId}/videos/${item.catalogVideoId}/timed-transcript-candidates/${review.candidateId}/activate`,
          {
            method: "POST",
            body: JSON.stringify(
              ActivateManualTimedTranscriptCandidateRequestSchema.parse({
                idempotencyKey,
                importId: review.importId,
                candidateId: review.candidateId,
                transcriptVersionId: review.transcriptVersionId,
                expectedProjectVideoVersion: review.projectVideoVersion,
                languageDecisionId: review.languageDecisionId,
                expectedLanguageDecisionVersion: review.languageDecisionVersion,
              }),
            ),
          },
        ),
      );
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...current[key]!,
          phase: activation.state === "activated" ? "activated" : "failed",
          activation,
          ...(activation.state === "superseded"
            ? {
                error:
                  "This activation was superseded by a later active transcript. Reload before approving another version.",
              }
            : {}),
        },
      }));
      if (activation.state === "activated") {
        setMessage(
          "Corrected transcript activated. Opening this video now uses the reviewed immutable version.",
        );
      }
    } catch (error) {
      if (
        !isCurrentTimedImport(
          generation,
          selectionGeneration,
          operationGeneration,
          projectId,
        )
      )
        return;
      setTimedImportDrafts((current) => ({
        ...current,
        [key]: {
          ...current[key]!,
          phase: "failed",
          activationIdempotencyKey: idempotencyKey,
          error: errorMessage(error),
        },
      }));
    }
  }

  return (
    <section className="batch-workspace" aria-label="Project workflow">
      <div className="section-heading" hidden={destination !== "videos"}>
        <div>
          <p className="eyebrow">Shared project preparation</p>
          <h2 id="queue-title">Transcription queue</h2>
        </div>
        <span className="status">Milestone 3 in progress</span>
      </div>

      <div className="session-panel" hidden={destination !== "videos"}>
        {isDesktopRuntime() ? (
          <>
            <p>
              Desktop account:{" "}
              {desktopAuthStatus?.state.replaceAll("_", " ") ?? "checking"}
            </p>
            {desktopAuthenticationIssue(desktopAuthStatus) ? (
              <p role="status">
                {desktopAuthenticationIssue(desktopAuthStatus)}
              </p>
            ) : null}
            <div className="loader-row">
              {desktopAuthStatus?.state === "signed_in" ? (
                <>
                  <button
                    type="button"
                    disabled={busy || !authorization || !currentUserId}
                    onClick={connect}
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    disabled={busy || !onDesktopSignOut}
                    onClick={() => void onDesktopSignOut?.()}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={
                    busy ||
                    !onDesktopSignIn ||
                    desktopSignInUnavailable(desktopAuthStatus)
                  }
                  onClick={() => void onDesktopSignIn?.()}
                >
                  {desktopAuthStatus?.state === "signing_in"
                    ? "Waiting for browser…"
                    : desktopAuthStatus?.state === "refreshing"
                      ? "Refreshing…"
                      : "Sign in"}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <label htmlFor="development-authorization">
              Development session credential
            </label>
            <div className="loader-row">
              <input
                id="development-authorization"
                type="password"
                autoComplete="off"
                value={authorization}
                onChange={(event) => onAuthorizationChange(event.target.value)}
                placeholder="Bearer user-uuid|external-subject"
              />
              <button
                type="button"
                disabled={busy || !authorization}
                onClick={connect}
              >
                Connect
              </button>
            </div>
          </>
        )}
        <p className="form-message" role="status">
          {message}
        </p>
      </div>

      {authorization && destination === "videos" ? (
        <CollaborationAccessPanel
          request={request}
          onProjectsChanged={refreshProjects}
        />
      ) : null}

      {projects.length ? (
        <>
          <div
            className="add-worklist-section"
            hidden={destination !== "videos"}
          >
            <CanonicalWorklist
              worklist={worklist}
              keywordCatalog={keywordCatalog}
              view={worklistView}
              keywordResultGroup={keywordResultGroup}
              keywordStatusFilter={keywordStatusFilter}
              keywordIdFilter={keywordIdFilter}
              keywordSort={keywordSort}
              keywordEvidence={keywordEvidence}
              selectedVideoIds={selectedWorklistVideoIds}
              busy={busy}
              onViewChange={(view) => {
                setSelectedWorklistVideoIds(new Set());
                setWorklistView(view);
              }}
              onSelectionChange={(videoId, selected) =>
                setSelectedWorklistVideoIds((current) => {
                  const next = new Set(current);
                  if (selected) next.add(videoId);
                  else next.delete(videoId);
                  return next;
                })
              }
              onKeywordResultGroupChange={setKeywordResultGroup}
              onKeywordStatusFilterChange={setKeywordStatusFilter}
              onKeywordIdFilterChange={setKeywordIdFilter}
              onKeywordSortChange={setKeywordSort}
              onLoadKeywordEvidence={(item, result) =>
                void loadKeywordEvidence(item, result)
              }
              onOpenKeywordEvidence={(item, evidence, aliasPhrase) =>
                onOpenReadyVideo({
                  projectId,
                  catalogVideoId: item.video.id,
                  youtubeVideoId: item.video.youtubeVideoId,
                  canonicalUrl: item.video.canonicalUrl,
                  title: item.video.title,
                  keywordEvidence: {
                    seekMs: evidence.startMs,
                    timingPrecision: evidence.timingPrecision,
                    trackId: evidence.trackId,
                    aliasPhrase,
                  },
                })
              }
              onOpen={(item) =>
                onOpenReadyVideo({
                  projectId,
                  catalogVideoId: item.video.id,
                  youtubeVideoId: item.video.youtubeVideoId,
                  canonicalUrl: item.video.canonicalUrl,
                  title: item.video.title,
                })
              }
              onToggleOwnFlag={(item) => void updateOwnFlag(item)}
              onClaim={(item, action, takeoverConfirmed) =>
                void updateClaim(item, action, takeoverConfirmed)
              }
              onGovernance={(item, change) =>
                void updateGovernance(item, change)
              }
              onBulkPriority={(items, nextPriority) =>
                void updateBulkPriority(items, nextPriority)
              }
              onReview={(item, action) =>
                void updateCanonicalReview(item, action)
              }
              onTriage={(items, action) => void updateTriage(items, action)}
            />

            <ActivityInbox
              activity={activity}
              commentNotices={commentNotices?.notices.filter(
                (notice) => notice.projectId === projectId,
              )}
              issue={activityIssue}
              busy={busy}
              onMarkSeen={(eventIds) => void markActivitySeen(eventIds)}
              onMarkCommentSeen={(noticeId) =>
                void markCommentNoticeSeen(noticeId)
              }
            />
          </div>

          <div hidden={destination !== "project_settings"}>
            <ProjectGovernanceControls
              project={projects.find((project) => project.id === projectId)}
              request={request}
              onProjectUpdated={(updatedProject) => {
                onProjectsChange(
                  projects.map((project) =>
                    project.id === updatedProject.id ? updatedProject : project,
                  ),
                );
              }}
            />

            <LocalProcessingControls
              status={localProcessing}
              busy={busy}
              onChange={(state) => void updateLocalProcessing(state)}
            />

            <ProjectKeywordControls
              catalog={keywordCatalog}
              canManage={
                projects.find((project) => project.id === projectId)
                  ?.currentUserRole === "owner" ||
                projects.find((project) => project.id === projectId)
                  ?.currentUserRole === "administrator"
              }
              {...(currentUserId ? { currentUserId } : {})}
              targetId={keywordTargetId}
              label={keywordLabel}
              description={keywordDescription}
              language={keywordLanguage}
              phrase={keywordPhrase}
              rationale={keywordRationale}
              busy={busy}
              onTargetChange={setKeywordTargetId}
              onLabelChange={setKeywordLabel}
              onDescriptionChange={setKeywordDescription}
              onLanguageChange={setKeywordLanguage}
              onPhraseChange={setKeywordPhrase}
              onRationaleChange={setKeywordRationale}
              onSuggest={() => void suggestKeyword()}
              onReview={(suggestion, action) =>
                void reviewKeywordSuggestion(suggestion, action)
              }
              onWithdraw={(suggestion) =>
                void withdrawKeywordSuggestion(suggestion)
              }
              onUpdateKeyword={(keyword, patch) =>
                void updateKeyword(keyword, patch)
              }
              onUpdateAlias={(keyword, alias, patch) =>
                void updateKeywordAlias(keyword, alias, patch)
              }
            />
          </div>

          <div className="batch-grid" hidden={destination !== "videos"}>
            <article className="queue-card batch-create-card">
              <h3>Create a transcription batch</h3>
              <label>
                Batch name
                <input
                  ref={batchNameRef}
                  value={batchName}
                  onChange={(event) => setBatchName(event.target.value)}
                />
              </label>
              <label>
                YouTube URLs or video IDs, one per line
                <textarea
                  ref={bulkInputsRef}
                  value={inputsText}
                  onChange={(event) => {
                    setInputsText(event.target.value);
                    setPreflight(undefined);
                  }}
                  rows={6}
                />
              </label>
              <div className="csv-import-panel">
                <label htmlFor="batch-csv">Import CSV</label>
                <input
                  ref={csvInputRef}
                  id="batch-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) =>
                    void loadCsv(event.currentTarget.files?.[0])
                  }
                />
                {csvDocument ? (
                  <div className="csv-column-row">
                    <label htmlFor="csv-url-column">YouTube URL column</label>
                    <select
                      id="csv-url-column"
                      value={csvColumnIndex}
                      onChange={(event) =>
                        setCsvColumnIndex(event.target.value)
                      }
                    >
                      <option value="">Choose a column</option>
                      {csvDocument.columns.map((column, index) => (
                        <option key={`${column}-${index}`} value={index}>
                          {column}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={csvColumnIndex === ""}
                      onClick={applyCsv}
                    >
                      Use CSV values
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="option-grid">
                <label>
                  Source policy
                  <select
                    value={sourcePolicy}
                    onChange={(event) => {
                      setSourcePolicy(event.target.value);
                      setPreflight(undefined);
                    }}
                  >
                    <option value="prefer-existing">Prefer existing</option>
                    <option value="captions-then-generate">
                      Captions, then generate
                    </option>
                    <option value="force-generate">Force generation</option>
                  </select>
                </label>
                <label>
                  Worker
                  <select
                    value={executionLocation}
                    onChange={(event) => {
                      setExecutionLocation(event.target.value);
                      setPreflight(undefined);
                    }}
                  >
                    <option value="local">Local</option>
                    <option value="hosted">Hosted</option>
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={priority}
                    onChange={(event) => {
                      setPriority(event.target.value);
                      setPreflight(undefined);
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <label className="cloud-translation-consent">
                <input
                  type="checkbox"
                  checked={translationConsentAccepted}
                  onChange={(event) => {
                    setTranslationConsentAccepted(event.target.checked);
                    setPreflight(undefined);
                  }}
                />
                <span>
                  Allow Amazon Translate when a source is not English. The
                  version-pinned transcript text will be sent to Amazon only for
                  this batch; no media or local AWS credentials are sent.
                </span>
              </label>
              <div className="action-row">
                <button
                  type="button"
                  disabled={busy || inputs.length === 0}
                  onClick={runPreflight}
                >
                  Preflight {inputs.length || ""}
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !preflight || !batchName.trim()}
                  onClick={createBatch}
                >
                  Create batch
                </button>
              </div>
              {preflight ? <PreflightTable preflight={preflight} /> : null}
            </article>

            <article className="queue-card">
              <h3>Batches</h3>
              {batchList?.batches.length ? (
                <>
                  <div className="batch-list">
                    {batchList.batches
                      .filter(
                        (entry) =>
                          showBatchHistory ||
                          entry.progress.total === 0 ||
                          entry.progress.canceled < entry.progress.total,
                      )
                      .map((entry) => (
                        <button
                          type="button"
                          className={
                            selectedBatch?.batch.id === entry.batch.id
                              ? "batch-list-item selected"
                              : "batch-list-item"
                          }
                          key={entry.batch.id}
                          onClick={() =>
                            void loadBatch(projectId, entry.batch.id)
                          }
                        >
                          <strong>{entry.batch.name}</strong>
                          <span>
                            {entry.batch.dispatchStatus} ·{" "}
                            {entry.progress.readyForReview} ready ·{" "}
                            {entry.progress.active} active ·{" "}
                            {entry.progress.queued} queued
                          </span>
                        </button>
                      ))}
                  </div>
                  {batchList.batches.some(
                    (entry) =>
                      entry.progress.total > 0 &&
                      entry.progress.canceled === entry.progress.total,
                  ) ? (
                    <button
                      type="button"
                      className="history-toggle"
                      onClick={() => setShowBatchHistory((current) => !current)}
                    >
                      {showBatchHistory ? "Hide history" : "Show batch history"}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="muted">No transcription batches yet.</p>
              )}
              {selectedBatch ? (
                <BatchDetail
                  batch={selectedBatch}
                  busy={busy}
                  onControl={controlBatch}
                  onCancelItem={cancelBatchItem}
                  showCanceledItems={showCanceledItems}
                  onShowCanceledItemsChange={setShowCanceledItems}
                  onHostedApproval={updateHostedApproval}
                  projectId={projectId}
                  languageDecisionDrafts={languageDecisionDrafts}
                  onLanguageDraftChange={setLanguageDecisionDraft}
                  onConfirmLanguage={confirmLanguage}
                  timedImportDrafts={timedImportDrafts}
                  onTimedImportFile={setTimedImportFile}
                  onCreateTimedImport={createTimedImport}
                  onReviewPage={loadTimedCandidateReviewPage}
                  onActivateCandidate={activateTimedCandidate}
                />
              ) : null}
            </article>
          </div>

          <details
            className="queue-card review-card"
            hidden={destination !== "workbench"}
            open={reviewInboxExpanded}
            onToggle={(event) =>
              setReviewInboxExpanded(event.currentTarget.open)
            }
          >
            <summary>
              Ready for review{" "}
              <span className="count-badge">{reviewItems.length}</span>
              {hasOpenReviewSource ? (
                <span className="muted">
                  {" "}
                  · Inbox collapsed while reviewing
                </span>
              ) : null}
            </summary>
            {reviewItems.length ? (
              <div className="review-list">
                {reviewItems.map((item) => (
                  <div className="review-item" key={item.id}>
                    <div>
                      <strong>{item.title ?? item.youtubeVideoId}</strong>
                      <span>
                        {item.batchName}
                        {item.channel ? ` · ${item.channel}` : ""}
                      </span>
                    </div>
                    <select
                      aria-label={`Review status for ${item.title ?? item.youtubeVideoId}`}
                      value={item.reviewStatus}
                      disabled={busy}
                      onChange={(event) =>
                        void updateReview(item, event.target.value)
                      }
                    >
                      <option value="unreviewed">Unreviewed</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="skipped">Skipped</option>
                    </select>
                    {item.canonicalUrl &&
                    item.catalogVideoId &&
                    item.youtubeVideoId ? (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenReadyVideo({
                            projectId,
                            catalogVideoId: item.catalogVideoId!,
                            youtubeVideoId: item.youtubeVideoId!,
                            canonicalUrl: item.canonicalUrl!,
                            ...(item.title ? { title: item.title } : {}),
                          })
                        }
                      >
                        Open video
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                Completed transcripts will appear here without being hidden by
                failed siblings.
              </p>
            )}
          </details>
          <div hidden={destination !== "clips"}>
            <ClipQueue
              authorization={authorization}
              projectId={projectId}
              {...(notificationTarget ? { notificationTarget } : {})}
              request={request}
              onOpenSourceClip={(clip, fallbackNotice, sourceTimeMs) =>
                onOpenSourceClip({
                  projectId,
                  catalogVideoId: clip.catalogVideoId,
                  youtubeVideoId: clip.video.youtubeVideoId,
                  canonicalUrl: clip.video.canonicalUrl,
                  title: clip.video.title,
                  clipId: clip.id,
                  selection: clip.selection,
                  ...(fallbackNotice ? { fallbackNotice } : {}),
                  ...(sourceTimeMs === undefined ? {} : { sourceTimeMs }),
                })
              }
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

function ProjectKeywordControls({
  catalog,
  canManage,
  currentUserId,
  targetId,
  label,
  description,
  language,
  phrase,
  rationale,
  busy,
  onTargetChange,
  onLabelChange,
  onDescriptionChange,
  onLanguageChange,
  onPhraseChange,
  onRationaleChange,
  onSuggest,
  onReview,
  onWithdraw,
  onUpdateKeyword,
  onUpdateAlias,
}: {
  catalog: ProjectKeywordCatalog | undefined;
  canManage: boolean;
  currentUserId?: string;
  targetId: string;
  label: string;
  description: string;
  language: string;
  phrase: string;
  rationale: string;
  busy: boolean;
  onTargetChange(value: string): void;
  onLabelChange(value: string): void;
  onDescriptionChange(value: string): void;
  onLanguageChange(value: string): void;
  onPhraseChange(value: string): void;
  onRationaleChange(value: string): void;
  onSuggest(): void;
  onReview(
    suggestion: ProjectKeywordSuggestion,
    action: "approve" | "reject",
  ): void;
  onWithdraw(suggestion: ProjectKeywordSuggestion): void;
  onUpdateKeyword(
    keyword: ProjectKeyword,
    patch: { label?: string; description?: string | null; enabled?: boolean },
  ): void;
  onUpdateAlias(
    keyword: ProjectKeyword,
    alias: ProjectKeywordAlias,
    patch: { language?: string; phrase?: string; enabled?: boolean },
  ): void;
}) {
  const [keywordDrafts, setKeywordDrafts] = useState<
    Record<string, { label: string; description: string }>
  >({});
  const [aliasDrafts, setAliasDrafts] = useState<
    Record<string, { language: string; phrase: string }>
  >({});
  const pending =
    catalog?.suggestions.filter(
      (suggestion) => suggestion.state === "pending",
    ) ?? [];
  const reviewedCount =
    catalog?.suggestions.filter((suggestion) => suggestion.state !== "pending")
      .length ?? 0;
  const selectedKeyword = catalog?.keywords.find(
    (keyword) => keyword.id === targetId,
  );
  const canSuggest =
    Boolean(catalog) &&
    Boolean(language.trim()) &&
    Boolean(phrase.trim()) &&
    (targetId !== "new" || Boolean(label.trim()));
  return (
    <article className="queue-card" aria-label="Project keywords">
      <h3>
        Project keywords{" "}
        <span className="count-badge">
          v{catalog?.keywordSetVersion ?? "…"}
        </span>
      </h3>
      <p className="muted">
        Approved positive literal scan rules for this project. These are not
        clip tags. Any label, description, phrase, language, or enabled-state
        change makes current scan evidence stale and queues idempotent
        replacement scans; prior evidence remains readable.
      </p>

      <h4>Approved vocabulary</h4>
      {catalog?.keywords.length ? (
        <div className="review-list">
          {catalog.keywords.map((keyword) => (
            <div className="review-item" key={keyword.id}>
              <div>
                <strong>{keyword.label}</strong>
                {keyword.description ? (
                  <span>{keyword.description}</span>
                ) : null}
                <span>
                  {keyword.enabled ? "Enabled" : "Disabled"} · version{" "}
                  {keyword.version}
                </span>
              </div>
              {canManage ? (
                <div className="form-grid" aria-label={`Edit ${keyword.label}`}>
                  <label>
                    Display label
                    <input
                      aria-label={`Display label for ${keyword.label}`}
                      maxLength={120}
                      disabled={busy}
                      value={keywordDrafts[keyword.id]?.label ?? keyword.label}
                      onChange={(event) =>
                        setKeywordDrafts((current) => ({
                          ...current,
                          [keyword.id]: {
                            label: event.target.value,
                            description:
                              current[keyword.id]?.description ??
                              keyword.description ??
                              "",
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Description
                    <input
                      aria-label={`Description for ${keyword.label}`}
                      maxLength={1_000}
                      disabled={busy}
                      value={
                        keywordDrafts[keyword.id]?.description ??
                        keyword.description ??
                        ""
                      }
                      onChange={(event) =>
                        setKeywordDrafts((current) => ({
                          ...current,
                          [keyword.id]: {
                            label: current[keyword.id]?.label ?? keyword.label,
                            description: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <div className="action-row">
                    <button
                      type="button"
                      disabled={
                        busy ||
                        !(
                          keywordDrafts[keyword.id]?.label ?? keyword.label
                        ).trim()
                      }
                      onClick={() =>
                        onUpdateKeyword(keyword, {
                          label:
                            keywordDrafts[keyword.id]?.label ?? keyword.label,
                          description:
                            (
                              keywordDrafts[keyword.id]?.description ??
                              keyword.description ??
                              ""
                            ).trim() || null,
                        })
                      }
                    >
                      Save keyword
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        onUpdateKeyword(keyword, { enabled: !keyword.enabled })
                      }
                    >
                      {keyword.enabled ? "Disable keyword" : "Enable keyword"}
                    </button>
                  </div>
                </div>
              ) : null}
              <div aria-label={`Aliases for ${keyword.label}`}>
                {keyword.aliases.map((alias) => (
                  <div className="review-item" key={alias.id}>
                    <span className="count-badge">
                      {formatLanguageLabel(alias.language)}: {alias.phrase} ·{" "}
                      {alias.enabled ? "enabled" : "disabled"}
                    </span>
                    {canManage ? (
                      <div className="action-row">
                        <input
                          aria-label={`Language for alias ${alias.phrase}`}
                          maxLength={35}
                          disabled={busy}
                          value={
                            aliasDrafts[alias.id]?.language ?? alias.language
                          }
                          onChange={(event) =>
                            setAliasDrafts((current) => ({
                              ...current,
                              [alias.id]: {
                                language: event.target.value,
                                phrase:
                                  current[alias.id]?.phrase ?? alias.phrase,
                              },
                            }))
                          }
                        />
                        <input
                          aria-label={`Phrase for alias ${alias.phrase}`}
                          maxLength={160}
                          disabled={busy}
                          value={aliasDrafts[alias.id]?.phrase ?? alias.phrase}
                          onChange={(event) =>
                            setAliasDrafts((current) => ({
                              ...current,
                              [alias.id]: {
                                language:
                                  current[alias.id]?.language ?? alias.language,
                                phrase: event.target.value,
                              },
                            }))
                          }
                        />
                        <button
                          type="button"
                          disabled={
                            busy ||
                            !(
                              aliasDrafts[alias.id]?.language ?? alias.language
                            ).trim() ||
                            !(
                              aliasDrafts[alias.id]?.phrase ?? alias.phrase
                            ).trim()
                          }
                          onClick={() =>
                            onUpdateAlias(keyword, alias, {
                              language:
                                aliasDrafts[alias.id]?.language ??
                                alias.language,
                              phrase:
                                aliasDrafts[alias.id]?.phrase ?? alias.phrase,
                            })
                          }
                        >
                          Save alias
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            onUpdateAlias(keyword, alias, {
                              enabled: !alias.enabled,
                            })
                          }
                        >
                          {alias.enabled ? "Disable alias" : "Enable alias"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No approved project keywords yet.</p>
      )}

      <h4>Suggest a literal keyword or alias</h4>
      <div className="form-grid">
        <label>
          Suggestion target
          <select
            aria-label="Keyword suggestion target"
            value={targetId}
            disabled={busy || !catalog}
            onChange={(event) => onTargetChange(event.target.value)}
          >
            <option value="new">New keyword</option>
            {catalog?.keywords.map((keyword) => (
              <option key={keyword.id} value={keyword.id}>
                Alias for {keyword.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          New keyword label
          <input
            aria-label="New keyword label"
            value={label}
            maxLength={120}
            disabled={busy || targetId !== "new"}
            placeholder={
              selectedKeyword
                ? `Alias for ${selectedKeyword.label}`
                : "Climate change"
            }
            onChange={(event) => onLabelChange(event.target.value)}
          />
        </label>
        <label>
          Description (optional)
          <input
            aria-label="Keyword description"
            value={description}
            maxLength={1_000}
            disabled={busy || targetId !== "new"}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        </label>
        <label>
          Alias language
          <input
            aria-label="Keyword alias language"
            value={language}
            maxLength={35}
            disabled={busy}
            placeholder="en"
            onChange={(event) => onLanguageChange(event.target.value)}
          />
        </label>
        <label>
          Literal phrase
          <input
            aria-label="Literal keyword phrase"
            value={phrase}
            maxLength={160}
            disabled={busy}
            onChange={(event) => onPhraseChange(event.target.value)}
          />
        </label>
        <label>
          Rationale (optional)
          <textarea
            aria-label="Keyword suggestion rationale"
            value={rationale}
            maxLength={1_000}
            disabled={busy}
            onChange={(event) => onRationaleChange(event.target.value)}
          />
        </label>
      </div>
      <button type="button" disabled={busy || !canSuggest} onClick={onSuggest}>
        Suggest project keyword
      </button>

      <h4>
        Pending suggestions{" "}
        <span className="count-badge">{pending.length}</span>
      </h4>
      {pending.length ? (
        <div className="review-list">
          {pending.map((suggestion) => {
            const target = suggestion.keywordId
              ? catalog?.keywords.find(
                  (keyword) => keyword.id === suggestion.keywordId,
                )?.label
              : suggestion.proposedLabel;
            return (
              <div className="review-item" key={suggestion.id}>
                <div>
                  <strong>
                    {formatLanguageLabel(suggestion.language)}:{" "}
                    {suggestion.phrase}
                  </strong>
                  <span>
                    {suggestion.keywordId
                      ? `Alias for ${target}`
                      : `New keyword: ${target}`}
                    {` · suggested by @${suggestion.proposedBy.handle}`}
                  </span>
                  {suggestion.rationale ? (
                    <span>{suggestion.rationale}</span>
                  ) : null}
                </div>
                <div className="action-row">
                  {suggestion.proposedBy.userId ===
                  (currentUserId ?? catalog?.currentUserId) ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Withdraw ${suggestion.phrase}`}
                      onClick={() => onWithdraw(suggestion)}
                    >
                      Withdraw
                    </button>
                  ) : null}
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Approve ${suggestion.phrase}`}
                        onClick={() => onReview(suggestion, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Reject ${suggestion.phrase}`}
                        onClick={() => onReview(suggestion, "reject")}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">No keyword suggestions await review.</p>
      )}
      {reviewedCount ? (
        <p className="muted">
          {reviewedCount} reviewed suggestion record
          {reviewedCount === 1 ? "" : "s"} retained.
        </p>
      ) : null}
    </article>
  );
}

function LocalProcessingControls({
  status,
  busy,
  onChange,
}: {
  status: ProjectLocalProcessingStatus | undefined;
  busy: boolean;
  onChange(state: ProjectLocalProcessingStatus["policy"]["state"]): void;
}) {
  const workload = status?.workload;
  return (
    <article className="queue-card" aria-label="Local processing policy">
      <h3>Local processing</h3>
      <p>
        Policy: <strong>{status?.policy.state ?? "Loading"}</strong>
        {status?.policy.updatedBy
          ? ` · last changed by @${status.policy.updatedBy.handle}`
          : " · safe historical default"}
      </p>
      <p className="muted">
        Caption discovery runs before configured local Whisper. Worker lanes
        remain bounded by this workstation&apos;s configured 1–8 concurrency.
      </p>
      {workload ? (
        <div className="action-row" aria-label="Local processing workload">
          <span>
            Queued {workload.queuedJobs} · known load{" "}
            {formatLoadDuration(workload.queuedKnownDurationMs)}
            {workload.queuedUnknownDurationCount
              ? ` · ${workload.queuedUnknownDurationCount} unknown duration`
              : ""}
          </span>
          <span>
            Active {workload.activeJobs} · known load{" "}
            {formatLoadDuration(workload.activeKnownDurationMs)}
            {workload.activeUnknownDurationCount
              ? ` · ${workload.activeUnknownDurationCount} unknown duration`
              : ""}
          </span>
          {workload.unprocessedActiveVideoCount ? (
            <span>
              {workload.unprocessedActiveVideoCount} active video
              {workload.unprocessedActiveVideoCount === 1 ? "" : "s"} not yet
              queued
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="action-row">
        {status?.policy.state === "paused" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange("automatic")}
          >
            Resume and queue up to 50
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !status}
            onClick={() => onChange("paused")}
          >
            Pause new local starts
          </button>
        )}
        {status?.policy.state === "automatic" &&
        workload?.unprocessedActiveVideoCount ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange("automatic")}
          >
            Queue next 50
          </button>
        ) : null}
      </div>
    </article>
  );
}

function CanonicalWorklist({
  worklist,
  keywordCatalog,
  view,
  keywordResultGroup,
  keywordStatusFilter,
  keywordIdFilter,
  keywordSort,
  keywordEvidence,
  selectedVideoIds,
  busy,
  onViewChange,
  onSelectionChange,
  onKeywordResultGroupChange,
  onKeywordStatusFilterChange,
  onKeywordIdFilterChange,
  onKeywordSortChange,
  onLoadKeywordEvidence,
  onOpenKeywordEvidence,
  onOpen,
  onToggleOwnFlag,
  onClaim,
  onGovernance,
  onBulkPriority,
  onReview,
  onTriage,
}: {
  worklist: ProjectVideoWorklistPage | undefined;
  keywordCatalog: ProjectKeywordCatalog | undefined;
  view: WorklistView;
  keywordResultGroup: KeywordResultGroup;
  keywordStatusFilter: string;
  keywordIdFilter: string;
  keywordSort: KeywordSort;
  keywordEvidence: Record<string, KeywordEvidenceState>;
  selectedVideoIds: ReadonlySet<string>;
  busy: boolean;
  onViewChange(view: WorklistView): void;
  onSelectionChange(videoId: string, selected: boolean): void;
  onKeywordResultGroupChange(group: KeywordResultGroup): void;
  onKeywordStatusFilterChange(status: string): void;
  onKeywordIdFilterChange(keywordId: string): void;
  onKeywordSortChange(sort: KeywordSort): void;
  onLoadKeywordEvidence(
    item: ProjectVideoWorklistItem,
    result: KeywordEvidenceResult,
  ): void;
  onOpenKeywordEvidence(
    item: ProjectVideoWorklistItem,
    evidence: ProjectKeywordMatchArtifact["occurrences"][number]["evidence"][number],
    aliasPhrase: string,
  ): void;
  onOpen(item: ProjectVideoWorklistItem): void;
  onToggleOwnFlag(item: ProjectVideoWorklistItem): void;
  onClaim(
    item: ProjectVideoWorklistItem,
    action: "claim" | "renew" | "release",
    takeoverConfirmed?: boolean,
  ): void;
  onGovernance(
    item: ProjectVideoWorklistItem,
    change:
      | { priority: ProjectVideoWorklistItem["priority"] }
      | {
          completionPolicy: ProjectVideoWorklistItem["completionPolicy"];
        },
  ): void;
  onBulkPriority(
    items: ProjectVideoWorklistItem[],
    priority: ProjectVideoWorklistItem["priority"],
  ): void;
  onReview(item: ProjectVideoWorklistItem, action: "complete" | "reopen"): void;
  onTriage(
    items: ProjectVideoWorklistItem[],
    action: "dismiss" | "restore",
  ): void;
}) {
  const items = worklist?.items ?? [];
  const selectedItems = items.filter((item) =>
    selectedVideoIds.has(item.video.id),
  );
  const selectedActiveItems = selectedItems.filter(
    (item) => item.triage.state === "active",
  );
  const selectedDismissedItems = selectedItems.filter(
    (item) => item.triage.state === "dismissed",
  );
  const groupOrder = [
    "promising",
    "no_matches",
    "processing",
    "action_needed",
  ] as const;
  const groupCounts = Object.fromEntries(
    groupOrder.map((group) => [
      group,
      items.filter((item) => keywordGroup(item) === group).length,
    ]),
  ) as Record<(typeof groupOrder)[number], number>;
  const filteredItems = items.filter((item) => {
    const scan = item.keywordScan;
    if (
      keywordResultGroup !== "all" &&
      keywordGroup(item) !== keywordResultGroup
    )
      return false;
    if (keywordStatusFilter !== "all" && scan.status !== keywordStatusFilter)
      return false;
    if (keywordIdFilter) {
      const result = visibleKeywordResult(scan);
      if (
        !result?.keywordCounts?.some(
          (entry) => entry.keywordId === keywordIdFilter,
        )
      )
        return false;
    }
    return true;
  });
  const groupedItems = new Map(
    groupOrder.map((group) => [
      group,
      filteredItems
        .filter((item) => keywordGroup(item) === group)
        .sort((left, right) => compareKeywordRows(left, right, keywordSort)),
    ]),
  );
  return (
    <article
      className="queue-card canonical-worklist-card"
      aria-label="Project video worklist"
    >
      <h3>
        Project video worklist{" "}
        <span className="count-badge">{worklist?.total ?? 0}</span>
      </h3>
      <p className="muted">
        One shared row per project video. Keyword evidence is exact, versioned,
        and never dismisses a video automatically.
      </p>
      <div className="action-row" aria-label="Worklist views">
        {(["queue", "reviewed", "dismissed", "all"] as const).map((option) => (
          <button
            type="button"
            key={option}
            aria-pressed={view === option}
            disabled={busy}
            onClick={() => onViewChange(option)}
          >
            {option === "all"
              ? "All"
              : option[0]!.toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
      <div
        className="worklist-keyword-filters"
        aria-label="Keyword evidence filters"
      >
        <label>
          Result group
          <select
            aria-label="Keyword result group"
            value={keywordResultGroup}
            onChange={(event) =>
              onKeywordResultGroupChange(
                event.target.value as KeywordResultGroup,
              )
            }
          >
            <option value="all">All groups</option>
            <option value="promising">Promising</option>
            <option value="no_matches">No matches</option>
            <option value="processing">Processing</option>
            <option value="action_needed">Action needed</option>
          </select>
        </label>
        <label>
          Scan state
          <select
            aria-label="Keyword scan state"
            value={keywordStatusFilter}
            onChange={(event) =>
              onKeywordStatusFilterChange(event.target.value)
            }
          >
            <option value="all">All scan states</option>
            {[
              "current",
              "stale",
              "queued",
              "scanning",
              "failed",
              "waiting_for_transcript",
              "not_scanned",
            ].map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Approved keyword
          <select
            aria-label="Approved keyword filter"
            value={keywordIdFilter}
            onChange={(event) => onKeywordIdFilterChange(event.target.value)}
          >
            <option value="">All approved keywords</option>
            {(keywordCatalog?.keywords ?? [])
              .filter((keyword) => keyword.enabled)
              .map((keyword) => (
                <option key={keyword.id} value={keyword.id}>
                  {keyword.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Sort within groups
          <select
            aria-label="Keyword result sort"
            value={keywordSort}
            onChange={(event) =>
              onKeywordSortChange(event.target.value as KeywordSort)
            }
          >
            <option value="coverage">Keyword coverage</option>
            <option value="occurrences">Occurrences</option>
            <option value="density">Matches per minute</option>
            <option value="duration">Duration</option>
            <option value="priority">Priority</option>
            <option value="recency">Recency</option>
          </select>
        </label>
      </div>
      {selectedItems.length ? (
        <div className="action-row" aria-label="Bulk worklist triage">
          <span className="muted">{selectedItems.length} selected</span>
          {(["high", "normal", "low"] as const).map((nextPriority) => (
            <button
              type="button"
              key={nextPriority}
              disabled={busy}
              onClick={() => onBulkPriority(selectedItems, nextPriority)}
            >
              Set {nextPriority} priority
            </button>
          ))}
          {selectedActiveItems.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onTriage(selectedActiveItems, "dismiss")}
            >
              Dismiss selected ({selectedActiveItems.length})
            </button>
          ) : null}
          {selectedDismissedItems.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onTriage(selectedDismissedItems, "restore")}
            >
              Restore selected ({selectedDismissedItems.length})
            </button>
          ) : null}
        </div>
      ) : null}
      {items.length ? (
        <div className="keyword-result-groups">
          {groupOrder
            .filter(
              (group) =>
                keywordResultGroup === "all" || keywordResultGroup === group,
            )
            .map((group) => (
              <section
                className="keyword-result-group"
                key={group}
                aria-label={`${keywordGroupLabel(group)} keyword results`}
              >
                <h4>
                  {keywordGroupLabel(group)}{" "}
                  <span className="count-badge">{groupCounts[group]}</span>
                </h4>
                {groupedItems.get(group)?.length ? (
                  <div className="canonical-worklist">
                    {groupedItems.get(group)!.map((item) => (
                      <CanonicalWorklistRow
                        key={item.video.id}
                        item={item}
                        keywordCatalog={keywordCatalog}
                        evidenceState={
                          keywordEvidence[
                            `${item.video.id}:${visibleKeywordResult(item.keywordScan)?.scanId ?? "none"}`
                          ]
                        }
                        selected={selectedVideoIds.has(item.video.id)}
                        busy={busy}
                        onSelectionChange={onSelectionChange}
                        onLoadKeywordEvidence={onLoadKeywordEvidence}
                        onOpenKeywordEvidence={onOpenKeywordEvidence}
                        onOpen={onOpen}
                        onToggleOwnFlag={onToggleOwnFlag}
                        onClaim={onClaim}
                        onGovernance={onGovernance}
                        onReview={onReview}
                        onTriage={onTriage}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="muted">No videos match these filters.</p>
                )}
              </section>
            ))}
        </div>
      ) : (
        <p className="muted">
          {view === "dismissed"
            ? "No dismissed project videos."
            : view === "reviewed"
              ? "No reviewed project videos."
              : "Add a URL or create a batch to start this project’s canonical worklist."}
        </p>
      )}
      {worklist?.nextCursor ? (
        <p className="muted">
          Showing the first {worklist.items.length} rows of {worklist.total}.
        </p>
      ) : null}
    </article>
  );
}

function CanonicalWorklistRow({
  item,
  keywordCatalog,
  evidenceState,
  selected,
  busy,
  onSelectionChange,
  onLoadKeywordEvidence,
  onOpenKeywordEvidence,
  onOpen,
  onToggleOwnFlag,
  onClaim,
  onGovernance,
  onReview,
  onTriage,
}: {
  item: ProjectVideoWorklistItem;
  keywordCatalog: ProjectKeywordCatalog | undefined;
  evidenceState: KeywordEvidenceState | undefined;
  selected: boolean;
  busy: boolean;
  onSelectionChange(videoId: string, selected: boolean): void;
  onLoadKeywordEvidence(
    item: ProjectVideoWorklistItem,
    result: KeywordEvidenceResult,
  ): void;
  onOpenKeywordEvidence(
    item: ProjectVideoWorklistItem,
    evidence: ProjectKeywordMatchArtifact["occurrences"][number]["evidence"][number],
    aliasPhrase: string,
  ): void;
  onOpen(item: ProjectVideoWorklistItem): void;
  onToggleOwnFlag(item: ProjectVideoWorklistItem): void;
  onClaim(
    item: ProjectVideoWorklistItem,
    action: "claim" | "renew" | "release",
    takeoverConfirmed?: boolean,
  ): void;
  onGovernance(
    item: ProjectVideoWorklistItem,
    change:
      | { priority: ProjectVideoWorklistItem["priority"] }
      | { completionPolicy: ProjectVideoWorklistItem["completionPolicy"] },
  ): void;
  onReview(item: ProjectVideoWorklistItem, action: "complete" | "reopen"): void;
  onTriage(
    items: ProjectVideoWorklistItem[],
    action: "dismiss" | "restore",
  ): void;
}) {
  const result = visibleKeywordResult(item.keywordScan);
  const keywordById = new Map(
    (keywordCatalog?.keywords ?? []).map((keyword) => [keyword.id, keyword]),
  );
  const aliasById = new Map(
    (keywordCatalog?.keywords ?? []).flatMap((keyword) =>
      keyword.aliases.map((alias) => [alias.id, alias] as const),
    ),
  );
  return (
    <div className="canonical-worklist-item">
      <div>
        <label>
          <input
            type="checkbox"
            aria-label={`Select ${item.video.title}`}
            checked={selected}
            disabled={busy}
            onChange={(event) =>
              onSelectionChange(item.video.id, event.target.checked)
            }
          />{" "}
          <strong>{item.video.title}</strong>
        </label>
        {item.unreadActivityCount ? (
          <span className="count-badge">
            New for you · {item.unreadActivityCount}
          </span>
        ) : null}
        <span>{keywordSummaryLabel(item)}</span>
        {result ? (
          <span>
            Coverage {result.matchedKeywordCount}/{result.approvedKeywordCount}{" "}
            · {result.occurrenceCount} occurrence
            {result.occurrenceCount === 1 ? "" : "s"}
            {result.matchesPerMinute === undefined
              ? ""
              : ` · ${result.matchesPerMinute.toFixed(2)} per minute`}
            {` · completed ${new Date(result.completedAt).toLocaleString()}`}
          </span>
        ) : null}
        <span>
          {item.video.channel ? `${item.video.channel} · ` : ""}
          {item.processing.state.replaceAll("_", " ")}
          {item.activeTranscriptVersionId
            ? " · transcript ready"
            : " · no active transcript"}
          {` · ${item.clipCount} clip${item.clipCount === 1 ? "" : "s"}`}
        </span>
        <span>
          {item.activeFlagCount > 0
            ? `Flagged by ${item.flaggers
                .map((flagger) => `@${flagger.handle}`)
                .join(", ")}${item.flaggersTruncated ? ", and others" : ""}`
            : "No active flags"}
        </span>
        <span>
          Priority {item.priority} · review cycle {item.review.cycleNumber}{" "}
          {item.review.status}
          {item.review.completedBy
            ? ` by @${item.review.completedBy.handle}`
            : ""}
          {item.review.reopenReason
            ? ` · reopened: ${item.review.reopenReason}`
            : ""}
        </span>
        <span>
          {item.triage.state === "dismissed"
            ? `Dismissed${item.triage.dismissedBy ? ` by @${item.triage.dismissedBy.handle}` : ""}${item.triage.reason ? ` · ${item.triage.reason}` : ""}`
            : "Active in worklist"}
        </span>
        <span>
          {item.claim
            ? `${item.claim.active ? "Claimed" : "Expired claim"} ${
                item.claim.isCurrentUser
                  ? "by you"
                  : `by @${item.claim.claimant.handle}`
              }`
            : "Unclaimed"}
        </span>
      </div>
      {result ? (
        <div className="keyword-evidence-panel">
          <button
            type="button"
            disabled={evidenceState?.state === "loading"}
            onClick={() => onLoadKeywordEvidence(item, result)}
          >
            {evidenceState?.state === "loading"
              ? "Verifying keyword evidence…"
              : evidenceState?.state === "error"
                ? "Retry evidence verification"
                : evidenceState?.state === "ready"
                  ? "Reverify keyword evidence"
                  : "Show verified keyword evidence"}
          </button>
          {evidenceState?.state === "error" ? (
            <p role="alert">Evidence unavailable: {evidenceState.message}</p>
          ) : null}
          {evidenceState?.state === "ready" ? (
            <div className="keyword-context-list">
              {evidenceState.artifact.occurrences.length ? (
                evidenceState.artifact.occurrences
                  .slice(0, 100)
                  .map((occurrence) => {
                    const keyword = keywordById.get(occurrence.keywordId);
                    return (
                      <div className="keyword-context-row" key={occurrence.id}>
                        <strong>{keyword?.label ?? "Approved keyword"}</strong>
                        {occurrence.evidence.slice(0, 3).map((evidence) => {
                          const alias = aliasById.get(evidence.aliasId);
                          const aliasPhrase =
                            alias?.phrase ?? keyword?.label ?? "keyword";
                          return (
                            <button
                              type="button"
                              className="keyword-context-button"
                              key={`${occurrence.id}:${evidence.trackId}:${evidence.aliasId}`}
                              onClick={() =>
                                onOpenKeywordEvidence(
                                  item,
                                  evidence,
                                  aliasPhrase,
                                )
                              }
                            >
                              {formatReviewTime(evidence.startMs)} ·{" "}
                              {aliasPhrase} ·{" "}
                              {formatLanguageLabel(evidence.language)} ·{" "}
                              {evidence.timingPrecision} · {evidence.context}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
              ) : (
                <p className="muted">
                  Verified current evidence contains genuinely zero matches.
                </p>
              )}
              {evidenceState.artifact.occurrences.length > 100 ? (
                <p className="muted">
                  Showing the first 100 timestamped occurrences from this
                  verified artifact.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="action-row">
        <button type="button" onClick={() => onOpen(item)}>
          Open video
        </button>
        {!item.claim ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onClaim(item, "claim", false)}
          >
            Claim review
          </button>
        ) : item.claim.isCurrentUser ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onClaim(item, item.claim?.active ? "renew" : "claim", false)
              }
            >
              {item.claim.active ? "Renew claim" : "Reclaim review"}
            </button>
            {item.claim.active ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onClaim(item, "release")}
              >
                Release claim
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Take over this ${item.claim?.active ? "active" : "expired"} claim from @${item.claim?.claimant.handle}? The takeover will be recorded.`,
                )
              )
                onClaim(item, "claim", true);
            }}
          >
            Take over claim
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onReview(
              item,
              item.review.status === "open" ? "complete" : "reopen",
            )
          }
        >
          {item.review.status === "open" ? "Complete review" : "Reopen review"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onTriage(
              [item],
              item.triage.state === "dismissed" ? "restore" : "dismiss",
            )
          }
        >
          {item.triage.state === "dismissed"
            ? "Restore video"
            : "Dismiss video"}
        </button>
        {item.ownFlag ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggleOwnFlag(item)}
          >
            {item.ownFlag.active ? "Remove my flag" : "Restore my flag"}
          </button>
        ) : null}
        <label>
          Priority
          <select
            aria-label={`Priority for ${item.video.title}`}
            disabled={busy}
            value={item.priority}
            onChange={(event) =>
              onGovernance(item, {
                priority: event.target
                  .value as ProjectVideoWorklistItem["priority"],
              })
            }
          >
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Completion
          <select
            aria-label={`Review completion policy for ${item.video.title}`}
            disabled={busy}
            value={item.completionPolicy}
            onChange={(event) =>
              onGovernance(item, {
                completionPolicy: event.target
                  .value as ProjectVideoWorklistItem["completionPolicy"],
              })
            }
          >
            <option value="researcher_or_administrator">
              Researcher or administrator
            </option>
            <option value="administrator_only">Administrator only</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function ActivityInbox({
  activity,
  commentNotices,
  issue,
  busy,
  onMarkSeen,
  onMarkCommentSeen,
}: {
  activity: ProjectVideoActivityPage | undefined;
  commentNotices: ClipCommentNoticePage["notices"] | undefined;
  issue: string | undefined;
  busy: boolean;
  onMarkSeen(eventIds?: string[]): void;
  onMarkCommentSeen(noticeId: string): void;
}) {
  const unreadCommentCount =
    commentNotices?.filter((notice) => notice.state === "unread").length ?? 0;
  return (
    <article className="queue-card activity-inbox-card">
      <div className="action-row">
        <h3>
          Activity for you{" "}
          <span className="count-badge">
            {(activity?.unreadCount ?? 0) + unreadCommentCount}
          </span>
        </h3>
        {activity?.items.some((item) => item.state === "unread") ? (
          <button type="button" disabled={busy} onClick={() => onMarkSeen()}>
            Mark all shown seen
          </button>
        ) : null}
      </div>
      <p className="muted">
        Review, triage, followed-comment, and mention activity, newest first.
      </p>
      {issue ? <p role="alert">Activity unavailable: {issue}</p> : null}
      {activity?.items.length ? (
        <div className="canonical-worklist" aria-label="Project activity">
          {activity.items.map((item) => (
            <div className="canonical-worklist-item" key={item.eventId}>
              <div>
                <strong>{item.videoTitle}</strong>
                <span>
                  {item.eventType.replaceAll("_", " ")} by @{item.actor.handle}
                </span>
                {item.reason ? <span>{item.reason}</span> : null}
                <span>
                  {new Date(item.createdAt).toLocaleString()} · {item.state}
                </span>
              </div>
              {item.state === "unread" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMarkSeen([item.eventId])}
                >
                  Mark seen
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : issue ? null : (
        <p className="muted">No project activity for you yet.</p>
      )}
      {commentNotices?.length ? (
        <div className="canonical-worklist" aria-label="Clip comment activity">
          {commentNotices.map((notice) => (
            <div className="canonical-worklist-item" key={notice.id}>
              <div>
                <strong>
                  {notice.reason === "mention"
                    ? "You were mentioned"
                    : "New comment on a followed clip"}
                </strong>
                <span>
                  @{notice.actor.handle} ·{" "}
                  {new Date(notice.createdAt).toLocaleString()}
                </span>
                <span>
                  Clip {notice.clipId.slice(0, 8)} · {notice.state}
                </span>
              </div>
              {notice.state === "unread" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMarkCommentSeen(notice.id)}
                >
                  Mark seen
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {activity?.nextCursor ? (
        <p className="muted">Showing the 10 most recent activity items.</p>
      ) : null}
    </article>
  );
}

function PreflightTable({ preflight }: { preflight: BatchPreflightResponse }) {
  return (
    <div className="table-wrap">
      <p className="summary-line">
        {preflight.summary.ready} to transcribe ·{" "}
        {preflight.summary.existingTranscripts} reusable ·{" "}
        {preflight.summary.duplicates} duplicates ·{" "}
        {preflight.summary.unsupported + preflight.summary.metadataFailed}{" "}
        blocked
      </p>
      <table>
        <thead>
          <tr>
            <th>Video</th>
            <th>Status</th>
            <th>Need</th>
          </tr>
        </thead>
        <tbody>
          {preflight.items.map((item) => (
            <tr key={item.inputIndex}>
              <td>{item.title ?? item.input}</td>
              <td>{item.status}</td>
              <td>{item.processingNeed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const transcriptionPipeline = [
  "queued",
  "resolving",
  "acquiring",
  "transcribing",
  "translating",
  "aligning",
  "uploading",
  "ready_for_review",
] as const;

const transcriptionActiveItemStates = new Set<TranscriptionBatchItem["state"]>([
  "resolving",
  "acquiring",
  "transcribing",
  "translating",
  "aligning",
  "uploading",
]);

function TranscriptionStageBar({ item }: { item: TranscriptionBatchItem }) {
  const pipelineIndex = transcriptionPipeline.indexOf(
    item.state as (typeof transcriptionPipeline)[number],
  );
  const terminalLabel =
    item.state === "ready_for_review"
      ? "Ready"
      : item.state === "blocked" || item.state === "needs_language_confirmation"
        ? "Action needed"
        : item.state === "failed"
          ? "Failed"
          : item.state === "canceling"
            ? "Canceling"
            : item.state === "canceled"
              ? "Canceled"
              : undefined;
  const readableStage =
    terminalLabel ?? titleCase(item.state.replaceAll("_", " "));
  const stageNumber = pipelineIndex >= 0 ? pipelineIndex + 1 : undefined;
  const accessibleText = stageNumber
    ? `${readableStage}, stage ${stageNumber} of ${transcriptionPipeline.length}; time remaining unknown.`
    : `${readableStage}; time remaining unknown.`;

  return (
    <div
      className={`transcription-stage stage-${item.state}`}
      role="progressbar"
      aria-label={accessibleText}
      aria-valuemin={1}
      aria-valuemax={transcriptionPipeline.length}
      {...(stageNumber ? { "aria-valuenow": stageNumber } : {})}
      aria-valuetext={accessibleText}
    >
      <div className="stage-segments" aria-hidden="true">
        {transcriptionPipeline.map((stage, index) => (
          <span
            key={stage}
            className={[
              "stage-segment",
              pipelineIndex >= index ? "complete" : "",
              pipelineIndex === index ? "current" : "",
              pipelineIndex === index &&
              transcriptionActiveItemStates.has(item.state)
                ? "current-active"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </div>
      <span className="stage-label">{readableStage}</span>
    </div>
  );
}

function BatchDetail({
  batch,
  busy,
  onControl,
  onCancelItem,
  showCanceledItems,
  onShowCanceledItemsChange,
  onHostedApproval,
  projectId,
  languageDecisionDrafts,
  onLanguageDraftChange,
  onConfirmLanguage,
  timedImportDrafts,
  onTimedImportFile,
  onCreateTimedImport,
  onReviewPage,
  onActivateCandidate,
}: {
  batch: CreateTranscriptionBatchResponse;
  busy: boolean;
  onControl(action: TranscriptionBatchControlRequest["action"]): void;
  onCancelItem(item: TranscriptionBatchItem): void;
  showCanceledItems: boolean;
  onShowCanceledItemsChange(value: boolean): void;
  onHostedApproval(
    action: UpdateHostedTranscriptionApprovalRequest["action"],
  ): void;
  projectId: string;
  languageDecisionDrafts: Record<string, LanguageDecisionDraft>;
  onLanguageDraftChange(
    item: TranscriptionBatchItem,
    resolvedLanguage: string,
  ): void;
  onConfirmLanguage(
    item: TranscriptionBatchItem,
    gate: LanguageGate,
    resolvedLanguage: string,
  ): void;
  timedImportDrafts: Record<string, TimedImportDraft>;
  onTimedImportFile(
    item: TranscriptionBatchItem,
    role: "original" | "english",
    file: File | undefined,
  ): void;
  onCreateTimedImport(item: TranscriptionBatchItem, gate: LanguageGate): void;
  onReviewPage(item: TranscriptionBatchItem, offset: number): void;
  onActivateCandidate(item: TranscriptionBatchItem): void;
}) {
  const canDispatch = batch.batch.dispatchStatus !== "canceled";
  const hiddenHistoryCount = batch.items.filter((item) =>
    ["canceling", "canceled"].includes(item.state),
  ).length;
  const visibleItems = showCanceledItems
    ? batch.items
    : batch.items.filter(
        (item) => !["canceling", "canceled"].includes(item.state),
      );
  return (
    <div className="batch-detail">
      {batch.batch.translationConsent ? (
        <p className="translation-consent-summary">
          Amazon Translate consent recorded for this batch (disclosure v
          {batch.batch.translationConsent.disclosureVersion}).
        </p>
      ) : null}
      {batch.batch.hostedApproval ? (
        <div className="hosted-approval-summary">
          <p>
            <strong>
              Hosted processing: {titleCase(batch.batch.hostedApproval.state)}
            </strong>
          </p>
          <p className="muted">
            Paid hosted work cannot dispatch or be claimed until an Owner or
            Administrator approves this exact batch.
          </p>
          {batch.batch.hostedApproval.decidedBy &&
          batch.batch.hostedApproval.decidedAt ? (
            <p className="muted">
              Last decided by @{batch.batch.hostedApproval.decidedBy.handle} ·{" "}
              {new Date(batch.batch.hostedApproval.decidedAt).toLocaleString()}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onHostedApproval(
                batch.batch.hostedApproval?.state === "approved"
                  ? "revoke"
                  : "approve",
              )
            }
          >
            {batch.batch.hostedApproval.state === "approved"
              ? "Revoke hosted approval"
              : "Approve hosted processing"}
          </button>
          <p className="muted">Owner or Administrator authority is required.</p>
        </div>
      ) : null}
      <div className="action-row">
        {batch.batch.dispatchStatus === "active" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onControl("pause_pending")}
          >
            Pause pending
          </button>
        ) : null}
        {batch.batch.dispatchStatus === "paused" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onControl("resume")}
          >
            Resume
          </button>
        ) : null}
        {canDispatch && batch.progress.retryableFailed > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onControl("retry_failed")}
          >
            Retry failed
          </button>
        ) : null}
        {canDispatch && batch.progress.queued > 0 ? (
          <button
            type="button"
            className="danger-action"
            disabled={busy}
            onClick={() => onControl("cancel_unstarted")}
          >
            Cancel unstarted
          </button>
        ) : null}
        {batch.items.some(
          (item) => !["canceling", "canceled"].includes(item.state),
        ) ? (
          <button
            type="button"
            className="danger-action"
            disabled={busy}
            onClick={() => onControl("cancel_all")}
          >
            Cancel batch
          </button>
        ) : null}
        {hiddenHistoryCount ? (
          <button
            type="button"
            onClick={() => onShowCanceledItemsChange(!showCanceledItems)}
          >
            {showCanceledItems
              ? "Hide canceled/history"
              : `Show canceled/history (${hiddenHistoryCount})`}
          </button>
        ) : null}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Video</th>
              <th>Stage</th>
              <th>Attempt</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.title ?? item.input}
                  {item.error ? <small>{item.error.message}</small> : null}
                  {item.catalogVideoId &&
                  timedImportDrafts[
                    timedImportKey(projectId, item.catalogVideoId, item.id)
                  ]?.status?.state === "finalized" ? (
                    <TimedTranscriptCandidateReview
                      item={item}
                      draft={
                        timedImportDrafts[
                          timedImportKey(
                            projectId,
                            item.catalogVideoId,
                            item.id,
                          )
                        ]!
                      }
                      onPage={onReviewPage}
                      onActivate={onActivateCandidate}
                    />
                  ) : null}
                  {item.languageGate?.state !== undefined &&
                  item.languageGate.state !== "ready" ? (
                    <LanguageConfirmation
                      item={item}
                      gate={item.languageGate}
                      {...(item.catalogVideoId &&
                      languageDecisionDrafts[
                        languageDecisionKey(
                          projectId,
                          item.catalogVideoId,
                          item.id,
                        )
                      ]
                        ? {
                            draft:
                              languageDecisionDrafts[
                                languageDecisionKey(
                                  projectId,
                                  item.catalogVideoId,
                                  item.id,
                                )
                              ],
                          }
                        : {})}
                      onDraftChange={onLanguageDraftChange}
                      onConfirm={onConfirmLanguage}
                      timedImportDraft={
                        item.catalogVideoId
                          ? timedImportDrafts[
                              timedImportKey(
                                projectId,
                                item.catalogVideoId,
                                item.id,
                              )
                            ]
                          : undefined
                      }
                      onTimedImportFile={onTimedImportFile}
                      onCreateTimedImport={onCreateTimedImport}
                    />
                  ) : null}
                </td>
                <td>
                  <TranscriptionStageBar item={item} />
                </td>
                <td>{item.attempt}</td>
                <td>
                  <button
                    type="button"
                    className="danger-action"
                    disabled={
                      busy ||
                      item.state === "canceling" ||
                      item.state === "canceled"
                    }
                    onClick={() => onCancelItem(item)}
                  >
                    {item.state === "canceling"
                      ? "Canceling…"
                      : item.state === "canceled"
                        ? "Canceled"
                        : "Cancel"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type LanguageDecisionDraft = Readonly<{
  resolvedLanguage: string;
  busy: boolean;
  idempotencyKey?: string;
  error?: string;
}>;

type TimedImportDraft = Readonly<{
  phase:
    | "idle"
    | "creating"
    | "uploading"
    | "finalizing"
    | "finalized"
    | "reviewing"
    | "activating"
    | "activated"
    | "failed";
  original?: File;
  english?: File;
  importId?: string;
  originalReceipt?: ManualTimedTranscriptUploadReceipt;
  englishReceipt?: ManualTimedTranscriptUploadReceipt;
  createIdempotencyKey?: string;
  finalizeIdempotencyKey?: string;
  finalizeTakeoverAttempts?: number;
  status?: ManualTimedTranscriptImportStatus;
  review?: ManualTimedTranscriptCandidateReviewPage;
  activationIdempotencyKey?: string;
  activation?: ManualTimedTranscriptActivationStatus;
  error?: string;
}>;

function TimedTranscriptCandidateReview({
  item,
  draft,
  onPage,
  onActivate,
}: {
  item: TranscriptionBatchItem;
  draft: TimedImportDraft;
  onPage(item: TranscriptionBatchItem, offset: number): void;
  onActivate(item: TranscriptionBatchItem): void;
}) {
  const review = draft.review;
  if (!review) {
    return (
      <div className="timed-candidate-review">
        <p role={draft.error ? "alert" : "status"}>
          {draft.error ?? "Loading the finalized bilingual candidate…"}
        </p>
      </div>
    );
  }
  const rows = Array.from({
    length: Math.max(review.original.cues.length, review.english.cues.length),
  });
  const busy = draft.phase === "reviewing" || draft.phase === "activating";
  const activated = draft.activation?.state === "activated";
  return (
    <section
      className="timed-candidate-review"
      aria-label="Corrected transcript candidate review"
    >
      <p role="status">Timed bilingual candidate finalized for review.</p>
      <h4>Review corrected bilingual transcript</h4>
      <p>
        Candidate {review.candidateId} · immutable version{" "}
        {review.transcriptVersionId} · cue timing ·{" "}
        {formatLanguageLabel(review.original.language)} → English ·{" "}
        {review.original.provider}
      </p>
      <p>
        English track {review.english.trackId} links directly to original track{" "}
        {review.english.sourceTrackId}.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                Original — {formatLanguageLabel(review.original.language)}
              </th>
              <th>English</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((_, index) => {
              const original = review.original.cues[index];
              const english = review.english.cues[index];
              return (
                <tr key={`${review.offset}:${index}`}>
                  <td>
                    {original ? (
                      <>
                        <small>
                          {formatReviewTime(original.startMs)}–
                          {formatReviewTime(original.endMs)}
                        </small>
                        <p>{original.text}</p>
                      </>
                    ) : (
                      <span className="muted">No cue at this ordinal</span>
                    )}
                  </td>
                  <td>
                    {english ? (
                      <>
                        <small>
                          {formatReviewTime(english.startMs)}–
                          {formatReviewTime(english.endMs)}
                        </small>
                        <p>{english.text}</p>
                      </>
                    ) : (
                      <span className="muted">No cue at this ordinal</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="action-row">
        <button
          type="button"
          disabled={busy || review.offset === 0}
          onClick={() =>
            onPage(item, Math.max(0, review.offset - review.limit))
          }
        >
          Previous cues
        </button>
        <button
          type="button"
          disabled={busy || !review.hasMore}
          onClick={() => onPage(item, review.offset + review.limit)}
        >
          Next cues
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={busy || activated}
          onClick={() => onActivate(item)}
        >
          {draft.phase === "activating"
            ? "Activating reviewed version"
            : activated
              ? "Corrected version active"
              : "Activate this exact version"}
        </button>
      </div>
      {activated ? (
        <p role="status">
          Corrected transcript activated. The shared transcript workspace now
          resolves this exact immutable version.
        </p>
      ) : null}
      {draft.error ? <p role="alert">{draft.error}</p> : null}
    </section>
  );
}

function keywordGroup(
  item: ProjectVideoWorklistItem,
): Exclude<KeywordResultGroup, "all"> {
  const scan = item.keywordScan;
  if (scan.status === "current")
    return scan.occurrenceCount === 0 ? "no_matches" : "promising";
  if (scan.status === "queued" || scan.status === "scanning")
    return "processing";
  return "action_needed";
}

function keywordGroupLabel(group: Exclude<KeywordResultGroup, "all">) {
  if (group === "promising") return "Promising";
  if (group === "no_matches") return "No matches";
  if (group === "processing") return "Processing";
  return "Action needed";
}

function visibleKeywordResult(scan: ProjectVideoWorklistItem["keywordScan"]) {
  if (
    (scan.status === "current" || scan.status === "stale") &&
    scan.scanId &&
    scan.transcriptVersionId &&
    scan.occurrenceCount !== undefined &&
    scan.matchedKeywordCount !== undefined &&
    scan.artifact &&
    scan.completedAt
  ) {
    return {
      scanId: scan.scanId,
      transcriptVersionId: scan.transcriptVersionId,
      keywordSetVersion: scan.keywordSetVersion,
      scannerSchemaVersion: scan.scannerSchemaVersion,
      occurrenceCount: scan.occurrenceCount,
      matchedKeywordCount: scan.matchedKeywordCount,
      ...(scan.keywordCounts ? { keywordCounts: scan.keywordCounts } : {}),
      approvedKeywordCount: scan.approvedKeywordCount,
      ...(scan.durationMs === undefined ? {} : { durationMs: scan.durationMs }),
      ...(scan.matchesPerMinute === undefined
        ? {}
        : { matchesPerMinute: scan.matchesPerMinute }),
      artifact: scan.artifact,
      completedAt: scan.completedAt,
    };
  }
  return scan.priorResult;
}

function keywordSummaryLabel(item: ProjectVideoWorklistItem) {
  const scan = item.keywordScan;
  if (scan.status === "current")
    return scan.occurrenceCount === 0
      ? "Current scan · genuine zero matches · no triage change"
      : "Current keyword evidence";
  if (scan.status === "stale") return "Stale prior evidence · rescan required";
  if (scan.status === "queued")
    return scan.priorResult
      ? "Replacement queued · showing prior stale evidence"
      : "Keyword scan queued";
  if (scan.status === "scanning")
    return scan.priorResult
      ? "Replacement scanning · showing prior stale evidence"
      : "Keyword scan in progress";
  if (scan.status === "failed")
    return `${scan.priorResult ? "Replacement failed · prior stale evidence remains" : "Keyword scan failed"}${scan.error ? ` · ${scan.error.message}` : ""}`;
  if (scan.status === "waiting_for_transcript")
    return "Waiting for an active transcript";
  return "Not scanned yet";
}

function compareKeywordRows(
  left: ProjectVideoWorklistItem,
  right: ProjectVideoWorklistItem,
  sort: KeywordSort,
) {
  const leftResult = visibleKeywordResult(left.keywordScan);
  const rightResult = visibleKeywordResult(right.keywordScan);
  const value = (item: ProjectVideoWorklistItem, side: typeof leftResult) => {
    if (sort === "coverage") return side?.matchedKeywordCount ?? -1;
    if (sort === "occurrences") return side?.occurrenceCount ?? -1;
    if (sort === "density") return side?.matchesPerMinute ?? -1;
    if (sort === "duration") return item.video.durationMs ?? -1;
    if (sort === "priority")
      return { high: 3, normal: 2, low: 1 }[item.priority];
    return Date.parse(side?.completedAt ?? item.updatedAt);
  };
  return (
    value(right, rightResult) - value(left, leftResult) ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.video.id.localeCompare(right.video.id)
  );
}

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function formatReviewTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}.${String(
    milliseconds % 1_000,
  ).padStart(3, "0")}`;
}

function formatLoadDuration(milliseconds: number) {
  if (milliseconds <= 0) return "0m";
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const timedImportFinalizeTakeoverDelayMs = 250;

function languageDecisionKey(
  projectId: string,
  catalogVideoId: string,
  batchItemId: string,
) {
  return `${projectId}:${catalogVideoId}:${batchItemId}`;
}

function timedImportKey(
  projectId: string,
  catalogVideoId: string,
  batchItemId: string,
) {
  return `timed-import:${projectId}:${catalogVideoId}:${batchItemId}`;
}

function supportsTimedImport(gate: LanguageGate | undefined) {
  if (gate?.decision?.status !== "confirmed") return false;
  return (
    gate.state === "needs_transcript" ||
    gate.state === "needs_translation" ||
    gate.speechCapability?.state === "unsupported" ||
    gate.translationCapability?.state === "unsupported"
  );
}

function timedFormatForFile(file: File): ManualTimedTranscriptFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".srt")) return "srt";
  if (name.endsWith(".vtt")) return "vtt";
  throw new Error("Timed transcript files must use the .srt or .vtt format.");
}

async function timedFileDescriptor(file: File) {
  const format = timedFormatForFile(file);
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    throw new Error("Timed transcript files must be between 1 byte and 20 MB.");
  }
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return {
    format,
    byteSize: file.size,
    sha256: [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

async function uploadTimedFile(
  target:
    | {
        role: "original" | "english";
        format: ManualTimedTranscriptFormat;
        uploadUrl: string;
      }
    | undefined,
  importId: string,
  file: File,
  descriptor: {
    format: ManualTimedTranscriptFormat;
    byteSize: number;
    sha256: string;
  },
): Promise<ManualTimedTranscriptUploadReceipt> {
  if (!target || target.format !== descriptor.format) {
    throw new Error(
      "The timed transcript upload grant did not match the selected file.",
    );
  }
  const contentType =
    descriptor.format === "srt" ? "application/x-subrip" : "text/vtt";
  const bridge = desktopBridge();
  const objectVersionId = bridge
    ? (
        await bridge.uploadTimedTranscript({
          importId,
          role: target.role,
          contentType,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })
      ).objectVersionId
    : await uploadTimedTranscriptInBrowser(target.uploadUrl, file, contentType);
  return {
    objectVersionId,
    byteSize: descriptor.byteSize,
    sha256: descriptor.sha256,
  };
}

async function uploadTimedTranscriptInBrowser(
  uploadUrl: string,
  file: File,
  contentType: "application/x-subrip" | "text/vtt",
) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: file,
    redirect: "error",
  });
  if (!response.ok) throw new Error("Timed transcript upload failed.");
  const objectVersionId = response.headers.get("x-amz-version-id");
  if (!objectVersionId)
    throw new Error(
      "Timed transcript upload did not return an object version.",
    );
  return objectVersionId;
}

function LanguageConfirmation({
  item,
  gate,
  draft,
  onDraftChange,
  onConfirm,
  timedImportDraft,
  onTimedImportFile,
  onCreateTimedImport,
}: {
  item: TranscriptionBatchItem;
  gate: LanguageGate;
  draft?: LanguageDecisionDraft;
  onDraftChange(item: TranscriptionBatchItem, resolvedLanguage: string): void;
  onConfirm(
    item: TranscriptionBatchItem,
    gate: LanguageGate,
    resolvedLanguage: string,
  ): void;
  timedImportDraft: TimedImportDraft | undefined;
  onTimedImportFile(
    item: TranscriptionBatchItem,
    role: "original" | "english",
    file: File | undefined,
  ): void;
  onCreateTimedImport(item: TranscriptionBatchItem, gate: LanguageGate): void;
}) {
  const choices = [
    ...new Set([
      gate.creatorReportedLanguage,
      gate.providerEvidence?.reportedLanguage,
      gate.decision?.resolvedLanguage,
    ]),
  ].filter((language): language is string => Boolean(language));
  const selectedLanguage = draft?.resolvedLanguage ?? choices[0] ?? "";
  const confirmedLanguage = normalizeSpokenLanguageChoice(selectedLanguage);
  const requiresExplicitLanguage = choices.length === 0;
  const languageSuggestionsId = `spoken-language-suggestions-${item.id}`;
  const unsupported = [gate.speechCapability, gate.translationCapability]
    .filter((capability): capability is NonNullable<typeof capability> =>
      Boolean(capability),
    )
    .find((capability) => capability.state !== "supported");
  const selectedCapabilityUnsupported = Boolean(
    unsupported?.sourceLanguage &&
    confirmedLanguage &&
    languagesEquivalent(unsupported.sourceLanguage, confirmedLanguage),
  );

  return (
    <fieldset>
      <legend>Language confirmation required</legend>
      <p>
        Provider-reported language:{" "}
        {gate.providerEvidence?.reportedLanguage ?? "Unknown"}
      </p>
      <p>
        Creator-reported language: {gate.creatorReportedLanguage ?? "Unknown"}
      </p>
      <p>
        Current resolved language:{" "}
        {gate.decision?.resolvedLanguage ?? "Unresolved"}
      </p>
      <p>
        Status: {gate.status}. Basis:{" "}
        {gate.decision?.basis ?? "Not yet confirmed"}. Decision version:{" "}
        {gate.decision?.decisionVersion ?? 0}.
      </p>
      <p>Speech capability: {capabilitySummary(gate.speechCapability)}</p>
      <p>
        Translation capability: {capabilitySummary(gate.translationCapability)}
      </p>
      <p>
        {remediationCopy(gate.remediationReason)}
        {unsupported
          ? ` ${unsupported.operation === "speech_to_text" ? "Speech recognition" : "Translation"} is ${unsupported.state}${"reason" in unsupported ? ` (${unsupported.reason.replaceAll("_", " ")})` : ""}.`
          : ""}
      </p>
      <label>
        Confirmed spoken language
        {requiresExplicitLanguage ? (
          <>
            <input
              aria-label={`Confirmed spoken language for ${item.title ?? item.input}`}
              list={languageSuggestionsId}
              value={selectedLanguage}
              maxLength={35}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={draft?.busy}
              placeholder="Choose or type a language code"
              onChange={(event) => onDraftChange(item, event.target.value)}
            />
            <datalist id={languageSuggestionsId}>
              {suggestedSpokenLanguages.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </datalist>
          </>
        ) : (
          <select
            aria-label={`Confirmed spoken language for ${item.title ?? item.input}`}
            value={selectedLanguage}
            disabled={draft?.busy}
            onChange={(event) => onDraftChange(item, event.target.value)}
          >
            {choices.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        )}
      </label>
      {requiresExplicitLanguage ? (
        selectedLanguage && !confirmedLanguage ? (
          <p role="alert">
            Enter a valid BCP-47 language tag, such as en, dz, or zh-Hant.
          </p>
        ) : (
          <p className="form-message">
            {confirmedLanguage
              ? `Selected: ${spokenLanguageChoiceLabel(confirmedLanguage)}`
              : "No language was detected. Choose a suggestion or type a BCP-47 language tag."}
          </p>
        )
      ) : null}
      <button
        type="button"
        disabled={
          draft?.busy ||
          !confirmedLanguage ||
          !item.catalogVideoId ||
          selectedCapabilityUnsupported
        }
        onClick={() => onConfirm(item, gate, confirmedLanguage ?? "")}
      >
        {selectedCapabilityUnsupported
          ? "Choose a supported language to retry"
          : "Confirm language and retry"}
      </button>
      {!item.catalogVideoId ? (
        <p role="alert">
          This item cannot be confirmed until its project video is available.
        </p>
      ) : null}
      {draft?.error ? <p role="alert">{draft.error}</p> : null}
      {supportsTimedImport(gate) ? (
        <TimedTranscriptImport
          item={item}
          gate={gate}
          draft={timedImportDraft}
          onFile={onTimedImportFile}
          onCreate={onCreateTimedImport}
        />
      ) : null}
    </fieldset>
  );
}

function TimedTranscriptImport({
  item,
  gate,
  draft,
  onFile,
  onCreate,
}: {
  item: TranscriptionBatchItem;
  gate: LanguageGate;
  draft: TimedImportDraft | undefined;
  onFile(
    item: TranscriptionBatchItem,
    role: "original" | "english",
    file: File | undefined,
  ): void;
  onCreate(item: TranscriptionBatchItem, gate: LanguageGate): void;
}) {
  const busy = ["creating", "uploading", "finalizing"].includes(
    draft?.phase ?? "idle",
  );
  return (
    <fieldset>
      <legend>Import timed original and English transcripts</legend>
      <p>
        Import one UTF-8 SRT or VTT file for the confirmed original language and
        one directly linked English file. This creates a review candidate and
        does not replace the active transcript.
      </p>
      <TimedTranscriptFileInput
        label="Timed original transcript"
        file={draft?.original}
        disabled={busy}
        onFile={(file) => onFile(item, "original", file)}
      />
      <TimedTranscriptFileInput
        label="Timed English transcript"
        file={draft?.english}
        disabled={busy}
        onFile={(file) => onFile(item, "english", file)}
      />
      <button
        type="button"
        disabled={
          busy || !draft?.original || !draft.english || !item.catalogVideoId
        }
        onClick={() => onCreate(item, gate)}
      >
        {busy ? "Importing timed transcripts" : "Import timed transcripts"}
      </button>
      {draft?.status?.state === "finalized" ? (
        <p role="status">Timed bilingual candidate finalized for review.</p>
      ) : null}
      {draft?.phase === "finalizing" && draft.status?.state === "finalizing" ? (
        <p role="status">
          Finalization is still in progress. Retrying confirmation shortly.
        </p>
      ) : null}
      {draft?.error ? <p role="alert">{draft.error}</p> : null}
    </fieldset>
  );
}

function TimedTranscriptFileInput({
  label,
  file,
  disabled,
  onFile,
}: {
  label: string;
  file: File | undefined;
  disabled: boolean;
  onFile(file: File | undefined): void;
}) {
  return (
    <label>
      {label}
      <input
        type="file"
        accept=".srt,.vtt,application/x-subrip,text/vtt,text/plain"
        disabled={disabled}
        onChange={(event) => onFile(event.currentTarget.files?.[0])}
      />
      <span>
        {file
          ? `${timedFormatForFile(file).toUpperCase()} · ${file.size} bytes`
          : "No file selected"}
      </span>
    </label>
  );
}

function remediationCopy(reason: LanguageGate["remediationReason"]) {
  switch (reason) {
    case "confirm_language":
      return "Confirm the spoken language before transcription can continue.";
    case "resolve_conflict":
      return "Provider and creator language evidence conflict. Confirm the spoken language before any dependent work continues.";
    case "select_supported_provider":
      return "The selected language needs a supported provider before work can continue.";
    default:
      return "Language evidence needs remediation before work can continue.";
  }
}

function capabilitySummary(capability: LanguageGate["speechCapability"]) {
  if (!capability) return "Not evaluated";
  return capability.state === "supported"
    ? "Supported"
    : `${capability.state.replaceAll("_", " ")} (${capability.reason.replaceAll("_", " ")})`;
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}

async function payloadIdempotencyKey(scope: string, payload: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${scope}:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

class CloudRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
