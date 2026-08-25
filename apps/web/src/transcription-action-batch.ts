type ListedBatch = Readonly<{ batch: Readonly<{ id: string }> }>;

type WorklistProcessing = Readonly<{
  state: string;
  batchId?: string | undefined;
}>;

type WorklistItem = Readonly<{ processing: WorklistProcessing }>;

type RetryableBatchDetail = Readonly<{
  batch: Readonly<{ id: string; version: number }>;
  items: readonly Readonly<{
    id: string;
    catalogVideoId?: string | undefined;
    youtubeVideoId?: string | undefined;
    state: string;
    version: number;
    error?: Readonly<{ retryable?: boolean | undefined }> | undefined;
  }>[];
}>;

export type RetryableTranscriptionItem = Readonly<{
  batchId: string;
  batchVersion: number;
  itemId: string;
  itemVersion: number;
}>;

/**
 * Project-local batches stay out of the ordinary batch list, but an exact
 * language gate in one of those batches must remain reachable for a person to
 * resolve. Explicit selection of a listed batch still wins.
 */
export function selectTranscriptionBatchId(
  listed: readonly ListedBatch[],
  worklist: readonly WorklistItem[],
  preferredBatchId: string,
): string | undefined {
  const preferred = listed.find((entry) => entry.batch.id === preferredBatchId)
    ?.batch.id;
  if (preferred) return preferred;

  const actionRequired = worklist.find(
    (item) =>
      item.processing.state === "needs_language_confirmation" &&
      item.processing.batchId,
  )?.processing.batchId;
  return actionRequired ?? listed[0]?.batch.id;
}

/**
 * The transcript surface may retry only the exact selected project-video item.
 * Batch order is newest first, so the first exact retryable failure wins.
 */
export function findRetryableTranscriptionItem(
  batches: readonly RetryableBatchDetail[],
  catalogVideoId: string,
  youtubeVideoId: string,
): RetryableTranscriptionItem | undefined {
  for (const detail of batches) {
    const item = detail.items.find(
      (candidate) =>
        candidate.catalogVideoId === catalogVideoId &&
        candidate.youtubeVideoId === youtubeVideoId &&
        candidate.state === "failed" &&
        candidate.error?.retryable === true,
    );
    if (item) {
      return {
        batchId: detail.batch.id,
        batchVersion: detail.batch.version,
        itemId: item.id,
        itemVersion: item.version,
      };
    }
  }
  return undefined;
}
