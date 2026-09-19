/**
 * SEC-14 · FR-08 · P7 gate — bundle serving against a real PostgreSQL: ETag equals integrity,
 * If-None-Match costs no bytes, the served body is the canonical document the device verifies,
 * a row altered in the database is refused rather than served, and the application role
 * cannot write a bundle at all.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { canonicalJson, parseCropBundle, verifyIntegrity, type CropProfile } from '@fasal/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockStorageRegistryAdapter } from '../src/adapters/storage-registry/storage-registry.js';
import { MockTransportTariffAdapter } from '../src/adapters/transport-tariff/transport-tariff.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import { buildRelease, type Release } from '../src/modules/bundles/publish.js';
import { loadRelease } from '../src/modules/bundles/store.js';
import { createKeyRing } from '../src/security/keys.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const BUNDLES = join(ROOT, 'data', 'bundles');
const VERSION = readdirSync(BUNDLES).filter((d) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(d)).sort().at(-1) ?? '';

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;
let release: Release;

async function asSuperuser<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: db.seedUrl });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
  const keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys });
  await app.ready();
  release = await buildRelease(join(BUNDLES, VERSION, 'pipeline'), {
    storage: new MockStorageRegistryAdapter(),
    transport: new MockTransportTariffAdapter(),
    crops: JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'crops.json'), 'utf8')) as { version: string; crops: CropProfile[] },
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('FR-08 · before any release, the API says so instead of inventing prices', () => {
  it('answers 503 with a farmer-readable reason', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bundles/onion/nashik' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'NO_BUNDLE_RELEASE' } });
  });
});

describe('P7 · serving a release', () => {
  beforeAll(async () => {
    await loadRelease(db.ownerUrl, release);
  });

  it('serves the manifest with its integrity as the ETag', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bundles/manifest' });
    expect(response.statusCode).toBe(200);
    const manifest = response.json<Record<string, unknown>>();
    expect(verifyIntegrity(manifest)).toBe(true);
    expect(response.headers['etag']).toBe(`"${String(manifest['integrity'])}"`);
    expect(response.headers['x-bundle-version']).toBe(VERSION);
  });

  it('serves a crop bundle as its canonical bytes, which verify and parse', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bundles/onion/nashik' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['cache-control']).toBe('no-cache');
    const document = JSON.parse(response.body) as Record<string, unknown>;
    expect(canonicalJson(document)).toBe(response.body);
    expect(verifyIntegrity(document)).toBe(true);
    expect(parseCropBundle(document).crop).toBe('onion');
    const committed = readFileSync(join(BUNDLES, VERSION, 'published', 'bundles', 'onion__nashik.json'), 'utf8');
    expect(response.body).toBe(committed); // disk, database and wire: the same bytes
  });

  it('answers If-None-Match with 304 and no body — a revalidation costs no bundle bytes', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/bundles/onion/nashik' });
    const etag = String(first.headers['etag']);
    const again = await app.inject({ method: 'GET', url: '/api/bundles/onion/nashik', headers: { 'if-none-match': `W/${etag}` } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    const stale = await app.inject({ method: 'GET', url: '/api/bundles/onion/nashik', headers: { 'if-none-match': '"sha256-0000"' } });
    expect(stale.statusCode).toBe(200);
  });

  it('serves the shared bundles: crop dictionary, MSP and district climatology', async () => {
    for (const url of ['/api/bundles/shared/crops', '/api/bundles/shared/msp', '/api/bundles/shared/climatology/nashik']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(verifyIntegrity(response.json<Record<string, unknown>>())).toBe(true);
    }
  });

  it('refuses an unknown crop with 404 and a malformed one with 422', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/bundles/saffron/nashik' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/bundles/Onion%27--/nashik' })).statusCode).toBe(422);
  });

  it('records the measured layer weights beside the bundle', async () => {
    const rows = await asSuperuser(async (c) => (await c.query<{ n: string }>("SELECT count(*) AS n FROM app.raksha_signals WHERE crop = 'onion' AND district = 'nashik'")).rows);
    expect(Number(rows[0]?.n)).toBe(6);
  });
});

describe('SEC-14 · a bundle altered in the database is refused, not served', () => {
  it('returns 500 BUNDLE_INTEGRITY_FAILED when a stored price was changed', async () => {
    await asSuperuser((c) =>
      c.query(`UPDATE app.forecast_bundles SET payload = jsonb_set(payload, '{benchmark,modal}', to_jsonb((payload #>> '{benchmark,modal}')::numeric + 500))
               WHERE crop = 'tomato' AND district = 'pune'`),
    );
    const response = await app.inject({ method: 'GET', url: '/api/bundles/tomato/pune' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'BUNDLE_INTEGRITY_FAILED' } });
  });

  it('the application role cannot write a bundle at all', async () => {
    const client = await pool.connect();
    try {
      await expect(client.query("UPDATE app.forecast_bundles SET status = 'published' WHERE crop = 'grapes'")).rejects.toThrow(/permission denied/);
      await expect(client.query("INSERT INTO app.bundle_releases (version, as_of, data_source, manifest, integrity) VALUES ('2099-01-01.1', '2099-01-01', 'synthetic', '{}', 'sha256-" + '0'.repeat(64) + "')")).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });
});
