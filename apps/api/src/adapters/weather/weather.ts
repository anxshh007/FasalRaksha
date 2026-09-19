/**
 * WeatherAdapter (RK-4, PROMPT §4.5, §XIII). Weather is *consumed, never predicted*: this adapter
 * reads a published forecast; nothing in Fasal Raksha trains a weather model. The forecast feeds
 * operational urgency ("Rain expected Thursday in Nashik…"), pickup risk and listing expiry.
 *
 *   MockWeatherAdapter  — a deterministic, season-shaped district forecast (monsoon June–
 *                         September, dry winter, pre-monsoon showers in May); same inputs, same
 *                         forecast, labelled mock
 *   OpenMeteoWeatherAdapter — the public Open-Meteo forecast API (no credential needed)
 */
import { addDays, type DistrictId, type GeoPoint, type ISODate } from '@fasal/shared';

import { AdapterError, fetchJson, seededRandom, type Transport } from '../http.js';

export interface DailyWeather {
  date: ISODate;
  rainMm: number;
  /** 0–1, or null when the source does not publish it. */
  rainProbability: number | null;
  humidityPct: number | null;
}

export interface WeatherForecast {
  district: DistrictId;
  issuedDate: ISODate;
  days: DailyWeather[];
  source: string;
}

export interface WeatherAdapter {
  readonly mode: 'mock' | 'live';
  forecast(district: DistrictId, location: GeoPoint, issuedDate: ISODate, days?: number): Promise<WeatherForecast>;
}

/** Monthly rain chance and humidity band for Maharashtra's plateau districts, by calendar month. */
const SEASON: ReadonlyArray<{ rainChance: number; wetMm: number; humidity: readonly [number, number] }> = [
  { rainChance: 0.02, wetMm: 2, humidity: [40, 60] }, // Jan
  { rainChance: 0.02, wetMm: 2, humidity: [35, 55] },
  { rainChance: 0.04, wetMm: 3, humidity: [30, 45] },
  { rainChance: 0.06, wetMm: 4, humidity: [25, 40] },
  { rainChance: 0.12, wetMm: 6, humidity: [30, 50] }, // May: pre-monsoon showers
  { rainChance: 0.55, wetMm: 14, humidity: [65, 85] }, // Jun
  { rainChance: 0.7, wetMm: 18, humidity: [75, 92] },
  { rainChance: 0.65, wetMm: 15, humidity: [75, 92] },
  { rainChance: 0.5, wetMm: 12, humidity: [70, 88] }, // Sep
  { rainChance: 0.2, wetMm: 8, humidity: [55, 75] },
  { rainChance: 0.06, wetMm: 4, humidity: [45, 65] },
  { rainChance: 0.02, wetMm: 2, humidity: [40, 60] },
];

export class MockWeatherAdapter implements WeatherAdapter {
  readonly mode = 'mock' as const;

  async forecast(district: DistrictId, _location: GeoPoint, issuedDate: ISODate, days = 7): Promise<WeatherForecast> {
    const out: DailyWeather[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(issuedDate, i);
      const month = Number(date.slice(5, 7)) - 1;
      const season = SEASON[month] ?? SEASON[0];
      if (season === undefined) throw new Error('season table is empty');
      const rand = seededRandom(`${district}|${date}`);
      const chance = Math.min(0.95, season.rainChance * (0.6 + 0.8 * rand()));
      const wet = rand() < chance;
      const rainMm = wet ? Math.round(season.wetMm * -Math.log(1 - rand() * 0.95) * 10) / 10 : 0;
      const humidity = season.humidity[0] + (season.humidity[1] - season.humidity[0]) * rand();
      out.push({ date, rainMm, rainProbability: Math.round(chance * 100) / 100, humidityPct: Math.round(humidity) });
    }
    return { district, issuedDate, days: out, source: 'mock (seasonal pattern, not a forecast)' };
  }
}

export interface OpenMeteoConfig {
  baseUrl?: string;
  transport?: Transport;
}

/**
 * GET /v1/forecast?latitude&longitude&daily=precipitation_sum,precipitation_probability_max,
 * relative_humidity_2m_mean&timezone=Asia/Kolkata&start_date&end_date → `{ daily: { time: [...],
 * precipitation_sum: [...], precipitation_probability_max: [...], relative_humidity_2m_mean: [...] } }`.
 */
export class OpenMeteoWeatherAdapter implements WeatherAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: OpenMeteoConfig = {}) {
    this.transport = config.transport ?? fetch;
  }

  async forecast(district: DistrictId, location: GeoPoint, issuedDate: ISODate, days = 7): Promise<WeatherForecast> {
    const url = new URL(`${this.config.baseUrl ?? 'https://api.open-meteo.com'}/v1/forecast`);
    url.searchParams.set('latitude', location.lat.toFixed(4));
    url.searchParams.set('longitude', location.lon.toFixed(4));
    url.searchParams.set('daily', 'precipitation_sum,precipitation_probability_max,relative_humidity_2m_mean');
    url.searchParams.set('timezone', 'Asia/Kolkata');
    url.searchParams.set('start_date', issuedDate);
    url.searchParams.set('end_date', addDays(issuedDate, days - 1));
    const body = (await fetchJson(this.transport, { adapter: 'Open-Meteo', url: url.toString() })) as {
      daily?: { time?: unknown; precipitation_sum?: unknown; precipitation_probability_max?: unknown; relative_humidity_2m_mean?: unknown };
    };
    const daily = body.daily;
    const time = daily?.time;
    if (daily === undefined || !Array.isArray(time)) throw new AdapterError('Open-Meteo', 'bad-response', 'The forecast had no daily series.');
    const col = (values: unknown, i: number): number | null => {
      const v = Array.isArray(values) ? values[i] : null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const out: DailyWeather[] = time.map((date, i) => {
      const probability = col(daily.precipitation_probability_max, i);
      return {
        date: String(date),
        rainMm: Math.max(0, col(daily.precipitation_sum, i) ?? 0),
        rainProbability: probability === null ? null : probability / 100,
        humidityPct: col(daily.relative_humidity_2m_mean, i),
      };
    });
    return { district, issuedDate, days: out, source: 'Open-Meteo' };
  }
}
