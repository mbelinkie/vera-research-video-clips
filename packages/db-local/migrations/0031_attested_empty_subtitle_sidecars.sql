-- Keep zero-cue no-speech evidence separate from transcript-derived sidecars.
-- This prevents nullable or sentinel transcript IDs from weakening the existing
-- positive-cue provenance table.
CREATE TABLE export_empty_subtitle_sidecars (
  export_request_id TEXT NOT NULL REFERENCES export_requests(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('original', 'english')),
  language TEXT NOT NULL CHECK (length(language) BETWEEN 2 AND 35),
  empty_reason TEXT NOT NULL CHECK (empty_reason = 'attested_no_speech'),
  no_speech_attestation_json TEXT NOT NULL CHECK (json_valid(no_speech_attestation_json)),
  cue_count INTEGER NOT NULL CHECK (cue_count = 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  start_ms INTEGER NOT NULL CHECK (start_ms = 0),
  end_ms INTEGER NOT NULL CHECK (end_ms = 0),
  source_attempt INTEGER NOT NULL CHECK (source_attempt > 0),
  validated_at TEXT NOT NULL,
  PRIMARY KEY (export_request_id, role)
);

CREATE INDEX idx_export_empty_subtitle_sidecars_attempt
  ON export_empty_subtitle_sidecars(source_attempt, validated_at);

CREATE TRIGGER export_empty_subtitle_sidecars_attestation_insert
BEFORE INSERT ON export_empty_subtitle_sidecars
WHEN NOT EXISTS (
  SELECT 1 FROM export_requests request
  WHERE request.id = NEW.export_request_id
    AND json_extract(request.selection_snapshot_json, '$.selectionType') = 'player_time_range'
    AND json_extract(request.selection_snapshot_json, '$.speechStatus') = 'no_speech'
    AND json_extract(NEW.no_speech_attestation_json, '$.schemaVersion') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.schemaVersion')
    AND json_extract(NEW.no_speech_attestation_json, '$.actor.id') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.actor.id')
    AND json_extract(NEW.no_speech_attestation_json, '$.actor.handle') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.actor.handle')
    AND json_extract(NEW.no_speech_attestation_json, '$.actor.displayName') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.actor.displayName')
    AND json_extract(NEW.no_speech_attestation_json, '$.attestedAt') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.attestedAt')
    AND (SELECT count(*) FROM json_each(NEW.no_speech_attestation_json)) = 3
    AND (SELECT count(*) FROM json_each(NEW.no_speech_attestation_json, '$.actor')) = 3
)
BEGIN
  SELECT RAISE(ABORT, 'empty subtitle attestation must match request selection');
END;

CREATE TRIGGER export_empty_subtitle_sidecars_attestation_update
BEFORE UPDATE ON export_empty_subtitle_sidecars
WHEN NOT EXISTS (
  SELECT 1 FROM export_requests request
  WHERE request.id = NEW.export_request_id
    AND json_extract(request.selection_snapshot_json, '$.selectionType') = 'player_time_range'
    AND json_extract(request.selection_snapshot_json, '$.speechStatus') = 'no_speech'
    AND json_extract(NEW.no_speech_attestation_json, '$.schemaVersion') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.schemaVersion')
    AND json_extract(NEW.no_speech_attestation_json, '$.actor.id') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.actor.id')
    AND json_extract(NEW.no_speech_attestation_json, '$.actor.handle') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.actor.handle')
    AND json_extract(NEW.no_speech_attestation_json, '$.actor.displayName') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.actor.displayName')
    AND json_extract(NEW.no_speech_attestation_json, '$.attestedAt') =
        json_extract(request.selection_snapshot_json, '$.noSpeechAttestation.attestedAt')
    AND (SELECT count(*) FROM json_each(NEW.no_speech_attestation_json)) = 3
    AND (SELECT count(*) FROM json_each(NEW.no_speech_attestation_json, '$.actor')) = 3
)
BEGIN
  SELECT RAISE(ABORT, 'empty subtitle attestation must match request selection');
END;
