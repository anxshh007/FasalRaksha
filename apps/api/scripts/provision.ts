/**
 * `pnpm db:provision` — prepare a **managed** PostgreSQL (Render, Neon, Supabase, RDS) that you
 * were handed as a single connection string: create the two roles, grant them what they need,
 * apply every migration as the owner, install the request-context key, and print the environment
 * the API needs. `pnpm db:bootstrap` is the same thing for a cluster you control, where the
 * database itself still has to be created.
 *
 * Needs DATABASE_ADMIN_URL — the platform's own connection string, database included. The API
 * must never use it: that role owns the relations, and an owner is not bound by row-level
 * security, so the API refuses to start as it (ARCH-03).
 *
 *   DATABASE_ADMIN_URL=postgres://user:pass@host/db pnpm db:provision          (bash)
 *   set "DATABASE_ADMIN_URL=postgres://…" && pnpm db:provision                 (cmd.exe)
 *   $env:DATABASE_ADMIN_URL="postgres://…"; pnpm db:provision                  (PowerShell)
 *
 * Idempotent: running it again re-asserts the roles, rotates their passwords (so it prints a new
 * DATABASE_URL, which must be pasted back) and applies only the migrations that are pending.
 *
 * The secrets are generated fresh unless you put them in the *environment* — a deployment must
 * not inherit the development ones that happen to be sitting in the repository's `.env`. Set
 * DB_CONTEXT_KEY and AUTH_SECRET yourself when re-provisioning a deployment that already runs
 * with them: rotating either one signs every existing session and actor assertion out.
 */
import { randomBytes } from 'node:crypto';

import { installContextKey, provisionDatabase } from '../src/db/bootstrap.js';
import { migrate } from '../src/db/migrate.js';
import { loadEnvIfPresent } from './lib/envfile.js';
import { ENV_FILE, MIGRATIONS_DIR } from './lib/paths.js';

// What the operator actually typed, before `.env` fills the gaps: `.env` is this machine's
// development database, and its secrets must not silently become a deployment's.
const shell = { ...process.env };
loadEnvIfPresent(ENV_FILE);

const adminUrl = process.env['DATABASE_ADMIN_URL'];
if (adminUrl === undefined || adminUrl === '') {
  process.stderr.write('DATABASE_ADMIN_URL is not set — the connection string the platform gave you, database included.\n');
  process.exit(1);
}

const contextKey = shell['DB_CONTEXT_KEY'] || randomBytes(32).toString('hex');
const authSecret = shell['AUTH_SECRET'] || randomBytes(32).toString('hex');

const urls = await provisionDatabase(adminUrl, {
  ownerPassword: randomBytes(24).toString('base64url'),
  appPassword: randomBytes(24).toString('base64url'),
});
const result = await migrate(urls.ownerUrl, MIGRATIONS_DIR);
await installContextKey(urls.ownerUrl, contextKey);

process.stdout.write(`\nRoles created, ${result.applied.length} migration(s) applied, ${result.alreadyApplied.length} already applied, context key installed.\n`);
process.stdout.write('\nGive the API service these, and keep them out of the repository:\n\n');
process.stdout.write(`DATABASE_URL=${urls.appUrl}\nDB_CONTEXT_KEY=${contextKey}\nAUTH_SECRET=${authSecret}\n`);
process.stdout.write('\nAnd keep this one for yourself — it runs migrations, publishes releases and seeds; the API never sees it:\n\n');
process.stdout.write(`DATABASE_OWNER_URL=${urls.ownerUrl}\n\n`);
process.stdout.write('Next, against the same database:\n');
process.stdout.write('  DATABASE_OWNER_URL=… pnpm bundles:publish     # the prices and forecasts the phone verifies\n');
process.stdout.write('  DATABASE_OWNER_URL=… pnpm db:seed-demo        # the demonstration traders, only for a demonstration\n');
