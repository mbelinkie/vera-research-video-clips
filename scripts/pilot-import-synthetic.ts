/**
 * #50 non-destructive proof path only; NEVER operate on an actual Mac catalog.
 * Source name must start vera50_synthetic_; target is an empty vera50_test_ DB.
 * Does not install PostgreSQL, wipe schemas, or switch application configuration.
 */
import { cp, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import {
  ConnectionAffineDatabase,
  runCloudMigrations,
} from "../packages/db-cloud/src/index.ts";
import { LocalTranscriptObjectStore } from "../packages/storage/src/index.ts";

const tablesInFkOrder = [
  "users",
  "projects",
  "videos",
  "project_members",
  "transcript_versions",
  "project_videos",
  "transcription_batches",
  "jobs",
  "worker_leases",
  "transcript_artifacts",
  "transcript_uploads",
  "transcript_upload_targets",
  "sync_events",
  "transcription_batch_items",
  "clip_candidates",
  "clip_tags",
  "clip_candidate_tags",
  "export_requests",
] as const;
const keyColumns: Record<string, string[]> = {
  users: ["id"],
  projects: ["id"],
  videos: ["id"],
  project_members: ["project_id", "user_id"],
  transcript_versions: ["id"],
  project_videos: ["project_id", "video_id"],
  transcription_batches: ["id"],
  jobs: ["id"],
  worker_leases: ["job_id"],
  transcript_artifacts: ["transcript_version_id", "artifact_type"],
  transcript_uploads: ["id"],
  transcript_upload_targets: ["upload_id", "artifact_type"],
  sync_events: ["sequence"],
  transcription_batch_items: ["id"],
  clip_candidates: ["id"],
  clip_tags: ["id"],
  clip_candidate_tags: ["clip_id", "tag_id"],
  export_requests: ["id"],
};

const normalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, normalize(val)]),
    );
  return value;
};

function stableRow(
  row: Record<string, unknown>,
  columns: Record<string, string>,
) {
  return JSON.stringify(
    normalize(
      Object.fromEntries(
        Object.entries(row).map(([key, raw]) => {
          if (raw === null) return [key, null];
          const type = columns[key];
          if (type === "bigint") return [key, String(raw)];
          if (type === "jsonb" && typeof raw === "string")
            return [key, JSON.parse(raw)];
          return [key, raw];
        }),
      ),
    ),
  );
}

