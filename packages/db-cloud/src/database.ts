/**
 * The catalog's deliberately narrow SQL contract. All queries issued while a
 * transaction callback runs must use its checked-out connection.
 */
export interface SqlDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: unknown[],
  ): Promise<{ rows: Row[] }>;
  exec(statement: string): Promise<unknown>;
  // Deliberately distinct from PGlite's native `transaction(callback)`:
  // its callback receives a *different* transaction handle. Catalog code
  // queries this interface directly, so calling PGlite.transaction would
  // deadlock while the original connection is held.
  withTransaction?<T>(action: () => Promise<T>): Promise<T>;
}
