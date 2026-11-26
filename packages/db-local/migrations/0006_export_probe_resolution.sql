ALTER TABLE source_scratch_assets
  ADD COLUMN duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0);
ALTER TABLE source_scratch_assets
  ADD COLUMN container_format TEXT;
ALTER TABLE source_scratch_assets
  ADD COLUMN video_codec TEXT;
ALTER TABLE source_scratch_assets
  ADD COLUMN audio_codec TEXT;
ALTER TABLE source_scratch_assets
  ADD COLUMN ffprobe_version TEXT;

ALTER TABLE export_requests
  ADD COLUMN resolved_export_start_ms INTEGER;
ALTER TABLE export_requests
  ADD COLUMN resolved_export_end_ms INTEGER;
ALTER TABLE export_requests
  ADD COLUMN resolved_source_attempt INTEGER;
ALTER TABLE export_requests
  ADD COLUMN resolved_at TEXT;

CREATE INDEX idx_export_requests_resolved_bounds
  ON export_requests(resolved_source_attempt, resolved_at);
