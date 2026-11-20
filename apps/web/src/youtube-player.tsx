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
const pollIntervalMs = 250;

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
  const loadedRef = useRef(false);
  const readyRef = useRef(false);
  const playingRef = useRef(false);
  const pendingSeek = useRef<number | undefined>(undefined);
  const pendingPlayback = useRef<"playVideo" | "pauseVideo" | undefined>(
    undefined,
  );
  const [playing, setPlaying] = useState(false);
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
        if (!iframeRef.current?.contentWindow || state === "error")
          return false;
        if (readyRef.current) command("seekTo", [milliseconds / 1_000, true]);
        else pendingSeek.current = milliseconds;
        onTimeChange(milliseconds);
        return true;
      },
      play: () => setPlayback("playVideo"),
      pause: () => setPlayback("pauseVideo"),
      requestDuration: () => readyRef.current && command("getDuration"),
    }),
    [onTimeChange, state],
  );

  function setPlayback(action: "playVideo" | "pauseVideo"): boolean {
    if (!iframeRef.current?.contentWindow || state === "error") return false;
    if (readyRef.current) return command(action);
    pendingPlayback.current = action;
    return true;
  }

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
      if (!loadedRef.current || !message) return;
      if (message.event === "onError") {
        loadedRef.current = false;
        readyRef.current = false;
        setState("error");
        return;
      }
      if (!readyRef.current) {
        if (
          message.event !== "onReady" &&
          message.event !== "initialDelivery"
        ) {
          return;
        }
        readyRef.current = true;
        setState("ready");
        const seek = pendingSeek.current;
        const playback = pendingPlayback.current;
        pendingSeek.current = undefined;
        pendingPlayback.current = undefined;
        if (seek !== undefined) command("seekTo", [seek / 1_000, true]);
        if (playback) command(playback);
      }
      const playerState = message.info?.playerState;
      if (typeof playerState === "number") {
        playingRef.current = playerState === 1;
        setPlaying(playingRef.current);
      }
      const seconds = message.info?.currentTime;
      if (typeof seconds === "number" && Number.isFinite(seconds)) {
        onTimeChange(Math.max(0, Math.round(seconds * 1_000)));
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
      if (!loadedRef.current) return;
      if (!readyRef.current) {
        // The iframe document can load before YouTube starts accepting commands.
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening" }),
          playerOrigin,
        );
        return;
      }
      if (playingRef.current) command("getCurrentTime");
      command("getDuration");
    }, pollIntervalMs);
    return () => window.clearInterval(interval);
  });

  return (
    <>
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
            loadedRef.current = true;
            readyRef.current = false;
            playingRef.current = false;
            setPlaying(false);
            setState("loading");
          }}
          onError={() => {
            loadedRef.current = false;
            readyRef.current = false;
            setState("error");
          }}
        />
        {state !== "ready" ? (
          <div className="player-status" role="status">
            {state === "error"
              ? "Player unavailable"
              : "Loading YouTube player…"}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="quiet-button"
        disabled={state !== "ready"}
        onClick={() => setPlayback(playing ? "pauseVideo" : "playVideo")}
      >
        {playing ? "Pause video" : "Play video"}
      </button>
    </>
  );
});

function parsePlayerMessage(value: unknown):
  | {
      event: unknown;
      info:
        | {
            playerState?: unknown;
            currentTime?: unknown;
            duration?: unknown;
          }
        | undefined;
    }
  | undefined {
  try {
    const parsed =
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { event, info } = parsed as { event?: unknown; info?: unknown };
    return {
      event,
      info:
        typeof info === "object" && info !== null
          ? (info as {
              playerState?: unknown;
              currentTime?: unknown;
              duration?: unknown;
            })
          : undefined,
    };
  } catch {
    return undefined;
  }
}
