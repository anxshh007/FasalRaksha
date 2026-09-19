/**
 * The parser's fixed vocabulary: units, currency, per-unit and whole-lot markers, multipliers,
 * number words and intent words — in Latin transliteration and native script, Devanagari first.
 * Crops and places are *not* here: they come from the shipped dictionaries (crops.json,
 * districts.json) so they can be corrected without an app release.
 */
import type { Locale } from '../core/types.js';
import type { QuantityUnit } from '../units/units.js';

const DIGIT_ZERO: readonly number[] = [0x0966 /* Devanagari */, 0x09e6 /* Bengali */, 0x0a66 /* Gurmukhi */];

/** NFC, native digits → ASCII (१२३ → 123), zero-width characters removed, Latin lower-cased. */
export function normaliseText(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0;
    const zero = DIGIT_ZERO.find((z) => code >= z && code <= z + 9);
    if (zero !== undefined) out += String(code - zero);
    else if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) continue;
    else out += ch;
  }
  return out.toLowerCase();
}

/**
 * The comparison key for a word: nukta dropped (प्याज़ = प्याज), chandrabindu folded into
 * anusvara (गेहूँ = गेहूं), so spelling variants that speech recognisers produce all meet.
 */
export function foldKey(word: string): string {
  return normaliseText(word)
    .normalize('NFD')
    .replace(/[़়਼]/g, '')
    .replace(/ँ/g, 'ं')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Tokens: the rupee sign, numbers (with grouping commas or a decimal point), words (letters and
 * their combining marks — virama, matras, anusvara — so Devanagari words stay whole), and '/'.
 * JavaScript's `\b` is ASCII-only and can never find a Devanagari word boundary, which is why
 * Phase 1's `findCropInText` could not have been extended to Marathi; this tokenizer does not use it.
 */
export function tokenize(normalised: string): string[] {
  return normalised.match(/₹|\d+(?:[.,]\d+)*|[\p{L}\p{M}]+|\//gu) ?? [];
}

const words = (list: string): string[] => list.split(/\s+/).filter(Boolean).map(foldKey);

export const UNIT_WORDS: ReadonlyMap<string, QuantityUnit> = new Map<string, QuantityUnit>([
  ...words('kg kgs kilo kilos kilogram kilograms kilogramme किलो किलोग्रॅम किलोग्राम केजी').map((w): [string, QuantityUnit] => [w, 'kg']),
  ...words('quintal quintals qtl qtls qntl qntls kwintal kvintal quental क्विंटल क्विंटल्स क्विन्टल क्वींटल क्विंटाल').map((w): [string, QuantityUnit] => [w, 'quintal']),
  ...words('ton tons tonne tonnes tan टन').map((w): [string, QuantityUnit] => [w, 'tonne']),
  ...words('crate crates carat carats caret karat kret क्रेट कॅरेट कैरेट क्रेट्स').map((w): [string, QuantityUnit] => [w, 'crate']),
  ...words('bag bags bori boriya gonpat goni gonya pote poti pishvi पोते पोती गोणी गोण्या गोणपाट बोरी बोरे बॅग बॅगा').map((w): [string, QuantityUnit] => [w, 'bag']),
]);

export const CURRENCY_WORDS: ReadonlySet<string> = new Set([
  '₹',
  ...words('rs inr rupee rupees rupaye rupaya rupye rupay rupaiya rupaiye rupya रुपये रुपया रुपए रुपयांना रुपयाला रु रू रुपयात'),
]);

/** Words meaning "per" that precede a unit: "per quintal", "प्रति क्विंटल". */
export const PER_WORDS: ReadonlySet<string> = new Set(['/', ...words('per prati प्रति')]);

/** Marathi case endings that turn a unit into "per unit": क्विंटलला, किलोमागे. */
export const PER_SUFFIXES: readonly string[] = ['ला', 'मागे', 'ले'];

/** Marathi/Hindi endings stripped when looking a word up: कांद्याला → कांद्या, लासलगावला → लासलगाव. */
export const CASE_SUFFIXES: readonly string[] = ['मध्ये', 'साठी', 'मागे', 'च्या', 'चा', 'ची', 'चे', 'ला', 'ने', 'ना', 'ही', 'ात', 'त', 'ले', 'से', 'में', 'का', 'की', 'के'];

/** "For the whole lot". */
export const LOT_WORDS: ReadonlySet<string> = new Set(
  words('lot whole total sagla sagle sagli sarva sampurna poora pura poori puri sab kul पूर्ण संपूर्ण सगळा सगळे सगळी सर्व एकूण पूरा पूरी पूरे कुल खेप'),
);

export const MULTIPLIERS: ReadonlyMap<string, number> = new Map<string, number>([
  ...words('hazar hajar hazaar hajaar thousand हजार हज़ार').map((w): [string, number] => [w, 1000]),
  ...words('lakh lakhs lac lacs लाख').map((w): [string, number] => [w, 100_000]),
]);

/**
 * Number words, by language. Only read as numbers when a unit, currency or multiplier follows
 * ("pach quintal", "दोन हजार"), so "do" or "sat" in ordinary speech is never mistaken for a count.
 */
const NUMBER_WORDS: Readonly<Record<Locale, ReadonlyArray<readonly [string, number]>>> = {
  mr: [
    ['एक', 1], ['दोन', 2], ['तीन', 3], ['चार', 4], ['पाच', 5], ['सहा', 6], ['सात', 7], ['आठ', 8], ['नऊ', 9], ['दहा', 10],
    ['बारा', 12], ['पंधरा', 15], ['वीस', 20], ['पंचवीस', 25], ['तीस', 30], ['चाळीस', 40], ['पन्नास', 50], ['शंभर', 100],
    ['ek', 1], ['don', 2], ['teen', 3], ['char', 4], ['pach', 5], ['paach', 5], ['saha', 6], ['saat', 7], ['aath', 8], ['nau', 9], ['daha', 10],
    ['vees', 20], ['vis', 20], ['pannas', 50], ['shambhar', 100],
  ],
  hi: [
    ['एक', 1], ['दो', 2], ['तीन', 3], ['चार', 4], ['पांच', 5], ['पाँच', 5], ['छह', 6], ['छः', 6], ['सात', 7], ['आठ', 8], ['नौ', 9], ['दस', 10],
    ['बारह', 12], ['पंद्रह', 15], ['बीस', 20], ['पच्चीस', 25], ['तीस', 30], ['चालीस', 40], ['पचास', 50], ['सौ', 100],
    ['ek', 1], ['do', 2], ['teen', 3], ['char', 4], ['panch', 5], ['paanch', 5], ['chhah', 6], ['saat', 7], ['aath', 8], ['nau', 9], ['das', 10],
    ['bees', 20], ['pachees', 25], ['pachas', 50], ['sau', 100],
  ],
  en: [
    ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
    ['twelve', 12], ['fifteen', 15], ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['hundred', 100],
  ],
  bn: [['এক', 1], ['দুই', 2], ['তিন', 3], ['চার', 4], ['পাঁচ', 5], ['দশ', 10], ['কুড়ি', 20]],
  pa: [['ਇੱਕ', 1], ['ਦੋ', 2], ['ਤਿੰਨ', 3], ['ਚਾਰ', 4], ['ਪੰਜ', 5], ['ਦਸ', 10], ['ਵੀਹ', 20]],
};

export function numberWords(locale: Locale): ReadonlyMap<string, number> {
  return new Map(NUMBER_WORDS[locale].map(([word, value]) => [foldKey(word), value]));
}

export const SELL_WORDS: ReadonlySet<string> = new Set(
  words(
    'sell selling sale vikaycha vikaychi vikayche vikaycha vikaicha vikayla vikne viknar vikri bechna bechni bechne bechunga bikri ' +
      'विकायचा विकायची विकायचे विकायला विकणे विकणार विक्री विकाय बेचना बेचनी बेचने बेचूंगा बेचना बिक्री',
  ),
);

export const ENQUIRE_WORDS: ReadonlySet<string> = new Set(
  words('bhav bhaav bhaw rate rates dar kiti kitna kitne kya price kimmat kimat भाव दर किती कितना कितने क्या किंमत कीमत'),
);
