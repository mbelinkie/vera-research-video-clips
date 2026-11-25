-- Expand-first source identity migration. Legacy YouTube columns remain for
-- rollback and immutable historical descriptor compatibility.
ALTER TABLE videos ADD COLUMN source_provider text;
ALTER TABLE videos ADD COLUMN provider_media_id text;
ALTER TABLE videos ADD COLUMN source_fingerprint_evidence jsonb;

UPDATE videos
SET source_provider = 'youtube',
    provider_media_id = youtube_video_id
WHERE source_provider IS NULL OR provider_media_id IS NULL;

ALTER TABLE videos ALTER COLUMN source_provider SET NOT NULL;
ALTER TABLE videos ALTER COLUMN provider_media_id SET NOT NULL;
ALTER TABLE videos ADD CONSTRAINT videos_source_provider_check
  CHECK (source_provider IN ('youtube', 'tiktok', 'instagram', 'facebook'));
ALTER TABLE videos ADD CONSTRAINT videos_source_identity_unique
  UNIQUE (source_provider, provider_media_id);

-- The legacy YouTube constraint remains during the expand/dual-read phase so
-- historical ON CONFLICT writers and rollback continue to behave identically.
-- A later platform-qualification migration may relax it only after all writes
-- use the composite provider identity.

ALTER TABLE transcription_batch_items ADD COLUMN source_provider text;
ALTER TABLE transcription_batch_items ADD COLUMN provider_media_id text;
UPDATE transcription_batch_items
SET source_provider = 'youtube',
    provider_media_id = youtube_video_id
WHERE youtube_video_id IS NOT NULL;
ALTER TABLE transcription_batch_items ADD CONSTRAINT transcription_batch_items_source_provider_check
  CHECK (source_provider IS NULL OR source_provider IN ('youtube', 'tiktok', 'instagram', 'facebook'));
CREATE INDEX transcription_batch_items_source_identity
  ON transcription_batch_items(source_provider, provider_media_id);

ALTER TABLE clip_candidates ADD COLUMN source_provider text;
ALTER TABLE clip_candidates ADD COLUMN provider_media_id text;
UPDATE clip_candidates
SET source_provider = 'youtube',
    provider_media_id = youtube_video_id;
ALTER TABLE clip_candidates ALTER COLUMN source_provider SET NOT NULL;
ALTER TABLE clip_candidates ALTER COLUMN provider_media_id SET NOT NULL;
ALTER TABLE clip_candidates ADD CONSTRAINT clip_candidates_source_provider_check
  CHECK (source_provider IN ('youtube', 'tiktok', 'instagram', 'facebook'));
CREATE INDEX clip_candidates_source_identity
  ON clip_candidates(source_provider, provider_media_id);
