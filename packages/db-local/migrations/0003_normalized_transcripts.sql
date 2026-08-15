CREATE TABLE transcript_tracks (
  transcript_version_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  catalog_video_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  language TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('original', 'english')),
  source TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  source_track_id TEXT,
  timing_precision TEXT NOT NULL CHECK (timing_precision IN ('word', 'cue', 'estimated')),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  version INTEGER NOT NULL CHECK (version > 0),
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (transcript_version_id, id)
);

CREATE TABLE transcript_segments (
  transcript_version_id TEXT NOT NULL,
  id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  PRIMARY KEY (transcript_version_id, id),
  UNIQUE (transcript_version_id, track_id, ordinal),
  FOREIGN KEY (transcript_version_id, track_id)
    REFERENCES transcript_tracks(transcript_version_id, id) ON DELETE CASCADE
);

CREATE TABLE transcript_tokens (
  transcript_version_id TEXT NOT NULL,
  id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  text TEXT NOT NULL CHECK (length(text) > 0),
  start_ms INTEGER,
  end_ms INTEGER,
  timing_confidence REAL,
  PRIMARY KEY (transcript_version_id, id),
  UNIQUE (transcript_version_id, segment_id, ordinal),
  FOREIGN KEY (transcript_version_id, segment_id)
    REFERENCES transcript_segments(transcript_version_id, id) ON DELETE CASCADE,
  CHECK (start_ms IS NULL OR start_ms >= 0),
  CHECK (end_ms IS NULL OR end_ms > 0),
  CHECK (start_ms IS NULL OR end_ms IS NULL OR end_ms > start_ms),
  CHECK (timing_confidence IS NULL OR (timing_confidence >= 0 AND timing_confidence <= 1))
);

CREATE INDEX transcript_tracks_project_video
  ON transcript_tracks(project_id, catalog_video_id, transcript_version_id, kind);
CREATE INDEX transcript_segments_time
  ON transcript_segments(transcript_version_id, track_id, start_ms, end_ms);
CREATE INDEX transcript_tokens_time
  ON transcript_tokens(transcript_version_id, segment_id, start_ms, end_ms);
