ALTER TABLE transcript_tracks
  ADD COLUMN alignment_artifact_id TEXT
  CHECK (alignment_artifact_id IS NULL OR length(trim(alignment_artifact_id)) > 0);

ALTER TABLE transcript_tracks
  ADD COLUMN alignment_fingerprint TEXT
  CHECK (alignment_fingerprint IS NULL OR (
    length(alignment_fingerprint) = 64 AND
    alignment_fingerprint NOT GLOB '*[^0-9a-f]*'
  ));

ALTER TABLE transcript_tracks
  ADD COLUMN alignment_source_content_sha256 TEXT
  CHECK (alignment_source_content_sha256 IS NULL OR (
    length(alignment_source_content_sha256) = 64 AND
    alignment_source_content_sha256 NOT GLOB '*[^0-9a-f]*'
  ));

ALTER TABLE transcript_tokens
  ADD COLUMN alignment_status TEXT
  CHECK (
    alignment_status IS NULL OR
    (alignment_status = 'acoustic' AND start_ms IS NOT NULL AND end_ms IS NOT NULL AND end_timing IS NULL) OR
    (alignment_status = 'unaligned' AND start_ms IS NULL AND end_ms IS NULL AND end_timing IS NULL)
  );
