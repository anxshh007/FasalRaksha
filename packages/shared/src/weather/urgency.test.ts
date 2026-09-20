/**
 * FR-13 · RK-4 · §XIII — weather as urgency, never as prediction.
 *
 * The engine turns a published forecast into one operational sentence, and refuses to produce one
 * when the forecast is too old to stand behind — the same rule staleness imposes on price advice.
 */
import { describe, expect, it } from 'vitest';

import { suggestedPickup, weatherUrgency, type DistrictForecast } from './urgency.js';

const onion = { moistureRelevant: true };
const cotton = { moistureRelevant: false };

const forecast = (issuedDate: string, days: Array<[string, number, number | null, number | null]>): DistrictForecast => ({
  district: 'nashik',
  issuedDate,
  days: days.map(([date, rainMm, rainProbability, humidityPct]) => ({ date, rainMm, rainProbability, humidityPct })),
  source: 'mock (seasonal pattern, not a forecast)',
});

const dry = (date: string): [string, number, number | null, number | null] => [date, 0, 0.05, 45];
const wet = (date: string): [string, number, number | null, number | null] => [date, 18, 0.8, 88];

describe('FR-13 · rain becomes an instruction only when it is soon and the crop cares', () => {
  it('names the day, the millimetres and the hours to act on a moisture-sensitive lot', () => {
    const answer = weatherUrgency(forecast('2026-09-20', [dry('2026-09-20'), dry('2026-09-21'), wet('2026-09-22')]), onion, '2026-09-20');
    expect(answer.level).toBe('move');
    expect(answer.reason).toBe('rain-soon');
    expect(answer.day).toBe('2026-09-22');
    expect(answer.rainMm).toBe(18);
    expect(answer.hoursToAct).toBe(48); // "within 48 hours", computed, not written into the copy
    expect(answer.source).toContain('mock'); // where it came from travels with it
  });

  it('the same week, for a crop that does not mind rain, is something to know rather than to do', () => {
    const answer = weatherUrgency(forecast('2026-09-20', [dry('2026-09-20'), wet('2026-09-21')]), cotton, '2026-09-20');
    expect(answer.level).toBe('watch');
    expect(answer.reason).toBe('rain-soon');
  });

  it('rain later in the week is a watch, not a lorry today', () => {
    const answer = weatherUrgency(forecast('2026-09-20', [dry('2026-09-20'), dry('2026-09-21'), dry('2026-09-22'), wet('2026-09-25')]), onion, '2026-09-20');
    expect(answer.level).toBe('watch');
    expect(answer.reason).toBe('rain-later');
    expect(answer.hoursToAct).toBe(120);
  });

  it('a dry but heavy week is a watch for a moisture-sensitive lot, and nothing for the rest', () => {
    const humid = forecast('2026-09-20', [[ '2026-09-20', 0, 0.1, 90 ], ['2026-09-21', 1, 0.2, 91]]);
    expect(weatherUrgency(humid, onion, '2026-09-20').reason).toBe('humid');
    expect(weatherUrgency(humid, onion, '2026-09-20').level).toBe('watch');
    expect(weatherUrgency(humid, cotton, '2026-09-20').level).toBe('none');
  });

  it('a clear week says so, and says nothing more', () => {
    const answer = weatherUrgency(forecast('2026-09-20', [dry('2026-09-20'), dry('2026-09-21')]), onion, '2026-09-20');
    expect(answer).toMatchObject({ level: 'none', reason: 'clear', day: null, hoursToAct: null });
  });
});

describe('FR-13 · a forecast too old to stand behind produces no urgency at all', () => {
  it('two days is the limit; three days says stale and stops', () => {
    const week = forecast('2026-09-18', [dry('2026-09-18'), wet('2026-09-20'), wet('2026-09-21')]);
    expect(weatherUrgency(week, onion, '2026-09-20').level).toBe('move'); // two days old: still usable
    const older = weatherUrgency(week, onion, '2026-09-21');
    expect(older.level).toBe('none');
    expect(older.reason).toBe('stale-forecast');
    expect(older.forecastAgeDays).toBe(3);
  });

  it('no forecast at all is said plainly, not treated as a clear sky', () => {
    expect(weatherUrgency(null, onion, '2026-09-20')).toMatchObject({ level: 'none', reason: 'no-forecast', source: null });
  });
});

describe('FR-13 · the pickup a sauda slip suggests', () => {
  it('is the first day in the window the weather does not argue against', () => {
    const week = forecast('2026-09-20', [wet('2026-09-20'), wet('2026-09-21'), dry('2026-09-22'), dry('2026-09-23')]);
    expect(suggestedPickup(week, '2026-09-20', '2026-09-27', '2026-09-20')).toEqual({ date: '2026-09-22', weatherChecked: true });
  });

  it('never starts before today, even when the window opened last week', () => {
    const week = forecast('2026-09-20', [dry('2026-09-20'), dry('2026-09-21')]);
    expect(suggestedPickup(week, '2026-09-14', '2026-09-27', '2026-09-20').date).toBe('2026-09-20');
  });

  it('falls back to the first day of the window when the forecast is too old, and says so', () => {
    const old = forecast('2026-09-10', [dry('2026-09-10')]);
    expect(suggestedPickup(old, '2026-09-22', '2026-09-27', '2026-09-20')).toEqual({ date: '2026-09-22', weatherChecked: false });
    expect(suggestedPickup(null, '2026-09-22', '2026-09-27', '2026-09-20')).toEqual({ date: '2026-09-22', weatherChecked: false });
  });

  it('a week of rain end to end still suggests a day rather than refusing to name one', () => {
    const week = forecast('2026-09-20', [wet('2026-09-20'), wet('2026-09-21'), wet('2026-09-22')]);
    expect(suggestedPickup(week, '2026-09-20', '2026-09-22', '2026-09-20')).toEqual({ date: '2026-09-20', weatherChecked: true });
  });
});
