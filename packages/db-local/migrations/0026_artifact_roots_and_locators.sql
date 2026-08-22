CREATE TABLE artifact_roots (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  platform TEXT NOT NULL CHECK (platform IN ('posix', 'windows')),
  absolute_path TEXT NOT NULL CHECK (length(absolute_path) BETWEEN 1 AND 4096),
  path_fingerprint TEXT NOT NULL CHECK (length(path_fingerprint) = 64),
  filesystem_identity TEXT NOT NULL
    CHECK (length(filesystem_identity) BETWEEN 3 AND 200),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  path_policy_version INTEGER NOT NULL DEFAULT 1
    CHECK (path_policy_version = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, path_fingerprint)
);

CREATE TRIGGER artifact_roots_identity_immutable
BEFORE UPDATE OF id, platform, absolute_path, path_fingerprint,
  filesystem_identity, path_policy_version ON artifact_roots
BEGIN
  SELECT RAISE(ABORT, 'artifact root identity is immutable');
END;

CREATE TABLE export_artifact_locators (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  artifact_version_id TEXT NOT NULL CHECK (length(artifact_version_id) = 36),
  root_id TEXT NOT NULL REFERENCES artifact_roots(id) ON DELETE RESTRICT,
  relative_package_path TEXT NOT NULL CHECK (
    length(relative_package_path) = 41 AND
    relative_package_path = 'clip-' || request_id
  ),
  platform TEXT NOT NULL CHECK (platform IN ('posix', 'windows')),
  project_id TEXT NOT NULL CHECK (length(project_id) = 36),
  clip_id TEXT NOT NULL CHECK (length(clip_id) = 36),
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  package_identity TEXT NOT NULL CHECK (
    package_identity = relative_package_path
  ),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  manifest_schema_version INTEGER NOT NULL
    CHECK (manifest_schema_version IN (1, 2)),
  result_fingerprint TEXT NOT NULL CHECK (length(result_fingerprint) = 64),
  verification_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (verification_schema_version = 1),
  availability TEXT NOT NULL CHECK (
    availability IN ('verified', 'missing', 'invalid')
  ),
  failure_class TEXT CHECK (failure_class IS NULL OR failure_class IN (
    'root_unavailable', 'root_changed', 'package_missing', 'unsafe_path',
    'unsupported_schema', 'manifest_invalid', 'identity_mismatch',
    'snapshot_mismatch', 'artifact_mismatch', 'filesystem_untrusted',
    'io_error'
  )),
  checked_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    substr(request_id, 9, 1) = '-' AND
    substr(request_id, 14, 1) = '-' AND
    substr(request_id, 19, 1) = '-' AND
    substr(request_id, 24, 1) = '-' AND
    length(replace(request_id, '-', '')) = 32 AND
    replace(request_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    (availability = 'verified' AND failure_class IS NULL) OR
    (availability <> 'verified' AND failure_class IS NOT NULL)
  ),
  UNIQUE (root_id, artifact_version_id),
  UNIQUE (root_id, relative_package_path)
);

CREATE INDEX export_artifact_locators_version
  ON export_artifact_locators(artifact_version_id, availability, checked_at DESC);

CREATE TRIGGER export_artifact_locators_root_platform_valid
BEFORE INSERT ON export_artifact_locators
WHEN NOT EXISTS (
  SELECT 1 FROM artifact_roots root
  WHERE root.id = NEW.root_id AND root.platform = NEW.platform
)
BEGIN
  SELECT RAISE(ABORT, 'artifact locator root platform is inconsistent');
END;

CREATE TRIGGER export_artifact_locators_identity_immutable
BEFORE UPDATE OF id, artifact_version_id, root_id, relative_package_path,
  platform, project_id, clip_id, request_id, package_identity,
  manifest_sha256, manifest_schema_version, result_fingerprint,
  verification_schema_version ON export_artifact_locators
BEGIN
  SELECT RAISE(ABORT, 'artifact locator identity is immutable');
END;
