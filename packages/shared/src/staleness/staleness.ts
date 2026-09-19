/**
 * Staleness governs advice, not just display (Constitution §10).
 *
 * Every price and forecast carries `asOf`. Bands widen with age at the crop's own measured rate
 * (`bandKappa`). Past the crop's limit — 7 days for perishables, 14 for grains — the
 * sell/wait reading is suppressed entirely: the price is still shown, with its date, but no
 * recommendation is attached to it. There is no other path from a stale forecast to a farmer.
 */
import { daysBetween } from '../core/dates.js';
import type { ISODate } from '../core/types.js';

/** Whole days between the data's as-of date and today. Never negative (a future as-of date is age 0). */
export function ageDays(asOf: ISODate, today: ISODate): number {
  return Math.max(0, daysBetween(asOf, today));
}

/** True once the data is *past* the limit: at exactly `limitDays` old, advice is still given. */
export function isAdviceSuppressed(asOf: ISODate, today: ISODate, limitDays: number): boolean {
  if (!Number.isInteger(limitDays) || limitDays < 0) throw new RangeError('A staleness limit is a non-negative whole number of days.');
  return ageDays(asOf, today) > limitDays;
}

/** `1 + κ · age` (PROMPT §5.3). The band only ever widens. */
export function bandMultiplier(age: number, kappa: number): number {
  if (!(age >= 0) || !(kappa >= 0)) throw new RangeError('Age and κ must both be non-negative.');
  return 1 + kappa * age;
}

export interface QuantileBand {
  q10: number;
  q50: number;
  q90: number;
}

/** Widen a band about its median by `multiplier` (≥ 1). The median does not move. */
export function widenBand(band: QuantileBand, multiplier: number): QuantileBand {
  if (!(multiplier >= 1)) throw new RangeError('A band multiplier below 1 would narrow the band.');
  return {
    q10: band.q50 - (band.q50 - band.q10) * multiplier,
    q50: band.q50,
    q90: band.q50 + (band.q90 - band.q50) * multiplier,
  };
}
