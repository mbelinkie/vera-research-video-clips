-- Expand-first local source grouping identity. Historical compatibility keys,
-- package bytes, and YouTube fields are intentionally untouched.
ALTER TABLE logged_export_source_groups ADD COLUMN source_provider TEXT;
ALTER TABLE logged_export_source_groups ADD COLUMN provider_media_id TEXT;
ALTER TABLE logged_export_source_groups ADD COLUMN canonical_url TEXT;

UPDATE logged_export_source_groups
SET source_provider = 'youtube',
    provider_media_id = youtube_video_id,
    canonical_url = 'https://www.youtube.com/watch?v=' || youtube_video_id
WHERE source_provider IS NULL OR provider_media_id IS NULL OR canonical_url IS NULL;

CREATE UNIQUE INDEX logged_export_source_groups_provider_identity
  ON logged_export_source_groups(
    project_id,
    batch_id,
    source_provider,
    provider_media_id,
    acquisition_profile_fingerprint
  );

CREATE TRIGGER logged_export_source_groups_provider_identity_immutable
BEFORE UPDATE OF source_provider, provider_media_id, canonical_url
ON logged_export_source_groups
BEGIN
  SELECT RAISE(ABORT, 'provider source identity is immutable');
END;
