ALTER TABLE project_videos
  ADD COLUMN worklist_priority text NOT NULL DEFAULT 'normal'
    CHECK (worklist_priority IN ('high', 'normal', 'low')),
  ADD COLUMN review_completion_policy text NOT NULL
    DEFAULT 'researcher_or_administrator'
    CHECK (review_completion_policy IN (
      'researcher_or_administrator', 'administrator_only'
    ));

CREATE TABLE project_video_claims (
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  claimant_user_id uuid NOT NULL REFERENCES users(id),
  generation integer NOT NULL CHECK (generation > 0),
  version integer NOT NULL CHECK (version > 0),
  claimed_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, video_id),
  CONSTRAINT project_video_claims_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_video_claims_expiry_check CHECK (
    claimed_at <= heartbeat_at AND heartbeat_at < expires_at
  )
);

CREATE TABLE project_video_claim_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'claimed', 'renewed', 'taken_over', 'released'
  )),
  actor_id uuid NOT NULL REFERENCES users(id),
  previous_claimant_user_id uuid REFERENCES users(id),
  claim_generation integer NOT NULL CHECK (claim_generation > 0),
  claim_version integer NOT NULL CHECK (claim_version > 0),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT project_video_claim_events_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  UNIQUE (project_id, video_id, actor_id, idempotency_key)
);

CREATE INDEX project_video_claims_expiry
  ON project_video_claims(expires_at, project_id, video_id);

CREATE INDEX project_video_claim_events_project_video
  ON project_video_claim_events(project_id, video_id, created_at, id);

CREATE TABLE project_video_governance_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  priority text CHECK (priority IN ('high', 'normal', 'low')),
  review_completion_policy text CHECK (review_completion_policy IN (
    'researcher_or_administrator', 'administrator_only'
  )),
  project_video_version integer NOT NULL CHECK (project_video_version > 0),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT project_video_governance_events_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_video_governance_events_change_check CHECK (
    priority IS NOT NULL OR review_completion_policy IS NOT NULL
  ),
  UNIQUE (project_id, video_id, actor_id, idempotency_key)
);

CREATE INDEX project_video_governance_events_project_video
  ON project_video_governance_events(project_id, video_id, created_at, id);

CREATE TABLE project_video_review_cycles (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  status text NOT NULL CHECK (status IN ('open', 'completed')),
  version integer NOT NULL CHECK (version > 0),
  opened_by uuid REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  reopen_reason text CHECK (
    reopen_reason IS NULL OR (
      length(btrim(reopen_reason)) > 0 AND length(reopen_reason) <= 1000
    )
  ),
  completion_policy text CHECK (completion_policy IN (
    'researcher_or_administrator', 'administrator_only'
  )),
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  completion_basis text CHECK (completion_basis IN (
    'ready_transcript', 'without_ready_transcript_acknowledged'
  )),
  transcript_version_id uuid,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_video_review_cycles_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_video_review_cycles_transcript_fk
    FOREIGN KEY (transcript_version_id)
    REFERENCES transcript_versions(id),
  CONSTRAINT project_video_review_cycles_reopen_check CHECK (
    (cycle_number = 1 AND reopen_reason IS NULL)
    OR (cycle_number > 1 AND reopen_reason IS NOT NULL)
  ),
  CONSTRAINT project_video_review_cycles_completion_check CHECK (
    (
      status = 'open'
      AND completion_policy IS NULL
      AND completed_by IS NULL
      AND completed_at IS NULL
      AND completion_basis IS NULL
      AND transcript_version_id IS NULL
    ) OR (
      status = 'completed'
      AND completion_policy IS NOT NULL
      AND completed_by IS NOT NULL
      AND completed_at IS NOT NULL
      AND completion_basis IS NOT NULL
      AND (
        (completion_basis = 'ready_transcript' AND transcript_version_id IS NOT NULL)
        OR (
          completion_basis = 'without_ready_transcript_acknowledged'
          AND transcript_version_id IS NULL
        )
      )
    )
  ),
  UNIQUE (project_id, video_id, cycle_number),
  UNIQUE (project_id, video_id, id)
);

CREATE UNIQUE INDEX project_video_review_cycles_one_open
  ON project_video_review_cycles(project_id, video_id)
  WHERE status = 'open';

CREATE TABLE project_video_review_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  previous_cycle_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('completed', 'reopened')),
  actor_id uuid NOT NULL REFERENCES users(id),
  cycle_version integer NOT NULL CHECK (cycle_version > 0),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT project_video_review_events_cycle_fk
    FOREIGN KEY (project_id, video_id, cycle_id)
    REFERENCES project_video_review_cycles(project_id, video_id, id),
  CONSTRAINT project_video_review_events_previous_cycle_fk
    FOREIGN KEY (project_id, video_id, previous_cycle_id)
    REFERENCES project_video_review_cycles(project_id, video_id, id),
  CONSTRAINT project_video_review_events_previous_check CHECK (
    (event_type = 'completed' AND previous_cycle_id IS NULL)
    OR (event_type = 'reopened' AND previous_cycle_id IS NOT NULL)
  ),
  UNIQUE (project_id, video_id, actor_id, idempotency_key)
);

CREATE INDEX project_video_review_events_project_video
  ON project_video_review_events(project_id, video_id, created_at, id);

WITH historical_cycles AS (
  SELECT
    pv.project_id,
    pv.video_id,
    pv.created_at,
    md5(pv.project_id::text || ':' || pv.video_id::text || ':review:1') AS digest
  FROM project_videos pv
)
INSERT INTO project_video_review_cycles (
  id, project_id, video_id, cycle_number, status, version, opened_by,
  opened_at, reopen_reason, updated_at
)
SELECT
  (
    substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-' ||
    '4' || substr(digest, 14, 3) || '-' ||
    '8' || substr(digest, 18, 3) || '-' ||
    substr(digest, 21, 12)
  )::uuid,
  project_id,
  video_id,
  1,
  'open',
  1,
  NULL,
  created_at,
  NULL,
  created_at
FROM historical_cycles;
