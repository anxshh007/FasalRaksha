/**
 * FR-08 · RK-7 · RK-9 · GR-1…GR-7 · Gate E — the seven gates as seven independent refusals, and
 * the cost-sensitive downside rule, on the device.
 */
import { describe, expect, it } from 'vitest';

import type { CropBundle, HorizonForecast } from '../bundle/types.js';
import { FARMER_VILLAGE, onionBundle, WAREHOUSE } from '../testing/fixtures.js';
import { carryCost, evaluateWait, gr7Storage, type WaitInput } from './decision.js';
import { findReachableStorage, type StorageChoice } from './storage.js';

const TODAY = '2026-09-06';
const storageFor = (bundle: CropBundle): StorageChoice | null => findReachableStorage(bundle.storage, FARMER_VILLAGE, 'onion', 5, bundle.benchmark.modal);

function input(bundle: CropBundle = onionBundle(), extra: Partial<WaitInput> = {}): WaitInput {
  return { bundle, horizon: 7, quantityQtl: 5, storage: storageFor(bundle), financeRateAnnual: 0.12, tolerableLossFraction: 0.02, today: TODAY, ...extra };
}

function withH7(changes: Partial<HorizonForecast>, extra: Partial<CropBundle> = {}): CropBundle {
  const base = onionBundle();
  const h7 = base.forecast?.h7;
  if (!h7) throw new Error('fixture has no h7');
  return onionBundle({ forecast: { h7: { ...h7, ...changes }, h14: base.forecast?.h14 ?? null }, ...extra });
}

describe('RK-9 · the baseline case clears every condition', () => {
  const result = evaluateWait(input());

  it('suggests waiting only when all seven gates and RK-7 pass', () => {
    expect(result.conditions.map((c) => [c.id, c.status])).toEqual([
      ['GR-1', 'pass'], ['GR-2', 'pass'], ['GR-3', 'pass'], ['GR-4', 'pass'], ['GR-5', 'pass'], ['GR-6', 'pass'], ['GR-7', 'pass'], ['RK-7', 'pass'],
    ]);
    expect(result).toMatchObject({ verdict: 'wait', headline: 'WAIT_MAY_BE_POSSIBLE', failedConditions: [], primaryRefusal: null, lean: 'up', evidenceStrength: 'moderate', suppressed: false });
  });

  it('nets storage, spoilage and financing out of the gain before showing it (RK-7)', () => {
    const carry = carryCost({ facility: WAREHOUSE, roadKm: 10 }, 'onion', 1840, 7, 0.12);
    // 30·7/30 + 0.02·7/30·1840 + 0.09·1840·7/365 — the e-NWR pledge rate, not the farmer's 12%.
    expect(carry.perQuintal).toBeCloseTo(7 + 8.586666666666666 + 3.1758904109589044, 9);
    expect(carry.financeSource).toBe('e-nwr-pledge');
    expect(result.expectedGain?.amount).toBeCloseTo(1990 - 1840 - carry.perQuintal, 9);
    expect(result.carry?.amount).toBeCloseTo(carry.perQuintal, 9);
  });

  it('widens the band with the data’s age before reasoning about it', () => {
    // age 2 days, κ 0.02 → ×1.04 about the median
    expect(result.band?.q10).toBeCloseTo(1990 - 140 * 1.04, 9);
    expect(result.band?.q90).toBeCloseTo(1990 + 160 * 1.04, 9);
  });
});

describe('Gate E · any single failed condition blocks WAIT, each with its own refusal', () => {
  const only = (bundle: CropBundle, extra: Partial<WaitInput> = {}) => evaluateWait(input(bundle, extra));

  it('GR-1 · stale data: "Not enough current data to advise you" — and no advice at all', () => {
    const r = only(onionBundle(), { today: '2026-09-12' });
    expect(r.failedConditions).toEqual(['GR-1']);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-1', suppressed: true, lean: null, band: null, expectedGain: null });
  });

  it('GR-2 · the forecast does not beat the seasonal baseline', () => {
    const r = only(withH7({ skillSeasonal: -0.01 }));
    expect(r.failedConditions).toEqual(['GR-2']);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-2', lean: null });
  });

  it('GR-3 · confidence below the higher of the policy floor and the crop’s own threshold', () => {
    const r = only(withH7({ confidenceMin: 0.6 }));
    expect(r.failedConditions).toEqual(['GR-3']);
    expect(r.conditions.find((c) => c.id === 'GR-3')?.threshold).toBe(0.6);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-3' });
  });

  it('GR-4 · the signals do not agree strongly enough', () => {
    const r = only(withH7({ agreement: 0.5 }));
    expect(r.failedConditions).toEqual(['GR-4']);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-4', evidenceStrength: 'weak' });
  });

  it('GR-5 · the season points the other way', () => {
    const base = onionBundle();
    const bundle = onionBundle({
      seasonal: { woyMedian: 1755, woyIQR: [1600, 1980], position: 'above' },
      raksha: { layers: { ...base.raksha.layers, 'RK-2': { bucket: 'down', weight: 0.3, value: -0.05 } } },
    });
    const r = only(bundle);
    expect(r.failedConditions).toEqual(['GR-5']);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-5' });
  });

  it('GR-5 · with no seasonal history there is no season to contradict the signal', () => {
    const base = onionBundle();
    const bundle = onionBundle({
      seasonal: null,
      raksha: { layers: { ...base.raksha.layers, 'RK-2': { bucket: 'down', weight: 0.3, value: -0.05 } } },
    });
    expect(evaluateWait(input(bundle)).conditions.find((c) => c.id === 'GR-5')?.status).toBe('pass');
  });

  it('GR-6 · expected upside does not cover storage and spoilage costs', () => {
    // A tight band and an expensive warehouse: the gain is gone, the downside is still tolerable.
    const costly = { ...WAREHOUSE, ratePerQtlMonth: 600 };
    const bundle = withH7({ q10: 1985 }, { storage: [costly] });
    const r = only(bundle, { storage: { facility: costly, roadKm: 10 } });
    expect(r.failedConditions).toEqual(['GR-6']);
    expect(r.expectedGain?.amount).toBeLessThan(0);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-6' });
  });

  it('GR-7 · waiting may not be practical: no storage within reach', () => {
    const r = only(onionBundle({ storage: [] }), { storage: null });
    expect(r.failedConditions).toEqual(['GR-7']);
    // Without a warehouse the carry cannot be costed, so GR-6 and RK-7 are not evaluated — not passed.
    expect(r.conditions.filter((c) => c.status === 'not-evaluated').map((c) => c.id)).toEqual(['GR-6', 'RK-7']);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-7', carry: null });
  });

  it('GR-7 · a warehouse that is too far, full, or does not take the crop is not "within reach"', () => {
    expect(gr7Storage({ facility: WAREHOUSE, roadKm: 61 }, 'onion', 5).status).toBe('fail');
    expect(gr7Storage({ facility: { ...WAREHOUSE, capacityAvailableQtl: 4 }, roadKm: 10 }, 'onion', 5).status).toBe('fail');
    expect(gr7Storage({ facility: WAREHOUSE, roadKm: 10 }, 'soybean', 5).status).toBe('fail');
    expect(gr7Storage({ facility: WAREHOUSE, roadKm: 10 }, 'onion', 5).status).toBe('pass');
  });

  it('RK-7 · the bad case would cost more than τ_loss of the lot', () => {
    const r = only(withH7({ q10: 1700 }));
    expect(r.failedConditions).toEqual(['RK-7']);
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'RK-7' });
  });

  it('RK-7 · a farmer who can tolerate more loss may be told waiting is possible', () => {
    expect(only(withH7({ q10: 1700 }), { tolerableLossFraction: 0.1 }).verdict).toBe('wait');
  });
});

