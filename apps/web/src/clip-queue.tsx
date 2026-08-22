import { useEffect, useMemo, useRef, useState } from "react";

import {
  ClipCandidateSchema,
  ClipTagNameSchema,
  LocalClipLibrarySelectionSchema,
  LocalClipLibraryPageSchema,
  type ClipCandidate,
  type ClipLibraryEntry,
  type LocalClipLibraryPage,
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
  const [entries, setEntries] = useState<ClipLibraryEntry[]>([]);
  const [page, setPage] = useState<LocalClipLibraryPage>();
  const [localAvailability, setLocalAvailability] = useState<
    LocalClipLibraryPage["localAvailability"]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [researchFilter, setResearchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [completedFilter, setCompletedFilter] = useState("any");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [editingClipId, setEditingClipId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading project Clip Library…");
  const requestGeneration = useRef(0);

  function pagePath(
    cursor?: string,
    resetFilters = false,
    restoreLatest = false,
  ) {
    if (restoreLatest) {
      return `/local-agent/api/projects/${projectId}/clip-library/latest`;
    }
    const parameters = new URLSearchParams({
      limit: "25",
      completed: resetFilters ? "any" : completedFilter,
    });
    if (cursor) parameters.set("cursor", cursor);
    if (!resetFilters && query.trim()) parameters.set("query", query.trim());
    if (!resetFilters && tagFilter) parameters.set("tag", tagFilter);
    if (!resetFilters && researchFilter !== "all")
      parameters.set("researchStatus", researchFilter);
    if (!resetFilters && statusFilter !== "all")
      parameters.set("exportStatus", statusFilter);
    return `/local-agent/api/projects/${projectId}/clip-library?${parameters}`;
  }

  async function reload(
    cursor?: string,
    resetFilters = false,
    restoreLatest = false,
  ) {
    if (!projectId || !authorization) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    try {
      const response = await fetch(
        pagePath(cursor, resetFilters, restoreLatest),
        {
          headers: { accept: "application/json", authorization },
        },
      );
      if (restoreLatest && response.status === 503) {
        await reload(undefined, true);
        return;
      }
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error("Unable to load the Clip Library.");
      const loaded = LocalClipLibraryPageSchema.parse(payload);
      if (generation !== requestGeneration.current) return;
      if (restoreLatest) {
        setQuery(loaded.query.query ?? "");
        setTagFilter(loaded.query.tag ?? "");
        setResearchFilter(loaded.query.researchStatus ?? "all");
        setStatusFilter(loaded.query.exportStatus ?? "all");
        setCompletedFilter(loaded.query.completed);
      }
      setPage(loaded);
      setLocalAvailability((current) =>
        cursor
          ? [
              ...current,
              ...loaded.localAvailability.filter(
                (availability) =>
                  !current.some(
                    (candidate) =>
                      candidate.artifactVersionId ===
                      availability.artifactVersionId,
                  ),
              ),
            ]
          : loaded.localAvailability,
      );
      setEntries((current) =>
        cursor
          ? [
              ...current,
              ...loaded.entries.filter(
                (entry) =>
                  !current.some(
                    (candidate) => candidate.clip.id === entry.clip.id,
                  ),
              ),
            ]
          : loaded.entries,
      );
      setSelected((current) =>
        cursor
          ? new Set([...current, ...loaded.selectedClipIds])
          : new Set(loaded.selectedClipIds),
      );
      setMessage(
        loaded.freshness === "stale"
          ? `Offline cached subset from ${new Date(loaded.cachedAt).toLocaleString()}. Cloud changes and mutations are unavailable.`
          : "",
      );
      if (!cursor) {
        void request(`/api/projects/${projectId}/clip-tags`)
          .then((tags) => {
            if (generation === requestGeneration.current) {
              setSuggestedTags(ClipTagNameSchema.array().parse(tags));
            }
          })
          .catch(() => undefined);
      }
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error ? error.message : "Unable to load clips.",
        );
      }
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  useEffect(() => {
    requestGeneration.current += 1;
    setEntries([]);
    setPage(undefined);
    setLocalAvailability([]);
    setSelected(new Set());
    setEditingClipId(undefined);
    setQuery("");
    setTagFilter("");
    setResearchFilter("all");
    setStatusFilter("all");
    setCompletedFilter("any");
    setAvailabilityFilter("all");
    void reload(undefined, true, true);
    // Reads use the current in-memory credential and restart through the local
    // authorization-fingerprint cache only after the same credential returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, authorization]);

  const availabilityByVersion = useMemo(
    () =>
      new Map(
        localAvailability.map((availability) => [
          availability.artifactVersionId,
          availability.locators,
        ]),
      ),
    [localAvailability],
  );

  function entryAvailability(entry: ClipLibraryEntry) {
    const locators = entry.recentArtifactVersions.flatMap(
      (version) => availabilityByVersion.get(version.artifactVersionId) ?? [],
    );
    if (locators.some((locator) => locator.availability === "verified"))
      return "verified";
    if (locators.some((locator) => locator.availability === "invalid"))
      return "invalid";
    if (locators.some((locator) => locator.availability === "missing"))
      return "missing";
    return "none";
  }

  const visibleEntries = useMemo(
    () =>
      availabilityFilter === "all"
        ? entries
        : entries.filter(
            (entry) => entryAvailability(entry) === availabilityFilter,
          ),
    // Availability is a local filter over the cached subset, not a cloud-global
    // predicate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, availabilityFilter, availabilityByVersion],
  );

  function beginEdit(clip: ClipCandidate) {
    if (page?.freshness !== "fresh") {
      setMessage("Reconnect before changing shared clip notes or tags.");
      return;
    }
    setEditingClipId(clip.id);
    setNotes(clip.notes);
    setTagsText(clip.tags.join(", "));
    setMessage("");
  }

  async function saveEdit(clip: ClipCandidate) {
    if (page?.freshness !== "fresh") return;
    setBusy(true);
    try {
      const tags = tagsText
        .split(/[,\n]/u)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const updated = ClipCandidateSchema.parse(
        await request(`/api/projects/${projectId}/clips/${clip.id}`, {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: clip.version, notes, tags }),
        }),
      );
      setEntries((current) =>
        current.map((entry) =>
          entry.clip.id === updated.id ? { ...entry, clip: updated } : entry,
        ),
      );
      setSuggestedTags((current) =>
        [...new Set([...current, ...updated.tags])].toSorted((left, right) =>
          left.localeCompare(right),
        ),
      );
      setEditingClipId(undefined);
      setMessage("Clip notes and tags saved. Refresh to update the cache.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Refresh before retrying; this edit is not replayed offline.`
          : "Unable to save clip.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateSelection(clipId: string, checked: boolean) {
    const generation = requestGeneration.current;
    const next = new Set(selected);
    if (checked) next.add(clipId);
    else next.delete(clipId);
    setSelected(next);
    try {
      const response = await fetch(
        `/local-agent/api/projects/${projectId}/clip-library/selection`,
        {
          method: "PUT",
          headers: {
            accept: "application/json",
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            pageClipIds: [clipId],
            selectedClipIds: checked ? [clipId] : [],
          }),
        },
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error("Unable to persist clip selection.");
      if (generation !== requestGeneration.current) return;
      setSelected(
        new Set(LocalClipLibrarySelectionSchema.parse(payload).selectedClipIds),
      );
    } catch (error) {
      if (generation === requestGeneration.current) {
        setMessage(
          error instanceof Error ? error.message : "Unable to save selection.",
        );
      }
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
      aria-labelledby="clip-library-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Project research log</p>
          <h3 id="clip-library-title">Clip Library</h3>
        </div>
        <div className="clip-queue-actions">
          <button
            type="button"
            disabled={busy || page?.freshness !== "fresh"}
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
          Research status
          <select
            value={researchFilter}
            onChange={(event) => setResearchFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="candidate">Candidate</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
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
            <option value="canceled">Canceled</option>
          </select>
        </label>
        <label>
          Completed versions
          <select
            value={completedFilter}
            onChange={(event) => setCompletedFilter(event.target.value)}
          >
            <option value="any">Any</option>
            <option value="yes">Has completed version</option>
            <option value="no">No completed version</option>
          </select>
        </label>
        <label>
          This cached subset
          <select
            value={availabilityFilter}
            onChange={(event) => setAvailabilityFilter(event.target.value)}
          >
            <option value="all">Any local state</option>
            <option value="verified">Verified locally</option>
            <option value="missing">Missing locally</option>
            <option value="invalid">Invalid locally</option>
            <option value="none">No local locator</option>
          </select>
        </label>
      </div>
      <div className="action-row">
        <button type="button" disabled={busy} onClick={() => void reload()}>
          Apply cloud filters
        </button>
      </div>
      <p className="form-message" role="status">
        {message ||
          `${visibleEntries.length} cached result${visibleEntries.length === 1 ? "" : "s"}; ${selected.size} selected.`}
      </p>
      {visibleEntries.length ? (
        <div className="clip-list">
          {visibleEntries.map((entry) => {
            const clip = entry.clip;
            const editing = editingClipId === clip.id;
            const localState = entryAvailability(entry);
            return (
              <section className="clip-card" key={clip.id}>
                <div className="clip-card-heading">
                  <div>
                    <label className="clip-library-select">
                      <input
                        type="checkbox"
                        checked={selected.has(clip.id)}
                        onChange={(event) =>
                          void updateSelection(clip.id, event.target.checked)
                        }
                      />
                      Select {clip.video.title}
                    </label>
                    <strong>{clip.video.title}</strong>
                    <span>
                      {formatTime(clip.selection.exportStartMs)}–
                      {formatTime(clip.selection.exportEndMs)} ·{" "}
                      {clip.exportStatus.replaceAll("_", " ")}
                    </span>
                    <span>
                      History: {entry.completedVersionCount} completed ·
                      Workstation:{" "}
                      {localState === "none"
                        ? "no verified locator"
                        : localState}
                    </span>
                    {entry.currentLeaves.map((leaf) => (
                      <span key={leaf.requestId}>
                        Export {leaf.state.replaceAll("_", " ")}
                        {leaf.retryOrdinal
                          ? ` · retry ${leaf.retryOrdinal}`
                          : ""}
                        {leaf.progress
                          ? ` · ${leaf.progress.stage.replaceAll("_", " ")} ${Math.floor(leaf.progress.basisPoints / 100)}%`
                          : ""}
                      </span>
                    ))}
                    {entry.hasMoreLeaves ? (
                      <span>Additional export lineages are available.</span>
                    ) : null}
                  </div>
                  <div className="clip-card-actions">
                    <button
                      type="button"
                      onClick={() => onOpenVideo(clip.video.canonicalUrl)}
                    >
                      Open video
                    </button>
                    <button
                      type="button"
                      disabled={busy || page?.freshness !== "fresh"}
                      onClick={() => beginEdit(clip)}
                    >
                      Edit notes/tags
                    </button>
                  </div>
                </div>
                {clip.languageEvidence.schemaVersion === 2 ? (
                  <div className="clip-language-evidence">
                    <blockquote>
                      <strong>
                        Native ({clip.languageEvidence.native.language})
                      </strong>
                      {clip.languageEvidence.native.text}
                    </blockquote>
                    <blockquote>
                      <strong>English</strong>
                      {clip.languageEvidence.english.text}
                    </blockquote>
                    {clip.languageEvidence.preferred ? (
                      <blockquote>
                        <strong>
                          Preferred ({clip.languageEvidence.preferred.language})
                        </strong>
                        {clip.languageEvidence.preferred.text}
                      </blockquote>
                    ) : null}
                  </div>
                ) : (
                  <blockquote>{clip.englishText}</blockquote>
                )}
                {entry.recentArtifactVersions.length ? (
                  <details>
                    <summary>Recent immutable artifact history</summary>
                    <ul>
                      {entry.recentArtifactVersions.map((version) => (
                        <li key={version.artifactVersionId}>
                          {new Date(version.completedAt).toLocaleString()} ·{" "}
                          {version.artifacts.length} artifacts · manifest{" "}
                          {version.manifest.schemaVersion}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
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
      {page?.nextCursor ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void reload(page.nextCursor)}
        >
          Load next page
        </button>
      ) : null}
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
