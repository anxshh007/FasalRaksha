/**
 * Gate I · P1-02 · P1-03 · P1-04 — an ambiguous price unit cannot silently pass, the stated
 * quantity unit is kept, and the district is the verified one. The parser is the real shared
 * parser over the real crop dictionary and district registry.
 */
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { buildLexicon, computeBenchmark, parseCropBundle, parseListingIntent, type CropDictionary, type DistrictRegistry } from '@fasal/shared';
import { describe, expect, it } from 'vitest';

import { implausible, resolve, toListingDraft } from './draft';

const ROOT = resolvePath(import.meta.dirname, '../../../..');
const dictionary = JSON.parse(readFileSync(join(ROOT, 'data/reference/crops.json'), 'utf8')) as CropDictionary;
const registry = JSON.parse(readFileSync(join(ROOT, 'data/reference/districts.json'), 'utf8')) as DistrictRegistry;
const lexicon = buildLexicon(dictionary, registry);
const context = { farmerDistrict: 'nashik', dictionary, districts: registry };
const parse = (text: string, locale: 'mr' | 'hi' | 'en' = 'mr') => parseListingIntent(text, locale, context, lexicon);
const details = { clientId: 'client-0001', availableFrom: '2026-09-19', availableUntil: '2026-09-26', poolOptIn: false, note: '' };

const onion = parseCropBundle(JSON.parse(readFileSync(join(ROOT, 'data/bundles/2026-09-18.1/published/bundles/onion__nashik.json'), 'utf8')));
const benchmark = computeBenchmark(onion, '2026-09-19');
const onionProfile = dictionary.crops.find((c) => c.id === 'onion') ?? null;

describe('Gate I · the ₹2500 test: an unmarked price never passes silently', () => {
  it('"kanda 20 quintal 2500" asks what the ₹2,500 is for, and is not ready until answered', () => {
    const resolved = resolve(parse('kanda 20 quintal 2500'), {}, 'nashik');
    expect(resolved.price).toMatchObject({ amount: 2500, unit: null });
    expect(resolved.questions).toEqual(['price-unit']);
    expect(resolved.ready).toBe(false);
    expect(() => toListingDraft(resolved, details)).toThrow(/questions/);
  });

  it('once the farmer taps "per quintal", the price carries that basis into the listing', () => {
    const resolved = resolve(parse('kanda 20 quintal 2500'), { priceUnit: 'quintal' }, 'nashik');
    expect(resolved.ready).toBe(true);
    expect(toListingDraft(resolved, details).askingPrice).toEqual({ amount: 2500, unit: 'quintal' });
  });

  it('"Mala 2500 rupaye pahijet" alone is ambiguous in Marathi, Hindi and English phrasing alike', () => {
    for (const [text, locale] of [['कांदा 5 क्विंटल, मला 2500 रुपये पाहिजेत', 'mr'], ['प्याज़ 5 क्विंटल, 2500 रुपये चाहिए', 'hi'], ['onion 5 quintal, want 2500 rupees', 'en']] as const) {
      expect(resolve(parse(text, locale), {}, 'nashik').questions, text).toContain('price-unit');
    }
  });

  it('a price stated with its basis needs no question', () => {
    const resolved = resolve(parse('kanda 20 quintal 2500 rupaye prati quintal'), {}, 'nashik');
    expect(resolved.price).toEqual({ amount: 2500, unit: 'quintal' });
    expect(resolved.ready).toBe(true);
  });

  it('a per-kilo answer that is 70× today\'s rate is flagged before it is listed', () => {
    const perKilo = resolve(parse('kanda 20 quintal 2500'), { priceUnit: 'kg' }, 'nashik');
    const flag = implausible(perKilo.price, benchmark, onionProfile);
    expect(flag?.perQuintal).toBe(250_000);
    expect(flag?.times).toBeGreaterThan(50);
    expect(implausible(resolve(parse('kanda 20 quintal 2500'), { priceUnit: 'quintal' }, 'nashik').price, benchmark, onionProfile)).toBeNull();
  });

  it('no price at all is a listing without a price, not a question', () => {
    const resolved = resolve(parse('मला ५ क्विंटल कांदा विकायचा आहे'), {}, 'nashik');
    expect(resolved.ready).toBe(true);
    expect(toListingDraft(resolved, details).askingPrice).toBeNull();
  });
});

describe('P1-02 · P1-04 · the farmer\'s own unit and district', () => {
  it('"मला ५ क्विंटल कांदा विकायचा आहे" is 5 quintal of onion, never 500 kg, in the verified district', () => {
    const resolved = resolve(parse('मला ५ क्विंटल कांदा विकायचा आहे'), {}, 'nashik');
    expect(resolved).toMatchObject({ crop: 'onion', quantity: { value: 5, unit: 'quintal' }, district: 'nashik', districtSource: 'registry' });
  });

  it('"Mere paas 400 kilo soyabean hai, Latur" keeps kilos and uses the place named', () => {
    const resolved = resolve(parse('Mere paas 400 kilo soyabean hai, Latur', 'hi'), {}, 'nashik');
    expect(resolved).toMatchObject({ crop: 'soybean', quantity: { value: 400, unit: 'kg' }, district: 'latur', districtSource: 'message' });
  });

  it('missing crop and quantity become questions, and the farmer\'s answers resolve them', () => {
    const empty = resolve(parse(''), {}, 'nashik');
    expect(empty.questions).toEqual(['crop', 'quantity']);
    const answered = resolve(parse(''), { crop: 'tomato', quantity: { value: 30, unit: 'crate' } }, 'nashik');
    expect(answered.ready).toBe(true);
    expect(toListingDraft(answered, details).quantity).toEqual({ value: 30, unit: 'crate' });
  });
});
