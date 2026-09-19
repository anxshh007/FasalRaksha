/**
 * CAM-12 · CAM-13 · CAM-14 · §7.6 · §8.6 — photographs against a real PostgreSQL: a chunked
 * upload that survives a dropped connection and resumes where it stopped, never duplicates,
 * refuses what is not a photograph (by its bytes), keeps the grader's proposal beside the stored
 * image, and serves it only through a URL signed for one viewer.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPhotoStore, SignatureScanAdapter } from '../src/adapters/photos/photos.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import { createKeyRing, type KeyRing } from '../src/security/keys.js';
import { signPhotoUrl } from '../src/security/signed-url.js';
import { issueAccessToken } from '../src/security/tokens.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';
import { seedWorld, type SeededWorld } from './support/seed.js';

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;
let keys: KeyRing;
let world: SeededWorld;
let seed: pg.Client;

const photo = readFileSync(resolve(import.meta.dirname, '../../../data/fixtures/camera/onion-lot-exif-gps.jpg'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bearer = (userId: string, role: 'farmer' | 'buyer') => ({ authorization: `Bearer ${issueAccessToken(keys, { userId, role, sessionId: randomUUID() }, Math.floor(Date.now() / 1000))}` });
const proposal = { grade: 'B', band: 'moderate', views: 4, modelVersion: '2026-09-19.1' };

async function listing(userId = world.farmerA): Promise<string> {
  const clientId = `listing-${randomUUID()}`;
  const key = `create-${randomUUID()}`;
  const response = await app.inject({
    method: 'POST', url: '/api/outbox', headers: { ...bearer(userId, 'farmer'), 'idempotency-key': key },
    payload: {
      kind: 'listing.create', idempotencyKey: key, createdAt: '2026-09-19T06:30:00.000Z', attempts: 0,
      listing: { clientId, crop: 'onion', quantity: { value: 20, unit: 'quintal' }, askingPrice: null, grade: 'B', gradeProvenance: 'farmer-declared-ai-assisted', availableFrom: '2026-09-19', availableUntil: '2026-09-26', poolOptIn: false },
    },
  });
  expect(response.statusCode).toBe(201);
  return clientId;
}

const open = (userId: string, body: Record<string, unknown>, role: 'farmer' | 'buyer' = 'farmer') => app.inject({ method: 'POST', url: '/api/photos/uploads', headers: bearer(userId, role), payload: body });
const put = (userId: string, id: string, offset: number, bytes: Uint8Array) =>
  app.inject({ method: 'PUT', url: `/api/photos/uploads/${id}`, headers: { ...bearer(userId, 'farmer'), 'content-type': 'application/octet-stream', 'upload-offset': String(offset) }, payload: Buffer.from(bytes) });

async function uploadWhole(userId: string, clientId: string, bytes: Uint8Array, chunk = 16 * 1024) {
  const opened = await open(userId, { listingClientId: clientId, contentHash: sha(bytes), byteLength: bytes.byteLength, proposal });
  const state = opened.json() as { uploadId: string; offset: number; status: string };
  let last = opened;
  for (let offset = state.offset; offset < bytes.byteLength; offset += chunk) last = await put(userId, state.uploadId, offset, bytes.subarray(offset, offset + chunk));
  return last;
}

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
    photos: { store: new LocalPhotoStore(mkdtempSync(join(tmpdir(), 'fasal-photos-db-'))), scanner: new SignatureScanAdapter() },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await seed?.end();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('CAM-13 · resumable and idempotent', () => {
  it('a photograph for a listing the server has not received yet waits (409, retried by the phone)', async () => {
    const response = await open(world.farmerA, { listingClientId: `listing-${randomUUID()}`, contentHash: sha(photo), byteLength: photo.byteLength });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'LISTING_NOT_YET_RECEIVED' } });
  });

  it('a dropped connection resumes from the bytes that arrived; a retry of the finished photo is the same photo', async () => {
    const clientId = await listing();
    const opened = await open(world.farmerA, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength, proposal });
    expect(opened.statusCode).toBe(200);
    const { uploadId, offset } = opened.json() as { uploadId: string; offset: number };
    expect(offset).toBe(0);
    expect((await put(world.farmerA, uploadId, 0, photo.subarray(0, 20_000))).json()).toMatchObject({ status: 'open', offset: 20_000 });
    // …the connection drops. The phone asks again and is told where to carry on.
    const reopened = await open(world.farmerA, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength, proposal });
    expect(reopened.json()).toMatchObject({ status: 'open', uploadId, offset: 20_000 });
    // A chunk from the wrong place is refused, not appended.
    expect((await put(world.farmerA, uploadId, 0, photo.subarray(0, 100))).statusCode).toBe(409);
    const done = await put(world.farmerA, uploadId, 20_000, photo.subarray(20_000));
    expect(done.statusCode).toBe(200);
    const stored = done.json() as { status: string; photoId: string; width: number; height: number };
    expect(stored).toMatchObject({ status: 'stored', width: 640, height: 480 }); // oriented upright

    // The same photo again (a retry after the answer was lost): the same row, never a second.
    const again = await open(world.farmerA, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength, proposal });
    expect(again.json()).toMatchObject({ status: 'stored', photoId: stored.photoId });
    expect((await put(world.farmerA, uploadId, 0, photo.subarray(0, 10))).json()).toMatchObject({ status: 'stored', photoId: stored.photoId });
    const rows = await seed.query('SELECT proposed_grade, proposal_band, proposal_views, model_version FROM app.listing_photos WHERE id = $1', [stored.photoId]);
    expect(rows.rows).toEqual([{ proposed_grade: 'B', proposal_band: 'moderate', proposal_views: 4, model_version: '2026-09-19.1' }]); // §7.6
    expect((await seed.query('SELECT count(*)::int AS n FROM app.listing_photos WHERE content_hash = $1', [sha(photo)])).rows[0]).toEqual({ n: 1 });
  });

  it('more bytes than announced are refused while they stream', async () => {
    const clientId = await listing();
    const opened = (await open(world.farmerA, { listingClientId: clientId, contentHash: sha(photo.subarray(0, 1000)), byteLength: 1000 })).json() as { uploadId: string };
    const response = await put(world.farmerA, opened.uploadId, 0, photo.subarray(0, 1001));
    expect(response.statusCode).toBe(413);
  });

  it('a chunk larger than one request may carry is refused by the server itself', async () => {
    const clientId = await listing();
    const big = new Uint8Array(300 * 1024);
    big.set([0xff, 0xd8, 0xff]);
    const opened = (await open(world.farmerA, { listingClientId: clientId, contentHash: sha(big), byteLength: big.byteLength })).json() as { uploadId: string };
    expect((await put(world.farmerA, opened.uploadId, 0, big)).statusCode).toBe(413);
  });
});

describe('§8.6 · what is not a photograph never becomes one', () => {
  it('SVG is refused on its first bytes, and stays refused', async () => {
    const clientId = await listing();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const opened = (await open(world.farmerA, { listingClientId: clientId, contentHash: sha(svg), byteLength: svg.byteLength })).json() as { uploadId: string };
    const response = await put(world.farmerA, opened.uploadId, 0, svg);
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_AN_IMAGE' } });
    expect((await open(world.farmerA, { listingClientId: clientId, contentHash: sha(svg), byteLength: svg.byteLength })).statusCode).toBe(415);
  });

  it('the virus-scan hook refuses a known-bad file (the EICAR test file)', async () => {
    const clientId = await listing();
    const eicar = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1')]);
    const response = await uploadWhole(world.farmerA, clientId, eicar);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'REFUSED_BY_SCAN' } });
  });

  it('bytes that are not what the phone fingerprinted are refused', async () => {
    const clientId = await listing();
    const opened = (await open(world.farmerA, { listingClientId: clientId, contentHash: sha(Buffer.from('something else')), byteLength: photo.byteLength })).json() as { uploadId: string };
    const response = await put(world.farmerA, opened.uploadId, 0, photo.subarray(0, 200 * 1024)).then(async (first) =>
      first.statusCode === 200 ? put(world.farmerA, opened.uploadId, 200 * 1024, photo.subarray(200 * 1024)) : first,
    );
    expect(response.json()).toMatchObject({ error: { code: 'HASH_MISMATCH' } });
  });
});

describe('§8.6 · ownership, limits and signed URLs', () => {
  it('another farmer can neither append to my upload nor see it; a buyer cannot upload at all', async () => {
    const clientId = await listing();
    const opened = (await open(world.farmerA, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength })).json() as { uploadId: string };
    expect((await put(world.farmerB, opened.uploadId, 0, photo.subarray(0, 100))).statusCode).toBe(404);
    // Farmer B naming farmer A's listing finds nothing: listings are looked up among B's own.
    expect((await open(world.farmerB, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength })).statusCode).toBe(409);
    expect((await open(world.buyerVerified, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength }, 'buyer')).statusCode).toBe(403);
  });

  it('the stored photo is served only by a URL signed for the viewer, as a nosniff attachment, with no metadata', async () => {
    const clientId = await listing();
    expect((await uploadWhole(world.farmerA, clientId, photo)).json()).toMatchObject({ status: 'stored' });
    const mine = await app.inject({ method: 'GET', url: '/api/listings/mine', headers: bearer(world.farmerA, 'farmer') });
    const entry = (mine.json() as { listings: { clientId: string; grade: string; gradeProvenance: string; photos: { url: string; width: number }[] }[] }).listings.find((l) => l.clientId === clientId);
    expect(entry).toMatchObject({ grade: 'B', gradeProvenance: 'farmer-declared-ai-assisted' });
    const url = entry?.photos[0]?.url ?? '';
    expect(url).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\?v=.+&e=\d+&s=[0-9a-f]{64}$/);

    const served = await app.inject({ method: 'GET', url, headers: bearer(world.farmerA, 'farmer') });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['content-disposition']).toBe('attachment; filename="photo.jpg"');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(served.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect(served.rawPayload.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false); // no EXIF segment, so no GPS

    // Signed for A: useless to B, useless tampered, useless without signing in.
    expect((await app.inject({ method: 'GET', url, headers: bearer(world.farmerB, 'farmer') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: url.replace(/s=([0-9a-f])/, (_m, c: string) => `s=${c === '0' ? '1' : '0'}`), headers: bearer(world.farmerA, 'farmer') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    // An expired link says so.
    const storageKey = url.split('/')[3]?.split('?')[0] ?? '';
    const stale = signPhotoUrl(keys, storageKey, world.farmerA, Math.floor(Date.now() / 1000) - 3600);
    expect((await app.inject({ method: 'GET', url: stale, headers: bearer(world.farmerA, 'farmer') })).statusCode).toBe(410);
    // A URL signed for B, for A's photo, still finds nothing: RLS hides another farmer's photo.
    const forB = signPhotoUrl(keys, storageKey, world.farmerB, Math.floor(Date.now() / 1000));
    expect((await app.inject({ method: 'GET', url: forB, headers: bearer(world.farmerB, 'farmer') })).statusCode).toBe(404);
  });

  it('an account opening too many uploads in an hour is told to wait; the photos stay on the phone', async () => {
    const clientId = await listing(world.farmerB);
    const listingId = (await seed.query<{ id: string }>('SELECT id FROM app.listings WHERE client_id = $1', [clientId])).rows[0]?.id;
    for (let i = 0; i < 30; i++) {
      await seed.query('INSERT INTO app.photo_uploads (farmer_id, listing_id, content_hash, declared_bytes, status, refusal) VALUES ($1, $2, $3, 10, $4, $5)', [world.farmerB, listingId, sha(Buffer.from(`p${i}`)), 'refused', 'NOT_AN_IMAGE']);
    }
    const response = await open(world.farmerB, { listingClientId: clientId, contentHash: sha(photo), byteLength: photo.byteLength });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: { code: 'PHOTO_RATE_LIMIT' } });
  });
});
