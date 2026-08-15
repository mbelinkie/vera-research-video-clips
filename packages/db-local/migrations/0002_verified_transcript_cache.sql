CREATE TABLE verified_transcript_cache (
  project_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  transcript_version_id TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  cache_path TEXT NOT NULL,
  sync_state TEXT NOT NULL CHECK (sync_state IN ('verified', 'stale', 'failed')),
  server_version INTEGER NOT NULL CHECK (server_version > 0),
  verified_at TEXT NOT NULL,
  PRIMARY KEY (project_id, video_id, transcript_version_id)
);

CREATE TABLE sync_cursors (
  project_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_verified_transcript_active_lookup
  ON verified_transcript_cache(project_id, video_id, verified_at);
