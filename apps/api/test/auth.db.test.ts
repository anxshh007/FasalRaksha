/**
 * P1-09 · ARCH-02 · ARCH-03 — authentication and verification end to end, through HTTP, against
 * a real PostgreSQL: one-time-code sign-up and sign-in, verification pointed at the risky side,
 * rotating refresh tokens with reuse detection, integrity-protected auth rows, and a log stream
 * that never carries the phone number it handled.
 */
import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockMessagingAdapter } from '../src/adapters/messaging/index.js';
import { MOCK_BUSINESSES, MockBuyerRegistryAdapter, MockFarmerRegistryAdapter } from '../src/adapters/registry/mock.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, CSRF_HEADER, REFRESH_COOKIE, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import { createKeyRing } from '../src/security/keys.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;
const messaging = new MockMessagingAdapter();
const logLines: string[] = [];
let clock = new Date('2026-09-06T06:00:00Z');

const FARMER_PHONE = '98765 43210';
const BUYER_PHONE = '+91 98200 00001';
const GODAVARI_GSTIN = MOCK_BUSINESSES.find((b) => b.legalName === 'Godavari Agro Traders')?.id ?? '';
const CANCELLED_GSTIN = MOCK_BUSINESSES.find((b) => b.status === 'cancelled')?.id ?? '';

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({
    DATABASE_URL: db.appUrl,
    NODE_ENV: 'test',
    DB_CONTEXT_KEY: db.contextKey.toString('hex'),
    AUTH_SECRET: randomBytes(32).toString('hex'),
  });
  const keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({
    config,
    logger: createLogger({ level: 'info', destination: { write: (line: string) => void logLines.push(line) } }),
    db: { pool, contextKey: keys.contextKey },
    keys,
    messaging,
    farmerRegistry: new MockFarmerRegistryAdapter(),
    buyerRegistry: new MockBuyerRegistryAdapter(),
    now: () => clock,
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

async function codeFor(phone: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { devCode: string }).devCode;
}

async function signUp(phone: string, signup: Record<string, unknown>): Promise<{ token: string; cookie: string; userId: string }> {
  const code = await codeFor(phone);
  const res = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone, code, signup } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE);
  const body = res.json() as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, cookie: cookie?.value ?? '', userId: body.user.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('P1-09 · sign-in and verification, pointed at the risky side', () => {
  let farmer: { token: string; cookie: string; userId: string };
  let buyer: { token: string; cookie: string; userId: string };

  it('a farmer signs up with a one-time code; the code went to their phone, not into the logs', async () => {
    farmer = await signUp(FARMER_PHONE, { kind: 'farmer', displayName: 'Sunil', locale: 'mr' });
    expect(messaging.outbox('+919876543210')).toHaveLength(1);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(farmer.token) });
    expect(me.json()).toMatchObject({ role: 'farmer', displayName: 'Sunil', district: null, phone: '••••••3210', verification: { verified: false } });
  });

  it('asking for a code never reveals whether the number has an account', async () => {
    const known = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: FARMER_PHONE } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '9123456789' } });
    expect(Object.keys(known.json() as object).sort()).toEqual(Object.keys(unknown.json() as object).sort());
    expect(known.statusCode).toBe(unknown.statusCode);
  });

  it('a wrong code is refused, and five wrong codes lock the challenge', async () => {
    const code = await codeFor('9000000001');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000001', code: wrong, signup: { kind: 'farmer', displayName: 'X', locale: 'mr' } } });
      expect(res.json()).toMatchObject({ error: { code: 'CODE_WRONG' } });
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { phone: '9000000001', code, signup: { kind: 'farmer', displayName: 'X', locale: 'mr' } } });
    expect(locked.json()).toMatchObject({ error: { code: 'TOO_MANY_ATTEMPTS' } });
  });

  it('verifying a PM-KISAN identifier makes the registry name and district the farmer’s identity', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/verify/farmer', headers: bearer(farmer.token), payload: { registry: 'pm-kisan', id: 'pmk-mh-2003-11427' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Sunil Ramrao Bhosale', district: 'nashik' });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(farmer.token) });
    expect(me.json()).toMatchObject({ displayName: 'Sunil Ramrao Bhosale', district: 'nashik', verification: { verified: true, method: 'pm-kisan', last4: '1427' } });
  });

  it('an unknown farmer identifier gets Phase 1’s own domain explanation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/verify/farmer', headers: bearer(farmer.token), payload: { registry: 'pm-kisan', id: 'PMK-MH-9999-99999' } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'FARMER_ID_NOT_FOUND', message: expect.stringMatching(/contact your local agriculture office/) } });
  });

  it('a buyer verifies with GSTIN; a checksum-invalid or cancelled GSTIN is refused with a reason', async () => {
    buyer = await signUp(BUYER_PHONE, { kind: 'buyer', businessName: 'Godavari Agro Traders', place: 'Lasalgaon', district: 'nashik' });
    const typo = GODAVARI_GSTIN.slice(0, 14) + (GODAVARI_GSTIN.endsWith('A') ? 'B' : 'A');
    const bad = await app.inject({ method: 'POST', url: '/api/verify/buyer', headers: bearer(buyer.token), payload: { method: 'gstin', id: typo } });
    expect(bad.json()).toMatchObject({ error: { code: 'BUSINESS_ID_NOT_VALID' } });
    const ok = await app.inject({ method: 'POST', url: '/api/verify/buyer', headers: bearer(buyer.token), payload: { method: 'gstin', id: GODAVARI_GSTIN } });
    expect(ok.json()).toMatchObject({ legalName: 'Godavari Agro Traders', status: 'verified' });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(buyer.token) });
    expect(me.json()).toMatchObject({ role: 'buyer', verification: { verified: true, method: 'gstin' } });
  });

  it('a cancelled registration is recorded as rejected and cannot make offers', async () => {
    const other = await signUp('9820000055', { kind: 'buyer', businessName: 'Kalyan', place: 'Nashik', district: 'nashik' });
    const res = await app.inject({ method: 'POST', url: '/api/verify/buyer', headers: bearer(other.token), payload: { method: 'gstin', id: CANCELLED_GSTIN } });
    expect(res.json()).toMatchObject({ error: { code: 'BUSINESS_NOT_ACTIVE' } });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(other.token) });
    expect(me.json()).toMatchObject({ verification: { verified: false } });
  });

  it('a farmer account cannot verify as a buyer, and vice versa', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/verify/buyer', headers: bearer(farmer.token), payload: { method: 'gstin', id: GODAVARI_GSTIN } });
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_BUYER_ACCOUNT' } });
  });

  it('without a token, nothing personal is served', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED' } });
  });

  it('refresh rotates the token; replaying the old one ends the whole session', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { [CSRF_HEADER]: '1' }, cookies: { [REFRESH_COOKIE]: farmer.cookie } });
    expect(first.statusCode).toBe(200);
    const rotated = first.cookies.find((c) => c.name === REFRESH_COOKIE)?.value ?? '';
    expect(rotated).not.toBe(farmer.cookie);

    const replay = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { [CSRF_HEADER]: '1' }, cookies: { [REFRESH_COOKIE]: farmer.cookie } });
    expect(replay.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });

    // The legitimate newest token died with the family.
    const after = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { [CSRF_HEADER]: '1' }, cookies: { [REFRESH_COOKIE]: rotated } });
    expect(after.json()).toMatchObject({ error: { code: 'SESSION_EXPIRED' } });
  });

  it('refresh without the app’s CSRF header is refused', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: buyer.cookie } });
    expect(res.json()).toMatchObject({ error: { code: 'CSRF_HEADER_MISSING' } });
  });

  it('a refresh token planted with database credentials alone is rejected by its MAC', async () => {
    const planted = randomBytes(32).toString('base64url');
    const { createHmac } = await import('node:crypto');
    // The attacker can write the row but cannot compute the API's keyed hash or MAC.
    const guessedHash = createHmac('sha256', randomBytes(32)).update(planted).digest('hex');
    const raw = new pg.Client({ connectionString: db.appUrl });
    await raw.connect();
    await raw.query(
      "INSERT INTO app_auth.refresh_tokens (user_id, family_id, token_hash, expires_at, mac) VALUES ($1, gen_random_uuid(), $2, now() + interval '1 day', 'deadbeef')",
      [farmer.userId, guessedHash],
    );
    await raw.end();
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { [CSRF_HEADER]: '1' }, cookies: { [REFRESH_COOKIE]: planted } });
    expect(res.json()).toMatchObject({ error: { code: 'SESSION_EXPIRED' } });
  });

  it('an expired access token is refused', async () => {
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(buyer.token) });
    expect(res.statusCode).toBe(401);
  });

  it('security headers are set on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['content-security-policy']).not.toMatch(/unsafe-inline/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
  });
});

describe('ARCH-02 · after every flow above, the log stream carries no phone number', () => {
  it('greps the captured log stream for the seeded numbers', () => {
    const stream = logLines.join('');
    expect(logLines.length).toBeGreaterThan(10);
    for (const form of ['9876543210', '98765 43210', '9820000001', '98200 00001', '9820000055']) expect(stream).not.toContain(form);
  });
});
