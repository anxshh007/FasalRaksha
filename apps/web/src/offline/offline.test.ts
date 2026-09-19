/**
 * P1-11 · FR-10 · SEC-14 · FR-07 · FR-08 — the device's offline core, in Node against an
 * in-memory IndexedDB, with the network replaced by a fake server serving the committed release
 * bytes. What a phone does when the server answers, when it answers "no", and when nothing
 * answers at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { OutboxEntry } from '@fasal/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeHome, DEFAULT_CONTEXT, todayInIndia } from './compute';
import { DeviceStore, store, useStore, type StoredProfile } from './db';
import { request, setAccessToken } from './http';
import { drain, enqueue, queueSummary } from './outbox';
import { probe } from './reach';
import { restoreSession } from './session';
import { syncDistrict } from './sync';

const ROOT = resolve(import.meta.dirname, '../../../..');
const RELEASES = join(ROOT, 'data', 'bundles');
const VERSION = readdirSync(RELEASES).filter((d) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(d)).sort().at(-1) ?? '';
const PUBLISHED = join(RELEASES, VERSION, 'published');
const manifestBody = readFileSync(join(PUBLISHED, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestBody) as { integrity: string; asOf: string };

// ── a fake server ─────────────────────────────────────────────────────────────────────────

interface Server {
  up: boolean;
  calls: string[];
  tamper: string | null;
  refresh: 'ok' | 'rejected';
  outbox: (body: OutboxEntry) => { status: number; body: unknown };
}

let server: Server;

function reply(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : body, { status, headers: { 'content-type': 'application/json', ...headers } });
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const method = init?.method ?? 'GET';
  server.calls.push(`${method} ${url}`);
  if (!server.up) return Promise.reject(new TypeError('Failed to fetch'));
  const headers = new Headers(init?.headers);
  const etagged = (body: string) => {
    const integrity = (JSON.parse(body) as { integrity: string }).integrity;
    const etag = `"${integrity}"`;
    return headers.get('if-none-match') === etag ? reply(304, '', { etag }) : reply(200, body, { etag });
  };
  if (url === '/api/health') return Promise.resolve(reply(200, '{"ok":true}'));
  if (url === '/api/bundles/manifest') return Promise.resolve(etagged(manifestBody));
  const shared = /^\/api\/bundles\/shared\/(.+)$/.exec(url);
  if (shared) return Promise.resolve(etagged(readFileSync(join(PUBLISHED, 'shared', `${shared[1]}.json`), 'utf8')));
  const bundle = /^\/api\/bundles\/([a-z-]+)\/([a-z-]+)$/.exec(url);
  if (bundle) {
    let body = readFileSync(join(PUBLISHED, 'bundles', `${bundle[1]}__${bundle[2]}.json`), 'utf8');
    if (server.tamper === `${bundle[1]}|${bundle[2]}`) body = body.replace(/"modal":(\d+)/, (_, n: string) => `"modal":${Number(n) + 500}`);
    return Promise.resolve(etagged(body));
  }
  if (url === '/api/auth/refresh') {
    return Promise.resolve(server.refresh === 'ok' ? reply(200, JSON.stringify({ accessToken: 'token-2', sessionId: 's', user: { id: FARMER.userId, role: 'farmer' } })) : reply(401, '{"error":{"code":"SESSION_EXPIRED","message":"Please sign in again."}}'));
  }
  if (url === '/api/me') {
    return Promise.resolve(reply(200, JSON.stringify({ id: FARMER.userId, role: 'farmer', displayName: FARMER.displayName, district: 'nashik', village: 'Lasalgaon', locale: 'mr', verification: { verified: true } })));
  }
  if (url === '/api/outbox') {
    const answer = server.outbox(JSON.parse(String(init?.body)) as OutboxEntry);
    return Promise.resolve(reply(answer.status, JSON.stringify(answer.body)));
  }
  return Promise.resolve(reply(404, '{"error":{"code":"NOT_FOUND","message":"no route"}}'));
}

const FARMER: StoredProfile = {
  id: 'me', userId: '11111111-1111-4111-8111-111111111111', role: 'farmer', displayName: 'Sangita Kadam',
  district: 'nashik', village: 'Lasalgaon', locale: 'mr', verified: true, confirmedAt: 0,
};

let dbCount = 0;
beforeEach(() => {
  useStore(new DeviceStore(`test-${++dbCount}`));
  server = { up: true, calls: [], tamper: null, refresh: 'ok', outbox: () => ({ status: 201, body: { ok: true } }) };
  globalThis.fetch = fakeFetch as typeof fetch;
  setAccessToken(null);
});

afterEach(async () => {
  store().close();
});

const alert = (key: string): OutboxEntry => ({ kind: 'price-alert.create', idempotencyKey: key, createdAt: '2026-09-18T06:30:00.000Z', attempts: 0, crop: 'onion', threshold: { amount: 4000, unit: 'quintal' } });

// ── http ──────────────────────────────────────────────────────────────────────────────────

describe('P1-11 · every failure is classified: unreachable, rejected or failed', () => {
  it('no answer is unreachable, never a rejection', async () => {
    server.up = false;
    expect((await request('/api/me')).kind).toBe('unreachable');
  });

  it("the service worker's cached answer is not the server speaking", async () => {
    globalThis.fetch = (() => Promise.resolve(reply(200, '{}', { 'x-fasal-from-cache': '1' }))) as typeof fetch;
    expect((await request('/api/bundles/manifest')).kind).toBe('unreachable');
  });

  it("a dev proxy's bare 502 means the API is not there", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('Bad gateway', { status: 502 }))) as typeof fetch;
    expect((await request('/api/health')).kind).toBe('unreachable');
  });

  it('a 4xx with a domain code is a rejection; a 5xx is a failure', async () => {
    globalThis.fetch = (() => Promise.resolve(reply(403, '{"error":{"code":"FARMERS_ONLY","message":"no"}}'))) as typeof fetch;
    expect(await request('/api/outbox')).toMatchObject({ kind: 'rejected', status: 403, code: 'FARMERS_ONLY' });
    globalThis.fetch = (() => Promise.resolve(reply(501, '{"error":{"code":"NOT_AVAILABLE_YET","message":"later"}}'))) as typeof fetch;
    expect(await request('/api/outbox')).toMatchObject({ kind: 'failed', status: 501 });
  });
});

// ── bundle sync ───────────────────────────────────────────────────────────────────────────

describe('SEC-14 · FR-07 · district-first sync stores only what verifies', () => {
  it("fetches the farmer's district and the shared bundles it needs, nothing else", async () => {
    const report = await syncDistrict('nashik');
    expect(report.reached).toBe(true);
    expect(report.rejected).toEqual([]);
    const stored = await store().bundles.toArray();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((b) => b.district === 'nashik')).toBe(true);
    expect((await store().shared.toArray()).map((s) => s.name).sort()).toEqual(['climatology/nashik', 'crops', 'districts', 'msp']);
    expect(server.calls.some((c) => c.includes('/latur'))).toBe(false);
  });

  it('a second sync of an unchanged release costs one 304 and no bundle downloads', async () => {
    await syncDistrict('nashik');
    server.calls = [];
    const again = await syncDistrict('nashik');
    expect(server.calls).toEqual(['GET /api/bundles/manifest']);
    expect(again.fetched).toEqual([]);
    expect(again.bytes).toBe(0);
  });

  it('a bundle altered in transit is refused and the verified copy is kept', async () => {
    await syncDistrict('nashik');
    const before = await store().bundles.get('onion|nashik');
    await store().bundles.update('onion|nashik', { integrity: 'sha256-older' }); // force a re-fetch
    server.tamper = 'onion|nashik';
    const report = await syncDistrict('nashik');
    expect(report.rejected).toEqual([{ name: 'onion|nashik', reason: 'content does not match its integrity hash' }]);
    expect((await store().bundles.get('onion|nashik'))?.bundle.benchmark.modal).toBe(before?.bundle.benchmark.modal);
    expect((await store().events.where('kind').equals('integrity-rejected').count())).toBe(1);
  });

  it('with no network nothing changes and the attempt is recorded', async () => {
    server.up = false;
    const report = await syncDistrict('nashik');
    expect(report.reached).toBe(false);
    expect(await store().bundles.count()).toBe(0);
    expect(await store().events.where('kind').equals('unreachable').count()).toBe(1);
  });
});

// ── session ───────────────────────────────────────────────────────────────────────────────

describe('P1-11 · a farmer is not signed out by a missing network', () => {
  it('network unavailable: the last-confirmed profile is restored', async () => {
    await store().profile.put(FARMER);
    server.up = false;
    expect(await restoreSession()).toEqual({ status: 'offline-restored', profile: FARMER });
  });

  it('server reached and the session rejected: signed out, profile cleared', async () => {
    await store().profile.put(FARMER);
    server.refresh = 'rejected';
    expect(await restoreSession()).toEqual({ status: 'signed-out', reason: 'rejected' });
    expect(await store().profile.get('me')).toBeUndefined();
  });

  it('server reached and the session valid: the profile is re-confirmed', async () => {
    const state = await restoreSession(1_000);
    expect(state).toMatchObject({ status: 'signed-in', profile: { district: 'nashik', confirmedAt: 1_000 } });
  });

  it('concurrent restores share one refresh — a rotating token is never presented twice', async () => {
    await Promise.all([restoreSession(), restoreSession(), restoreSession()]);
    expect(server.calls.filter((c) => c === 'POST /api/auth/refresh')).toHaveLength(1);
  });
});

// ── outbox ────────────────────────────────────────────────────────────────────────────────

describe('FR-10 · the outbox keeps every offline action until the server has it', () => {
  it('queuing the same action twice keeps one', async () => {
    expect(await enqueue(alert('alert-000001'), FARMER.userId)).toBe('queued');
    expect(await enqueue(alert('alert-000001'), FARMER.userId)).toBe('already-queued');
    expect((await queueSummary(FARMER.userId)).waiting).toBe(1);
  });

  it('drains when the server answers, and sends the attempt count with the key', async () => {
    const seen: OutboxEntry[] = [];
    server.outbox = (entry) => (seen.push(entry), { status: 201, body: { id: 'a1' } });
    await enqueue(alert('alert-000002'), FARMER.userId);
    expect(await drain(FARMER.userId)).toMatchObject({ sent: 1, stoppedBecause: 'done' });
    expect(seen[0]).toMatchObject({ idempotencyKey: 'alert-000002', attempts: 1 });
    expect((await queueSummary(FARMER.userId)).sent).toBe(1);
  });

  it('with no network nothing is lost: the entry stays queued and draining stops', async () => {
    await enqueue(alert('alert-000003'), FARMER.userId);
    server.up = false;
    expect(await drain(FARMER.userId)).toMatchObject({ sent: 0, stoppedBecause: 'unreachable' });
    expect((await store().outbox.get('alert-000003'))?.state).toBe('queued');
  });

  it('a server that cannot take it yet (501) is retried later with backoff', async () => {
    server.outbox = () => ({ status: 501, body: { error: { code: 'NOT_AVAILABLE_YET', message: 'later' } } });
    await enqueue(alert('alert-000004'), FARMER.userId, 1_000);
    await drain(FARMER.userId, { now: 1_000 });
    const row = await store().outbox.get('alert-000004');
    expect(row?.state).toBe('retrying');
    expect(row?.nextAttemptAt).toBeGreaterThan(1_000);
    expect(await drain(FARMER.userId, { now: 1_001 })).toMatchObject({ deferred: 1, sent: 0 });
  });

  it('a refusal (4xx) is final and shown with its reason', async () => {
    server.outbox = () => ({ status: 422, body: { error: { code: 'ALERT_NEEDS_A_WEIGHT_UNIT', message: 'Use a price per quintal.' } } });
    await enqueue(alert('alert-000005'), FARMER.userId);
    await drain(FARMER.userId);
    expect((await queueSummary(FARMER.userId)).rejected.map((r) => r.lastError)).toEqual(['Use a price per quintal.']);
  });

  it("another account's queued actions are never sent under this one", async () => {
    await enqueue(alert('alert-000006'), 'someone-else');
    expect(await drain(FARMER.userId)).toMatchObject({ sent: 0 });
    expect((await store().outbox.get('alert-000006'))?.state).toBe('queued');
  });
});

// ── on-device computation ─────────────────────────────────────────────────────────────────

describe('FR-08 · FR-07 · home is computed on the phone with no network at all', () => {
  it('benchmark and decision for every crop in the district, from verified bundles only', async () => {
    await syncDistrict('nashik');
    server.up = false;
    server.calls = [];
    const now = Date.parse(`${manifest.asOf}T06:00:00Z`);
    const home = await computeHome(FARMER, DEFAULT_CONTEXT, now);
    expect(server.calls).toEqual([]); // not a single request
    expect(home?.crops.map((c) => c.crop).sort()).toEqual(['grapes', 'onion', 'tomato']);
    const onion = home?.crops.find((c) => c.crop === 'onion');
    expect(onion?.benchmark.modal.amount).toBeGreaterThan(0);
    expect(['sell', 'wait', 'refuse']).toContain(onion?.evaluation.verdict);
    expect(onion?.storage?.facility.district).toBe('nashik');
    expect(home?.location).toMatchObject({ source: 'market-town', marketId: 'lasalgaon' });
    expect(home?.dataSource).toBe('synthetic');
  });

  it('an off-season crop with old prices is shown with its date and no advice', async () => {
    await syncDistrict('nashik');
    const home = await computeHome(FARMER, DEFAULT_CONTEXT, Date.parse(`${manifest.asOf}T06:00:00Z`));
    const grapes = home?.crops.find((c) => c.crop === 'grapes');
    expect(grapes?.benchmark.adviceSuppressed).toBe(true);
    expect(grapes?.evaluation.suppressed).toBe(true);
  });

  it('is recomputed on every call: the time it was computed moves, the prices do not', async () => {
    await syncDistrict('nashik');
    const t0 = Date.parse(`${manifest.asOf}T06:00:00Z`);
    const first = await computeHome(FARMER, DEFAULT_CONTEXT, t0);
    const second = await computeHome(FARMER, DEFAULT_CONTEXT, t0 + 60_000);
    expect(second?.computedAt).toBe(t0 + 60_000);
    expect(second?.crops.map((c) => c.benchmark.modal.amount)).toEqual(first?.crops.map((c) => c.benchmark.modal.amount));
  });

  it("today is India's date, not the phone's time zone", () => {
    expect(todayInIndia(Date.parse('2026-09-18T19:00:00Z'))).toBe('2026-09-19'); // 00:30 IST
    expect(todayInIndia(Date.parse('2026-09-18T18:00:00Z'))).toBe('2026-09-18'); // 23:30 IST
  });
});

describe('P1-11 · reachability is measured', () => {
  it('records when the server was last reached, and keeps it through an outage', async () => {
    expect(await probe(5_000)).toMatchObject({ reachable: true, lastReachedAt: 5_000 });
    server.up = false;
    expect(await probe(9_000)).toMatchObject({ reachable: false, lastReachedAt: 5_000 });
  });
});
