ALTER TABLE export_requests
  ADD COLUMN retry_of_request_id uuid
    REFERENCES export_requests(id) ON DELETE RESTRICT,
  ADD COLUMN retry_ordinal integer NOT NULL DEFAULT 0
    CHECK (retry_ordinal >= 0),
  ADD COLUMN retry_idempotency_key text;

ALTER TABLE export_requests
  ADD CONSTRAINT export_requests_retry_lineage_shape CHECK (
    (
      retry_of_request_id IS NULL AND
      retry_ordinal = 0 AND
      retry_idempotency_key IS NULL
    ) OR (
      retry_of_request_id IS NOT NULL AND
      retry_ordinal > 0 AND
      length(btrim(retry_idempotency_key)) > 0 AND
      length(retry_idempotency_key) <= 512
    )
  );

CREATE UNIQUE INDEX export_requests_one_direct_retry
  ON export_requests(retry_of_request_id)
  WHERE retry_of_request_id IS NOT NULL;

CREATE UNIQUE INDEX export_requests_retry_command_identity
  ON export_requests(project_id, retry_idempotency_key)
  WHERE retry_idempotency_key IS NOT NULL;

CREATE FUNCTION validate_logged_export_retry_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.retry_of_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM export_requests parent
    WHERE parent.id = NEW.retry_of_request_id
      AND parent.mode = 'logged'
      AND NEW.mode = 'logged'
      AND parent.project_id = NEW.project_id
      AND parent.clip_id = NEW.clip_id
      AND NEW.retry_ordinal = parent.retry_ordinal + 1
      AND NEW.video_snapshot = parent.video_snapshot
      AND NEW.selection_snapshot = parent.selection_snapshot
      AND NEW.source_language_class = parent.source_language_class
      AND NEW.subtitle_tracks_snapshot IS NOT DISTINCT FROM parent.subtitle_tracks_snapshot
      AND NEW.preset_snapshot = parent.preset_snapshot
      AND NEW.resolved_settings_snapshot = parent.resolved_settings_snapshot
  ) THEN
    RAISE EXCEPTION 'logged export retry lineage or immutable snapshots are inconsistent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER export_requests_retry_lineage_valid
BEFORE INSERT ON export_requests
FOR EACH ROW EXECUTE FUNCTION validate_logged_export_retry_lineage();

CREATE FUNCTION reject_logged_export_request_identity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'logged export request identity and snapshots are immutable';
END;
$$;

CREATE TRIGGER export_requests_identity_snapshots_immutable
BEFORE UPDATE OF job_id, clip_id, project_id, mode, video_snapshot,
  selection_snapshot, source_language_class, subtitle_tracks_snapshot,
  preset_snapshot, resolved_settings_snapshot, requested_by,
  retry_of_request_id, retry_ordinal, retry_idempotency_key
ON export_requests
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_request_identity_update();
