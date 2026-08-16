ALTER TABLE export_requests
  ADD COLUMN rendered_duration_ms INTEGER CHECK (rendered_duration_ms IS NULL OR rendered_duration_ms > 0);
ALTER TABLE export_requests
  ADD COLUMN rendered_container_format TEXT;
ALTER TABLE export_requests
  ADD COLUMN rendered_video_codec TEXT;
ALTER TABLE export_requests
  ADD COLUMN rendered_audio_codec TEXT;
ALTER TABLE export_requests
  ADD COLUMN rendered_ffprobe_version TEXT;
ALTER TABLE export_requests
  ADD COLUMN rendered_source_attempt INTEGER;
ALTER TABLE export_requests
  ADD COLUMN rendered_validated_at TEXT;

CREATE INDEX idx_export_requests_render_validation
  ON export_requests(rendered_source_attempt, rendered_validated_at);
