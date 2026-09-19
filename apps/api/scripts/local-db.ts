/**
 * `pnpm db:start` — a real PostgreSQL server for local development, without Docker.
 *
 * This machine class (Windows, no administrator rights, no Docker) cannot run the
 * docker-compose service, so the same PostgreSQL major is run from the `embedded-postgres`
 * binaries instead — a genuine server process speaking the wire protocol, not an emulation.
 * See CUTS.md C-01. The cluster lives in `.pgdata/` (gitignored) and survives restarts.
 *
 * On every start: bootstrap roles (idempotent), apply migrations, install the request-context
 * key, and write DATABASE_URL / DATABASE_OWNER_URL / DB_CONTEXT_KEY / AUTH_SECRET into `.env`.
 * Secrets are generated once and kept in `.pgdata/credentials.json`.
 *
 * Foreground process: Ctrl+C stops the server cleanly.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

import { bootstrapDatabase, installContextKey } from '../src/db/bootstrap.js';
import { migrate } from '../src/db/migrate.js';
import { upsertEnv } from './lib/envfile.js';
import { latestPipelineVersion, publish } from './lib/release.js';
import { ENV_FILE, LOCAL_PG_DIR, MIGRATIONS_DIR } from './lib/paths.js';

const PORT = Number(process.env['LOCAL_PG_PORT'] ?? 54329);
const CLUSTER_DIR = join(LOCAL_PG_DIR, 'cluster');
const CREDENTIALS = join(LOCAL_PG_DIR, 'credentials.json');

interface Credentials {
  superuser: string;
  owner: string;
  app: string;
  contextKey?: string;
  authSecret?: string;
}

function credentials(): Required<Credentials> {
  mkdirSync(LOCAL_PG_DIR, { recursive: true });
  const existing: Partial<Credentials> = existsSync(CREDENTIALS) ? (JSON.parse(readFileSync(CREDENTIALS, 'utf8')) as Credentials) : {};
  const full: Required<Credentials> = {
    superuser: existing.superuser ?? randomBytes(24).toString('base64url'),
    owner: existing.owner ?? randomBytes(24).toString('base64url'),
    app: existing.app ?? randomBytes(24).toString('base64url'),
    contextKey: existing.contextKey ?? randomBytes(32).toString('hex'),
    authSecret: existing.authSecret ?? randomBytes(32).toString('hex'),
  };
  writeFileSync(CREDENTIALS, JSON.stringify(full, null, 2), { mode: 0o600 });
  return full;
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
await installContextKey(urls.ownerUrl, creds.contextKey);
upsertEnv(ENV_FILE, {
  DATABASE_URL: urls.appUrl,
  DATABASE_OWNER_URL: urls.ownerUrl,
  DATABASE_SUPERUSER_URL: superuserUrl.replace(/\/postgres$/, '/fasal'),
  DB_CONTEXT_KEY: creds.contextKey,
  AUTH_SECRET: creds.authSecret,
});

// Serve the newest committed bundle release, so the API has prices from the first start.
const latest = latestPipelineVersion();
let bundles = 'no bundle release found (run `pnpm ml:pipeline`, then `pnpm bundles:publish`)';
if (latest !== null) {
  const { release } = await publish(latest, { ownerUrl: urls.ownerUrl, env: process.env });
  bundles = `bundle release ${release.version} loaded (${release.bundles.length} crop × district bundles, ${release.dataSource} data)`;
}

process.stdout.write(
  `PostgreSQL is running on 127.0.0.1:${PORT} (database "fasal").\n` +
    `  migrations: ${result.applied.length} applied, ${result.alreadyApplied.length} already applied\n` +
    '  request-context key installed; credentials and keys are in .env\n' +
    `  ${bundles}\n` +
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
