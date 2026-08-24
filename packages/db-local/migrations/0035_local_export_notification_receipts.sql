ALTER TABLE export_requests ADD COLUMN notification_account_scope_sha256 TEXT
  CHECK (
    notification_account_scope_sha256 IS NULL OR
    notification_account_scope_sha256 GLOB '[0-9a-f]*' AND
    length(notification_account_scope_sha256) = 64
  );

CREATE TABLE local_export_notification_receipts (
  id TEXT PRIMARY KEY,
  export_request_id TEXT NOT NULL REFERENCES export_requests(id) ON DELETE CASCADE,
  account_scope_sha256 TEXT NOT NULL CHECK (
    account_scope_sha256 GLOB '[0-9a-f]*' AND
    length(account_scope_sha256) = 64
  ),
  source_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'action_needed')),
  source_label TEXT NOT NULL CHECK (length(trim(source_label)) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL,
  UNIQUE (account_scope_sha256, source_key)
);

CREATE INDEX local_export_notification_receipts_feed
  ON local_export_notification_receipts(
    account_scope_sha256, created_at DESC, id DESC
  );
