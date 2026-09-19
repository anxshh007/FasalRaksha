/**
 * ModelFallbackAdapter (PROMPT §6, Constitution §14; P1-10). Deterministic first, model second,
 * never the reverse: this is consulted *only* for fields the on-device rule cascade could not
 * resolve, only on the server (the key lives in server configuration — Phase 1's browser-held
 * Groq key is gone), and only as a *suggestion* the farmer confirms on the parse-confirm card.
 *
 * One rule is enforced after either implementation answers, not trusted to it: a model never
 * assigns a unit to a price. Whatever it says, `price.unit` comes back null and the farmer is asked
 * with a single tap (P1-03). Crops outside the dictionary, impossible quantities and unknown
 * intents are dropped the same way.
 *
 *   MockModelFallbackAdapter — spelling-tolerant matching against the crop dictionary ("onyon",
 *                              "tamaatarr"): the most common failure of a rule cascade, handled
 *                              deterministically; everything else it leaves unresolved
 *   ClaudeModelFallbackAdapter — Claude (claude-opus-5) through the Anthropic SDK, with
 *                              structured output and server-side refusal fallbacks
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { foldKey, normaliseText, tokenize, type CropId, type Locale, type PriceUnit, type Quantity, type UnresolvedField } from '@fasal/shared';
import { z } from 'zod';

import { AdapterError, type Transport } from '../http.js';

export interface FallbackRequest {
  text: string;
  locale: Locale;
  /** What the deterministic parser could not resolve; the fallback fills only these. */
  unresolved: readonly UnresolvedField[];
  crops: ReadonlyArray<{ id: CropId; names: { en: string; mr: string; hi: string }; synonyms: readonly string[] }>;
}

export interface FallbackSuggestion {
  crop: CropId | null;
  quantity: Quantity | null;
  /** Never carries a unit: an unmarked amount is asked about, not assigned (P1-03). */
  price: { amount: number; unit: null } | null;
  place: string | null;
  intent: 'sell' | 'enquire' | null;
}

export interface ModelFallbackAdapter {
  readonly mode: 'mock' | 'live';
  suggest(request: FallbackRequest): Promise<FallbackSuggestion>;
}

const QUANTITY_UNITS = ['kg', 'quintal', 'tonne', 'crate', 'bag'] as const;

/** Applied to every answer, from either implementation. */
export function guardSuggestion(request: FallbackRequest, raw: {
  crop?: string | null;
  quantity?: { value: number; unit: string } | null;
  priceAmount?: number | null;
  place?: string | null;
  intent?: string | null;
}): FallbackSuggestion {
  const crop = raw.crop !== null && raw.crop !== undefined && request.crops.some((c) => c.id === raw.crop) ? raw.crop : null;
  const q = raw.quantity;
  const quantity =
    q !== null && q !== undefined && Number.isFinite(q.value) && q.value > 0 && (QUANTITY_UNITS as readonly string[]).includes(q.unit)
      ? { value: q.value, unit: q.unit as Quantity['unit'] }
      : null;
  const amount = raw.priceAmount;
  const price = amount !== null && amount !== undefined && Number.isFinite(amount) && amount > 0 ? { amount, unit: null } : null;
  const place = typeof raw.place === 'string' && raw.place.trim() !== '' ? raw.place.trim().slice(0, 60) : null;
  const intent = raw.intent === 'sell' || raw.intent === 'enquire' ? raw.intent : null;
  const wants = (field: UnresolvedField): boolean => request.unresolved.includes(field);
  return {
    crop: wants('crop') ? crop : null,
    quantity: wants('quantity') ? quantity : null,
    price: wants('price-unit') || wants('quantity') ? price : null,
    place,
    intent,
  };
}

