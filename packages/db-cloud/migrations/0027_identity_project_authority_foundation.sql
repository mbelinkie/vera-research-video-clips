ALTER TABLE users
  ADD COLUMN handle text,
  ADD COLUMN normalized_handle text;

UPDATE users
SET handle = 'user_' || left(replace(id::text, '-', ''), 20),
    normalized_handle = 'user_' || left(replace(id::text, '-', ''), 20)
WHERE handle IS NULL OR normalized_handle IS NULL;

ALTER TABLE users
  ALTER COLUMN handle SET NOT NULL,
  ALTER COLUMN normalized_handle SET NOT NULL,
  ADD CONSTRAINT users_handle_shape
    CHECK (handle ~ '^[a-z][a-z0-9_]{2,31}$'),
  ADD CONSTRAINT users_normalized_handle_shape
    CHECK (normalized_handle ~ '^[a-z][a-z0-9_]{2,31}$');

CREATE UNIQUE INDEX users_normalized_handle_once
  ON users(normalized_handle);

ALTER TABLE projects
  ADD COLUMN kind text NOT NULL DEFAULT 'shared'
    CHECK (kind IN ('personal', 'shared')),
  ADD COLUMN visibility text NOT NULL DEFAULT 'invitation_only'
    CHECK (visibility IN ('private', 'invitation_only', 'open_to_join')),
  ADD CONSTRAINT projects_kind_visibility
    CHECK (
      (kind = 'personal' AND visibility = 'private') OR
      (kind = 'shared' AND visibility IN ('invitation_only', 'open_to_join'))
    );

UPDATE project_members
SET role = 'researcher', version = version + 1, updated_at = now()
WHERE role = 'editor';

-- Project creation has always made created_by the Owner, but the historical
-- uniqueness index included user_id and therefore did not actually prevent a
-- second Owner. Restore that invariant deterministically before replacing the
-- index: the project creator is retained/restored as Owner and any extra
-- historical Owner rows become ordinary Researchers.
INSERT INTO project_members AS member
  (project_id, user_id, role, version, created_at, updated_at)
SELECT id, created_by, 'owner', 1, created_at, now()
FROM projects
ON CONFLICT (project_id, user_id) DO UPDATE
SET role = 'owner',
    version = CASE
      WHEN member.role = 'owner' THEN member.version
      ELSE member.version + 1
    END,
    updated_at = CASE
      WHEN member.role = 'owner' THEN member.updated_at
      ELSE now()
    END;

UPDATE project_members AS member
SET role = 'researcher', version = member.version + 1, updated_at = now()
FROM projects
WHERE member.project_id = projects.id
  AND member.role = 'owner'
  AND member.user_id <> projects.created_by;

ALTER TABLE project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;

ALTER TABLE project_members
  ADD CONSTRAINT project_members_role_check
    CHECK (role IN ('owner', 'administrator', 'researcher', 'viewer'));

DROP INDEX IF EXISTS project_owner_once;

CREATE UNIQUE INDEX project_owner_once
  ON project_members(project_id)
  WHERE role = 'owner';
