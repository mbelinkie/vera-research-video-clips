import {
  ApiErrorSchema,
  CreateTranscriptionBatchResponseSchema,
  ProjectVideoWorklistPageSchema,
  RetryTranscriptionBatchItemResponseSchema,
  TranscriptionBatchListResponseSchema,
} from "@research-video/contracts";
import { apiFetch } from "./api-client.ts";
import { findRetryableTranscriptionItem } from "./transcription-action-batch.ts";

type WorkspaceRetryAction = {
  authorization: string | undefined;
  target: { projectId: string; catalogVideoId: string } | undefined;
  projectId: string;
  setWorkspaceLoadState: (state: "loading" | "unavailable" | "failed") => void;
  setWorkspaceMessage: (message: string) => void;
  setWorkspaceReload: (update: (value: number) => number) => void;
  setWorkspaceRetry: (
    retry: { batchId: string; itemId: string } | undefined,
  ) => void;
};

export async function retryWorkspaceTranscript({
  authorization,
  target,
  projectId,
  setWorkspaceLoadState,
  setWorkspaceMessage,
  setWorkspaceReload,
  setWorkspaceRetry,
}: WorkspaceRetryAction) {
  if (!authorization || !target || target.projectId !== projectId) return;
  setWorkspaceLoadState("loading");
  setWorkspaceMessage("Looking for this video's failed transcript job…");
  try {
    const base = `/api/projects/${target.projectId}`;
    async function readBatch(batchId: string) {
      const response = await apiFetch(
        "cloud",
        `${base}/transcription-batches/${batchId}`,
        {},
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to inspect a failed transcription batch.",
        );
      }
      const detail = CreateTranscriptionBatchResponseSchema.parse(payload);
      if (detail.batch.id !== batchId || detail.batch.projectId !== projectId) {
        throw new Error(
          "The returned batch does not belong to this project and batch.",
        );
      }
      return detail;
    }

    // Automatic processing batches are intentionally absent from the manual
    // list. Resolve the selected video's canonical worklist identity first.
    let retryable: ReturnType<typeof findRetryableTranscriptionItem> =
      undefined;
    let cursor: string | undefined;
    const visitedCursors = new Set<string>();
    do {
      const query = new URLSearchParams({ limit: "50", view: "all" });
      if (cursor) query.set("cursor", cursor);
      const response = await apiFetch(
        "cloud",
        `${base}/worklist?${query}`,
        {},
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ApiErrorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to inspect the project video worklist.",
        );
      }
      const page = ProjectVideoWorklistPageSchema.parse(payload);
      const selected = page.items.find(
        (item) =>
          item.projectId === projectId &&
          item.video.id === target.catalogVideoId,
      );
      if (selected) {
        const processing = selected.processing;
        if (
          processing.state === "failed" &&
          processing.error?.retryable === true &&
          processing.batchId &&
          processing.batchItemId
        ) {
          const detail = await readBatch(processing.batchId);
          // The worklist is a snapshot; recheck the exact item in fresh detail
          // before using its current version in the retry command.
          retryable = findRetryableTranscriptionItem(
            [
              {
                ...detail,
                items: detail.items.filter(
                  (item) =>
                    item.id === processing.batchItemId &&
                    item.batchId === processing.batchId,
                ),
              },
            ],
            target.catalogVideoId,
          );
        }
        break;
      }
      cursor = page.nextCursor;
      if (cursor) {
        if (visitedCursors.has(cursor))
          throw new Error(
            "The project video worklist returned a repeated cursor.",
          );
        visitedCursors.add(cursor);
      }
    } while (cursor);

    if (!retryable) {
      const listedResponse = await apiFetch(
        "cloud",
        `${base}/transcription-batches`,
        {},
        authorization,
      );
      const listedPayload = await listedResponse.json().catch(() => undefined);
      if (!listedResponse.ok) {
        const parsed = ApiErrorSchema.safeParse(listedPayload);
        throw new Error(
          parsed.success
            ? parsed.data.error.message
            : "Unable to inspect failed transcription work.",
        );
      }
      const retryableSummaries = TranscriptionBatchListResponseSchema.parse(
        listedPayload,
      ).batches.filter((entry) => entry.progress.retryableFailed > 0);
      for (const summary of retryableSummaries) {
        const detail = await readBatch(summary.batch.id);
        retryable = findRetryableTranscriptionItem(
          [detail],
          target.catalogVideoId,
        );
        if (retryable) break;
      }
    }
    if (!retryable) {
      setWorkspaceReload((value) => value + 1);
      throw new Error(
        "No retryable failed job exists for this exact video. Open Project Videos to inspect its current processing state.",
      );
    }
    const retryResponse = await apiFetch(
      "cloud",
      `/api/projects/${target.projectId}/transcription-batches/${retryable.batchId}/items/${retryable.itemId}/retry`,
      {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: `workspace-transcript-retry:${target.projectId}:${retryable.itemId}:v${retryable.itemVersion}`,
          expectedVersion: retryable.itemVersion,
        }),
      },
      authorization,
    );
    const retryPayload = await retryResponse.json().catch(() => undefined);
    if (!retryResponse.ok) {
      const parsed = ApiErrorSchema.safeParse(retryPayload);
      throw new Error(
        parsed.success
          ? parsed.data.error.message
          : "Unable to retry this video's transcription job.",
      );
    }
    RetryTranscriptionBatchItemResponseSchema.parse(retryPayload);
    setWorkspaceRetry({
      batchId: retryable.batchId,
      itemId: retryable.itemId,
    });
    setWorkspaceLoadState("unavailable");
    setWorkspaceMessage(
      "Retry queued. Checking the YouTube transcript before Whisper…",
    );
  } catch (caught: unknown) {
    setWorkspaceRetry(undefined);
    setWorkspaceLoadState("failed");
    setWorkspaceMessage(
      caught instanceof Error
        ? caught.message
        : "Unable to retry this video's transcript.",
    );
  }
}
