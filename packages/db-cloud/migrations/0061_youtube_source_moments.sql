ALTER TABLE library_sources
  ADD COLUMN youtube_reason text CHECK (length(youtube_reason) BETWEEN 1 AND 200),
  ADD COLUMN youtube_reason_updated_by uuid REFERENCES users(id),
  ADD COLUMN youtube_reason_updated_at timestamptz,
  ADD CHECK ((youtube_reason_updated_by IS NULL) = (youtube_reason_updated_at IS NULL)),
  ADD CHECK (youtube_reason IS NULL OR youtube_reason_updated_by IS NOT NULL),
  ADD CHECK (kind = 'youtube' OR youtube_reason_updated_by IS NULL);

-- Keep the point attached directly to the project source, independently of
-- the transcription batch and of any Library item.
CREATE TABLE youtube_source_moments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  timecode_ms bigint NOT NULL CHECK (timecode_ms BETWEEN 0 AND 9007199254740991),
  note text CHECK (length(note) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (project_id, source_id)
    REFERENCES library_sources(project_id, id) ON DELETE CASCADE
);
CREATE INDEX youtube_source_moments_by_source
  ON youtube_source_moments(project_id, source_id, timecode_ms, id);

ALTER TABLE chrome_video_submissions
  ADD COLUMN source_details_fingerprint text
    CHECK (source_details_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD CHECK (source_details_fingerprint IS NULL OR (comment IS NULL AND timecode_ms IS NULL));

CREATE OR REPLACE FUNCTION library_unlink_unused_video() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM library_sources WHERE project_id=OLD.project_id AND id=OLD.video_id FOR UPDATE;
  DELETE FROM library_sources s WHERE s.project_id=OLD.project_id AND s.id=OLD.video_id
    AND s.legacy_video_id=OLD.video_id AND s.bibliography IS NULL AND s.details IS NULL
    AND s.youtube_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM youtube_source_moments m WHERE m.project_id=s.project_id AND m.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM library_items i WHERE i.project_id=s.project_id AND i.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM clip_candidates c WHERE c.project_id=s.project_id AND c.video_id=s.id);
  RETURN OLD;
END $$;
