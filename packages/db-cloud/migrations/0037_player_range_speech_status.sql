ALTER TABLE clip_candidates
ADD COLUMN selection_kind text NOT NULL DEFAULT 'transcript_range'
CHECK (selection_kind IN ('transcript_range', 'player_time_range'));

ALTER TABLE clip_candidates
ADD COLUMN speech_status text
CHECK (speech_status IN ('speech', 'no_speech', 'transcript_unavailable'));

ALTER TABLE clip_candidates ADD COLUMN selection_snapshot jsonb;

UPDATE clip_candidates
SET selection_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'selectionType', 'transcript_range',
  'trackId', transcript_track_id,
  'transcriptVersion', transcript_version,
  'firstSegmentId', first_segment_id,
  'lastSegmentId', last_segment_id,
  'firstTokenId', first_token_id,
  'lastTokenId', last_token_id,
  'transcriptStartMs', transcript_start_ms,
  'transcriptEndMs', transcript_end_ms,
  'exportStartMs', export_start_ms,
  'exportEndMs', export_end_ms,
  'text', coalesce(selection_text, english_text),
  'timingPrecision', timing_precision
));

ALTER TABLE clip_candidates ALTER COLUMN selection_snapshot SET NOT NULL;

ALTER TABLE clip_candidates
ADD COLUMN no_speech_attested_by uuid REFERENCES users(id),
ADD COLUMN no_speech_attested_handle text,
ADD COLUMN no_speech_attested_display_name text,
ADD COLUMN no_speech_attested_at timestamptz,
ADD COLUMN no_speech_attestation_version integer;

ALTER TABLE clip_candidates
ALTER COLUMN transcript_track_id DROP NOT NULL,
ALTER COLUMN transcript_version DROP NOT NULL,
ALTER COLUMN first_segment_id DROP NOT NULL,
ALTER COLUMN last_segment_id DROP NOT NULL,
ALTER COLUMN transcript_start_ms DROP NOT NULL,
ALTER COLUMN transcript_end_ms DROP NOT NULL,
ALTER COLUMN timing_precision DROP NOT NULL,
ALTER COLUMN english_text DROP NOT NULL;

ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_check;
ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_check2;
ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_check3;
ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_english_text_check;
ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_timing_precision_check;
ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_transcript_start_ms_check;
ALTER TABLE clip_candidates DROP CONSTRAINT clip_candidates_transcript_version_check;
ALTER TABLE clip_candidates
DROP CONSTRAINT clip_candidates_language_evidence_schema_version_check;

ALTER TABLE clip_candidates
ADD CONSTRAINT clip_candidates_language_evidence_schema_version_check
CHECK (language_evidence_schema_version IN (1, 2, 3));

ALTER TABLE clip_candidates
ADD CONSTRAINT clip_candidates_selection_shape_check CHECK (
  (
    selection_kind = 'transcript_range'
    AND speech_status IS NULL
    AND transcript_track_id IS NOT NULL
    AND transcript_version > 0
    AND first_segment_id IS NOT NULL
    AND last_segment_id IS NOT NULL
    AND transcript_start_ms >= 0
    AND transcript_end_ms > transcript_start_ms
    AND export_start_ms <= transcript_start_ms
    AND export_end_ms >= transcript_end_ms
    AND timing_precision IN ('word', 'cue', 'estimated')
    AND english_text IS NOT NULL
    AND length(btrim(english_text)) > 0
    AND language_evidence_schema_version IN (1, 2)
    AND no_speech_attested_by IS NULL
    AND no_speech_attested_handle IS NULL
    AND no_speech_attested_display_name IS NULL
    AND no_speech_attested_at IS NULL
    AND no_speech_attestation_version IS NULL
  ) OR (
    selection_kind = 'player_time_range'
    AND speech_status IS NOT NULL
    AND transcript_track_id IS NULL
    AND transcript_version IS NULL
    AND first_segment_id IS NULL
    AND last_segment_id IS NULL
    AND first_token_id IS NULL
    AND last_token_id IS NULL
    AND transcript_start_ms IS NULL
    AND transcript_end_ms IS NULL
    AND timing_precision IS NULL
    AND (
      (language_evidence_schema_version = 2
       AND english_text IS NOT NULL
       AND length(btrim(english_text)) > 0)
      OR
      (language_evidence_schema_version = 3 AND english_text IS NULL)
    )
    AND (
      (
        speech_status = 'no_speech'
        AND no_speech_attested_by IS NOT NULL
        AND length(btrim(no_speech_attested_handle)) > 0
        AND length(btrim(no_speech_attested_display_name)) > 0
        AND no_speech_attested_at IS NOT NULL
        AND no_speech_attestation_version = 1
      ) OR (
        speech_status <> 'no_speech'
        AND no_speech_attested_by IS NULL
        AND no_speech_attested_handle IS NULL
        AND no_speech_attested_display_name IS NULL
        AND no_speech_attested_at IS NULL
        AND no_speech_attestation_version IS NULL
      )
    )
  )
);

ALTER TABLE clip_candidates
ALTER COLUMN selection_kind DROP DEFAULT;
