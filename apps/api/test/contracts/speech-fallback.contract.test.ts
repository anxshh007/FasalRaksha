/**
 * ARCH-06 · FR-10 · P1-10 — SpeechAdapter and ModelFallbackAdapter, Mock and Live. The fallback
 * is server-side (P1-10), only fills what the rule cascade left unresolved, and never assigns a
 * unit to a price (P1-03).
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ClaudeModelFallbackAdapter, FALLBACK_MODEL, MockModelFallbackAdapter, type FallbackRequest, type ModelFallbackAdapter } from '../../src/adapters/model-fallback/model-fallback.js';
import { BhashiniSpeechAdapter, MockSpeechAdapter, type SpeechAdapter } from '../../src/adapters/speech/speech.js';
import crops from '../../../../data/reference/crops.json' with { type: 'json' };
import { recorded } from './support/recorded.js';

const DEMO_PHRASE = 'मला ५ क्विंटल कांदा विकायचा आहे';
const KNOWN_AUDIO = Uint8Array.from(randomBytes(4096));
const UNKNOWN_AUDIO = Uint8Array.from(randomBytes(4096));

function bhashini() {
  return recorded([
    {
      when: (c) => c.headers['authorization'] === 'bhashini-key',
      json: (c) => {
        const body = c.body as { inputData: { audio: Array<{ audioContent: string }> } };
        const content = body.inputData.audio[0]?.audioContent ?? '';
        const known = content === Buffer.from(KNOWN_AUDIO).toString('base64');
        return { pipelineResponse: [{ taskType: 'asr', config: null, output: [{ source: known ? DEMO_PHRASE : '' }], audio: null }] };
      },
    },
  ]);
}

const speeches: Array<[string, () => SpeechAdapter]> = [
  [
    'mock',
    () => {
      const m = new MockSpeechAdapter();
      m.remember(KNOWN_AUDIO, 'mr', DEMO_PHRASE);
      return m;
    },
  ],
  ['live', () => new BhashiniSpeechAdapter({ url: 'https://bhashini.test/services/inference/pipeline', inferenceKey: 'bhashini-key', serviceIds: { mr: 'ai4bharat/asr-mr' }, transport: bhashini().transport })],
];

describe.each(speeches)('ARCH-06 · FR-10 · SpeechAdapter contract (%s)', (_mode, make) => {
  it('transcribes a Marathi recording made offline, once the phone is back online', async () => {
    expect(await make().transcribe({ audio: KNOWN_AUDIO, mimeType: 'audio/webm;codecs=opus', locale: 'mr' })).toEqual({ status: 'transcribed', text: DEMO_PHRASE, locale: 'mr' });
  });

  it('says "unrecognised" for audio it cannot make out — never an invented sentence', async () => {
    expect(await make().transcribe({ audio: UNKNOWN_AUDIO, mimeType: 'audio/webm', locale: 'mr' })).toEqual({ status: 'unrecognised', text: null, locale: 'mr' });
  });

  it('refuses an unsupported format and an empty recording', async () => {
    await expect(make().transcribe({ audio: KNOWN_AUDIO, mimeType: 'image/png', locale: 'mr' })).rejects.toMatchObject({ problem: 'upstream-rejected' });
    await expect(make().transcribe({ audio: new Uint8Array(0), mimeType: 'audio/webm', locale: 'mr' })).rejects.toMatchObject({ problem: 'upstream-rejected' });
  });
});

const CROPS = crops.crops.map((c) => ({ id: c.id, names: c.names, synonyms: c.synonyms }));
const request = (text: string, unresolved: FallbackRequest['unresolved']): FallbackRequest => ({ text, locale: 'mr', unresolved, crops: CROPS });

/** A recorded Messages API response carrying the structured answer as its text block. */
function claude(answer: unknown, extra: Record<string, unknown> = {}) {
  return recorded([
    {
      when: (c) => c.url.pathname === '/v1/messages' && c.headers['x-api-key'] === 'sk-test',
      json: () => ({
        id: 'msg_recorded',
        type: 'message',
        role: 'assistant',
        model: FALLBACK_MODEL,
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 412, output_tokens: 38 },
        ...extra,
      }),
    },
  ]);
}

const ONYON = { crop: 'onion', quantity: { value: 5, unit: 'quintal' }, price_amount: 1840, place: 'Lasalgaon', intent: 'sell' };

const fallbacks: Array<[string, () => ModelFallbackAdapter]> = [
  ['mock', () => new MockModelFallbackAdapter()],
  ['live', () => new ClaudeModelFallbackAdapter({ apiKey: 'sk-test', transport: claude(ONYON).transport })],
];

describe.each(fallbacks)('ARCH-06 · P1-10 · ModelFallbackAdapter contract (%s)', (_mode, make) => {
  it('suggests the crop behind a misspelling the rule cascade could not match', async () => {
    const s = await make().suggest(request('onyon 5 quintal 1840 lasalgaon', ['crop']));
    expect(s.crop).toBe('onion');
  });

  it('never assigns a unit to a price', async () => {
    const s = await make().suggest(request('onyon 5 quintal 1840 lasalgaon', ['crop', 'price-unit']));
    expect(s.price === null || s.price.unit === null).toBe(true);
  });

  it('fills only the fields that were unresolved', async () => {
    const s = await make().suggest(request('onyon 5 quintal 1840', ['crop']));
    expect(s.quantity).toBeNull();
  });
});

describe('ARCH-06 · ModelFallbackAdapter, live-only behaviour', () => {
  it('asks claude-opus-5 for structured output at low effort, with server-side refusal fallbacks', async () => {
    const api = claude(ONYON);
    await new ClaudeModelFallbackAdapter({ apiKey: 'sk-test', transport: api.transport }).suggest(request('onyon 5 quintal', ['crop']));
    const call = api.calls[0];
    const body = call?.body as { model: string; fallbacks: unknown; output_config: { effort: string; format: { type: string } }; system: string };
    expect(body.model).toBe('claude-opus-5');
    expect(body.fallbacks).toBe('default');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(call?.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(body.system).toMatch(/Never decide what a price is per/);
  });

  it('drops a crop outside the dictionary and a quantity that makes no sense', async () => {
    const odd = claude({ crop: 'kiwi', quantity: { value: -5, unit: 'quintal' }, price_amount: null, place: null, intent: 'sell' });
    const s = await new ClaudeModelFallbackAdapter({ apiKey: 'sk-test', transport: odd.transport }).suggest(request('kiwi 5', ['crop', 'quantity']));
    expect(s).toMatchObject({ crop: null, quantity: null });
  });

  it('treats a refusal as "no suggestion" — the farmer is simply asked', async () => {
    const refusal = claude({}, { content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } });
    const s = await new ClaudeModelFallbackAdapter({ apiKey: 'sk-test', transport: refusal.transport }).suggest(request('onyon', ['crop']));
    expect(s).toEqual({ crop: null, quantity: null, price: null, place: null, intent: null });
  });

  it('a rejected key is reported as not configured, with no raw SDK error leaking out', async () => {
    const denied = recorded([{ when: () => true, status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
    await expect(new ClaudeModelFallbackAdapter({ apiKey: 'sk-bad', transport: denied.transport }).suggest(request('onyon', ['crop']))).rejects.toMatchObject({ problem: 'not-configured' });
  });
});
