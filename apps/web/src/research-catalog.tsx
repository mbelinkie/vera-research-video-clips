import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  ProjectMemberSummarySchema,
  AudioAssetManifestSchema,
  type ItemKind,
  type LibraryItem,
  type LibrarySource,
  type SourceKind,
} from "@research-video/contracts";
import { AudioPlayer, audioRoles } from "./audio-player.tsx";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player.tsx";
import {
  getResearchSource,
  listItems,
  listSources,
  projectPath,
  readResearch,
  researchPageSize,
  type ResearchRequest,
} from "./research-library-data.ts";

export const sourceKinds: Record<SourceKind, string> = {
  youtube: "YouTube",
  web_page: "Web page",
  image: "Image",
  audio: "Audio",
  local_video: "File",
  provider_video: "Video",
  offline: "Offline",
  pdf: "PDF",
};

const itemKinds: Record<ItemKind, string> = {
  clip: "Clip",
  quote: "Quote",
  still: "Still",
  audio: "Audio",
};

export function sourceTitle(source: LibrarySource) {
  return (
    source.bibliography.title?.value ??
    source.bibliography.url?.value ??
    source.sourceIdentity?.canonicalUrl ??
    sourceKinds[source.kind]
  );
}

export function researchError(caught: unknown, fallback: string) {
  return caught instanceof Error && !(caught instanceof z.ZodError)
    ? caught.message
    : fallback;
}

type ReadState<T> = { data?: T; error?: string; loaded?: boolean };

export function useResearchRead<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
  refresh = 0,
  poll = false,
): ReadState<T> {
  const [result, setResult] = useState<{
    load: typeof load;
    state: ReadState<T>;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let current: AbortController | undefined;
    function run() {
      if (current) return;
      const controller = new AbortController();
      current = controller;
      void load(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted)
            setResult({ load, state: { data, loaded: true } });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              load,
              state: {
                error: researchError(error, "Unable to load Research records."),
              },
            });
        })
        .finally(() => {
          if (current === controller) current = undefined;
        });
    }
    function refreshVisible() {
      if (document.visibilityState === "visible") run();
    }
    run();
    const interval = poll
      ? window.setInterval(refreshVisible, 4_000)
      : undefined;
    if (poll) {
      window.addEventListener("focus", refreshVisible);
      document.addEventListener("visibilitychange", refreshVisible);
    }
    return () => {
      current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [enabled, load, poll, refresh]);
  return result?.load === load ? result.state : {};
}

export function useResearchMutation() {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return controller;
}

type Filters = {
  kind: string;
  topic: string;
  query: string;
  logger: string;
  page: number;
};
const emptyFilters: Filters = {
  kind: "",
  topic: "",
  query: "",
  logger: "",
  page: 0,
};

type CatalogProps = {
  request: ResearchRequest;
  projectId: string;
  onOpenSource(id: string): void;
};

