/**
 * Weather as urgency, not prediction (PROMPT §XIII; RK-4; FR-13).
 *
 * Nothing here forecasts anything. A published district forecast comes in, and what comes out is
 * an operational sentence a farmer can act on today:
 *
 *   "Rain expected Thursday in Nashik. Your onion lot is moisture-sensitive. Move it within 48 hours."
 *
 * Three rules keep it honest. A forecast has an age, and past `WEATHER_MAX_AGE_DAYS` it produces
 * no urgency at all — the same discipline staleness imposes on price advice, for the same reason.
 * A crop that is not moisture-sensitive never gets the strong sentence, however wet the week. And
 * the level is derived from published millimetres and the crop's own sensitivity, never from a
 * model: `source` travels with the forecast so a screen can say where it came from.
 */
import { daysBetween } from '../core/dates.js';
import type { DistrictId, ISODate } from '../core/types.js';
import type { CropProfile } from '../crops/types.js';

export interface DailyWeather {
  date: ISODate;
  rainMm: number;
  /** 0–1, or null when the source does not publish it. */
  rainProbability: number | null;
  humidityPct: number | null;
}

export interface DistrictForecast {
  district: DistrictId;
  issuedDate: ISODate;
  days: DailyWeather[];
  source: string;
}

/** Beyond this, a forecast says nothing: weather advice goes stale faster than price advice. */
export const WEATHER_MAX_AGE_DAYS = 2;
/** A day's rainfall at or above this is "rain expected", not a passing shower. */
export const RAIN_MM_EXPECTED = 5;
/** …or a published chance at or above this, where the source gives one. */
export const RAIN_PROBABILITY_EXPECTED = 0.6;
/** Sustained humidity at or above this spoils a moisture-sensitive lot sitting in the open. */
export const HUMIDITY_WATCH_PCT = 85;
/** Rain this soon is something to act on today, not to keep an eye on. */
export const ACT_WITHIN_HOURS = 48;

export type UrgencyLevel = 'none' | 'watch' | 'move';
export type UrgencyReason = 'rain-soon' | 'rain-later' | 'humid' | 'clear' | 'no-forecast' | 'stale-forecast';

export interface WeatherUrgency {
  level: UrgencyLevel;
  reason: UrgencyReason;
  /** The first day rain is expected, when there is one. */
  day: ISODate | null;
  rainMm: number | null;
  /** Hours from the start of today to that day: what "within 48 hours" is measured against. */
  hoursToAct: number | null;
  humidityPct: number | null;
  forecastAgeDays: number | null;
  source: string | null;
}

const NONE = (reason: UrgencyReason, forecastAgeDays: number | null, source: string | null): WeatherUrgency => ({
  level: 'none',
  reason,
  day: null,
  rainMm: null,
  hoursToAct: null,
  humidityPct: null,
  forecastAgeDays,
  source,
});

function expectsRain(day: DailyWeather): boolean {
  return day.rainMm >= RAIN_MM_EXPECTED || (day.rainProbability !== null && day.rainProbability >= RAIN_PROBABILITY_EXPECTED);
}

/**
 * What this lot's weather means today. `today` is the farmer's day, not the forecast's: a
 * forecast issued two days ago is still read against today, and is discarded once it is older
 * than `WEATHER_MAX_AGE_DAYS`.
 */
