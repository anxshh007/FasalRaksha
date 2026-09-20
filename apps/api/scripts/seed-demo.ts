/**
 * `pnpm db:seed-demo` — the demonstration's counterparties, against a database that already has
 * its migrations and a bundle release: the §16 traders with their verifications and completed-deal
 * histories, their demand priced against the loaded release, and the Kadwa Valley consignment
 * two quintals short of its buyer's minimum (§16.1; CUTS C-09, C-11).
 *
 * `pnpm db:start` does this for the local cluster as part of starting it. This is the same seed
 * for a deployed database, which has no such start-up step. It is idempotent: traders already
 * present are left alone and only their demand is re-priced against the current release.
 *
 * A production deployment simply never runs it. Nothing else creates these rows, and every screen
 * that shows one of them says it is a demonstration.
 */
import { seedDemand } from './lib/demand-seed.js';
import { loadEnvIfPresent } from './lib/envfile.js';
import { ENV_FILE } from './lib/paths.js';
import { latestPipelineVersion } from './lib/release.js';

loadEnvIfPresent(ENV_FILE);

const ownerUrl = process.env['DATABASE_OWNER_URL'];
if (ownerUrl === undefined || ownerUrl === '') {
  process.stderr.write('DATABASE_OWNER_URL is not set. The seed writes as the owner role, never as the application role.\n');
  process.exit(1);
}

const version = process.env['BUNDLE_VERSION'] ?? latestPipelineVersion();
if (version === null || version === undefined) {
  process.stderr.write('No bundle release found under data/bundles. Run `pnpm bundles:publish` first: the demand is priced against it.\n');
  process.exit(1);
}

const result = await seedDemand(ownerUrl, version);
process.stdout.write(
  `Demonstration data seeded against release ${version}.\n` +
    `  buyers: ${result.buyers} (${result.created ? `created, with ${result.completedDeals} completed deals of history` : 'already present'})\n` +
    `  requirements placed: ${result.requirements}\n` +
    'Every screen that shows one of these says it is a demonstration buyer.\n',
);
