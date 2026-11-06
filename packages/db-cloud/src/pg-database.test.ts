import { describe, expect, it, vi } from "vitest";

import { ConnectionAffineDatabase } from "./pg-database.ts";

describe("connection-affine PostgreSQL database", () => {
  it("keeps each transaction on its leased connection, not the pool", async () => {
    const calls: string[][] = [];
    const direct = vi.fn(async () => ({ rows: [] }));
    const released = vi.fn();
    const db = new ConnectionAffineDatabase({
      query: direct,
      async connect() {
        const own: string[] = [];
        calls.push(own);
        return {
          async query(sql: string) {
            own.push(sql);
            await Promise.resolve();
            return { rows: [] };
          },
          release: released,
        };
      },
    });
    await Promise.all([
      db.withTransaction(async () => {
        await db.query("SELECT LEFT");
        await db.query("UPDATE LEFT");
      }),
      db.withTransaction(async () => {
        await db.query("SELECT RIGHT");
        await db.query("UPDATE RIGHT");
      }),
    ]);
    expect(calls).toHaveLength(2);
    for (const own of calls) {
      expect(own[0]).toBe("BEGIN");
      expect(own.at(-1)).toBe("COMMIT");
      expect(own).toHaveLength(4);
      expect(
        own.some((sql) => sql.includes("LEFT")) &&
          own.some((sql) => sql.includes("RIGHT")),
      ).toBe(false);
    }
    expect(released).toHaveBeenCalledTimes(2);
    expect(direct).not.toHaveBeenCalled();
    await db.query("SELECT outside");
    expect(direct).toHaveBeenCalledOnce();
  });

  it("rolls back after failed work, releases, and rejects nesting", async () => {
    const statements: string[] = [];
    const release = vi.fn();
    const db = new ConnectionAffineDatabase({
      async query() {
        throw new Error("Pool query should never run in transaction");
      },
      async connect() {
        return {
          async query(sql: string) {
            statements.push(sql);
            return { rows: [] };
          },
          release,
        };
      },
    });
    await expect(
      db.withTransaction(async () => {
        await db.query("SELECT fixture");
        await expect(db.withTransaction(async () => {})).rejects.toThrow(
          "Nested",
        );
        throw new Error("fixture failure");
      }),
    ).rejects.toThrow("fixture failure");
    expect(statements).toEqual(["BEGIN", "SELECT fixture", "ROLLBACK"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("never runs work if BEGIN fails", async () => {
    const release = vi.fn();
    const db = new ConnectionAffineDatabase({
      async query() {
        return { rows: [] };
      },
      async connect() {
        return {
          async query() {
            throw new Error("No connection");
          },
          release,
        };
      },
    });
    const work = vi.fn();
    await expect(db.withTransaction(work)).rejects.toThrow("No connection");
    expect(work).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
