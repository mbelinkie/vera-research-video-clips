-- A capture is the server-side receipt for one browser action.  The request
-- UUID is scoped to the actor and project by the catalog code; keeping the
-- receipt separate from its optional assets lets a page/audio capture be
-- replayed even when no screenshot or Library item exists.
CREATE TABLE extension_captures (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  capture_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('quote','page','audio')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  source_id uuid NOT NULL,
  item_id uuid,
  page_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, capture_id),
  FOREIGN KEY (project_id, source_id)
    REFERENCES library_sources(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, item_id)
    REFERENCES library_items(project_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'quote') = (item_id IS NOT NULL)),
  CHECK ((kind <> 'quote') = (item_id IS NULL))
);

CREATE INDEX extension_captures_project_created
  ON extension_captures(project_id, created_at DESC, capture_id);

-- Each object is addressed by a project/capture/role/checksum key and is
-- pinned to the exact object-store version captured below.  JSON geometry is
-- deliberately duplicated in normalized and PNG-pixel coordinates so a later
-- Timeline adapter can consume lossless raster evidence without guessing a
-- device-pixel ratio.
CREATE TABLE extension_capture_assets (
  project_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('top','passage')),
  source_id uuid NOT NULL,
  item_id uuid,
  revision_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  object_key text NOT NULL,
  object_version_id text NOT NULL CHECK (object_version_id <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  normalized_rectangles jsonb NOT NULL DEFAULT '[]'::jsonb,
  pixel_rectangles jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, capture_id, role),
  UNIQUE (project_id, object_key, object_version_id),
  FOREIGN KEY (project_id, capture_id)
    REFERENCES extension_captures(project_id, capture_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, source_id)
    REFERENCES library_sources(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, item_id)
    REFERENCES library_items(project_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(normalized_rectangles) = 'array'),
  CHECK (jsonb_typeof(pixel_rectangles) = 'array')
);

CREATE INDEX extension_capture_assets_project_source
  ON extension_capture_assets(project_id, source_id, capture_id);
