/**
 * Gate F · FR-09 · P1-01 — the shortlist the phone computes: the §16.2 order from the committed
 * Nashik release and a demand document shaped like the served one, B's higher offer explained by
 * payment risk, an honest empty result with alternatives when nothing beats the mandi, and (the
 * gate's grep) no percentage anywhere in the match components or their copy.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { computeBenchmark, locateFarmer, parseCropBundle, parseDemand, weatherUrgency, type CropDictionary, type DistrictRegistry } from '@fasal/shared';
import { describe, expect, it } from 'vitest';

import { raw, LOCALES, type StringKey } from '../i18n/strings';
import { DEFAULT_CONTEXT, type HomeBriefing } from '../offline/compute';
import { shortlistFor, type LotSpec } from './shortlist';

const ROOT = resolve(import.meta.dirname, '../../../..');
const RELEASES = join(ROOT, 'data', 'bundles');
const VERSION = readdirSync(RELEASES).filter((d) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(d)).sort().at(-1) ?? '';
const PUBLISHED = join(RELEASES, VERSION, 'published');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const onion = parseCropBundle(read(join(PUBLISHED, 'bundles', 'onion__nashik.json')));
const dictionary = read(join(PUBLISHED, 'shared', 'crops.json'))['dictionary'] as CropDictionary;
const registry = read(join(PUBLISHED, 'shared', 'districts.json'))['registry'] as DistrictRegistry;
const nashik = registry.districts.find((d) => d.id === 'nashik')!;
const market = (id: string) => nashik.markets.find((m) => m.id === id)!.location;
const scaled = (p: number) => Math.round((p * onion.benchmark.modal) / 1840 / 10) * 10;
const days = (n: number, d: number) => Array.from({ length: n }, () => d);

function requirement(id: string, buyerId: string, price: number, at: string, crop = 'onion') {
  return { id, buyerId, crop, gradeFloor: null, minQuantity: { value: 1, unit: 'quintal' }, maxQuantity: { value: 50, unit: 'quintal' }, price: { amount: price, unit: 'quintal' }, location: market(at), district: 'nashik', radiusKm: 60, validFrom: '2026-08-01', validUntil: '2026-12-31' };
}

function buyer(id: string, name: string, place: string, paymentDays: number[], extra: Record<string, unknown> = {}) {
  return { id, name, place, verified: true, demonstration: true, history: { completedDeals: paymentDays.length, paymentDays, defaults: 0, defaultExposureDays: 0, openDisputes: 0 }, ...extra };
}

const demand = parseDemand({
  kind: 'demand',
  district: 'nashik',
  asOf: onion.asOf,
  integrity: `sha256-${'0'.repeat(64)}`,
  requirements: [
    requirement('req-b', 'b', scaled(2000), 'pimpalgaon-baswant'),
    requirement('req-c', 'c', scaled(1900), 'niphad'),
    requirement('req-a', 'a', scaled(1950), 'lasalgaon'),
    requirement('req-u', 'u', scaled(2400), 'manmad'),
    requirement('req-cotton', 'y', 7100, 'yeola', 'cotton'),
  ],
  buyers: [
    buyer('a', 'Godavari Agro Traders', 'Lasalgaon', [...days(12, 4), ...days(6, 3), ...days(5, 5)]),
    { ...buyer('b', 'Deccan Exports', 'Pimpalgaon Baswant', [...days(9, 60), ...days(5, 55), ...days(4, 65)]), history: { completedDeals: 18, paymentDays: [...days(9, 60), ...days(5, 55), ...days(4, 65)], defaults: 1, defaultExposureDays: 90, openDisputes: 0 } },
    buyer('c', 'Niphad Traders', 'Niphad', days(31, 2)),
    buyer('u', 'Manmad Fresh Buyers', 'Manmad', [], { verified: false }),
    buyer('y', 'Yeola Cotton Ginning', 'Yeola', days(8, 7)),
  ],
});

function briefing(extra: Partial<HomeBriefing> = {}): HomeBriefing {
  const computedAt = Date.parse(`${onion.asOf}T04:00:00Z`);
  return {
    district: 'nashik',
    districtNames: nashik.names,
    locationNames: null,
    location: locateFarmer('Vinchur (Niphad)', nashik),
    crops: [{ crop: 'onion', bundle: onion, names: { en: 'Onion', mr: 'कांदा' }, benchmark: computeBenchmark(onion, onion.asOf), evaluation: null as never, storage: null, urgency: weatherUrgency(null, { moistureRelevant: true }, onion.asOf), release: onion.version }],
    computedAt,
    release: VERSION,
    dataSource: 'synthetic',
    dictionary,
    registry,
    demand,
    forecast: null,
    ...extra,
  };
}

const lot = (extra: Partial<LotSpec> = {}): LotSpec => ({ crop: 'onion', quantity: { value: 5, unit: 'quintal' }, grade: null, availableFrom: onion.asOf, availableUntil: onion.asOf, listingClientId: null, ...extra });

describe('Gate F · the §16.2 scenario, computed on the phone', () => {
  const shortlist = shortlistFor(briefing(), lot(), DEFAULT_CONTEXT);
  if (shortlist.kind !== 'ranked') throw new Error('expected a ranked shortlist');

  it('ranks A above C above B by what reaches the farmer', () => {
    expect(shortlist.result.matches.map((m) => m.buyerName)).toEqual(['Godavari Agro Traders', 'Niphad Traders', 'Deccan Exports']);
    const [a, , b] = shortlist.result.matches;
    expect(b!.offerPerQtl).toBeGreaterThan(a!.offerPerQtl);
    expect(b!.riskAdjustedNet).toBeLessThan(a!.riskAdjustedNet);
  });

  it('explains why B, offering the most, ranks last: higher payment-delay risk', () => {
    const b = shortlist.result.matches[2]!;
    expect(shortlist.below.get(b.requirementId)?.why.decisive).toBe('payment-risk');
    expect(shortlist.below.has(shortlist.result.matches[0]!.requirementId)).toBe(false);
  });

  it('keeps the unverified buyer and the cotton buyer out, and says why', () => {
    expect(shortlist.result.matches.map((m) => m.buyerId)).not.toContain('u');
    expect(shortlist.result.excluded.map((e) => e.reason).sort()).toEqual(['crop-mismatch', 'unverified-buyer']);
    expect(shortlist.demonstration).toBe(true);
  });

  it('is the freshly computed answer: it carries the moment it was computed', () => {
    expect(shortlist.computedAt).toBe(Date.parse(`${onion.asOf}T04:00:00Z`));
  });
});

describe('P1-01 · honest emptiness, and saying what is missing', () => {
  it('when nothing beats the nearest mandi, the list is empty and the alternatives are real', () => {
    const low = parseDemand({ kind: 'demand', district: 'nashik', asOf: onion.asOf, integrity: demand.integrity, requirements: [requirement('req-low', 'a', Math.round(onion.benchmark.modal * 0.8), 'lasalgaon')], buyers: demand.buyers });
    const shortlist = shortlistFor(briefing({ demand: low }), lot(), DEFAULT_CONTEXT);
    expect(shortlist.kind).toBe('ranked');
    if (shortlist.kind !== 'ranked') return;
    expect(shortlist.result.matches).toEqual([]);
    expect(shortlist.result.excluded.map((e) => e.reason)).toEqual(['below-walk-away']);
    expect(shortlist.nearestMandi?.market.id).toBeDefined();
    expect(shortlist.result.walkAwayPerQtl).toBeLessThan(onion.benchmark.modal);
  });

  it('no demand on the phone yet, or no district price for the crop: says which, ranks nothing', () => {
    expect(shortlistFor(briefing({ demand: null }), lot(), DEFAULT_CONTEXT)).toEqual({ kind: 'no-demand' });
    expect(shortlistFor(briefing(), lot({ crop: 'grapes' }), DEFAULT_CONTEXT)).toEqual({ kind: 'no-price', crop: 'grapes' });
  });
});

describe('Gate F · the grep: no percentage in the match components or their copy', () => {
  it('no "%" in any file under src/match that renders', () => {
    const dir = resolve(import.meta.dirname);
    const offences = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') || (f.endsWith('.ts') && !f.endsWith('.test.ts')))
      .filter((f) => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').includes('%'));
    expect(offences).toEqual([]);
  });

  it('no "%" in any string a buyer card, the shortlist or the best-buyer line can show', () => {
    const keys = ['buyers.', 'card.', 'why.', 'empty.', 'excluded.', 'home.bestBuyer', 'home.noBuyer', 'home.allBuyers', 'listings.buyers', 'confirm.vsBenchmark.'].flatMap(keysWith);
    expect(keys.length).toBeGreaterThan(40);
    const offending = keys.flatMap((k) => LOCALES.map((l) => raw(l, k))).filter((text) => text.includes('%'));
    expect(offending).toEqual([]);
  });
});

function keysWith(prefix: string): StringKey[] {
  const source = readFileSync(resolve(import.meta.dirname, '../i18n/strings.ts'), 'utf8');
  return [...source.matchAll(/^\s+"([^"]+)": \{ mr:/gm)].map((m) => m[1] as StringKey).filter((k) => k.startsWith(prefix));
}
