CREATE TABLE clip_comment_mentions (
  comment_id uuid NOT NULL REFERENCES clip_comments(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES users(id),
  mentioned_handle text NOT NULL CHECK (length(btrim(mentioned_handle)) > 0),
  mentioned_display_name text NOT NULL
    CHECK (length(btrim(mentioned_display_name)) > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (comment_id, mentioned_user_id)
);

CREATE TABLE clip_follows (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  following boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, clip_id, user_id),
  FOREIGN KEY (project_id, clip_id)
    REFERENCES clip_candidates(project_id, id) ON DELETE CASCADE
);

INSERT INTO clip_follows
  (project_id, clip_id, user_id, following, version, updated_at)
SELECT project_id, id, created_by, true, 1, created_at
FROM clip_candidates
ON CONFLICT DO NOTHING;

CREATE TABLE clip_follow_commands (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  clip_id uuid NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, actor_id, idempotency_key),
  FOREIGN KEY (project_id, clip_id)
    REFERENCES clip_candidates(project_id, id) ON DELETE CASCADE
);

CREATE TABLE clip_comment_notices (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  comment_id uuid NOT NULL REFERENCES clip_comments(id) ON DELETE CASCADE,
  comment_version integer NOT NULL CHECK (comment_version > 0),
  recipient_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('mention', 'followed_comment')),
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_handle text NOT NULL CHECK (length(btrim(actor_handle)) > 0),
  actor_display_name text NOT NULL CHECK (length(btrim(actor_display_name)) > 0),
  source_time_ms bigint CHECK (source_time_ms IS NULL OR source_time_ms >= 0),
  state text NOT NULL DEFAULT 'unread' CHECK (state IN ('unread', 'seen')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  seen_at timestamptz,
  FOREIGN KEY (project_id, clip_id)
    REFERENCES clip_candidates(project_id, id) ON DELETE CASCADE,
  CHECK (
    (state = 'unread' AND seen_at IS NULL)
    OR (state = 'seen' AND seen_at IS NOT NULL)
  ),
  UNIQUE (comment_id, comment_version, recipient_id)
);

CREATE INDEX clip_comment_notices_recipient
  ON clip_comment_notices(recipient_id, state, created_at DESC, id);

CREATE TABLE authoring_build_snapshots (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, created_by, idempotency_key)
);

CREATE INDEX clip_comments_active_search
  ON clip_comments(project_id, clip_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;
