/**
 * Understanding the farmer's own words (PROMPT §6.1–§6.4; P1-02, P1-03, P1-04).
 *
 * A deterministic rule cascade over the shipped crop dictionary and district registry. It runs
 * entirely on the device, offline, instantly, and identically every time — which matters most for
 * voice, because Marathi and Hindi speech recognition returns Devanagari.
 *
 * Three correctness boundaries, each a Phase-1 bug:
 *
 *  - the stated unit is kept: "5 क्विंटल" is `{ value: 5, unit: 'quintal' }`, never 500 kg (P1-02);
 *  - an unmarked price is never given a unit: "kanda 20 quintal 1840" yields
 *    `{ amount: 1840, unit: null }`, and the farmer is asked with a single tap (P1-03);
 *  - with no place in the message, the district is the farmer's verified registry district —
 *    there is no constant fallback anywhere (P1-04).
 *
 * Anything the cascade cannot resolve is returned in `unresolved` for the parse-confirm card to
 * ask about. A server-side model fallback exists only for what this cannot resolve, never first
 * (Constitution §14).
 */
import type { CropId, DistrictId, Locale } from '../core/types.js';
import type { CropDictionary, DistrictRegistry } from '../crops/types.js';
import { findCrop } from '../crops/types.js';
import { kgPerUnit, type AmbiguousPrice, type Money, type PriceUnit, type Quantity, type QuantityUnit } from '../units/units.js';
import {
  CASE_SUFFIXES,
  CURRENCY_WORDS,
  ENQUIRE_WORDS,
  foldKey,
  LOT_WORDS,
  MULTIPLIERS,
  normaliseText,
  numberWords,
  PER_SUFFIXES,
  PER_WORDS,
  SELL_WORDS,
  tokenize,
  UNIT_WORDS,
} from './lexicon.js';

export type UnresolvedField = 'crop' | 'quantity' | 'price-unit' | 'quantity-weight';

export interface ParseContext {
  /** The farmer's verified district from their registry record. Required: there is no default. */
  farmerDistrict: DistrictId;
  dictionary: CropDictionary;
  districts: DistrictRegistry;
}

export interface ParsedListingIntent {
  crop?: CropId;
  quantity?: Quantity;
  price?: Money | AmbiguousPrice;
  intent: 'sell' | 'enquire';
  district: DistrictId;
  districtSource: 'message' | 'registry';
  /** When the place named was a market, which one. */
  market?: string;
  unresolved: UnresolvedField[];
  /** Notes on things seen but set aside (a second quantity, unclear numbers) — for the trace. */
  notes: string[];
}

/** Precomputed lookup tables. Build once per dictionary version and reuse. */
export interface Lexicon {
  crops: Map<string, CropId>;
  places: Map<string, { district: DistrictId; market?: string }>;
  dictionary: CropDictionary;
  registry: DistrictRegistry;
}

export function buildLexicon(dictionary: CropDictionary, registry: DistrictRegistry): Lexicon {
  const crops = new Map<string, CropId>();
  for (const crop of dictionary.crops) {
    for (const word of [...crop.synonyms, crop.names.en, crop.names.mr, crop.names.hi]) crops.set(foldKey(word), crop.id);
  }
  const places = new Map<string, { district: DistrictId; market?: string }>();
  for (const district of registry.districts) {
    for (const word of [...district.synonyms, district.names.en, district.names.mr, district.names.hi]) {
      places.set(foldKey(word), { district: district.id });
    }
    for (const market of district.markets) {
      for (const word of market.synonyms) places.set(foldKey(word), { district: district.id, market: market.id });
    }
  }
  return { crops, places, dictionary, registry };
}

interface Tok {
  raw: string;
  key: string;
}

/** Look a token up directly, then with one Marathi/Hindi case ending removed. */
function lookup<T>(table: ReadonlyMap<string, T>, key: string): { value: T; suffix: string } | null {
  const direct = table.get(key);
  if (direct !== undefined) return { value: direct, suffix: '' };
  for (const suffix of CASE_SUFFIXES) {
    if (key.length > suffix.length + 1 && key.endsWith(suffix)) {
      const stem = table.get(key.slice(0, -suffix.length));
      if (stem !== undefined) return { value: stem, suffix };
    }
  }
  return null;
}

