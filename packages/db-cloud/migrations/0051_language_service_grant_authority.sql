ALTER TABLE transcription_batches
  ADD COLUMN transcription_grant_id uuid REFERENCES cloud_provider_launch_grants(id),
  ADD COLUMN translation_grant_id uuid REFERENCES cloud_provider_launch_grants(id);

CREATE INDEX transcription_batches_provider_grants
  ON transcription_batches(transcription_grant_id, translation_grant_id);
