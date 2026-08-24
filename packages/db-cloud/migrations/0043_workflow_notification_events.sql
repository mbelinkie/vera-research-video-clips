CREATE TABLE workflow_notification_events (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'transcription_batch_terminal',
    'transcription_action_needed',
    'logged_export_terminal'
  )),
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 512),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES transcription_batches(id) ON DELETE CASCADE,
  batch_item_id uuid REFERENCES transcription_batch_items(id) ON DELETE CASCADE,
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE,
  clip_id uuid REFERENCES clip_candidates(id) ON DELETE CASCADE,
  export_request_id uuid REFERENCES export_requests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'ready', 'blocked', 'failed', 'action_needed', 'completed'
  )),
  project_label text NOT NULL CHECK (length(btrim(project_label)) BETWEEN 1 AND 160),
  batch_label text CHECK (batch_label IS NULL OR length(btrim(batch_label)) BETWEEN 1 AND 160),
  source_label text CHECK (source_label IS NULL OR length(btrim(source_label)) BETWEEN 1 AND 160),
  clip_label text CHECK (clip_label IS NULL OR length(btrim(clip_label)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL,
  UNIQUE (recipient_id, event_type, source_key),
  CHECK (
    (event_type = 'transcription_batch_terminal'
      AND batch_id IS NOT NULL AND batch_item_id IS NULL
      AND clip_id IS NULL AND export_request_id IS NULL
      AND batch_label IS NOT NULL AND status IN ('ready', 'action_needed'))
    OR
    (event_type = 'transcription_action_needed'
      AND batch_id IS NOT NULL AND batch_item_id IS NOT NULL
      AND clip_id IS NULL AND export_request_id IS NULL
      AND batch_label IS NOT NULL
      AND status IN ('blocked', 'failed', 'action_needed'))
    OR
    (event_type = 'logged_export_terminal'
      AND batch_id IS NULL AND batch_item_id IS NULL
      AND clip_id IS NOT NULL AND export_request_id IS NOT NULL
      AND status IN ('completed', 'action_needed'))
  )
);

CREATE INDEX workflow_notification_events_recipient_feed
  ON workflow_notification_events(recipient_id, created_at DESC, id DESC);
