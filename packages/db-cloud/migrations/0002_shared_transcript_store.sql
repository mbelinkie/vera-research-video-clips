ALTER TABLE users ADD COLUMN display_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE videos ADD COLUMN canonical_url text NOT NULL DEFAULT '';
ALTER TABLE videos ADD COLUMN source_language text;
ALTER TABLE videos ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE transcript_versions ADD COLUMN manifest_object_version_id text NOT NULL DEFAULT '';
ALTER TABLE transcript_versions ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX transcript_versions_idempotency_key
  ON transcript_versions(idempotency_key);

CREATE TABLE transcript_artifacts (
  transcript_version_id uuid NOT NULL REFERENCES transcript_versions(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  object_key text NOT NULL,
  object_version_id text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  PRIMARY KEY (transcript_version_id, artifact_type)
);

CREATE TABLE transcript_uploads (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  lineage_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('staged', 'finalized', 'expired')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transcript_upload_targets (
  upload_id uuid NOT NULL REFERENCES transcript_uploads(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  object_key text NOT NULL,
  PRIMARY KEY (upload_id, artifact_type),
  UNIQUE (upload_id, object_key)
);

CREATE TABLE sync_events (
  sequence bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_id uuid NOT NULL,
  server_version integer NOT NULL CHECK (server_version > 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_events_project_sequence
  ON sync_events(project_id, sequence);
