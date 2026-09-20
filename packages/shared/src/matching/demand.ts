/**
 * The demand document the phone ranks buyers from (FR-09; Gate A, Gate F), parsed strictly.
 *
 * Served by `GET /api/demand/:district` as canonical JSON with an integrity field. The phone
 * verifies the hash first, then this parser checks every field before anything is ranked: a
 * document that is not exactly the expected shape is refused whole, and the phone keeps the
 * demand it already had. A price always carries its unit and a quantity its unit (P1-02,
 * P1-03); a lot price is not a buying price and is refused here as the database refuses it.
 */
import type { ISODate } from '../core/types.js';
import type { PriceUnit, QuantityUnit } from '../units/units.js';
import { RATING_DIMENSIONS, type BuyerProfile, type BuyerRequirement, type Grade, type PartyRating } from './types.js';

export class DemandShapeError extends Error {
  constructor(
    readonly path: string,
    problem: string,
  ) {
    super(`${path}: ${problem}`);
    this.name = 'DemandShapeError';
  }
}

export interface Demand {
  district: string;
  asOf: ISODate;
  integrity: string;
  requirements: BuyerRequirement[];
  buyers: BuyerProfile[];
}

const QUANTITY_UNITS: readonly QuantityUnit[] = ['kg', 'quintal', 'tonne', 'crate', 'bag'];
const BUYING_PRICE_UNITS: readonly PriceUnit[] = ['kg', 'quintal', 'tonne', 'crate'];
const GRADES: readonly Grade[] = ['A', 'B', 'C'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]+$/;

type Doc = Record<string, unknown>;
const isDoc = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);

function field<T>(doc: Doc, key: string, path: string, check: (v: unknown) => v is T, problem: string): T {
  const value = doc[key];
  if (!check(value)) throw new DemandShapeError(`${path}.${key}`, problem);
  return value;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';

function quantity(doc: Doc, key: string, path: string) {
  const q = field(doc, key, path, isDoc, 'must be a quantity');
  const value = field(q, 'value', `${path}.${key}`, positive, 'must be a positive number');
  const unit = field(q, 'unit', `${path}.${key}`, (v): v is QuantityUnit => QUANTITY_UNITS.includes(v as QuantityUnit), 'is not a quantity unit');
  return { value, unit };
}

function requirement(raw: unknown, path: string): BuyerRequirement {
  if (!isDoc(raw)) throw new DemandShapeError(path, 'must be an object');
  const price = field(raw, 'price', path, isDoc, 'must be a price with its unit');
  const location = field(raw, 'location', path, isDoc, 'must be a point');
  const lat = field(location, 'lat', `${path}.location`, (v): v is number => typeof v === 'number' && v >= -90 && v <= 90, 'must be a latitude');
  const lon = field(location, 'lon', `${path}.location`, (v): v is number => typeof v === 'number' && v >= -180 && v <= 180, 'must be a longitude');
  const gradeFloor = raw['gradeFloor'];
  if (gradeFloor !== null && !GRADES.includes(gradeFloor as Grade)) throw new DemandShapeError(`${path}.gradeFloor`, 'must be A, B, C or null');
  const variety = raw['variety'];
  if (variety !== undefined && !str(variety)) throw new DemandShapeError(`${path}.variety`, 'must be a name when present');
  const validFrom = field(raw, 'validFrom', path, date, 'must be an ISO date');
  const validUntil = field(raw, 'validUntil', path, date, 'must be an ISO date');
  if (validUntil < validFrom) throw new DemandShapeError(path, 'ends before it starts');
  return {
    id: field(raw, 'id', path, str, 'must be an id'),
    buyerId: field(raw, 'buyerId', path, str, 'must be an id'),
    crop: field(raw, 'crop', path, (v): v is string => typeof v === 'string' && SLUG.test(v), 'must be a crop id'),
    ...(variety === undefined ? {} : { variety: variety as string }),
    gradeFloor: gradeFloor as Grade | null,
    minQuantity: quantity(raw, 'minQuantity', path),
    maxQuantity: quantity(raw, 'maxQuantity', path),
    price: {
      amount: field(price, 'amount', `${path}.price`, positive, 'must be a positive amount'),
      unit: field(price, 'unit', `${path}.price`, (v): v is Exclude<PriceUnit, 'lot'> => BUYING_PRICE_UNITS.includes(v as PriceUnit), 'must be a unit a buyer can pay by'),
    },
    location: { lat, lon },
    district: field(raw, 'district', path, (v): v is string => typeof v === 'string' && SLUG.test(v), 'must be a district id'),
    radiusKm: field(raw, 'radiusKm', path, positive, 'must be a positive distance'),
    validFrom,
    validUntil,
  };
}

/** A rating is a count and, for each dimension anyone has rated, a number between 1 and 5. */
function rating(raw: unknown, path: string): PartyRating | null {
  if (raw === undefined || raw === null) return null;
  if (!isDoc(raw)) throw new DemandShapeError(path, 'must be a rating or null');
  const parsed: PartyRating = { count: field(raw, 'count', path, count, 'must be a count'), paymentTimeliness: null, weighmentFairness: null, pickupReliability: null, qualityAsDescribed: null, quantityAsDescribed: null, availability: null };
  for (const dimension of RATING_DIMENSIONS) {
    const value = raw[dimension];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !(value >= 1 && value <= 5)) throw new DemandShapeError(`${path}.${dimension}`, 'must be between 1 and 5');
    parsed[dimension] = value;
  }
  return parsed;
}

