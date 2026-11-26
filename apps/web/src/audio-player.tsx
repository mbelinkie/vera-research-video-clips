import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type {
  AudioAssetManifest,
  AudioRoleSchema,
} from "@research-video/contracts";
import type { z } from "zod";
import type { ResearchRequest } from "./research-library-data.ts";

export type AudioRole = z.infer<typeof AudioRoleSchema>;
export const audioRoles: Record<AudioRole, string> = {
  sound_effect: "Sound effect",
  ambience: "Ambience",
  music: "Music",
  speech: "Speech",
};
export type AudioRange = { startMs: number; endMs: number };

export function audioTime(ms: number) {
  const seconds = (ms % 60000) / 1000;
  return `${Math.floor(ms / 60000)}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function AudioWaveform({
  manifest,
  range,
  position,
}: {
  manifest: AudioAssetManifest;
  range?: AudioRange | undefined;
  position?: number | undefined;
}) {
  const percent = (ms: number) =>
    `${(Math.max(0, Math.min(ms, manifest.durationMs)) / manifest.durationMs) * 100}%`;
  return (
    <div
      className="audio-waveform"
      role="img"
      aria-label={`Waveform, ${audioTime(manifest.durationMs)}`}
    >
      {range && (
        <div
          className="audio-waveform-selection"
          style={{
            left: percent(range.startMs),
            right: `calc(100% - ${percent(range.endMs)})`,
          }}
        />
      )}
      <div className="audio-waveform-peaks" aria-hidden="true">
        {manifest.peaks.map((peak, index) => (
          <span
            key={index}
            style={{ "--peak": `${Math.max(2, peak * 100)}%` } as CSSProperties}
          />
        ))}
      </div>
      {position !== undefined && (
        <div
          className="audio-waveform-position"
          style={{ left: percent(position) }}
        />
      )}
    </div>
  );
}

export function AudioPlayer({
  request,
  path,
  manifest,
  file,
  range,
  player,
}: {
  request: ResearchRequest;
  path: string;
  manifest: AudioAssetManifest;
  file?: File | undefined;
  range?: AudioRange | undefined;
  player: RefObject<HTMLAudioElement | null>;
}) {
  const [playback, setPlayback] = useState<{
    path: string;
    file: File | undefined;
    url?: string | undefined;
    failed?: boolean;
  }>();
  const [retry, setRetry] = useState(0);
  const [position, setPosition] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const stopAt = useRef<number | undefined>(undefined);
  const playableMs = file ? manifest.durationMs : manifest.playbackDurationMs;
  const current =
    playback?.path === path && playback.file === file ? playback : undefined;
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    setPlayback(undefined);
    setPosition(0);
    setReady(false);
    setError("");
    stopAt.current = undefined;
    const audio = file
      ? Promise.resolve(file)
      : request(`${path}/playback`, { signal: abort.signal }).then(
          (response) => {
            if (!response.ok) throw new Error("Audio unavailable");
            return response.blob();
          },
        );
    void audio
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPlayback({ path, file, url });
      })
      .catch(() => {
        if (!abort.signal.aborted) setPlayback({ path, file, failed: true });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, path, request, retry]);

  function playRange() {
    if (!range || !player.current) return;
    player.current.currentTime = range.startMs / 1000;
    stopAt.current = range.endMs;
    void player.current.play().catch(() => {
      stopAt.current = undefined;
      setError("The selection could not be played.");
    });
  }

  return (
    <div className="audio-player">
      <AudioWaveform manifest={manifest} range={range} position={position} />
      <div className="audio-time-labels">
        <span>0:00</span>
        <span>{audioTime(manifest.durationMs)}</span>
      </div>
      {current?.url && (
        <audio
          key={current.url}
          ref={player}
          aria-label="Audio playback"
          src={current.url}
          controls
          preload="metadata"
          onLoadedMetadata={() => setReady(true)}
          onError={() =>
            setError("This recording could not be played by this browser.")
          }
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            const now = Math.round(audio.currentTime * 1000);
            if (stopAt.current !== undefined && now >= stopAt.current) {
              audio.pause();
              audio.currentTime = stopAt.current / 1000;
              stopAt.current = undefined;
            }
            setPosition(Math.round(audio.currentTime * 1000));
          }}
        />
      )}
      {current?.failed && (
        <p role="alert">
          Kept audio is unavailable.{" "}
          <button type="button" onClick={() => setRetry(retry + 1)}>
            Try playback again
          </button>
        </p>
      )}
      {!current && <p role="status">Loading audio…</p>}
      {error && <p role="alert">{error}</p>}
      {manifest.origin.kind === "file" && !file && (
        <p className="muted">
          Shared preview · {audioTime(playableMs)}. Relink the original for
          full-quality playback.
        </p>
      )}
      {range && (
        <button
          type="button"
          disabled={
            !ready || range.startMs >= range.endMs || range.endMs > playableMs
          }
          onClick={playRange}
        >
          Play selection
        </button>
      )}
    </div>
  );
}
