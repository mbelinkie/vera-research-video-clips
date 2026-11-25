import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  ApiErrorSchema,
  SourceProviderCapabilitiesResponseSchema,
  SourceSearchResponseSchema,
  type SourceProvider,
  type SourceProviderCapabilitiesResponse,
  type SourceSearchCandidate,
} from "@research-video/contracts";

import { apiFetch } from "./api-client.ts";
import { YouTubePlayer } from "./youtube-player.tsx";

type SourceIngestPanelProps = Readonly<{
  projectId: string;
  authorization: string;
  url: string;
  error?: string;
  pasteMessage?: string;
  loading?: boolean;
  onUrlChange(url: string): void;
  onSubmit(): void;
  onBulkAdd(): void;
  onSearchCandidatesSelected(urls: string[]): void;
}>;

const providers: SourceProvider[] = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
];

export function SourceIngestPanel({
  projectId,
  authorization,
  url,
  error,
  pasteMessage,
  loading = false,
  onUrlChange,
  onSubmit,
  onBulkAdd,
  onSearchCandidatesSelected,
}: SourceIngestPanelProps) {
  const [mode, setMode] = useState<"paste" | "search">("paste");
  const [capabilities, setCapabilities] =
    useState<SourceProviderCapabilitiesResponse>();
  const [query, setQuery] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<
    Set<SourceProvider>
  >(new Set());
  const [results, setResults] = useState<SourceSearchCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<string>();
  const [nextCursors, setNextCursors] = useState<
    Partial<Record<SourceProvider, string>>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Search does not add videos or start processing until you confirm a batch.",
  );
  const searchRequest = useRef(0);

  useEffect(() => {
    searchRequest.current += 1;
    setBusy(false);
    setCapabilities(undefined);
    setSelectedProviders(new Set());
    setResults([]);
    setSelected(new Set());
    setPreviewing(undefined);
    setNextCursors({});
    if (!projectId || !authorization) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(
          "cloud",
          `/api/projects/${projectId}/source-capabilities`,
          { signal: controller.signal },
          authorization,
        );
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) throw new Error(apiMessage(payload));
        const parsed = SourceProviderCapabilitiesResponseSchema.parse(payload);
        setCapabilities(parsed);
        const youtubeSearch = parsed.providers
          .find((entry) => entry.provider === "youtube")
          ?.operations.find((entry) => entry.operation === "search");
        setSelectedProviders(
          youtubeSearch?.state === "available"
            ? new Set<SourceProvider>(["youtube"])
            : new Set(),
        );
      } catch (caught) {
        if (!controller.signal.aborted) {
          setMessage(
            caught instanceof Error
              ? caught.message
              : "Unable to load source capabilities.",
          );
        }
      }
    })();
    return () => controller.abort();
  }, [authorization, projectId]);

  const searchCapabilities = useMemo(
    () =>
      new Map(
        (capabilities?.providers ?? []).map((entry) => [
          entry.provider,
          entry.operations.find(
            (operation) => operation.operation === "search",
          ),
        ]),
      ),
    [capabilities],
  );

  function submitPaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  async function search(cursors?: Partial<Record<SourceProvider, string>>) {
    if (
      !projectId ||
      !authorization ||
      !query.trim() ||
      !selectedProviders.size
    )
      return;
    const requestId = ++searchRequest.current;
    setBusy(true);
    setPreviewing(undefined);
    try {
      const requestedProviders = [...selectedProviders];
      const response = await apiFetch(
        "cloud",
        `/api/projects/${projectId}/source-search`,
        {
          method: "POST",
          body: JSON.stringify({
            query: query.trim(),
            providers: requestedProviders,
            pageSize: 12,
            ...(cursors && Object.keys(cursors).length ? { cursors } : {}),
          }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiMessage(payload));
      const parsed = SourceSearchResponseSchema.parse(payload);
      if (searchRequest.current !== requestId) return;
      const successful = parsed.outcomes.filter(
        (outcome) => outcome.state === "success",
      );
      const found = successful.flatMap((outcome) => outcome.candidates);
      setResults((current) =>
        cursors ? dedupeCandidates([...current, ...found]) : found,
      );
      if (!cursors) setSelected(new Set());
      setNextCursors(
        Object.fromEntries(
          parsed.outcomes.flatMap((outcome) =>
            outcome.nextCursor
              ? [[outcome.provider, outcome.nextCursor] as const]
              : [],
          ),
        ),
      );
      const issues = parsed.outcomes.filter(
        (outcome) => outcome.state !== "success",
      );
      setMessage(
        issues.length
          ? issues
              .map((outcome) => outcome.explanation)
              .filter(Boolean)
              .join(" ")
          : found.length
            ? `${found.length} result${found.length === 1 ? "" : "s"} loaded. Select videos to send through batch preflight.`
            : "No matching videos were found.",
      );
    } catch (caught) {
      if (searchRequest.current !== requestId) return;
      setMessage(
        caught instanceof Error ? caught.message : "Source search failed.",
      );
    } finally {
      if (searchRequest.current === requestId) setBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  function toggleProvider(provider: SourceProvider) {
    setSelectedProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  function toggleCandidate(candidate: SourceSearchCandidate) {
    const key = candidateKey(candidate);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedCandidates = results.filter((candidate) =>
    selected.has(candidateKey(candidate)),
  );

  return (
    <section className="source-ingest-panel" aria-label="Add source videos">
      <div className="ingest-mode-tabs" role="tablist" aria-label="Add videos">
        <button
          id="ingest-tab-paste"
          type="button"
          role="tab"
          aria-selected={mode === "paste"}
          aria-controls="ingest-panel-paste"
          tabIndex={mode === "paste" ? 0 : -1}
          onClick={() => setMode("paste")}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "End") {
              event.preventDefault();
              setMode("search");
              document.getElementById("ingest-tab-search")?.focus();
            }
          }}
        >
          Paste URL
        </button>
        <button
          id="ingest-tab-search"
          type="button"
          role="tab"
          aria-selected={mode === "search"}
          aria-controls="ingest-panel-search"
          tabIndex={mode === "search" ? 0 : -1}
          onClick={() => setMode("search")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "Home") {
              event.preventDefault();
              setMode("paste");
              document.getElementById("ingest-tab-paste")?.focus();
            }
          }}
        >
          Search
        </button>
      </div>

      {mode === "paste" ? (
        <form
          id="ingest-panel-paste"
          className="loader compact-ingest ingest-tab-panel"
          role="tabpanel"
          aria-labelledby="ingest-tab-paste"
          onSubmit={submitPaste}
        >
          <label htmlFor="video-url">YouTube URL or video ID</label>
          <div className="loader-row">
            <input
              id="video-url"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              aria-invalid={Boolean(error)}
            />
            <button type="submit" disabled={loading}>
              {loading ? "Adding video…" : "Load video"}
            </button>
            <button type="button" onClick={onBulkAdd}>
              Bulk add
            </button>
          </div>
          <p
            className={error ? "form-message error" : "form-message"}
            role="status"
          >
            {error ??
              pasteMessage ??
              "Open a project video from the worklist to resolve its verified transcript."}
          </p>
        </form>
      ) : (
        <form
          id="ingest-panel-search"
          className="source-search-form ingest-tab-panel"
          role="tabpanel"
          aria-labelledby="ingest-tab-search"
          onSubmit={submitSearch}
        >
          <fieldset disabled={!projectId || !authorization || busy}>
            <legend>Search platforms</legend>
            <div className="source-provider-options">
              {providers.map((provider) => {
                const capability = searchCapabilities.get(provider);
                const available = capability?.state === "available";
                return (
                  <label key={provider} title={capability?.explanation}>
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedProviders.has(provider)}
                        disabled={!available}
                        onChange={() => toggleProvider(provider)}
                      />
                      {providerName(provider)}
                      {!available ? " — unavailable" : ""}
                    </span>
                    {!available && capability?.explanation ? (
                      <small>{capability.explanation}</small>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="loader-row">
            <input
              aria-label="Search videos"
              value={query}
              maxLength={500}
              placeholder="Search YouTube videos"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="submit"
              disabled={busy || !query.trim() || !selectedProviders.size}
            >
              {busy ? "Searching…" : "Search"}
            </button>
          </div>
          <p className="form-message" role="status">
            {message}
          </p>
        </form>
      )}

      {mode === "search" && results.length ? (
        <div className="source-search-results">
          {results.map((candidate) => {
            const key = candidateKey(candidate);
            const isPreviewing = previewing === key;
            const previewCapability = capabilities?.providers
              .find(
                (entry) => entry.provider === candidate.sourceIdentity.provider,
              )
              ?.operations.find(
                (operation) => operation.operation === "embed-preview",
              );
            const canPreview =
              candidate.sourceIdentity.provider === "youtube" &&
              previewCapability?.state === "available";
            return (
              <article className="source-result-card" key={key}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggleCandidate(candidate)}
                  />
                  Select
                </label>
                {candidate.thumbnailUrl && !isPreviewing ? (
                  <img src={candidate.thumbnailUrl} alt="" loading="lazy" />
                ) : null}
                {isPreviewing &&
                candidate.sourceIdentity.provider === "youtube" ? (
                  <YouTubePlayer
                    videoId={candidate.sourceIdentity.providerMediaId}
                    onTimeChange={() => {}}
                    onDurationChange={() => {}}
                  />
                ) : null}
                <strong>{candidate.title}</strong>
                <span>
                  {candidate.creator ??
                    providerName(candidate.sourceIdentity.provider)}
                </span>
                <button
                  type="button"
                  disabled={!canPreview}
                  title={
                    canPreview
                      ? undefined
                      : (previewCapability?.explanation ??
                        "Preview is unavailable for this source.")
                  }
                  onClick={() => setPreviewing(isPreviewing ? undefined : key)}
                >
                  {isPreviewing ? "Close preview" : "Preview"}
                </button>
              </article>
            );
          })}
          <div className="source-search-actions">
            <button
              type="button"
              disabled={!selectedCandidates.length}
              onClick={() =>
                onSearchCandidatesSelected(
                  selectedCandidates.map(
                    (candidate) => candidate.sourceIdentity.canonicalUrl,
                  ),
                )
              }
            >
              Add selected to batch ({selectedCandidates.length})
            </button>
            {Object.keys(nextCursors).length ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void search(nextCursors)}
              >
                More results
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function candidateKey(candidate: SourceSearchCandidate) {
  return `${candidate.sourceIdentity.provider}:${candidate.sourceIdentity.providerMediaId}`;
}

function dedupeCandidates(candidates: SourceSearchCandidate[]) {
  return [
    ...new Map(
      candidates.map((candidate) => [candidateKey(candidate), candidate]),
    ).values(),
  ];
}

function providerName(provider: SourceProvider) {
  if (provider === "youtube") return "YouTube";
  if (provider === "tiktok") return "TikTok";
  if (provider === "instagram") return "Instagram";
  return "Facebook";
}

function apiMessage(payload: unknown) {
  const parsed = ApiErrorSchema.safeParse(payload);
  return parsed.success
    ? parsed.data.error.message
    : "The request could not be completed.";
}
