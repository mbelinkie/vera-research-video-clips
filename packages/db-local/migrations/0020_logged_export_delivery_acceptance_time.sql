ALTER TABLE export_requests ADD COLUMN cloud_accepted_at TEXT;

UPDATE export_requests
SET cloud_accepted_at = updated_at
WHERE cloud_delivery_state = 'accepted';

CREATE TRIGGER export_requests_cloud_acceptance_absent_on_insert
BEFORE INSERT ON export_requests
WHEN NEW.cloud_accepted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'cloud acceptance time may only be recorded during activation');
END;

CREATE TRIGGER export_requests_cloud_acceptance_matches_state
BEFORE UPDATE OF cloud_delivery_state, cloud_accepted_at ON export_requests
WHEN
  (NEW.cloud_delivery_state = 'accepted' AND NEW.cloud_accepted_at IS NULL) OR
  (NEW.cloud_delivery_state = 'pending_acceptance' AND NEW.cloud_accepted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cloud acceptance time must match delivery state');
END;

CREATE TRIGGER export_requests_cloud_acceptance_forward_only
BEFORE UPDATE OF cloud_accepted_at ON export_requests
WHEN NOT (
  OLD.cloud_accepted_at IS NULL AND
  NEW.cloud_accepted_at IS NOT NULL AND
  OLD.cloud_delivery_state = 'pending_acceptance' AND
  NEW.cloud_delivery_state = 'accepted'
)
BEGIN
  SELECT RAISE(ABORT, 'cloud acceptance time is immutable');
END;
