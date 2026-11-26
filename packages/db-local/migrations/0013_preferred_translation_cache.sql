CREATE TABLE derived_translation_cache (
  translation_version_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  catalog_video_id TEXT NOT NULL,
  base_transcript_version_id TEXT NOT NULL,
  original_track_id TEXT NOT NULL,
  original_content_sha256 TEXT NOT NULL CHECK (length(original_content_sha256) = 64),
  target_language TEXT NOT NULL,
  target_primary_language TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  normalization_schema_version INTEGER NOT NULL CHECK (normalization_schema_version > 0),
  translated_track_id TEXT NOT NULL,
  translated_track_version INTEGER NOT NULL CHECK (translated_track_version > 0),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  normalized_sha256 TEXT NOT NULL CHECK (length(normalized_sha256) = 64),
  normalized_transcript_json TEXT NOT NULL CHECK (length(normalized_transcript_json) > 0),
  promoted_at TEXT NOT NULL
);

CREATE INDEX derived_translation_cache_lookup
  ON derived_translation_cache(
    project_id, catalog_video_id, base_transcript_version_id,
    original_track_id, target_primary_language
  );
CREATE UNIQUE INDEX derived_translation_cache_identity
  ON derived_translation_cache(
    project_id, catalog_video_id, base_transcript_version_id,
    original_track_id, original_content_sha256, target_primary_language,
    provider, COALESCE(model, ''), normalization_schema_version
  );
