import type { SqlDatabase } from "@research-video/db-cloud";

type Session = Pick<SqlDatabase, "query">;

const trackingKeys = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "gbraid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ttclid",
  "wbraid",
]);

export function articleIdentity(value: string): string {
  const url = new URL(value);
  const query = url.search.slice(1).split("&");
  const retained = query.filter((parameter) => {
    const key = new URLSearchParams(parameter).keys().next().value;
    const name = key?.toLowerCase();
    return (
      name === undefined ||
      (!name.startsWith("utm_") && !trackingKeys.has(name))
    );
  });
  // Preserve the spelling and order of non-tracking parameters, including repeated keys.
  if (retained.length !== query.length) url.search = retained.join("&");
  return url.href;
}

export async function lockSourceIdentity(tx: Session, projectId: string) {
  // Serialize URL edits and source creation before inspecting current addresses or retry keys.
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 77))",
    [projectId],
  );
}

export async function findArticle(
  tx: Session,
  projectId: string,
  identity: string,
  excludeId?: string,
) {
  const { rows } = await tx.query<{ id: string; url: string }>(
    `SELECT id, bibliography #>> '{url,value}' AS url FROM library_sources
     WHERE project_id = $1 AND kind = 'web_page'
       AND bibliography #>> '{url,value}' IS NOT NULL
       AND ($2::uuid IS NULL OR id <> $2)
     ORDER BY id`,
    [projectId, excludeId ?? null],
  );
  // Include URLs saved before deduplication. If there are legacy duplicates,
  // consistently reuse one without rewriting existing source or item IDs.
  return rows.find(({ url }) => articleIdentity(url) === identity)?.id;
}
