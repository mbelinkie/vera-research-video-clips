CREATE TABLE export_presets (
  id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('personal', 'project')),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  normalized_name text NOT NULL CHECK (length(normalized_name) > 0),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_user_id),
  UNIQUE (id, project_id),
  CHECK (
    (scope = 'personal' AND owner_user_id IS NOT NULL AND project_id IS NULL)
    OR
    (scope = 'project' AND owner_user_id IS NULL AND project_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX export_presets_personal_name
  ON export_presets(owner_user_id, normalized_name)
  WHERE scope = 'personal';
CREATE UNIQUE INDEX export_presets_project_name
  ON export_presets(project_id, normalized_name)
  WHERE scope = 'project';

CREATE TABLE export_preset_versions (
  preset_id uuid NOT NULL REFERENCES export_presets(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  settings_snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preset_id, version)
);

CREATE FUNCTION reject_export_preset_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'export preset versions are immutable';
END;
$$;

CREATE TRIGGER export_preset_versions_immutable
BEFORE UPDATE ON export_preset_versions
FOR EACH ROW EXECUTE FUNCTION reject_export_preset_version_update();

CREATE TABLE personal_export_preset_defaults (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preset_id uuid NOT NULL,
  preset_version integer NOT NULL CHECK (preset_version > 0),
  entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (preset_id, user_id)
    REFERENCES export_presets(id, owner_user_id),
  FOREIGN KEY (preset_id, preset_version)
    REFERENCES export_preset_versions(preset_id, version)
);

CREATE TABLE project_export_preset_defaults (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  preset_id uuid NOT NULL,
  preset_version integer NOT NULL CHECK (preset_version > 0),
  entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (preset_id, project_id)
    REFERENCES export_presets(id, project_id),
  FOREIGN KEY (preset_id, preset_version)
    REFERENCES export_preset_versions(preset_id, version)
);

CREATE TABLE export_preset_command_receipts (
  scope text NOT NULL CHECK (scope IN ('personal', 'project')),
  scope_owner_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  command_kind text NOT NULL CHECK (command_kind IN ('create', 'revise', 'set_default')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  request_sha256 text NOT NULL CHECK (length(request_sha256) = 64),
  response_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_owner_id, actor_user_id, command_kind, idempotency_key)
);

CREATE INDEX export_preset_versions_created
  ON export_preset_versions(preset_id, version DESC);
