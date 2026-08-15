CREATE TABLE clip_candidates (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  youtube_video_id text NOT NULL,
  canonical_url text NOT NULL,
  video_title text NOT NULL,
  video_channel text,
  source_language text,
  idempotency_key text NOT NULL,
  transcript_track_id uuid NOT NULL,
  transcript_version integer NOT NULL CHECK (transcript_version > 0),
  first_segment_id uuid NOT NULL,
  last_segment_id uuid NOT NULL,
  first_token_id uuid,
  last_token_id uuid,
  transcript_start_ms bigint NOT NULL CHECK (transcript_start_ms >= 0),
  transcript_end_ms bigint NOT NULL CHECK (transcript_end_ms > transcript_start_ms),
  export_start_ms bigint NOT NULL CHECK (export_start_ms >= 0),
  export_end_ms bigint NOT NULL CHECK (export_end_ms > export_start_ms),
  timing_precision text NOT NULL CHECK (timing_precision IN ('word', 'cue', 'estimated')),
  english_text text NOT NULL CHECK (length(btrim(english_text)) > 0),
  original_text text,
  notes text NOT NULL DEFAULT '',
  research_status text NOT NULL DEFAULT 'candidate'
    CHECK (research_status IN ('candidate', 'approved', 'rejected')),
  export_status text NOT NULL DEFAULT 'not_requested'
    CHECK (export_status IN ('not_requested', 'queued', 'processing', 'complete', 'failed')),
  created_by uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, idempotency_key),
  CHECK (export_start_ms <= transcript_start_ms),
  CHECK (export_end_ms >= transcript_end_ms)
);

CREATE TABLE clip_tags (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  normalized_name text NOT NULL CHECK (length(normalized_name) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_name)
);

CREATE TABLE clip_candidate_tags (
  clip_id uuid NOT NULL REFERENCES clip_candidates(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES clip_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (clip_id, tag_id)
);

CREATE INDEX clip_candidates_project_created
  ON clip_candidates(project_id, created_at DESC, id);
CREATE INDEX clip_candidate_tags_tag
  ON clip_candidate_tags(tag_id, clip_id);
