-- Source-rights evidence is immutable request provenance. NULL is reserved for
-- rows created before this migration; those rows remain readable but cannot
-- authorize a later acquisition.
ALTER TABLE export_requests ADD COLUMN source_rights_confirmation_json TEXT
  CHECK (
    source_rights_confirmation_json IS NULL OR
    json_valid(source_rights_confirmation_json)
  );

CREATE TRIGGER export_requests_source_rights_confirmation_matches_video_insert
BEFORE INSERT ON export_requests
WHEN NEW.source_rights_confirmation_json IS NOT NULL
  AND json_extract(NEW.source_rights_confirmation_json, '$.youtubeVideoId')
    IS NOT json_extract(NEW.video_snapshot_json, '$.youtubeVideoId')
BEGIN
  SELECT RAISE(ABORT, 'source rights confirmation must match request video');
END;

CREATE TRIGGER export_requests_source_rights_confirmation_matches_video_update
BEFORE UPDATE OF source_rights_confirmation_json ON export_requests
WHEN NEW.source_rights_confirmation_json IS NOT NULL
  AND json_extract(NEW.source_rights_confirmation_json, '$.youtubeVideoId')
    IS NOT json_extract(NEW.video_snapshot_json, '$.youtubeVideoId')
BEGIN
  SELECT RAISE(ABORT, 'source rights confirmation must match request video');
END;

CREATE TRIGGER export_requests_source_rights_confirmation_immutable
BEFORE UPDATE OF source_rights_confirmation_json ON export_requests
WHEN NEW.source_rights_confirmation_json IS NOT OLD.source_rights_confirmation_json
BEGIN
  SELECT RAISE(ABORT, 'source rights confirmation is immutable');
END;

-- Logged delivery reconciliation is intentionally separate from local job
-- terminal state: a cloud result can be acknowledged exactly once after its
-- durable local evidence has been reconciled.
ALTER TABLE export_requests ADD COLUMN cloud_terminal_outcome TEXT
  CHECK (cloud_terminal_outcome IS NULL OR cloud_terminal_outcome IN (
    'success', 'failure', 'canceled'
  ));
ALTER TABLE export_requests ADD COLUMN cloud_terminal_reconciled_at TEXT;

CREATE TRIGGER export_requests_cloud_terminal_reconciliation_complete_insert
BEFORE INSERT ON export_requests
WHEN (NEW.cloud_terminal_outcome IS NULL) != (NEW.cloud_terminal_reconciled_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'cloud terminal reconciliation provenance must be complete');
END;

CREATE TRIGGER export_requests_cloud_terminal_reconciliation_complete_update
BEFORE UPDATE OF cloud_terminal_outcome, cloud_terminal_reconciled_at ON export_requests
WHEN (NEW.cloud_terminal_outcome IS NULL) != (NEW.cloud_terminal_reconciled_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'cloud terminal reconciliation provenance must be complete');
END;

CREATE TRIGGER export_requests_cloud_terminal_reconciliation_logged_only
BEFORE INSERT ON export_requests
WHEN NEW.cloud_terminal_outcome IS NOT NULL AND NEW.cloud_delivery_state IS NULL
BEGIN
  SELECT RAISE(ABORT, 'only logged deliveries can record cloud terminal reconciliation');
END;

CREATE TRIGGER export_requests_cloud_terminal_reconciliation_logged_only_update
BEFORE UPDATE OF cloud_terminal_outcome, cloud_terminal_reconciled_at
  ON export_requests
WHEN NEW.cloud_terminal_outcome IS NOT NULL AND NEW.cloud_delivery_state IS NULL
BEGIN
  SELECT RAISE(ABORT, 'only logged deliveries can record cloud terminal reconciliation');
END;

CREATE TRIGGER export_requests_cloud_terminal_reconciliation_insert_only
BEFORE UPDATE OF cloud_terminal_outcome, cloud_terminal_reconciled_at ON export_requests
WHEN OLD.cloud_terminal_outcome IS NOT NULL OR OLD.cloud_terminal_reconciled_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'cloud terminal reconciliation is immutable');
END;

CREATE INDEX export_requests_accepted_unreconciled_oldest
  ON export_requests(cloud_delivery_state, cloud_terminal_reconciled_at, created_at, id)
  WHERE cloud_delivery_state = 'accepted'
    AND cloud_terminal_reconciled_at IS NULL;
