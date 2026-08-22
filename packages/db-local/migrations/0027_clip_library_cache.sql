CREATE TABLE clip_library_cache_pages (
  project_id TEXT NOT NULL CHECK (length(project_id) = 36),
  authorization_scope_sha256 TEXT NOT NULL CHECK (
    length(authorization_scope_sha256) = 64 AND
    authorization_scope_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  query_fingerprint TEXT NOT NULL CHECK (
    length(query_fingerprint) = 64 AND
    query_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  cursor_key TEXT NOT NULL CHECK (
    cursor_key = 'root' OR (
      length(cursor_key) = 64 AND
      cursor_key NOT GLOB '*[^0-9a-f]*'
    )
  ),
  query_json TEXT NOT NULL CHECK (json_valid(query_json)),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  sync_cursor TEXT NOT NULL CHECK (
    length(sync_cursor) BETWEEN 1 AND 40 AND
    sync_cursor NOT GLOB '*[^0-9]*'
  ),
  cached_at TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  last_viewed_sequence INTEGER NOT NULL CHECK (last_viewed_sequence > 0),
  PRIMARY KEY (
    project_id,
    authorization_scope_sha256,
    query_fingerprint,
    cursor_key
  )
);

CREATE INDEX clip_library_cache_pages_scope
  ON clip_library_cache_pages(
    project_id,
    authorization_scope_sha256,
    last_viewed_sequence DESC
  );

CREATE TABLE clip_library_selected_clips (
  project_id TEXT NOT NULL CHECK (length(project_id) = 36),
  authorization_scope_sha256 TEXT NOT NULL CHECK (
    length(authorization_scope_sha256) = 64 AND
    authorization_scope_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  clip_id TEXT NOT NULL CHECK (length(clip_id) = 36),
  selected_at TEXT NOT NULL,
  PRIMARY KEY (project_id, authorization_scope_sha256, clip_id)
);

CREATE INDEX clip_library_selected_clips_scope
  ON clip_library_selected_clips(
    project_id,
    authorization_scope_sha256,
    selected_at,
    clip_id
  );
