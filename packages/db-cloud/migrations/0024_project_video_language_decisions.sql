-- PUNCH-001A keeps provider claims and authorized language resolutions
-- append-only.  Existing project videos deliberately remain unverified until
-- a new preflight/worker observation records bounded evidence.
CREATE TABLE project_video_language_evidence (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN (
    'creator_metadata', 'caption', 'speech_detection', 'manual_transcript'
  )),
  provider text NOT NULL CHECK (
    length(btrim(provider)) > 0 AND length(provider) <= 160
  ),
  reported_language text,
  track_fingerprint text CHECK (
    track_fingerprint IS NULL OR track_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  caption_kind text CHECK (
    caption_kind IS NULL OR caption_kind IN ('manual', 'automatic')
  ),
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  attempt integer CHECK (attempt IS NULL OR attempt > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_video_language_evidence_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_video_language_evidence_worker_pair_check CHECK (
    (job_id IS NULL) = (attempt IS NULL)
  ),
  CONSTRAINT project_video_language_evidence_caption_source_check CHECK (
    (source = 'caption') = (caption_kind IS NOT NULL)
  ),
  UNIQUE (id, project_id, video_id)
);

CREATE TABLE project_video_language_decisions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  decision_version integer NOT NULL CHECK (decision_version > 0),
  status text NOT NULL CHECK (status IN (
    'unverified', 'confirmed', 'conflict', 'unknown', 'mixed'
  )),
  basis text NOT NULL CHECK (basis IN (
    'provider_metadata', 'creator_metadata', 'user_confirmation',
    'speech_detection', 'manual_transcript'
  )),
  resolved_language text,
  evidence_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_video_language_decisions_project_video_fk
    FOREIGN KEY (project_id, video_id)
    REFERENCES project_videos(project_id, video_id) ON DELETE CASCADE,
  CONSTRAINT project_video_language_decisions_evidence_fk
    FOREIGN KEY (evidence_id, project_id, video_id)
    REFERENCES project_video_language_evidence(id, project_id, video_id),
  CONSTRAINT project_video_language_decisions_confirmed_language_check CHECK (
    status <> 'confirmed' OR resolved_language IS NOT NULL
  ),
  UNIQUE (id, video_id),
  UNIQUE (id, project_id, video_id),
  UNIQUE (project_id, video_id, decision_version),
  UNIQUE (project_id, video_id, actor_id, idempotency_key)
);

ALTER TABLE project_videos
  ADD COLUMN current_language_evidence_id uuid,
  ADD COLUMN current_language_decision_id uuid,
  ADD COLUMN language_gate_status text NOT NULL DEFAULT 'unverified'
    CHECK (language_gate_status IN (
      'unverified', 'confirmed', 'conflict', 'unknown', 'mixed'
    ));

ALTER TABLE project_videos
  ADD CONSTRAINT project_videos_current_language_evidence_fk
    FOREIGN KEY (current_language_evidence_id, project_id, video_id)
    REFERENCES project_video_language_evidence(id, project_id, video_id),
  ADD CONSTRAINT project_videos_current_language_decision_fk
    FOREIGN KEY (current_language_decision_id, project_id, video_id)
    REFERENCES project_video_language_decisions(id, project_id, video_id);

ALTER TABLE transcription_batch_items
  ADD COLUMN language_gate jsonb,
  ADD COLUMN language_decision_id uuid,
  ADD COLUMN language_decision_video_id uuid,
  ADD CONSTRAINT transcription_batch_items_language_decision_fk
    FOREIGN KEY (language_decision_id, language_decision_video_id)
    REFERENCES project_video_language_decisions(id, video_id),
  ADD CONSTRAINT transcription_batch_items_language_decision_pair_check CHECK (
    (language_decision_id IS NULL) = (language_decision_video_id IS NULL)
    AND (
      language_decision_video_id IS NULL
      OR language_decision_video_id = catalog_video_id
    )
  );

ALTER TABLE transcription_batch_items
  DROP CONSTRAINT transcription_batch_items_state_check,
  ADD CONSTRAINT transcription_batch_items_state_check CHECK (state IN (
    'draft', 'preflight', 'queued', 'resolving', 'acquiring', 'transcribing',
    'translating', 'aligning', 'uploading', 'ready_for_review', 'blocked',
    'needs_language_confirmation', 'failed', 'canceled'
  ));

CREATE INDEX project_video_language_evidence_project_video_created
  ON project_video_language_evidence(project_id, video_id, created_at DESC, id DESC);
CREATE INDEX project_video_language_decisions_project_video_version
  ON project_video_language_decisions(project_id, video_id, decision_version DESC);
CREATE INDEX transcription_batch_items_language_gate
  ON transcription_batch_items(batch_id, state, language_decision_id)
  WHERE language_gate IS NOT NULL;
