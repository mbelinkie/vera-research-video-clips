CREATE TABLE cloud_provider_account_preferences (
  account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service IN ('translation', 'transcription')),
  provider_id text NOT NULL,
  access_request_id uuid NOT NULL REFERENCES cloud_provider_access_requests(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, service),
  FOREIGN KEY (provider_id, service)
    REFERENCES language_service_providers(id, service)
);
