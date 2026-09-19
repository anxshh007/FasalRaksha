/**
 * Process entry point: parse configuration, refuse to run with excess database privilege,
 * wire the adapters named by the environment, serve. Every failure on the way up is reported in
 * words an operator can act on.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { MockMessagingAdapter } from './adapters/messaging/index.js';
import { MockBuyerRegistryAdapter, MockFarmerRegistryAdapter } from './adapters/registry/mock.js';
import { ConfigError, loadConfig } from './config.js';
import { assertLeastPrivilege } from './db/guard.js';
import { createPool } from './db/pool.js';
import { buildApp } from './http/app.js';
import { createLogger } from './log/logger.js';
import { createKeyRing } from './security/keys.js';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.LOG_LEVEL });
  if (config.REGISTRY_ADAPTER === 'live') {
    throw new ConfigError(['REGISTRY_ADAPTER=live needs the live registry gateway, which arrives with the adapter phase (P4)']);
  }
  const pool = createPool(config.DATABASE_URL);
  const privileges = await assertLeastPrivilege(pool);
  logger.info({ role: privileges.role }, 'database role is least-privilege');

  const keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  const app = buildApp({
    config,
    logger,
    db: { pool, contextKey: keys.contextKey },
    keys,
    messaging: new MockMessagingAdapter(),
    farmerRegistry: new MockFarmerRegistryAdapter(),
    buyerRegistry: new MockBuyerRegistryAdapter(),
  });
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
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
