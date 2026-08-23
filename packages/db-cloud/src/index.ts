import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolConfig } from "pg";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const cloudMigrationAdvisoryLock = 731_001;

export type CloudQueryRow = Record<string, unknown>;

export interface CloudQueryResult<Row extends CloudQueryRow = CloudQueryRow> {
  rows: Row[];
}

/** The only database operations needed by the cloud catalog. */
export interface CloudDatabase {
  query<Row extends CloudQueryRow = CloudQueryRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<CloudQueryResult<Row>>;
  execute(sql: string): Promise<void>;
  transaction<Result>(
    action: () => Promise<Result>,
    options?: CloudTransactionOptions,
  ): Promise<Result>;
  close(): Promise<void>;
}

export interface CloudTransactionOptions {
  repeatableRead?: boolean;
  readOnly?: boolean;
}

/**
 * Compatibility surface for the embedded deterministic test database. It is
 * intentionally not the production database contract.
 */
export interface EmbeddedCloudDatabase {
  query<Row extends CloudQueryRow = CloudQueryRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<CloudQueryResult<Row>>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

export type CloudDatabaseInput = CloudDatabase | EmbeddedCloudDatabase;

const embeddedDatabaseAdapters = new WeakMap<
  EmbeddedCloudDatabase,
  CloudDatabase
>();

function isCloudDatabase(
  database: CloudDatabaseInput,
): database is CloudDatabase {
  return "execute" in database && "transaction" in database;
}

export function asCloudDatabase(database: CloudDatabaseInput): CloudDatabase {
  if (isCloudDatabase(database)) return database;
  const existing = embeddedDatabaseAdapters.get(database);
  if (existing) return existing;
  const adapter = createEmbeddedCloudDatabase(database);
  embeddedDatabaseAdapters.set(database, adapter);
  return adapter;
}

/**
 * Wrap PGlite (or another embedded PostgreSQL-compatible test double) so
 * transactions and ordinary queries cannot interleave on its single session.
 */
export function createEmbeddedCloudDatabase(
  database: EmbeddedCloudDatabase,
): CloudDatabase {
  const transactionContext = new AsyncLocalStorage<boolean>();
  let tail: Promise<void> = Promise.resolve();

  const exclusively = async <Result>(action: () => Promise<Result>) => {
    const predecessor = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await action();
    } finally {
      release();
    }
  };

  return {
    async query<Row extends CloudQueryRow>(
      sql: string,
      values?: readonly unknown[],
    ) {
      const query = () => database.query<Row>(sql, values);
      return transactionContext.getStore() ? query() : exclusively(query);
    },
    async execute(sql: string) {
      const execute = async () => {
        await database.exec(sql);
      };
      return transactionContext.getStore() ? execute() : exclusively(execute);
    },
    async transaction<Result>(
      action: () => Promise<Result>,
      options: CloudTransactionOptions = {},
    ) {
      if (transactionContext.getStore()) {
        throw new Error(
          "Nested cloud database transactions are not supported.",
        );
      }
      return exclusively(async () => {
        const begin = options.repeatableRead
          ? `BEGIN ISOLATION LEVEL REPEATABLE READ${options.readOnly ? " READ ONLY" : ""}`
          : options.readOnly
            ? "BEGIN READ ONLY"
            : "BEGIN";
        await database.exec(begin);
        try {
          const result = await transactionContext.run(true, action);
          await database.exec("COMMIT");
          return result;
        } catch (error) {
          await database.exec("ROLLBACK");
          throw error;
        }
      });
    },
    close: () => database.close(),
  };
}

export interface PostgresClient {
  query<Row extends CloudQueryRow = CloudQueryRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<CloudQueryResult<Row>>;
  release(): void;
}

export interface PostgresPool {
  query<Row extends CloudQueryRow = CloudQueryRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<CloudQueryResult<Row>>;
  connect(): Promise<PostgresClient>;
  end(): Promise<void>;
}

/**
 * PostgreSQL adapter. During transaction() every query made through this
 * instance is routed to the one checked-out client, never Pool.query.
 */
export class PostgresCloudDatabase implements CloudDatabase {
  private readonly transactionContext = new AsyncLocalStorage<PostgresClient>();

  constructor(private readonly pool: PostgresPool) {}

  query<Row extends CloudQueryRow>(sql: string, values?: readonly unknown[]) {
    const client = this.transactionContext.getStore();
    return (client ?? this.pool).query<Row>(sql, values);
  }

  async execute(sql: string) {
    await this.query(sql);
  }

  async transaction<Result>(
    action: () => Promise<Result>,
    options: CloudTransactionOptions = {},
  ): Promise<Result> {
    if (this.transactionContext.getStore()) {
      throw new Error("Nested cloud database transactions are not supported.");
    }
    const client = await this.pool.connect();
    const begin = options.repeatableRead
      ? `BEGIN ISOLATION LEVEL REPEATABLE READ${options.readOnly ? " READ ONLY" : ""}`
      : options.readOnly
        ? "BEGIN READ ONLY"
        : "BEGIN";
    try {
      await client.query(begin);
      const result = await this.transactionContext.run(client, action);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the primary query or callback failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  close() {
    return this.pool.end();
  }
}

export function createPostgresCloudDatabase(
  configuration: PoolConfig,
): PostgresCloudDatabase {
  return new PostgresCloudDatabase(new Pool(configuration));
}

export async function runCloudMigrations(
  input: CloudDatabaseInput,
  migrationDirectory = defaultMigrationDirectory,
): Promise<string[]> {
  const database = asCloudDatabase(input);
  await database.transaction(async () => {
    await database.query("SELECT pg_advisory_xact_lock($1)", [
      cloudMigrationAdvisoryLock,
    ]);
    await database.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  });

  const result = await database.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const applied = new Set(result.rows.map((row) => row.version));
  const files = readdirSync(resolve(migrationDirectory))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();
  const newlyApplied: string[] = [];

  for (const filename of files) {
    const version = basename(filename, ".sql");
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(migrationDirectory, filename), "utf8");
    const didApply = await database.transaction(async () => {
      await database.query("SELECT pg_advisory_xact_lock($1)", [
        cloudMigrationAdvisoryLock,
      ]);
      const current = await database.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (current.rows[0]) return false;
      await database.execute(sql);
      await database.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version],
      );
      return true;
    });
    if (didApply) newlyApplied.push(version);
  }

  return newlyApplied;
}
