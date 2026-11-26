CREATE TABLE desktop_setup (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  rights_acknowledged INTEGER NOT NULL CHECK (rights_acknowledged IN (0, 1)),
  privacy_acknowledged INTEGER NOT NULL CHECK (privacy_acknowledged IN (0, 1)),
  worker_enabled INTEGER NOT NULL CHECK (worker_enabled IN (0, 1)),
  translation_consent INTEGER NOT NULL CHECK (translation_consent IN (0, 1)),
  caption_provider TEXT NOT NULL CHECK (caption_provider IN ('disabled', 'yt_dlp')),
  media_provider TEXT NOT NULL CHECK (media_provider IN ('disabled', 'yt_dlp_audio')),
  export_source_provider TEXT NOT NULL CHECK (export_source_provider IN ('disabled', 'yt_dlp')),
  speech_to_text_provider TEXT NOT NULL CHECK (speech_to_text_provider IN ('disabled', 'whisper_cpp')),
  translation_provider TEXT NOT NULL CHECK (translation_provider IN ('disabled', 'aws_translate')),
  updated_at TEXT NOT NULL
);

CREATE TABLE validated_local_component_references (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  target TEXT NOT NULL CHECK (target IN (
    'output_root', 'cache_root', 'ffmpeg', 'ffprobe', 'yt_dlp', 'whisper_cli', 'whisper_model'
  )),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  absolute_path TEXT NOT NULL CHECK (length(absolute_path) BETWEEN 1 AND 4096),
  filesystem_identity TEXT NOT NULL CHECK (length(filesystem_identity) BETWEEN 3 AND 200),
  version TEXT CHECK (version IS NULL OR length(trim(version)) BETWEEN 1 AND 160),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR (
    length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  )),
  validation_evidence_json TEXT NOT NULL CHECK (json_valid(validation_evidence_json)),
  validation_schema_version INTEGER NOT NULL CHECK (validation_schema_version = 1),
  state TEXT NOT NULL CHECK (state IN ('candidate', 'active', 'superseded')),
  validated_at TEXT NOT NULL,
  activated_at TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (state = 'candidate' AND activated_at IS NULL AND superseded_at IS NULL) OR
    (state = 'active' AND activated_at IS NOT NULL AND superseded_at IS NULL) OR
    (state = 'superseded' AND activated_at IS NOT NULL AND superseded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX validated_local_component_references_one_active_target
  ON validated_local_component_references(target)
  WHERE state = 'active';

CREATE INDEX validated_local_component_references_target_state
  ON validated_local_component_references(target, state, validated_at DESC);
