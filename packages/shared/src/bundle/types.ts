/**
 * The crop × district data bundle, schema version 3 (PROMPT §5.8).
 *
 * Everything in it is user-independent — the market, never the farmer (Constitution §4) — which
 * is what lets it be precomputed nightly and shipped as ~2 KB instead of served. Prices are ₹
 * per quintal. Validation and the integrity check live beside this file (P7); the pipeline
 * writes it, the device reads it, and `@fasal/shared` is the only code that interprets it.
 */
import type { CropId, DistrictId, GeoPoint, ISODate } from '../core/types.js';

export const BUNDLE_SCHEMA_VERSION = 3;

export type Direction = 'up' | 'flat' | 'down';
export type SeasonalPosition = 'above' | 'within' | 'below';
export type LayerId = 'RK-1' | 'RK-2' | 'RK-3' | 'RK-4' | 'RK-5' | 'RK-6';
export const SERVER_LAYERS: readonly LayerId[] = ['RK-1', 'RK-2', 'RK-3', 'RK-4', 'RK-5', 'RK-6'];

export interface TrendPoint {
  date: ISODate;
  /** District modal ₹/qtl, or null when the market did not trade that day. */
  modal: number | null;
  imputed?: boolean;
}

export interface HorizonForecast {
  /** Conformalised price quantiles at the horizon, ₹/qtl. */
  q10: number;
  q50: number;
  q90: number;
  /** RK-8 skill-weighted direction and its agreement share in [1/3, 1]. */
  direction: Direction;
  agreement: number;
  /** Out-of-fold skill vs the naive (persistence) baseline; > 0 means it beat it. */
  skill: number;
  /** Out-of-fold skill vs the seasonal-naive baseline. */
  skillSeasonal: number;
  /** Achieved conformal coverage of the q10–q90 band on the final fold. */
  coverage: number;
  /** Staleness widening rate per day. */
  bandKappa: number;
  /** The crop's own calibrated confidence threshold (GR-3), when validation produced one. */
  confidenceMin?: number;
}

export interface LayerReading {
  /** The layer's own reading, or null when it had nothing to say. */
  bucket: Direction | null;
  /** The layer's measured weight: max(0, skill). A zero-weight layer says nothing. */
  weight: number;
  /** The layer's value in its own units (e.g. arrivals log-ratio), for "Technical details". */
  value: number | null;
}

export interface StorageFacility {
  id: string;
  name: string;
  district: DistrictId;
  location: GeoPoint;
  capacityAvailableQtl: number;
  /** Crops accepted; empty means none. */
  crops: CropId[];
  /** ₹ per quintal per month. */
  ratePerQtlMonth: number;
  /** Expected loss fraction per month for each accepted crop in this facility. */
  spoilageFractionPerMonth: Record<CropId, number>;
  /** WDRA registration — required for an e-NWR. */
  wdraAccredited: boolean;
  eNwr: boolean;
  /** Annual interest on a loan pledged against this facility's e-NWR, when available. */
  pledgeRateAnnual: number | null;
}

export interface TransportTariff {
  id: string;
  vehicleClass: string;
  capacityKg: number;
  ratePerKm: number;
  minimumCharge: number;
  district: DistrictId;
}

export interface CropBundle {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  version: string;
  generatedAt: string;
  asOf: ISODate;
  district: DistrictId;
  crop: CropId;
  /** The market whose modal is the district benchmark. */
  market: string;
  benchmark: { modal: number; min: number; max: number; unit: 'quintal' };
  msp: { amountPerQuintal: number; season: string } | null;
  trend: TrendPoint[];
  /** This week's seasonal norm from earlier years (RK-2), or null when there is no earlier year to
   *  build it from — a missing season is said, never invented. */
  seasonal: { woyMedian: number; woyIQR: [number, number]; position: SeasonalPosition } | null;
  arrivalsRatio: number | null;
  forecast: { h7: HorizonForecast | null; h14: HorizonForecast | null } | null;
  raksha: { layers: Record<LayerId, LayerReading> };
  storage: StorageFacility[];
  transport: TransportTariff[];
  stalenessLimitDays: number;
  status: 'published' | 'insufficient';
  integrity: string;
}
