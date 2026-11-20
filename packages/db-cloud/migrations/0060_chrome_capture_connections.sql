-- Each installation receives capture-only access. A browser session is never
-- copied to the extension. Only a digest of its random secret is retained.
CREATE TABLE chrome_capture_connections (
  id uuid PRIMARY KEY,
  key_digest text NOT NULL UNIQUE CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  extension_origin text NOT NULL CHECK (extension_origin ~ '^chrome-extension://[a-p]{32}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE chrome_video_submissions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES transcription_batches(id),
  comment text CHECK (length(comment) BETWEEN 1 AND 2000),
  timecode_ms bigint CHECK (timecode_ms BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,created_by,request_id),
  FOREIGN KEY(project_id,source_id) REFERENCES library_sources(project_id,id) ON DELETE CASCADE
);
CREATE INDEX chrome_video_comments_by_source ON chrome_video_submissions(project_id,source_id,created_at,id)
  WHERE comment IS NOT NULL OR timecode_ms IS NOT NULL;
