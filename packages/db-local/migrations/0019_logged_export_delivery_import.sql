-- The historical mode column is constrained to export_only. Keep it intact for
-- populated-database compatibility and use the presence of typed cloud delivery
-- provenance as the authoritative logged-mode discriminator.
ALTER TABLE export_requests ADD COLUMN cloud_project_id TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_clip_id TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_delivery_id TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_delivery_generation INTEGER
  CHECK (cloud_delivery_generation IS NULL OR cloud_delivery_generation > 0);
ALTER TABLE export_requests ADD COLUMN cloud_reservation_token TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_worker_id TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_worker_epoch INTEGER
  CHECK (cloud_worker_epoch IS NULL OR cloud_worker_epoch > 0);
ALTER TABLE export_requests ADD COLUMN cloud_reserved_at TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_reservation_expires_at TEXT;
ALTER TABLE export_requests ADD COLUMN cloud_delivery_state TEXT
  CHECK (cloud_delivery_state IS NULL OR cloud_delivery_state IN ('pending_acceptance', 'accepted'));

CREATE UNIQUE INDEX export_requests_cloud_delivery_identity
  ON export_requests(cloud_delivery_id)
  WHERE cloud_delivery_id IS NOT NULL;
CREATE UNIQUE INDEX export_requests_cloud_request_identity
  ON export_requests(id)
  WHERE cloud_delivery_id IS NOT NULL;

CREATE TRIGGER export_requests_cloud_delivery_require_complete_insert
BEFORE INSERT ON export_requests
WHEN (
    NEW.cloud_project_id IS NOT NULL OR NEW.cloud_clip_id IS NOT NULL OR
    NEW.cloud_delivery_id IS NOT NULL OR
    NEW.cloud_delivery_generation IS NOT NULL OR
    NEW.cloud_reservation_token IS NOT NULL OR
    NEW.cloud_worker_id IS NOT NULL OR NEW.cloud_worker_epoch IS NOT NULL OR
    NEW.cloud_reserved_at IS NOT NULL OR
    NEW.cloud_reservation_expires_at IS NOT NULL OR
    NEW.cloud_delivery_state IS NOT NULL
  )
  AND (
    NEW.cloud_project_id IS NULL OR NEW.cloud_clip_id IS NULL OR
    NEW.cloud_delivery_id IS NULL OR NEW.cloud_delivery_generation IS NULL OR
    NEW.cloud_reservation_token IS NULL OR NEW.cloud_worker_id IS NULL OR
    NEW.cloud_worker_epoch IS NULL OR NEW.cloud_reserved_at IS NULL OR
    NEW.cloud_reservation_expires_at IS NULL OR NEW.cloud_delivery_state IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'cloud logged delivery provenance must be complete');
END;

CREATE TRIGGER export_requests_cloud_delivery_immutable
BEFORE UPDATE OF cloud_project_id, cloud_clip_id, cloud_delivery_id,
  cloud_delivery_generation, cloud_reservation_token, cloud_worker_id,
  cloud_worker_epoch, cloud_reserved_at, cloud_reservation_expires_at
  ON export_requests
WHEN
  NEW.cloud_project_id IS NOT OLD.cloud_project_id OR
  NEW.cloud_clip_id IS NOT OLD.cloud_clip_id OR
  NEW.cloud_delivery_id IS NOT OLD.cloud_delivery_id OR
  NEW.cloud_delivery_generation IS NOT OLD.cloud_delivery_generation OR
  NEW.cloud_reservation_token IS NOT OLD.cloud_reservation_token OR
  NEW.cloud_worker_id IS NOT OLD.cloud_worker_id OR
  NEW.cloud_worker_epoch IS NOT OLD.cloud_worker_epoch OR
  NEW.cloud_reserved_at IS NOT OLD.cloud_reserved_at OR
  NEW.cloud_reservation_expires_at IS NOT OLD.cloud_reservation_expires_at
BEGIN
  SELECT RAISE(ABORT, 'cloud logged delivery provenance is immutable');
END;

CREATE TRIGGER export_requests_cloud_delivery_insert_only
BEFORE UPDATE OF cloud_delivery_id ON export_requests
WHEN OLD.cloud_delivery_id IS NULL AND NEW.cloud_delivery_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'cloud logged delivery provenance is insert-only');
END;

CREATE TRIGGER export_requests_cloud_delivery_state_forward_only
BEFORE UPDATE OF cloud_delivery_state ON export_requests
WHEN NOT (
  OLD.cloud_delivery_state IS 'pending_acceptance' AND
  NEW.cloud_delivery_state IS 'accepted'
)
BEGIN
  SELECT RAISE(ABORT, 'cloud logged delivery state may only transition from pending acceptance to accepted');
END;
