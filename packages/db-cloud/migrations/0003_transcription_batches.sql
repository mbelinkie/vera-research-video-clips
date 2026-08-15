ALTER TABLE transcription_batches
  ADD COLUMN transcription_profile text NOT NULL DEFAULT 'default';
ALTER TABLE transcription_batches
  ADD COLUMN source_policy text NOT NULL DEFAULT 'prefer-existing'
    CHECK (source_policy IN ('prefer-existing', 'captions-then-generate', 'force-generate'));
ALTER TABLE transcription_batches
  ADD COLUMN priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high'));
ALTER TABLE transcription_batches
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE transcription_batches
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE transcription_batch_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES transcription_batches(id) ON DELETE CASCADE,
  input_index integer NOT NULL CHECK (input_index >= 0),
  raw_input text NOT NULL,
  youtube_video_id text,
  canonical_url text,
  catalog_video_id uuid REFERENCES videos(id),
  active_transcript_version_id uuid REFERENCES transcript_versions(id),
  title text,
  channel text,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  source_language text,
  preflight_status text NOT NULL CHECK (preflight_status IN (
    'ready', 'existing-transcript', 'duplicate', 'unsupported', 'metadata-failed'
  )),
  processing_need text NOT NULL CHECK (processing_need IN ('transcription', 'reuse-shared', 'none')),
  duplicate_of_input_index integer CHECK (duplicate_of_input_index IS NULL OR duplicate_of_input_index >= 0),
  state text NOT NULL CHECK (state IN (
    'draft', 'preflight', 'queued', 'resolving', 'acquiring', 'transcribing',
    'translating', 'aligning', 'uploading', 'ready_for_review', 'blocked',
    'failed', 'canceled'
  )),
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'reviewing', 'reviewed', 'skipped')),
  job_id uuid REFERENCES jobs(id),
  idempotency_key text,
  error_code text,
  error_message text,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, input_index)
);

CREATE INDEX transcription_batch_items_batch_state
  ON transcription_batch_items(batch_id, state, input_index);
CREATE INDEX transcription_batch_items_video
  ON transcription_batch_items(youtube_video_id);
