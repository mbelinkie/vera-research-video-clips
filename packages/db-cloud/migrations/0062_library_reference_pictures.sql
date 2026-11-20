-- Reference pictures are private attachments to an existing offline source or
-- quote, never independent Library stills or extension capture provenance.
-- The owner discriminator is backed by real project-scoped foreign keys.
CREATE TABLE library_reference_pictures (
  project_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('source','quote')),
  owner_id uuid NOT NULL,
  source_id uuid,
  item_id uuid,
  role text NOT NULL CHECK (role IN ('original','display','thumbnail')),
  revision_id uuid NOT NULL,
  object_key text NOT NULL,
  object_version_id text NOT NULL CHECK (object_version_id <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, owner_kind, owner_id, role),
  CHECK (
    (owner_kind='source' AND source_id IS NOT NULL AND source_id=owner_id AND item_id IS NULL) OR
    (owner_kind='quote' AND item_id IS NOT NULL AND item_id=owner_id AND source_id IS NULL)
  ),
  FOREIGN KEY (project_id,source_id) REFERENCES library_sources(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY (project_id,item_id) REFERENCES library_items(project_id,id) ON DELETE CASCADE
);
CREATE INDEX library_reference_pictures_source ON library_reference_pictures(project_id,source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX library_reference_pictures_item ON library_reference_pictures(project_id,item_id)
  WHERE item_id IS NOT NULL;
