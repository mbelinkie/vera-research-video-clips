CREATE UNIQUE INDEX transcript_versions_project_video_identity
  ON transcript_versions(project_id, video_id, id);

CREATE TABLE project_keyword_scans (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  transcript_version_id uuid NOT NULL,
  keyword_set_version integer NOT NULL CHECK (keyword_set_version > 0),
  scanner_schema_version integer NOT NULL CHECK (scanner_schema_version > 0),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'scanning', 'completed', 'failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  worker_id uuid REFERENCES users(id),
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  expires_at timestamptz,
  artifact_object_key text,
  artifact_object_version_id text,
  artifact_sha256 text CHECK (artifact_sha256 IS NULL OR length(artifact_sha256) = 64),
  artifact_size_bytes bigint CHECK (artifact_size_bytes IS NULL OR artifact_size_bytes BETWEEN 0 AND 50000000),
  artifact_schema_version integer CHECK (artifact_schema_version IS NULL OR artifact_schema_version > 0),
  occurrence_count integer CHECK (occurrence_count IS NULL OR occurrence_count BETWEEN 0 AND 50000),
  matched_keyword_count integer CHECK (matched_keyword_count IS NULL OR matched_keyword_count BETWEEN 0 AND 200),
  approved_keyword_count integer NOT NULL CHECK (approved_keyword_count BETWEEN 0 AND 200),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
  error_code text CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 120),
  error_message text CHECK (error_message IS NULL OR length(error_message) BETWEEN 1 AND 500),
  terminal_actor_id uuid REFERENCES users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_keyword_scans_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_keyword_scans_transcript_identity_fk
    FOREIGN KEY (project_id, video_id, transcript_version_id)
    REFERENCES transcript_versions(project_id, video_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_keyword_scans_exact_input_unique
    UNIQUE (
      project_id,
      video_id,
      transcript_version_id,
      keyword_set_version,
      scanner_schema_version
    ),
  CONSTRAINT project_keyword_scans_lifecycle_check CHECK (
    (
      state = 'queued'
      AND worker_id IS NULL
      AND claimed_at IS NULL
      AND heartbeat_at IS NULL
      AND expires_at IS NULL
      AND artifact_object_key IS NULL
      AND artifact_object_version_id IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_schema_version IS NULL
      AND occurrence_count IS NULL
      AND matched_keyword_count IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND terminal_actor_id IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      state = 'scanning'
      AND attempt > 0
      AND worker_id IS NOT NULL
      AND claimed_at IS NOT NULL
      AND heartbeat_at IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > heartbeat_at
      AND artifact_object_key IS NULL
      AND artifact_object_version_id IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_schema_version IS NULL
      AND occurrence_count IS NULL
      AND matched_keyword_count IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND terminal_actor_id IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      state = 'completed'
      AND attempt > 0
      AND worker_id IS NULL
      AND claimed_at IS NULL
      AND heartbeat_at IS NULL
      AND expires_at IS NULL
      AND artifact_object_key IS NOT NULL
      AND artifact_object_version_id IS NOT NULL
      AND artifact_sha256 IS NOT NULL
      AND artifact_size_bytes IS NOT NULL
      AND artifact_schema_version = scanner_schema_version
      AND occurrence_count IS NOT NULL
      AND matched_keyword_count IS NOT NULL
      AND matched_keyword_count <= approved_keyword_count
      AND error_code IS NULL
      AND error_message IS NULL
      AND terminal_actor_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR
    (
      state = 'failed'
      AND attempt > 0
      AND worker_id IS NULL
      AND claimed_at IS NULL
      AND heartbeat_at IS NULL
      AND expires_at IS NULL
      AND artifact_object_key IS NULL
      AND artifact_object_version_id IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_schema_version IS NULL
      AND occurrence_count IS NULL
      AND matched_keyword_count IS NULL
      AND error_code IS NOT NULL
      AND error_message IS NOT NULL
      AND terminal_actor_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX project_keyword_scans_claimable
  ON project_keyword_scans(created_at, id)
  WHERE state = 'queued';
CREATE INDEX project_keyword_scans_expired
  ON project_keyword_scans(expires_at, id)
  WHERE state = 'scanning';
CREATE INDEX project_keyword_scans_project_video_history
  ON project_keyword_scans(project_id, video_id, created_at DESC, id DESC);
