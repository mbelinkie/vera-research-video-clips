import { AsyncLocalStorage } from "node:async_hooks";

import { Pool, type PoolConfig } from "pg";

import type { SqlDatabase } from "./database.ts";

export interface SqlSession {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: unknown[],
  ): Promise<{ rows: Row[] }>;
}
export interface SqlLease extends SqlSession {
  release(): void;
}
export interface SqlPool extends SqlSession {
  connect(): Promise<SqlLease>;
  end?(): Promise<void>;
}

/** Queries outside a transaction use the pool; inside, *all* queries are leased. */
export class ConnectionAffineDatabase implements SqlDatabase {
  private readonly current = new AsyncLocalStorage<SqlLease>();

  constructor(private readonly pool: SqlPool) {}

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters: unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    return (this.current.getStore() ?? this.pool).query<Row>(
      statement,
      parameters,
    );
  }

  async exec(statement: string): Promise<void> {
    await this.query(statement);
  }

  async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.current.getStore()) {
      throw new Error("Nested SQL transactions are not supported");
    }
    const client = await this.pool.connect();
    let began = false;
    try {
      await client.query("BEGIN");
      began = true;
      const result = await this.current.run(client, action);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure. A broken client is discarded by pg.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }
}

/** Explicitly invoked only by the selected pilot runtime, never a fallback. */
export function createPostgresDatabase(connectionString: string) {
  const config: PoolConfig = {
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "vera-research-mac-pilot",
  };
  return new ConnectionAffineDatabase(new Pool(config));
}
