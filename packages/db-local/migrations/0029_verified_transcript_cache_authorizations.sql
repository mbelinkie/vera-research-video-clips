CREATE TABLE verified_transcript_cache_authorizations (
  project_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  transcript_version_id TEXT NOT NULL,
  authorization_scope_sha256 TEXT NOT NULL CHECK (
    length(authorization_scope_sha256) = 64 AND
    authorization_scope_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  authorized_at TEXT NOT NULL,
  PRIMARY KEY (
    project_id,
    video_id,
    transcript_version_id,
    authorization_scope_sha256
  ),
  FOREIGN KEY (project_id, video_id, transcript_version_id)
    REFERENCES verified_transcript_cache(
      project_id, video_id, transcript_version_id
    ) ON DELETE CASCADE
);

CREATE INDEX verified_transcript_cache_authorizations_lookup
  ON verified_transcript_cache_authorizations(
    project_id,
    video_id,
    authorization_scope_sha256,
    authorized_at DESC
  );
