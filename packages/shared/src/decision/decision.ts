/**
 * RAKSHA-QAD on the device: RK-7 (risk asymmetry) and RK-9 (the seven-gate guardrail).
 *
 * These two layers run here, not on the server, by necessity: they are the only ones that take
 * the farmer's own lot size, storage access and cost of money, and those must never reach the
 * model (Constitution §4). Everything else arrives precomputed in the bundle.
 *
 * A wrong "wait" costs principal, storage and spoilage; a wrong "sell" costs only foregone
 * upside. So "wait" must clear every one of seven independently named conditions *and* the
 * cost-sensitive downside rule, and when it does not, the system says which condition failed —
 * in the farmer's terms. The refusal path is the product (Constitution §5).
 */
import type { CropBundle, Direction, HorizonForecast } from '../bundle/types.js';
import { AGREEMENT_MIN, CONFIDENCE_FLOOR, MAX_STORAGE_DISTANCE_KM, STRONG_AGREEMENT } from '../constants/policy.js';
import type { ISODate } from '../core/types.js';
import { ageDays, bandMultiplier, isAdviceSuppressed, widenBand, type QuantileBand } from '../staleness/staleness.js';
import type { Money } from '../units/units.js';
import { storageFit, type StorageChoice } from './storage.js';

export type GuardrailId = 'GR-1' | 'GR-2' | 'GR-3' | 'GR-4' | 'GR-5' | 'GR-6' | 'GR-7';
/** The seven gates plus RK-7's downside rule, which has its own refusal. */
export type ConditionId = GuardrailId | 'RK-7';
export const CONDITION_ORDER: readonly ConditionId[] = ['GR-1', 'GR-2', 'GR-3', 'GR-4', 'GR-5', 'GR-6', 'GR-7', 'RK-7'];

export type ConditionStatus = 'pass' | 'fail' | 'not-evaluated';

export interface ConditionResult {
  id: ConditionId;
  status: ConditionStatus;
  /** What was measured, in the condition's own units — shown under "Technical details". */
  measured: number | null;
  threshold: number | null;
}

export type Verdict = 'sell' | 'wait' | 'refuse';
export type Headline = 'SELL_NOW' | 'WAIT_MAY_BE_POSSIBLE' | 'NOT_ENOUGH_EVIDENCE_TO_WAIT';

export interface WaitInput {
  bundle: CropBundle;
  horizon: 7 | 14;
  quantityQtl: number;
  /** The farmer's reachable storage (see `findReachableStorage`), or null. */
  storage: StorageChoice | null;
  /** The farmer's own annual cost of money, used when no e-NWR pledge is available. */
  financeRateAnnual: number;
  /** τ_loss, default 0.02, farmer-adjustable. */
  tolerableLossFraction: number;
  today: ISODate;
}

export interface WaitEvaluation {
  verdict: Verdict;
  headline: Headline;
  /** Past the staleness limit: no recommendation of any kind is shown. */
  suppressed: boolean;
  conditions: ConditionResult[];
  failedConditions: ConditionId[];
  /** The first failed condition in canonical order — the sentence the refusal card leads with. */
  primaryRefusal: ConditionId | null;
  /** "Market is leaning upward" — the forecast's direction, when there is a usable forecast. */
  lean: Direction | null;
  evidenceStrength: 'weak' | 'moderate' | 'strong' | null;
  /** Staleness-widened band at the horizon (₹/qtl), or null. */
  band: QuantileBand | null;
  confidence: number | null;
  /** Per quintal, net of storage, spoilage and financing. Null when they cannot be costed. */
  expectedGain: Money | null;
  downside: Money | null;
  carry: Money | null;
  finance: { rateAnnual: number; source: 'e-nwr-pledge' | 'own-credit' } | null;
  horizon: 7 | 14;
  asOf: ISODate;
  ageDays: number;
}

const perQuintal = (amount: number): Money => ({ amount, unit: 'quintal' });

// ─── The eight named predicates. Each is tested on its own (GR-1…GR-7, RK-7). ───────────────

/** GR-1 · price data is fresh within this crop's staleness limit. */
export function gr1Fresh(bundle: CropBundle, today: ISODate): ConditionResult {
  const age = ageDays(bundle.asOf, today);
  return {
    id: 'GR-1',
    status: isAdviceSuppressed(bundle.asOf, today, bundle.stalenessLimitDays) ? 'fail' : 'pass',
    measured: age,
    threshold: bundle.stalenessLimitDays,
  };
}

