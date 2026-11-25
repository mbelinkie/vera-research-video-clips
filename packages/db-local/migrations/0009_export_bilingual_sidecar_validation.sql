ALTER TABLE export_requests
  ADD COLUMN subtitle_tracks_snapshot_json TEXT;

CREATE TABLE export_subtitle_sidecars (
  export_request_id TEXT NOT NULL REFERENCES export_requests(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('original', 'english')),
  language TEXT NOT NULL,
  track_id TEXT NOT NULL,
  track_version INTEGER NOT NULL CHECK (track_version > 0),
  cue_count INTEGER NOT NULL CHECK (cue_count > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  source_attempt INTEGER NOT NULL CHECK (source_attempt > 0),
  validated_at TEXT NOT NULL,
  PRIMARY KEY (export_request_id, role)
);

CREATE INDEX idx_export_subtitle_sidecars_attempt
  ON export_subtitle_sidecars(source_attempt, validated_at);
