import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiErrorSchema,
  ArtifactLocatorActionResultSchema,
  ArtifactLocatorSummarySchema,
  ArtifactResolutionResultSchema,
  ArtifactRootListResponseSchema,
  ClipLibraryExportSubmissionSchema,
  ClipCandidateSchema,
  ClipCommentPageSchema,
  ClipCommentSchema,
  OfflineClipCommentMutationResultSchema,
  OfflineClipCommentReplayResultSchema,
  ClipFollowSchema,
  ClipTagNameSchema,
  ExportStoragePreflightSchema,
  formatLanguageLabel,
  LocalClipLibrarySelectionSchema,
  LocalClipLibraryPageSchema,
  ProjectExportPresetCatalogSchema,
  type ClipCandidate,
  type ClipComment,
  type DesktopNotificationNavigationTarget,
  type ArtifactResolutionResult,
  type ArtifactRootSummary,
  type ClipLibraryEntry,
  type ExportSettingsSelection,
  type ExportStoragePreflight,
  type LocalClipLibraryPage,
} from "@research-video/contracts";
import { apiFetch } from "./api-client.ts";

type CloudRequest = (path: string, init?: RequestInit) => Promise<unknown>;

type ClipQueueProps = {
  authorization: string;
  projectId: string;
  notificationTarget?: DesktopNotificationNavigationTarget;
  request: CloudRequest;
  onOpenSourceClip(
    clip: ClipCandidate,
    fallbackNotice?: string,
    sourceTimeMs?: number,
  ): void;
};

