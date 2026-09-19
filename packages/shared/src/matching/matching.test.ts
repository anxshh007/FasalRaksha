/**
 * FR-09 · P1-01 · P1-05 · P1-06 · Gate F — explained, net-realisation ranking with no percentage.
 */
import { describe, expect, it } from 'vitest';

import {
  BUYER_A,
  BUYER_B,
  BUYER_C,
  demoLot,
  LASALGAON,
  matchContext,
  REQ_A,
  REQ_B,
  REQ_C,
  requirement,
  TARIFFS,
} from '../testing/fixtures.js';
import { estimateFreight } from './freight.js';
import { explainOrder, rankBuyers, walkAwayPerQtl } from './rank.js';
import { dailyDefaultHazard, defaultProbability, expectedDaysToPay, paymentRisk, typicalDaysToPay } from './risk.js';
import type { BuyerProfile } from './types.js';

const scenario = () => rankBuyers(demoLot(), [REQ_B, REQ_C, REQ_A], matchContext());

describe('Gate F · the §16.2 three-buyer scenario', () => {
  it('ranks A (₹1,950, pays in 4 days) above C (₹1,900, 2 days) above B (₹2,000, 60 days)', () => {
    expect(scenario().matches.map((m) => m.buyerName)).toEqual(['Godavari Agro Traders', 'Niphad Traders', 'Deccan Exports']);
  });

  it('shows A exactly as PROMPT §6.5 describes: ₹9,750 gross, ₹9,400 after freight, 23 deals, ~4 days', () => {
    const a = scenario().matches[0];
    expect(a).toMatchObject({ offerPerQtl: 1950, vsBenchmarkPerQtl: 110, gross: 9750, freight: 350, afterFreight: 9400, completedDeals: 23, typicalDaysToPay: 4, fullLot: true });
    expect(a?.matched).toEqual({ value: 5, unit: 'quintal' });
    expect(a?.reasons.map((r) => r.code)).toEqual(['PRICE_VS_BENCHMARK', 'DISTANCE', 'QUANTITY_FULL', 'GROSS_AND_AFTER_FREIGHT', 'TRACK_RECORD']);
  });

  it('explains why A outranks B: ₹2,000 gross, but higher payment-delay risk', () => {
    const { matches } = scenario();
    const a = matches.find((m) => m.buyerId === 'buyer-a');
    const b = matches.find((m) => m.buyerId === 'buyer-b');
    if (!a || !b) throw new Error('both buyers must be shortlisted');
    const why = explainOrder(a, b);
    expect(why.grossDifferencePerQtl).toBe(-50);
    expect(why.decisive).toBe('payment-risk');
    expect(b.reasons.some((r) => r.code === 'PAYMENT_RISK')).toBe(true);
    expect(a.reasons.some((r) => r.code === 'PAYMENT_RISK')).toBe(false);
  });

  it('carries no percentage and no score anywhere in the result', () => {
    const json = JSON.stringify(scenario());
    expect(json).not.toMatch(/%/);
    expect(json).not.toMatch(/"(score|matchScore|percent|percentage|matchPct)"/i);
  });

  it('is deterministic and independent of input order', () => {
    const shuffled = rankBuyers(demoLot(), [REQ_A, REQ_C, REQ_B], matchContext());
    expect(shuffled).toEqual(rankBuyers(demoLot(), [REQ_A, REQ_C, REQ_B], matchContext()));
    expect(shuffled.matches.map((m) => m.requirementId)).toEqual(scenario().matches.map((m) => m.requirementId));
  });
});

