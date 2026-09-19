/** GR-1 · RK-6 · Gate D — staleness governs advice, at the exact per-crop thresholds. */
import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, InvalidDateError, rangesOverlap } from '../core/dates.js';
import { ageDays, bandMultiplier, isAdviceSuppressed, widenBand } from './staleness.js';

describe('GR-1 · suppression at the exact per-crop limit (Gate D)', () => {
  it('perishables: advice at 7 days old, suppressed at 8', () => {
    expect(isAdviceSuppressed('2026-09-04', '2026-09-11', 7)).toBe(false);
    expect(isAdviceSuppressed('2026-09-04', '2026-09-12', 7)).toBe(true);
  });

  it('grains: advice at 14 days old, suppressed at 15', () => {
    expect(isAdviceSuppressed('2026-09-04', '2026-09-18', 14)).toBe(false);
    expect(isAdviceSuppressed('2026-09-04', '2026-09-19', 14)).toBe(true);
  });

  it('age is whole days, and a future as-of date is age 0 rather than negative', () => {
    expect(ageDays('2026-09-04', '2026-09-04')).toBe(0);
    expect(ageDays('2026-08-30', '2026-09-04')).toBe(5);
    expect(ageDays('2026-09-10', '2026-09-04')).toBe(0);
  });

  it('rejects a nonsensical limit', () => {
    expect(() => isAdviceSuppressed('2026-09-04', '2026-09-05', -1)).toThrow(RangeError);
  });
});

describe('RK-6 · bands widen with age and never narrow', () => {
  it('band_multiplier(age) = 1 + κ · age', () => {
    expect(bandMultiplier(0, 0.06)).toBe(1);
    expect(bandMultiplier(5, 0.06)).toBeCloseTo(1.3, 12);
    expect(() => bandMultiplier(-1, 0.06)).toThrow(RangeError);
  });

  it('widens about the median, which does not move', () => {
    const widened = widenBand({ q10: 1790, q50: 1905, q90: 2060 }, 1.5);
    expect(widened.q50).toBe(1905);
    expect(widened.q10).toBeCloseTo(1732.5, 9);
    expect(widened.q90).toBeCloseTo(2137.5, 9);
  });

  it('refuses a multiplier that would narrow the band', () => {
    expect(() => widenBand({ q10: 1, q50: 2, q90: 3 }, 0.9)).toThrow(/narrow/);
  });
});

describe('calendar arithmetic', () => {
  it('counts days across month and year ends and rejects impossible dates', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(InvalidDateError);
    expect(() => daysBetween('04/09/2026', '2026-03-01')).toThrow(InvalidDateError);
  });

  it('detects overlapping availability windows, inclusively', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-05', '2026-09-05', '2026-09-09')).toBe(true);
    expect(rangesOverlap('2026-09-01', '2026-09-04', '2026-09-05', '2026-09-09')).toBe(false);
  });
});