/** Optimal-string-alignment edit distance, capped: returns cap + 1 once exceeded. */
export function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((d[i - 1]?.[j] ?? 0) + 1, (d[i]?.[j - 1] ?? 0) + 1, (d[i - 1]?.[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (d[i - 2]?.[j - 2] ?? 0) + 1);
      (d[i] as number[])[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length]?.[b.length] ?? cap + 1;
}

export class MockModelFallbackAdapter implements ModelFallbackAdapter {
  readonly mode = 'mock' as const;

  async suggest(request: FallbackRequest): Promise<FallbackSuggestion> {
    let best: { crop: CropId; distance: number } | null = null;
    for (const token of tokenize(normaliseText(request.text)).map(foldKey)) {
      if (token.length < 4 || /^\d/.test(token)) continue;
      const cap = token.length >= 7 ? 2 : 1;
      for (const crop of request.crops) {
        for (const synonym of crop.synonyms.map(foldKey)) {
          if (synonym.length < 4) continue;
          const distance = editDistance(token, synonym, cap);
          if (distance <= cap && (best === null || distance < best.distance)) best = { crop: crop.id, distance };
        }
      }
    }
    return guardSuggestion(request, { crop: best?.crop ?? null });
  }
}

const SuggestionSchema = z.object({
  crop: z.string().nullable().describe('One of the listed crop ids, or null if the message names no listed crop.'),
  quantity: z
    .object({ value: z.number().describe('The number exactly as the farmer gave it (convert Devanagari digits).'), unit: z.enum(QUANTITY_UNITS) })
    .nullable()
    .describe('The quantity to sell in the unit the farmer used, or null.'),
  price_amount: z.number().nullable().describe('A price amount in rupees if one is named, or null. Do not say what it is per.'),
  place: z.string().nullable().describe('A district, town or market named in the message, in English spelling, or null.'),
  intent: z.enum(['sell', 'enquire']).nullable().describe('sell = offering produce; enquire = asking about rates. Null if unclear.'),
});

export interface ClaudeFallbackConfig {
  apiKey: string;
  transport?: Transport;
  timeoutMs?: number;
}

export const FALLBACK_MODEL = 'claude-opus-5';

function systemPrompt(request: FallbackRequest): string {
  const crops = request.crops.map((c) => `${c.id} (${c.names.en} / ${c.names.mr} / ${c.names.hi})`).join('; ');
  return [
    'You read a short message from a farmer in Maharashtra who wants to sell produce or ask about prices.',
    'The message may be Marathi, Hindi, English or a mix, in Devanagari or Latin script, often from speech recognition.',
    'Extract only what the farmer actually said. When something is not stated or you are unsure, use null — a wrong value is worse than a missing one, because the farmer is asked to confirm and a null becomes a simple question.',
    'Never decide what a price is per (quintal, kilo or the whole lot); report only the amount.',
    `Crop ids you may use: ${crops}.`,
  ].join('\n');
}

export class ClaudeModelFallbackAdapter implements ModelFallbackAdapter {
  readonly mode = 'live' as const;
  private readonly client: Anthropic;

  constructor(config: ClaudeFallbackConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      // A farmer is waiting on this: one quick retry, then the parse-confirm card simply asks.
      timeout: config.timeoutMs ?? 12_000,
      maxRetries: 1,
      ...(config.transport === undefined ? {} : { fetch: config.transport as NonNullable<ConstructorParameters<typeof Anthropic>[0]>['fetch'] }),
    });
  }

  async suggest(request: FallbackRequest): Promise<FallbackSuggestion> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: FALLBACK_MODEL,
        // A short structured answer at low effort; this cap leaves room for adaptive thinking.
        max_tokens: 4096,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(SuggestionSchema) },
        system: systemPrompt(request),
        messages: [{ role: 'user', content: request.text }],
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new AdapterError('Claude fallback', 'upstream-unavailable', 'The language fallback is busy; the farmer will be asked directly.');
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new AdapterError('Claude fallback', 'not-configured', 'The language fallback is not authorised on this server.');
      }
      if (error instanceof Anthropic.BadRequestError) throw new AdapterError('Claude fallback', 'upstream-rejected', 'The language fallback refused the request.');
      if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
        throw new AdapterError('Claude fallback', 'upstream-unavailable', 'The language fallback could not be reached.');
      }
      throw error;
    }
    if (response.stop_reason === 'refusal') return guardSuggestion(request, {});
    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) throw new AdapterError('Claude fallback', 'bad-response', 'The language fallback did not return a readable answer.');
    return guardSuggestion(request, {
      crop: parsed.crop,
      quantity: parsed.quantity,
      priceAmount: parsed.price_amount,
      place: parsed.place,
      intent: parsed.intent,
    });
  }
}

export type { PriceUnit };
