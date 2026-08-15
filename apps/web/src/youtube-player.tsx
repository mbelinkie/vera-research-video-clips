import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type PlayerStateEvent = { data: number };
type PlayerErrorEvent = { data: number };

type YouTubePlayerInstance = {
  cueVideoById(videoId: string): void;
  destroy(): void;
  getCurrentTime(): number;
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
  PlayerState: { PLAYING: number };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YouTubePlayerHandle = {
  seekTo(milliseconds: number): boolean;
  play(): boolean;
  pause(): boolean;
};

type YouTubePlayerProps = {
  videoId: string;
  onTimeChange(milliseconds: number): void;
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

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer({ videoId, onTimeChange }, forwardedRef) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | undefined>(undefined);
  const playingRef = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(
    forwardedRef,
    () => ({
      seekTo(milliseconds) {
        if (!playerRef.current) return false;
        playerRef.current.seekTo(milliseconds / 1_000, true);
        onTimeChange(milliseconds);
        return true;
      },
      play() {
        if (!playerRef.current) return false;
        playerRef.current.playVideo();
        return true;
      },
      pause() {
        if (!playerRef.current) return false;
        playerRef.current.pauseVideo();
        return true;
      },
    }),
    [onTimeChange],
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
            },
            onError: () => setState("error"),
          },
        });
      })
      .catch(() => setState("error"));

    return () => {
      disposed = true;
      window.clearInterval(interval);
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