/** Earliest match in the message, trying two-word phrases before single words. */
function findPhrase<T>(tokens: readonly Tok[], table: ReadonlyMap<string, T>, skip: ReadonlySet<number>): { value: T; start: number; end: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    if (skip.has(i)) continue;
    const next = tokens[i + 1];
    if (next !== undefined && !skip.has(i + 1)) {
      const pair = lookup(table, `${tokens[i]?.key ?? ''} ${next.key}`);
      if (pair !== null) return { value: pair.value, start: i, end: i + 1 };
    }
    const single = lookup(table, tokens[i]?.key ?? '');
    if (single !== null) return { value: single.value, start: i, end: i };
  }
  return null;
}

/** A unit word, possibly carrying a "per" ending (क्विंटलला = per quintal). */
function unitOf(tok: Tok | undefined): { unit: QuantityUnit; per: boolean } | null {
  if (tok === undefined) return null;
  const direct = UNIT_WORDS.get(tok.key);
  if (direct !== undefined) return { unit: direct, per: false };
  for (const suffix of PER_SUFFIXES) {
    if (tok.key.endsWith(suffix)) {
      const stem = UNIT_WORDS.get(tok.key.slice(0, -suffix.length));
      if (stem !== undefined) return { unit: stem, per: true };
    }
  }
  return null;
}

const isCurrency = (tok: Tok | undefined): boolean => tok !== undefined && CURRENCY_WORDS.has(tok.key);
const isLot = (tok: Tok | undefined): boolean => tok !== undefined && LOT_WORDS.has(tok.key);
const isPer = (tok: Tok | undefined): boolean => tok !== undefined && PER_WORDS.has(tok.key);

function priceUnit(unit: QuantityUnit): PriceUnit | null {
  return unit === 'bag' ? null : unit;
}

interface NumberItem {
  value: number;
  start: number;
  end: number;
}

function readNumbers(tokens: readonly Tok[], locale: Locale): NumberItem[] {
  const spoken = numberWords(locale);
  const items: NumberItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    let value: number | null = null;
    if (/^\d/.test(tok.key)) value = Number(tok.key.replace(/,/g, ''));
    else {
      const word = spoken.get(tok.key);
      const next = tokens[i + 1];
      // A number word counts only when a unit, currency or multiplier follows it.
      if (word !== undefined && (unitOf(next) !== null || isCurrency(next) || (next !== undefined && MULTIPLIERS.has(next.key)))) value = word;
    }
    if (value === null || !Number.isFinite(value)) continue;
    let end = i;
    const multiplier = tokens[i + 1] === undefined ? undefined : MULTIPLIERS.get(tokens[i + 1]?.key ?? '');
    if (multiplier !== undefined) {
      value *= multiplier;
      end = i + 1;
    }
    items.push({ value, start: i, end });
    i = end;
  }
  return items;
}