export function weatherUrgency(forecast: DistrictForecast | null, crop: Pick<CropProfile, 'moistureRelevant'>, today: ISODate): WeatherUrgency {
  if (forecast === null || forecast.days.length === 0) return NONE('no-forecast', null, forecast?.source ?? null);
  const age = daysBetween(forecast.issuedDate, today);
  if (age > WEATHER_MAX_AGE_DAYS || age < 0) return NONE('stale-forecast', age, forecast.source);

  const ahead = forecast.days.filter((day) => day.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const wet = ahead.find(expectsRain);
  if (wet !== undefined) {
    const hours = daysBetween(today, wet.date) * 24;
    const soon = hours <= ACT_WITHIN_HOURS;
    return {
      // Only a moisture-sensitive lot gets "move it": for everything else rain is worth knowing,
      // not worth a lorry today.
      level: soon && crop.moistureRelevant ? 'move' : 'watch',
      reason: soon ? 'rain-soon' : 'rain-later',
      day: wet.date,
      rainMm: wet.rainMm,
      hoursToAct: hours,
      humidityPct: wet.humidityPct,
      forecastAgeDays: age,
      source: forecast.source,
    };
  }

  const humid = crop.moistureRelevant ? ahead.find((day) => day.humidityPct !== null && day.humidityPct >= HUMIDITY_WATCH_PCT) : undefined;
  if (humid !== undefined) {
    return {
      level: 'watch',
      reason: 'humid',
      day: humid.date,
      rainMm: humid.rainMm,
      hoursToAct: daysBetween(today, humid.date) * 24,
      humidityPct: humid.humidityPct,
      forecastAgeDays: age,
      source: forecast.source,
    };
  }
  return NONE('clear', age, forecast.source);
}

/**
 * The first day in a delivery window that the weather does not argue against — what the sauda
 * slip suggests for the pickup (FR-13). Not a booking: two verified parties still make the call.
 * With no usable forecast the answer is the first day of the window, and the slip says why.
 */
export function suggestedPickup(forecast: DistrictForecast | null, from: ISODate, until: ISODate, today: ISODate): { date: ISODate; weatherChecked: boolean } {
  const start = from > today ? from : today;
  if (forecast === null || daysBetween(forecast.issuedDate, today) > WEATHER_MAX_AGE_DAYS) return { date: start, weatherChecked: false };
  const dry = forecast.days.filter((day) => day.date >= start && day.date <= until && !expectsRain(day)).sort((a, b) => a.date.localeCompare(b.date))[0];
  return { date: dry?.date ?? start, weatherChecked: true };
}

export class ForecastShapeError extends Error {
  constructor(
    readonly path: string,
    problem: string,
  ) {
    super(`${path}: ${problem}`);
    this.name = 'ForecastShapeError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a served weather document strictly, the way the demand document is parsed: the phone
 * verifies the integrity hash first, then refuses anything that is not exactly this shape rather
 * than storing a half-understood forecast and reasoning from it.
 */
export function parseForecast(raw: unknown): DistrictForecast {
  const doc = raw as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ForecastShapeError('weather', 'must be an object');
  if (doc['kind'] !== 'weather') throw new ForecastShapeError('weather.kind', 'must be "weather"');
  const district = doc['district'];
  const issuedDate = doc['issuedDate'];
  const source = doc['source'];
  const days = doc['days'];
  if (typeof district !== 'string' || !/^[a-z0-9-]+$/.test(district)) throw new ForecastShapeError('weather.district', 'must be a district id');
  if (typeof issuedDate !== 'string' || !DATE.test(issuedDate)) throw new ForecastShapeError('weather.issuedDate', 'must be an ISO date');
  if (typeof source !== 'string' || source.length === 0 || source.length > 200) throw new ForecastShapeError('weather.source', 'must name where it came from');
  if (!Array.isArray(days) || days.length === 0) throw new ForecastShapeError('weather.days', 'must be a non-empty list');
  return {
    district,
    issuedDate,
    source,
    days: days.map((value, i): DailyWeather => {
      const path = `weather.days[${i}]`;
      const day = value as Record<string, unknown>;
      if (typeof value !== 'object' || value === null) throw new ForecastShapeError(path, 'must be a day');
      const date = day['date'];
      const rainMm = day['rainMm'];
      const rainProbability = day['rainProbability'] ?? null;
      const humidityPct = day['humidityPct'] ?? null;
      if (typeof date !== 'string' || !DATE.test(date)) throw new ForecastShapeError(`${path}.date`, 'must be an ISO date');
      if (typeof rainMm !== 'number' || !Number.isFinite(rainMm) || rainMm < 0) throw new ForecastShapeError(`${path}.rainMm`, 'must be millimetres');
      if (rainProbability !== null && (typeof rainProbability !== 'number' || rainProbability < 0 || rainProbability > 1)) {
        throw new ForecastShapeError(`${path}.rainProbability`, 'must be between 0 and 1, or null');
      }
      if (humidityPct !== null && (typeof humidityPct !== 'number' || humidityPct < 0 || humidityPct > 100)) {
        throw new ForecastShapeError(`${path}.humidityPct`, 'must be a percentage, or null');
      }
      return { date, rainMm, rainProbability, humidityPct };
    }),
  };
}
