/**
 * FR-10 · P1-02 · P1-03 · P1-04 — the deterministic parser (PROMPT §6.1–§6.4), Devanagari first.
 */
import { describe, expect, it } from 'vitest';

import { DICTIONARY, REGISTRY } from '../testing/fixtures.js';
import { foldKey, normaliseText, tokenize } from './lexicon.js';
import { buildLexicon, describeParse, parseListingIntent, parseQuantity, type ParseContext } from './parse.js';

const NASHIK_FARMER: ParseContext = { farmerDistrict: 'nashik', dictionary: DICTIONARY, districts: REGISTRY };
const LATUR_FARMER: ParseContext = { farmerDistrict: 'latur', dictionary: DICTIONARY, districts: REGISTRY };
const lexicon = buildLexicon(DICTIONARY, REGISTRY);
const parse = (text: string, locale: 'mr' | 'hi' | 'en' = 'mr', context: ParseContext = NASHIK_FARMER) => parseListingIntent(text, locale, context, lexicon);

describe('FR-10 · the five required inputs (PROMPT §6.1)', () => {
  it('"मला ५ क्विंटल कांदा विकायचा आहे" — Marathi, Devanagari numerals, registry district', () => {
    const r = parse('मला ५ क्विंटल कांदा विकायचा आहे');
    expect(r).toMatchObject({ crop: 'onion', quantity: { value: 5, unit: 'quintal' }, intent: 'sell', district: 'nashik', districtSource: 'registry' });
    expect(r.unresolved).toEqual([]);
    expect(r.price).toBeUndefined();
  });

  it('"Mere paas 400 kilo soyabean hai, Latur" — Hinglish, place named in the message', () => {
    const r = parse('Mere paas 400 kilo soyabean hai, Latur', 'hi');
    expect(r).toMatchObject({ crop: 'soybean', quantity: { value: 400, unit: 'kg' }, intent: 'sell', district: 'latur', districtSource: 'message' });
    expect(r.unresolved).toEqual([]);
  });

  it('"kanda 20 quintal 1840" — a price with no stated basis is left without one', () => {
    const r = parse('kanda 20 quintal 1840');
    expect(r).toMatchObject({ crop: 'onion', quantity: { value: 20, unit: 'quintal' }, intent: 'sell' });
    expect(r.price).toEqual({ amount: 1840, unit: null, candidates: ['quintal', 'kg', 'lot'] });
    expect(r.unresolved).toEqual(['price-unit']);
  });

  it('"२० क्विंटल कांदा"', () => {
    expect(parse('२० क्विंटल कांदा')).toMatchObject({ crop: 'onion', quantity: { value: 20, unit: 'quintal' } });
  });

  it('"tamatar 3 crate" — a count unit is carried as stated', () => {
    const r = parse('tamatar 3 crate', 'hi');
    expect(r).toMatchObject({ crop: 'tomato', quantity: { value: 3, unit: 'crate' } });
    expect(r.unresolved).toEqual([]);
  });

  it('describes the parse for confirmation in the PROMPT §6.1 form', () => {
    expect(describeParse(parse('मला ५ क्विंटल कांदा विकायचा आहे'), REGISTRY)).toBe(
      'crop: onion · quantity: 5 · unit: quintal · intent: sell · location: Nashik',
    );
  });
});

describe('P1-02 · the stated unit is never discarded', () => {
  it('"5 quintal" stays 5 quintal — not 500 kg as Phase 1 stored it', () => {
    expect(parse('kanda 5 quintal').quantity).toEqual({ value: 5, unit: 'quintal' });
  });

  it('"400 kilo" stays 400 kg; "2 tonne" stays 2 tonne', () => {
    expect(parse('400 kilo kanda').quantity).toEqual({ value: 400, unit: 'kg' });
    expect(parse('2 ton soybean', 'en').quantity).toEqual({ value: 2, unit: 'tonne' });
  });

  it('parseQuantity returns the farmer’s own unit', () => {
    expect(parseQuantity('१२ पोती सोयाबीन', 'mr', NASHIK_FARMER)).toEqual({ value: 12, unit: 'bag' });
  });

  it('flags a count unit the crop gives no weight for, instead of guessing one', () => {
    const r = parse('kanda 10 crate');
    expect(r.quantity).toEqual({ value: 10, unit: 'crate' });
    expect(r.unresolved).toContain('quantity-weight');
  });
});

