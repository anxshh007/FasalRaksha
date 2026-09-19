/** FR-09 · aggregation pools clear a real MOQ from real listings; proceeds split to the paisa. */
import { describe, expect, it } from 'vitest';

import { requirement, LASALGAON } from '../testing/fixtures.js';
import { formPools, splitProceeds, type Coordinator, type PoolListing } from './pools.js';

const FPO: Coordinator = { kind: 'fpo', id: 'fpo-sahyadri', name: 'Sahyadri Farmer Producer Company', location: { lat: 20.12, lon: 74.18 } };

function listing(id: string, qtl: number, lat: number, lon: number, extra: Partial<PoolListing> = {}): PoolListing {
  return {
    listingId: id,
    farmerId: `farmer-${id}`,
    crop: 'onion',
    grade: 'B',
    quantity: { value: qtl, unit: 'quintal' },
    location: { lat, lon },
    availableFrom: '2026-09-05',
    availableUntil: '2026-09-20',
    optedIn: true,
    ...extra,
  };
}

const EXPORTER = requirement('req-export', 'buyer-x', 2150, LASALGAON, {
  minQuantity: { value: 18, unit: 'quintal' },
  maxQuantity: { value: 25, unit: 'quintal' },
  gradeFloor: 'B',
});

const VILLAGE = [
  listing('l1', 5, 20.11, 74.17),
  listing('l2', 4, 20.13, 74.19, { grade: 'A' }),
  listing('l3', 3.5, 20.1, 74.2),
  listing('l4', 6, 20.14, 74.16),
  listing('l5', 2, 20.09, 74.18),
];

describe('FR-09 · a pool clears the buyer’s minimum order from real listings', () => {
  const result = formPools(VILLAGE, EXPORTER, { radiusKm: 15, coordinator: FPO, weights: {} });

  it('forms one consignment that clears 18 qtl, nearest listings first', () => {
    expect(result.pools).toHaveLength(1);
    const pool = result.pools[0];
    expect(pool?.totalKg).toBeGreaterThanOrEqual(1800);
    expect(pool?.totalKg).toBeLessThanOrEqual(2500);
    expect(pool?.coordinator?.name).toBe('Sahyadri Farmer Producer Company');
    expect(pool?.spanKm).toBeLessThanOrEqual(15);
  });

  it('presents a grade range and a shared availability window', () => {
    const pool = result.pools[0];
    expect(pool?.gradeRange).toEqual({ lowest: 'B', highest: 'A' });
    expect(pool?.window).toEqual({ from: '2026-09-05', until: '2026-09-20' });
    expect(pool?.includesUngraded).toBe(false);
  });

  it('records each member’s share of the volume', () => {
    const pool = result.pools[0];
    const shares = pool?.members.reduce((sum, m) => sum + m.share, 0) ?? 0;
    expect(shares).toBeCloseTo(1, 12);
  });
});

describe('FR-09 · pooling respects every constraint', () => {
  it('is opt-in: a listing that has not opted in is never pooled', () => {
    const result = formPools([...VILLAGE, listing('l6', 10, 20.12, 74.18, { optedIn: false })], EXPORTER, { radiusKm: 15, coordinator: FPO, weights: {} });
    expect(result.ineligible).toContainEqual({ listingId: 'l6', reason: 'not-opted-in' });
    expect(result.pools[0]?.members.some((m) => m.listingId === 'l6')).toBe(false);
  });

  it('excludes other crops, lower grades and ungraded lots when the buyer sets a floor', () => {
    const result = formPools(
      [listing('x1', 10, 20.12, 74.18, { crop: 'potato' }), listing('x2', 10, 20.12, 74.18, { grade: 'C' }), listing('x3', 10, 20.12, 74.18, { grade: null })],
      EXPORTER,
      { radiusKm: 15, coordinator: FPO, weights: {} },
    );
    expect(result.ineligible.map((i) => i.reason)).toEqual(['crop-mismatch', 'grade-below-floor', 'ungraded']);
    expect(result.pools).toEqual([]);
  });

  it('never pools lots with no common day of availability', () => {
    const early = listing('e1', 10, 20.12, 74.18, { availableFrom: '2026-09-01', availableUntil: '2026-09-06' });
    const late = listing('e2', 10, 20.12, 74.18, { availableFrom: '2026-09-10', availableUntil: '2026-09-20' });
    const result = formPools([early, late], EXPORTER, { radiusKm: 15, coordinator: FPO, weights: {} });
    expect(result.pools).toEqual([]);
    expect(result.shortfall).toEqual({ availableKg: 1000, neededKg: 800 });
  });

  it('leaves out lots beyond the radius and reports how far short the pool falls', () => {
    const result = formPools([listing('n1', 8, 20.12, 74.18), listing('far', 20, 19.0, 73.0)], EXPORTER, { radiusKm: 15, coordinator: FPO, weights: {} });
    expect(result.pools).toEqual([]);
    expect(result.shortfall).toEqual({ availableKg: 800, neededKg: 1000 });
  });

  it('stops once the minimum clears, but lets the last lot fill up to the buyer’s maximum — never beyond', () => {
    const big = [listing('b1', 20, 20.12, 74.18), listing('b2', 20, 20.121, 74.181)];
    const pool = formPools(big, { ...EXPORTER, minQuantity: { value: 22, unit: 'quintal' } }, { radiusKm: 15, coordinator: FPO, weights: {} }).pools[0];
    expect(pool?.totalKg).toBe(2500);
    expect(pool?.members.map((m) => m.contributedKg)).toEqual([2000, 500]);
  });

  it('is deterministic', () => {
    const opts = { radiusKm: 15, coordinator: FPO, weights: {} };
    expect(formPools(VILLAGE, EXPORTER, opts)).toEqual(formPools([...VILLAGE].reverse(), EXPORTER, opts));
  });
});

describe('FR-09 · proceeds split proportionally, recorded to the paisa', () => {
  it('splits by contributed volume and the parts sum exactly to the total', () => {
    const pool = formPools(VILLAGE, EXPORTER, { radiusKm: 15, coordinator: FPO, weights: {} }).pools[0];
    if (!pool) throw new Error('pool expected');
    const total = 38_987.65;
    const parts = splitProceeds(pool, total);
    const sumPaise = parts.reduce((sum, p) => sum + Math.round(p.rupees * 100), 0);
    expect(sumPaise).toBe(Math.round(total * 100));
    for (const part of parts) {
      const member = pool.members.find((m) => m.listingId === part.listingId);
      expect(Math.abs(part.rupees - total * (member?.share ?? 0))).toBeLessThan(0.02);
    }
  });

  it('hands indivisible paise to the largest remainders, deterministically', () => {
    const pool = {
      requirementId: 'r',
      coordinator: null,
      members: [
        { listingId: 'a', farmerId: 'fa', contributedKg: 100, share: 1 / 3 },
        { listingId: 'b', farmerId: 'fb', contributedKg: 100, share: 1 / 3 },
        { listingId: 'c', farmerId: 'fc', contributedKg: 100, share: 1 / 3 },
      ],
      totalKg: 300,
      gradeRange: null,
      includesUngraded: false,
      window: { from: '2026-09-05', until: '2026-09-06' },
      spanKm: 1,
    };
    expect(splitProceeds(pool, 100).map((p) => p.rupees)).toEqual([33.34, 33.33, 33.33]);
  });
});
