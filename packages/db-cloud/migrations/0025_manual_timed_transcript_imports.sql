-- PUNCH-001B stores browser-staged timed-text imports separately from worker
-- uploads. A finalized import publishes an immutable candidate, never an
-- active project-video pointer.
CREATE TABLE manual_timed_transcript_imports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  language_decision_id uuid NOT NULL,
  language_decision_version integer NOT NULL CHECK (language_decision_version > 0),
  project_video_version integer NOT NULL CHECK (project_video_version > 0),
  video_duration_ms bigint NOT NULL CHECK (video_duration_ms > 0),
  video_updated_at timestamptz NOT NULL,
  batch_item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  batch_item_version integer NOT NULL,
  original_format text NOT NULL CHECK (original_format IN ('srt', 'vtt')),
  english_format text NOT NULL CHECK (english_format IN ('srt', 'vtt')),
  original_byte_size bigint NOT NULL CHECK (original_byte_size > 0 AND original_byte_size <= 20971520),
  english_byte_size bigint NOT NULL CHECK (english_byte_size > 0 AND english_byte_size <= 20971520),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[a-f0-9]{64}$'),
  english_sha256 text NOT NULL CHECK (english_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('staged', 'finalizing', 'finalized', 'expired')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  finalize_idempotency_key text CHECK (
    finalize_idempotency_key IS NULL
    OR (length(btrim(finalize_idempotency_key)) > 0 AND length(finalize_idempotency_key) <= 512)
  ),
  finalize_request_sha256 text CHECK (
    finalize_request_sha256 IS NULL OR finalize_request_sha256 ~ '^[a-f0-9]{64}$'
  ),
  original_object_version_id text,
  english_object_version_id text,
  finalization_token uuid,
  finalization_started_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT manual_timed_import_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT manual_timed_import_decision_fk
    FOREIGN KEY (language_decision_id, project_id, video_id)
    REFERENCES project_video_language_decisions(id, project_id, video_id),
  CONSTRAINT manual_timed_import_batch_snapshot_check CHECK (
    batch_item_version > 0
  ),
  CONSTRAINT manual_timed_import_finalize_pair_check CHECK (
    (finalize_idempotency_key IS NULL) = (finalize_request_sha256 IS NULL)
  ),
  CONSTRAINT manual_timed_import_finalization_claim_check CHECK (
    (state = 'finalizing') = (
      finalization_token IS NOT NULL AND finalization_started_at IS NOT NULL
    )
  ),
  CONSTRAINT manual_timed_import_finalized_at_check CHECK (
    (state = 'finalized') = (finalized_at IS NOT NULL)
  ),
  UNIQUE (project_id, video_id, created_by, idempotency_key)
);

ALTER TABLE transcription_batches
  ADD CONSTRAINT transcription_batches_id_project_unique UNIQUE (id, project_id);

ALTER TABLE transcription_batch_items
  ADD CONSTRAINT transcription_batch_items_id_batch_video_unique
  UNIQUE (id, batch_id, catalog_video_id);

ALTER TABLE manual_timed_transcript_imports
  ADD CONSTRAINT manual_timed_import_batch_item_fk
  FOREIGN KEY (batch_item_id, batch_id, video_id)
  REFERENCES transcription_batch_items(id, batch_id, catalog_video_id)
  ON DELETE RESTRICT;

ALTER TABLE manual_timed_transcript_imports
  ADD CONSTRAINT manual_timed_import_batch_project_fk
  FOREIGN KEY (batch_id, project_id)
  REFERENCES transcription_batches(id, project_id)
  ON DELETE RESTRICT;

CREATE TABLE manual_timed_transcript_import_targets (
  import_id uuid NOT NULL REFERENCES manual_timed_transcript_imports(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('original', 'english')),
  object_key text NOT NULL,
  PRIMARY KEY (import_id, role),
  UNIQUE (import_id, object_key)
);

CREATE TABLE manual_timed_transcript_candidates (
  id uuid PRIMARY KEY,
  import_id uuid NOT NULL UNIQUE REFERENCES manual_timed_transcript_imports(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  transcript_version_id uuid NOT NULL UNIQUE REFERENCES transcript_versions(id) ON DELETE RESTRICT,
  language_decision_id uuid NOT NULL,
  language_decision_version integer NOT NULL CHECK (language_decision_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_timed_candidate_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT manual_timed_candidate_decision_fk
    FOREIGN KEY (language_decision_id, project_id, video_id)
    REFERENCES project_video_language_decisions(id, project_id, video_id)
);

ALTER TABLE transcription_batch_items
  ADD COLUMN manual_timed_transcript_candidate_id uuid
    REFERENCES manual_timed_transcript_candidates(id);

CREATE INDEX manual_timed_import_project_video_created
  ON manual_timed_transcript_imports(project_id, video_id, created_at DESC, id DESC);
CREATE INDEX manual_timed_candidate_project_video_created
  ON manual_timed_transcript_candidates(project_id, video_id, created_at DESC, id DESC);
CREATE INDEX transcription_batch_items_manual_timed_candidate
  ON transcription_batch_items(manual_timed_transcript_candidate_id)
  WHERE manual_timed_transcript_candidate_id IS NOT NULL;
