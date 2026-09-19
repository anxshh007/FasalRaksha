/**
 * FR-09 · §6.6 — aggregation against a real PostgreSQL. The P14 gate: a consignment clears a real
 * minimum order quantity from real listings.
 *
 * The seeded consignment holds six members' small onion lots, 28 quintals against the bulk
 * buyer's 30. One more farmer's five quintals clears it. Leaving again re-opens it. And the
 * database, not this service, decides who may pool what: a coordinator opens a consignment, a
 * farmer adds only their own opted-in, open lot.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { CropBundle } from '@fasal/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createPool as createDbPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import type { PoolView } from '../src/modules/pools/service.js';
import { createKeyRing, type KeyRing } from '../src/security/keys.js';
import { issueAccessToken } from '../src/security/tokens.js';
import { demoId, seedDemand } from '../scripts/lib/demand-seed.js';
import { latestPipelineVersion } from '../scripts/lib/release.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';
import { seedWorld, type SeededWorld } from './support/seed.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const VERSION = latestPipelineVersion() ?? '';
const bundle = JSON.parse(readFileSync(join(ROOT, 'data', 'bundles', VERSION, 'published', 'bundles', 'onion__nashik.json'), 'utf8')) as CropBundle;
const NOW = new Date(`${bundle.asOf}T06:00:00Z`);

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;
let keys: KeyRing;
let world: SeededWorld;
let seed: pg.Client;

const bearer = (userId: string, role: 'farmer' | 'buyer' | 'fpo') => ({ authorization: `Bearer ${issueAccessToken(keys, { userId, role, sessionId: randomUUID() }, Math.floor(NOW.getTime() / 1000))}` });
const fpoId = demoId('fpo:kadwa');

/** A listing for farmer A, as their phone would have sent it. */
async function listing(clientId: string, quintals: number, poolOptIn: boolean, userId = world.farmerA): Promise<string> {
  const key = `create-${randomUUID()}`;
  const response = await app.inject({
    method: 'POST', url: '/api/outbox', headers: { ...bearer(userId, 'farmer'), 'idempotency-key': key },
    payload: {
      kind: 'listing.create', idempotencyKey: key, createdAt: `${bundle.asOf}T06:30:00.000Z`, attempts: 0,
      listing: { clientId, crop: 'onion', quantity: { value: quintals, unit: 'quintal' }, askingPrice: null, grade: null, gradeProvenance: null, availableFrom: bundle.asOf, availableUntil: '2026-10-10', poolOptIn },
    },
  });
  expect(response.statusCode).toBe(201);
  return clientId;
}

const openFor = async (clientId: string, userId = world.farmerA) => {
  const response = await app.inject({ method: 'GET', url: `/api/pools/open?listing=${clientId}`, headers: bearer(userId, 'farmer') });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { pools: PoolView[] };
};
const putIn = (poolId: string, clientId: string, userId = world.farmerA) =>
  app.inject({ method: 'POST', url: `/api/pools/${poolId}/join`, headers: bearer(userId, 'farmer'), payload: { listingClientId: clientId } });
const takeOut = (poolId: string, clientId: string, userId = world.farmerA) =>
  app.inject({ method: 'POST', url: `/api/pools/${poolId}/leave`, headers: bearer(userId, 'farmer'), payload: { listingClientId: clientId } });

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  world = await seedWorld(db.seedUrl);
  seed = new pg.Client({ connectionString: db.seedUrl });
  await seed.connect();
  pool = createDbPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
  keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys, now: () => NOW });
  await app.ready();
  await seedDemand(db.ownerUrl, VERSION, NOW);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await seed?.end();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('P14 gate · a consignment clears a real minimum from real listings', () => {
  it('six small lots fall short of 30 quintals; one more farmer clears it, and leaving re-opens it', async () => {
    const clientId = await listing(`listing-${randomUUID()}`, 5, true);
    const offered = await openFor(clientId);
    expect(offered.pools).toHaveLength(1);
    const consignment = offered.pools[0]!;
    expect(consignment.status).toBe('forming');
    expect(consignment.contributors).toBe(6);
    expect(consignment.mine).toBeNull();
    expect(consignment.totalKg).toBe(2800);
    expect(consignment.needKg).toBe(3000);
    expect(consignment.shortfallKg).toBe(200); // two quintals short
    expect(consignment.coordinator?.name).toBe('Kadwa Valley Farmer Producer Company');
    expect(consignment.buyer.name).toBe('Yeola Onion Export Terminal');

    const storedStatus = async () => (await seed.query<{ status: string }>('SELECT status FROM app.aggregation_pools WHERE id = $1', [consignment.id])).rows[0]!.status;
    const joined = (await putIn(consignment.id, clientId)).json() as PoolView;
    expect(joined.status).toBe('cleared'); // the gate
    // And cleared in the table, for everyone: row-level security forbids a farmer from updating a
    // consignment, so a status set by the API after the join would be a claim in that one answer
    // and nowhere else. It is `app.pool_settle` that writes it, from the lots actually in it.
    expect(await storedStatus()).toBe('cleared');
    expect(joined.totalKg).toBe(3300);
    expect(joined.contributors).toBe(7);
    expect(joined.mine?.contributedKg).toBe(500);
    expect(joined.mine?.share).toBeCloseTo(500 / 3300, 10);

    // It is one consignment for the buyer: one volume, one grade range, one window.
    expect(joined.window?.from).toBeDefined();
    expect(joined.includesUngraded).toBe(true);

    const mineNow = ((await app.inject({ method: 'GET', url: '/api/pools/mine', headers: bearer(world.farmerA, 'farmer') })).json() as { pools: PoolView[] }).pools;
    expect(mineNow.map((p) => p.id)).toEqual([consignment.id]);

    const left = (await takeOut(consignment.id, clientId)).json() as PoolView;
    expect(left.status).toBe('forming'); // below the minimum again
    expect(await storedStatus()).toBe('forming');
    expect(left.totalKg).toBe(2800);
    expect((await openFor(clientId)).pools).toHaveLength(1); // offered again
  });

  it('never takes more than the buyer will buy', async () => {
    const big = await listing(`listing-${randomUUID()}`, 400, true); // 40 tonnes against a 20 tonne maximum
    const consignment = (await openFor(big)).pools[0]!;
    const joined = (await putIn(consignment.id, big)).json() as PoolView;
    expect(joined.totalKg).toBe(joined.maxKg);
    expect(joined.mine?.contributedKg).toBe(joined.maxKg - 2800);
    await takeOut(consignment.id, big);
  });
});

