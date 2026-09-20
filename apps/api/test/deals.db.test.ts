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

import { MockWeatherAdapter } from '../src/adapters/weather/weather.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import type { DemandDocument } from '../src/modules/demand/service.js';
import type { DisputeView, GrievancePattern } from '../src/modules/disputes/service.js';
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
  app = buildApp({
    config,
    logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }),
    db: { pool, contextKey: keys.contextKey },
    keys,
    // The slip's suggested pickup is checked against a forecast, so the server has one (§XIII).
    weather: new MockWeatherAdapter(),
    now: () => NOW,
  });
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
    const grant = granted.json() as { relayHandle: string; expiresAt: string; buyer: { name: string; place: string } };
    expect(grant.relayHandle).toMatch(/^[0-9a-f]{24}$/); // a handle for the masked relay, never a number
    expect(grant.buyer.name).toBe(offer.buyer.name);
    // What comes back is the handle, when it expires, and who it reaches — and nothing else: no
    // phone number, and no field that could carry one (§8.4).
    expect(Object.keys(grant).sort()).toEqual(['buyer', 'expiresAt', 'relayHandle']);
    expect(Object.keys(grant.buyer).sort()).toEqual(['name', 'place']);

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

describe('FR-14 · delivery, payment, and a reputation that moves only on completed deals', () => {
  /** A lot taken all the way to a struck deal, ready for the second half of §8.9. */
  async function struckDeal(): Promise<DealView> {
    const offer = (await offersOn(await listLot(5)))[0]!;
    const accepted = (await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: bearer(world.farmerA, 'farmer') })).json() as DealView;
    expect(accepted.state).toBe('SAUDA_SLIP');
    return accepted;
  }

  const buyerInDemand = async (buyerId: string) => {
    const response = await app.inject({ method: 'GET', url: '/api/demand/nashik', headers: bearer(world.farmerA, 'farmer') });
    return (response.json() as DemandDocument).buyers.find((b) => b.id === buyerId);
  };

  const post = (url: string, userId: string, role: 'farmer' | 'buyer', payload: unknown = {}) =>
    app.inject({ method: 'POST', url, headers: bearer(userId, role), payload: payload as object });

  it('a deal completes only when both sides confirm delivery and the seller confirms the money', async () => {
    const deal = await struckDeal();
    const before = await buyerInDemand(deal.buyer.id);

    // The farmer confirms their side; the trader's own confirmation is what completes delivery.
    const delivered = (await post(`/api/deals/${deal.id}/delivery`, world.farmerA, 'farmer', { weighed: { value: 4.96, unit: 'quintal' }, note: 'Weighed at the Niphad bridge.' })).json() as DealView;
    expect(delivered.state).toBe('DELIVERY_CONFIRMED');
    expect(delivered.delivery.seller).toBe(true);
    expect(delivered.delivery.buyer).toBe(true);
    expect(delivered.delivery.weighed).toEqual({ value: 4.96, unit: 'quintal' }); // what it actually weighed

    // Nobody confirms twice: with both sides in, the deal has moved past the point where a
    // delivery confirmation means anything (a second one while still waiting is ALREADY_DONE).
    const twice = await post(`/api/deals/${deal.id}/delivery`, world.farmerA, 'farmer');
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ error: { code: 'WRONG_STATE' } });
    const byBuyer = await post(`/api/deals/${deal.id}/payment`, deal.buyer.id, 'buyer', { amount: 18_000 });
    expect(byBuyer.statusCode).toBe(409);
    expect(byBuyer.json()).toMatchObject({ error: { code: 'ONLY_SELLER_CONFIRMS_PAYMENT' } });

    // Delivered is not completed: the buyer's record has not moved, and cannot be rated yet.
    const midway = await buyerInDemand(deal.buyer.id);
    expect(midway?.history.completedDeals).toBe(before?.history.completedDeals);
    const early = await post(`/api/deals/${deal.id}/rate`, world.farmerA, 'farmer', { paymentTimeliness: 5 });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: { code: 'WRONG_STATE' } });

    const paid = (await post(`/api/deals/${deal.id}/payment`, world.farmerA, 'farmer', { amount: deal.slip?.grossValue ?? 18_000 })).json() as DealView;
    expect(paid.state).toBe('PAYMENT_CONFIRMED');
    expect(paid.payment?.amount).toBe(deal.slip?.grossValue);
    expect(paid.payment?.daysAfterDelivery).toBe(0); // paid the same day, on the app's clock

    // Now — and only now — the buyer's public record counts one more completed deal.
    const after = await buyerInDemand(deal.buyer.id);
    expect(after?.history.completedDeals).toBe((before?.history.completedDeals ?? 0) + 1);
    expect(after?.history.paymentDays).toContain(0);
  });

  it('each side rates the other on its own three things, once, and the rating shows with the count', async () => {
    const deal = await struckDeal();
    await post(`/api/deals/${deal.id}/delivery`, world.farmerA, 'farmer');
    await post(`/api/deals/${deal.id}/payment`, world.farmerA, 'farmer', { amount: 18_000 });

    // A farmer rates the buyer on payment, weighment and pickup — not on their own dimensions.
    const wrong = await post(`/api/deals/${deal.id}/rate`, world.farmerA, 'farmer', { qualityAsDescribed: 5 });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ error: { code: 'WRONG_RATING' } });

    const rated = (await post(`/api/deals/${deal.id}/rate`, world.farmerA, 'farmer', { paymentTimeliness: 5, weighmentFairness: 4, pickupReliability: 5 })).json() as DealView;
    // The trader rates back through the desk, which is what closes a deal (§8.9).
    expect(rated.state).toBe('MUTUALLY_RATED');
    expect(rated.rated.you).toBe(true);
    expect(rated.rated.them).toBe(true);

    const again = await post(`/api/deals/${deal.id}/rate`, world.farmerA, 'farmer', { paymentTimeliness: 1 });
    expect(again.statusCode).toBe(409); // never edited, never repeated (SEC-12)

    // The buyer's reputation is now visible to the next farmer — as an average with its count.
    const buyer = await buyerInDemand(deal.buyer.id);
    expect(buyer?.rating?.count).toBeGreaterThanOrEqual(1);
    expect(buyer?.rating?.paymentTimeliness).toBeGreaterThanOrEqual(1);
    expect(buyer?.rating?.paymentTimeliness).toBeLessThanOrEqual(5);
    // And the farmer sees their own, from the buyer who rated them.
    const mine = ((await app.inject({ method: 'GET', url: `/api/deals/${deal.id}`, headers: bearer(world.farmerA, 'farmer') })).json() as DealView).counterpartyRating;
    expect(mine?.count).toBeGreaterThanOrEqual(1);
    expect(Object.keys(mine?.scores ?? {})).toEqual(['paymentTimeliness', 'weighmentFairness', 'pickupReliability']);
  });

  it('a rating is never a row anyone else can read: reputation leaves the database as aggregates', async () => {
    // There are rating rows in the table — the previous test wrote two of them.
    const rows = await seed.query<{ n: string }>('SELECT count(*) AS n FROM app.ratings');
    expect(Number(rows.rows[0]!.n)).toBeGreaterThanOrEqual(2);

    // A farmer who was not part of any of it cannot read the deal at all, and the demand document
    // they are served carries counts and averages: never a rating, a rater, or a deal.
    const stranger = await app.inject({ method: 'GET', url: '/api/demand/nashik', headers: bearer(world.farmerB, 'farmer') });
    expect(stranger.statusCode).toBe(200);
    const document = stranger.json() as DemandDocument;
    const body = JSON.stringify(document);
    expect(body).not.toContain('rater');
    expect(body).not.toContain('dealId');
    for (const buyer of document.buyers) {
      if (buyer.rating === null) continue;
      expect(Object.keys(buyer.rating).sort()).toEqual(['count', 'paymentTimeliness', 'pickupReliability', 'weighmentFairness']);
    }
  });
});

