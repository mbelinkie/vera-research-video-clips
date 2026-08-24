ALTER TABLE project_videos
  ADD COLUMN triage_state text NOT NULL DEFAULT 'active'
    CHECK (triage_state IN ('active', 'dismissed')),
  ADD COLUMN triage_version integer NOT NULL DEFAULT 1
    CHECK (triage_version > 0),
  ADD COLUMN dismissed_by uuid REFERENCES users(id),
  ADD COLUMN dismissed_at timestamptz,
  ADD COLUMN dismissal_reason text CHECK (
    dismissal_reason IS NULL OR (
      length(btrim(dismissal_reason)) > 0
      AND length(dismissal_reason) <= 1000
    )
  ),
  ADD CONSTRAINT project_videos_triage_evidence_check CHECK (
    (
      triage_state = 'active'
      AND dismissed_by IS NULL
      AND dismissed_at IS NULL
      AND dismissal_reason IS NULL
    ) OR (
      triage_state = 'dismissed'
      AND dismissed_by IS NOT NULL
      AND dismissed_at IS NOT NULL
    )
  );

CREATE TABLE project_video_triage_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('dismiss', 'restore')),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, actor_id, idempotency_key)
);

CREATE TABLE project_video_triage_events (
  id uuid PRIMARY KEY,
  command_id uuid NOT NULL REFERENCES project_video_triage_commands(id),
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('dismissed', 'restored')),
  actor_id uuid NOT NULL REFERENCES users(id),
  previous_state text NOT NULL CHECK (previous_state IN ('active', 'dismissed')),
  triage_version integer NOT NULL CHECK (triage_version > 0),
  reason text CHECK (
    reason IS NULL OR (
      length(btrim(reason)) > 0 AND length(reason) <= 1000
    )
  ),
  created_at timestamptz NOT NULL,
  CONSTRAINT project_video_triage_events_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  UNIQUE (command_id, video_id)
);

CREATE INDEX project_video_triage_events_project_video
  ON project_video_triage_events(project_id, video_id, created_at, id);

CREATE TABLE transcription_job_cancel_requests (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL,
  revoked_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT transcription_job_cancel_requests_lifecycle_check CHECK (
    (revoked_at IS NULL OR revoked_at >= requested_at)
    AND (completed_at IS NULL OR completed_at >= requested_at)
    AND NOT (revoked_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX transcription_job_cancel_requests_pending
  ON transcription_job_cancel_requests(project_id, requested_at, job_id)
  WHERE revoked_at IS NULL AND completed_at IS NULL;

CREATE TABLE project_video_activity_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'review_completed', 'review_reopened', 'video_dismissed', 'video_restored'
  )),
  actor_id uuid NOT NULL REFERENCES users(id),
  source_key text NOT NULL CHECK (
    length(btrim(source_key)) > 0 AND length(source_key) <= 240
  ),
  reason text CHECK (
    reason IS NULL OR (
      length(btrim(reason)) > 0 AND length(reason) <= 1000
    )
  ),
  created_at timestamptz NOT NULL,
  CONSTRAINT project_video_activity_events_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  UNIQUE (project_id, event_type, source_key)
);

CREATE INDEX project_video_activity_events_project_video
  ON project_video_activity_events(project_id, video_id, created_at, id);

CREATE TABLE project_video_activity_receipts (
  event_id uuid NOT NULL REFERENCES project_video_activity_events(id)
    ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'unread' CHECK (state IN ('unread', 'seen')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  seen_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT project_video_activity_receipts_seen_check CHECK (
    (state = 'unread' AND seen_at IS NULL)
    OR (state = 'seen' AND seen_at IS NOT NULL)
  )
);

CREATE INDEX project_video_activity_receipts_user_state
  ON project_video_activity_receipts(user_id, state, created_at DESC, event_id);
