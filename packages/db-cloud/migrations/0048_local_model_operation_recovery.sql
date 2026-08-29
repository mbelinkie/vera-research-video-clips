-- Retry and recovery metadata are deliberately separate from immutable model
-- evidence.  A retry starts a fresh attempt of the same approved operation;
-- it never overwrites a snapshot, candidate, or evaluated artifact.
ALTER TABLE local_model_operations
  ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  ADD COLUMN last_retried_at timestamptz;

CREATE INDEX local_model_operations_expired_lease
  ON local_model_operations(lease_expires_at, id)
  WHERE state = 'running';

-- Failed byte acquisition is a valid, durable evaluation result.  It has no
-- artifact bytes, so zero is the only honest size; the associated hard finding
-- prevents it from ever becoming available.
ALTER TABLE local_model_evaluations
  DROP CONSTRAINT local_model_evaluations_byte_size_check;
ALTER TABLE local_model_evaluations
  ADD CONSTRAINT local_model_evaluations_byte_size_check CHECK (byte_size >= 0);
