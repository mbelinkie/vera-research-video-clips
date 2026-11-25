CREATE TABLE project_bookmarks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id uuid NOT NULL,
  source_time_ms bigint NOT NULL CHECK (source_time_ms >= 0),
  title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 120),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 4000),
  search_text text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_by_handle text NOT NULL,
  created_by_display_name text NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_by_handle text NOT NULL,
  updated_by_display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id),
  UNIQUE (project_id, id)
);

CREATE TABLE project_bookmark_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bookmark_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_kind text NOT NULL
    CHECK (command_kind IN ('create', 'update', 'archive', 'restore')),
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (length(request_sha256) = 64),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, bookmark_id)
    REFERENCES project_bookmarks(project_id, id),
  UNIQUE (project_id, actor_id, idempotency_key)
);

CREATE INDEX project_bookmarks_video_time
  ON project_bookmarks(project_id, video_id, state, source_time_ms, id);
CREATE INDEX project_bookmarks_project_time
  ON project_bookmarks(project_id, state, source_time_ms, id);
CREATE INDEX project_bookmark_commands_created
  ON project_bookmark_commands(project_id, created_at, id);
