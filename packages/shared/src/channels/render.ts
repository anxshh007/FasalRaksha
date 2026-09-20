/**
 * The same answer, in four widths (PROMPT PART XII; Constitution §3).
 *
 * The PWA is the richest channel and the narrowest: the farmers with the worst price information
 * are reachable mainly by WhatsApp, SMS and a phone call. So the benchmark, the sell-or-wait
 * answer and the refusal all come from the same functions here, and the only thing that differs
 * between channels is how many characters there are to say it in.
 *
 *   app        ₹3,508 per quintal at Lasalgaon, with the trend, the band and the evidence panel
 *   whatsapp   the same figure, the answer, and one line on what to do next
 *   sms        Kanda Lasalgaon Rs3508/qtl · 7d +4% · vikri karava — 160 characters, GSM-7 safe
 *   ivr        the same sentences, cut into utterances a voice can read at a farmer's pace
 *
 * Two rules make the promise in §XII testable. Every channel takes the *same* `Benchmark` and
 * `WaitEvaluation` this module never recomputes, so "identical benchmark on all four channels"
 * is true by construction and asserted in a test. And SMS is transliterated into Latin on
 * purpose: a Devanagari message costs 70 characters a segment instead of 160, and a farmer on a
 * feature phone pays for every segment.
 */
import type { Benchmark } from '../benchmark/benchmark.js';
import type { ISODate } from '../core/types.js';
import type { WaitEvaluation } from '../decision/decision.js';
import type { WeatherUrgency } from '../weather/urgency.js';

export type Channel = 'app' | 'whatsapp' | 'sms' | 'ivr';

export interface ChannelSubject {
  /** Crop id, and the name to say in each script. */
  crop: string;
  cropNameEn: string;
  cropNameMr: string;
  /** The transliterated name a feature phone can print: "Kanda". */
  cropNameLatin: string;
  districtNameEn: string;
  districtNameMr: string;
  marketNameEn: string;
  marketNameLatin: string;
}

export interface ChannelAnswer {
  benchmark: Benchmark;
  evaluation: WaitEvaluation;
  urgency?: WeatherUrgency;
  today: ISODate;
}

/** The one figure every channel must agree on: the district modal, in whole rupees per quintal. */
export function benchmarkFigure(answer: ChannelAnswer): number {
  return Math.round(answer.benchmark.modal.amount);
}

/** Seven-day movement as the SMS prints it: "+4" / "-3" / "0", or null when it is unknown. */
export function trendPercent(answer: ChannelAnswer): number | null {
  const change = answer.benchmark.trendChange;
  if (change === null) return null;
  return Math.round(change.fraction * 100);
}

function verdictLatin(answer: ChannelAnswer): string {
  if (answer.evaluation.suppressed) return 'bhav junaa - salla nahi';
  if (answer.evaluation.verdict === 'sell') return 'vikri karava';
  if (answer.evaluation.verdict === 'wait') return 'thamba';
  return 'salla nahi';
}

/**
 * Why a refusal is a refusal, in the channel's own register. The app has its own copy for the
 * same seven conditions (`refusal.GR-*`); these are the spoken and texted versions, and neither
 * ever says "GR-3" to a farmer.
 */
const REFUSAL_MR: Readonly<Record<string, string>> = {
  'GR-1': 'ताजी माहिती नाही.',
  'GR-2': 'अंदाज हंगामी पातळीपेक्षा चांगला नाही.',
  'GR-3': 'पुरावा पुरेसा भक्कम नाही.',
  'GR-4': 'संकेत एकाच दिशेला नाहीत.',
  'GR-5': 'हंगाम उलट दिशेला आहे.',
  'GR-6': 'वाढ साठवणीचा खर्च भरून काढत नाही.',
  'GR-7': 'जवळ योग्य गोदाम नाही.',
  'RK-7': 'तोटा सहन करण्यापलीकडे जाऊ शकतो.',
};

