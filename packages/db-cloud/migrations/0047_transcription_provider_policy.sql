-- Existing and queued batches remain explicitly local. This migration grants
-- no provider access and does not rewrite any cloud consent or approval.
ALTER TABLE transcription_batches
  ADD COLUMN transcription_execution_policy jsonb NOT NULL DEFAULT
    '{"schemaVersion":1,"execution":"local","fallback":"local"}'::jsonb,
  ADD COLUMN transcription_access_request_id uuid
    REFERENCES cloud_provider_access_requests(id) ON DELETE SET NULL;

ALTER TABLE transcription_batches
  ADD CONSTRAINT transcription_batches_provider_policy_authority CHECK (
    (transcription_execution_policy->>'execution' = 'local'
      AND transcription_access_request_id IS NULL)
    OR
    (transcription_execution_policy->>'execution' = 'cloud'
      AND transcription_access_request_id IS NOT NULL)
  );
