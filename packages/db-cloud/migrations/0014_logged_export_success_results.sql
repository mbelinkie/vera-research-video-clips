ALTER TABLE logged_export_deliveries
  ADD CONSTRAINT logged_export_delivery_request_identity
  UNIQUE (id, export_request_id);

CREATE TABLE logged_export_success_results (
  id uuid PRIMARY KEY,
  export_request_id uuid NOT NULL UNIQUE,
  delivery_id uuid NOT NULL UNIQUE,
  delivery_generation integer NOT NULL CHECK (delivery_generation > 0),
  worker_id uuid NOT NULL REFERENCES registered_export_workers(id) ON DELETE RESTRICT,
  worker_epoch integer NOT NULL CHECK (worker_epoch > 0),
  result_schema_version integer NOT NULL CHECK (result_schema_version = 1),
  result_json jsonb NOT NULL,
  result_fingerprint text NOT NULL CHECK (result_fingerprint ~ '^[a-f0-9]{64}$'),
  reconciled_at timestamptz NOT NULL,
  FOREIGN KEY (delivery_id, export_request_id)
    REFERENCES logged_export_deliveries(id, export_request_id)
    ON DELETE CASCADE,
  CHECK (jsonb_typeof(result_json) = 'object'),
  CHECK ((result_json->>'schemaVersion')::integer = result_schema_version),
  CHECK (result_json->>'requestId' = export_request_id::text)
);

CREATE INDEX logged_export_success_results_delivery_worker
  ON logged_export_success_results(delivery_id, delivery_generation, worker_id, worker_epoch);

CREATE FUNCTION reject_logged_export_success_result_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'logged export success results are immutable';
END;
$$;

CREATE TRIGGER logged_export_success_results_immutable
BEFORE UPDATE ON logged_export_success_results
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_success_result_update();