describe('§6.6 · aggregation is opt-in, and the database enforces it', () => {
  it('a lot that did not opt in is never offered a consignment, and cannot be put in one', async () => {
    const clientId = await listing(`listing-${randomUUID()}`, 5, false);
    expect((await openFor(clientId)).pools).toEqual([]);
    const consignment = (await seed.query<{ id: string }>('SELECT id FROM app.aggregation_pools LIMIT 1')).rows[0]!;
    const refused = await putIn(consignment.id, clientId);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'NOT_OPTED_IN' } });
  });

  it('a farmer cannot pool another farmer\'s lot, and cannot join twice', async () => {
    const mine = await listing(`listing-${randomUUID()}`, 3, true);
    const consignment = (await openFor(mine)).pools[0]!;
    expect((await putIn(consignment.id, mine, world.farmerB)).statusCode).toBe(409); // B has no such lot
    expect((await putIn(consignment.id, mine)).statusCode).toBe(200);
    expect((await putIn(consignment.id, mine)).statusCode).toBe(409);
    await takeOut(consignment.id, mine);
  });

  it('only a coordinator opens a consignment; a farmer and a buyer are refused', async () => {
    const requirement = (await seed.query<{ id: string }>('SELECT id FROM app.buyer_requirements WHERE buyer_id = $1', [demoId('buyer:yeola-export')])).rows[0]!;
    expect((await app.inject({ method: 'POST', url: '/api/pools', headers: bearer(world.farmerA, 'farmer'), payload: { requirementId: requirement.id } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/pools', headers: bearer(world.buyerVerified, 'buyer'), payload: { requirementId: requirement.id } })).statusCode).toBe(403);
    const asCoordinator = await app.inject({ method: 'POST', url: '/api/pools', headers: bearer(fpoId, 'fpo'), payload: { requirementId: requirement.id } });
    expect(asCoordinator.statusCode).toBe(200);
    const proposal = asCoordinator.json() as { pool: PoolView; couldGather: { listings: number; totalKg: number } };
    expect(proposal.pool.id).toBeDefined(); // the one it already coordinates, not a second
    expect(proposal.couldGather.totalKg).toBeGreaterThan(0); // what the clustering engine could gather today
  });

  it('the clustering engine is what proposes: it reports what opted-in lots could gather', async () => {
    const requirement = (await seed.query<{ id: string }>('SELECT id FROM app.buyer_requirements WHERE buyer_id = $1', [demoId('buyer:yeola-export')])).rows[0]!;
    await listing(`listing-${randomUUID()}`, 25, true);
    const proposal = (await app.inject({ method: 'POST', url: '/api/pools', headers: bearer(fpoId, 'fpo'), payload: { requirementId: requirement.id } })).json() as { couldGather: { listings: number; totalKg: number; shortfallKg: number } };
    expect(proposal.couldGather.totalKg).toBeGreaterThanOrEqual(3000); // the minimum can be gathered
    expect(proposal.couldGather.shortfallKg).toBe(0);
    expect(proposal.couldGather.totalKg).toBeLessThanOrEqual(20000); // and never more than the buyer will buy
    expect(proposal.couldGather.listings).toBeGreaterThanOrEqual(1);
  });
});
