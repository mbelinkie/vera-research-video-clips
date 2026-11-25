CREATE TABLE project_video_flags (
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  PRIMARY KEY (project_id, video_id, user_id),
  CONSTRAINT project_video_flags_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_video_flags_active_timestamp_check CHECK (
    (active AND deactivated_at IS NULL)
    OR (NOT active AND deactivated_at IS NOT NULL)
  )
);

CREATE INDEX project_video_flags_active_project
  ON project_video_flags(project_id, updated_at DESC, video_id, user_id)
  WHERE active;

-- Historical project-video rows predate per-user flags. Preserve each row and
-- establish one deterministic active flag for the project creator, who is
-- restored as the protected Owner by migration 0027.
INSERT INTO project_video_flags
  (project_id, video_id, user_id, active, version, created_at, updated_at)
SELECT pv.project_id, pv.video_id, p.created_by, true, 1,
       pv.created_at, pv.updated_at
FROM project_videos pv
JOIN projects p ON p.id = pv.project_id
ON CONFLICT (project_id, video_id, user_id) DO NOTHING;
