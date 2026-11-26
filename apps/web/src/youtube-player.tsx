import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { isDesktopRuntime } from "./api-client.ts";

const BrowserYouTubePlayer = lazy(async () => ({
  default: (await import("./hosted-youtube-player.tsx")).BrowserYouTubePlayer,
}));

type PlayerStateEvent = { data: number };
type PlayerErrorEvent = { data: number };
export type PlaybackRange = { startMs: number; endMs: number };

export type YouTubePlayerHandle = {
  seekTo(milliseconds: number): boolean;
  playRange(startMilliseconds: number, endMilliseconds: number): boolean;
  play(): boolean;
  pause(): boolean;
  requestDuration(): boolean;
};

export type YouTubePlayerProps = {
  videoId: string;
  onTimeChange(milliseconds: number): void;
  onRangeInterrupted?: () => void;
  onReady?: () => void;
  onDurationChange?: (milliseconds: number | undefined) => void;
};

const playerOrigin = "https://www.youtube-nocookie.com";
const pollIntervalMs = 250;

const DesktopYouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function DesktopYouTubePlayer(
  { videoId, onRangeInterrupted, onReady, onTimeChange, onDurationChange },
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
  const rangeRef = useRef<PlaybackRange | undefined>(undefined);
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

  function command(name: string, args: readonly unknown[] = []): boolean {
    const target = iframeRef.current?.contentWindow;
    if (!target) return false;
    target.postMessage(
      JSON.stringify({ event: "command", func: name, args }),
      playerOrigin,
    );
    return true;
  }

  function seek(milliseconds: number) {
    if (readyRef.current) {
      pendingSeek.current = undefined;
      command("seekTo", [milliseconds / 1_000, true]);
    } else pendingSeek.current = milliseconds;
  }

  function setPlayback(action: "playVideo" | "pauseVideo"): boolean {
    if (!iframeRef.current?.contentWindow || state === "error") return false;
    if (readyRef.current) {
      pendingPlayback.current = undefined;
      return command(action);
    }
    pendingPlayback.current = action;
    return true;
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      seekTo(milliseconds) {
        if (!iframeRef.current?.contentWindow || state === "error")
          return false;
        const range = rangeRef.current;
        if (
          range &&
          (milliseconds < range.startMs || milliseconds >= range.endMs)
        ) {
          rangeRef.current = undefined;
          onRangeInterrupted?.();
        }
        seek(milliseconds);
        onTimeChange(milliseconds);
        return true;
      },
      playRange(startMilliseconds, endMilliseconds) {
        if (
          !iframeRef.current?.contentWindow ||
          state === "error" ||
          endMilliseconds <= startMilliseconds
        )
          return false;
        rangeRef.current = {
          startMs: startMilliseconds,
          endMs: endMilliseconds,
        };
        seek(startMilliseconds);
        setPlayback("playVideo");
        onTimeChange(startMilliseconds);
        return true;
      },
      play: () => setPlayback("playVideo"),
      pause() {
        if (!iframeRef.current?.contentWindow || state === "error")
          return false;
        rangeRef.current = undefined;
        pendingPlayback.current = "pauseVideo";
        return setPlayback("pauseVideo");
      },
      requestDuration: () => readyRef.current && command("getDuration"),
    }),
    [onRangeInterrupted, onTimeChange, state],
  );

  useEffect(() => {
    rangeRef.current = undefined;
    pendingSeek.current = undefined;
    pendingPlayback.current = undefined;
    onDurationChange?.(undefined);
  }, [onDurationChange, videoId]);

  useEffect(() => {
    const receivePlayerMessage = (event: MessageEvent) => {
      if (
        event.origin !== playerOrigin ||
        event.source !== iframeRef.current?.contentWindow
      )
        return;
      const message = parsePlayerMessage(event.data);
      if (!loadedRef.current || !message) return;
      if (message.event === "onError") {
        loadedRef.current = false;
        readyRef.current = false;
        playingRef.current = false;
        rangeRef.current = undefined;
        setPlaying(false);
        setState("error");
        return;
      }
      if (!readyRef.current) {
        if (message.event !== "onReady" && message.event !== "initialDelivery")
          return;
        readyRef.current = true;
        setState("ready");
        onReady?.();
        const seekMilliseconds = pendingSeek.current;
        const playback = pendingPlayback.current;
        pendingSeek.current = undefined;
        pendingPlayback.current = undefined;
        if (seekMilliseconds !== undefined) seek(seekMilliseconds);
        if (playback) command(playback);
      }
      const playerState = message.info?.playerState;
      if (typeof playerState === "number") {
        playingRef.current = playerState === 1;
        setPlaying(playingRef.current);
        const range = rangeRef.current;
        if (playerState === 0 && range) {
          seek(range.startMs);
          setPlayback("playVideo");
          onTimeChange(range.startMs);
          return;
        }
      }
      const durationSeconds = message.info?.duration;
      if (
        typeof durationSeconds === "number" &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
      )
        onDurationChange?.(Math.round(durationSeconds * 1_000));
      const seconds = message.info?.currentTime;
      if (typeof seconds !== "number" || !Number.isFinite(seconds)) return;
      const milliseconds = Math.max(0, Math.round(seconds * 1_000));
      const range = rangeRef.current;
      if (range && milliseconds >= range.endMs) {
        seek(range.startMs);
        setPlayback("playVideo");
        onTimeChange(range.startMs);
        return;
      }
      onTimeChange(milliseconds);
    };
    window.addEventListener("message", receivePlayerMessage);
    const interval = window.setInterval(() => {
      if (!loadedRef.current) return;
      if (!readyRef.current) {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening" }),
          playerOrigin,
        );
      } else if (playingRef.current || rangeRef.current) {
        command("getCurrentTime");
        command("getDuration");
      } else command("getDuration");
    }, pollIntervalMs);
    return () => {
      window.removeEventListener("message", receivePlayerMessage);
      window.clearInterval(interval);
    };
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
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
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
            rangeRef.current = undefined;
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

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(props, forwardedRef) {
  if (isDesktopRuntime()) {
    return <DesktopYouTubePlayer {...props} ref={forwardedRef} />;
  }
  return (
    <Suspense fallback={null}>
      <BrowserYouTubePlayer {...props} ref={forwardedRef} />
    </Suspense>
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
