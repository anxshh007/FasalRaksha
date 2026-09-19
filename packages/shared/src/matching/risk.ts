/**
 * Payment risk from the buyer's own completed-deal history (L-2: payment default and delay).
 *
 * Two costs, both in rupees, both explainable:
 *
 *  - payment-delay cost: the farmer's money is tied up for the days the buyer actually takes to
 *    pay, at the farmer's own cost of money;
 *  - default-risk cost: the chance the money never arrives, times the amount. Default is modelled
 *    as a hazard per day outstanding, estimated from this buyer's history and shrunk toward a
 *    prior so that a buyer with no history is priced as unknown, not as safe. Risk therefore
 *    grows with the payment delay itself.
 *
 * This is deliberately not machine learning: there is no transaction corpus to learn from, and
 * a learned ranker could not explain itself (PROMPT §6.5).
 */
import { DEFAULT_RISK_PRIOR, PAYMENT_DAYS_PRIOR } from '../constants/policy.js';
import type { BuyerHistory } from './types.js';

/** Mean days to pay over completed deals; the prior when there are none. Drives the cost. */
export function expectedDaysToPay(history: BuyerHistory): number {
  if (history.paymentDays.length === 0) return PAYMENT_DAYS_PRIOR.value;
  return history.paymentDays.reduce((sum, d) => sum + d, 0) / history.paymentDays.length;
}

/** Median days to pay — what the farmer is shown ("pays in ~4 days"). Null with no history. */
export function typicalDaysToPay(history: BuyerHistory): number | null {
  if (history.paymentDays.length === 0) return null;
  const sorted = [...history.paymentDays].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Defaults per day of money outstanding (Gamma–Poisson posterior mean). */
export function dailyDefaultHazard(history: BuyerHistory): number {
  const exposure = history.paymentDays.reduce((sum, d) => sum + d, 0) + history.defaultExposureDays;
  return (history.defaults + DEFAULT_RISK_PRIOR.value.defaults) / (exposure + DEFAULT_RISK_PRIOR.value.exposureDays);
}

/** Probability the money never arrives, for `days` of exposure. Payment at pickup carries none. */
export function defaultProbability(history: BuyerHistory, days: number): number {
  if (!(days >= 0)) throw new RangeError('Days of exposure cannot be negative.');
  return 1 - Math.exp(-dailyDefaultHazard(history) * days);
}

export interface PaymentRisk {
  expectedDaysToPay: number;
  typicalDaysToPay: number | null;
  defaultProbability: number;
  /** ₹ for the given gross amount. */
  delayCost: number;
  defaultCost: number;
}

export function paymentRisk(history: BuyerHistory, gross: number, financeRateAnnual: number): PaymentRisk {
  const days = expectedDaysToPay(history);
  const p = defaultProbability(history, days);
  return {
    expectedDaysToPay: days,
    typicalDaysToPay: typicalDaysToPay(history),
    defaultProbability: p,
    delayCost: gross * financeRateAnnual * (days / 365),
    defaultCost: gross * p,
  };
}