export function ResearchCatalog({
  request,
  projectId,
  tab,
  active,
  visible = true,
  refresh,
  onOpenSource,
  toolbar,
  commentCounts,
  localAudio,
}: CatalogProps & {
  tab: "sources" | "library";
  active: boolean;
  visible?: boolean;
  refresh: number;
  toolbar?: ReactNode;
  localAudio?: { sourceId: string; file: File } | undefined;
  commentCounts?: (
    ids: string[],
    signal: AbortSignal,
  ) => Promise<Record<string, { total: number; unread: number }>>;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState("");
  const detailRef = useRef<HTMLHeadingElement>(null);
  const openedItem = useRef<HTMLButtonElement>(null);
  const selectedId = useRef("");
  const seen = useRef<{
    scope: string;
    ids: Set<string>;
    arrivals: Set<string>;
  }>(undefined);
  const sources = tab === "sources";

  useEffect(() => {
    const timeout = window.setTimeout(
      () =>
        setFilters((current) =>
          current.query === query.trim()
            ? current
            : { ...current, query: query.trim(), page: 0 },
        ),
      220,
    );
    return () => window.clearTimeout(timeout);
  }, [query]);

  const params = new URLSearchParams({
    limit: String(researchPageSize),
    offset: String(filters.page * researchPageSize),
  });
  if (sources) params.set("sort", "recent");
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.query) params.set("q", filters.query);
  if (filters.logger) params.set("logger", filters.logger);
  const filterKey = params.toString();

  const load = useCallback(
    (signal: AbortSignal): Promise<LibrarySource[] | LibraryItem[]> =>
      sources
        ? listSources(
            request,
            projectId,
            new URLSearchParams(filterKey),
            signal,
          )
        : listItems(request, projectId, new URLSearchParams(filterKey), signal),
    [filterKey, projectId, request, sources],
  );
  const { data, error } = useResearchRead(load, active, refresh + retry, true);

  const loadTopics = useCallback(
    (signal: AbortSignal) =>
      readResearch(
        request,
        `${projectPath(projectId)}/clip-tags`,
        z.string().array(),
        { signal },
      ),
    [projectId, request],
  );
  const loadMembers = useCallback(
    (signal: AbortSignal) =>
      readResearch(
        request,
        `${projectPath(projectId)}/members`,
        ProjectMemberSummarySchema.array(),
        { signal },
      ),
    [projectId, request],
  );
  const topics = useResearchRead(loadTopics, active, refresh).data ?? [];
  const members =
    useResearchRead(loadMembers, active && !sources, refresh).data ?? [];
  const sourceIds = sources ? (data ?? []).map((row) => row.id).join(",") : "";
  const loadCounts = useCallback(
    (signal: AbortSignal) =>
      commentCounts?.(sourceIds.split(","), signal) ?? Promise.resolve({}),
    [commentCounts, sourceIds],
  );
  const counts = useResearchRead(
    loadCounts,
    active && Boolean(sourceIds),
    refresh,
    true,
  ).data as Record<string, { total: number; unread: number }> | undefined;

  const [arrivalIds, setArrivalIds] = useState(new Set<string>());
  useEffect(() => {
    if (!sources || !data) return;
    if (seen.current?.scope !== filterKey) {
      seen.current = {
        scope: filterKey,
        ids: new Set(data.map((row) => row.id)),
        arrivals: new Set(),
      };
    } else {
      for (const row of data) {
        if (!seen.current.ids.has(row.id)) seen.current.arrivals.add(row.id);
        seen.current.ids.add(row.id);
      }
    }
    setArrivalIds(new Set(seen.current.arrivals));
  }, [data, filterKey, sources]);

  useEffect(() => {
    if (
      selectedItemId &&
      data?.some((row) => row.id === selectedItemId) &&
      selectedId.current !== selectedItemId
    ) {
      selectedId.current = selectedItemId;
      detailRef.current?.focus();
    }
  }, [data, selectedItemId]);

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, page: 0, [key]: value }));
    setSelectedItemId("");
  }

  const sourceRows = sources
    ? (data as LibrarySource[] | undefined)
    : undefined;
  const itemRows = sources ? undefined : (data as LibraryItem[] | undefined);
  const selectedItem = itemRows?.find((item) => item.id === selectedItemId);

  return (
    <section
      className="research-catalog"
      hidden={!visible}
      aria-label={sources ? "Research sources" : "Research library"}
    >
      <div className="research-toolbar">
        <label className="research-search">
          Search
          <input
            type="search"
            aria-label={sources ? "Search sources" : "Search library"}
            value={query}
            maxLength={500}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Kind
          <select
            aria-label={sources ? "Source kind" : "Item kind"}
            value={filters.kind}
            onChange={(event) => update("kind", event.target.value)}
          >
            <option value="">All kinds</option>
            {Object.entries(sources ? sourceKinds : itemKinds).map(
              ([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Topic
          <select
            value={filters.topic}
            onChange={(event) => update("topic", event.target.value)}
          >
            <option value="">All Topics</option>
            {topics.map((topic) => (
              <option key={topic}>{topic}</option>
            ))}
          </select>
        </label>
        {!sources && (
          <label>
            Logger
            <select
              value={filters.logger}
              onChange={(event) => update("logger", event.target.value)}
            >
              <option value="">All loggers</option>
              {members.map(({ user }) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {toolbar}
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Try again
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading {tab}…</p>}
      {data?.length === 0 && (
        <p>No {sources ? "sources" : "logged items"} match this view.</p>
      )}
      {sourceRows && (
        <ul className="research-rows">
          {sourceRows.map((source) => {
            const count = counts?.[source.id];
            return (
              <li
                key={source.id}
                className="research-row"
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest("button, a"))
                    onOpenSource(source.id);
                }}
              >
                <span className="research-kind">
                  {sourceKinds[source.kind]}
                </span>
                <button
                  type="button"
                  className="research-title"
                  data-research-source={source.id}
                  onClick={() => onOpenSource(source.id)}
                >
                  {sourceTitle(source)}
                </button>
                {source.bibliography.publication && (
                  <span className="muted">
                    {source.bibliography.publication.value}
                  </span>
                )}
                {!!count?.total && <span>{commentLabel(count)}</span>}
                {arrivalIds.has(source.id) && (
                  <span className="research-new">New</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {itemRows && (
        <div className={selectedItem ? "research-library-split" : undefined}>
          <ul className="research-rows">
            {itemRows.map((item) => (
              <li key={item.id} className="research-item">
                <ItemSummary request={request} item={item} />
                <button
                  type="button"
                  aria-expanded={item.id === selectedItemId}
                  onClick={(event) => {
                    openedItem.current = event.currentTarget;
                    setSelectedItemId(item.id);
                  }}
                >
                  View {itemKinds[item.kind].toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
          {selectedItem && (
            <aside className="research-detail" aria-label="Library item detail">
              <div className="section-heading">
                <h3 ref={detailRef} tabIndex={-1}>
                  {itemKinds[selectedItem.kind]} details
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    selectedId.current = "";
                    setSelectedItemId("");
                    openedItem.current?.focus();
                  }}
                >
                  Close details
                </button>
              </div>
              <ItemSummary
                key={selectedItem.id}
                item={selectedItem}
                request={request}
                detail
                audioFile={
                  localAudio?.sourceId === selectedItem.sourceId
                    ? localAudio.file
                    : undefined
                }
              />
              {selectedItem.notes && <p>{selectedItem.notes}</p>}
              <button
                type="button"
                onClick={() => onOpenSource(selectedItem.sourceId)}
              >
                Open source
              </button>
            </aside>
          )}
        </div>
      )}
      {!!(filters.page || data?.length === researchPageSize) && (
        <div className="research-pagination" aria-label="Result pages">
          <button
            type="button"
            disabled={!filters.page}
            onClick={() => update("page", filters.page - 1)}
          >
            Previous
          </button>
          <span>Page {filters.page + 1}</span>
          <button
            type="button"
            disabled={data?.length !== researchPageSize || filters.page >= 3333}
            onClick={() => update("page", filters.page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

export function commentLabel(count: { total: number; unread: number }) {
  return `Comments · ${count.total}${count.unread ? ` · ${count.unread} new` : ""}`;
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ItemSummary({
  request,
  item,
  detail = false,
  audioFile,
}: {
  request: ResearchRequest;
  item: LibraryItem;
  detail?: boolean;
  audioFile?: File | undefined;
}) {
  const { projectId, sourceId } = item;
  const loadSource = useCallback(
    (signal: AbortSignal) =>
      getResearchSource(request, projectId, sourceId, signal),
    [projectId, request, sourceId],
  );
  const { data: source } = useResearchRead(loadSource);
  const sourceName = source && sourceTitle(source);
  const player = useRef<YouTubePlayerHandle>(null);
  const [ready, setReady] = useState(false);
  const mediaId =
    source?.kind === "youtube"
      ? (source.sourceIdentity?.providerMediaId ?? source.providerMediaId)
      : undefined;
  const clipVideoId =
    mediaId && /^[A-Za-z0-9_-]{11}$/u.test(mediaId) ? mediaId : undefined;
  const clipText =
    item.kind === "clip"
      ? (item.content.text ?? item.content.originalText)
      : undefined;
  const quote = item.kind === "quote" ? item.content : undefined;
  const title = item.content.title ?? sourceName ?? itemKinds[item.kind];
  const timing =
    item.kind === "clip" || item.kind === "audio" ? item.content : undefined;
  return (
    <>
      <div className="research-item-heading">
        <span className="research-kind">{itemKinds[item.kind]}</span>
        {timing && (
          <span>
            {formatTime(timing.startMs)}–{formatTime(timing.endMs)}
          </span>
        )}
      </div>
      {quote ? (
        <blockquote className={detail ? undefined : "research-excerpt"}>
          {quote.text}
        </blockquote>
      ) : (
        <strong>{title}</strong>
      )}
      {clipText && (
        <p className={detail ? undefined : "research-excerpt"}>{clipText}</p>
      )}
      {quote && (quote.speaker || quote.speakerTitle) && (
        <p>{[quote.speaker, quote.speakerTitle].filter(Boolean).join(", ")}</p>
      )}
      {item.kind === "still" && (
        <ResearchImage
          request={request}
          path={`${projectPath(projectId)}/stills/${item.id}/assets/${detail ? "display" : "thumbnail"}`}
          alt={title}
        />
      )}
      {item.kind === "still" && item.content.credit && (
        <p>{item.content.credit}</p>
      )}
      {item.kind === "clip" &&
        detail &&
        (clipVideoId ? (
          <>
            <YouTubePlayer
              ref={player}
              videoId={clipVideoId}
              onTimeChange={() => {}}
              onReady={() => setReady(true)}
            />
            <button
              type="button"
              disabled={!ready}
              onClick={() =>
                player.current?.playRange(
                  item.content.startMs,
                  item.content.endMs,
                )
              }
            >
              Play saved range
            </button>
          </>
        ) : (
          <p className="muted">Clip preview unavailable.</p>
        ))}
      {item.kind === "audio" && detail && (
        <AudioItemPlayer item={item} request={request} file={audioFile} />
      )}
      {item.kind === "audio" && (
        <>
          <p>
            {item.content.role
              ? audioRoles[item.content.role]
              : "Audio selection"}
          </p>
          {item.content.text && (
            <p className={detail ? undefined : "research-excerpt"}>
              {item.content.text}
            </p>
          )}
        </>
      )}
      {(quote?.citationOverride || sourceName) && (
        <p className="muted">{quote?.citationOverride ?? sourceName}</p>
      )}
      {!!item.topics.length && (
        <p className="research-topics">{item.topics.join(" · ")}</p>
      )}
    </>
  );
}

function AudioItemPlayer({
  item,
  request,
  file,
}: {
  item: Extract<LibraryItem, { kind: "audio" }>;
  request: ResearchRequest;
  file: File | undefined;
}) {
  const player = useRef<HTMLAudioElement>(null);
  const path = `${projectPath(item.projectId)}/audio/${item.sourceId}`;
  const load = useCallback(
    (signal: AbortSignal) =>
      readResearch(request, path, AudioAssetManifestSchema, { signal }),
    [path, request],
  );
  const { data, error } = useResearchRead(load);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <p role="status">Loading waveform…</p>;
  return (
    <AudioPlayer
      request={request}
      path={path}
      manifest={data}
      file={file}
      player={player}
      range={item.content}
    />
  );
}

export function ResearchImage({
  request,
  path,
  alt,
}: {
  request: ResearchRequest;
  path: string;
  alt: string;
}) {
  const [image, setImage] = useState<{ path: string; url?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void request(path, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers
            .get("content-type")
            ?.match(/^image\/(png|jpeg|webp)(?:;|$)/u)
        )
          throw new Error("Image unavailable.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ path, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setImage({ path });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, request]);

  if (image?.path !== path) return <span role="status">Loading picture…</span>;
  return image.url ? (
    <img src={image.url} alt={alt} />
  ) : (
    <p className="muted">Picture unavailable.</p>
  );
}