export function ClipQueue({
  authorization,
  projectId,
  notificationTarget,
  request,
  onOpenSourceClip,
}: ClipQueueProps) {
  const [entries, setEntries] = useState<ClipLibraryEntry[]>([]);
  const [page, setPage] = useState<LocalClipLibraryPage>();
  const [localAvailability, setLocalAvailability] = useState<
    LocalClipLibraryPage["localAvailability"]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [topicMatch, setTopicMatch] = useState<"any" | "all">("any");
  const [topicGrouping, setTopicGrouping] = useState(false);
  const [researchFilter, setResearchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [completedFilter, setCompletedFilter] = useState("any");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [editingClipId, setEditingClipId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [commentsByClip, setCommentsByClip] = useState<
    Map<string, ClipComment[]>
  >(() => new Map());
  const [notificationClip, setNotificationClip] = useState<ClipCandidate>();
  const [commentDrafts, setCommentDrafts] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [commentAnchorDrafts, setCommentAnchorDrafts] = useState<
    Map<string, string>
  >(() => new Map());
  const [editingCommentId, setEditingCommentId] = useState<string>();
  const [commentEditDraft, setCommentEditDraft] = useState("");
  const [commentEditAnchorDraft, setCommentEditAnchorDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading project Clip Library…");
  const [settingsSelection, setSettingsSelection] =
    useState<ExportSettingsSelection>({
      base: "context_default",
      overrides: {},
    });
  const [presetOptions, setPresetOptions] = useState<
    Array<{ key: string; label: string; selection: ExportSettingsSelection }>
  >([]);
  const [presetKey, setPresetKey] = useState("context_default");
  const [preflight, setPreflight] = useState<ExportStoragePreflight>();
  const [confirmUnknownSources, setConfirmUnknownSources] = useState(false);
  const [sourceRightsConfirmed, setSourceRightsConfirmed] = useState(false);
  const [reexportArtifactVersionId, setReexportArtifactVersionId] =
    useState<string>();
  const [artifactRoots, setArtifactRoots] = useState<ArtifactRootSummary[]>([]);
  const [resolutions, setResolutions] = useState<
    Map<string, ArtifactResolutionResult>
  >(() => new Map());
  const requestGeneration = useRef(0);

  function pagePath(
    cursor?: string,
    resetFilters = false,
    restoreLatest = false,
  ) {
    if (restoreLatest) {
      return `/api/projects/${projectId}/clip-library/latest`;
    }
    const parameters = new URLSearchParams({
      limit: "25",
      completed: resetFilters ? "any" : completedFilter,
    });
    if (cursor) parameters.set("cursor", cursor);
    if (!resetFilters && query.trim()) parameters.set("query", query.trim());
    if (!resetFilters && tagFilter.trim()) {
      parameters.set("topics", tagFilter.trim());
      parameters.set("topicMatch", topicMatch);
    }
    if (!resetFilters && researchFilter !== "all")
      parameters.set("researchStatus", researchFilter);
    if (!resetFilters && statusFilter !== "all")
      parameters.set("exportStatus", statusFilter);
    return `/api/projects/${projectId}/clip-library?${parameters}`;
  }

  async function reload(
    cursor?: string,
    resetFilters = false,
    restoreLatest = false,
  ) {
    if (!projectId || !authorization) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    try {
      const response = await apiFetch(
        "local",
        pagePath(cursor, resetFilters, restoreLatest),
        {},
        authorization,
      );
      if (restoreLatest && response.status === 503) {
        await reload(undefined, true);
        return;
      }
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error("Unable to load the Clip Library.");
      const loaded = LocalClipLibraryPageSchema.parse(payload);
      if (generation !== requestGeneration.current) return;
      if (restoreLatest) {
        setQuery(loaded.query.query ?? "");
        setTagFilter(loaded.query.topics?.join(", ") ?? loaded.query.tag ?? "");
        setTopicMatch(loaded.query.topicMatch ?? "any");
        setResearchFilter(loaded.query.researchStatus ?? "all");
        setStatusFilter(loaded.query.exportStatus ?? "all");
        setCompletedFilter(loaded.query.completed);
      }
      setPage(loaded);
      setLocalAvailability((current) =>
        cursor
          ? [
              ...current,
              ...loaded.localAvailability.filter(
                (availability) =>
                  !current.some(
                    (candidate) =>
                      candidate.artifactVersionId ===
                      availability.artifactVersionId,
                  ),
              ),
            ]
          : loaded.localAvailability,
      );
      setEntries((current) =>
        cursor
          ? [
              ...current,
              ...loaded.entries.filter(
                (entry) =>
                  !current.some(
                    (candidate) => candidate.clip.id === entry.clip.id,
                  ),
              ),
            ]
          : loaded.entries,
      );
      setSelected((current) =>
        cursor
          ? new Set([...current, ...loaded.selectedClipIds])
          : new Set(loaded.selectedClipIds),
      );
      setMessage(
        loaded.freshness === "stale"
          ? `Offline cached subset from ${new Date(loaded.cachedAt).toLocaleString()}. Cloud changes and mutations are unavailable.`
          : "",
      );
      if (!cursor) {
        void request(`/api/projects/${projectId}/clip-tags`)
          .then((tags) => {
            if (generation === requestGeneration.current) {
              setSuggestedTags(ClipTagNameSchema.array().parse(tags));
            }
          })
          .catch(() => undefined);
        void request(`/api/projects/${projectId}/export-presets`)
          .then((payload) => {
            if (generation !== requestGeneration.current) return;
            const catalog = ProjectExportPresetCatalogSchema.parse(payload);
            setPresetOptions([
              {
                key: "context_default",
                label: "Project default",
                selection: { base: "context_default", overrides: {} },
              },
              {
                key: "application_default",
                label: "Editing MP4",
                selection: { base: "application_default", overrides: {} },
              },
              ...catalog.projectPresets.map((preset) => ({
                key: `project:${preset.id}:${preset.currentVersion}`,
                label: `${preset.current.name} (project v${preset.currentVersion})`,
                selection: {
                  base: "context_default" as const,
                  selectedPreset: {
                    scope: "project" as const,
                    presetId: preset.id,
                    presetVersion: preset.currentVersion,
                  },
                  overrides: {},
                },
              })),
              ...catalog.personalPresets.map((preset) => ({
                key: `personal:${preset.id}:${preset.currentVersion}`,
                label: `${preset.current.name} (personal v${preset.currentVersion})`,
                selection: {
                  base: "context_default" as const,
                  selectedPreset: {
                    scope: "personal" as const,
                    presetId: preset.id,
                    presetVersion: preset.currentVersion,
                  },
                  overrides: {},
                },
              })),
            ]);
          })
          .catch(() => undefined);
        void apiFetch("local", "/api/artifact-roots", {}, authorization)
          .then(async (response) => {
            if (!response.ok) return undefined;
            return ArtifactRootListResponseSchema.parse(await response.json());
          })
          .then((roots) => {
            if (roots && generation === requestGeneration.current) {
              setArtifactRoots(roots.roots);
            }
          })
          .catch(() => undefined);
      }
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error ? error.message : "Unable to load clips.",
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  useEffect(() => {
    requestGeneration.current += 1;
    setEntries([]);
    setPage(undefined);
    setLocalAvailability([]);
    setSelected(new Set());
    setEditingClipId(undefined);
    setQuery("");
    setTagFilter("");
    setTopicMatch("any");
    setTopicGrouping(false);
    setResearchFilter("all");
    setStatusFilter("all");
    setCompletedFilter("any");
    setAvailabilityFilter("all");
    setPreflight(undefined);
    setConfirmUnknownSources(false);
    setSourceRightsConfirmed(false);
    setReexportArtifactVersionId(undefined);
    setArtifactRoots([]);
    setResolutions(new Map());
    setCommentsByClip(new Map());
    setNotificationClip(undefined);
    setCommentDrafts(new Map());
    setCommentAnchorDrafts(new Map());
    setEditingCommentId(undefined);
    setCommentEditDraft("");
    setCommentEditAnchorDraft("");
    setPresetKey("context_default");
    setSettingsSelection({ base: "context_default", overrides: {} });
    void reload(undefined, true, true);
    // Reads use the current in-memory credential and restart through the local
    // authorization-fingerprint cache only after the same credential returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, authorization]);

  useEffect(() => {
    if (
      !notificationTarget ||
      (notificationTarget.kind !== "logged_export" &&
        notificationTarget.kind !== "mention") ||
      notificationTarget.projectId !== projectId ||
      !authorization
    ) {
      return;
    }
    const clipId = notificationTarget.clipId;
    let active = true;
    void Promise.all([
      request(`/api/projects/${projectId}/clips/${clipId}`).then((payload) =>
        ClipCandidateSchema.parse(payload),
      ),
      notificationTarget.kind === "mention"
        ? request(
            `/api/projects/${projectId}/clips/${clipId}/comments/${notificationTarget.commentId}`,
          ).then((payload) => ClipCommentSchema.parse(payload))
        : Promise.resolve(undefined),
    ])
      .then(([clip, comment]) => {
        if (!active) return;
        setNotificationClip(clip);
        if (comment) {
          setCommentsByClip((current) =>
            new Map(current).set(clipId, [comment]),
          );
        }
        setMessage(
          notificationTarget.kind === "mention"
            ? "Opened the exact mentioned clip comment."
            : "Opened the export request clip.",
        );
      })
      .catch((error) => {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "The notification target is no longer available.",
          );
        }
      });
    return () => {
      active = false;
    };
    // The request adapter is stable for the mounted Clip Library.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorization, notificationTarget, projectId]);

  useEffect(() => {
    if (
      !notificationTarget ||
      (notificationTarget.kind !== "logged_export" &&
        notificationTarget.kind !== "mention") ||
      notificationClip?.id !== notificationTarget.clipId
    ) {
      return;
    }
    if (
      notificationTarget.kind === "mention" &&
      !commentsByClip
        .get(notificationTarget.clipId)
        ?.some((comment) => comment.id === notificationTarget.commentId)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const anchor =
        notificationTarget.kind === "mention"
          ? document.getElementById(
              `clip-comment-${notificationTarget.commentId}`,
            )
          : document.getElementById(`clip-${notificationTarget.clipId}`);
      anchor?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [commentsByClip, notificationClip, notificationTarget]);

  const availabilityByVersion = useMemo(
    () =>
      new Map(
        localAvailability.map((availability) => [
          availability.artifactVersionId,
          availability.locators,
        ]),
      ),
    [localAvailability],
  );

  function entryAvailability(entry: ClipLibraryEntry) {
    const locators = entry.recentArtifactVersions.flatMap(
      (version) => availabilityByVersion.get(version.artifactVersionId) ?? [],
    );
    if (locators.some((locator) => locator.availability === "verified"))
      return "verified";
    if (locators.some((locator) => locator.availability === "invalid"))
      return "invalid";
    if (locators.some((locator) => locator.availability === "missing"))
      return "missing";
    return "none";
  }

  const visibleEntries = useMemo(
    () => {
      const filtered =
        availabilityFilter === "all"
          ? entries
          : entries.filter(
              (entry) => entryAvailability(entry) === availabilityFilter,
            );
      return topicGrouping
        ? [...filtered].toSorted((left, right) =>
            (left.clip.tags[0] ?? "No Topics").localeCompare(
              right.clip.tags[0] ?? "No Topics",
            ),
          )
        : filtered;
    },
    // Availability is a local filter over the cached subset, not a cloud-global
    // predicate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, availabilityFilter, availabilityByVersion, topicGrouping],
  );

  function beginEdit(clip: ClipCandidate) {
    if (page?.freshness !== "fresh") {
      setMessage(
        "Reconnect before changing shared clip descriptions or Topics.",
      );
      return;
    }
    setEditingClipId(clip.id);
    setNotes(clip.notes);
    setTagsText(clip.tags.join(", "));
    setMessage("");
  }

  async function saveEdit(clip: ClipCandidate) {
    if (page?.freshness !== "fresh") return;
    setBusy(true);
    try {
      const tags = tagsText
        .split(/[,\n]/u)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const updated = ClipCandidateSchema.parse(
        await request(`/api/projects/${projectId}/clips/${clip.id}`, {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: clip.version, notes, tags }),
        }),
      );
      setEntries((current) =>
        current.map((entry) =>
          entry.clip.id === updated.id ? { ...entry, clip: updated } : entry,
        ),
      );
      setSuggestedTags((current) =>
        [...new Set([...current, ...updated.tags])].toSorted((left, right) =>
          left.localeCompare(right),
        ),
      );
      setEditingClipId(undefined);
      setMessage(
        "Clip description and Topics saved. Refresh to update the cache.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Refresh before retrying; this edit is not replayed offline.`
          : "Unable to save clip.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateSelection(clipId: string, checked: boolean) {
    const generation = requestGeneration.current;
    const next = new Set(selected);
    if (checked) next.add(clipId);
    else next.delete(clipId);
    setSelected(next);
    setPreflight(undefined);
    setConfirmUnknownSources(false);
    setSourceRightsConfirmed(false);
    setReexportArtifactVersionId(undefined);
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clip-library/selection`,
        {
          method: "PUT",
          body: JSON.stringify({
            pageClipIds: [clipId],
            selectedClipIds: checked ? [clipId] : [],
          }),
        },
        authorization,
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error("Unable to persist clip selection.");
      if (generation !== requestGeneration.current) return;
      setSelected(
        new Set(LocalClipLibrarySelectionSchema.parse(payload).selectedClipIds),
      );
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error ? error.message : "Unable to save selection.",
        );
      }
    }
  }

  async function prepareExport(reexport?: {
    clipId: string;
    artifactVersionId: string;
  }) {
    const clipIds = reexport ? [reexport.clipId] : [...selected].toSorted();
    if (page?.freshness !== "fresh" || !clipIds.length) return;
    const generation = requestGeneration.current;
    setReexportArtifactVersionId(reexport?.artifactVersionId);
    if (reexport) setSelected(new Set([reexport.clipId]));
    setBusy(true);
    setPreflight(undefined);
    setConfirmUnknownSources(false);
    setSourceRightsConfirmed(false);
    setMessage("Resolving immutable settings and measuring storage…");
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clip-library/export-preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            clipIds,
            settingsSelection,
            ...(reexport
              ? { reexportArtifactVersionId: reexport.artifactVersionId }
              : {}),
          }),
        },
        authorization,
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw apiError(payload, "Unable to preflight export.");
      const prepared = ExportStoragePreflightSchema.parse(payload);
      if (generation !== requestGeneration.current) return;
      setPreflight(prepared);
      setMessage(
        prepared.decision === "insufficient"
          ? "The known export requirement does not fit. No request was created."
          : prepared.decision === "confirmation_required"
            ? "Source sizes are unavailable until acquisition. Review and confirm before submitting."
            : "Storage preflight passed. Review the immutable settings before submitting.",
      );
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to preflight export.",
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function submitExport() {
    if (!preflight || page?.freshness !== "fresh" || !sourceRightsConfirmed)
      return;
    const sourceRights = preflight.items.map((item) => {
      const clip = entries.find((entry) => entry.clip.id === item.clipId)?.clip;
      if (!clip) throw new Error("The selected clip is no longer available.");
      return {
        clipId: clip.id,
        sourceRights: {
          schemaVersion: 1,
          source: "youtube" as const,
          youtubeVideoId: clip.video.youtubeVideoId,
          confirmation: "authorized_to_process" as const,
          disclosureVersion: 1,
        },
      };
    });
    const generation = requestGeneration.current;
    setBusy(true);
    setMessage("Submitting the durable export command…");
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clip-library/exports`,
        {
          method: "POST",
          body: JSON.stringify({
            clipIds: [...selected].toSorted(),
            settingsSelection,
            ...(reexportArtifactVersionId ? { reexportArtifactVersionId } : {}),
            expectedPreflightFingerprint: preflight.preflightFingerprint,
            confirmUnknownSourceSizes: confirmUnknownSources,
            sourceRights,
          }),
        },
        authorization,
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw apiError(payload, "Unable to submit export.");
      const submitted = ClipLibraryExportSubmissionSchema.parse(payload);
      if (generation !== requestGeneration.current) return;
      const submittedMessage =
        submitted.kind === "batch"
          ? `Queued ${submitted.batch.summary.total} independent export requests.`
          : "Queued one durable export request.";
      setPreflight(undefined);
      setSourceRightsConfirmed(false);
      const reloadPromise = reload();
      const reloadGeneration = requestGeneration.current;
      await reloadPromise;
      if (reloadGeneration === requestGeneration.current)
        setMessage(submittedMessage);
    } catch (error) {
      if (generation === requestGeneration.current) {
        const failureMessage =
          error instanceof Error
            ? `${error.message} The Clip Library was refreshed to recover any request committed before the response was lost.`
            : "Unable to submit export.";
        const reloadPromise = reload();
        const reloadGeneration = requestGeneration.current;
        await reloadPromise;
        if (reloadGeneration === requestGeneration.current)
          setMessage(failureMessage);
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function mutateLeaf(requestId: string, action: "retry" | "cancel") {
    if (page?.freshness !== "fresh") return;
    const generation = requestGeneration.current;
    setBusy(true);
    try {
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/export-requests/${requestId}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `clip-library-${action}:${requestId}`,
          }),
        },
        authorization,
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok)
        throw apiError(payload, `Unable to ${action} this export.`);
      if (generation !== requestGeneration.current) return;
      setMessage(
        action === "retry"
          ? "Created or recovered the immutable retry child."
          : "Cancellation was requested without changing sibling exports.",
      );
      void reload();
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error
            ? error.message
            : `Unable to ${action} export.`,
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function resolveArtifact(
    clip: ClipCandidate,
    version: ClipLibraryEntry["recentArtifactVersions"][number],
    options: { announce?: boolean; refresh?: boolean } = {},
  ): Promise<ArtifactResolutionResult | undefined> {
    const generation = requestGeneration.current;
    const { text: _text, ...selection } = version.selection;
    const rendererCapabilityId =
      version.resolvedSettingsSnapshot.settings.videoCodec === "prores"
        ? "prores_mov"
        : version.resolvedSettingsSnapshot.settings.videoCodec === "hevc"
          ? "hevc_mkv"
          : "h264_mp4";
    setBusy(true);
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clips/${clip.id}/artifact-resolution`,
        {
          method: "POST",
          body: JSON.stringify({
            requirements: {
              clipId: clip.id,
              selection,
              resolvedBounds: {
                startMs: version.resolvedExportBounds.startMs,
                endMs: version.resolvedExportBounds.endMs,
              },
              sourceLanguageClass: version.sourceLanguageClass,
              ...(version.subtitleTracks
                ? { subtitleTracks: version.subtitleTracks }
                : {}),
              subtitlePolicy: version.subtitleOmissionProvenance
                ? {
                    requiredSidecars: [],
                    omittedReason: version.subtitleOmissionProvenance.policy,
                  }
                : version.sourceLanguageClass === "confirmed_english"
                  ? { requiredSidecars: ["english"] }
                  : { requiredSidecars: ["original", "english"] },
              requiredArtifactRoles: version.artifacts.map(
                (artifact) => artifact.role,
              ),
              acceptedManifestSchemas:
                version.manifest.schemaVersion === "unknown"
                  ? [1, 2]
                  : [version.manifest.schemaVersion],
              settings: version.resolvedSettingsSnapshot.resolutionFingerprint
                ? {
                    mode: "exact_fingerprint",
                    resolutionFingerprint:
                      version.resolvedSettingsSnapshot.resolutionFingerprint,
                  }
                : {
                    mode: "accepted_renderer_profiles",
                    rendererCapabilityIds: [rendererCapabilityId],
                  },
            },
          }),
        },
        authorization,
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw apiError(payload, "Unable to resolve artifact.");
      const resolution = ArtifactResolutionResultSchema.parse(payload);
      if (generation !== requestGeneration.current) return undefined;
      setResolutions((current) =>
        new Map(current).set(version.artifactVersionId, resolution),
      );
      if (options.announce !== false)
        setMessage(
          `Artifact resolution: ${resolution.state.replaceAll("_", " ")}.`,
        );
      if (options.refresh !== false) void reload();
      return resolution;
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to resolve artifact.",
        );
      }
      return undefined;
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function actOnArtifact(
    locatorId: string,
    action: "verify" | "reveal" | "open" | "relink",
    targetRootId?: string,
  ): Promise<boolean> {
    if (action === "relink" && page?.freshness !== "fresh") {
      setMessage("Reconnect before relinking a project artifact.");
      return false;
    }
    const generation = requestGeneration.current;
    setBusy(true);
    try {
      const response = await apiFetch(
        "local",
        `/api/artifact-locators/${locatorId}/${action}`,
        {
          method: "POST",
          body:
            action === "relink"
              ? JSON.stringify({ targetRootId })
              : JSON.stringify({}),
        },
        authorization,
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok)
        throw apiError(payload, `Unable to ${action} local artifact.`);
      const actionResult =
        action !== "relink"
          ? ArtifactLocatorActionResultSchema.parse(payload)
          : undefined;
      if (generation !== requestGeneration.current) return false;
      if (actionResult) {
        setMessage(
          actionResult.freshness === "stale"
            ? `Local artifact ${action} completed after fresh byte verification under the cached authorization scope.`
            : `Local artifact ${action} completed after full verification.`,
        );
      } else {
        ArtifactLocatorSummarySchema.parse(payload);
        setMessage("Local artifact relink completed after full verification.");
      }
      void reload();
      return true;
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error
            ? error.message
            : `Unable to ${action} local artifact.`,
        );
      }
      return false;
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function openClip(entry: ClipLibraryEntry) {
    let artifactFailure = false;
    for (const version of entry.recentArtifactVersions) {
      const cachedResolution = resolutions.get(version.artifactVersionId);
      const resolution =
        cachedResolution ??
        (await resolveArtifact(entry.clip, version, {
          announce: false,
          refresh: false,
        }));
      if (!resolution) {
        artifactFailure = true;
        continue;
      }
      if (resolution.state !== "reusable_local") continue;
      const opened = await actOnArtifact(resolution.locator.id, "open");
      if (opened) return;
      artifactFailure = true;
    }
    const fallbackNotice = artifactFailure
      ? "A compatible local artifact could not be freshly verified, so VERA opened the authorized source range instead."
      : undefined;
    if (fallbackNotice) setMessage(fallbackNotice);
    onOpenSourceClip(entry.clip, fallbackNotice);
  }

  async function loadComments(clipId: string) {
    try {
      const replayResponse = await apiFetch(
        "local",
        `/api/projects/${projectId}/clip-comment-outbox/replay`,
        { method: "POST" },
        authorization,
      );
      if (replayResponse.ok) {
        const replay = OfflineClipCommentReplayResultSchema.parse(
          await replayResponse.json(),
        );
        if (replay.conflicts > 0) {
          setMessage(
            `${replay.conflicts} offline comment edit requires conflict review; no author data was discarded.`,
          );
        }
      }
      const comments: ClipComment[] = [];
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const parameters = new URLSearchParams({ limit: "50" });
        if (cursor) parameters.set("cursor", cursor);
        const commentPage = ClipCommentPageSchema.parse(
          await request(
            `/api/projects/${projectId}/clips/${clipId}/comments?${parameters}`,
          ),
        );
        comments.push(...commentPage.comments);
        cursor = commentPage.nextCursor;
        if (!cursor) break;
      }
      setCommentsByClip((current) => new Map(current).set(clipId, comments));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load comments.",
      );
    }
  }

  async function createComment(clipId: string) {
    const body = commentDrafts.get(clipId)?.trim();
    if (!body || page?.freshness !== "fresh") return;
    const sourceTimeSeconds = Number(commentAnchorDrafts.get(clipId));
    setBusy(true);
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clips/${clipId}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `vera-comment:${clipId}:${crypto.randomUUID()}`,
            body,
            ...(Number.isFinite(sourceTimeSeconds) && sourceTimeSeconds >= 0
              ? { sourceTimeMs: Math.round(sourceTimeSeconds * 1_000) }
              : {}),
          }),
        },
        authorization,
      );
      const result = OfflineClipCommentMutationResultSchema.parse(
        await response.json(),
      );
      if (result.state === "queued") {
        setCommentDrafts((current) => new Map(current).set(clipId, ""));
        setCommentAnchorDrafts((current) => new Map(current).set(clipId, ""));
        setMessage(
          "Comment queued offline and will replay in order after reconnecting.",
        );
        return;
      }
      if (result.state === "conflict") {
        setMessage(
          `Comment was retained for conflict review (${result.code}); refresh before resolving it.`,
        );
        return;
      }
      const comment = ClipCommentSchema.parse(result.comment);
      setCommentsByClip((current) =>
        new Map(current).set(clipId, [...(current.get(clipId) ?? []), comment]),
      );
      setCommentDrafts((current) => new Map(current).set(clipId, ""));
      setCommentAnchorDrafts((current) => new Map(current).set(clipId, ""));
      setMessage("Comment added; this clip is now followed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to add comment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function setFollowing(clipId: string, following: boolean) {
    setBusy(true);
    try {
      ClipFollowSchema.parse(
        await request(`/api/projects/${projectId}/clips/${clipId}/follow`, {
          method: "PUT",
          body: JSON.stringify({
            idempotencyKey: `vera-follow:${clipId}:${following}:${crypto.randomUUID()}`,
            following,
          }),
        }),
      );
      setMessage(following ? "Following clip comments." : "Clip unfollowed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to update follow.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateComment(clipId: string, comment: ClipComment) {
    if (!commentEditDraft.trim()) return;
    const sourceTimeSeconds = Number(commentEditAnchorDraft);
    setBusy(true);
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clips/${clipId}/comments/${comment.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            idempotencyKey: `vera-comment-edit:${comment.id}:${crypto.randomUUID()}`,
            expectedVersion: comment.version,
            body: commentEditDraft.trim(),
            sourceTimeMs:
              commentEditAnchorDraft.trim() &&
              Number.isFinite(sourceTimeSeconds) &&
              sourceTimeSeconds >= 0
                ? Math.round(sourceTimeSeconds * 1_000)
                : null,
          }),
        },
        authorization,
      );
      const result = OfflineClipCommentMutationResultSchema.parse(
        await response.json(),
      );
      if (result.state === "applied") {
        setCommentsByClip((current) =>
          new Map(current).set(
            clipId,
            (current.get(clipId) ?? []).map((candidate) =>
              candidate.id === comment.id ? result.comment : candidate,
            ),
          ),
        );
        setEditingCommentId(undefined);
        setMessage("Comment updated.");
      } else {
        setMessage(
          result.state === "queued"
            ? "Comment edit queued offline; its original text remains visible until replay."
            : `Comment edit retained for conflict review (${result.code}).`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to update comment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(clipId: string, comment: ClipComment) {
    if (
      !window.confirm("Delete this comment? Its audit tombstone will remain.")
    )
      return;
    setBusy(true);
    try {
      const response = await apiFetch(
        "local",
        `/api/projects/${projectId}/clips/${clipId}/comments/${comment.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            idempotencyKey: `vera-comment-delete:${comment.id}:${crypto.randomUUID()}`,
            expectedVersion: comment.version,
          }),
        },
        authorization,
      );
      const result = OfflineClipCommentMutationResultSchema.parse(
        await response.json(),
      );
      if (result.state === "applied") {
        setCommentsByClip((current) =>
          new Map(current).set(
            clipId,
            (current.get(clipId) ?? []).map((candidate) =>
              candidate.id === comment.id ? result.comment : candidate,
            ),
          ),
        );
        setMessage("Comment deleted; its body is no longer available.");
      } else {
        setMessage(
          result.state === "queued"
            ? "Comment deletion queued offline."
            : `Comment deletion retained for conflict review (${result.code}).`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete comment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    setBusy(true);
    try {
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/clips.csv`,
        {},
        authorization,
      );
      if (!response.ok) throw new Error("Unable to export the project CSV.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `project-clips-${projectId}.csv`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setMessage("Downloaded the project clip log as CSV.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to export the project CSV.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadCommentsCsv() {
    setBusy(true);
    try {
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/clip-comments.csv`,
        {},
        authorization,
      );
      if (!response.ok) throw new Error("Unable to export comments CSV.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `project-clip-comments-${projectId}.csv`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setMessage("Downloaded the authorized project comments CSV.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to export comments.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="queue-card clip-queue"
      aria-labelledby="clip-library-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Project research log</p>
          <h3 id="clip-library-title">Clip Library</h3>
        </div>
        <div className="clip-queue-actions">
          <button
            type="button"
            disabled={busy || page?.freshness !== "fresh"}
            onClick={() => void downloadCsv()}
          >
            Export CSV
          </button>
          <button
            type="button"
            disabled={busy || page?.freshness !== "fresh"}
            onClick={() => void downloadCommentsCsv()}
          >
            Export comments CSV
          </button>
          <button type="button" disabled={busy} onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </div>
      <div className="clip-filter-grid">
        <label>
          Search clips
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Passage, description, comment, Topic, or video"
          />
        </label>
        <label>
          Topics
          <input
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            list="project-topic-suggestions"
            placeholder="Comma-separated Topics"
          />
        </label>
        <label>
          Topic matching
          <select
            value={topicMatch}
            onChange={(event) =>
              setTopicMatch(event.target.value as "any" | "all")
            }
          >
            <option value="any">Match any</option>
            <option value="all">Match all</option>
          </select>
        </label>
        <label>
          Topic grouping
          <select
            value={topicGrouping ? "topic" : "none"}
            onChange={(event) =>
              setTopicGrouping(event.target.value === "topic")
            }
          >
            <option value="none">Canonical order</option>
            <option value="topic">Group by first Topic</option>
          </select>
        </label>
        <label>
          Research status
          <select
            value={researchFilter}
            onChange={(event) => setResearchFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="candidate">Candidate</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Export status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="not_requested">Not requested</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
        </label>
        <label>
          Completed versions
          <select
            value={completedFilter}
            onChange={(event) => setCompletedFilter(event.target.value)}
          >
            <option value="any">Any</option>
            <option value="yes">Has completed version</option>
            <option value="no">No completed version</option>
          </select>
        </label>
        <label>
          This cached subset
          <select
            value={availabilityFilter}
            onChange={(event) => setAvailabilityFilter(event.target.value)}
          >
            <option value="all">Any local state</option>
            <option value="verified">Verified locally</option>
            <option value="missing">Missing locally</option>
            <option value="invalid">Invalid locally</option>
            <option value="none">No local locator</option>
          </select>
        </label>
      </div>
      <div className="action-row">
        <button type="button" disabled={busy} onClick={() => void reload()}>
          Apply cloud filters
        </button>
      </div>
      <section className="clip-library-export" aria-label="Clip export">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Durable export</p>
            <h4>Export selected clips</h4>
          </div>
        </div>
        <label>
          Conversion preset
          <select
            value={presetKey}
            disabled={busy || page?.freshness !== "fresh"}
            onChange={(event) => {
              const option = presetOptions.find(
                (candidate) => candidate.key === event.target.value,
              );
              if (!option) return;
              setPresetKey(option.key);
              setSettingsSelection(option.selection);
              setPreflight(undefined);
              setConfirmUnknownSources(false);
            }}
          >
            {(presetOptions.length
              ? presetOptions
              : [
                  {
                    key: "context_default",
                    label: "Project default",
                    selection: settingsSelection,
                  },
                ]
            ).map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="action-row">
          <button
            type="button"
            disabled={
              busy ||
              page?.freshness !== "fresh" ||
              selected.size < 1 ||
              selected.size > 25
            }
            onClick={() => void prepareExport()}
          >
            Preflight {selected.size || "selected"} clip
            {selected.size === 1 ? "" : "s"}
          </button>
        </div>
        {preflight ? (
          <div className="clip-library-preflight">
            <p>
              {formatBytes(preflight.availableBytes)} available ·{" "}
              {formatBytes(preflight.outputEstimatedBytes)} estimated outputs ·{" "}
              {formatBytes(preflight.promotionReserveBytes)} promotion copy ·{" "}
              {formatBytes(preflight.activeCheckpointReserveBytes)} active
              update/checkpoint reserve ·{" "}
              {formatBytes(preflight.safetyReserveBytes)} safety margin
            </p>
            <p>
              {preflight.uniqueSourceCount} compatible source
              {preflight.uniqueSourceCount === 1 ? "" : "s"} on this workstation
              · {preflight.unknownSourceCount} unknown before acquisition
            </p>
            <ul>
              {preflight.items.map((item) => {
                const clip = entries.find(
                  (entry) => entry.clip.id === item.clipId,
                )?.clip;
                const settings = item.resolvedSettingsSnapshot.settings;
                return (
                  <li key={item.clipId}>
                    {clip?.video.title ?? "Selected clip"} (YouTube ID:{" "}
                    {clip?.video.youtubeVideoId ?? "unavailable"}):{" "}
                    {settings.videoCodec.toUpperCase()} /{" "}
                    {settings.audioCodec.toUpperCase()} /{" "}
                    {settings.container.toUpperCase()} ·{" "}
                    {formatBytes(item.outputEstimatedBytes)} estimated ·
                    fingerprint{" "}
                    {item.resolvedSettingsSnapshot.resolutionFingerprint?.slice(
                      0,
                      12,
                    )}
                  </li>
                );
              })}
            </ul>
            {preflight.decision === "confirmation_required" ? (
              <label className="export-checkbox">
                <input
                  type="checkbox"
                  checked={confirmUnknownSources}
                  onChange={(event) =>
                    setConfirmUnknownSources(event.target.checked)
                  }
                />
                Continue with unknown source sizes and recheck measured space
                before rendering
              </label>
            ) : null}
            <label className="export-checkbox">
              <input
                type="checkbox"
                checked={sourceRightsConfirmed}
                onChange={(event) =>
                  setSourceRightsConfirmed(event.target.checked)
                }
              />
              I confirm I am authorized to process every exact YouTube source
              listed above for this export.
            </label>
            <button
              type="button"
              disabled={
                busy ||
                preflight.decision === "insufficient" ||
                !sourceRightsConfirmed ||
                (preflight.decision === "confirmation_required" &&
                  !confirmUnknownSources)
              }
              onClick={() => void submitExport()}
            >
              Submit durable {preflight.items.length === 1 ? "export" : "batch"}
            </button>
          </div>
        ) : null}
      </section>
      <p className="form-message" role="status">
        {message ||
          `${visibleEntries.length} cached result${visibleEntries.length === 1 ? "" : "s"}; ${selected.size} selected.`}
      </p>
      {notificationClip &&
      !visibleEntries.some((entry) => entry.clip.id === notificationClip.id) ? (
        <section
          className="clip-card notification-target-card"
          id={`clip-${notificationClip.id}`}
          aria-label="Notification target clip"
        >
          <div className="clip-card-heading">
            <div>
              <strong>{notificationClip.video.title}</strong>
              <span>
                {formatTime(notificationClip.selection.exportStartMs)}–
                {formatTime(notificationClip.selection.exportEndMs)} · exact
                notification target
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenSourceClip(notificationClip)}
            >
              Open source
            </button>
          </div>
          {(commentsByClip.get(notificationClip.id) ?? []).map((comment) => (
            <article
              className="clip-comment"
              id={`clip-comment-${comment.id}`}
              key={comment.id}
            >
              <strong>@{comment.author.handle}</strong>
              {comment.status === "active" ? (
                <p>{comment.body}</p>
              ) : (
                <p>Deleted comment</p>
              )}
            </article>
          ))}
        </section>
      ) : null}
      {visibleEntries.length ? (
        <div className="clip-list">
          {visibleEntries.map((entry) => {
            const clip = entry.clip;
            const editing = editingClipId === clip.id;
            const localState = entryAvailability(entry);
            return (
              <section
                className="clip-card"
                id={`clip-${clip.id}`}
                key={clip.id}
              >
                <div className="clip-card-heading">
                  <div>
                    <label className="clip-library-select">
                      <input
                        type="checkbox"
                        checked={selected.has(clip.id)}
                        onChange={(event) =>
                          void updateSelection(clip.id, event.target.checked)
                        }
                      />
                      Select {clip.video.title}
                    </label>
                    <strong>{clip.video.title}</strong>
                    <span>
                      {formatTime(clip.selection.exportStartMs)}–
                      {formatTime(clip.selection.exportEndMs)} ·{" "}
                      {clip.exportStatus.replaceAll("_", " ")}
                    </span>
                    <span>
                      History: {entry.completedVersionCount} completed ·
                      Workstation:{" "}
                      {localState === "none"
                        ? "no verified locator"
                        : localState}
                    </span>
                    <span>
                      Comments: {entry.commentCount ?? 0}
                      {entry.latestCommentAt
                        ? ` · latest ${new Date(entry.latestCommentAt).toLocaleString()}`
                        : ""}
                    </span>
                    {topicGrouping ? (
                      <span>Topic group: {clip.tags[0] ?? "No Topics"}</span>
                    ) : null}
                    {entry.matchingComment ? (
                      <button
                        type="button"
                        onClick={() => {
                          void loadComments(clip.id);
                          if (entry.matchingComment?.sourceTimeMs !== undefined)
                            onOpenSourceClip(
                              clip,
                              "Opened the matching comment time anchor.",
                              entry.matchingComment.sourceTimeMs,
                            );
                        }}
                      >
                        Matching comment by @
                        {entry.matchingComment.author.handle}
                      </button>
                    ) : null}
                    {entry.currentLeaves.map((leaf) => (
                      <span key={leaf.requestId}>
                        Export {leaf.state.replaceAll("_", " ")}
                        {leaf.retryOrdinal
                          ? ` · retry ${leaf.retryOrdinal}`
                          : ""}
                        {leaf.progress
                          ? ` · ${leaf.progress.stage.replaceAll("_", " ")} ${Math.floor(leaf.progress.basisPoints / 100)}%`
                          : ""}
                        {leaf.state === "failed" ? (
                          <button
                            type="button"
                            disabled={busy || page?.freshness !== "fresh"}
                            onClick={() =>
                              void mutateLeaf(leaf.requestId, "retry")
                            }
                          >
                            Retry
                          </button>
                        ) : null}
                        {["queued", "claimed", "processing"].includes(
                          leaf.state,
                        ) ? (
                          <button
                            type="button"
                            disabled={busy || page?.freshness !== "fresh"}
                            onClick={() =>
                              void mutateLeaf(leaf.requestId, "cancel")
                            }
                          >
                            Cancel
                          </button>
                        ) : null}
                      </span>
                    ))}
                    {entry.hasMoreLeaves ? (
                      <span>Additional export lineages are available.</span>
                    ) : null}
                  </div>
                  <div className="clip-card-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openClip(entry)}
                    >
                      Open clip
                    </button>
                    <button
                      type="button"
                      disabled={busy || page?.freshness !== "fresh"}
                      onClick={() => beginEdit(clip)}
                    >
                      Edit description/Topics
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void loadComments(clip.id)}
                    >
                      Comments
                    </button>
                  </div>
                </div>
                {clip.languageEvidence.schemaVersion === 2 ? (
                  <div className="clip-language-evidence">
                    <blockquote>
                      <strong>
                        Native —{" "}
                        {formatLanguageLabel(
                          clip.languageEvidence.native.language,
                        )}
                      </strong>
                      {clip.languageEvidence.native.text}
                    </blockquote>
                    <blockquote>
                      <strong>English</strong>
                      {clip.languageEvidence.english.text}
                    </blockquote>
                    {clip.languageEvidence.preferred ? (
                      <blockquote>
                        <strong>
                          Preferred —{" "}
                          {formatLanguageLabel(
                            clip.languageEvidence.preferred.language,
                          )}
                        </strong>
                        {clip.languageEvidence.preferred.text}
                      </blockquote>
                    ) : null}
                  </div>
                ) : (
                  <blockquote>{clip.englishText}</blockquote>
                )}
                {entry.recentArtifactVersions.length ? (
                  <details>
                    <summary>Recent immutable artifact history</summary>
                    <ul>
                      {entry.recentArtifactVersions.map((version) => {
                        const versionLocators =
                          availabilityByVersion.get(
                            version.artifactVersionId,
                          ) ?? [];
                        const resolution = resolutions.get(
                          version.artifactVersionId,
                        );
                        return (
                          <li key={version.artifactVersionId}>
                            <span>
                              {new Date(version.completedAt).toLocaleString()} ·{" "}
                              {version.artifacts.length} artifacts · manifest{" "}
                              {version.manifest.schemaVersion} · completion is
                              immutable · workstation{" "}
                              {resolution?.state.replaceAll("_", " ") ??
                                (versionLocators.length
                                  ? versionLocators[0]!.availability
                                  : "not resolved")}
                            </span>
                            <div className="action-row">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void resolveArtifact(clip, version)
                                }
                              >
                                Resolve
                              </button>
                              {versionLocators.map((locator) => (
                                <span key={locator.id}>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void actOnArtifact(locator.id, "verify")
                                    }
                                  >
                                    Verify
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      busy ||
                                      locator.availability !== "verified"
                                    }
                                    onClick={() =>
                                      void actOnArtifact(locator.id, "reveal")
                                    }
                                  >
                                    Reveal
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      busy ||
                                      locator.availability !== "verified"
                                    }
                                    onClick={() =>
                                      void actOnArtifact(locator.id, "open")
                                    }
                                  >
                                    Open artifact
                                  </button>
                                  {artifactRoots
                                    .filter(
                                      (root) =>
                                        root.enabled &&
                                        root.id !== locator.rootId,
                                    )
                                    .map((root) => (
                                      <button
                                        key={root.id}
                                        type="button"
                                        disabled={
                                          busy || page?.freshness !== "fresh"
                                        }
                                        onClick={() =>
                                          void actOnArtifact(
                                            locator.id,
                                            "relink",
                                            root.id,
                                          )
                                        }
                                      >
                                        Relink to {root.label}
                                      </button>
                                    ))}
                                </span>
                              ))}
                              <button
                                type="button"
                                disabled={busy || page?.freshness !== "fresh"}
                                onClick={() =>
                                  void prepareExport({
                                    clipId: clip.id,
                                    artifactVersionId:
                                      version.artifactVersionId,
                                  })
                                }
                              >
                                Preflight re-export
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
                {editing ? (
                  <div className="clip-edit-form">
                    <label>
                      Clip description / intended use
                      <textarea
                        aria-label={`Notes for ${clip.video.title}`}
                        rows={3}
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </label>
                    <label>
                      Topics
                      <input
                        aria-label={`Topics for ${clip.video.title}`}
                        list="project-topic-suggestions"
                        value={tagsText}
                        onChange={(event) => setTagsText(event.target.value)}
                      />
                    </label>
                    <div className="action-row">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveEdit(clip)}
                      >
                        Save clip
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingClipId(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {clip.notes ? (
                      <p className="clip-notes">{clip.notes}</p>
                    ) : null}
                    <div className="clip-tags" aria-label="Topics">
                      {clip.tags.length ? (
                        clip.tags.map((tag) => <span key={tag}>{tag}</span>)
                      ) : (
                        <span className="muted">No Topics</span>
                      )}
                    </div>
                  </>
                )}
                {commentsByClip.has(clip.id) ? (
                  <section className="clip-comments" aria-label="Clip comments">
                    <div className="section-heading">
                      <h4>Comments</h4>
                      <div className="action-row">
                        <button
                          type="button"
                          disabled={busy || page?.freshness !== "fresh"}
                          onClick={() => void setFollowing(clip.id, true)}
                        >
                          Follow
                        </button>
                        <button
                          type="button"
                          disabled={busy || page?.freshness !== "fresh"}
                          onClick={() => void setFollowing(clip.id, false)}
                        >
                          Unfollow
                        </button>
                      </div>
                    </div>
                    {(commentsByClip.get(clip.id) ?? []).map((comment) => (
                      <article
                        key={comment.id}
                        id={`clip-comment-${comment.id}`}
                        className="clip-comment"
                      >
                        <strong>@{comment.author.handle}</strong>{" "}
                        <span>
                          {new Date(comment.createdAt).toLocaleString()}
                        </span>
                        {comment.status === "active" ? (
                          <>
                            {editingCommentId === comment.id ? (
                              <div className="clip-edit-form">
                                <label>
                                  Edit comment
                                  <textarea
                                    value={commentEditDraft}
                                    onChange={(event) =>
                                      setCommentEditDraft(event.target.value)
                                    }
                                  />
                                </label>
                                <label>
                                  Optional source time (seconds)
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={commentEditAnchorDraft}
                                    onChange={(event) =>
                                      setCommentEditAnchorDraft(
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <div className="action-row">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void updateComment(clip.id, comment)
                                    }
                                  >
                                    Save comment
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      setEditingCommentId(undefined)
                                    }
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p>{comment.body}</p>
                            )}
                            {comment.sourceTimeMs !== undefined ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenSourceClip(
                                    clip,
                                    "Opened the selected comment time anchor.",
                                    comment.sourceTimeMs,
                                  )
                                }
                              >
                                Open at {formatTime(comment.sourceTimeMs)}
                              </button>
                            ) : null}
                            {comment.mentions?.length ? (
                              <span>
                                Mentions{" "}
                                {comment.mentions
                                  .map((mention) => `@${mention.handle}`)
                                  .join(", ")}
                              </span>
                            ) : null}
                            {editingCommentId !== comment.id ? (
                              <div className="action-row">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditingCommentId(comment.id);
                                    setCommentEditDraft(comment.body);
                                    setCommentEditAnchorDraft(
                                      comment.sourceTimeMs === undefined
                                        ? ""
                                        : String(comment.sourceTimeMs / 1_000),
                                    );
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void deleteComment(clip.id, comment)
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="muted">Comment deleted</p>
                        )}
                      </article>
                    ))}
                    <label>
                      Add comment
                      <textarea
                        value={commentDrafts.get(clip.id) ?? ""}
                        onChange={(event) =>
                          setCommentDrafts((current) =>
                            new Map(current).set(clip.id, event.target.value),
                          )
                        }
                        placeholder="Use @handle to mention a current project member"
                      />
                    </label>
                    <label>
                      Optional source time (seconds)
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={commentAnchorDrafts.get(clip.id) ?? ""}
                        onChange={(event) =>
                          setCommentAnchorDrafts((current) =>
                            new Map(current).set(clip.id, event.target.value),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        page?.freshness !== "fresh" ||
                        !(commentDrafts.get(clip.id) ?? "").trim()
                      }
                      onClick={() => void createComment(clip.id)}
                    >
                      Add comment
                    </button>
                  </section>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="muted">No clip candidates match the current filters.</p>
      )}
      {page?.nextCursor ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void reload(page.nextCursor)}
        >
          Load next page
        </button>
      ) : null}
      <datalist id="project-topic-suggestions">
        {suggestedTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </article>
  );
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes.toLocaleString()} bytes`;
}

function apiError(payload: unknown, fallback: string) {
  const parsed = ApiErrorSchema.safeParse(payload);
  return new Error(parsed.success ? parsed.data.error.message : fallback);
}
