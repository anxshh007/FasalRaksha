/**
 * The Fastify application factory. Domain modules register here as they are built
 * (PROMPT §3.3: domain modules, not giant controllers). Constructed with its dependencies so
 * tests can inject them and never touch a real network.
 */
import Fastify from 'fastify';

import type { Config } from '../config.js';
import type { Pool } from '../db/pool.js';
import type { Logger } from '../log/logger.js';

export const API_VERSION = '3.0.0';

export interface AppDependencies {
  config: Config;
  logger: Logger;
  /** Absent only in tests that exercise routes with no database behind them. */
  pool?: Pool;
}

async function databaseReachable(pool: Pool | undefined): Promise<boolean> {
  if (pool === undefined) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function buildApp(deps: AppDependencies) {
  const app = Fastify({
    loggerInstance: deps.logger,
    // Request ids are generated server-side; a client-supplied id is never trusted.
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 256 * 1024,
  });

  /**
   * Reachability is measured, not inferred (a lesson from V-2: `navigator.onLine` is true on a
   * captive portal). `no-store` so no cache anywhere can answer on the server's behalf.
   */
  app.get('/api/health', async (_request, reply) => {
    const database = (await databaseReachable(deps.pool)) ? 'up' : 'down';
    void reply.header('cache-control', 'no-store');
    return { ok: database === 'up', service: 'fasal-api', version: API_VERSION, database };
  });

  return app;
}

export type App = ReturnType<typeof buildApp>;
