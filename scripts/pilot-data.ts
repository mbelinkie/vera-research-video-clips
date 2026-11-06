/**
 * VERA Research #50: explicit, local, operator-driven consistent backup/restore.
 * Requires a quiesced Mac pilot API (or an explicitly stopped API + worker).
 * Never creates a database, modifies the source, or restores over an existing root.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
} from "node:fs/promises";
import { join, dirname, isAbsolute, resolve, relative, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Pool } from "pg";
import { LocalTranscriptObjectStore } from "../packages/storage/src/index.ts";
import { pilotBackupGatePath } from "../packages/db-cloud/src/maintenance.ts";

type Ref = {
  object_key: string;
  object_version_id: string;
  sha256: string;
  byte_size: string;
};
type ObjectEntry = {
  key: string;
  versionId: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  file: string;
};
type BackupManifest = {
  format: "VERA50_PILOT_BACKUP_V1";
  completed: true;
  createdAt: string;
  databaseName: string;
  schemaVersions: string[];
  tableCounts: Record<string, number>;
  tableDigests: Record<string, string>;
  sqlDumpSha256: string;
  references: Ref[];
  objects: ObjectEntry[];
  visibleHeads: Array<{ key: string; versionId: string | null }>;
};

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const legalName = /^[a-z][a-z0-9_]{0,62}$/u;
const tables = [
  "users",
  "projects",
  "project_members",
  "videos",
  "project_videos",
  "transcript_versions",
  "transcript_artifacts",
  "transcript_uploads",
  "transcript_upload_targets",
  "transcription_batches",
  "transcription_batch_items",
  "jobs",
  "worker_leases",
  "sync_events",
  "clip_candidates",
  "clip_tags",
  "clip_candidate_tags",
  "export_requests",
];

function localPg(raw: string, restore: boolean) {
  if (!raw)
    throw new Error("A local PostgreSQL URL is required in the environment");
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.username ||
    !url.password ||
    !legalName.test(name)
  ) {
    throw new Error(
      "A credentialed loopback PostgreSQL database URL is required",
    );
  }
  if (restore && !name.startsWith("vera50_test_"))
    throw new Error(
      "Restore requires a separately prepared vera50_test_ database",
    );
  return {
    raw,
    name,
    env: {
      ...process.env,
      PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: name,
    },
  };
}

async function runPgTool(
  name: "pg_dump" | "pg_restore",
  env: NodeJS.ProcessEnv,
  args: string[],
) {
  await new Promise<void>((resolvePromise, reject) => {
    // Credentials travel through the environment only, never argv or logs.
    const child = spawn(name, [...args, "--no-password"], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.resume();
    child.on("error", () => reject(new Error(name + " could not start")));
    child.on("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(name + " failed (code " + code + ")")),
    );
  });
}

async function writeSynced(file: string, data: Uint8Array) {
  const handle = await open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDir(path: string) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function mustBeAbsent(path: string) {
  try {
    await lstat(path);
    throw new Error("Destination already exists: " + path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function privateDir(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error(
      "Pilot storage path is not a private non-symlink directory",
    );
}
async function readSnapshot(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const versions = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const references =
      await client.query<Ref>(`SELECT object_key, object_version_id, sha256, byte_size::text
       FROM transcript_artifacts ORDER BY object_key, object_version_id`);
    const manifests = await client.query<{
      manifest_object_key: string;
      manifest_object_version_id: string;
      manifest_sha256: string;
    }>(
      "SELECT manifest_object_key, manifest_object_version_id, manifest_sha256 FROM transcript_versions",
    );
    const referenceIds = new Set(
      references.rows.map(
        (ref) =>
          ref.object_key +
          "\u0000" +
          ref.object_version_id +
          "\u0000" +
          ref.sha256,
      ),
    );
    for (const manifest of manifests.rows) {
      if (
        !referenceIds.has(
          manifest.manifest_object_key +
            "\u0000" +
            manifest.manifest_object_version_id +
            "\u0000" +
            manifest.manifest_sha256,
        )
      ) {
        throw new Error(
          "Catalog manifest reference is not present in transcript_artifacts",
        );
      }
    }
    const counts: Record<string, number> = {};
    const tableDigests: Record<string, string> = {};
    for (const table of tables) {
      const result = await client.query<{ total: string }>(
        "SELECT count(*)::text AS total FROM " + table,
      );
      counts[table] = Number(result.rows[0]!.total);
      // Counts alone do not prove exact IDs, permissions, job payloads, or
      // optimistic versions. Hash all canonical JSONB rows in stable order.
      const records = await client.query<{ row_json: string }>(
        "SELECT to_jsonb(t)::text AS row_json FROM " + table + " t",
      );
      tableDigests[table] = sha(
        Buffer.from(
          records.rows
            .map((row) => row.row_json)
            .sort()
            .join("\n"),
        ),
      );
    }
    await client.query("COMMIT");
    return {
      schemaVersions: versions.rows.map((row) => row.version),
      references: references.rows,
      tableCounts: counts,
      tableDigests,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function drain(apiOrigin: string, offline: boolean, pool: Pool) {
  if (offline) {
    const connected = await pool.query<{
      count: string;
    }>(`SELECT count(*)::text AS count FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()`);
    if (Number(connected.rows[0]?.count) !== 0)
      throw new Error(
        "Other database connections remain; offline backup refused",
      );
    return;
  }
  const origin = new URL(apiOrigin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    throw new Error("Backup probe must use loopback");
  for (let attempt = 0; attempt < 120; attempt++) {
    let status: { writesBlocked?: boolean; inFlightWrites?: number };
    try {
      const response = await fetch(new URL("/__maintenance/status", origin), {
        signal: AbortSignal.timeout(1_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error();
      status = (await response.json()) as typeof status;
    } catch {
      throw new Error(
        "Pilot API drain status unreachable; stop all services and use --offline only after verifying shutdown",
      );
    }
    if (status.writesBlocked && status.inFlightWrites === 0) return;
    await sleep(250);
  }
  throw new Error("Pilot writes did not drain within 30 seconds");
}

export async function backupPilot(
  sourceUrl: string,
  objectRoot: string,
  destination: string,
  options: { offline: boolean; apiOrigin: string },
) {
  if (!isAbsolute(objectRoot) || !isAbsolute(destination))
    throw new Error("Absolute private paths required");
  objectRoot = resolve(objectRoot);
  destination = resolve(destination);
  const diff = relative(objectRoot, destination);
  if (
    !diff ||
    (!diff.startsWith(".." + sep) && diff !== ".." && !isAbsolute(diff))
  )
    throw new Error("Backup destination must not be inside the object root");
  await privateDir(objectRoot);
  await mustBeAbsent(destination);
  const pg = localPg(sourceUrl, false);
  const gate = pilotBackupGatePath(objectRoot);
  const stage = destination + ".incomplete-" + randomUUID();
  const pool = new Pool({
    connectionString: sourceUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
  });
  await mkdir(gate, { mode: 0o700 });
  try {
    await syncDir(objectRoot);
    await drain(options.apiOrigin, options.offline, pool);
    await mkdir(stage, { mode: 0o700 });
    await mkdir(join(stage, "versions"), { mode: 0o700 });
    const dump = join(stage, "catalog.dump");
    await runPgTool("pg_dump", pg.env, ["--format=custom", "--file", dump]);
    const snapshot = await readSnapshot(pool);
    const store = new LocalTranscriptObjectStore(objectRoot);
    const objects = new Map<string, ObjectEntry>();
    const heads: BackupManifest["visibleHeads"] = [];
    const copy = async (
      key: string,
      versionId: string,
      expectedSha?: string,
      expectedSize?: number,
    ) => {
      const id = key + "\u0000" + versionId;
      if (objects.has(id)) return;
      const obj = await store.get(key, versionId);
      if (
        !obj ||
        (expectedSha && obj.sha256 !== expectedSha) ||
        (expectedSize !== undefined && obj.bytes.byteLength !== expectedSize)
      ) {
        throw new Error("Missing or inconsistent pinned transcript version");
      }
      const hash = sha(Buffer.from(key));
      const sub = join(stage, "versions", hash);
      await mkdir(sub, { mode: 0o700, recursive: true });
      const file = join("versions", hash, versionId + ".blob");
      await writeSynced(join(stage, file), obj.bytes);
      await syncDir(sub);
      objects.set(id, {
        key,
        versionId,
        sha256: obj.sha256,
        byteSize: obj.bytes.byteLength,
        contentType: obj.contentType,
        file,
      });
    };
    for (const ref of snapshot.references)
      await copy(
        ref.object_key,
        ref.object_version_id,
        ref.sha256,
        Number(ref.byte_size),
      );
    for (const key of new Set(
      snapshot.references.map((ref) => ref.object_key),
    )) {
      const current = await store.get(key);
      if (current)
        await copy(
          key,
          current.versionId,
          current.sha256,
          current.bytes.byteLength,
        );
      heads.push({ key, versionId: current?.versionId ?? null });
    }
    const manifest: BackupManifest = {
      format: "VERA50_PILOT_BACKUP_V1",
      completed: true,
      createdAt: new Date().toISOString(),
      databaseName: pg.name,
      schemaVersions: snapshot.schemaVersions,
      tableCounts: snapshot.tableCounts,
      tableDigests: snapshot.tableDigests,
      sqlDumpSha256: sha(await readFile(dump)),
      references: snapshot.references,
      objects: [...objects.values()],
      visibleHeads: heads,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    await writeSynced(join(stage, "manifest.json"), manifestBytes);
    await writeSynced(
      join(stage, "manifest.sha256"),
      Buffer.from(sha(manifestBytes) + "\n"),
    );
    await syncDir(stage);
    await rename(stage, destination);
    await syncDir(dirname(destination));
    return {
      objects: manifest.objects.length,
      tables: Object.keys(manifest.tableCounts).length,
    };
  } finally {
    await pool.end();
    // Only a successfully created gate by this invocation is removed.
    await rmdir(gate);
  }
}

export async function restorePilot(
  backupRoot: string,
  targetUrl: string,
  targetRoot: string,
) {
  if (![backupRoot, targetRoot].every(isAbsolute))
    throw new Error("Absolute paths required");
  backupRoot = resolve(backupRoot);
  targetRoot = resolve(targetRoot);
  await mustBeAbsent(targetRoot);
  const pg = localPg(targetUrl, true);
  const bytes = await readFile(join(backupRoot, "manifest.json"));
  const knownDigest = (
    await readFile(join(backupRoot, "manifest.sha256"), "utf8")
  ).trim();
  if (sha(bytes) !== knownDigest)
    throw new Error("Corrupt backup manifest checksum");
  const manifest = JSON.parse(bytes.toString("utf8")) as BackupManifest;
  if (
    manifest.format !== "VERA50_PILOT_BACKUP_V1" ||
    manifest.completed !== true ||
    !Array.isArray(manifest.references) ||
    !Array.isArray(manifest.objects) ||
    !Array.isArray(manifest.visibleHeads) ||
    manifest.schemaVersions.length === 0
  ) {
    throw new Error("Unrecognized or incomplete backup manifest");
  }
  if (
    sha(await readFile(join(backupRoot, "catalog.dump"))) !==
    manifest.sqlDumpSha256
  )
    throw new Error("Corrupt PostgreSQL dump");
  const images = new Map<string, Uint8Array>();
  for (const obj of manifest.objects) {
    const hash = sha(Buffer.from(obj.key));
    const expected = join("versions", hash, obj.versionId + ".blob");
    if (
      obj.file !== expected ||
      !/^[0-9a-f-]{36}$/u.test(obj.versionId) ||
      obj.byteSize < 0
    )
      throw new Error("Unsafe backup object identity");
    const data = await readFile(join(backupRoot, obj.file));
    if (data.length !== obj.byteSize || sha(data) !== obj.sha256)
      throw new Error("Corrupt backup object bytes");
    images.set(obj.key + "\u0000" + obj.versionId, data);
  }
  for (const ref of manifest.references) {
    const id = ref.object_key + "\u0000" + ref.object_version_id;
    const data = images.get(id);
    if (
      !data ||
      data.length !== Number(ref.byte_size) ||
      sha(data) !== ref.sha256
    )
      throw new Error("Backup missing a referenced object version");
  }
  const pool = new Pool({
    connectionString: targetUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
  });
  const stage = targetRoot + ".restore-incomplete-" + randomUUID();
  try {
    const existing = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    if (existing.rows.length !== 0)
      throw new Error(
        "Restore database must be completely empty; never --clean an existing database",
      );
    await mkdir(stage, { mode: 0o700 });
    const store = new LocalTranscriptObjectStore(stage);
    for (const obj of manifest.objects) {
      await store.restoreVerifiedVersion({
        key: obj.key,
        versionId: obj.versionId,
        bytes: images.get(obj.key + "\u0000" + obj.versionId)!,
        sha256: obj.sha256,
        contentType: obj.contentType,
      });
    }
    for (const head of manifest.visibleHeads)
      await store.restoreVisibleHead(head.key, head.versionId);
    await runPgTool("pg_restore", pg.env, [
      "--dbname",
      pg.name,
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--exit-on-error",
      join(backupRoot, "catalog.dump"),
    ]);
    const snapshot = await readSnapshot(pool);
    if (
      JSON.stringify(snapshot.schemaVersions) !==
        JSON.stringify(manifest.schemaVersions) ||
      JSON.stringify(snapshot.tableCounts) !==
        JSON.stringify(manifest.tableCounts) ||
      JSON.stringify(snapshot.tableDigests) !==
        JSON.stringify(manifest.tableDigests) ||
      JSON.stringify(snapshot.references) !==
        JSON.stringify(manifest.references)
    ) {
      throw new Error(
        "Restored PostgreSQL identities/counts do not match backed-up catalog",
      );
    }
    for (const ref of snapshot.references) {
      const obj = await store.get(ref.object_key, ref.object_version_id);
      if (
        !obj ||
        obj.sha256 !== ref.sha256 ||
        obj.bytes.byteLength !== Number(ref.byte_size)
      )
        throw new Error("Restored object link failed verification");
    }
    await rename(stage, targetRoot);
    await syncDir(dirname(targetRoot));
    return {
      objects: manifest.objects.length,
      tables: Object.keys(snapshot.tableCounts).length,
    };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("pilot-data.ts")) {
  const [operation, pathA, pathB, flag] = process.argv.slice(2);
  if (operation === "backup" && pathA && !pathB) {
    backupPilot(
      process.env.PILOT_PG_URL ?? "",
      process.env.PILOT_OBJECT_ROOT ?? "",
      pathA,
      {
        offline: false,
        apiOrigin:
          process.env.PILOT_CLOUD_API_ORIGIN ?? "http://127.0.0.1:43111",
      },
    )
      .then((result) => console.log("Backup verified:", result))
      .catch((error) => {
        console.error((error as Error).message);
        process.exitCode = 1;
      });
  } else if (
    operation === "backup" &&
    pathA &&
    pathB === "--offline" &&
    !flag
  ) {
    backupPilot(
      process.env.PILOT_PG_URL ?? "",
      process.env.PILOT_OBJECT_ROOT ?? "",
      pathA,
      {
        offline: true,
        apiOrigin: "http://127.0.0.1:43111",
      },
    )
      .then((result) => console.log("Offline backup verified:", result))
      .catch((error) => {
        console.error((error as Error).message);
        process.exitCode = 1;
      });
  } else if (operation === "restore" && pathA && pathB && !flag) {
    restorePilot(pathA, process.env.VERA50_TEST_PG_URL ?? "", pathB)
      .then((result) => console.log("Fresh test restore verified:", result))
      .catch((error) => {
        console.error((error as Error).message);
        process.exitCode = 1;
      });
  } else {
    console.error(
      "Usage: pilot-data.ts backup /absolute/new-backup [--offline] OR restore /absolute/backup /absolute/new-test-object-root",
    );
    process.exitCode = 2;
  }
}
