/**
 * FR-12 · Gate G (runtime half) · §8.9 — offers, the negotiation and the sauda slip, against a
 * real PostgreSQL.
 *
 * The §16.2 scenario end to end through the production path: a Nashik farmer lists five quintals
 * of onion, the demonstration traders answer it with real offers, the farmer counters one, the
 * buyer accepts, and the server — not either party — issues the sauda slip and closes the lot.
 *
 * And the refusals, which are the point of a state machine: a buyer who is not verified cannot
 * offer, a farmer cannot accept their own price, a stranger cannot see the deal, and a second
 * acceptance of the same deal finds it already moved.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { CropBundle } from '@fasal/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import type { DealView, SaudaSlip } from '../src/modules/deals/service.js';
import { createKeyRing, type KeyRing } from '../src/security/keys.js';
import { issueAccessToken } from '../src/security/tokens.js';
import { demoId, seedDemand } from '../scripts/lib/demand-seed.js';
import { latestPipelineVersion, publish } from '../scripts/lib/release.js';
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

const bearer = (userId: string, role: 'farmer' | 'buyer' | 'fpo') => ({
  authorization: `Bearer ${issueAccessToken(keys, { userId, role, sessionId: randomUUID() }, Math.floor(NOW.getTime() / 1000))}`,
});

/** A lot, as the farmer's phone would have sent it, which the demonstration desk then answers. */
async function listLot(quintals: number, userId = world.farmerA): Promise<string> {
  const clientId = `listing-${randomUUID()}`;
  const key = `create-${randomUUID()}`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/outbox',
    headers: { ...bearer(userId, 'farmer'), 'idempotency-key': key },
    payload: {
      kind: 'listing.create',
      idempotencyKey: key,
      createdAt: `${bundle.asOf}T06:30:00.000Z`,
      attempts: 0,
      listing: {
        clientId,
        crop: 'onion',
        quantity: { value: quintals, unit: 'quintal' },
        askingPrice: null,
        grade: null,
        gradeProvenance: null,
        availableFrom: bundle.asOf,
        availableUntil: '2026-10-10',
        poolOptIn: false,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return clientId;
}

const dealsOf = async (userId: string, role: 'farmer' | 'buyer' = 'farmer'): Promise<DealView[]> =>
  ((await app.inject({ method: 'GET', url: '/api/deals/mine', headers: bearer(userId, role) })).json() as { deals: DealView[] }).deals;

const offersOn = async (clientId: string, userId = world.farmerA): Promise<DealView[]> => (await dealsOf(userId)).filter((d) => d.listingClientId === clientId);

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  world = await seedWorld(db.seedUrl);
  seed = new pg.Client({ connectionString: db.seedUrl });
  await seed.connect();
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
  keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys, now: () => NOW });
  await app.ready();
  await publish(VERSION, { ownerUrl: db.ownerUrl, env: {} }); // the slip's benchmark and freight come from the published bundle
  await seedDemand(db.ownerUrl, VERSION, NOW);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await seed?.end();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('FR-12 · an offer reaches the farmer, and the price is negotiated', () => {
  it('the seeded traders answer a new lot with real offers, each beside the benchmark it was made against', async () => {
    const clientId = await listLot(5);
    const offers = await offersOn(clientId);
    expect(offers.length).toBeGreaterThanOrEqual(2); // §16.2 wants a choice, not one taker

    for (const offer of offers) {
      expect(offer.state).toBe('OFFERED');
      expect(offer.you).toBe('seller');
      expect(offer.lastPriceBy).toBe('buyer'); // a deal only ever begins with a buyer's offer
      expect(offer.terms.price.unit).toBe('quintal'); // a price never exists without its basis (P1-03)
      expect(offer.terms.quantity).toEqual({ value: 5, unit: 'quintal' }); // the farmer's own unit (P1-02)
      expect(offer.benchmarkAtOffer?.modalPerQtl).toBe(bundle.benchmark.modal);
      expect(offer.buyer.verified).toBe(true);
      expect(offer.buyer.demonstration).toBe(true);
      expect(offer.paymentRecord.completedDeals).toBeGreaterThan(0);
      expect(offer.slip).toBeNull();
      expect(offer.youCan).toEqual(expect.arrayContaining(['ACCEPT', 'COUNTER', 'DECLINE']));
    }
    expect(JSON.stringify(offers)).not.toContain('%'); // no match percentages, anywhere (Gate F)
  });

  it('the farmer counters, the buyer cannot counter their own price, and either may walk away', async () => {
    const clientId = await listLot(5);
    const [offer] = await offersOn(clientId);
    const buyerId = offer!.buyer.id;
    const asked = Math.round(offer!.terms.price.amount * 1.05);

    const countered = (await app.inject({
      method: 'POST',
      url: `/api/offers/${offer!.id}/counter`,
      headers: bearer(world.farmerA, 'farmer'),
      payload: { price: { amount: asked, unit: 'quintal' }, quantity: { value: 5, unit: 'quintal' } },
    })).json() as DealView;
    expect(countered.state).toBe('COUNTERED');
    expect(countered.terms.price.amount).toBe(asked);
    expect(countered.lastPriceBy).toBe('seller');
    expect(countered.history.map((h) => h.type)).toEqual(['OFFER', 'COUNTER']);

    // The farmer named this price, so the farmer cannot accept it or name another.
    const again = await app.inject({ method: 'POST', url: `/api/offers/${offer!.id}/counter`, headers: bearer(world.farmerA, 'farmer'), payload: { price: { amount: asked + 10, unit: 'quintal' }, quantity: { value: 5, unit: 'quintal' } } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'NOT_YOUR_TURN' } });
    const own = await app.inject({ method: 'POST', url: `/api/offers/${offer!.id}/accept`, headers: bearer(world.farmerA, 'farmer') });
    expect(own.statusCode).toBe(409);
    expect(own.json()).toMatchObject({ error: { code: 'OWN_OFFER' } });

    // A second lot, declined instead: a farmer can say no, and the deal stops there.
    const other = (await offersOn(await listLot(5)))[0]!;
    const declined = (await app.inject({ method: 'POST', url: `/api/offers/${other.id}/decline`, headers: bearer(world.farmerA, 'farmer') })).json() as DealView;
    expect(declined.state).toBe('DECLINED');
    expect(declined.youCan).toEqual([]);
    expect(buyerId).toBeDefined();
  });
});

