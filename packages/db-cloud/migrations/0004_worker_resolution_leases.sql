ALTER TABLE transcription_batch_items
  ADD COLUMN source_plan jsonb;
ALTER TABLE transcription_batch_items
  ADD COLUMN source_resolved_at timestamptz;

CREATE INDEX worker_leases_expiry ON worker_leases(expires_at);
CREATE INDEX jobs_transcription_claim
  ON jobs(kind, state, created_at)
  WHERE kind = 'transcription';
