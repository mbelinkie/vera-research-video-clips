type ListedBatch = Readonly<{ batch: Readonly<{ id: string }> }>;

type WorklistProcessing = Readonly<{
  state: string;
  batchId?: string | undefined;
}>;

type WorklistItem = Readonly<{ processing: WorklistProcessing }>;

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