describe('Gate F · payment delay is priced from the buyer’s own history', () => {
  const clean = (days: number): BuyerProfile['history'] => ({ completedDeals: 20, paymentDays: Array.from({ length: 20 }, () => days), defaults: 0, defaultExposureDays: 0, openDisputes: 0 });

  it('a buyer offering ₹50/qtl more who pays in 90 days ranks below one who pays in 4', () => {
    const prompt: BuyerProfile = { id: 'prompt', name: 'Prompt Payer', place: 'Lasalgaon', verified: true, history: clean(4) };
    const slow: BuyerProfile = { id: 'slow', name: 'Slow Payer', place: 'Lasalgaon', verified: true, history: clean(90) };
    const result = rankBuyers(
      demoLot(),
      [requirement('r-slow', 'slow', 2000, LASALGAON), requirement('r-prompt', 'prompt', 1950, LASALGAON)],
      matchContext({ buyers: [prompt, slow] }),
    );
    expect(result.matches.map((m) => m.buyerId)).toEqual(['prompt', 'slow']);
  });

  it('with equal payment behaviour, the higher offer ranks first', () => {
    const one: BuyerProfile = { id: 'one', name: 'One', place: 'Lasalgaon', verified: true, history: clean(4) };
    const two: BuyerProfile = { id: 'two', name: 'Two', place: 'Lasalgaon', verified: true, history: clean(4) };
    const result = rankBuyers(demoLot(), [requirement('r1', 'one', 1950, LASALGAON), requirement('r2', 'two', 2000, LASALGAON)], matchContext({ buyers: [one, two] }));
    expect(result.matches.map((m) => m.buyerId)).toEqual(['two', 'one']);
  });

  it('prices a buyer with no history as unknown, not as safe', () => {
    const fresh = { completedDeals: 0, paymentDays: [], defaults: 0, defaultExposureDays: 0, openDisputes: 0 };
    expect(expectedDaysToPay(fresh)).toBe(30);
    expect(typicalDaysToPay(fresh)).toBeNull();
    expect(defaultProbability(fresh, 30)).toBeGreaterThan(0.02);
  });

  it('default risk grows with the days money is outstanding, and is zero when paid at pickup', () => {
    expect(defaultProbability(BUYER_B.history, 0)).toBe(0);
    expect(defaultProbability(BUYER_B.history, 60)).toBeGreaterThan(defaultProbability(BUYER_B.history, 4));
    // (1 default + 1 prior) / (9·60 + 5·55 + 4·65 paid days + 90 defaulted days + 1,000 prior days)
    expect(dailyDefaultHazard(BUYER_B.history)).toBeCloseTo(2 / (1075 + 90 + 1000), 12);
  });

  it('costs delay at the farmer’s own rate of money', () => {
    const risk = paymentRisk(BUYER_A.history, 9750, 0.12);
    expect(risk.delayCost).toBeCloseTo((9750 * 0.12 * expectedDaysToPay(BUYER_A.history)) / 365, 9);
  });

  it('keeps an open dispute visible on the card instead of a clean record', () => {
    const disputed = { ...BUYER_C, history: { ...BUYER_C.history, openDisputes: 1 } };
    const m = rankBuyers(demoLot(), [REQ_C], matchContext({ buyers: [disputed] })).matches[0];
    expect(m?.underDispute).toBe(true);
    expect(m?.reasons.some((r) => r.code === 'UNDER_DISPUTE')).toBe(true);
  });

  it('does not shortlist a buyer whose chance of not paying is too high, whatever the price', () => {
    const risky: BuyerProfile = { id: 'risky', name: 'Risky', place: 'Lasalgaon', verified: true, history: { completedDeals: 4, paymentDays: [120, 150, 90, 180], defaults: 3, defaultExposureDays: 400, openDisputes: 0 } };
    const result = rankBuyers(demoLot(), [requirement('r-risky', 'risky', 2600, LASALGAON)], matchContext({ buyers: [risky] }));
    expect(result.matches).toEqual([]);
    expect(result.excluded).toEqual([{ requirementId: 'r-risky', buyerId: 'risky', reason: 'payment-risk-too-high' }]);
  });
});

