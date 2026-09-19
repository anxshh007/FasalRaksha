/**
 * Quantities and money — the two-orders-of-magnitude boundary (PROMPT §6.2, §6.3).
 *
 * A number that means a price or a quantity never travels without its unit. The unit the
 * farmer actually used is preserved end to end (P1-02) and converted only at the point of
 * comparison, here, once. An unmarked price is represented with `unit: null` and cannot be
 * used in arithmetic until someone — the farmer, with a single tap — says what it was for
 * (P1-03).
 *
 * Crates and bags are real trade units (`tamatar 3 crate`) whose weight depends on the crop.
 * They convert only when the crop dictionary states a weight; otherwise the conversion fails
 * with a reason instead of guessing.
 */
import { fail, ok, type Result } from '../core/types.js';

export type QuantityUnit = 'kg' | 'quintal' | 'tonne' | 'crate' | 'bag';
/** Price bases. `lot` means "for the whole lot", not per anything. */
export type PriceUnit = 'kg' | 'quintal' | 'tonne' | 'crate' | 'lot';

export interface Quantity {
  value: number;
  unit: QuantityUnit;
}

/** Rupees per `unit` (or for the whole lot when `unit` is `lot`). Never a bare number. */
export interface Money {
  amount: number;
  unit: PriceUnit;
}

/** A price whose basis nobody has established. It cannot be converted or compared. */
export interface AmbiguousPrice {
  amount: number;
  unit: null;
  candidates: readonly PriceUnit[];
}

/** Crop-specific weights for count units, from the crop dictionary. */
export interface UnitWeights {
  crateKg?: number | undefined;
  bagKg?: number | undefined;
}

export type ConversionFailure = 'crate-weight-unknown' | 'bag-weight-unknown' | 'lot-size-unknown' | 'not-positive';

const FIXED_KG: Readonly<Record<'kg' | 'quintal' | 'tonne', number>> = { kg: 1, quintal: 100, tonne: 1000 };

export function isAmbiguous(price: Money | AmbiguousPrice): price is AmbiguousPrice {
  return price.unit === null;
}

/** Kilograms in one `unit`, or why it cannot be known. */
export function kgPerUnit(unit: QuantityUnit | Exclude<PriceUnit, 'lot'>, weights: UnitWeights = {}): Result<number, ConversionFailure> {
  if (unit === 'crate') return weights.crateKg !== undefined && weights.crateKg > 0 ? ok(weights.crateKg) : fail('crate-weight-unknown');
  if (unit === 'bag') return weights.bagKg !== undefined && weights.bagKg > 0 ? ok(weights.bagKg) : fail('bag-weight-unknown');
  return ok(FIXED_KG[unit]);
}

export function quantityToKg(quantity: Quantity, weights: UnitWeights = {}): Result<number, ConversionFailure> {
  const per = kgPerUnit(quantity.unit, weights);
  return per.ok ? ok(quantity.value * per.value) : per;
}

/** Express a quantity in another unit. The original is untouched; the farmer's unit is still theirs. */
export function convertQuantity(quantity: Quantity, to: QuantityUnit, weights: UnitWeights = {}): Result<Quantity, ConversionFailure> {
  if (quantity.unit === to) return ok({ ...quantity });
  const kg = quantityToKg(quantity, weights);
  if (!kg.ok) return kg;
  const per = kgPerUnit(to, weights);
  return per.ok ? ok({ value: kg.value / per.value, unit: to }) : per;
}

export interface PriceContext extends UnitWeights {
  /** The lot's size, required to turn a whole-lot price into a per-unit one and back. */
  lotKg?: number | undefined;
}

/** Rupees per kilogram — the one pivot through which every price conversion passes. */
export function pricePerKg(price: Money, context: PriceContext = {}): Result<number, ConversionFailure> {
  if (price.unit === 'lot') {
    if (context.lotKg === undefined) return fail('lot-size-unknown');
    if (context.lotKg <= 0) return fail('not-positive');
    return ok(price.amount / context.lotKg);
  }
  const per = kgPerUnit(price.unit, context);
  return per.ok ? ok(price.amount / per.value) : per;
}

/** Kilograms that one `unit` of price refers to (the whole lot for `lot`). */
function kgBasis(unit: PriceUnit, context: PriceContext): Result<number, ConversionFailure> {
  if (unit !== 'lot') return kgPerUnit(unit, context);
  if (context.lotKg === undefined) return fail('lot-size-unknown');
  return context.lotKg > 0 ? ok(context.lotKg) : fail('not-positive');
}

/**
 * Express a price on another basis (PROMPT §6: `normalisePrice`). Normalised once, centrally.
 * Computed as `amount × kg(to) / kg(from)` — multiplication first, so whole-rupee prices convert
 * exactly (₹18,400/t → ₹1,840/qtl with no floating-point residue).
 */
export function normalisePrice(price: Money, to: PriceUnit, context: PriceContext = {}): Result<Money, ConversionFailure> {
  if (price.unit === to) return ok({ ...price });
  const from = kgBasis(price.unit, context);
  if (!from.ok) return from;
  const target = kgBasis(to, context);
  if (!target.ok) return target;
  return ok({ amount: (price.amount * target.value) / from.value, unit: to });
}

/** The single-tap answer to "₹2,500 — was that per quintal, per kilo, or for the whole lot?". */
export function resolvePriceUnit(price: AmbiguousPrice, unit: PriceUnit): Money {
  if (!price.candidates.includes(unit)) {
    throw new RangeError(`"${unit}" was not one of the offered choices (${price.candidates.join(', ')}).`);
  }
  return { amount: price.amount, unit };
}

/** The value of a lot at a price: `price × quantity`, as a whole-lot amount. */
export function lotValue(price: Money, quantity: Quantity, weights: UnitWeights = {}): Result<Money, ConversionFailure> {
  const kg = quantityToKg(quantity, weights);
  if (!kg.ok) return kg;
  if (price.unit === 'lot') return ok({ ...price });
  const basis = kgPerUnit(price.unit, weights);
  return basis.ok ? ok({ amount: (price.amount * kg.value) / basis.value, unit: 'lot' }) : basis;
}
