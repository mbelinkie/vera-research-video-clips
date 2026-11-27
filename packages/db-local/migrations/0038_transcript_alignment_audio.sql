ALTER TABLE transcript_tracks
  ADD COLUMN alignment_audio_json TEXT
  CHECK (alignment_audio_json IS NULL OR
    (alignment_artifact_id IS NOT NULL AND json_valid(alignment_audio_json)));
