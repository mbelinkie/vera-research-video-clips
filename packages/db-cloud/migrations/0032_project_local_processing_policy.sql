ALTER TABLE projects
  ADD COLUMN local_processing_state text NOT NULL DEFAULT 'automatic'
    CHECK (local_processing_state IN ('automatic', 'paused')),
  ADD COLUMN local_processing_version integer NOT NULL DEFAULT 1
    CHECK (local_processing_version > 0),
  ADD COLUMN local_processing_updated_by uuid REFERENCES users(id),
  ADD COLUMN local_processing_updated_at timestamptz,
  ADD CONSTRAINT projects_local_processing_evidence_check CHECK (
    (local_processing_updated_by IS NULL AND local_processing_updated_at IS NULL)
    OR
    (local_processing_updated_by IS NOT NULL AND local_processing_updated_at IS NOT NULL)
  );

CREATE TABLE project_local_processing_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  requested_state text NOT NULL
    CHECK (requested_state IN ('automatic', 'paused')),
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (length(request_sha256) = 64),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, actor_id, idempotency_key)
);

ALTER TABLE transcription_batches
  ADD COLUMN processing_origin text NOT NULL DEFAULT 'manual'
    CHECK (processing_origin IN ('manual', 'project_local'));

CREATE UNIQUE INDEX transcription_batches_one_project_local
  ON transcription_batches(project_id)
  WHERE processing_origin = 'project_local';

CREATE INDEX project_local_processing_commands_project_created
  ON project_local_processing_commands(project_id, created_at DESC, id);
