-- Keep optimistic membership revisions monotonic across revoke/re-grant.
-- Deleting a membership must not reset the version and make an old command
-- against that (project, user) pair valid again after a new grant.
CREATE TABLE IF NOT EXISTS revoked_project_member_versions (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_version integer NOT NULL CHECK (last_version > 0),
  PRIMARY KEY (project_id, user_id)
);
