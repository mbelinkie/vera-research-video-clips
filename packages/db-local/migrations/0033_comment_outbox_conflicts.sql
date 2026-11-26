ALTER TABLE sync_outbox ADD COLUMN conflict_json TEXT;
ALTER TABLE sync_outbox ADD COLUMN last_error_code TEXT;

CREATE INDEX idx_outbox_project_command
  ON sync_outbox(project_id, command_type, created_at);
