ALTER TABLE library_sources ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX library_sources_recent ON library_sources(project_id, created_at DESC, id);

CREATE TABLE source_discussion_comments (
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, source_id, id),
  FOREIGN KEY (project_id, source_id)
    REFERENCES library_sources(project_id, id) ON DELETE CASCADE
);
CREATE INDEX source_discussion_order
  ON source_discussion_comments(project_id, source_id, created_at, id);

CREATE TABLE source_discussion_reads (
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  comment_id uuid NOT NULL,
  reader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, source_id, comment_id, reader_id),
  FOREIGN KEY (project_id, source_id, comment_id)
    REFERENCES source_discussion_comments(project_id, source_id, id) ON DELETE CASCADE
);
