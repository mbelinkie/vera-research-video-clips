import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiErrorSchema,
  YouTubeSourceDetailsSchema,
  type YouTubeSourceDetails,
} from "@research-video/contracts";
import { normalizeYouTubeUrl } from "@research-video/providers";

import { researchRequest } from "./research-library-data.ts";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player.tsx";

type SourceReceipt = Readonly<{
  projectId: string;
  sourceId: string;
}>;

type YouTubeSourceViewProps = Readonly<{
  receipt: SourceReceipt;
  authorization: string;
  csrfToken?: string;
  projectName?: string;
  onAuthUnavailable?: () => void;
  onClose(): void;
  nested?: boolean;
}>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function parseYouTubeSourceReceipt(
  search: string,
): SourceReceipt | undefined {
  const parameters = new URLSearchParams(search);
  const projectId = parameters.get("projectId");
  const sourceId = parameters.get("sourceId");
  if (
    !projectId ||
    !sourceId ||
    !uuidPattern.test(projectId) ||
    !uuidPattern.test(sourceId)
  )
    return undefined;
  return { projectId, sourceId };
}

export function sourceReceiptReturnTo(pathname: string, search: string) {
  const receipt = parseYouTubeSourceReceipt(search);
  if (!receipt) return pathname || "/";
  const parameters = new URLSearchParams({
    projectId: receipt.projectId,
    sourceId: receipt.sourceId,
  });
  return `${pathname || "/"}?${parameters.toString()}`;
}

function formatMomentTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const remainder = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

function errorMessage(response: Response, payload: unknown) {
  if (response.status === 403 || response.status === 404)
    return "This YouTube source is not available in the selected project.";
  const parsed = ApiErrorSchema.safeParse(payload);
  return parsed.success
    ? parsed.data.error.message
    : "Unable to load this YouTube source.";
}

export function YouTubeSourceView({
  receipt,
  authorization,
  csrfToken,
  projectName,
  onAuthUnavailable,
  onClose,
  nested = false,
}: YouTubeSourceViewProps) {
  const [details, setDetails] = useState<YouTubeSourceDetails>();
  const [videoId, setVideoId] = useState<string>();
  const [currentMs, setCurrentMs] = useState(0);
  const pendingSeekRef = useRef<number | undefined>(undefined);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string>();
  const playerRef = useRef<YouTubePlayerHandle>(null);

  useEffect(() => {
    if (!authorization || !receipt.projectId || !receipt.sourceId) {
      setDetails(undefined);
      setVideoId(undefined);
      setState("idle");
      setMessage(undefined);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setDetails(undefined);
    setVideoId(undefined);
    pendingSeekRef.current = undefined;
    setState("loading");
    setMessage(undefined);
    void researchRequest({
      authorization,
      csrfToken,
      onUnavailable: onAuthUnavailable,
    })(
      `/api/projects/${encodeURIComponent(receipt.projectId)}/sources/${encodeURIComponent(receipt.sourceId)}/youtube-details`,
      { signal: controller.signal, headers: { accept: "application/json" } },
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) throw new Error(errorMessage(response, payload));
        const parsed = YouTubeSourceDetailsSchema.parse(payload);
        if (parsed.sourceId !== receipt.sourceId)
          throw new Error("Source details do not match the requested project.");
        const normalized = normalizeYouTubeUrl(parsed.url);
        if (!active || controller.signal.aborted) return;
        setDetails(parsed);
        setVideoId(normalized.videoId);
        setState("ready");
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState("error");
        setMessage(
          caught instanceof Error
            ? caught.message
            : "Unable to load this YouTube source.",
        );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authorization,
    csrfToken,
    onAuthUnavailable,
    receipt.projectId,
    receipt.sourceId,
  ]);

  function seekMoment(timecodeMs: number) {
    if (playerRef.current?.seekTo(timecodeMs)) {
      setCurrentMs(timecodeMs);
      pendingSeekRef.current = undefined;
    } else {
      pendingSeekRef.current = timecodeMs;
    }
  }

  const seekPendingMoment = useCallback(() => {
    const timecodeMs = pendingSeekRef.current;
    if (timecodeMs === undefined) return;
    if (playerRef.current?.seekTo(timecodeMs)) {
      setCurrentMs(timecodeMs);
      pendingSeekRef.current = undefined;
    }
  }, []);

  return (
    <section
      className="loader"
      aria-label="YouTube source view"
      data-testid="youtube-source-view"
    >
      <div className="section-heading">
        <div>
          <h2>{details?.title ?? "YouTube source"}</h2>
          {projectName ? <p className="muted">Project: {projectName}</p> : null}
        </div>
        {!nested && (
          <button type="button" className="quiet-button" onClick={onClose}>
            Back to workspace
          </button>
        )}
      </div>

      {state === "loading" ? (
        <p className="form-message" role="status">
          Loading source details…
        </p>
      ) : null}
      {state === "error" ? (
        <p className="form-message error" role="alert">
          {message}
        </p>
      ) : null}
      {details && videoId ? (
        <div className="batch-grid">
          <div className="batch-list">
            <section
              className="queue-card youtube-source-record"
              aria-label="Shared source reason"
              data-testid="youtube-source-reason"
            >
              <h3>Shared source reason</h3>
              {details.reason ? (
                <>
                  <p>{details.reason.text}</p>
                  <p className="muted">
                    Last edited by {details.reason.updatedByName} ·{" "}
                    {new Date(details.reason.updatedAt).toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="muted">No shared reason has been saved.</p>
              )}
            </section>
            <section
              className="queue-card youtube-source-record"
              aria-label="Saved moments"
            >
              <h3>Saved moments</h3>
              {details.moments.length ? (
                <div className="batch-list">
                  {details.moments.map((moment) => (
                    <button
                      type="button"
                      className="source-moment"
                      key={moment.id}
                      data-testid="youtube-source-moment"
                      data-moment-id={moment.id}
                      data-timecode-ms={moment.timecodeMs}
                      aria-label={`Seek to moment at ${formatMomentTime(moment.timecodeMs)}. ${moment.note ?? "No note"}. Saved by ${moment.authorName}`}
                      onClick={() => seekMoment(moment.timecodeMs)}
                    >
                      <time dateTime={`PT${moment.timecodeMs / 1_000}S`}>
                        {formatMomentTime(moment.timecodeMs)}
                      </time>
                      <span>
                        {moment.note ?? "No note"}
                        <small>Saved by {moment.authorName}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">No saved moments yet.</p>
              )}
            </section>
          </div>
          <div className="video-panel">
            <YouTubePlayer
              ref={playerRef}
              videoId={videoId}
              onReady={seekPendingMoment}
              onRangeInterrupted={() => undefined}
              onTimeChange={setCurrentMs}
            />
            <div className="video-details source-playback-details">
              <p className="eyebrow">Playback position</p>
              <strong>{formatMomentTime(currentMs)}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export type { SourceReceipt };