describe('FR-12 · Gate G · acceptance is the server\'s, and so is the slip', () => {
  it('the buyer accepts the farmer\'s price: the slip is issued in the same breath and the lot is sold', async () => {
    const clientId = await listLot(5);
    const offer = (await offersOn(clientId))[0]!;
    const asked = Math.round(offer.terms.price.amount * 1.02);
    await app.inject({
      method: 'POST',
      url: `/api/offers/${offer.id}/counter`,
      headers: bearer(world.farmerA, 'farmer'),
      payload: { price: { amount: asked, unit: 'quintal' }, quantity: { value: 5, unit: 'quintal' } },
    });

    const accepted = (await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: bearer(offer.buyer.id, 'buyer') })).json() as DealView;
    // ACCEPTED is not a resting state: the server issues the slip inside the same transaction.
    expect(accepted.state).toBe('SAUDA_SLIP');
    expect(accepted.slip).not.toBeNull();

    const slip = accepted.slip!;
    expect(slip.slipNo).toMatch(/^SR-NAS-\d{8}-\d{4,}$/);
    expect(slip.price).toEqual({ amount: asked, unit: 'quintal' });
    expect(slip.quantity).toEqual({ value: 5, unit: 'quintal' });
    expect(slip.grossValue).toBe(asked * 5);
    expect(slip.benchmark?.modalPerQtl).toBe(bundle.benchmark.modal); // the number the price can be judged against
    expect(slip.benchmark?.asOf).toBe(bundle.asOf);
    expect(slip.freight?.total).toBeGreaterThan(0);
    expect(slip.freight?.roadKm).toBeGreaterThan(0);
    expect(slip.buyer.verified).toBe(true);
    expect(slip.paymentRecord.completedDeals).toBeGreaterThan(0);
    expect(slip.disputeFrom).toBe('delivery-confirmed');
    expect(slip.split).toBeNull(); // one farmer's lot, not a consignment

    // The lot is no longer for sale — written by the database, not by whoever pressed accept.
    const listing = await seed.query<{ status: string }>('SELECT status FROM app.listings WHERE client_id = $1', [clientId]);
    expect(listing.rows[0]?.status).toBe('sold');

    // Both parties can read the same slip; a stranger cannot read the deal at all.
    const asFarmer = await app.inject({ method: 'GET', url: `/api/deals/${offer.id}/sauda-slip`, headers: bearer(world.farmerA, 'farmer') });
    expect(asFarmer.statusCode).toBe(200);
    expect((asFarmer.json() as SaudaSlip).slipNo).toBe(slip.slipNo);
    const asStranger = await app.inject({ method: 'GET', url: `/api/deals/${offer.id}`, headers: bearer(world.farmerB, 'farmer') });
    expect(asStranger.statusCode).toBe(404);
  });

  it('a second acceptance finds the deal already moved', async () => {
    const offer = (await offersOn(await listLot(5)))[0]!;
    const first = await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: bearer(world.farmerA, 'farmer') });
    expect(first.statusCode, first.body).toBe(200);
    const second = await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: bearer(world.farmerA, 'farmer') });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'WRONG_STATE' } });
  });

  it('there is no offline path to a transition: the outbox will not carry one', async () => {
    const key = `accept-${randomUUID()}`;
    const refused = await app.inject({
      method: 'POST',
      url: '/api/outbox',
      headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key },
      payload: { kind: 'deal.accept', idempotencyKey: key, createdAt: `${bundle.asOf}T07:00:00.000Z`, attempts: 0, dealId: randomUUID() },
    });
    expect(refused.statusCode).toBe(422); // the outbox parser knows no such entry (Constitution §9)
  });
});

