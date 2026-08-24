import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

export type SourcePlayerHandle = {
  seekTo(milliseconds: number): boolean;
  play(): boolean;
  pause(): boolean;
  requestDuration(): boolean;
};

export type YouTubePlayerHandle = SourcePlayerHandle;

type YouTubePlayerProps = {
  videoId: string;
  onTimeChange(milliseconds: number): void;
  onDurationChange(milliseconds: number | undefined): void;
};

const playerOrigin = "https://www.youtube-nocookie.com";

/**
 * The privileged desktop renderer never imports YouTube JavaScript. Commands
 * cross only the isolated iframe's postMessage boundary, so remote player code
 * cannot see the preload bridge or invoke authenticated desktop IPC.
 */
export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(
  { videoId, onTimeChange, onDurationChange },
  forwardedRef,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playingRef = useRef(false);
  const latestTimeMs = useRef(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const source = useMemo(() => {
    const parameters = new URLSearchParams({
      enablejsapi: "1",
      playsinline: "1",
      origin: window.location.origin,
    });
    return `${playerOrigin}/embed/${encodeURIComponent(videoId)}?${parameters}`;
  }, [videoId]);

  const command = (name: string, args: readonly unknown[] = []): boolean => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return false;
    target.postMessage(
      JSON.stringify({ event: "command", func: name, args }),
      playerOrigin,
    );
    return true;
  };

  useImperativeHandle(
    forwardedRef,
    () => ({
      seekTo(milliseconds) {
        latestTimeMs.current = milliseconds;
        if (!command("seekTo", [milliseconds / 1_000, true])) return false;
        onTimeChange(milliseconds);
        return true;
      },
      play: () => command("playVideo"),
      pause: () => command("pauseVideo"),
      requestDuration: () => command("getDuration"),
    }),
    [onTimeChange],
  );

  useEffect(() => {
    onDurationChange(undefined);
  }, [onDurationChange, videoId]);

  useEffect(() => {
    const receivePlayerMessage = (event: MessageEvent) => {
      if (
        event.origin !== playerOrigin ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }
      const message = parsePlayerMessage(event.data);
      if (!message) return;
      const playerState = message.info?.playerState;
      if (typeof playerState === "number") {
        playingRef.current = playerState === 1;
        setState("ready");
      }
      const seconds = message.info?.currentTime;
      if (typeof seconds === "number" && Number.isFinite(seconds)) {
        latestTimeMs.current = Math.max(0, Math.round(seconds * 1_000));
        onTimeChange(latestTimeMs.current);
      }
      const durationSeconds = message.info?.duration;
      if (
        typeof durationSeconds === "number" &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
      ) {
        onDurationChange(Math.round(durationSeconds * 1_000));
      }
    };
    window.addEventListener("message", receivePlayerMessage);
    return () => window.removeEventListener("message", receivePlayerMessage);
  }, [onDurationChange, onTimeChange]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (playingRef.current) command("getCurrentTime");
      command("getDuration");
    }, 250);
    return () => window.clearInterval(interval);
  });

  return (
    <div className="player-frame" data-player-state={state}>
      <iframe
        ref={iframeRef}
        className="player-mount"
        src={source}
        title="YouTube video player"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => {
          setState("ready");
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: "listening" }),
            playerOrigin,
          );
          command("getDuration");
        }}
        onError={() => setState("error")}
      />
      {state !== "ready" ? (
        <div className="player-status" role="status">
          {state === "error" ? "Player unavailable" : "Loading YouTube player…"}
        </div>
      ) : null}
    </div>
  );
});

function parsePlayerMessage(value: unknown):
  | {
      info?: {
        playerState?: unknown;
        currentTime?: unknown;
        duration?: unknown;
      };
    }
  | undefined {
  try {
    const parsed =
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const info = (parsed as { info?: unknown }).info;
    return typeof info === "object" && info !== null
      ? {
          info: info as {
            playerState?: unknown;
            currentTime?: unknown;
            duration?: unknown;
          },
        }
      : {};
  } catch {
    return undefined;
  }
}
