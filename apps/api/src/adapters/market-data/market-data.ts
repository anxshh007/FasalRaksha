/**
 * MarketDataAdapter (FR-01, FR-04). Fetches daily mandi records *as the upstream publishes them*
 * — its own headers, its own date format, its own defects — for the nightly pipeline to land in
 * `data/raw/`. Header resolution, unit repair and every other cleaning step belong to the
 * pipeline (PROMPT §4), which is tolerant on input and strict on output; this adapter never
 * "fixes" a value on the way in, because a silent fix here would hide the defect from the
 * cleaner's counters.
 *
 *   MockMarketDataAdapter  — serves the Agmarknet- or MSAMB-shaped files in `data/raw/`
 *                            (the synthetic dataset, PROMPT §4.4 — labelled synthetic everywhere)
 *   AgmarknetMarketDataAdapter — the Open Government Data platform's daily mandi price resource
 */
import { readFile } from 'node:fs/promises';

import { dayNumber, type ISODate } from '@fasal/shared';

import { parseCsv } from '../csv.js';
import { AdapterError, fetchJson, type Transport } from '../http.js';

export interface MarketQuery {
  state: string;
  district?: string | undefined;
  commodity?: string | undefined;
  from: ISODate;
  to: ISODate;
}

/** A table exactly as published: its header row, and rows of raw strings. */
export interface MarketTable {
  source: 'agmarknet' | 'msamb';
  columns: string[];
  rows: string[][];
}

export interface MarketDataAdapter {
  readonly mode: 'mock' | 'live';
  fetchDaily(query: MarketQuery): Promise<MarketTable>;
}

/** Published dates are dd/mm/yyyy (Agmarknet) or yyyy-mm-dd; anything else is left to the cleaner. */
export function publishedDateToIso(value: string): ISODate | null {
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (dmy !== null) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function inRange(date: ISODate | null, query: MarketQuery): boolean {
  if (date === null) return true; // an unparseable date is a defect for the cleaner to count, not ours to drop
  try {
    const d = dayNumber(date);
    return d >= dayNumber(query.from) && d <= dayNumber(query.to);
  } catch {
    return true;
  }
}

const same = (a: string | undefined, b: string | undefined): boolean => a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface MockMarketFile {
  path: string;
  source: 'agmarknet' | 'msamb';
  /** The file's own column names for the three fields the mock filters on. */
  columns: { state?: string; district: string; commodity: string; date: string };
}

export class MockMarketDataAdapter implements MarketDataAdapter {
  readonly mode = 'mock' as const;

  constructor(private readonly file: MockMarketFile) {}

  async fetchDaily(query: MarketQuery): Promise<MarketTable> {
    let text: string;
    try {
      text = await readFile(this.file.path, 'utf8');
    } catch {
      throw new AdapterError('MockMarketDataAdapter', 'not-configured', `No market dataset at ${this.file.path}. Generate it with \`pnpm ml:generate\`.`);
    }
    const [header, ...body] = parseCsv(text);
    if (header === undefined) throw new AdapterError('MockMarketDataAdapter', 'bad-response', 'The market dataset is empty.');
    const at = (name: string | undefined): number => (name === undefined ? -1 : header.indexOf(name));
    const [iState, iDistrict, iCommodity, iDate] = [at(this.file.columns.state), at(this.file.columns.district), at(this.file.columns.commodity), at(this.file.columns.date)];
    const rows = body.filter(
      (row) =>
        (iState < 0 || same(row[iState], query.state)) &&
        (query.district === undefined || same(row[iDistrict], query.district)) &&
        (query.commodity === undefined || same(row[iCommodity], query.commodity)) &&
        inRange(publishedDateToIso(row[iDate] ?? ''), query),
    );
    return { source: this.file.source, columns: header, rows };
  }
}

export interface AgmarknetConfig {
  apiKey: string;
  /** OGD resource id of the "current daily price of various commodities from various markets" dataset. */
  resourceId: string;
  baseUrl?: string;
  transport?: Transport;
  pageSize?: number;
}

/**
 * The OGD platform returns `{ total, count, records: [{ state, district, market, commodity,
 * variety, grade, arrival_date, min_price, max_price, modal_price, … }] }` — field names vary
 * between resources and versions (`Min_x0020_Price` in older exports), which is exactly why the
 * pipeline resolves headers through a synonym table instead of trusting these.
 */
export class AgmarknetMarketDataAdapter implements MarketDataAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: AgmarknetConfig) {
    this.transport = config.transport ?? fetch;
  }

  async fetchDaily(query: MarketQuery): Promise<MarketTable> {
    const pageSize = this.config.pageSize ?? 500;
    const records: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < 50_000; offset += pageSize) {
      const url = new URL(`${this.config.baseUrl ?? 'https://api.data.gov.in'}/resource/${this.config.resourceId}`);
      url.searchParams.set('api-key', this.config.apiKey);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('filters[state.keyword]', query.state);
      if (query.district !== undefined) url.searchParams.set('filters[district]', query.district);
      if (query.commodity !== undefined) url.searchParams.set('filters[commodity]', query.commodity);
      const body = await fetchJson(this.transport, { adapter: 'Agmarknet (data.gov.in)', url: url.toString(), timeoutMs: 15_000 });
      const page = (body as { records?: unknown }).records;
      if (!Array.isArray(page)) throw new AdapterError('Agmarknet (data.gov.in)', 'bad-response', 'The market feed did not include a records list.');
      records.push(...(page as Array<Record<string, unknown>>));
      if (page.length < pageSize) break;
    }
    const columns = records[0] === undefined ? [] : Object.keys(records[0]);
    const dateColumn = columns.find((c) => /arrival.?date|price.?date|date/i.test(c));
    const rows = records
      .map((record) => columns.map((c) => (record[c] === null || record[c] === undefined ? '' : String(record[c]))))
      .filter((row) => dateColumn === undefined || inRange(publishedDateToIso(row[columns.indexOf(dateColumn)] ?? ''), query));
    return { source: 'agmarknet', columns, rows };
  }
}