function buyer(raw: unknown, path: string): BuyerProfile {
  if (!isDoc(raw)) throw new DemandShapeError(path, 'must be an object');
  const history = field(raw, 'history', path, isDoc, 'must be a track record');
  const paymentDays = field(history, 'paymentDays', `${path}.history`, (v): v is number[] => Array.isArray(v) && v.every(count), 'must be whole days');
  const completedDeals = field(history, 'completedDeals', `${path}.history`, count, 'must be a count');
  if (paymentDays.length !== completedDeals) throw new DemandShapeError(`${path}.history`, 'needs one payment day per completed deal');
  return {
    id: field(raw, 'id', path, str, 'must be an id'),
    name: field(raw, 'name', path, str, 'must be a name'),
    place: field(raw, 'place', path, str, 'must be a place'),
    verified: field(raw, 'verified', path, bool, 'must be true or false'),
    demonstration: field(raw, 'demonstration', path, bool, 'must be true or false'),
    rating: rating(raw['rating'], `${path}.rating`),
    history: {
      completedDeals,
      paymentDays,
      defaults: field(history, 'defaults', `${path}.history`, count, 'must be a count'),
      defaultExposureDays: field(history, 'defaultExposureDays', `${path}.history`, count, 'must be a count'),
      openDisputes: field(history, 'openDisputes', `${path}.history`, count, 'must be a count'),
    },
  };
}

export function parseDemand(raw: unknown): Demand {
  if (!isDoc(raw)) throw new DemandShapeError('demand', 'must be an object');
  if (raw['kind'] !== 'demand') throw new DemandShapeError('demand.kind', 'must be "demand"');
  const requirements = field(raw, 'requirements', 'demand', Array.isArray, 'must be a list');
  const buyers = field(raw, 'buyers', 'demand', Array.isArray, 'must be a list');
  const parsedBuyers = buyers.map((b, i) => buyer(b, `demand.buyers[${i}]`));
  const known = new Set(parsedBuyers.map((b) => b.id));
  const parsedRequirements = requirements.map((r, i) => requirement(r, `demand.requirements[${i}]`));
  for (const [i, r] of parsedRequirements.entries()) {
    if (!known.has(r.buyerId)) throw new DemandShapeError(`demand.requirements[${i}].buyerId`, 'names no buyer in this document');
  }
  return {
    district: field(raw, 'district', 'demand', (v): v is string => typeof v === 'string' && SLUG.test(v), 'must be a district id'),
    asOf: field(raw, 'asOf', 'demand', date, 'must be an ISO date'),
    integrity: field(raw, 'integrity', 'demand', (v): v is string => typeof v === 'string' && /^sha256-[0-9a-f]{64}$/.test(v), 'must be an integrity hash'),
    requirements: parsedRequirements,
    buyers: parsedBuyers,
  };
}
