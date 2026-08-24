ALTER TABLE projects
  ADD COLUMN keyword_set_version integer NOT NULL DEFAULT 1
    CHECK (keyword_set_version > 0);

CREATE TABLE project_keywords (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  normalized_label text NOT NULL CHECK (length(normalized_label) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_label),
  UNIQUE (project_id, id)
);

CREATE TABLE project_keyword_aliases (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id uuid NOT NULL,
  language text NOT NULL CHECK (length(language) BETWEEN 1 AND 35),
  phrase text NOT NULL CHECK (length(phrase) BETWEEN 1 AND 160),
  normalized_phrase text NOT NULL CHECK (length(normalized_phrase) BETWEEN 1 AND 160),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, keyword_id)
    REFERENCES project_keywords(project_id, id) ON DELETE CASCADE,
  UNIQUE (project_id, language, normalized_phrase),
  UNIQUE (project_id, id)
);

CREATE TABLE project_keyword_suggestions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id uuid,
  proposed_label text CHECK (proposed_label IS NULL OR length(proposed_label) BETWEEN 1 AND 120),
  proposed_description text CHECK (proposed_description IS NULL OR length(proposed_description) <= 1000),
  language text NOT NULL CHECK (length(language) BETWEEN 1 AND 35),
  phrase text NOT NULL CHECK (length(phrase) BETWEEN 1 AND 160),
  normalized_phrase text NOT NULL CHECK (length(normalized_phrase) BETWEEN 1 AND 160),
  rationale text CHECK (rationale IS NULL OR length(rationale) BETWEEN 1 AND 1000),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'approved', 'rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  proposed_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_reason text CHECK (review_reason IS NULL OR length(review_reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, keyword_id)
    REFERENCES project_keywords(project_id, id),
  CHECK (keyword_id IS NOT NULL OR proposed_label IS NOT NULL),
  CHECK (
    (state = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (state <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX project_keyword_suggestions_one_pending_phrase
  ON project_keyword_suggestions(project_id, language, normalized_phrase)
  WHERE state = 'pending';

CREATE TABLE project_keyword_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_kind text NOT NULL CHECK (command_kind IN ('suggest', 'review')),
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (length(request_sha256) = 64),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, actor_id, idempotency_key)
);

CREATE INDEX project_keywords_project_enabled
  ON project_keywords(project_id, enabled, normalized_label, id);
CREATE INDEX project_keyword_aliases_keyword
  ON project_keyword_aliases(project_id, keyword_id, language, normalized_phrase, id);
CREATE INDEX project_keyword_suggestions_project_state
  ON project_keyword_suggestions(project_id, state, created_at DESC, id);
CREATE INDEX project_keyword_commands_project_created
  ON project_keyword_commands(project_id, created_at DESC, id);
