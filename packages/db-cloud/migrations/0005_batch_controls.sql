ALTER TABLE transcription_batches
  ADD COLUMN dispatch_status text NOT NULL DEFAULT 'active'
    CHECK (dispatch_status IN ('active', 'paused', 'canceled'));

ALTER TABLE transcription_batch_items
  ADD COLUMN error_retryable boolean;

CREATE INDEX transcription_batches_project_updated
  ON transcription_batches(project_id, updated_at DESC);

CREATE INDEX transcription_batch_items_dispatch
  ON transcription_batch_items(job_id, state, batch_id);

