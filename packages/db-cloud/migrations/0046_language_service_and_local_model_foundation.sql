-- Empty foundation only: no provider is enabled, no account is approved, and
-- no model is made available by this migration.

CREATE TABLE language_service_providers (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9.-]{1,158}[a-z0-9]$'),
  service text NOT NULL CHECK (service IN ('translation', 'transcription')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  adapter_contract_version integer NOT NULL CHECK (adapter_contract_version > 0),
  configuration_revision text NOT NULL CHECK (length(btrim(configuration_revision)) BETWEEN 1 AND 160),
  capability_revision text NOT NULL CHECK (length(btrim(capability_revision)) BETWEEN 1 AND 160),
  supported_languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_modes jsonb NOT NULL DEFAULT '[]'::jsonb,
  disclosure jsonb NOT NULL,
  pricing jsonb NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'enabled', 'draining', 'disabled', 'suspended')),
  recommended boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, service)
);

CREATE UNIQUE INDEX language_service_provider_one_recommended_per_service
  ON language_service_providers(service) WHERE recommended AND state = 'enabled';

CREATE TABLE language_service_provider_server_configurations (
  provider_id text PRIMARY KEY REFERENCES language_service_providers(id) ON DELETE CASCADE,
  region text,
  protected_credential_reference text NOT NULL CHECK (protected_credential_reference ~ '^(credential|keychain|kms|secret|vault):[A-Za-z0-9._:/-]+$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE language_service_provider_configuration_audits (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL REFERENCES language_service_providers(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  prior_version integer NOT NULL CHECK (prior_version >= 0),
  next_version integer NOT NULL CHECK (next_version > prior_version),
  changed_fields jsonb NOT NULL CHECK (
    jsonb_typeof(changed_fields) = 'array'
    AND jsonb_array_length(changed_fields) > 0
    AND changed_fields <@ '["region", "protected_credential_reference", "pricing", "disclosure"]'::jsonb
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  changed_at timestamptz NOT NULL
);

CREATE TABLE cloud_provider_access_requests (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  service text NOT NULL CHECK (service IN ('translation', 'transcription')),
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disclosure_version integer NOT NULL CHECK (disclosure_version > 0),
  consent_accepted_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('requested', 'approved', 'denied', 'withdrawn', 'revoked')),
  decision_by uuid REFERENCES users(id),
  decision_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider_id, service) REFERENCES language_service_providers(id, service),
  CHECK (
    (state IN ('approved', 'denied', 'revoked') AND decision_by IS NOT NULL AND decision_at IS NOT NULL) OR
    (state IN ('requested', 'withdrawn') AND decision_by IS NULL AND decision_at IS NULL)
  )
);

CREATE INDEX cloud_provider_access_requests_account_state
  ON cloud_provider_access_requests(account_id, state, updated_at DESC);
CREATE INDEX cloud_provider_access_requests_provider_state
  ON cloud_provider_access_requests(provider_id, state, updated_at DESC);
CREATE UNIQUE INDEX cloud_provider_access_requests_one_active_per_service
  ON cloud_provider_access_requests(account_id, provider_id, service)
  WHERE state IN ('requested', 'approved');

-- Every language-service mutation uses this actor-scoped immutable receipt.
-- Commands are intentionally generic so a later provider does not need a new
-- ledger table merely to obtain exact idempotent replay.
CREATE TABLE language_service_command_receipts (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  command_type text NOT NULL CHECK (length(btrim(command_type)) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  request_sha256 text NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 !~ '[^0-9a-f]'),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, command_type, idempotency_key)
);

