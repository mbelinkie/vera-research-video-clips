ALTER TABLE users
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'en'
    CHECK (length(preferred_language) BETWEEN 2 AND 35);

CREATE TABLE transcript_translation_lineages (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  base_transcript_version_id uuid NOT NULL REFERENCES transcript_versions(id) ON DELETE CASCADE,
  original_track_id uuid NOT NULL,
  original_content_sha256 text NOT NULL CHECK (length(original_content_sha256) = 64),
  target_language text NOT NULL CHECK (length(target_language) BETWEEN 2 AND 35),
  target_primary_language text NOT NULL CHECK (length(target_primary_language) BETWEEN 2 AND 8),
  provider text NOT NULL CHECK (length(btrim(provider)) > 0),
  model text,
  normalization_schema_version integer NOT NULL CHECK (normalization_schema_version > 0),
  idempotency_key text NOT NULL UNIQUE,
  active_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transcript_translation_versions (
  id uuid PRIMARY KEY,
  lineage_id uuid NOT NULL REFERENCES transcript_translation_lineages(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  translated_track_id uuid NOT NULL,
  translated_track_version integer NOT NULL CHECK (translated_track_version > 0),
  source_track_id uuid NOT NULL,
  language text NOT NULL CHECK (length(language) BETWEEN 2 AND 35),
  timing_precision text NOT NULL CHECK (timing_precision IN ('word', 'cue', 'estimated')),
  manifest_object_key text NOT NULL,
  manifest_object_version_id text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (length(manifest_sha256) = 64),
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lineage_id, version)
);

ALTER TABLE transcript_translation_lineages
  ADD CONSTRAINT transcript_translation_lineages_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES transcript_translation_versions(id);

CREATE TABLE transcript_translation_artifacts (
  translation_version_id uuid NOT NULL REFERENCES transcript_translation_versions(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('manifest', 'translated-normalized')),
  object_key text NOT NULL,
  object_version_id text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  PRIMARY KEY (translation_version_id, artifact_type)
);

CREATE TABLE transcript_translation_jobs (
  id uuid PRIMARY KEY,
  lineage_id uuid NOT NULL REFERENCES transcript_translation_lineages(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('queued', 'processing', 'complete', 'failed', 'canceled', 'superseded')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_worker_id uuid REFERENCES users(id),
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lineage_id)
);

CREATE INDEX transcript_translation_lookup
  ON transcript_translation_lineages(
    project_id, video_id, base_transcript_version_id,
    target_primary_language, active_version_id
  );
CREATE UNIQUE INDEX transcript_translation_identity
  ON transcript_translation_lineages(
    project_id, video_id, base_transcript_version_id, original_track_id,
    original_content_sha256, target_primary_language, provider,
    COALESCE(model, ''), normalization_schema_version
  );
CREATE INDEX transcript_translation_jobs_claim
  ON transcript_translation_jobs(state, lease_expires_at, created_at);

ALTER TABLE clip_candidates
  ADD COLUMN language_evidence_schema_version integer NOT NULL DEFAULT 1
    CHECK (language_evidence_schema_version IN (1, 2));
ALTER TABLE clip_candidates
  ADD COLUMN selection_text text;

CREATE TABLE clip_language_evidence (
  clip_id uuid NOT NULL REFERENCES clip_candidates(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('native', 'english', 'preferred')),
  language text NOT NULL CHECK (length(language) BETWEEN 2 AND 35),
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  track_id uuid NOT NULL,
  track_version integer NOT NULL CHECK (track_version > 0),
  source_track_id uuid,
  timing_precision text NOT NULL CHECK (timing_precision IN ('word', 'cue', 'estimated')),
  PRIMARY KEY (clip_id, role),
  CHECK (role <> 'preferred' OR source_track_id IS NOT NULL)
);

CREATE INDEX clip_language_evidence_language
  ON clip_language_evidence(language, role, clip_id);
