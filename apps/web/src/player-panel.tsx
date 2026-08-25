import { useEffect, type ReactNode, type RefObject } from "react";

import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player.tsx";

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type PlayerPanelProps = Readonly<{
  playerRef: RefObject<YouTubePlayerHandle | null>;
  videoId: string | undefined;
  currentMs: number;
  lastSeekMs: number | undefined;
  lastSeekPrecision: "word" | "cue" | "estimated";
  sourceDurationMs: number | undefined;
  playerRangeStartMs: number | undefined;
  playerRangeEndMs: number | undefined;
  playerSpeechStatus:
    "speech" | "no_speech" | "transcript_unavailable" | undefined;
  playerRangeMessage: string | undefined;
  clipLoopRange?: { startMs: number; endMs: number };
  selectionEditor: ReactNode;
  bookmarks?: ReactNode;
  onTimeChange: (milliseconds: number) => void;
  onDurationChange: (milliseconds: number | undefined) => void;
  onSetPlayerRangeBound: (bound: "in" | "out") => void;
  onPlayerSpeechStatusChange: (
    status: "speech" | "no_speech" | "transcript_unavailable",
  ) => void;
  onClearPlayerRange: () => void;
}>;

export function PlayerPanel({
  playerRef,
  videoId,
  currentMs,
  lastSeekMs,
  lastSeekPrecision,
  sourceDurationMs,
  playerRangeStartMs,
  playerRangeEndMs,
  playerSpeechStatus,
  playerRangeMessage,
  clipLoopRange,
  selectionEditor,
  bookmarks,
  onTimeChange,
  onDurationChange,
  onSetPlayerRangeBound,
  onPlayerSpeechStatusChange,
  onClearPlayerRange,
}: PlayerPanelProps) {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isPlayerRangeShortcut(event)) return;
      const key = event.key.toLowerCase();
      if (key !== "i" && key !== "o") return;
      event.preventDefault();
      onSetPlayerRangeBound(key === "i" ? "in" : "out");
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onSetPlayerRangeBound]);

  return (
    <aside className="panel video-panel">
      {videoId ? (
        <YouTubePlayer
          ref={playerRef}
          videoId={videoId}
          onTimeChange={onTimeChange}
          onDurationChange={onDurationChange}
        />
      ) : (
        <div className="video-placeholder">16:9 YouTube player</div>
      )}
      <div className="video-details">
        <p className="eyebrow">Playback position</p>
        <strong>{formatTime(currentMs)}</strong>
        <p className="muted">
          {lastSeekMs === undefined
            ? "Click a transcript word to play, or a cue time to seek."
            : `${seekPrecisionLabel(lastSeekPrecision)} requested ${formatTime(lastSeekMs)}.`}
        </p>
        {clipLoopRange ? (
          <p className="muted" role="status">
            Looping logged clip {formatTime(clipLoopRange.startMs)}–
            {formatTime(clipLoopRange.endMs)}
          </p>
        ) : null}
      </div>
      <section className="player-range-panel" aria-label="Player clip range">
        <div className="selection-heading">
          <div>
            <p className="eyebrow">Player range</p>
            <strong>Manual source bounds</strong>
          </div>
          <button
            type="button"
            className="quiet-button"
            disabled={playerRangeStartMs === undefined}
            onClick={onClearPlayerRange}
          >
            Clear range
          </button>
        </div>
        <p className="muted">
          Duration:{" "}
          {sourceDurationMs === undefined
            ? "resolving…"
            : formatTime(sourceDurationMs)}{" "}
          · playhead {formatTime(currentMs)}
        </p>
        <div className="player-range-actions">
          <button
            type="button"
            className="handle-button"
            disabled={
              !videoId ||
              sourceDurationMs === undefined ||
              currentMs >= sourceDurationMs
            }
            onClick={() => onSetPlayerRangeBound("in")}
          >
            Set in <kbd>I</kbd>
          </button>
          <button
            type="button"
            className="handle-button"
            disabled={
              !videoId ||
              sourceDurationMs === undefined ||
              playerRangeStartMs === undefined ||
              currentMs <= playerRangeStartMs ||
              currentMs > sourceDurationMs
            }
            onClick={() => onSetPlayerRangeBound("out")}
          >
            Set out <kbd>O</kbd>
          </button>
        </div>
        <p className="immutable-bounds" data-testid="player-range-bounds">
          In:{" "}
          {playerRangeStartMs === undefined
            ? "not set"
            : formatTime(playerRangeStartMs)}{" "}
          · Out:{" "}
          {playerRangeEndMs === undefined
            ? "not set"
            : formatTime(playerRangeEndMs)}
        </p>
        {playerRangeStartMs !== undefined && playerRangeEndMs !== undefined ? (
          <fieldset className="speech-status-picker">
            <legend>Speech status (required)</legend>
            {(
              [
                ["speech", "Speech"],
                ["no_speech", "No speech"],
                ["transcript_unavailable", "Transcript unavailable"],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="player-speech-status"
                  value={value}
                  checked={playerSpeechStatus === value}
                  onChange={() => onPlayerSpeechStatusChange(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        ) : null}
        <p
          className={playerRangeMessage ? "form-message" : "muted"}
          role="status"
        >
          {playerRangeMessage ??
            "Set an in-point, then a later out-point. Shortcuts are ignored while editing fields or using a menu/dialog."}
        </p>
      </section>
      {bookmarks}
      {selectionEditor}
    </aside>
  );
}

function seekPrecisionLabel(precision: "word" | "cue" | "estimated") {
  if (precision === "word") return "Word";
  if (precision === "estimated") return "Estimated word";
  return "Cue";
}

export function isPlayerRangeShortcut(event: KeyboardEvent) {
  if (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  const path = event.composedPath();
  return !path.some((entry) => {
    if (!(entry instanceof HTMLElement)) return false;
    const tagName = entry.tagName.toLowerCase();
    return (
      ["input", "textarea", "select"].includes(tagName) ||
      entry.isContentEditable ||
      ["menu", "dialog"].includes(entry.getAttribute("role") ?? "") ||
      ["menu", "dialog"].includes(tagName)
    );
  });
}
