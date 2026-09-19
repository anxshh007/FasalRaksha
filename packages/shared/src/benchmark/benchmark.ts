/**
 * Benchmark before price (Constitution §12; FR-01, FR-07).
 *
 * Every screen where a number is named or accepted shows today's district rate, the MSP floor
 * and the seven-day movement. This is the one function that produces those figures, for the
 * home screen, the sell flow, the buyer card, the sauda slip and all three message channels.
 */
import type { CropBundle, SeasonalPosition, TrendPoint } from '../bundle/types.js';
import type { ISODate } from '../core/types.js';
import { ageDays, isAdviceSuppressed } from '../staleness/staleness.js';
import { normalisePrice, type ConversionFailure, type Money, type PriceContext } from '../units/units.js';

export interface MspFloor {
  price: Money;
  season: string;
}

export interface Comparison {
  /** Difference in ₹ per quintal: positive means above the benchmark. */
  delta: Money;
  position: 'above' | 'at' | 'below';
}

export interface Benchmark {
  crop: string;
  district: string;
  market: string;
  modal: Money;
  min: Money;
  max: Money;
  mspFloor: MspFloor | null;
  /** Modal minus MSP (₹/qtl), when an MSP exists. */
  vsMsp: Comparison | null;
  trend7: TrendPoint[];
  /** Change from the first to the last traded day of the window, when two exist. */
  trendChange: { amount: Money; fraction: number } | null;
  seasonalPosition: SeasonalPosition;
  asOf: ISODate;
  ageDays: number;
  /** Past the crop's limit: the figure is shown with its date, and no advice is attached. */
  adviceSuppressed: boolean;
}

const perQuintal = (amount: number): Money => ({ amount, unit: 'quintal' });

function compare(difference: number): Comparison {
  return { delta: perQuintal(difference), position: difference > 0 ? 'above' : difference < 0 ? 'below' : 'at' };
}

export function computeBenchmark(bundle: CropBundle, today: ISODate): Benchmark {
  const trend7 = bundle.trend.slice(-7);
  const traded = trend7.filter((point): point is TrendPoint & { modal: number } => point.modal !== null);
  const first = traded[0];
  const last = traded[traded.length - 1];
  const trendChange =
    first !== undefined && last !== undefined && first !== last
      ? { amount: perQuintal(last.modal - first.modal), fraction: (last.modal - first.modal) / first.modal }
      : null;

  const mspFloor = bundle.msp === null ? null : { price: perQuintal(bundle.msp.amountPerQuintal), season: bundle.msp.season };

  return {
    crop: bundle.crop,
    district: bundle.district,
    market: bundle.market,
    modal: perQuintal(bundle.benchmark.modal),
    min: perQuintal(bundle.benchmark.min),
    max: perQuintal(bundle.benchmark.max),
    mspFloor,
    vsMsp: mspFloor === null ? null : compare(bundle.benchmark.modal - mspFloor.price.amount),
    trend7,
    trendChange,
    seasonalPosition: bundle.seasonal.position,
    asOf: bundle.asOf,
    ageDays: ageDays(bundle.asOf, today),
    adviceSuppressed: isAdviceSuppressed(bundle.asOf, today, bundle.stalenessLimitDays),
  };
}

/**
 * How a price compares with today's district modal — "₹110 above today's Nashik rate". Any
 * price basis is accepted; it is normalised to ₹/qtl once, here.
 */
export function compareWithBenchmark(price: Money, benchmark: Benchmark, context: PriceContext = {}): { ok: true; value: Comparison } | { ok: false; reason: ConversionFailure } {
  const normalised = normalisePrice(price, 'quintal', context);
  if (!normalised.ok) return normalised;
  return { ok: true, value: compare(normalised.value.amount - benchmark.modal.amount) };
}
