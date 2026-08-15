CREATE TABLE export_requests (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode = 'export_only'),
  video_snapshot_json TEXT NOT NULL,
  selection_snapshot_json TEXT NOT NULL,
  source_language_class TEXT NOT NULL
    CHECK (source_language_class IN ('confirmed_english', 'foreign', 'mixed', 'unknown')),
  preset_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_export_requests_created_at
  ON export_requests(created_at DESC, id);
