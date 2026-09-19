/**
 * FR-09 · P1-03 — the demand document is parsed strictly before anything is ranked from it: a
 * valid one becomes requirements and buyer profiles; any malformed field refuses the whole
 * document, so the phone keeps the demand it already had.
 */
import { describe, expect, it } from 'vitest';

import { DemandShapeError, parseDemand } from './demand.js';

function valid() {
  return {
    kind: 'demand',
    district: 'nashik',
    asOf: '2026-09-18',
    integrity: `sha256-${'a'.repeat(64)}`,
    requirements: [
      {
        id: 'r1',
        buyerId: 'b1',
        crop: 'onion',
        gradeFloor: null,
        minQuantity: { value: 1, unit: 'quintal' },
        maxQuantity: { value: 50, unit: 'quintal' },
        price: { amount: 3720, unit: 'quintal' },
        location: { lat: 20.15, lon: 74.233 },
        district: 'nashik',
        radiusKm: 60,
        validFrom: '2026-08-19',
        validUntil: '2026-12-17',
      },
    ],
    buyers: [
      {
        id: 'b1',
        name: 'Godavari Agro Traders',
        place: 'Lasalgaon',
        verified: true,
        demonstration: true,
        history: { completedDeals: 2, paymentDays: [4, 3], defaults: 0, defaultExposureDays: 0, openDisputes: 0 },
      },
    ],
  };
}

type Mutable = ReturnType<typeof valid> & Record<string, unknown>;

function refused(change: (d: Mutable) => void, path: RegExp) {
  const d = valid() as Mutable;
  change(d);
  expect(() => parseDemand(d)).toThrow(DemandShapeError);
  try {
    parseDemand(d);
  } catch (error) {
    expect((error as DemandShapeError).path).toMatch(path);
  }
}

describe('FR-09 · the demand document', () => {
  it('parses into requirements and buyer profiles, keeping the demonstration flag', () => {
    const demand = parseDemand(valid());
    expect(demand.requirements[0]).toMatchObject({ crop: 'onion', price: { amount: 3720, unit: 'quintal' }, gradeFloor: null });
    expect(demand.buyers[0]).toMatchObject({ name: 'Godavari Agro Traders', demonstration: true, history: { completedDeals: 2 } });
  });

  it('refuses a price without a buying unit, including a price "for the lot" (P1-03)', () => {
    refused((d) => ((d.requirements[0] as Record<string, unknown>)['price'] = { amount: 3720, unit: 'lot' }), /price\.unit$/);
    refused((d) => ((d.requirements[0] as Record<string, unknown>)['price'] = { amount: 3720 }), /price\.unit$/);
  });

  it('refuses a quantity without its unit, a bad grade, and reversed dates', () => {
    refused((d) => ((d.requirements[0] as Record<string, unknown>)['maxQuantity'] = { value: 50 }), /maxQuantity\.unit$/);
    refused((d) => ((d.requirements[0] as Record<string, unknown>)['gradeFloor'] = 'AAA'), /gradeFloor$/);
    refused((d) => ((d.requirements[0] as Record<string, unknown>)['validUntil'] = '2026-01-01'), /requirements\[0\]$/);
  });

  it('refuses a requirement naming no buyer in the document', () => {
    refused((d) => ((d.requirements[0] as Record<string, unknown>)['buyerId'] = 'b9'), /buyerId$/);
  });

  it('refuses a track record whose payment days do not match its completed deals', () => {
    refused((d) => (d.buyers[0]!.history.paymentDays = [4]), /history$/);
    refused((d) => (d.buyers[0]!.history.defaults = -1), /defaults$/);
  });

  it('refuses anything that is not a demand document', () => {
    refused((d) => (d.kind = 'bundle'), /kind$/);
    expect(() => parseDemand(null)).toThrow(DemandShapeError);
    expect(() => parseDemand([])).toThrow(DemandShapeError);
  });
});
