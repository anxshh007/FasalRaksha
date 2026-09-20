/**
 * WhatsApp, SMS and IVR (PROMPT PART XII; §8.7's webhook surface).
 *
 * One inbound message, three widths, the same answer as the app — because all four read the same
 * published bundle through the same engines in @fasal/shared. The parser is the app's parser, so
 * "kanda lasalgaon bhav" is understood on a feature phone exactly as it is in the sell box.
 *
 * What these channels answer is deliberately narrow: **published district information only** —
 * today's benchmark, the movement, the sell-or-wait answer and the refusal behind it. Nothing
 * account-specific ever goes out over them. A phone number in an inbound webhook is a claim, not
 * an identity: anyone can spoof a sender id on an SMS gateway, and a farmer's lots, deals and
 * offers are worth more than the convenience of quoting them back. The app, where the sender
 * holds a session, is where that lives.
 *
 * The webhook itself is authenticated with a shared secret from the gateway (`CHANNEL_SECRET`),
 * compared in constant time. No secret configured means the endpoint is closed, not open.
 */
import { timingSafeEqual } from 'node:crypto';

import {
  computeBenchmark,
  evaluateWait,
  findReachableStorage,
  ivrScript,
  parseListingIntent,
  smsReply,
  smsSegments,
  whatsappReply,
  FINANCE_RATE_ANNUAL_DEFAULT,
  TOLERABLE_LOSS_FRACTION_DEFAULT,
  type Channel,
  type ChannelAnswer,
  type ChannelSubject,
  type CropBundle,
  type CropDictionary,
  type DistrictRegistry,
  type Locale,
} from '@fasal/shared';
import { z } from 'zod';

import type { Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import { cropBundle } from '../bundles/store.js';
import { districtRegistry } from '../demand/service.js';
import { cropDictionary } from '../listings/service.js';

export const InboundBody = z
  .object({
    /** The sender, as the gateway reports it. A claim, never an identity: see the file header. */
    from: z.string().trim().min(3).max(32),
    text: z.string().trim().min(1).max(500),
    /** IVR sends a keypress instead of words once the menu is playing. */
    digits: z.string().trim().max(8).optional(),
    locale: z.enum(['mr', 'hi', 'en']).default('mr'),
  })
  .strict();

export interface ChannelReply {
  channel: Channel;
  /** What the gateway should send back, already in the channel's own shape. */
  text: string;
  utterances?: string[];
  /** How many SMS segments the reply costs. One, or the reply is wrong for the channel. */
  segments?: number;
  understood: { crop: string | null; district: string; market: string | null };
  /** The one figure every channel must agree on (§XII's test). */
  benchmarkPerQtl: number | null;
  asOf: string | null;
}

/** The district a message is about: the place it names, or Nashik, where the demonstration lives. */
const DEFAULT_DISTRICT = 'nashik';
/** A feature phone cannot print Devanagari, so the SMS needs Latin names for crop and market. */
const LATIN: Readonly<Record<string, string>> = {
  onion: 'Kanda',
  tomato: 'Tomato',
  potato: 'Batata',
  soybean: 'Soyabean',
  gram: 'Harbhara',
  tur: 'Tur',
  banana: 'Kel',
  orange: 'Santra',
  grapes: 'Draksh',
  pomegranate: 'Dalimb',
  wheat: 'Gahu',
  cotton: 'Kapus',
};

function title(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function subjectFor(dictionary: CropDictionary, registry: DistrictRegistry, bundle: CropBundle): ChannelSubject {
  const crop = dictionary.crops.find((c) => c.id === bundle.crop);
  const district = registry.districts.find((d) => d.id === bundle.district);
  const market = district?.markets.find((m) => m.id === bundle.market);
  return {
    crop: bundle.crop,
    cropNameEn: crop?.names.en ?? title(bundle.crop),
    cropNameMr: crop?.names.mr ?? bundle.crop,
    cropNameLatin: LATIN[bundle.crop] ?? title(bundle.crop),
    districtNameEn: district?.names.en ?? title(bundle.district),
    districtNameMr: district?.names.mr ?? bundle.district,
    marketNameEn: market?.names.en ?? title(bundle.market),
    marketNameLatin: market?.names.en ?? title(bundle.market),
  };
}

/** Constant-time comparison of the gateway's shared secret; a missing secret closes the door. */
export function secretMatches(configured: string | undefined, presented: string | undefined): boolean {
  if (configured === undefined || configured.length === 0 || presented === undefined) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ChannelDeps {
  db: Database;
  now: () => Date;
}

/**
 * Answer one inbound message. The crop and place come from the shared parser; the figures come
 * from the published bundle; the words come from the shared channel renderers, so the SMS, the
 * WhatsApp reply, the IVR script and the app all quote the same rupees.
 */
export async function answerInbound(deps: ChannelDeps, channel: Channel, body: z.infer<typeof InboundBody>): Promise<ChannelReply> {
  const registry = districtRegistry();
  const dictionary = cropDictionary();
  const today = new Date(deps.now().getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

  const parsed = parseListingIntent(body.text, body.locale as Locale, { dictionary, districts: registry, farmerDistrict: DEFAULT_DISTRICT });
  const district = parsed.district;
  const understood = { crop: parsed.crop ?? null, district, market: parsed.market ?? null };

  if (parsed.crop === undefined) {
    return { channel, text: cannotTell(channel, body.locale as Locale), understood, benchmarkPerQtl: null, asOf: null, ...(channel === 'sms' ? { segments: 1 } : {}) };
  }

  let bundle: CropBundle;
  try {
    bundle = JSON.parse((await cropBundle(deps.db, parsed.crop, district)).body) as CropBundle;
  } catch {
    throw new DomainError(404, 'NO_BUNDLE', 'No prices are published for this crop in this district.');
  }

  const benchmark = computeBenchmark(bundle, today);
  const centre = registry.districts.find((d) => d.id === district)?.centroid ?? null;
  // One quintal: the channels answer the district's question, never a particular farmer's lot.
  const storage = centre === null ? null : findReachableStorage(bundle.storage, centre, bundle.crop, 1, bundle.benchmark.modal);
  const evaluation = evaluateWait({
    bundle,
    horizon: 7,
    quantityQtl: 1,
    storage,
    financeRateAnnual: FINANCE_RATE_ANNUAL_DEFAULT.value,
    tolerableLossFraction: TOLERABLE_LOSS_FRACTION_DEFAULT.value,
    today,
  });

  const subject = subjectFor(dictionary, registry, bundle);
  const answer: ChannelAnswer = { benchmark, evaluation, today };
  const reply: ChannelReply = {
    channel,
    text: '',
    understood,
    benchmarkPerQtl: Math.round(benchmark.modal.amount),
    asOf: benchmark.asOf,
  };

  if (channel === 'sms') {
    reply.text = smsReply(subject, answer);
    reply.segments = smsSegments(reply.text);
  } else if (channel === 'ivr') {
    reply.utterances = ivrScript(subject, answer);
    reply.text = reply.utterances.join(' ');
  } else {
    reply.text = whatsappReply(subject, answer);
  }
  return reply;
}

/** Not understood, in the channel's own width — and never a generic error (§10.4). */
function cannotTell(channel: Channel, locale: Locale): string {
  if (channel === 'sms') return 'Pik kalale nahi. Udaharan: KANDA LASALGAON';
  if (locale === 'hi') return 'कौन-सी फ़सल? जैसे: प्याज़ लासलगाँव का भाव';
  if (locale === 'en') return 'Which crop? For example: onion Lasalgaon price';
  return 'कोणते पीक? उदाहरण: कांदा लासलगाव भाव';
}
