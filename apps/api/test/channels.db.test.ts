/**
 * P19 gate · FR-07 · §XII — all four channels return the identical benchmark figure for the same
 * crop × district × date.
 *
 * The PWA is the richest channel and the narrowest. A farmer with a feature phone gets the same
 * number as a farmer with an Android, or the product is optimising for the people least injured
 * by the problem it exists to solve. So the figure is compared four ways: the way the app
 * computes it on the device, and the way the WhatsApp reply, the SMS and the IVR script say it.
 *
 * Also here: the webhook is closed without the gateway's shared secret, the SMS costs exactly one
 * segment, and nothing account-specific ever leaves through a channel.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { computeBenchmark, parseCropBundle, type CropBundle } from '@fasal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import type { ChannelReply } from '../src/modules/channels/service.js';
import { createKeyRing } from '../src/security/keys.js';
import { latestPipelineVersion, publish } from '../scripts/lib/release.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const VERSION = latestPipelineVersion() ?? '';
const bundle = parseCropBundle(JSON.parse(readFileSync(join(ROOT, 'data', 'bundles', VERSION, 'published', 'bundles', 'onion__nashik.json'), 'utf8'))) as CropBundle;
const NOW = new Date(`${bundle.asOf}T06:00:00Z`);
const SECRET = 'a-gateway-shared-secret-value';

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;

const inbound = (channel: 'whatsapp' | 'sms' | 'ivr', text: string, headers: Record<string, string> = { 'x-channel-secret': SECRET }) =>
  app.inject({ method: 'POST', url: `/api/channels/${channel}/webhook`, headers, payload: { from: '+919822000000', text } });

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({
    DATABASE_URL: db.appUrl,
    NODE_ENV: 'test',
    DB_CONTEXT_KEY: db.contextKey.toString('hex'),
    AUTH_SECRET: randomBytes(32).toString('hex'),
    CHANNEL_SECRET: SECRET,
  });
  const keys = createKeyRing(config.AUTH_SECRET, config.DB_CONTEXT_KEY);
  app = buildApp({ config, logger: createLogger({ level: 'fatal', destination: { write: () => undefined } }), db: { pool, contextKey: keys.contextKey }, keys, now: () => NOW });
  await app.ready();
  await publish(VERSION, { ownerUrl: db.ownerUrl, env: {} });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('§XII · the same figure, whatever the farmer is holding', () => {
  it('app, WhatsApp, SMS and IVR quote one number for onion in Nashik today', async () => {
    // 1 · the app: what the phone computes for itself from the verified bundle.
    const onDevice = Math.round(computeBenchmark(bundle, bundle.asOf).modal.amount);

    const [whatsapp, sms, ivr] = await Promise.all([inbound('whatsapp', 'कांदा लासलगाव भाव'), inbound('sms', 'KANDA LASALGAON'), inbound('ivr', 'kanda lasalgaon')]);
    for (const response of [whatsapp, sms, ivr]) expect(response.statusCode, response.body).toBe(200);
    const replies = [whatsapp, sms, ivr].map((r) => r.json() as ChannelReply);

    for (const reply of replies) {
      expect(reply.understood.crop).toBe('onion');
      expect(reply.understood.district).toBe('nashik');
      expect(reply.asOf).toBe(bundle.asOf);
      expect(reply.benchmarkPerQtl).toBe(onDevice); // ← the gate
      expect(reply.text).toContain(String(onDevice)); // and it is in the words, not only the payload
    }
  });

  it('the SMS is one segment, in an alphabet a feature phone can print', async () => {
    const reply = (await inbound('sms', 'KANDA LASALGAON')).json() as ChannelReply;
    expect(reply.segments).toBe(1);
    expect(reply.text.length).toBeLessThanOrEqual(160);
    expect(reply.text).toMatch(/^[\x20-\x7E·]+$/); // no Devanagari: 70 characters a segment, and paid for
    expect(reply.text).toContain('Rs');
    expect(reply.text).toContain('/qtl'); // a price never without its unit (P1-03)
  });

  it('the IVR script is short utterances, and the menu comes last', async () => {
    const reply = (await inbound('ivr', 'kanda lasalgaon')).json() as ChannelReply;
    expect(reply.utterances?.length).toBeGreaterThanOrEqual(3);
    for (const line of reply.utterances ?? []) expect(line.length).toBeLessThanOrEqual(120);
    expect(reply.utterances?.at(-1)).toContain('दाबा'); // "press" — the menu, after the price
  });

  it('a message it cannot read gets an example, not an error', async () => {
    const reply = (await inbound('sms', 'zzzz')).json() as ChannelReply;
    expect(reply.benchmarkPerQtl).toBeNull();
    expect(reply.text).toContain('KANDA LASALGAON'); // §10.4: no generic errors in this product
  });
});

describe('§XII · a channel is a gateway, not an identity', () => {
  it('the webhook is closed without the gateway secret, and closed with the wrong one', async () => {
    expect((await inbound('sms', 'KANDA LASALGAON', {})).statusCode).toBe(401);
    expect((await inbound('sms', 'KANDA LASALGAON', { 'x-channel-secret': 'not-the-secret' })).statusCode).toBe(401);
    expect((await inbound('sms', 'KANDA LASALGAON', { 'x-channel-secret': `${SECRET}x` })).statusCode).toBe(401);
  });

  it('nothing account-specific ever leaves through one, however the sender identifies', async () => {
    const reply = (await inbound('whatsapp', 'माझे सौदे दाखवा')).json() as ChannelReply;
    const body = JSON.stringify(reply);
    for (const forbidden of ['9822', 'deal', 'offer', 'listing', 'buyer']) expect(body.toLowerCase()).not.toContain(forbidden);
  });
});
