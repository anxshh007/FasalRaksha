import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface PoolOptions {
  /** Maximum concurrent connections. Small by default: this is a 2G-first product. */
  max?: number;
  /** Label visible in `pg_stat_activity`, so an operator can tell the API from a migration. */
  applicationName?: string;
}

export function createPool(connectionString: string, options: PoolOptions = {}): Pool {
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'fasal-api',
    // Fail fast rather than queue a farmer's request behind a dead database.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}
