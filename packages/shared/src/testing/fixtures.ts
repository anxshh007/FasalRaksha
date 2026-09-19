/**
 * Test fixtures — the §16.2 demonstration scenario, as data. Test-only: excluded from the package
 * build and from the purity scan. Every figure below is an *input*; tests assert what the domain
 * code computes from them.
 */
import crops from '../../../../data/reference/crops.json' with { type: 'json' };
import districts from '../../../../data/reference/districts.json' with { type: 'json' };

import type { CropBundle, StorageFacility, TransportTariff } from '../bundle/types.js';
import type { GeoPoint } from '../core/types.js';
import type { CropDictionary, DistrictRegistry } from '../crops/types.js';
import type { BuyerProfile, BuyerRequirement, Lot, MatchContext } from '../matching/types.js';

export const DICTIONARY = crops as unknown as CropDictionary;
export const REGISTRY = districts as unknown as DistrictRegistry;

export const LASALGAON: GeoPoint = { lat: 20.1497, lon: 74.233 };
export const PIMPALGAON: GeoPoint = { lat: 20.1667, lon: 73.987 };
export const NIPHAD: GeoPoint = { lat: 20.08, lon: 74.11 };
/** The demo farmer's village, between Niphad and Lasalgaon. */
export const FARMER_VILLAGE: GeoPoint = { lat: 20.1, lon: 74.15 };

export const TARIFFS: TransportTariff[] = [
  { id: 'nsk-ace', vehicleClass: 'Mini-truck (≈0.75 t)', capacityKg: 750, ratePerKm: 18, minimumCharge: 350, district: 'nashik' },
  { id: 'nsk-pickup', vehicleClass: 'Pickup (≈1.5 t)', capacityKg: 1500, ratePerKm: 22, minimumCharge: 600, district: 'nashik' },
  { id: 'nsk-407', vehicleClass: 'LCV (≈3.5 t)', capacityKg: 3500, ratePerKm: 30, minimumCharge: 1200, district: 'nashik' },
  { id: 'nsk-9t', vehicleClass: 'Truck (≈9 t)', capacityKg: 9000, ratePerKm: 45, minimumCharge: 3000, district: 'nashik' },
];

export const WAREHOUSE: StorageFacility = {
  id: 'wh-lasalgaon-1',
  name: 'Lasalgaon Onion Storage (WDRA)',
  district: 'nashik',
  location: { lat: 20.155, lon: 74.24 },
  capacityAvailableQtl: 400,
  crops: ['onion'],
  ratePerQtlMonth: 30,
  spoilageFractionPerMonth: { onion: 0.02 },
  wdraAccredited: true,
  eNwr: true,
  pledgeRateAnnual: 0.09,
};

/** A Nashik onion bundle whose 7-day outlook clears all seven gates and RK-7 for a 5 qtl lot. */
export function onionBundle(overrides: Partial<CropBundle> = {}): CropBundle {
  return {
    schemaVersion: 3,
    version: '2026-09-04.1',
    generatedAt: '2026-09-04T02:14:00Z',
    asOf: '2026-09-04',
    district: 'nashik',
    crop: 'onion',
    market: 'lasalgaon',
    benchmark: { modal: 1840, min: 1500, max: 2100, unit: 'quintal' },
    msp: null,
    trend: [
      { date: '2026-08-29', modal: 1760 },
      { date: '2026-08-30', modal: null },
      { date: '2026-08-31', modal: 1785 },
      { date: '2026-09-01', modal: 1800 },
      { date: '2026-09-02', modal: 1810 },
      { date: '2026-09-03', modal: 1825 },
      { date: '2026-09-04', modal: 1840 },
    ],
    seasonal: { woyMedian: 1755, woyIQR: [1600, 1980], position: 'within' },
    arrivalsRatio: 0.82,
    forecast: {
      h7: { q10: 1850, q50: 1990, q90: 2150, direction: 'up', agreement: 0.75, skill: 0.12, skillSeasonal: 0.05, coverage: 0.91, bandKappa: 0.02, confidenceMin: 0.3 },
      h14: { q10: 1800, q50: 2020, q90: 2260, direction: 'up', agreement: 0.7, skill: 0.08, skillSeasonal: 0.03, coverage: 0.9, bandKappa: 0.02, confidenceMin: 0.3 },
    },
    raksha: {
      layers: {
        'RK-1': { bucket: 'up', weight: 0.9, value: 0.021 },
        'RK-2': { bucket: 'up', weight: 0.3, value: 0.048 },
        'RK-3': { bucket: 'up', weight: 0.4, value: -0.198 },
        'RK-4': { bucket: 'flat', weight: 0, value: 0.1 },
        'RK-5': { bucket: 'flat', weight: 0.2, value: 0.4 },
        'RK-6': { bucket: 'up', weight: 0.12, value: 0.078 },
      },
    },
    storage: [WAREHOUSE],
    transport: TARIFFS,
    stalenessLimitDays: 7,
    status: 'published',
    integrity: 'sha256-test',
    ...overrides,
  };
}

