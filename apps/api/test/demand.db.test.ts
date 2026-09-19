/**
 * FR-09 · Gate F · P1-01 · P1-05 — demand for the phone, against a real PostgreSQL: the §16
 * buyers seeded into the real tables, their track records computed from completed deals only,
 * served as a verifiable document with nothing private in it, and ranked by the shared engine
 * into the §16.2 order: A above C above B, B's higher price undone by its payment record.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { explainOrder, FINANCE_RATE_ANNUAL_DEFAULT, rankBuyers, roadKm, verifyIntegrity, type BuyerProfile, type BuyerRequirement, type CropBundle, type CropDictionary, type DistrictRegistry } from '@fasal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import type { DemandDocument } from '../src/modules/demand/service.js';
import { createKeyRing, type KeyRing } from '../src/security/keys.js';
import { issueAccessToken } from '../src/security/tokens.js';
import { demoId, seedDemand } from '../scripts/lib/demand-seed.js';
import { latestPipelineVersion } from '../scripts/lib/release.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';
import { seedWorld, type SeededWorld } from './support/seed.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const VERSION = latestPipelineVersion() ?? '';
const bundle = JSON.parse(readFileSync(join(ROOT, 'data', 'bundles', VERSION, 'published', 'bundles', 'onion__nashik.json'), 'utf8')) as CropBundle;
const dictionary = (JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'crops.json'), 'utf8')) as { dictionary?: CropDictionary } & CropDictionary);
const registryRaw = JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'districts.json'), 'utf8')) as { registry?: DistrictRegistry } & DistrictRegistry;
const registry = registryRaw.registry ?? registryRaw;

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;
let keys: KeyRing;
let world: SeededWorld;

/** The app runs on the release's date, so validity windows are deterministic; tokens are issued on the same clock. */
const NOW = new Date(`${bundle.asOf}T06:00:00Z`);
const bearer = (userId: string, role: 'farmer' | 'buyer') => ({ authorization: `Bearer ${issueAccessToken(keys, { userId, role, sessionId: randomUUID() }, Math.floor(NOW.getTime() / 1000))}` });
const demand = async (district: string, userId = world.farmerA) => app.inject({ method: 'GET', url: `/api/demand/${district}`, headers: bearer(userId, 'farmer') });
const doc = async (district: string) => (await demand(district)).json() as DemandDocument;
/** Seeded traders by their stable id: the shared test world has its own buyers with some of the same names. */
const seeded = (d: DemandDocument, key: string) => d.buyers.find((b) => b.id === demoId(`buyer:${key}`));

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  world = await seedWorld(db.seedUrl);
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
  keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys, now: () => NOW });
  await app.ready();
  await seedDemand(db.ownerUrl, VERSION, NOW);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('FR-09 · the demonstration buyers are real rows, seeded once', () => {
  it('a second seed creates no one and places the same demand again, once', async () => {
    const before = (await doc('nashik')).requirements.length;
    const again = await seedDemand(db.ownerUrl, VERSION, NOW);
    expect(again.created).toBe(false);
    expect(again.buyers).toBe(13);
    const after = await doc('nashik');
    expect(after.requirements).toHaveLength(before); // replaced, not duplicated
    expect(seeded(after, 'godavari')?.history.completedDeals).toBe(23); // history not re-seeded
  });
});

