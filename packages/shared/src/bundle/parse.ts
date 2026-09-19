/**
 * Bundle parsing (PROMPT §8.5: parse at every boundary, never cast). The API runs this before it
 * seals and serves a bundle; the device runs it before a bundle reaches IndexedDB. It lives here,
 * dependency-free, so both sides refuse exactly the same documents.
 *
 * Strict: an unknown key is an error, not something to ignore. A new field means a new schema
 * version, and a document carrying fields this build does not understand is not one it can trust.
 * Parsing checks shape and the invariants a consumer relies on (q10 ≤ q50 ≤ q90, min ≤ modal ≤
 * max, an insufficient bundle carries no forecast). The integrity hash is checked separately by
 * `verifyIntegrity`, over the raw document, before parsing.
 */
import { isIsoDate } from '../core/dates.js';
import {
  BUNDLE_SCHEMA_VERSION,
  SERVER_LAYERS,
  type CropBundle,
  type Direction,
  type HorizonForecast,
  type LayerId,
  type LayerReading,
  type SeasonalPosition,
  type StorageFacility,
  type TransportTariff,
  type TrendPoint,
} from './types.js';

export class BundleShapeError extends Error {
  constructor(
    readonly path: string,
    problem: string,
  ) {
    super(`${path}: ${problem}`);
    this.name = 'BundleShapeError';
  }
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BundleShapeError(path, 'must be an object');
  const record = value as Json;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key) && !optional.includes(key)) throw new BundleShapeError(`${path}.${key}`, 'is not part of this schema');
  }
  for (const key of keys) if (!(key in record)) throw new BundleShapeError(`${path}.${key}`, 'is missing');
  return record;
}

function array(value: unknown, path: string, max = 500): unknown[] {
  if (!Array.isArray(value)) throw new BundleShapeError(path, 'must be an array');
  if (value.length > max) throw new BundleShapeError(path, `has more than ${max} items`);
  return value;
}

function string(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new BundleShapeError(path, 'must be a non-empty string');
  if (pattern !== undefined && !pattern.test(value)) throw new BundleShapeError(path, `must match ${String(pattern)}`);
  return value;
}

function isoDate(value: unknown, path: string): string {
  const text = string(value, path);
  if (!isIsoDate(text)) throw new BundleShapeError(path, 'must be a real calendar date (YYYY-MM-DD)');
  return text;
}

function number(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BundleShapeError(path, 'must be a finite number');
  if (value < min || value > max) throw new BundleShapeError(path, `must be within [${min}, ${max}]`);
  return value;
}

function nullableNumber(value: unknown, path: string, min = -Infinity, max = Infinity): number | null {
  return value === null ? null : number(value, path, min, max);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new BundleShapeError(path, 'must be true or false');
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) throw new BundleShapeError(path, `must be one of ${options.join(', ')}`);
  return value as T;
}

