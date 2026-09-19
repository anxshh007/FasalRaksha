/**
 * The evidence ledger (PROMPT §9.9-1): the nine RAKSHA layers in plain words, for "Why this
 * signal?". Pure, from the bundle and the on-device evaluation, so every row is testable.
 *
 *   RK-1…RK-6 come from the bundle: each server layer's own reading (up / flat / down) and its
 *             *measured* weight, max(0, out-of-fold skill). A layer with no weight has no say
 *             and is shown as such, not hidden.
 *   RK-7      is the farmer's own downside at the low end of the range, against the loss they
 *             said they can bear. Computed on the phone and never sent anywhere.
 *   RK-8      is how strongly the weighted layers agree.
 *   RK-9      is the seven checks, and how many pass.
 *
 * "Supporting" is relative to where the evidence as a whole leans (the RK-8 direction): an
 * arrivals reading that points up supports an upward lean even though arrivals are falling.
 */
import { SERVER_LAYERS, type CropBundle, type Direction, type LayerId, type WaitEvaluation } from '@fasal/shared';

export type LedgerId = LayerId | 'RK-7' | 'RK-8' | 'RK-9';
export type Stance = 'supporting' | 'against' | 'neutral' | 'silent';

export interface LayerRow {
  kind: 'layer';
  id: LayerId;
  direction: Direction | null;
  stance: Stance;
  /** The measured weight, 0…1. */
  weight: number;
  /** Weight relative to the heaviest layer, 0…1, for the hairline meter. */
  share: number;
  value: number | null;
}

export interface DownsideRow {
  kind: 'downside';
  id: 'RK-7';
  status: 'pass' | 'fail' | 'not-evaluated';
  /** Rupees the whole lot could lose at the low end of the range (positive = a loss). */
  lotLoss: number | null;
  /** Rupees the farmer said they can bear on this lot. */
  tolerable: number | null;
}

export interface AgreementRow {
  kind: 'agreement';
  id: 'RK-8';
  strength: 'weak' | 'moderate' | 'strong' | null;
  share: number | null;
}

export interface ChecksRow {
  kind: 'checks';
  id: 'RK-9';
  passed: number;
  failed: string[];
  notEvaluated: string[];
}

export type LedgerRow = LayerRow | DownsideRow | AgreementRow | ChecksRow;

export function stanceOf(reading: Direction | null, lean: Direction | null, weight: number): Stance {
  if (reading === null || weight <= 0 || lean === null) return 'silent';
  if (reading === lean) return 'supporting';
  if (reading === 'flat' || lean === 'flat') return 'neutral';
  return 'against';
}

export function evidenceLedger(bundle: CropBundle, evaluation: WaitEvaluation): LedgerRow[] {
  const forecast = bundle.forecast === null ? null : evaluation.horizon === 7 ? bundle.forecast.h7 : bundle.forecast.h14;
  const lean = evaluation.lean ?? forecast?.direction ?? null;
  const layers = bundle.raksha.layers;
  const heaviest = Math.max(0, ...SERVER_LAYERS.map((id) => layers[id].weight));

  const rows: LedgerRow[] = SERVER_LAYERS.map((id) => {
    const reading = layers[id];
    return {
      kind: 'layer',
      id,
      direction: reading.bucket,
      stance: bundle.status === 'published' ? stanceOf(reading.bucket, lean, reading.weight) : 'silent',
      weight: reading.weight,
      share: heaviest > 0 ? reading.weight / heaviest : 0,
      value: reading.value,
    };
  });

  const rk7 = evaluation.conditions.find((c) => c.id === 'RK-7');
  rows.push({
    kind: 'downside',
    id: 'RK-7',
    status: rk7?.status ?? 'not-evaluated',
    lotLoss: rk7?.measured === null || rk7?.measured === undefined ? null : Math.max(0, -rk7.measured),
    tolerable: rk7?.threshold === null || rk7?.threshold === undefined ? null : -rk7.threshold,
  });

  rows.push({
    kind: 'agreement',
    id: 'RK-8',
    strength: evaluation.evidenceStrength,
    share: forecast?.agreement ?? null,
  });

  const gates = evaluation.conditions.filter((c) => c.id.startsWith('GR-'));
  rows.push({
    kind: 'checks',
    id: 'RK-9',
    passed: gates.filter((c) => c.status === 'pass').length,
    failed: gates.filter((c) => c.status === 'fail').map((c) => c.id),
    notEvaluated: gates.filter((c) => c.status === 'not-evaluated').map((c) => c.id),
  });
  return rows;
}

/** Rupees shown to a farmer: whole rupees for today's rates, nearest ₹10 for anything ahead. */
export const roundAhead = (amount: number): number => Math.round(amount / 10) * 10;
