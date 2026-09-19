/**
 * The buyer shortlist, computed on the phone (PROMPT §6.5; FR-09; Gates A and F).
 *
 * The farmer's lot, which never leaves the phone, is joined to the district's verified demand,
 * today's benchmark and hired-vehicle tariffs from the crop bundle, and the farmer's own
 * alternative, the nearest mandi, and ranked by @fasal/shared's `rankBuyers` against one
 * objective: what reaches the farmer after freight and the risk of late or missing payment.
 * Never a percentage, never a score floor.
 *
 * Each card below one with a lower offer carries why it ranks lower ("₹3,810 offered, but higher
 * payment-delay risk"), from the shared `explainOrder`. When nothing clears the nearest mandi, the
 * result is honestly empty, with what the farmer can do instead.
 */
import {
  explainOrder,
  rankBuyers,
  roadKm,
  type Grade,
  type ISODate,
  type Lot,
  type MatchResult,
  type OrderExplanation,
  type Quantity,
  type RankedMatch,
} from '@fasal/shared';

import type { DecisionContext, HomeBriefing } from '../offline/compute';

export interface LotSpec {
  crop: string;
  quantity: Quantity;
  grade: Grade | null;
  availableFrom: ISODate;
  availableUntil: ISODate;
  /** The listing this lot is, or null for the lot on the home screen. */
  listingClientId: string | null;
}

export interface MarketRef {
  id: string;
  names: { en: string; mr: string };
}

export type Shortlist =
  | { kind: 'no-demand' }
  | { kind: 'no-price'; crop: string }
  | {
      kind: 'ranked';
      lot: Lot;
      result: MatchResult;
      /** For a match ranked below one with a lower offer: why. Keyed by requirement id. */
      below: Map<string, { above: RankedMatch; why: OrderExplanation }>;
      benchmark: { modalPerQtl: number; market: MarketRef | null; asOf: string };
      nearestMandi: { market: MarketRef; roadKm: number } | null;
      /** Any buyer here is a seeded demonstration trader. */
      demonstration: boolean;
      computedAt: number;
    };

export function shortlistFor(briefing: HomeBriefing, spec: LotSpec, context: DecisionContext): Shortlist {
  if (briefing.demand === null) return { kind: 'no-demand' };
  const crop = briefing.crops.find((c) => c.crop === spec.crop);
  if (crop === undefined || briefing.location === null) return { kind: 'no-price', crop: spec.crop };
  const bundle = crop.bundle;
  const district = briefing.registry?.districts.find((d) => d.id === briefing.district) ?? null;
  const profile = briefing.dictionary?.crops.find((c) => c.id === spec.crop);
  const point = briefing.location.point;

  const markets = (district?.markets ?? []).map((m) => ({ market: { id: m.id, names: m.names }, roadKm: roadKm(point, m.location) })).sort((a, b) => a.roadKm - b.roadKm);
  const nearest = markets[0] ?? null;
  const benchmarkMarket = district?.markets.find((m) => m.id === bundle.market);

  const lot: Lot = {
    listingId: spec.listingClientId ?? `home-${spec.crop}`,
    crop: spec.crop,
    quantity: spec.quantity,
    grade: spec.grade,
    location: point,
    district: briefing.district,
    availableFrom: spec.availableFrom,
    availableUntil: spec.availableUntil,
  };
  const result = rankBuyers(lot, briefing.demand.requirements, {
    buyers: briefing.demand.buyers,
    benchmark: { modalPerQtl: crop.benchmark.modal.amount, district: briefing.district, market: bundle.market, asOf: bundle.asOf },
    tariffs: bundle.transport,
    financeRateAnnual: context.financeRateAnnual,
    nearestMandi: nearest === null ? null : { name: nearest.market.names.en, roadKm: nearest.roadKm },
    weights: { ...(profile?.crateKg === undefined ? {} : { crateKg: profile.crateKg }), ...(profile?.bagKg === undefined ? {} : { bagKg: profile.bagKg }) },
    substitutions: briefing.dictionary?.varietySubstitutions ?? [],
    today: new Date(briefing.computedAt + 5.5 * 3600_000).toISOString().slice(0, 10),
  });

  const below = new Map<string, { above: RankedMatch; why: OrderExplanation }>();
  result.matches.forEach((match, i) => {
    // Explain every card that offers more than one ranked above it: the case a farmer would query.
    const above = result.matches.slice(0, i).find((m) => m.offerPerQtl < match.offerPerQtl);
    if (above !== undefined) below.set(match.requirementId, { above, why: explainOrder(above, match) });
  });

  const shown = new Set(result.matches.map((m) => m.buyerId));
  return {
    kind: 'ranked',
    lot,
    result,
    below,
    benchmark: { modalPerQtl: crop.benchmark.modal.amount, market: benchmarkMarket === undefined ? null : { id: benchmarkMarket.id, names: benchmarkMarket.names }, asOf: bundle.asOf },
    nearestMandi: nearest,
    demonstration: briefing.demand.buyers.some((b) => shown.has(b.id) && b.demonstration === true),
    computedAt: briefing.computedAt,
  };
}
