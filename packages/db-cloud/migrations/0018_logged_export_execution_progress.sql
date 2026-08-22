CREATE TABLE logged_export_execution_progress (
  execution_id uuid PRIMARY KEY REFERENCES logged_export_executions(id) ON DELETE RESTRICT,
  export_request_id uuid NOT NULL UNIQUE REFERENCES export_requests(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt > 0),
  sequence integer NOT NULL CHECK (sequence > 0),
  stage text NOT NULL CHECK (stage IN (
    'preparing', 'acquiring_source', 'inspecting_source', 'rendering',
    'validating_media', 'building_thumbnail', 'building_subtitles',
    'packaging', 'cleaning_source', 'local_complete'
  )),
  stage_rank integer NOT NULL CHECK (stage_rank BETWEEN 1 AND 10),
  basis_points integer NOT NULL CHECK (basis_points BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL,
  CHECK (stage_rank = CASE stage
    WHEN 'preparing' THEN 1
    WHEN 'acquiring_source' THEN 2
    WHEN 'inspecting_source' THEN 3
    WHEN 'rendering' THEN 4
    WHEN 'validating_media' THEN 5
    WHEN 'building_thumbnail' THEN 6
    WHEN 'building_subtitles' THEN 7
    WHEN 'packaging' THEN 8
    WHEN 'cleaning_source' THEN 9
    WHEN 'local_complete' THEN 10
  END)
);

CREATE FUNCTION restrict_logged_export_progress_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.execution_id <> OLD.execution_id OR
     NEW.export_request_id <> OLD.export_request_id OR
     NEW.attempt <> OLD.attempt OR
     NEW.sequence < OLD.sequence OR
     NEW.stage_rank < OLD.stage_rank OR
     NEW.basis_points < OLD.basis_points OR
     (NEW.sequence = OLD.sequence AND (
       NEW.stage <> OLD.stage OR
       NEW.stage_rank <> OLD.stage_rank OR
       NEW.basis_points <> OLD.basis_points OR
       NEW.updated_at <> OLD.updated_at
     )) THEN
    RAISE EXCEPTION 'logged export progress must be exact and monotonic';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logged_export_execution_progress_restrict_update
BEFORE UPDATE ON logged_export_execution_progress
FOR EACH ROW EXECUTE FUNCTION restrict_logged_export_progress_update();
