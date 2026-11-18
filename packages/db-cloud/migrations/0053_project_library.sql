-- A linked source keeps the project's original video UUID. Its bibliography
-- inherits the video evidence until a project writer supplies a correction.
CREATE TABLE library_sources (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('youtube','provider_video','web_page','pdf','offline','image','audio','local_video')),
  legacy_video_id uuid CHECK (legacy_video_id = id),
  source_identity jsonb,
  bibliography jsonb,
  details jsonb,
  create_actor_id uuid,
  create_idempotency_key text,
  create_fingerprint text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, create_actor_id, create_idempotency_key),
  FOREIGN KEY (project_id, legacy_video_id) REFERENCES project_videos(project_id, video_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX library_sources_linked_video ON library_sources(legacy_video_id) WHERE legacy_video_id IS NOT NULL;
CREATE UNIQUE INDEX library_source_provider_identity
  ON library_sources(project_id, (source_identity->>'provider'), (source_identity->>'providerMediaId'))
  WHERE source_identity IS NOT NULL;

CREATE FUNCTION library_link_project_video() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO library_sources(project_id, id, kind, legacy_video_id)
  SELECT NEW.project_id, v.id,
    CASE WHEN COALESCE(to_jsonb(v)->>'source_provider', 'youtube') = 'youtube'
      THEN 'youtube' ELSE 'provider_video' END, v.id
  FROM videos v WHERE v.id = NEW.video_id
  ON CONFLICT (project_id, id) DO UPDATE SET legacy_video_id = excluded.legacy_video_id, version=library_sources.version+1
    WHERE library_sources.legacy_video_id IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER library_link_project_video AFTER INSERT ON project_videos
  FOR EACH ROW EXECUTE FUNCTION library_link_project_video();

INSERT INTO library_sources(project_id, id, kind, legacy_video_id)
SELECT pv.project_id, v.id,
  CASE WHEN COALESCE(to_jsonb(v)->>'source_provider', 'youtube') = 'youtube'
    THEN 'youtube' ELSE 'provider_video' END, v.id
FROM project_videos pv JOIN videos v ON v.id = pv.video_id;

-- Historical clip rows only referenced the global video, not the project
-- membership. Recover an unlinked source from this project's own last logged
-- snapshot without granting access to another project's video or transcripts.
INSERT INTO library_sources(project_id,id,kind,source_identity,bibliography,details)
SELECT DISTINCT ON (c.project_id,c.video_id) c.project_id,c.video_id,
  CASE WHEN COALESCE(to_jsonb(c)->>'source_provider','youtube')='youtube' THEN 'youtube' ELSE 'provider_video' END,
  CASE WHEN c.canonical_url <> '' THEN jsonb_build_object('schemaVersion',1,'provider',
    COALESCE(to_jsonb(c)->>'source_provider','youtube'), 'providerMediaId',
    COALESCE(to_jsonb(c)->>'provider_media_id',c.youtube_video_id),'canonicalUrl',c.canonical_url) END,
  jsonb_strip_nulls(jsonb_build_object(
    'title', CASE WHEN NULLIF(btrim(c.video_title),'') IS NOT NULL THEN jsonb_build_object('value',c.video_title) END,
    'url', CASE WHEN c.canonical_url <> '' THEN jsonb_build_object('value',c.canonical_url) END)),
  jsonb_strip_nulls(jsonb_build_object('channel',c.video_channel,'sourceLanguage',c.source_language))
FROM clip_candidates c WHERE NOT EXISTS (
  SELECT 1 FROM library_sources s WHERE s.project_id=c.project_id AND s.id=c.video_id
) ORDER BY c.project_id,c.video_id,c.created_at DESC,c.id;

CREATE VIEW project_library_sources AS
SELECT s.project_id, s.id, s.kind, s.version,
  COALESCE(s.source_identity, CASE WHEN NULLIF(v.canonical_url, '') IS NOT NULL THEN
    jsonb_build_object('schemaVersion', 1, 'provider', COALESCE(to_jsonb(v)->>'source_provider','youtube'),
      'providerMediaId', COALESCE(to_jsonb(v)->>'provider_media_id', v.youtube_video_id), 'canonicalUrl', v.canonical_url)
  END) AS source_identity,
  COALESCE(to_jsonb(v)->>'provider_media_id', v.youtube_video_id) AS provider_media_id,
  jsonb_strip_nulls(jsonb_build_object(
    'title', CASE WHEN NULLIF(btrim(v.title),'') IS NOT NULL THEN jsonb_build_object('value',v.title) END,
    'url', CASE WHEN NULLIF(v.canonical_url,'') IS NOT NULL THEN jsonb_build_object('value',v.canonical_url) END
  ) || COALESCE(s.bibliography, '{}'::jsonb)) AS bibliography,
  jsonb_strip_nulls(jsonb_build_object(
    'channel', v.channel, 'durationMs', v.duration_ms, 'sourceLanguage', v.source_language
  ) || COALESCE(s.details, '{}'::jsonb)) AS details
FROM library_sources s LEFT JOIN videos v ON v.id = s.legacy_video_id;

-- Main's legacy video registry and the provider-aware pilot both allocate
-- the catalog UUID here. Only the public locator is shared between projects.
CREATE FUNCTION library_youtube_id(candidate uuid, media_id text, url text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='videos'::regclass
             AND attname='source_provider' AND NOT attisdropped) THEN
    INSERT INTO videos(id,youtube_video_id,canonical_url,source_provider,provider_media_id)
    VALUES(candidate,media_id,url,'youtube',media_id)
    ON CONFLICT (youtube_video_id) DO UPDATE SET youtube_video_id=excluded.youtube_video_id
      WHERE videos.source_provider='youtube' AND videos.provider_media_id=media_id
    RETURNING id INTO result;
  ELSE
    INSERT INTO videos(id,youtube_video_id,canonical_url) VALUES(candidate,media_id,url)
    ON CONFLICT (youtube_video_id) DO UPDATE SET youtube_video_id=excluded.youtube_video_id
    RETURNING id INTO result;
  END IF;
  RETURN result;
END $$;

-- Inherited evidence participates in optimistic concurrency. A legacy refresh
-- cannot overwrite an editor's citation field undetected.
CREATE FUNCTION library_video_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE library_sources SET version=version+1 WHERE legacy_video_id=NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER library_video_changed AFTER UPDATE ON videos FOR EACH ROW
  WHEN ((OLD.title,OLD.channel,OLD.duration_ms,OLD.source_language,OLD.canonical_url)
     IS DISTINCT FROM (NEW.title,NEW.channel,NEW.duration_ms,NEW.source_language,NEW.canonical_url))
  EXECUTE FUNCTION library_video_changed();

CREATE TABLE library_items (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('clip','quote','still','audio')),
  content jsonb NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  create_idempotency_key text,
  create_fingerprint text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (project_id, id),
  UNIQUE (project_id, created_by, create_idempotency_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id,source_id) REFERENCES library_sources(project_id,id) ON DELETE CASCADE
);
CREATE INDEX library_items_by_source ON library_items(project_id, source_id);
CREATE INDEX library_items_by_kind ON library_items(project_id, kind, created_at DESC, id);
ALTER TABLE clip_tags ADD CONSTRAINT clip_tags_project_identity UNIQUE(project_id,id);
CREATE TABLE library_item_topics (
  project_id uuid NOT NULL,
  item_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  FOREIGN KEY(project_id,item_id) REFERENCES library_items(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,tag_id) REFERENCES clip_tags(project_id,id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX library_item_topics_tag ON library_item_topics(tag_id, item_id);

-- Both storage formats share one externally addressable item UUID namespace.
-- This also protects an import that supplies IDs instead of generating them.
CREATE FUNCTION library_check_item_id() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE id_taken boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text, 76));
  IF TG_TABLE_NAME = 'library_items' THEN
    SELECT EXISTS (SELECT 1 FROM clip_candidates WHERE id=NEW.id) INTO id_taken;
  ELSE
    SELECT EXISTS (SELECT 1 FROM library_items WHERE id=NEW.id) INTO id_taken;
  END IF;
  IF id_taken THEN
    RAISE EXCEPTION 'Item UUID already belongs to another logged item' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER library_check_item_id AFTER INSERT OR UPDATE OF id ON library_items
  FOR EACH ROW EXECUTE FUNCTION library_check_item_id();