describe('P1-03 · an unmarked price is never silently assigned a unit', () => {
  it('"Mala 2500 rupaye pahijet" — currency, but no basis → ask', () => {
    const r = parse('Mala 2500 rupaye pahijet');
    expect(r.price).toEqual({ amount: 2500, unit: null, candidates: ['quintal', 'kg', 'lot'] });
    expect(r.unresolved).toContain('price-unit');
  });

  it('offers "per crate" as a choice when the farmer counted in crates', () => {
    expect(parse('tamatar 3 crate 400 rupaye').price).toEqual({ amount: 400, unit: null, candidates: ['quintal', 'kg', 'lot', 'crate'] });
  });

  it('reads an explicitly stated basis in every common form', () => {
    expect(parse('kanda 5 quintal ₹1840/qtl').price).toEqual({ amount: 1840, unit: 'quintal' });
    expect(parse('कांदा २० रुपये किलो').price).toEqual({ amount: 20, unit: 'kg' });
    expect(parse('कांदा क्विंटलला १८४० रुपये').price).toEqual({ amount: 1840, unit: 'quintal' });
    expect(parse('kanda 1840 per quintal').price).toEqual({ amount: 1840, unit: 'quintal' });
    expect(parse('प्याज प्रति क्विंटल ₹1840', 'hi').price).toEqual({ amount: 1840, unit: 'quintal' });
    expect(parse('kanda 5 quintal 1840 rupaye quintal').price).toEqual({ amount: 1840, unit: 'quintal' });
  });

  it('reads a whole-lot price and Indian multipliers', () => {
    expect(parse('kanda 50 quintal sagla 1 lakh rupaye').price).toEqual({ amount: 100_000, unit: 'lot' });
    expect(parse('कांदा ५ क्विंटल दोन हजार रुपये').price).toEqual({ amount: 2000, unit: null, candidates: ['quintal', 'kg', 'lot'] });
  });

  it('does not treat the quantity’s unit as the price’s basis', () => {
    expect(parse('5 quintal ₹1840 kanda').price).toEqual({ amount: 1840, unit: null, candidates: ['quintal', 'kg', 'lot'] });
  });

  it('does not invent a price or a quantity from numbers it cannot place', () => {
    const r = parse('kanda 20 1840');
    expect(r.quantity).toBeUndefined();
    expect(r.price).toBeUndefined();
    expect(r.unresolved).toEqual(['quantity']);
    expect(r.notes.join(' ')).toMatch(/could not be placed/);
  });
});

describe('P1-04 · location comes from the verified record, never a constant', () => {
  it('uses the farmer’s own registry district when the message names no place', () => {
    const r = parse('मला ५ क्विंटल सोयाबीन विकायचे आहे', 'mr', LATUR_FARMER);
    expect(r).toMatchObject({ district: 'latur', districtSource: 'registry' });
  });

  it('a Latur farmer is never silently placed in Nashik', () => {
    expect(parse('20 quintal tur', 'mr', LATUR_FARMER).district).toBe('latur');
  });

  it('a market named in the message sets its district for that message', () => {
    expect(parse('कांदा लासलगावला १० क्विंटल')).toMatchObject({ district: 'nashik', market: 'lasalgaon', districtSource: 'message' });
    expect(parse('soybean 30 quintal latur', 'en', NASHIK_FARMER)).toMatchObject({ district: 'latur', districtSource: 'message' });
  });

  it('knows renamed districts by their former names', () => {
    expect(parse('kapus 10 quintal aurangabad').district).toBe('chhatrapati-sambhajinagar');
    expect(parse('कांदा ५ क्विंटल अहमदनगर').district).toBe('ahilyanagar');
  });

  it('refuses to run without a verified district rather than defaulting one', () => {
    expect(() => parseListingIntent('kanda 5 quintal', 'mr', { ...NASHIK_FARMER, farmerDistrict: '' })).toThrow(/verified district is required/);
  });
});

