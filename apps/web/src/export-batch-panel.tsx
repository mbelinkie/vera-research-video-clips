import React, { useEffect, useMemo, useState } from "react";

import {
  ApiErrorSchema,
  ClipCandidateSchema,
  ClipLanguageEvidenceV2Schema,
  ExportSettingsPreviewSchema,
  LoggedExportBatchSchema,
  languagesEquivalent,
  type ClipCandidate,
  type LoggedExportBatch,
} from "@research-video/contracts";
import { apiFetch } from "./api-client.ts";

export function ExportBatchPanel(props: {
  authorization: string;
  projectId: string;
}) {
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batch, setBatch] = useState<LoggedExportBatch>();
  const [message, setMessage] = useState("Choose at least two eligible clips.");
  const [busy, setBusy] = useState(false);

  async function loadClips(signal?: AbortSignal) {
    if (!props.authorization || !props.projectId) return;
    const response = await apiFetch(
      "cloud",
      `/api/projects/${props.projectId}/clips`,
      signal ? { signal } : {},
      props.authorization,
    );
    const payload: unknown = await response.json();
    if (!response.ok) throw apiError(payload, "Unable to load batch clips.");
    setClips(
      ClipCandidateSchema.array().parse(payload).filter(isBatchEligible),
    );
  }

  useEffect(() => {
    setClips([]);
    setSelected(new Set());
    setBatch(undefined);
    if (!props.authorization || !props.projectId) return;
    const controller = new AbortController();
    void loadClips(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error ? error.message : "Unable to load clips.",
        );
    });
    return () => controller.abort();
  }, [props.authorization, props.projectId]);

  useEffect(() => {
    if (!batch || ["complete", "mixed_terminal"].includes(batch.summary.status))
      return;
    const timer = window.setInterval(() => {
      void apiFetch(
        "cloud",
        `/api/projects/${props.projectId}/export-batches/${batch.id}`,
        {},
        props.authorization,
      )
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok) throw apiError(payload, "Unable to refresh batch.");
          setBatch(LoggedExportBatchSchema.parse(payload));
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [batch, props.authorization, props.projectId]);

  const selectedClips = useMemo(
    () => clips.filter((clip) => selected.has(clip.id)),
    [clips, selected],
  );

  async function submit() {
    if (selectedClips.length < 2) return;
    setBusy(true);
    setMessage("Resolving immutable settings for every sibling…");
    try {
      const items = await Promise.all(
        selectedClips.map(async (clip, index) => {
          const sourceLanguageClass = clipSourceLanguageClass(clip);
          const settingsSelection = {
            base: "context_default" as const,
            overrides: {},
          };
          const previewResponse = await apiFetch(
            "cloud",
            `/api/projects/${props.projectId}/export-settings/preview`,
            {
              method: "POST",
              body: JSON.stringify({
                sourceLanguageClass,
                selection: settingsSelection,
              }),
            },
            props.authorization,
          );
          const previewPayload: unknown = await previewResponse.json();
          if (!previewResponse.ok)
            throw apiError(previewPayload, "Unable to resolve batch settings.");
          const preview = ExportSettingsPreviewSchema.parse(previewPayload);
          if (
            preview.issues.length ||
            !preview.snapshot.resolutionFingerprint
          ) {
            throw new Error(
              "One selected clip has no compatible export worker settings.",
            );
          }
          const evidence = ClipLanguageEvidenceV2Schema.parse(
            clip.languageEvidence,
          );
          return {
            clipId: clip.id,
            export: {
              idempotencyKey: `batch-item:${index}:${clip.id}`,
              requestOrigin: "selection_action",
              sourceLanguageClass,
              ...(sourceLanguageClass === "confirmed_english"
                ? {}
                : {
                    subtitleTracks: {
                      original: {
                        trackId: evidence.native.trackId,
                        trackVersion: evidence.native.trackVersion,
                      },
                      english: {
                        trackId: evidence.english!.trackId,
                        trackVersion: evidence.english!.trackVersion,
                      },
                    },
                  }),
              settingsSelection,
              expectedResolutionFingerprint:
                preview.snapshot.resolutionFingerprint,
            },
          };
        }),
      );
      const commandFingerprint = await sha256Hex(
        JSON.stringify(
          items.map((item) => ({
            clipId: item.clipId,
            fingerprint: item.export.expectedResolutionFingerprint,
          })),
        ),
      );
      const response = await apiFetch(
        "cloud",
        `/api/projects/${props.projectId}/export-batches`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `web-batch:${commandFingerprint}`,
            items,
          }),
        },
        props.authorization,
      );
      const payload: unknown = await response.json();
      if (!response.ok)
        throw apiError(payload, "Unable to queue export batch.");
      const created = LoggedExportBatchSchema.parse(payload);
      setBatch(created);
      setMessage(
        `Queued ${created.summary.total} independent export requests.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to queue batch.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-panel" data-testid="export-batch-panel">
      <h2>Batch export</h2>
      <p className="muted">
        Select 2–25 unexported project clips. Each sibling keeps its own
        execution, progress, cancellation, retry, and result.
      </p>
      {clips.length ? (
        <div className="batch-export-list">
          {clips.map((clip) => (
            <label key={clip.id} className="export-checkbox">
              <input
                type="checkbox"
                checked={selected.has(clip.id)}
                disabled={
                  busy || (!selected.has(clip.id) && selected.size >= 25)
                }
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(clip.id);
                    else next.delete(clip.id);
                    return next;
                  })
                }
              />
              {clip.video.title} — {clip.selection.text.slice(0, 80)}
            </label>
          ))}
        </div>
      ) : (
        <p className="muted">No eligible unexported clips are available.</p>
      )}
      <button
        type="button"
        disabled={busy || selected.size < 2 || selected.size > 25}
        onClick={() => void submit()}
      >
        {busy ? "Queuing batch…" : `Export ${selected.size} selected clips`}
      </button>
      <button
        type="button"
        disabled={busy || !props.authorization || !props.projectId}
        onClick={() =>
          void loadClips().catch((error: unknown) =>
            setMessage(
              error instanceof Error ? error.message : "Unable to load clips.",
            ),
          )
        }
      >
        Refresh eligible clips
      </button>
      {batch ? (
        <p data-testid="export-batch-summary">
          {batch.summary.complete} complete · {batch.summary.failed} failed ·{" "}
          {batch.summary.canceled} canceled ·{" "}
          {batch.summary.total -
            batch.summary.complete -
            batch.summary.failed -
            batch.summary.canceled}{" "}
          active
        </p>
      ) : null}
      <p className="form-message" role="status">
        {message}
      </p>
    </section>
  );
}

function isBatchEligible(clip: ClipCandidate) {
  return (
    clip.exportStatus === "not_requested" &&
    ClipLanguageEvidenceV2Schema.safeParse(clip.languageEvidence).success
  );
}

function clipSourceLanguageClass(
  clip: ClipCandidate,
): "confirmed_english" | "foreign" {
  const evidence = ClipLanguageEvidenceV2Schema.parse(clip.languageEvidence);
  return evidence.native.trackId === evidence.english.trackId &&
    languagesEquivalent(evidence.native.language, "en")
    ? "confirmed_english"
    : "foreign";
}

function apiError(payload: unknown, fallback: string) {
  const parsed = ApiErrorSchema.safeParse(payload);
  return new Error(parsed.success ? parsed.data.error.message : fallback);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
