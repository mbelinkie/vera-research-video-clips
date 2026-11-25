CREATE INDEX jobs_transcription_queue_delivery_idx
  ON jobs (
    state,
    (payload->>'queueDeliveredAt'),
    (payload->>'queueDispatchedAt')
  )
  WHERE kind = 'transcription';
