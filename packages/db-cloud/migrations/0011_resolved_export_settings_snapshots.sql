ALTER TABLE export_requests ADD COLUMN resolved_settings_snapshot jsonb;

UPDATE export_requests
SET resolved_settings_snapshot = jsonb_build_object(
  'schemaVersion', 1,
  'resolutionKind', 'legacy_inline',
  'context', 'logged',
  'base', 'legacy_inline',
  'applicationDefaultVersion', 1,
  'legacyPreset', preset_snapshot,
  'overrides', '{}'::jsonb,
  'overrideFields', '[]'::jsonb,
  'settings', preset_snapshot->'settings',
  'capability', jsonb_build_object(
    'profileId', 'local-editing-renderer',
    'profileVersion', 1,
    'fingerprint', '08f7b71d54b157ee151f91a0a43a58b426484e0cd9dd91a9579d9baa3559a5a9',
    'validation', 'legacy_unvalidated'
  ),
  'resolutionFingerprint', md5(preset_snapshot::text) || md5(preset_snapshot::text),
  'resolvedAt', to_jsonb(
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
)
WHERE resolved_settings_snapshot IS NULL;

UPDATE jobs
SET payload = payload || jsonb_build_object(
  'resolvedSettingsSnapshot', export_requests.resolved_settings_snapshot
)
FROM export_requests
WHERE export_requests.job_id = jobs.id;

ALTER TABLE export_requests ALTER COLUMN resolved_settings_snapshot SET NOT NULL;

CREATE FUNCTION reject_resolved_export_settings_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'resolved export settings snapshots are immutable';
END;
$$;

CREATE TRIGGER export_requests_resolved_settings_immutable
BEFORE UPDATE OF resolved_settings_snapshot ON export_requests
FOR EACH ROW
WHEN (NEW.resolved_settings_snapshot IS DISTINCT FROM OLD.resolved_settings_snapshot)
EXECUTE FUNCTION reject_resolved_export_settings_update();
