CREATE TABLE source_scratch_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  provider TEXT,
  source_identity TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size > 0),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  lifecycle_state TEXT NOT NULL
    CHECK (lifecycle_state IN ('acquiring', 'ready', 'deleting', 'deleted', 'cleanup_failed')),
  cleanup_error_code TEXT,
  cleanup_error_message TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ready_at TEXT,
  cleanup_started_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (job_id, attempt)
);

CREATE INDEX idx_source_scratch_assets_lifecycle
  ON source_scratch_assets(lifecycle_state, updated_at);
