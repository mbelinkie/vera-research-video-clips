-- Nullable only for history created before M7-05. New catalog commands write
-- the strict, immutable confirmation snapshot and copy it through retries.
ALTER TABLE export_requests
  ADD COLUMN source_rights_snapshot jsonb;

ALTER TABLE export_requests
  ADD CONSTRAINT export_requests_source_rights_exact_video CHECK (
    source_rights_snapshot IS NULL OR (
      jsonb_typeof(source_rights_snapshot) = 'object'
      AND source_rights_snapshot->>'schemaVersion' = '1'
      AND source_rights_snapshot->>'source' = 'youtube'
      AND source_rights_snapshot->>'confirmation' = 'authorized_to_process'
      AND jsonb_typeof(source_rights_snapshot->'youtubeVideoId') = 'string'
      AND COALESCE(
        source_rights_snapshot->>'youtubeVideoId' =
          video_snapshot->>'youtubeVideoId',
        false
      )
    )
  );

CREATE OR REPLACE FUNCTION validate_logged_export_retry_lineage()
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
      AND NEW.source_rights_snapshot IS NOT DISTINCT FROM parent.source_rights_snapshot
      AND NEW.resolved_settings_snapshot = parent.resolved_settings_snapshot
      AND NEW.request_origin IS NOT DISTINCT FROM parent.request_origin
  ) THEN
    RAISE EXCEPTION 'logged export retry lineage or immutable snapshots are inconsistent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER export_requests_identity_snapshots_immutable ON export_requests;
CREATE TRIGGER export_requests_identity_snapshots_immutable
BEFORE UPDATE OF job_id, clip_id, project_id, mode, video_snapshot,
  selection_snapshot, source_language_class, subtitle_tracks_snapshot,
  preset_snapshot, source_rights_snapshot, resolved_settings_snapshot,
  requested_by, retry_of_request_id, retry_ordinal, retry_idempotency_key,
  request_origin
ON export_requests
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_request_identity_update();
