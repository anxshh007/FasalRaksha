/**
 * The bundle publisher (PROMPT §5.8, P7). It turns one pipeline run into one release:
 *
 *   1. read the pipeline's manifest and every core it lists, and verify each Python-sealed hash
 *      with the TypeScript implementation. This is the Python↔TypeScript parity check, run on
 *      every real artefact rather than only on golden vectors. A single mismatch stops the release;
 *   2. compose each crop × district bundle from its core plus what the pipeline does not own:
 *      MSP from the one constants module, and storage and transport from their adapters;
 *   3. parse the result with the shared strict parser (the device runs the same one), seal it and
 *      verify the seal;
 *   4. seal the shared bundles (crop dictionary, MSP, district climatology) and the manifest the
 *      device syncs from.
 *
 * The served body of every document is its canonical JSON, so the bytes on disk, in the
 * database and on the wire hash identically, and the ETag is simply the integrity.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  BUNDLE_SCHEMA_VERSION,
  canonicalJson,
  computeIntegrity,
  MSP_TABLE,
  mspEntry,
  parseCropBundle,
  verifyIntegrity,
  type CropBundle,
  type CropProfile,
} from '@fasal/shared';

import type { StorageRegistryAdapter } from '../../adapters/storage-registry/storage-registry.js';
import type { TransportTariffAdapter } from '../../adapters/transport-tariff/transport-tariff.js';

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

type Doc = Record<string, unknown>;

export interface SealedDocument {
  /** `crop/district` for a crop bundle; `crops`, `msp` or `climatology/<district>` for a shared one. */
  name: string;
  document: Doc;
  integrity: string;
  /** The exact served bytes. */
  body: string;
  bytes: number;
  gzipBytes: number;
}

export interface Release {
  version: string;
  asOf: string;
  generatedAt: string;
  dataSource: string;
  bundles: (SealedDocument & { bundle: CropBundle })[];
  shared: SealedDocument[];
  manifest: SealedDocument;
}

export interface PublishSources {
  storage: StorageRegistryAdapter;
  transport: TransportTariffAdapter;
  /** The crop dictionary (`data/reference/crops.json`). */
  crops: { version: string; crops: CropProfile[] } & Doc;
  /** The district registry (`data/reference/districts.json`): names, markets, coordinates. */
  districts: { version: string } & Doc;
}

function seal(content: Doc): Doc {
  const { integrity: _drop, ...rest } = content;
  return { ...rest, integrity: computeIntegrity(rest) };
}

export function sealed(name: string, document: Doc): SealedDocument {
  if (!verifyIntegrity(document)) throw new PublishError(`${name}: its content does not match its integrity hash`);
  const body = canonicalJson(document);
  return { name, document, integrity: document['integrity'] as string, body, bytes: Buffer.byteLength(body), gzipBytes: gzipSync(body, { level: 9 }).length };
}

async function readJson(path: string): Promise<Doc> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new PublishError(`${path}: not a JSON object`);
  return parsed as Doc;
}

interface ManifestEntry {
  crop?: string;
  district: string;
  file: string;
  integrity: string;
}

function entries(value: unknown, what: string): ManifestEntry[] {
  if (!Array.isArray(value)) throw new PublishError(`pipeline manifest: ${what} is not a list`);
  return value.map((item: unknown) => {
    const e = item as Partial<ManifestEntry>;
    if (typeof e.district !== 'string' || typeof e.file !== 'string' || typeof e.integrity !== 'string' || !/^[a-z]+\/[a-z0-9_-]+\.json$/.test(e.file)) {
      throw new PublishError(`pipeline manifest: a ${what} entry is malformed`);
    }
    return e as ManifestEntry;
  });
}

/** Compose, parse and seal one crop × district bundle. */
export async function composeBundle(core: Doc, sources: PublishSources): Promise<CropBundle> {
  const crop = String(core['crop']);
  const district = String(core['district']);
  const profile = sources.crops.crops.find((c) => c.id === crop);
  if (profile === undefined) throw new PublishError(`${crop} × ${district}: the crop is not in the dictionary`);
  const msp = mspEntry(profile.mspKey);
  const storage = (await sources.storage.facilities(district)).filter((f) => f.crops.includes(crop) && f.capacityAvailableQtl > 0);
  const transport = await sources.transport.tariffs(district);
  const { integrity: _core, ...content } = core;
  const bundle = parseCropBundle(seal({ ...content, msp: msp === null ? null : { amountPerQuintal: msp.amountPerQuintal, season: msp.season }, storage, transport }));
  if (!verifyIntegrity(bundle as unknown as Doc)) throw new PublishError(`${crop} × ${district}: sealed bundle failed its own integrity check`);
  return bundle;
}

