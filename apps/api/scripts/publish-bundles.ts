/**
 * `pnpm bundles:publish [--version YYYY-MM-DD.N] [--no-load]` — turn a pipeline run into a
 * release: verify every Python seal in TypeScript, compose and re-seal each bundle, write the
 * served bytes under data/bundles/<version>/published, print the size budget, and load the
 * release into PostgreSQL as the owner role (when DATABASE_OWNER_URL is set).
 */
import { loadEnvIfPresent } from './lib/envfile.js';
import { ENV_FILE } from './lib/paths.js';
import { latestPipelineVersion, publish } from './lib/release.js';

loadEnvIfPresent(ENV_FILE);
const args = process.argv.slice(2);
const flag = args.indexOf('--version');
const version = flag >= 0 ? args[flag + 1] : latestPipelineVersion();
if (version === undefined || version === null) {
  process.stderr.write('No pipeline run found under data/bundles. Run `pnpm ml:pipeline` first.\n');
  process.exit(1);
}
const load = !args.includes('--no-load');
const ownerUrl = load ? process.env['DATABASE_OWNER_URL'] : undefined;
const { report, root } = await publish(version, { ownerUrl, env: process.env });
process.stdout.write(`${report}\n\nWritten to ${root}\n`);
process.stdout.write(ownerUrl ? 'Loaded into PostgreSQL as the current release.\n' : 'Not loaded into PostgreSQL (no DATABASE_OWNER_URL, or --no-load).\n');
