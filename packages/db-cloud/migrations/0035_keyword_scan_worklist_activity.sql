ALTER TABLE project_video_activity_events
  DROP CONSTRAINT project_video_activity_events_event_type_check;

ALTER TABLE project_video_activity_events
  ADD CONSTRAINT project_video_activity_events_event_type_check CHECK (
    event_type IN (
      'review_completed', 'review_reopened', 'video_dismissed',
      'video_restored', 'keyword_scan_completed'
    )
  );

ALTER TABLE project_keyword_scans
  ADD COLUMN keyword_counts jsonb,
  ADD CONSTRAINT project_keyword_scans_keyword_counts_check CHECK (
    keyword_counts IS NULL OR jsonb_typeof(keyword_counts) = 'array'
  );

CREATE TABLE project_video_priority_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  requested_priority text NOT NULL CHECK (
    requested_priority IN ('high', 'normal', 'low')
  ),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, actor_id, idempotency_key)
);
