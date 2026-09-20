/**
 * P20 · §14.4 — Judge Mode reports what is actually there.
 *
 * The point of this surface is that it can be checked, so the test checks it against the same
 * artefacts and the same database: the release it names is the release loaded, the adapters it
 * lists are the adapters configured, the validation table is the pipeline's own report, and the
 * vision numbers are held-out synthetic ones that say so.
 *
 * And the thing it must never contain: anybody's data.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { buildApp, type App } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';
import type { JudgeStatus } from '../src/modules/judge/service.js';
import { createKeyRing } from '../src/security/keys.js';
import { latestPipelineVersion, publish } from '../scripts/lib/release.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';
import { seedWorld } from './support/seed.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const VERSION = latestPipelineVersion() ?? '';
const NOW = new Date('2026-09-20T06:00:00Z');

let cluster: TestCluster;
let db: TestDatabase;
let pool: Pool;
let app: App;

const status = async (): Promise<JudgeStatus> => {
  const response = await app.inject({ method: 'GET', url: '/api/_judge/status' });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as JudgeStatus;
};

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);
  await seedWorld(db.seedUrl); // real farmers, buyers and deals exist: none of them may show up below
  pool = createPool(db.appUrl, { max: 4 });
  const config = loadConfig({ DATABASE_URL: db.appUrl, NODE_ENV: 'test', DB_CONTEXT_KEY: db.contextKey.toString('hex'), AUTH_SECRET: randomBytes(32).toString('hex') });
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

describe('§14.4 · it reports the release that is loaded, not the newest folder on disk', () => {
  it('names the version, its date, its age today and what it was built from', async () => {
    const judge = await status();
    expect(judge.release.version).toBe(VERSION);
    const pipeline = JSON.parse(readFileSync(join(ROOT, 'data', 'bundles', VERSION, 'pipeline', 'manifest.json'), 'utf8')) as { asOf: string; dataSource: string; cores: unknown[] };
    expect(judge.release.asOf).toBe(pipeline.asOf);
    expect(judge.release.dataSource).toBe(pipeline.dataSource); // "synthetic", and the app says so too
    expect(judge.release.ageDays).toBe(2); // the app clock is two days past the bundle
    expect(judge.release.bundles).toHaveLength(pipeline.cores.length);
  });

  it('lists every adapter with the mode it is actually running in', async () => {
    const judge = await status();
    // Nothing was configured live in this test, and a live adapter missing a credential cannot
    // start the server at all (config.ts), so "mock" here is a report rather than a claim.
    for (const [name, mode] of Object.entries(judge.adapters)) {
      if (name === 'channels') expect(mode).toBe('closed'); // no CHANNEL_SECRET: the webhook is shut
      else expect(mode).toBe('mock');
    }
  });

  it('carries the pipeline validation table and the ingest report as they were written', async () => {
    const judge = await status();
    const report = JSON.parse(readFileSync(join(ROOT, 'data', 'clean', 'validation_report.json'), 'utf8')) as Array<{ crop: string; horizons: Record<string, unknown> }>;
    const rows = report.reduce((n, entry) => n + Object.keys(entry.horizons).length, 0);
    expect(judge.validation).toHaveLength(rows);
    const onion = judge.validation.find((v) => v.crop === 'onion' && v.district === 'nashik' && v.horizon === 'h7');
    expect(onion?.skillSeasonal).toBeTypeOf('number');
    expect(onion?.coverageConformal).toBeTypeOf('number');
    expect(judge.ingest?.['raw_rows']).toBeTypeOf('number');
    expect(judge.ingest?.['rejected_by_reason']).toBeTypeOf('object'); // why rows were thrown away
  });

  it('says the grading numbers are held-out synthetic ones, and that nothing is field-validated', async () => {
    const judge = await status();
    expect(judge.vision?.fieldValidated).toBe(false);
    expect(judge.vision?.note).toContain('synthetic');
    expect(judge.vision?.families.length).toBeGreaterThan(0);
  });

  it('counts REQUIREMENTS.csv, which is Gate J\'s own evidence', async () => {
    const judge = await status();
    const rows = readFileSync(join(ROOT, 'REQUIREMENTS.csv'), 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim().length > 0);
    expect(judge.requirements.total).toBe(rows.length);
    expect(judge.requirements.byFamily['P1']).toBe(12);
    expect(judge.requirements.tested).toBeGreaterThan(60);
  });
});

describe('§14.4 · diagnostics are not a back door', () => {
  it('contains no farmer, no buyer, no deal and no phone number', async () => {
    const body = JSON.stringify(await status()).toLowerCase();
    for (const forbidden of ['farmer_id', 'phone', 'seller', 'listing', '9822', 'godavari']) expect(body).not.toContain(forbidden);
  });
});
