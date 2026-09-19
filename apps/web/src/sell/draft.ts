/**
 * The parse-confirm card's model (PROMPT §6.1–§6.4, §9.9-3; Gate I). Pure: the parser's reading
 * of what the farmer said, overlaid with the farmer's own answers, resolves to a listing draft
 * only when nothing is left to ask.
 *
 *   The quantity is echoed in the farmer's own unit (P1-02).
 *   A price with no stated basis is never given one. The card asks with a single tap, and the
 *   draft is not ready until it is answered (P1-03, Gate I).
 *   The district is the verified one unless the message named a place (P1-04).
 *   A price that is wildly out of line with today's rate once normalised (the per-kilo-meant-
 *   per-quintal mistake) is flagged before it is listed.
 */
import {
  normalisePrice,
  resolvePriceUnit,
  type AmbiguousPrice,
  type Benchmark,
  type CropProfile,
  type ListingDraft,
  type Money,
  type ParsedListingIntent,
  type PriceUnit,
  type Quantity,
  type UnresolvedField,
} from '@fasal/shared';

export interface Answers {
  crop?: string;
  quantity?: Quantity;
  /** The basis the farmer tapped for an unmarked price. */
  priceUnit?: PriceUnit;
  /** A price typed into the card, with its unit (replaces anything parsed). */
  price?: Money | null;
}

export interface Resolved {
  crop: string | null;
  quantity: Quantity | null;
  price: Money | AmbiguousPrice | null;
  district: string;
  districtSource: 'message' | 'registry';
  /** What the card must still ask, in the order it asks. */
  questions: UnresolvedField[];
  ready: boolean;
}

export function resolve(parsed: ParsedListingIntent, answers: Answers, farmerDistrict: string): Resolved {
  const crop = answers.crop ?? parsed.crop ?? null;
  const quantity = answers.quantity ?? parsed.quantity ?? null;
  let price: Money | AmbiguousPrice | null = answers.price !== undefined ? answers.price : (parsed.price ?? null);
  if (price !== null && price.unit === null && answers.priceUnit !== undefined) {
    const ambiguous = price as AmbiguousPrice;
    price = ambiguous.candidates.includes(answers.priceUnit) ? resolvePriceUnit(ambiguous, answers.priceUnit) : { amount: ambiguous.amount, unit: answers.priceUnit };
  }
  const questions: UnresolvedField[] = [];
  if (crop === null) questions.push('crop');
  if (quantity === null) questions.push('quantity');
  if (price !== null && price.unit === null) questions.push('price-unit');
  return {
    crop,
    quantity,
    price,
    // A place named in the message wins for this listing only; otherwise the verified district.
    district: parsed.districtSource === 'message' ? parsed.district : farmerDistrict,
    districtSource: parsed.districtSource,
    questions,
    ready: questions.length === 0,
  };
}

export interface Plausibility {
  perQuintal: number;
  times: number;
}

/**
 * How far a stated price sits from today's district rate once expressed per quintal. Returns a
 * warning when it is more than 4× or less than a quarter of it: almost always a per-kilo price
 * meant per quintal, or the reverse. Null when it cannot be compared (no benchmark, a lot price).
 */
export function implausible(price: Money | AmbiguousPrice | null, benchmark: Benchmark | null, profile: CropProfile | null): Plausibility | null {
  if (price === null || price.unit === null || benchmark === null) return null;
  const context = { ...(profile?.crateKg === undefined ? {} : { crateKg: profile.crateKg }), ...(profile?.bagKg === undefined ? {} : { bagKg: profile.bagKg }) };
  const perQuintal = normalisePrice(price as Money, 'quintal', context);
  if (!perQuintal.ok) return null;
  const times = perQuintal.value.amount / benchmark.modal.amount;
  return times > 4 || times < 0.25 ? { perQuintal: perQuintal.value.amount, times } : null;
}

export function toListingDraft(
  resolved: Resolved,
  details: { clientId: string; availableFrom: string; availableUntil: string; poolOptIn: boolean; note: string },
): ListingDraft {
  if (!resolved.ready || resolved.crop === null || resolved.quantity === null) throw new Error('The draft still has questions to answer.');
  const price = resolved.price;
  if (price !== null && price.unit === null) throw new Error('A price without its basis cannot be listed.');
  const draft: ListingDraft = {
    clientId: details.clientId,
    crop: resolved.crop,
    quantity: resolved.quantity,
    askingPrice: price === null ? null : (price as Money),
    grade: null,
    gradeProvenance: null,
    availableFrom: details.availableFrom,
    availableUntil: details.availableUntil,
    poolOptIn: details.poolOptIn,
  };
  if (details.note.trim() !== '') draft.note = details.note.trim().slice(0, 500);
  return draft;
}
