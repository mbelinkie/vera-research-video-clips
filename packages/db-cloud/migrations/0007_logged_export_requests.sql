CREATE TABLE export_requests (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL REFERENCES clip_candidates(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode = 'logged'),
  video_snapshot jsonb NOT NULL,
  selection_snapshot jsonb NOT NULL,
  source_language_class text NOT NULL
    CHECK (source_language_class IN ('confirmed_english', 'foreign', 'mixed', 'unknown')),
  preset_snapshot jsonb NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX export_requests_one_active_per_clip_key
  ON export_requests(clip_id, job_id);
CREATE INDEX export_requests_project_created
  ON export_requests(project_id, created_at DESC, id);