/** Build a release from `data/bundles/<version>/pipeline`. Nothing is written. */
export async function buildRelease(pipelineDir: string, sources: PublishSources): Promise<Release> {
  const manifest = await readJson(join(pipelineDir, 'manifest.json'));
  if (!verifyIntegrity(manifest)) throw new PublishError('pipeline manifest: its content does not match its integrity hash (Python and TypeScript disagree, or it was altered)');
  const version = String(manifest['version']);
  const asOf = String(manifest['asOf']);
  const generatedAt = String(manifest['generatedAt']);
  const dataSource = String(manifest['dataSource']);

  const bundles: Release['bundles'] = [];
  for (const entry of entries(manifest['cores'], 'core')) {
    const core = await readJson(join(pipelineDir, entry.file));
    if (!verifyIntegrity(core)) throw new PublishError(`${entry.file}: the Python seal does not verify in TypeScript`);
    if (core['integrity'] !== entry.integrity) throw new PublishError(`${entry.file}: not the core the pipeline manifest lists`);
    if (core['version'] !== version) throw new PublishError(`${entry.file}: belongs to release ${String(core['version'])}, not ${version}`);
    const bundle = await composeBundle(core, sources);
    bundles.push({ ...sealed(`${bundle.crop}/${bundle.district}`, bundle as unknown as Doc), bundle });
  }

  const shared: SealedDocument[] = [];
  for (const entry of entries(manifest['climatology'], 'climatology')) {
    const document = await readJson(join(pipelineDir, entry.file));
    if (document['integrity'] !== entry.integrity) throw new PublishError(`${entry.file}: not the climatology the pipeline manifest lists`);
    shared.push(sealed(`climatology/${entry.district}`, document));
  }
  shared.push(sealed('crops', seal({ schemaVersion: BUNDLE_SCHEMA_VERSION, kind: 'crops', version, generatedAt, dictionary: sources.crops })));
  shared.push(sealed('districts', seal({ schemaVersion: BUNDLE_SCHEMA_VERSION, kind: 'districts', version, generatedAt, registry: sources.districts })));
  shared.push(
    sealed(
      'msp',
      seal({
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        kind: 'msp',
        version,
        generatedAt,
        source: MSP_TABLE.source,
        verified: MSP_TABLE.verified,
        note: MSP_TABLE.note ?? null,
        entries: MSP_TABLE.value.map((e) => ({ ...e })),
      }),
    ),
  );

  const served = seal({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    kind: 'manifest',
    version,
    generatedAt,
    asOf,
    dataSource,
    bundles: bundles.map((b) => ({ crop: b.bundle.crop, district: b.bundle.district, status: b.bundle.status, asOf: b.bundle.asOf, integrity: b.integrity, bytes: b.bytes, gzipBytes: b.gzipBytes })),
    shared: shared.map((s) => ({ name: s.name, integrity: s.integrity, bytes: s.bytes, gzipBytes: s.gzipBytes })),
  });
  return { version, asOf, generatedAt, dataSource, bundles, shared, manifest: sealed('manifest', served) };
}

/** The per-district byte budget the P7 gate prints: a farmer's own district, every crop in it. */
export function districtSizes(release: Release): { district: string; crops: number; bytes: number; gzipBytes: number; largest: number }[] {
  const byDistrict = new Map<string, { crops: number; bytes: number; gzipBytes: number; largest: number }>();
  for (const b of release.bundles) {
    const row = byDistrict.get(b.bundle.district) ?? { crops: 0, bytes: 0, gzipBytes: 0, largest: 0 };
    row.crops++;
    row.bytes += b.bytes;
    row.gzipBytes += b.gzipBytes;
    row.largest = Math.max(row.largest, b.gzipBytes);
    byDistrict.set(b.bundle.district, row);
  }
  return [...byDistrict.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([district, row]) => ({ district, ...row }));
}
