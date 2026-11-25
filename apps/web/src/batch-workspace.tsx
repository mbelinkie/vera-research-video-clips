import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ApiErrorSchema,
  BatchPreflightResponseSchema,
  CreateTranscriptionBatchResponseSchema,
  ProjectSchema,
  VideoCommentSchema,
  type VideoComment,
  ReviewInboxResponseSchema,
  TranscriptionBatchListResponseSchema,
  languagesEquivalent,
  type BatchPreflightResponse,
  type CloudTranslationConsent,
  type CreateTranscriptionBatchResponse,
  type LanguageGate,
  type Project,
  type ReviewInboxItem,
  type TranscriptionBatchControlRequest,
  type TranscriptionBatchListResponse,
  type TranscriptionExecutionPolicy,
} from "@research-video/contracts";

import {
  MAX_CSV_BYTES,
  CsvImportError,
  extractCsvInputs,
  parseCsvImport,
  type CsvImportDocument,
} from "./csv-import.ts";
import { ClipQueue } from "./clip-queue.tsx";
import { apiFetch, isDesktopRuntime } from "./api-client.ts";
import { cloudFetch } from "./browser-api.ts";
import { immediateProgress } from "./immediate-transcript.ts";
import { ProjectMembersPanel } from "./project-members-panel.tsx";
import {
  normalizeSpokenLanguageChoice,
  spokenLanguageChoiceLabel,
  suggestedSpokenLanguages,
} from "./spoken-language-choice.ts";

type BatchWorkspaceProps = {
  authorization: string;
  browserSession?: boolean;
  csrfToken?: string | undefined;
  onAuthUnavailable?: () => void;
  onAuthorizationChange(value: string): void;
  onOpenSource?: (sourceId: string) => void;
  onOpenVideo(canonicalUrl: string): void;
  onProjectChange(projectId: string): void;
  onProjectsChange(projects: Project[]): void;
  projectId: string;
  projects: readonly Project[];
  batchProviderSelector?: ReactNode;
  transcriptionExecutionPolicy?: TranscriptionExecutionPolicy;
  translationConsent?: CloudTranslationConsent;
};

const apiRoot = "/cloud-api";

type LanguageDecisionDraft = {
  resolvedLanguage: string;
  busy: boolean;
  idempotencyKey?: string;
  error?: string;
};