CREATE TRIGGER library_check_clip_id AFTER INSERT OR UPDATE OF id ON clip_candidates
  FOR EACH ROW EXECUTE FUNCTION library_check_item_id();

-- Legacy unlink still succeeds for an untouched video with no logged items.
-- A retained log or correction needs an explicit Library deletion decision.
CREATE FUNCTION library_unlink_unused_video() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM library_sources WHERE project_id=OLD.project_id AND id=OLD.video_id FOR UPDATE;
  DELETE FROM library_sources s WHERE s.project_id=OLD.project_id AND s.id=OLD.video_id
    AND s.legacy_video_id=OLD.video_id AND s.bibliography IS NULL AND s.details IS NULL
    AND NOT EXISTS (SELECT 1 FROM library_items i WHERE i.project_id=s.project_id AND i.source_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM clip_candidates c WHERE c.project_id=s.project_id AND c.video_id=s.id);
  RETURN OLD;
END $$;
CREATE TRIGGER library_unlink_unused_video BEFORE DELETE ON project_videos
  FOR EACH ROW EXECUTE FUNCTION library_unlink_unused_video();

-- The clip row remains authoritative for its log, immutable selection and
-- export history. Both APIs consequently observe the same notes and Topics.
ALTER TABLE clip_candidates ADD COLUMN library_title text, ADD COLUMN library_speaker text;
CREATE VIEW project_library_items AS
SELECT id, project_id, source_id, kind, content, notes, created_by, version, created_at, updated_at, false AS legacy
FROM library_items
UNION ALL
SELECT c.id, c.project_id, c.video_id, 'clip', jsonb_strip_nulls(jsonb_build_object(
  'startMs',c.export_start_ms, 'endMs',c.export_end_ms, 'text',c.english_text,
  'originalText',c.original_text, 'title',c.library_title, 'speaker',c.library_speaker
)), c.notes, c.created_by, c.version, c.created_at, c.updated_at, true
FROM clip_candidates c;

CREATE VIEW project_library_item_topics AS
SELECT item_id, tag_id FROM library_item_topics
UNION ALL SELECT clip_id, tag_id FROM clip_candidate_tags;
