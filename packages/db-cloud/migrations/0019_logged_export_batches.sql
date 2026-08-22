CREATE TABLE logged_export_batches (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (
    length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 512
  ),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, idempotency_key)
);

CREATE TABLE logged_export_batch_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES logged_export_batches(id) ON DELETE RESTRICT,
  clip_id uuid NOT NULL REFERENCES clip_candidates(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  root_export_request_id uuid UNIQUE REFERENCES export_requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (batch_id, ordinal),
  UNIQUE (batch_id, clip_id)
);

ALTER TABLE export_requests
  ADD COLUMN batch_item_id uuid
    REFERENCES logged_export_batch_items(id) ON DELETE RESTRICT;

CREATE INDEX logged_export_batch_items_batch_ordinal
  ON logged_export_batch_items(batch_id, ordinal, id);
CREATE INDEX export_requests_batch_item
  ON export_requests(batch_item_id, retry_ordinal DESC, id)
  WHERE batch_item_id IS NOT NULL;

CREATE FUNCTION reject_logged_export_batch_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'logged export batch identity is immutable';
END;
$$;

CREATE TRIGGER logged_export_batches_immutable
BEFORE UPDATE OR DELETE ON logged_export_batches
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_batch_update();

CREATE FUNCTION restrict_logged_export_batch_item_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.batch_id <> OLD.batch_id OR
     NEW.clip_id <> OLD.clip_id OR NEW.ordinal <> OLD.ordinal OR
     NEW.created_at <> OLD.created_at OR
     OLD.root_export_request_id IS NOT NULL OR
     NEW.root_export_request_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM export_requests request
       WHERE request.id = NEW.root_export_request_id
         AND request.batch_item_id = OLD.id
         AND request.retry_of_request_id IS NULL
     ) THEN
    RAISE EXCEPTION 'logged export batch item identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logged_export_batch_items_restrict_update
BEFORE UPDATE ON logged_export_batch_items
FOR EACH ROW EXECUTE FUNCTION restrict_logged_export_batch_item_update();

CREATE TRIGGER logged_export_batch_items_no_delete
BEFORE DELETE ON logged_export_batch_items
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_batch_update();

CREATE FUNCTION validate_logged_export_batch_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.batch_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM logged_export_batch_items item
    JOIN logged_export_batches batch ON batch.id = item.batch_id
    WHERE item.id = NEW.batch_item_id
      AND item.clip_id = NEW.clip_id
      AND batch.project_id = NEW.project_id
      AND (
        NEW.retry_of_request_id IS NULL OR EXISTS (
          SELECT 1 FROM export_requests parent
          WHERE parent.id = NEW.retry_of_request_id
            AND parent.batch_item_id = NEW.batch_item_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'logged export batch request identity is inconsistent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER export_requests_batch_item_valid
BEFORE INSERT ON export_requests
FOR EACH ROW EXECUTE FUNCTION validate_logged_export_batch_request();

CREATE TRIGGER export_requests_batch_item_immutable
BEFORE UPDATE OF batch_item_id ON export_requests
FOR EACH ROW EXECUTE FUNCTION reject_logged_export_request_identity_update();
