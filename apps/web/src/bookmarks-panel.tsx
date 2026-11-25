import { useCallback, useEffect, useState } from "react";
import {
  ApiErrorSchema,
  LocalProjectBookmarkPageSchema,
  OfflineProjectBookmarkMutationResultSchema,
  type ProjectBookmark,
  type OfflineProjectBookmarkCommand,
  type ProjectRole,
} from "@research-video/contracts";
import { apiFetch } from "./api-client.ts";

export function BookmarksPanel(props: {
  authorization: string;
  projectId: string;
  videoId: string;
  currentMs: number;
  currentUserId?: string;
  currentRole?: ProjectRole;
  onSeek(ms: number): void;
  onOpen(target: ProjectBookmark): void;
}) {
  const [page, setPage] = useState<ProjectBookmark[]>([]);
  const [outbox, setOutbox] = useState<OfflineProjectBookmarkCommand[]>([]);
  const [freshness, setFreshness] = useState<"fresh" | "stale">("fresh");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [wholeProject, setWholeProject] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState("");
  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await apiFetch("local", path, init, props.authorization);
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Bookmark request failed.",
        );
      }
      return payload;
    },
    [props.authorization],
  );
  const load = useCallback(async () => {
    if (!props.projectId || !props.videoId || !props.authorization) return;
    const query = new URLSearchParams({
      scope: wholeProject ? "project" : "video",
      state: showArchived ? "all" : "active",
      limit: "50",
    });
    if (!wholeProject) query.set("videoId", props.videoId);
    if (search.trim()) query.set("search", search.trim());
    try {
      await request(`/api/projects/${props.projectId}/bookmark-outbox/replay`, {
        method: "POST",
      });
      const result = LocalProjectBookmarkPageSchema.parse(
        await request(`/api/projects/${props.projectId}/bookmarks?${query}`),
      );
      setPage(result.items);
      setOutbox(result.outbox);
      setFreshness(result.freshness);
      setMessage(
        result.freshness === "stale"
          ? "Showing the last authorized offline bookmark cache."
          : "",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load bookmarks.",
      );
    }
  }, [
    props.projectId,
    props.videoId,
    request,
    search,
    showArchived,
    wholeProject,
  ]);
  useEffect(() => void load(), [load]);

  async function create() {
    try {
      const result = OfflineProjectBookmarkMutationResultSchema.parse(
        await request(`/api/projects/${props.projectId}/bookmarks`, {
          method: "POST",
          body: JSON.stringify({
            videoId: props.videoId,
            sourceTimeMs: Math.max(0, Math.round(props.currentMs)),
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            idempotencyKey: `bookmark-create:${crypto.randomUUID()}`,
          }),
        }),
      );
      if (result.state !== "conflict") {
        setTitle("");
        setNote("");
      }
      setMessage(
        result.state === "applied"
          ? "Bookmark saved."
          : result.state === "queued"
            ? "Bookmark queued offline and will replay in order."
            : "Bookmark conflict retained with its title and note.",
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save bookmark.",
      );
    }
  }

  async function mutate(
    bookmark: ProjectBookmark,
    action: "archive" | "restore" | "edit",
  ) {
    try {
      let path = `/api/projects/${props.projectId}/bookmarks/${bookmark.id}`;
      let body: Record<string, unknown> = { expectedVersion: bookmark.version };
      if (action === "edit") {
        const nextTitle = window.prompt(
          "Bookmark title (blank removes it):",
          bookmark.title ?? "",
        );
        if (nextTitle === null) return;
        const nextNote = window.prompt(
          "Bookmark note (blank removes it):",
          bookmark.note ?? "",
        );
        if (nextNote === null) return;
        body = {
          ...body,
          title: nextTitle.trim() || null,
          note: nextNote.trim() || null,
        };
      } else path += `/${action}`;
      body.idempotencyKey = `bookmark-${action}:${crypto.randomUUID()}`;
      const result = OfflineProjectBookmarkMutationResultSchema.parse(
        await request(path, {
          method: action === "edit" ? "PATCH" : "POST",
          body: JSON.stringify(body),
        }),
      );
      setMessage(
        result.state === "applied"
          ? "Bookmark updated."
          : result.state === "queued"
            ? "Bookmark change queued offline."
            : "Bookmark conflict retained for review.",
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Bookmark conflict retained; reload and retry.",
      );
      await load();
    }
  }

  return (
    <section className="bookmarks-panel" aria-label="Bookmarks">
      <div className="selection-heading">
        <strong>Bookmarks</strong>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <input
        aria-label="Bookmark title"
        maxLength={120}
        value={title}
        placeholder="Optional title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        aria-label="Bookmark note"
        maxLength={4000}
        value={note}
        placeholder="Optional searchable note"
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        disabled={!props.videoId}
        onClick={() => void create()}
      >
        Bookmark current time
      </button>
      <div className="action-row">
        <input
          aria-label="Search bookmarks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or note"
        />
        <label>
          <input
            type="checkbox"
            checked={wholeProject}
            onChange={(e) => setWholeProject(e.target.checked)}
          />
          Whole project
        </label>
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived
        </label>
      </div>
      {message ? (
        <p role="status" className="muted">
          {message}
        </p>
      ) : null}
      {freshness === "stale" ? (
        <span className="status-chip warning">Offline cache</span>
      ) : null}
      {outbox.length ? (
        <div className="bookmark-outbox" aria-label="Bookmark sync status">
          {outbox.map((command) => (
            <article className="review-item" key={command.outboxId}>
              <strong>
                {command.state === "queued" ? "Queued offline" : "Conflict"}
              </strong>
              <span>
                {command.title ??
                  command.note ??
                  command.commandType
                    .replace("bookmark.", "")
                    .replace(".v1", "")}
              </span>
              {command.note && command.title ? (
                <span>{command.note}</span>
              ) : null}
              {command.code ? <span>{command.code}</span> : null}
            </article>
          ))}
        </div>
      ) : null}
      <div className="bookmark-list">
        {page.map((bookmark) => {
          const own = bookmark.createdBy.userId === props.currentUserId;
          const moderate =
            own ||
            props.currentRole === "owner" ||
            props.currentRole === "administrator";
          return (
            <article className="review-item" key={bookmark.id}>
              <button
                type="button"
                className="quiet-button"
                onClick={() =>
                  bookmark.videoId === props.videoId
                    ? props.onSeek(bookmark.sourceTimeMs)
                    : props.onOpen(bookmark)
                }
              >
                {formatTime(bookmark.sourceTimeMs)} ·{" "}
                {bookmark.title ??
                  bookmark.source?.title ??
                  "Untitled bookmark"}
              </button>
              {bookmark.note ? <span>{bookmark.note}</span> : null}
              <span>
                {bookmark.state} · @{bookmark.createdBy.handle}
              </span>
              <div className="action-row">
                {own ? (
                  <button
                    type="button"
                    onClick={() => void mutate(bookmark, "edit")}
                  >
                    Edit
                  </button>
                ) : null}
                {moderate ? (
                  <button
                    type="button"
                    onClick={() =>
                      void mutate(
                        bookmark,
                        bookmark.state === "active" ? "archive" : "restore",
                      )
                    }
                  >
                    {bookmark.state === "active" ? "Archive" : "Restore"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
