ALTER TABLE export_requests ADD COLUMN cloud_execution_id TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_execution_attempt INTEGER
  CHECK (cloud_execution_attempt IS NULL OR cloud_execution_attempt > 0);
ALTER TABLE export_requests ADD COLUMN cloud_execution_lease_token TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_execution_started_at TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_execution_heartbeat_at TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_execution_expires_at TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_cancel_requested_at TEXT;
ALTER TABLE export_requests ADD COLUMN local_cancellation_reason TEXT
  CHECK (local_cancellation_reason IS NULL OR local_cancellation_reason IN ('user_requested', 'execution_lease_lost'));
ALTER TABLE export_requests ADD COLUMN local_canceled_at TEXT;

CREATE UNIQUE INDEX export_requests_cloud_execution_identity
  ON export_requests(cloud_execution_id)
  WHERE cloud_execution_id IS NOT NULL;

CREATE TRIGGER export_requests_cloud_execution_require_complete
BEFORE UPDATE OF cloud_execution_id, cloud_execution_attempt,
  cloud_execution_lease_token, cloud_execution_started_at,
  cloud_execution_heartbeat_at, cloud_execution_expires_at ON export_requests
WHEN (
    NEW.cloud_execution_id IS NOT NULL OR
    NEW.cloud_execution_attempt IS NOT NULL OR
    NEW.cloud_execution_lease_token IS NOT NULL OR
    NEW.cloud_execution_started_at IS NOT NULL OR
    NEW.cloud_execution_heartbeat_at IS NOT NULL OR
    NEW.cloud_execution_expires_at IS NOT NULL
  ) AND (
    NEW.cloud_execution_id IS NULL OR
    NEW.cloud_execution_attempt IS NULL OR
    NEW.cloud_execution_lease_token IS NULL OR
    NEW.cloud_execution_started_at IS NULL OR
    NEW.cloud_execution_heartbeat_at IS NULL OR
    NEW.cloud_execution_expires_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cloud export execution provenance must be complete');
END;

CREATE TRIGGER export_requests_cloud_execution_identity_immutable
BEFORE UPDATE OF cloud_execution_id, cloud_execution_attempt,
  cloud_execution_lease_token, cloud_execution_started_at ON export_requests
WHEN OLD.cloud_execution_id IS NOT NULL AND (
  NEW.cloud_execution_id IS NOT OLD.cloud_execution_id OR
  NEW.cloud_execution_attempt IS NOT OLD.cloud_execution_attempt OR
  NEW.cloud_execution_lease_token IS NOT OLD.cloud_execution_lease_token OR
  NEW.cloud_execution_started_at IS NOT OLD.cloud_execution_started_at
)
BEGIN
  SELECT RAISE(ABORT, 'cloud export execution identity is immutable');
END;

CREATE TRIGGER export_requests_cloud_execution_heartbeat_forward
BEFORE UPDATE OF cloud_execution_heartbeat_at, cloud_execution_expires_at
  ON export_requests
WHEN OLD.cloud_execution_id IS NOT NULL AND (
  NEW.cloud_execution_heartbeat_at < OLD.cloud_execution_heartbeat_at OR
  NEW.cloud_execution_expires_at < OLD.cloud_execution_expires_at OR
  NEW.cloud_execution_expires_at <= NEW.cloud_execution_heartbeat_at
)
BEGIN
  SELECT RAISE(ABORT, 'cloud export execution heartbeat must move forward');
END;

CREATE TRIGGER export_requests_cloud_cancel_forward_only
BEFORE UPDATE OF cloud_cancel_requested_at ON export_requests
WHEN OLD.cloud_cancel_requested_at IS NOT NULL AND
     NEW.cloud_cancel_requested_at IS NOT OLD.cloud_cancel_requested_at
BEGIN
  SELECT RAISE(ABORT, 'cloud export cancel intent is immutable');
END;

CREATE TRIGGER export_requests_local_cancellation_complete
BEFORE UPDATE OF local_cancellation_reason, local_canceled_at ON export_requests
WHEN (NEW.local_cancellation_reason IS NULL) IS NOT (NEW.local_canceled_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'local cancellation evidence must be complete');
END;

CREATE TRIGGER export_requests_local_cancellation_immutable
BEFORE UPDATE OF local_cancellation_reason, local_canceled_at ON export_requests
WHEN OLD.local_cancellation_reason IS NOT NULL AND (
  NEW.local_cancellation_reason IS NOT OLD.local_cancellation_reason OR
  NEW.local_canceled_at IS NOT OLD.local_canceled_at
)
BEGIN
  SELECT RAISE(ABORT, 'local cancellation evidence is immutable');
END;
