import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "@research-video/db-cloud";

export function normalizeTagName(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export async function addTopics(
  db: Pick<SqlDatabase, "query">,
  legacyClip: boolean,
  projectId: string,
  itemId: string,
  names: readonly string[],
  now: string,
) {
  const byNormalizedName = new Map<string, string>();
  for (const name of names) {
    const normalized = normalizeTagName(name);
    if (!byNormalizedName.has(normalized))
      byNormalizedName.set(normalized, name.trim());
  }
  // Lock shared dictionary entries in the same order across writers.
  for (const normalized of [...byNormalizedName.keys()].sort()) {
    const tag = await db.query<{ id: string }>(
      `INSERT INTO clip_tags(id,project_id,name,normalized_name,created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(project_id,normalized_name) DO UPDATE SET normalized_name=excluded.normalized_name
       RETURNING id`,
      [
        randomUUID(),
        projectId,
        byNormalizedName.get(normalized),
        normalized,
        now,
      ],
    );
    await db.query(
      legacyClip
        ? "INSERT INTO clip_candidate_tags(clip_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING"
        : "INSERT INTO library_item_topics(item_id,tag_id,project_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      legacyClip
        ? [itemId, tag.rows[0]!.id]
        : [itemId, tag.rows[0]!.id, projectId],
    );
  }
}