describe('FR-09 · the demand document', () => {
  it('names the district\'s buyers and their requirements, verifiably, and nothing from elsewhere', async () => {
    const response = await demand('nashik');
    expect(response.statusCode).toBe(200);
    const d = response.json() as DemandDocument;
    expect(verifyIntegrity(d as unknown as Record<string, unknown>)).toBe(true);
    expect(response.headers['etag']).toBe(`"${d.integrity}"`);
    const names = d.buyers.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(['Godavari Agro Traders', 'Deccan Exports', 'Niphad Traders', 'Manmad Fresh Buyers', 'Yeola Cotton Ginning']));
    expect(names).not.toContain('Manjara Oilseeds & Pulses'); // Latur, out of reach
    // The seeded traders say they are demonstration buyers; the test world's own buyers do not.
    const keys = ['godavari', 'deccan', 'niphad', 'manmad', 'yeola-cotton', 'pimpalgaon-tomato'];
    expect(keys.map((k) => seeded(d, k)?.demonstration)).toEqual(keys.map(() => true));
    const everySeeded = (JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'demo-buyers.json'), 'utf8')) as { buyers: { key: string }[] }).buyers;
    const ids = new Set(everySeeded.map((b) => demoId(`buyer:${b.key}`)));
    expect(d.buyers.filter((b) => !ids.has(b.id)).every((b) => !b.demonstration)).toBe(true);
    expect(seeded(d, 'manmad')?.verified).toBe(false);
    // The §16.2 offers, scaled from the ₹1,840 market they were written for to today's benchmark.
    const priceOf = (key: string) => d.requirements.find((r) => r.buyerId === demoId(`buyer:${key}`))?.price.amount;
    const scaled = (p: number) => Math.round((p * bundle.benchmark.modal) / 1840 / 10) * 10;
    expect([priceOf('godavari'), priceOf('deccan'), priceOf('niphad')]).toEqual([scaled(1950), scaled(2000), scaled(1900)]);
  });

  it('revalidates with a 304 when nothing changed', async () => {
    const first = await demand('nashik');
    const again = await app.inject({ method: 'GET', url: '/api/demand/nashik', headers: { ...bearer(world.farmerA, 'farmer'), 'if-none-match': String(first.headers['etag']) } });
    expect(again.statusCode).toBe(304);
  });

  it('track records come from completed deals only: counts, payment days, defaults, open disputes', async () => {
    const nashik = await doc('nashik');
    const godavari = seeded(nashik, 'godavari')!;
    expect(godavari.history.completedDeals).toBe(23);
    expect([...godavari.history.paymentDays].sort((a, b) => a - b)[11]).toBe(4); // median of 23
    const deccan = seeded(nashik, 'deccan')!;
    expect(deccan.history).toMatchObject({ completedDeals: 18, defaults: 1, defaultExposureDays: 90, openDisputes: 0 });
    const pune = await doc('pune');
    expect(seeded(pune, 'manchar')?.history.openDisputes).toBe(1);
  });

  it('carries nothing private: no phone, no GSTIN, no deal, no counterparty', async () => {
    const body = (await demand('nashik')).body;
    expect(body).not.toMatch(/phone|gstin|identifier|last4|deal_id|seller|\+91|1Z5Q/i);
  });

  it('is for signed-in accounts only, and only for districts that exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/demand/nashik' })).statusCode).toBe(401);
    expect((await demand('atlantis')).statusCode).toBe(404);
  });

  it('the track-record function refuses a caller with no asserted actor, even the application role', async () => {
    await expect(pool.query('SELECT * FROM app.buyer_track_records($1::uuid[])', [[demoId('buyer:godavari')]])).rejects.toMatchObject({ code: '42501' });
  });
});

describe('Gate F · the §16.2 scenario, from the database through the shared engine', () => {
  it('ranks A above C above B; B\'s higher gross is undone by payment risk; no unverified or cotton buyer appears', async () => {
    const d = await doc('nashik');
    const nashik = registry.districts.find((x) => x.id === 'nashik')!;
    const point = nashik.centroid;
    const nearest = nashik.markets.map((m) => ({ name: m.names.en, roadKm: roadKm(point, m.location) })).sort((a, b) => a.roadKm - b.roadKm)[0] ?? null;
    const onion = (dictionary.dictionary ?? dictionary).crops.find((c) => c.id === 'onion')!;
    const result = rankBuyers(
      { listingId: 'lot', crop: 'onion', quantity: { value: 5, unit: 'quintal' }, grade: null, location: point, district: 'nashik', availableFrom: bundle.asOf, availableUntil: bundle.asOf },
      d.requirements as unknown as BuyerRequirement[],
      {
        buyers: d.buyers as unknown as BuyerProfile[],
        benchmark: { modalPerQtl: bundle.benchmark.modal, district: 'nashik', market: bundle.market, asOf: bundle.asOf },
        tariffs: bundle.transport,
        financeRateAnnual: FINANCE_RATE_ANNUAL_DEFAULT.value,
        nearestMandi: nearest,
        weights: { ...(onion.crateKg === undefined ? {} : { crateKg: onion.crateKg }), ...(onion.bagKg === undefined ? {} : { bagKg: onion.bagKg }) },
        substitutions: (dictionary.dictionary ?? dictionary).varietySubstitutions,
        today: bundle.asOf,
      },
    );
    expect(result.matches.map((m) => m.buyerId)).toEqual(['godavari', 'niphad', 'deccan'].map((k) => demoId(`buyer:${k}`)));
    const [a, , b] = result.matches;
    expect(b!.gross).toBeGreaterThan(a!.gross);
    expect(explainOrder(a!, b!).decisive).toBe('payment-risk');
    expect(result.excluded.map((e) => e.reason)).toEqual(expect.arrayContaining(['unverified-buyer', 'crop-mismatch']));
    expect(JSON.stringify(result)).not.toContain('%');
  });
});
