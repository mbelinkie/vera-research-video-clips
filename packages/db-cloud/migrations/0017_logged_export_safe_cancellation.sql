ALTER TABLE clip_candidates
  DROP CONSTRAINT clip_candidates_export_status_check;

ALTER TABLE clip_candidates
  ADD CONSTRAINT clip_candidates_export_status_check
  CHECK (export_status IN ('not_requested', 'queued', 'processing', 'complete', 'failed', 'canceled'));

CREATE TABLE logged_export_cancel_intents (
  export_request_id uuid PRIMARY KEY REFERENCES export_requests(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  requested_at timestamptz NOT NULL,
  UNIQUE (project_id, idempotency_key)
);

CREATE TABLE logged_export_executions (
  id uuid PRIMARY KEY,
  export_request_id uuid NOT NULL UNIQUE REFERENCES export_requests(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL UNIQUE REFERENCES logged_export_deliveries(id) ON DELETE RESTRICT,
  delivery_generation integer NOT NULL CHECK (delivery_generation > 0),
  worker_id uuid NOT NULL REFERENCES registered_export_workers(id) ON DELETE RESTRICT,
  worker_epoch integer NOT NULL CHECK (worker_epoch > 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  lease_token uuid NOT NULL UNIQUE,
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > heartbeat_at),
  UNIQUE (export_request_id, attempt)
);

CREATE INDEX logged_export_executions_lease
  ON logged_export_executions(worker_id, worker_epoch, expires_at);

CREATE TABLE logged_export_canceled_results (
  id uuid PRIMARY KEY,
  export_request_id uuid NOT NULL UNIQUE REFERENCES export_requests(id) ON DELETE RESTRICT,
  delivery_id uuid UNIQUE REFERENCES logged_export_deliveries(id) ON DELETE RESTRICT,
  delivery_generation integer CHECK (delivery_generation IS NULL OR delivery_generation > 0),
  worker_id uuid REFERENCES registered_export_workers(id) ON DELETE RESTRICT,
  worker_epoch integer CHECK (worker_epoch IS NULL OR worker_epoch > 0),
  execution_id uuid UNIQUE REFERENCES logged_export_executions(id) ON DELETE RESTRICT,
  result_schema_version integer NOT NULL CHECK (result_schema_version = 1),
  result_json jsonb NOT NULL,
  result_fingerprint text NOT NULL CHECK (result_fingerprint ~ '^[a-f0-9]{64}$'),
  reconciled_at timestamptz NOT NULL,
  CHECK (
    (delivery_id IS NULL AND delivery_generation IS NULL AND worker_id IS NULL AND worker_epoch IS NULL AND execution_id IS NULL)
    OR
    (delivery_id IS NOT NULL AND delivery_generation IS NOT NULL AND worker_id IS NOT NULL AND worker_epoch IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION reject_logged_export_success_if_failure_exists()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM logged_export_failure_results
    WHERE export_request_id = NEW.export_request_id OR delivery_id = NEW.delivery_id
  ) OR EXISTS (
    SELECT 1 FROM logged_export_canceled_results
    WHERE export_request_id = NEW.export_request_id OR delivery_id = NEW.delivery_id
  ) THEN
    RAISE EXCEPTION 'terminal export evidence is mutually exclusive';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_logged_export_failure_if_success_exists()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM logged_export_success_results
    WHERE export_request_id = NEW.export_request_id OR delivery_id = NEW.delivery_id
  ) OR EXISTS (
    SELECT 1 FROM logged_export_canceled_results
    WHERE export_request_id = NEW.export_request_id OR delivery_id = NEW.delivery_id
  ) THEN
    RAISE EXCEPTION 'terminal export evidence is mutually exclusive';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_logged_export_cancel_if_terminal_exists()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM logged_export_success_results
    WHERE export_request_id = NEW.export_request_id
       OR (NEW.delivery_id IS NOT NULL AND delivery_id = NEW.delivery_id)
  ) OR EXISTS (
    SELECT 1 FROM logged_export_failure_results
    WHERE export_request_id = NEW.export_request_id
       OR (NEW.delivery_id IS NOT NULL AND delivery_id = NEW.delivery_id)
  ) THEN
    RAISE EXCEPTION 'terminal export evidence is mutually exclusive';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logged_export_cancel_reject_terminal
BEFORE INSERT ON logged_export_canceled_results
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_cancel_if_terminal_exists();

CREATE FUNCTION reject_logged_export_canceled_result_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'logged export canceled results are immutable';
END;
$$;

CREATE TRIGGER logged_export_canceled_results_immutable
BEFORE UPDATE ON logged_export_canceled_results
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_canceled_result_update();

CREATE FUNCTION reject_logged_export_cancel_intent_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'logged export cancel intent is immutable';
END;
$$;

CREATE TRIGGER logged_export_cancel_intents_immutable
BEFORE UPDATE ON logged_export_cancel_intents
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_cancel_intent_update();

CREATE FUNCTION restrict_logged_export_execution_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR
     NEW.export_request_id <> OLD.export_request_id OR
     NEW.delivery_id <> OLD.delivery_id OR
     NEW.delivery_generation <> OLD.delivery_generation OR
     NEW.worker_id <> OLD.worker_id OR
     NEW.worker_epoch <> OLD.worker_epoch OR
     NEW.attempt <> OLD.attempt OR
     NEW.lease_token <> OLD.lease_token OR
     NEW.started_at <> OLD.started_at OR
     NEW.heartbeat_at < OLD.heartbeat_at OR
     NEW.expires_at < OLD.expires_at OR
     NEW.expires_at <= NEW.heartbeat_at THEN
    RAISE EXCEPTION 'logged export execution identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logged_export_executions_restrict_update
BEFORE UPDATE ON logged_export_executions
FOR EACH ROW EXECUTE FUNCTION restrict_logged_export_execution_update();
