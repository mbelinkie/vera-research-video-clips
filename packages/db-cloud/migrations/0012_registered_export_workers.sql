CREATE TABLE registered_export_workers (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  epoch integer NOT NULL CHECK (epoch > 0),
  capability_json jsonb NOT NULL,
  installed_capabilities_json jsonb NOT NULL,
  advertisement_fingerprint char(64) NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX registered_export_workers_available
  ON registered_export_workers(owner_user_id, expires_at)
  WHERE revoked_at IS NULL;
