-- Cache and runtime evidence only. No cloud grant secret is stored locally and
-- no model is installed or enabled by a migration.

CREATE TABLE local_language_service_provider_catalog (
  provider_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('translation', 'transcription')),
  descriptor_json TEXT NOT NULL,
  catalog_revision TEXT NOT NULL CHECK (length(trim(catalog_revision)) BETWEEN 1 AND 160),
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, service)
);

CREATE TABLE local_cloud_provider_access_cache (
  provider_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('translation', 'transcription')),
  account_scope_sha256 TEXT NOT NULL CHECK (account_scope_sha256 GLOB '[0-9a-f]*' AND length(account_scope_sha256) = 64),
  access_request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested', 'approved', 'denied', 'withdrawn', 'revoked')),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, service, account_scope_sha256)
);

CREATE TABLE local_model_catalog_releases (
  release_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
  catalog_sha256 TEXT NOT NULL CHECK (catalog_sha256 GLOB '[0-9a-f]*' AND length(catalog_sha256) = 64),
  signing_key_id TEXT NOT NULL CHECK (length(trim(signing_key_id)) BETWEEN 1 AND 160),
  signature_base64 TEXT NOT NULL CHECK (length(trim(signature_base64)) BETWEEN 1 AND 16384),
  descriptor_json TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE local_model_installations (
  local_model_version_id TEXT PRIMARY KEY,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  runtime_family TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL CHECK (artifact_sha256 GLOB '[0-9a-f]*' AND length(artifact_sha256) = 64),
  artifact_byte_size INTEGER NOT NULL CHECK (artifact_byte_size > 0),
  install_state TEXT NOT NULL CHECK (install_state IN ('downloading', 'active', 'deletion_pending', 'deleted', 'failed')),
  installed_at TEXT,
  verified_at TEXT,
  deletion_requested_at TEXT,
  deleted_at TEXT,
  CHECK ((install_state = 'active') = (installed_at IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK ((install_state = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE TABLE local_model_leases (
  local_model_version_id TEXT NOT NULL REFERENCES local_model_installations(local_model_version_id) ON DELETE CASCADE,
  lease_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (local_model_version_id, lease_id),
  CHECK (expires_at > acquired_at)
);
CREATE INDEX local_model_leases_expiry ON local_model_leases(expires_at);

-- Local lifecycle commands are durable across agent restarts. They carry only
-- opaque model-version IDs and never a cloud grant or credential.
CREATE TABLE local_model_runtime_operations (
  id TEXT PRIMARY KEY,
  local_model_version_id TEXT NOT NULL REFERENCES local_model_installations(local_model_version_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('download', 'verify', 'activate', 'delete')),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 512),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  sanitized_failure_code TEXT,
  lease_id TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  CHECK ((lease_id IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((state <> 'running') OR (started_at IS NOT NULL AND heartbeat_at IS NOT NULL AND lease_id IS NOT NULL)),
  CHECK ((state NOT IN ('succeeded', 'failed', 'canceled')) OR finished_at IS NOT NULL),
  CHECK ((state = 'failed') = (sanitized_failure_code IS NOT NULL)),
  UNIQUE (local_model_version_id, kind, idempotency_key)
);
CREATE INDEX local_model_runtime_operations_active
  ON local_model_runtime_operations(state, created_at);
