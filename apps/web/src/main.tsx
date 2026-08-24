import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  ApiErrorSchema,
  ClipCandidateSchema,
  ExportPresetSnapshotSchema,
  ExportSettingsPreviewSchema,
  PersonalExportPresetCatalogSchema,
  ProjectExportPresetCatalogSchema,
  ExportRequestSchema,
  ProjectSchema,
  ExportSourceRightsSnapshotSchema,
  TranscriptSelectionSchema,
  TranscriptWorkspaceResponseSchema,
  UserSchema,
  VideoSchema,
  languagesEquivalent,
  type ClipCandidate,
  type DesktopAuthStatus,
  type ExportPresetCatalogEntry,
  type ExportPresetDefault,
  type ExportPresetSnapshot,
  type ExportSettingsOverride,
  type ExportSettingsPreview,
  type ExportSettingsSelection,
  type NormalizedTranscript,
  type Project,
  type TranscriptSelection,
  type TranscriptWorkspaceResponse,
  type User,
  type Video,
} from "@research-video/contracts";
import { normalizeYouTubeUrl } from "@research-video/providers";
import {
  deriveTranscriptSelection,
  buildClipLanguageEvidence,
  searchTranscript,
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
import { DesktopSetup } from "./desktop-setup.tsx";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player.tsx";
import { VirtualTranscript } from "./virtual-transcript.tsx";

const builtInPresetKey = "built-in:editing-mp4:v1";

type WorkspaceVideoTarget = Readonly<{
  projectId: string;
  catalogVideoId: string;
  youtubeVideoId: string;
  canonicalUrl: string;
  title?: string;
}>;

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

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPreciseTime(milliseconds: number) {
  return `${(milliseconds / 1_000).toFixed(3)}s`;
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

function App() {
  const [url, setUrl] = useState("");
  const [workspaceTarget, setWorkspaceTarget] =
    useState<WorkspaceVideoTarget>();
  const [workspace, setWorkspace] = useState<TranscriptWorkspaceResponse>();
  const [workspaceLoadState, setWorkspaceLoadState] =
    useState<WorkspaceLoadState>("idle");
  const [workspaceMessage, setWorkspaceMessage] = useState<string>();
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const workspaceGeneration = useRef(0);
  const [projectVideos, setProjectVideos] = useState<Video[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [lastSeekMs, setLastSeekMs] = useState<number>();
  const [follow, setFollow] = useState(true);
  const [selection, setSelection] = useState<TranscriptSelection>();
  const [selectionError, setSelectionError] = useState<string>();
  const [previewingSelection, setPreviewingSelection] = useState(false);
  const [authorization, setAuthorization] = useState("");
  const [desktopAuthStatus, setDesktopAuthStatus] =
    useState<DesktopAuthStatus>();
  const [user, setUser] = useState<User>();
  const [preferredLanguageDraft, setPreferredLanguageDraft] = useState("en");
  const [preferenceMessage, setPreferenceMessage] = useState(
    "Connect a session to load your account preference.",
  );
  const [transcriptView, setTranscriptView] = useState<
    "preferred" | "english" | "original"
  >("preferred");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string>();
  const [clipNotes, setClipNotes] = useState("");
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
    setLastSeekMs(undefined);
    setQuery("");
    setTranscriptView("preferred");
    setSelection(undefined);
    setSelectionError(undefined);
    setPreviewingSelection(false);
    setClipNotes("");
    setClipTags("");
    setSelectionCommandId(crypto.randomUUID());
    setClipActionMessage(undefined);
    setLoggedClipId(undefined);
    setLoggedExportRequestId(undefined);
    setExportOnlyRequestId(undefined);
    setSourceRightsConfirmed(false);
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
    await bridge.signIn();
    await refreshDesktopStatus();
  }

  async function completeDesktopSignOut() {
    const bridge = desktopBridge();
    if (!bridge) return;
    clearWorkspaceInteraction();
    setWorkspaceTarget(undefined);
    await bridge.signOut();
    await refreshDesktopStatus();
    setProjects([]);
    selectProject("");
    setProjectMessage(undefined);
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
  const visibleSegments = useMemo(
    () => searchTranscript(transcript?.segments ?? [], query),
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
  const selectedTokenIds = useMemo(() => {
    const ids = new Set<string>();
    if (!transcript || !selection?.firstTokenId || !selection.lastTokenId) {
      return ids;
    }
    const firstIndex = transcript.tokens.findIndex(
      (token) => token.id === selection.firstTokenId,
    );
    const lastIndex = transcript.tokens.findIndex(
      (token) => token.id === selection.lastTokenId,
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
  }, [selection, transcript]);

  useEffect(() => setMatchIndex(0), [query, videoId]);

  useEffect(() => {
    setSourceRightsConfirmed(false);
  }, [
    projectId,
    selection?.exportEndMs,
    selection?.exportStartMs,
    selection?.firstSegmentId,
    selection?.lastSegmentId,
    selectedVideoSnapshot?.youtubeVideoId,
  ]);

  useEffect(() => {
    if (!authorization) {
      setUser(undefined);
      setPreferredLanguageDraft("en");
      return;
    }
    void apiFetch("cloud", "/api/session/profile", {}, authorization)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error("Unable to load account settings.");
        return UserSchema.parse(payload);
      })
      .then((profile) => {
        setUser(profile);
        setPreferredLanguageDraft(profile.preferredLanguage);
        setPreferenceMessage(
          `Preferred transcript language: ${profile.preferredLanguage}.`,
        );
      })
      .catch((caught: unknown) => {
        setUser(undefined);
        setPreferenceMessage(
          caught instanceof Error
            ? caught.message
            : "Unable to load account settings.",
        );
      });
  }, [authorization]);

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
    loadVideoUrl(url);
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

  function loadVideoUrl(nextUrl: string) {
    try {
      const normalized = normalizeYouTubeUrl(nextUrl);
      clearWorkspaceInteraction();
      setWorkspaceTarget(undefined);
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
        openProjectVideo({
          projectId,
          catalogVideoId: projectVideo.id,
          youtubeVideoId: projectVideo.youtubeVideoId,
          canonicalUrl: projectVideo.canonicalUrl,
          title: projectVideo.title,
        });
        return;
      }
      setError(
        `“${normalized.videoId}” is not in this project yet. Add it through the transcription batch workflow, then open it from Ready for review.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load video.",
      );
    }
  }

  function openProjectVideo(target: WorkspaceVideoTarget) {
    clearWorkspaceInteraction();
    setProjectId(target.projectId);
    setWorkspaceTarget(target);
    setUrl(target.canonicalUrl);
    setError(undefined);
  }

  function selectProject(nextProjectId: string) {
    if (nextProjectId !== projectId) {
      clearWorkspaceInteraction();
      setWorkspaceTarget(undefined);
    }
    setProjectId(nextProjectId);
  }

  function changeExportBound(bound: "start" | "end", secondsText: string) {
    if (!selection || secondsText.trim() === "") return;
    const milliseconds = Math.round(Number(secondsText) * 1_000);
    try {
      setSelection(
        updateTranscriptSelectionExportBounds(selection, {
          startMs: bound === "start" ? milliseconds : selection.exportStartMs,
          endMs: bound === "end" ? milliseconds : selection.exportEndMs,
        }),
      );
      setSelectionError(undefined);
    } catch (caught) {
      setSelectionError(
        caught instanceof Error ? caught.message : "Invalid export bounds.",
      );
    }
  }

  function addExportHandles() {
    if (!selection) return;
    setSelection(
      updateTranscriptSelectionExportBounds(selection, {
        startMs: Math.max(0, selection.exportStartMs - 500),
        endMs: selection.exportEndMs + 500,
      }),
    );
    setSelectionError(undefined);
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
      setProjects((current) => [
        ...current.filter((candidate) => candidate.id !== project.id),
        project,
      ]);
      selectProject(project.id);
      setNewProjectName("");
      setNewProjectDescription("");
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
      !languageEvidenceReady ||
      offlineCachedWorkspace
    )
      return undefined;
    const languageEvidence = buildClipLanguageEvidence({
      original: transcriptTracks.original,
      english: transcriptTracks.english,
      ...(preferredTranscript ? { preferred: preferredTranscript } : {}),
      startMs: selection.transcriptStartMs,
      endMs: selection.transcriptEndMs,
    });
    setClipActionBusy(true);
    try {
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/clips`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `queue:${selectionCommandId}`,
            video: selectedVideoSnapshot,
            selection,
            languageEvidence,
            notes: clipNotes,
            tags: clipTags
              .split(/[,\n]/u)
              .map((tag) => tag.trim())
              .filter(Boolean),
          }),
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
    try {
      await navigator.clipboard.writeText(selection.text);
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

  const [lastSeekPrecision, setLastSeekPrecision] = useState<"word" | "cue">(
    "cue",
  );

  function moveMatch(direction: 1 | -1) {
    if (visibleSegments.length === 0) return;
    const next =
      (matchIndex + direction + visibleSegments.length) %
      visibleSegments.length;
    setMatchIndex(next);
    seekTo(visibleSegments[next]!.startMs, "cue");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Research video workspace</p>
          <h1>Navigate video by transcript</h1>
        </div>
        <span className="status">Multilingual clip logging</span>
      </header>

      <DesktopSetup
        authorization={authorization}
        {...(desktopAuthStatus ? { authStatus: desktopAuthStatus } : {})}
        projects={projects}
        projectId={projectId}
        onProjectsChange={setProjects}
        onProjectChange={selectProject}
        onSignIn={beginDesktopSignIn}
        onSignOut={completeDesktopSignOut}
      />

      <form
        className="loader"
        onSubmit={(event) => {
          event.preventDefault();
          loadVideo();
        }}
      >
        <label htmlFor="video-url">YouTube URL or video ID</label>
        <div className="loader-row">
          <input
            id="video-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={Boolean(error)}
          />
          <button type="submit">Load video</button>
        </div>
        <p className={error ? "form-message error" : "form-message"}>
          {error ??
            "Open a project video from Ready for review to resolve its verified transcript."}
        </p>
      </form>

      <section
        className="loader account-settings"
        aria-label="Account settings"
      >
        <label htmlFor="preferred-language">
          Preferred transcript language
        </label>
        <div className="loader-row">
          <input
            id="preferred-language"
            value={preferredLanguageDraft}
            maxLength={35}
            disabled={!authorization}
            onChange={(event) => setPreferredLanguageDraft(event.target.value)}
            placeholder="en, fr-CA, zh-Hant…"
          />
          <button
            type="button"
            disabled={!authorization || !preferredLanguageDraft.trim()}
            onClick={() => void savePreferredLanguage()}
          >
            Save preference
          </button>
        </div>
        <p className="form-message" role="status">
          {preferenceMessage}
        </p>
      </section>

      <section className="workspace" aria-label="Research workspace">
        <article className="panel transcript-panel">
          <div className="panel-heading">
            <div>
              <span>
                {transcript
                  ? `${transcript.track.language} transcript`
                  : "Transcript"}
              </span>
              {transcript ? (
                <span className="precision">
                  {transcript.track.timingPrecision} timing
                </span>
              ) : null}
            </div>
            {transcriptTracks ? (
              <label className="transcript-view-picker">
                Language view
                <select
                  value={transcriptView}
                  onChange={(event) =>
                    setTranscriptView(
                      event.target.value as
                        "preferred" | "english" | "original",
                    )
                  }
                >
                  <option
                    value="preferred"
                    disabled={preferredEvidenceRequired && !preferredTranscript}
                  >
                    Preferred{user ? ` (${user.preferredLanguage})` : ""}
                  </option>
                  <option value="english">English</option>
                  {!languagesEquivalent(
                    transcriptTracks.original.track.language,
                    "en",
                  ) ? (
                    <option value="original">
                      Original ({transcriptTracks.original.track.language})
                    </option>
                  ) : null}
                </select>
              </label>
            ) : null}
            <button
              className="quiet-button"
              type="button"
              onClick={() => setFollow((value) => !value)}
              aria-pressed={follow}
            >
              {follow ? "Following" : "Resume follow"}
            </button>
          </div>

          {transcript ? (
            <>
              <p className="form-message" role="status">
                {workspaceMessage}
              </p>
              {preferredEvidenceRequired && !preferredTranscript ? (
                <p className="form-message error" role="status">
                  Preferred translation unavailable for{" "}
                  {user?.preferredLanguage}. Original and English remain
                  available; logging waits for the required preferred evidence.
                </p>
              ) : null}
              {offlineCachedWorkspace ? (
                <p className="form-message" role="status">
                  This is verified offline cache review. Reconnect to confirm
                  the current project transcript; Queue / log only and Export +
                  log are unavailable until then.
                </p>
              ) : null}
              <div className="search-field">
                <label htmlFor="transcript-search">Search transcript</label>
                <input
                  id="transcript-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find exact text"
                />
                <span className="search-navigation">
                  <span>
                    {visibleSegments.length === 0
                      ? "0 matches"
                      : `${matchIndex + 1} of ${visibleSegments.length}`}
                  </span>
                  <button
                    type="button"
                    disabled={visibleSegments.length === 0}
                    onClick={() => moveMatch(-1)}
                  >
                    Previous match
                  </button>
                  <button
                    type="button"
                    disabled={visibleSegments.length === 0}
                    onClick={() => moveMatch(1)}
                  >
                    Next match
                  </button>
                </span>
              </div>
              {visibleSegments.length > 0 ? (
                <VirtualTranscript
                  segments={visibleSegments}
                  tokens={transcript.tokens}
                  {...(activeSegment
                    ? { activeSegmentId: activeSegment.id }
                    : {})}
                  {...(activeToken ? { activeTokenId: activeToken.id } : {})}
                  selectedTokenIds={selectedTokenIds}
                  follow={follow}
                  onFollowSuspended={() => setFollow(false)}
                  onSeek={seekTo}
                  onSelect={(anchor, focus) => {
                    playerRef.current?.pause();
                    setPreviewingSelection(false);
                    setSelection(
                      deriveTranscriptSelection({
                        transcript,
                        anchor,
                        focus,
                      }),
                    );
                    setClipNotes("");
                    setClipTags("");
                    setSelectionCommandId(crypto.randomUUID());
                    setClipActionMessage(undefined);
                    setLoggedClipId(undefined);
                    setLoggedExportRequestId(undefined);
                    setExportOnlyRequestId(undefined);
                    setSelectionError(undefined);
                  }}
                />
              ) : (
                <p className="no-results">No transcript matches.</p>
              )}
            </>
          ) : (
            <div className="empty-state">
              <span className="step">01</span>
              <h2>
                {workspaceLoadState === "loading"
                  ? "Loading verified transcript"
                  : workspaceLoadState === "unavailable"
                    ? "No active project transcript"
                    : workspaceLoadState === "failed"
                      ? "Transcript unavailable"
                      : "Open a project video"}
              </h2>
              <p>
                {workspaceMessage ??
                  "Open a Ready for review project video. The app never substitutes fixture text when real resolution is unavailable."}
              </p>
              {workspaceTarget && workspaceLoadState !== "loading" ? (
                <button
                  type="button"
                  onClick={() => setWorkspaceReload((value) => value + 1)}
                >
                  Retry transcript
                </button>
              ) : null}
            </div>
          )}
        </article>

        <aside className="panel video-panel">
          {videoId ? (
            <YouTubePlayer
              ref={playerRef}
              videoId={videoId}
              onTimeChange={setCurrentMs}
            />
          ) : (
            <div className="video-placeholder">16:9 YouTube player</div>
          )}
          <div className="video-details">
            <p className="eyebrow">Playback position</p>
            <strong>{formatTime(currentMs)}</strong>
            <p className="muted">
              {lastSeekMs === undefined
                ? "Click a timed word or cue to seek."
                : `${lastSeekPrecision === "word" ? "Word" : "Cue"} requested ${formatTime(lastSeekMs)}.`}
            </p>
          </div>
          {selection ? (
            <section className="selection-panel" aria-label="Clip selection">
              <div className="selection-heading">
                <div>
                  <p className="eyebrow">Selected passage</p>
                  <strong>{selection.timingPrecision} bounds</strong>
                </div>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    playerRef.current?.pause();
                    setPreviewingSelection(false);
                    setSelection(undefined);
                    setSelectionError(undefined);
                    setClipNotes("");
                    setClipTags("");
                    setClipActionMessage(undefined);
                    setLoggedClipId(undefined);
                    setLoggedExportRequestId(undefined);
                    setExportOnlyRequestId(undefined);
                  }}
                >
                  Clear
                </button>
              </div>
              <blockquote>{selection.text}</blockquote>
              <div className="selection-project">
                <div className="selection-project-heading">
                  <label htmlFor="selection-project">Logging project</label>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={!authorization || Boolean(loggedClipId)}
                    onClick={() => setCreatingProject((current) => !current)}
                  >
                    {creatingProject ? "Cancel new project" : "New project"}
                  </button>
                </div>
                <select
                  id="selection-project"
                  value={projectId}
                  disabled={projects.length === 0 || Boolean(loggedClipId)}
                  onChange={(event) => selectProject(event.target.value)}
                >
                  <option value="">Choose a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                {creatingProject ? (
                  <div className="quick-project-form">
                    <label>
                      Project name
                      <input
                        value={newProjectName}
                        maxLength={160}
                        onChange={(event) =>
                          setNewProjectName(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Description (optional)
                      <textarea
                        value={newProjectDescription}
                        maxLength={2_000}
                        rows={2}
                        onChange={(event) =>
                          setNewProjectDescription(event.target.value)
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="handle-button"
                      disabled={projectBusy || !newProjectName.trim()}
                      onClick={() => void createProjectFromSelection()}
                    >
                      Create and select project
                    </button>
                  </div>
                ) : null}
                <p className="form-message" role="status">
                  {projectMessage ??
                    (authorization
                      ? projects.length
                        ? "Logging actions will show this destination explicitly."
                        : "Connect below to load projects, or create one here."
                      : "Connect a development session below to choose or create a logging project.")}
                </p>
              </div>
              <div className="clip-research-fields">
                <label>
                  Notes / intended use
                  <textarea
                    rows={3}
                    maxLength={20_000}
                    value={clipNotes}
                    disabled={Boolean(loggedClipId)}
                    onChange={(event) => setClipNotes(event.target.value)}
                    placeholder="How might this clip support the essay?"
                  />
                </label>
                <label>
                  Clip tags
                  <input
                    value={clipTags}
                    disabled={Boolean(loggedClipId)}
                    onChange={(event) => setClipTags(event.target.value)}
                    placeholder="topic, person, argument"
                  />
                  <span>Separate reusable project tags with commas.</span>
                </label>
              </div>
              <p className="immutable-bounds">
                Transcript selection:{" "}
                {formatPreciseTime(selection.transcriptStartMs)}–
                {formatPreciseTime(selection.transcriptEndMs)}
              </p>
              <div className="export-bounds">
                <label>
                  Export start (seconds)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    disabled={Boolean(loggedClipId)}
                    value={(selection.exportStartMs / 1_000).toFixed(3)}
                    onChange={(event) =>
                      changeExportBound("start", event.target.value)
                    }
                  />
                </label>
                <label>
                  Export end (seconds)
                  <input
                    type="number"
                    min="0.001"
                    step="0.1"
                    disabled={Boolean(loggedClipId)}
                    value={(selection.exportEndMs / 1_000).toFixed(3)}
                    onChange={(event) =>
                      changeExportBound("end", event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="selection-controls">
                <button
                  type="button"
                  className="handle-button"
                  onClick={toggleSelectionPreview}
                >
                  {previewingSelection ? "Stop preview" : "Loop preview"}
                </button>
                <button
                  type="button"
                  className="handle-button"
                  disabled={Boolean(loggedClipId)}
                  onClick={addExportHandles}
                >
                  Add 0.5s handles
                </button>
                <button
                  type="button"
                  className="handle-button"
                  disabled={
                    Boolean(loggedClipId) ||
                    currentMs > selection.transcriptStartMs ||
                    currentMs >= selection.exportEndMs
                  }
                  onClick={() => setExportBoundFromPlayhead("start")}
                >
                  Set start from playhead
                </button>
                <button
                  type="button"
                  className="handle-button"
                  disabled={
                    Boolean(loggedClipId) ||
                    currentMs < selection.transcriptEndMs ||
                    currentMs <= selection.exportStartMs
                  }
                  onClick={() => setExportBoundFromPlayhead("end")}
                >
                  Set end from playhead
                </button>
              </div>
              <section
                className="preset-picker"
                aria-label="Conversion preset picker"
              >
                <div className="export-settings-grid">
                  <label>
                    Logged export preset
                    <select
                      value={loggedPresetSelectionKey}
                      onChange={(event) =>
                        setLoggedPresetKey(event.target.value)
                      }
                    >
                      {projectPresetOptions.length ? (
                        <optgroup label="Project presets">
                          {projectPresetOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.snapshot.name} v
                              {option.snapshot.presetVersion}
                              {option.isDefault ? " — project default" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {personalPresetOptions.length ? (
                        <optgroup label="Personal presets">
                          {personalPresetOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.snapshot.name} v
                              {option.snapshot.presetVersion}
                              {option.isDefault ? " — personal default" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <option value={builtInPresetKey}>
                        Editing MP4 v1 — built-in fallback
                      </option>
                    </select>
                  </label>
                  <label>
                    Export-only preset
                    <select
                      value={exportOnlyPresetSelectionKey}
                      onChange={(event) =>
                        setExportOnlyPresetKey(event.target.value)
                      }
                    >
                      {personalPresetOptions.length ? (
                        <optgroup label="Personal presets">
                          {personalPresetOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.snapshot.name} v
                              {option.snapshot.presetVersion}
                              {option.isDefault ? " — personal default" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <option value={builtInPresetKey}>
                        Editing MP4 v1 — built-in fallback
                      </option>
                    </select>
                  </label>
                </div>
                <p className="form-message" role="status">
                  {presetDiscoveryMessage}
                </p>
                <p className="muted">
                  Logged settings: {loggedSettingsState}. Export-only settings:{" "}
                  {exportOnlySettingsState}. Preset versions are resolved by the
                  authoritative service and creation must match this preview.
                </p>
                {loggedSettingsPreview ? (
                  <p className="muted" data-testid="logged-settings-summary">
                    Logged provenance: Editing application v1
                    {loggedSettingsPreview.snapshot.base ===
                    "application_default"
                      ? " → application base selected"
                      : loggedSettingsPreview.snapshot.contextDefault
                        ? ` → project default ${loggedSettingsPreview.snapshot.contextDefault.name} v${loggedSettingsPreview.snapshot.contextDefault.presetVersion}`
                        : " → no project default"}
                    {loggedSettingsPreview.snapshot.selectedPreset
                      ? ` → selected ${loggedSettingsPreview.snapshot.selectedPresetScope} ${loggedSettingsPreview.snapshot.selectedPreset.name} v${loggedSettingsPreview.snapshot.selectedPreset.presetVersion}`
                      : " → no explicit preset"}
                    {loggedSettingsPreview.snapshot.overrideFields.length
                      ? ` → overrides ${loggedSettingsPreview.snapshot.overrideFields.join(", ")}`
                      : " → no overrides"}
                    . Effective:{" "}
                    {loggedSettingsPreview.snapshot.settings.container.toUpperCase()}{" "}
                    /{" "}
                    {loggedSettingsPreview.snapshot.settings.videoCodec.toUpperCase()}{" "}
                    / {loggedSettingsPreview.snapshot.settings.frameRate} fps.
                    Sidecars:{" "}
                    {loggedSettingsPreview.effectiveSubtitlePolicy.requiredSidecars.join(
                      " + ",
                    ) || "omitted for confidently English"}
                    .
                  </p>
                ) : null}
                {exportOnlySettingsPreview ? (
                  <p
                    className="muted"
                    data-testid="export-only-settings-summary"
                  >
                    Export-only provenance: Editing application v1
                    {exportOnlySettingsPreview.snapshot.base ===
                    "application_default"
                      ? " → application base selected"
                      : exportOnlySettingsPreview.snapshot.contextDefault
                        ? ` → personal default ${exportOnlySettingsPreview.snapshot.contextDefault.name} v${exportOnlySettingsPreview.snapshot.contextDefault.presetVersion}`
                        : " → no personal default"}
                    {exportOnlySettingsPreview.snapshot.selectedPreset
                      ? ` → selected personal ${exportOnlySettingsPreview.snapshot.selectedPreset.name} v${exportOnlySettingsPreview.snapshot.selectedPreset.presetVersion}`
                      : " → no explicit preset"}
                    {exportOnlySettingsPreview.snapshot.overrideFields.length
                      ? ` → overrides ${exportOnlySettingsPreview.snapshot.overrideFields.join(", ")}`
                      : " → no overrides"}
                    . Effective:{" "}
                    {exportOnlySettingsPreview.snapshot.settings.container.toUpperCase()}{" "}
                    /{" "}
                    {exportOnlySettingsPreview.snapshot.settings.videoCodec.toUpperCase()}{" "}
                    / {exportOnlySettingsPreview.snapshot.settings.frameRate}{" "}
                    fps. Sidecars:{" "}
                    {exportOnlySettingsPreview.effectiveSubtitlePolicy.requiredSidecars.join(
                      " + ",
                    ) || "omitted for confidently English"}
                    .
                  </p>
                ) : null}
                {[
                  ...(loggedSettingsPreview?.issues ?? []),
                  ...(exportOnlySettingsPreview?.issues ?? []),
                ].map((issue, index) => (
                  <p
                    className="form-message error"
                    key={`${issue.field}:${issue.code}:${index}`}
                  >
                    {issue.field}: {issue.message}
                  </p>
                ))}
              </section>
              <details className="export-settings-panel">
                <summary>Per-export overrides</summary>
                <p className="muted">
                  {overrideFields.size
                    ? `Overrides: ${[...overrideFields].join(", ")}`
                    : "No overrides; the resolved base is used unchanged."}
                  {overrideFields.size ? (
                    <button
                      type="button"
                      className="handle-button"
                      onClick={() => setOverrideFields(new Set())}
                    >
                      Reset all overrides
                    </button>
                  ) : null}
                </p>
                <div className="export-settings-grid">
                  <label>
                    Rendering family
                    <select
                      value={selectedRendererCapabilityId}
                      onChange={(event) => {
                        const rendererCapabilityId = event.target.value;
                        setOverrideFields(
                          (current) =>
                            new Set([
                              ...current,
                              "container",
                              "videoCodec",
                              "videoRateControl",
                              "audioCodec",
                              "audioKilobitsPerSecond",
                            ]),
                        );
                        if (rendererCapabilityId === "h264_mp4") {
                          setExportContainer("mp4");
                          setExportVideoCodec("h264");
                          setExportAudioCodec("aac");
                          if (exportRateControlMode === "codec_default")
                            setExportRateControlMode("crf");
                          return;
                        }
                        if (rendererCapabilityId === "hevc_mkv") {
                          setExportContainer("mkv");
                          setExportVideoCodec("hevc");
                          setExportAudioCodec("aac");
                          if (exportRateControlMode === "codec_default")
                            setExportRateControlMode("crf");
                          return;
                        }
                        setExportContainer("mov");
                        setExportVideoCodec("prores");
                        setExportAudioCodec("pcm_s16le");
                        setExportRateControlMode("codec_default");
                        setExportAudioBitrate(undefined);
                      }}
                    >
                      <option value="h264_mp4">
                        MP4 · H.264 High · AAC
                        {installedRendererIds &&
                        !installedRendererIds.has("h264_mp4")
                          ? " — unavailable for local export-only"
                          : ""}
                      </option>
                      <option value="hevc_mkv">
                        MKV · HEVC Main · AAC
                        {installedRendererIds &&
                        !installedRendererIds.has("hevc_mkv")
                          ? " — unavailable for local export-only"
                          : ""}
                      </option>
                      <option value="prores_mov">
                        MOV · ProRes 422 · PCM
                        {installedRendererIds &&
                        !installedRendererIds.has("prores_mov")
                          ? " — unavailable for local export-only"
                          : ""}
                      </option>
                    </select>
                  </label>
                  <label>
                    Rate control
                    <select
                      value={exportRateControlMode}
                      disabled={exportVideoCodec === "prores"}
                      onChange={(event) => {
                        setOverrideFields((current) =>
                          new Set(current).add("videoRateControl"),
                        );
                        setExportRateControlMode(
                          event.target.value as "crf" | "bitrate",
                        );
                      }}
                    >
                      {exportVideoCodec === "prores" ? (
                        <option value="codec_default">Codec fixed</option>
                      ) : (
                        <>
                          <option value="crf">CRF</option>
                          <option value="bitrate">Target bitrate</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label>
                    {exportRateControlMode === "bitrate"
                      ? "Video bitrate (kbps)"
                      : exportRateControlMode === "crf"
                        ? "Quality (CRF)"
                        : "Codec profile"}
                    <input
                      type="number"
                      min={exportRateControlMode === "bitrate" ? 500 : 0}
                      max={exportRateControlMode === "bitrate" ? 200_000 : 51}
                      disabled={exportRateControlMode === "codec_default"}
                      value={
                        exportRateControlMode === "bitrate"
                          ? exportVideoBitrate
                          : exportRateControlMode === "crf"
                            ? exportCrf
                            : ""
                      }
                      placeholder="ProRes 422"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isInteger(value)) return;
                        if (
                          exportRateControlMode === "crf" &&
                          value >= 0 &&
                          value <= 51
                        )
                          setExportCrf(value);
                        if (
                          exportRateControlMode === "bitrate" &&
                          value >= 500 &&
                          value <= 200_000
                        )
                          setExportVideoBitrate(value);
                        setOverrideFields((current) =>
                          new Set(current).add("videoRateControl"),
                        );
                      }}
                    />
                  </label>
                  <label>
                    Maximum width
                    <select
                      value={exportMaxWidth ?? "source"}
                      onChange={(event) => {
                        setOverrideFields((current) =>
                          new Set(current).add("maxWidth"),
                        );
                        if (event.target.value === "source") {
                          setExportMaxWidth(undefined);
                          return;
                        }
                        setExportMaxWidth(Number(event.target.value));
                      }}
                    >
                      <option value="source">Source</option>
                      <option value="640">640</option>
                      <option value="1280">1280</option>
                      <option value="1920">1920</option>
                      <option value="3840">3840</option>
                    </select>
                  </label>
                  <label>
                    Frame rate
                    <select
                      value={exportFrameRate}
                      onChange={(event) => (
                        setOverrideFields((current) =>
                          new Set(current).add("frameRate"),
                        ),
                        setExportFrameRate(
                          event.target.value as
                            "source" | "23.976" | "24" | "25" | "29.97" | "30",
                        )
                      )}
                    >
                      <option value="source">Source</option>
                      <option value="23.976">23.976</option>
                      <option value="24">24</option>
                      <option value="25">25</option>
                      <option value="29.97">29.97</option>
                      <option value="30">30</option>
                    </select>
                  </label>
                  <label>
                    {exportAudioCodec === "aac"
                      ? "AAC audio (kbps)"
                      : "PCM audio bitrate"}
                    <select
                      value={exportAudioBitrate ?? "default"}
                      disabled={exportAudioCodec !== "aac"}
                      onChange={(event) => {
                        setOverrideFields((current) =>
                          new Set(current).add("audioKilobitsPerSecond"),
                        );
                        if (event.target.value === "default") {
                          setExportAudioBitrate(undefined);
                          return;
                        }
                        setExportAudioBitrate(Number(event.target.value));
                      }}
                    >
                      {exportAudioCodec === "aac" ? (
                        <>
                          <option value="default">Adapter default</option>
                          <option value="96">96</option>
                          <option value="128">128</option>
                          <option value="192">192</option>
                          <option value="256">256</option>
                          <option value="320">320</option>
                        </>
                      ) : (
                        <option value="default">Not applicable</option>
                      )}
                    </select>
                  </label>
                  <label>
                    Audio sample rate
                    <select
                      value={exportAudioSampleRate}
                      onChange={(event) => {
                        setOverrideFields((current) =>
                          new Set(current).add("audioSampleRate"),
                        );
                        setExportAudioSampleRate(
                          event.target.value as "source" | "44100" | "48000",
                        );
                      }}
                    >
                      <option value="source">Source</option>
                      <option value="44100">44.1 kHz</option>
                      <option value="48000">48 kHz</option>
                    </select>
                  </label>
                  <label>
                    Audio channels
                    <select
                      value={exportAudioChannels}
                      onChange={(event) => {
                        setOverrideFields((current) =>
                          new Set(current).add("audioChannels"),
                        );
                        setExportAudioChannels(
                          event.target.value as "source" | "1" | "2",
                        );
                      }}
                    >
                      <option value="source">Source</option>
                      <option value="1">Mono</option>
                      <option value="2">Stereo</option>
                    </select>
                  </label>
                </div>
                {installedRendererIds ? (
                  <p className="muted">
                    Export-only availability reflects this local worker. Logged
                    export availability remains canonical until a worker is
                    registered for delivery.
                  </p>
                ) : null}
                <label className="export-checkbox">
                  <input
                    type="checkbox"
                    checked={omitEnglishSubtitles}
                    disabled={sourceLanguageClass !== "confirmed_english"}
                    onChange={(event) => {
                      setOverrideFields((current) =>
                        new Set(current).add(
                          "omitSubtitleFilesForConfirmedEnglish",
                        ),
                      );
                      setOmitEnglishSubtitles(event.target.checked);
                    }}
                  />
                  Omit subtitle files for confirmed-English videos
                </label>
                {sourceLanguageClass !== "confirmed_english" ? (
                  <p className="muted">
                    Omission is ineligible here: foreign, mixed, and unknown
                    sources always require original + English sidecars. A saved
                    true preference remains inert in the immutable settings.
                  </p>
                ) : null}
                <label className="export-checkbox">
                  <input
                    type="checkbox"
                    checked={embedEnglishSubtitles}
                    disabled={exportOnlySettingsState !== "ready"}
                    onChange={(event) => {
                      setOverrideFields((current) =>
                        new Set(current).add("embedEnglishSubtitleTrack"),
                      );
                      setEmbedEnglishSubtitles(event.target.checked);
                    }}
                  />
                  Embed an English soft-subtitle track
                </label>
                {exportOnlySettingsState !== "ready" ? (
                  <p className="muted">
                    Resolve an eligible local renderer before enabling English
                    soft subtitles.
                  </p>
                ) : null}
              </details>
              <p className="muted">
                Export source: YouTube video ID{" "}
                {sourceRights?.youtubeVideoId ?? "unavailable"}
              </p>
              <label className="export-checkbox">
                <input
                  type="checkbox"
                  checked={sourceRightsConfirmed}
                  disabled={!selectedVideoSnapshot}
                  onChange={(event) =>
                    setSourceRightsConfirmed(event.target.checked)
                  }
                />
                I confirm I am authorized to process this exact YouTube source
                for export.
              </label>
              <div className="selection-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={
                    clipActionBusy ||
                    Boolean(loggedClipId) ||
                    !authorization ||
                    !projectId ||
                    !user ||
                    !selectedVideoSnapshot ||
                    !languageEvidenceReady ||
                    offlineCachedWorkspace
                  }
                  onClick={() => void queueClipOnly()}
                >
                  {loggedClipId ? "Logged" : "Queue / log only"}
                </button>
                <button
                  type="button"
                  disabled={
                    clipActionBusy ||
                    Boolean(loggedExportRequestId) ||
                    !authorization ||
                    !projectId ||
                    !user ||
                    !selectedVideoSnapshot ||
                    !languageEvidenceReady ||
                    offlineCachedWorkspace ||
                    !sourceRightsConfirmed ||
                    loggedSettingsState !== "ready"
                  }
                  onClick={() => void requestLoggedExport()}
                >
                  {loggedExportRequestId ? "Export queued" : "Export + log"}
                </button>
                <button
                  type="button"
                  disabled={
                    clipActionBusy ||
                    Boolean(exportOnlyRequestId) ||
                    !selectedVideoSnapshot ||
                    !sourceRightsConfirmed ||
                    exportOnlySettingsState !== "ready"
                  }
                  onClick={() => void requestExportOnly()}
                >
                  {exportOnlyRequestId ? "Export-only queued" : "Export only"}
                </button>
                <button type="button" onClick={() => void copySelectionText()}>
                  Copy
                </button>
              </div>
              <span className="selection-action-help">
                Queue-only starts no media work. Export-only creates no project
                research record.
              </span>
              <p className="form-message" role="status">
                {clipActionMessage ??
                  (!projectId
                    ? "Choose a visible project before logging this selection."
                    : "Ready to log this selection without exporting it.")}
              </p>
              <p
                className={
                  selectionError ? "form-message error" : "form-message"
                }
              >
                {selectionError ??
                  "Export padding is adjustable; the transcript selection remains unchanged."}
              </p>
            </section>
          ) : null}
        </aside>
      </section>
      <BatchWorkspace
        authorization={authorization}
        {...(desktopAuthStatus ? { desktopAuthStatus } : {})}
        onDesktopSignIn={beginDesktopSignIn}
        onDesktopSignOut={completeDesktopSignOut}
        onAuthorizationChange={(value) => {
          setAuthorization(value);
          setProjects([]);
          selectProject("");
          setProjectMessage(undefined);
        }}
        onOpenVideo={loadVideoUrl}
        onOpenReadyVideo={(target) => {
          openProjectVideo(target);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onProjectChange={selectProject}
        onProjectsChange={setProjects}
        projectId={projectId}
        projects={projects}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
