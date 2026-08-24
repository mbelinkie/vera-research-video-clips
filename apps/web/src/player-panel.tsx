import type { ReactNode, RefObject } from "react";

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
  lastSeekPrecision: "word" | "cue";
  clipLoopRange?: { startMs: number; endMs: number };
  selectionEditor: ReactNode;
  onTimeChange: (milliseconds: number) => void;
}>;

export function PlayerPanel({
  playerRef,
  videoId,
  currentMs,
  lastSeekMs,
  lastSeekPrecision,
  clipLoopRange,
  selectionEditor,
  onTimeChange,
}: PlayerPanelProps) {
  return (
    <aside className="panel video-panel">
      {videoId ? (
        <YouTubePlayer
          ref={playerRef}
          videoId={videoId}
          onTimeChange={onTimeChange}
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
        {clipLoopRange ? (
          <p className="muted" role="status">
            Looping logged clip {formatTime(clipLoopRange.startMs)}–
            {formatTime(clipLoopRange.endMs)}
          </p>
        ) : null}
      </div>
      {selectionEditor}
    </aside>
  );
}