describe('P1-05 · crop is a hard filter, with one auditable substitution table', () => {
  it('a cotton buyer never ranks against an onion lot — excluded, not scored low', () => {
    const cotton = requirement('r-cotton', 'buyer-a', 7000, LASALGAON, { crop: 'cotton' });
    const result = rankBuyers(demoLot(), [cotton], matchContext());
    expect(result.matches).toEqual([]);
    expect(result.excluded[0]?.reason).toBe('crop-mismatch');
  });

  it('no substring credit: "onion-seed" is not "onion"', () => {
    const seed = requirement('r-seed', 'buyer-a', 1950, LASALGAON, { crop: 'onion-seed' });
    expect(rankBuyers(demoLot(), [seed], matchContext()).excluded[0]?.reason).toBe('crop-mismatch');
  });

  it('a listed variety substitution passes, and is labelled as a substitution', () => {
    const wantsKharif = requirement('r-var', 'buyer-a', 1950, LASALGAON, { variety: 'kharif' });
    const m = rankBuyers(demoLot({ variety: 'late-kharif' }), [wantsKharif], matchContext()).matches[0];
    expect(m?.substitution).toMatchObject({ requested: 'kharif', offered: 'late-kharif' });
    expect(m?.reasons.some((r) => r.code === 'SUBSTITUTION')).toBe(true);
  });

  it('an unlisted variety difference is excluded', () => {
    const wantsRabi = requirement('r-rabi', 'buyer-a', 1950, LASALGAON, { variety: 'rabi' });
    expect(rankBuyers(demoLot({ variety: 'kharif' }), [wantsRabi], matchContext()).excluded[0]?.reason).toBe('variety-mismatch');
  });
});

describe('P1-06 · price is scored against the district benchmark, never the farmer’s ask', () => {
  it('the farmer’s own ask changes nothing — neither the order nor any figure', () => {
    const lowAsk = rankBuyers(demoLot({ askingPrice: { amount: 1200, unit: 'quintal' } }), [REQ_A, REQ_B, REQ_C], matchContext());
    const highAsk = rankBuyers(demoLot({ askingPrice: { amount: 2600, unit: 'quintal' } }), [REQ_A, REQ_B, REQ_C], matchContext());
    expect(lowAsk).toEqual(highAsk);
  });

  it('reports the offer against today’s district modal', () => {
    const c = scenario().matches.find((m) => m.buyerId === 'buyer-c');
    expect(c?.vsBenchmarkPerQtl).toBe(60);
    expect(c?.reasons[0]).toEqual({ code: 'PRICE_VS_BENCHMARK', deltaPerQtl: 60, position: 'above', market: 'lasalgaon' });
  });

  it('normalises a per-kilo offer before comparing', () => {
    const perKg = requirement('r-kg', 'buyer-a', 0, LASALGAON, { price: { amount: 19.5, unit: 'kg' } });
    expect(rankBuyers(demoLot(), [perKg], matchContext()).matches[0]?.offerPerQtl).toBe(1950);
  });
});

describe('FR-09 · quantity is overlap, not a ratio', () => {
  it('"500 kg matched · 4,500 kg remaining", in the farmer’s own unit', () => {
    const small = requirement('r-small', 'buyer-a', 1950, LASALGAON, { maxQuantity: { value: 500, unit: 'kg' } });
    const m = rankBuyers(demoLot({ quantity: { value: 5000, unit: 'kg' } }), [small], matchContext()).matches[0];
    expect(m?.matched).toEqual({ value: 500, unit: 'kg' });
    expect(m?.remaining).toEqual({ value: 4500, unit: 'kg' });
    expect(m?.fullLot).toBe(false);
    expect(m?.reasons).toContainEqual({ code: 'QUANTITY_PARTIAL', matched: { value: 500, unit: 'kg' }, remaining: { value: 4500, unit: 'kg' } });
  });

  it('a lot below the buyer’s minimum is not a match — it is an aggregation opportunity', () => {
    const bulk = requirement('r-bulk', 'buyer-a', 2100, LASALGAON, { minQuantity: { value: 18, unit: 'quintal' } });
    const result = rankBuyers(demoLot(), [bulk], matchContext());
    expect(result.excluded[0]?.reason).toBe('below-minimum-quantity');
    expect(result.alternatives.poolCandidates).toEqual(['r-bulk']);
  });
});

