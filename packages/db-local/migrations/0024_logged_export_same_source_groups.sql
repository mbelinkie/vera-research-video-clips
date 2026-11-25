CREATE TABLE logged_export_source_groups (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  compatibility_key TEXT NOT NULL UNIQUE CHECK (length(compatibility_key) = 64),
  project_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  acquisition_profile_fingerprint TEXT NOT NULL
    CHECK (length(acquisition_profile_fingerprint) = 64),
  worker_id TEXT NOT NULL,
  worker_epoch INTEGER NOT NULL CHECK (worker_epoch > 0),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'open', 'acquiring', 'ready', 'deleting', 'deleted',
    'acquisition_failed', 'cleanup_failed'
  )),
  provider TEXT,
  source_identity TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size > 0),
  content_sha256 TEXT CHECK (
    content_sha256 IS NULL OR length(content_sha256) = 64
  ),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
  container_format TEXT,
  video_codec TEXT,
  audio_codec TEXT,
  ffprobe_version TEXT,
  cleanup_claim_token TEXT,
  cleanup_claim_expires_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ready_at TEXT,
  cleanup_started_at TEXT,
  deleted_at TEXT,
  cleanup_error_code TEXT,
  cleanup_error_message TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE logged_export_source_group_members (
  group_id TEXT NOT NULL REFERENCES logged_export_source_groups(id)
    ON DELETE RESTRICT,
  export_request_id TEXT NOT NULL UNIQUE REFERENCES export_requests(id)
    ON DELETE RESTRICT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  execution_id TEXT NOT NULL,
  batch_item_id TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'joined', 'released', 'settled'
  )),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'succeeded', 'failed', 'canceled'
  )),
  joined_at TEXT NOT NULL,
  released_at TEXT,
  settled_at TEXT,
  PRIMARY KEY (group_id, export_request_id),
  UNIQUE (execution_id),
  UNIQUE (group_id, batch_item_id),
  UNIQUE (group_id, job_id, attempt)
);

ALTER TABLE source_scratch_assets
  ADD COLUMN source_group_id TEXT REFERENCES logged_export_source_groups(id)
    ON DELETE RESTRICT;

DROP TRIGGER source_scratch_assets_layout_version_insert;
DROP TRIGGER source_scratch_assets_layout_version_update;

CREATE TRIGGER source_scratch_assets_layout_version_insert
BEFORE INSERT ON source_scratch_assets
WHEN NEW.scratch_layout_version IS NOT NULL
  AND NEW.scratch_layout_version NOT IN (2, 3)
BEGIN
  SELECT RAISE(ABORT, 'unsupported source scratch layout version');
END;

CREATE TRIGGER source_scratch_assets_layout_version_update
BEFORE UPDATE OF scratch_layout_version ON source_scratch_assets
WHEN NEW.scratch_layout_version IS NOT NULL
  AND NEW.scratch_layout_version NOT IN (2, 3)
BEGIN
  SELECT RAISE(ABORT, 'unsupported source scratch layout version');
END;

CREATE INDEX logged_export_source_groups_cleanup
  ON logged_export_source_groups(lifecycle_state, expires_at,
    cleanup_claim_expires_at);
CREATE INDEX logged_export_source_group_members_release
  ON logged_export_source_group_members(group_id, lifecycle_state);
CREATE INDEX source_scratch_assets_group
  ON source_scratch_assets(source_group_id, lifecycle_state);

CREATE TRIGGER logged_export_source_groups_identity_immutable
BEFORE UPDATE OF compatibility_key, project_id, batch_id, youtube_video_id,
  acquisition_profile_fingerprint, worker_id, worker_epoch
ON logged_export_source_groups
BEGIN
  SELECT RAISE(ABORT, 'logged export source group identity is immutable');
END;

CREATE TRIGGER logged_export_source_group_member_identity_immutable
BEFORE UPDATE OF group_id, export_request_id, job_id, attempt, execution_id,
  batch_item_id
ON logged_export_source_group_members
BEGIN
  SELECT RAISE(ABORT, 'logged export source group member identity is immutable');
END;

CREATE TRIGGER logged_export_source_group_member_shape_insert
BEFORE INSERT ON logged_export_source_group_members
WHEN (NEW.lifecycle_state = 'joined' AND (
        NEW.outcome IS NOT NULL OR NEW.released_at IS NOT NULL OR
        NEW.settled_at IS NOT NULL
      )) OR
     (NEW.lifecycle_state = 'released' AND (
        NEW.outcome IS NULL OR NEW.released_at IS NULL OR
        NEW.settled_at IS NOT NULL
      )) OR
     (NEW.lifecycle_state = 'settled' AND (
        NEW.outcome IS NULL OR NEW.released_at IS NULL OR
        NEW.settled_at IS NULL
      ))
BEGIN
  SELECT RAISE(ABORT, 'logged export source group member state is incomplete');
END;

CREATE TRIGGER logged_export_source_group_member_shape_update
BEFORE UPDATE OF lifecycle_state, outcome, released_at, settled_at
ON logged_export_source_group_members
WHEN (NEW.lifecycle_state = 'joined' AND (
        NEW.outcome IS NOT NULL OR NEW.released_at IS NOT NULL OR
        NEW.settled_at IS NOT NULL
      )) OR
     (NEW.lifecycle_state = 'released' AND (
        NEW.outcome IS NULL OR NEW.released_at IS NULL OR
        NEW.settled_at IS NOT NULL
      )) OR
     (NEW.lifecycle_state = 'settled' AND (
        NEW.outcome IS NULL OR NEW.released_at IS NULL OR
        NEW.settled_at IS NULL
      ))
BEGIN
  SELECT RAISE(ABORT, 'logged export source group member state is incomplete');
END;

CREATE TRIGGER logged_export_source_group_cleanup_claim_pair_insert
BEFORE INSERT ON logged_export_source_groups
WHEN (NEW.cleanup_claim_token IS NULL) !=
     (NEW.cleanup_claim_expires_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'logged export source group cleanup claim is incomplete');
END;

CREATE TRIGGER logged_export_source_group_cleanup_claim_pair_update
BEFORE UPDATE OF cleanup_claim_token, cleanup_claim_expires_at
ON logged_export_source_groups
WHEN (NEW.cleanup_claim_token IS NULL) !=
     (NEW.cleanup_claim_expires_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'logged export source group cleanup claim is incomplete');
END;

CREATE TRIGGER source_scratch_assets_group_layout_insert
BEFORE INSERT ON source_scratch_assets
WHEN NEW.source_group_id IS NOT NULL AND NEW.scratch_layout_version IS NOT 3
BEGIN
  SELECT RAISE(ABORT, 'shared source scratch requires layout version 3');
END;

CREATE TRIGGER source_scratch_assets_group_layout_update
BEFORE UPDATE OF source_group_id, scratch_layout_version ON source_scratch_assets
WHEN NEW.source_group_id IS NOT NULL AND NEW.scratch_layout_version IS NOT 3
BEGIN
  SELECT RAISE(ABORT, 'shared source scratch requires layout version 3');
END;
