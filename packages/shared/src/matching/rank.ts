/**
 * The explained buyer shortlist (FR-09; P1-01, P1-05, P1-06). Never a match percentage.
 *
 * Constrained multi-criteria ranking against one explicit objective — expected net realisation:
 *
 *   rank key = gross offer − estimated freight − expected payment-delay cost − default-risk cost
 *
 *  - crop is a hard filter; variety differences pass only through the one auditable
 *    substitution table, and are always labelled (P1-05);
 *  - quantity is overlap ("500 kg matched · 4,500 kg remaining"), never a ratio;
 *  - price is compared with the district benchmark, never with the farmer's ask (P1-06) — the
 *    ask is not even an input here;
 *  - distance is priced as freight from a hired-vehicle tariff;
 *  - payment delay and default risk come from the buyer's own completed deals.
 *
 * There is no score floor. A buyer whose risk-adjusted net is below what the farmer would get by
 * taking the lot to the nearest mandi is not shortlisted; when nothing clears, the result is
 * empty and says what the farmer can do instead (P1-01).
 */
import { MANDI_CHARGES_FRACTION, MAX_DEFAULT_PROBABILITY } from '../constants/policy.js';
import { dayNumber } from '../core/dates.js';
import { distanceKm, roadKm } from '../core/geo.js';
import type { VarietySubstitution } from '../crops/types.js';
import { convertQuantity, normalisePrice, quantityToKg, type Money, type Quantity } from '../units/units.js';
import { estimateFreight } from './freight.js';
import { paymentRisk } from './risk.js';
import { GRADE_RANK, type BuyerRequirement, type Lot, type MatchContext } from './types.js';

export type MatchReason =
  | { code: 'PRICE_VS_BENCHMARK'; deltaPerQtl: number; position: 'above' | 'at' | 'below'; market: string }
  | { code: 'DISTANCE'; roadKm: number }
  | { code: 'QUANTITY_FULL'; matched: Quantity }
  | { code: 'QUANTITY_PARTIAL'; matched: Quantity; remaining: Quantity }
  | { code: 'GROSS_AND_AFTER_FREIGHT'; gross: number; afterFreight: number }
  | { code: 'TRACK_RECORD'; completedDeals: number; typicalDaysToPay: number | null }
  | { code: 'NEW_BUYER' }
  | { code: 'PAYMENT_RISK'; expectedDaysToPay: number; costPerQtl: number }
  | { code: 'SUBSTITUTION'; requested: string; offered: string; note: string }
  | { code: 'GRADE_CHECK_AT_PICKUP' }
  | { code: 'UNDER_DISPUTE'; openDisputes: number };

export type ExclusionReason =
  | 'not-currently-buying'
  | 'unverified-buyer'
  | 'crop-mismatch'
  | 'variety-mismatch'
  | 'grade-below-floor'
  | 'outside-radius'
  | 'below-minimum-quantity'
  | 'unit-unknown'
  | 'no-transport-tariff'
  | 'payment-risk-too-high'
  | 'below-walk-away';

export interface Exclusion {
  requirementId: string;
  buyerId: string;
  reason: ExclusionReason;
}

export interface RankedMatch {
  requirementId: string;
  buyerId: string;
  buyerName: string;
  buyerPlace: string;
  offerAsStated: Money;
  offerPerQtl: number;
  vsBenchmarkPerQtl: number;
  roadKm: number;
  /** In the farmer's own unit. */
  matched: Quantity;
  remaining: Quantity;
  /** The matched quantity in quintals — the basis of every per-quintal figure. */
  matchedQtl: number;
  fullLot: boolean;
  vehicleClass: string;
  /** Whole-lot rupees for the matched quantity. */
  gross: number;
  freight: number;
  afterFreight: number;
  paymentDelayCost: number;
  defaultRiskCost: number;
  riskAdjustedNet: number;
  riskAdjustedNetPerQtl: number;
  expectedDaysToPay: number;
  typicalDaysToPay: number | null;
  defaultProbability: number;
  completedDeals: number;
  underDispute: boolean;
  substitution: VarietySubstitution | null;
  gradeCheckAtPickup: boolean;
  reasons: MatchReason[];
}

export interface MatchResult {
  matches: RankedMatch[];
  excluded: Exclusion[];
  /** ₹/qtl the farmer would realise at the nearest mandi — the workable threshold. */
  walkAwayPerQtl: number | null;
  /** When empty: what the farmer can do instead (PROMPT §6.5, §10.4). */
  alternatives: {
    benchmarkPerQtl: number;
    market: string;
    nearestMandi: { name: string; roadKm: number } | null;
    /** Requirements this lot is too small for on its own — candidates for an aggregation pool. */
    poolCandidates: string[];
  };
}

/** A risk cost at or above this share of the offer is named in the explanation. */
const RISK_WORTH_NAMING = 0.01;

