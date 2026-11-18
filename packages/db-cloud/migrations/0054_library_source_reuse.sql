-- Canonical reuse may give one source many successful create requests.
-- The original create receipt stays on library_sources for compatibility.
CREATE TABLE library_source_reuse_receipts (
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  create_fingerprint text NOT NULL,
  source_id uuid NOT NULL,
  PRIMARY KEY (project_id, actor_id, idempotency_key),
  FOREIGN KEY (project_id, source_id) REFERENCES library_sources(project_id, id) ON DELETE CASCADE
);
