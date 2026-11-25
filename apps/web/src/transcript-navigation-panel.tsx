import { useEffect, useRef, type ComponentProps } from "react";

import {
  formatLanguageLabel,
  languagesEquivalent,
  type NormalizedTranscript,
} from "@research-video/contracts";

import { VirtualTranscript } from "./virtual-transcript.tsx";
import type { TranscriptSearchOccurrence } from "@research-video/transcript";

export type TranscriptView = "preferred" | "english" | "original";

type TranscriptNavigationPanelProps = Readonly<{
  transcript: NormalizedTranscript | undefined;
  originalTranscript: NormalizedTranscript | undefined;
  preferredTranscript: NormalizedTranscript | undefined;
  preferredLanguage: string | undefined;
  transcriptView: TranscriptView;
  preferredEvidenceRequired: boolean;
  offlineCachedWorkspace: boolean;
  workspaceMessage: string | undefined;
  workspaceLoadState: "idle" | "loading" | "unavailable" | "failed";
  hasWorkspaceTarget: boolean;
  query: string;
  matchIndex: number;
  matches: readonly TranscriptSearchOccurrence[];
  activeSegmentId: string | undefined;
  activeTokenId: string | undefined;
  selectedTokenIds: ReadonlySet<string>;
  follow: boolean;
  onTranscriptViewChange: (view: TranscriptView) => void;
  onFollowChange: (follow: boolean) => void;
  onQueryChange: (query: string) => void;
  onMoveMatch: (direction: 1 | -1) => void;
  onFollowSuspended: () => void;
  onSeek: ComponentProps<typeof VirtualTranscript>["onSeek"];
  onPlayFromToken: ComponentProps<typeof VirtualTranscript>["onPlayFromToken"];
  onSelect: ComponentProps<typeof VirtualTranscript>["onSelect"];
  onRetry: () => void;
}>;

export function TranscriptNavigationPanel({
  transcript,
  originalTranscript,
  preferredTranscript,
  preferredLanguage,
  transcriptView,
  preferredEvidenceRequired,
  offlineCachedWorkspace,
  workspaceMessage,
  workspaceLoadState,
  hasWorkspaceTarget,
  query,
  matchIndex,
  matches,
  activeSegmentId,
  activeTokenId,
  selectedTokenIds,
  follow,
  onTranscriptViewChange,
  onFollowChange,
  onQueryChange,
  onMoveMatch,
  onFollowSuspended,
  onSeek,
  onPlayFromToken,
  onSelect,
  onRetry,
}: TranscriptNavigationPanelProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const activeMatch = matches[matchIndex];

  useEffect(() => {
    if (!transcript) return;
    function focusTranscriptFind(event: KeyboardEvent) {
      if (
        event.key.toLocaleLowerCase() !== "f" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        )
      )
        return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
    window.addEventListener("keydown", focusTranscriptFind);
    return () => window.removeEventListener("keydown", focusTranscriptFind);
  }, [transcript]);

  return (
    <article ref={panelRef} className="panel transcript-panel" tabIndex={-1}>
      <div className="panel-heading">
        <div>
          <span>
            {transcript
              ? `${formatLanguageLabel(transcript.track.language)} transcript`
              : "Transcript"}
          </span>
          {transcript ? (
            <span className="precision">
              {transcript.track.timingPrecision} timing
            </span>
          ) : null}
        </div>
        {originalTranscript ? (
          <label className="transcript-view-picker">
            Language view
            <select
              value={transcriptView}
              onChange={(event) =>
                onTranscriptViewChange(event.target.value as TranscriptView)
              }
            >
              <option
                value="preferred"
                disabled={preferredEvidenceRequired && !preferredTranscript}
              >
                Preferred
                {preferredLanguage
                  ? ` — ${formatLanguageLabel(preferredLanguage)}`
                  : ""}
              </option>
              <option value="english">English</option>
              {!languagesEquivalent(originalTranscript.track.language, "en") ? (
                <option value="original">
                  Original —{" "}
                  {formatLanguageLabel(originalTranscript.track.language)}
                </option>
              ) : null}
            </select>
          </label>
        ) : null}
        <button
          className="quiet-button"
          type="button"
          onClick={() => onFollowChange(!follow)}
          aria-pressed={follow}
        >
          {follow ? "Following" : "Resume follow"}
        </button>
      </div>

      {transcript ? (
        <>
          <p className="form-message" role="status">
            {workspaceMessage}
          </p>
          {preferredEvidenceRequired && !preferredTranscript ? (
            <p className="form-message error" role="status">
              Preferred translation unavailable for{" "}
              {preferredLanguage
                ? formatLanguageLabel(preferredLanguage)
                : "the selected language"}
              . Original and English remain available; logging waits for the
              required preferred evidence.
            </p>
          ) : null}
          {offlineCachedWorkspace ? (
            <p className="form-message" role="status">
              This is verified offline cache review. Reconnect to confirm the
              current project transcript; Log clip and Log and export are
              unavailable until then.
            </p>
          ) : null}
          <div className="search-field">
            <label htmlFor="transcript-search">Search transcript</label>
            <input
              ref={searchInputRef}
              id="transcript-search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Find exact text"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onMoveMatch(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  panelRef.current?.focus();
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="quiet-button"
                aria-label="Clear transcript search"
                onClick={() => {
                  onQueryChange("");
                  searchInputRef.current?.focus();
                }}
              >
                Clear
              </button>
            ) : null}
            <span className="search-navigation">
              <span>
                {matches.length === 0
                  ? "0 matches"
                  : `${matchIndex + 1} of ${matches.length}`}
              </span>
              <button
                type="button"
                disabled={matches.length === 0}
                onClick={() => onMoveMatch(-1)}
              >
                Previous match
              </button>
              <button
                type="button"
                disabled={matches.length === 0}
                onClick={() => onMoveMatch(1)}
              >
                Next match
              </button>
            </span>
          </div>
          <VirtualTranscript
            segments={transcript.segments}
            tokens={transcript.tokens}
            searchMatches={matches}
            {...(activeMatch ? { activeSearchMatchId: activeMatch.id } : {})}
            {...(activeSegmentId ? { activeSegmentId } : {})}
            {...(activeTokenId ? { activeTokenId } : {})}
            selectedTokenIds={selectedTokenIds}
            follow={follow}
            onFollowSuspended={onFollowSuspended}
            onSeek={onSeek}
            onPlayFromToken={onPlayFromToken}
            onSelect={onSelect}
          />
        </>
      ) : (
        <div className="empty-state">
          <span className="step">01</span>
          <h2>
            {workspaceLoadState === "loading"
              ? "Loading verified transcript"
              : workspaceLoadState === "unavailable"
                ? "No active project transcript"
                : workspaceLoadState === "failed"
                  ? "Transcript unavailable"
                  : "Open a project video"}
          </h2>
          <p>
            {workspaceMessage ??
              "Open a Ready for review project video. The app never substitutes fixture text when real resolution is unavailable."}
          </p>
          {hasWorkspaceTarget && workspaceLoadState !== "loading" ? (
            <button type="button" onClick={onRetry}>
              Retry transcript
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}
