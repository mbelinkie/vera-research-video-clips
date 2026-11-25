ALTER TABLE export_requests
  ADD COLUMN subtitle_omission_policy TEXT
    CHECK (
      subtitle_omission_policy IS NULL OR
      subtitle_omission_policy = 'confirmed_english_user_setting'
    );
ALTER TABLE export_requests
  ADD COLUMN subtitle_omission_source_attempt INTEGER;
ALTER TABLE export_requests
  ADD COLUMN subtitle_omission_validated_at TEXT;

CREATE INDEX idx_export_requests_subtitle_omission_validation
  ON export_requests(subtitle_omission_source_attempt, subtitle_omission_validated_at);
