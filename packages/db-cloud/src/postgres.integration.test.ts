import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { ConnectionAffineDatabase } from "./pg-database.ts";
import { runCloudMigrations } from "./index.ts";
import { SharedProjectCatalog } from "../../catalog/src/index.ts";
import { MemoryTranscriptObjectStore } from "../../storage/src/index.ts";

/**
 * Non-destructive gated test. Supply a fresh, empty vera50_test_* PostgreSQL
 * DB explicitly; no CI or normal local tests touch live PostgreSQL.
 */
const pgUrl = process.env.VERA50_TEST_PG_URL;
const permitted =
  pgUrl && process.env.VERA50_TEST_PG_ALLOW_SCHEMA_CREATE === "1";
const pools: Pool[] = [];
const database = () => {
  const pool = new Pool({
    connectionString: pgUrl,
    max: 3,
    connectionTimeoutMillis: 3000,
  });
  pools.push(pool);
  return new ConnectionAffineDatabase(pool);
};
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
});

describe.skipIf(!permitted)(
  "real PostgreSQL isolated pilot integration",
  () => {
    it("serializes simultaneous cold migrations and verifies durable data using independent clients", async () => {
      const parsed = new URL(pgUrl!);
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
        !decodeURIComponent(parsed.pathname.slice(1)).startsWith("vera50_test_")
      )
        throw new Error("Test DB URL is not a safe disposable local target");
      const first = database();
      const second = database();
      const before = await first.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      if (before.rows.length !== 0)
        throw new Error("A brand-new empty test database is required");
      const [left, right] = await Promise.all([
        runCloudMigrations(first),
        runCloudMigrations(second),
      ]);
      expect(left.length + right.length).toBe(7);
      expect(await runCloudMigrations(second)).toEqual([]);

      const catalog = new SharedProjectCatalog(
        first,
        new MemoryTranscriptObjectStore(),
      );
      const actor = {
        userId: randomUUID(),
        externalSubject: "vera50-synthetic-owner",
      };
      await catalog.registerUser(actor, "Owner");
      const project = await catalog.createProject(actor, {
        name: "Durable PG fixture",
      });
      const found = await new SharedProjectCatalog(
        second,
        new MemoryTranscriptObjectStore(),
      ).listProjects(actor);
      expect(found.some((item) => item.id === project.id)).toBe(true);

      // Two independently leased writers; rollback cannot leave partial state.
      const marker = randomUUID();
      await expect(
        first.transaction(async () => {
          await first.query("UPDATE projects SET name = $1 WHERE id = $2", [
            marker,
            project.id,
          ]);
          throw new Error("rollback fixture");
        }),
      ).rejects.toThrow("rollback fixture");
      const afterRollback = await second.query<{ name: string }>(
        "SELECT name FROM projects WHERE id=$1",
        [project.id],
      );
      expect(afterRollback.rows[0]?.name).toBe("Durable PG fixture");
      const stale = await second.query(
        "UPDATE projects SET version=version+1 WHERE id=$1 AND version=$2 RETURNING id",
        [project.id, 999],
      );
      expect(stale.rows).toEqual([]);
      const won = await first.query(
        "UPDATE projects SET version=version+1 WHERE id=$1 AND version=$2 RETURNING id",
        [project.id, 1],
      );
      expect(won.rows).toHaveLength(1);
      const retry = await second.query(
        "UPDATE projects SET version=version+1 WHERE id=$1 AND version=$2 RETURNING id",
        [project.id, 1],
      );
      expect(retry.rows).toHaveLength(0);

      // A held row lock must force SKIP LOCKED to return no rows on the second pool.
      let indicateLocked!: () => void;
      const waitForLock = new Promise<void>((resolve) => {
        indicateLocked = resolve;
      });
      const heldTransaction = first.transaction(async () => {
        await first.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
          project.id,
        ]);
        indicateLocked();
        await new Promise((release) => setTimeout(release, 350));
      });
      await waitForLock;
      const skipped = await second.transaction(() =>
        second.query(
          "SELECT id FROM projects WHERE id=$1 FOR UPDATE SKIP LOCKED",
          [project.id],
        ),
      );
      expect(skipped.rows).toEqual([]);
      await heldTransaction;
      const committed = await second.query<{ version: number }>(
        "SELECT version FROM projects WHERE id=$1",
        [project.id],
      );
      expect(committed.rows[0]?.version).toBe(2);
    });
  },
);
