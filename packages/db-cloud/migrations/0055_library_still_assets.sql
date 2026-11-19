CREATE TABLE library_still_assets (
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('original', 'display', 'thumbnail')),
  object_key text NOT NULL,
  object_version_id text NOT NULL CHECK (object_version_id <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  provenance jsonb,
  CHECK ((role = 'original') = (provenance IS NOT NULL)),
  PRIMARY KEY (project_id, item_id, role),
  FOREIGN KEY (project_id, item_id) REFERENCES library_items(project_id,id) ON DELETE CASCADE
);
