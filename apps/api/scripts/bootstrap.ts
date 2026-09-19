/**
 * `pnpm db:bootstrap` — for a PostgreSQL you already run (docker-compose, CI service,
 * managed instance): create the roles and database with fresh passwords, apply migrations,
 * install the request-context key, and write DATABASE_URL / DATABASE_OWNER_URL /
 * DB_CONTEXT_KEY / AUTH_SECRET into the gitignored `.env` (existing keys are kept).
 *
 * Needs DATABASE_SUPERUSER_URL. Optional DATABASE_NAME (default `fasal`).
 */
import { randomBytes } from 'node:crypto';

import { bootstrapDatabase, installContextKey } from '../src/db/bootstrap.js';
import { migrate } from '../src/db/migrate.js';
import { loadEnvIfPresent, upsertEnv } from './lib/envfile.js';
import { ENV_FILE, MIGRATIONS_DIR } from './lib/paths.js';

loadEnvIfPresent(ENV_FILE);
const superuserUrl = process.env['DATABASE_SUPERUSER_URL'];
if (superuserUrl === undefined || superuserUrl === '') {
  process.stderr.write('DATABASE_SUPERUSER_URL is not set (for docker-compose: postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres).\n');
  process.exit(1);
}
const database = process.env['DATABASE_NAME'] ?? 'fasal';
const contextKey = process.env['DB_CONTEXT_KEY'] || randomBytes(32).toString('hex');
const authSecret = process.env['AUTH_SECRET'] || randomBytes(32).toString('hex');
const urls = await bootstrapDatabase(superuserUrl, {
  database,
  ownerPassword: randomBytes(24).toString('base64url'),
  appPassword: randomBytes(24).toString('base64url'),
});
const result = await migrate(urls.ownerUrl, MIGRATIONS_DIR);
await installContextKey(urls.ownerUrl, contextKey);
upsertEnv(ENV_FILE, { DATABASE_URL: urls.appUrl, DATABASE_OWNER_URL: urls.ownerUrl, DB_CONTEXT_KEY: contextKey, AUTH_SECRET: authSecret });
process.stdout.write(`Database "${database}" ready: ${result.applied.length} migration(s) applied, context key installed. Credentials written to .env.\n`);
