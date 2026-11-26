import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  TranscriptSegment,
  TranscriptToken,
} from "@research-video/contracts";
import {
  transcriptNavigationTokens,
  transcriptVirtualWindow,
} from "@research-video/transcript";
import type {
  TranscriptSearchOccurrence,
  TranscriptSelectionBoundary,
} from "@research-video/transcript";

const rowHeight = 76;
const viewportHeight = 500;

export type TranscriptSeekPrecision =
  "word" | "cue" | "caption-start" | "estimated";

type VirtualTranscriptProps = {
  segments: readonly TranscriptSegment[];
  tokens: readonly TranscriptToken[];
  activeSegmentId?: string;
  activeTokenId?: string;
  searchMatches?: readonly TranscriptSearchOccurrence[];
  activeSearchMatchId?: string;
  selectedTokenIds?: ReadonlySet<string>;
  follow: boolean;
  wrapCues?: boolean;
  onWordSelect?: (word: TranscriptSelectionBoundary, extend: boolean) => void;
  onFollowSuspended(): void;
  onSeek(milliseconds: number, precision: TranscriptSeekPrecision): void;
  /** Precision-aware token activation (hosted app); takes priority over onPlayFromToken. */
  onActivateToken?:
    | ((milliseconds: number, precision: TranscriptSeekPrecision) => void)
    | undefined;
  onPlayFromToken?:
    | ((milliseconds: number, precision: "word" | "estimated") => void)
    | undefined;
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
  searchMatches = [],
  activeSearchMatchId,
  selectedTokenIds,
  follow,
  wrapCues = false,
  onWordSelect,
  onFollowSuspended,
  onSeek,
  onPlayFromToken,
  onActivateToken,
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
  const navigationTargets = useMemo(
    () =>
      new Map(
        transcriptNavigationTokens(segments, tokens).map((token) => [
          token.id,
          token,
        ]),
      ),
    [segments, tokens],
  );
  function activateToken(
    token: TranscriptToken,
    segment: TranscriptSegment,
    navigationTarget: {
      startMs: number;
      timingPrecision: "word" | "estimated";
    },
  ) {
    if (!onActivateToken && onPlayFromToken) {
      onPlayFromToken(
        navigationTarget.startMs,
        navigationTarget.timingPrecision,
      );
      return;
    }
    const precision: TranscriptSeekPrecision =
      token.startMs === undefined
        ? "cue"
        : token.endTiming === "derived"
          ? "caption-start"
          : "word";
    (onActivateToken ?? onSeek)(token.startMs ?? segment.startMs, precision);
  }

  const virtualWindow = transcriptVirtualWindow({
    itemCount: segments.length,
    scrollTop,
    viewportHeight,
    rowHeight,
  });
  const rendered = wrapCues
    ? segments
    : segments.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  const activeSearchMatch = searchMatches.find(
    (match) => match.id === activeSearchMatchId,
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

  useEffect(() => {
    if (!activeSearchMatch || !containerRef.current) return;
    const matchIndex = segments.findIndex(
      (segment) => segment.id === activeSearchMatch.startSegmentId,
    );
    if (matchIndex < 0) return;
    const nextScrollTop = Math.max(
      0,
      matchIndex * rowHeight - viewportHeight / 2 + rowHeight / 2,
    );
    containerRef.current.scrollTo({ top: nextScrollTop, behavior: "smooth" });
  }, [activeSearchMatch, segments]);

  return (
    <div
      ref={containerRef}
      className={`transcript-list${wrapCues ? " transcript-list-wrap" : ""}`}
      onScroll={
        wrapCues
          ? undefined
          : (event) => setScrollTop(event.currentTarget.scrollTop)
      }
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
        style={wrapCues ? undefined : { height: virtualWindow.totalHeight }}
      >
        <div
          className="transcript-window"
          style={
            wrapCues
              ? undefined
              : { transform: `translateY(${virtualWindow.offsetTop}px)` }
          }
        >
          {rendered.map((segment) => {
            const segmentTokens = tokensBySegment.get(segment.id) ?? [];
            const searchRanges = searchMatches
              .flatMap((match) =>
                match.ranges
                  .filter((range) => range.segmentId === segment.id)
                  .map((range) => ({ ...range, matchId: match.id })),
              )
              .toSorted((left, right) => left.startOffset - right.startOffset);
            let tokenTextCursor = 0;
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
                    segmentTokens.map((token, index) => {
                      const navigationTarget = navigationTargets.get(token.id)!;
                      const tokenOffset = segment.text.indexOf(
                        token.text,
                        tokenTextCursor,
                      );
                      const tokenStart =
                        tokenOffset < 0 ? tokenTextCursor : tokenOffset;
                      const tokenEnd = tokenStart + token.text.length;
                      tokenTextCursor = tokenEnd;
                      const tokenMatches = searchRanges.filter(
                        (range) =>
                          range.startOffset < tokenEnd &&
                          range.endOffset > tokenStart,
                      );
                      const activeSearch = tokenMatches.some(
                        (range) => range.matchId === activeSearchMatchId,
                      );
                      return (
                        <span key={token.id}>
                          {index > 0 ? " " : null}
                          <span
                            role="button"
                            tabIndex={0}
                            data-transcript-segment-id={segment.id}
                            data-transcript-token-id={token.id}
                            data-alignment-status={token.alignmentStatus}
                            aria-label={`${token.text}${token.alignmentStatus === "unaligned" ? ", unaligned, cue timing only" : ""}`}
                            className={`transcript-token${activeTokenId === token.id ? " active" : ""}${selectedTokenIds?.has(token.id) ? " selected" : ""}${token.alignmentStatus === "unaligned" ? " unaligned" : ""}${tokenMatches.length ? " search-match" : ""}${activeSearch ? " active-search-match" : ""}`}
                            title={
                              navigationTarget.timingPrecision === "estimated"
                                ? `Estimated word position ${formatTime(navigationTarget.startMs)}`
                                : token.startMs === undefined
                                  ? "Cue-level timing"
                                  : token.endTiming === "derived"
                                    ? `Exact caption word start ${(token.startMs / 1_000).toFixed(3)}s; derived end (estimate) ${(token.endMs! / 1_000).toFixed(3)}s`
                                    : `Word timing ${(token.startMs / 1_000).toFixed(3)}s`
                            }
                            onClick={(event) => {
                              if (
                                !window.getSelection()?.isCollapsed &&
                                !(onWordSelect && event.shiftKey)
                              )
                                return;
                              if (onWordSelect) {
                                onWordSelect(
                                  { segmentId: segment.id, tokenId: token.id },
                                  event.shiftKey,
                                );
                              } else {
                                activateToken(token, segment, navigationTarget);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ")
                                return;
                              event.preventDefault();
                              if (onWordSelect) {
                                onWordSelect(
                                  { segmentId: segment.id, tokenId: token.id },
                                  event.shiftKey,
                                );
                              } else {
                                activateToken(token, segment, navigationTarget);
                              }
                            }}
                          >
                            {token.text}
                          </span>
                        </span>
                      );
                    })
                  ) : (
                    <span data-transcript-segment-id={segment.id}>
                      {highlightedTranscriptText(
                        segment.text,
                        searchRanges,
                        activeSearchMatchId,
                      )}
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

function highlightedTranscriptText(
  text: string,
  ranges: readonly {
    startOffset: number;
    endOffset: number;
    matchId: string;
  }[],
  activeMatchId: string | undefined,
) {
  if (!ranges.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.startOffset > cursor)
      parts.push(text.slice(cursor, range.startOffset));
    parts.push(
      <mark
        key={`${range.matchId}:${range.startOffset}`}
        className={range.matchId === activeMatchId ? "active-search-match" : ""}
      >
        {text.slice(range.startOffset, range.endOffset)}
      </mark>,
    );
    cursor = Math.max(cursor, range.endOffset);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
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
