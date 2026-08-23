import { useEffect, useMemo, useState } from "react";

import {
  ApiErrorSchema,
  BatchPreflightResponseSchema,
  CreateTranscriptionBatchResponseSchema,
  ProjectSchema,
  ReviewInboxResponseSchema,
  TranscriptionBatchListResponseSchema,
  type BatchPreflightResponse,
  type CreateTranscriptionBatchResponse,
  type Project,
  type ReviewInboxItem,
  type TranscriptionBatchControlRequest,
  type TranscriptionBatchListResponse,
} from "@research-video/contracts";

import {
  MAX_CSV_BYTES,
  CsvImportError,
  extractCsvInputs,
  parseCsvImport,
  type CsvImportDocument,
} from "./csv-import.ts";
import { ClipQueue } from "./clip-queue.tsx";

type BatchWorkspaceProps = {
  authorization: string;
  onAuthorizationChange(value: string): void;
  onOpenVideo(canonicalUrl: string): void;
  onProjectChange(projectId: string): void;
  onProjectsChange(projects: Project[]): void;
  projectId: string;
  projects: readonly Project[];
};

const apiRoot = "/cloud-api";

export function BatchWorkspace({
  authorization,
  onAuthorizationChange,
  onOpenVideo,
  onProjectChange,
  onProjectsChange,
  projectId,
  projects,
}: BatchWorkspaceProps) {
  const [batchName, setBatchName] = useState("Research batch");
  const [inputsText, setInputsText] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState("prefer-existing");
  const [executionLocation, setExecutionLocation] = useState("local");
  const [priority, setPriority] = useState("normal");
  const [translationConsentAccepted, setTranslationConsentAccepted] =
    useState(false);
  const [preflight, setPreflight] = useState<BatchPreflightResponse>();
  const [csvDocument, setCsvDocument] = useState<CsvImportDocument>();
  const [csvColumnIndex, setCsvColumnIndex] = useState("");
  const [batchList, setBatchList] = useState<TranscriptionBatchListResponse>();
  const [selectedBatch, setSelectedBatch] =
    useState<CreateTranscriptionBatchResponse>();
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [reviewItems, setReviewItems] = useState<ReviewInboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Connect with a development session credential to load your projects.",
  );

  const inputs = useMemo(
    () =>
      inputsText
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    [inputsText],
  );

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${apiRoot}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new Error(
        parsed.success ? parsed.data.error.message : "Cloud request failed.",
      );
    }
    return payload;
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
    try {
      const [listed, inbox] = await Promise.all([
        request(`/api/projects/${targetProjectId}/transcription-batches`),
        request(`/api/projects/${targetProjectId}/review-inbox`),
      ]);
      const parsedList = TranscriptionBatchListResponseSchema.parse(listed);
      const parsedInbox = ReviewInboxResponseSchema.parse(inbox);
      setBatchList(parsedList);
      setReviewItems(parsedInbox.items);
      const selectedId =
        parsedList.batches.find((entry) => entry.batch.id === preferredBatchId)
          ?.batch.id ?? parsedList.batches[0]?.batch.id;
      if (selectedId) await loadBatch(targetProjectId, selectedId);
      else {
        setSelectedBatch(undefined);
        setSelectedBatchId("");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function loadBatch(targetProjectId: string, batchId: string) {
    const payload = await request(
      `/api/projects/${targetProjectId}/transcription-batches/${batchId}`,
    );
    setSelectedBatch(CreateTranscriptionBatchResponseSchema.parse(payload));
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
    executionLocation,
    priority,
    ...(translationConsentAccepted
      ? {
          translationConsent: {
            provider: "amazon-translate" as const,
            disclosureVersion: 1 as const,
            transcriptTextTransferAccepted: true as const,
          },
        }
      : {}),
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
        <label htmlFor="development-authorization">
          Development session credential
        </label>
        <div className="loader-row">
          <input
            id="development-authorization"
            type="password"
            autoComplete="off"
            value={authorization}
            onChange={(event) => onAuthorizationChange(event.target.value)}
            placeholder="Bearer user-uuid|external-subject"
          />
          <button
            type="button"
            disabled={busy || !authorization}
            onClick={connect}
          >
            Connect
          </button>
        </div>
        <p className="form-message" role="status">
          {message}
        </p>
      </div>

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
              <label className="cloud-translation-consent">
                <input
                  type="checkbox"
                  checked={translationConsentAccepted}
                  onChange={(event) => {
                    setTranslationConsentAccepted(event.target.checked);
                    setPreflight(undefined);
                  }}
                />
                <span>
                  Allow Amazon Translate when a source is not English. The
                  version-pinned transcript text will be sent to Amazon only for
                  this batch; no media or local AWS credentials are sent.
                </span>
              </label>
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
              {batchList?.batches.length ? (
                <div className="batch-list">
                  {batchList.batches.map((entry) => (
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
              {selectedBatch ? (
                <BatchDetail
                  batch={selectedBatch}
                  busy={busy}
                  onControl={controlBatch}
                />
              ) : null}
            </article>
          </div>

          <article className="queue-card review-card">
            <h3>
              Ready for review{" "}
              <span className="count-badge">{reviewItems.length}</span>
            </h3>
            {reviewItems.length ? (
              <div className="review-list">
                {reviewItems.map((item) => (
                  <div className="review-item" key={item.id}>
                    <div>
                      <strong>{item.title ?? item.youtubeVideoId}</strong>
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
  busy,
  onControl,
}: {
  batch: CreateTranscriptionBatchResponse;
  busy: boolean;
  onControl(action: TranscriptionBatchControlRequest["action"]): void;
}) {
  const canDispatch = batch.batch.dispatchStatus !== "canceled";
  return (
    <div className="batch-detail">
      {batch.batch.translationConsent ? (
        <p className="translation-consent-summary">
          Amazon Translate consent recorded for this batch (disclosure v
          {batch.batch.translationConsent.disclosureVersion}).
        </p>
      ) : null}
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
                  {item.error ? <small>{item.error.message}</small> : null}
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}
