import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  ApiErrorSchema,
  ClipCandidateSchema,
  ClipSelectionSchema,
  CreateTranscriptionBatchResponseSchema,
  CreateClipCandidateRequestSchema,
  ExportPresetSnapshotSchema,
  ExportSettingsPreviewSchema,
  PersonalExportPresetCatalogSchema,
  ProjectExportPresetCatalogSchema,
  ExportRequestSchema,
  ProjectSchema,
  ProjectSummarySchema,
  RetryTranscriptionBatchItemResponseSchema,
  ExportSourceRightsSnapshotSchema,
  PlayerTimeRangeSelectionSchema,
  TranscriptSelectionSchema,
  TranscriptionBatchListResponseSchema,
  TranscriptWorkspaceResponseSchema,
  UserSchema,
  VideoSchema,
  languagesEquivalent,
  type ClipCandidate,
  type ClipSelection,
  type DesktopAuthStatus,
  type DesktopNotificationNavigationTarget,
  type ExportPresetCatalogEntry,
  type ExportPresetDefault,
  type ExportPresetSnapshot,
  type ExportSettingsOverride,
  type ExportSettingsPreview,
  type ExportSettingsSelection,
  type NormalizedTranscript,
  type ProjectSummary,
  type NoSpeechAttestation,
  type TranscriptSelection,
  type TranscriptWorkspaceResponse,
  type User,
  type Video,
} from "@research-video/contracts";
import { normalizeYouTubeUrl } from "@research-video/providers";
import {
  deriveTranscriptSelection,
  derivePlayerRangeTranscriptAttachment,
  buildClipLanguageEvidence,
  searchTranscriptOccurrences,
  segmentAtTime,
  timedTranscriptTokens,
  transcriptTextForTimeRange,
  tokenAtTime,
  updateTranscriptSelectionExportBounds,
} from "@research-video/transcript";

import "./styles.css";
import {
  apiFetch,
  desktopBridge,
  DESKTOP_CONNECTED_SENTINEL,
} from "./api-client.ts";
import { BatchWorkspace } from "./batch-workspace.tsx";
import { findRetryableTranscriptionItem } from "./transcription-action-batch.ts";
import { DesktopSetup, type DesktopProfileState } from "./desktop-setup.tsx";
import { NotificationPreferencesPanel } from "./notification-preferences.tsx";
import { resolveNotificationNavigation } from "./notification-navigation.ts";
import { PlayerPanel } from "./player-panel.tsx";
import { BookmarksPanel } from "./bookmarks-panel.tsx";
import { SelectionCommandPanel } from "./selection-command-panel.tsx";
import { SelectionEditor } from "./selection-editor.tsx";
import { SourceIngestPanel } from "./source-ingest-panel.tsx";
import { TranscriptNavigationPanel } from "./transcript-navigation-panel.tsx";
import type { YouTubePlayerHandle } from "./youtube-player.tsx";
import {
  AccountLanguagePanel,
  ResearchWorkspaceLayout,
  WorkspaceShell,
  type ProjectDestination,
} from "./workspace-shell.tsx";

const builtInPresetKey = "built-in:editing-mp4:v1";

type WorkspaceVideoTarget = Readonly<{
  projectId: string;
  catalogVideoId: string;
  youtubeVideoId: string;
  canonicalUrl: string;
  title?: string;
  keywordEvidence?: Readonly<{
    seekMs: number;
    timingPrecision: "word" | "cue" | "estimated";
    trackId: string;
    aliasPhrase: string;
  }>;
  bookmarkSource?: Readonly<{ sourceTimeMs: number }>;
  clipSource?: Readonly<{
    clipId: string;
    selection: ClipSelection;
    fallbackNotice?: string;
    sourceTimeMs?: number;
  }>;
}>;

type NavigationSnapshot = Readonly<{
  schemaVersion: 1;
  projectId: string;
  catalogVideoId: string;
  youtubeVideoId: string;
  canonicalUrl: string;
  title?: string;
  transcriptVersionId: string;
  currentMs: number;
  transcriptView: "preferred" | "english" | "original";
  query: string;
  matchIndex: number;
  selection?: TranscriptSelection;
}>;

const navigationHistoryLimit = 20;

function parseNavigationSnapshot(
  value: unknown,
): NavigationSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.projectId !== "string" ||
    typeof candidate.catalogVideoId !== "string" ||
    typeof candidate.youtubeVideoId !== "string" ||
    typeof candidate.canonicalUrl !== "string" ||
    typeof candidate.transcriptVersionId !== "string" ||
    typeof candidate.currentMs !== "number" ||
    !Number.isFinite(candidate.currentMs) ||
    candidate.currentMs < 0 ||
    !["preferred", "english", "original"].includes(
      String(candidate.transcriptView),
    ) ||
    typeof candidate.query !== "string" ||
    candidate.query.length > 500 ||
    typeof candidate.matchIndex !== "number" ||
    !Number.isInteger(candidate.matchIndex) ||
    candidate.matchIndex < 0 ||
    (candidate.title !== undefined &&
      (typeof candidate.title !== "string" || candidate.title.length > 500))
  )
    return undefined;
  const parsedSelection = candidate.selection
    ? TranscriptSelectionSchema.safeParse(candidate.selection)
    : undefined;
  if (parsedSelection && !parsedSelection.success) return undefined;
  return {
    schemaVersion: 1,
    projectId: candidate.projectId,
    catalogVideoId: candidate.catalogVideoId,
    youtubeVideoId: candidate.youtubeVideoId,
    canonicalUrl: candidate.canonicalUrl,
    ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
    transcriptVersionId: candidate.transcriptVersionId,
    currentMs: candidate.currentMs,
    transcriptView:
      candidate.transcriptView as NavigationSnapshot["transcriptView"],
    query: candidate.query,
    matchIndex: candidate.matchIndex,
    ...(parsedSelection?.success ? { selection: parsedSelection.data } : {}),
  };
}

function navigationStorageKey(userId: string, projectId: string) {
  return `vera:navigation:v1:${userId}:${projectId}`;
}

type WorkspaceLoadState = "idle" | "loading" | "unavailable" | "failed";

function catalogPresetKey(
  scope: "personal" | "project",
  snapshot: ExportPresetSnapshot & { presetId: string },
) {
  return `${scope}:${snapshot.presetId}:v${snapshot.presetVersion}`;
}

function catalogEntrySnapshot(
  entry: ExportPresetCatalogEntry,
): ExportPresetSnapshot & { presetId: string } {
  const snapshot = ExportPresetSnapshotSchema.parse({
    presetId: entry.id,
    presetVersion: entry.current.presetVersion,
    name: entry.current.name,
    settings: entry.current.settings,
  });
  return { ...snapshot, presetId: entry.id };
}

function mapSelectionToTranscript(
  selection: TranscriptSelection,
  transcript: NormalizedTranscript,
): TranscriptSelection {
  const segments = transcript.segments.filter(
    (segment) =>
      segment.endMs > selection.transcriptStartMs &&
      segment.startMs < selection.transcriptEndMs,
  );
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) {
    throw new Error("The selected time range is unavailable in this view.");
  }
  return TranscriptSelectionSchema.parse({
    trackId: transcript.track.id,
    transcriptVersion: transcript.track.version,
    firstSegmentId: first.id,
    lastSegmentId: last.id,
    transcriptStartMs: selection.transcriptStartMs,
    transcriptEndMs: selection.transcriptEndMs,
    exportStartMs: selection.exportStartMs,
    exportEndMs: selection.exportEndMs,
    text: transcriptTextForTimeRange(
      transcript,
      selection.transcriptStartMs,
      selection.transcriptEndMs,
    ),
    timingPrecision: transcript.track.timingPrecision,
  });
}

function transcriptForView(
  workspace: TranscriptWorkspaceResponse,
  view: "preferred" | "english" | "original",
) {
  if (view === "original") return workspace.original;
  if (view === "english") return workspace.english;
  return workspace.preferred.state === "ready"
    ? workspace.preferred.transcript
    : undefined;
}

function exactRestorableSelection(
  candidate: TranscriptSelection | undefined,
  transcript: NormalizedTranscript | undefined,
) {
  if (!candidate || !transcript) return undefined;
  const orderedSegments = transcript.segments.toSorted(
    (left, right) => left.ordinal - right.ordinal,
  );
  const firstSegmentIndex = orderedSegments.findIndex(
    (segment) => segment.id === candidate.firstSegmentId,
  );
  const lastSegmentIndex = orderedSegments.findIndex(
    (segment) => segment.id === candidate.lastSegmentId,
  );
  if (
    candidate.trackId !== transcript.track.id ||
    candidate.transcriptVersion !== transcript.track.version ||
    firstSegmentIndex < 0 ||
    lastSegmentIndex < firstSegmentIndex ||
    Boolean(candidate.firstTokenId) !== Boolean(candidate.lastTokenId)
  )
    return undefined;
  if (candidate.firstTokenId && candidate.lastTokenId) {
    const segmentOrder = new Map(
      orderedSegments.map((segment, index) => [segment.id, index]),
    );
    const orderedTokens = transcript.tokens.toSorted(
      (left, right) =>
        (segmentOrder.get(left.segmentId) ?? Number.MAX_SAFE_INTEGER) -
          (segmentOrder.get(right.segmentId) ?? Number.MAX_SAFE_INTEGER) ||
        left.ordinal - right.ordinal,
    );
    const firstTokenIndex = orderedTokens.findIndex(
      (token) => token.id === candidate.firstTokenId,
    );
    const lastTokenIndex = orderedTokens.findIndex(
      (token) => token.id === candidate.lastTokenId,
    );
    const firstToken = orderedTokens[firstTokenIndex];
    const lastToken = orderedTokens[lastTokenIndex];
    if (
      firstTokenIndex < 0 ||
      lastTokenIndex < firstTokenIndex ||
      !firstToken ||
      !lastToken ||
      firstToken.segmentId !== candidate.firstSegmentId ||
      lastToken.segmentId !== candidate.lastSegmentId ||
      firstToken.startMs !== candidate.transcriptStartMs ||
      lastToken.endMs !== candidate.transcriptEndMs ||
      orderedTokens
        .slice(firstTokenIndex, lastTokenIndex + 1)
        .map((token) => token.text)
        .join(" ") !== candidate.text
    )
      return undefined;
  } else if (
    transcriptTextForTimeRange(
      transcript,
      candidate.transcriptStartMs,
      candidate.transcriptEndMs,
    ) !== candidate.text
  ) {
    return undefined;
  }
  return candidate;
}

function transcriptEvidenceSelection(
  selection: ClipSelection | undefined,
): TranscriptSelection | undefined {
  if (!selection) return undefined;
  return selection.selectionType === "player_time_range"
    ? selection.transcriptAttachment
    : selection;
}

function directNavigationSelection(
  selection: ClipSelection | undefined,
): TranscriptSelection | undefined {
  return selection?.selectionType === "player_time_range"
    ? undefined
    : selection;
}

function playerSpeechLabel(
  status: "speech" | "no_speech" | "transcript_unavailable",
) {
  if (status === "no_speech") return "No speech";
  if (status === "transcript_unavailable") return "Transcript unavailable";
  return "Speech";
}

