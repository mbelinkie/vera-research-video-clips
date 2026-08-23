ALTER TABLE transcription_batches
  ADD COLUMN translation_provider text,
  ADD COLUMN translation_disclosure_version integer,
  ADD COLUMN translation_consent_accepted_at timestamptz,
  ADD CONSTRAINT transcription_batches_translation_consent_complete CHECK (
    (translation_provider IS NULL
      AND translation_disclosure_version IS NULL
      AND translation_consent_accepted_at IS NULL)
    OR
    (translation_provider = 'amazon-translate'
      AND translation_disclosure_version = 1
      AND translation_consent_accepted_at IS NOT NULL)
  );
