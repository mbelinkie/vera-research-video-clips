ALTER TABLE export_requests ADD COLUMN request_origin TEXT
  CHECK (request_origin IS NULL OR request_origin IN (
    'selection_action', 'clip_library', 'authoring_build'
  ));

CREATE TRIGGER export_requests_request_origin_immutable
BEFORE UPDATE OF request_origin ON export_requests
WHEN NEW.request_origin IS NOT OLD.request_origin
BEGIN
  SELECT RAISE(ABORT, 'export request origin is immutable');
END;
