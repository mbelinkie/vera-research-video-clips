CREATE TABLE logged_export_deliveries (
  id uuid PRIMARY KEY,
  export_request_id uuid NOT NULL UNIQUE REFERENCES export_requests(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  reservation_token uuid NOT NULL UNIQUE,
  worker_id uuid NOT NULL REFERENCES registered_export_workers(id) ON DELETE RESTRICT,
  worker_epoch integer NOT NULL CHECK (worker_epoch > 0),
  reserved_at timestamptz NOT NULL,
  reservation_expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (reservation_expires_at > reserved_at),
  CHECK (
    accepted_at IS NULL OR
    (accepted_at >= reserved_at AND accepted_at < reservation_expires_at)
  )
);

CREATE INDEX logged_export_deliveries_worker_replay
  ON logged_export_deliveries(worker_id, worker_epoch, accepted_at, reservation_expires_at);
CREATE INDEX logged_export_deliveries_claimability
  ON logged_export_deliveries(export_request_id, accepted_at, reservation_expires_at);
