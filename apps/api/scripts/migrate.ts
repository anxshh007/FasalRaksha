/** `pnpm db:migrate` — apply pending migrations as the owner role (DATABASE_OWNER_URL). */
import { migrate } from '../src/db/migrate.js';
import { loadEnvIfPresent } from './lib/envfile.js';
import { ENV_FILE, MIGRATIONS_DIR } from './lib/paths.js';

loadEnvIfPresent(ENV_FILE);
const ownerUrl = process.env['DATABASE_OWNER_URL'];
if (ownerUrl === undefined || ownerUrl === '') {
  process.stderr.write('DATABASE_OWNER_URL is not set. Run `pnpm db:start` (local) or `pnpm db:bootstrap` (docker) first.\n');
  process.exit(1);
}
const result = await migrate(ownerUrl, MIGRATIONS_DIR);
for (const file of result.alreadyApplied) process.stdout.write(`  already applied  ${file}\n`);
for (const file of result.applied) process.stdout.write(`  applied          ${file}\n`);
process.stdout.write(`${result.applied.length} applied, ${result.alreadyApplied.length} already applied.\n`);
