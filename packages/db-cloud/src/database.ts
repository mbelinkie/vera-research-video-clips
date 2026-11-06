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
  transaction?<T>(action: () => Promise<T>): Promise<T>;
}
