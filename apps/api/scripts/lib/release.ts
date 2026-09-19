/**
 * Build a bundle release from the pipeline's output, write the served bytes to disk, and
 * optionally load it into PostgreSQL. Shared by `pnpm bundles:publish` and `pnpm db:start`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CropProfile } from '@fasal/shared';

import { MockStorageRegistryAdapter } from '../../src/adapters/storage-registry/storage-registry.js';
import { MockTransportTariffAdapter } from '../../src/adapters/transport-tariff/transport-tariff.js';
import { createAdapters } from '../../src/adapters/index.js';
import { loadConfig } from '../../src/config.js';
import { buildRelease, districtSizes, type PublishSources, type Release } from '../../src/modules/bundles/publish.js';
import { loadRelease } from '../../src/modules/bundles/store.js';
import { REPO_ROOT } from './paths.js';

export const BUNDLES_DIR = join(REPO_ROOT, 'data', 'bundles');

/** The newest version directory that holds a pipeline run. */
export function latestPipelineVersion(): string | null {
  if (!existsSync(BUNDLES_DIR)) return null;
  const versions = readdirSync(BUNDLES_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(name) && existsSync(join(BUNDLES_DIR, name, 'pipeline', 'manifest.json')))
    .sort((a, b) => {
      const [da = '', na = '0'] = a.split('.');
      const [db = '', nb = '0'] = b.split('.');
      return da === db ? Number(na) - Number(nb) : da < db ? -1 : 1;
    });
  return versions.at(-1) ?? null;
}

/** Storage and transport as `.env` names them. Live adapters need the full, validated config. */
export function publishSources(env: Readonly<Record<string, string | undefined>>): PublishSources & { describe: string } {
  const crops = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'reference', 'crops.json'), 'utf8')) as { version: string; crops: CropProfile[] } & Record<string, unknown>;
  if (env['STORAGE_ADAPTER'] === 'live' || env['TRANSPORT_ADAPTER'] === 'live') {
    const adapters = createAdapters(loadConfig(env), REPO_ROOT);
    return { storage: adapters.storage, transport: adapters.transport, crops, describe: `storage ${adapters.storage.mode}, transport ${adapters.transport.mode}` };
  }
  return { storage: new MockStorageRegistryAdapter(), transport: new MockTransportTariffAdapter(), crops, describe: 'storage mock, transport mock' };
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

/** Write exactly the bytes the API serves, so what is committed is what a phone receives. */
export function writeRelease(release: Release): string {
  const root = join(BUNDLES_DIR, release.version, 'published');
  for (const b of release.bundles) write(join(root, 'bundles', `${b.bundle.crop}__${b.bundle.district}.json`), b.body);
  for (const s of release.shared) write(join(root, 'shared', `${s.name}.json`), s.body);
  write(join(root, 'manifest.json'), release.manifest.body);
  return root;
}

export function formatRelease(release: Release, adapters: string): string {
  const lines = [
    `BUNDLE RELEASE ${release.version} (${release.dataSource} data, as of ${release.asOf}; ${adapters})`,
    `Python seals verified in TypeScript: ${release.bundles.length} cores, ${release.shared.filter((s) => s.name.startsWith('climatology/')).length} climatology — every served document re-sealed and re-verified`,
    '',
    `${'crop × district'.padEnd(28)}${'status'.padEnd(14)}${'as of'.padEnd(12)}${'bytes'.padStart(7)}${'gzip'.padStart(7)}  integrity`,
  ];
  for (const b of release.bundles) {
    lines.push(`${`${b.bundle.crop} × ${b.bundle.district}`.padEnd(28)}${b.bundle.status.padEnd(14)}${b.bundle.asOf.padEnd(12)}${String(b.bytes).padStart(7)}${String(b.gzipBytes).padStart(7)}  ${b.integrity.slice(0, 19)}…`);
  }
  lines.push('', 'Per district — a farmer\'s own district, every crop in it (PROMPT §5.8 budget: ~2 KB):');
  for (const d of districtSizes(release)) {
    lines.push(`  ${d.district.padEnd(14)}${String(d.crops).padStart(2)} crop(s)  ${String(d.bytes).padStart(6)} B raw  ${String(d.gzipBytes).padStart(5)} B gzip  (largest single bundle ${d.largest} B gzip)`);
  }
  lines.push('', 'Shared:');
  for (const s of release.shared) lines.push(`  ${s.name.padEnd(26)}${String(s.bytes).padStart(7)} B raw ${String(s.gzipBytes).padStart(6)} B gzip`);
  lines.push(`  ${'manifest'.padEnd(26)}${String(release.manifest.bytes).padStart(7)} B raw ${String(release.manifest.gzipBytes).padStart(6)} B gzip`);
  return lines.join('\n');
}

export async function publish(version: string, options: { ownerUrl?: string | undefined; env: Readonly<Record<string, string | undefined>> }): Promise<{ release: Release; report: string; root: string }> {
  const sources = publishSources(options.env);
  const release = await buildRelease(join(BUNDLES_DIR, version, 'pipeline'), sources);
  const root = writeRelease(release);
  if (options.ownerUrl !== undefined && options.ownerUrl !== '') await loadRelease(options.ownerUrl, release);
  return { release, report: formatRelease(release, sources.describe), root };
}
