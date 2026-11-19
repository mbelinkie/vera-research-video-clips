import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type PlayerStateEvent = { data: number };
type PlayerErrorEvent = { data: number };
type PlaybackRange = { startMs: number; endMs: number };

type YouTubePlayerInstance = {
  cueVideoById(videoId: string): void;
  loadVideoById(options: {
    videoId: string;
    startSeconds: number;
    endSeconds: number;
  }): void;
  destroy(): void;
  getCurrentTime(): number;
  pauseVideo(): void;
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

export type YouTubePlayerHandle = {
  seekTo(milliseconds: number): boolean;
  playRange(startMilliseconds: number, endMilliseconds: number): boolean;
  pause(): boolean;
};

type YouTubePlayerProps = {
  videoId: string;
  onTimeChange(milliseconds: number): void;
  onRangeInterrupted(): void;
};

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

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(
  { videoId, onRangeInterrupted, onTimeChange },
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
            onRangeInterrupted();
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
      pause() {
        if (!playerRef.current) return false;
        rangeRef.current = undefined;
        playerRef.current.pauseVideo();
        return true;
      },
    }),
    [onRangeInterrupted, onTimeChange, videoId],
  );

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
            onReady: () => setState("ready"),
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
  }, [onTimeChange, videoId]);

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
