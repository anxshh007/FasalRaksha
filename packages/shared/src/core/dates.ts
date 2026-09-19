/**
 * Calendar-date arithmetic on `YYYY-MM-DD` strings, in whole UTC days.
 *
 * Pure: nothing here reads the clock. "Today" is always an argument, computed by the caller in
 * the farmer's timezone, so the device, the API and the channels agree on a date given the same
 * inputs.
 */
import type { ISODate } from './types.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`"${value}" is not a calendar date in YYYY-MM-DD form.`);
    this.name = 'InvalidDateError';
  }
}

/** Days since 1970-01-01 (UTC). Throws `InvalidDateError` for malformed or impossible dates. */
export function dayNumber(date: ISODate): number {
  const match = ISO_DATE.exec(date);
  if (match === null) throw new InvalidDateError(date);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new InvalidDateError(date);
  }
  return Math.round(ms / MS_PER_DAY);
}

export function isIsoDate(value: string): boolean {
  try {
    dayNumber(value);
    return true;
  } catch {
    return false;
  }
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) throw new RangeError('addDays takes a whole number of days.');
  const ms = (dayNumber(date) + days) * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/** True when the inclusive ranges [aStart, aEnd] and [bStart, bEnd] share at least one day. */
export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return dayNumber(aStart) <= dayNumber(bEnd) && dayNumber(bStart) <= dayNumber(aEnd);
}
