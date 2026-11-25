import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PlaybackRange,
  YouTubePlayerHandle,
  YouTubePlayerProps,
} from "./youtube-player.tsx";

// Hosted browser player only. The desktop renderer must never load remote
// scripts, so this module is imported lazily from youtube-player.tsx and only
// when the app is not running inside the desktop shell.

type PlayerStateEvent = { data: number };
type PlayerErrorEvent = { data: number };

type YouTubePlayerInstance = {
  cueVideoById(videoId: string): void;
  loadVideoById(options: {
    videoId: string;
    startSeconds: number;
    endSeconds: number;
  }): void;
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
};

type YouTubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady(): void;
        onStateChange(event: PlayerStateEvent): void;
        onError(event: PlayerErrorEvent): void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: { ENDED: number; PAUSED: number; PLAYING: number };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeNamespace> | undefined;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API loaded without a Player."));
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (existing) return;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () =>
      reject(new Error("YouTube player API failed to load."));
    document.head.append(script);
  });
  return apiPromise;
}

function loadRange(
  player: YouTubePlayerInstance,
  videoId: string,
  range: PlaybackRange,
  startMs = range.startMs,
) {
  player.loadVideoById({
    videoId,
    startSeconds: startMs / 1_000,
    endSeconds: range.endMs / 1_000,
  });
}

export const BrowserYouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function BrowserYouTubePlayer(
  { videoId, onRangeInterrupted, onReady, onTimeChange, onDurationChange },
  forwardedRef,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | undefined>(undefined);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const rangeRef = useRef<PlaybackRange | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(
    forwardedRef,
    () => ({
      seekTo(milliseconds) {
        const player = playerRef.current;
        if (!player) return false;
        const range = rangeRef.current;
        if (range) {
          if (milliseconds < range.startMs || milliseconds >= range.endMs) {
            rangeRef.current = undefined;
            player.seekTo(milliseconds / 1_000, true);
            onTimeChange(milliseconds);
            onRangeInterrupted?.();
            return true;
          }
          const wasPaused = pausedRef.current;
          loadRange(player, videoId, range, milliseconds);
          if (wasPaused) player.pauseVideo();
          onTimeChange(milliseconds);
          return true;
        }
        player.seekTo(milliseconds / 1_000, true);
        onTimeChange(milliseconds);
        return true;
      },
      playRange(startMilliseconds, endMilliseconds) {
        const player = playerRef.current;
        if (!player) return false;
        const range = { startMs: startMilliseconds, endMs: endMilliseconds };
        rangeRef.current = range;
        loadRange(player, videoId, range);
        onTimeChange(startMilliseconds);
        return true;
      },
      play() {
        if (!playerRef.current) return false;
        playerRef.current.playVideo();
        return true;
      },
      pause() {
        if (!playerRef.current) return false;
        rangeRef.current = undefined;
        playerRef.current.pauseVideo();
        return true;
      },
      requestDuration() {
        const player = playerRef.current;
        if (!player) return false;
        reportDuration(player.getDuration());
        return true;
      },
    }),
    [onDurationChange, onRangeInterrupted, onTimeChange, videoId],
  );

  function reportDuration(seconds: number) {
    if (Number.isFinite(seconds) && seconds > 0)
      onDurationChange?.(Math.round(seconds * 1_000));
  }

  useEffect(() => {
    onDurationChange?.(undefined);
  }, [onDurationChange, videoId]);

  useEffect(() => {
    let disposed = false;
    const interval = window.setInterval(() => {
      if (!playingRef.current || !playerRef.current) return;
      onTimeChange(
        Math.max(0, Math.round(playerRef.current.getCurrentTime() * 1_000)),
      );
    }, 250);

    void loadYouTubeApi()
      .then((youtube) => {
        if (disposed || !mountRef.current) return;
        playerRef.current = new youtube.Player(mountRef.current, {
          videoId,
          playerVars: {
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              setState("ready");
              if (playerRef.current)
                reportDuration(playerRef.current.getDuration());
              onReady?.();
            },
            onStateChange: (event) => {
              playingRef.current = event.data === youtube.PlayerState.PLAYING;
              pausedRef.current = event.data === youtube.PlayerState.PAUSED;
              if (event.data !== youtube.PlayerState.ENDED) return;
              const range = rangeRef.current;
              const player = playerRef.current;
              if (!range || !player) {
                if (player)
                  onTimeChange(
                    Math.max(0, Math.round(player.getCurrentTime() * 1_000)),
                  );
                return;
              }
              loadRange(player, videoId, range);
              onTimeChange(range.startMs);
            },
            onError: () => setState("error"),
          },
        });
      })
      .catch(() => setState("error"));

    return () => {
      disposed = true;
      window.clearInterval(interval);
      playingRef.current = false;
      pausedRef.current = false;
      rangeRef.current = undefined;
      playerRef.current?.destroy();
      playerRef.current = undefined;
    };
  }, [onReady, onTimeChange, videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="player-frame" data-player-state={state}>
      <div ref={mountRef} className="player-mount" />
      {state !== "ready" ? (
        <div className="player-status" role="status">
          {state === "error" ? "Player unavailable" : "Loading YouTube player…"}
        </div>
      ) : null}
    </div>
  );
});