/** GR-2 · the model beat both its naive and its seasonal-naive baseline for this crop. */
export function gr2BeatsBaseline(forecast: HorizonForecast | null): ConditionResult {
  if (forecast === null) return { id: 'GR-2', status: 'fail', measured: null, threshold: 0 };
  const weakest = Math.min(forecast.skill, forecast.skillSeasonal);
  return { id: 'GR-2', status: weakest > 0 ? 'pass' : 'fail', measured: weakest, threshold: 0 };
}

/** GR-3 · forecast confidence clears the higher of the policy floor and the crop's own threshold. */
export function gr3Confidence(forecast: HorizonForecast, band: QuantileBand, today: number): ConditionResult {
  const threshold = Math.max(CONFIDENCE_FLOOR.value, forecast.confidenceMin ?? 0);
  const width = band.q90 - band.q10;
  if (!(width > 0)) return { id: 'GR-3', status: 'fail', measured: null, threshold };
  const confidence = (band.q50 - today) / width;
  return { id: 'GR-3', status: confidence >= threshold ? 'pass' : 'fail', measured: confidence, threshold };
}

/** GR-4 · the signal layers agree strongly enough (RK-8 agreement share). */
export function gr4Agreement(forecast: HorizonForecast): ConditionResult {
  return {
    id: 'GR-4',
    status: forecast.agreement >= AGREEMENT_MIN.value ? 'pass' : 'fail',
    measured: forecast.agreement,
    threshold: AGREEMENT_MIN.value,
  };
}

/**
 * GR-5 · the season does not strongly contradict the signal. "Strongly" means both: the
 * seasonal layer (RK-2, with measured weight) reads the opposite way, *and* today's price already
 * sits beyond the seasonal band on the side that makes reversal likely.
 */
export function gr5Season(bundle: CropBundle, forecast: HorizonForecast): ConditionResult {
  const seasonal = bundle.raksha.layers['RK-2'];
  const position = bundle.seasonal.position;
  const counted = seasonal.weight > 0;
  const contradicts =
    counted &&
    ((forecast.direction === 'up' && seasonal.bucket === 'down' && position === 'above') ||
      (forecast.direction === 'down' && seasonal.bucket === 'up' && position === 'below'));
  return { id: 'GR-5', status: contradicts ? 'fail' : 'pass', measured: null, threshold: null };
}

export interface CarryCost {
  perQuintal: number;
  financeRateAnnual: number;
  financeSource: 'e-nwr-pledge' | 'own-credit';
}

/**
 * carry(h) = storage_rate · h/30 + spoilage_fraction(crop, h) · p0 + finance_rate · p0 · h/365,
 * with every input taken from *this* farmer's warehouse and credit — never a constant.
 */
export function carryCost(storage: StorageChoice, crop: string, p0: number, horizon: number, ownRateAnnual: number): CarryCost {
  const facility = storage.facility;
  const spoilagePerMonth = facility.spoilageFractionPerMonth[crop] ?? 0;
  const pledge = facility.eNwr && facility.pledgeRateAnnual !== null ? facility.pledgeRateAnnual : null;
  const financeRateAnnual = pledge ?? ownRateAnnual;
  const perQuintal =
    facility.ratePerQtlMonth * (horizon / 30) + spoilagePerMonth * (horizon / 30) * p0 + financeRateAnnual * p0 * (horizon / 365);
  return { perQuintal, financeRateAnnual, financeSource: pledge === null ? 'own-credit' : 'e-nwr-pledge' };
}

/** GR-6 · expected gain, net of storage, spoilage and financing, is positive: G = q50 − p0 − carry > 0. */
export function gr6NetGain(band: QuantileBand, p0: number, carry: number): ConditionResult {
  const gain = band.q50 - p0 - carry;
  return { id: 'GR-6', status: gain > 0 ? 'pass' : 'fail', measured: gain, threshold: 0 };
}

/** GR-7 · a real, named storage mechanism is within reach and can take this lot. */
export function gr7Storage(storage: StorageChoice | null, crop: string, quantityQtl: number): ConditionResult {
  if (storage === null) return { id: 'GR-7', status: 'fail', measured: null, threshold: MAX_STORAGE_DISTANCE_KM.value };
  const fit = storageFit(storage.facility, crop, quantityQtl, storage.roadKm);
  return { id: 'GR-7', status: fit === 'fits' ? 'pass' : 'fail', measured: storage.roadKm, threshold: MAX_STORAGE_DISTANCE_KM.value };
}

/**
 * RK-7 · the cost-sensitive downside rule: D · q > −L, where D = q10 − p0 − carry and
 * L = τ_loss · p0 · q. A bad outcome must not cost more than the farmer can afford to lose.
 */