describe('FR-10 · the cascade across scripts and spellings', () => {
  it('matches Marathi inflections by stripping case endings', () => {
    expect(parse('कांद्याला भाव किती?')).toMatchObject({ crop: 'onion', intent: 'enquire' });
  });

  it('folds nukta and chandrabindu spellings together', () => {
    expect(parse('प्याज़ 10 क्विंटल', 'hi').crop).toBe('onion');
    expect(parse('गेहूँ 10 क्विंटल', 'hi').crop).toBe('wheat');
  });

  it('reads Bengali and Gurmukhi synonyms and numerals', () => {
    expect(parse('পেঁয়াজ ১০ kg', 'en')).toMatchObject({ crop: 'onion', quantity: { value: 10, unit: 'kg' } });
    expect(parse('ਪਿਆਜ਼ ੫ quintal', 'en')).toMatchObject({ crop: 'onion', quantity: { value: 5, unit: 'quintal' } });
  });

  it('matches two-word crop names', () => {
    expect(parse('tur dal 10 quintal', 'en').crop).toBe('tur');
    expect(parse('red gram 10 quintal', 'en').crop).toBe('tur');
  });

  it('never guesses a crop it does not know', () => {
    const r = parse('10 quintal kiwi');
    expect(r.crop).toBeUndefined();
    expect(r.unresolved).toContain('crop');
  });

  it('keeps the first of two quantities and says so', () => {
    const r = parse('kanda 5 quintal ani 200 kilo');
    expect(r.quantity).toEqual({ value: 5, unit: 'quintal' });
    expect(r.notes.join(' ')).toMatch(/second quantity/);
  });

  it('reads a full sentence: crop, quantity, price basis, place and intent', () => {
    const r = parse('Latur la 50 quintal soybean vikaycha, rate 4800 rs quintal');
    expect(r).toMatchObject({ crop: 'soybean', quantity: { value: 50, unit: 'quintal' }, price: { amount: 4800, unit: 'quintal' }, district: 'latur', intent: 'sell' });
  });

  it('is deterministic: the same words always give the same answer', () => {
    const text = 'मला ५ क्विंटल कांदा विकायचा आहे';
    expect(parse(text)).toEqual(parse(text));
  });
});

describe('Constitution §13 · the chosen language drives the parser', () => {
  it('reads Marathi number words in Marathi', () => {
    expect(parse('दोन क्विंटल कांदा', 'mr').quantity).toEqual({ value: 2, unit: 'quintal' });
    expect(parse('pach quintal kanda', 'mr').quantity).toEqual({ value: 5, unit: 'quintal' });
  });

  it('reads Hindi number words in Hindi, and not Marathi ones', () => {
    expect(parse('पांच क्विंटल प्याज', 'hi').quantity).toEqual({ value: 5, unit: 'quintal' });
    expect(parse('दोन क्विंटल कांदा', 'hi').quantity).toBeUndefined();
  });

  it('never reads a number word that no unit or currency follows', () => {
    expect(parse('do kanda', 'hi').quantity).toBeUndefined();
  });
});

describe('FR-10 · tokenizer and normalisation', () => {
  it('keeps a Devanagari word whole, including its virama and anusvara', () => {
    expect(tokenize(normaliseText('५ क्विंटल'))).toEqual(['5', 'क्विंटल']);
  });

  it('converts native digits and keeps grouping and decimals', () => {
    expect(tokenize(normaliseText('₹१,८४०/qtl आणि 2.5 kg'))).toEqual(['₹', '1,840', '/', 'qtl', 'आणि', '2.5', 'kg']);
  });

  it('folds keys consistently', () => {
    expect(foldKey('प्याज़')).toBe(foldKey('प्याज'));
    expect(foldKey('  KANDA ')).toBe('kanda');
  });
});