describe('FR-08 · what the farmer is told', () => {
  it('unanimous calm is reported as confident calm — "sell now", strong evidence', () => {
    const r = evaluateWait(input(withH7({ direction: 'flat', agreement: 1, q10: 1800, q50: 1845, q90: 1890 })));
    expect(r).toMatchObject({ verdict: 'sell', headline: 'SELL_NOW', lean: 'flat', evidenceStrength: 'strong', primaryRefusal: null });
  });

  it('a falling market with agreeing evidence says sell now', () => {
    const r = evaluateWait(input(withH7({ direction: 'down', agreement: 0.8, q10: 1650, q50: 1760, q90: 1880 })));
    expect(r).toMatchObject({ verdict: 'sell', headline: 'SELL_NOW', lean: 'down' });
  });

  it('a falling market with disagreeing evidence refuses to advise either way', () => {
    const r = evaluateWait(input(withH7({ direction: 'down', agreement: 0.45, q10: 1650, q50: 1760, q90: 1880 })));
    expect(r).toMatchObject({ verdict: 'refuse', headline: 'NOT_ENOUGH_EVIDENCE_TO_WAIT' });
  });

  it('a crop with no published forecast renders honestly: GR-2 refuses, nothing else is guessed', () => {
    const r = evaluateWait(input(onionBundle({ status: 'insufficient', forecast: null })));
    expect(r).toMatchObject({ verdict: 'refuse', primaryRefusal: 'GR-2', lean: null, band: null, confidence: null, expectedGain: null });
    expect(r.conditions.filter((c) => c.status === 'not-evaluated').map((c) => c.id)).toEqual(['GR-3', 'GR-4', 'GR-5', 'GR-6', 'RK-7']);
  });

  it('uses the farmer’s own cost of money when the warehouse offers no e-NWR pledge', () => {
    const plain = { ...WAREHOUSE, eNwr: false, pledgeRateAnnual: null };
    const r = evaluateWait(input(onionBundle({ storage: [plain] }), { storage: { facility: plain, roadKm: 10 } }));
    expect(r.finance).toEqual({ rateAnnual: 0.12, source: 'own-credit' });
  });

  it('evaluates the 14-day horizon independently', () => {
    const r = evaluateWait(input(onionBundle(), { horizon: 14 }));
    expect(r.horizon).toBe(14);
    expect(r.conditions.find((c) => c.id === 'GR-4')?.measured).toBe(0.7);
  });

  it('rejects an impossible lot size or loss tolerance', () => {
    expect(() => evaluateWait(input(onionBundle(), { quantityQtl: 0 }))).toThrow(RangeError);
    expect(() => evaluateWait(input(onionBundle(), { tolerableLossFraction: 1.2 }))).toThrow(RangeError);
  });
});

describe('GR-7 · finding the farmer’s reachable storage', () => {
  it('picks the cheapest facility that fits, and none when nothing fits', () => {
    const cheaper = { ...WAREHOUSE, id: 'wh-2', ratePerQtlMonth: 20 };
    expect(findReachableStorage([WAREHOUSE, cheaper], FARMER_VILLAGE, 'onion', 5, 1840)?.facility.id).toBe('wh-2');
    expect(findReachableStorage([WAREHOUSE], FARMER_VILLAGE, 'onion', 500, 1840)).toBeNull();
    expect(findReachableStorage([], FARMER_VILLAGE, 'onion', 5, 1840)).toBeNull();
  });
});
