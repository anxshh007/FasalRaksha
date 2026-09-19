/**
 * FR-08 · RK-8 · RK-9 — the evidence ledger shows all nine layers, with measured weights and
 * plain stances, from a real committed bundle and the device's own evaluation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { evaluateWait, findReachableStorage, parseCropBundle, SERVER_LAYERS, type CropBundle } from '@fasal/shared';
import { describe, expect, it } from 'vitest';

import { evidenceLedger, roundAhead, stanceOf, type LayerRow } from './evidence';

const ROOT = resolve(import.meta.dirname, '../../../..');
const RELEASES = join(ROOT, 'data', 'bundles');
const VERSION = readdirSync(RELEASES).filter((d) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(d)).sort().at(-1) ?? '';
const load = (crop: string, district: string): CropBundle =>
  parseCropBundle(JSON.parse(readFileSync(join(RELEASES, VERSION, 'published', 'bundles', `${crop}__${district}.json`), 'utf8')));

const LASALGAON = { lat: 20.1497, lon: 74.233 };

function evaluate(bundle: CropBundle, today = bundle.asOf) {
  const storage = findReachableStorage(bundle.storage, LASALGAON, bundle.crop, 5, bundle.benchmark.modal);
  return evaluateWait({ bundle, horizon: 7, quantityQtl: 5, storage, financeRateAnnual: 0.12, tolerableLossFraction: 0.02, today });
}

describe('FR-08 · the ledger has nine rows, RK-1 to RK-9, in order', () => {
  const bundle = load('onion', 'nashik');
  const rows = evidenceLedger(bundle, evaluate(bundle));

  it('lists the nine layers', () => {
    expect(rows.map((r) => r.id)).toEqual([...SERVER_LAYERS, 'RK-7', 'RK-8', 'RK-9']);
  });

  it('carries each server layer\'s measured weight exactly as the bundle ships it', () => {
    for (const row of rows.filter((r): r is LayerRow => r.kind === 'layer')) {
      expect(row.weight).toBe(bundle.raksha.layers[row.id].weight);
      expect(row.share).toBeGreaterThanOrEqual(0);
      expect(row.share).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...rows.filter((r): r is LayerRow => r.kind === 'layer').map((r) => r.share))).toBe(1);
  });

  it('counts the seven checks', () => {
    const checks = rows.find((r) => r.kind === 'checks');
    expect(checks?.kind === 'checks' && checks.passed + checks.failed.length + checks.notEvaluated.length).toBe(7);
  });
});

describe('RK-8 · stances are relative to where the evidence leans', () => {
  it('agrees → supporting; opposite → against; flat on either side → neutral; no weight → no say', () => {
    expect(stanceOf('up', 'up', 0.2)).toBe('supporting');
    expect(stanceOf('down', 'up', 0.2)).toBe('against');
    expect(stanceOf('flat', 'up', 0.2)).toBe('neutral');
    expect(stanceOf('up', 'flat', 0.2)).toBe('neutral');
    expect(stanceOf('up', 'up', 0)).toBe('silent');
    expect(stanceOf(null, 'up', 0.3)).toBe('silent');
  });
});

describe('RK-9 · a withheld or stale crop still gets a ledger, and every layer says nothing', () => {
  it('grapes (off season, prices from June) — no forecast, all layers silent, checks fail on freshness', () => {
    const grapes = load('grapes', 'nashik');
    const rows = evidenceLedger(grapes, evaluate(grapes, '2026-09-19'));
    expect(rows).toHaveLength(9);
    expect(rows.filter((r): r is LayerRow => r.kind === 'layer').every((r) => r.stance === 'silent')).toBe(true);
    const checks = rows.find((r) => r.kind === 'checks');
    expect(checks?.kind === 'checks' && checks.failed).toContain('GR-1');
  });
});

describe('no fake precision', () => {
  it('anything ahead is shown to the nearest ₹10', () => {
    expect(roundAhead(3369.99)).toBe(3370);
    expect(roundAhead(1784)).toBe(1780);
  });
});