function App() {
  const [url, setUrl] = useState("");
  const [workspaceTarget, setWorkspaceTarget] =
    useState<WorkspaceVideoTarget>();
  const [workspace, setWorkspace] = useState<TranscriptWorkspaceResponse>();
  const [workspaceLoadState, setWorkspaceLoadState] =
    useState<WorkspaceLoadState>("idle");
  const [workspaceMessage, setWorkspaceMessage] = useState<string>();
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [workspaceRetry, setWorkspaceRetry] = useState<{
    batchId: string;
    itemId: string;
  }>();
  const workspaceGeneration = useRef(0);
  const handledKeywordEvidence = useRef<string | undefined>(undefined);
  const recentProjectValidation = useRef<string | undefined>(undefined);
  const [recentProjectReadyIdentity, setRecentProjectReadyIdentity] =
    useState<string>();
  const [projectVideos, setProjectVideos] = useState<Video[]>();
  const [error, setError] = useState<string>();
  const [videoLoadBusy, setVideoLoadBusy] = useState(false);
  const [videoLoadMessage, setVideoLoadMessage] = useState<string>();
  const videoLoadGeneration = useRef(0);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [lastSeekMs, setLastSeekMs] = useState<number>();
  const [clipLoopRange, setClipLoopRange] = useState<{
    startMs: number;
    endMs: number;
  }>();
  const [navigationBackStack, setNavigationBackStack] = useState<
    NavigationSnapshot[]
  >([]);
  const pendingNavigationRestore = useRef<NavigationSnapshot | undefined>(
    undefined,
  );
  const pendingMatchIndexRestore = useRef<number | undefined>(undefined);
  const hydratedNavigationIdentity = useRef<string | undefined>(undefined);
  const [follow, setFollow] = useState(true);
  const [selection, setSelection] = useState<ClipSelection>();
  const [selectionError, setSelectionError] = useState<string>();
  const [sourceDurationMs, setSourceDurationMs] = useState<number>();
  const [playerRangeStartMs, setPlayerRangeStartMs] = useState<number>();
  const [playerRangeEndMs, setPlayerRangeEndMs] = useState<number>();
  const [playerSpeechStatus, setPlayerSpeechStatus] = useState<
    "speech" | "no_speech" | "transcript_unavailable"
  >();
  const [playerRangeMessage, setPlayerRangeMessage] = useState<string>();
  const [playerNoSpeechAttestation, setPlayerNoSpeechAttestation] =
    useState<NoSpeechAttestation>();
  const [previewingSelection, setPreviewingSelection] = useState(false);
  const [authorization, setAuthorization] = useState("");
  const [desktopAuthStatus, setDesktopAuthStatus] =
    useState<DesktopAuthStatus>();
  const [user, setUser] = useState<User>();
  const [profileState, setProfileState] = useState<DesktopProfileState>("idle");
  const [preferredLanguageDraft, setPreferredLanguageDraft] = useState("en");
  const [preferenceMessage, setPreferenceMessage] = useState(
    "Connect a session to load your account preference.",
  );
  const [transcriptView, setTranscriptView] = useState<
    "preferred" | "english" | "original"
  >("preferred");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [destination, setDestination] = useState<ProjectDestination>("videos");
  const [notificationTarget, setNotificationTarget] =
    useState<DesktopNotificationNavigationTarget>();
  const [pendingNotificationTarget, setPendingNotificationTarget] =
    useState<DesktopNotificationNavigationTarget>();
  const [bulkAddRequest, setBulkAddRequest] = useState(0);
  const [searchBatchRequest, setSearchBatchRequest] = useState<{
    generation: number;
    inputs: string[];
  }>();
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectKind, setNewProjectKind] = useState<"personal" | "shared">(
    "shared",
  );
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string>();
  const [clipNotes, setClipNotes] = useState("");
  const [clipFirstComment, setClipFirstComment] = useState("");
  const [clipTags, setClipTags] = useState("");
  const [selectionCommandId, setSelectionCommandId] = useState(() =>
    crypto.randomUUID(),
  );
  const [clipActionBusy, setClipActionBusy] = useState(false);
  const [clipActionMessage, setClipActionMessage] = useState<string>();
  const [loggedClipId, setLoggedClipId] = useState<string>();
  const [loggedExportRequestId, setLoggedExportRequestId] = useState<string>();
  const [exportOnlyRequestId, setExportOnlyRequestId] = useState<string>();
  const [sourceRightsConfirmed, setSourceRightsConfirmed] = useState(false);
  const [personalPresets, setPersonalPresets] = useState<
    ExportPresetCatalogEntry[]
  >([]);
  const [personalPresetDefault, setPersonalPresetDefault] =
    useState<ExportPresetDefault>();
  const [projectPresets, setProjectPresets] = useState<
    ExportPresetCatalogEntry[]
  >([]);
  const [projectPresetDefault, setProjectPresetDefault] =
    useState<ExportPresetDefault>();
  const [loggedPresetKey, setLoggedPresetKey] = useState(builtInPresetKey);
  const [exportOnlyPresetKey, setExportOnlyPresetKey] =
    useState(builtInPresetKey);
  const [presetDiscoveryMessage, setPresetDiscoveryMessage] = useState(
    "Connect a session to discover saved presets. Editing MP4 remains available.",
  );
  const [overrideFields, setOverrideFields] = useState<Set<string>>(
    () => new Set(),
  );
  const [loggedSettingsPreview, setLoggedSettingsPreview] =
    useState<ExportSettingsPreview>();
  const [exportOnlySettingsPreview, setExportOnlySettingsPreview] =
    useState<ExportSettingsPreview>();
  const [loggedSettingsState, setLoggedSettingsState] = useState("missing");
  const [exportOnlySettingsState, setExportOnlySettingsState] =
    useState("missing");
  const [exportContainer, setExportContainer] = useState<"mp4" | "mov" | "mkv">(
    "mp4",
  );
  const [exportVideoCodec, setExportVideoCodec] = useState<
    "h264" | "hevc" | "prores"
  >("h264");
  const [exportAudioCodec, setExportAudioCodec] = useState<"aac" | "pcm_s16le">(
    "aac",
  );
  const [exportRateControlMode, setExportRateControlMode] = useState<
    "crf" | "bitrate" | "codec_default"
  >("crf");
  const [exportCrf, setExportCrf] = useState(20);
  const [exportVideoBitrate, setExportVideoBitrate] = useState(8_000);
  const [exportMaxWidth, setExportMaxWidth] = useState<number>();
  const [exportFrameRate, setExportFrameRate] = useState<
    "source" | "23.976" | "24" | "25" | "29.97" | "30"
  >("source");
  const [exportAudioBitrate, setExportAudioBitrate] = useState<number>();
  const [exportAudioSampleRate, setExportAudioSampleRate] = useState<
    "source" | "44100" | "48000"
  >("source");
  const [exportAudioChannels, setExportAudioChannels] = useState<
    "source" | "1" | "2"
  >("source");
  const [omitEnglishSubtitles, setOmitEnglishSubtitles] = useState(false);
  const [embedEnglishSubtitles, setEmbedEnglishSubtitles] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const videoId = workspaceTarget?.youtubeVideoId;

  function clearWorkspaceInteraction() {
    workspaceGeneration.current += 1;
    setWorkspace(undefined);
    setWorkspaceLoadState("idle");
    setWorkspaceMessage(undefined);
    setCurrentMs(0);
    setSourceDurationMs(undefined);
    setLastSeekMs(undefined);
    setClipLoopRange(undefined);
    setQuery("");
    pendingMatchIndexRestore.current = undefined;
    setTranscriptView("preferred");
    setSelection(undefined);
    setSelectionError(undefined);
    setPlayerRangeStartMs(undefined);
    setPlayerRangeEndMs(undefined);
    setPlayerSpeechStatus(undefined);
    setPlayerRangeMessage(undefined);
    setPlayerNoSpeechAttestation(undefined);
    setPreviewingSelection(false);
    setClipNotes("");
    setClipFirstComment("");
    setClipTags("");
    setSelectionCommandId(crypto.randomUUID());
    setClipActionMessage(undefined);
    setLoggedClipId(undefined);
    setLoggedExportRequestId(undefined);
    setExportOnlyRequestId(undefined);
    setSourceRightsConfirmed(false);
    handledKeywordEvidence.current = undefined;
  }

  async function refreshDesktopStatus() {
    const bridge = desktopBridge();
    if (!bridge) return;
    const status = await bridge.getStatus();
    setDesktopAuthStatus(status.auth);
    setAuthorization(
      status.auth.state === "signed_in" ? DESKTOP_CONNECTED_SENTINEL : "",
    );
  }

  async function beginDesktopSignIn() {
    const bridge = desktopBridge();
    if (!bridge) return;
    try {
      const status = await bridge.signIn();
      setDesktopAuthStatus(status);
      setAuthorization(
        status.state === "signed_in" ? DESKTOP_CONNECTED_SENTINEL : "",
      );
    } catch {
      setDesktopAuthStatus({
        state: "signed_out",
        issue: "authentication_failed",
      });
      setAuthorization("");
    }
  }

  async function completeDesktopSignOut() {
    const bridge = desktopBridge();
    if (!bridge) return;
    clearWorkspaceInteraction();
    setWorkspaceTarget(undefined);
    const status = await bridge.signOut();
    setDesktopAuthStatus(status);
    setAuthorization("");
    setProjects([]);
    setProjectsLoaded(false);
    selectProject("");
    setProjectMessage(undefined);
    recentProjectValidation.current = undefined;
    setRecentProjectReadyIdentity(undefined);
  }

  useEffect(() => {
    void refreshDesktopStatus().catch(() => {
      setDesktopAuthStatus({
        state: "unavailable",
        issue: "authentication_failed",
      });
      setAuthorization("");
    });
  }, []);

  useEffect(() => {
    if (
      !desktopBridge() ||
      !["signing_in", "refreshing"].includes(desktopAuthStatus?.state ?? "")
    )
      return;
    const timer = window.setInterval(() => {
      void refreshDesktopStatus().catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [desktopAuthStatus?.state]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    return bridge.onNotificationNavigation((target) => {
      if (target.kind === "local_export") {
        setDestination("workbench");
        setExportOnlyRequestId(target.requestId);
        setClipActionMessage(
          "Opened the local export status from a desktop notification.",
        );
        setNotificationTarget(target);
        return;
      }
      setPendingNotificationTarget(target);
    });
  }, []);

  useEffect(() => {
    const target = pendingNotificationTarget;
    if (!target || target.kind === "local_export" || !projectsLoaded) return;
    setPendingNotificationTarget(undefined);
    const resolution = resolveNotificationNavigation(
      target,
      new Set(projects.map((project) => project.id)),
    );
    if (resolution.state === "project_unavailable") {
      setProjectMessage(
        "This notification belongs to a project that is no longer available to this account.",
      );
      return;
    }
    selectProject(resolution.projectId!);
    setDestination(resolution.destination);
    setNotificationTarget(target);
  }, [pendingNotificationTarget, projects, projectsLoaded]);
  const transcriptTracks = useMemo(
    () =>
      workspace
        ? {
            original: workspace.original,
            english: workspace.english,
            translations:
              workspace.preferred.state === "ready" &&
              workspace.preferred.source !== "original" &&
              workspace.preferred.source !== "english"
                ? [workspace.preferred.transcript]
                : [],
          }
        : undefined,
    [workspace],
  );
  const preferredTranscript =
    workspace?.preferred.state === "ready"
      ? workspace.preferred.transcript
      : undefined;
  const offlineCachedWorkspace = workspace?.catalogState === "offline_cached";
  const transcript = useMemo(() => {
    if (!transcriptTracks) return undefined;
    if (transcriptView === "original") return transcriptTracks.original;
    if (transcriptView === "english") return transcriptTracks.english;
    return preferredTranscript;
  }, [preferredTranscript, transcriptTracks, transcriptView]);
  const preferredEvidenceRequired = Boolean(
    workspace?.preferred.state !== undefined &&
    workspace.preferred.state !== "ready",
  );
  const languageEvidenceReady =
    !preferredEvidenceRequired || Boolean(preferredTranscript);
  const transcriptMatches = useMemo(
    () => searchTranscriptOccurrences(transcript, query),
    [query, transcript],
  );
  const activeSegment = transcript
    ? segmentAtTime(transcript.segments, currentMs)
    : undefined;
  const timedTokens = useMemo(
    () => timedTranscriptTokens(transcript?.tokens ?? []),
    [transcript],
  );
  const activeToken = tokenAtTime(timedTokens, currentMs);
  const exportOverrides = useMemo(() => {
    const override: ExportSettingsOverride = {};
    if (overrideFields.has("container")) override.container = exportContainer;
    if (overrideFields.has("videoCodec"))
      override.videoCodec = exportVideoCodec;
    if (overrideFields.has("videoRateControl"))
      override.videoRateControl =
        exportRateControlMode === "crf"
          ? { mode: "crf", value: exportCrf }
          : exportRateControlMode === "bitrate"
            ? {
                mode: "bitrate",
                kilobitsPerSecond: exportVideoBitrate,
              }
            : { mode: "codec_default" };
    if (overrideFields.has("maxWidth"))
      override.maxWidth = exportMaxWidth ?? null;
    if (overrideFields.has("frameRate")) override.frameRate = exportFrameRate;
    if (overrideFields.has("audioCodec"))
      override.audioCodec = exportAudioCodec;
    if (overrideFields.has("audioKilobitsPerSecond"))
      override.audioKilobitsPerSecond = exportAudioBitrate ?? null;
    if (overrideFields.has("audioSampleRate"))
      override.audioSampleRate = exportAudioSampleRate;
    if (overrideFields.has("audioChannels"))
      override.audioChannels = exportAudioChannels;
    if (overrideFields.has("omitSubtitleFilesForConfirmedEnglish"))
      override.omitSubtitleFilesForConfirmedEnglish = omitEnglishSubtitles;
    if (overrideFields.has("embedEnglishSubtitleTrack"))
      override.embedEnglishSubtitleTrack = embedEnglishSubtitles;
    return override;
  }, [
    embedEnglishSubtitles,
    exportAudioBitrate,
    exportAudioChannels,
    exportAudioCodec,
    exportAudioSampleRate,
    exportContainer,
    exportCrf,
    exportRateControlMode,
    exportFrameRate,
    exportMaxWidth,
    exportVideoCodec,
    exportVideoBitrate,
    omitEnglishSubtitles,
    overrideFields,
  ]);
  const personalPresetOptions = useMemo(() => {
    const options = personalPresets.map((entry) => ({
      key: catalogPresetKey("personal", catalogEntrySnapshot(entry)),
      snapshot: catalogEntrySnapshot(entry),
      description: entry.current.description,
      isDefault:
        personalPresetDefault?.presetId === entry.id &&
        personalPresetDefault.presetVersion === entry.currentVersion,
    }));
    if (
      personalPresetDefault &&
      !options.some(
        (option) =>
          option.snapshot.presetId === personalPresetDefault.presetId &&
          option.snapshot.presetVersion === personalPresetDefault.presetVersion,
      )
    ) {
      options.push({
        key: catalogPresetKey("personal", personalPresetDefault.snapshot),
        snapshot: personalPresetDefault.snapshot,
        description: personalPresetDefault.description,
        isDefault: true,
      });
    }
    return options;
  }, [personalPresetDefault, personalPresets]);
  const projectPresetOptions = useMemo(() => {
    const options = projectPresets.map((entry) => ({
      key: catalogPresetKey("project", catalogEntrySnapshot(entry)),
      snapshot: catalogEntrySnapshot(entry),
      description: entry.current.description,
      isDefault:
        projectPresetDefault?.presetId === entry.id &&
        projectPresetDefault.presetVersion === entry.currentVersion,
    }));
    if (
      projectPresetDefault &&
      !options.some(
        (option) =>
          option.snapshot.presetId === projectPresetDefault.presetId &&
          option.snapshot.presetVersion === projectPresetDefault.presetVersion,
      )
    ) {
      options.push({
        key: catalogPresetKey("project", projectPresetDefault.snapshot),
        snapshot: projectPresetDefault.snapshot,
        description: projectPresetDefault.description,
        isDefault: true,
      });
    }
    return options;
  }, [projectPresetDefault, projectPresets]);
  const loggedPresetSelectionKey =
    projectPresetOptions.some((option) => option.key === loggedPresetKey) ||
    personalPresetOptions.some((option) => option.key === loggedPresetKey)
      ? loggedPresetKey
      : builtInPresetKey;
  const exportOnlyPresetSelectionKey = personalPresetOptions.some(
    (option) => option.key === exportOnlyPresetKey,
  )
    ? exportOnlyPresetKey
    : builtInPresetKey;
  const loggedExportPreset =
    projectPresetOptions.find(
      (option) => option.key === loggedPresetSelectionKey,
    )?.snapshot ??
    personalPresetOptions.find(
      (option) => option.key === loggedPresetSelectionKey,
    )?.snapshot;
  const exportOnlyExportPreset = personalPresetOptions.find(
    (option) => option.key === exportOnlyPresetSelectionKey,
  )?.snapshot;
  const sourceLanguageClass =
    transcriptTracks &&
    transcriptTracks.original.track.id === transcriptTracks.english.track.id &&
    languagesEquivalent(transcriptTracks.original.track.language, "en")
      ? ("confirmed_english" as const)
      : ("foreign" as const);
  const selectedVideoTitle =
    workspaceTarget?.title ??
    projectVideos?.find(
      (candidate) => candidate.id === workspaceTarget?.catalogVideoId,
    )?.title;
  const selectedVideoSnapshot =
    workspace && workspaceTarget && selectedVideoTitle
      ? {
          youtubeVideoId: workspace.youtubeVideoId,
          canonicalUrl: workspaceTarget.canonicalUrl,
          title: selectedVideoTitle,
          sourceLanguage: workspace.original.track.language,
        }
      : undefined;
  const selectedEvidence = transcriptEvidenceSelection(selection);
  const selectionExportBlockReason = !selection
    ? "Select a transcript passage or complete a player range."
    : selection.selectionType !== "player_time_range"
      ? undefined
      : selection.speechStatus === "transcript_unavailable"
        ? "Transcript-unavailable player ranges can be logged but cannot be exported."
        : selection.speechStatus === "speech" && !selection.transcriptAttachment
          ? "Attach verified overlapping transcript evidence before exporting this speech range."
          : selection.speechStatus === "no_speech" && embedEnglishSubtitles
            ? "Attested no-speech exports use explicit empty sidecars and cannot embed subtitles."
            : undefined;
  const sourceRights = useMemo(
    () =>
      selectedVideoSnapshot
        ? ExportSourceRightsSnapshotSchema.parse({
            schemaVersion: 1,
            source: "youtube",
            youtubeVideoId: selectedVideoSnapshot.youtubeVideoId,
            confirmation: "authorized_to_process",
            disclosureVersion: 1,
          })
        : undefined,
    [selectedVideoSnapshot],
  );
  const selectedRendererCapabilityId =
    exportContainer === "mp4" && exportVideoCodec === "h264"
      ? "h264_mp4"
      : exportContainer === "mkv" && exportVideoCodec === "hevc"
        ? "hevc_mkv"
        : exportContainer === "mov" && exportVideoCodec === "prores"
          ? "prores_mov"
          : "unsupported";
  const installedRendererIds =
    exportOnlySettingsPreview?.workerAvailability?.discovery === "installed"
      ? new Set(
          exportOnlySettingsPreview.workerAvailability.availableRendererIds,
        )
      : undefined;
  const selectionForKey = (
    key: string,
    selected: ExportPresetSnapshot | undefined,
  ): ExportSettingsSelection => ({
    base: key === builtInPresetKey ? "application_default" : "context_default",
    ...(selected?.presetId
      ? {
          selectedPreset: {
            scope: key.startsWith("project:")
              ? ("project" as const)
              : ("personal" as const),
            presetId: selected.presetId,
            presetVersion: selected.presetVersion,
          },
        }
      : {}),
    overrides: exportOverrides,
  });
  const loggedSettingsSelection = selectionForKey(
    loggedPresetSelectionKey,
    loggedExportPreset,
  );
  const exportOnlySettingsSelection = selectionForKey(
    exportOnlyPresetSelectionKey,
    exportOnlyExportPreset,
  );
  const activeTranscriptSelection = transcriptEvidenceSelection(selection);
  const selectedTokenIds = useMemo(() => {
    const ids = new Set<string>();
    if (
      !transcript ||
      !activeTranscriptSelection?.firstTokenId ||
      !activeTranscriptSelection.lastTokenId
    ) {
      return ids;
    }
    const firstIndex = transcript.tokens.findIndex(
      (token) => token.id === activeTranscriptSelection.firstTokenId,
    );
    const lastIndex = transcript.tokens.findIndex(
      (token) => token.id === activeTranscriptSelection.lastTokenId,
    );
    if (firstIndex < 0 || lastIndex < 0) return ids;
    for (
      let index = Math.min(firstIndex, lastIndex);
      index <= Math.max(firstIndex, lastIndex);
      index += 1
    ) {
      ids.add(transcript.tokens[index]!.id);
    }
    return ids;
  }, [activeTranscriptSelection, transcript]);

  useEffect(() => {
    const restoredIndex = pendingMatchIndexRestore.current;
    pendingMatchIndexRestore.current = undefined;
    setMatchIndex(restoredIndex ?? 0);
  }, [query, videoId, transcript?.track.id]);

  useEffect(() => {
    setSourceRightsConfirmed(false);
  }, [
    projectId,
    selection?.exportEndMs,
    selection?.exportStartMs,
    activeTranscriptSelection?.firstSegmentId,
    activeTranscriptSelection?.lastSegmentId,
    selectedVideoSnapshot?.youtubeVideoId,
  ]);

  useEffect(() => {
    if (!authorization) {
      setUser(undefined);
      setProfileState("idle");
      setPreferredLanguageDraft("en");
      return;
    }
    setUser(undefined);
    setProfileState("loading");
    const controller = new AbortController();
    void apiFetch(
      "cloud",
      "/api/session/profile",
      { signal: controller.signal },
      authorization,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          if (
            response.status === 404 &&
            parsed.success &&
            parsed.data.error.code === "not_found"
          ) {
            return { state: "registration_required" as const };
          }
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Unable to load account settings.",
          );
        }
        return { state: "ready" as const, profile: UserSchema.parse(payload) };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.state === "registration_required") {
          setProfileState("registration_required");
          setPreferenceMessage(
            "Create your account profile to start using shared projects.",
          );
          return;
        }
        const profile = result.profile;
        setUser(profile);
        setProfileState("ready");
        setPreferredLanguageDraft(profile.preferredLanguage);
        setPreferenceMessage(
          `Preferred transcript language: ${profile.preferredLanguage}.`,
        );
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setUser(undefined);
        setProfileState("error");
        setPreferenceMessage(
          caught instanceof Error
            ? caught.message
            : "Unable to load account settings.",
        );
      });
    return () => controller.abort();
  }, [authorization]);

  useEffect(() => {
    if (!desktopBridge() || !authorization || profileState !== "ready" || !user)
      return;
    const controller = new AbortController();
    setProjectsLoaded(false);
    void apiFetch(
      "cloud",
      "/api/projects",
      { signal: controller.signal },
      authorization,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Unable to load projects.",
          );
        }
        return ProjectSummarySchema.array().parse(payload);
      })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setProjects(loaded);
        setProjectsLoaded(true);
        setProjectMessage(
          loaded.length
            ? undefined
            : "Your account is ready. Create your first project to begin.",
        );
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setProjects([]);
        setProjectsLoaded(true);
        setProjectMessage(
          caught instanceof Error ? caught.message : "Unable to load projects.",
        );
      });
    return () => controller.abort();
  }, [authorization, profileState, user?.id]);

  useEffect(() => {
    if (!user || !projects.length) return;
    const key = `vera:recent-project:${user.id}`;
    const validationIdentity = `${user.id}:${projects
      .map((project) => project.id)
      .sort()
      .join(",")}`;
    if (recentProjectValidation.current === validationIdentity) return;
    recentProjectValidation.current = validationIdentity;
    let recentProjectId: string | null = null;
    try {
      recentProjectId = localStorage.getItem(key);
    } catch {
      // Private recency is optional when install storage is unavailable.
    }
    if (
      recentProjectId &&
      projects.some((project) => project.id === recentProjectId)
    ) {
      selectProject(recentProjectId);
      setRecentProjectReadyIdentity(validationIdentity);
      return;
    }
    if (recentProjectId) {
      try {
        localStorage.removeItem(key);
      } catch {
        // The invalid identity is still ignored in memory.
      }
      selectProject("");
      setRecentProjectReadyIdentity(validationIdentity);
      return;
    }
    if (!projects.some((project) => project.id === projectId))
      selectProject(projects[0]!.id);
    setRecentProjectReadyIdentity(validationIdentity);
  }, [projectId, projects, user]);

  useEffect(() => {
    if (!user || !projectId) return;
    if (!projects.some((project) => project.id === projectId)) return;
    const validationIdentity = `${user.id}:${projects
      .map((project) => project.id)
      .sort()
      .join(",")}`;
    if (recentProjectReadyIdentity !== validationIdentity) return;
    try {
      localStorage.setItem(`vera:recent-project:${user.id}`, projectId);
    } catch {
      // Private recency is optional when install storage is unavailable.
    }
  }, [projectId, projects, recentProjectReadyIdentity, user]);

  useEffect(() => {
    if (!authorization || !projectId) {
      setProjectVideos(undefined);
      return;
    }
    const controller = new AbortController();
    setProjectVideos(undefined);
    void apiFetch(
      "cloud",
      `/api/projects/${projectId}/videos`,
      { signal: controller.signal },
      authorization,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Unable to load this project’s videos.",
          );
        }
        return VideoSchema.array().parse(payload);
      })
      .then((videos) => {
        if (!controller.signal.aborted) setProjectVideos(videos);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProjectVideos([]);
      });
    return () => controller.abort();
  }, [authorization, projectId]);

  useEffect(() => {
    if (!user || !projectId || !projectVideos) return;
    const identity = `${user.id}:${projectId}:${projectVideos
      .map((video) => `${video.id}:${video.youtubeVideoId}`)
      .sort()
      .join(",")}`;
    if (hydratedNavigationIdentity.current === identity) return;
    hydratedNavigationIdentity.current = identity;
    let stored: unknown;
    let hadStoredValue = false;
    try {
      const raw = localStorage.getItem(
        navigationStorageKey(user.id, projectId),
      );
      hadStoredValue = raw !== null;
      stored = raw ? JSON.parse(raw) : undefined;
    } catch {
      stored = undefined;
      hadStoredValue = true;
    }
    if (!stored || typeof stored !== "object") {
      if (hadStoredValue) {
        try {
          localStorage.removeItem(navigationStorageKey(user.id, projectId));
        } catch {
          // Invalid private navigation remains ignored in memory.
        }
      }
      return;
    }
    const record = stored as { current?: unknown; backStack?: unknown };
    const isAuthorizedVideo = (snapshot: NavigationSnapshot) =>
      snapshot.projectId === projectId &&
      projectVideos.some(
        (video) =>
          video.id === snapshot.catalogVideoId &&
          video.youtubeVideoId === snapshot.youtubeVideoId &&
          video.canonicalUrl === snapshot.canonicalUrl,
      );
    const restoredBackStack = Array.isArray(record.backStack)
      ? record.backStack
          .map(parseNavigationSnapshot)
          .filter((snapshot): snapshot is NavigationSnapshot =>
            Boolean(snapshot && isAuthorizedVideo(snapshot)),
          )
          .slice(-navigationHistoryLimit)
      : [];
    const restoredCurrent = parseNavigationSnapshot(record.current);
    const authorizedCurrent =
      restoredCurrent && isAuthorizedVideo(restoredCurrent)
        ? restoredCurrent
        : undefined;
    setNavigationBackStack(restoredBackStack);
    try {
      if (authorizedCurrent || restoredBackStack.length) {
        localStorage.setItem(
          navigationStorageKey(user.id, projectId),
          JSON.stringify({
            schemaVersion: 1,
            ...(authorizedCurrent ? { current: authorizedCurrent } : {}),
            backStack: restoredBackStack,
          }),
        );
      } else {
        localStorage.removeItem(navigationStorageKey(user.id, projectId));
      }
    } catch {
      // Sanitization is best effort; unauthorized state remains ignored.
    }
    if (!workspaceTarget && authorizedCurrent) {
      restoreNavigationSnapshot(authorizedCurrent);
      return;
    }
  }, [projectId, projectVideos, user, workspaceTarget]);

  useEffect(() => {
    if (!user || !workspace || !workspaceTarget) return;
    const timer = window.setTimeout(() => {
      const navigationSelection = directNavigationSelection(selection);
      const current: NavigationSnapshot = {
        schemaVersion: 1,
        projectId: workspaceTarget.projectId,
        catalogVideoId: workspaceTarget.catalogVideoId,
        youtubeVideoId: workspaceTarget.youtubeVideoId,
        canonicalUrl: workspaceTarget.canonicalUrl,
        ...(workspaceTarget.title ? { title: workspaceTarget.title } : {}),
        transcriptVersionId: workspace.transcriptVersionId,
        currentMs,
        transcriptView,
        query,
        matchIndex,
        ...(navigationSelection ? { selection: navigationSelection } : {}),
      };
      try {
        localStorage.setItem(
          navigationStorageKey(user.id, workspaceTarget.projectId),
          JSON.stringify({
            schemaVersion: 1,
            current,
            backStack: navigationBackStack.slice(-navigationHistoryLimit),
          }),
        );
      } catch {
        // Navigation persistence is optional private install state.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    currentMs,
    matchIndex,
    navigationBackStack,
    query,
    selection,
    transcriptView,
    user,
    workspace,
    workspaceTarget,
  ]);

  useEffect(() => {
    const target = workspaceTarget;
    const generation = ++workspaceGeneration.current;
    if (!authorization || !target || target.projectId !== projectId) {
      setWorkspace(undefined);
      setWorkspaceLoadState("idle");
      return;
    }
    const controller = new AbortController();
    const preferredLanguage = user?.preferredLanguage ?? "en";
    setWorkspace(undefined);
    setWorkspaceLoadState("loading");
    setWorkspaceMessage("Resolving the project’s verified transcript…");
    const parameters = new URLSearchParams({ preferredLanguage });
    void apiFetch(
      "local",
      `/api/projects/${target.projectId}/videos/${target.catalogVideoId}/transcript?${parameters}`,
      { signal: controller.signal },
      authorization,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "The verified transcript is unavailable right now.",
          );
        }
        const parsed = TranscriptWorkspaceResponseSchema.parse(payload);
        if (
          parsed.projectId !== target.projectId ||
          parsed.catalogVideoId !== target.catalogVideoId ||
          parsed.youtubeVideoId !== target.youtubeVideoId
        ) {
          throw new Error(
            "The returned transcript does not belong to the selected project video.",
          );
        }
        return parsed;
      })
      .then((resolved) => {
        if (
          controller.signal.aborted ||
          generation !== workspaceGeneration.current
        )
          return;
        setWorkspace(resolved);
        setWorkspaceRetry(undefined);
        setTranscriptView(
          resolved.preferred.state === "ready" ? "preferred" : "english",
        );
        setWorkspaceLoadState("idle");
        setWorkspaceMessage(
          resolved.catalogState === "offline_cached"
            ? "Reviewing the exact verified cached transcript. Reconnect before creating project work or checking for a newer active version."
            : resolved.source === "verified-local-cache"
              ? "Loaded the exact verified local transcript cache."
              : "Downloaded and verified the project transcript.",
        );
      })
      .catch((caught: unknown) => {
        if (
          controller.signal.aborted ||
          generation !== workspaceGeneration.current
        )
          return;
        const message =
          caught instanceof Error
            ? caught.message
            : "The verified transcript is unavailable right now.";
        setWorkspace(undefined);
        setWorkspaceLoadState(
          /no active transcript|not found|unavailable/i.test(message)
            ? "unavailable"
            : "failed",
        );
        setWorkspaceMessage(message);
      });
    return () => controller.abort();
  }, [
    authorization,
    projectId,
    user?.preferredLanguage,
    workspaceReload,
    workspaceTarget,
  ]);

  async function retryWorkspaceTranscript() {
    const target = workspaceTarget;
    if (!authorization || !target || target.projectId !== projectId) return;
    setWorkspaceLoadState("loading");
    setWorkspaceMessage("Looking for this video's failed transcript job…");
    try {
      const listedResponse = await apiFetch(
        "cloud",
        `/api/projects/${target.projectId}/transcription-batches`,
        {},
        authorization,
      );
      const listedPayload = await listedResponse.json().catch(() => undefined);
      if (!listedResponse.ok) {
        const parsed = ApiErrorSchema.safeParse(listedPayload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to inspect failed transcription work.",
        );
      }
      const retryableSummaries = TranscriptionBatchListResponseSchema.parse(
        listedPayload,
      ).batches.filter((entry) => entry.progress.retryableFailed > 0);
      let retryable:
        ReturnType<typeof findRetryableTranscriptionItem> | undefined;
      for (const summary of retryableSummaries) {
        const detailResponse = await apiFetch(
          "cloud",
          `/api/projects/${target.projectId}/transcription-batches/${summary.batch.id}`,
          {},
          authorization,
        );
        const detailPayload = await detailResponse
          .json()
          .catch(() => undefined);
        if (!detailResponse.ok) {
          const parsed = ApiErrorSchema.safeParse(detailPayload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Unable to inspect a failed transcription batch.",
          );
        }
        const detail =
          CreateTranscriptionBatchResponseSchema.parse(detailPayload);
        retryable = findRetryableTranscriptionItem(
          [detail],
          target.catalogVideoId,
          target.youtubeVideoId,
        );
        if (retryable) break;
      }
      if (!retryable) {
        setWorkspaceReload((value) => value + 1);
        throw new Error(
          "No retryable failed job exists for this exact video. Open Project Videos to inspect its current processing state.",
        );
      }
      const retryResponse = await apiFetch(
        "cloud",
        `/api/projects/${target.projectId}/transcription-batches/${retryable.batchId}/items/${retryable.itemId}/retry`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `workspace-transcript-retry:${target.projectId}:${retryable.itemId}:v${retryable.itemVersion}`,
            expectedVersion: retryable.itemVersion,
          }),
        },
        authorization,
      );
      const retryPayload = await retryResponse.json().catch(() => undefined);
      if (!retryResponse.ok) {
        const parsed = ApiErrorSchema.safeParse(retryPayload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to retry this video's transcription job.",
        );
      }
      RetryTranscriptionBatchItemResponseSchema.parse(retryPayload);
      setWorkspaceRetry({
        batchId: retryable.batchId,
        itemId: retryable.itemId,
      });
      setWorkspaceLoadState("unavailable");
      setWorkspaceMessage(
        "Retry queued. Checking the YouTube transcript before Whisper…",
      );
    } catch (caught: unknown) {
      setWorkspaceRetry(undefined);
      setWorkspaceLoadState("failed");
      setWorkspaceMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to retry this video's transcript.",
      );
    }
  }

  useEffect(() => {
    const pending = workspaceRetry;
    const target = workspaceTarget;
    if (!pending || !authorization || !target) return;
    const pendingRetry = pending;
    const retryTarget = target;
    let stopped = false;
    let polling = false;
    async function poll() {
      if (polling || stopped) return;
      polling = true;
      try {
        const response = await apiFetch(
          "cloud",
          `/api/projects/${retryTarget.projectId}/transcription-batches/${pendingRetry.batchId}`,
          {},
          authorization,
        );
        const payload = await response.json().catch(() => undefined);
        if (!response.ok)
          throw new Error("Unable to refresh transcript retry.");
        const detail = CreateTranscriptionBatchResponseSchema.parse(payload);
        const item = detail.items.find(
          (candidate) => candidate.id === pendingRetry.itemId,
        );
        if (!item)
          throw new Error("The retried transcription item is missing.");
        if (item.state === "ready_for_review") {
          setWorkspaceMessage("Transcript published. Loading it now…");
          setWorkspaceReload((value) => value + 1);
        } else if (item.state === "failed") {
          setWorkspaceRetry(undefined);
          setWorkspaceLoadState("failed");
          setWorkspaceMessage(
            item.error?.message ?? "The transcript retry failed.",
          );
        } else if (
          ["blocked", "needs_language_confirmation", "canceled"].includes(
            item.state,
          )
        ) {
          setWorkspaceRetry(undefined);
          setWorkspaceLoadState("unavailable");
          setWorkspaceMessage(
            item.state === "needs_language_confirmation"
              ? "Confirm the spoken language in Project Videos to continue."
              : item.state === "blocked"
                ? "Transcript processing needs attention in Project Videos."
                : "The transcript retry was canceled.",
          );
        } else {
          setWorkspaceLoadState("unavailable");
          setWorkspaceMessage(
            item.sourcePlan?.strategy === "caption"
              ? "Downloading and verifying the YouTube transcript…"
              : "Checking the YouTube transcript before Whisper…",
          );
        }
      } catch (caught: unknown) {
        if (!stopped) {
          setWorkspaceMessage(
            caught instanceof Error
              ? caught.message
              : "Unable to refresh transcript retry.",
          );
        }
      } finally {
        polling = false;
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [authorization, workspaceRetry, workspaceTarget]);

  useEffect(() => {
    const intent = workspaceTarget?.keywordEvidence;
    if (!workspace || !workspaceTarget || !intent) return;
    const intentKey = [
      workspaceTarget.projectId,
      workspaceTarget.catalogVideoId,
      intent.trackId,
      intent.seekMs,
      intent.aliasPhrase,
    ].join(":");
    if (handledKeywordEvidence.current === intentKey) return;
    const preferredTrack =
      workspace.preferred.state === "ready"
        ? workspace.preferred.transcript.track
        : undefined;
    if (workspace.original.track.id === intent.trackId) {
      setTranscriptView("original");
    } else if (workspace.english.track.id === intent.trackId) {
      setTranscriptView("english");
    } else if (preferredTrack?.id === intent.trackId) {
      setTranscriptView("preferred");
    } else {
      setWorkspaceMessage(
        "The matched evidence track is not available in this exact hydrated transcript version.",
      );
      handledKeywordEvidence.current = intentKey;
      return;
    }
    setQuery(intent.aliasPhrase);
    setMatchIndex(0);
    seekTo(intent.seekMs, intent.timingPrecision === "word" ? "word" : "cue");
    setWorkspaceMessage(
      `Opened verified keyword evidence at ${Math.round(intent.seekMs / 1_000)}s with ${intent.timingPrecision} timing.`,
    );
    handledKeywordEvidence.current = intentKey;
  }, [workspace, workspaceTarget]);

  useEffect(() => {
    if (!workspace || !workspaceTarget?.bookmarkSource) return;
    seekTo(workspaceTarget.bookmarkSource.sourceTimeMs, "cue");
  }, [workspace, workspaceTarget]);

  useEffect(() => {
    if (!workspace || !workspaceTarget) return;
    const restore = pendingNavigationRestore.current;
    if (restore) {
      pendingNavigationRestore.current = undefined;
      const restoredTranscript = transcriptForView(
        workspace,
        restore.transcriptView,
      );
      const transcriptVersionMatches =
        restore.transcriptVersionId === workspace.transcriptVersionId;
      const restoredSelection = transcriptVersionMatches
        ? exactRestorableSelection(restore.selection, restoredTranscript)
        : undefined;
      setTranscriptView(
        restoredTranscript ? restore.transcriptView : "english",
      );
      setQuery(restore.query);
      const restoredMatches = searchTranscriptOccurrences(
        restoredTranscript,
        restore.query,
      );
      const restoredMatchIndex = Math.min(
        restore.matchIndex,
        Math.max(0, restoredMatches.length - 1),
      );
      pendingMatchIndexRestore.current = restoredMatchIndex;
      setMatchIndex(restoredMatchIndex);
      setSelection(restoredSelection);
      seekTo(restore.currentMs, "cue");
      setWorkspaceMessage(
        !transcriptVersionMatches
          ? "Restored the authorized source, playhead, view, and search, but discarded its selection because the active transcript version changed."
          : restoredSelection || !restore.selection
            ? "Restored private source navigation after exact authorization and transcript validation."
            : "Restored the source navigation, but discarded a stale transcript selection.",
      );
      return;
    }

    const clipSource = workspaceTarget.clipSource;
    if (!clipSource) return;
    const tracks: Array<{
      view: "preferred" | "english" | "original";
      transcript: NormalizedTranscript | undefined;
    }> = [
      { view: "original", transcript: workspace.original },
      { view: "english", transcript: workspace.english },
      {
        view: "preferred",
        transcript:
          workspace.preferred.state === "ready"
            ? workspace.preferred.transcript
            : undefined,
      },
    ];
    const clipTranscriptSelection = transcriptEvidenceSelection(
      clipSource.selection,
    );
    const exactTrack = tracks.find(({ transcript }) =>
      Boolean(
        transcript &&
        clipTranscriptSelection &&
        transcript.track.id === clipTranscriptSelection.trackId &&
        transcript.track.version === clipTranscriptSelection.transcriptVersion,
      ),
    );
    const restoredSelection = exactRestorableSelection(
      clipTranscriptSelection,
      exactTrack?.transcript,
    );
    if (exactTrack) setTranscriptView(exactTrack.view);
    if (clipSource.selection.selectionType === "player_time_range") {
      setPlayerRangeStartMs(clipSource.selection.sourceStartMs);
      setPlayerRangeEndMs(clipSource.selection.sourceEndMs);
      setPlayerSpeechStatus(clipSource.selection.speechStatus);
      setPlayerNoSpeechAttestation(clipSource.selection.noSpeechAttestation);
      setSelection(
        restoredSelection
          ? PlayerTimeRangeSelectionSchema.parse({
              ...clipSource.selection,
              transcriptAttachment: restoredSelection,
            })
          : clipSource.selection,
      );
    } else {
      setSelection(restoredSelection);
    }
    setClipLoopRange({
      startMs: clipSource.selection.exportStartMs,
      endMs: clipSource.selection.exportEndMs,
    });
    seekTo(
      clipSource.sourceTimeMs ?? clipSource.selection.exportStartMs,
      "cue",
    );
    playerRef.current?.play();
    setWorkspaceMessage(
      `${clipSource.fallbackNotice ? `${clipSource.fallbackNotice} ` : ""}${
        clipSource.selection.selectionType === "player_time_range"
          ? `Opened the authorized player range (${playerSpeechLabel(clipSource.selection.speechStatus)}) and enabled looping.${restoredSelection ? " Its exact transcript attachment is highlighted." : " No transcript selection was fabricated."}`
          : restoredSelection
            ? "Opened the authorized source at the exact logged clip range and enabled looping."
            : "Opened the authorized source range and enabled looping; exact transcript selection is unavailable in the active version."
      }`,
    );
  }, [workspace, workspaceTarget]);

  useEffect(() => {
    if (workspaceTarget && workspaceTarget.projectId !== projectId) {
      clearWorkspaceInteraction();
      setWorkspaceTarget(undefined);
    }
  }, [projectId, workspaceTarget]);

  useEffect(() => {
    if (authorization) return;
    clearWorkspaceInteraction();
    setWorkspaceTarget(undefined);
  }, [authorization]);

  useEffect(() => {
    if (!authorization) {
      setPersonalPresets([]);
      setPersonalPresetDefault(undefined);
      setProjectPresets([]);
      setProjectPresetDefault(undefined);
      setLoggedPresetKey(builtInPresetKey);
      setExportOnlyPresetKey(builtInPresetKey);
      setPresetDiscoveryMessage(
        "Connect a session to discover saved presets. Editing MP4 remains available.",
      );
      return;
    }
    setExportOnlySettingsState("loading");
    void apiFetch("cloud", "/api/export-presets", {}, authorization)
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Unable to discover personal presets.",
          );
        }
        return PersonalExportPresetCatalogSchema.parse(payload);
      })
      .then((catalog) => {
        setPersonalPresets(catalog.presets);
        setPersonalPresetDefault(catalog.default);
        const validKeys = new Set(
          catalog.presets.map((entry) =>
            catalogPresetKey("personal", catalogEntrySnapshot(entry)),
          ),
        );
        if (catalog.default) {
          validKeys.add(catalogPresetKey("personal", catalog.default.snapshot));
        }
        setExportOnlyPresetKey((current) => {
          if (current !== builtInPresetKey && validKeys.has(current))
            return current;
          return catalog.default
            ? catalogPresetKey("personal", catalog.default.snapshot)
            : builtInPresetKey;
        });
        setPresetDiscoveryMessage(
          catalog.presets.length
            ? "Saved personal presets loaded."
            : "No saved personal presets. Editing MP4 is available.",
        );
      })
      .catch((caught: unknown) => {
        setPresetDiscoveryMessage(
          `${caught instanceof Error ? caught.message : "Unable to discover personal presets."} Continue with the current valid selection or Editing MP4.`,
        );
      });
  }, [authorization]);

  useEffect(() => {
    setProjectPresets([]);
    setProjectPresetDefault(undefined);
    setLoggedPresetKey((current) =>
      current.startsWith("project:") ? builtInPresetKey : current,
    );
    if (!authorization || !projectId) return;
    setLoggedSettingsState("loading");
    void apiFetch(
      "cloud",
      `/api/projects/${projectId}/export-presets`,
      {},
      authorization,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Unable to discover project presets.",
          );
        }
        return ProjectExportPresetCatalogSchema.parse(payload);
      })
      .then((catalog) => {
        setProjectPresets(catalog.projectPresets);
        setProjectPresetDefault(catalog.projectDefault);
        setPersonalPresets(catalog.personalPresets);
        setPersonalPresetDefault(catalog.personalDefault);
        const personalKeys = new Set(
          catalog.personalPresets.map((entry) =>
            catalogPresetKey("personal", catalogEntrySnapshot(entry)),
          ),
        );
        if (catalog.personalDefault) {
          personalKeys.add(
            catalogPresetKey("personal", catalog.personalDefault.snapshot),
          );
        }
        setLoggedPresetKey((current) => {
          if (current.startsWith("personal:") && personalKeys.has(current)) {
            return current;
          }
          return catalog.projectDefault
            ? catalogPresetKey("project", catalog.projectDefault.snapshot)
            : builtInPresetKey;
        });
        setPresetDiscoveryMessage(
          catalog.projectPresets.length || catalog.personalPresets.length
            ? "Saved project and personal presets loaded."
            : "No saved presets for this context. Editing MP4 is available.",
        );
      })
      .catch((caught: unknown) => {
        setPresetDiscoveryMessage(
          `${caught instanceof Error ? caught.message : "Unable to discover project presets."} Continue with the current valid personal selection or Editing MP4.`,
        );
      });
  }, [authorization, projectId]);

  useEffect(() => {
    if (!authorization || !transcriptTracks) {
      setLoggedSettingsPreview(undefined);
      setExportOnlySettingsPreview(undefined);
      setLoggedSettingsState("missing");
      setExportOnlySettingsState("missing");
      return;
    }
    const controller = new AbortController();
    const resolvePreview = async (
      target: "cloud" | "local",
      path: string,
      selection: ExportSettingsSelection,
      setPreview: (preview: ExportSettingsPreview | undefined) => void,
      setState: (state: string) => void,
    ) => {
      setState("resolving");
      setPreview(undefined);
      try {
        const response = await apiFetch(
          target,
          path,
          {
            method: "POST",
            body: JSON.stringify({ sourceLanguageClass, selection }),
            signal: controller.signal,
          },
          authorization,
        );
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(payload);
          throw new Error(
            parsed.success
              ? parsed.data.error.message
              : "Settings preview unavailable.",
          );
        }
        const preview = ExportSettingsPreviewSchema.parse(payload);
        setPreview(preview);
        setState(
          preview.issues.some(
            (issue) => issue.code === "capability_profile_unavailable",
          )
            ? "capability-unavailable"
            : preview.issues.length
              ? "unsupported"
              : "ready",
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setState(
          caught instanceof Error && /missing|not found/i.test(caught.message)
            ? "missing"
            : "stale",
        );
      }
    };
    if (projectId) {
      void resolvePreview(
        "cloud",
        `/api/projects/${projectId}/export-settings/preview`,
        loggedSettingsSelection,
        setLoggedSettingsPreview,
        setLoggedSettingsState,
      );
    } else {
      setLoggedSettingsPreview(undefined);
      setLoggedSettingsState("missing");
    }
    void resolvePreview(
      "local",
      "/api/export-settings/preview",
      exportOnlySettingsSelection,
      setExportOnlySettingsPreview,
      setExportOnlySettingsState,
    );
    return () => controller.abort();
  }, [
    authorization,
    projectId,
    loggedPresetSelectionKey,
    exportOnlyPresetSelectionKey,
    JSON.stringify(exportOverrides),
    sourceLanguageClass,
    transcriptTracks,
  ]);

  const previousTranscriptTrackId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousTranscriptTrackId.current;
    previousTranscriptTrackId.current = transcript?.track.id;
    if (
      !selection ||
      selection.selectionType === "player_time_range" ||
      !transcript ||
      !previous ||
      previous === transcript.track.id
    )
      return;
    try {
      setSelection(mapSelectionToTranscript(selection, transcript));
      setSelectionError(undefined);
      setSelectionCommandId(crypto.randomUUID());
      setLoggedClipId(undefined);
      setLoggedExportRequestId(undefined);
    } catch (caught) {
      setSelection(undefined);
      setSelectionError(
        caught instanceof Error
          ? caught.message
          : "Reselect this passage in the new language view.",
      );
    }
  }, [selection, transcript]);

  useEffect(() => {
    if (
      !previewingSelection ||
      !selection ||
      currentMs < selection.exportEndMs
    ) {
      return;
    }
    playerRef.current?.seekTo(selection.exportStartMs);
    playerRef.current?.play();
  }, [currentMs, previewingSelection, selection]);

  function loadVideo() {
    void loadVideoUrl(url);
  }

  async function savePreferredLanguage() {
    if (!authorization) return;
    try {
      const response = await apiFetch(
        "cloud",
        "/api/session/profile",
        {
          method: "PATCH",
          body: JSON.stringify({ preferredLanguage: preferredLanguageDraft }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to save preferred language.",
        );
      }
      const profile = UserSchema.parse(payload);
      setUser(profile);
      setPreferredLanguageDraft(profile.preferredLanguage);
      setTranscriptView("preferred");
      setSelection(undefined);
      setSelectionCommandId(crypto.randomUUID());
      setPreferenceMessage(
        `Saved ${profile.preferredLanguage}. Existing logged clips are unchanged.`,
      );
    } catch (caught) {
      setPreferenceMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to save preferred language.",
      );
    }
  }

  async function registerDesktopProfile(displayName: string) {
    if (!authorization) throw new Error("Sign in before creating a profile.");
    setProfileState("loading");
    try {
      const response = await apiFetch(
        "cloud",
        "/api/session/register",
        {
          method: "POST",
          body: JSON.stringify({ displayName }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to create the account profile.",
        );
      }
      const profile = UserSchema.parse(payload);
      setUser(profile);
      setProfileState("ready");
      setPreferredLanguageDraft(profile.preferredLanguage);
      setPreferenceMessage(
        `Account ready. Preferred transcript language: ${profile.preferredLanguage}.`,
      );
    } catch (caught) {
      setUser(undefined);
      setProfileState("registration_required");
      throw caught;
    }
  }

  async function loadVideoUrl(nextUrl: string) {
    const generation = ++videoLoadGeneration.current;
    setVideoLoadBusy(false);
    setVideoLoadMessage(undefined);
    try {
      const normalized = normalizeYouTubeUrl(nextUrl);
      setUrl(normalized.canonicalUrl);
      if (!authorization || !projectId) {
        setError("Choose a project before loading a project-authorized video.");
        return;
      }
      if (!projectVideos) {
        setError(
          "Checking this project’s videos. Try Load video again shortly.",
        );
        return;
      }
      const projectVideo = projectVideos.find(
        (candidate) =>
          candidate.youtubeVideoId === normalized.videoId ||
          candidate.canonicalUrl === normalized.canonicalUrl,
      );
      if (projectVideo) {
        setVideoLoadMessage(undefined);
        openProjectVideo({
          projectId,
          catalogVideoId: projectVideo.id,
          youtubeVideoId: projectVideo.youtubeVideoId,
          canonicalUrl: projectVideo.canonicalUrl,
          title: projectVideo.title,
        });
        return;
      }
      setVideoLoadBusy(true);
      setError(undefined);
      setVideoLoadMessage(
        "Adding this video to the project and checking its transcript…",
      );
      const targetProjectId = projectId;
      const response = await apiFetch(
        "cloud",
        `/api/projects/${targetProjectId}/videos/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ url: normalized.canonicalUrl }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to add this video to the project.",
        );
      }
      const resolved = VideoSchema.parse(payload);
      if (
        resolved.youtubeVideoId !== normalized.videoId ||
        resolved.canonicalUrl !== normalized.canonicalUrl
      ) {
        throw new Error("The resolved video did not match the requested URL.");
      }
      if (videoLoadGeneration.current !== generation) return;
      setVideoLoadMessage(undefined);
      const nextProjectVideos = [
        ...projectVideos.filter((candidate) => candidate.id !== resolved.id),
        resolved,
      ];
      setProjectVideos(nextProjectVideos);
      openProjectVideo(
        {
          projectId: targetProjectId,
          catalogVideoId: resolved.id,
          youtubeVideoId: resolved.youtubeVideoId,
          canonicalUrl: resolved.canonicalUrl,
          title: resolved.title,
        },
        { authorizedVideos: nextProjectVideos },
      );
    } catch (caught) {
      if (videoLoadGeneration.current !== generation) return;
      setVideoLoadMessage(undefined);
      setError(
        caught instanceof Error ? caught.message : "Unable to load video.",
      );
    } finally {
      if (videoLoadGeneration.current === generation) setVideoLoadBusy(false);
    }
  }

  function currentNavigationSnapshot(): NavigationSnapshot | undefined {
    if (!workspaceTarget || !workspace) return undefined;
    const navigationSelection = directNavigationSelection(selection);
    return {
      schemaVersion: 1,
      projectId: workspaceTarget.projectId,
      catalogVideoId: workspaceTarget.catalogVideoId,
      youtubeVideoId: workspaceTarget.youtubeVideoId,
      canonicalUrl: workspaceTarget.canonicalUrl,
      ...(workspaceTarget.title ? { title: workspaceTarget.title } : {}),
      transcriptVersionId: workspace.transcriptVersionId,
      currentMs,
      transcriptView,
      query,
      matchIndex,
      ...(navigationSelection ? { selection: navigationSelection } : {}),
    };
  }

  function pushNavigationSnapshot(snapshot: NavigationSnapshot) {
    setNavigationBackStack((current) =>
      [
        ...current.filter(
          (entry) =>
            entry.catalogVideoId !== snapshot.catalogVideoId ||
            entry.transcriptVersionId !== snapshot.transcriptVersionId,
        ),
        snapshot,
      ].slice(-navigationHistoryLimit),
    );
  }

  function openProjectVideo(
    target: WorkspaceVideoTarget,
    options: {
      pushCurrent?: boolean;
      restore?: NavigationSnapshot;
      authorizedVideos?: readonly Video[];
    } = {},
  ) {
    const authorizedVideo = (options.authorizedVideos ?? projectVideos)?.some(
      (video) =>
        video.id === target.catalogVideoId &&
        video.youtubeVideoId === target.youtubeVideoId &&
        video.canonicalUrl === target.canonicalUrl,
    );
    if (target.projectId !== projectId || !authorizedVideo) {
      setDestination("workbench");
      setError(
        "This source is no longer an authorized video in the active project. Refresh the project before trying again.",
      );
      return;
    }
    const currentSnapshot = currentNavigationSnapshot();
    const openingDifferentClip =
      target.clipSource?.clipId !== workspaceTarget?.clipSource?.clipId;
    if (
      options.pushCurrent !== false &&
      currentSnapshot &&
      (currentSnapshot.projectId !== target.projectId ||
        currentSnapshot.catalogVideoId !== target.catalogVideoId ||
        openingDifferentClip)
    )
      pushNavigationSnapshot(currentSnapshot);
    pendingNavigationRestore.current = options.restore;
    clearWorkspaceInteraction();
    setProjectId(target.projectId);
    setWorkspaceTarget(target);
    setDestination("workbench");
    setUrl(target.canonicalUrl);
    setError(undefined);
  }

  function restoreNavigationSnapshot(
    snapshot: NavigationSnapshot,
    pushCurrent = false,
  ) {
    const video = projectVideos?.find(
      (candidate) =>
        candidate.id === snapshot.catalogVideoId &&
        candidate.youtubeVideoId === snapshot.youtubeVideoId &&
        candidate.canonicalUrl === snapshot.canonicalUrl,
    );
    if (!video || snapshot.projectId !== projectId) return;
    openProjectVideo(
      {
        projectId: snapshot.projectId,
        catalogVideoId: snapshot.catalogVideoId,
        youtubeVideoId: snapshot.youtubeVideoId,
        canonicalUrl: snapshot.canonicalUrl,
        title: video.title ?? snapshot.title,
      },
      { pushCurrent, restore: snapshot },
    );
  }

  function navigateBack() {
    const snapshot = navigationBackStack.at(-1);
    if (!snapshot) return;
    setNavigationBackStack((current) => current.slice(0, -1));
    restoreNavigationSnapshot(snapshot);
  }

  function selectProject(nextProjectId: string) {
    if (nextProjectId !== projectId) {
      videoLoadGeneration.current += 1;
      setVideoLoadBusy(false);
      setVideoLoadMessage(undefined);
      clearWorkspaceInteraction();
      setWorkspaceTarget(undefined);
      setDestination("videos");
      setUnreadActivityCount(0);
      setNavigationBackStack([]);
      pendingNavigationRestore.current = undefined;
      hydratedNavigationIdentity.current = undefined;
    }
    setProjectId(nextProjectId);
  }

  function signOutFromShell() {
    if (desktopBridge()) {
      void completeDesktopSignOut();
      return;
    }
    clearWorkspaceInteraction();
    setWorkspaceTarget(undefined);
    setAuthorization("");
    setProjects([]);
    setProjectsLoaded(false);
    setProjectId("");
    setDestination("videos");
    setUnreadActivityCount(0);
    setProjectMessage(undefined);
    setNavigationBackStack([]);
    pendingNavigationRestore.current = undefined;
    hydratedNavigationIdentity.current = undefined;
    recentProjectValidation.current = undefined;
    setRecentProjectReadyIdentity(undefined);
  }

  function resetSelectionCommandOutcome(
    options: {
      clearResearchContext?: boolean;
    } = {},
  ) {
    if (options.clearResearchContext) {
      setClipNotes("");
      setClipFirstComment("");
      setClipTags("");
    }
    setSelectionCommandId(crypto.randomUUID());
    setClipActionMessage(undefined);
    setLoggedClipId(undefined);
    setLoggedExportRequestId(undefined);
    setExportOnlyRequestId(undefined);
    setSourceRightsConfirmed(false);
  }

  function setPlayerRangeBound(bound: "in" | "out") {
    if (sourceDurationMs === undefined) {
      setPlayerRangeMessage(
        "Wait for the player to report the exact source duration before setting bounds.",
      );
      playerRef.current?.requestDuration();
      return;
    }
    if (currentMs < 0 || currentMs > sourceDurationMs) {
      setPlayerRangeMessage(
        "The playhead is outside the known source duration.",
      );
      return;
    }
    if (bound === "in") {
      if (currentMs >= sourceDurationMs) {
        setPlayerRangeMessage(
          "The in-point must be before the end of the source.",
        );
        return;
      }
      playerRef.current?.pause();
      setPreviewingSelection(false);
      setClipLoopRange(undefined);
      setSelection(undefined);
      setSelectionError(undefined);
      setPlayerRangeStartMs(currentMs);
      setPlayerRangeEndMs(undefined);
      setPlayerSpeechStatus(undefined);
      setPlayerNoSpeechAttestation(undefined);
      setPlayerRangeMessage(
        `Set in at ${(currentMs / 1_000).toFixed(3)}s. Move to a later playhead and set out.`,
      );
      resetSelectionCommandOutcome({ clearResearchContext: true });
      return;
    }
    if (playerRangeStartMs === undefined) {
      setPlayerRangeMessage("Set an in-point before setting the out-point.");
      return;
    }
    if (currentMs <= playerRangeStartMs) {
      setPlayerRangeMessage(
        "The out-point must be strictly after the in-point.",
      );
      return;
    }
    setPlayerRangeEndMs(currentMs);
    setPlayerSpeechStatus(undefined);
    setPlayerNoSpeechAttestation(undefined);
    setSelection(undefined);
    setSelectionError(undefined);
    setPlayerRangeMessage(
      `Set out at ${(currentMs / 1_000).toFixed(3)}s. Choose the required speech status.`,
    );
    resetSelectionCommandOutcome();
  }

  function changePlayerSpeechStatus(
    status: "speech" | "no_speech" | "transcript_unavailable",
  ) {
    if (playerRangeStartMs === undefined || playerRangeEndMs === undefined)
      return;
    let attestation = playerNoSpeechAttestation;
    if (status === "no_speech" && !attestation) {
      if (!user) {
        setPlayerRangeMessage(
          "Sign in and load the current account before attesting that this range has no speech.",
        );
        return;
      }
      attestation = {
        schemaVersion: 1,
        actor: {
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
        },
        attestedAt: new Date().toISOString(),
      };
      setPlayerNoSpeechAttestation(attestation);
    }
    try {
      const nextSelection = PlayerTimeRangeSelectionSchema.parse({
        selectionType: "player_time_range",
        sourceStartMs: playerRangeStartMs,
        sourceEndMs: playerRangeEndMs,
        exportStartMs: playerRangeStartMs,
        exportEndMs: playerRangeEndMs,
        origin: "manual_player",
        speechStatus: status,
        ...(status === "no_speech" ? { noSpeechAttestation: attestation } : {}),
      });
      setPlayerSpeechStatus(status);
      setSelection(nextSelection);
      setSelectionError(undefined);
      setPlayerRangeMessage(
        `${playerSpeechLabel(status)} recorded. ${status === "speech" ? "Attach overlapping transcript evidence before export, or log the range without it." : status === "no_speech" ? "The current actor and UTC time are now immutable for this selection command." : "This range can be logged with context but cannot be exported."}`,
      );
      resetSelectionCommandOutcome();
    } catch (caught) {
      setPlayerRangeMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to record this player range.",
      );
    }
  }

  function attachOverlappingTranscript() {
    if (
      !selection ||
      selection.selectionType !== "player_time_range" ||
      selection.speechStatus !== "speech" ||
      !transcript
    )
      return;
    try {
      const attachment = derivePlayerRangeTranscriptAttachment({
        transcript,
        sourceStartMs: selection.sourceStartMs,
        sourceEndMs: selection.sourceEndMs,
        exportStartMs: selection.exportStartMs,
        exportEndMs: selection.exportEndMs,
      });
      if (!attachment) {
        setPlayerRangeMessage(
          "No verified transcript overlaps this exact player range in the current language view. Adjust the range or switch transcript views; speech status was not changed.",
        );
        return;
      }
      setSelection(
        PlayerTimeRangeSelectionSchema.parse({
          ...selection,
          transcriptAttachment: attachment,
        }),
      );
      setPlayerRangeMessage(
        `Attached verified ${transcript.track.language} transcript evidence with ${attachment.timingPrecision} precision. The selection remains player-originated.`,
      );
      setSelectionError(undefined);
      resetSelectionCommandOutcome();
    } catch (caught) {
      setPlayerRangeMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to attach overlapping transcript evidence.",
      );
    }
  }

  function clearPlayerRange() {
    playerRef.current?.pause();
    setPreviewingSelection(false);
    if (selection?.selectionType === "player_time_range")
      setSelection(undefined);
    setPlayerRangeStartMs(undefined);
    setPlayerRangeEndMs(undefined);
    setPlayerSpeechStatus(undefined);
    setPlayerNoSpeechAttestation(undefined);
    setPlayerRangeMessage(undefined);
    setSelectionError(undefined);
    resetSelectionCommandOutcome({ clearResearchContext: true });
  }

  function changeExportBound(bound: "start" | "end", secondsText: string) {
    if (!selection || secondsText.trim() === "") return;
    const milliseconds = Math.round(Number(secondsText) * 1_000);
    try {
      const bounds = {
        startMs: bound === "start" ? milliseconds : selection.exportStartMs,
        endMs: bound === "end" ? milliseconds : selection.exportEndMs,
      };
      setSelection(
        selection.selectionType === "player_time_range"
          ? PlayerTimeRangeSelectionSchema.parse({
              ...selection,
              exportStartMs: bounds.startMs,
              exportEndMs: bounds.endMs,
              ...(selection.transcriptAttachment
                ? {
                    transcriptAttachment: updateTranscriptSelectionExportBounds(
                      selection.transcriptAttachment,
                      bounds,
                    ),
                  }
                : {}),
            })
          : updateTranscriptSelectionExportBounds(selection, bounds),
      );
      setSelectionError(undefined);
      resetSelectionCommandOutcome();
    } catch (caught) {
      setSelectionError(
        caught instanceof Error ? caught.message : "Invalid export bounds.",
      );
    }
  }

  function addExportHandles() {
    if (!selection) return;
    const bounds = {
      startMs: Math.max(0, selection.exportStartMs - 500),
      endMs: Math.min(
        sourceDurationMs ?? Number.MAX_SAFE_INTEGER,
        selection.exportEndMs + 500,
      ),
    };
    setSelection(
      selection.selectionType === "player_time_range"
        ? PlayerTimeRangeSelectionSchema.parse({
            ...selection,
            exportStartMs: bounds.startMs,
            exportEndMs: bounds.endMs,
            ...(selection.transcriptAttachment
              ? {
                  transcriptAttachment: updateTranscriptSelectionExportBounds(
                    selection.transcriptAttachment,
                    bounds,
                  ),
                }
              : {}),
          })
        : updateTranscriptSelectionExportBounds(selection, bounds),
    );
    setSelectionError(undefined);
    resetSelectionCommandOutcome();
  }

  function toggleSelectionPreview() {
    if (!selection) return;
    if (previewingSelection) {
      playerRef.current?.pause();
      setPreviewingSelection(false);
      return;
    }
    const sought = playerRef.current?.seekTo(selection.exportStartMs) ?? false;
    const played = playerRef.current?.play() ?? false;
    if (!sought || !played) {
      setSelectionError("The video player is not ready for preview yet.");
      return;
    }
    setPreviewingSelection(true);
    setSelectionError(undefined);
  }

  function setExportBoundFromPlayhead(bound: "start" | "end") {
    changeExportBound(bound, String(currentMs / 1_000));
  }

  async function createProjectFromSelection() {
    if (!authorization || !newProjectName.trim()) return;
    setProjectBusy(true);
    try {
      const response = await apiFetch(
        "cloud",
        "/api/projects",
        {
          method: "POST",
          body: JSON.stringify({
            name: newProjectName,
            description: newProjectDescription,
            kind: newProjectKind,
          }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to create project.",
        );
      }
      const project = ProjectSchema.parse(payload);
      const projectSummary = ProjectSummarySchema.parse({
        ...project,
        currentUserRole: "owner",
        memberCount: 1,
      });
      if (user) {
        try {
          localStorage.setItem(`vera:recent-project:${user.id}`, project.id);
        } catch {
          // The explicit in-memory selection remains authoritative this run.
        }
      }
      setProjects((current) => [
        ...current.filter((candidate) => candidate.id !== project.id),
        projectSummary,
      ]);
      selectProject(project.id);
      setNewProjectName("");
      setNewProjectDescription("");
      setNewProjectKind("shared");
      setCreatingProject(false);
      setProjectMessage(`Created and selected “${project.name}”.`);
    } catch (caught) {
      setProjectMessage(
        caught instanceof Error ? caught.message : "Unable to create project.",
      );
    } finally {
      setProjectBusy(false);
    }
  }

  async function queueClipOnly(): Promise<ClipCandidate | undefined> {
    if (
      !authorization ||
      !projectId ||
      !videoId ||
      !selection ||
      !transcriptTracks ||
      !selectedVideoSnapshot ||
      !user ||
      (Boolean(selectedEvidence) && !languageEvidenceReady) ||
      offlineCachedWorkspace
    )
      return undefined;
    const languageEvidence = selectedEvidence
      ? buildClipLanguageEvidence({
          original: transcriptTracks.original,
          english: transcriptTracks.english,
          ...(preferredTranscript ? { preferred: preferredTranscript } : {}),
          startMs: selectedEvidence.transcriptStartMs,
          endMs: selectedEvidence.transcriptEndMs,
        })
      : undefined;
    setClipActionBusy(true);
    try {
      const command = CreateClipCandidateRequestSchema.safeParse({
        idempotencyKey: `queue:${selectionCommandId}`,
        video: selectedVideoSnapshot,
        selection,
        ...(languageEvidence ? { languageEvidence } : {}),
        notes: clipNotes,
        ...(clipFirstComment.trim()
          ? { firstComment: { body: clipFirstComment } }
          : {}),
        tags: clipTags
          .split(/[,\n]/u)
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      if (!command.success) {
        throw new Error(
          command.error.issues[0]?.message ?? "Unable to validate clip.",
        );
      }
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/clips`,
        {
          method: "POST",
          body: JSON.stringify(command.data),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success ? parsed.data.error.message : "Unable to log clip.",
        );
      }
      const clip = ClipCandidateSchema.parse(payload);
      setLoggedClipId(clip.id);
      setClipActionMessage(
        `Logged to ${projects.find((project) => project.id === projectId)?.name ?? "the selected project"}. No export was requested.`,
      );
      return clip;
    } catch (caught) {
      setClipActionMessage(
        caught instanceof Error ? caught.message : "Unable to log clip.",
      );
      return undefined;
    } finally {
      setClipActionBusy(false);
    }
  }

  async function requestLoggedExport() {
    if (
      !authorization ||
      !projectId ||
      !selection ||
      !transcriptTracks ||
      selectionExportBlockReason ||
      offlineCachedWorkspace ||
      !sourceRightsConfirmed ||
      !sourceRights ||
      loggedSettingsState !== "ready" ||
      !loggedSettingsPreview?.snapshot.resolutionFingerprint
    )
      return;
    const clipId =
      loggedClipId ?? (await queueClipOnly().then((clip) => clip?.id));
    if (!clipId) return;
    setClipActionBusy(true);
    try {
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/clips/${clipId}/exports`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `logged-export:${selectionCommandId}`,
            requestOrigin: "selection_action",
            sourceLanguageClass:
              transcriptTracks.original.track.id ===
                transcriptTracks.english.track.id &&
              languagesEquivalent(
                transcriptTracks.original.track.language,
                "en",
              )
                ? "confirmed_english"
                : "foreign",
            ...(selection.selectionType === "player_time_range" &&
            selection.speechStatus === "no_speech"
              ? { noSpeechAttestation: selection.noSpeechAttestation }
              : {
                  subtitleTracks: {
                    original: {
                      trackId: transcriptTracks.original.track.id,
                      trackVersion: transcriptTracks.original.track.version,
                    },
                    english: {
                      trackId: transcriptTracks.english.track.id,
                      trackVersion: transcriptTracks.english.track.version,
                    },
                  },
                }),
            settingsSelection: loggedSettingsSelection,
            expectedResolutionFingerprint:
              loggedSettingsPreview.snapshot.resolutionFingerprint,
            sourceRights,
          }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        if (
          parsed.success &&
          parsed.data.error.code === "export_settings_stale"
        )
          setLoggedSettingsState("stale");
        throw new Error(
          parsed.success
            ? `Clip logged, but export could not be queued: ${parsed.data.error.message}`
            : "Clip logged, but export could not be queued.",
        );
      }
      const exportRequest = ExportRequestSchema.parse(payload);
      setLoggedExportRequestId(exportRequest.id);
      setSourceRightsConfirmed(false);
      setClipActionMessage(
        `Logged to ${projects.find((project) => project.id === projectId)?.name ?? "the selected project"} and queued an export with the ${exportRequest.preset.name} snapshot.`,
      );
    } catch (caught) {
      setClipActionMessage(
        caught instanceof Error
          ? caught.message
          : "Clip logged, but export could not be queued.",
      );
    } finally {
      setClipActionBusy(false);
    }
  }

  async function requestExportOnly() {
    if (
      !videoId ||
      !selection ||
      !transcriptTracks ||
      !selectedVideoSnapshot ||
      selectionExportBlockReason ||
      !sourceRightsConfirmed ||
      !sourceRights ||
      exportOnlySettingsState !== "ready" ||
      !exportOnlySettingsPreview?.snapshot.resolutionFingerprint
    )
      return;
    setClipActionBusy(true);
    try {
      const response = await apiFetch(
        "local",
        "/api/exports",
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `export-only:${selectionCommandId}`,
            video: selectedVideoSnapshot,
            selection,
            sourceLanguageClass:
              transcriptTracks.original.track.id ===
                transcriptTracks.english.track.id &&
              languagesEquivalent(
                transcriptTracks.original.track.language,
                "en",
              )
                ? "confirmed_english"
                : "foreign",
            ...(selection.selectionType === "player_time_range" &&
            selection.speechStatus === "no_speech"
              ? { noSpeechAttestation: selection.noSpeechAttestation }
              : {
                  subtitleTracks: {
                    original: {
                      trackId: transcriptTracks.original.track.id,
                      trackVersion: transcriptTracks.original.track.version,
                    },
                    english: {
                      trackId: transcriptTracks.english.track.id,
                      trackVersion: transcriptTracks.english.track.version,
                    },
                  },
                }),
            settingsSelection: exportOnlySettingsSelection,
            expectedResolutionFingerprint:
              exportOnlySettingsPreview.snapshot.resolutionFingerprint,
            sourceRights,
          }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        if (
          parsed.success &&
          parsed.data.error.code === "export_settings_stale"
        )
          setExportOnlySettingsState("stale");
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to queue local export.",
        );
      }
      const exportRequest = ExportRequestSchema.parse(payload);
      setExportOnlyRequestId(exportRequest.id);
      setSourceRightsConfirmed(false);
      setClipActionMessage(
        `Queued a local export-only job with the ${exportRequest.preset.name} snapshot. Nothing was added to a project.`,
      );
    } catch (caught) {
      setClipActionMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to queue local export.",
      );
    } finally {
      setClipActionBusy(false);
    }
  }

  async function copySelectionText() {
    if (!selection) return;
    const copyText = transcriptEvidenceSelection(selection)?.text;
    if (!copyText) {
      setClipActionMessage(
        "This player range has no attached transcript text to copy.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(copyText);
      setClipActionMessage("Copied the selected transcript text.");
    } catch {
      setClipActionMessage("The browser could not copy the selection.");
    }
  }

  function seekTo(startMs: number, precision: "word" | "cue" = "cue") {
    playerRef.current?.seekTo(startMs);
    setCurrentMs(startMs);
    setLastSeekMs(startMs);
    setLastSeekPrecision(precision);
  }

  function handlePlayerTimeChange(milliseconds: number) {
    setCurrentMs(milliseconds);
    if (clipLoopRange && milliseconds >= clipLoopRange.endMs) {
      playerRef.current?.seekTo(clipLoopRange.startMs);
      playerRef.current?.play();
    }
  }

  const [lastSeekPrecision, setLastSeekPrecision] = useState<"word" | "cue">(
    "cue",
  );

  function moveMatch(direction: 1 | -1) {
    if (transcriptMatches.length === 0) return;
    const next =
      (matchIndex + direction + transcriptMatches.length) %
      transcriptMatches.length;
    setMatchIndex(next);
    const match = transcriptMatches[next]!;
    seekTo(match.startMs, match.timingPrecision);
  }

  return (
    <WorkspaceShell
      projects={projects}
      projectId={projectId}
      destination={destination}
      {...(user ? { user } : {})}
      unreadCount={unreadActivityCount}
      {...(workspaceTarget
        ? {
            navigationTitle:
              workspaceTarget.title ?? workspaceTarget.youtubeVideoId,
          }
        : {})}
      navigationHistory={navigationBackStack.map((entry, index) => ({
        id: String(index),
        label: entry.title ?? entry.youtubeVideoId,
      }))}
      onProjectChange={selectProject}
      onDestinationChange={setDestination}
      onBack={navigateBack}
      onNavigationHistorySelect={(id) => {
        const snapshot = navigationBackStack[Number(id)];
        if (snapshot) restoreNavigationSnapshot(snapshot, true);
      }}
      onSignOut={signOutFromShell}
      setup={
        <DesktopSetup
          authorization={authorization}
          {...(desktopAuthStatus ? { authStatus: desktopAuthStatus } : {})}
          profileState={profileState}
          projects={projects}
          projectId={projectId}
          onProjectsChange={(nextProjects) => {
            setProjects(nextProjects);
            setProjectsLoaded(Boolean(authorization));
          }}
          onProjectChange={selectProject}
          onRegisterProfile={registerDesktopProfile}
          onSignIn={beginDesktopSignIn}
          onSignOut={completeDesktopSignOut}
        />
      }
      ingest={
        <SourceIngestPanel
          projectId={projectId}
          authorization={authorization}
          url={url}
          {...(error ? { error } : {})}
          {...(videoLoadMessage ? { pasteMessage: videoLoadMessage } : {})}
          loading={videoLoadBusy}
          onUrlChange={(nextUrl) => {
            setUrl(nextUrl);
            setError(undefined);
            setVideoLoadMessage(undefined);
          }}
          onSubmit={loadVideo}
          onBulkAdd={() => {
            setDestination("videos");
            setBulkAddRequest((request) => request + 1);
          }}
          onSearchCandidatesSelected={(inputs) => {
            setDestination("videos");
            setSearchBatchRequest((current) => ({
              generation: (current?.generation ?? 0) + 1,
              inputs,
            }));
          }}
        />
      }
      accountSettings={
        <>
          <AccountLanguagePanel
            preferredLanguage={preferredLanguageDraft}
            disabled={!authorization}
            message={preferenceMessage}
            onPreferredLanguageChange={setPreferredLanguageDraft}
            onSave={() => void savePreferredLanguage()}
          />
          <NotificationPreferencesPanel signedIn={Boolean(authorization)} />
        </>
      }
      workspace={
        <ResearchWorkspaceLayout
          transcript={
            <TranscriptNavigationPanel
              transcript={transcript}
              originalTranscript={transcriptTracks?.original}
              preferredTranscript={preferredTranscript}
              preferredLanguage={user?.preferredLanguage}
              transcriptView={transcriptView}
              preferredEvidenceRequired={preferredEvidenceRequired}
              offlineCachedWorkspace={Boolean(offlineCachedWorkspace)}
              workspaceMessage={workspaceMessage}
              workspaceLoadState={workspaceLoadState}
              hasWorkspaceTarget={Boolean(workspaceTarget)}
              query={query}
              matchIndex={matchIndex}
              matches={transcriptMatches}
              activeSegmentId={activeSegment?.id}
              activeTokenId={activeToken?.id}
              selectedTokenIds={selectedTokenIds}
              follow={follow}
              onTranscriptViewChange={setTranscriptView}
              onFollowChange={setFollow}
              onQueryChange={setQuery}
              onMoveMatch={moveMatch}
              onFollowSuspended={() => setFollow(false)}
              onSeek={seekTo}
              onSelect={(anchor, focus) => {
                playerRef.current?.pause();
                setPreviewingSelection(false);
                setSelection(
                  deriveTranscriptSelection({
                    transcript: transcript!,
                    anchor,
                    focus,
                  }),
                );
                setPlayerRangeStartMs(undefined);
                setPlayerRangeEndMs(undefined);
                setPlayerSpeechStatus(undefined);
                setPlayerRangeMessage(undefined);
                setPlayerNoSpeechAttestation(undefined);
                setClipNotes("");
                setClipFirstComment("");
                setClipTags("");
                setSelectionCommandId(crypto.randomUUID());
                setClipActionMessage(undefined);
                setLoggedClipId(undefined);
                setLoggedExportRequestId(undefined);
                setExportOnlyRequestId(undefined);
                setSelectionError(undefined);
              }}
              onRetry={() => void retryWorkspaceTranscript()}
            />
          }
          player={
            <PlayerPanel
              playerRef={playerRef}
              videoId={videoId}
              currentMs={currentMs}
              lastSeekMs={lastSeekMs}
              lastSeekPrecision={lastSeekPrecision}
              sourceDurationMs={sourceDurationMs}
              playerRangeStartMs={playerRangeStartMs}
              playerRangeEndMs={playerRangeEndMs}
              playerSpeechStatus={playerSpeechStatus}
              playerRangeMessage={playerRangeMessage}
              {...(clipLoopRange ? { clipLoopRange } : {})}
              onTimeChange={handlePlayerTimeChange}
              onDurationChange={setSourceDurationMs}
              onSetPlayerRangeBound={setPlayerRangeBound}
              onPlayerSpeechStatusChange={changePlayerSpeechStatus}
              onClearPlayerRange={clearPlayerRange}
              {...(authorization &&
              projectId &&
              selectedVideoSnapshot &&
              workspaceTarget
                ? {
                    bookmarks: (
                      <BookmarksPanel
                        authorization={authorization}
                        projectId={projectId}
                        videoId={workspaceTarget.catalogVideoId}
                        currentMs={currentMs}
                        {...(user ? { currentUserId: user.id } : {})}
                        {...(projects.find(
                          (project) => project.id === projectId,
                        )?.currentUserRole
                          ? {
                              currentRole: projects.find(
                                (project) => project.id === projectId,
                              )!.currentUserRole,
                            }
                          : {})}
                        onSeek={(milliseconds) => {
                          playerRef.current?.seekTo(milliseconds);
                          setLastSeekMs(milliseconds);
                        }}
                        onOpen={(bookmark) => {
                          if (!bookmark.source) return;
                          openProjectVideo({
                            projectId,
                            catalogVideoId: bookmark.videoId,
                            youtubeVideoId: bookmark.source.youtubeVideoId,
                            canonicalUrl: bookmark.source.canonicalUrl,
                            title: bookmark.source.title,
                            bookmarkSource: {
                              sourceTimeMs: bookmark.sourceTimeMs,
                            },
                          });
                        }}
                      />
                    ),
                  }
                : {})}
              selectionEditor={
                selection ? (
                  <SelectionEditor
                    selection={selection}
                    currentMs={currentMs}
                    authorizationAvailable={Boolean(authorization)}
                    projects={projects}
                    projectId={projectId}
                    creatingProject={creatingProject}
                    newProjectName={newProjectName}
                    newProjectDescription={newProjectDescription}
                    newProjectKind={newProjectKind}
                    projectBusy={projectBusy}
                    projectMessage={projectMessage}
                    clipNotes={clipNotes}
                    clipFirstComment={clipFirstComment}
                    clipTags={clipTags}
                    logged={Boolean(loggedClipId)}
                    previewingSelection={previewingSelection}
                    onClear={() => {
                      playerRef.current?.pause();
                      setPreviewingSelection(false);
                      if (selection.selectionType === "player_time_range") {
                        setPlayerRangeStartMs(undefined);
                        setPlayerRangeEndMs(undefined);
                        setPlayerSpeechStatus(undefined);
                        setPlayerRangeMessage(undefined);
                        setPlayerNoSpeechAttestation(undefined);
                      }
                      setSelection(undefined);
                      setSelectionError(undefined);
                      setClipNotes("");
                      setClipFirstComment("");
                      setClipTags("");
                      setClipActionMessage(undefined);
                      setLoggedClipId(undefined);
                      setLoggedExportRequestId(undefined);
                      setExportOnlyRequestId(undefined);
                    }}
                    onCreatingProjectChange={setCreatingProject}
                    onProjectChange={selectProject}
                    onNewProjectNameChange={setNewProjectName}
                    onNewProjectDescriptionChange={setNewProjectDescription}
                    onNewProjectKindChange={setNewProjectKind}
                    onCreateProject={() => void createProjectFromSelection()}
                    onClipNotesChange={setClipNotes}
                    onClipFirstCommentChange={setClipFirstComment}
                    onClipTagsChange={setClipTags}
                    transcriptLanguage={transcript?.track.language}
                    onAttachOverlappingTranscript={attachOverlappingTranscript}
                    onExportBoundChange={changeExportBound}
                    onTogglePreview={toggleSelectionPreview}
                    onAddExportHandles={addExportHandles}
                    onSetExportBoundFromPlayhead={setExportBoundFromPlayhead}
                    commandPanel={
                      <SelectionCommandPanel
                        loggedPresetSelectionKey={loggedPresetSelectionKey}
                        exportOnlyPresetSelectionKey={
                          exportOnlyPresetSelectionKey
                        }
                        projectPresetOptions={projectPresetOptions}
                        personalPresetOptions={personalPresetOptions}
                        presetDiscoveryMessage={presetDiscoveryMessage}
                        loggedSettingsState={loggedSettingsState}
                        exportOnlySettingsState={exportOnlySettingsState}
                        loggedSettingsPreview={loggedSettingsPreview}
                        exportOnlySettingsPreview={exportOnlySettingsPreview}
                        overrideFields={overrideFields}
                        selectedRendererCapabilityId={
                          selectedRendererCapabilityId
                        }
                        installedRendererIds={installedRendererIds}
                        exportVideoCodec={exportVideoCodec}
                        exportRateControlMode={exportRateControlMode}
                        exportVideoBitrate={exportVideoBitrate}
                        exportCrf={exportCrf}
                        exportMaxWidth={exportMaxWidth}
                        exportFrameRate={exportFrameRate}
                        exportAudioCodec={exportAudioCodec}
                        exportAudioBitrate={exportAudioBitrate}
                        exportAudioSampleRate={exportAudioSampleRate}
                        exportAudioChannels={exportAudioChannels}
                        omitEnglishSubtitles={omitEnglishSubtitles}
                        embedEnglishSubtitles={embedEnglishSubtitles}
                        sourceLanguageClass={sourceLanguageClass}
                        sourceRights={sourceRights}
                        sourceRightsConfirmed={sourceRightsConfirmed}
                        selectedVideoSnapshot={Boolean(selectedVideoSnapshot)}
                        clipActionBusy={clipActionBusy}
                        loggedClipId={loggedClipId}
                        loggedExportRequestId={loggedExportRequestId}
                        exportOnlyRequestId={exportOnlyRequestId}
                        authorization={Boolean(authorization)}
                        projectId={projectId}
                        user={Boolean(user)}
                        languageEvidenceReady={languageEvidenceReady}
                        selectionHasTranscriptEvidence={Boolean(
                          selectedEvidence,
                        )}
                        selectionExportBlockReason={selectionExportBlockReason}
                        attestedNoSpeech={
                          selection?.selectionType === "player_time_range" &&
                          selection.speechStatus === "no_speech"
                        }
                        offlineCachedWorkspace={Boolean(offlineCachedWorkspace)}
                        clipActionMessage={clipActionMessage}
                        selectionError={selectionError}
                        setLoggedPresetKey={setLoggedPresetKey}
                        setExportOnlyPresetKey={setExportOnlyPresetKey}
                        setOverrideFields={setOverrideFields}
                        setExportContainer={setExportContainer}
                        setExportVideoCodec={setExportVideoCodec}
                        setExportAudioCodec={setExportAudioCodec}
                        setExportRateControlMode={setExportRateControlMode}
                        setExportVideoBitrate={setExportVideoBitrate}
                        setExportCrf={setExportCrf}
                        setExportMaxWidth={setExportMaxWidth}
                        setExportFrameRate={setExportFrameRate}
                        setExportAudioBitrate={setExportAudioBitrate}
                        setExportAudioSampleRate={setExportAudioSampleRate}
                        setExportAudioChannels={setExportAudioChannels}
                        setOmitEnglishSubtitles={setOmitEnglishSubtitles}
                        setEmbedEnglishSubtitles={setEmbedEnglishSubtitles}
                        setSourceRightsConfirmed={setSourceRightsConfirmed}
                        queueClipOnly={queueClipOnly}
                        requestLoggedExport={requestLoggedExport}
                        requestExportOnly={requestExportOnly}
                        copySelectionText={copySelectionText}
                      />
                    }
                  />
                ) : null
              }
            />
          }
        />
      }
      projectContent={
        <BatchWorkspace
          authorization={authorization}
          {...(user ? { currentUserId: user.id } : {})}
          {...(desktopAuthStatus ? { desktopAuthStatus } : {})}
          onDesktopSignIn={beginDesktopSignIn}
          onDesktopSignOut={completeDesktopSignOut}
          onAuthorizationChange={(value) => {
            recentProjectValidation.current = undefined;
            setRecentProjectReadyIdentity(undefined);
            setNavigationBackStack([]);
            pendingNavigationRestore.current = undefined;
            hydratedNavigationIdentity.current = undefined;
            setAuthorization(value);
            setProjects([]);
            setProjectsLoaded(false);
            selectProject("");
            setProjectMessage(undefined);
          }}
          onOpenSourceClip={(target) =>
            openProjectVideo({
              projectId: target.projectId,
              catalogVideoId: target.catalogVideoId,
              youtubeVideoId: target.youtubeVideoId,
              canonicalUrl: target.canonicalUrl,
              title: target.title,
              clipSource: {
                clipId: target.clipId,
                selection: target.selection,
                ...(target.fallbackNotice
                  ? { fallbackNotice: target.fallbackNotice }
                  : {}),
                ...(target.sourceTimeMs === undefined
                  ? {}
                  : { sourceTimeMs: target.sourceTimeMs }),
              },
            })
          }
          onOpenReadyVideo={(target) => {
            openProjectVideo(target);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onProjectChange={selectProject}
          onProjectsChange={(nextProjects) => {
            setProjects(nextProjects);
            setProjectsLoaded(Boolean(authorization));
          }}
          onUnreadActivityChange={setUnreadActivityCount}
          projectId={projectId}
          projects={projects}
          destination={destination}
          hasOpenReviewSource={Boolean(workspaceTarget)}
          {...(notificationTarget ? { notificationTarget } : {})}
          bulkAddRequest={bulkAddRequest}
          {...(searchBatchRequest
            ? { externalInputsRequest: searchBatchRequest }
            : {})}
        />
      }
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
