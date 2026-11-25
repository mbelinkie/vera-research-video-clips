-- M5-19 can recover only the deterministic layout introduced below. Earlier
-- attempts were created with an unpersisted mkdtemp suffix, so deriving the new
-- path for them would be an unsafe false-deletion claim.
ALTER TABLE source_scratch_assets
  ADD COLUMN scratch_layout_version INTEGER;
ALTER TABLE source_scratch_assets
  ADD COLUMN cleanup_claim_token TEXT;
ALTER TABLE source_scratch_assets
  ADD COLUMN cleanup_claim_expires_at TEXT;
ALTER TABLE source_scratch_assets
  ADD COLUMN cleanup_claim_previous_lifecycle_state TEXT;

CREATE INDEX idx_source_scratch_assets_recovery_claim
  ON source_scratch_assets(
    scratch_layout_version,
    lifecycle_state,
    expires_at,
    cleanup_claim_expires_at
  );

CREATE TRIGGER source_scratch_assets_layout_version_insert
BEFORE INSERT ON source_scratch_assets
WHEN NEW.scratch_layout_version IS NOT NULL
  AND NEW.scratch_layout_version != 2
BEGIN
  SELECT RAISE(ABORT, 'unsupported source scratch layout version');
END;

CREATE TRIGGER source_scratch_assets_layout_version_update
BEFORE UPDATE OF scratch_layout_version ON source_scratch_assets
WHEN NEW.scratch_layout_version IS NOT NULL
  AND NEW.scratch_layout_version != 2
BEGIN
  SELECT RAISE(ABORT, 'unsupported source scratch layout version');
END;

CREATE TRIGGER source_scratch_assets_recovery_claim_pair_insert
BEFORE INSERT ON source_scratch_assets
WHEN (NEW.cleanup_claim_token IS NULL) != (NEW.cleanup_claim_expires_at IS NULL)
  OR (NEW.cleanup_claim_token IS NULL) != (NEW.cleanup_claim_previous_lifecycle_state IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'source scratch recovery claim is incomplete');
END;

CREATE TRIGGER source_scratch_assets_recovery_claim_pair_update
BEFORE UPDATE OF cleanup_claim_token, cleanup_claim_expires_at,
  cleanup_claim_previous_lifecycle_state
ON source_scratch_assets
WHEN (NEW.cleanup_claim_token IS NULL) != (NEW.cleanup_claim_expires_at IS NULL)
  OR (NEW.cleanup_claim_token IS NULL) != (NEW.cleanup_claim_previous_lifecycle_state IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'source scratch recovery claim is incomplete');
END;

-- Do not infer an absent deterministic directory for legacy rows. They remain
-- local/manual cleanup work, and any interrupted processor is surfaced rather
-- than left permanently processing behind an excluded recovery row.
UPDATE source_scratch_assets
SET lifecycle_state = 'cleanup_failed',
    cleanup_error_code = 'source_scratch_legacy_layout_unrecoverable',
    cleanup_error_message = 'Legacy source scratch requires manual cleanup.',
    cleanup_claim_token = NULL,
    cleanup_claim_expires_at = NULL,
    cleanup_claim_previous_lifecycle_state = NULL
WHERE scratch_layout_version IS NULL
  AND lifecycle_state != 'deleted';

UPDATE jobs
SET state = 'needs_user_action',
    payload_json = json_set(
      payload_json,
      '$.lastError',
      json_object(
        'code', 'source_scratch_legacy_layout_unrecoverable',
        'message', 'Legacy source scratch requires manual cleanup.'
      )
    )
WHERE state = 'processing'
  AND EXISTS (
    SELECT 1
    FROM source_scratch_assets
    WHERE source_scratch_assets.job_id = jobs.id
      AND source_scratch_assets.scratch_layout_version IS NULL
      AND source_scratch_assets.lifecycle_state = 'cleanup_failed'
  );