CREATE TABLE cloud_provider_launch_grants (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  service text NOT NULL CHECK (service IN ('translation', 'transcription')),
  access_request_id uuid NOT NULL REFERENCES cloud_provider_access_requests(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_reference_sha256 text NOT NULL CHECK (length(grant_reference_sha256) = 64 AND grant_reference_sha256 !~ '[^0-9a-f]'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (provider_id, service) REFERENCES language_service_providers(id, service),
  CHECK (expires_at > issued_at)
);
CREATE INDEX cloud_provider_launch_grants_active
  ON cloud_provider_launch_grants(account_id, provider_id, service, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE cloud_provider_operations (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  service text NOT NULL CHECK (service IN ('translation', 'transcription')),
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id uuid REFERENCES cloud_provider_launch_grants(id) ON DELETE SET NULL,
  policy_snapshot jsonb NOT NULL,
  configuration_revision text NOT NULL CHECK (length(btrim(configuration_revision)) BETWEEN 1 AND 160),
  capability_revision text NOT NULL CHECK (length(btrim(capability_revision)) BETWEEN 1 AND 160),
  input_mode text NOT NULL CHECK (input_mode IN ('text_segments', 'object_uri', 'direct_upload', 'byte_stream', 'source_url')),
  state text NOT NULL CHECK (state IN ('staging', 'submitted', 'running', 'succeeded', 'failed', 'canceled')),
  cleanup_state text NOT NULL DEFAULT 'not_required' CHECK (cleanup_state IN ('not_required', 'pending', 'completed', 'failed')),
  cleanup_completed_at timestamptz,
  cleanup_failure_code text CHECK (cleanup_failure_code IS NULL OR length(btrim(cleanup_failure_code)) BETWEEN 1 AND 160),
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider_id, service) REFERENCES language_service_providers(id, service),
  CHECK ((cleanup_state = 'completed') = (cleanup_completed_at IS NOT NULL)),
  CHECK ((cleanup_state = 'failed') = (cleanup_failure_code IS NOT NULL)),
  CHECK ((state IN ('succeeded', 'failed', 'canceled')) = (terminal_at IS NOT NULL))
);

CREATE TABLE cloud_provider_operation_attempts (
  operation_id uuid NOT NULL REFERENCES cloud_provider_operations(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  external_operation_reference text,
  state text NOT NULL CHECK (state IN ('staging', 'submitted', 'running', 'succeeded', 'failed', 'canceled')),
  progress_percent integer CHECK (progress_percent BETWEEN 0 AND 100),
  sanitized_failure_code text CHECK (sanitized_failure_code IS NULL OR length(btrim(sanitized_failure_code)) BETWEEN 1 AND 160),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (operation_id, attempt)
);

CREATE TABLE cloud_provider_usage (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  service text NOT NULL CHECK (service IN ('translation', 'transcription')),
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid REFERENCES cloud_provider_operations(id) ON DELETE SET NULL,
  pricing_snapshot jsonb NOT NULL,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  estimated_cost_micros bigint NOT NULL CHECK (estimated_cost_micros >= 0),
  recorded_at timestamptz NOT NULL
  ,FOREIGN KEY (provider_id, service) REFERENCES language_service_providers(id, service)
);
CREATE INDEX cloud_provider_usage_account_recorded
  ON cloud_provider_usage(account_id, recorded_at DESC);

CREATE TABLE local_model_sources (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9.-]{1,158}[a-z0-9]$'),
  adapter text NOT NULL CHECK (adapter = 'argos-package-index'),
  source_url text NOT NULL CHECK (length(btrim(source_url)) BETWEEN 1 AND 2048),
  state text NOT NULL DEFAULT 'disabled' CHECK (state IN ('enabled', 'disabled')),
  refresh_interval_hours integer NOT NULL CHECK (refresh_interval_hours BETWEEN 1 AND 744),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE local_model_feed_snapshots (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES local_model_sources(id) ON DELETE CASCADE,
  source_url text NOT NULL CHECK (length(btrim(source_url)) BETWEEN 1 AND 2048),
  feed_sha256 text NOT NULL CHECK (length(feed_sha256) = 64 AND feed_sha256 !~ '[^0-9a-f]'),
  raw_feed_artifact_id text NOT NULL CHECK (length(btrim(raw_feed_artifact_id)) BETWEEN 1 AND 512),
  raw_feed_byte_size bigint NOT NULL CHECK (raw_feed_byte_size > 0),
  fetched_at timestamptz NOT NULL,
  additions integer NOT NULL CHECK (additions >= 0),
  changes integer NOT NULL CHECK (changes >= 0),
  removals integer NOT NULL CHECK (removals >= 0),
  UNIQUE (source_id, feed_sha256)
);

CREATE TABLE local_model_candidates (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES local_model_sources(id),
  feed_snapshot_id uuid NOT NULL REFERENCES local_model_feed_snapshots(id),
  source_language text NOT NULL,
  target_language text NOT NULL,
  package_version text NOT NULL CHECK (length(btrim(package_version)) BETWEEN 1 AND 160),
  runtime_family text NOT NULL CHECK (length(btrim(runtime_family)) BETWEEN 1 AND 160),
  runtime_version text NOT NULL CHECK (length(btrim(runtime_version)) BETWEEN 1 AND 160),
  artifact_url text NOT NULL CHECK (length(btrim(artifact_url)) BETWEEN 1 AND 2048),
  raw_entry jsonb NOT NULL,
  raw_entry_sha256 text NOT NULL CHECK (length(raw_entry_sha256) = 64 AND raw_entry_sha256 !~ '[^0-9a-f]'),
  raw_entry_artifact_id text NOT NULL CHECK (length(btrim(raw_entry_artifact_id)) BETWEEN 1 AND 512),
  state text NOT NULL DEFAULT 'discovered' CHECK (state IN ('discovered', 'evaluating', 'evaluated', 'rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  discovered_at timestamptz NOT NULL,
  UNIQUE (feed_snapshot_id, source_language, target_language, package_version, runtime_family)
);

CREATE TABLE local_model_evaluations (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES local_model_candidates(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  evaluation_schema_version integer NOT NULL CHECK (evaluation_schema_version = 1),
  evaluated_by uuid NOT NULL REFERENCES users(id),
  raw_evidence_artifact_ids jsonb NOT NULL CHECK (jsonb_typeof(raw_evidence_artifact_ids) = 'array' AND jsonb_array_length(raw_evidence_artifact_ids) > 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  artifact_sha256 text NOT NULL CHECK (length(artifact_sha256) = 64 AND artifact_sha256 !~ '[^0-9a-f]'),
  archive_format text NOT NULL CHECK (length(btrim(archive_format)) BETWEEN 1 AND 80),
  archive_manifest jsonb NOT NULL,
  tokenizer_format text,
  model_format text,
  license_evidence jsonb NOT NULL CHECK (jsonb_typeof(license_evidence) = 'array' AND jsonb_array_length(license_evidence) > 0),
  attribution_evidence jsonb NOT NULL CHECK (jsonb_typeof(attribution_evidence) = 'array' AND jsonb_array_length(attribution_evidence) > 0),
  training_provenance_evidence jsonb NOT NULL CHECK (jsonb_typeof(training_provenance_evidence) = 'array' AND jsonb_array_length(training_provenance_evidence) > 0),
  quality_results jsonb NOT NULL CHECK (jsonb_typeof(quality_results) = 'object' AND quality_results <> '{}'::jsonb),
  compatible_runtime_versions jsonb NOT NULL,
  compatible_platforms jsonb NOT NULL,
  findings jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  UNIQUE (candidate_id, revision),
  UNIQUE (candidate_id, artifact_sha256)
);

CREATE TABLE local_model_versions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES local_model_candidates(id),
  evaluation_id uuid NOT NULL REFERENCES local_model_evaluations(id),
  source_language text NOT NULL,
  target_language text NOT NULL,
  runtime_family text NOT NULL CHECK (length(btrim(runtime_family)) BETWEEN 1 AND 160),
  artifact_sha256 text NOT NULL CHECK (length(artifact_sha256) = 64 AND artifact_sha256 !~ '[^0-9a-f]'),
  artifact_byte_size bigint NOT NULL CHECK (artifact_byte_size > 0),
  mirrored_artifact_id text NOT NULL CHECK (length(btrim(mirrored_artifact_id)) BETWEEN 1 AND 512),
  availability_state text NOT NULL DEFAULT 'disabled' CHECK (availability_state IN ('enabled', 'enabled_by_override', 'disabled', 'revoked')),
  availability_version integer NOT NULL DEFAULT 1 CHECK (availability_version > 0),
  availability_changed_at timestamptz NOT NULL DEFAULT now(),
  availability_changed_by uuid REFERENCES users(id),
  override_reason text,
  CHECK (
    (availability_state = 'enabled_by_override' AND availability_changed_by IS NOT NULL AND length(btrim(override_reason)) BETWEEN 1 AND 1000) OR
    (availability_state <> 'enabled_by_override' AND availability_changed_by IS NULL AND override_reason IS NULL)
  ),
  UNIQUE (evaluation_id),
  UNIQUE (runtime_family, artifact_sha256)
);
CREATE UNIQUE INDEX local_model_versions_one_active_pair
  ON local_model_versions(source_language, target_language, runtime_family)
  WHERE availability_state IN ('enabled', 'enabled_by_override');

CREATE TABLE local_model_availability_audits (
  id uuid PRIMARY KEY,
  local_model_version_id uuid NOT NULL REFERENCES local_model_versions(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  prior_version integer NOT NULL CHECK (prior_version >= 0),
  next_version integer NOT NULL CHECK (next_version > prior_version),
  state text NOT NULL CHECK (state IN ('enabled', 'enabled_by_override', 'disabled', 'revoked')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  changed_at timestamptz NOT NULL
);

CREATE TABLE signed_local_model_catalog_releases (
  id uuid PRIMARY KEY,
  sequence integer NOT NULL UNIQUE CHECK (sequence > 0),
  catalog_sha256 text NOT NULL CHECK (length(catalog_sha256) = 64 AND catalog_sha256 !~ '[^0-9a-f]'),
  signing_key_id text NOT NULL CHECK (length(btrim(signing_key_id)) BETWEEN 1 AND 160),
  signature_base64 text NOT NULL CHECK (length(btrim(signature_base64)) BETWEEN 1 AND 16384),
  published_at timestamptz NOT NULL,
  UNIQUE (catalog_sha256)
);

CREATE TABLE local_model_operations (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('refresh_source', 'evaluate_candidate', 'mirror_artifact', 'publish_catalog_release')),
  source_id text REFERENCES local_model_sources(id),
  candidate_id uuid REFERENCES local_model_candidates(id),
  catalog_release_id uuid REFERENCES signed_local_model_catalog_releases(id),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  sanitized_failure_code text CHECK (sanitized_failure_code IS NULL OR length(btrim(sanitized_failure_code)) BETWEEN 1 AND 160),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  CHECK (
    (kind = 'refresh_source' AND source_id IS NOT NULL AND candidate_id IS NULL AND catalog_release_id IS NULL) OR
    (kind IN ('evaluate_candidate', 'mirror_artifact') AND source_id IS NULL AND candidate_id IS NOT NULL AND catalog_release_id IS NULL) OR
    (kind = 'publish_catalog_release' AND source_id IS NULL AND candidate_id IS NULL AND catalog_release_id IS NOT NULL)
  ),
  CHECK ((state = 'failed') = (sanitized_failure_code IS NOT NULL)),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((state <> 'running') OR (started_at IS NOT NULL AND heartbeat_at IS NOT NULL AND lease_owner IS NOT NULL)),
  CHECK ((state NOT IN ('succeeded', 'failed', 'canceled')) OR finished_at IS NOT NULL),
  UNIQUE (created_by, idempotency_key)
);
CREATE INDEX local_model_operations_active ON local_model_operations(state, created_at);

CREATE TABLE signed_local_model_catalog_release_versions (
  release_id uuid NOT NULL REFERENCES signed_local_model_catalog_releases(id) ON DELETE CASCADE,
  local_model_version_id uuid NOT NULL REFERENCES local_model_versions(id),
  PRIMARY KEY (release_id, local_model_version_id)
);

-- Explicit revocations mean verified deletion. Omission or disabled state means
-- a client may retain a verified pack for rollback or offline use.
CREATE TABLE signed_local_model_catalog_release_revocations (
  release_id uuid NOT NULL REFERENCES signed_local_model_catalog_releases(id) ON DELETE CASCADE,
  local_model_version_id uuid NOT NULL REFERENCES local_model_versions(id),
  PRIMARY KEY (release_id, local_model_version_id)
);