function inFarmerUnit(kg: number, like: Quantity, context: MatchContext): Quantity {
  const converted = convertQuantity({ value: kg, unit: 'kg' }, like.unit, context.weights);
  return converted.ok ? converted.value : { value: kg, unit: 'kg' };
}

function varietyCheck(lot: Lot, requirement: BuyerRequirement, table: readonly VarietySubstitution[]): VarietySubstitution | null | 'mismatch' {
  if (requirement.variety === undefined || lot.variety === undefined || requirement.variety === lot.variety) return null;
  const substitution = table.find((s) => s.crop === lot.crop && s.requested === requirement.variety && s.offered === lot.variety);
  return substitution ?? 'mismatch';
}

/** The farmer's walk-away price: district modal, less freight to the nearest mandi and market charges. */
export function walkAwayPerQtl(lot: Lot, context: MatchContext): number | null {
  if (context.nearestMandi === null) return null;
  const kg = quantityToKg(lot.quantity, context.weights);
  if (!kg.ok) return null;
  const freight = estimateFreight(context.tariffs, context.nearestMandi.roadKm, kg.value);
  if (freight === null) return null;
  const modal = context.benchmark.modalPerQtl;
  return modal - freight.total / (kg.value / 100) - MANDI_CHARGES_FRACTION.value * modal;
}

export function rankBuyers(lot: Lot, requirements: readonly BuyerRequirement[], context: MatchContext): MatchResult {
  const excluded: Exclusion[] = [];
  const matches: RankedMatch[] = [];
  const poolCandidates: string[] = [];
  const exclude = (requirement: BuyerRequirement, reason: ExclusionReason): void => {
    excluded.push({ requirementId: requirement.id, buyerId: requirement.buyerId, reason });
  };

  const lotKg = quantityToKg(lot.quantity, context.weights);
  const walkAway = walkAwayPerQtl(lot, context);
  const today = dayNumber(context.today);

  for (const requirement of requirements) {
    if (today < dayNumber(requirement.validFrom) || today > dayNumber(requirement.validUntil)) {
      exclude(requirement, 'not-currently-buying');
      continue;
    }
    const buyer = context.buyers.find((b) => b.id === requirement.buyerId);
    if (buyer === undefined || !buyer.verified) {
      exclude(requirement, 'unverified-buyer');
      continue;
    }
    // Crop is a filter, not a weight: a wheat lot never ranks against a cotton buyer (P1-05).
    if (requirement.crop !== lot.crop) {
      exclude(requirement, 'crop-mismatch');
      continue;
    }
    const variety = varietyCheck(lot, requirement, context.substitutions);
    if (variety === 'mismatch') {
      exclude(requirement, 'variety-mismatch');
      continue;
    }
    if (requirement.gradeFloor !== null && lot.grade !== null && GRADE_RANK[lot.grade] < GRADE_RANK[requirement.gradeFloor]) {
      exclude(requirement, 'grade-below-floor');
      continue;
    }
    if (distanceKm(lot.location, requirement.location) > requirement.radiusKm) {
      exclude(requirement, 'outside-radius');
      continue;
    }
    const minKg = quantityToKg(requirement.minQuantity, context.weights);
    const maxKg = quantityToKg(requirement.maxQuantity, context.weights);
    const offer = normalisePrice(requirement.price, 'quintal', context.weights);
    if (!lotKg.ok || !minKg.ok || !maxKg.ok || !offer.ok) {
      exclude(requirement, 'unit-unknown');
      continue;
    }
    if (lotKg.value < minKg.value) {
      exclude(requirement, 'below-minimum-quantity');
      poolCandidates.push(requirement.id);
      continue;
    }

    const matchedKg = Math.min(lotKg.value, maxKg.value);
    const road = roadKm(lot.location, requirement.location);
    const freight = estimateFreight(context.tariffs, road, matchedKg);
    if (freight === null) {
      exclude(requirement, 'no-transport-tariff');
      continue;
    }

    const quintals = matchedKg / 100;
    const gross = offer.value.amount * quintals;
    const risk = paymentRisk(buyer.history, gross, context.financeRateAnnual);
    if (risk.defaultProbability > MAX_DEFAULT_PROBABILITY.value) {
      exclude(requirement, 'payment-risk-too-high');
      continue;
    }
    const riskAdjustedNet = gross - freight.total - risk.delayCost - risk.defaultCost;
    const netPerQtl = riskAdjustedNet / quintals;
    if (walkAway !== null && netPerQtl < walkAway) {
      exclude(requirement, 'below-walk-away');
      continue;
    }

    const matched = inFarmerUnit(matchedKg, lot.quantity, context);
    const remaining = inFarmerUnit(lotKg.value - matchedKg, lot.quantity, context);
    const fullLot = matchedKg >= lotKg.value;
    const delta = offer.value.amount - context.benchmark.modalPerQtl;
    const riskPerQtl = (risk.delayCost + risk.defaultCost) / quintals;

    const reasons: MatchReason[] = [
      { code: 'PRICE_VS_BENCHMARK', deltaPerQtl: delta, position: delta > 0 ? 'above' : delta < 0 ? 'below' : 'at', market: context.benchmark.market },
      { code: 'DISTANCE', roadKm: road },
      fullLot ? { code: 'QUANTITY_FULL', matched } : { code: 'QUANTITY_PARTIAL', matched, remaining },
      { code: 'GROSS_AND_AFTER_FREIGHT', gross, afterFreight: gross - freight.total },
      buyer.history.completedDeals > 0
        ? { code: 'TRACK_RECORD', completedDeals: buyer.history.completedDeals, typicalDaysToPay: risk.typicalDaysToPay }
        : { code: 'NEW_BUYER' },
    ];
    if (riskPerQtl >= RISK_WORTH_NAMING * offer.value.amount) {
      reasons.push({ code: 'PAYMENT_RISK', expectedDaysToPay: risk.expectedDaysToPay, costPerQtl: riskPerQtl });
    }
    if (variety !== null) reasons.push({ code: 'SUBSTITUTION', requested: variety.requested, offered: variety.offered, note: variety.note });
    const gradeCheckAtPickup = requirement.gradeFloor !== null && lot.grade === null;
    if (gradeCheckAtPickup) reasons.push({ code: 'GRADE_CHECK_AT_PICKUP' });
    const underDispute = buyer.history.openDisputes > 0;
    if (underDispute) reasons.push({ code: 'UNDER_DISPUTE', openDisputes: buyer.history.openDisputes });

    matches.push({
      requirementId: requirement.id,
      buyerId: buyer.id,
      buyerName: buyer.name,
      buyerPlace: buyer.place,
      offerAsStated: requirement.price,
      offerPerQtl: offer.value.amount,
      vsBenchmarkPerQtl: delta,
      roadKm: road,
      matched,
      remaining,
      matchedQtl: quintals,
      fullLot,
      vehicleClass: freight.vehicleClass,
      gross,
      freight: freight.total,
      afterFreight: gross - freight.total,
      paymentDelayCost: risk.delayCost,
      defaultRiskCost: risk.defaultCost,
      riskAdjustedNet,
      riskAdjustedNetPerQtl: netPerQtl,
      expectedDaysToPay: risk.expectedDaysToPay,
      typicalDaysToPay: risk.typicalDaysToPay,
      defaultProbability: risk.defaultProbability,
      completedDeals: buyer.history.completedDeals,
      underDispute,
      substitution: variety,
      gradeCheckAtPickup,
      reasons,
    });
  }

  matches.sort(
    (a, b) =>
      b.riskAdjustedNetPerQtl - a.riskAdjustedNetPerQtl || b.completedDeals - a.completedDeals || a.requirementId.localeCompare(b.requirementId),
  );

  return {
    matches,
    excluded,
    walkAwayPerQtl: walkAway,
    alternatives: {
      benchmarkPerQtl: context.benchmark.modalPerQtl,
      market: context.benchmark.market,
      nearestMandi: context.nearestMandi,
      poolCandidates,
    },
  };
}

