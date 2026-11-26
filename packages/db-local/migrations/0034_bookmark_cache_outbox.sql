CREATE TABLE bookmark_cache (
  authorized_account_id text NOT NULL,
  project_id text NOT NULL,
  bookmark_id text NOT NULL,
  video_id text NOT NULL,
  payload_json text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'archived')),
  source_time_ms integer NOT NULL CHECK (source_time_ms >= 0),
  cached_at text NOT NULL,
  PRIMARY KEY (authorized_account_id, project_id, bookmark_id)
);

CREATE TABLE bookmark_cache_reads (
  authorized_account_id text NOT NULL,
  project_id text NOT NULL,
  query_fingerprint text NOT NULL,
  query_json text NOT NULL,
  response_json text NOT NULL,
  cached_at text NOT NULL,
  PRIMARY KEY (authorized_account_id, project_id, query_fingerprint)
);

CREATE TABLE bookmark_outbox (
  sequence integer PRIMARY KEY AUTOINCREMENT,
  command_id text NOT NULL UNIQUE,
  account_id text NOT NULL,
  project_id text NOT NULL,
  bookmark_id text,
  command_kind text NOT NULL
    CHECK (command_kind IN ('create', 'update', 'archive', 'restore')),
  idempotency_key text NOT NULL,
  request_json text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'conflict')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  UNIQUE (account_id, project_id, idempotency_key)
);

CREATE TABLE bookmark_outbox_conflicts (
  command_id text PRIMARY KEY REFERENCES bookmark_outbox(command_id),
  conflict_code text NOT NULL,
  conflict_message text NOT NULL,
  retained_request_json text NOT NULL,
  created_at text NOT NULL
);

CREATE INDEX bookmark_outbox_replay
  ON bookmark_outbox(account_id, project_id, state, sequence);
CREATE INDEX bookmark_cache_video_time
  ON bookmark_cache(
    authorized_account_id, project_id, video_id, state, source_time_ms, bookmark_id
  );
