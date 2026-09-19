/**
 * SEC-14 · FR-08 — the bundle publisher, against the pipeline run committed under data/bundles.
 * Every Python seal must verify in TypeScript; a tampered or substituted core stops the release.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseCropBundle, verifyIntegrity, type CropProfile } from '@fasal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockStorageRegistryAdapter } from '../src/adapters/storage-registry/storage-registry.js';
import { MockTransportTariffAdapter } from '../src/adapters/transport-tariff/transport-tariff.js';
import { buildRelease, districtSizes, PublishError, type PublishSources, type Release } from '../src/modules/bundles/publish.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const BUNDLES = join(ROOT, 'data', 'bundles');
const VERSION = readdirSync(BUNDLES).filter((d) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(d)).sort().at(-1) ?? '';
const PIPELINE = join(BUNDLES, VERSION, 'pipeline');

const sources: PublishSources = {
  storage: new MockStorageRegistryAdapter(),
  transport: new MockTransportTariffAdapter(),
  crops: JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'crops.json'), 'utf8')) as { version: string; crops: CropProfile[] },
};

let release: Release;
let scratch: string;

beforeAll(async () => {
  release = await buildRelease(PIPELINE, sources);
  scratch = mkdtempSync(join(tmpdir(), 'fasal-bundles-'));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function copyPipeline(): string {
  const dir = join(scratch, `p-${Math.random().toString(36).slice(2)}`);
  cpSync(PIPELINE, dir, { recursive: true });
  return dir;
}

describe('SEC-14 · the release is built only from seals that verify', () => {
  it('verifies every Python-sealed core and publishes one bundle per core', () => {
    const manifest = JSON.parse(readFileSync(join(PIPELINE, 'manifest.json'), 'utf8')) as { cores: unknown[] };
    expect(release.bundles).toHaveLength(manifest.cores.length);
    for (const b of release.bundles) {
      expect(verifyIntegrity(b.document)).toBe(true);
      expect(parseCropBundle(JSON.parse(b.body))).toEqual(b.bundle);
    }
  });

  it('stops when a core was altered after the pipeline sealed it', async () => {
    const dir = copyPipeline();
    const path = join(dir, 'core', 'onion__nashik.json');
    const core = JSON.parse(readFileSync(path, 'utf8')) as { benchmark: { modal: number } };
    core.benchmark.modal += 100;
    writeFileSync(path, JSON.stringify(core));
    await expect(buildRelease(dir, sources)).rejects.toThrow(/does not verify in TypeScript/);
  });

  it('stops when a core was swapped for another validly sealed one', async () => {
    const dir = copyPipeline();
    cpSync(join(dir, 'core', 'tomato__nashik.json'), join(dir, 'core', 'onion__nashik.json'));
    await expect(buildRelease(dir, sources)).rejects.toThrow(PublishError);
  });

  it('stops when the pipeline manifest itself was edited', async () => {
    const dir = copyPipeline();
    const path = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dataSource: string };
    manifest.dataSource = 'agmarknet'; // passing synthetic data off as real
    writeFileSync(path, JSON.stringify(manifest));
    await expect(buildRelease(dir, sources)).rejects.toThrow(/manifest/);
  });
});

describe('FR-08 · what the publisher adds is exactly what the pipeline does not own', () => {
  const bundle = (crop: string, district: string) => {
    const found = release.bundles.find((b) => b.bundle.crop === crop && b.bundle.district === district);
    if (found === undefined) throw new Error(`${crop} × ${district} not in the release`);
    return found.bundle;
  };

  it('MSP comes from the one constants module, with its season; crops without an MSP carry null', () => {
    expect(bundle('soybean', 'latur').msp).toEqual({ amountPerQuintal: 5328, season: 'KMS 2025-26' });
    expect(bundle('onion', 'nashik').msp).toBeNull();
  });

  it('storage lists only facilities in the district that take this crop', () => {
    const onion = bundle('onion', 'nashik');
    expect(onion.storage.length).toBeGreaterThan(0);
    for (const f of onion.storage) {
      expect(f.district).toBe('nashik');
      expect(f.crops).toContain('onion');
    }
  });

  it('a withheld crop keeps its prices and loses its forecast', () => {
    const grapes = bundle('grapes', 'nashik');
    expect(grapes.status).toBe('insufficient');
    expect(grapes.forecast).toBeNull();
    expect(grapes.benchmark.modal).toBeGreaterThan(0);
  });

  it('the manifest lists every document by its integrity, and says the data is synthetic', () => {
    const manifest = JSON.parse(release.manifest.body) as { dataSource: string; bundles: { integrity: string }[]; shared: { name: string }[] };
    expect(manifest.dataSource).toBe('synthetic');
    expect(manifest.bundles.map((b) => b.integrity)).toEqual(release.bundles.map((b) => b.integrity));
    expect(manifest.shared.map((s) => s.name)).toEqual(expect.arrayContaining(['crops', 'msp', 'climatology/nashik']));
  });

  it('every single crop bundle is about 1 KB on the wire (PROMPT §5.8 budget: ~2 KB)', () => {
    for (const b of release.bundles) expect(b.gzipBytes).toBeLessThan(2048);
    const sizes = districtSizes(release);
    expect(sizes.map((d) => d.district)).toEqual(['ahilyanagar', 'jalgaon', 'latur', 'nagpur', 'nashik', 'pune']);
  });
});
