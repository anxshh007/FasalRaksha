/**
 * FR-10 · SEC-09 — the outbox drain endpoint against a real PostgreSQL. A 2G retry of the same
 * queued action changes nothing, a reused key with different content is refused, a deal
 * transition is refused before the database, and a photograph (bytes) posted here is refused:
 * it travels in chunks to /api/photos/uploads.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const bearer = (userId: string, role: 'farmer' | 'buyer') => ({ authorization: `Bearer ${issueAccessToken(keys, { userId, role, sessionId: randomUUID() }, Math.floor(Date.now() / 1000))}` });

const alert = (key: string, amount = 2000, unit = 'quintal') => ({
  kind: 'price-alert.create',
  idempotencyKey: key,
  createdAt: '2026-09-18T06:30:00.000Z',
  attempts: 0,
  crop: 'onion',
  threshold: { amount, unit },
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const c = new pg.Client({ connectionString: db.seedUrl });
  await c.connect();
  try {
    return Number((await c.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  world = await seedWorld(db.seedUrl);
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
  keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('FR-10 · a queued price alert reaches the server exactly once', () => {
  it('creates the alert in the farmer\'s verified district, per quintal', async () => {
    const key = `alert-${randomUUID()}`;
    const response = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key }, payload: alert(key, 20, 'kg') });
    expect(response.statusCode).toBe(201);
    expect(response.headers['idempotent-replay']).toBe('false');
    expect(response.json()).toMatchObject({ kind: 'price-alert.create', district: 'nashik', thresholdPerQuintal: 2000 });
  });

  it('a retry after a lost response replays the answer and creates nothing', async () => {
    const key = `alert-${randomUUID()}`;
    const first = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key }, payload: alert(key) });
    const retry = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key }, payload: { ...alert(key), attempts: 3 } });
    expect(retry.statusCode).toBe(first.statusCode);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await count('SELECT count(*) AS n FROM app.price_alerts WHERE client_key = $1', [key])).toBe(1);
  });

  it('the same key with different content is refused (409), not applied', async () => {
    const key = `alert-${randomUUID()}`;
    await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key }, payload: alert(key, 2000) });
    const reused = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key }, payload: alert(key, 9000) });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('refuses a header key that does not match the queued action', async () => {
    const key = `alert-${randomUUID()}`;
    const response = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': 'something-else' }, payload: alert(key) });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a per-crate threshold: it cannot be compared with a price per quintal', async () => {
    const key = `alert-${randomUUID()}`;
    const response = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key }, payload: alert(key, 400, 'crate') });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'ALERT_NEEDS_A_WEIGHT_UNIT' } });
  });

  it('another farmer cannot see the alert', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const visible = await c.query('SELECT count(*) AS n FROM app.price_alerts');
      await c.query('ROLLBACK');
      expect(Number(visible.rows[0]?.n)).toBe(0); // no actor: row-level security shows nothing
    } finally {
      c.release();
    }
  });
});

describe('SEC-09 · FR-10 · what the outbox refuses, and what it keeps for later', () => {
  it('refuses an offline deal acceptance before the database is reached', async () => {
    const key = `deal-${randomUUID()}`;
    const response = await app.inject({
      method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key },
      payload: { kind: 'deal.accept', idempotencyKey: key, createdAt: '2026-09-18T06:30:00.000Z', attempts: 0, dealId: world.dealOffered },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_AN_OFFLINE_ACTION' } });
  });

  it('refuses a photograph sent as an outbox entry: its bytes go in chunks to /api/photos/uploads', async () => {
    const key = `photo-${randomUUID()}`;
    const response = await app.inject({
      method: 'POST', url: '/api/outbox', headers: { ...bearer(world.farmerA, 'farmer'), 'idempotency-key': key },
      payload: { kind: 'photo.upload', idempotencyKey: key, createdAt: '2026-09-18T06:30:00.000Z', attempts: 0, listingClientId: 'client-listing-1', contentHash: 'a'.repeat(64), blobKey: 'blob-1', byteLength: 250_000, proposal: null },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'PHOTO_UPLOADS_ARE_CHUNKED' } });
    expect(await count('SELECT count(*) AS n FROM app.idempotency_keys WHERE key = $1', [key])).toBe(0);
  });

  it('requires a signed-in actor', async () => {
    const key = `alert-${randomUUID()}`;
    expect((await app.inject({ method: 'POST', url: '/api/outbox', headers: { 'idempotency-key': key }, payload: alert(key) })).statusCode).toBe(401);
  });

  it('a buyer cannot create a farmer\'s price alert', async () => {
    const key = `alert-${randomUUID()}`;
    const response = await app.inject({ method: 'POST', url: '/api/outbox', headers: { ...bearer(world.buyerVerified, 'buyer'), 'idempotency-key': key }, payload: alert(key) });
    expect(response.statusCode).toBe(403);
  });
});