export function rk7Downside(band: QuantileBand, p0: number, carry: number, quantityQtl: number, tolerableLossFraction: number): ConditionResult {
  const downsideLot = (band.q10 - p0 - carry) * quantityQtl;
  const tolerableLot = tolerableLossFraction * p0 * quantityQtl;
  return { id: 'RK-7', status: downsideLot > -tolerableLot ? 'pass' : 'fail', measured: downsideLot, threshold: -tolerableLot };
}

// ─── The evaluation ─────────────────────────────────────────────────────────────────────────

function strength(agreement: number): 'weak' | 'moderate' | 'strong' {
  if (agreement < AGREEMENT_MIN.value) return 'weak';
  return agreement >= STRONG_AGREEMENT.value ? 'strong' : 'moderate';
}

const notEvaluated = (id: ConditionId): ConditionResult => ({ id, status: 'not-evaluated', measured: null, threshold: null });

export function evaluateWait(input: WaitInput): WaitEvaluation {
  const { bundle, horizon, quantityQtl, storage, today } = input;
  if (!(quantityQtl > 0)) throw new RangeError('The lot size must be a positive number of quintals.');
  if (!(input.tolerableLossFraction >= 0 && input.tolerableLossFraction < 1)) throw new RangeError('τ_loss must be in [0, 1).');

  const p0 = bundle.benchmark.modal;
  const age = ageDays(bundle.asOf, today);
  const forecast = bundle.status === 'published' && bundle.forecast !== null ? (horizon === 7 ? bundle.forecast.h7 : bundle.forecast.h14) : null;
  const band = forecast === null ? null : widenBand(forecast, bandMultiplier(age, forecast.bandKappa));
  const carry = storage === null ? null : carryCost(storage, bundle.crop, p0, horizon, input.financeRateAnnual);

  const gr1 = gr1Fresh(bundle, today);
  const gr2 = gr2BeatsBaseline(forecast);
  const gr7 = gr7Storage(storage, bundle.crop, quantityQtl);
  const conditions: ConditionResult[] =
    forecast === null || band === null
      ? [gr1, gr2, notEvaluated('GR-3'), notEvaluated('GR-4'), notEvaluated('GR-5'), notEvaluated('GR-6'), gr7, notEvaluated('RK-7')]
      : [
          gr1,
          gr2,
          gr3Confidence(forecast, band, p0),
          gr4Agreement(forecast),
          gr5Season(bundle, forecast),
          carry === null ? notEvaluated('GR-6') : gr6NetGain(band, p0, carry.perQuintal),
          gr7,
          carry === null ? notEvaluated('RK-7') : rk7Downside(band, p0, carry.perQuintal, quantityQtl, input.tolerableLossFraction),
        ];

  const failedConditions = conditions.filter((c) => c.status === 'fail').map((c) => c.id);
  const allPass = conditions.every((c) => c.status === 'pass');
  const suppressed = gr1.status === 'fail';
  const agreementOk = conditions.find((c) => c.id === 'GR-4')?.status === 'pass';

  let verdict: Verdict;
  if (suppressed || gr2.status === 'fail') verdict = 'refuse';
  else if (allPass) verdict = 'wait';
  else if (forecast !== null && forecast.direction !== 'up' && agreementOk) verdict = 'sell';
  else verdict = 'refuse';

  const headline: Headline = verdict === 'wait' ? 'WAIT_MAY_BE_POSSIBLE' : verdict === 'sell' ? 'SELL_NOW' : 'NOT_ENOUGH_EVIDENCE_TO_WAIT';
  const usable = !suppressed && forecast !== null && gr2.status === 'pass';

  return {
    verdict,
    headline,
    suppressed,
    conditions,
    failedConditions,
    primaryRefusal: verdict === 'refuse' ? (CONDITION_ORDER.find((id) => failedConditions.includes(id)) ?? null) : null,
    lean: usable ? forecast.direction : null,
    evidenceStrength: usable ? strength(forecast.agreement) : null,
    band: usable ? band : null,
    confidence: usable ? ((conditions.find((c) => c.id === 'GR-3')?.measured as number | null) ?? null) : null,
    expectedGain: band !== null && carry !== null && usable ? perQuintal(band.q50 - p0 - carry.perQuintal) : null,
    downside: band !== null && carry !== null && usable ? perQuintal(band.q10 - p0 - carry.perQuintal) : null,
    carry: carry === null ? null : perQuintal(carry.perQuintal),
    finance: carry === null ? null : { rateAnnual: carry.financeRateAnnual, source: carry.financeSource },
    horizon,
    asOf: bundle.asOf,
    ageDays: age,
  };
}
