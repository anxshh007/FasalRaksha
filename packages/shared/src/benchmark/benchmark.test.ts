/** FR-01 · FR-07 — benchmark before price: modal, MSP floor, seven-day movement, seasonal position. */
import { describe, expect, it } from 'vitest';

import { onionBundle } from '../testing/fixtures.js';
import { compareWithBenchmark, computeBenchmark } from './benchmark.js';

describe('FR-07 · the district benchmark', () => {
  const benchmark = computeBenchmark(onionBundle(), '2026-09-06');

  it('reads the district modal, range and as-of date from the bundle, in ₹ per quintal', () => {
    expect(benchmark).toMatchObject({
      crop: 'onion',
      district: 'nashik',
      market: 'lasalgaon',
      modal: { amount: 1840, unit: 'quintal' },
      min: { amount: 1500, unit: 'quintal' },
      max: { amount: 2100, unit: 'quintal' },
      asOf: '2026-09-04',
      ageDays: 2,
      adviceSuppressed: false,
      seasonalPosition: 'within',
    });
  });

  it('computes the seven-day movement over traded days only, skipping market holidays', () => {
    expect(benchmark.trend7).toHaveLength(7);
    expect(benchmark.trendChange?.amount).toEqual({ amount: 80, unit: 'quintal' });
    expect(benchmark.trendChange?.fraction).toBeCloseTo(80 / 1760, 12);
  });

  it('says plainly when a crop has no MSP, rather than inventing a floor', () => {
    expect(benchmark.mspFloor).toBeNull();
    expect(benchmark.vsMsp).toBeNull();
  });

  it('shows the MSP floor, its season and the gap when there is one', () => {
    const soy = computeBenchmark(onionBundle({ crop: 'soybean', msp: { amountPerQuintal: 5328, season: 'KMS 2025-26' }, benchmark: { modal: 4650, min: 4400, max: 4800, unit: 'quintal' } }), '2026-09-06');
    expect(soy.mspFloor).toEqual({ price: { amount: 5328, unit: 'quintal' }, season: 'KMS 2025-26' });
    expect(soy.vsMsp).toEqual({ delta: { amount: -678, unit: 'quintal' }, position: 'below' });
  });

  it('keeps the figure but suppresses advice once the data is past the crop’s limit', () => {
    const old = computeBenchmark(onionBundle(), '2026-09-12');
    expect(old.modal.amount).toBe(1840);
    expect(old.ageDays).toBe(8);
    expect(old.adviceSuppressed).toBe(true);
  });

  it('has no trend change with fewer than two traded days', () => {
    const quiet = computeBenchmark(onionBundle({ trend: [{ date: '2026-09-04', modal: 1840 }] }), '2026-09-05');
    expect(quiet.trendChange).toBeNull();
  });
});

describe('FR-01 · comparing any price with the benchmark', () => {
  const benchmark = computeBenchmark(onionBundle(), '2026-09-06');

  it('"₹110 above today’s Nashik rate" — from a per-quintal offer', () => {
    expect(compareWithBenchmark({ amount: 1950, unit: 'quintal' }, benchmark)).toEqual({ ok: true, value: { delta: { amount: 110, unit: 'quintal' }, position: 'above' } });
  });

  it('normalises a per-kilo or whole-lot price first, once', () => {
    expect(compareWithBenchmark({ amount: 17, unit: 'kg' }, benchmark)).toEqual({ ok: true, value: { delta: { amount: -140, unit: 'quintal' }, position: 'below' } });
    expect(compareWithBenchmark({ amount: 9200, unit: 'lot' }, benchmark, { lotKg: 500 })).toEqual({ ok: true, value: { delta: { amount: 0, unit: 'quintal' }, position: 'at' } });
  });

  it('refuses a whole-lot price when the lot size is unknown', () => {
    expect(compareWithBenchmark({ amount: 9200, unit: 'lot' }, benchmark)).toEqual({ ok: false, reason: 'lot-size-unknown' });
  });
});
