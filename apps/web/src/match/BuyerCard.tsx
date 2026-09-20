/**
 * One buyer, explained (PROMPT §6.5). No match percentage, no score: every line is a dimension
 * the farmer can act on without trusting an algorithm they cannot inspect.
 *
 *   GODAVARI AGRO TRADERS · Lasalgaon
 *   ₹3,720 / qtl · ₹212 above today's Lasalgaon rate · 12 km away · wants your full 5 qtl
 *   ₹18,600 gross
 *   ₹18,250 estimated after freight          ← the headline figure
 *   23 completed deals · pays in ~4 days
 *
 * A buyer ranked below one offering less says why ("₹3,810 per quintal offered, but higher
 * payment-delay risk"). An open dispute is shown on the card, never hidden behind a clean record.
 */
import { overallRating, type MatchReason, type OrderExplanation, type PartyRating, type RankedMatch } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { number, rupees, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';

function reason<C extends MatchReason['code']>(match: RankedMatch, code: C): Extract<MatchReason, { code: C }> | undefined {
  return match.reasons.find((r): r is Extract<MatchReason, { code: C }> => r.code === code);
}

export function BuyerCard({
  locale,
  match,
  rank,
  marketName,
  below,
  rating,
}: {
  locale: Locale;
  match: RankedMatch;
  rank: number;
  marketName: string;
  below: { above: RankedMatch; why: OrderExplanation } | null;
  rating: PartyRating | null;
}) {
  const unit = t(locale, `unit.q.${match.matched.unit}`);
  const partial = reason(match, 'QUANTITY_PARTIAL');
  const record = reason(match, 'TRACK_RECORD');
  const risk = reason(match, 'PAYMENT_RISK');
  const dispute = reason(match, 'UNDER_DISPUTE');
  const substitution = reason(match, 'SUBSTITUTION');
  const delta = Math.round(match.vsBenchmarkPerQtl);
  const vsKey = delta > 0 ? 'confirm.vsBenchmark.above' : delta < 0 ? 'confirm.vsBenchmark.below' : 'confirm.vsBenchmark.at';

  return (
    <li className="buyer-card" data-testid="buyer-card" data-rank={rank} data-buyer={match.buyerId} data-requirement={match.requirementId}>
      <header className="buyer-card__head">
        <strong className="buyer-card__name" data-testid="buyer-name">
          {match.buyerName}
        </strong>
        <span className="muted"> · {match.buyerPlace}</span>
      </header>

      <p className="buyer-card__offer">
        <span className="figure buyer-card__price" data-testid="buyer-price" data-amount={match.offerPerQtl}>
          {rupees(locale, match.offerPerQtl)}
        </span>{' '}
        {t(locale, 'unit.per.quintal')}
      </p>
      <ul className="buyer-card__facts">
        <li>
          <Tx locale={locale} k={vsKey} values={{ market: marketName, amount: rupees(locale, Math.abs(delta)) }} words={['market']} />
        </li>
        <li>
          <Tx locale={locale} k="card.distance" values={{ km: number(locale, Math.round(match.roadKm)) }} />
        </li>
        <li data-testid="buyer-quantity" data-full={String(match.fullLot)}>
          {partial === undefined ? (
            <Tx locale={locale} k="card.full" values={{ qty: number(locale, match.matched.value), unit }} words={['unit']} />
          ) : (
            <Tx locale={locale} k="card.partial" values={{ matched: number(locale, partial.matched.value), remaining: number(locale, partial.remaining.value), unit }} words={['unit']} />
          )}
        </li>
      </ul>

      <p className="buyer-card__gross">
        <Tx locale={locale} k="card.gross" values={{ amount: rupees(locale, Math.round(match.gross)) }} />
      </p>
      <p className="buyer-card__net" data-testid="buyer-after-freight" data-amount={Math.round(match.afterFreight)}>
        <Tx locale={locale} k="card.afterFreight" values={{ amount: rupees(locale, Math.round(match.afterFreight)) }} />
      </p>
      <p className="muted buyer-card__vehicle">
        <Tx locale={locale} k="card.vehicle" values={{ vehicle: match.vehicleClass }} words={['vehicle']} />
      </p>

      <p className="buyer-card__record" data-testid="buyer-record" data-deals={match.completedDeals}>
        {record === undefined ? (
          t(locale, 'card.newBuyer')
        ) : (
          <Tx locale={locale} k="card.record" values={{ n: number(locale, record.completedDeals), days: number(locale, Math.round(record.typicalDaysToPay ?? match.expectedDaysToPay)) }} />
        )}
      </p>
      {/* What other farmers said, always with the count: one rating is not a hundred deals (§8.9).
          While a complaint against this buyer is open it is not shown at all: an open dispute
          suppresses the clean presentation, which is what gives the dispute path its teeth. */}
      {dispute === undefined && (
        <p className="muted buyer-card__rating" data-testid="buyer-rating" data-count={rating?.count ?? 0}>
          {overallRating(rating) === null ? (
            t(locale, 'deal.rating.none')
          ) : (
            <Tx locale={locale} k="deal.rating" values={{ rating: number(locale, overallRating(rating) ?? 0), n: number(locale, rating?.count ?? 0) }} />
          )}
        </p>
      )}
      {risk !== undefined && (
        <p className="buyer-card__risk" data-testid="buyer-risk">
          <Glyph name="caution" size={16} />
          <Tx locale={locale} k="card.risk" values={{ days: number(locale, Math.round(risk.expectedDaysToPay)), amount: rupees(locale, Math.round(risk.costPerQtl)) }} />
        </p>
      )}
      {dispute !== undefined && (
        <p className="buyer-card__risk" data-testid="buyer-dispute">
          <Glyph name="flag" size={16} />
          <Tx locale={locale} k="card.dispute" values={{ n: number(locale, dispute.openDisputes) }} />
        </p>
      )}
      {substitution !== undefined && (
        <p className="muted">
          <Tx locale={locale} k="card.substitution" values={{ requested: substitution.requested, offered: substitution.offered }} words={['requested', 'offered']} />
        </p>
      )}
      {match.gradeCheckAtPickup && <p className="muted">{t(locale, 'card.gradeAtPickup')}</p>}
      {below !== null && (
        <p className="buyer-card__why" data-testid="buyer-why" data-decisive={below.why.decisive}>
          <Tx locale={locale} k="card.below" values={{ amount: rupees(locale, match.offerPerQtl), reason: t(locale, `why.${below.why.decisive}`) }} words={['reason']} />
        </p>
      )}
    </li>
  );
}
