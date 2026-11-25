ALTER TABLE transcription_batch_items
  DROP CONSTRAINT transcription_batch_items_state_check,
  ADD CONSTRAINT transcription_batch_items_state_check CHECK (state IN (
    'draft', 'preflight', 'queued', 'resolving', 'acquiring', 'transcribing',
    'translating', 'aligning', 'uploading', 'canceling', 'ready_for_review',
    'blocked', 'needs_language_confirmation', 'failed', 'canceled'
  ));

ALTER TABLE transcription_job_cancel_requests
  ADD COLUMN reason text NOT NULL DEFAULT 'project_video_triage'
    CHECK (reason IN ('project_video_triage', 'batch_item'));

CREATE TABLE transcription_batch_item_cancel_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES transcription_batches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES transcription_batch_items(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, actor_id, idempotency_key)
);

CREATE INDEX transcription_batch_item_cancel_commands_item
  ON transcription_batch_item_cancel_commands(project_id, batch_id, item_id,
                                                created_at DESC, id DESC);