export interface OrderExplanation {
  grossDifferencePerQtl: number;
  freightDifferencePerQtl: number;
  riskDifferencePerQtl: number;
  /** What decided the order: the largest of the three differences in the higher match's favour. */
  decisive: 'price' | 'freight' | 'payment-risk';
}

/**
 * Why `higher` outranks `lower` — e.g. "₹2,000 gross, but higher payment-delay risk". Differences
 * are per quintal and signed in `higher`'s favour.
 */
export function explainOrder(higher: RankedMatch, lower: RankedMatch): OrderExplanation {
  const q = (m: RankedMatch): number => m.matchedQtl;
  const grossDifferencePerQtl = higher.offerPerQtl - lower.offerPerQtl;
  const freightDifferencePerQtl = lower.freight / q(lower) - higher.freight / q(higher);
  const riskDifferencePerQtl =
    (lower.paymentDelayCost + lower.defaultRiskCost) / q(lower) - (higher.paymentDelayCost + higher.defaultRiskCost) / q(higher);
  const contributions: Array<[OrderExplanation['decisive'], number]> = [
    ['price', grossDifferencePerQtl],
    ['freight', freightDifferencePerQtl],
    ['payment-risk', riskDifferencePerQtl],
  ];
  contributions.sort((a, b) => b[1] - a[1]);
  return { grossDifferencePerQtl, freightDifferencePerQtl, riskDifferencePerQtl, decisive: contributions[0]?.[0] ?? 'price' };
}
