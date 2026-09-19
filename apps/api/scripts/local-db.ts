/**
 * `pnpm db:start` — a real PostgreSQL server for local development, without Docker.
 *
 * This machine class (Windows, no administrator rights, no Docker) cannot run the
 * docker-compose service, so the same PostgreSQL major is run from the `embedded-postgres`
 * binaries instead — a genuine server process speaking the wire protocol, not an emulation.
 * See CUTS.md C-02. The cluster lives in `.pgdata/` (gitignored) and survives restarts.
 *
 * Foreground process: Ctrl+C stops the server cleanly.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

import { bootstrapDatabase } from '../src/db/bootstrap.js';
import { migrate } from '../src/db/migrate.js';
import { upsertEnv } from './lib/envfile.js';
import { ENV_FILE, LOCAL_PG_DIR, MIGRATIONS_DIR } from './lib/paths.js';

const PORT = Number(process.env['LOCAL_PG_PORT'] ?? 54329);
const CLUSTER_DIR = join(LOCAL_PG_DIR, 'cluster');
const CREDENTIALS = join(LOCAL_PG_DIR, 'credentials.json');

interface Credentials {
  superuser: string;
  owner: string;
  app: string;
}

function credentials(): Credentials {
  if (existsSync(CREDENTIALS)) return JSON.parse(readFileSync(CREDENTIALS, 'utf8')) as Credentials;
  mkdirSync(LOCAL_PG_DIR, { recursive: true });
  const fresh: Credentials = {
    superuser: randomBytes(24).toString('base64url'),
    owner: randomBytes(24).toString('base64url'),
    app: randomBytes(24).toString('base64url'),
  };
  writeFileSync(CREDENTIALS, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  return fresh;
}

const creds = credentials();
const server = new EmbeddedPostgres({
  databaseDir: CLUSTER_DIR,
  user: 'postgres',
  password: creds.superuser,
  port: PORT,
  persistent: true,
  onLog: () => undefined,
  onError: (message: unknown) => process.stderr.write(`[postgres] ${String(message)}\n`),
});

if (!existsSync(join(CLUSTER_DIR, 'PG_VERSION'))) {
  process.stdout.write(`Initialising a new PostgreSQL cluster in ${CLUSTER_DIR} …\n`);
  await server.initialise();
}
await server.start();

const superuserUrl = `postgres://postgres:${encodeURIComponent(creds.superuser)}@127.0.0.1:${PORT}/postgres`;
const urls = await bootstrapDatabase(superuserUrl, { database: 'fasal', ownerPassword: creds.owner, appPassword: creds.app });
const result = await migrate(urls.ownerUrl, MIGRATIONS_DIR);
upsertEnv(ENV_FILE, { DATABASE_URL: urls.appUrl, DATABASE_OWNER_URL: urls.ownerUrl });

process.stdout.write(
  `PostgreSQL is running on 127.0.0.1:${PORT} (database "fasal").\n` +
    `  migrations: ${result.applied.length} applied, ${result.alreadyApplied.length} already applied\n` +
    '  DATABASE_URL (fasal_app) and DATABASE_OWNER_URL (fasal_owner) are in .env\n' +
    'Ctrl+C to stop.\n',
);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.stdout.write('PostgreSQL stopped.\n');
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// Keep the event loop alive while the server runs.
setInterval(() => undefined, 1 << 30);
