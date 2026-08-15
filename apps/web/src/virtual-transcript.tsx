import { useEffect, useMemo, useRef, useState } from "react";

import type {
  TranscriptSegment,
  TranscriptToken,
} from "@research-video/contracts";
import { transcriptVirtualWindow } from "@research-video/transcript";
import type { TranscriptSelectionBoundary } from "@research-video/transcript";

const rowHeight = 76;
const viewportHeight = 500;

type VirtualTranscriptProps = {
  segments: readonly TranscriptSegment[];
  tokens: readonly TranscriptToken[];
  activeSegmentId?: string;
  activeTokenId?: string;
  selectedTokenIds?: ReadonlySet<string>;
  follow: boolean;
  onFollowSuspended(): void;
  onSeek(milliseconds: number, precision: "word" | "cue"): void;
  onSelect(
    anchor: TranscriptSelectionBoundary,
    focus: TranscriptSelectionBoundary,
  ): void;
};

export function VirtualTranscript({
  segments,
  tokens,
  activeSegmentId,
  activeTokenId,
  selectedTokenIds,
  follow,
  onFollowSuspended,
  onSeek,
  onSelect,
}: VirtualTranscriptProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const tokensBySegment = useMemo(() => {
    const grouped = new Map<string, TranscriptToken[]>();
    for (const token of tokens) {
      const group = grouped.get(token.segmentId) ?? [];
      group.push(token);
      grouped.set(token.segmentId, group);
    }
    return grouped;
  }, [tokens]);
  const virtualWindow = transcriptVirtualWindow({
    itemCount: segments.length,
    scrollTop,
    viewportHeight,
    rowHeight,
  });
  const rendered = segments.slice(
    virtualWindow.startIndex,
    virtualWindow.endIndex,
  );

  useEffect(() => {
    if (!follow || !activeSegmentId || !containerRef.current) return;
    const activeIndex = segments.findIndex(
      (segment) => segment.id === activeSegmentId,
    );
    if (activeIndex < 0) return;
    const nextScrollTop = Math.max(
      0,
      activeIndex * rowHeight - viewportHeight / 2 + rowHeight / 2,
    );
    containerRef.current.scrollTo({ top: nextScrollTop, behavior: "smooth" });
  }, [activeSegmentId, follow, segments]);

  return (
    <div
      ref={containerRef}
      className="transcript-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onWheel={onFollowSuspended}
      onTouchMove={onFollowSuspended}
      onMouseUp={(event) => {
        const selection = window.getSelection();
        if (
          !selection ||
          selection.isCollapsed ||
          !selection.anchorNode ||
          !selection.focusNode
        ) {
          return;
        }
        const anchor = selectionBoundaryFromNode(
          selection.anchorNode,
          event.currentTarget,
        );
        const focus = selectionBoundaryFromNode(
          selection.focusNode,
          event.currentTarget,
        );
        if (anchor && focus) onSelect(anchor, focus);
      }}
    >
      <div
        className="transcript-spacer"
        style={{ height: virtualWindow.totalHeight }}
      >
        <div
          className="transcript-window"
          style={{ transform: `translateY(${virtualWindow.offsetTop}px)` }}
        >
          {rendered.map((segment) => {
            const segmentTokens = tokensBySegment.get(segment.id) ?? [];
            return (
              <div
                key={segment.id}
                data-testid="transcript-window-row"
                data-transcript-segment-id={segment.id}
                className={`transcript-row${activeSegmentId === segment.id ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="cue-time"
                  aria-label={`Seek to ${formatTime(segment.startMs)}`}
                  onClick={() => onSeek(segment.startMs, "cue")}
                >
                  {formatTime(segment.startMs)}
                </button>
                <span className="transcript-text">
                  {segmentTokens.length > 0 ? (
                    segmentTokens.map((token, index) => (
                      <span key={token.id}>
                        {index > 0 ? " " : null}
                        <span
                          role="button"
                          tabIndex={0}
                          data-transcript-segment-id={segment.id}
                          data-transcript-token-id={token.id}
                          className={`transcript-token${activeTokenId === token.id ? " active" : ""}${selectedTokenIds?.has(token.id) ? " selected" : ""}`}
                          title={
                            token.startMs === undefined
                              ? "Cue-level timing"
                              : `Word timing ${formatTime(token.startMs)}`
                          }
                          onClick={() => {
                            if (!window.getSelection()?.isCollapsed) return;
                            onSeek(
                              token.startMs ?? segment.startMs,
                              token.startMs === undefined ? "cue" : "word",
                            );
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ")
                              return;
                            event.preventDefault();
                            onSeek(
                              token.startMs ?? segment.startMs,
                              token.startMs === undefined ? "cue" : "word",
                            );
                          }}
                        >
                          {token.text}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span data-transcript-segment-id={segment.id}>
                      {segment.text}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function selectionBoundaryFromNode(
  node: Node,
  root: HTMLElement,
): TranscriptSelectionBoundary | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element || !root.contains(element)) return undefined;
  const token = element.closest<HTMLElement>("[data-transcript-token-id]");
  if (token && root.contains(token)) {
    const segmentId = token.dataset.transcriptSegmentId;
    const tokenId = token.dataset.transcriptTokenId;
    if (segmentId && tokenId) return { segmentId, tokenId };
  }
  const segment = element.closest<HTMLElement>("[data-transcript-segment-id]");
  const segmentId = segment?.dataset.transcriptSegmentId;
  return segmentId ? { segmentId } : undefined;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
