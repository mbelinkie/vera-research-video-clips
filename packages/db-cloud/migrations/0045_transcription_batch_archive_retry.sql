ALTER TABLE transcription_batches
  ADD COLUMN archived_by uuid REFERENCES users(id),
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT transcription_batches_archive_evidence CHECK (
    (archived_by IS NULL AND archived_at IS NULL) OR
    (archived_by IS NOT NULL AND archived_at IS NOT NULL)
  );

CREATE INDEX transcription_batches_project_visible_updated
  ON transcription_batches(project_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE TABLE transcription_batch_archive_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES transcription_batches(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (
    length(request_sha256) = 64 AND
    request_sha256 !~ '[^0-9a-f]'
  ),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, actor_id, idempotency_key)
);

CREATE TABLE transcription_batch_item_retry_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES transcription_batches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES transcription_batch_items(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (
    length(request_sha256) = 64 AND
    request_sha256 !~ '[^0-9a-f]'
  ),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, actor_id, idempotency_key)
);