export function parseListingIntent(text: string, locale: Locale, context: ParseContext, lexicon?: Lexicon): ParsedListingIntent {
  if (context.farmerDistrict === '') throw new RangeError('The farmer’s verified district is required; there is no default district.');
  const lex = lexicon ?? buildLexicon(context.dictionary, context.districts);
  const tokens: Tok[] = tokenize(normaliseText(text)).map((raw) => ({ raw, key: foldKey(raw) }));
  const notes: string[] = [];

  const crop = findPhrase(tokens, lex.crops, new Set());
  const cropSpan = new Set<number>(crop === null ? [] : Array.from({ length: crop.end - crop.start + 1 }, (_, k) => crop.start + k));
  const place = findPhrase(tokens, lex.places, cropSpan);

  let quantity: Quantity | undefined;
  const explicitPrices: Array<Money | AmbiguousPrice> = [];
  const bare: NumberItem[] = [];

  for (const item of readNumbers(tokens, locale)) {
    if (!(item.value > 0)) continue;
    const before = tokens[item.start - 1];
    const before2 = tokens[item.start - 2];
    const before3 = tokens[item.start - 3];
    const after = tokens[item.end + 1];
    const currencyBefore = isCurrency(before);
    const currencyAfter = isCurrency(after);

    if (currencyBefore || currencyAfter) {
      // Where would a stated basis be? After the currency word, or before the currency/number.
      const k = currencyAfter ? item.end + 2 : item.end + 1;
      const tail = tokens[k];
      const tailUnit = unitOf(tail);
      const perTailUnit = isPer(tail) ? unitOf(tokens[k + 1]) : null;
      const head = currencyBefore ? before2 : before;
      const headUnit = unitOf(head);
      const perHead = currencyBefore ? isPer(before3) : isPer(before2);
      let unit: PriceUnit | null = null;
      if (perTailUnit !== null) unit = priceUnit(perTailUnit.unit);
      else if (tailUnit !== null) unit = priceUnit(tailUnit.unit);
      else if (isLot(tail) || isLot(head)) unit = 'lot';
      else if (headUnit !== null && (headUnit.per || perHead)) unit = priceUnit(headUnit.unit);
      explicitPrices.push(unit === null ? { amount: item.value, unit: null, candidates: [] } : { amount: item.value, unit });
      continue;
    }

    const next = unitOf(after);
    if (next !== null && !next.per) {
      if (quantity === undefined) quantity = { value: item.value, unit: next.unit };
      else notes.push(`a second quantity (${item.value} ${next.unit}) was set aside`);
      continue;
    }
    // "1840 क्विंटलला", "1840/qtl", "क्विंटलला 1840", "per quintal 1840": a per-unit price with no currency word.
    const slashUnit = isPer(after) ? unitOf(tokens[item.end + 2]) : null;
    const headUnit = unitOf(before);
    if ((next !== null && next.per) || slashUnit !== null || (headUnit !== null && (headUnit.per || isPer(before2)))) {
      const unit = next?.unit ?? slashUnit?.unit ?? headUnit?.unit;
      const basis = unit === undefined ? null : priceUnit(unit);
      explicitPrices.push(basis === null ? { amount: item.value, unit: null, candidates: [] } : { amount: item.value, unit: basis });
      continue;
    }
    if (isLot(after) || isLot(before)) {
      explicitPrices.push({ amount: item.value, unit: 'lot' });
      continue;
    }
    bare.push(item);
  }

  // The questions offered for an unmarked price: per quintal, per kilo, for the whole lot — and
  // per crate when the farmer counted in crates.
  const candidates: PriceUnit[] = ['quintal', 'kg', 'lot', ...(quantity?.unit === 'crate' ? (['crate'] as const) : [])];
  let price: Money | AmbiguousPrice | undefined;
  const firstExplicit = explicitPrices[0];
  if (firstExplicit !== undefined) {
    price = firstExplicit.unit === null ? { amount: firstExplicit.amount, unit: null, candidates } : firstExplicit;
    if (explicitPrices.length > 1) notes.push('more than one price was mentioned; the first was kept');
  } else if (quantity !== undefined && bare.length === 1 && bare[0] !== undefined) {
    price = { amount: bare[0].value, unit: null, candidates };
  } else if (bare.length > 0) {
    notes.push('numbers without a unit or currency could not be placed');
  }

  const keys = tokens.map((t) => t.key);
  const selling = keys.some((k) => SELL_WORDS.has(k));
  const enquiring = keys.some((k) => ENQUIRE_WORDS.has(k));
  const intent: 'sell' | 'enquire' = !selling && enquiring && quantity === undefined ? 'enquire' : 'sell';

  const unresolved: UnresolvedField[] = [];
  if (crop === null) unresolved.push('crop');
  if (quantity === undefined) unresolved.push('quantity');
  if (price !== undefined && price.unit === null) unresolved.push('price-unit');
  if (quantity !== undefined && crop !== null && (quantity.unit === 'crate' || quantity.unit === 'bag')) {
    const profile = findCrop(lex.dictionary, crop.value);
    const weight = kgPerUnit(quantity.unit, { crateKg: profile?.crateKg, bagKg: profile?.bagKg });
    if (!weight.ok) unresolved.push('quantity-weight');
  }

  const result: ParsedListingIntent = {
    intent,
    district: place?.value.district ?? context.farmerDistrict,
    districtSource: place === null ? 'registry' : 'message',
    unresolved,
    notes,
  };
  if (crop !== null) result.crop = crop.value;
  if (quantity !== undefined) result.quantity = quantity;
  if (price !== undefined) result.price = price;
  if (place?.value.market !== undefined) result.market = place.value.market;
  return result;
}

/** The first quantity in a message, in the unit the farmer used — or null. */
export function parseQuantity(text: string, locale: Locale, context: ParseContext): Quantity | null {
  return parseListingIntent(text, locale, context).quantity ?? null;
}

/** "crop: onion · quantity: 5 · unit: quintal · intent: sell · location: Nashik" (PROMPT §6.1). */
export function describeParse(result: ParsedListingIntent, registry: DistrictRegistry): string {
  const district = registry.districts.find((d) => d.id === result.district)?.names.en ?? result.district;
  const parts = [
    `crop: ${result.crop ?? '?'}`,
    `quantity: ${result.quantity?.value ?? '?'}`,
    `unit: ${result.quantity?.unit ?? '?'}`,
  ];
  if (result.price !== undefined) parts.push(`price: ${result.price.amount} per ${result.price.unit ?? '?'}`);
  parts.push(`intent: ${result.intent}`, `location: ${district}`);
  return parts.join(' · ');
}