describe('FR-13 · the pickup a sauda slip suggests, checked against the weather', () => {
  it("names a day inside the lot's own window, and says the forecast was consulted", async () => {
    const clientId = await listLot(5);
    const offer = (await offersOn(clientId))[0]!;
    const accepted = (await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: bearer(world.farmerA, 'farmer') })).json() as DealView;
    const pickup = accepted.slip?.pickup;
    expect(pickup?.arrangedBy).toBe('phone'); // §XIII: inform the phone call, never replace it
    expect(pickup?.weatherChecked).toBe(true); // the mock forecast is a real forecast document here
    expect(pickup?.suggested).not.toBeNull();
    expect(pickup!.suggested! >= bundle.asOf).toBe(true);
    expect(pickup!.suggested! <= '2026-10-10').toBe(true); // inside the availability window the lot was listed with
  });
});

describe('FR-15 · a complaint, with a reason code, routed to the district officer', () => {
  const bearerOfficer = (userId: string) => ({ authorization: `Bearer ${issueAccessToken(keys, { userId, role: 'officer', sessionId: randomUUID() }, Math.floor(NOW.getTime() / 1000))}` });
  const post = (url: string, userId: string, role: 'farmer' | 'buyer', payload: unknown = {}) =>
    app.inject({ method: 'POST', url, headers: bearer(userId, role), payload: payload as object });

  /** A deal carried to delivery, with a photograph of the lot on file to attach as evidence. */
  async function deliveredDeal(): Promise<{ deal: DealView; photoId: string }> {
    const clientId = await listLot(5);
    const listing = await seed.query<{ id: string }>('SELECT id FROM app.listings WHERE client_id = $1', [clientId]);
    const listingId = listing.rows[0]!.id;
    const photo = await seed.query<{ storage_key: string }>(
      `INSERT INTO app.listing_photos (listing_id, farmer_id, content_hash, byte_length, width, height, created_at)
       VALUES ($1, $2, $3, 120000, 1280, 960, $4) RETURNING storage_key`,
      [listingId, world.farmerA, randomUUID().replace(/-/g, '').padEnd(64, '0'), NOW],
    );
    const offer = (await offersOn(clientId))[0]!;
    await post(`/api/offers/${offer.id}/accept`, world.farmerA, 'farmer');
    const delivered = (await post(`/api/deals/${offer.id}/delivery`, world.farmerA, 'farmer')).json() as DealView;
    expect(delivered.state).toBe('DELIVERY_CONFIRMED');
    return { deal: delivered, photoId: photo.rows[0]!.storage_key };
  }

  it('cannot be raised before the lot has changed hands, or by anyone but the two parties', async () => {
    const offer = (await offersOn(await listLot(5)))[0]!;
    const early = await post(`/api/deals/${offer.id}/dispute`, world.farmerA, 'farmer', { reason: 'GRADE_DISPUTE', note: 'Too early to complain.' });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: { code: 'DISPUTE_TOO_EARLY' } });

    const stranger = await post(`/api/deals/${offer.id}/dispute`, world.farmerB, 'farmer', { reason: 'OTHER', note: 'Not my deal.' });
    expect([403, 404]).toContain(stranger.statusCode); // not a party, and not even readable
  });

  it('a grade dispute carries its photograph, reaches the officer, and shows on the buyer as an open dispute', async () => {
    const { deal, photoId } = await deliveredDeal();
    const raised = await post(`/api/deals/${deal.id}/dispute`, world.farmerA, 'farmer', {
      reason: 'GRADE_DISPUTE',
      note: 'They graded the lot C at the yard; it was photographed and declared B.',
      evidencePhotoId: photoId,
    });
    expect(raised.statusCode).toBe(201);
    const dispute = raised.json() as DisputeView;
    expect(dispute.state).toBe('DISPUTE_OPEN');
    expect(dispute.reason).toBe('GRADE_DISPUTE'); // a code, so a district can be counted, not parsed
    expect(dispute.raisedByParty).toBe('seller');
    expect(dispute.district).toBe('nashik'); // the deal's district, set by the database
    expect(dispute.evidence).toBe(1); // the lot's own photograph, attached by reference

    // One at a time, per deal.
    const again = await post(`/api/deals/${deal.id}/dispute`, world.farmerA, 'farmer', { reason: 'OTHER', note: 'And another thing.' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'DISPUTE_ALREADY_OPEN' } });

    // The buyer's clean record is not clean while this is open — that is what gives it teeth.
    const document = (await app.inject({ method: 'GET', url: '/api/demand/nashik', headers: bearer(world.farmerA, 'farmer') })).json() as DemandDocument;
    const buyer = document.buyers.find((b) => b.id === deal.buyer.id);
    expect(buyer?.history.openDisputes).toBeGreaterThanOrEqual(1);
    const onDeal = (await app.inject({ method: 'GET', url: `/api/deals/${deal.id}`, headers: bearer(world.farmerA, 'farmer') })).json() as DealView;
    expect(onDeal.paymentRecord.openDisputes).toBeGreaterThanOrEqual(1);
    expect(onDeal.dispute?.reason).toBe('GRADE_DISPUTE');
  });

  it('only the officer of that district moves it, open → under review → resolved', async () => {
    const { deal } = await deliveredDeal();
    const dispute = (await post(`/api/deals/${deal.id}/dispute`, world.farmerA, 'farmer', { reason: 'QUANTITY_SHORT', note: 'Four quintals were weighed, not five.' })).json() as DisputeView;

    const byFarmer = await post(`/api/disputes/${dispute.id}/review`, world.farmerA, 'farmer');
    expect(byFarmer.statusCode).toBe(403);
    expect(byFarmer.json()).toMatchObject({ error: { code: 'OFFICERS_ONLY' } });

    const byLatur = await app.inject({ method: 'POST', url: `/api/disputes/${dispute.id}/review`, headers: bearerOfficer(world.officerLatur) });
    expect(byLatur.statusCode).toBe(409); // another district's officer cannot see it, let alone move it

    const reviewing = await app.inject({ method: 'POST', url: `/api/disputes/${dispute.id}/review`, headers: bearerOfficer(world.officerNashik) });
    expect(reviewing.statusCode).toBe(200);
    expect((reviewing.json() as DisputeView).state).toBe('UNDER_REVIEW');

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/disputes/${dispute.id}/resolve`,
      headers: bearerOfficer(world.officerNashik),
      payload: { outcome: 'settled', note: 'Both parties agreed on four quintals at the agreed rate.' },
    });
    expect(resolved.statusCode).toBe(200);
    const done = resolved.json() as DisputeView;
    expect(done.state).toBe('RESOLVED');
    expect(done.outcome).toBe('settled');
    expect(done.resolvedAt).not.toBeNull();

    // Resolved, the buyer's record is clean again — and a second resolution is not possible.
    const twice = await app.inject({ method: 'POST', url: `/api/disputes/${dispute.id}/resolve`, headers: bearerOfficer(world.officerNashik), payload: { outcome: 'upheld', note: 'No.' } });
    expect(twice.statusCode).toBe(409);
  });

  it('the officer sees the district counted by reason, not a pile of sentences', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/disputes/patterns', headers: bearerOfficer(world.officerNashik) });
    expect(response.statusCode).toBe(200);
    const patterns = (response.json() as { patterns: GrievancePattern[] }).patterns;
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern.district).toBe('nashik'); // row-level security keeps the officer in their district
      expect(['QUANTITY_SHORT', 'GRADE_DISPUTE', 'PAYMENT_OVERDUE', 'NO_SHOW', 'OTHER']).toContain(pattern.reason);
    }
    expect(JSON.stringify(patterns)).not.toContain('note'); // a pattern, not a case file
    const farmer = await app.inject({ method: 'GET', url: '/api/disputes/patterns', headers: bearer(world.farmerA, 'farmer') });
    expect(farmer.statusCode).toBe(403);
  });
});
