ALTER TABLE export_requests ADD COLUMN resolved_settings_snapshot_json TEXT;

UPDATE export_requests
SET resolved_settings_snapshot_json = json_object(
  'schemaVersion', 1,
  'resolutionKind', 'legacy_inline',
  'context', 'export_only',
  'base', 'legacy_inline',
  'applicationDefaultVersion', 1,
  'legacyPreset', json(preset_snapshot_json),
  'overrides', json('{}'),
  'overrideFields', json('[]'),
  'settings', json_extract(preset_snapshot_json, '$.settings'),
  'capability', json_object(
    'profileId', 'local-editing-renderer',
    'profileVersion', 1,
    'fingerprint', '08f7b71d54b157ee151f91a0a43a58b426484e0cd9dd91a9579d9baa3559a5a9',
    'validation', 'legacy_unvalidated'
  ),
  'resolutionFingerprint', legacy_export_settings_fingerprint(preset_snapshot_json),
  'resolvedAt', created_at
)
WHERE resolved_settings_snapshot_json IS NULL;

UPDATE jobs
SET payload_json = json_set(
  payload_json,
  '$.resolvedSettingsSnapshot',
  json((
    SELECT resolved_settings_snapshot_json
    FROM export_requests
    WHERE export_requests.job_id = jobs.id
  ))
)
WHERE kind = 'export'
  AND EXISTS (SELECT 1 FROM export_requests WHERE export_requests.job_id = jobs.id);

CREATE TRIGGER export_requests_require_resolved_settings_insert
BEFORE INSERT ON export_requests
WHEN NEW.resolved_settings_snapshot_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'resolved settings snapshot is required');
END;

CREATE TRIGGER export_requests_resolved_settings_immutable
BEFORE UPDATE OF resolved_settings_snapshot_json ON export_requests
WHEN NEW.resolved_settings_snapshot_json <> OLD.resolved_settings_snapshot_json
BEGIN
  SELECT RAISE(ABORT, 'resolved settings snapshot is immutable');
END;