const days = (n: number, value: number): number[] => Array.from({ length: n }, () => value);

export const BUYER_A: BuyerProfile = {
  id: 'buyer-a',
  name: 'Godavari Agro Traders',
  place: 'Lasalgaon',
  verified: true,
  history: { completedDeals: 23, paymentDays: [...days(12, 4), ...days(6, 3), ...days(5, 5)], defaults: 0, defaultExposureDays: 0, openDisputes: 0 },
};
export const BUYER_B: BuyerProfile = {
  id: 'buyer-b',
  name: 'Deccan Exports',
  place: 'Pimpalgaon Baswant',
  verified: true,
  history: { completedDeals: 18, paymentDays: [...days(9, 60), ...days(5, 55), ...days(4, 65)], defaults: 1, defaultExposureDays: 90, openDisputes: 0 },
};
export const BUYER_C: BuyerProfile = {
  id: 'buyer-c',
  name: 'Niphad Traders',
  place: 'Niphad',
  verified: true,
  history: { completedDeals: 31, paymentDays: days(31, 2), defaults: 0, defaultExposureDays: 0, openDisputes: 0 },
};

export function requirement(id: string, buyerId: string, pricePerQtl: number, location: GeoPoint, extra: Partial<BuyerRequirement> = {}): BuyerRequirement {
  return {
    id,
    buyerId,
    crop: 'onion',
    gradeFloor: null,
    minQuantity: { value: 1, unit: 'quintal' },
    maxQuantity: { value: 50, unit: 'quintal' },
    price: { amount: pricePerQtl, unit: 'quintal' },
    location,
    district: 'nashik',
    radiusKm: 60,
    validFrom: '2026-09-01',
    validUntil: '2026-09-30',
    ...extra,
  };
}

export const REQ_A = requirement('req-a', 'buyer-a', 1950, LASALGAON);
export const REQ_B = requirement('req-b', 'buyer-b', 2000, PIMPALGAON);
export const REQ_C = requirement('req-c', 'buyer-c', 1900, NIPHAD);

export function demoLot(extra: Partial<Lot> = {}): Lot {
  return {
    listingId: 'lot-1',
    crop: 'onion',
    quantity: { value: 5, unit: 'quintal' },
    grade: 'B',
    location: FARMER_VILLAGE,
    district: 'nashik',
    availableFrom: '2026-09-05',
    availableUntil: '2026-09-15',
    ...extra,
  };
}

export function matchContext(extra: Partial<MatchContext> = {}): MatchContext {
  return {
    buyers: [BUYER_A, BUYER_B, BUYER_C],
    benchmark: { modalPerQtl: 1840, district: 'nashik', market: 'lasalgaon', asOf: '2026-09-04' },
    tariffs: TARIFFS,
    financeRateAnnual: 0.12,
    nearestMandi: { name: 'Lasalgaon', roadKm: 13.4 },
    weights: { bagKg: 50 },
    substitutions: DICTIONARY.varietySubstitutions,
    today: '2026-09-06',
    ...extra,
  };
}
