import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  ApiErrorSchema,
  ClipCandidateSchema,
  ExportPresetSnapshotSchema,
  ExportRequestSchema,
  ProjectSchema,
  type ClipCandidate,
  type Project,
  type TranscriptSelection,
} from "@research-video/contracts";
import { normalizeYouTubeUrl } from "@research-video/providers";
import {
  deriveTranscriptSelection,
  normalizeTranscriptFixture,
  searchTranscript,
  segmentAtTime,
  timedTranscriptTokens,
  tokenAtTime,
  updateTranscriptSelectionExportBounds,
} from "@research-video/transcript";
import transcriptFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };

import "./styles.css";
import { BatchWorkspace } from "./batch-workspace.tsx";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player.tsx";
import { VirtualTranscript } from "./virtual-transcript.tsx";

const demoVideoId = "M7lc1UVf-VE";
const demoUrl = `https://www.youtube.com/watch?v=${demoVideoId}`;

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPreciseTime(milliseconds: number) {
  return `${(milliseconds / 1_000).toFixed(3)}s`;
}

function App() {
  const [url, setUrl] = useState(demoUrl);
  const [videoId, setVideoId] = useState<string>();
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
  const [exportContainer, setExportContainer] = useState<"mp4" | "mov" | "mkv">(
    "mp4",
  );
  const [exportVideoCodec, setExportVideoCodec] = useState<
    "h264" | "hevc" | "prores"
  >("h264");
  const [exportCrf, setExportCrf] = useState(20);
  const [exportMaxWidth, setExportMaxWidth] = useState(1_920);
  const [exportFrameRate, setExportFrameRate] = useState<
    "source" | "23.976" | "24" | "25" | "29.97" | "30"
  >("source");
  const [exportAudioBitrate, setExportAudioBitrate] = useState(192);
  const [omitEnglishSubtitles, setOmitEnglishSubtitles] = useState(false);
  const [embedEnglishSubtitles, setEmbedEnglishSubtitles] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const transcript = useMemo(() => {
    if (videoId !== demoVideoId) return undefined;
    return normalizeTranscriptFixture({
      ...transcriptFixture,
      track: { ...transcriptFixture.track, videoId: demoVideoId },
    });
  }, [videoId]);
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
  const exportPreset = useMemo(
    () =>
      ExportPresetSnapshotSchema.parse({
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: exportContainer,
          videoCodec: exportVideoCodec,
          videoRateControl: { mode: "crf", value: exportCrf },
          maxWidth: exportMaxWidth,
          frameRate: exportFrameRate,
          audioCodec: "aac",
          audioKilobitsPerSecond: exportAudioBitrate,
          omitSubtitleFilesForConfirmedEnglish: omitEnglishSubtitles,
          embedEnglishSubtitleTrack: embedEnglishSubtitles,
        },
      }),
    [
      embedEnglishSubtitles,
      exportAudioBitrate,
      exportContainer,
      exportCrf,
      exportFrameRate,
      exportMaxWidth,
      exportVideoCodec,
      omitEnglishSubtitles,
    ],
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

  function loadVideoUrl(nextUrl: string) {
    try {
      const normalized = normalizeYouTubeUrl(nextUrl);
      setVideoId(normalized.videoId);
      setUrl(normalized.canonicalUrl);
      setCurrentMs(0);
      setLastSeekMs(undefined);
      setQuery("");
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
      setError(undefined);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load video.",
      );
    }
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
      const response = await fetch("/cloud-api/api/projects", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: newProjectName,
          description: newProjectDescription,
        }),
      });
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
      setProjectId(project.id);
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
    if (!authorization || !projectId || !videoId || !selection)
      return undefined;
    setClipActionBusy(true);
    try {
      const response = await fetch(
        `/cloud-api/api/projects/${projectId}/clips`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            idempotencyKey: `queue:${selectionCommandId}`,
            video: {
              youtubeVideoId: videoId,
              canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
              title:
                videoId === demoVideoId
                  ? "YouTube IFrame API demo"
                  : `YouTube video ${videoId}`,
            },
            selection,
            englishText: selection.text,
            notes: clipNotes,
            tags: clipTags
              .split(/[,\n]/u)
              .map((tag) => tag.trim())
              .filter(Boolean),
          }),
        },
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
    if (!authorization || !projectId || !selection) return;
    const clipId =
      loggedClipId ?? (await queueClipOnly().then((clip) => clip?.id));
    if (!clipId) return;
    setClipActionBusy(true);
    try {
      const response = await fetch(
        `/cloud-api/api/projects/${projectId}/clips/${clipId}/exports`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            idempotencyKey: `logged-export:${selectionCommandId}`,
            sourceLanguageClass: "confirmed_english",
            preset: exportPreset,
          }),
        },
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? `Clip logged, but export could not be queued: ${parsed.data.error.message}`
            : "Clip logged, but export could not be queued.",
        );
      }
      const exportRequest = ExportRequestSchema.parse(payload);
      setLoggedExportRequestId(exportRequest.id);
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
    if (!videoId || !selection) return;
    setClipActionBusy(true);
    try {
      const response = await fetch("/local-agent/api/exports", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: `export-only:${selectionCommandId}`,
          video: {
            youtubeVideoId: videoId,
            canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
            title:
              videoId === demoVideoId
                ? "YouTube IFrame API demo"
                : `YouTube video ${videoId}`,
          },
          selection,
          sourceLanguageClass: "confirmed_english",
          preset: exportPreset,
        }),
      });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to queue local export.",
        );
      }
      const exportRequest = ExportRequestSchema.parse(payload);
      setExportOnlyRequestId(exportRequest.id);
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
        <span className="status">Milestone 4 in progress</span>
      </header>

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
            "The included API demo opens with a short navigation fixture; other valid videos load without inventing a transcript."}
        </p>
      </form>

      <section className="workspace" aria-label="Research workspace">
        <article className="panel transcript-panel">
          <div className="panel-heading">
            <div>
              <span>English transcript</span>
              {transcript ? (
                <span className="precision">
                  {transcript.track.timingPrecision} timing
                </span>
              ) : null}
            </div>
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
              <div className="fixture-warning">
                Navigation fixture for the API demo—not a transcript of the
                video.
              </div>
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
              <h2>{videoId ? "No shared transcript yet" : "Load a video"}</h2>
              <p>
                {videoId
                  ? "This slice will not invent transcript text. Shared transcript resolution is the next connection."
                  : "Paste a supported YouTube URL to create a canonical video identity."}
              </p>
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
                  onChange={(event) => setProjectId(event.target.value)}
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
              <details className="export-settings-panel">
                <summary>Export settings — {exportPreset.name}</summary>
                <div className="export-settings-grid">
                  <label>
                    Container
                    <select
                      value={exportContainer}
                      onChange={(event) => {
                        const container = event.target.value as
                          "mp4" | "mov" | "mkv";
                        setExportContainer(container);
                        if (
                          container === "mp4" &&
                          exportVideoCodec === "prores"
                        )
                          setExportVideoCodec("h264");
                      }}
                    >
                      <option value="mp4">MP4</option>
                      <option value="mov">MOV</option>
                      <option value="mkv">MKV</option>
                    </select>
                  </label>
                  <label>
                    Video codec
                    <select
                      value={exportVideoCodec}
                      onChange={(event) => {
                        const codec = event.target.value as
                          "h264" | "hevc" | "prores";
                        setExportVideoCodec(codec);
                        if (codec === "prores" && exportContainer === "mp4")
                          setExportContainer("mov");
                      }}
                    >
                      <option value="h264">H.264</option>
                      <option value="hevc">HEVC</option>
                      <option value="prores">ProRes</option>
                    </select>
                  </label>
                  <label>
                    Quality (CRF)
                    <input
                      type="number"
                      min="0"
                      max="51"
                      value={exportCrf}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (
                          Number.isInteger(value) &&
                          value >= 0 &&
                          value <= 51
                        )
                          setExportCrf(value);
                      }}
                    />
                  </label>
                  <label>
                    Maximum width
                    <input
                      type="number"
                      min="320"
                      max="7680"
                      step="2"
                      value={exportMaxWidth}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (
                          Number.isInteger(value) &&
                          value >= 320 &&
                          value <= 7_680
                        )
                          setExportMaxWidth(value);
                      }}
                    />
                  </label>
                  <label>
                    Frame rate
                    <select
                      value={exportFrameRate}
                      onChange={(event) =>
                        setExportFrameRate(
                          event.target.value as
                            "source" | "23.976" | "24" | "25" | "29.97" | "30",
                        )
                      }
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
                    AAC audio (kbps)
                    <input
                      type="number"
                      min="64"
                      max="1536"
                      step="16"
                      value={exportAudioBitrate}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (
                          Number.isInteger(value) &&
                          value >= 64 &&
                          value <= 1_536
                        )
                          setExportAudioBitrate(value);
                      }}
                    />
                  </label>
                </div>
                <label className="export-checkbox">
                  <input
                    type="checkbox"
                    checked={omitEnglishSubtitles}
                    onChange={(event) =>
                      setOmitEnglishSubtitles(event.target.checked)
                    }
                  />
                  Omit subtitle files for confirmed-English videos
                </label>
                <label className="export-checkbox">
                  <input
                    type="checkbox"
                    checked={embedEnglishSubtitles}
                    onChange={(event) =>
                      setEmbedEnglishSubtitles(event.target.checked)
                    }
                  />
                  Embed an English soft-subtitle track
                </label>
              </details>
              <div className="selection-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={
                    clipActionBusy ||
                    Boolean(loggedClipId) ||
                    !authorization ||
                    !projectId
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
                    !projectId
                  }
                  onClick={() => void requestLoggedExport()}
                >
                  {loggedExportRequestId ? "Export queued" : "Export + log"}
                </button>
                <button
                  type="button"
                  disabled={clipActionBusy || Boolean(exportOnlyRequestId)}
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
        onAuthorizationChange={(value) => {
          setAuthorization(value);
          setProjects([]);
          setProjectId("");
          setProjectMessage(undefined);
        }}
        onOpenVideo={(canonicalUrl) => {
          loadVideoUrl(canonicalUrl);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onProjectChange={setProjectId}
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