describe('P1-01 · no score floor — honest emptiness beats fake recommendations', () => {
  it('when nothing clears, the shortlist is empty and says what the farmer can do instead', () => {
    const lowball = requirement('r-low', 'buyer-a', 1500, LASALGAON);
    const result = rankBuyers(demoLot(), [lowball], matchContext());
    expect(result.matches).toEqual([]);
    expect(result.excluded).toEqual([{ requirementId: 'r-low', buyerId: 'buyer-a', reason: 'below-walk-away' }]);
    expect(result.alternatives).toEqual({ benchmarkPerQtl: 1840, market: 'lasalgaon', nearestMandi: { name: 'Lasalgaon', roadKm: 13.4 }, poolCandidates: [] });
  });

  it('the workable threshold is the farmer’s own alternative: the nearest mandi, net of freight and charges', () => {
    // 1,840 − ₹350 freight for 5 qtl (₹70/qtl) − 2% market charges
    expect(walkAwayPerQtl(demoLot(), matchContext())).toBeCloseTo(1840 - 70 - 36.8, 9);
  });

  it('unverified buyers may browse but never appear on a farmer’s shortlist', () => {
    const unverified = { ...BUYER_A, verified: false };
    expect(rankBuyers(demoLot(), [REQ_A], matchContext({ buyers: [unverified] })).excluded[0]?.reason).toBe('unverified-buyer');
  });

  it('excludes requirements outside their radius, expired, or below the grade floor — each with its reason', () => {
    const far = requirement('r-far', 'buyer-a', 1950, { lat: 18.52, lon: 73.86 }, { radiusKm: 50 });
    const expired = requirement('r-old', 'buyer-a', 1950, LASALGAON, { validUntil: '2026-09-01' });
    const choosy = requirement('r-a', 'buyer-a', 1950, LASALGAON, { gradeFloor: 'A' });
    expect(rankBuyers(demoLot(), [far, expired, choosy], matchContext()).excluded.map((e) => e.reason)).toEqual([
      'outside-radius',
      'not-currently-buying',
      'grade-below-floor',
    ]);
  });

  it('an ungraded lot is matched, with the grade to be checked at pickup', () => {
    const graded = requirement('r-b', 'buyer-a', 1950, LASALGAON, { gradeFloor: 'B' });
    const m = rankBuyers(demoLot({ grade: null }), [graded], matchContext()).matches[0];
    expect(m?.gradeCheckAtPickup).toBe(true);
  });
});

describe('FR-05 · freight from a hired-vehicle tariff', () => {
  it('charges the vehicle minimum on a short trip — ₹350 for 5 qtl over 13 km', () => {
    expect(estimateFreight(TARIFFS, 13.4, 500)).toEqual({ total: 350, vehicleClass: 'Mini-truck (≈0.75 t)', tariffId: 'nsk-ace', trips: 1 });
  });

  it('chooses the cheapest workable vehicle and counts trips', () => {
    const f = estimateFreight(TARIFFS, 40, 5000);
    expect(f?.tariffId).toBe('nsk-407');
    expect(f?.trips).toBe(2);
    expect(f?.total).toBe(2 * 1200);
  });

  it('returns nothing, rather than a made-up rate, when no tariff is known', () => {
    expect(estimateFreight([], 10, 500)).toBeNull();
    const result = rankBuyers(demoLot(), [REQ_A], matchContext({ tariffs: [], nearestMandi: null }));
    expect(result.excluded[0]?.reason).toBe('no-transport-tariff');
  });
});

describe('FR-09 · requirements are several and concurrent per buyer', () => {
  it('each requirement is ranked on its own terms', () => {
    const second = requirement('req-a2', 'buyer-a', 1980, LASALGAON, { maxQuantity: { value: 3, unit: 'quintal' } });
    const result = rankBuyers(demoLot(), [REQ_A, second], matchContext({ buyers: [BUYER_A] }));
    expect(result.matches.map((m) => m.requirementId).sort()).toEqual(['req-a', 'req-a2']);
    expect(result.matches.find((m) => m.requirementId === 'req-a2')?.fullLot).toBe(false);
  });

  it('uses BUYER_C as a control: a clean, prompt payer is costed but not flagged', () => {
    const c = rankBuyers(demoLot(), [REQ_C], matchContext({ buyers: [BUYER_C] })).matches[0];
    expect(c?.reasons.some((r) => r.code === 'PAYMENT_RISK')).toBe(false);
    expect(c?.defaultRiskCost).toBeGreaterThan(0);
  });
});
