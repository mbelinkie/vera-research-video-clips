CREATE TABLE library_audio_assets (
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  object_version_id text NOT NULL,
  playback_sha256 text NOT NULL CHECK (playback_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
  mime_type text NOT NULL,
  manifest jsonb NOT NULL,
  PRIMARY KEY (project_id, source_id),
  FOREIGN KEY (project_id, source_id) REFERENCES library_sources(project_id, id) ON DELETE CASCADE
);
