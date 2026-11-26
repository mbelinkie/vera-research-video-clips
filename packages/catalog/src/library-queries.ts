import {
  LibraryItemSchema,
  LibrarySourceSchema,
  type ItemListQuery,
  type SourceListQuery,
} from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";

import { CatalogNotFoundError } from "./catalog-errors.ts";
import { normalizeTagName } from "./topics.ts";

type LibraryQueryDatabase = Pick<SqlDatabase, "query">;
type DbRow = Record<string, unknown>;

function mapSource(row: DbRow) {
  return LibrarySourceSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    ...(row.source_identity
      ? { sourceIdentity: row.source_identity }
      : { providerMediaId: row.provider_media_id ?? undefined }),
    bibliography: row.bibliography,
    details: row.details,
    version: row.version,
  });
}

function mapItem(row: DbRow) {
  return LibraryItemSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    kind: row.kind,
    content: row.content,
    notes: row.notes,
    topics: row.topics,
    createdBy: row.created_by,
    version: row.version,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  });
}

export async function readLibrarySource(
  db: LibraryQueryDatabase,
  projectId: string,
  id: string,
) {
  const {
    rows: [row],
  } = await db.query(
    "SELECT * FROM project_library_sources WHERE project_id = $1 AND id = $2",
    [projectId, id],
  );
  if (!row) throw new CatalogNotFoundError("Library source not found.");
  return mapSource(row);
}

const sourceTextMatches = `EXISTS (
         SELECT 1 FROM unnest(ARRAY[
           s.bibliography #>> '{title,value}',
           s.bibliography #>> '{publication,value}',
           s.bibliography #>> '{publisher,value}',
           s.bibliography #>> '{credit,value}',
           s.details ->> 'channel'
         ]) AS field(value) WHERE strpos(lower(field.value), lower($4)) > 0
         UNION ALL
         SELECT 1 FROM jsonb_array_elements_text(s.bibliography #> '{authors,value}')
           AS author(name) WHERE strpos(lower(author.name), lower($4)) > 0
       )`;

export async function listLibrarySources(
  db: LibraryQueryDatabase,
  projectId: string,
  query: SourceListQuery,
) {
  const { rows } = await db.query(
    `SELECT s.* FROM project_library_sources s
     JOIN library_sources record ON (record.project_id, record.id)=(s.project_id, s.id)
     WHERE s.project_id = $1
       AND ($2::text IS NULL OR s.kind = $2)
       AND ($3::text IS NULL OR EXISTS (
         SELECT 1
         FROM project_library_items i
         JOIN project_library_item_topics it ON it.item_id = i.id
         JOIN clip_tags t ON t.id = it.tag_id AND t.project_id = i.project_id
         WHERE i.project_id = s.project_id AND i.source_id = s.id
           AND t.normalized_name = $3
       ))
       AND ($4::text IS NULL OR ${sourceTextMatches})
     ORDER BY CASE WHEN $7::boolean THEN record.created_at END DESC, s.id
     LIMIT $5 OFFSET $6`,
    [
      projectId,
      query.kind ?? null,
      query.topic ? normalizeTagName(query.topic) : null,
      query.q ?? null,
      query.limit,
      query.offset,
      query.sort === "recent",
    ],
  );
  return rows.map(mapSource);
}

const itemWithTopics = `SELECT i.*, ARRAY(
  SELECT t.name
  FROM project_library_item_topics it
  JOIN clip_tags t ON t.id = it.tag_id AND t.project_id = i.project_id
  WHERE it.item_id = i.id
  ORDER BY t.normalized_name, t.id
) AS topics FROM project_library_items i`;

export async function readLibraryItemRow(
  db: LibraryQueryDatabase,
  projectId: string,
  id: string,
) {
  const {
    rows: [row],
  } = await db.query(
    `${itemWithTopics} WHERE i.project_id = $1 AND i.id = $2`,
    [projectId, id],
  );
  if (!row) throw new CatalogNotFoundError("Library item not found.");
  return { item: mapItem(row), legacy: row.legacy === true };
}

export async function listLibraryItems(
  db: LibraryQueryDatabase,
  projectId: string,
  query: ItemListQuery,
) {
  const { rows } = await db.query(
    `${itemWithTopics}
     JOIN project_library_sources s ON s.project_id = i.project_id AND s.id = i.source_id
     WHERE i.project_id = $1
       AND ($2::text IS NULL OR i.kind = $2)
       AND ($3::text IS NULL OR EXISTS (
         SELECT 1
         FROM project_library_item_topics it
         JOIN clip_tags t ON t.id = it.tag_id AND t.project_id = i.project_id
         WHERE it.item_id = i.id AND t.normalized_name = $3
       ))
       AND ($4::text IS NULL OR EXISTS (
         SELECT 1 FROM unnest(ARRAY[
           i.content ->> 'title',
           i.content ->> 'text',
           i.content ->> 'originalText',
           i.content ->> 'speaker',
           i.content ->> 'speakerTitle',
           i.content ->> 'credit',
           i.notes
         ]) AS field(value) WHERE strpos(lower(field.value), lower($4)) > 0
       ) OR ${sourceTextMatches})
       AND ($5::uuid IS NULL OR i.created_by = $5)
       AND ($8::uuid IS NULL OR i.source_id = $8)
     ORDER BY i.created_at DESC, i.id
     LIMIT $6 OFFSET $7`,
    [
      projectId,
      query.kind ?? null,
      query.topic ? normalizeTagName(query.topic) : null,
      query.q ?? null,
      query.logger ?? null,
      query.limit,
      query.offset,
      query.sourceId ?? null,
    ],
  );
  return rows.map(mapItem);
}
