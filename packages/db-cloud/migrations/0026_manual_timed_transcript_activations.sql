-- PUNCH-001C records every explicit corrected-candidate activation as
-- immutable command/audit evidence. Exact command replay can be answered
-- without moving the active pointer or emitting another event.
ALTER TABLE manual_timed_transcript_candidates
  ADD CONSTRAINT manual_timed_candidate_activation_identity_unique
  UNIQUE (id, project_id, video_id, transcript_version_id, import_id);

ALTER TABLE project_video_language_decisions
  ADD CONSTRAINT project_video_language_decision_activation_identity_unique
  UNIQUE (id, project_id, video_id, decision_version);

CREATE TABLE manual_timed_transcript_activations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  import_id uuid NOT NULL,
  candidate_id uuid NOT NULL UNIQUE,
  transcript_version_id uuid NOT NULL,
  language_decision_id uuid NOT NULL,
  language_decision_version integer NOT NULL CHECK (language_decision_version > 0),
  expected_project_video_version integer NOT NULL CHECK (expected_project_video_version > 0),
  resulting_project_video_version integer NOT NULL CHECK (
    resulting_project_video_version = expected_project_video_version + 1
  ),
  previous_transcript_version_id uuid REFERENCES transcript_versions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  activated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_timed_activation_candidate_fk
    FOREIGN KEY (
      candidate_id, project_id, video_id, transcript_version_id, import_id
    ) REFERENCES manual_timed_transcript_candidates (
      id, project_id, video_id, transcript_version_id, import_id
    ) ON DELETE RESTRICT,
  CONSTRAINT manual_timed_activation_decision_fk
    FOREIGN KEY (
      language_decision_id, project_id, video_id, language_decision_version
    ) REFERENCES project_video_language_decisions (
      id, project_id, video_id, decision_version
    ) ON DELETE RESTRICT,
  UNIQUE (project_id, video_id, actor_id, idempotency_key)
);

CREATE INDEX manual_timed_activation_project_video_created
  ON manual_timed_transcript_activations(
    project_id, video_id, activated_at DESC, id DESC
  );

CREATE FUNCTION reject_manual_timed_activation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'manual timed transcript activations are immutable history';
END;
$$;

CREATE TRIGGER manual_timed_transcript_activations_immutable
BEFORE UPDATE OR DELETE ON manual_timed_transcript_activations
FOR EACH ROW EXECUTE FUNCTION reject_manual_timed_activation_mutation();
