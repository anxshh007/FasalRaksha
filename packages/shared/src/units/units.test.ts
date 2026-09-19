/** P1-02 · P1-03 — units are carried, never discarded; prices are never silently given a basis. */
import { describe, expect, it } from 'vitest';

import {
  convertQuantity,
  isAmbiguous,
  kgPerUnit,
  lotValue,
  normalisePrice,
  pricePerKg,
  quantityToKg,
  resolvePriceUnit,
  type AmbiguousPrice,
  type Money,
} from './units.js';

describe('P1-02 · quantities keep the unit the farmer used', () => {
  it('converts only when asked, leaving the original untouched', () => {
    const stated = { value: 5, unit: 'quintal' as const };
    const inKg = convertQuantity(stated, 'kg');
    expect(inKg).toEqual({ ok: true, value: { value: 500, unit: 'kg' } });
    expect(stated).toEqual({ value: 5, unit: 'quintal' });
  });

  it('converts kg, quintal and tonne exactly', () => {
    expect(quantityToKg({ value: 2.5, unit: 'tonne' })).toEqual({ ok: true, value: 2500 });
    expect(convertQuantity({ value: 450, unit: 'kg' }, 'quintal')).toEqual({ ok: true, value: { value: 4.5, unit: 'quintal' } });
    expect(convertQuantity({ value: 7, unit: 'quintal' }, 'quintal')).toEqual({ ok: true, value: { value: 7, unit: 'quintal' } });
  });

  it('converts crates and bags only when the crop states their weight', () => {
    expect(quantityToKg({ value: 3, unit: 'crate' }, { crateKg: 20 })).toEqual({ ok: true, value: 60 });
    expect(quantityToKg({ value: 3, unit: 'crate' })).toEqual({ ok: false, reason: 'crate-weight-unknown' });
    expect(quantityToKg({ value: 4, unit: 'bag' }, { bagKg: 50 })).toEqual({ ok: true, value: 200 });
    expect(kgPerUnit('bag', {})).toEqual({ ok: false, reason: 'bag-weight-unknown' });
  });
});

describe('P1-03 · the price-unit boundary', () => {
  it('normalises once, centrally: ₹19.50/kg is ₹1,950/qtl', () => {
    expect(normalisePrice({ amount: 19.5, unit: 'kg' }, 'quintal')).toEqual({ ok: true, value: { amount: 1950, unit: 'quintal' } });
    expect(normalisePrice({ amount: 18400, unit: 'tonne' }, 'quintal')).toEqual({ ok: true, value: { amount: 1840, unit: 'quintal' } });
  });

  it('turns a whole-lot price into a per-quintal one only when the lot size is known', () => {
    expect(normalisePrice({ amount: 9750, unit: 'lot' }, 'quintal', { lotKg: 500 })).toEqual({ ok: true, value: { amount: 1950, unit: 'quintal' } });
    expect(normalisePrice({ amount: 9750, unit: 'lot' }, 'quintal')).toEqual({ ok: false, reason: 'lot-size-unknown' });
    expect(pricePerKg({ amount: 100, unit: 'lot' }, { lotKg: 0 })).toEqual({ ok: false, reason: 'not-positive' });
  });

  it('prices per crate using the crop’s crate weight', () => {
    expect(normalisePrice({ amount: 400, unit: 'crate' }, 'kg', { crateKg: 20 })).toEqual({ ok: true, value: { amount: 20, unit: 'kg' } });
    expect(normalisePrice({ amount: 400, unit: 'crate' }, 'kg')).toEqual({ ok: false, reason: 'crate-weight-unknown' });
  });

  it('an unmarked amount is ambiguous and must be resolved by the farmer before use', () => {
    const asked: AmbiguousPrice = { amount: 2500, unit: null, candidates: ['quintal', 'kg', 'lot'] };
    expect(isAmbiguous(asked)).toBe(true);
    const answered: Money = resolvePriceUnit(asked, 'kg');
    expect(answered).toEqual({ amount: 2500, unit: 'kg' });
    expect(isAmbiguous(answered)).toBe(false);
  });

  it('refuses an answer that was not one of the offered choices', () => {
    const asked: AmbiguousPrice = { amount: 2500, unit: null, candidates: ['quintal', 'kg', 'lot'] };
    expect(() => resolvePriceUnit(asked, 'crate')).toThrow(/not one of the offered choices/);
  });

  it('the three readings of ₹2,500 differ by two orders of magnitude — which is why nothing guesses', () => {
    const lotKg = 500;
    const perQuintal = normalisePrice({ amount: 2500, unit: 'quintal' }, 'quintal', { lotKg });
    const perKg = normalisePrice({ amount: 2500, unit: 'kg' }, 'quintal', { lotKg });
    const wholeLot = normalisePrice({ amount: 2500, unit: 'lot' }, 'quintal', { lotKg });
    expect([perQuintal, perKg, wholeLot].map((r) => (r.ok ? r.value.amount : NaN))).toEqual([2500, 250000, 500]);
  });

  it('values a lot in the farmer’s own unit', () => {
    expect(lotValue({ amount: 1950, unit: 'quintal' }, { value: 5, unit: 'quintal' })).toEqual({ ok: true, value: { amount: 9750, unit: 'lot' } });
    expect(lotValue({ amount: 19.5, unit: 'kg' }, { value: 500, unit: 'kg' })).toEqual({ ok: true, value: { amount: 9750, unit: 'lot' } });
    expect(lotValue({ amount: 400, unit: 'crate' }, { value: 3, unit: 'crate' }, { crateKg: 20 })).toEqual({ ok: true, value: { amount: 1200, unit: 'lot' } });
  });
});
