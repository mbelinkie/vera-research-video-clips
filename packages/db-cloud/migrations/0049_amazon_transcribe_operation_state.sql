-- Provider-private durable state. The generic operation ledger remains the
-- public control-plane contract; these fields are only consumed by the
-- reviewed Amazon Transcribe adapter so SDK identities never leak into jobs.
CREATE TABLE amazon_transcribe_operations (
  id text PRIMARY KEY CHECK (length(id) = 48 AND id !~ '[^0-9a-f]'),
  job_name text NOT NULL UNIQUE CHECK (length(btrim(job_name)) BETWEEN 1 AND 200),
  video_id text NOT NULL CHECK (length(btrim(video_id)) BETWEEN 1 AND 256),
  language text,
  media_format text NOT NULL CHECK (media_format IN ('mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'm4a')),
  input_bucket text NOT NULL,
  input_key text NOT NULL,
  output_bucket text NOT NULL,
  output_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('created', 'staged', 'running', 'completed_pending_cleanup', 'failed_pending_cleanup', 'succeeded', 'failed')),
  normalized_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state IN ('completed_pending_cleanup', 'succeeded')) = (normalized_result IS NOT NULL))
);

CREATE INDEX amazon_transcribe_operations_cleanup_pending
  ON amazon_transcribe_operations(updated_at)
  WHERE state IN ('completed_pending_cleanup', 'failed_pending_cleanup');