function verdictMarathi(answer: ChannelAnswer): string {
  if (answer.evaluation.suppressed) return 'हे भाव जुने आहेत, त्यामुळे सल्ला दिला जात नाही.';
  if (answer.evaluation.verdict === 'sell') return 'आजचा सल्ला: विक्री करावी.';
  if (answer.evaluation.verdict === 'wait') return 'आजचा सल्ला: थांबता येईल.';
  return 'आज सल्ला देता येत नाही.';
}

/** A GSM-7 alphabet approximation: what a single-segment SMS may contain. */
const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà·\n\r]*$/;

export const SMS_SEGMENT_CHARS = 160;

/**
 * The core value in one segment (§XII): crop, market, price, movement, and the answer. Latin,
 * because a Devanagari segment is 70 characters and this must not cost a farmer two messages.
 */
export function smsReply(subject: ChannelSubject, answer: ChannelAnswer): string {
  const trend = trendPercent(answer);
  const parts = [
    `${subject.cropNameLatin} ${subject.marketNameLatin} Rs${benchmarkFigure(answer)}/qtl`,
    trend === null ? null : `7d ${trend > 0 ? '+' : ''}${trend}%`,
    verdictLatin(answer),
  ].filter((part): part is string => part !== null);
  const text = parts.join(' · ');
  // The separator is not GSM-7; fall back to a hyphen rather than silently costing two segments.
  return GSM7.test(text) ? text : text.replace(/ · /g, ' - ');
}

export function smsSegments(text: string): number {
  const perSegment = GSM7.test(text) ? SMS_SEGMENT_CHARS : 70;
  return Math.max(1, Math.ceil(text.length / perSegment));
}

/**
 * WhatsApp has room for the reason as well as the answer, and it is read on a screen, so it is
 * written in Devanagari. It says the same figure as the SMS and stops at the same refusal.
 */
export function whatsappReply(subject: ChannelSubject, answer: ChannelAnswer): string {
  const trend = trendPercent(answer);
  const lines = [
    `${subject.cropNameMr} · ${subject.marketNameEn}`,
    `₹${benchmarkFigure(answer)} प्रति क्विंटल${trend === null ? '' : ` · ७ दिवसांत ${trend > 0 ? '+' : ''}${trend}%`}`,
    verdictMarathi(answer),
  ];
  // A refusal says why, in words. The condition ids stay in Judge Mode where they belong.
  if (!answer.evaluation.suppressed && answer.evaluation.verdict === 'refuse') {
    const first = answer.evaluation.failedConditions[0];
    if (first !== undefined && REFUSAL_MR[first] !== undefined) lines.push(REFUSAL_MR[first]);
  }
  if (answer.urgency !== undefined && answer.urgency.level === 'move' && answer.urgency.day !== null) {
    lines.push(`${answer.urgency.day} रोजी पाऊस अपेक्षित — माल लवकर हलवा.`);
  }
  lines.push(`भाव ${answer.benchmark.asOf} चा आहे.`);
  return lines.join('\n');
}

/**
 * The IVR script: one idea per utterance, because a voice cannot be re-read. The menu comes last,
 * so a farmer who only wanted the price can hang up having heard it.
 */
export function ivrScript(subject: ChannelSubject, answer: ChannelAnswer): string[] {
  const trend = trendPercent(answer);
  const script = [
    `${subject.cropNameMr}, ${subject.marketNameEn}.`,
    `आजचा भाव, ${benchmarkFigure(answer)} रुपये प्रति क्विंटल.`,
  ];
  if (trend !== null) script.push(`सात दिवसांत ${trend > 0 ? 'वाढ' : trend < 0 ? 'घट' : 'बदल नाही'}, ${Math.abs(trend)} टक्के.`);
  script.push(verdictMarathi(answer));
  script.push('भाव पुन्हा ऐकण्यासाठी एक दाबा. विकण्यासाठी दोन दाबा. खरेदीदारांसाठी तीन दाबा.');
  return script;
}
