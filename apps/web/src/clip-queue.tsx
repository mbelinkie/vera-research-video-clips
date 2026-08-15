import { useEffect, useMemo, useState } from "react";

import {
  ClipCandidateSchema,
  ClipTagNameSchema,
  type ClipCandidate,
} from "@research-video/contracts";

type CloudRequest = (path: string, init?: RequestInit) => Promise<unknown>;

type ClipQueueProps = {
  authorization: string;
  projectId: string;
  request: CloudRequest;
  onOpenVideo(canonicalUrl: string): void;
};

export function ClipQueue({
  authorization,
  projectId,
  request,
  onOpenVideo,
}: ClipQueueProps) {
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingClipId, setEditingClipId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading project clips…");

  async function reload() {
    if (!projectId) return;
    setBusy(true);
    try {
      const [listed, tags] = await Promise.all([
        request(`/api/projects/${projectId}/clips`),
        request(`/api/projects/${projectId}/clip-tags`),
      ]);
      setClips(ClipCandidateSchema.array().parse(listed));
      setSuggestedTags(ClipTagNameSchema.array().parse(tags));
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load clips.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setEditingClipId(undefined);
    setQuery("");
    setTagFilter("");
    setStatusFilter("all");
    void reload();
    // `request` deliberately reads the current in-memory session credential.
    // Reloads are tied to an explicit project change or user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const visibleClips = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return clips.filter((clip) => {
      if (statusFilter !== "all" && clip.exportStatus !== statusFilter) {
        return false;
      }
      if (tagFilter && !clip.tags.includes(tagFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        clip.video.title,
        clip.englishText,
        clip.notes,
        ...clip.tags,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [clips, query, statusFilter, tagFilter]);

  function beginEdit(clip: ClipCandidate) {
    setEditingClipId(clip.id);
    setNotes(clip.notes);
    setTagsText(clip.tags.join(", "));
    setMessage("");
  }

  async function saveEdit(clip: ClipCandidate) {
    setBusy(true);
    try {
      const tags = tagsText
        .split(/[,\n]/u)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const updated = ClipCandidateSchema.parse(
        await request(`/api/projects/${projectId}/clips/${clip.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: clip.version,
            notes,
            tags,
          }),
        }),
      );
      setClips((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      setSuggestedTags((current) =>
        [...new Set([...current, ...updated.tags])].toSorted((left, right) =>
          left.localeCompare(right),
        ),
      );
      setEditingClipId(undefined);
      setMessage("Clip notes and tags saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save clip.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    setBusy(true);
    try {
      const response = await fetch(
        `/cloud-api/api/projects/${projectId}/clips.csv`,
        { headers: { authorization } },
      );
      if (!response.ok) throw new Error("Unable to export the project CSV.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `project-clips-${projectId}.csv`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setMessage("Downloaded the project clip log as CSV.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to export the project CSV.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="queue-card clip-queue"
      aria-labelledby="clip-queue-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Project research log</p>
          <h3 id="clip-queue-title">Clip queue</h3>
        </div>
        <div className="clip-queue-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadCsv()}
          >
            Export CSV
          </button>
          <button type="button" disabled={busy} onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </div>
      <div className="clip-filter-grid">
        <label>
          Search clips
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Passage, note, tag, or video"
          />
        </label>
        <label>
          Filter tag
          <select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="">All tags</option>
            {suggestedTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label>
          Export status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="not_requested">Not requested</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>
      <p className="form-message" role="status">
        {message ||
          `${visibleClips.length} of ${clips.length} clip${clips.length === 1 ? "" : "s"}.`}
      </p>
      {visibleClips.length ? (
        <div className="clip-list">
          {visibleClips.map((clip) => {
            const editing = editingClipId === clip.id;
            return (
              <section className="clip-card" key={clip.id}>
                <div className="clip-card-heading">
                  <div>
                    <strong>{clip.video.title}</strong>
                    <span>
                      {formatTime(clip.selection.exportStartMs)}–
                      {formatTime(clip.selection.exportEndMs)} ·{" "}
                      {clip.exportStatus.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="clip-card-actions">
                    <button
                      type="button"
                      onClick={() => onOpenVideo(clip.video.canonicalUrl)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => beginEdit(clip)}
                    >
                      Edit notes/tags
                    </button>
                  </div>
                </div>
                <blockquote>{clip.englishText}</blockquote>
                {editing ? (
                  <div className="clip-edit-form">
                    <label>
                      Notes / intended use
                      <textarea
                        aria-label={`Notes for ${clip.video.title}`}
                        rows={3}
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </label>
                    <label>
                      Tags
                      <input
                        aria-label={`Tags for ${clip.video.title}`}
                        list="project-tag-suggestions"
                        value={tagsText}
                        onChange={(event) => setTagsText(event.target.value)}
                      />
                    </label>
                    <div className="action-row">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveEdit(clip)}
                      >
                        Save clip
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingClipId(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {clip.notes ? (
                      <p className="clip-notes">{clip.notes}</p>
                    ) : null}
                    <div className="clip-tags">
                      {clip.tags.length ? (
                        clip.tags.map((tag) => <span key={tag}>{tag}</span>)
                      ) : (
                        <span className="muted">No tags</span>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="muted">No clip candidates match the current filters.</p>
      )}
      <datalist id="project-tag-suggestions">
        {suggestedTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </article>
  );
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
