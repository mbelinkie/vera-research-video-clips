import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "@research-video/contracts";
import {
  ConnectionAffineDatabase,
  runCloudMigrations,
  type SqlDatabase,
} from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { SharedProjectCatalog } from "./index.ts";

// Never touch an existing database. Opt in only with a newly created, empty,
// loopback-only PostgreSQL database whose name clearly identifies test data.
const pgUrl = process.env.VERA49_TEST_PG_URL;
const enabled =
  Boolean(pgUrl) && process.env.VERA49_TEST_PG_ALLOW_SCHEMA_CREATE === "1";

describe.skipIf(!enabled)("real PostgreSQL membership serialization", () => {
  it("locks current Owner authority, competing demotions and transfer/revoke on independent connections", async () => {
    const parsed = new URL(pgUrl!);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      !decodeURIComponent(parsed.pathname.slice(1)).startsWith("vera49_test_")
    ) {
      throw new Error("A disposable local vera49_test_ database is required");
    }

    const pools = [
      new Pool({ connectionString: pgUrl, max: 2 }),
      new Pool({ connectionString: pgUrl, max: 2 }),
    ];
    try {
      const [first, second] = pools.map(
        (pool) => new ConnectionAffineDatabase(pool),
      ) as [ConnectionAffineDatabase, ConnectionAffineDatabase];
      const existing = await first.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      if (existing.rows.length !== 0) {
        throw new Error("A brand-new empty test database is required");
      }
      await runCloudMigrations(first);

      const left = new SharedProjectCatalog(
        first,
        new MemoryTranscriptObjectStore(),
      );
      const right = new SharedProjectCatalog(
        second,
        new MemoryTranscriptObjectStore(),
      );
      const register = async (label: string): Promise<AuthenticatedActor> => {
        const actor = {
          userId: randomUUID(),
          externalSubject: `vera49:fixture:${randomUUID()}`,
        };
        await left.registerUser(actor, label);
        return actor;
      };
      const owner = await register("Owner");
      const otherOwner = await register("Other Owner");
      const target = await register("Target");
      const countOwners = async (projectId: string) => {
        const count = await second.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM project_members WHERE project_id=$1 AND role='owner'",
          [projectId],
        );
        return Number(count.rows[0]?.count);
      };
      const membership = async (projectId: string, userId: string) => {
        const result = await second.query<{ role: string; version: number }>(
          "SELECT role, version FROM project_members WHERE project_id=$1 AND user_id=$2",
          [projectId, userId],
        );
        return result.rows[0];
      };

      // Prove the project lock is still held after a later query on the same
      // leased transaction. A bare pool.query or autocommit FOR UPDATE would
      // release it before this test reaches the NOWAIT probe.
      const lockProject = await left.createProject(owner, {
        name: "Connection-affine lock probe",
      });
      let resume!: () => void;
      let reached!: () => void;
      const held = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const observed: SqlDatabase = {
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          params: unknown[] = [],
        ) => {
          const result = await first.query<Row>(sql, params);
          if (sql.startsWith("SELECT 1 FROM users WHERE id =")) {
            reached();
            await held;
          }
          return result;
        },
        exec: (sql) => first.exec(sql),
        withTransaction: (action) => first.withTransaction(action),
      };
      const lockCatalog = new SharedProjectCatalog(
        observed,
        new MemoryTranscriptObjectStore(),
      );
      const pendingGrant = lockCatalog.addMember(
        owner,
        lockProject.id,
        target.userId,
        "viewer",
      );
      try {
        await paused;
        await expect(
          second.query(
            "SELECT id FROM projects WHERE id = $1 FOR UPDATE NOWAIT",
            [lockProject.id],
          ),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        resume();
        await pendingGrant;
      }

      const project = await left.createProject(owner, { name: "Two owners" });
      // Only test setup may inject a second Owner: public grants never do so.
      await first.query(
        `INSERT INTO project_members(project_id,user_id,role,version,created_at,updated_at)
         VALUES($1,$2,'owner',1,now(),now())`,
        [project.id, otherOwner.userId],
      );
      const competingDemotions = await Promise.allSettled([
        left.changeMemberRole(
          owner,
          project.id,
          otherOwner.userId,
          "editor",
          1,
        ),
        right.changeMemberRole(
          otherOwner,
          project.id,
          owner.userId,
          "editor",
          1,
        ),
      ]);
      expect(
        competingDemotions.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await countOwners(project.id)).toBe(1);
      const survivingOwner =
        (await membership(project.id, owner.userId))?.role === "owner"
          ? owner
          : otherOwner;
      const demotedOwner = survivingOwner === owner ? otherOwner : owner;
      await expect(
        left.listMembers(demotedOwner, project.id),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(
        right.changeMemberRole(
          survivingOwner,
          project.id,
          survivingOwner.userId,
          "viewer",
          1,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });

      const transferProject = await left.createProject(owner, {
        name: "Concurrent transfer or revoke",
      });
      await left.addMember(owner, transferProject.id, target.userId, "viewer");
      const competingChanges = await Promise.allSettled([
        left.transferOwnership(owner, transferProject.id, target.userId, 1, 1),
        right.removeMember(owner, transferProject.id, target.userId, 1),
      ]);
      expect(
        competingChanges.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await countOwners(transferProject.id)).toBe(1);
      const finalTarget = await membership(transferProject.id, target.userId);
      if (finalTarget) {
        expect(finalTarget).toMatchObject({ role: "owner", version: 2 });
        await expect(
          left.listMembers(owner, transferProject.id),
        ).rejects.toMatchObject({
          statusCode: 403,
        });
        await expect(
          right.transferOwnership(
            owner,
            transferProject.id,
            target.userId,
            1,
            1,
          ),
        ).rejects.toMatchObject({ statusCode: 403 });
      } else {
        expect(
          await membership(transferProject.id, owner.userId),
        ).toMatchObject({
          role: "owner",
          version: 1,
        });
        await expect(
          right.getProject(target, transferProject.id),
        ).rejects.toMatchObject({
          statusCode: 403,
        });
      }

      // A failure after target promotion must roll back BOTH sides of the
      // transfer. This fixture constraint deliberately rejects the second
      // UPDATE, when the acting Owner would become Editor.
      const rollbackProject = await left.createProject(owner, {
        name: "Transfer rollback",
      });
      await left.addMember(owner, rollbackProject.id, target.userId, "viewer");
      await first.query(
        `ALTER TABLE project_members ADD CONSTRAINT vera49_reject_owner_stepdown
         CHECK (NOT (project_id = '${rollbackProject.id}'::uuid
                AND user_id = '${owner.userId}'::uuid AND role = 'editor'))`,
      );
      await expect(
        left.transferOwnership(owner, rollbackProject.id, target.userId, 1, 1),
      ).rejects.toThrow();
      expect(await countOwners(rollbackProject.id)).toBe(1);
      expect(await membership(rollbackProject.id, owner.userId)).toMatchObject({
        role: "owner",
        version: 1,
      });
      expect(await membership(rollbackProject.id, target.userId)).toMatchObject(
        {
          role: "viewer",
          version: 1,
        },
      );

      // Concurrent checks do not waive CAS or safe retry rules.
      await expect(
        left.changeMemberRole(
          survivingOwner,
          project.id,
          demotedOwner.userId,
          "viewer",
          1,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  }, 30_000);
});
