/**
 * ARCH-06 · FR-01 · FR-04 · RK-4 — MarketDataAdapter and WeatherAdapter: one contract, run against
 * the Mock and against the Live adapter replaying the upstream's real response shape.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterError } from '../../src/adapters/http.js';
import { AgmarknetMarketDataAdapter, MockMarketDataAdapter, publishedDateToIso, type MarketDataAdapter, type MarketTable } from '../../src/adapters/market-data/market-data.js';
import { MockWeatherAdapter, OpenMeteoWeatherAdapter, type WeatherAdapter } from '../../src/adapters/weather/weather.js';
import { recorded } from './support/recorded.js';

const SAMPLE = resolve(import.meta.dirname, 'fixtures/agmarknet_sample.csv');

const AGMARKNET_RECORDS = [
  { state: 'Maharashtra', district: 'Nashik', market: 'Lasalgaon', commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: '03/09/2026', min_price: '1480', max_price: '2080', modal_price: '1825' },
  { state: 'Maharashtra', district: 'Nashik', market: 'Lasalgaon', commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: '04/09/2026', min_price: '1500', max_price: '2100', modal_price: '1840' },
  { state: 'Maharashtra', district: 'Nashik', market: 'Pimpalgaon Baswant', commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: '04/09/2026', min_price: '15.2', max_price: '21.4', modal_price: '18.4' },
  { state: 'Maharashtra', district: 'Nashik', market: 'Lasalgaon', commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: '28/08/2026', min_price: '1400', max_price: '1950', modal_price: '1760' },
];

function agmarknetFeed(pageSize = 500) {
  return recorded([
    {
      when: (c) => c.url.pathname.startsWith('/resource/'),
      json: (c) => {
        const district = c.url.searchParams.get('filters[district]');
        const commodity = c.url.searchParams.get('filters[commodity]');
        const offset = Number(c.url.searchParams.get('offset'));
        const matching = AGMARKNET_RECORDS.filter((r) => (!district || r.district === district) && (!commodity || r.commodity === commodity));
        const page = matching.slice(offset, offset + pageSize);
        return { index_name: '9ef84268', title: 'Current Daily Price of Various Commodities from Various Markets (Mandi)', total: matching.length, count: page.length, records: page };
      },
    },
  ]);
}

const markets: Array<[string, () => MarketDataAdapter]> = [
  ['mock', () => new MockMarketDataAdapter({ path: SAMPLE, source: 'agmarknet', columns: { state: 'State', district: 'District', commodity: 'Commodity', date: 'Arrival_Date' } })],
  ['live', () => new AgmarknetMarketDataAdapter({ apiKey: 'test-key', resourceId: '9ef84268-d588-465a-a308-a864a43d0070', transport: agmarknetFeed().transport })],
];

const colIndex = (table: MarketTable, pattern: RegExp): number => table.columns.findIndex((c) => pattern.test(c));

describe.each(markets)('ARCH-06 · FR-01 · MarketDataAdapter contract (%s)', (_mode, make) => {
  const query = { state: 'Maharashtra', district: 'Nashik', commodity: 'Onion', from: '2026-09-01', to: '2026-09-05' };

  it('returns the table as published: a date column, a modal price column, rectangular rows', async () => {
    const table = await make().fetchDaily(query);
    expect(colIndex(table, /arrival.?date/i)).toBeGreaterThanOrEqual(0);
    expect(colIndex(table, /modal/i)).toBeGreaterThanOrEqual(0);
    expect(table.rows.length).toBeGreaterThan(0);
    for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
  });

  it('honours the district, commodity and date filters', async () => {
    const table = await make().fetchDaily(query);
    const d = colIndex(table, /^district$/i);
    const c = colIndex(table, /^commodity$/i);
    const t = colIndex(table, /arrival.?date/i);
    for (const row of table.rows) {
      expect(row[d]).toBe('Nashik');
      expect(row[c]).toBe('Onion');
      const iso = publishedDateToIso(row[t] ?? '');
      expect(iso !== null && iso >= '2026-09-01' && iso <= '2026-09-05').toBe(true);
    }
    expect(table.rows).toHaveLength(3);
  });

  it('passes defects through untouched — a per-kilo row quoted as 18.4 is the cleaner’s to find (FR-04)', async () => {
    const table = await make().fetchDaily(query);
    const m = colIndex(table, /modal/i);
    expect(table.rows.map((r) => r[m])).toContain('18.4');
  });
});

describe('ARCH-06 · MarketDataAdapter, live-only behaviour', () => {
  it('sends the API key and the filters the OGD platform expects, and pages through results', async () => {
    const feed = agmarknetFeed(2);
    const adapter = new AgmarknetMarketDataAdapter({ apiKey: 'test-key', resourceId: 'res-1', transport: feed.transport, pageSize: 2 });
    const table = await adapter.fetchDaily({ state: 'Maharashtra', district: 'Nashik', commodity: 'Onion', from: '2026-08-01', to: '2026-09-30' });
    expect(table.rows).toHaveLength(4);
    expect(feed.calls).toHaveLength(3);
    const first = feed.calls[0]?.url;
    expect(first?.pathname).toBe('/resource/res-1');
    expect(first?.searchParams.get('api-key')).toBe('test-key');
    expect(first?.searchParams.get('filters[state.keyword]')).toBe('Maharashtra');
  });

  it('turns an upstream failure into a domain explanation', async () => {
    const down = recorded([{ when: () => true, status: 503, json: { error: 'maintenance' } }]);
    const adapter = new AgmarknetMarketDataAdapter({ apiKey: 'k', resourceId: 'r', transport: down.transport });
    await expect(adapter.fetchDaily({ state: 'Maharashtra', from: '2026-09-01', to: '2026-09-02' })).rejects.toMatchObject({ problem: 'upstream-unavailable' });
  });

  it('refuses a response with no records list', async () => {
    const odd = recorded([{ when: () => true, json: { message: 'Invalid key' } }]);
    await expect(new AgmarknetMarketDataAdapter({ apiKey: 'k', resourceId: 'r', transport: odd.transport }).fetchDaily({ state: 'Maharashtra', from: '2026-09-01', to: '2026-09-02' })).rejects.toBeInstanceOf(AdapterError);
  });

  it('the mock says plainly when no dataset has been generated', async () => {
    const adapter = new MockMarketDataAdapter({ path: resolve(import.meta.dirname, 'fixtures/missing.csv'), source: 'agmarknet', columns: { district: 'District', commodity: 'Commodity', date: 'Arrival_Date' } });
    await expect(adapter.fetchDaily({ state: 'Maharashtra', from: '2026-09-01', to: '2026-09-02' })).rejects.toMatchObject({ problem: 'not-configured' });
  });
});

function openMeteo() {
  return recorded([
    {
      when: (c) => c.url.pathname === '/v1/forecast',
      json: (c) => {
        const start = c.url.searchParams.get('start_date') ?? '';
        const time = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
        return {
          latitude: 20.0,
          longitude: 73.8,
          timezone: 'Asia/Kolkata',
          daily_units: { time: 'iso8601', precipitation_sum: 'mm', precipitation_probability_max: '%', relative_humidity_2m_mean: '%' },
          daily: {
            time,
            precipitation_sum: [0, 0, 12.4, 3.1, 0, 0, 0.2],
            precipitation_probability_max: [10, 25, 80, 60, 15, 5, 20],
            relative_humidity_2m_mean: [71, 74, 88, 85, 70, 66, 69],
          },
        };
      },
    },
  ]);
}

const weathers: Array<[string, () => WeatherAdapter]> = [
  ['mock', () => new MockWeatherAdapter()],
  ['live', () => new OpenMeteoWeatherAdapter({ transport: openMeteo().transport })],
];

describe.each(weathers)('ARCH-06 · RK-4 · WeatherAdapter contract (%s)', (_mode, make) => {
  const nashik = { lat: 19.9975, lon: 73.7898 };

  it('returns seven consecutive days starting on the issue date', async () => {
    const f = await make().forecast('nashik', nashik, '2026-09-06');
    expect(f.days.map((d) => d.date)).toEqual(['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']);
    expect(f.district).toBe('nashik');
    expect(f.source.length).toBeGreaterThan(0);
  });

  it('keeps every value physical: rain ≥ 0, probability in [0, 1], humidity in [0, 100]', async () => {
    const f = await make().forecast('nashik', nashik, '2026-09-06');
    for (const d of f.days) {
      expect(d.rainMm).toBeGreaterThanOrEqual(0);
      if (d.rainProbability !== null) expect(d.rainProbability >= 0 && d.rainProbability <= 1).toBe(true);
      if (d.humidityPct !== null) expect(d.humidityPct >= 0 && d.humidityPct <= 100).toBe(true);
    }
  });

  it('is repeatable: the same request gives the same forecast', async () => {
    expect(await make().forecast('nashik', nashik, '2026-09-06')).toEqual(await make().forecast('nashik', nashik, '2026-09-06'));
  });
});

describe('ARCH-06 · WeatherAdapter, specific behaviour', () => {
  it('live asks Open-Meteo for the district’s coordinates, in Indian time', async () => {
    const feed = openMeteo();
    await new OpenMeteoWeatherAdapter({ transport: feed.transport }).forecast('nashik', { lat: 19.9975, lon: 73.7898 }, '2026-09-06');
    const url = feed.calls[0]?.url;
    expect(url?.searchParams.get('latitude')).toBe('19.9975');
    expect(url?.searchParams.get('timezone')).toBe('Asia/Kolkata');
    expect(url?.searchParams.get('end_date')).toBe('2026-09-12');
  });

  it('live refuses a response with no daily series', async () => {
    const odd = recorded([{ when: () => true, json: { error: true, reason: 'bad coordinates' } }]);
    await expect(new OpenMeteoWeatherAdapter({ transport: odd.transport }).forecast('nashik', { lat: 0, lon: 0 }, '2026-09-06')).rejects.toMatchObject({ problem: 'bad-response' });
  });

  it('the mock follows the season: July is wetter than January', async () => {
    const m = new MockWeatherAdapter();
    const rainyDays = async (start: string) => (await m.forecast('nashik', { lat: 20, lon: 74 }, start, 28)).days.filter((d) => d.rainMm > 0).length;
    expect(await rainyDays('2026-07-01')).toBeGreaterThan(await rainyDays('2026-01-01'));
  });
});