export function BatchWorkspace({
  authorization,
  browserSession = false,
  csrfToken,
  onAuthUnavailable,
  onAuthorizationChange,
  onOpenSource,
  onOpenVideo,
  onProjectChange,
  onProjectsChange,
  projectId,
  projects,
  batchProviderSelector,
  transcriptionExecutionPolicy,
  translationConsent,
}: BatchWorkspaceProps) {
  const [batchName, setBatchName] = useState("Research batch");
  const [inputsText, setInputsText] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState("prefer-existing");
  const [executionLocation, setExecutionLocation] = useState("local");
  const [priority, setPriority] = useState("normal");
  const [preflight, setPreflight] = useState<BatchPreflightResponse>();
  const [csvDocument, setCsvDocument] = useState<CsvImportDocument>();
  const [csvColumnIndex, setCsvColumnIndex] = useState("");
  const [batchList, setBatchList] = useState<TranscriptionBatchListResponse>();
  const [selectedBatch, setSelectedBatch] =
    useState<CreateTranscriptionBatchResponse>();
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewInboxItem[]>([]);
  const [languageDecisionDrafts, setLanguageDecisionDrafts] = useState<
    Record<string, LanguageDecisionDraft>
  >({});
  const [reviewProjectId, setReviewProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [message, setMessage] = useState(
    browserSession
      ? "Refresh your projects."
      : "Connect with a development session credential to load your projects.",
  );
  const currentContext = useRef({ projectId, authorization });
  currentContext.current = { projectId, authorization };
  const sameContext = (targetProjectId: string, targetAuth = authorization) =>
    currentContext.current.projectId === targetProjectId &&
    currentContext.current.authorization === targetAuth;

  useEffect(() => {
    // Never keep another project's private batch/review rows visible.
    setBatchList(undefined);
    setSelectedBatch(undefined);
    setSelectedBatchId("");
    setReviewItems([]);
    setReviewProjectId("");
    setLanguageDecisionDrafts({});
  }, [projectId, authorization]);

  const visibleReviewItems = reviewProjectId === projectId ? reviewItems : [];
  const visibleBatches =
    batchList?.batches.filter((entry) => entry.batch.projectId === projectId) ??
    [];

  const inputs = useMemo(
    () =>
      inputsText
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    [inputsText],
  );

  async function loadComments(sourceId: string, offset: number) {
    return VideoCommentSchema.array().parse(
      await request(
        `/api/projects/${projectId}/sources/${sourceId}/comments?offset=${offset}`,
      ),
    );
  }
  async function request(path: string, init: RequestInit = {}) {
    const response = isDesktopRuntime()
      ? await apiFetch(
          "cloud",
          path,
          {
            ...(init.method ? { method: init.method } : {}),
            ...(init.body === undefined
              ? {}
              : typeof init.body === "string"
                ? { body: init.body }
                : (() => {
                    throw new TypeError(
                      "Desktop API requests require a JSON string body.",
                    );
                  })()),
            ...(init.signal ? { signal: init.signal } : {}),
          },
          authorization,
        )
      : await cloudFetch(
          `${apiRoot}${path}`,
          {
            ...init,
            headers: {
              accept: "application/json",
              ...(init.body ? { "content-type": "application/json" } : {}),
              ...init.headers,
            },
          },
          { authorization, csrfToken, onUnavailable: onAuthUnavailable },
        );
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new Error(
        parsed.success ? parsed.data.error.message : "Cloud request failed.",
      );
    }
    return payload;
  }

  useEffect(() => {
    if (browserSession && authorization) void connect();
  }, [browserSession, authorization]);

  async function createProject() {
    if (!authorization || !newProject.trim()) return;
    setBusy(true);
    try {
      const created = ProjectSchema.parse(
        await request("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: newProject.trim() }),
        }),
      );
      onProjectsChange([
        ...projects.filter((project) => project.id !== created.id),
        created,
      ]);
      onProjectChange(created.id);
      setNewProject("");
      setMessage(`Created project “${created.name}”.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const loaded = ProjectSchema.array().parse(
        await request("/api/projects"),
      );
      onProjectsChange(loaded);
      onProjectChange(projectId || loaded[0]?.id || "");
      setMessage(
        loaded.length
          ? `Connected. ${loaded.length} project${loaded.length === 1 ? "" : "s"} available.`
          : "Connected, but this account has no projects yet.",
      );
    } catch (error) {
      onProjectsChange([]);
      onProjectChange("");
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshProject(
    targetProjectId = projectId,
    preferredBatchId = selectedBatchId,
  ) {
    if (!targetProjectId || !authorization) return;
    const expectedAuth = authorization;
    try {
      const [listed, inbox] = await Promise.all([
        request(`/api/projects/${targetProjectId}/transcription-batches`),
        request(`/api/projects/${targetProjectId}/review-inbox`),
      ]);
      if (!sameContext(targetProjectId, expectedAuth)) return;
      const parsedList = TranscriptionBatchListResponseSchema.parse(listed);
      const parsedInbox = ReviewInboxResponseSchema.parse(inbox);
      if (
        parsedList.batches.some(
          (entry) => entry.batch.projectId !== targetProjectId,
        )
      )
        throw new Error("Batch list does not match the selected project.");
      setBatchList(parsedList);
      setReviewItems(parsedInbox.items);
      setReviewProjectId(targetProjectId);
      const selectedId =
        parsedList.batches.find((entry) => entry.batch.id === preferredBatchId)
          ?.batch.id ?? parsedList.batches[0]?.batch.id;
      if (selectedId) await loadBatch(targetProjectId, selectedId);
      else {
        setSelectedBatch(undefined);
        setSelectedBatchId("");
      }
    } catch (error) {
      if (sameContext(targetProjectId, expectedAuth))
        setMessage(errorMessage(error));
    }
  }

  async function loadBatch(targetProjectId: string, batchId: string) {
    const expectedAuth = authorization;
    const payload = await request(
      `/api/projects/${targetProjectId}/transcription-batches/${batchId}`,
    );
    if (!sameContext(targetProjectId, expectedAuth)) return;
    const parsed = CreateTranscriptionBatchResponseSchema.parse(payload);
    if (
      parsed.batch.projectId !== targetProjectId ||
      parsed.batch.id !== batchId
    )
      throw new Error("Batch does not match the selected project or request.");
    setSelectedBatch(parsed);
    setSelectedBatchId(batchId);
  }

  useEffect(() => {
    if (!projectId || !authorization) return;
    void refreshProject(projectId);
    const timer = window.setInterval(
      () => void refreshProject(projectId),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [projectId, authorization, selectedBatchId]);

  const requestOptions = {
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy,
    executionLocation: transcriptionExecutionPolicy
      ? transcriptionExecutionPolicy.execution === "cloud"
        ? "hosted"
        : "local"
      : executionLocation,
    priority,
    ...(transcriptionExecutionPolicy ? { transcriptionExecutionPolicy } : {}),
    ...(translationConsent ? { translationConsent } : {}),
  };

  async function runPreflight() {
    if (!projectId || inputs.length === 0) return;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/videos/preflight`,
        {
          method: "POST",
          body: JSON.stringify({ inputs, ...requestOptions }),
        },
      );
      setPreflight(BatchPreflightResponseSchema.parse(payload));
      setMessage(
        "Preflight complete. Review every row before creating the batch.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadCsv(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_CSV_BYTES) {
        throw new CsvImportError("CSV files must be 2 MB or smaller.");
      }
      const document = parseCsvImport(await file.text());
      setCsvDocument(document);
      setCsvColumnIndex(
        document.suggestedColumnIndex === undefined
          ? ""
          : String(document.suggestedColumnIndex),
      );
      setMessage(
        `Loaded ${document.rows.length} CSV row${document.rows.length === 1 ? "" : "s"}. Choose the URL column before applying it.`,
      );
    } catch (error) {
      setCsvDocument(undefined);
      setCsvColumnIndex("");
      setMessage(errorMessage(error));
    }
  }

  function applyCsv() {
    if (!csvDocument || csvColumnIndex === "") return;
    try {
      const extracted = extractCsvInputs(csvDocument, Number(csvColumnIndex));
      setInputsText(extracted.inputs.join("\n"));
      setPreflight(undefined);
      setMessage(
        `Applied ${extracted.inputs.length} CSV value${extracted.inputs.length === 1 ? "" : "s"}${extracted.ignoredEmptyRows ? ` and ignored ${extracted.ignoredEmptyRows} empty row${extracted.ignoredEmptyRows === 1 ? "" : "s"}` : ""}. Run preflight to validate and deduplicate them.`,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function createBatch() {
    if (!projectId || !preflight || !batchName.trim()) return;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/transcription-batches`,
        {
          method: "POST",
          body: JSON.stringify({
            name: batchName,
            inputs,
            ...requestOptions,
          }),
        },
      );
      const created = CreateTranscriptionBatchResponseSchema.parse(payload);
      setSelectedBatch(created);
      setSelectedBatchId(created.batch.id);
      setPreflight(undefined);
      setMessage(`Created “${created.batch.name}”.`);
      await refreshProject(projectId, created.batch.id);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function controlBatch(
    action: TranscriptionBatchControlRequest["action"],
  ) {
    if (!projectId || !selectedBatch) return;
    setBusy(true);
    try {
      const payload = await request(
        `/api/projects/${projectId}/transcription-batches/${selectedBatch.batch.id}/control`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            expectedVersion: selectedBatch.batch.version,
          }),
        },
      );
      setSelectedBatch(CreateTranscriptionBatchResponseSchema.parse(payload));
      setMessage("Batch control applied.");
      await refreshProject(projectId);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function confirmLanguage(
    item: CreateTranscriptionBatchResponse["items"][number],
    gate: LanguageGate,
    resolvedLanguage: string,
  ) {
    if (!projectId || !item.catalogVideoId || !resolvedLanguage) return;
    const targetProjectId = projectId;
    const expectedAuth = authorization;
    const key = languageDecisionKey(
      targetProjectId,
      item.catalogVideoId,
      item.id,
    );
    const idempotencyKey =
      languageDecisionDrafts[key]?.idempotencyKey ?? crypto.randomUUID();
    setLanguageDecisionDrafts((current) => ({
      ...current,
      [key]: { resolvedLanguage, busy: true, idempotencyKey },
    }));
    try {
      await request(
        `/api/projects/${targetProjectId}/videos/${item.catalogVideoId}/language-decisions`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey,
            expectedDecisionVersion: gate.decision?.decisionVersion ?? 0,
            resolvedLanguage,
            basis: "user_confirmation",
            ...(gate.providerEvidence?.id
              ? { evidenceId: gate.providerEvidence.id }
              : {}),
            batchItemId: item.id,
            expectedBatchItemVersion: item.version,
          }),
        },
      );
      if (!sameContext(targetProjectId, expectedAuth)) return;
      setLanguageDecisionDrafts((current) => {
        const { [key]: _completed, ...remaining } = current;
        return remaining;
      });
      setMessage("Language confirmation recorded. Refreshing the batch.");
    } catch (error) {
      if (!sameContext(targetProjectId, expectedAuth)) return;
      setLanguageDecisionDrafts((current) => ({
        ...current,
        [key]: {
          resolvedLanguage,
          busy: false,
          idempotencyKey,
          error: errorMessage(error),
        },
      }));
    } finally {
      if (sameContext(targetProjectId, expectedAuth))
        await refreshProject(targetProjectId, selectedBatchId);
    }
  }

  function setLanguageDecisionDraft(
    item: CreateTranscriptionBatchResponse["items"][number],
    resolvedLanguage: string,
  ) {
    if (!projectId || !item.catalogVideoId) return;
    const key = languageDecisionKey(projectId, item.catalogVideoId, item.id);
    setLanguageDecisionDrafts((current) => ({
      ...current,
      [key]: { resolvedLanguage, busy: false },
    }));
  }

  async function updateReview(item: ReviewInboxItem, reviewStatus: string) {
    if (!projectId) return;
    setBusy(true);
    try {
      await request(`/api/projects/${projectId}/review-inbox/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus, expectedVersion: item.version }),
      });
      setMessage("Review status updated.");
      await refreshProject(projectId);
    } catch (error) {
      setMessage(errorMessage(error));
      await refreshProject(projectId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="batch-workspace" aria-labelledby="queue-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shared project preparation</p>
          <h2 id="queue-title">Transcription queue</h2>
        </div>
        <span className="status">Milestone 3 in progress</span>
      </div>

      <div className="session-panel">
        {!browserSession && (
          <label htmlFor="development-authorization">
            Development session credential
          </label>
        )}
        <div className="loader-row">
          {!browserSession && (
            <input
              id="development-authorization"
              type="password"
              autoComplete="off"
              value={authorization}
              onChange={(event) => onAuthorizationChange(event.target.value)}
              placeholder="Bearer user-uuid|external-subject"
            />
          )}
          <button
            type="button"
            disabled={busy || !authorization}
            onClick={connect}
          >
            {browserSession ? "Refresh projects" : "Connect"}
          </button>
        </div>
        <p className="form-message" role="status">
          {message}
        </p>
      </div>

      {browserSession && (
        <div className="session-panel">
          <label htmlFor="create-browser-project">Create a project</label>
          <div className="loader-row">
            <input
              id="create-browser-project"
              value={newProject}
              maxLength={160}
              onChange={(event) => setNewProject(event.target.value)}
              placeholder="Project name"
            />
            <button
              type="button"
              disabled={busy || !authorization || !newProject.trim()}
              onClick={() => void createProject()}
            >
              Create project
            </button>
          </div>
        </div>
      )}
      {projects.length ? (
        <>
          <label className="project-picker" htmlFor="batch-project">
            <span>Target project</span>
            <select
              id="batch-project"
              value={projectId}
              onChange={(event) => {
                onProjectChange(event.target.value);
                setPreflight(undefined);
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <ProjectMembersPanel
            key={`${projectId}:${authorization}:${csrfToken ?? ""}`}
            authorization={authorization}
            csrfToken={csrfToken}
            onAuthUnavailable={onAuthUnavailable}
            projectId={projectId}
            projectName={
              projects.find((project) => project.id === projectId)?.name ??
              "Selected project"
            }
          />

          <div className="batch-grid">
            <article className="queue-card batch-create-card">
              <h3>Create a transcription batch</h3>
              <label>
                Batch name
                <input
                  value={batchName}
                  onChange={(event) => setBatchName(event.target.value)}
                />
              </label>
              <label>
                YouTube URLs or video IDs, one per line
                <textarea
                  value={inputsText}
                  onChange={(event) => {
                    setInputsText(event.target.value);
                    setPreflight(undefined);
                  }}
                  rows={6}
                />
              </label>
              <div className="csv-import-panel">
                <label htmlFor="batch-csv">Import CSV</label>
                <input
                  id="batch-csv"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void loadCsv(input.files?.[0]).finally(() => {
                      input.value = "";
                    });
                  }}
                />
                {csvDocument ? (
                  <div className="csv-column-row">
                    <label htmlFor="csv-url-column">YouTube URL column</label>
                    <select
                      id="csv-url-column"
                      value={csvColumnIndex}
                      onChange={(event) =>
                        setCsvColumnIndex(event.target.value)
                      }
                    >
                      <option value="">Choose a column</option>
                      {csvDocument.columns.map((column, index) => (
                        <option key={`${column}-${index}`} value={index}>
                          {column}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={csvColumnIndex === ""}
                      onClick={applyCsv}
                    >
                      Use CSV values
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="option-grid">
                <label>
                  Source policy
                  <select
                    value={sourcePolicy}
                    onChange={(event) => {
                      setSourcePolicy(event.target.value);
                      setPreflight(undefined);
                    }}
                  >
                    <option value="prefer-existing">Prefer existing</option>
                    <option value="captions-then-generate">
                      Captions, then generate
                    </option>
                    <option value="force-generate">Force generation</option>
                  </select>
                </label>
                {batchProviderSelector ? (
                  batchProviderSelector
                ) : (
                  <label>
                    Worker
                    <select
                      value={executionLocation}
                      onChange={(event) => {
                        setExecutionLocation(event.target.value);
                        setPreflight(undefined);
                      }}
                    >
                      <option value="local">Local</option>
                      <option value="hosted">Hosted</option>
                    </select>
                  </label>
                )}
                <label>
                  Priority
                  <select
                    value={priority}
                    onChange={(event) => {
                      setPriority(event.target.value);
                      setPreflight(undefined);
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  disabled={busy || inputs.length === 0}
                  onClick={runPreflight}
                >
                  Preflight {inputs.length || ""}
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !preflight || !batchName.trim()}
                  onClick={createBatch}
                >
                  Create batch
                </button>
              </div>
              {preflight ? <PreflightTable preflight={preflight} /> : null}
            </article>

            <article className="queue-card">
              <h3>Batches</h3>
              {visibleBatches.length ? (
                <div className="batch-list">
                  {visibleBatches.map((entry) => (
                    <button
                      type="button"
                      className={
                        selectedBatch?.batch.id === entry.batch.id
                          ? "batch-list-item selected"
                          : "batch-list-item"
                      }
                      key={entry.batch.id}
                      onClick={() => void loadBatch(projectId, entry.batch.id)}
                    >
                      <strong>{entry.batch.name}</strong>
                      <span>
                        {entry.batch.dispatchStatus} ·{" "}
                        {entry.progress.readyForReview} ready ·{" "}
                        {entry.progress.active} active · {entry.progress.queued}{" "}
                        queued
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">No transcription batches yet.</p>
              )}
              {selectedBatch && selectedBatch.batch.projectId === projectId ? (
                <BatchDetail
                  batch={selectedBatch}
                  loadComments={loadComments}
                  busy={busy}
                  onControl={controlBatch}
                  projectId={projectId}
                  languageDecisionDrafts={languageDecisionDrafts}
                  onLanguageDraftChange={setLanguageDecisionDraft}
                  onConfirmLanguage={(item, gate, resolvedLanguage) =>
                    void confirmLanguage(item, gate, resolvedLanguage)
                  }
                />
              ) : null}
            </article>
          </div>

          <article className="queue-card review-card">
            <h3>
              Ready for review{" "}
              <span className="count-badge">{visibleReviewItems.length}</span>
            </h3>
            {visibleReviewItems.length ? (
              <div className="review-list">
                {visibleReviewItems.map((item) => (
                  <div className="review-item" key={item.id}>
                    <div>
                      <strong>{item.title ?? item.youtubeVideoId}</strong>
                      <VideoComments
                        key={item.id}
                        item={item}
                        load={loadComments}
                      />
                      <span>
                        {item.batchName}
                        {item.channel ? ` · ${item.channel}` : ""}
                      </span>
                    </div>
                    <select
                      aria-label={`Review status for ${item.title ?? item.youtubeVideoId}`}
                      value={item.reviewStatus}
                      disabled={busy}
                      onChange={(event) =>
                        void updateReview(item, event.target.value)
                      }
                    >
                      <option value="unreviewed">Unreviewed</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="skipped">Skipped</option>
                    </select>
                    {item.catalogVideoId && onOpenSource ? (
                      <button
                        type="button"
                        data-testid="open-youtube-source"
                        onClick={() => onOpenSource(item.catalogVideoId!)}
                      >
                        Open source
                      </button>
                    ) : null}
                    {item.canonicalUrl ? (
                      <button
                        type="button"
                        onClick={() => onOpenVideo(item.canonicalUrl!)}
                      >
                        Open video
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                Completed transcripts will appear here without being hidden by
                failed siblings.
              </p>
            )}
          </article>
          <ClipQueue
            authorization={authorization}
            projectId={projectId}
            request={request}
            onAuthUnavailable={onAuthUnavailable}
            onOpenVideo={onOpenVideo}
          />
        </>
      ) : null}
    </section>
  );
}

function PreflightTable({ preflight }: { preflight: BatchPreflightResponse }) {
  return (
    <div className="table-wrap">
      <p className="summary-line">
        {preflight.summary.ready} to transcribe ·{" "}
        {preflight.summary.existingTranscripts} reusable ·{" "}
        {preflight.summary.duplicates} duplicates ·{" "}
        {preflight.summary.unsupported + preflight.summary.metadataFailed}{" "}
        blocked
      </p>
      <table>
        <thead>
          <tr>
            <th>Video</th>
            <th>Status</th>
            <th>Need</th>
          </tr>
        </thead>
        <tbody>
          {preflight.items.map((item) => (
            <tr key={item.inputIndex}>
              <td>{item.title ?? item.input}</td>
              <td>{item.status}</td>
              <td>{item.processingNeed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchDetail({
  batch,
  loadComments,
  busy,
  onControl,
  projectId,
  languageDecisionDrafts,
  onLanguageDraftChange,
  onConfirmLanguage,
}: {
  batch: CreateTranscriptionBatchResponse;
  loadComments: (sourceId: string, offset: number) => Promise<VideoComment[]>;
  busy: boolean;
  onControl(action: TranscriptionBatchControlRequest["action"]): void;
  projectId: string;
  languageDecisionDrafts: Record<string, LanguageDecisionDraft>;
  onLanguageDraftChange(
    item: CreateTranscriptionBatchResponse["items"][number],
    resolvedLanguage: string,
  ): void;
  onConfirmLanguage(
    item: CreateTranscriptionBatchResponse["items"][number],
    gate: LanguageGate,
    resolvedLanguage: string,
  ): void;
}) {
  const canDispatch = batch.batch.dispatchStatus !== "canceled";
  return (
    <div className="batch-detail">
      <div className="action-row">
        {batch.batch.dispatchStatus === "active" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onControl("pause_pending")}
          >
            Pause pending
          </button>
        ) : null}
        {batch.batch.dispatchStatus === "paused" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onControl("resume")}
          >
            Resume
          </button>
        ) : null}
        {canDispatch && batch.progress.retryableFailed > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onControl("retry_failed")}
          >
            Retry failed
          </button>
        ) : null}
        {canDispatch && batch.progress.queued > 0 ? (
          <button
            type="button"
            className="danger-action"
            disabled={busy}
            onClick={() => onControl("cancel_unstarted")}
          >
            Cancel unstarted
          </button>
        ) : null}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Video</th>
              <th>Stage</th>
              <th>Attempt</th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.title ?? item.input}
                  <VideoComments
                    key={item.id}
                    item={item}
                    load={loadComments}
                  />
                  {item.error ? <small>{safeBatchError(item)}</small> : null}
                  {item.languageGate?.state &&
                  item.languageGate.state !== "ready" ? (
                    <LanguageConfirmation
                      item={item}
                      gate={item.languageGate}
                      draft={
                        item.catalogVideoId
                          ? languageDecisionDrafts[
                              languageDecisionKey(
                                projectId,
                                item.catalogVideoId,
                                item.id,
                              )
                            ]
                          : undefined
                      }
                      onDraftChange={onLanguageDraftChange}
                      onConfirm={onConfirmLanguage}
                    />
                  ) : null}
                </td>
                <td>{item.state}</td>
                <td>{item.attempt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function languageDecisionKey(
  projectId: string,
  catalogVideoId: string,
  batchItemId: string,
) {
  return `${projectId}:${catalogVideoId}:${batchItemId}`;
}

function LanguageConfirmation({
  item,
  gate,
  draft,
  onDraftChange,
  onConfirm,
}: {
  item: CreateTranscriptionBatchResponse["items"][number];
  gate: LanguageGate;
  draft?: LanguageDecisionDraft | undefined;
  onDraftChange(
    item: CreateTranscriptionBatchResponse["items"][number],
    resolvedLanguage: string,
  ): void;
  onConfirm(
    item: CreateTranscriptionBatchResponse["items"][number],
    gate: LanguageGate,
    resolvedLanguage: string,
  ): void;
}) {
  const choices = [
    ...new Set([
      gate.creatorReportedLanguage,
      gate.providerEvidence?.reportedLanguage,
      gate.decision?.resolvedLanguage,
    ]),
  ].filter((language): language is string => Boolean(language));
  const selectedLanguage = draft?.resolvedLanguage ?? choices[0] ?? "";
  const confirmedLanguage = normalizeSpokenLanguageChoice(selectedLanguage);
  const requiresExplicitLanguage = choices.length === 0;
  const suggestionsId = `spoken-language-suggestions-${item.id}`;
  const unsupported = [gate.speechCapability, gate.translationCapability]
    .filter((capability): capability is NonNullable<typeof capability> =>
      Boolean(capability),
    )
    .find((capability) => capability.state !== "supported");
  const selectedCapabilityUnsupported = Boolean(
    unsupported?.sourceLanguage &&
    confirmedLanguage &&
    languagesEquivalent(unsupported.sourceLanguage, confirmedLanguage),
  );

  return (
    <fieldset>
      <legend>Language confirmation required</legend>
      <p>
        Provider-reported language:{" "}
        {gate.providerEvidence?.reportedLanguage ?? "Unknown"}
      </p>
      <p>
        Creator-reported language: {gate.creatorReportedLanguage ?? "Unknown"}
      </p>
      <p>
        Current resolved language:{" "}
        {gate.decision?.resolvedLanguage ?? "Unresolved"}
      </p>
      <p>
        Status: {gate.status}. Basis:{" "}
        {gate.decision?.basis ?? "Not yet confirmed"}. Decision version:{" "}
        {gate.decision?.decisionVersion ?? 0}.
      </p>
      <p>Speech capability: {capabilitySummary(gate.speechCapability)}</p>
      <p>
        Translation capability: {capabilitySummary(gate.translationCapability)}
      </p>
      <p>{remediationCopy(gate.remediationReason)}</p>
      <label>
        Confirmed spoken language
        {requiresExplicitLanguage ? (
          <>
            <input
              aria-label={`Confirmed spoken language for ${item.title ?? item.input}`}
              list={suggestionsId}
              value={selectedLanguage}
              maxLength={35}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={draft?.busy}
              placeholder="Choose or type a language code"
              onChange={(event) => onDraftChange(item, event.target.value)}
            />
            <datalist id={suggestionsId}>
              {suggestedSpokenLanguages.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </datalist>
          </>
        ) : (
          <select
            aria-label={`Confirmed spoken language for ${item.title ?? item.input}`}
            value={selectedLanguage}
            disabled={draft?.busy}
            onChange={(event) => onDraftChange(item, event.target.value)}
          >
            {choices.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        )}
      </label>
      {requiresExplicitLanguage ? (
        selectedLanguage && !confirmedLanguage ? (
          <p role="alert">
            Enter a valid BCP-47 language tag, such as en, dz, or zh-Hant.
          </p>
        ) : (
          <p className="form-message">
            {confirmedLanguage
              ? `Selected: ${spokenLanguageChoiceLabel(confirmedLanguage)}`
              : "No language was detected. Choose a suggestion or type a BCP-47 language tag."}
          </p>
        )
      ) : null}
      <button
        type="button"
        disabled={
          draft?.busy ||
          !confirmedLanguage ||
          !item.catalogVideoId ||
          selectedCapabilityUnsupported
        }
        onClick={() => onConfirm(item, gate, confirmedLanguage ?? "")}
      >
        {selectedCapabilityUnsupported
          ? "Choose a supported language to retry"
          : "Confirm language and retry"}
      </button>
      {!item.catalogVideoId ? (
        <p role="alert">
          This item cannot be confirmed until its project video is available.
        </p>
      ) : null}
      {draft?.error ? <p role="alert">{draft.error}</p> : null}
    </fieldset>
  );
}

function remediationCopy(reason: LanguageGate["remediationReason"]) {
  switch (reason) {
    case "confirm_language":
      return "Confirm the spoken language before transcription can continue.";
    case "resolve_conflict":
      return "Provider and creator language evidence conflict. Confirm the spoken language before any dependent work continues.";
    case "select_supported_provider":
      return "The selected language needs a supported provider before work can continue.";
    default:
      return "Language evidence needs remediation before work can continue.";
  }
}

function capabilitySummary(
  capability:
    LanguageGate["speechCapability"] | LanguageGate["translationCapability"],
) {
  if (!capability) return "Not evaluated";
  return capability.state === "supported"
    ? "Supported"
    : `${capability.state.replaceAll("_", " ")} (${capability.reason.replaceAll("_", " ")})`;
}

function safeBatchError(
  item: CreateTranscriptionBatchResponse["items"][number],
) {
  const progress = immediateProgress(item);
  return progress.kind === "failed"
    ? progress.message
    : "Transcript processing requires attention.";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

function VideoComments({
  item,
  load,
}: {
  item: CreateTranscriptionBatchResponse["items"][number];
  load: (sourceId: string, offset: number) => Promise<VideoComment[]>;
}) {
  const [older, setOlder] = useState<VideoComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const comments = [...(item.videoComments ?? []), ...older];
  if (!comments.length) return null;
  async function more() {
    if (!item.catalogVideoId || busy) return;
    setBusy(true);
    setError("");
    try {
      const page = await load(item.catalogVideoId, comments.length);
      setOlder((previous) => [...previous, ...page]);
    } catch {
      setError("Comments could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div aria-label="Video comments">
      {comments.map((comment) => {
        const { timecodeMs } = comment;
        const sec = Math.floor((timecodeMs ?? 0) / 1000);
        return (
          <p className="submission-comment" key={comment.id}>
            <strong>{comment.authorName}</strong>
            {" · "}
            {timecodeMs !== null && (
              <>
                <time dateTime={`PT${timecodeMs / 1000}S`}>
                  {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
                </time>{" "}
              </>
            )}
            {comment.text}
          </p>
        );
      })}
      {comments.length < (item.videoCommentCount ?? 0) && (
        <button type="button" disabled={busy} onClick={() => void more()}>
          More comments
        </button>
      )}
      {error && <p role="status">{error}</p>}
    </div>
  );
}
