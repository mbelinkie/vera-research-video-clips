ALTER TABLE export_requests ADD COLUMN local_progress_sequence INTEGER
  CHECK (local_progress_sequence IS NULL OR local_progress_sequence > 0);
ALTER TABLE export_requests ADD COLUMN local_progress_stage TEXT
  CHECK (local_progress_stage IS NULL OR local_progress_stage IN (
    'preparing', 'acquiring_source', 'inspecting_source', 'rendering',
    'validating_media', 'building_thumbnail', 'building_subtitles',
    'packaging', 'cleaning_source', 'local_complete'
  ));
ALTER TABLE export_requests ADD COLUMN local_progress_stage_rank INTEGER
  CHECK (local_progress_stage_rank IS NULL OR local_progress_stage_rank BETWEEN 1 AND 10);
ALTER TABLE export_requests ADD COLUMN local_progress_basis_points INTEGER
  CHECK (local_progress_basis_points IS NULL OR local_progress_basis_points BETWEEN 0 AND 10000);
ALTER TABLE export_requests ADD COLUMN local_progress_updated_at TEXT;

CREATE TRIGGER export_requests_local_progress_rank_insert
BEFORE INSERT ON export_requests
WHEN NEW.local_progress_stage IS NOT NULL AND NEW.local_progress_stage_rank IS NOT CASE NEW.local_progress_stage
  WHEN 'preparing' THEN 1 WHEN 'acquiring_source' THEN 2
  WHEN 'inspecting_source' THEN 3 WHEN 'rendering' THEN 4
  WHEN 'validating_media' THEN 5 WHEN 'building_thumbnail' THEN 6
  WHEN 'building_subtitles' THEN 7 WHEN 'packaging' THEN 8
  WHEN 'cleaning_source' THEN 9 WHEN 'local_complete' THEN 10 END
BEGIN
  SELECT RAISE(ABORT, 'local export progress stage rank is invalid');
END;

CREATE TRIGGER export_requests_local_progress_rank_update
BEFORE UPDATE OF local_progress_stage, local_progress_stage_rank ON export_requests
WHEN NEW.local_progress_stage IS NOT NULL AND NEW.local_progress_stage_rank IS NOT CASE NEW.local_progress_stage
  WHEN 'preparing' THEN 1 WHEN 'acquiring_source' THEN 2
  WHEN 'inspecting_source' THEN 3 WHEN 'rendering' THEN 4
  WHEN 'validating_media' THEN 5 WHEN 'building_thumbnail' THEN 6
  WHEN 'building_subtitles' THEN 7 WHEN 'packaging' THEN 8
  WHEN 'cleaning_source' THEN 9 WHEN 'local_complete' THEN 10 END
BEGIN
  SELECT RAISE(ABORT, 'local export progress stage rank is invalid');
END;

CREATE TRIGGER export_requests_local_progress_complete
BEFORE UPDATE OF local_progress_sequence, local_progress_stage,
  local_progress_stage_rank, local_progress_basis_points,
  local_progress_updated_at ON export_requests
WHEN (
  NEW.local_progress_sequence IS NULL OR NEW.local_progress_stage IS NULL OR
  NEW.local_progress_stage_rank IS NULL OR NEW.local_progress_basis_points IS NULL OR
  NEW.local_progress_updated_at IS NULL
) AND NOT (
  NEW.local_progress_sequence IS NULL AND NEW.local_progress_stage IS NULL AND
  NEW.local_progress_stage_rank IS NULL AND NEW.local_progress_basis_points IS NULL AND
  NEW.local_progress_updated_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'local export progress must be complete');
END;

CREATE TRIGGER export_requests_local_progress_monotonic
BEFORE UPDATE OF local_progress_sequence, local_progress_stage,
  local_progress_stage_rank, local_progress_basis_points,
  local_progress_updated_at ON export_requests
WHEN OLD.local_progress_sequence IS NOT NULL AND (
  NEW.local_progress_sequence < OLD.local_progress_sequence OR
  NEW.local_progress_stage_rank < OLD.local_progress_stage_rank OR
  NEW.local_progress_basis_points < OLD.local_progress_basis_points OR
  (NEW.local_progress_sequence = OLD.local_progress_sequence AND (
    NEW.local_progress_stage IS NOT OLD.local_progress_stage OR
    NEW.local_progress_stage_rank IS NOT OLD.local_progress_stage_rank OR
    NEW.local_progress_basis_points IS NOT OLD.local_progress_basis_points OR
    NEW.local_progress_updated_at IS NOT OLD.local_progress_updated_at
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'local export progress must be exact and monotonic');
END;
