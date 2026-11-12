-- Forward-only metadata; existing indexed tokens remain unchanged and unlabeled.
ALTER TABLE transcript_tokens ADD COLUMN end_timing TEXT
  CHECK (end_timing IS NULL OR end_timing = 'derived')
  CHECK (end_timing IS NULL OR (start_ms IS NOT NULL AND end_ms IS NOT NULL));
