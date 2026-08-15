CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  external_subject text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'researcher', 'viewer')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY,
  youtube_video_id text NOT NULL UNIQUE,
  title text,
  channel text,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_videos (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  active_transcript_version_id uuid,
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'reviewing', 'reviewed', 'skipped')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, video_id)
);

CREATE TABLE IF NOT EXISTS transcript_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  lineage_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  source_language text NOT NULL,
  target_language text NOT NULL,
  timing_precision text NOT NULL CHECK (timing_precision IN ('word', 'cue', 'estimated')),
  manifest_object_key text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (length(manifest_sha256) = 64),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, video_id, lineage_id, version)
);

ALTER TABLE project_videos
  ADD CONSTRAINT project_videos_active_transcript_fk
  FOREIGN KEY (active_transcript_version_id) REFERENCES transcript_versions(id);

CREATE TABLE IF NOT EXISTS transcription_batches (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  target_language text NOT NULL DEFAULT 'en',
  execution_location text NOT NULL CHECK (execution_location IN ('local', 'hosted')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('transcription', 'export', 'sync')),
  state text NOT NULL CHECK (state IN ('queued', 'claimed', 'processing', 'needs_user_action', 'complete', 'failed', 'canceled')),
  idempotency_key text NOT NULL UNIQUE,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_leases (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  claimed_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS project_owner_once
  ON project_members(project_id, user_id)
  WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS jobs_claimable ON jobs(state, created_at);
