/**
 * FR-10 · P1-02 · P1-03 · P1-04 — listings through the outbox against a real PostgreSQL, and
 * the transcription endpoint that enriches a listing spoken offline (§10.2).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockSpeechAdapter } from '../src/adapters/speech/speech.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import { createKeyRing, type KeyRing } from '../src/security/keys.js';
import { issueAccessToken } from '../src/security/tokens.js';
import { seedWorld, type SeededWorld } from './support/seed.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;
let keys: KeyRing;
let world: SeededWorld;
let unverified: string;
const speech = new MockSpeechAdapter();

const bearer = (userId: string, role: 'farmer' | 'buyer') => ({ authorization: `Bearer ${issueAccessToken(keys, { userId, role, sessionId: randomUUID() }, Math.floor(Date.now() / 1000))}` });

function create(clientId: string, overrides: Record<string, unknown> = {}) {
  const key = `create-${randomUUID()}`;
  return {
    key,
    payload: {
      kind: 'listing.create',
      idempotencyKey: key,
      createdAt: '2026-09-18T06:30:00.000Z',
      attempts: 0,
      listing: {
        clientId,
        crop: 'onion',
        quantity: { value: 5, unit: 'quintal' },
        askingPrice: { amount: 1900, unit: 'quintal' },
        grade: null,
        gradeProvenance: null,
        availableFrom: '2026-09-19',
        availableUntil: '2026-09-26',
        poolOptIn: false,
        ...overrides,
      },
    },
  };
}

const send = (userId: string, role: 'farmer' | 'buyer', body: { key: string; payload: Record<string, unknown> }) =>
  app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(userId, role), 'idempotency-key': body.key }, payload: body.payload });

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  world = await seedWorld(db.seedUrl);
  const seed = new pg.Client({ connectionString: db.seedUrl });
  await seed.connect();
  unverified = randomUUID();
  await seed.query("INSERT INTO app.users (id, kind) VALUES ($1, 'farmer')", [unverified]);
  await seed.query("INSERT INTO app.farmer_profiles (user_id, display_name) VALUES ($1, 'Not yet verified')", [unverified]);
  await seed.end();
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
  keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys, speech });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('FR-10 · a listing composed on the phone arrives as the farmer stated it', () => {
  it('keeps the stated quantity unit and the price with its basis; the district is the verified one', async () => {
    const clientId = `listing-${randomUUID()}`;
    const response = await send(world.farmerA, 'farmer', create(clientId, { quantity: { value: 5, unit: 'quintal' } }));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ kind: 'listing.create', clientId, district: 'nashik' });
    const mine = await app.inject({ method: 'GET', url: '/api/listings/mine', headers: bearer(world.farmerA, 'farmer') });
    const listing = (mine.json() as { listings: { clientId: string; quantity: unknown; askingPrice: unknown; availableFrom: string }[] }).listings.find((l) => l.clientId === clientId);
    expect(listing?.quantity).toEqual({ value: 5, unit: 'quintal' }); // P1-02: never 500 kg
    expect(listing?.askingPrice).toEqual({ amount: 1900, unit: 'quintal' }); // P1-03: never a bare number
    expect(listing?.availableFrom).toBe('2026-09-19'); // dates survive the time zone
  });

  it('a listing without a price is a listing without a price, not a zero', async () => {
    const response = await send(world.farmerA, 'farmer', create(`listing-${randomUUID()}`, { askingPrice: null }));
    expect(response.statusCode).toBe(201);
  });

  it('refuses a crop the dictionary does not know', async () => {
    const response = await send(world.farmerA, 'farmer', create(`listing-${randomUUID()}`, { crop: 'saffron' }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'UNKNOWN_CROP' } });
  });

  it('P1-04 · an unverified farmer cannot list: there is no district to tie it to', async () => {
    const response = await send(unverified, 'farmer', create(`listing-${randomUUID()}`));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'VERIFY_FIRST' } });
  });

  it('a buyer cannot list a crop', async () => {
    expect((await send(world.buyerVerified, 'buyer', create(`listing-${randomUUID()}`))).statusCode).toBe(403);
  });

  it('an update that overtakes its own listing is "not yet", and applies once the listing exists', async () => {
    const clientId = `listing-${randomUUID()}`;
    const renewKey = `renew-${randomUUID()}`;
    const renew = { key: renewKey, payload: { kind: 'listing.renew', idempotencyKey: renewKey, createdAt: '2026-09-18T07:00:00.000Z', attempts: 0, listingClientId: clientId, availableUntil: '2026-10-05' } };
    const early = await send(world.farmerA, 'farmer', renew);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: { code: 'LISTING_NOT_YET_RECEIVED' } });
    await send(world.farmerA, 'farmer', create(clientId));
    const later = await send(world.farmerA, 'farmer', renew);
    expect(later.statusCode).toBe(200);
    expect(later.json()).toMatchObject({ availableUntil: '2026-10-05' });
  });

  it('an update changes only what it names, and keeps units with amounts', async () => {
    const clientId = `listing-${randomUUID()}`;
    await send(world.farmerA, 'farmer', create(clientId));
    const key = `update-${randomUUID()}`;
    const response = await send(world.farmerA, 'farmer', {
      key,
      payload: { kind: 'listing.update', idempotencyKey: key, createdAt: '2026-09-18T08:00:00.000Z', attempts: 0, listingClientId: clientId, changes: { quantity: { value: 400, unit: 'kg' } } },
    });
    expect(response.statusCode).toBe(200);
    const mine = await app.inject({ method: 'GET', url: '/api/listings/mine', headers: bearer(world.farmerA, 'farmer') });
    const listing = (mine.json() as { listings: { clientId: string; quantity: unknown; askingPrice: unknown }[] }).listings.find((l) => l.clientId === clientId);
    expect(listing?.quantity).toEqual({ value: 400, unit: 'kg' });
    expect(listing?.askingPrice).toEqual({ amount: 1900, unit: 'quintal' });
  });
});

describe('§10.2 · a listing spoken offline is transcribed on reconnection', () => {
  const audio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);

  it('returns the words for a recording the recogniser can make out', async () => {
    speech.remember(audio, 'mr', 'मला ५ क्विंटल कांदा विकायचा आहे');
    const response = await app.inject({ method: 'POST', url: '/api/speech/transcribe?locale=mr', headers: { ...bearer(world.farmerA, 'farmer'), 'content-type': 'audio/webm' }, payload: Buffer.from(audio) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'transcribed', text: 'मला ५ क्विंटल कांदा विकायचा आहे', locale: 'mr' });
  });

  it('says "unrecognised" rather than inventing words', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/speech/transcribe?locale=mr', headers: { ...bearer(world.farmerA, 'farmer'), 'content-type': 'audio/webm' }, payload: Buffer.from([9, 9, 9, 9]) });
    expect(response.json()).toMatchObject({ status: 'unrecognised', text: null });
  });

  it('requires sign-in and a real recording', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/speech/transcribe?locale=mr', headers: { 'content-type': 'audio/webm' }, payload: Buffer.from(audio) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/speech/transcribe?locale=xx', headers: { ...bearer(world.farmerA, 'farmer'), 'content-type': 'audio/webm' }, payload: Buffer.from(audio) })).statusCode).toBe(422);
  });
});
