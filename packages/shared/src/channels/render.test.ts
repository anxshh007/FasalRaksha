/**
 * FR-07 · §XII — the same answer in four widths, from one set of numbers.
 *
 * These are the renderers only: they are handed a benchmark and an evaluation and may not
 * recompute either, which is what makes "identical benchmark on all four channels" a property of
 * the code rather than a promise. The end-to-end check, against a real bundle over HTTP, is in
 * `apps/api/test/channels.db.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { Benchmark } from '../benchmark/benchmark.js';
import type { WaitEvaluation } from '../decision/decision.js';
import { benchmarkFigure, ivrScript, smsReply, smsSegments, whatsappReply, type ChannelAnswer, type ChannelSubject } from './render.js';

const subject: ChannelSubject = {
  crop: 'onion',
  cropNameEn: 'Onion',
  cropNameMr: 'कांदा',
  cropNameLatin: 'Kanda',
  districtNameEn: 'Nashik',
  districtNameMr: 'नाशिक',
  marketNameEn: 'Lasalgaon',
  marketNameLatin: 'Lasalgaon',
};

const benchmark = (modal: number, fraction: number | null): Benchmark =>
  ({
    crop: 'onion',
    district: 'nashik',
    market: 'lasalgaon',
    modal: { amount: modal, unit: 'quintal' },
    min: { amount: modal - 200, unit: 'quintal' },
    max: { amount: modal + 200, unit: 'quintal' },
    mspFloor: null,
    vsMsp: null,
    trend7: [],
    trendChange: fraction === null ? null : { amount: { amount: Math.round(modal * fraction), unit: 'quintal' }, fraction },
    seasonalPosition: null,
    asOf: '2026-09-18',
    ageDays: 0,
    adviceSuppressed: false,
  }) as Benchmark;

const evaluation = (verdict: 'sell' | 'wait' | 'refuse', failed: string[] = [], suppressed = false): WaitEvaluation =>
  ({ verdict, suppressed, failedConditions: failed, conditions: [], headline: verdict, expectedGain: null, downside: null, carry: null, asOf: '2026-09-18' }) as unknown as WaitEvaluation;

const answer = (modal = 3508, fraction: number | null = 0.04, verdict: 'sell' | 'wait' | 'refuse' = 'sell', failed: string[] = [], suppressed = false): ChannelAnswer => ({
  benchmark: benchmark(modal, fraction),
  evaluation: evaluation(verdict, failed, suppressed),
  today: '2026-09-18',
});

describe('§XII · every channel quotes the same figure', () => {
  it('the number in the SMS, the WhatsApp reply and the IVR script is the benchmark, rounded once', () => {
    const a = answer(3508.4);
    expect(benchmarkFigure(a)).toBe(3508);
    expect(smsReply(subject, a)).toContain('Rs3508/qtl');
    expect(whatsappReply(subject, a)).toContain('₹3508');
    expect(ivrScript(subject, a).join(' ')).toContain('3508');
  });

  it('a movement is signed, and absent when there is nothing to compare with', () => {
    expect(smsReply(subject, answer(3508, 0.04))).toContain('7d +4%');
    expect(smsReply(subject, answer(3508, -0.031))).toContain('7d -3%');
    expect(smsReply(subject, answer(3508, null))).not.toContain('7d');
  });
});

describe('§XII · an SMS costs one segment and prints on a feature phone', () => {
  it('stays inside 160 GSM-7 characters, whatever the verdict', () => {
    for (const verdict of ['sell', 'wait', 'refuse'] as const) {
      const text = smsReply(subject, answer(3508, 0.04, verdict, ['GR-6']));
      expect(text.length).toBeLessThanOrEqual(160);
      expect(smsSegments(text)).toBe(1);
      expect(text).toMatch(/^[\x20-\x7E·]+$/); // Latin only: Devanagari would cost a second segment
    }
  });

  it('counts a Devanagari message at seventy characters a segment, as a gateway would bill it', () => {
    expect(smsSegments('कांदा लासलगाव भाव'.repeat(6))).toBeGreaterThan(1);
  });
});

describe('§XII · the refusal and the stale answer survive the narrowing', () => {
  it('WhatsApp gives the reason in words, never a condition id', () => {
    const text = whatsappReply(subject, answer(3508, 0.02, 'refuse', ['GR-6', 'GR-3']));
    expect(text).toContain('साठवणीचा खर्च'); // "does not cover the cost of storage"
    expect(text).not.toContain('GR-');
  });

  it('a stale bundle says so on every channel, and never says sell or wait', () => {
    const stale = answer(3508, 0.04, 'sell', [], true);
    expect(smsReply(subject, stale)).toContain('bhav junaa');
    expect(smsReply(subject, stale)).not.toContain('vikri karava');
    expect(whatsappReply(subject, stale)).toContain('जुने');
    expect(ivrScript(subject, stale).join(' ')).toContain('जुने');
  });

  it('the IVR says one thing per utterance, and the menu is last', () => {
    const script = ivrScript(subject, answer());
    expect(script.length).toBeGreaterThanOrEqual(4);
    expect(script.at(-1)).toContain('दाबा');
    for (const line of script) expect(line.length).toBeLessThanOrEqual(120);
  });
});