export async function importSyntheticPglite(
  sourcePath: string,
  sourceObjectRoot: string,
  targetUrl: string,
  targetObjectRoot: string,
  evidencePath: string,
) {
  if (
    ![sourcePath, sourceObjectRoot, targetObjectRoot, evidencePath].every(
      isAbsolute,
    )
  )
    throw new Error("Explicit absolute synthetic paths required");
  if (!basename(sourcePath).startsWith("vera50_synthetic_"))
    throw new Error(
      "Real PGlite catalogs may not be imported by the synthetic proof tool",
    );
  const parsed = new URL(targetUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !decodeURIComponent(parsed.pathname.slice(1)).startsWith("vera50_test_")
  ) {
    throw new Error(
      "The import target must be a loopback vera50_test_ PostgreSQL database",
    );
  }
  if (!parsed.username || !parsed.password)
    throw new Error("Explicit test PostgreSQL credentials are required");
  sourcePath = resolve(sourcePath);
  sourceObjectRoot = resolve(sourceObjectRoot);
  targetObjectRoot = resolve(targetObjectRoot);
  evidencePath = resolve(evidencePath);
  for (const path of [targetObjectRoot, evidencePath]) {
    try {
      await lstat(path);
      throw new Error("Import output already exists; no overwrite allowed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const sourceInfo = await lstat(sourcePath);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink())
    throw new Error("Unsafe synthetic PGlite source");
  const stageRoot = evidencePath + ".incomplete-" + randomUUID();
  await mkdir(stageRoot, { recursive: true, mode: 0o700 });
  // Retain an immutable source-directory rollback copy before querying or opening
  // the disposable PGlite. Never read a live Mac data directory in this tool.
  const sourceCopy = join(stageRoot, "pglite-source-backup");
  await cp(sourcePath, sourceCopy, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const source = new PGlite(sourceCopy);
  const pool = new Pool({
    connectionString: targetUrl,
    max: 3,
    connectionTimeoutMillis: 5_000,
  });
  const db = new ConnectionAffineDatabase(pool);
  const objectStage = targetObjectRoot + ".incomplete-" + randomUUID();
  try {
    const existing = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    if (existing.rows.length !== 0)
      throw new Error("Only an empty test PostgreSQL database is accepted");
    const sourceMigrations = await source.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const applied = await runCloudMigrations(db);
    if (
      JSON.stringify(sourceMigrations.rows.map((x) => x.version)) !==
      JSON.stringify(applied)
    ) {
      throw new Error(
        "Schema drift: source and target migration versions differ",
      );
    }
    const targetStore = new LocalTranscriptObjectStore(objectStage);
    const sourceStore = new LocalTranscriptObjectStore(sourceObjectRoot);
    const refs = await source.query<{
      object_key: string;
      object_version_id: string;
      sha256: string;
      byte_size: number;
    }>(
      "SELECT object_key, object_version_id, sha256, byte_size FROM transcript_artifacts",
    );
    const imported = new Set<string>();
    for (const ref of refs.rows) {
      const id = ref.object_key + "\u0000" + ref.object_version_id;
      if (imported.has(id)) continue;
      const data = await sourceStore.get(ref.object_key, ref.object_version_id);
      if (
        !data ||
        data.sha256 !== ref.sha256 ||
        data.bytes.byteLength !== Number(ref.byte_size)
      )
        throw new Error("Missing PGlite catalog-linked source object");
      await targetStore.restoreVerifiedVersion(data);
      imported.add(id);
    }
    for (const key of new Set(refs.rows.map((row) => row.object_key))) {
      const head = await sourceStore.get(key);
      if (head && !imported.has(key + "\u0000" + head.versionId))
        await targetStore.restoreVerifiedVersion(head);
      await targetStore.restoreVisibleHead(key, head?.versionId ?? null);
    }
    const client = await pool.connect();
    const counts: Record<string, number> = {};
    try {
      await client.query("BEGIN");
      for (const table of tablesInFkOrder) {
        const names = await source.query<{
          column_name: string;
          data_type: string;
        }>(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position",
          [table],
        );
        const columns = names.rows.map((x) => x.column_name);
        const columnTypes = Object.fromEntries(
          names.rows.map((x) => [x.column_name, x.data_type]),
        );
        if (
          !columns.length ||
          columns.some((name) => !/^[a-z][a-z0-9_]*$/u.test(name))
        )
          throw new Error("Unexpected source table schema");
        const sourceRows = await source.query<Record<string, unknown>>(
          "SELECT * FROM " + table,
        );
        for (const row of sourceRows.rows) {
          const values = columns.map((col) => {
            const value = row[col];
            return value instanceof Date
              ? value.toISOString()
              : value && typeof value === "object"
                ? JSON.stringify(value)
                : value;
          });
          await client.query(
            "INSERT INTO " +
              table +
              " (" +
              columns.join(",") +
              ") VALUES (" +
              columns.map((_, i) => "$" + (i + 1)).join(",") +
              ")",
            values,
          );
        }
        const targetRows = await client.query<Record<string, unknown>>(
          "SELECT * FROM " + table,
        );
        const ordering = (
          a: Record<string, unknown>,
          b: Record<string, unknown>,
        ) =>
          keyColumns[table]!.map((k) => String(a[k]))
            .join("|")
            .localeCompare(
              keyColumns[table]!.map((k) => String(b[k])).join("|"),
            );
        const before = sourceRows.rows
          .sort(ordering)
          .map((row) => stableRow(row, columnTypes));
        const after = targetRows.rows
          .sort(ordering)
          .map((row) => stableRow(row, columnTypes));
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error("Imported field/identity mismatch in " + table);
        counts[table] = before.length;
      }
      await client.query(
        "SELECT setval(pg_get_serial_sequence('sync_events', 'sequence'), greatest(coalesce((select max(sequence) from sync_events), 0), 1), (select count(*) > 0 from sync_events))",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await rename(objectStage, targetObjectRoot);
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        join(stageRoot, "inventory.json"),
        JSON.stringify(
          { counts, importedObjectVersions: imported.size },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      ),
    );
    await rename(stageRoot, evidencePath);
    return { counts, objectVersions: imported.size };
  } finally {
    await source.close();
    await db.close();
  }
}

if (process.argv[1]?.endsWith("pilot-import-synthetic.ts")) {
  const [source, sourceObjects, targetObjects, evidence] =
    process.argv.slice(2);
  if (!source || !sourceObjects || !targetObjects || !evidence) {
    console.error(
      "Usage: pilot-import-synthetic.ts /absolute/vera50_synthetic_pglite /absolute/synthetic-objects /absolute/new-test-objects /absolute/new-evidence",
    );
    process.exitCode = 2;
  } else {
    importSyntheticPglite(
      source,
      sourceObjects,
      process.env.VERA50_TEST_PG_URL ?? "",
      targetObjects,
      evidence,
    )
      .then((result) =>
        console.log("Synthetic PGlite import verified:", result),
      )
      .catch((error) => {
        console.error((error as Error).message);
        process.exitCode = 1;
      });
  }
}
