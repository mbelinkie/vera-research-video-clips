ALTER TABLE transcription_batches
  DROP CONSTRAINT transcription_batches_translation_consent_complete;

ALTER TABLE transcription_batches
  ADD CONSTRAINT transcription_batches_translation_consent_complete CHECK (
    (translation_provider IS NULL
      AND translation_disclosure_version IS NULL
      AND translation_consent_accepted_at IS NULL)
    OR
    (translation_provider ~ '^[a-z0-9][a-z0-9.-]{1,158}[a-z0-9]$'
      AND translation_disclosure_version > 0
      AND translation_consent_accepted_at IS NOT NULL)
  );
