ALTER TABLE transcription_batches
  ADD COLUMN hosted_approval_state text,
  ADD COLUMN hosted_approval_version integer NOT NULL DEFAULT 1
    CHECK (hosted_approval_version > 0),
  ADD COLUMN hosted_approval_by uuid REFERENCES users(id),
  ADD COLUMN hosted_approval_at timestamptz;

UPDATE transcription_batches
SET hosted_approval_state = CASE
  WHEN execution_location = 'hosted' THEN 'pending'
  ELSE 'not_required'
END;

UPDATE transcription_batches
SET dispatch_status = 'paused'
WHERE execution_location = 'hosted'
  AND dispatch_status = 'active';

ALTER TABLE transcription_batches
  ALTER COLUMN hosted_approval_state SET NOT NULL,
  ALTER COLUMN hosted_approval_state SET DEFAULT 'not_required',
  ADD CONSTRAINT transcription_batches_hosted_approval_check CHECK (
    (
      execution_location = 'local'
      AND hosted_approval_state = 'not_required'
      AND hosted_approval_by IS NULL
      AND hosted_approval_at IS NULL
    ) OR (
      execution_location = 'hosted'
      AND (
        (
          hosted_approval_state = 'pending'
          AND hosted_approval_by IS NULL
          AND hosted_approval_at IS NULL
        ) OR (
          hosted_approval_state IN ('approved', 'revoked')
          AND hosted_approval_by IS NOT NULL
          AND hosted_approval_at IS NOT NULL
        )
      )
    )
  );

CREATE TABLE hosted_transcription_approval_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES transcription_batches(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('approve', 'revoke')),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, batch_id, actor_id, idempotency_key)
);

CREATE INDEX hosted_transcription_approval_commands_batch
  ON hosted_transcription_approval_commands(project_id, batch_id, created_at, id);
