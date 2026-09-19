/**
 * Process entry point: parse configuration, refuse to run with excess database privilege,
 * serve. Every failure on the way up is reported in words an operator can act on.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { ConfigError, loadConfig } from './config.js';
import { assertLeastPrivilege } from './db/guard.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { createLogger } from './log/logger.js';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.LOG_LEVEL });
  const pool = createPool(config.DATABASE_URL);
  const privileges = await assertLeastPrivilege(pool);
  logger.info({ role: privileges.role }, 'database role is least-privilege');

  const app = buildApp({ config, logger, pool });
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError || error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
