ALTER TABLE export_requests
  ADD COLUMN english_subtitle_track_id TEXT;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_track_version INTEGER;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_cue_count INTEGER;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_byte_size INTEGER;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_content_sha256 TEXT;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_start_ms INTEGER;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_end_ms INTEGER;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_source_attempt INTEGER;
ALTER TABLE export_requests
  ADD COLUMN english_subtitle_validated_at TEXT;

CREATE INDEX idx_export_requests_english_subtitle_validation
  ON export_requests(english_subtitle_source_attempt, english_subtitle_validated_at);
