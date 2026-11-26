-- SQLite cannot widen a CHECK constraint in place. Rebuild the final-artifact
-- child table inside runLocalMigrations' immediate transaction so all existing
-- provenance rows and the request/attempt index survive unchanged.
CREATE TABLE export_final_artifacts_0014 (
  export_request_id TEXT NOT NULL REFERENCES export_requests(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('video_mp4', 'english_srt', 'original_srt', 'clip_metadata_json', 'manifest_json')),
  package_identity TEXT NOT NULL CHECK (package_identity GLOB 'clip-[0-9a-f-]*'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  source_attempt INTEGER NOT NULL CHECK (source_attempt > 0),
  validated_at TEXT NOT NULL,
  PRIMARY KEY (export_request_id, role)
);

INSERT INTO export_final_artifacts_0014
  (export_request_id, role, package_identity, byte_size, content_sha256,
   source_attempt, validated_at)
SELECT export_request_id, role, package_identity, byte_size, content_sha256,
       source_attempt, validated_at
  FROM export_final_artifacts;

DROP TABLE export_final_artifacts;

ALTER TABLE export_final_artifacts_0014 RENAME TO export_final_artifacts;

CREATE INDEX idx_export_final_artifacts_request_attempt
  ON export_final_artifacts(export_request_id, source_attempt);
