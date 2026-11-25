ALTER TABLE export_requests
  ADD COLUMN thumbnail_extraction_time_ms INTEGER
    CHECK (thumbnail_extraction_time_ms IS NULL OR thumbnail_extraction_time_ms >= 0);
ALTER TABLE export_requests
  ADD COLUMN thumbnail_width INTEGER
    CHECK (thumbnail_width IS NULL OR (thumbnail_width > 0 AND thumbnail_width <= 1280));
ALTER TABLE export_requests
  ADD COLUMN thumbnail_height INTEGER
    CHECK (thumbnail_height IS NULL OR (thumbnail_height > 0 AND thumbnail_height <= 720));
ALTER TABLE export_requests
  ADD COLUMN thumbnail_source_attempt INTEGER;
ALTER TABLE export_requests
  ADD COLUMN thumbnail_validated_at TEXT;

CREATE INDEX idx_export_requests_thumbnail_validation
  ON export_requests(thumbnail_source_attempt, thumbnail_validated_at);

-- SQLite cannot widen a CHECK constraint in place. Rebuild this child table
-- inside runLocalMigrations' immediate transaction so prior artifact rows and
-- the request/attempt index remain unchanged.
CREATE TABLE export_final_artifacts_0015 (
  export_request_id TEXT NOT NULL REFERENCES export_requests(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('video_mp4', 'english_srt', 'original_srt', 'clip_metadata_json', 'thumbnail_jpg', 'manifest_json')),
  package_identity TEXT NOT NULL CHECK (package_identity GLOB 'clip-[0-9a-f-]*'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  source_attempt INTEGER NOT NULL CHECK (source_attempt > 0),
  validated_at TEXT NOT NULL,
  PRIMARY KEY (export_request_id, role)
);

INSERT INTO export_final_artifacts_0015
  (export_request_id, role, package_identity, byte_size, content_sha256,
   source_attempt, validated_at)
SELECT export_request_id, role, package_identity, byte_size, content_sha256,
       source_attempt, validated_at
  FROM export_final_artifacts;

DROP TABLE export_final_artifacts;

ALTER TABLE export_final_artifacts_0015 RENAME TO export_final_artifacts;

CREATE INDEX idx_export_final_artifacts_request_attempt
  ON export_final_artifacts(export_request_id, source_attempt);