const DIRECTIONS: readonly Direction[] = ['up', 'flat', 'down'];
const POSITIONS: readonly SeasonalPosition[] = ['above', 'within', 'below'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function trendPoint(value: unknown, path: string): TrendPoint {
  const r = object(value, path, ['date', 'modal'], ['imputed']);
  const point: TrendPoint = { date: isoDate(r['date'], `${path}.date`), modal: nullableNumber(r['modal'], `${path}.modal`, Number.MIN_VALUE) };
  if ('imputed' in r) point.imputed = boolean(r['imputed'], `${path}.imputed`);
  return point;
}

function horizon(value: unknown, path: string): HorizonForecast | null {
  if (value === null) return null;
  const r = object(value, path, ['q10', 'q50', 'q90', 'direction', 'agreement', 'skill', 'skillSeasonal', 'coverage', 'bandKappa'], ['confidenceMin']);
  const q10 = number(r['q10'], `${path}.q10`, Number.MIN_VALUE);
  const q50 = number(r['q50'], `${path}.q50`, Number.MIN_VALUE);
  const q90 = number(r['q90'], `${path}.q90`, Number.MIN_VALUE);
  if (!(q10 <= q50 && q50 <= q90)) throw new BundleShapeError(path, 'quantiles must satisfy q10 ≤ q50 ≤ q90');
  const forecast: HorizonForecast = {
    q10,
    q50,
    q90,
    direction: oneOf(r['direction'], `${path}.direction`, DIRECTIONS),
    agreement: number(r['agreement'], `${path}.agreement`, 1 / 3 - 1e-9, 1),
    skill: number(r['skill'], `${path}.skill`, -Infinity, 1),
    skillSeasonal: number(r['skillSeasonal'], `${path}.skillSeasonal`, -Infinity, 1),
    coverage: number(r['coverage'], `${path}.coverage`, 0, 1),
    bandKappa: number(r['bandKappa'], `${path}.bandKappa`, 0, 1),
  };
  if ('confidenceMin' in r) forecast.confidenceMin = number(r['confidenceMin'], `${path}.confidenceMin`, 0, 1);
  return forecast;
}

function layer(value: unknown, path: string): LayerReading {
  const r = object(value, path, ['bucket', 'weight', 'value']);
  return {
    bucket: r['bucket'] === null ? null : oneOf(r['bucket'], `${path}.bucket`, DIRECTIONS),
    weight: number(r['weight'], `${path}.weight`, 0, 1),
    value: nullableNumber(r['value'], `${path}.value`),
  };
}

function facility(value: unknown, path: string): StorageFacility {
  const r = object(value, path, [
    'id', 'name', 'district', 'location', 'capacityAvailableQtl', 'crops', 'ratePerQtlMonth', 'spoilageFractionPerMonth', 'wdraAccredited', 'eNwr', 'pledgeRateAnnual',
  ]);
  const location = object(r['location'], `${path}.location`, ['lat', 'lon']);
  const spoilageIn = r['spoilageFractionPerMonth'];
  if (typeof spoilageIn !== 'object' || spoilageIn === null || Array.isArray(spoilageIn)) throw new BundleShapeError(`${path}.spoilageFractionPerMonth`, 'must be an object');
  const spoilageFractionPerMonth: Record<string, number> = {};
  for (const [crop, fraction] of Object.entries(spoilageIn)) {
    spoilageFractionPerMonth[string(crop, `${path}.spoilageFractionPerMonth`, SLUG)] = number(fraction, `${path}.spoilageFractionPerMonth.${crop}`, 0, 1);
  }
  return {
    id: string(r['id'], `${path}.id`),
    name: string(r['name'], `${path}.name`),
    district: string(r['district'], `${path}.district`, SLUG),
    location: { lat: number(location['lat'], `${path}.location.lat`, -90, 90), lon: number(location['lon'], `${path}.location.lon`, -180, 180) },
    capacityAvailableQtl: number(r['capacityAvailableQtl'], `${path}.capacityAvailableQtl`, 0),
    crops: array(r['crops'], `${path}.crops`, 50).map((c, i) => string(c, `${path}.crops[${i}]`, SLUG)),
    ratePerQtlMonth: number(r['ratePerQtlMonth'], `${path}.ratePerQtlMonth`, 0),
    spoilageFractionPerMonth,
    wdraAccredited: boolean(r['wdraAccredited'], `${path}.wdraAccredited`),
    eNwr: boolean(r['eNwr'], `${path}.eNwr`),
    pledgeRateAnnual: nullableNumber(r['pledgeRateAnnual'], `${path}.pledgeRateAnnual`, 0, 1),
  };
}

function tariff(value: unknown, path: string): TransportTariff {
  const r = object(value, path, ['id', 'vehicleClass', 'capacityKg', 'ratePerKm', 'minimumCharge', 'district']);
  return {
    id: string(r['id'], `${path}.id`),
    vehicleClass: string(r['vehicleClass'], `${path}.vehicleClass`),
    capacityKg: number(r['capacityKg'], `${path}.capacityKg`, Number.MIN_VALUE),
    ratePerKm: number(r['ratePerKm'], `${path}.ratePerKm`, Number.MIN_VALUE),
    minimumCharge: number(r['minimumCharge'], `${path}.minimumCharge`, 0),
    district: string(r['district'], `${path}.district`, SLUG),
  };
}

const BUNDLE_KEYS = [
  'schemaVersion', 'version', 'generatedAt', 'asOf', 'district', 'crop', 'market', 'benchmark', 'msp', 'trend', 'seasonal', 'arrivalsRatio',
  'forecast', 'raksha', 'storage', 'transport', 'stalenessLimitDays', 'status', 'integrity',
] as const;

/** Parse an untrusted document into a `CropBundle`, or throw `BundleShapeError` naming the path. */
export function parseCropBundle(input: unknown): CropBundle {
  const r = object(input, 'bundle', BUNDLE_KEYS);
  if (r['schemaVersion'] !== BUNDLE_SCHEMA_VERSION) throw new BundleShapeError('bundle.schemaVersion', `must be ${BUNDLE_SCHEMA_VERSION}`);

  const b = object(r['benchmark'], 'bundle.benchmark', ['modal', 'min', 'max', 'unit']);
  const benchmark = {
    modal: number(b['modal'], 'bundle.benchmark.modal', Number.MIN_VALUE),
    min: number(b['min'], 'bundle.benchmark.min', Number.MIN_VALUE),
    max: number(b['max'], 'bundle.benchmark.max', Number.MIN_VALUE),
    unit: oneOf(b['unit'], 'bundle.benchmark.unit', ['quintal'] as const),
  };
  if (!(benchmark.min <= benchmark.modal && benchmark.modal <= benchmark.max)) throw new BundleShapeError('bundle.benchmark', 'must satisfy min ≤ modal ≤ max');

  let msp: CropBundle['msp'] = null;
  if (r['msp'] !== null) {
    const m = object(r['msp'], 'bundle.msp', ['amountPerQuintal', 'season']);
    msp = { amountPerQuintal: number(m['amountPerQuintal'], 'bundle.msp.amountPerQuintal', Number.MIN_VALUE), season: string(m['season'], 'bundle.msp.season') };
  }

  let seasonal: CropBundle['seasonal'] = null;
  if (r['seasonal'] !== null) {
    const s = object(r['seasonal'], 'bundle.seasonal', ['woyMedian', 'woyIQR', 'position']);
    const iqr = array(s['woyIQR'], 'bundle.seasonal.woyIQR', 2);
    const low = number(iqr[0], 'bundle.seasonal.woyIQR[0]', Number.MIN_VALUE);
    const high = number(iqr[1], 'bundle.seasonal.woyIQR[1]', Number.MIN_VALUE);
    if (iqr.length !== 2 || low > high) throw new BundleShapeError('bundle.seasonal.woyIQR', 'must be [low, high] with low ≤ high');
    seasonal = { woyMedian: number(s['woyMedian'], 'bundle.seasonal.woyMedian', Number.MIN_VALUE), woyIQR: [low, high], position: oneOf(s['position'], 'bundle.seasonal.position', POSITIONS) };
  }

  let forecast: CropBundle['forecast'] = null;
  if (r['forecast'] !== null) {
    const f = object(r['forecast'], 'bundle.forecast', ['h7', 'h14']);
    forecast = { h7: horizon(f['h7'], 'bundle.forecast.h7'), h14: horizon(f['h14'], 'bundle.forecast.h14') };
  }

  const raksha = object(r['raksha'], 'bundle.raksha', ['layers']);
  const layersIn = object(raksha['layers'], 'bundle.raksha.layers', SERVER_LAYERS);
  const layers = {} as Record<LayerId, LayerReading>;
  for (const id of SERVER_LAYERS) layers[id] = layer(layersIn[id], `bundle.raksha.layers.${id}`);

  const stalenessLimitDays = number(r['stalenessLimitDays'], 'bundle.stalenessLimitDays', 1, 60);
  if (!Number.isInteger(stalenessLimitDays)) throw new BundleShapeError('bundle.stalenessLimitDays', 'must be a whole number of days');
  const status = oneOf(r['status'], 'bundle.status', ['published', 'insufficient'] as const);
  const hasForecast = forecast !== null && (forecast.h7 !== null || forecast.h14 !== null);
  if (status === 'published' && !hasForecast) throw new BundleShapeError('bundle.forecast', 'a published bundle must carry at least one horizon');
  if (status === 'insufficient' && forecast !== null) throw new BundleShapeError('bundle.forecast', 'an insufficient bundle is withheld: its forecast must be null');

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    version: string(r['version'], 'bundle.version', /^\d{4}-\d{2}-\d{2}\.\d+$/),
    generatedAt: string(r['generatedAt'], 'bundle.generatedAt', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    asOf: isoDate(r['asOf'], 'bundle.asOf'),
    district: string(r['district'], 'bundle.district', SLUG),
    crop: string(r['crop'], 'bundle.crop', SLUG),
    market: string(r['market'], 'bundle.market', SLUG),
    benchmark,
    msp,
    trend: array(r['trend'], 'bundle.trend', 31).map((p, i) => trendPoint(p, `bundle.trend[${i}]`)),
    seasonal,
    arrivalsRatio: nullableNumber(r['arrivalsRatio'], 'bundle.arrivalsRatio', 0),
    forecast,
    raksha: { layers },
    storage: array(r['storage'], 'bundle.storage', 100).map((s, i) => facility(s, `bundle.storage[${i}]`)),
    transport: array(r['transport'], 'bundle.transport', 100).map((t, i) => tariff(t, `bundle.transport[${i}]`)),
    stalenessLimitDays,
    status,
    integrity: string(r['integrity'], 'bundle.integrity', /^sha256-[0-9a-f]{64}$/),
  };
}
