ALTER TABLE clip_candidates
  ADD COLUMN request_sha256 text
    CHECK (request_sha256 IS NULL OR request_sha256 ~ '^[a-f0-9]{64}$');

ALTER TABLE clip_candidates
  ADD CONSTRAINT clip_candidates_project_identity
  UNIQUE (project_id, id);

CREATE TABLE clip_comments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  author_handle text NOT NULL CHECK (length(btrim(author_handle)) > 0),
  author_display_name text NOT NULL
    CHECK (length(btrim(author_display_name)) > 0),
  body text,
  source_time_ms bigint CHECK (source_time_ms IS NULL OR source_time_ms >= 0),
  initial_comment boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id),
  deleted_by_handle text,
  deleted_by_display_name text,
  deletion_kind text CHECK (deletion_kind IN ('author', 'moderation')),
  FOREIGN KEY (project_id, clip_id)
    REFERENCES clip_candidates(project_id, id) ON DELETE CASCADE,
  CHECK (
    (deleted_at IS NULL
      AND body IS NOT NULL
      AND length(btrim(body)) > 0
      AND deleted_by IS NULL
      AND deleted_by_handle IS NULL
      AND deleted_by_display_name IS NULL
      AND deletion_kind IS NULL)
    OR
    (deleted_at IS NOT NULL
      AND body IS NULL
      AND deleted_by IS NOT NULL
      AND length(btrim(deleted_by_handle)) > 0
      AND length(btrim(deleted_by_display_name)) > 0
      AND deletion_kind IS NOT NULL)
  )
);

CREATE UNIQUE INDEX clip_comments_one_initial_per_clip
  ON clip_comments(project_id, clip_id)
  WHERE initial_comment;
CREATE INDEX clip_comments_chronological
  ON clip_comments(project_id, clip_id, created_at, id);

CREATE TABLE clip_comment_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_kind text NOT NULL
    CHECK (command_kind IN ('create', 'update', 'delete', 'moderate')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  comment_id uuid NOT NULL REFERENCES clip_comments(id) ON DELETE CASCADE,
  result_version integer NOT NULL CHECK (result_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, clip_id)
    REFERENCES clip_candidates(project_id, id) ON DELETE CASCADE,
  UNIQUE (project_id, actor_id, command_kind, idempotency_key)
);

CREATE INDEX clip_comment_commands_comment
  ON clip_comment_commands(project_id, clip_id, comment_id);
