-- Export-only requests store a JSON snapshot; logged candidates need a column.
-- Existing candidates retain NULL (legacy unlabelled timing).
ALTER TABLE clip_candidates ADD COLUMN end_timing text
  CHECK (end_timing IS NULL OR end_timing = 'derived')
  CHECK (end_timing IS NULL OR
    (timing_precision = 'estimated' AND first_token_id IS NOT NULL
     AND last_token_id IS NOT NULL));
