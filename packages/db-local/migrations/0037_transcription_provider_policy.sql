-- Compatibility-only local snapshot: prior batches remain local Whisper work.
ALTER TABLE transcription_batches
  ADD COLUMN transcription_execution_policy_json TEXT NOT NULL DEFAULT
    '{"schemaVersion":1,"execution":"local","fallback":"local"}';
