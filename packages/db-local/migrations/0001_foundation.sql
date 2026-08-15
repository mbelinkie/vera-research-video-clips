CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'researcher', 'viewer')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS transcript_manifests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, video_id, lineage_id, version)
);

CREATE TABLE IF NOT EXISTS transcription_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  target_language TEXT NOT NULL DEFAULT 'en',
  execution_location TEXT NOT NULL CHECK (execution_location IN ('local', 'hosted')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('transcription', 'export', 'sync')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'claimed', 'processing', 'needs_user_action', 'complete', 'failed', 'canceled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  command_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt ON sync_outbox(next_attempt_at, created_at);