describe('SEC · only the two parties, and only a verified buyer', () => {
  it('an unverified buyer cannot open a deal, and a farmer cannot offer at all', async () => {
    const clientId = await listLot(5);
    const listing = await seed.query<{ id: string }>('SELECT id FROM app.listings WHERE client_id = $1', [clientId]);
    const payload = { listingId: listing.rows[0]!.id, price: { amount: 3600, unit: 'quintal' }, quantity: { value: 5, unit: 'quintal' } };

    const unverified = await app.inject({ method: 'POST', url: '/api/offers', headers: bearer(world.buyerUnverified, 'buyer'), payload });
    expect(unverified.statusCode).toBe(403);
    const asFarmer = await app.inject({ method: 'POST', url: '/api/offers', headers: bearer(world.farmerA, 'farmer'), payload });
    expect(asFarmer.statusCode).toBe(403);
    expect(asFarmer.json()).toMatchObject({ error: { code: 'BUYERS_ONLY' } });

    const verified = await app.inject({ method: 'POST', url: '/api/offers', headers: bearer(world.buyerVerified, 'buyer'), payload });
    expect(verified.statusCode).toBe(201);
    expect((verified.json() as DealView).state).toBe('OFFERED');
  });

  it('the farmer acknowledges an offer, and only then is there a way for the buyer to make contact', async () => {
    const offer = (await offersOn(await listLot(5)))[0]!;
    const asBuyer = await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/acknowledge`, headers: bearer(offer.buyer.id, 'buyer'), payload: { reason: 'Call me about pickup.' } });
    expect(asBuyer.statusCode).toBe(403);

    const granted = await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/acknowledge`, headers: bearer(world.farmerA, 'farmer'), payload: { reason: 'Happy to discuss pickup.' } });
    expect(granted.statusCode).toBe(200);
    const grant = granted.json() as { relayHandle: string; expiresAt: string; buyer: { name: string } };
    expect(grant.relayHandle).toMatch(/^[0-9a-f]{24}$/); // a handle for the masked relay, never a number
    expect(grant.buyer.name).toBe(offer.buyer.name);
    expect(JSON.stringify(grant)).not.toMatch(/\+?\d{10}/); // no phone number reaches either side

    const stored = await seed.query<{ reason: string }>('SELECT reason FROM app.contact_grants WHERE deal_id = $1', [offer.id]);
    expect(stored.rows[0]?.reason).toBe('Happy to discuss pickup.'); // audited, with the farmer's own words
  });

  it('the demonstration desk only ever acts for demonstration traders', async () => {
    const clientId = await listLot(5);
    const offers = await offersOn(clientId);
    const traders = await seed.query<{ user_id: string }>('SELECT user_id FROM app.buyer_profiles WHERE demonstration');
    const demonstration = new Set(traders.rows.map((r) => r.user_id));
    for (const offer of offers) expect(demonstration.has(offer.buyer.id)).toBe(true);
    // And the buyer the §16.2 scenario is built around is among them.
    expect(offers.map((o) => o.buyer.id)).toContain(demoId('buyer:godavari'));
  });
});
